import { snowflakeSortKey, snowflakeToMs } from '../core/snowflake';
import type { ExportAttachment, ExportAuthor, ExportEmoji, ExportMessage } from '../core/types';
import type { ExportJob, StoredMessage } from '../jobs/model';
import { jobKeyRange, jobKeyRangeAfter, openExporterDb } from './db';

/** A message produced by a retrieval adapter, plus a change-detection hash. */
export interface IncomingMessage extends ExportMessage {
  hash?: number;
}

export interface CaptureBatchInput {
  messages: IncomingMessage[];
  /** Pairs of message IDs seen directly next to each other: `[older, newer]`. */
  pairs: [string, string][];
  /** The conversation's first message was visible (nothing older exists). */
  reachedBeginning?: boolean;
  /** The conversation's latest message was visible (nothing newer exists yet). */
  reachedLatest?: boolean;
}

function storedKey(jobId: string, id: string): [string, string] {
  return [jobId, snowflakeSortKey(id)];
}

function toStored(jobId: string, message: IncomingMessage, now: number): StoredMessage {
  return { ...message, jobId, sortKey: snowflakeSortKey(message.id), updatedAt: now };
}

function hasAuthor(author: ExportAuthor | undefined): author is ExportAuthor {
  return Boolean(author && (author.id || author.name));
}

function mergeById<T extends { id: string }>(previous: T[], next: T[]): T[] {
  if (!previous.length) return next;
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of next) byId.set(item.id, { ...byId.get(item.id), ...item });
  return [...byId.values()];
}

/**
 * Merges a re-captured message into the stored one. Discord renders parts of a
 * message lazily (images, embeds), so newer captures win field by field, but
 * never erase information an earlier capture had.
 */
export function mergeMessage(existing: StoredMessage, incoming: IncomingMessage, now: number): StoredMessage {
  return {
    ...existing,
    ...incoming,
    author: hasAuthor(incoming.author) ? incoming.author : existing.author,
    authorRefId: incoming.authorRefId ?? existing.authorRefId,
    content: incoming.content || existing.content,
    contentHtml: incoming.content ? incoming.contentHtml : existing.contentHtml,
    attachments: mergeById<ExportAttachment>(existing.attachments, incoming.attachments),
    embeds: incoming.embeds.length ? incoming.embeds : existing.embeds,
    stickers: incoming.stickers.length ? incoming.stickers : existing.stickers,
    emojis: mergeById<ExportEmoji>(existing.emojis, incoming.emojis),
    reference: incoming.reference ?? existing.reference,
    flags: [...new Set([...existing.flags, ...incoming.flags])],
    jobId: existing.jobId,
    sortKey: existing.sortKey,
    prevId: existing.prevId,
    nextId: existing.nextId,
    updatedAt: now,
  };
}

/**
 * Stores one batch from the DOM capture and updates the job's statistics and
 * coverage flags in the same transaction.
 */
export async function applyCaptureBatch(jobId: string, batch: CaptureBatchInput): Promise<ExportJob> {
  const db = await openExporterDb();
  const tx = db.transaction(['jobs', 'messages'], 'readwrite');
  const jobs = tx.objectStore('jobs');
  const store = tx.objectStore('messages');
  const job = await jobs.get(jobId);
  if (!job) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(`Export job ${jobId} no longer exists.`);
  }

  const { startMs, endMs } = job.range;
  const inRange = (ms: number) => ms >= startMs && ms <= endMs;
  const now = Date.now();
  const touched = new Map<string, StoredMessage>();
  let added = 0;
  let addedAttachments = 0;

  for (const message of batch.messages) {
    const ms = snowflakeToMs(message.id);
    if (!inRange(ms)) continue;
    const existing = touched.get(message.id) ?? (await store.get(storedKey(jobId, message.id)));
    if (existing) {
      const merged = mergeMessage(existing, message, now);
      addedAttachments += merged.attachments.length - existing.attachments.length;
      touched.set(message.id, merged);
    } else {
      added++;
      addedAttachments += message.attachments.length;
      touched.set(message.id, toStored(jobId, message, now));
    }
  }

  for (const [olderId, newerId] of batch.pairs) {
    const olderMs = snowflakeToMs(olderId);
    const newerMs = snowflakeToMs(newerId);
    const olderIn = inRange(olderMs);
    const newerIn = inRange(newerMs);
    if (!olderIn && !newerIn) {
      // Neighbours on both sides of the range: the range is empty but covered.
      if (olderMs < startMs && newerMs > endMs) {
        job.collect.startReached = true;
        job.collect.endReached = true;
      }
      continue;
    }
    if (newerIn) {
      const record = touched.get(newerId) ?? (await store.get(storedKey(jobId, newerId)));
      if (record) {
        record.prevId = olderId;
        touched.set(newerId, record);
      }
      if (!olderIn) job.collect.startReached = true;
    }
    if (olderIn) {
      const record = touched.get(olderId) ?? (await store.get(storedKey(jobId, olderId)));
      if (record) {
        record.nextId = newerId;
        touched.set(olderId, record);
      }
      if (!newerIn) job.collect.endReached = true;
    }
  }

  for (const record of touched.values()) {
    await store.put(record);
    const ms = snowflakeToMs(record.id);
    if (job.collect.oldestMs === undefined || ms < job.collect.oldestMs) job.collect.oldestMs = ms;
    if (job.collect.newestMs === undefined || ms > job.collect.newestMs) job.collect.newestMs = ms;
  }

  if (batch.reachedBeginning) job.collect.startReached = true;
  if (batch.reachedLatest) job.collect.endReached = true;
  job.collect.messageCount += added;
  job.collect.attachmentCount = Math.max(0, job.collect.attachmentCount + addedAttachments);
  job.collect.lastActivityAt = now;
  job.updatedAt = now;
  await jobs.put(job);
  await tx.done;
  return job;
}

/** Stores messages fetched from the bot API (already in range and contiguous). */
export async function putFetchedMessages(jobId: string, messages: ExportMessage[]): Promise<{ added: number; attachments: number }> {
  const db = await openExporterDb();
  const tx = db.transaction('messages', 'readwrite');
  const now = Date.now();
  let added = 0;
  let attachments = 0;
  for (const message of messages) {
    const key = storedKey(jobId, message.id);
    const existing = await tx.store.get(key);
    if (!existing) {
      added++;
      attachments += message.attachments.length;
    }
    await tx.store.put({ ...message, jobId, sortKey: key[1], updatedAt: now });
  }
  await tx.done;
  return { added, attachments };
}

export async function getMessage(jobId: string, id: string): Promise<StoredMessage | undefined> {
  const db = await openExporterDb();
  return db.get('messages', storedKey(jobId, id));
}

export async function replaceMessage(record: StoredMessage): Promise<void> {
  const db = await openExporterDb();
  await db.put('messages', { ...record, updatedAt: Date.now() });
}

export async function countMessages(jobId: string): Promise<number> {
  const db = await openExporterDb();
  return db.count('messages', jobKeyRange(jobId));
}

/**
 * Iterates a job's messages in chronological order, in batches. Each batch is
 * read in its own short transaction, so callers may do async work between
 * batches.
 */
export async function* iterateMessages(jobId: string, batchSize = 250): AsyncGenerator<StoredMessage[]> {
  const db = await openExporterDb();
  let lastKey: string | null = null;
  for (;;) {
    const range: IDBKeyRange = lastKey === null ? jobKeyRange(jobId) : jobKeyRangeAfter(jobId, lastKey);
    const batch: StoredMessage[] = await db.getAll('messages', range, batchSize);
    if (!batch.length) return;
    lastKey = batch[batch.length - 1].sortKey;
    yield batch;
    if (batch.length < batchSize) return;
  }
}

/** Sorted message IDs as a compact typed array (8 bytes per message). */
export async function loadSortedIds(jobId: string): Promise<BigUint64Array> {
  const db = await openExporterDb();
  const total = await db.count('messages', jobKeyRange(jobId));
  const ids = new BigUint64Array(total);
  let index = 0;
  let lastKey: string | null = null;
  while (index < total) {
    const range: IDBKeyRange = lastKey === null ? jobKeyRange(jobId) : jobKeyRangeAfter(jobId, lastKey);
    const keys: [string, string][] = await db.getAllKeys('messages', range, 5000);
    if (!keys.length) break;
    for (const [, sortKey] of keys) {
      if (index >= total) break;
      ids[index++] = BigInt(sortKey);
    }
    lastKey = keys[keys.length - 1][1];
  }
  return index === total ? ids : ids.slice(0, index);
}

export interface Gap {
  afterId: string;
  beforeId: string;
  fromMs: number;
  toMs: number;
}

/**
 * Finds places where two chronologically consecutive stored messages were
 * never seen next to each other, i.e. messages may be missing between them.
 */
export async function findGaps(jobId: string, maxGaps = 500): Promise<{ gaps: Gap[]; total: number }> {
  const gaps: Gap[] = [];
  let total = 0;
  let previous: StoredMessage | null = null;
  for await (const batch of iterateMessages(jobId, 500)) {
    for (const message of batch) {
      if (previous && previous.nextId !== message.id && message.prevId !== previous.id) {
        total++;
        if (gaps.length < maxGaps) {
          gaps.push({
            afterId: previous.id,
            beforeId: message.id,
            fromMs: snowflakeToMs(previous.id),
            toMs: snowflakeToMs(message.id),
          });
        }
      }
      previous = message;
    }
  }
  return { gaps, total };
}
