import { describe, expect, it, vi } from 'vitest';
import { downloadToCache, type DownloadDeps } from '../src/processing/downloader';

const NOW = 1_700_000_000_000;
const exHex = (ms: number) => Math.floor(ms / 1000).toString(16);
const signed = (ms: number) => `https://cdn.discordapp.com/attachments/1/2/file.png?ex=${exHex(ms)}&is=${exHex(NOW)}&hm=abc`;

function deps(responses: Array<Response | Error>, written: string[] = []): DownloadDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    fetch,
    now: () => NOW,
    sleep: async () => undefined,
    writeFile: async (name, body) => {
      written.push(name);
      let bytes = 0;
      const reader = body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
      return bytes;
    },
  };
}

const file = (size: number, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(size), { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': String(size), ...headers } });

describe('downloadToCache', () => {
  it('downloads and validates the expected size', async () => {
    const d = deps([file(10)]);
    const outcome = await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', expectedSize: 10, cacheName: 'a-2' }, d);
    expect(outcome).toMatchObject({ status: 'done', bytes: 10 });
    expect(d.fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });

  it('does not request links that have already expired', async () => {
    const d = deps([]);
    const outcome = await downloadToCache({ urls: [signed(NOW - 1000)], filename: 'file.png', cacheName: 'a-2' }, d);
    expect(outcome.status).toBe('expired');
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('reports deleted files as missing', async () => {
    const d = deps([new Response('Not found', { status: 404 })]);
    const outcome = await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', cacheName: 'a-2' }, d);
    expect(outcome).toMatchObject({ status: 'missing' });
  });

  it('treats 403 on a signed link as expired', async () => {
    const d = deps([new Response('denied', { status: 403 })]);
    const outcome = await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', cacheName: 'a-2' }, d);
    expect(outcome.status).toBe('expired');
  });

  it('retries rate limits and server errors', async () => {
    const d = deps([new Response('', { status: 429, headers: { 'Retry-After': '1' } }), new Response('', { status: 503 }), file(4)]);
    const outcome = await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', cacheName: 'a-2' }, d);
    expect(outcome.status).toBe('done');
    expect(d.fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects HTML error pages and size mismatches', async () => {
    const html = new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const d1 = deps([html]);
    expect((await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', cacheName: 'x' }, d1)).status).toBe('failed');

    const d2 = deps([file(5), file(5), file(5), file(5)]);
    const outcome = await downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', expectedSize: 6, cacheName: 'x' }, d2);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.status === 'failed' && outcome.error).toMatch(/Size mismatch/);
  });

  it('falls back to the next candidate URL', async () => {
    const d = deps([new Response('', { status: 404 }), file(3)]);
    const outcome = await downloadToCache(
      { urls: [signed(NOW + 3600_000), 'https://media.discordapp.net/attachments/1/2/file.png?ex=ffffffff&is=1&hm=1'], filename: 'file.png', cacheName: 'x' },
      d,
    );
    expect(outcome).toMatchObject({ status: 'done', bytes: 3 });
  });

  it('propagates aborts so the record stays pending', async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps([new DOMException('Aborted', 'AbortError') as unknown as Error]);
    await expect(
      downloadToCache({ urls: [signed(NOW + 3600_000)], filename: 'file.png', cacheName: 'x' }, d, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
