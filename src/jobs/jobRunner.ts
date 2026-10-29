import { errorMessage, isAbortError } from '../core/format';
import type { ExportFormats } from '../core/types';
import { exportBaseName, writeExport, type SaveProgress, type SaveResult } from '../export/exporter';
import { DirectorySink, ZipSink, type OutputSink } from '../export/sinks';
import { runDownloads } from '../processing/downloadRunner';
import { DiscordBotClient } from '../retrieval/bot/client';
import { fetchMessagesInRange, loadConversationContext, refetchMessage } from '../retrieval/bot/fetcher';
import { getBotToken } from '../settings/botToken';
import { resetUnfinishedDownloads, tallyDownloads } from '../storage/downloadStore';
import { appendError, getJob, updateJob } from '../storage/jobStore';
import { putFetchedMessages } from '../storage/messageStore';
import type { DownloadState, ExportJob } from './model';

export type Activity = 'idle' | 'collecting' | 'downloading' | 'saving';

export interface RunnerStatus {
  activity: Activity;
  rateLimitedUntil?: number;
  download?: DownloadState;
  save?: SaveProgress;
  lastError?: string;
}

const CONTENT_INTENT_WARNING =
  'Messages arrive without content: the bot probably does not have the Message Content intent enabled (Developer Portal → Bot → Privileged Gateway Intents).';

/**
 * Runs the long parts of a job inside the export page: bot collection,
 * attachment downloads and saving. One activity at a time; pausing or
 * cancelling aborts the current activity, and progress is persisted so a
 * closed page can pick up where it stopped.
 */
export class JobRunner {
  private controller: AbortController | null = null;
  /** The activity currently running, so pause/stop can wait for it to wind down. */
  private task: Promise<unknown> | null = null;
  status: RunnerStatus = { activity: 'idle' };

  constructor(
    private readonly jobId: string,
    private readonly onChange: () => void,
  ) {}

  private set(patch: Partial<RunnerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onChange();
  }

  get busy(): boolean {
    return this.status.activity !== 'idle';
  }

  private async begin(activity: Activity): Promise<AbortSignal> {
    this.controller?.abort();
    this.controller = new AbortController();
    this.set({ activity, lastError: undefined });
    return this.controller.signal;
  }

  private end(): void {
    this.controller = null;
    this.set({ activity: 'idle', rateLimitedUntil: undefined });
  }

  private async track<T>(run: () => Promise<T>): Promise<T> {
    const task = run();
    this.task = task;
    try {
      return await task;
    } finally {
      if (this.task === task) this.task = null;
    }
  }

  /** Aborts the current activity and waits until it has stopped. */
  private async interrupt(): Promise<void> {
    this.controller?.abort();
    await this.task?.catch(() => undefined);
  }

  private async fail(stage: 'collecting' | 'downloading' | 'saving', error: unknown): Promise<void> {
    const message = errorMessage(error);
    this.set({ lastError: message });
    await updateJob(this.jobId, (job) => appendError(job, stage, message)).catch(() => undefined);
  }

  /** Continues whatever the job's current stage needs (used on page load). */
  async continueJob(): Promise<void> {
    const job = await getJob(this.jobId);
    if (!job || job.paused || this.busy) return;
    if (job.stage === 'collecting' && job.method === 'bot') await this.collectWithBot();
    const after = await getJob(this.jobId);
    if (after?.stage === 'downloading' && !after.paused) await this.download();
  }

  collectWithBot(): Promise<void> {
    return this.track(() => this.collectWithBotTask());
  }

  private async collectWithBotTask(): Promise<void> {
    const signal = await this.begin('collecting');
    try {
      const job = await requireJob(this.jobId);
      const stored = await getBotToken();
      if (!stored) throw new Error('No bot token is set. Add one in the extension options, then resume.');
      const client = new DiscordBotClient(stored.token, {
        onRateLimit: (waitMs) => this.set({ rateLimitedUntil: Date.now() + waitMs }),
      });
      const context = await loadConversationContext(client, job.conversation.channelId, signal);
      await updateJob(this.jobId, (j) => {
        if (context.channel.name) j.conversation.channelName ??= `#${context.channel.name}`;
        if (context.guild?.name) j.conversation.guildName ??= context.guild.name;
        j.collect.startReached = true;
      });

      let requests = job.collect.requests ?? 0;
      for await (const page of fetchMessagesInRange(
        client,
        job.conversation.channelId,
        job.range,
        job.collect.cursor,
        context.mapContext,
        signal,
      )) {
        requests++;
        const { added, attachments } = await putFetchedMessages(this.jobId, page.messages);
        await updateJob(this.jobId, (j) => {
          j.collect.cursor = page.cursor;
          j.collect.messageCount += added;
          j.collect.attachmentCount += attachments;
          j.collect.requests = requests;
          for (const message of page.messages) {
            const ms = Date.parse(message.timestamp);
            if (j.collect.oldestMs === undefined || ms < j.collect.oldestMs) j.collect.oldestMs = ms;
            if (j.collect.newestMs === undefined || ms > j.collect.newestMs) j.collect.newestMs = ms;
          }
          if (page.missingContentIntent && !j.collect.warnings.includes(CONTENT_INTENT_WARNING)) {
            j.collect.warnings.push(CONTENT_INTENT_WARNING);
          }
          if (page.finished) {
            j.collect.done = true;
            j.collect.endReached = true;
            j.stage = j.options.downloadAttachments || j.options.downloadAssets ? 'downloading' : 'ready';
          }
        });
        this.set({ rateLimitedUntil: undefined });
      }
    } catch (error) {
      if (!(isAbortError(error) || signal.aborted)) await this.fail('collecting', error);
    } finally {
      this.end();
    }
  }

  download(): Promise<void> {
    return this.track(() => this.downloadTask());
  }

  private async downloadTask(): Promise<void> {
    const signal = await this.begin('downloading');
    try {
      const job = await requireJob(this.jobId);
      let refreshAttachment;
      if (job.method === 'bot') {
        const stored = await getBotToken();
        if (stored) {
          const client = new DiscordBotClient(stored.token);
          refreshAttachment = async (messageId: string, attachmentId: string, s?: AbortSignal) => {
            const fresh = await refetchMessage(client, job.conversation.channelId, messageId, {}, s);
            return fresh?.attachments.find((a) => a.id === attachmentId) ?? null;
          };
        }
      }
      const result = await runDownloads(job, { refreshAttachment, onProgress: (download) => this.set({ download }) }, signal);
      if (result === 'completed') {
        await updateJob(this.jobId, (j) => {
          j.stage = 'ready';
          j.paused = false;
          j.download.finishedAt = Date.now();
        });
      }
    } catch (error) {
      if (!(isAbortError(error) || signal.aborted)) await this.fail('downloading', error);
    } finally {
      this.end();
    }
  }

  /** Pauses the current stage (collection or downloads). */
  async pause(): Promise<void> {
    await this.interrupt();
    await updateJob(this.jobId, (job) => {
      job.paused = true;
    });
    this.onChange();
  }

  async resume(): Promise<void> {
    await updateJob(this.jobId, (job) => {
      job.paused = false;
    });
    await this.continueJob();
  }

  /** Stops collecting/downloading and keeps what was gathered. */
  async stopStage(): Promise<void> {
    await this.interrupt();
    await updateJob(this.jobId, (job) => {
      if (job.stage !== 'ready') job.cancelled = true;
      job.stage = 'ready';
      job.paused = false;
    });
    this.onChange();
  }

  async retryFailedDownloads(): Promise<void> {
    await resetUnfinishedDownloads(this.jobId);
    await updateJob(this.jobId, (job) => {
      job.stage = 'downloading';
      job.paused = false;
      job.cancelled = false;
    });
    await this.download();
  }

  saveTo(sinkFactory: () => Promise<OutputSink>, formats: ExportFormats): Promise<SaveResult | null> {
    return this.track(() => this.saveTask(sinkFactory, formats));
  }

  private async saveTask(sinkFactory: () => Promise<OutputSink>, formats: ExportFormats): Promise<SaveResult | null> {
    let sink: OutputSink | null = null;
    const signal = await this.begin('saving');
    try {
      sink = await sinkFactory();
      const job = await requireJob(this.jobId);
      const result = await writeExport(job, sink, formats, (save) => this.set({ save }), signal);
      await updateJob(this.jobId, (j) => {
        j.saves.push({
          at: Date.now(),
          target: sink!.kind === 'zip' ? 'zip' : 'folder',
          name: sink!.name,
          files: result.files,
          bytes: result.bytes,
          completed: true,
        });
      });
      return result;
    } catch (error) {
      await sink?.abort().catch(() => undefined);
      if (isAbortError(error) || signal.aborted) {
        this.set({ lastError: 'Saving was cancelled; the destination contains a partial export.' });
      } else {
        await this.fail('saving', error);
      }
      return null;
    } finally {
      this.set({ save: undefined });
      this.end();
    }
  }

  cancelSave(): void {
    if (this.status.activity === 'saving') this.controller?.abort();
  }

  dispose(): void {
    this.controller?.abort();
  }
}

async function requireJob(jobId: string): Promise<ExportJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error('This export no longer exists.');
  return job;
}

/** Asks for a parent folder; the export goes into a new sub-folder. Must run in a click handler. */
export async function pickFolderSink(job: ExportJob): Promise<() => Promise<OutputSink>> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot save into folders (File System Access API missing).');
  const parent = await window.showDirectoryPicker({ id: 'chat-export', mode: 'readwrite', startIn: 'downloads' });
  return () => DirectorySink.create(parent, exportBaseName(job));
}

/** Asks for a ZIP file name. Must run in a click handler. */
export async function pickZipSink(job: ExportJob): Promise<() => Promise<OutputSink>> {
  if (!window.showSaveFilePicker) throw new Error('This browser cannot save files directly (File System Access API missing).');
  const handle = await window.showSaveFilePicker({
    id: 'chat-export-zip',
    suggestedName: `${exportBaseName(job)}.zip`,
    startIn: 'downloads',
    types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
  });
  return async () => {
    const tally = await tallyDownloads(job.id);
    const estimatedBytes = tally.bytes + job.collect.messageCount * 4096;
    const entries = tally.done + Math.ceil(job.collect.messageCount / job.options.messagesPerHtmlPart) + 8;
    const zip64 = estimatedBytes > 3.5 * 1024 ** 3 || entries > 60_000;
    const writable = await handle.createWritable();
    return new ZipSink(writable, handle.name, { zip64 });
  };
}
