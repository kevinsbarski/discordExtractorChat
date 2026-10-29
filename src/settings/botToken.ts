import { browser } from 'wxt/browser';

/**
 * The optional bot adapter uses a token for a bot the user created in the
 * Discord Developer Portal. By default it is kept in session storage (memory
 * only, cleared when the browser closes, not readable by content scripts);
 * "remember" stores it in local extension storage instead.
 */

const KEY = 'botToken';

export interface StoredBotToken {
  token: string;
  remembered: boolean;
}

/** Accepts a pasted token with or without the "Bot " prefix. */
export function normalizeBotToken(input: string): string {
  return input.trim().replace(/^Bot\s+/i, '').replace(/^["']|["']$/g, '');
}

/** Bot tokens are three base64url segments separated by dots. */
export function looksLikeBotToken(token: string): boolean {
  return /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token);
}

export async function getBotToken(): Promise<StoredBotToken | null> {
  const session = await browser.storage.session.get(KEY);
  if (typeof session[KEY] === 'string' && session[KEY]) return { token: session[KEY] as string, remembered: false };
  const local = await browser.storage.local.get(KEY);
  if (typeof local[KEY] === 'string' && local[KEY]) return { token: local[KEY] as string, remembered: true };
  return null;
}

export async function setBotToken(token: string, remember: boolean): Promise<void> {
  await clearBotToken();
  if (remember) await browser.storage.local.set({ [KEY]: token });
  else await browser.storage.session.set({ [KEY]: token });
}

export async function clearBotToken(): Promise<void> {
  await browser.storage.session.remove(KEY);
  await browser.storage.local.remove(KEY);
}
