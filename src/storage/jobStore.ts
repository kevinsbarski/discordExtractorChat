import type { ConversationRef, DateRange, ExportOptions, RetrievalMethod } from '../core/types';
import {
  emptyCollectState,
  emptyDownloadState,
  MAX_STORED_ERRORS,
  type ExportJob,
  type JobError,
} from '../jobs/model';
import { jobKeyRange, openExporterDb } from './db';
import { deleteJobFiles } from './fileCache';

export interface NewJobInput {
  method: RetrievalMethod;
  conversation: ConversationRef;
  range: DateRange;
  options: ExportOptions;
  tabId?: number;
}

function newJobId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `job-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

export async function createJob(input: NewJobInput): Promise<ExportJob> {
  const now = Date.now();
  const job: ExportJob = {
    id: newJobId(),
    schema: 1,
    createdAt: now,
    updatedAt: now,
    method: input.method,
    conversation: input.conversation,
    range: input.range,
    options: input.options,
    stage: 'collecting',
    paused: false,
    cancelled: false,
    collect: { ...emptyCollectState(), tabId: input.tabId },
    download: emptyDownloadState(),
    errors: [],
    errorCount: 0,
    saves: [],
  };
  const db = await openExporterDb();
  await db.put('jobs', job);
  return job;
}

export async function getJob(jobId: string): Promise<ExportJob | undefined> {
  const db = await openExporterDb();
  return db.get('jobs', jobId);
}

/** All jobs, newest first. */
export async function listJobs(): Promise<ExportJob[]> {
  const db = await openExporterDb();
  const jobs = await db.getAll('jobs');
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLatestJob(): Promise<ExportJob | undefined> {
  return (await listJobs())[0];
}

/**
 * Atomic read-modify-write of a job record (single IndexedDB transaction).
 * The mutator must be synchronous.
 */
export async function updateJob(jobId: string, mutate: (job: ExportJob) => void): Promise<ExportJob> {
  const db = await openExporterDb();
  const tx = db.transaction('jobs', 'readwrite');
  const job = await tx.store.get(jobId);
  if (!job) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error(`Export job ${jobId} no longer exists.`);
  }
  mutate(job);
  job.updatedAt = Date.now();
  await tx.store.put(job);
  await tx.done;
  return job;
}

export function appendError(job: ExportJob, stage: JobError['stage'], message: string): void {
  job.errors.push({ at: Date.now(), stage, message });
  if (job.errors.length > MAX_STORED_ERRORS) job.errors.splice(0, job.errors.length - MAX_STORED_ERRORS);
  job.errorCount++;
}

export async function recordJobError(jobId: string, stage: JobError['stage'], message: string): Promise<void> {
  await updateJob(jobId, (job) => appendError(job, stage, message)).catch(() => undefined);
}

/** Removes a job with its messages, download records and cached files. */
export async function deleteJob(jobId: string): Promise<void> {
  const db = await openExporterDb();
  const tx = db.transaction(['jobs', 'messages', 'downloads'], 'readwrite');
  await Promise.all([
    tx.objectStore('jobs').delete(jobId),
    tx.objectStore('messages').delete(jobKeyRange(jobId)),
    tx.objectStore('downloads').delete(jobKeyRange(jobId)),
  ]);
  await tx.done;
  await deleteJobFiles(jobId).catch(() => undefined);
}

export async function deleteAllJobsExcept(keepJobId?: string): Promise<void> {
  for (const job of await listJobs()) {
    if (job.id !== keepJobId) await deleteJob(job.id);
  }
}
