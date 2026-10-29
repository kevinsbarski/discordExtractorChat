import { attachmentFile, resolvedMessages, type ExportContext, type ResolvedMessage } from '../context';
import { CSV_BOM, csvLine } from '../csv';

export const CSV_HEADER = [
  'message_id',
  'timestamp_utc',
  'timestamp_local',
  'author_id',
  'author_name',
  'author_username',
  'content',
  'attachment_files',
  'attachment_urls',
  'attachment_download_status',
  'embeds',
  'reactions',
  'stickers',
  'reply_to_message_id',
  'edited_timestamp',
  'type',
  'flags',
];

function localTimestamp(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function messageCsvRow(message: ResolvedMessage, ctx: ExportContext): unknown[] {
  const files = message.attachments.map((a) => attachmentFile(ctx, a));
  return [
    message.id,
    message.timestamp,
    localTimestamp(message.timestamp, ctx.job.range.timeZone),
    message.author.id ?? '',
    message.author.name,
    message.author.username ?? '',
    message.content,
    files.map((f, i) => f?.localPath ?? `(not downloaded) ${message.attachments[i].filename}`).join('\n'),
    message.attachments.map((a) => a.url).join('\n'),
    files.map((f) => f?.status ?? 'not-requested').join('\n'),
    message.embeds
      .map((e) => [e.title, e.description, e.url].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('\n'),
    message.reactions.map((r) => `${r.emoji} ${r.count}`).join(', '),
    message.stickers.map((s) => s.name).join(', '),
    message.reference?.messageId ?? '',
    message.editedTimestamp ?? '',
    message.type,
    message.flags.join(' '),
  ];
}

/** `messages.csv`, one row per message. */
export async function* csvChunks(ctx: ExportContext): AsyncGenerator<string> {
  yield CSV_BOM + csvLine(CSV_HEADER);
  for await (const batch of resolvedMessages(ctx)) {
    yield batch.map((message) => csvLine(messageCsvRow(message, ctx))).join('');
  }
}
