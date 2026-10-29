import { isAbortError } from '../core/format';
import type { ExportAttachment, ExportMessage } from '../core/types';
import {
  assetDownloadKey,
  attachmentDownloadKey,
  type DownloadRecord,
  type DownloadState,
  type ExportJob,
} from '../jobs/model';
import { openExporterDb } from '../storage/db';
import { assignedLocalPaths, iterateDownloads, putDownload, tallyDownloads } from '../storage/downloadStore';
import { writeCacheFile } from '../storage/fileCache';
import { updateJob } from '../storage/jobStore';
import { getMessage, iterateMessages, replaceMessage } from '../storage/messageStore';
import { attachmentCandidateUrls, describeAsset } from './discordCdn';
import { downloadToCache, type DownloadOutcome } from './downloader';
import { FilenameAllocator } from './filenames';

/** URLs of avatars, custom emoji and stickers referenced by a message. */
export function assetUrlsOf(message: ExportMessage): string[] {
  const urls: string[] = [];
  if (message.author.avatarUrl) urls.push(message.author.avatarUrl);
  for (const emoji of message.emojis) urls.push(emoji.url);
  for (const sticker of message.stickers) if (sticker.url) urls.push(sticker.url);
  for (const reaction of message.reactions) if (reaction.emojiUrl) urls.push(reaction.emojiUrl);
  return urls;
}

function cacheNameFor(key: string): string {
  return key.replace(/[^\w.-]+/g, '-');
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Creates a pending download record for every attachment (and asset, if
 * enabled) that does not have one yet. Safe to run repeatedly.
 */
export async function prepareDownloads(job: ExportJob): Promise<void> {
  const db = await openExporterDb();
  const seenAssets = new Set<string>();
  const now = Date.now();
  for await (const batch of iterateMessages(job.id, 250)) {
    const wanted: Omit<DownloadRecord, 'jobId' | 'status' | 'attempts' | 'updatedAt'>[] = [];
    for (const message of batch) {
      if (job.options.downloadAttachments) {
        for (const attachment of message.attachments) {
          wanted.push({
            key: attachmentDownloadKey(attachment.id),
            kind: 'attachment',
            messageId: message.id,
            filename: attachment.filename,
          });
        }
      }
      if (job.options.downloadAssets) {
        for (const url of assetUrlsOf(message)) {
          const asset = describeAsset(url);
          if (!asset || seenAssets.has(asset.key)) continue;
          seenAssets.add(asset.key);
          wanted.push({
            key: assetDownloadKey(asset.key),
            kind: 'asset',
            filename: basename(asset.path),
            url: asset.url,
            localPath: asset.path,
          });
        }
      }
    }
    if (!wanted.length) continue;
    const tx = db.transaction('downloads', 'readwrite');
    for (const record of wanted) {
      const existing = await tx.store.get([job.id, record.key]);
      if (!existing) {
        await tx.store.put({ ...record, jobId: job.id, status: 'pending', attempts: 0, updatedAt: now });
      }
    }
    await tx.done;
  }
}

async function* pendingRecords(jobId: string): AsyncGenerator<DownloadRecord> {
  for await (const batch of iterateDownloads(jobId, 200)) {
    for (const record of batch) if (record.status === 'pending') yield record;
  }
}

export interface DownloadRunnerOptions {
  fetch?: typeof fetch;
  concurrency?: number;
  /** Bot mode: fetch the message again to get a fresh signed URL. */
  refreshAttachment?: (messageId: string, attachmentId: string, signal?: AbortSignal) => Promise<ExportAttachment | null>;
  onProgress?: (state: DownloadState) => void;
}

export type DownloadRunResult = 'completed' | 'aborted';

/**
 * Downloads every pending record into the cache. Aborting (pause/cancel)
 * leaves unfinished records pending, so the next run picks them up.
 */
export async function runDownloads(
  job: ExportJob,
  options: DownloadRunnerOptions = {},
  signal?: AbortSignal,
): Promise<DownloadRunResult> {
  await prepareDownloads(job);

  const allocator = new FilenameAllocator(
    (await assignedLocalPaths(job.id))
      .filter((path) => path.startsWith('attachments/'))
      .map((path) => path.slice('attachments/'.length)),
  );
  const tally = await tallyDownloads(job.id);
  const state: DownloadState = {
    ...job.download,
    total: tally.total,
    done: tally.done,
    failed: tally.failed + tally.expired + tally.missing,
    skipped: tally.skipped,
    bytes: tally.bytes,
    startedAt: job.download.startedAt ?? Date.now(),
  };
  options.onProgress?.({ ...state });

  let lastPersist = 0;
  const persist = async (force = false) => {
    if (!force && Date.now() - lastPersist < 1000) return;
    lastPersist = Date.now();
    const snapshot = { ...state };
    await updateJob(job.id, (j) => {
      j.download = snapshot;
    });
  };

  const writeFile = (name: string, body: ReadableStream<Uint8Array>, s?: AbortSignal) => writeCacheFile(job.id, name, body, s);

  const processRecord = async (record: DownloadRecord) => {
    let outcome: DownloadOutcome;
    record.cacheName ??= cacheNameFor(record.key);

    if (record.kind === 'attachment') {
      const attachmentId = record.key.slice(2);
      const message = record.messageId ? await getMessage(job.id, record.messageId) : undefined;
      let attachment = message?.attachments.find((a) => a.id === attachmentId);
      if (!message || !attachment) {
        outcome = { status: 'missing', error: 'The attachment is no longer part of the export.' };
      } else {
        record.localPath ??= `attachments/${allocator.allocate(attachment.filename, 'attachment')}`;
        const download = (att: ExportAttachment) =>
          downloadToCache(
            {
              urls: attachmentCandidateUrls(att.url, att.fallbackUrls ?? []),
              filename: att.filename,
              expectedSize: att.size,
              cacheName: record.cacheName!,
            },
            { fetch: options.fetch, writeFile },
            signal,
          );
        outcome = await download(attachment);
        if (outcome.status === 'expired' && options.refreshAttachment) {
          const fresh = await options.refreshAttachment(message.id, attachmentId, signal);
          if (fresh) {
            attachment = { ...attachment, ...fresh };
            await replaceMessage({
              ...message,
              attachments: message.attachments.map((a) => (a.id === attachmentId ? attachment! : a)),
            });
            outcome = await download(attachment);
          }
        }
      }
    } else {
      outcome = await downloadToCache(
        { urls: record.url ? [record.url] : [], filename: record.filename, cacheName: record.cacheName },
        { fetch: options.fetch, writeFile },
        signal,
      );
    }

    record.attempts++;
    record.status = outcome.status;
    if (outcome.status === 'done') {
      record.bytes = outcome.bytes;
      record.contentType = outcome.contentType;
      record.error = undefined;
      state.done++;
      state.bytes += outcome.bytes;
    } else {
      record.error = outcome.error;
      state.failed++;
    }
    await putDownload(record);
    options.onProgress?.({ ...state });
    await persist();
  };

  const queue = pendingRecords(job.id);
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 3) }, async () => {
    for (;;) {
      signal?.throwIfAborted();
      const next = await queue.next();
      if (next.done) return;
      await processRecord(next.value);
    }
  });

  try {
    await Promise.all(workers);
  } catch (error) {
    await persist(true).catch(() => undefined);
    if (isAbortError(error) || signal?.aborted) return 'aborted';
    throw error;
  }

  state.finishedAt = Date.now();
  await persist(true);
  return 'completed';
}
