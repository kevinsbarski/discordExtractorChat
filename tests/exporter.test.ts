import 'fake-indexeddb/auto';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it, vi } from 'vitest';
import { exportBaseName, writeExport } from '../src/export/exporter';
import { MemorySink, ZipSink } from '../src/export/sinks';
import { openExporterDb } from '../src/storage/db';
import { createJob, getJob } from '../src/storage/jobStore';
import { applyCaptureBatch } from '../src/storage/messageStore';
import { idAt, jobInput, message } from './helpers';

vi.mock('../src/storage/fileCache', () => ({
  getCacheFile: vi.fn(async (_jobId: string, name: string) => new File([`bytes of ${name}`], name)),
  writeCacheFile: vi.fn(),
  deleteJobFiles: vi.fn(async () => undefined),
  storageEstimate: vi.fn(async () => ({})),
}));

async function seedJob() {
  const job = await createJob(jobInput());
  const ids = Array.from({ length: 120 }, (_, i) => idAt(i + 1));
  const messages = ids.map((id, i) =>
    message(id, {
      // Every 5th message continues the previous author's group.
      ...(i % 5 === 4 ? { author: { name: '' }, authorRefId: ids[i - 1] } : {}),
      content: i === 3 ? '<img src=x onerror=alert(1)>' : `hello ${i}`,
      contentHtml: i === 3 ? undefined : `hello <strong>${i}</strong>`,
      attachments:
        i === 0
          ? [
              { id: '900', filename: 'photo.png', url: 'https://cdn.discordapp.com/attachments/10/900/photo.png?ex=1&is=1&hm=1', kind: 'image' },
              { id: '901', filename: 'gone.pdf', url: 'https://cdn.discordapp.com/attachments/10/901/gone.pdf?ex=1&is=1&hm=1', kind: 'file' },
            ]
          : [],
      reference: i === 110 ? { messageId: ids[2], authorName: 'Alice', snippet: 'hello 2' } : undefined,
    }),
  );
  const pairs = ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);
  await applyCaptureBatch(job.id, { messages, pairs });

  const db = await openExporterDb();
  const now = Date.now();
  await db.put('downloads', {
    jobId: job.id,
    key: 'a:900',
    kind: 'attachment',
    messageId: ids[0],
    filename: 'photo.png',
    localPath: 'attachments/photo.png',
    cacheName: 'a-900',
    status: 'done',
    bytes: 18,
    attempts: 1,
    updatedAt: now,
  });
  await db.put('downloads', {
    jobId: job.id,
    key: 'a:901',
    kind: 'attachment',
    messageId: ids[0],
    filename: 'gone.pdf',
    status: 'missing',
    error: 'The file is no longer available (HTTP 404).',
    attempts: 1,
    updatedAt: now,
  });
  await db.put('downloads', {
    jobId: job.id,
    key: 's:avatar:20:abc',
    kind: 'asset',
    filename: '20-abc.webp',
    localPath: 'assets/avatars/20-abc.webp',
    cacheName: 's-avatar-20-abc',
    url: 'https://cdn.discordapp.com/avatars/20/abc.webp?size=128',
    status: 'done',
    bytes: 10,
    attempts: 1,
    updatedAt: now,
  });
  const updated = await getJob(job.id);
  updated!.options.messagesPerHtmlPart = 50;
  updated!.stage = 'ready';
  return { job: updated!, ids };
}

describe('writeExport', () => {
  it('writes JSON, CSV, HTML parts, files and a report', async () => {
    const { job, ids } = await seedJob();
    const sink = new MemorySink();
    const progress: string[] = [];
    const result = await writeExport(job, sink, { json: true, csv: true, html: true }, (p) => progress.push(p.step));

    const paths = [...sink.files.keys()].sort();
    expect(paths).toEqual(
      [
        'README.txt',
        'assets/avatars/20-abc.webp',
        'attachments/photo.png',
        'export-report.json',
        'html/part-0001.html',
        'html/part-0002.html',
        'html/part-0003.html',
        'index.html',
        'messages.csv',
        'messages.json',
      ].sort(),
    );
    expect(result.files).toBe(paths.length);
    expect(progress).toContain('html');

    const json = JSON.parse(sink.text('messages.json'));
    expect(json.messages).toHaveLength(120);
    expect(json.method).toBe('dom-capture');
    expect(json.messages[0].attachments[0]).toMatchObject({ localPath: 'attachments/photo.png', downloadStatus: 'done' });
    expect(json.messages[0].attachments[1]).toMatchObject({ downloadStatus: 'missing' });
    // Continuation messages get their group's author.
    expect(json.messages[4].author.name).toBe('Alice');
    expect(json.completeness.possibleGaps).toBe(0);

    const csvBytes = sink.files.get('messages.csv')!;
    expect(Array.from(csvBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const csv = sink.text('messages.csv');
    expect(csv.startsWith('message_id,')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(121);

    const part1 = sink.text('html/part-0001.html');
    expect(part1).toContain('<strong>0</strong>');
    expect(part1).toContain('src="../attachments/photo.png"');
    expect(part1).toContain('src="../assets/avatars/20-abc.webp"');
    expect(part1).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(part1).not.toContain('<img src=x');
    expect(part1).toContain('download missing');

    // A reply in part 3 links to its target in part 1.
    const part3 = sink.text('html/part-0003.html');
    expect(part3).toContain(`href="part-0001.html#m-${ids[2]}"`);

    const index = sink.text('index.html');
    expect(index).toContain('href="html/part-0002.html"');
    expect(index).toContain('gone.pdf');
    expect(new TextDecoder().decode(sink.files.get('attachments/photo.png'))).toBe('bytes of a-900');

    const report = JSON.parse(sink.text('export-report.json'));
    expect(report.downloads.notSaved).toBe(1);
  });

  it('names server exports after the server, channel and dates', async () => {
    const { job } = await seedJob();
    expect(exportBaseName(job)).toBe('Test Server - general - 2026-01-01');
    const range = { ...job.range, endDate: '2026-01-31' };
    expect(exportBaseName({ ...job, range })).toBe('Test Server - general - 2026-01-01 to 2026-01-31');
  });

  it('names DM and group exports after the chat and dates', async () => {
    const { job } = await seedJob();
    const range = { ...job.range, endDate: '2026-02-15' };
    const dm = { ...job.conversation, guildId: null, guildName: undefined, channelName: '@alice' };
    expect(exportBaseName({ ...job, range, conversation: dm })).toBe('alice - 2026-01-01 to 2026-02-15');
    const group = { ...dm, channelName: 'Weekend plans 🎉' };
    expect(exportBaseName({ ...job, range, conversation: group })).toBe('Weekend plans 🎉 - 2026-01-01 to 2026-02-15');
  });

  it('falls back to IDs and keeps names folder-safe', async () => {
    const { job } = await seedJob();
    const unknown = { ...job.conversation, guildName: undefined, channelName: undefined };
    expect(exportBaseName({ ...job, conversation: unknown })).toBe('Server 1 - Channel 10 - 2026-01-01');
    const dm = { ...job.conversation, guildId: null, channelName: undefined };
    expect(exportBaseName({ ...job, conversation: dm })).toBe('Direct message 10 - 2026-01-01');
    const nasty = { ...job.conversation, guildName: '..My/Server: <v2>?', channelName: '#news|*alerts*  ' };
    const name = exportBaseName({ ...job, conversation: nasty });
    expect(name).toBe('My_Server_ _v2__ - news__alerts_ - 2026-01-01');
    expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
    const long = { ...job.conversation, guildName: 'x'.repeat(300), channelName: 'CON' };
    const longName = exportBaseName({ ...job, conversation: long });
    expect(longName).toBe(`${'x'.repeat(60)} - CON_ - 2026-01-01`);
  });

  it('streams a valid ZIP archive', async () => {
    const { job } = await seedJob();
    const chunks: Uint8Array[] = [];
    const writable = new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) });
    const sink = new ZipSink(writable, 'test.zip');
    await writeExport(job, sink, { json: true, csv: false, html: false });

    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    const entries = await reader.getEntries();
    const names = entries.map((e) => e.filename).sort();
    expect(names).toEqual(['README.txt', 'assets/avatars/20-abc.webp', 'attachments/photo.png', 'export-report.json', 'messages.json']);
    const jsonEntry = entries.find((e) => e.filename === 'messages.json')!;
    if (jsonEntry.directory) throw new Error('unexpected directory');
    const text = await jsonEntry.getData(new TextWriter());
    expect(JSON.parse(text).messages).toHaveLength(120);
    await reader.close();
  });
});
