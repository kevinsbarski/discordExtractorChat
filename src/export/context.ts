import type { ExportAttachment, ExportAuthor } from '../core/types';
import type { DownloadStatus, ExportJob, StoredMessage } from '../jobs/model';
import { describeAsset } from '../processing/discordCdn';
import { iterateDownloads } from '../storage/downloadStore';
import { findGaps, getMessage, iterateMessages, loadSortedIds, type Gap } from '../storage/messageStore';

export const EXPORTER_NAME = 'Local Chat Exporter for Discord';
export const EXPORTER_VERSION = '0.1.0';

export interface FileInfo {
  status: DownloadStatus;
  localPath?: string;
  bytes?: number;
  error?: string;
}

/** Everything the format writers need, loaded once per save. */
export interface ExportContext {
  job: ExportJob;
  exportedAt: string;
  /** Attachment ID → download state. */
  attachments: Map<string, FileInfo>;
  /** Asset key → local path (downloaded assets only). */
  assets: Map<string, string>;
  /** Sorted message IDs (compact). */
  ids: BigUint64Array;
  messagesPerPart: number;
  gaps: { gaps: Gap[]; total: number };
}

export interface ResolvedMessage extends StoredMessage {
  author: ExportAuthor;
}

export async function buildExportContext(job: ExportJob): Promise<ExportContext> {
  const attachments = new Map<string, FileInfo>();
  const assets = new Map<string, string>();
  for await (const batch of iterateDownloads(job.id)) {
    for (const record of batch) {
      if (record.kind === 'attachment') {
        attachments.set(record.key.slice(2), {
          status: record.status,
          localPath: record.status === 'done' ? record.localPath : undefined,
          bytes: record.bytes,
          error: record.error,
        });
      } else if (record.status === 'done' && record.localPath) {
        assets.set(record.key.slice(2), record.localPath);
      }
    }
  }
  const ids = await loadSortedIds(job.id);
  const gaps = job.method === 'dom' ? await findGaps(job.id) : { gaps: [], total: 0 };
  return {
    job,
    exportedAt: new Date().toISOString(),
    attachments,
    assets,
    ids,
    messagesPerPart: Math.max(50, job.options.messagesPerHtmlPart || 1000),
    gaps,
  };
}

export function partCount(ctx: ExportContext): number {
  return Math.max(1, Math.ceil(ctx.ids.length / ctx.messagesPerPart));
}

/** Index of the stored message with this ID, or -1. */
export function messageIndex(ctx: ExportContext, id: string): number {
  let target: bigint;
  try {
    target = BigInt(id);
  } catch {
    return -1;
  }
  let lo = 0;
  let hi = ctx.ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = ctx.ids[mid];
    if (value === target) return mid;
    if (value < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function partOfMessage(ctx: ExportContext, id: string): number | null {
  const index = messageIndex(ctx, id);
  return index < 0 ? null : Math.floor(index / ctx.messagesPerPart);
}

export function assetPath(ctx: ExportContext, url: string | undefined): string | undefined {
  const asset = describeAsset(url);
  return asset ? ctx.assets.get(asset.key) : undefined;
}

export function attachmentFile(ctx: ExportContext, attachment: ExportAttachment): FileInfo | undefined {
  return ctx.attachments.get(attachment.id);
}

export const UNKNOWN_AUTHOR: ExportAuthor = { name: 'Unknown author' };

/**
 * DOM-captured continuation messages only point at the first message of
 * their visual group; this resolves (and caches) the actual author.
 */
export class AuthorResolver {
  private readonly cache = new Map<string, ExportAuthor>();

  constructor(private readonly jobId: string) {}

  async resolve(message: StoredMessage): Promise<ExportAuthor> {
    // System messages name their actor in the text; there is no author.
    if (message.system) return message.author ?? { name: '' };
    if (message.author && (message.author.id || message.author.name)) {
      this.cache.set(message.id, message.author);
      return message.author;
    }
    const ref = message.authorRefId;
    if (!ref) return UNKNOWN_AUTHOR;
    const cached = this.cache.get(ref);
    if (cached) return cached;
    const head = await getMessage(this.jobId, ref);
    const author = head?.author && (head.author.id || head.author.name) ? head.author : UNKNOWN_AUTHOR;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(ref, author);
    return author;
  }
}

/** Messages in chronological order with authors resolved, in batches. */
export async function* resolvedMessages(ctx: ExportContext, batchSize = 250): AsyncGenerator<ResolvedMessage[]> {
  const resolver = new AuthorResolver(ctx.job.id);
  for await (const batch of iterateMessages(ctx.job.id, batchSize)) {
    const resolved: ResolvedMessage[] = [];
    for (const message of batch) resolved.push({ ...message, author: await resolver.resolve(message) });
    yield resolved;
  }
}

/** Flattens batches into single messages. */
export async function* eachMessage(ctx: ExportContext): AsyncGenerator<ResolvedMessage> {
  for await (const batch of resolvedMessages(ctx)) yield* batch;
}

export function conversationTitle(ctx: { job: ExportJob }): string {
  const c = ctx.job.conversation;
  const channel = c.channelName || `channel ${c.channelId}`;
  if (!c.guildId) return channel.startsWith('@') ? channel : `Direct messages: ${channel}`;
  return channel.startsWith('#') ? channel : `#${channel}`;
}

export interface CompletenessReport {
  method: 'dom' | 'bot';
  startReached: boolean;
  endReached: boolean;
  cancelled: boolean;
  possibleGaps: number;
  notes: string[];
}

export function completenessReport(ctx: ExportContext): CompletenessReport {
  const { job } = ctx;
  const notes: string[] = [];
  if (job.method === 'dom') {
    notes.push(
      'Captured from messages rendered in the browser while scrolling. Only messages that were displayed during the capture are included.',
    );
    if (!job.collect.startReached) {
      notes.push('The capture did not reach the start of the date range; older messages in the range may be missing.');
    }
    if (!job.collect.endReached) {
      notes.push('The capture did not reach the end of the date range; newer messages in the range may be missing.');
    }
    if (ctx.gaps.total) {
      notes.push(`${ctx.gaps.total} place(s) where messages may be missing between two captured messages (see "gaps").`);
    }
  } else if (!job.collect.done) {
    notes.push('Fetching stopped before the end of the date range.');
  }
  if (job.cancelled) notes.push('The export was cancelled before it finished; the data is partial.');
  for (const warning of job.collect.warnings) notes.push(warning);
  return {
    method: job.method,
    startReached: job.collect.startReached,
    endReached: job.collect.endReached,
    cancelled: job.cancelled,
    possibleGaps: ctx.gaps.total,
    notes,
  };
}
