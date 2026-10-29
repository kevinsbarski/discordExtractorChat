import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { runDownloads } from '../src/processing/downloadRunner';
import { iterateDownloads } from '../src/storage/downloadStore';
import { createJob, getJob } from '../src/storage/jobStore';
import { putFetchedMessages } from '../src/storage/messageStore';
import { idAt, jobInput, message } from './helpers';

vi.mock('../src/storage/fileCache', () => ({
  writeCacheFile: vi.fn(async (_jobId: string, _name: string, body: ReadableStream<Uint8Array>) => {
    let bytes = 0;
    const reader = body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
    }
  }),
  getCacheFile: vi.fn(),
  deleteJobFiles: vi.fn(async () => undefined),
}));

const future = Math.floor(Date.now() / 1000 + 3600).toString(16);
const url = (id: string, name: string) => `https://cdn.discordapp.com/attachments/10/${id}/${name}?ex=${future}&is=1&hm=1`;

async function allRecords(jobId: string) {
  const records = [];
  for await (const batch of iterateDownloads(jobId)) records.push(...batch);
  return records;
}

describe('runDownloads', () => {
  it('downloads attachments and assets, keeps names unique and records failures', async () => {
    const job = await createJob(jobInput());
    await putFetchedMessages(job.id, [
      message(idAt(1), {
        attachments: [
          { id: '1', filename: 'image.png', url: url('1', 'image.png'), kind: 'image' },
          { id: '2', filename: 'gone.pdf', url: url('2', 'gone.pdf'), kind: 'file' },
        ],
        emojis: [{ id: '55', name: 'wave', url: 'https://cdn.discordapp.com/emojis/55.webp?size=48' }],
      }),
      message(idAt(2), { attachments: [{ id: '3', filename: 'image.png', url: url('3', 'image.png'), kind: 'image', size: 4 }] }),
    ]);

    const fetch = vi.fn(async (input: string | URL | Request) => {
      const target = String(input);
      if (target.includes('gone.pdf')) return new Response('missing', { status: 404 });
      return new Response(new Uint8Array(4), { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } });
    });
    const progress = vi.fn();
    const result = await runDownloads((await getJob(job.id))!, { fetch, onProgress: progress, concurrency: 2 });
    expect(result).toBe('completed');

    const records = await allRecords(job.id);
    const byKey = Object.fromEntries(records.map((r) => [r.key, r]));
    expect(byKey['a:1']).toMatchObject({ status: 'done', localPath: 'attachments/image.png', bytes: 4 });
    expect(byKey['a:3']).toMatchObject({ status: 'done', localPath: 'attachments/image (2).png' });
    expect(byKey['a:2']).toMatchObject({ status: 'missing' });
    expect(byKey['s:avatar:20:abc']).toMatchObject({ status: 'done', localPath: 'assets/avatars/20-abc.webp' });
    expect(byKey['s:emoji:55:webp']).toMatchObject({ status: 'done', localPath: 'assets/emoji/55.webp' });

    const saved = await getJob(job.id);
    expect(saved?.download).toMatchObject({ total: 5, done: 4, failed: 1 });
    expect(progress).toHaveBeenCalled();
  });

  it('leaves records pending when aborted, then resumes', async () => {
    const job = await createJob(jobInput({ options: { ...jobInput().options, downloadAssets: false } }));
    await putFetchedMessages(job.id, [
      message(idAt(1), { attachments: [{ id: '7', filename: 'a.bin', url: url('7', 'a.bin'), kind: 'file' }] }),
    ]);
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    expect(await runDownloads((await getJob(job.id))!, { fetch }, controller.signal)).toBe('aborted');
    expect((await allRecords(job.id))[0].status).toBe('pending');

    const ok = vi.fn(async () => new Response(new Uint8Array(2), { status: 200 }));
    expect(await runDownloads((await getJob(job.id))!, { fetch: ok })).toBe('completed');
    expect((await allRecords(job.id))[0]).toMatchObject({ status: 'done', localPath: 'attachments/a.bin' });
  });
});
