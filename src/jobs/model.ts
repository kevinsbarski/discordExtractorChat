import type { ConversationRef, DateRange, ExportMessage, ExportOptions, RetrievalMethod } from '../core/types';

/**
 * An export job moves through three stages:
 *   collecting  – messages are gathered (DOM capture or bot API)
 *   downloading – attachments and assets are copied into local storage
 *   ready       – everything is stored locally and can be saved (repeatedly)
 * Each stage can be paused and resumed; cancelling stops collection or
 * downloading early and keeps whatever was gathered so far.
 */
export type JobStage = 'collecting' | 'downloading' | 'ready';

export interface CollectState {
  /** Messages stored for this job (inside the date range). */
  messageCount: number;
  attachmentCount: number;
  /** Oldest / newest stored message times (epoch ms). */
  oldestMs?: number;
  newestMs?: number;
  /** Collection reached past the start of the range (or the conversation's first message). */
  startReached: boolean;
  /** Collection reached past the end of the range (or the conversation's latest message). */
  endReached: boolean;
  /** DOM capture: tab the capture runs in. */
  tabId?: number;
  /** DOM capture: last time the content script reported in (epoch ms). */
  lastActivityAt?: number;
  /** Bot API: ID of the newest message fetched so far (pagination cursor). */
  cursor?: string;
  /** Bot API: requests made and time spent waiting for rate limits. */
  requests?: number;
  rateLimitWaitMs?: number;
  /** Collection finished (user finished capture or the API ran out of messages). */
  done: boolean;
  warnings: string[];
}

export interface DownloadState {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  bytes: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface JobError {
  at: number;
  stage: JobStage | 'saving';
  message: string;
}

export interface SaveRecord {
  at: number;
  target: 'folder' | 'zip';
  name: string;
  files: number;
  bytes: number;
  completed: boolean;
  message?: string;
}

export interface ExportJob {
  id: string;
  schema: 1;
  createdAt: number;
  updatedAt: number;
  method: RetrievalMethod;
  conversation: ConversationRef;
  range: DateRange;
  options: ExportOptions;
  stage: JobStage;
  paused: boolean;
  /** Collection or downloading was cancelled; the stored data is partial. */
  cancelled: boolean;
  collect: CollectState;
  download: DownloadState;
  /** Most recent errors (capped); `errorCount` counts all of them. */
  errors: JobError[];
  errorCount: number;
  saves: SaveRecord[];
}

export const MAX_STORED_ERRORS = 200;

export interface StoredMessage extends ExportMessage {
  jobId: string;
  /** Zero-padded ID; with `jobId` forms the primary key (chronological order). */
  sortKey: string;
  /** Neighbours observed directly before/after this message (gap detection). */
  prevId?: string;
  nextId?: string;
  /** Change-detection hash of the captured content. */
  hash?: number;
  updatedAt: number;
}

export type DownloadKind = 'attachment' | 'asset';

export type DownloadStatus = 'pending' | 'done' | 'failed' | 'expired' | 'missing' | 'skipped';

export interface DownloadRecord {
  jobId: string;
  /** `a:<attachmentId>` for attachments, `s:<assetKey>` for assets. */
  key: string;
  kind: DownloadKind;
  messageId?: string;
  /** Original file name (attachments). */
  filename: string;
  /** Path inside the export, e.g. `attachments/photo.png`. Assigned once. */
  localPath?: string;
  /** Name of the cached copy in the origin-private file system. */
  cacheName?: string;
  /** Asset URL (attachments always use the latest URL stored on the message). */
  url?: string;
  status: DownloadStatus;
  bytes?: number;
  contentType?: string;
  attempts: number;
  error?: string;
  updatedAt: number;
}

export function emptyCollectState(): CollectState {
  return { messageCount: 0, attachmentCount: 0, startReached: false, endReached: false, done: false, warnings: [] };
}

export function emptyDownloadState(): DownloadState {
  return { total: 0, done: 0, failed: 0, skipped: 0, bytes: 0 };
}

export function attachmentDownloadKey(attachmentId: string): string {
  return `a:${attachmentId}`;
}

export function assetDownloadKey(assetKey: string): string {
  return `s:${assetKey}`;
}

export function describeStage(job: ExportJob): string {
  if (job.stage === 'collecting') {
    if (job.paused) return 'Collection paused';
    return job.method === 'dom' ? 'Capturing messages' : 'Fetching messages';
  }
  if (job.stage === 'downloading') return job.paused ? 'Downloads paused' : 'Downloading attachments';
  return 'Ready to save';
}
