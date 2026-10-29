import { buildChannelUrl, parseDiscordUrl } from '../../core/discordUrl';
import { formatDateTime } from '../../core/format';
import { msToSnowflake } from '../../core/snowflake';
import type { ExportJob } from '../../jobs/model';
import { sendToBackground, type ContentRequest, type ContentResponses, type PageInfo } from '../../messaging/protocol';
import { CaptureSession, type CaptureView } from './captureSession';
import { CaptureOverlay } from './overlay';

/** Channel and server names from the tab title, e.g. "#general | My Server - Discord". */
export function namesFromTitle(title: string): { channelName?: string; guildName?: string } {
  const parts = title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/^•\s*/, '')
    .split(/\s+[|•]\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== 'discord');
  if (!parts.length) return {};
  const channelIndex = parts.findIndex((part) => part.startsWith('#') || part.startsWith('@'));
  if (channelIndex === -1) return { channelName: parts[0], guildName: parts[1] };
  const guildName = parts.find((_, i) => i !== channelIndex);
  return { channelName: parts[channelIndex], guildName };
}

type CaptureTotals = Pick<CaptureView, 'storedCount' | 'attachmentCount' | 'oldestMs' | 'newestMs' | 'startReached' | 'endReached'>;

function totalsFrom(job: ExportJob): CaptureTotals {
  return {
    storedCount: job.collect.messageCount,
    attachmentCount: job.collect.attachmentCount,
    oldestMs: job.collect.oldestMs,
    newestMs: job.collect.newestMs,
    startReached: job.collect.startReached,
    endReached: job.collect.endReached,
  };
}

type Envelope = { ok: true; data: unknown } | { ok: false; error: string };

/** Runs inside the Discord tab: answers the popup and drives capture sessions. */
export class ContentController {
  private session: CaptureSession | null = null;
  private overlay: CaptureOverlay | null = null;
  private job: ExportJob | null = null;

  pageInfo(): PageInfo {
    return {
      location: parseDiscordUrl(location.href),
      title: document.title,
      ...namesFromTitle(document.title),
      captureJobId: this.session?.jobId,
    };
  }

  handle(message: ContentRequest, sendResponse: (response: Envelope) => void): boolean {
    const run = async (): Promise<ContentResponses[ContentRequest['type']]> => {
      switch (message.type) {
        case 'content/ping':
          return this.pageInfo();
        case 'capture/start':
          this.startCapture(message.job);
          return { started: true };
        case 'capture/command':
          await this.command(message.jobId, message.command);
          return { done: true };
      }
    };
    run().then(
      (data) => sendResponse({ ok: true, data }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  }

  /** After a reload, continue an active capture that belongs to this tab. */
  async attachIfActive(): Promise<void> {
    try {
      const { job } = await sendToBackground({ type: 'capture/attach', channelId: parseDiscordUrl(location.href)?.channelId ?? '' });
      if (job && !this.session) this.startCapture(job);
    } catch {
      // The extension may have been reloaded; nothing to resume.
    }
  }

  startCapture(job: ExportJob): void {
    this.dispose();
    this.job = job;
    const conversationLabel = [job.conversation.channelName, job.conversation.guildName].filter(Boolean).join(' · ') ||
      `Conversation ${job.conversation.channelId}`;
    this.overlay = new CaptureOverlay(
      { conversationLabel, range: job.range },
      {
        onPause: () => void this.command(job.id, 'pause'),
        onResume: () => void this.command(job.id, 'resume'),
        onFinish: () => void this.finish(),
        onCancel: () => void this.cancel(false),
        onJumpToStart: () => void this.jumpToStart(),
        onCheckGaps: () => void this.checkGaps(),
        onReturn: () => location.assign(job.conversation.url),
      },
    );
    this.session = new CaptureSession({
      jobId: job.id,
      channelId: job.conversation.channelId,
      range: job.range,
      startPaused: job.paused,
      send: async (batch) => {
        const { job: updated } = await sendToBackground({ type: 'capture/batch', jobId: job.id, batch });
        this.job = updated;
        return totalsFrom(updated);
      },
      onChange: (view) => this.overlay?.render(view),
    });
    this.session.applyTotals(totalsFrom(job));
    this.session.start();
  }

  async command(jobId: string, command: 'pause' | 'resume' | 'finish' | 'cancel'): Promise<void> {
    if (!this.session || this.session.jobId !== jobId) return;
    switch (command) {
      case 'pause':
        this.session.pause();
        await this.session.flushNow();
        await sendToBackground({ type: 'capture/set-paused', jobId, paused: true });
        break;
      case 'resume':
        this.session.resume();
        await sendToBackground({ type: 'capture/set-paused', jobId, paused: false });
        break;
      case 'finish':
        await this.finish(true);
        break;
      case 'cancel':
        await this.cancel(true);
        break;
    }
  }

  private async cancel(confirmed: boolean): Promise<void> {
    const job = this.job;
    if (!job) return;
    if (!confirmed && !confirm('Discard this capture? Everything captured so far will be deleted.')) return;
    this.dispose();
    await sendToBackground({ type: 'job/discard', jobId: job.id });
  }

  private async finish(skipConfirm = false): Promise<void> {
    const session = this.session;
    const job = this.job;
    if (!session || !job) return;
    this.overlay?.setBusy(true);
    try {
      await session.flushNow();
      if (!skipConfirm) {
        const view = session.current;
        const missing: string[] = [];
        if (!view.startReached) missing.push('the start of the date range');
        if (!view.endReached) missing.push('the end of the date range');
        const { total } = await sendToBackground({ type: 'job/gaps', jobId: job.id });
        let question = '';
        if (missing.length) question += `The capture has not reached ${missing.join(' or ')}. `;
        if (total) question += `${total} possible gap(s) were found between captured messages. `;
        if (question && !confirm(`${question}\n\nFinish anyway and continue with what was captured?`)) return;
      }
      session.stop();
      await sendToBackground({ type: 'capture/finish', jobId: job.id });
      this.dispose();
    } finally {
      this.overlay?.setBusy(false);
    }
  }

  private async jumpToStart(): Promise<void> {
    const job = this.job;
    const session = this.session;
    if (!job || !session) return;
    await session.flushNow();
    const target = buildChannelUrl(
      { guildId: job.conversation.guildId, channelId: job.conversation.channelId },
      msToSnowflake(job.range.startMs),
    );
    location.assign(target);
  }

  private async checkGaps(): Promise<void> {
    const job = this.job;
    if (!job || !this.session) return;
    await this.session.flushNow();
    const { total, gaps } = await sendToBackground({ type: 'job/gaps', jobId: job.id });
    if (!total) {
      this.overlay?.setGaps('No gaps between captured messages.');
      return;
    }
    const sample = gaps
      .slice(0, 3)
      .map((gap) => `${formatDateTime(gap.fromMs)} → ${formatDateTime(gap.toMs)}`)
      .join('; ');
    this.overlay?.setGaps(`${total} possible gap(s). Scroll through: ${sample}${total > 3 ? '; …' : ''}`);
  }

  dispose(): void {
    this.session?.stop();
    this.session = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
