import { describe, expect, it } from 'vitest';
import { csvCell, csvLine } from '../src/export/csv';
import { encodeRelativePath, escapeHtml, safeExternalUrl } from '../src/export/escape';
import { discordMarkdownToText, renderDiscordMarkdown } from '../src/export/markdown';

describe('Discord markdown', () => {
  it('renders inline formatting', () => {
    expect(renderDiscordMarkdown('**bold** *it* __under__ ~~gone~~ ||secret||')).toBe(
      '<strong>bold</strong> <em>it</em> <u>under</u> <s>gone</s> <span class="d-spoiler">secret</span>',
    );
  });

  it('keeps code literal', () => {
    expect(renderDiscordMarkdown('`**not bold**`')).toBe('<code class="d-code">**not bold**</code>');
    expect(renderDiscordMarkdown('```js\nconst a = "<b>";\n```')).toBe(
      '<pre class="d-codeblock" data-lang="js"><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>',
    );
  });

  it('escapes HTML and never emits script or event handlers', () => {
    const html = renderDiscordMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1))');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;');
  });

  it('resolves mentions, emoji and timestamps', () => {
    const html = renderDiscordMarkdown('hi <@123> in <#9> <:wave:55> <t:0:d>', {
      users: { '123': 'Alice' },
      channels: { '9': 'general' },
      emojiSrc: (id) => `../assets/emoji/${id}.png`,
    });
    expect(html).toContain('<span class="d-mention">@Alice</span>');
    expect(html).toContain('<span class="d-mention">#general</span>');
    expect(html).toContain('<img class="d-emoji" data-emoji-id="55" src="../assets/emoji/55.png" alt=":wave:"');
    expect(html).toContain('<time class="d-timestamp" datetime="1970-01-01T00:00:00.000Z"');
  });

  it('links URLs without swallowing punctuation and keeps masked links', () => {
    expect(renderDiscordMarkdown('see https://example.com/a_b.')).toBe(
      'see <a href="https://example.com/a_b" rel="noopener noreferrer" target="_blank">https://example.com/a_b</a>.',
    );
    expect(renderDiscordMarkdown('[docs](https://example.com/x?a=1&b=2)')).toBe(
      '<a href="https://example.com/x?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">docs</a>',
    );
    expect(renderDiscordMarkdown('<https://example.com>')).toContain('href="https://example.com"');
  });

  it('renders blocks: quotes, headings, lists and subtext', () => {
    expect(renderDiscordMarkdown('> quoted\nplain')).toBe('<blockquote class="d-quote">quoted</blockquote>plain');
    expect(renderDiscordMarkdown('# Title')).toBe('<h1 class="d-heading">Title</h1>');
    expect(renderDiscordMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderDiscordMarkdown('-# small')).toBe('<small class="d-subtext">small</small>');
    expect(renderDiscordMarkdown('>>> all\nof this')).toBe('<blockquote class="d-quote">all<br>of this</blockquote>');
  });

  it('converts to readable plain text', () => {
    expect(discordMarkdownToText('<@1> sent <:pog:2> to <@&3>', { users: { '1': 'Bob' }, roles: { '3': 'Mods' } })).toBe(
      '@Bob sent :pog: to @Mods',
    );
  });
});

describe('escaping', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('allows only web links', () => {
    expect(safeExternalUrl('https://example.com/')).toBe('https://example.com/');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,x')).toBeNull();
  });

  it('encodes relative paths segment by segment', () => {
    expect(encodeRelativePath('../attachments/a b#1.png')).toBe('../attachments/a%20b%231.png');
  });
});

describe('CSV', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(undefined)).toBe('');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@everyone')).toBe("'@everyone");
  });

  it('ends rows with CRLF', () => {
    expect(csvLine(['a', 1, null])).toBe('a,1,\r\n');
  });
});
