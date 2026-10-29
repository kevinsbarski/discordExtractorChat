import type { ExportEmoji } from '../../core/types';
import { escapeHtml, safeExternalUrl } from '../../export/escape';
import { customEmojiUrl } from '../../processing/discordCdn';

/**
 * Converts the rendered content of a Discord message into
 *  - `html`: a small, safe subset of HTML (no attributes from the page except
 *    vetted links and emoji sources, no scripts, no inline styles), and
 *  - `text`: plain text with mentions and emoji as Discord shows them.
 * The page's hashed class names are mapped onto stable `d-*` classes.
 */

export interface SanitizedContent {
  html: string;
  text: string;
  emojis: ExportEmoji[];
}

const CUSTOM_EMOJI_SRC_RE = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/emojis\/(\d+)\.(\w+)/;

const SIMPLE_TAGS: Record<string, string> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  U: 'u',
  S: 's',
  DEL: 's',
  STRIKE: 's',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
  P: 'p',
};

function classOf(el: Element): string {
  const value = el.getAttribute('class');
  return value ? value.toLowerCase() : '';
}

/** Elements that are part of the message chrome rather than its content. */
function isChrome(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (['SCRIPT', 'STYLE', 'TEMPLATE', 'BUTTON', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS'].includes(tag)) return true;
  // The "(edited)" marker is a <time> inside the content; <t:…> timestamps are spans.
  if (tag === 'TIME') return true;
  const cls = classOf(el);
  if (cls.includes('edited')) return true;
  // Screen-reader-only separators add stray commas to headings and lists.
  if (cls.includes('hiddenvisually')) return true;
  if (tag === 'I' && el.getAttribute('aria-hidden') === 'true') return true;
  // Code block toolbar (copy button).
  if (cls.includes('codeactions')) return true;
  return false;
}

export function sanitizeContent(root: Element): SanitizedContent {
  const emojis: ExportEmoji[] = [];
  let text = '';

  const walk = (node: Node): string => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const value = node.nodeValue ?? '';
      text += value;
      return escapeHtml(value);
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return '';
    const el = node as Element;
    if (isChrome(el)) return '';
    const tag = el.tagName.toUpperCase();
    const cls = classOf(el);
    const children = () => Array.from(el.childNodes).map(walk).join('');

    if (tag === 'BR') {
      text += '\n';
      return '<br>';
    }

    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? '';
      const fromSrc = CUSTOM_EMOJI_SRC_RE.exec(src);
      const dataId = el.getAttribute('data-id');
      const customId = fromSrc?.[1] ?? (dataId && /^\d+$/.test(dataId) ? dataId : undefined);
      if (customId) {
        const name = alt.replace(/^:|:$/g, '') || el.getAttribute('data-name')?.replace(/^:|:$/g, '') || 'emoji';
        const animated = fromSrc?.[2] === 'gif' || /[?&]animated=true/.test(src);
        const url = fromSrc ? src : customEmojiUrl(customId, animated);
        if (!emojis.some((e) => e.id === customId)) emojis.push({ id: customId, name, animated, url });
        text += `:${name}:`;
        return `<img class="d-emoji" data-emoji-id="${customId}" src="${escapeHtml(url)}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:">`;
      }
      // Unicode emoji are drawn as images; keep the character itself.
      text += alt;
      return escapeHtml(alt);
    }

    if (tag === 'A') {
      const href = safeExternalUrl(el.getAttribute('href'));
      const inner = children();
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
    }

    if (tag === 'PRE') {
      const codeEl = el.querySelector('code') ?? el;
      const code = codeEl.textContent ?? '';
      const lang = /(?:^|\s)language-([\w+#.-]{1,24})/.exec(codeEl.getAttribute('class') ?? '')?.[1];
      text += code;
      return `<pre class="d-codeblock"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(code)}</code></pre>`;
    }

    if (tag === 'CODE') {
      const code = el.textContent ?? '';
      text += code;
      return `<code class="d-code">${escapeHtml(code)}</code>`;
    }

    if (tag === 'BLOCKQUOTE') return `<blockquote class="d-quote">${children()}</blockquote>`;
    if (tag === 'SMALL') return `<small class="d-subtext">${children()}</small>`;

    if (cls.includes('mention')) return `<span class="d-mention">${children()}</span>`;
    // Spoilers: literal class "obscured" (text stays in the DOM while hidden).
    if (cls.includes('spoiler') || /(^|\s)obscured/.test(cls)) {
      // Discord nests several spoiler wrappers; emit one.
      const inner = children();
      return inner.startsWith('<span class="d-spoiler">') ? inner : `<span class="d-spoiler">${inner}</span>`;
    }

    const simple = SIMPLE_TAGS[tag];
    if (simple) return `<${simple}>${children()}</${simple}>`;

    return children();
  };

  const html = Array.from(root.childNodes).map(walk).join('');
  return { html, text: text.replace(/​/g, '').trim(), emojis };
}
