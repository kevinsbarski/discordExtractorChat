import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  // Visible folder (macOS hides dot-folders such as the default .output in file pickers).
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Local Chat Exporter for Discord',
    short_name: 'Chat Exporter',
    description:
      'Export Discord conversations and attachments for a date range to JSON, HTML and CSV. Runs locally and never reads your login token.',
    permissions: [
      // Job state and settings.
      'storage',
      // Large exports keep messages in IndexedDB and downloaded files in the
      // origin-private file system until they are saved.
      'unlimitedStorage',
      // Re-inject the content script into Discord tabs that were open before
      // the extension was installed or updated.
      'scripting',
      // Sets the User-Agent Discord requires on official bot API requests.
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: [
      'https://discord.com/*',
      'https://cdn.discordapp.com/*',
      'https://media.discordapp.net/*',
    ],
    action: {
      default_title: 'Export this Discord conversation',
    },
  },
});
