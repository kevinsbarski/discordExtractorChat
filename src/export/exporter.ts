import type { ExportFormats } from '../core/types';
import type { ExportJob } from '../jobs/model';
import { safeNameSegment } from '../processing/filenames';
import { iterateDownloads } from '../storage/downloadStore';
import { getCacheFile } from '../storage/fileCache';
import {
  buildExportContext,
  completenessReport,
  conversationTitle,
  eachMessage,
  EXPORTER_NAME,
  EXPORTER_VERSION,
  partCount,
  type ExportContext,
  type ResolvedMessage,
} from './context';
import { csvChunks } from './formats/csvExport';
import { jsonChunks } from './formats/json';
import { renderIndexPage, renderPartPage, type PartSummary } from './html/pages';
import { partFileName } from './html/render';
import type { OutputSink } from './sinks';

export type SaveStep = 'preparing' | 'json' | 'csv' | 'html' | 'files' | 'report' | 'finishing';

export interface SaveProgress {
  step: SaveStep;
  filesWritten: number;
  bytesWritten: number;
  totalFiles: number;
  detail?: string;
}

export interface SaveResult {
  files: number;
  bytes: number;
  skipped: { path: string; reason: string }[];
}

/** A name part with Discord's "#"/"@" prefix removed, made folder-safe; empty if unusable. */
function namePart(value: string | undefined): string {
  return safeNameSegment((value ?? '').replace(/^[#@]\s*/, ''));
}

/**
 * Folder / archive base name describing the export:
 *   server channel: `My Server - general - 2026-01-01 to 2026-01-31`
 *   DM / group DM:  `alice - 2026-01-01 to 2026-01-31`
 * A single-day range shows one date. When a name is unknown (page capture
 * reads names from the tab title), the ID is used instead, e.g. `Server 123`.
 */
export function exportBaseName(job: ExportJob): string {
  const c = job.conversation;
  const { startDate, endDate } = job.range;
  const dates = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
  const parts = c.guildId
    ? [namePart(c.guildName) || `Server ${c.guildId}`, namePart(c.channelName) || `Channel ${c.channelId}`]
    : [namePart(c.channelName) || `Direct message ${c.channelId}`];
  return [...parts, dates].join(' - ');
}

async function* single(text: string): AsyncGenerator<string> {
  yield text;
}

/** Pulls up to `count` items from a shared iterator without closing it. */
async function* take<T>(iterator: AsyncIterator<T>, count: number): AsyncGenerator<T> {
  for (let i = 0; i < count; i++) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

function readme(ctx: ExportContext, formats: ExportFormats): string {
  const lines = [
    `${conversationTitle(ctx)} — Discord export`,
    '',
    `Date range: ${ctx.job.range.startDate} to ${ctx.job.range.endDate} (${ctx.job.range.timeZone})`,
    `Messages: ${ctx.ids.length}`,
    `Collected with: ${ctx.job.method === 'dom' ? 'page capture (messages rendered in the browser)' : 'the official Discord bot API'}`,
    '',
    'Contents:',
    formats.html ? '  index.html          Open this in a browser to read the conversation offline.' : '',
    formats.html ? '  html/               Conversation pages (linked from index.html).' : '',
    formats.json ? '  messages.json       All messages with every captured field.' : '',
    formats.csv ? '  messages.csv        One row per message (UTF-8, opens in spreadsheets).' : '',
    '  attachments/        Downloaded attachments, with their original names where possible.',
    '  assets/             Avatars, custom emoji and stickers used by the HTML pages.',
    '  export-report.json  Completeness notes, possible gaps and files that could not be saved.',
    '',
    ...completenessReport(ctx).notes.map((note) => `Note: ${note}`),
    '',
    `Created by ${EXPORTER_NAME} ${EXPORTER_VERSION}. Not affiliated with Discord.`,
  ];
  return `${lines.filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')}\n`;
}

/**
 * Writes the whole export to `sink`: message files first (streamed from
 * IndexedDB), then the cached attachments and assets, then a report.
 */
export async function writeExport(
  job: ExportJob,
  sink: OutputSink,
  formats: ExportFormats,
  onProgress?: (progress: SaveProgress) => void,
  signal?: AbortSignal,
): Promise<SaveResult> {
  const ctx = await buildExportContext(job);
  const skipped: SaveResult['skipped'] = [];
  const failedDownloads: { name: string; status: string; error?: string }[] = [];
  let failedTotal = 0;
  let binaryFiles = 0;
  for await (const batch of iterateDownloads(job.id)) {
    for (const record of batch) {
      if (record.status === 'done') binaryFiles++;
      else if (record.kind === 'attachment') {
        failedTotal++;
        if (failedDownloads.length < 100) {
          failedDownloads.push({ name: record.filename, status: record.status, error: record.error });
        }
      }
    }
  }

  const parts = formats.html ? partCount(ctx) : 0;
  const totalFiles =
    (formats.json ? 1 : 0) + (formats.csv ? 1 : 0) + (formats.html ? parts + 1 : 0) + binaryFiles + 2;
  let files = 0;
  let bytes = 0;
  const report = (step: SaveStep, detail?: string) =>
    onProgress?.({ step, filesWritten: files, bytesWritten: bytes, totalFiles, detail });
  const write = async (step: SaveStep, path: string, chunks: AsyncIterable<string>) => {
    report(step, path);
    bytes += await sink.writeText(path, chunks, signal);
    files++;
    report(step, path);
  };

  if (formats.json) await write('json', 'messages.json', jsonChunks(ctx));
  if (formats.csv) await write('csv', 'messages.csv', csvChunks(ctx));

  if (formats.html) {
    const iterator: AsyncIterator<ResolvedMessage> = eachMessage(ctx);
    const summaries: PartSummary[] = [];
    for (let part = 0; part < parts; part++) {
      const summary: PartSummary = { index: part, file: partFileName(part), count: 0 };
      await write('html', `html/${summary.file}`, renderPartPage(ctx, part, take(iterator, ctx.messagesPerPart), summary));
      summaries.push(summary);
    }
    await iterator.return?.();
    await write(
      'html',
      'index.html',
      single(
        renderIndexPage(ctx, {
          parts: summaries,
          files: { json: formats.json, csv: formats.csv },
          failedDownloads,
          failedTotal,
        }),
      ),
    );
  }

  for await (const batch of iterateDownloads(job.id)) {
    for (const record of batch) {
      if (record.status !== 'done' || !record.localPath || !record.cacheName) continue;
      const file = await getCacheFile(job.id, record.cacheName);
      if (!file) {
        skipped.push({ path: record.localPath, reason: 'The downloaded copy is missing from the extension cache.' });
        continue;
      }
      report('files', record.localPath);
      bytes += await sink.writeBlob(record.localPath, file, signal);
      files++;
    }
  }

  const reportJson = {
    exporter: { name: EXPORTER_NAME, version: EXPORTER_VERSION, exportedAt: ctx.exportedAt },
    conversation: job.conversation,
    range: job.range,
    method: job.method === 'dom' ? 'dom-capture' : 'bot-api',
    completeness: completenessReport(ctx),
    collection: job.collect,
    downloads: { ...job.download, notSaved: failedTotal, examples: failedDownloads },
    gaps: ctx.gaps,
    skippedFiles: skipped,
    errors: job.errors.slice(-100),
  };
  await write('report', 'export-report.json', single(`${JSON.stringify(reportJson, null, 2)}\n`));
  await write('report', 'README.txt', single(readme(ctx, formats)));

  report('finishing');
  await sink.close();
  return { files, bytes, skipped };
}
