import { describe, expect, it, vi } from 'vitest';
import { msToSnowflake } from '../src/core/snowflake';
import type { ApiMessage } from '../src/retrieval/bot/apiTypes';
import { DiscordApiError, DiscordBotClient, routeKey } from '../src/retrieval/bot/client';
import { fetchMessagesInRange, initialCursor } from '../src/retrieval/bot/fetcher';
import { looksLikeMissingContentIntent, mapApiMessage } from '../src/retrieval/bot/mapper';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function fakeClock() {
  let now = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => now,
    sleep: vi.fn(async (ms: number) => {
      waits.push(ms);
      now += ms;
    }),
    waits,
  };
}

describe('DiscordBotClient', () => {
  it('sends the bot token and Discord user agent, without cookies', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ id: '1' }));
    const client = new DiscordBotClient('abc.def.ghi', { fetch, now: clock.now, sleep: clock.sleep });
    await client.get('/channels/1');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://discord.com/api/v10/channels/1');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bot abc.def.ghi');
    expect((init!.headers as Record<string, string>)['User-Agent']).toMatch(/^DiscordBot \(/);
    expect(init!.credentials).toBe('omit');
  });

  it('waits for retry_after on 429 and then succeeds', async () => {
    const clock = fakeClock();
    const responses = [json({ message: 'You are being rate limited.', retry_after: 2.5, global: false }, 429), json([])];
    const fetch = vi.fn(async () => responses.shift()!);
    const onRateLimit = vi.fn();
    const client = new DiscordBotClient('t.t.t', { fetch, now: clock.now, sleep: clock.sleep, onRateLimit });
    await expect(client.get('/channels/1/messages')).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(clock.waits).toContain(2750);
    expect(onRateLimit).toHaveBeenCalledWith(2750, 'user');
  });

  it('waits when the bucket is exhausted before the next request', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () =>
      json([], 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1.5', 'X-RateLimit-Bucket': 'abc' }),
    );
    const client = new DiscordBotClient('t.t.t', { fetch, now: clock.now, sleep: clock.sleep, minIntervalMs: 0 });
    await client.get('/channels/1/messages');
    await client.get('/channels/1/messages');
    expect(clock.waits.some((ms) => ms >= 1500)).toBe(true);
  });

  it('retries server errors with backoff and gives up eventually', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => json({ message: 'oops' }, 502));
    const client = new DiscordBotClient('t.t.t', { fetch, now: clock.now, sleep: clock.sleep, maxRetries: 2 });
    await expect(client.get('/channels/1')).rejects.toBeInstanceOf(DiscordApiError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('explains permission errors and does not retry them', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => json({ message: 'Missing Access', code: 50001 }, 403));
    const client = new DiscordBotClient('t.t.t', { fetch, now: clock.now, sleep: clock.sleep });
    const error = await client.get('/channels/1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiscordApiError);
    expect((error as DiscordApiError).status).toBe(403);
    expect((error as Error).message).toMatch(/never read your direct messages/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keys rate-limit buckets by major parameter', () => {
    expect(routeKey('GET', '/channels/1/messages/2')).toBe('GET /channels/1/messages/:id');
    expect(routeKey('GET', '/guilds/5/roles')).toBe('GET /guilds/5/roles');
  });
});

function apiMessage(id: string, overrides: Partial<ApiMessage> = {}): ApiMessage {
  return {
    id,
    channel_id: '10',
    type: 0,
    author: { id: '20', username: 'alice', global_name: 'Alice', avatar: 'abc' },
    content: `message ${id}`,
    timestamp: new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString(),
    edited_timestamp: null,
    ...overrides,
  };
}

describe('bot message mapping', () => {
  it('maps content, attachments, reactions, replies and mentions', () => {
    const message = mapApiMessage(
      apiMessage('1300000000000000000', {
        type: 19,
        content: 'hi <@30> **there**',
        mentions: [{ id: '30', username: 'bob', global_name: 'Bob' }],
        attachments: [
          {
            id: '99',
            filename: 'SPOILER_cat.png',
            size: 1234,
            url: 'https://cdn.discordapp.com/attachments/10/99/SPOILER_cat.png?ex=1&is=1&hm=1',
            proxy_url: 'https://media.discordapp.net/attachments/10/99/SPOILER_cat.png?ex=1&is=1&hm=1',
            content_type: 'image/png',
            width: 10,
            height: 20,
          },
        ],
        reactions: [
          { count: 3, emoji: { id: null, name: '👍' } },
          { count: 1, emoji: { id: '77', name: 'pog', animated: true } },
        ],
        message_reference: { message_id: '1299999999999999999', channel_id: '10' },
        referenced_message: apiMessage('1299999999999999999', { content: 'original' }),
        sticker_items: [{ id: '5', name: 'wave', format_type: 3 }],
      }),
    );
    expect(message.author).toMatchObject({ id: '20', name: 'Alice', username: 'alice' });
    expect(message.content).toBe('hi @Bob **there**');
    expect(message.contentMarkdown).toBe('hi <@30> **there**');
    expect(message.attachments[0]).toMatchObject({ id: '99', kind: 'image', size: 1234, spoiler: true });
    expect(message.reactions).toEqual([
      { emoji: '👍', count: 3 },
      { emoji: ':pog:', emojiId: '77', emojiUrl: 'https://cdn.discordapp.com/emojis/77.gif?size=96', count: 1 },
    ]);
    expect(message.reference).toMatchObject({ messageId: '1299999999999999999', authorName: 'Alice', snippet: 'original' });
    expect(message.stickers[0].format).toBe('lottie');
    expect(message.type).toBe('reply');
  });

  it('describes system messages and forwarded snapshots', () => {
    const join = mapApiMessage(apiMessage('1300000000000000001', { type: 7, content: '' }));
    expect(join.system).toBe(true);
    expect(join.content).toBe('Alice joined the server.');

    const forwarded = mapApiMessage(
      apiMessage('1300000000000000002', {
        content: '',
        message_reference: { type: 1, message_id: '5', channel_id: '6' },
        message_snapshots: [{ message: { content: 'forwarded text', attachments: [] } }],
      }),
    );
    expect(forwarded.flags).toContain('forwarded');
    expect(forwarded.content).toBe('forwarded text');
  });

  it('reads text and media from Components V2 messages', () => {
    const message = mapApiMessage(
      apiMessage('1300000000000000003', {
        content: '',
        flags: 1 << 15,
        components: [
          {
            type: 17,
            components: [
              { type: 10, content: 'Hello from components' },
              { type: 12, items: [{ media: { url: 'https://cdn.discordapp.com/attachments/10/123/pic.png?ex=1&is=1&hm=1' } }] },
            ],
          },
        ],
      }),
    );
    expect(message.content).toBe('Hello from components');
    expect(message.attachments.map((a) => a.id)).toEqual(['123']);
  });

  it('detects a missing Message Content intent', () => {
    const empty = Array.from({ length: 12 }, (_, i) => apiMessage(String(1300000000000000100n + BigInt(i)), { content: '' }));
    expect(looksLikeMissingContentIntent(empty)).toBe(true);
    expect(looksLikeMissingContentIntent([...empty.slice(0, 11), apiMessage('1300000000000000200')])).toBe(false);
  });
});

describe('date-range pagination', () => {
  it('pages forward with after=, sorts pages and stops past the end of the range', async () => {
    const start = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2026, 0, 2) - 1;
    const id = (ms: number, seq = 0) => (BigInt(msToSnowflake(ms)) + BigInt(seq)).toString();
    const inRange = Array.from({ length: 150 }, (_, i) => id(start + i * 60_000));
    const after = [id(end + 1000), id(end + 2000)];
    const all = [...inRange, ...after];

    const requests: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      requests.push(u.search);
      const cursor = BigInt(u.searchParams.get('after')!);
      const page = all.filter((m) => BigInt(m) > cursor).slice(0, 100);
      // Discord returns newest first.
      return json(page.reverse().map((m) => apiMessage(m)));
    });
    const clock = fakeClock();
    const client = new DiscordBotClient('t.t.t', { fetch, now: clock.now, sleep: clock.sleep });

    const pages = [];
    for await (const page of fetchMessagesInRange(client, '10', { startMs: start, endMs: end }, undefined, {})) pages.push(page);

    expect(requests[0]).toContain(`after=${initialCursor({ startMs: start })}`);
    expect(requests[0]).toContain('limit=100');
    expect(pages).toHaveLength(2);
    const ids = pages.flatMap((p) => p.messages.map((m) => m.id));
    expect(ids).toEqual(inRange);
    expect(pages[1].finished).toBe(true);
  });
});
