import { msToSnowflake, snowflakeToMs } from '../../core/snowflake';
import type { DateRange, ExportMessage } from '../../core/types';
import type { ApiChannel, ApiGuild, ApiMessage, ApiRole } from './apiTypes';
import { DiscordApiError, type DiscordBotClient } from './client';
import { looksLikeMissingContentIntent, mapApiMessage, type MapContext } from './mapper';

export interface ConversationContext {
  channel: ApiChannel;
  guild?: ApiGuild;
  mapContext: MapContext;
}

/** Channel details plus role/channel names for readable mentions (best effort). */
export async function loadConversationContext(
  client: DiscordBotClient,
  channelId: string,
  signal?: AbortSignal,
): Promise<ConversationContext> {
  const channel = await client.get<ApiChannel>(`/channels/${channelId}`, {}, signal);
  const mapContext: MapContext = {};
  let guild: ApiGuild | undefined;
  if (channel.guild_id) {
    const optional = async <T>(path: string): Promise<T | undefined> => {
      try {
        return await client.get<T>(path, {}, signal);
      } catch (error) {
        if (error instanceof DiscordApiError && error.status !== 0) return undefined;
        throw error;
      }
    };
    guild = await optional<ApiGuild>(`/guilds/${channel.guild_id}`);
    const roles = await optional<ApiRole[]>(`/guilds/${channel.guild_id}/roles`);
    const channels = await optional<ApiChannel[]>(`/guilds/${channel.guild_id}/channels`);
    if (roles) mapContext.roles = Object.fromEntries(roles.map((r) => [r.id, r.name]));
    if (channels) mapContext.channels = Object.fromEntries(channels.map((c) => [c.id, c.name ?? c.id]));
  }
  return { channel, guild, mapContext };
}

export interface FetchedPage {
  /** Messages inside the date range, oldest first. */
  messages: ExportMessage[];
  /** ID to continue after (newest message fetched). */
  cursor: string;
  /** Reached the end of the range or the conversation's latest message. */
  finished: boolean;
  missingContentIntent: boolean;
}

/** Cursor that makes the first page start exactly at the range start. */
export function initialCursor(range: Pick<DateRange, 'startMs'>): string {
  const first = BigInt(msToSnowflake(range.startMs));
  return first > 0n ? (first - 1n).toString() : '0';
}

/**
 * Pages forward through a channel with `after=<cursor>&limit=100` (the
 * approach DiscordChatExporter uses). Discord returns each page newest first,
 * so pages are re-sorted; messages past the end of the range stop the loop.
 */
export async function* fetchMessagesInRange(
  client: DiscordBotClient,
  channelId: string,
  range: Pick<DateRange, 'startMs' | 'endMs'>,
  startCursor: string | undefined,
  mapContext: MapContext,
  signal?: AbortSignal,
): AsyncGenerator<FetchedPage> {
  let cursor = startCursor ?? initialCursor(range);
  for (;;) {
    const page = await client.get<ApiMessage[]>(`/channels/${channelId}/messages`, { limit: 100, after: cursor }, signal);
    if (!page.length) {
      yield { messages: [], cursor, finished: true, missingContentIntent: false };
      return;
    }
    page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const inRange = page.filter((m) => snowflakeToMs(m.id) <= range.endMs);
    const passedEnd = inRange.length < page.length;
    cursor = page[page.length - 1].id;
    yield {
      messages: inRange.map((m) => mapApiMessage(m, mapContext)),
      cursor,
      finished: passedEnd || page.length < 100,
      missingContentIntent: looksLikeMissingContentIntent(page),
    };
    if (passedEnd || page.length < 100) return;
  }
}

/** Re-fetches one message to get fresh (re-signed) attachment URLs. */
export async function refetchMessage(
  client: DiscordBotClient,
  channelId: string,
  messageId: string,
  mapContext: MapContext,
  signal?: AbortSignal,
): Promise<ExportMessage | null> {
  try {
    const message = await client.get<ApiMessage>(`/channels/${channelId}/messages/${messageId}`, {}, signal);
    return mapApiMessage(message, mapContext);
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null;
    throw error;
  }
}
