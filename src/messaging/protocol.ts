import { browser } from 'wxt/browser';
import type { DiscordLocation } from '../core/discordUrl';
import type { ExportJob } from '../jobs/model';
import type { CaptureBatchInput, Gap } from '../storage/messageStore';
import type { NewJobInput } from '../storage/jobStore';

/**
 * Typed messages between the extension's contexts.
 *  - popup / export page / content script  →  background
 *  - popup / export page / background       →  content script (Discord tab)
 */

export type BackgroundRequest =
  | { type: 'job/create'; input: NewJobInput }
  | { type: 'job/get'; jobId?: string }
  | { type: 'job/discard'; jobId: string }
  | { type: 'job/open-export-page'; jobId: string }
  | { type: 'job/gaps'; jobId: string }
  | { type: 'capture/attach'; channelId: string }
  | { type: 'capture/batch'; jobId: string; batch: CaptureBatchInput }
  | { type: 'capture/set-paused'; jobId: string; paused: boolean }
  | { type: 'capture/finish'; jobId: string };

export interface BackgroundResponses {
  'job/create': { job: ExportJob };
  'job/get': { job: ExportJob | null };
  'job/discard': { discarded: true };
  'job/open-export-page': { opened: true };
  'job/gaps': { total: number; gaps: Gap[] };
  'capture/attach': { job: ExportJob | null };
  'capture/batch': { job: ExportJob };
  'capture/set-paused': { job: ExportJob };
  'capture/finish': { job: ExportJob };
}

export interface PageInfo {
  location: DiscordLocation | null;
  title: string;
  channelName?: string;
  guildName?: string;
  captureJobId?: string;
}

export type ContentCommand = 'pause' | 'resume' | 'finish' | 'cancel';

export type ContentRequest =
  | { type: 'content/ping' }
  | { type: 'capture/start'; job: ExportJob }
  | { type: 'capture/command'; jobId: string; command: ContentCommand };

export interface ContentResponses {
  'content/ping': PageInfo;
  'capture/start': { started: true };
  'capture/command': { done: true };
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function sendToBackground<T extends BackgroundRequest>(
  request: T,
): Promise<BackgroundResponses[T['type']]> {
  const reply = (await browser.runtime.sendMessage(request)) as Envelope<BackgroundResponses[T['type']]> | undefined;
  if (!reply) throw new Error('The extension background did not respond.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export async function sendToTab<T extends ContentRequest>(
  tabId: number,
  request: T,
): Promise<ContentResponses[T['type']]> {
  const reply = (await browser.tabs.sendMessage(tabId, request)) as Envelope<ContentResponses[T['type']]> | undefined;
  if (!reply) throw new Error('The Discord tab did not respond.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Wraps an async handler for `runtime.onMessage` (keeps the channel open). */
export function respondWith<T>(
  promise: Promise<T>,
  sendResponse: (response: Envelope<T>) => void,
): true {
  promise.then(
    (data) => sendResponse({ ok: true, data }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
}

/** Background → export pages: "is the page for this job open?" (answered with its tab). */
export interface ExportPagePing {
  type: 'export/ping';
  jobId: string;
}
