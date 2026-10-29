/**
 * Loads the built extension into Chromium and runs a page-capture export
 * end to end: content script → background → IndexedDB → export page →
 * downloads → save to a folder and to a ZIP.
 *
 * Nothing reaches the network: Discord pages and CDN files are answered by
 * local fixtures, every other request is aborted, and DNS is disabled.
 *
 * Run: npm run build && npm run test:e2e
 * (set E2E_CHROME_PATH to use a specific Chromium / Chrome for Testing build)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { msToSnowflake } from '../../src/core/snowflake';
import { CHANNEL_HTML, CHANNEL_ID, IDS } from '../fixtures/discordChannel';

const EXTENSION_PATH = path.resolve('dist/chrome-mv3');
const FUTURE_EX = Math.floor(Date.now() / 1000 + 6 * 3600).toString(16);
const DISCORD_URL = `https://discord.com/channels/1/${CHANNEL_ID}`;
const RANGE_START = Date.UTC(2026, 0, 1);
const RANGE_END = Date.UTC(2026, 0, 2) - 1;

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>#general | Test Server - Discord</title></head><body>${body}</body></html>`;

const BOT_TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAx.GabcDe.abcdefghijklmnopqrstuvwxyz0123';
/** 150 messages on 2026-01-01 (every 5 minutes) and 2 on the next day. */
const BOT_MESSAGE_IDS = [
  ...Array.from({ length: 150 }, (_, i) => msToSnowflake(RANGE_START + i * 5 * 60_000 + 1000)),
  msToSnowflake(RANGE_END + 3_600_000),
  msToSnowflake(RANGE_END + 7_200_000),
];
const botRequests: { path: string; headers: Record<string, string> }[] = [];
let botRateLimited = false;

function apiMessage(id: string, index: number) {
  return {
    id,
    channel_id: CHANNEL_ID,
    type: 0,
    author: { id: '20', username: 'alice', global_name: 'Alice', avatar: 'abc' },
    content: index % 10 === 0 ? `**update ${index}** for <@30>` : `message ${index}`,
    mentions: index % 10 === 0 ? [{ id: '30', username: 'bob', global_name: 'Bob' }] : [],
    timestamp: new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString(),
    edited_timestamp: null,
    attachments:
      index % 50 === 0
        ? [{ id: `90${index}`, filename: `chart-${index}.png`, size: `fixture:/attachments/${CHANNEL_ID}/90${index}/chart-${index}.png`.length, url: `https://cdn.discordapp.com/attachments/${CHANNEL_ID}/90${index}/chart-${index}.png?ex=${FUTURE_EX}&is=1&hm=1`, content_type: 'image/png' }]
        : [],
    reactions: index === 1 ? [{ count: 2, emoji: { id: null, name: '🎉' } }] : [],
  };
}

async function botApi(route: import('playwright').Route) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace('/api/v10', '');
  botRequests.push({ path: `${path}${url.search}`, headers: await request.allHeaders() });
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  if (request.headers()['authorization'] !== `Bot ${BOT_TOKEN}`) return json({ message: '401: Unauthorized', code: 0 }, 401);
  if (path === '/users/@me') return json({ id: '1', username: 'exporter-bot', bot: true });
  if (path === `/channels/${CHANNEL_ID}`) return json({ id: CHANNEL_ID, type: 0, name: 'general', guild_id: '1' });
  if (path === '/guilds/1') return json({ id: '1', name: 'Test Server' });
  if (path === '/guilds/1/roles') return json([{ id: '1', name: '@everyone' }]);
  if (path === '/guilds/1/channels') return json([{ id: CHANNEL_ID, type: 0, name: 'general' }]);
  if (path === `/channels/${CHANNEL_ID}/messages`) {
    // The second page is rate limited once, to exercise retry_after handling.
    if (!botRateLimited && url.searchParams.get('after') !== BOT_FIRST_CURSOR) {
      botRateLimited = true;
      return json({ message: 'You are being rate limited.', retry_after: 0.3, global: false }, 429, { 'X-RateLimit-Scope': 'user' });
    }
    const after = BigInt(url.searchParams.get('after') ?? '0');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const page = BOT_MESSAGE_IDS.map((id, i) => ({ id, i })).filter(({ id }) => BigInt(id) > after).slice(0, limit);
    return json(
      page.reverse().map(({ id, i }) => apiMessage(id, i)),
      200,
      { 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': '4', 'X-RateLimit-Reset-After': '1', 'X-RateLimit-Bucket': 'msgs' },
    );
  }
  return json({ message: 'Unknown', code: 0 }, 404);
}

const BOT_FIRST_CURSOR = (BigInt(msToSnowflake(RANGE_START)) - 1n).toString();

let context: BrowserContext;
let profileDir: string;
let extensionId: string;
const apiRequests: string[] = [];
const cdnRequests: string[] = [];

/** Runs `fn` in an extension page (has the `chrome` API). */
async function inExtension<T>(fn: string): Promise<T> {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/options.html`);
  try {
    return (await ext.evaluate(fn)) as T;
  } finally {
    await ext.close();
  }
}

async function getJob(jobId: string): Promise<any> {
  const reply = await inExtension<any>(`chrome.runtime.sendMessage({ type: 'job/get', jobId: ${JSON.stringify(jobId)} })`);
  return reply.data.job;
}

async function waitFor<T>(probe: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`Timed out; last value: ${JSON.stringify(value)?.slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  profileDir = mkdtempSync(path.join(tmpdir(), 'lce-e2e-'));
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: process.env.E2E_CHROME_PATH || undefined,
    headless: false,
    timezoneId: 'UTC',
    args: [
      '--headless=new',
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      // Safety net: nothing can resolve, so nothing un-intercepted leaves the machine.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.hostname === 'discord.com' && url.pathname.startsWith('/api/')) {
      apiRequests.push(url.toString());
      if (url.pathname.startsWith('/api/v10/')) return botApi(route);
      return route.abort();
    }
    if (url.hostname === 'discord.com' && url.pathname.startsWith('/channels/')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: page(CHANNEL_HTML.replaceAll('ex=6a0b1c2d', `ex=${FUTURE_EX}`)) });
    }
    if (['cdn.discordapp.com', 'media.discordapp.net', 'discord.com'].includes(url.hostname)) {
      cdnRequests.push(url.toString());
      if (url.pathname.includes('report%20final.pdf')) return route.fulfill({ status: 404, body: 'Not found' });
      const ext = url.pathname.split('.').pop() ?? '';
      const type = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', mp4: 'video/mp4', ogg: 'audio/ogg', svg: 'image/svg+xml' }[ext] ?? 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: type, body: Buffer.from(`fixture:${url.pathname}`) });
    }
    return route.abort();
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});

afterAll(async () => {
  await context?.close();
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
});

describe('extension in Chromium', () => {
  let discord: Page;
  let jobId: string;

  it('installs the bot User-Agent rule for its own v10 API requests only', async () => {
    const rules = await inExtension<any[]>('chrome.declarativeNetRequest.getDynamicRules()');
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.urlFilter).toBe('|https://discord.com/api/v10/');
    expect(rules[0].action.requestHeaders[0].header.toLowerCase()).toBe('user-agent');
    expect(rules[0].action.requestHeaders[0].value).toMatch(/^DiscordBot \(/);

    // Chrome's own matcher (unpacked extensions only): the rule applies to this
    // extension's requests and never to Discord's web client traffic.
    const outcome = await inExtension<Record<string, any>>(`(async () => {
      const tab = await chrome.tabs.getCurrent();
      const base = { url: 'https://discord.com/api/v10/channels/1/messages?limit=100', method: 'get', type: 'xmlhttprequest', tabId: tab.id };
      return {
        extension: await chrome.declarativeNetRequest.testMatchOutcome({ ...base, initiator: 'chrome-extension://' + chrome.runtime.id }),
        discordV9: await chrome.declarativeNetRequest.testMatchOutcome({ ...base, url: 'https://discord.com/api/v9/channels/1/messages', initiator: 'https://discord.com' }),
        discordV10: await chrome.declarativeNetRequest.testMatchOutcome({ ...base, initiator: 'https://discord.com' }),
      };
    })()`);
    expect(outcome.extension.matchedRules.map((r: any) => r.ruleId)).toEqual([1]);
    expect(outcome.discordV9.matchedRules).toEqual([]);
    expect(outcome.discordV10.matchedRules).toEqual([]);
  });

  it('answers from the Discord tab and starts a capture', async () => {
    discord = await context.newPage();
    await discord.goto(DISCORD_URL);
    const info = await waitFor(
      () =>
        inExtension<any>(`(async () => {
          const [tab] = await chrome.tabs.query({ url: 'https://discord.com/*' });
          try { return { tabId: tab.id, reply: await chrome.tabs.sendMessage(tab.id, { type: 'content/ping' }) }; }
          catch (e) { return { tabId: tab.id, error: String(e) }; }
        })()`),
      (v) => Boolean(v.reply?.ok),
    );
    expect(info.reply.data).toMatchObject({
      location: { guildId: '1', channelId: CHANNEL_ID },
      channelName: '#general',
      guildName: 'Test Server',
    });

    const input = {
      method: 'dom',
      tabId: info.tabId,
      conversation: { guildId: '1', channelId: CHANNEL_ID, channelName: '#general', guildName: 'Test Server', url: DISCORD_URL },
      range: { startMs: RANGE_START, endMs: RANGE_END, startDate: '2026-01-01', endDate: '2026-01-01', timeZone: 'UTC' },
      options: { formats: { json: true, html: true, csv: true }, downloadAttachments: true, downloadAssets: true, messagesPerHtmlPart: 1000 },
    };
    const started = await inExtension<any>(`(async () => {
      const created = await chrome.runtime.sendMessage({ type: 'job/create', input: ${JSON.stringify(input)} });
      const reply = await chrome.tabs.sendMessage(${info.tabId}, { type: 'capture/start', job: created.data.job });
      return { created, reply };
    })()`);
    expect(started.reply.ok).toBe(true);
    jobId = started.created.data.job.id;

    await discord.waitForSelector('local-chat-exporter-panel', { state: 'attached' });
    const job = await waitFor(() => getJob(jobId), (j) => j?.collect.messageCount === 6);
    expect(job.collect.attachmentCount).toBe(6);
  });

  it('records coverage when the user scrolls past both ends of the range', async () => {
    const older = (BigInt(IDS.first) - 4194304n * 3_600_000n * 11n).toString();
    const newer = (BigInt(IDS.first) + 4194304n * 3_600_000n * 15n).toString();
    await discord.evaluate(
      ([c, first, forward, before, after]) => {
        document.getElementById(`chat-messages-${c}-${first}`)!.insertAdjacentHTML(
          'beforebegin',
          `<li id="chat-messages-${c}-${before}"><div role="article" aria-labelledby="message-username-${before} message-content-${before}"><span id="message-username-${before}"><span data-text="Eve">Eve</span></span><div id="message-content-${before}">yesterday</div></div></li>`,
        );
        document.getElementById(`chat-messages-${c}-${forward}`)!.insertAdjacentHTML(
          'afterend',
          `<li id="chat-messages-${c}-${after}"><div role="article" aria-labelledby="message-username-${after} message-content-${after}"><span id="message-username-${after}"><span data-text="Eve">Eve</span></span><div id="message-content-${after}">tomorrow</div></div></li>`,
        );
      },
      [CHANNEL_ID, IDS.first, IDS.forward, older, newer],
    );
    const job = await waitFor(() => getJob(jobId), (j) => j.collect.startReached && j.collect.endReached);
    expect(job.collect.messageCount).toBe(6);

    const gaps = await inExtension<any>(`chrome.runtime.sendMessage({ type: 'job/gaps', jobId: '${jobId}' })`);
    expect(gaps.data.total).toBe(1); // the collapsed blocked-message group
  });

  it('finishes, downloads and validates files in the export page', async () => {
    const exportPagePromise = context.waitForEvent('page', (p) => p.url().includes('/export.html'));
    const reply = await inExtension<any>(`(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://discord.com/*' });
      return chrome.tabs.sendMessage(tab.id, { type: 'capture/command', jobId: '${jobId}', command: 'finish' });
    })()`);
    expect(reply.ok).toBe(true);
    const exportPage = await exportPagePromise;
    await exportPage.waitForLoadState();

    const job = await waitFor(() => getJob(jobId), (j) => j.stage === 'ready', 60_000);
    expect(job.download).toMatchObject({ total: 12, done: 11, failed: 1 });
    await exportPage.getByText('1 file not downloaded').waitFor();
    expect(apiRequests).toEqual([]);
    expect(cdnRequests.some((u) => u.includes('/attachments/'))).toBe(true);
    expect(await discord.$('local-chat-exporter-panel')).toBeNull();

    // "Open progress" focuses the existing export tab instead of opening another one.
    const exportTabs = () => context.pages().filter((p) => p.url().includes('/export.html')).length;
    const before = exportTabs();
    expect(before).toBe(1);
    await inExtension(`chrome.runtime.sendMessage({ type: 'job/open-export-page', jobId: '${jobId}' })`);
    await new Promise((r) => setTimeout(r, 1000)); // give a wrongly opened tab time to appear
    expect(exportTabs()).toBe(before);
  });

  it('saves to a folder and to a ZIP from the export page', async () => {
    const exportPage = context.pages().find((p) => p.url().includes('/export.html'))!;
    // Stand-ins for the native pickers: hand out folders/files in the private file system.
    await exportPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = await root.getDirectoryHandle('e2e-out', { create: true });
      (window as any).showDirectoryPicker = async () => out;
      (window as any).showSaveFilePicker = async () => out.getFileHandle('export.zip', { create: true });
    });

    await exportPage.getByRole('button', { name: 'Save to folder…' }).click();
    await exportPage.getByText(/Saved \d+ files/).waitFor({ timeout: 30_000 });

    const saved = await exportPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = await root.getDirectoryHandle('e2e-out');
      const list = async (dir: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> => {
        const names: string[] = [];
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'directory') names.push(...(await list(handle, `${prefix}${name}/`)));
          else names.push(`${prefix}${name}`);
        }
        return names;
      };
      const files = (await list(out)).sort();
      const folder = files[0].split('/')[0];
      const read = async (rel: string) => {
        let dir = await out.getDirectoryHandle(folder);
        const parts = rel.split('/');
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
      };
      return {
        files,
        json: await read('messages.json'),
        html: await read('html/part-0001.html'),
        index: await read('index.html'),
        photo: await read('attachments/photo.png'),
      };
    });

    const folder = 'Test Server - general - 2026-01-01';
    expect(saved.files).toEqual(
      expect.arrayContaining([
        `${folder}/index.html`,
        `${folder}/html/part-0001.html`,
        `${folder}/messages.json`,
        `${folder}/messages.csv`,
        `${folder}/export-report.json`,
        `${folder}/README.txt`,
        `${folder}/attachments/photo.png`,
        `${folder}/attachments/clip.mp4`,
        `${folder}/attachments/SPOILER_cat.png`,
        `${folder}/attachments/fwd.jpg`,
        `${folder}/attachments/voice-message.ogg`,
      ]),
    );
    expect(saved.files).not.toContain(`${folder}/attachments/report final.pdf`);
    const json = JSON.parse(saved.json);
    expect(json.messages.map((m: any) => m.author.name)).toEqual(['Alice', 'Alice', 'Helper Bot', '', 'Dave', 'Dave']);
    expect(json.completeness).toMatchObject({ startReached: true, endReached: true, possibleGaps: 1 });
    expect(saved.html).toContain('src="../attachments/photo.png"');
    expect(saved.html).toContain('Carol joined the party.');
    expect(saved.index).toContain('report final.pdf');
    expect(saved.photo).toContain('fixture:/attachments/');

    await exportPage.getByRole('button', { name: 'Save as ZIP…' }).click();
    await waitFor(
      () => exportPage.evaluate(() => document.body.innerText),
      (text) => (text.match(/ZIP “export.zip”/g) ?? []).length === 1,
    );
    const zipBytes = await exportPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = await root.getDirectoryHandle('e2e-out');
      const file = await (await out.getFileHandle('export.zip')).getFile();
      return Array.from(new Uint8Array(await file.arrayBuffer()));
    });
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(zipBytes)));
    const entries = await reader.getEntries();
    expect(entries.map((e) => e.filename)).toEqual(expect.arrayContaining(['index.html', 'messages.json', 'attachments/photo.png']));
    const jsonEntry = entries.find((e) => e.filename === 'messages.json')!;
    if (jsonEntry.directory) throw new Error('unexpected directory');
    expect(JSON.parse(await jsonEntry.getData(new TextWriter())).messages).toHaveLength(6);
    await reader.close();
  });

  it('shows the current export in the popup', async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByText('Current export').waitFor();
    await popup.getByText('Ready to save').waitFor();
    await popup.close();
  });
});

describe('official bot API adapter in Chromium', () => {
  it('verifies and stores a bot token from the options page', async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByPlaceholder('Bot token').fill(`Bot ${BOT_TOKEN}`);
    await options.getByRole('button', { name: 'Verify & save' }).click();
    await options.getByText('Connected as exporter-bot.').waitFor();
    const me = botRequests.find((r) => r.path === '/users/@me')!;
    expect(me.headers.authorization).toBe(`Bot ${BOT_TOKEN}`);
    await options.close();
  });

  it('fetches a date range with pagination and rate-limit retries, then downloads', async () => {
    const input = {
      method: 'bot',
      conversation: { guildId: '1', channelId: CHANNEL_ID, url: DISCORD_URL },
      range: { startMs: RANGE_START, endMs: RANGE_END, startDate: '2026-01-01', endDate: '2026-01-01', timeZone: 'UTC' },
      options: { formats: { json: true, html: true, csv: true }, downloadAttachments: true, downloadAssets: false, messagesPerHtmlPart: 1000 },
    };
    const exportPagePromise = context.waitForEvent('page', (p) => p.url().includes('/export.html'));
    const created = await inExtension<any>(`chrome.runtime.sendMessage({ type: 'job/create', input: ${JSON.stringify(input)} })`);
    const jobId = created.data.job.id;
    const exportPage = await exportPagePromise;

    const job = await waitFor(() => getJob(jobId), (j) => j?.stage === 'ready', 60_000);
    expect(job.collect).toMatchObject({ messageCount: 150, attachmentCount: 3, done: true, startReached: true, endReached: true });
    expect(job.conversation).toMatchObject({ channelName: '#general', guildName: 'Test Server' });
    expect(job.download).toMatchObject({ total: 3, done: 3, failed: 0 });
    expect(botRateLimited).toBe(true);

    const pages = botRequests.filter((r) => r.path.startsWith(`/channels/${CHANNEL_ID}/messages`));
    expect(pages[0].path).toContain(`after=${BOT_FIRST_CURSOR}`);
    expect(pages[0].path).toContain('limit=100');
    expect(pages.every((p) => p.headers.authorization === `Bot ${BOT_TOKEN}`)).toBe(true);
    expect(pages.every((p) => !('cookie' in p.headers))).toBe(true);

    await exportPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = await root.getDirectoryHandle('e2e-bot', { create: true });
      (window as any).showDirectoryPicker = async () => out;
    });
    await exportPage.getByRole('button', { name: 'Save to folder…' }).click();
    await exportPage.getByText(/Saved \d+ files/).waitFor({ timeout: 30_000 });
    const json = await exportPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out = await root.getDirectoryHandle('e2e-bot');
      for await (const [name, handle] of (out as any).entries()) {
        if (handle.kind !== 'directory') continue;
        const file = await (await (handle as FileSystemDirectoryHandle).getFileHandle('messages.json')).getFile();
        return { folder: name, text: await file.text() };
      }
      return null;
    });
    const parsed = JSON.parse(json!.text);
    expect(json!.folder).toBe('Test Server - general - 2026-01-01');
    expect(parsed.method).toBe('bot-api');
    expect(parsed.messages).toHaveLength(150);
    expect(parsed.messages[0]).toMatchObject({ content: '**update 0** for @Bob', contentMarkdown: '**update 0** for <@30>' });
    expect(parsed.messages[0].raw.id).toBe(BOT_MESSAGE_IDS[0]);
    expect(parsed.messages[1].reactions).toEqual([{ emoji: '🎉', count: 2 }]);
  });
});
