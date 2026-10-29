import { describe, expect, it } from 'vitest';
import { addDays, buildDateRange, isWithinRange, parseIsoDate, toIsoDate } from '../src/core/dateRange';
import { buildChannelUrl, parseDiscordUrl } from '../src/core/discordUrl';
import { formatBytes, sleep } from '../src/core/format';
import {
  compareSnowflakes,
  DISCORD_EPOCH_MS,
  isSnowflake,
  msToSnowflake,
  snowflakeSortKey,
  snowflakeToIso,
  snowflakeToMs,
  sortKeyToSnowflake,
} from '../src/core/snowflake';

describe('snowflakes', () => {
  it('decodes the documented example', () => {
    // https://discord.com/developers/docs/reference#snowflakes
    expect(snowflakeToMs('175928847299117063')).toBe(1462015105796);
    expect(snowflakeToIso('175928847299117063')).toBe('2016-04-30T11:18:25.796Z');
  });

  it('round-trips time to the smallest snowflake at that time', () => {
    const ms = Date.UTC(2026, 0, 15, 12, 30, 0, 123);
    const id = msToSnowflake(ms);
    expect(snowflakeToMs(id)).toBe(ms);
    expect(BigInt(id) & ((1n << 22n) - 1n)).toBe(0n);
  });

  it('clamps times before the Discord epoch', () => {
    expect(msToSnowflake(DISCORD_EPOCH_MS - 1000)).toBe('0');
  });

  it('compares numerically, including different lengths', () => {
    expect(compareSnowflakes('99', '100')).toBeLessThan(0);
    expect(compareSnowflakes('1234', '1234')).toBe(0);
    expect(compareSnowflakes('1300000000000000000', '999999999999999999')).toBeGreaterThan(0);
  });

  it('builds sort keys whose string order matches numeric order', () => {
    const ids = ['1300000000000000000', '999999999999999999', '175928847299117063'];
    const sorted = [...ids].sort((a, b) => (snowflakeSortKey(a) < snowflakeSortKey(b) ? -1 : 1));
    expect(sorted).toEqual(['175928847299117063', '999999999999999999', '1300000000000000000']);
    expect(sortKeyToSnowflake(snowflakeSortKey('175928847299117063'))).toBe('175928847299117063');
  });

  it('validates snowflake strings', () => {
    expect(isSnowflake('123')).toBe(true);
    expect(isSnowflake('12a')).toBe(false);
    expect(isSnowflake(123)).toBe(false);
  });
});

describe('date ranges (America/New_York)', () => {
  it('covers whole local days', () => {
    const range = buildDateRange('2026-01-01', '2026-01-31');
    expect(new Date(range.startMs).toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(new Date(range.endMs).toISOString()).toBe('2026-02-01T04:59:59.999Z');
    expect(range.timeZone).toBe('America/New_York');
  });

  it('handles the daylight-saving change (23-hour day)', () => {
    const range = buildDateRange('2026-03-08', '2026-03-08');
    expect(range.endMs - range.startMs + 1).toBe(23 * 3600 * 1000);
  });

  it('rejects invalid or reversed dates', () => {
    expect(() => buildDateRange('2026-02-31', '2026-03-01')).toThrow(/start date/);
    expect(() => buildDateRange('2026-03-02', '2026-03-01')).toThrow(/before the start/);
    expect(parseIsoDate('2026-13-01')).toBeNull();
  });

  it('checks inclusion at both edges', () => {
    const range = buildDateRange('2026-01-01', '2026-01-01');
    expect(isWithinRange(range, range.startMs)).toBe(true);
    expect(isWithinRange(range, range.endMs)).toBe(true);
    expect(isWithinRange(range, range.endMs + 1)).toBe(false);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('Discord URLs', () => {
  it('parses server channels, DMs and message links', () => {
    expect(parseDiscordUrl('https://discord.com/channels/123/456')).toEqual({ guildId: '123', channelId: '456' });
    expect(parseDiscordUrl('https://discord.com/channels/@me/789')).toEqual({ guildId: null, channelId: '789' });
    expect(parseDiscordUrl('https://discord.com/channels/1/2/3')).toEqual({ guildId: '1', channelId: '2', messageId: '3' });
  });

  it('rejects other pages and hosts', () => {
    expect(parseDiscordUrl('https://discord.com/app')).toBeNull();
    expect(parseDiscordUrl('https://discord.com/channels/@me')).toBeNull();
    expect(parseDiscordUrl('https://evil.example/channels/1/2')).toBeNull();
    expect(parseDiscordUrl('not a url')).toBeNull();
  });

  it('builds channel and jump URLs', () => {
    expect(buildChannelUrl({ guildId: null, channelId: '9' })).toBe('https://discord.com/channels/@me/9');
    expect(buildChannelUrl({ guildId: '1', channelId: '2' }, '3')).toBe('https://discord.com/channels/1/2/3');
  });
});

describe('formatting helpers', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
  });

  it('sleep can be aborted', async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
