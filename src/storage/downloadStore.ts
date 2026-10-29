import type { DownloadRecord, DownloadStatus } from '../jobs/model';
import { jobKeyRange, jobKeyRangeAfter, openExporterDb } from './db';

export async function putDownload(record: DownloadRecord): Promise<void> {
  const db = await openExporterDb();
  await db.put('downloads', { ...record, updatedAt: Date.now() });
}

export async function* iterateDownloads(jobId: string, batchSize = 500): AsyncGenerator<DownloadRecord[]> {
  const db = await openExporterDb();
  let lastKey: string | null = null;
  for (;;) {
    const range: IDBKeyRange = lastKey === null ? jobKeyRange(jobId) : jobKeyRangeAfter(jobId, lastKey);
    const batch: DownloadRecord[] = await db.getAll('downloads', range, batchSize);
    if (!batch.length) return;
    lastKey = batch[batch.length - 1].key;
    yield batch;
    if (batch.length < batchSize) return;
  }
}

export type DownloadTally = Record<DownloadStatus, number> & { bytes: number; total: number };

export async function tallyDownloads(jobId: string): Promise<DownloadTally> {
  const tally: DownloadTally = { pending: 0, done: 0, failed: 0, expired: 0, missing: 0, skipped: 0, bytes: 0, total: 0 };
  for await (const batch of iterateDownloads(jobId)) {
    for (const record of batch) {
      tally[record.status]++;
      tally.total++;
      if (record.status === 'done') tally.bytes += record.bytes ?? 0;
    }
  }
  return tally;
}

/** Marks failed, expired, missing and skipped downloads as pending again. */
export async function resetUnfinishedDownloads(jobId: string): Promise<number> {
  const db = await openExporterDb();
  let reset = 0;
  for await (const batch of iterateDownloads(jobId)) {
    const tx = db.transaction('downloads', 'readwrite');
    for (const record of batch) {
      if (record.status !== 'done' && record.status !== 'pending') {
        record.status = 'pending';
        record.error = undefined;
        record.attempts = 0;
        record.updatedAt = Date.now();
        await tx.store.put(record);
        reset++;
      }
    }
    await tx.done;
  }
  return reset;
}

/** Local paths already handed out (used to keep file names unique). */
export async function assignedLocalPaths(jobId: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const batch of iterateDownloads(jobId)) {
    for (const record of batch) if (record.localPath) paths.push(record.localPath);
  }
  return paths;
}
