/**
 * Helpers for Discord CDN URLs.
 *
 * Attachment URLs are signed (`ex`, `is`, `hm`) and expire; the documented way
 * to get a fresh URL is to fetch the message again. Avatar, emoji and sticker
 * URLs are not signed and do not expire.
 * https://discord.com/developers/docs/reference#signed-attachment-cdn-urls
 */

const ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const ATTACHMENT_PATH_RE = /^\/(?:ephemeral-)?attachments\/(\d+)\/(\d+)\/([^/]+)$/;
const SIGNATURE_PARAMS = ['ex', 'is', 'hm'] as const;

export interface ParsedAttachmentUrl {
  host: string;
  channelId: string;
  attachmentId: string;
  filename: string;
  expiresAtMs?: number;
  issuedAtMs?: number;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hexSecondsToMs(value: string | null): number | undefined {
  if (!value || !/^[0-9a-f]{1,12}$/i.test(value)) return undefined;
  return parseInt(value, 16) * 1000;
}

export function parseAttachmentUrl(value: string): ParsedAttachmentUrl | null {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || !ATTACHMENT_HOSTS.has(url.hostname)) return null;
  const match = ATTACHMENT_PATH_RE.exec(url.pathname);
  if (!match) return null;
  let filename = match[3];
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // Keep the raw segment.
  }
  return {
    host: url.hostname,
    channelId: match[1],
    attachmentId: match[2],
    filename,
    expiresAtMs: hexSecondsToMs(url.searchParams.get('ex')),
    issuedAtMs: hexSecondsToMs(url.searchParams.get('is')),
  };
}

/**
 * Original-quality CDN URL for an attachment: media-proxy URLs (resized or
 * re-encoded previews) are mapped back to cdn.discordapp.com and only the
 * signature parameters are kept.
 */
export function toOriginalAttachmentUrl(value: string): string {
  const url = parseUrl(value);
  if (!url || !parseAttachmentUrl(value)) return value;
  return withSignatureOnly(`https://cdn.discordapp.com${url.pathname}`, url);
}

function withSignatureOnly(base: string, source: URL): string {
  const out = new URL(base);
  for (const param of SIGNATURE_PARAMS) {
    const v = source.searchParams.get(param);
    if (v !== null) out.searchParams.set(param, v);
  }
  return out.toString();
}

/** URLs to try, best quality first, without duplicates. */
export function attachmentCandidateUrls(primary: string, extra: string[] = []): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  for (const value of [primary, ...extra]) {
    const url = parseUrl(value);
    if (!url) continue;
    if (parseAttachmentUrl(value)) {
      add(toOriginalAttachmentUrl(value));
      if (url.hostname === 'media.discordapp.net') {
        add(withSignatureOnly(`https://media.discordapp.net${url.pathname}`, url));
      }
    }
    add(value);
  }
  return candidates;
}

/** Whether a signed attachment URL has passed its expiry time. */
export function isAttachmentUrlExpired(value: string, nowMs = Date.now(), skewMs = 30_000): boolean {
  const parsed = parseAttachmentUrl(value);
  if (!parsed?.expiresAtMs) return false;
  return parsed.expiresAtMs <= nowMs + skewMs;
}

export type AssetKind = 'avatar' | 'emoji' | 'sticker' | 'misc';

export interface AssetDescriptor {
  /** Stable identity used for de-duplication. */
  key: string;
  kind: AssetKind;
  /** URL to download. */
  url: string;
  /** Relative path inside the export. */
  path: string;
}

const AVATAR_RE = /^\/avatars\/(\d+)\/((?:a_)?[0-9a-f]+)\.(png|jpe?g|webp|gif)$/i;
const MEMBER_AVATAR_RE = /^\/guilds\/(\d+)\/users\/(\d+)\/avatars\/((?:a_)?[0-9a-f]+)\.(png|jpe?g|webp|gif)$/i;
const DEFAULT_AVATAR_RE = /^\/embed\/avatars\/(\d+)\.png$/i;
const EMOJI_RE = /^\/emojis\/(\d+)\.(png|jpe?g|webp|gif)$/i;
const STICKER_RE = /^\/stickers\/(\d+)\.(png|gif|webp|json)$/i;
const DISCORD_ASSET_RE = /^\/assets\/([\w.-]+\.(?:png|svg|webp|gif))$/i;

/**
 * Describes an unsigned Discord image (avatar, custom emoji, sticker) so it can
 * be downloaded once and referenced locally. Returns `null` for anything else.
 */
export function describeAsset(value: string | undefined): AssetDescriptor | null {
  if (!value) return null;
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return null;
  const host = url.hostname;
  const path = url.pathname;

  if (host === 'cdn.discordapp.com' || host === 'media.discordapp.net') {
    let m = AVATAR_RE.exec(path);
    if (m) {
      const [, userId, hash, ext] = m;
      return {
        key: `avatar:${userId}:${hash}`,
        kind: 'avatar',
        url: `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=128`,
        path: `assets/avatars/${userId}-${hash}.${ext.toLowerCase()}`,
      };
    }
    m = MEMBER_AVATAR_RE.exec(path);
    if (m) {
      const [, guildId, userId, hash, ext] = m;
      return {
        key: `avatar:${guildId}:${userId}:${hash}`,
        kind: 'avatar',
        url: `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${hash}.${ext}?size=128`,
        path: `assets/avatars/${guildId}-${userId}-${hash}.${ext.toLowerCase()}`,
      };
    }
    m = DEFAULT_AVATAR_RE.exec(path);
    if (m) {
      return {
        key: `avatar:default:${m[1]}`,
        kind: 'avatar',
        url: `https://cdn.discordapp.com/embed/avatars/${m[1]}.png`,
        path: `assets/avatars/default-${m[1]}.png`,
      };
    }
    m = EMOJI_RE.exec(path);
    if (m) {
      const [, id, ext] = m;
      const animated = url.searchParams.get('animated') === 'true' || ext.toLowerCase() === 'gif';
      const outExt = animated ? 'gif' : ext.toLowerCase();
      return {
        key: `emoji:${id}:${outExt}`,
        kind: 'emoji',
        url: `https://cdn.discordapp.com/emojis/${id}.${outExt}?size=96`,
        path: `assets/emoji/${id}.${outExt}`,
      };
    }
    m = STICKER_RE.exec(path);
    if (m) {
      const [, id, ext] = m;
      return {
        key: `sticker:${id}`,
        kind: 'sticker',
        url: `https://${host}/stickers/${id}.${ext}${ext.toLowerCase() === 'json' ? '' : '?size=320'}`,
        path: `assets/stickers/${id}.${ext.toLowerCase()}`,
      };
    }
    return null;
  }

  if (host === 'discord.com') {
    const m = DISCORD_ASSET_RE.exec(path);
    if (m) {
      return {
        key: `misc:${m[1]}`,
        kind: 'misc',
        url: `https://discord.com/assets/${m[1]}`,
        path: `assets/misc/${m[1]}`,
      };
    }
  }
  return null;
}

/** CDN URL of a user avatar from API fields. */
export function userAvatarUrl(userId: string, avatarHash: string | null | undefined, discriminator?: string): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
  }
  // Default avatars: (id >> 22) % 6 for the new username system, discriminator % 5 for legacy users.
  const index =
    discriminator && discriminator !== '0'
      ? Number(discriminator) % 5
      : Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function customEmojiUrl(id: string, animated: boolean): string {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=96`;
}

/** Sticker URL by format type (1 PNG, 2 APNG, 3 Lottie, 4 GIF). */
export function stickerUrl(id: string, formatType: number): { url: string; format: 'png' | 'apng' | 'gif' | 'lottie' } {
  switch (formatType) {
    case 3:
      return { url: `https://cdn.discordapp.com/stickers/${id}.json`, format: 'lottie' };
    case 4:
      return { url: `https://media.discordapp.net/stickers/${id}.gif`, format: 'gif' };
    case 2:
      return { url: `https://cdn.discordapp.com/stickers/${id}.png`, format: 'apng' };
    default:
      return { url: `https://cdn.discordapp.com/stickers/${id}.png`, format: 'png' };
  }
}
