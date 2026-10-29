import { snowflakeToIso } from '../../core/snowflake';
import type {
  AttachmentKind,
  ExportAttachment,
  ExportAuthor,
  ExportEmbed,
  ExportPoll,
  ExportReaction,
  ExportReference,
  ExportSticker,
} from '../../core/types';
import { parseAttachmentUrl } from '../../processing/discordCdn';
import type { IncomingMessage } from '../../storage/messageStore';
import { sanitizeContent, type SanitizedContent } from './sanitize';

/**
 * Read-only parser for the messages Discord's web client has rendered.
 *
 * Hooks, in order of preference (see research_notes/Discord web DOM):
 *  - element IDs: `chat-messages-<channel>-<message>` (list items),
 *    `message-content-<id>`, `message-username-<groupStartId>`,
 *    `message-accessories-<id>`, `message-reply-context-<id>`,
 *    `message-reactions-<id>`;
 *  - `data-list-id`, `data-text`, `data-type`/`data-id`/`data-name` (emoji,
 *    stickers), `role` and `aria-labelledby`;
 *  - class-name substrings (`[class*="embedTitle"]`) only where nothing else
 *    exists, because Discord's class names carry build hashes.
 * Message times come from the snowflake ID, which is exact.
 */

export const MESSAGE_LIST_SELECTOR = 'ol[data-list-id="chat-messages"]';
const ITEM_ID_RE = /^chat-messages-(\d+)-(\d+)$/;
const USER_ID_FROM_AVATAR_RE = /\/(?:avatars|users)\/(\d+)\//;
const SIZE_TEXT_RE = /(\d+(?:[.,]\d+)?\s?(?:bytes|[KMGT]i?B))\b/i;

export interface DomParseContext {
  channelId: string;
}

export function findMessageList(doc: Document): Element | null {
  return doc.querySelector(MESSAGE_LIST_SELECTOR);
}

export function messageIdsOf(el: Element): { channelId: string; messageId: string } | null {
  const match = ITEM_ID_RE.exec(el.id);
  return match ? { channelId: match[1], messageId: match[2] } : null;
}

export type ListEntry =
  | { kind: 'message'; el: Element; messageId: string }
  /** Something between messages hides history here (e.g. a collapsed blocked-messages group). */
  | { kind: 'barrier' }
  /** The conversation's start header: nothing older exists. */
  | { kind: 'beginning' };

/**
 * Walks the rendered list in display order (oldest first). Message items are
 * not always direct children (jump targets are wrapped in `div[data-flash]`,
 * expanded blocked groups nest their messages), so descendants are used.
 */
export function walkList(list: Element, channelId: string): ListEntry[] {
  const entries: ListEntry[] = [];
  for (const el of Array.from(list.querySelectorAll('[id^="chat-messages-"], [role="article"]'))) {
    const ids = messageIdsOf(el);
    if (ids) {
      if (el.tagName === 'LI') {
        if (ids.channelId === channelId) entries.push({ kind: 'message', el, messageId: ids.messageId });
      } else if (ids.channelId === channelId && ids.messageId === channelId) {
        // div#chat-messages-<c>-<c>: "Welcome to #channel" / DM intro / thread starter.
        entries.push({ kind: 'beginning' });
      }
      continue;
    }
    if (el.closest('li[id^="chat-messages-"]') || el.closest('[id^="chat-messages-"]')) continue;
    // An article outside any message item: a collapsed blocked/ignored group or a
    // pending upload. An expanded group nests its messages and hides nothing.
    const group = el.parentElement;
    if (group && group !== list && group.querySelector('li[id^="chat-messages-"]')) continue;
    entries.push({ kind: 'barrier' });
  }
  return entries;
}

/** Message items in display order (convenience for callers that only need messages). */
export function listItems(list: Element, channelId: string): Element[] {
  return walkList(list, channelId).flatMap((entry) => (entry.kind === 'message' ? [entry.el] : []));
}

function outsideReply(el: Element): boolean {
  return !el.closest('[id^="message-reply-context-"]');
}

function firstOutsideReply(root: Element, selector: string): Element | null {
  for (const el of Array.from(root.querySelectorAll(selector))) {
    if (outsideReply(el)) return el;
  }
  return null;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
}

/** Resolves relative URLs (Discord serves default avatars as `/assets/...`). */
function absoluteUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://discord.com/');
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function articleOf(item: Element): Element {
  return item.matches('[role="article"]') ? item : (item.querySelector('[role="article"]') ?? item);
}

function parseAuthor(item: Element): ExportAuthor | undefined {
  const header = firstOutsideReply(item, '[id^="message-username-"]');
  if (!header) return undefined;
  const nameEl = header.querySelector('[data-text]') ?? header.querySelector('[class*="username"]') ?? header;
  const name = cleanText(nameEl.getAttribute('data-text') ?? nameEl.textContent).replace(/^@/, '');
  // Cozy layout: the avatar is a direct child image of the header's "contents" block.
  const contents = header.closest('[class*="contents"]');
  const avatar =
    (contents && Array.from(contents.children).find((el) => el.tagName === 'IMG' && !/decoration/i.test(el.className))) ??
    firstOutsideReply(item, 'img[class*="avatar"]:not([class*="Decoration"])');
  const avatarUrl = absoluteUrl(avatar?.getAttribute('src'));
  const tag = header.querySelector('[class*="botTag"], span[role="img"][aria-label]');
  const tagText = cleanText(tag?.textContent).toUpperCase();
  const bot = Boolean(tag && tagText !== 'OP' && (tagText !== '' || /app/i.test(tag.getAttribute('aria-label') ?? '')));
  return {
    id: avatarUrl ? USER_ID_FROM_AVATAR_RE.exec(avatarUrl)?.[1] : undefined,
    name: name || 'Unknown author',
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(bot ? { bot: true } : {}),
  };
}

interface Labels {
  groupStartId?: string;
  isReply: boolean;
  isSystem: boolean;
}

/**
 * `aria-labelledby` is `message-username-<groupStartId> … message-content-<id> …`;
 * replies start with `message-reply-context-<id>`; system messages have neither.
 */
function readLabels(item: Element): Labels {
  const article = articleOf(item);
  const labelled = article.getAttribute('aria-labelledby') ?? '';
  const groupStartId = /message-username-(\d+)/.exec(labelled)?.[1];
  const isReply = /message-reply-context-/.test(labelled);
  const classSystem = /systemMessage/i.test(article.className);
  const isSystem = classSystem || (labelled !== '' && !groupStartId && !isReply);
  return { groupStartId, isReply, isSystem };
}

/** Content elements of this message: its own, then forwarded snapshots (same ID, inside the accessories). */
function contentElements(item: Element, messageId: string): { own: Element[]; forwarded: Element[] } {
  const own: Element[] = [];
  const forwarded: Element[] = [];
  for (const el of Array.from(item.querySelectorAll(`[id="message-content-${messageId}"]`))) {
    if (!outsideReply(el)) continue;
    if (el.parentElement?.closest(`[id="message-accessories-${messageId}"]`)) forwarded.push(el);
    else own.push(el);
  }
  return { own, forwarded };
}

function parseEdited(item: Element, contents: Element[], messageId: string): string | undefined {
  // The "(edited)" marker is a <time> without an id at the end of the content,
  // or right after the accessories for attachment-only messages.
  const candidates = [
    ...contents.flatMap((el) => Array.from(el.querySelectorAll('time[datetime]:not([id])'))),
    ...Array.from(item.querySelectorAll(`[id="message-accessories-${messageId}"] > span time[datetime]:not([id])`)),
    ...Array.from(item.querySelectorAll('[class*="edited"] time[datetime], time[datetime] [class*="edited"]')).map(
      (el) => (el.tagName === 'TIME' ? el : el.closest('time')!),
    ),
  ];
  for (const time of candidates) {
    if (!time || !outsideReply(time)) continue;
    const date = new Date(time.getAttribute('datetime') ?? '');
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function parseReference(item: Element, messageId: string): ExportReference | undefined {
  const context = item.querySelector(`[id="message-reply-context-${messageId}"]`);
  if (!context) return undefined;
  const refContent = context.querySelector('[id^="message-content-"]');
  const refId = refContent?.id.replace('message-content-', '');
  const authorEl = context.querySelector('[data-text]') ?? context.querySelector('[class*="username"]');
  const authorName = cleanText(authorEl?.getAttribute('data-text') ?? authorEl?.textContent).replace(/^@/, '') || undefined;
  const placeholder = cleanText(context.querySelector('[class*="repliedTextPlaceholder"]')?.textContent) || undefined;
  if (refId && refId !== messageId) {
    return { messageId: refId, authorName, snippet: cleanText(sanitizeContent(refContent!).text).slice(0, 200) };
  }
  // No ID: the original was deleted, could not be loaded, is blocked, or has no text.
  return { authorName, snippet: placeholder, ...(authorName ? {} : { deleted: true }) };
}

function kindFor(tag: string, filename: string): AttachmentKind {
  if (tag === 'VIDEO') return 'video';
  if (tag === 'AUDIO') return 'audio';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a', 'opus', 'aac'].includes(ext)) return 'audio';
  if (tag === 'IMG') return 'image';
  return 'file';
}

const URL_ATTRIBUTES = ['href', 'src', 'data-safe-src', 'poster'];

function isEmbedMedia(el: Element, accessories: Element): boolean {
  const embed = el.closest('article, [class*="embed"]');
  return Boolean(embed && accessories.contains(embed) && !el.closest('[class*="imageWrapper"], [class*="fileWrapper"], [class*="attachment"]'));
}

/** Files referenced in the accessories, de-duplicated by attachment ID. */
function parseAttachments(accessories: Element): ExportAttachment[] {
  const found = new Map<string, ExportAttachment & { urls: string[]; el: Element }>();
  const candidates = accessories.querySelectorAll(
    'a[href], img[src], video[src], video[poster], source[src], audio[src], [data-safe-src]',
  );
  for (const el of Array.from(candidates)) {
    // Link previews (embeds) can show CDN images of other messages; skip them.
    if (isEmbedMedia(el, accessories)) continue;
    const media = el.tagName === 'SOURCE' ? el.parentElement : el;
    const mediaTag = media?.tagName ?? el.tagName;
    for (const attr of URL_ATTRIBUTES) {
      const url = absoluteUrl(el.getAttribute(attr));
      if (!url) continue;
      const parsed = parseAttachmentUrl(url);
      if (!parsed) continue;
      let entry = found.get(parsed.attachmentId);
      if (!entry) {
        entry = { id: parsed.attachmentId, filename: parsed.filename, url, urls: [], kind: kindFor(mediaTag, parsed.filename), el };
        found.set(parsed.attachmentId, entry);
      }
      if (!entry.urls.includes(url)) entry.urls.push(url);
      // Prefer the original file (cdn) over the media proxy preview.
      if (parsed.host === 'cdn.discordapp.com' && parseAttachmentUrl(entry.url)?.host !== 'cdn.discordapp.com') entry.url = url;
      if (mediaTag === 'VIDEO' || mediaTag === 'AUDIO') entry.kind = kindFor(mediaTag, parsed.filename);
      if (el.closest('[aria-label="Spoiler"], [class*="spoiler"]')) entry.spoiler = true;
      if (el.tagName === 'IMG') {
        const alt = el.getAttribute('alt');
        if (alt && !/^image$/i.test(alt) && alt !== parsed.filename) entry.description ??= alt;
      }
    }
  }
  return [...found.values()].map(({ urls, el, ...attachment }) => {
    const container = el.closest('[class*="fileWrapper"], [class*="attachment"], [role="region"]');
    const sizeText = container ? SIZE_TEXT_RE.exec(container.textContent ?? '')?.[1] : undefined;
    return {
      ...attachment,
      ...(urls.length > 1 ? { fallbackUrls: urls.filter((u) => u !== attachment.url) } : {}),
      // Displayed size only ("1.2 MB"); never used as the exact expected size.
      ...(sizeText ? { sizeText } : {}),
      ...(attachment.filename.startsWith('SPOILER_') ? { spoiler: true } : {}),
    };
  });
}

function textOf(root: Element, selector: string): string | undefined {
  return cleanText(root.querySelector(selector)?.textContent) || undefined;
}

function cssColorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return undefined;
  return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function outermost(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

function parseEmbeds(accessories: Element): ExportEmbed[] {
  const embeds: ExportEmbed[] = [];
  const rich = outermost(Array.from(accessories.querySelectorAll('article[class*="embed"], article[class*="Embed"], [class*="embedFull"]')));
  for (const el of rich) {
    const titleEl = el.querySelector('[class*="embedTitle"]');
    const titleLink = titleEl?.querySelector('a[href]') ?? (titleEl?.tagName === 'A' ? titleEl : null);
    const authorEl = el.querySelector('[class*="embedAuthorName"]');
    const fields = Array.from(el.querySelectorAll('[class*="embedFieldName"]')).map((nameEl) => ({
      name: cleanText(nameEl.textContent),
      value: cleanText(nameEl.parentElement?.querySelector('[class*="embedFieldValue"]')?.textContent),
    }));
    const imageLink = el.querySelector('[class*="embedImage"] a[href], [class*="embedMedia"] a[href]');
    const image = el.querySelector('[class*="embedImage"] img, [class*="embedMedia"] img');
    const thumbnail = el.querySelector('[class*="embedThumbnail"] img');
    const video = el.querySelector('[class*="embedVideo"] video, video');
    const style = el.getAttribute('style') ?? '';
    const embed: ExportEmbed = {
      title: cleanText(titleEl?.textContent) || undefined,
      url: absoluteUrl(titleLink?.getAttribute('href')),
      description: textOf(el, '[class*="embedDescription"]'),
      authorName: cleanText(authorEl?.textContent) || undefined,
      authorUrl: absoluteUrl(authorEl?.closest('a')?.getAttribute('href') ?? authorEl?.getAttribute('href')),
      providerName: textOf(el, '[class*="embedProvider"]'),
      footerText: textOf(el, '[class*="embedFooterText"]') ?? textOf(el, '[class*="embedFooter"]'),
      fields: fields.length ? fields : undefined,
      imageUrl: absoluteUrl(image?.getAttribute('src') ?? imageLink?.getAttribute('href')),
      thumbnailUrl: absoluteUrl(thumbnail?.getAttribute('src')),
      videoUrl: absoluteUrl(video?.getAttribute('src')),
      color: cssColorToHex(/border-left-color:\s*([^;]+)/i.exec(style)?.[1] ?? /border-color:\s*([^;]+)/i.exec(style)?.[1]),
    };
    for (const key of Object.keys(embed) as (keyof ExportEmbed)[]) if (embed[key] === undefined) delete embed[key];
    if (Object.keys(embed).length) embeds.push(embed);
  }
  // Image, GIF and video-only link previews.
  for (const el of outermost(Array.from(accessories.querySelectorAll('[class*="inlineMediaEmbed"]')))) {
    const link = el.querySelector('a[href]');
    const image = el.querySelector('img');
    const video = el.querySelector('video');
    const embed: ExportEmbed = { type: video ? 'video' : 'image' };
    const url = absoluteUrl(link?.getAttribute('href'));
    const imageUrl = absoluteUrl(image?.getAttribute('src'));
    const videoUrl = absoluteUrl(video?.getAttribute('src'));
    if (url) embed.url = url;
    if (imageUrl) embed.imageUrl = imageUrl;
    if (videoUrl) embed.videoUrl = videoUrl;
    if (url || imageUrl || videoUrl) embeds.push(embed);
  }
  return embeds;
}

function parseReactions(item: Element, messageId: string): ExportReaction[] {
  const container =
    item.querySelector(`[id="message-reactions-${messageId}"]`) ?? firstOutsideReply(item, '[class*="reactions"]');
  if (!container) return [];
  const reactions: ExportReaction[] = [];
  for (const img of Array.from(container.querySelectorAll('img.emoji, img[data-type="emoji"], [class*="reaction"] img'))) {
    const reaction = img.closest('[class*="reactionInner"]') ?? img.closest('[class*="reaction"]') ?? img.parentElement;
    if (!reaction) continue;
    const countText = cleanText(reaction.querySelector('[class*="reactionCount"]')?.textContent ?? reaction.textContent);
    const count = Number((/(\d[\d,.]*)/.exec(countText)?.[1] ?? '').replace(/[,.]/g, ''));
    if (!Number.isFinite(count) || count <= 0) continue;
    const src = absoluteUrl(img.getAttribute('src')) ?? '';
    const customId = img.getAttribute('data-id') ?? /\/emojis\/(\d+)\./.exec(src)?.[1];
    const alt = img.getAttribute('alt') || img.getAttribute('data-name') || '?';
    const emoji = customId ? `:${alt.replace(/^:|:$/g, '')}:` : alt;
    if (reactions.some((r) => (customId ? r.emojiId === customId : r.emoji === emoji))) continue;
    reactions.push({ emoji, ...(customId ? { emojiId: customId, emojiUrl: src || undefined } : {}), count });
  }
  return reactions;
}

const STICKER_FORMATS: Record<string, ExportSticker['format']> = { '1': 'png', '2': 'apng', '3': 'lottie', '4': 'gif' };

function parseStickers(accessories: Element): ExportSticker[] {
  const stickers: ExportSticker[] = [];
  for (const el of Array.from(accessories.querySelectorAll('[data-type="sticker"], img[src*="/stickers/"]'))) {
    const src = absoluteUrl(el.getAttribute('src'));
    const id = el.getAttribute('data-id') ?? (src ? /\/stickers\/(\d+)\./.exec(src)?.[1] : undefined);
    if (!id || stickers.some((s) => s.id === id)) continue;
    const format = STICKER_FORMATS[el.getAttribute('data-format-type') ?? ''] ?? (src && /\.gif/.test(src) ? 'gif' : 'png');
    const label = el.closest('[role="img"]')?.getAttribute('aria-label') ?? el.getAttribute('alt') ?? '';
    const name = el.getAttribute('data-name') || label.replace(/^Sticker,\s*/i, '').split(',')[0].trim() || 'sticker';
    stickers.push({
      id,
      name,
      url: format === 'lottie' ? `https://discord.com/stickers/${id}.json` : src,
      format,
    });
  }
  return stickers;
}

function parsePoll(accessories: Element): ExportPoll | undefined {
  const container = accessories.querySelector('[class*="pollContainer"]');
  if (!container) return undefined;
  const question = textOf(container, '[class*="question"]') ?? '';
  const answers = Array.from(container.querySelectorAll('[class*="answersContainer"] [class*="label"]')).map((label) => {
    const answer = label.closest('[class*="answer"]');
    const votesText = cleanText(answer?.querySelector('[class*="votesData"]')?.textContent);
    const votes = /(\d[\d,]*)\s*vote/i.exec(votesText)?.[1];
    return { text: cleanText(label.textContent), ...(votes ? { votes: Number(votes.replace(/,/g, '')) } : {}) };
  });
  return question || answers.length ? { question, answers } : undefined;
}

function joinContent(parts: SanitizedContent[]): { text: string; html: string } {
  return {
    text: parts.map((p) => p.text).filter(Boolean).join('\n'),
    html: parts.map((p) => p.html).filter(Boolean).join('<br>'),
  };
}

/** Parses one message list item. Returns `null` for items that are not messages of `ctx.channelId`. */
export function parseMessageItem(item: Element, ctx: DomParseContext): IncomingMessage | null {
  const ids = messageIdsOf(item);
  if (!ids || ids.channelId !== ctx.channelId) return null;
  const { messageId } = ids;

  const labels = readLabels(item);
  const author = labels.isSystem ? undefined : parseAuthor(item);
  const headId =
    !author && labels.groupStartId && labels.groupStartId !== messageId ? labels.groupStartId : undefined;
  const { own, forwarded } = contentElements(item, messageId);
  const accessories = item.querySelector(`[id="message-accessories-${messageId}"]`);
  const ownParts = own.map((el) => sanitizeContent(el));
  const forwardedParts = forwarded.map((el) => sanitizeContent(el));
  const content = joinContent([...ownParts, ...forwardedParts]);
  const emojis = [...ownParts, ...forwardedParts].flatMap((p) => p.emojis).filter((e, i, all) => all.findIndex((x) => x.id === e.id) === i);

  const flags: string[] = [];
  if (forwarded.length) flags.push('forwarded');
  if (accessories?.querySelector('[role="region"] audio, [class*="voiceMessage"]')) flags.push('voice-message');

  const attachments = accessories ? parseAttachments(accessories) : [];
  const embeds = accessories ? parseEmbeds(accessories) : [];
  const stickers = accessories ? parseStickers(accessories) : [];
  const poll = accessories ? parsePoll(accessories) : undefined;
  const reactions = parseReactions(item, messageId);
  const reference = parseReference(item, messageId);

  if (labels.isSystem) {
    const text = cleanText(content.text) || cleanText(articleOf(item).textContent);
    if (!text) return null;
    return {
      id: messageId,
      channelId: ids.channelId,
      timestamp: snowflakeToIso(messageId),
      type: 'system',
      system: true,
      author: { name: '' },
      content: text,
      attachments,
      embeds,
      reactions,
      stickers,
      emojis: [],
      flags,
      source: 'dom',
    };
  }

  return {
    id: messageId,
    channelId: ids.channelId,
    timestamp: snowflakeToIso(messageId),
    editedTimestamp: parseEdited(item, [...own, ...forwarded], messageId),
    type: reference ? 'reply' : 'default',
    author: author ?? { name: '' },
    authorRefId: headId,
    content: content.text,
    contentHtml: content.html || undefined,
    attachments,
    embeds,
    reactions,
    stickers,
    emojis,
    reference,
    flags,
    poll,
    source: 'dom',
  };
}
