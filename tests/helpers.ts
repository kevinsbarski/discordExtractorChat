import { msToSnowflake } from '../src/core/snowflake';
import { DEFAULT_OPTIONS, type ExportMessage } from '../src/core/types';
import type { NewJobInput } from '../src/storage/jobStore';

export const RANGE_START = Date.UTC(2026, 0, 1);
export const RANGE_END = Date.UTC(2026, 0, 2) - 1;

/** Snowflake for a time inside the test range, `minutes` after its start. */
export function idAt(minutes: number, seq = 0): string {
  return (BigInt(msToSnowflake(RANGE_START + minutes * 60_000)) + BigInt(seq)).toString();
}

export function jobInput(overrides: Partial<NewJobInput> = {}): NewJobInput {
  return {
    method: 'dom',
    conversation: {
      guildId: '1',
      channelId: '10',
      channelName: '#general',
      guildName: 'Test Server',
      url: 'https://discord.com/channels/1/10',
    },
    range: {
      startMs: RANGE_START,
      endMs: RANGE_END,
      startDate: '2026-01-01',
      endDate: '2026-01-01',
      timeZone: 'UTC',
    },
    options: { ...DEFAULT_OPTIONS },
    tabId: 7,
    ...overrides,
  };
}

export function message(id: string, overrides: Partial<ExportMessage> = {}): ExportMessage {
  return {
    id,
    channelId: '10',
    timestamp: new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString(),
    type: 'default',
    author: { id: '20', name: 'Alice', avatarUrl: 'https://cdn.discordapp.com/avatars/20/abc.webp?size=80' },
    content: `text ${id}`,
    attachments: [],
    embeds: [],
    reactions: [],
    stickers: [],
    emojis: [],
    flags: [],
    source: 'dom',
    ...overrides,
  };
}
