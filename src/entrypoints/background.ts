import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { respondWith, type BackgroundRequest, type BackgroundResponses, type ExportPagePing } from '../messaging/protocol';
import { BOT_USER_AGENT } from '../retrieval/bot/client';
import { createJob, deleteAllJobsExcept, deleteJob, getJob, getLatestJob, updateJob } from '../storage/jobStore';
import { applyCaptureBatch, findGaps } from '../storage/messageStore';

/**
 * Service worker: owns job creation and stores DOM-capture batches. Long
 * work (bot fetching, downloads, saving) runs in the export page instead,
 * because MV3 service workers are stopped when idle.
 */

const USER_AGENT_RULE_ID = 1;

async function installUserAgentRule(): Promise<void> {
  // Discord asks API clients to send "DiscordBot (url, version)". Chrome does
  // not let fetch() set User-Agent, so set it for this extension's own
  // requests to the v10 bot API only (Discord's web client uses v9).
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [USER_AGENT_RULE_ID],
    addRules: [
      {
        id: USER_AGENT_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'User-Agent', operation: 'set', value: BOT_USER_AGENT }],
        },
        condition: {
          urlFilter: '|https://discord.com/api/v10/',
          initiatorDomains: [browser.runtime.id],
          resourceTypes: ['xmlhttprequest'],
        },
      },
    ],
  });
}

/**
 * Focuses the export page of a job if one is open, otherwise opens it.
 * Without the "tabs" permission tab URLs are hidden (even for our own pages),
 * so open export pages are found by asking them directly.
 */
async function openExportPage(jobId: string): Promise<void> {
  try {
    const reply = (await browser.runtime.sendMessage({ type: 'export/ping', jobId } satisfies ExportPagePing)) as
      | { ok: true; data: { tabId?: number; windowId?: number } }
      | undefined;
    const tabId = reply?.ok ? reply.data.tabId : undefined;
    if (tabId !== undefined) {
      await browser.tabs.update(tabId, { active: true });
      if (reply?.ok && reply.data.windowId !== undefined) {
        await browser.windows.update(reply.data.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // No export page is open.
  }
  await browser.tabs.create({ url: `${browser.runtime.getURL('/export.html')}?job=${encodeURIComponent(jobId)}` });
}

async function tabExists(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function handle(request: BackgroundRequest, senderTabId: number | undefined): Promise<BackgroundResponses[BackgroundRequest['type']]> {
  switch (request.type) {
    case 'job/create': {
      // One export at a time: starting a new one discards older jobs.
      await deleteAllJobsExcept();
      const job = await createJob(request.input);
      if (job.method === 'bot') await openExportPage(job.id);
      return { job };
    }
    case 'job/get': {
      const job = request.jobId ? await getJob(request.jobId) : await getLatestJob();
      return { job: job ?? null };
    }
    case 'job/discard':
      await deleteJob(request.jobId);
      return { discarded: true };
    case 'job/open-export-page':
      await openExportPage(request.jobId);
      return { opened: true };
    case 'job/gaps':
      return findGaps(request.jobId, 50);
    case 'capture/attach': {
      const job = await getLatestJob();
      if (!job || job.method !== 'dom' || job.stage !== 'collecting' || senderTabId === undefined) return { job: null };
      if (job.collect.tabId !== senderTabId) {
        // Adopt this tab only if the original capture tab is gone.
        if (await tabExists(job.collect.tabId)) return { job: null };
        if (request.channelId !== job.conversation.channelId) return { job: null };
        const updated = await updateJob(job.id, (j) => {
          j.collect.tabId = senderTabId;
        });
        return { job: updated };
      }
      return { job };
    }
    case 'capture/batch':
      return { job: await applyCaptureBatch(request.jobId, request.batch) };
    case 'capture/set-paused':
      return {
        job: await updateJob(request.jobId, (job) => {
          job.paused = request.paused;
        }),
      };
    case 'capture/finish': {
      const job = await updateJob(request.jobId, (j) => {
        j.collect.done = true;
        j.paused = false;
        j.stage = j.options.downloadAttachments || j.options.downloadAssets ? 'downloading' : 'ready';
      });
      await openExportPage(job.id);
      return { job };
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void installUserAgentRule().catch((error: unknown) => console.warn('User-Agent rule not installed', error));
  });
  browser.runtime.onStartup.addListener(() => {
    void installUserAgentRule().catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;
    const request = message as BackgroundRequest;
    const known = ['job/', 'capture/attach', 'capture/batch', 'capture/set-paused', 'capture/finish'];
    if (!known.some((prefix) => request.type.startsWith(prefix))) return false;
    // Messages from web pages cannot reach this listener (no externally_connectable);
    // still, only accept messages from this extension.
    if (sender.id !== browser.runtime.id) return false;
    return respondWith(handle(request, sender.tab?.id), sendResponse as (response: unknown) => void);
  });
});
