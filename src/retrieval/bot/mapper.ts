import { snowflakeToIso } from '../../core/snowflake';
import type {
  AttachmentKind,
  ExportAttachment,
  ExportEmbed,
  ExportEmoji,
  ExportMessage,
  ExportPoll,
  ExportReaction,
  ExportSticker,
} from '../../core/types';
import { customEmojiUrl, parseAttachmentUrl, stickerUrl, userAvatarUrl } from '../../processing/discordCdn';
import { discordMarkdownToText, type MarkdownContext } from '../../export/markdown';
import type { ApiAttachment, ApiComponent, ApiEmbed, ApiMessage, ApiUser } from './apiTypes';

const FLAG_CROSSPOSTED = 1 << 0;
const FLAG_IS_CROSSPOST = 1 << 1;
const FLAG_IS_VOICE_MESSAGE = 1 << 13;
const FLAG_IS_COMPONENTS_V2 = 1 << 15;

const MESSAGE_TYPE_NAMES: Record<number, string> = {
  0: 'default',
  1: 'recipient-add',
  2: 'recipient-remove',
  3: 'call',
  4: 'channel-name-change',
  5: 'channel-icon-change',
  6: 'pin',
  7: 'member-join',
  8: 'boost',
  9: 'boost-tier-1',
  10: 'boost-tier-2',
  11: 'boost-tier-3',
  12: 'channel-follow-add',
  18: 'thread-created',
  19: 'reply',
  20: 'slash-command',
  21: 'thread-starter',
  22: 'invite-reminder',
  23: 'context-menu-command',
  24: 'auto-moderation',
  25: 'role-subscription',
  27: 'stage-start',
  28: 'stage-end',
  29: 'stage-speaker',
  31: 'stage-topic',
  46: 'poll-result',
};

const USER_MESSAGE_TYPES = new Set([0, 19, 20, 21, 23]);

export function displayName(user: ApiUser): string {
  return user.global_name || user.username;
}

function attachmentKind(contentType: string | undefined, filename: string): AttachmentKind {
  const type = contentType ?? '';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'aac'].includes(ext)) return 'audio';
  return 'file';
}

export function mapAttachment(attachment: ApiAttachment): ExportAttachment {
  return {
    id: attachment.id,
    filename: attachment.filename,
    url: attachment.url,
    fallbackUrls: attachment.proxy_url && attachment.proxy_url !== attachment.url ? [attachment.proxy_url] : undefined,
    size: attachment.size,
    contentType: attachment.content_type,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
    kind: attachmentKind(attachment.content_type, attachment.filename),
    spoiler: attachment.filename.startsWith('SPOILER_') || undefined,
    description: attachment.description,
  };
}

export function mapEmbed(embed: ApiEmbed): ExportEmbed {
  return {
    type: embed.type,
    url: embed.url,
    title: embed.title,
    description: embed.description,
    color: embed.color !== undefined ? `#${embed.color.toString(16).padStart(6, '0')}` : undefined,
    authorName: embed.author?.name,
    authorUrl: embed.author?.url,
    providerName: embed.provider?.name,
    footerText: embed.footer?.text,
    fields: embed.fields?.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
    imageUrl: embed.image?.url,
    thumbnailUrl: embed.thumbnail?.url,
    videoUrl: embed.video?.url,
    timestamp: embed.timestamp,
  };
}

/** Text and media from Components V2 layouts (text lives in components there). */
function collectComponents(components: ApiComponent[] | undefined, text: string[], mediaUrls: string[]): void {
  for (const component of components ?? []) {
    if (component.type === 10 && component.content) text.push(component.content);
    if (component.media?.url) mediaUrls.push(component.media.url);
    if (component.file?.url) mediaUrls.push(component.file.url);
    for (const item of component.items ?? []) if (item.media?.url) mediaUrls.push(item.media.url);
    if (component.accessory) collectComponents([component.accessory], text, mediaUrls);
    collectComponents(component.components, text, mediaUrls);
  }
}

function systemText(message: ApiMessage, name: string, mentions: Record<string, string>): string | null {
  const target = message.mentions?.[0] ? displayName(message.mentions[0]) : 'someone';
  switch (message.type) {
    case 1:
      return `${name} added ${target} to the group.`;
    case 2:
      return `${name} removed ${target} from the group.`;
    case 3:
      return `${name} started a call.`;
    case 4:
      return `${name} changed the channel name: ${message.content}`;
    case 5:
      return `${name} changed the channel icon.`;
    case 6:
      return `${name} pinned a message to this channel.`;
    case 7:
      return `${name} joined the server.`;
    case 8:
      return `${name} boosted the server.`;
    case 9:
    case 10:
    case 11:
      return `${name} boosted the server. It reached level ${message.type - 8}.`;
    case 12:
      return `${name} added a channel follower: ${message.content}`;
    case 18:
      return `${name} started a thread: ${message.content}`;
    case 46:
      return `${name}'s poll has closed.`;
    default:
      if (USER_MESSAGE_TYPES.has(message.type)) return null;
      return message.content ? discordMarkdownToText(message.content, { users: mentions }) : `${name} (${MESSAGE_TYPE_NAMES[message.type] ?? `type ${message.type}`})`;
  }
}

export interface MapContext {
  roles?: Record<string, string>;
  channels?: Record<string, string>;
}

export function mapApiMessage(message: ApiMessage, ctx: MapContext = {}): ExportMessage {
  const author = message.author;
  const name = displayName(author);
  const mentions: Record<string, string> = {};
  for (const user of message.mentions ?? []) mentions[user.id] = displayName(user);
  const markdownCtx: MarkdownContext = { users: mentions, roles: ctx.roles, channels: ctx.channels };

  const flags: string[] = [];
  const messageFlags = message.flags ?? 0;
  if (messageFlags & FLAG_IS_VOICE_MESSAGE) flags.push('voice-message');
  if (messageFlags & (FLAG_CROSSPOSTED | FLAG_IS_CROSSPOST)) flags.push('crossposted');
  if (messageFlags & FLAG_IS_COMPONENTS_V2) flags.push('components-v2');
  if (message.pinned) flags.push('pinned');
  if (message.type === 21) flags.push('thread-starter');

  let markdown = message.content ?? '';
  const attachments = (message.attachments ?? []).map(mapAttachment);
  const embeds = (message.embeds ?? []).map(mapEmbed);
  const stickerItems = [...(message.sticker_items ?? [])];

  // Forwarded messages carry their content in a snapshot.
  const snapshot = message.message_snapshots?.[0]?.message;
  if (snapshot) {
    flags.push('forwarded');
    if (snapshot.content) markdown = markdown ? `${markdown}\n${snapshot.content}` : snapshot.content;
    attachments.push(...(snapshot.attachments ?? []).map(mapAttachment));
    embeds.push(...(snapshot.embeds ?? []).map(mapEmbed));
    stickerItems.push(...(snapshot.sticker_items ?? []));
  }

  // Components V2: text and media live inside the component tree.
  const componentText: string[] = [];
  const componentMedia: string[] = [];
  collectComponents(message.components, componentText, componentMedia);
  if (snapshot) collectComponents(snapshot.components, componentText, componentMedia);
  if (componentText.length) markdown = [markdown, ...componentText].filter(Boolean).join('\n');
  for (const url of componentMedia) {
    const parsed = parseAttachmentUrl(url);
    if (parsed && !attachments.some((a) => a.id === parsed.attachmentId)) {
      attachments.push({
        id: parsed.attachmentId,
        filename: parsed.filename,
        url,
        kind: attachmentKind(undefined, parsed.filename),
      });
    }
  }

  const emojis: ExportEmoji[] = [];
  for (const match of markdown.matchAll(/<(a?):([\w~]{1,32}):(\d+)>/g)) {
    const [, animated, emojiName, id] = match;
    if (!emojis.some((e) => e.id === id)) {
      emojis.push({ id, name: emojiName, animated: animated === 'a', url: customEmojiUrl(id, animated === 'a') });
    }
  }

  const reactions: ExportReaction[] = (message.reactions ?? []).map((reaction) => {
    const emoji = reaction.emoji;
    if (emoji.id) {
      return {
        emoji: `:${emoji.name ?? 'emoji'}:`,
        emojiId: emoji.id,
        emojiUrl: customEmojiUrl(emoji.id, Boolean(emoji.animated)),
        count: reaction.count,
      };
    }
    return { emoji: emoji.name ?? '?', count: reaction.count };
  });

  const stickers: ExportSticker[] = stickerItems.map((sticker) => {
    const { url, format } = stickerUrl(sticker.id, sticker.format_type);
    return { id: sticker.id, name: sticker.name, url, format };
  });

  let poll: ExportPoll | undefined;
  if (message.poll) {
    const counts = new Map((message.poll.results?.answer_counts ?? []).map((c) => [c.id, c.count]));
    poll = {
      question: message.poll.question.text ?? '',
      answers: message.poll.answers.map((answer) => ({
        text: answer.poll_media.text ?? answer.poll_media.emoji?.name ?? '',
        votes: counts.get(answer.answer_id),
      })),
    };
  }

  const reference = message.message_reference?.message_id
    ? {
        messageId: message.message_reference.message_id,
        channelId: message.message_reference.channel_id,
        guildId: message.message_reference.guild_id,
        ...(message.referenced_message
          ? {
              authorName: displayName(message.referenced_message.author),
              snippet: discordMarkdownToText(message.referenced_message.content ?? '', markdownCtx).slice(0, 200),
            }
          : {}),
        ...(message.type === 19 && message.referenced_message === null ? { deleted: true } : {}),
      }
    : undefined;

  const system = systemText(message, name, mentions);
  const typeName = MESSAGE_TYPE_NAMES[message.type] ?? `type-${message.type}`;

  return {
    id: message.id,
    channelId: message.channel_id,
    timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : snowflakeToIso(message.id),
    editedTimestamp: message.edited_timestamp ? new Date(message.edited_timestamp).toISOString() : undefined,
    type: typeName,
    system: system !== null || undefined,
    author: {
      id: author.id,
      name,
      username: author.username,
      avatarUrl: userAvatarUrl(author.id, author.avatar, author.discriminator),
      bot: author.bot || undefined,
    },
    content: system ?? discordMarkdownToText(markdown, markdownCtx),
    contentMarkdown: system === null ? markdown : undefined,
    attachments,
    embeds,
    reactions,
    stickers,
    emojis,
    reference,
    flags,
    poll,
    mentions: Object.keys(mentions).length ? mentions : undefined,
    source: 'bot',
    raw: message,
  };
}

/**
 * True when a page of messages looks like the bot lacks the Message Content
 * intent: user messages arrive with no content, attachments or embeds.
 */
export function looksLikeMissingContentIntent(messages: ApiMessage[]): boolean {
  const userMessages = messages.filter((m) => USER_MESSAGE_TYPES.has(m.type) && !m.author.bot);
  if (userMessages.length < 10) return false;
  return userMessages.every(
    (m) =>
      !m.content &&
      !(m.attachments?.length) &&
      !(m.embeds?.length) &&
      !(m.components?.length) &&
      !(m.sticker_items?.length) &&
      !m.poll &&
      !(m.message_snapshots?.length),
  );
}
