import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ContentRequest } from '../messaging/protocol';
import { ContentController } from '../retrieval/dom/contentController';

/**
 * Runs in the isolated world of discord.com pages. It reads the rendered
 * message list during a capture; it does not touch Discord's own scripts,
 * storage, network traffic or login data.
 */
export default defineContentScript({
  matches: ['https://discord.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const marker = window as unknown as { __localChatExporterLoaded?: boolean };
    if (marker.__localChatExporterLoaded) return;
    marker.__localChatExporterLoaded = true;

    const controller = new ContentController();
    const listener = (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return false;
      const type = String((message as { type: unknown }).type);
      if (type !== 'content/ping' && !type.startsWith('capture/')) return false;
      return controller.handle(message as ContentRequest, sendResponse);
    };
    browser.runtime.onMessage.addListener(listener);
    void controller.attachIfActive();

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(listener);
      controller.dispose();
      marker.__localChatExporterLoaded = false;
    });
  },
});
