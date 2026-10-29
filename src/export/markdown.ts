import { escapeHtml } from './escape';

/**
 * Renders Discord-flavoured markdown (as returned by the bot API) to safe
 * HTML. Input is escaped before any formatting is applied, and every piece of
 * generated markup is swapped out for an opaque token so later rules cannot
 * break it.
 */

export interface MarkdownContext {
  /** User ID → display name. */
  users?: Record<string, string>;
  roles?: Record<string, string>;
  channels?: Record<string, string>;
  /** Returns the `src` for a custom emoji (local copy or CDN URL). */
  emojiSrc?: (id: string, animated: boolean) => string;
}

const TOKEN = '\u0000';
const TOKEN_RE = /\u0000(\d+)\u0000/g;

class TokenStore {
  private readonly items: string[] = [];

  add(html: string): string {
    this.items.push(html);
    return `${TOKEN}${this.items.length - 1}${TOKEN}`;
  }

  restore(text: string): string {
    // Tokens can nest (a token's HTML may contain other tokens).
    let out = text;
    for (let i = 0; i < 5 && out.includes(TOKEN); i++) {
      out = out.replace(TOKEN_RE, (_, index: string) => this.items[Number(index)] ?? '');
    }
    return out;
  }
}

export function formatDiscordTimestamp(seconds: number, style = 'f'): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return String(seconds);
  switch (style) {
    case 't':
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    case 'T':
      return date.toLocaleTimeString();
    case 'd':
      return date.toLocaleDateString();
    case 'D':
      return date.toLocaleDateString(undefined, { dateStyle: 'long' });
    case 'F':
      return date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
    default:
      return date.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  }
}

/** Replaces mention/emoji/timestamp syntax with readable text. */
export function discordMarkdownToText(input: string, ctx: MarkdownContext = {}): string {
  return input
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${ctx.users?.[id] ?? id}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${ctx.roles?.[id] ?? id}`)
    .replace(/<#(\d+)>/g, (_, id: string) => `#${ctx.channels?.[id] ?? id}`)
    .replace(/<a?:([\w~]{1,32}):\d+>/g, (_, name: string) => `:${name}:`)
    .replace(/<\/([\w -]{1,64}):\d+>/g, (_, name: string) => `/${name}`)
    .replace(/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, (_, s: string, style?: string) =>
      formatDiscordTimestamp(Number(s), style ?? 'f'),
    );
}

export function renderDiscordMarkdown(input: string, ctx: MarkdownContext = {}): string {
  if (!input) return '';
  const tokens = new TokenStore();
  let text = input.replace(/\u0000/g, '').replace(/\r\n?/g, '\n');

  // 1. Code blocks and inline code: contents are literal.
  text = text.replace(/```(?:([\w+#.-]{1,24})\n)?([\s\S]*?)```/g, (_, lang: string | undefined, code: string) => {
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    const body = code.replace(/^\n/, '').replace(/\n$/, '');
    return tokens.add(`<pre class="d-codeblock"${langAttr}><code>${escapeHtml(body)}</code></pre>`);
  });
  text = text.replace(/(`{1,2})([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _ticks: string, code: string) =>
    tokens.add(`<code class="d-code">${escapeHtml(code.trim() || code)}</code>`),
  );

  // 2. Backslash escapes keep the next character literal.
  text = text.replace(/\\([*_~`|\\>#\-[\]()<:@])/g, (_, ch: string) => tokens.add(escapeHtml(ch)));

  // 3. Escape everything else.
  text = escapeHtml(text);

  // 4. Inline elements that produce markup become tokens.
  text = renderInlineEntities(text, tokens, ctx);

  // 5. Block structure, then inline formatting per block.
  const html = renderBlocks(text, tokens);
  return tokens.restore(html);
}

function renderInlineEntities(text: string, tokens: TokenStore, ctx: MarkdownContext): string {
  return (
    text
      .replace(/&lt;@!?(\d+)&gt;/g, (_, id: string) =>
        tokens.add(`<span class="d-mention">@${escapeHtml(ctx.users?.[id] ?? id)}</span>`),
      )
      .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id: string) =>
        tokens.add(`<span class="d-mention">@${escapeHtml(ctx.roles?.[id] ?? id)}</span>`),
      )
      .replace(/&lt;#(\d+)&gt;/g, (_, id: string) =>
        tokens.add(`<span class="d-mention">#${escapeHtml(ctx.channels?.[id] ?? id)}</span>`),
      )
      .replace(/&lt;(a?):([\w~]{1,32}):(\d+)&gt;/g, (_, animated: string, name: string, id: string) => {
        const src = ctx.emojiSrc?.(id, animated === 'a') ?? `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=96`;
        return tokens.add(
          `<img class="d-emoji" data-emoji-id="${id}" src="${escapeHtml(src)}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy">`,
        );
      })
      .replace(/&lt;\/([\w -]{1,64}):(\d+)&gt;/g, (_, name: string) =>
        tokens.add(`<span class="d-mention">/${escapeHtml(name)}</span>`),
      )
      .replace(/&lt;t:(-?\d{1,13})(?::([tTdDfFR]))?&gt;/g, (_, s: string, style?: string) => {
        const seconds = Number(s);
        const iso = Number.isFinite(seconds) ? safeIso(seconds * 1000) : '';
        return tokens.add(
          `<time class="d-timestamp" datetime="${iso}" title="${iso}">${escapeHtml(formatDiscordTimestamp(seconds, style ?? 'f'))}</time>`,
        );
      })
      .replace(/(^|[^\w])(@everyone|@here)\b/g, (_, before: string, mention: string) =>
        before + tokens.add(`<span class="d-mention">${mention}</span>`),
      )
      // Masked links: [text](https://...)
      .replace(/\[([^\]\n]{1,256})\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, href: string) =>
        tokens.add(link(href, label)),
      )
      // <https://...> suppresses the embed but is still a link.
      .replace(/&lt;(https?:\/\/(?:(?!&gt;)\S)+)&gt;/g, (_, href: string) => tokens.add(link(href, href)))
      // Bare links; trailing punctuation is not part of the URL.
      .replace(/(^|[^\w/])(https?:\/\/(?:(?!&gt;|&lt;|&quot;|&#39;)\S)+)/g, (_, before: string, raw: string) => {
        let href = raw;
        let trailing = '';
        while (/[.,:;!?)\]]$/.test(href)) {
          if (href.endsWith(')') && count(href, '(') >= count(href, ')')) break;
          trailing = href.slice(-1) + trailing;
          href = href.slice(0, -1);
        }
        return before + tokens.add(link(href, href)) + trailing;
      })
  );
}

function link(href: string, label: string): string {
  return `<a href="${href}" rel="noopener noreferrer" target="_blank">${label}</a>`;
}

function count(value: string, ch: string): number {
  return value.split(ch).length - 1;
}

function safeIso(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function renderInlineFormatting(text: string): string {
  return text
    .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="d-spoiler">$1</span>')
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)([\s\S]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
}

/** Line-based block rendering: headings, subtext, quotes and lists. */
function renderBlocks(text: string, tokens: TokenStore): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(renderInlineFormatting(paragraph.join('<br>')));
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote class="d-quote">${renderBlocks(quote.join('\n'), tokens)}</blockquote>`);
    }
    quote = [];
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${list.items.map((item) => `<li>${renderInlineFormatting(item)}</li>`).join('')}</${tag}>`);
    }
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const multiQuote = /^&gt;&gt;&gt;\s(.*)$/.exec(line) ?? (line === '&gt;&gt;&gt;' ? ['', ''] : null);
    if (multiQuote) {
      flushAll();
      quote = [multiQuote[1], ...lines.slice(i + 1)];
      flushQuote();
      break;
    }

    const quoteLine = /^&gt;\s(.*)$/.exec(line) ?? (line === '&gt;' ? ['', ''] : null);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    flushQuote();

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level} class="d-heading">${renderInlineFormatting(heading[2])}</h${level}>`);
      continue;
    }

    const subtext = /^-#\s+(.+)$/.exec(line);
    if (subtext) {
      flushParagraph();
      flushList();
      out.push(`<small class="d-subtext">${renderInlineFormatting(subtext[1])}</small>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,3}\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushAll();
  return out.join('');
}
