# Local Chat Exporter for Discord

A free, local-first Chrome extension that exports a Discord conversation for a date range to **an offline HTML viewer, JSON and CSV**, together with its **attachments**.

- Everything runs in your browser: no server, no account, no LLM, no paid service.
- It **never reads, stores or uses your Discord login token.**
- Built with [WXT](https://wxt.dev), TypeScript and React (Chrome Manifest V3).

It was built as a safer alternative to the "Discord Chat Export Tool" extension analysed in [`reports/Discord Chat Export Tool analysis.md`](reports/Discord%20Chat%20Export%20Tool%20analysis.md), which copies your login token and drives Discord's private API with it.

---

## Quick start

```bash
git clone https://github.com/kevinsbarski/discordExtractorChat.git
cd discordExtractorChat
npm install
npm run build          # creates dist/chrome-mv3
```

Then load it into Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`dist/chrome-mv3`** folder inside the project (the folder that contains `manifest.json`).
4. Pin the extension (puzzle icon → pin) so its icon is always visible.
5. Reload any Discord tabs that were already open.

Requirements: Node.js 22+ and desktop Chrome or Edge (saving uses the File System Access API, which Firefox and Safari don't have).

**After pulling changes:** run `npm run build` again, then click the reload ↻ icon on the extension's card in `chrome://extensions`.

---

## How messages are collected

| Method | What it does | Works for | Limits |
|---|---|---|---|
| **Page capture** (default) | Reads the messages Discord has already shown in your tab while **you** scroll through the date range. Makes no Discord API requests and never scrolls or clicks for you. | Server channels, threads, DMs and group DMs you can open | You scroll through the whole range yourself. Detail is limited to what Discord displays. |
| **Official bot API** (optional) | Fetches the whole range automatically through Discord's documented API, signed in as **a bot you create**, following Discord's rate limits. | Server channels and threads where your bot is a member | Never DMs or group DMs. Someone with *Manage Server* must add the bot. Needs the Message Content intent. |

There is deliberately **no** mode that uses your personal account token and **no** auto-scrolling: Discord treats automating a user account as a self-bot and restricts accounts for it. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#what-is-not-implemented-and-why).

---

## Exporting with page capture

1. Open the conversation in Chrome at `https://discord.com/channels/...` (a server channel, thread, DM or group chat).
2. Click the extension icon. Keep **Capture from this page**, pick the **start and end dates**, choose formats and whether to download attachments, then click **Export — start capturing**.
3. A panel appears in the bottom-right corner of the Discord tab. Scroll through the whole date range:
   - **Easiest:** click **Jump to start date** (opens the conversation at the first message on or after the start date, like opening a message link), then scroll **down** with the mouse or Page Down until the panel says **✓ Reached the end of the range**.
   - **Or:** scroll **up** (Page Up) from today until it says **✓ Reached the start of the range**.
   - **Check gaps** lists places where messages may be missing; scroll through those times again.
   - **Pause / Resume** stops and restarts recording. **Cancel** discards the capture.
4. Click **Finish**. An export page opens and downloads the attachments, showing progress, failures and errors. You can pause, resume, skip remaining downloads or retry failed ones.
5. Click **Save to folder…** (pick e.g. Downloads; a new sub-folder is created) or **Save as ZIP…**.
6. Open **`index.html`** in the saved folder to read the conversation offline.

Tips:

- Scroll at a normal pace; the panel counts messages as they appear.
- If you reload the Discord tab during a capture, the capture continues after the reload.
- The extension icon's popup shows the current export, with buttons to pause, finish, open the progress page or discard it.
- Expand any "N blocked messages — Show" groups if you want those messages included.

## Exporting with the bot API

1. Click the extension icon → **Help & settings**, and follow the steps there:
   - create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its token,
   - enable **Message Content Intent**,
   - add the bot to your server with **View Channels** and **Read Message History**,
   - paste the token and click **Verify & save** (optionally "Remember on this device").
2. Open the server channel or thread in Discord, click the extension icon, choose **Official bot API**, pick the dates and click **Export**.
3. The export page fetches the whole range by itself (pause/resume supported), downloads attachments, and lets you save as above.

---

## What you get

The folder (or ZIP) is named after the conversation and date range:

- server channel: `My Server - general - 2026-01-01 to 2026-01-31`
- DM or group chat: `alice - 2026-01-01 to 2026-01-31`

```
<name>/
├── index.html            overview: counts, completeness notes, gaps, failed files, links to pages
├── html/part-0001.html   conversation pages (1,000 messages each), Discord-like, works offline
├── messages.json         every message with all captured fields (+ raw API objects in bot mode)
├── messages.csv          one row per message, UTF-8 (opens in Excel/Sheets)
├── attachments/          downloaded files with their original names (duplicates get " (2)")
├── assets/               avatars, custom emoji and stickers used by the HTML pages
├── export-report.json    completeness, gaps, download failures, errors
└── README.txt
```

---

## Limitations

- **Page capture only sees what Discord renders.** An export is as complete as your scrolling; the coverage and gap checks show what may be missing but can't guarantee completeness.
- Page capture detail: display names (not always usernames), user IDs only when an avatar is shown, approximate attachment sizes, reaction counts without who reacted, embeds as text, no thread contents (export the thread itself), no collapsed "blocked" messages.
- Conversation names for folder names come from the browser tab title; if one can't be read, an ID is used instead (e.g. `Server 123`).
- **Discord can change its page at any time**, which can break page capture until the parser (`src/retrieval/dom/parser.ts`) is updated. It follows Discord's web client markup as of October 2026 and is tested against fixtures, not the live site.
- Attachment links expire after roughly a day. Downloads start right after you finish capturing; expired files are reported (bot mode refreshes links automatically).
- Keep the export tab open while it downloads or saves. Progress is saved, so reopening it resumes.
- Large exports temporarily use disk space twice (extension storage + where you save) until you click **Discard export**.
- One export at a time; starting a new one discards the previous one.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Open a Discord conversation…" in the popup | The tab must be at `discord.com/channels/…`. Open a channel or DM first. |
| The panel doesn't appear | Reload the Discord tab and start again. |
| Panel shows "Could not save captured messages" | The extension was reloaded or updated; reload the Discord tab. |
| Can't find `dist/chrome-mv3` in the file picker | Run `npm run build` first; it's inside the project folder. |
| Bot export: "cannot read this conversation" | Add the bot to the server and give it View Channel + Read Message History for that channel. |
| Bot export: messages without content | Enable **Message Content Intent** for the bot in the Developer Portal. |

---

## Development

```bash
npm run dev       # development build with hot reload (opens a separate Chrome profile)
npm test          # unit + integration tests (Vitest, fake IndexedDB, happy-dom)
npm run compile   # TypeScript type check
npm run build     # production build → dist/chrome-mv3
npm run check     # compile + test + build
npm run test:e2e  # browser test with the built extension (run npm run build first)
npm run zip       # packaged ZIP of the extension
```

The browser test loads the built extension into Chromium with Playwright and runs both methods end to end against local fixtures; every request is answered locally or blocked, so it never contacts Discord. It needs `npx playwright install chromium`, or set `E2E_CHROME_PATH` to a Chromium / Chrome for Testing binary.

Project layout and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Background research: [`reports/`](reports/) and [`research_notes/`](research_notes/).

Not affiliated with Discord.
