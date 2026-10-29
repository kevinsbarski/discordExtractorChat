import { formatBytes, formatDateTime } from '../../core/format';
import {
  completenessReport,
  conversationTitle,
  EXPORTER_NAME,
  EXPORTER_VERSION,
  partCount,
  type ExportContext,
  type ResolvedMessage,
} from '../context';
import { escapeHtml } from '../escape';
import { VIEWER_CSS, VIEWER_SCRIPT } from './assets';
import { createFormatters, partFileName, renderMessage, type RenderState } from './render';

export interface PartSummary {
  index: number;
  file: string;
  count: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

function rangeLabel(ctx: ExportContext): string {
  const { range } = ctx.job;
  return `${range.startDate} → ${range.endDate} (${range.timeZone})`;
}

function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(`${EXPORTER_NAME} ${EXPORTER_VERSION}`)}">
<title>${escapeHtml(title)}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
${body}
<script>${VIEWER_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Streams one HTML part. `messages` yields at most `ctx.messagesPerPart`
 * messages; `summary` is filled in as the part is written.
 */
export async function* renderPartPage(
  ctx: ExportContext,
  part: number,
  messages: AsyncIterable<ResolvedMessage>,
  summary: PartSummary,
): AsyncGenerator<string> {
  const total = partCount(ctx);
  const title = conversationTitle(ctx);
  const prev = part > 0 ? `<a href="${partFileName(part - 1)}">← Previous</a>` : '<span class="disabled">← Previous</span>';
  const next = part < total - 1 ? `<a href="${partFileName(part + 1)}">Next →</a>` : '<span class="disabled">Next →</span>';
  const nav = `<nav class="pager"><a href="../index.html">Overview</a>${prev}${next}</nav>`;
  const head = `<header class="top"><div class="grow"><h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(
    [ctx.job.conversation.guildName, rangeLabel(ctx), `part ${part + 1} of ${total}`].filter(Boolean).join(' · '),
  )}</div></div>${nav}<input id="filter" type="search" placeholder="Filter this page" aria-label="Filter messages on this page"></header><main id="messages">`;

  // Emit the shell around the streamed messages.
  const marker = '\u0000MESSAGES\u0000';
  const shell = htmlDocument(`${title} — part ${part + 1}`, `${head}${marker}</main><footer class="top">${nav}</footer>`);
  const [before, after] = shell.split(marker);
  yield before;

  const fmt = createFormatters(ctx.job.range.timeZone);
  const state: RenderState = {};
  let buffer = '';
  for await (const message of messages) {
    summary.count++;
    summary.firstTimestamp ??= message.timestamp;
    summary.lastTimestamp = message.timestamp;
    buffer += renderMessage(message, ctx, fmt, state, part);
    if (buffer.length > 64 * 1024) {
      yield buffer;
      buffer = '';
    }
  }
  if (!summary.count) buffer += '<p class="wrap">No messages in this part.</p>';
  yield buffer;
  yield after;
}

export interface IndexInfo {
  parts: PartSummary[];
  files: { json: boolean; csv: boolean };
  failedDownloads: { name: string; status: string; error?: string }[];
  failedTotal: number;
}

export function renderIndexPage(ctx: ExportContext, info: IndexInfo): string {
  const { job } = ctx;
  const title = conversationTitle(ctx);
  const report = completenessReport(ctx);
  const fmt = createFormatters(job.range.timeZone);
  const downloaded = [...ctx.attachments.values()].filter((f) => f.status === 'done');
  const downloadedBytes = downloaded.reduce((sum, f) => sum + (f.bytes ?? 0), 0);

  const cards = [
    ['Messages', ctx.ids.length.toLocaleString()],
    ['Attachments saved', `${downloaded.length.toLocaleString()} (${formatBytes(downloadedBytes)})`],
    ['Download problems', info.failedTotal.toLocaleString()],
    ['Possible gaps', ctx.gaps.total.toLocaleString()],
  ]
    .map(([label, value]) => `<div class="card"><b>${escapeHtml(value)}</b>${escapeHtml(label)}</div>`)
    .join('');

  const notes = report.notes.length
    ? `<h2>Completeness</h2><ul class="notes">${report.notes.map((n) => `<li class="warn">${escapeHtml(n)}</li>`).join('')}</ul>`
    : '<h2>Completeness</h2><p>No problems detected.</p>';

  const rows = info.parts
    .map(
      (p) =>
        `<tr><td><a href="html/${p.file}">Part ${p.index + 1}</a></td><td>${p.count.toLocaleString()}</td><td>${escapeHtml(
          p.firstTimestamp ? fmt.dateTime.format(new Date(p.firstTimestamp)) : '',
        )}</td><td>${escapeHtml(p.lastTimestamp ? fmt.dateTime.format(new Date(p.lastTimestamp)) : '')}</td></tr>`,
    )
    .join('');

  const gaps = ctx.gaps.gaps.length
    ? `<h2>Possible gaps</h2><p>No captured message connects these pairs. Messages between them may be missing — scroll through these times again and capture to fill them.</p><table><tr><th>After</th><th>Before</th></tr>${ctx.gaps.gaps
        .slice(0, 200)
        .map(
          (g) =>
            `<tr><td>${escapeHtml(fmt.dateTime.format(new Date(g.fromMs)))}</td><td>${escapeHtml(fmt.dateTime.format(new Date(g.toMs)))}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  const failures = info.failedDownloads.length
    ? `<h2>Files that were not saved</h2><table><tr><th>File</th><th>Status</th><th>Reason</th></tr>${info.failedDownloads
        .map(
          (f) =>
            `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.status)}</td><td>${escapeHtml(f.error ?? '')}</td></tr>`,
        )
        .join('')}</table>${info.failedTotal > info.failedDownloads.length ? `<p>…and ${info.failedTotal - info.failedDownloads.length} more (see export-report.json).</p>` : ''}`
    : '';

  const other = [
    info.files.json ? '<li><a href="messages.json">messages.json</a> — every message with all captured fields</li>' : '',
    info.files.csv ? '<li><a href="messages.csv">messages.csv</a> — one row per message, for spreadsheets</li>' : '',
    '<li><a href="export-report.json">export-report.json</a> — completeness, gaps and download problems</li>',
  ].join('');

  const body = `<div class="wrap">
<h1>${escapeHtml(title)}</h1>
<p class="sub">${escapeHtml([job.conversation.guildName, rangeLabel(ctx)].filter(Boolean).join(' · '))}<br>
Collected with ${job.method === 'dom' ? 'page capture (messages rendered in the browser)' : 'the official Discord bot API'} · exported ${escapeHtml(formatDateTime(ctx.exportedAt))}</p>
<div class="cards">${cards}</div>
${notes}
<h2>Messages</h2>
<table><tr><th>Page</th><th>Messages</th><th>From</th><th>To</th></tr>${rows}</table>
<h2>Other files</h2><ul>${other}</ul>
${gaps}
${failures}
<p class="meta">Created by ${escapeHtml(EXPORTER_NAME)} ${escapeHtml(EXPORTER_VERSION)}. Not affiliated with Discord.</p>
</div>`;
  return htmlDocument(`${title} — export`, body);
}
