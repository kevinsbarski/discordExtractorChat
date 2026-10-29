import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DownloadRecord, ExportJob, StoredMessage } from '../jobs/model';

/**
 * IndexedDB schema (extension origin). Messages and download records are keyed
 * by `[jobId, ...]` so a job's rows form one contiguous, ordered key range.
 */
export interface ExporterSchema extends DBSchema {
  jobs: {
    key: string;
    value: ExportJob;
  };
  messages: {
    key: [string, string];
    value: StoredMessage;
  };
  downloads: {
    key: [string, string];
    value: DownloadRecord;
  };
}

export type ExporterDb = IDBPDatabase<ExporterSchema>;

export const DB_NAME = 'local-chat-exporter';
const DB_VERSION = 1;

let dbPromise: Promise<ExporterDb> | null = null;

export function openExporterDb(): Promise<ExporterDb> {
  if (!dbPromise) {
    dbPromise = openDB<ExporterSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('messages')) {
          db.createObjectStore('messages', { keyPath: ['jobId', 'sortKey'] });
        }
        if (!db.objectStoreNames.contains('downloads')) {
          db.createObjectStore('downloads', { keyPath: ['jobId', 'key'] });
        }
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Key range covering every row of one job. */
export function jobKeyRange(jobId: string): IDBKeyRange {
  return IDBKeyRange.bound([jobId, ''], [jobId, '￿']);
}

/** Key range for rows of one job strictly after `afterKey`. */
export function jobKeyRangeAfter(jobId: string, afterKey: string): IDBKeyRange {
  return IDBKeyRange.bound([jobId, afterKey], [jobId, '￿'], true, false);
}

/** Test hook: forget the cached connection. */
export function resetDbConnectionForTests(): void {
  dbPromise = null;
}
