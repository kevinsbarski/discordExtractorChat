import { errorMessage, isAbortError, sleep as defaultSleep } from '../../core/format';

/**
 * Minimal client for Discord's official HTTP API, authenticated with a bot
 * token the user created. Requests run one at a time and follow Discord's
 * rate-limit headers; 429 responses wait for `retry_after`.
 * https://discord.com/developers/docs/topics/rate-limits
 */

export const API_BASE = 'https://discord.com/api/v10';
/**
 * Discord asks API clients to identify themselves as
 * `DiscordBot ($url, $versionNumber)`. Replace the URL with the project's
 * homepage if it gets one. Chrome ignores a User-Agent set through fetch(), so
 * the background script also sets it with a declarativeNetRequest rule.
 */
export const BOT_USER_AGENT = 'DiscordBot (chrome-extension://local-chat-exporter, 0.1.0) LocalChatExporter';

/** Stop long before Discord's 10,000 invalid requests per 10 minutes IP ban. */
const INVALID_REQUEST_LIMIT = 50;
const INVALID_REQUEST_WINDOW_MS = 10 * 60 * 1000;

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export interface DiscordClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Retries for 429, 5xx and network errors. */
  maxRetries?: number;
  /** Minimum spacing between requests (politeness), in ms. */
  minIntervalMs?: number;
  onRateLimit?: (waitMs: number, scope: string) => void;
  onRequest?: () => void;
}

interface BucketState {
  remaining: number;
  resetAt: number;
}

type QueryValue = string | number | boolean | undefined;

/** Bucket key: major parameters (channel/guild/webhook IDs) are kept, other IDs are not. */
export function routeKey(method: string, path: string): string {
  const segments = path.split('/');
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const previous = segments[i - 1];
    const isMajor = previous === 'channels' || previous === 'guilds' || previous === 'webhooks';
    out.push(/^\d+$/.test(segment) && !isMajor ? ':id' : segment);
  }
  return `${method} ${out.join('/')}`;
}

export function describeApiError(status: number, body: { code?: number; message?: string } | undefined): string {
  const detail = body?.message ? ` (${body.message}${body.code ? `, code ${body.code}` : ''})` : '';
  switch (status) {
    case 401:
      return `Discord rejected the bot token${detail}. Check the token in the extension options.`;
    case 403:
      return `The bot cannot read this conversation${detail}. It needs to be a member of the server with the View Channel and Read Message History permissions; bots can never read your direct messages.`;
    case 404:
      return `Discord could not find this conversation${detail}. It may have been deleted, or the bot cannot see it.`;
    default:
      return `Discord API error ${status}${detail}.`;
  }
}

export class DiscordBotClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;
  private readonly buckets = new Map<string, BucketState>();
  private globalResetAt = 0;
  private lastRequestAt = 0;
  private invalidRequests: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly options: DiscordClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 5;
    this.minIntervalMs = options.minIntervalMs ?? 100;
  }

  /** GET request; calls are serialized so only one request is in flight. */
  get<T>(path: string, query: Record<string, QueryValue> = {}, signal?: AbortSignal): Promise<T> {
    const run = () => this.request<T>(path, query, signal);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async request<T>(path: string, query: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    const url = new URL(API_BASE + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const route = routeKey('GET', path);

    for (let attempt = 0; ; attempt++) {
      await this.waitForTurn(route, signal);
      this.options.onRequest?.();
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bot ${this.token}`, 'User-Agent': BOT_USER_AGENT },
          credentials: 'omit',
          cache: 'no-store',
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (attempt >= this.maxRetries) {
          throw new DiscordApiError(0, undefined, `Could not reach Discord: ${errorMessage(error)}`);
        }
        await this.sleep(backoffMs(attempt), signal);
        continue;
      } finally {
        this.lastRequestAt = this.now();
      }

      this.updateBucket(route, response.headers);

      if (response.status === 429) {
        const body = (await response.json().catch(() => ({}))) as { retry_after?: number; global?: boolean; code?: number };
        const scope = response.headers.get('X-RateLimit-Scope') ?? (body.global ? 'global' : 'user');
        if (scope !== 'shared') this.noteInvalidRequest();
        const retryAfterSeconds = Number(body.retry_after ?? response.headers.get('Retry-After') ?? 1);
        const waitMs = Math.ceil((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000) + 250;
        if (body.global) this.globalResetAt = this.now() + waitMs;
        else this.buckets.set(route, { remaining: 0, resetAt: this.now() + waitMs });
        this.options.onRateLimit?.(waitMs, scope);
        if (attempt >= this.maxRetries) {
          throw new DiscordApiError(429, body.code, 'Discord kept rate limiting the requests; try again later.');
        }
        await this.sleep(waitMs, signal);
        continue;
      }

      if (response.status >= 500 && attempt < this.maxRetries) {
        await this.sleep(backoffMs(attempt), signal);
        continue;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as { code?: number; message?: string } | undefined;
        if (response.status === 401 || response.status === 403) this.noteInvalidRequest();
        throw new DiscordApiError(response.status, body?.code, describeApiError(response.status, body));
      }
      return (await response.json()) as T;
    }
  }

  private async waitForTurn(route: string, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.now();
      const bucket = this.buckets.get(route);
      const waits = [
        this.globalResetAt - now,
        bucket && bucket.remaining <= 0 ? bucket.resetAt - now : 0,
        this.lastRequestAt + this.minIntervalMs - now,
      ];
      const waitMs = Math.max(...waits);
      if (waitMs <= 0) return;
      if (waitMs > this.minIntervalMs) this.options.onRateLimit?.(waitMs, 'bucket');
      await this.sleep(waitMs, signal);
      if (bucket && this.now() >= bucket.resetAt) this.buckets.delete(route);
    }
  }

  private updateBucket(route: string, headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    const resetAfter = headers.get('X-RateLimit-Reset-After');
    if (remaining === null || resetAfter === null) return;
    const remainingCount = Number(remaining);
    const resetAfterMs = Number(resetAfter) * 1000;
    if (!Number.isFinite(remainingCount) || !Number.isFinite(resetAfterMs)) return;
    this.buckets.set(route, { remaining: remainingCount, resetAt: this.now() + resetAfterMs });
  }

  private noteInvalidRequest(): void {
    const now = this.now();
    this.invalidRequests = this.invalidRequests.filter((at) => now - at < INVALID_REQUEST_WINDOW_MS);
    this.invalidRequests.push(now);
    if (this.invalidRequests.length > INVALID_REQUEST_LIMIT) {
      throw new DiscordApiError(
        0,
        undefined,
        'Stopped after too many rejected requests, to stay far away from Discord’s invalid-request limit. Wait 10 minutes before retrying.',
      );
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
