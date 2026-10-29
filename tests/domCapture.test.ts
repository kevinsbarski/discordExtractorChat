// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureSession, type CaptureView } from '../src/retrieval/dom/captureSession';
import { findMessageList, listItems, parseMessageItem, walkList } from '../src/retrieval/dom/parser';
import { sanitizeContent } from '../src/retrieval/dom/sanitize';
import type { CaptureBatchInput } from '../src/storage/messageStore';
import { BEGINNING_HEADER, CHANNEL_HTML, CHANNEL_ID, IDS, idAtTime } from './fixtures/discordChannel';

const ctx = { channelId: CHANNEL_ID };

function item(id: string): Element {
  const el = document.getElementById(`chat-messages-${CHANNEL_ID}-${id}`);
  if (!el) throw new Error(`fixture item ${id} missing`);
  return el;
}

function parse(id: string) {
  const message = parseMessageItem(item(id), ctx);
  if (!message) throw new Error(`no message parsed for ${id}`);
  return message;
}

beforeEach(() => {
  document.body.innerHTML = CHANNEL_HTML;
});

describe('list walking', () => {
  it('returns messages in display order, through wrappers, with barriers for hidden messages', () => {
    const list = findMessageList(document)!;
    const entries = walkList(list, CHANNEL_ID).map((e) => (e.kind === 'message' ? e.messageId : e.kind));
    expect(entries).toEqual([IDS.first, IDS.continuation, IDS.reply, IDS.join, 'barrier', IDS.media, IDS.forward]);
    expect(listItems(list, CHANNEL_ID)).toHaveLength(6);
  });

  it('recognises the conversation start header', () => {
    const list = findMessageList(document)!;
    list.querySelector('li')!.insertAdjacentHTML('beforebegin', BEGINNING_HEADER);
    expect(walkList(list, CHANNEL_ID)[0]).toEqual({ kind: 'beginning' });
  });
});

describe('DOM parser', () => {
  it('parses a full message: author, content, emoji, code, edit time, attachments and reactions', () => {
    const message = parse(IDS.first);
    expect(message.timestamp).toBe('2026-01-01T10:00:00.000Z');
    expect(message.author).toEqual({
      id: '2000000000000000020',
      name: 'Alice',
      avatarUrl: 'https://cdn.discordapp.com/avatars/2000000000000000020/a1b2c3.webp?size=80',
    });
    expect(message.editedTimestamp).toBe('2026-01-01T10:05:00.000Z');
    expect(message.content).toBe('Hi @Bob, look :wave: bold x < y https://example.com/page 😀secret\nlet a = 1;');
    expect(message.contentHtml).toContain('<span class="d-mention">@Bob</span>');
    expect(message.contentHtml).toContain('<img class="d-emoji" data-emoji-id="555"');
    expect(message.contentHtml).toContain('<code class="d-code">x &lt; y</code>');
    expect(message.contentHtml).toContain('<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">');
    expect(message.contentHtml).toContain('<span class="d-spoiler">secret</span>');
    expect(message.contentHtml).toContain('<pre class="d-codeblock" data-lang="js"><code>let a = 1;</code></pre>');
    expect(message.contentHtml).not.toMatch(/edited|Copy/);
    expect(message.emojis).toEqual([
      { id: '555', name: 'wave', animated: false, url: 'https://cdn.discordapp.com/emojis/555.webp?size=48&quality=lossless' },
    ]);

    expect(message.attachments).toHaveLength(2);
    const [photo, pdf] = message.attachments;
    expect(photo).toMatchObject({ id: '3000000000000000030', filename: 'photo.png', kind: 'image' });
    expect(photo.url.startsWith('https://cdn.discordapp.com/attachments/')).toBe(true);
    expect(photo.fallbackUrls?.[0]).toContain('https://media.discordapp.net/');
    expect(pdf).toMatchObject({ id: '3000000000000000031', filename: 'report final.pdf', kind: 'file', sizeText: '1.25 MB' });
    expect(pdf.size).toBeUndefined();

    expect(message.reactions).toEqual([
      { emoji: '👍', count: 3 },
      { emoji: ':pog:', emojiId: '777', emojiUrl: 'https://cdn.discordapp.com/emojis/777.webp?size=44&animated=true', count: 12 },
    ]);
  });

  it('links continuation messages to the first message of their group and drops hidden separators', () => {
    const message = parse(IDS.continuation);
    expect(message.authorRefId).toBe(IDS.first);
    expect(message.author.name).toBe('');
    expect(message.content).toContain('second line from Alice\nwith a newline');
    expect(message.contentHtml).toContain('<h1>Heading</h1>');
    expect(message.content).not.toContain(',');
  });

  it('parses replies, app tags and embeds, and drops unsafe markup', () => {
    const message = parse(IDS.reply);
    expect(message.author).toMatchObject({ id: '2000000000000000021', name: 'Helper Bot', bot: true });
    expect(message.reference).toEqual({ messageId: IDS.first, authorName: 'Alice', snippet: 'Hi @Bob, look' });
    expect(message.type).toBe('reply');
    expect(message.contentHtml).not.toMatch(/onerror|javascript:|<img src="x"/);
    expect(message.contentHtml).toContain('bad link');
    expect(message.attachments).toEqual([]);
    expect(message.embeds).toEqual([
      {
        title: 'An article',
        url: 'https://example.com/article',
        description: 'Short summary.',
        authorName: 'Writer',
        authorUrl: 'https://example.com/writer',
        providerName: 'Example',
        footerText: 'Footer text',
        fields: [{ name: 'Field', value: 'Value' }],
        imageUrl: 'https://images-ext-1.discordapp.net/external/abc/https/example.com/img.png?width=400&height=200',
        color: '#ff0000',
      },
      {
        type: 'video',
        url: 'https://tenor.com/view/happy-123',
        videoUrl: 'https://media.discordapp.net/external/xyz/https/media.tenor.com/happy.mp4',
      },
    ]);
  });

  it('reads system messages as text', () => {
    const message = parse(IDS.join);
    expect(message.system).toBe(true);
    expect(message.type).toBe('system');
    expect(message.content).toBe('Carol joined the party.');
    expect(message.editedTimestamp).toBeUndefined();
  });

  it('reads videos, voice messages, spoilered images, stickers and attachment-only edits', () => {
    const message = parse(IDS.media);
    expect(message.author).toEqual({ name: 'Dave', avatarUrl: 'https://discord.com/assets/788f05731f8aa02e.png' });
    expect(message.content).toBe('');
    expect(message.flags).toContain('voice-message');
    expect(message.editedTimestamp).toBe('2026-01-01T10:32:00.000Z');
    expect(message.attachments.map((a) => [a.filename, a.kind, Boolean(a.spoiler)])).toEqual([
      ['clip.mp4', 'video', false],
      ['voice-message.ogg', 'audio', false],
      ['SPOILER_cat.png', 'image', true],
    ]);
    expect(message.attachments[2].description).toBe('A cat');
    expect(message.stickers).toEqual([
      { id: '888', name: 'Wave Hello', url: 'https://media.discordapp.net/stickers/888.webp?size=160', format: 'png' },
      { id: '889', name: 'Dance', url: 'https://discord.com/stickers/889.json', format: 'lottie' },
    ]);
  });

  it('reads forwarded snapshots that reuse the message ID', () => {
    const message = parse(IDS.forward);
    expect(message.flags).toContain('forwarded');
    expect(message.content).toBe('forwarded words');
    expect(message.authorRefId).toBe(IDS.media);
    expect(message.attachments.map((a) => a.filename)).toEqual(['fwd.jpg']);
    expect(message.reference).toBeUndefined();
  });

  it('ignores messages of other channels', () => {
    const other = document.getElementById(`chat-messages-9999999999999999999-${IDS.other}`)!;
    expect(parseMessageItem(other, ctx)).toBeNull();
  });

  it('marks unavailable reply targets', () => {
    const context = item(IDS.reply).querySelector(`[id="message-reply-context-${IDS.reply}"]`)!;
    context.innerHTML = '<div class="repliedTextPreview_c19a55"><span class="repliedTextPlaceholder_c19a55">Original message was deleted</span></div>';
    expect(parse(IDS.reply).reference).toEqual({ snippet: 'Original message was deleted', deleted: true });
  });
});

describe('content sanitizer', () => {
  it('keeps only whitelisted markup', () => {
    const el = document.createElement('div');
    el.innerHTML =
      '<span style="color:red" onclick="steal()">hi</span><script>alert(1)</script><iframe src="https://evil"></iframe>' +
      '<a href="https://ok.example" onmouseover="x()">ok</a><a href="data:text/html,x">data</a><pre><code class="hljs"><span>let</span> a</code></pre>';
    const { html, text } = sanitizeContent(el);
    expect(html).toBe(
      'hi<a href="https://ok.example/" target="_blank" rel="noopener noreferrer">ok</a>data<pre class="d-codeblock"><code>let a</code></pre>',
    );
    expect(text).toBe('hiokdatalet a');
  });
});

describe('CaptureSession', () => {
  const range = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 2) - 1 };

  function createSession(url = `https://discord.com/channels/1/${CHANNEL_ID}`) {
    const batches: CaptureBatchInput[] = [];
    const views: CaptureView[] = [];
    let stored = 0;
    const send = vi.fn(async (batch: CaptureBatchInput) => {
      batches.push(batch);
      stored += batch.messages.length;
      return { storedCount: stored, attachmentCount: 0, startReached: false, endReached: false };
    });
    let location = url;
    const session = new CaptureSession({
      jobId: 'job-1',
      channelId: CHANNEL_ID,
      range,
      send,
      onChange: (view) => views.push(view),
      doc: document,
      location: () => location,
      flushDelayMs: 0,
    });
    return { session, batches, views, send, navigate: (next: string) => (location = next) };
  }

  it('captures rendered messages and the pairs that are truly adjacent', async () => {
    const { session, batches } = createSession();
    session.start();
    await session.flushNow();
    session.stop();

    const ids = batches.flatMap((b) => b.messages.map((m) => m.id));
    expect(ids).toEqual([IDS.first, IDS.continuation, IDS.reply, IDS.join, IDS.media, IDS.forward]);
    expect(batches.flatMap((b) => b.pairs)).toEqual([
      [IDS.first, IDS.continuation],
      [IDS.continuation, IDS.reply],
      [IDS.reply, IDS.join],
      [IDS.media, IDS.forward],
    ]);
    const byId = new Map(batches.flatMap((b) => b.messages).map((m) => [m.id, m]));
    expect(byId.get(IDS.continuation)?.author.name).toBe('Alice');
    expect(byId.get(IDS.forward)?.author.name).toBe('Dave');
    expect(batches.some((b) => b.reachedBeginning)).toBe(false);
  });

  it('only sends messages again when they change, and picks up new ones', async () => {
    const { session, batches } = createSession();
    session.start();
    await session.flushNow();
    const sentBefore = batches.flatMap((b) => b.messages).length;

    session.scan();
    await session.flushNow();
    expect(batches.flatMap((b) => b.messages).length).toBe(sentBefore);

    const newer = idAtTime('10:35:00');
    item(IDS.forward).insertAdjacentHTML(
      'afterend',
      `<li id="chat-messages-${CHANNEL_ID}-${newer}"><div role="article" aria-labelledby="message-username-${IDS.media} message-content-${newer}"><div id="message-content-${newer}">late message</div></div></li>`,
    );
    item(IDS.first).querySelector(`[id="message-content-${IDS.first}"] strong`)!.textContent = 'BOLD';

    session.scan();
    await session.flushNow();
    session.stop();
    const later = batches.slice(1).flatMap((b) => b.messages);
    expect(later.map((m) => m.id).sort()).toEqual([IDS.first, newer].sort());
    expect(later.find((m) => m.id === newer)?.author.name).toBe('Dave');
    expect(batches.slice(1).flatMap((b) => b.pairs)).toContainEqual([IDS.forward, newer]);
  });

  it('skips messages outside the date range but uses them for adjacency', async () => {
    const { session, batches } = createSession();
    const before = (BigInt(IDS.first) - 4194304n * 3_600_000n * 11n).toString(); // 2025-12-31
    item(IDS.first).insertAdjacentHTML(
      'beforebegin',
      `<li id="chat-messages-${CHANNEL_ID}-${before}"><div role="article"><div id="message-content-${before}">old</div></div></li>`,
    );
    session.start();
    await session.flushNow();
    session.stop();
    expect(batches.flatMap((b) => b.messages).map((m) => m.id)).not.toContain(before);
    expect(batches.flatMap((b) => b.pairs)).toContainEqual([before, IDS.first]);
  });

  it('reports when the start of the conversation is visible', async () => {
    const { session, batches } = createSession();
    findMessageList(document)!.querySelector('li')!.insertAdjacentHTML('beforebegin', BEGINNING_HEADER);
    session.start();
    await session.flushNow();
    session.stop();
    expect(batches.some((b) => b.reachedBeginning)).toBe(true);
  });

  it('pauses and notices navigation to another conversation', async () => {
    const { session, views, send, navigate } = createSession();
    session.pause();
    session.start();
    await session.flushNow();
    expect(send).not.toHaveBeenCalled();
    expect(views.at(-1)?.state).toBe('paused');

    navigate('https://discord.com/channels/1/123');
    session.resume();
    expect(views.at(-1)?.state).toBe('other-conversation');
    session.stop();
  });

  it('keeps unsent messages and reports an error when storing fails', async () => {
    const { session, views, send } = createSession();
    send.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    session.start();
    await session.flushNow();
    expect(views.at(-1)).toMatchObject({ state: 'error', error: 'Extension context invalidated.' });
    await session.flushNow();
    expect(send).toHaveBeenCalledTimes(2);
    expect(views.at(-1)?.state).toBe('capturing');
    session.stop();
  });
});
