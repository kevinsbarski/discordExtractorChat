import { parseDiscordUrl } from '../../core/discordUrl';
import { fnv1a } from '../../core/hash';
import { snowflakeToMs } from '../../core/snowflake';
import type { ExportAuthor } from '../../core/types';
import type { CaptureBatchInput, IncomingMessage } from '../../storage/messageStore';
import { findMessageList, parseMessageItem, walkList } from './parser';

/**
 * Watches Discord's rendered message list and records every message of the
 * target conversation that appears while the user scrolls. It never scrolls,
 * clicks or requests anything itself: Discord's own client decides what is
 * loaded, and this session only reads what is on the page.
 */

export type CaptureState = 'capturing' | 'paused' | 'other-conversation' | 'waiting-for-list' | 'stopped' | 'error';

export interface CaptureView {
  state: CaptureState;
  /** Messages in range stored so far (from the background). */
  storedCount: number;
  attachmentCount: number;
  oldestMs?: number;
  newestMs?: number;
  startReached: boolean;
  endReached: boolean;
  /** Times of the oldest/newest message currently rendered on screen. */
  visibleOldestMs?: number;
  visibleNewestMs?: number;
  error?: string;
}

export interface CaptureSessionOptions {
  jobId: string;
  channelId: string;
  range: { startMs: number; endMs: number };
  startPaused?: boolean;
  /** Persists a batch; resolves with the job's updated totals. */
  send: (batch: CaptureBatchInput) => Promise<Pick<CaptureView, 'storedCount' | 'attachmentCount' | 'oldestMs' | 'newestMs' | 'startReached' | 'endReached'>>;
  onChange: (view: CaptureView) => void;
  doc?: Document;
  /** Current URL (injectable for tests). */
  location?: () => string;
  flushDelayMs?: number;
}

const MAX_BATCH = 150;

export class CaptureSession {
  private readonly doc: Document;
  private readonly getLocation: () => string;
  private list: Element | null = null;
  private observer: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private readonly sentHashes = new Map<string, number>();
  private readonly sentPairs = new Set<string>();
  private readonly authors = new Map<string, ExportAuthor>();
  private pendingMessages = new Map<string, IncomingMessage>();
  private pendingPairs: [string, string][] = [];
  /** The conversation's start header was rendered (nothing older exists). */
  private pendingBeginning = false;
  private beginningSent = false;
  private userPaused: boolean;
  private stopped = false;
  private view: CaptureView;

  constructor(private readonly options: CaptureSessionOptions) {
    this.doc = options.doc ?? document;
    this.getLocation = options.location ?? (() => location.href);
    this.userPaused = Boolean(options.startPaused);
    this.view = {
      state: this.userPaused ? 'paused' : 'waiting-for-list',
      storedCount: 0,
      attachmentCount: 0,
      startReached: false,
      endReached: false,
    };
  }

  get jobId(): string {
    return this.options.jobId;
  }

  get channelId(): string {
    return this.options.channelId;
  }

  get current(): CaptureView {
    return this.view;
  }

  start(): void {
    this.tickTimer = setInterval(() => this.tick(), 1500);
    this.tick();
  }

  pause(): void {
    this.userPaused = true;
    this.update({ state: 'paused' });
  }

  resume(): void {
    this.userPaused = false;
    this.tick();
  }

  get paused(): boolean {
    return this.userPaused;
  }

  /** Sends everything still pending. */
  async flushNow(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = null;
    for (const timer of [this.scanTimer, this.flushTimer]) if (timer) clearTimeout(timer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.update({ state: 'stopped' });
  }

  /** Merges totals reported by the background (e.g. after re-attaching). */
  applyTotals(totals: Partial<CaptureView>): void {
    this.update(totals);
  }

  private update(patch: Partial<CaptureView>): void {
    this.view = { ...this.view, ...patch };
    this.options.onChange(this.view);
  }

  private inConversation(): boolean {
    return parseDiscordUrl(this.getLocation())?.channelId === this.options.channelId;
  }

  /** Periodic check: navigation, list replacement, and a safety re-scan. */
  private tick(): void {
    if (this.stopped) return;
    if (this.userPaused) {
      this.detach();
      if (this.view.state !== 'paused') this.update({ state: 'paused' });
      return;
    }
    if (!this.inConversation()) {
      this.detach();
      if (this.view.state !== 'other-conversation') this.update({ state: 'other-conversation' });
      return;
    }
    const list = findMessageList(this.doc);
    if (!list) {
      this.detach();
      if (this.view.state !== 'waiting-for-list') this.update({ state: 'waiting-for-list' });
      return;
    }
    if (list !== this.list) this.attach(list);
    // An error state stays visible until a batch is stored successfully again.
    if (this.view.state !== 'capturing' && this.view.state !== 'error') this.update({ state: 'capturing' });
    this.scan();
  }

  private attach(list: Element): void {
    this.detach();
    this.list = list;
    const View = this.doc.defaultView;
    const Observer = View?.MutationObserver ?? MutationObserver;
    this.observer = new Observer(() => this.scheduleScan());
    this.observer.observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'href'] });
  }

  private detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.list = null;
  }

  private scheduleScan(): void {
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      if (!this.userPaused && !this.stopped && this.inConversation()) this.scan();
    }, 250);
  }

  /** Reads every rendered item and queues new or changed messages. */
  scan(): void {
    const list = this.list ?? findMessageList(this.doc);
    if (!list) return;
    const { startMs, endMs } = this.options.range;
    let previousId: string | null = null;
    let visibleOldest: number | undefined;
    let visibleNewest: number | undefined;

    for (const entry of walkList(list, this.options.channelId)) {
      if (entry.kind !== 'message') {
        // Hidden messages (e.g. a collapsed blocked group) break adjacency.
        previousId = null;
        if (entry.kind === 'beginning' && !this.beginningSent) this.pendingBeginning = true;
        continue;
      }
      const item = entry.el;
      const id = entry.messageId;
      const ms = snowflakeToMs(id);
      visibleOldest = visibleOldest === undefined ? ms : Math.min(visibleOldest, ms);
      visibleNewest = visibleNewest === undefined ? ms : Math.max(visibleNewest, ms);

      if (previousId) {
        const key = `${previousId}:${id}`;
        if (!this.sentPairs.has(key)) {
          this.sentPairs.add(key);
          this.pendingPairs.push([previousId, id]);
        }
      }
      previousId = id;

      let parsed: IncomingMessage | null;
      try {
        parsed = parseMessageItem(item, { channelId: this.options.channelId });
      } catch {
        parsed = null;
      }
      if (!parsed) continue;
      if (parsed.author.name || parsed.author.id) {
        if (!parsed.authorRefId) this.authors.set(id, parsed.author);
      } else if (parsed.authorRefId) {
        const head = this.authors.get(parsed.authorRefId);
        if (head) parsed.author = head;
      }
      if (ms < startMs || ms > endMs) continue;

      const hash = fnv1a(JSON.stringify(parsed));
      if (this.sentHashes.get(id) === hash) continue;
      this.pendingMessages.set(id, { ...parsed, hash });
    }

    this.update({ visibleOldestMs: visibleOldest, visibleNewestMs: visibleNewest });
    if (this.hasPending()) this.scheduleFlush();
  }

  private hasPending(): boolean {
    return this.pendingMessages.size > 0 || this.pendingPairs.length > 0 || this.pendingBeginning;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.options.flushDelayMs ?? 400);
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      this.scheduleFlush();
      return;
    }
    if (!this.hasPending()) return;
    this.flushing = true;
    const messages = [...this.pendingMessages.values()].slice(0, MAX_BATCH);
    const pairs = this.pendingPairs.splice(0, 2000);
    const reachedBeginning = this.pendingBeginning;
    this.pendingBeginning = false;
    for (const message of messages) this.pendingMessages.delete(message.id);
    try {
      const totals = await this.options.send({ messages, pairs, ...(reachedBeginning ? { reachedBeginning } : {}) });
      if (reachedBeginning) this.beginningSent = true;
      for (const message of messages) this.sentHashes.set(message.id, message.hash ?? 0);
      this.update({ ...totals, error: undefined, ...(this.view.state === 'error' ? { state: 'capturing' as const } : {}) });
    } catch (error) {
      // Put the batch back so nothing is lost, then surface the problem.
      for (const message of messages) if (!this.pendingMessages.has(message.id)) this.pendingMessages.set(message.id, message);
      this.pendingPairs.unshift(...pairs);
      if (reachedBeginning) this.pendingBeginning = true;
      this.update({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      this.flushing = false;
      return;
    }
    this.flushing = false;
    if (this.hasPending()) this.scheduleFlush();
  }
}
