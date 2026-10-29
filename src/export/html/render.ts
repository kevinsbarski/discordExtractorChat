import { formatBytes } from '../../core/format';
import type { ExportAttachment, ExportEmbed } from '../../core/types';
import {
  assetPath,
  attachmentFile,
  partOfMessage,
  type ExportContext,
  type ResolvedMessage,
} from '../context';
import { encodeRelativePath, escapeHtml, safeExternalUrl } from '../escape';
import { renderDiscordMarkdown, type MarkdownContext } from '../markdown';

/** How messages are grouped under one header, like Discord (same author within 7 minutes). */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

export interface TimeFormatters {
  time: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  dayKey: Intl.DateTimeFormat;
}

export function createFormatters(timeZone: string | undefined): TimeFormatters {
  const make = (options: Intl.DateTimeFormatOptions, locale?: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone });
    } catch {
      return new Intl.DateTimeFormat(locale, options);
    }
  };
  return {
    time: make({ hour: '2-digit', minute: '2-digit' }),
    dateTime: make({ dateStyle: 'medium', timeStyle: 'short' }),
    day: make({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayKey: make({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA'),
  };
}

/** Resolves export-relative paths for a page located in `pageDir` ('' or 'html'). */
export function relativeHref(path: string, pageDir: string): string {
  return encodeRelativePath(pageDir ? `../${path}` : path);
}

function localOrRemote(ctx: ExportContext, url: string | undefined, pageDir: string): string | null {
  const local = assetPath(ctx, url);
  if (local) return relativeHref(local, pageDir);
  return safeExternalUrl(url);
}

function rewriteEmojiSources(html: string, ctx: ExportContext, pageDir: string): string {
  return html.replace(/(<img class="d-emoji"[^>]*?\ssrc=")([^"]*)(")/g, (match, before: string, src: string, after: string) => {
    const url = src.replace(/&amp;/g, '&');
    const local = assetPath(ctx, url);
    return local ? `${before}${escapeHtml(relativeHref(local, pageDir))}${after}` : match;
  });
}

function renderContent(message: ResolvedMessage, ctx: ExportContext, pageDir: string): string {
  if (message.system) return `<div class="system">${escapeHtml(message.content)}</div>`;
  if (message.contentHtml) {
    return `<div class="content">${rewriteEmojiSources(message.contentHtml, ctx, pageDir)}</div>`;
  }
  if (message.contentMarkdown) {
    const markdownCtx: MarkdownContext = {
      users: message.mentions,
      emojiSrc: (id, animated) => {
        const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=96`;
        const local = assetPath(ctx, url);
        return local ? relativeHref(local, pageDir) : url;
      },
    };
    return `<div class="content">${renderDiscordMarkdown(message.contentMarkdown, markdownCtx)}</div>`;
  }
  if (message.content) return `<div class="content">${escapeHtml(message.content)}</div>`;
  return '';
}

function renderAttachment(attachment: ExportAttachment, ctx: ExportContext, pageDir: string): string {
  const file = attachmentFile(ctx, attachment);
  const name = escapeHtml(attachment.filename);
  const size = attachment.size !== undefined ? formatBytes(attachment.size) : attachment.sizeText ?? '';
  let inner: string;
  if (file?.localPath) {
    const href = escapeHtml(relativeHref(file.localPath, pageDir));
    const dims =
      attachment.width && attachment.height ? ` width="${attachment.width}" height="${attachment.height}"` : '';
    switch (attachment.kind) {
      case 'image':
        inner = `<a href="${href}" target="_blank"><img src="${href}" alt="${escapeHtml(attachment.description ?? attachment.filename)}" loading="lazy"${dims}></a>`;
        break;
      case 'video':
        inner = `<video controls preload="metadata" src="${href}"${dims}></video><div class="meta"><a href="${href}" target="_blank">${name}</a> ${escapeHtml(size)}</div>`;
        break;
      case 'audio':
        inner = `<div class="file">🔊 <a href="${href}" target="_blank">${name}</a> <span class="meta">${escapeHtml(size)}</span></div><audio controls preload="none" src="${href}"></audio>`;
        break;
      default:
        inner = `<div class="file">📄 <a href="${href}" target="_blank">${name}</a> <span class="meta">${escapeHtml(size)}</span></div>`;
    }
  } else {
    const remote = safeExternalUrl(attachment.url);
    const why =
      file === undefined
        ? 'not downloaded'
        : file.status === 'pending'
          ? 'download not finished'
          : `download ${file.status}${file.error ? `: ${file.error}` : ''}`;
    inner = `<div class="missing">📎 ${remote ? `<a href="${escapeHtml(remote)}" target="_blank" rel="noreferrer">${name}</a>` : name} <span class="meta">${escapeHtml(size)}</span><br><span class="why">${escapeHtml(why)}</span> — the online link expires, so it may no longer work.</div>`;
  }
  if (attachment.spoiler) inner = `<details class="spoiler"><summary>Spoiler: ${name}</summary>${inner}</details>`;
  return `<div class="attachment">${inner}</div>`;
}

function renderEmbed(embed: ExportEmbed, message: ResolvedMessage, ctx: ExportContext, pageDir: string): string {
  const parts: string[] = [];
  const color = embed.color && /^#[0-9a-f]{6}$/i.test(embed.color) ? ` style="border-left-color:${embed.color}"` : '';
  if (embed.providerName) parts.push(`<div class="e-provider">${escapeHtml(embed.providerName)}</div>`);
  if (embed.authorName) {
    const href = safeExternalUrl(embed.authorUrl);
    parts.push(
      `<div class="e-author">${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(embed.authorName)}</a>` : escapeHtml(embed.authorName)}</div>`,
    );
  }
  if (embed.title) {
    const href = safeExternalUrl(embed.url);
    parts.push(
      `<div class="e-title">${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(embed.title)}</a>` : escapeHtml(embed.title)}</div>`,
    );
  }
  if (embed.description) {
    const desc =
      message.source === 'bot'
        ? renderDiscordMarkdown(embed.description, { users: message.mentions })
        : escapeHtml(embed.description);
    parts.push(`<div class="e-desc">${desc}</div>`);
  }
  if (embed.fields?.length) {
    parts.push(
      `<div class="e-fields">${embed.fields
        .map(
          (field) =>
            `<div class="e-field"><b>${escapeHtml(field.name)}</b>${message.source === 'bot' ? renderDiscordMarkdown(field.value) : escapeHtml(field.value)}</div>`,
        )
        .join('')}</div>`,
    );
  }
  const image = localOrRemote(ctx, embed.imageUrl ?? embed.thumbnailUrl, pageDir);
  if (image) parts.push(`<img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`);
  if (embed.footerText) parts.push(`<div class="e-footer">${escapeHtml(embed.footerText)}</div>`);
  if (!parts.length && embed.url) {
    const href = safeExternalUrl(embed.url);
    if (href) parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(href)}</a>`);
  }
  return parts.length ? `<div class="embed"${color}>${parts.join('')}</div>` : '';
}

function renderReply(message: ResolvedMessage, ctx: ExportContext, currentPart: number): string {
  const ref = message.reference;
  if (!ref || message.flags.includes('forwarded')) return '';
  if (ref.deleted) return `<div class="reply">↪ <i>${escapeHtml(ref.snippet ?? 'Original message was deleted')}</i></div>`;
  let href = '';
  if (ref.messageId) {
    const part = partOfMessage(ctx, ref.messageId);
    if (part !== null) href = part === currentPart ? `#m-${ref.messageId}` : `${partFileName(part)}#m-${ref.messageId}`;
  }
  const author = ref.authorName ? `<span class="ref-author">@${escapeHtml(ref.authorName)}</span>` : '';
  const snippet = escapeHtml((ref.snippet ?? '').slice(0, 120)) || '<i>Click to see the message</i>';
  const body = `${author} ${snippet}`;
  return `<div class="reply">↪ ${href ? `<a href="${escapeHtml(href)}">${body}</a>` : body}</div>`;
}

export function partFileName(part: number): string {
  return `part-${String(part + 1).padStart(4, '0')}.html`;
}

function initials(name: string): string {
  const letters = Array.from(name.trim()).filter((ch) => /\p{L}|\p{N}/u.test(ch));
  return escapeHtml((letters[0] ?? '?').toUpperCase());
}

export interface RenderState {
  previous?: ResolvedMessage;
  previousDay?: string;
}

/** Renders one message, starting a new group or day when needed. */
export function renderMessage(
  message: ResolvedMessage,
  ctx: ExportContext,
  fmt: TimeFormatters,
  state: RenderState,
  part: number,
  pageDir = 'html',
): string {
  const created = new Date(message.timestamp);
  const dayKey = fmt.dayKey.format(created);
  let out = '';
  if (dayKey !== state.previousDay) {
    out += `<div class="day" role="separator"><span>${escapeHtml(fmt.day.format(created))}</span></div>`;
  }
  const previous = state.previous;
  const sameAuthor =
    previous &&
    (previous.author.id && message.author.id ? previous.author.id === message.author.id : previous.author.name === message.author.name);
  const startsGroup =
    !previous ||
    dayKey !== state.previousDay ||
    !sameAuthor ||
    Boolean(message.system) ||
    Boolean(previous.system) ||
    Boolean(message.reference && !message.flags.includes('forwarded')) ||
    created.getTime() - new Date(previous.timestamp).getTime() > GROUP_WINDOW_MS;

  const iso = escapeHtml(message.timestamp);
  const searchText = `${message.author.name} ${message.content} ${message.attachments.map((a) => a.filename).join(' ')}`
    .toLowerCase()
    .slice(0, 4000);
  out += `<article class="msg${startsGroup ? ' start' : ''}" id="m-${escapeHtml(message.id)}" data-search="${escapeHtml(searchText)}">`;

  if (message.system) {
    // System messages (joins, pins, boosts…) carry their actor in the text.
    out += `<div class="gutter"><span class="system-icon" aria-hidden="true">→</span></div><div class="body">`;
    out += `<div class="head"><time datetime="${iso}" title="${iso}">${escapeHtml(fmt.dateTime.format(created))}</time></div>`;
  } else if (startsGroup) {
    const avatar = localOrRemote(ctx, message.author.avatarUrl, pageDir);
    out += `<div class="gutter">${
      avatar
        ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="avatar placeholder">${initials(message.author.name)}</div>`
    }</div><div class="body">`;
    out += renderReply(message, ctx, part);
    out += `<div class="head"><span class="author" title="${escapeHtml(message.author.username ?? message.author.id ?? '')}">${escapeHtml(message.author.name)}</span>`;
    if (message.author.bot) out += `<span class="badge">APP</span>`;
    out += `<time datetime="${iso}" title="${iso}">${escapeHtml(fmt.dateTime.format(created))}</time></div>`;
  } else {
    out += `<div class="gutter"><time datetime="${iso}" title="${iso}">${escapeHtml(fmt.time.format(created))}</time></div><div class="body">`;
  }

  const labels: string[] = [];
  if (message.flags.includes('forwarded')) labels.push('↗ Forwarded');
  if (message.flags.includes('voice-message')) labels.push('🎤 Voice message');
  if (message.flags.includes('pinned')) labels.push('📌 Pinned');
  if (labels.length) out += `<div class="label">${escapeHtml(labels.join(' · '))}</div>`;

  out += renderContent(message, ctx, pageDir);
  if (message.editedTimestamp) {
    out += ` <span class="edited" title="${escapeHtml(message.editedTimestamp)}">(edited)</span>`;
  }
  if (message.poll) {
    out += `<div class="poll"><b>📊 ${escapeHtml(message.poll.question)}</b><ul>${message.poll.answers
      .map((a) => `<li>${escapeHtml(a.text)}${a.votes !== undefined ? ` — ${a.votes} vote${a.votes === 1 ? '' : 's'}` : ''}</li>`)
      .join('')}</ul></div>`;
  }
  if (message.attachments.length) {
    out += `<div class="attachments">${message.attachments.map((a) => renderAttachment(a, ctx, pageDir)).join('')}</div>`;
  }
  for (const sticker of message.stickers) {
    const src = sticker.format === 'lottie' ? null : localOrRemote(ctx, sticker.url, pageDir);
    out += src
      ? `<img class="sticker" src="${escapeHtml(src)}" alt="${escapeHtml(sticker.name)}" title="${escapeHtml(sticker.name)}" loading="lazy">`
      : `<div class="label">Sticker: ${escapeHtml(sticker.name)}</div>`;
  }
  out += message.embeds.map((embed) => renderEmbed(embed, message, ctx, pageDir)).join('');
  if (message.reactions.length) {
    out += `<div class="reactions">${message.reactions
      .map((reaction) => {
        const src = reaction.emojiUrl ? localOrRemote(ctx, reaction.emojiUrl, pageDir) : null;
        const emoji = src
          ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(reaction.emoji)}" title="${escapeHtml(reaction.emoji)}">`
          : escapeHtml(reaction.emoji);
        return `<span class="reaction">${emoji} ${reaction.count}</span>`;
      })
      .join('')}</div>`;
  }
  out += `</div></article>`;

  state.previous = message;
  state.previousDay = dayKey;
  return out;
}
