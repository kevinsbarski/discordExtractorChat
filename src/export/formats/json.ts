import {
  assetPath,
  attachmentFile,
  completenessReport,
  EXPORTER_NAME,
  EXPORTER_VERSION,
  resolvedMessages,
  type ExportContext,
  type ResolvedMessage,
} from '../context';

function toJsonMessage(message: ResolvedMessage, ctx: ExportContext): Record<string, unknown> {
  const avatarLocalPath = assetPath(ctx, message.author.avatarUrl);
  return {
    id: message.id,
    channelId: message.channelId,
    timestamp: message.timestamp,
    editedTimestamp: message.editedTimestamp,
    type: message.type,
    system: message.system,
    author: { ...message.author, avatarLocalPath },
    content: message.content,
    contentMarkdown: message.contentMarkdown,
    contentHtml: message.contentHtml,
    attachments: message.attachments.map((attachment) => {
      const file = attachmentFile(ctx, attachment);
      return {
        ...attachment,
        localPath: file?.localPath,
        downloadStatus: file?.status ?? 'not-requested',
        downloadError: file?.error,
      };
    }),
    embeds: message.embeds,
    reactions: message.reactions,
    stickers: message.stickers.map((sticker) => ({ ...sticker, localPath: assetPath(ctx, sticker.url) })),
    emojis: message.emojis.map((emoji) => ({ ...emoji, localPath: assetPath(ctx, emoji.url) })),
    reference: message.reference,
    flags: message.flags,
    poll: message.poll,
    mentions: message.mentions,
    source: message.source,
    raw: message.raw,
  };
}

/** `messages.json`, streamed message by message. */
export async function* jsonChunks(ctx: ExportContext): AsyncGenerator<string> {
  const { job } = ctx;
  const header = {
    exporter: { name: EXPORTER_NAME, version: EXPORTER_VERSION, exportedAt: ctx.exportedAt },
    method: job.method === 'dom' ? 'dom-capture' : 'bot-api',
    conversation: job.conversation,
    range: job.range,
    completeness: completenessReport(ctx),
    gaps: ctx.gaps.gaps.map((gap) => ({
      afterMessageId: gap.afterId,
      beforeMessageId: gap.beforeId,
      from: new Date(gap.fromMs).toISOString(),
      to: new Date(gap.toMs).toISOString(),
    })),
    counts: {
      messages: ctx.ids.length,
      attachments: job.collect.attachmentCount,
      attachmentsDownloaded: [...ctx.attachments.values()].filter((f) => f.status === 'done').length,
    },
  };
  const headerJson = JSON.stringify(header, null, 2);
  yield `${headerJson.slice(0, -2)},\n  "messages": [\n`;
  let first = true;
  for await (const batch of resolvedMessages(ctx)) {
    let out = '';
    for (const message of batch) {
      out += `${first ? '' : ',\n'}    ${JSON.stringify(toJsonMessage(message, ctx))}`;
      first = false;
    }
    yield out;
  }
  yield '\n  ]\n}\n';
}
