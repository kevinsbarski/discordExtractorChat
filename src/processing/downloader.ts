import { errorMessage, isAbortError, sleep as defaultSleep } from '../core/format';
import { isAttachmentUrlExpired, parseAttachmentUrl } from './discordCdn';

/**
 * Downloads one file into the local cache and validates it: HTTP status,
 * content type (no HTML error pages), declared length and, when known, the
 * exact size Discord reported.
 */

export interface DownloadRequest {
  /** Candidate URLs, best first. */
  urls: string[];
  filename: string;
  /** Exact size in bytes when known (bot API). */
  expectedSize?: number;
  cacheName: string;
}

export type DownloadOutcome =
  | { status: 'done'; bytes: number; contentType?: string; url: string }
  | { status: 'failed' | 'expired' | 'missing'; error: string };

export interface DownloadDeps {
  fetch?: typeof fetch;
  writeFile: (cacheName: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal) => Promise<number>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get('Retry-After');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, seconds * 1000 + 250);
  return Math.min(30_000, 1000 * 2 ** attempt);
}

export async function downloadToCache(
  request: DownloadRequest,
  deps: DownloadDeps,
  signal?: AbortSignal,
): Promise<DownloadOutcome> {
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttempts ?? 4;

  let lastError = '';
  let sawExpired = false;
  let sawMissing = false;

  for (const url of request.urls) {
    signal?.throwIfAborted();
    if (isAttachmentUrlExpired(url, now())) {
      sawExpired = true;
      lastError = 'The download link has expired.';
      continue;
    }
    const isOriginal = parseAttachmentUrl(url)?.host === 'cdn.discordapp.com';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal });
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = `Network error: ${errorMessage(error)}`;
        await sleep(retryDelayMs(null, attempt), signal);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        await response.body?.cancel().catch(() => undefined);
        await sleep(retryDelayMs(response, attempt), signal);
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        sawMissing = true;
        lastError = `The file is no longer available (HTTP ${response.status}).`;
        await response.body?.cancel().catch(() => undefined);
        break;
      }
      if (response.status === 401 || response.status === 403) {
        if (parseAttachmentUrl(url)) sawExpired = true;
        lastError = `Access denied (HTTP ${response.status}); the link may have expired.`;
        await response.body?.cancel().catch(() => undefined);
        break;
      }
      if (!response.ok || !response.body) {
        lastError = `Unexpected response (HTTP ${response.status}).`;
        await response.body?.cancel().catch(() => undefined);
        break;
      }

      const contentType = response.headers.get('Content-Type') ?? undefined;
      if (contentType?.startsWith('text/html') && !/\.html?$/i.test(request.filename)) {
        lastError = 'The server returned a web page instead of the file.';
        await response.body.cancel().catch(() => undefined);
        break;
      }
      const encoded = Boolean(response.headers.get('Content-Encoding'));
      const declaredHeader = response.headers.get('Content-Length');
      const declared = declaredHeader !== null && !encoded ? Number(declaredHeader) : NaN;

      let bytes: number;
      try {
        bytes = await deps.writeFile(request.cacheName, response.body, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = `Download interrupted: ${errorMessage(error)}`;
        await sleep(retryDelayMs(null, attempt), signal);
        continue;
      }

      if (Number.isFinite(declared) && declared > 0 && bytes !== declared) {
        lastError = `Incomplete download (${bytes} of ${declared} bytes).`;
        continue;
      }
      if (isOriginal && request.expectedSize !== undefined && bytes !== request.expectedSize) {
        lastError = `Size mismatch: Discord reported ${request.expectedSize} bytes, received ${bytes}.`;
        continue;
      }
      if (bytes === 0 && request.expectedSize !== 0) {
        lastError = 'The downloaded file is empty.';
        break;
      }
      return { status: 'done', bytes, contentType, url };
    }
  }

  if (sawExpired && !sawMissing) {
    return { status: 'expired', error: lastError || 'The download link has expired.' };
  }
  if (sawMissing) return { status: 'missing', error: lastError };
  return { status: 'failed', error: lastError || 'Download failed.' };
}
