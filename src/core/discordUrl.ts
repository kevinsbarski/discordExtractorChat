import { isSnowflake } from './snowflake';

export interface DiscordLocation {
  /** `null` for direct messages (`@me`). */
  guildId: string | null;
  channelId: string;
  messageId?: string;
}

const CHANNEL_PATH_RE = /^\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?\/?$/;

/** Parses `https://discord.com/channels/<guild|@me>/<channel>[/<message>]`. */
export function parseDiscordUrl(url: string | undefined | null): DiscordLocation | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com') return null;
  const match = CHANNEL_PATH_RE.exec(parsed.pathname);
  if (!match) return null;
  const [, guild, channelId, messageId] = match;
  if (!isSnowflake(channelId)) return null;
  return {
    guildId: guild === '@me' ? null : guild,
    channelId,
    ...(messageId ? { messageId } : {}),
  };
}

export function buildChannelUrl(location: DiscordLocation, messageId?: string): string {
  const guild = location.guildId ?? '@me';
  const base = `https://discord.com/channels/${guild}/${location.channelId}`;
  return messageId ? `${base}/${messageId}` : base;
}
