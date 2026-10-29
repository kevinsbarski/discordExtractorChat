import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobRunner } from '../src/jobs/jobRunner';
import { createJob, getJob, updateJob } from '../src/storage/jobStore';
import { putFetchedMessages } from '../src/storage/messageStore';
import { idAt, jobInput, message } from './helpers';

vi.mock('../src/storage/fileCache', () => ({
  writeCacheFile: vi.fn(async (_jobId: string, _name: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal) => {
    let bytes = 0;
    const reader = body.getReader();
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
    }
  }),
  getCacheFile: vi.fn(),
  deleteJobFiles: vi.fn(async () => undefined),
  storageEstimate: vi.fn(async () => ({})),
}));

const future = Math.floor(Date.now() / 1000 + 3600).toString(16);

async function downloadingJob() {
  const job = await createJob(jobInput({ options: { ...jobInput().options, downloadAssets: false } }));
  await putFetchedMessages(job.id, [
    message(idAt(1), {
      attachments: [
        { id: '1', filename: 'a.bin', url: `https://cdn.discordapp.com/attachments/10/1/a.bin?ex=${future}&is=1&hm=1`, kind: 'file' },
      ],
    }),
  ]);
  await updateJob(job.id, (j) => {
    j.stage = 'downloading';
  });
  return job.id;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JobRunner', () => {
  it('pauses in-flight downloads, then resumes and finishes', async () => {
    const jobId = await downloadingJob();
    // A request that only ends when it is aborted.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (init?.signal?.aborted) abort();
            init?.signal?.addEventListener('abort', abort);
          }),
      ),
    );
    const onChange = vi.fn();
    const runner = new JobRunner(jobId, onChange);
    const running = runner.continueJob();
    await vi.waitFor(() => expect(runner.status.activity).toBe('downloading'));

    await runner.pause();
    expect(runner.status.activity).toBe('idle');
    expect((await getJob(jobId))?.paused).toBe(true);
    await running;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(3), { status: 200 })));
    await runner.resume();
    const job = await getJob(jobId);
    expect(job).toMatchObject({ stage: 'ready', paused: false });
    expect(job?.download).toMatchObject({ total: 1, done: 1 });
  });

  it('keeps what was collected when stopped early', async () => {
    const jobId = await downloadingJob();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (init?.signal?.aborted) abort();
            init?.signal?.addEventListener('abort', abort);
          }),
      ),
    );
    const runner = new JobRunner(jobId, () => undefined);
    const running = runner.download();
    await vi.waitFor(() => expect(runner.status.activity).toBe('downloading'));
    await runner.stopStage();
    await running;
    expect(await getJob(jobId)).toMatchObject({ stage: 'ready', cancelled: true, paused: false });
    expect(runner.status.activity).toBe('idle');
  });

  it('reports a missing bot token instead of failing silently', async () => {
    const job = await createJob(jobInput({ method: 'bot' }));
    const runner = new JobRunner(job.id, () => undefined);
    await runner.collectWithBot();
    expect(runner.status.lastError).toMatch(/No bot token/);
    expect((await getJob(job.id))?.errors.at(-1)?.message).toMatch(/No bot token/);
  });
});
