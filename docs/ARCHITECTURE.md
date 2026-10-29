# Architecture

Local Chat Exporter for Discord is a Manifest V3 Chrome extension built with WXT, TypeScript and React. It has no backend: messages live in the extension's IndexedDB, downloaded files in its origin-private file system (OPFS), and exports are written to a folder or ZIP the user picks.

The background research behind these decisions is in `reports/Discord Chat Export Tool analysis.md` and `research_notes/`.

## Goals and constraints

- Export one conversation for a date range to JSON, CSV and a self-contained offline HTML viewer, with attachments.
- No artificial message or attachment limits; large exports are processed incrementally.
- Never read, store or use the user's Discord login token, never bypass authentication, never make API requests that the user's own client would not make (page capture) or that are not authorized (bot API).
- Pause, resume and cancel at every long-running step; progress survives a closed tab.

## Contexts and data flow

```
 Discord tab (discord.com)                      Extension (chrome-extension://…)
┌──────────────────────────────┐   capture/batch   ┌─────────────────────────────┐
│ content script (isolated)     │ ───────────────▶ │ background service worker    │
│  • CaptureSession             │                  │  • job create/discard        │
│    MutationObserver on the    │ ◀─────────────── │  • stores batches (IndexedDB) │
│    rendered message list      │   job totals     │  • coverage + gap checks      │
│  • DOM parser + sanitizer     │                  │  • opens the export page      │
│  • in-page progress panel     │                  │  • User-Agent DNR rule (bot)  │
└──────────────────────────────┘                  └──────────────┬──────────────┘
          ▲  capture/start, commands                              │
          │                                                       ▼
┌─────────┴───────────┐                       ┌─────────────────────────────────────┐
│ popup               │ ── job/create ──────▶ │ export page (extension tab)          │
│  • detects tab/chat │                       │  • JobRunner                         │
│  • dates, method,   │                       │    – bot API collection (optional)   │
│    formats          │                       │    – attachment downloads → OPFS     │
└─────────────────────┘                       │    – save: JSON/CSV/HTML + files     │
                                              │      → folder (FS Access) or ZIP64    │
                                              └─────────────────────────────────────┘
```

Long work runs in the **export page**, not the service worker: MV3 service workers are stopped when idle, while an extension tab can run for hours and has the DOM APIs the File System Access pickers need. The service worker only handles short requests (storing a capture batch, creating jobs).

## Source layout

```
src/
  core/            types, snowflake/date-range math, Discord URL parsing, formatting
  retrieval/
    dom/           page capture: parser, sanitizer, CaptureSession, overlay, content controller
    bot/           official API: rate-limited client, fetcher (date-range pagination), mapper
  processing/      CDN URL helpers, file-name allocation, downloader + download runner
  storage/         IndexedDB (jobs, messages, downloads) and the OPFS file cache
  export/          JSON/CSV writers, HTML viewer renderer, sinks (folder, ZIP), exporter
  jobs/            job model and JobRunner (pause/resume/cancel orchestration)
  messaging/       typed messages between popup, content script, background and export page
  settings/        optional bot token storage
  entrypoints/     background, discord.content, popup, export, options (WXT entrypoints)
  ui/              shared React components and styles
tests/             Vitest suites (fake IndexedDB, happy-dom fixtures)
```

Retrieval, authentication, processing and export are separate modules: both retrieval adapters produce the same `ExportMessage` records (`src/core/types.ts`), and everything downstream (storage, downloads, exporters) is adapter-agnostic.

## Retrieval methods

### 1. Page capture (default, `src/retrieval/dom`)

How it works:
- The popup sends `capture/start` to the content script in the active Discord tab. A `CaptureSession` attaches a `MutationObserver` to Discord's message list (`ol[data-list-id="chat-messages"]`) and re-reads the rendered items (debounced) whenever Discord adds, removes or updates messages.
- Each list item `li#chat-messages-<channelId>-<messageId>` is parsed read-only (`parser.ts`). The message time comes from the snowflake ID, so it is exact. Authors come from `#message-username-<id>`; continuation messages (no header) point at their group's first message through the article's `aria-labelledby`, and the author is resolved from that message. Content is converted by a whitelist sanitizer (`sanitize.ts`) into safe HTML plus plain text. Attachments are taken from `cdn.discordapp.com` / `media.discordapp.net` attachment URLs inside `#message-accessories-<id>` (media-proxy previews are mapped back to the original file). Embeds, reactions, stickers, replies, edits and system messages are read where the markup allows.
- Only messages inside the date range are stored. Pairs of messages seen next to each other are recorded, which gives:
  - **coverage**: a captured neighbour older than the start date (or newer than the end date) proves that boundary was reached;
  - **gap detection**: two consecutive stored messages that were never seen adjacent may have missing messages between them.
- Batches go to the background (`capture/batch`), which merges them into IndexedDB in one transaction (re-renders refresh signed URLs and lazily loaded parts without losing earlier data).

Limitations (by design):
- **Manual scrolling is required.** Discord loads history only as the user scrolls; the extension never scrolls, clicks or requests messages. A full date-range export is possible only if the user scrolls through the whole range. The panel shows how far the capture reached and the gap check lists holes to revisit.
- “Jump to start date” navigates the tab to `discord.com/channels/<guild>/<channel>/<snowflake of the start date>` — the same as opening a message link — so the user can scroll *down* through the range instead of up from today. Discord's client code loads `GET …/messages?around=<id>` for such links and scrolls to the first loaded message after the ID, even when no message has that exact ID (confirmed in the client source, see `research_notes/Discord web DOM/`; **not tried on the live site**). If it misbehaves, use Discord's own search (`during:`/`after:`) and jump to a result.
- Fidelity is limited to the rendered page: display names, user IDs only from avatar URLs, approximate file sizes, reaction counts only, embeds as text, no thread contents, collapsed blocked messages are skipped, and Components-V2/poll layouts may be captured as plain text.
- The parser depends on Discord's markup. It prefers element IDs and ARIA attributes over hashed class names, and falls back to class-name substrings (`[class*="embedTitle"]`) only where nothing better exists. The rules follow Discord's web client source (canary build of 2026-10-29) as documented in `research_notes/Discord web DOM/dom_structure.md`: message items may be wrapped (`div[data-flash]`), continuation authors come from `aria-labelledby`, system messages have no username token, forwarded snapshots reuse the message's own content/accessories IDs, `div#chat-messages-<c>-<c>` marks the start of history, and collapsed blocked-message groups are treated as possible gaps. A Discord redesign can break it; failures are isolated per message. **It has not been run against the live site**; the tests use fixtures that reproduce the documented markup.

### 2. Official bot API (optional, `src/retrieval/bot`)

- Authenticates with a **bot token the user creates** (`Authorization: Bot …`), stored in `chrome.storage.session` by default (memory only, hidden from content scripts) or `chrome.storage.local` if the user chooses to remember it. The token is verified with `GET /users/@me` and must belong to a bot.
- Fetches with `GET /channels/{id}/messages?limit=100&after=<cursor>` starting from `(startMs − 1420070400000) << 22`, re-sorting each page (Discord returns newest first) and stopping at the first message after the end date — the approach DiscordChatExporter uses. The cursor is persisted after every page, so collection resumes exactly where it stopped.
- `DiscordBotClient` serializes requests, tracks per-route buckets from `X-RateLimit-Remaining`/`X-RateLimit-Reset-After`, waits `retry_after` on 429 (global or per-route), backs off on 5xx/network errors, stops on 401/403/404 with an explanation, and aborts after 50 rejected requests per 10 minutes (Discord bans IPs at 10,000).
- Discord requires `User-Agent: DiscordBot (url, version)`; Chrome ignores that header in `fetch()`, so the background installs a `declarativeNetRequest` rule that sets it only for this extension's requests to `/api/v10/` (Discord's web client uses v9). The browser test checks with Chrome's own matcher (`testMatchOutcome`) that the rule matches the extension's requests and none of Discord's page requests; the header value on the wire was not observed (request interception sees headers before the rule applies).
- Expired attachment links are refreshed by re-fetching the message (`GET /channels/{id}/messages/{id}`), Discord's documented method.
- Limitations: server channels and threads only; **bots can never read the user's DMs or group DMs**; the bot must be added by someone with *Manage Server*; without the Message Content intent Discord returns empty content (detected and reported).

## Storage

- **IndexedDB** (`local-chat-exporter`): `jobs` (one record per export: stage, options, counters, coverage, errors, saves), `messages` keyed by `[jobId, zero-padded snowflake]` (so iteration is chronological), and `downloads` keyed by `[jobId, "a:<attachmentId>" | "s:<assetKey>"]` (status, local path, bytes, error).
- **OPFS** (`exports/<jobId>/…`): downloaded files, streamed from `fetch()` straight to disk with `pipeTo`, never buffered whole in memory. OPFS needs no permission prompt, so downloads resume after a restart. `unlimitedStorage` avoids quota errors on big exports.
- One export at a time; starting a new export discards older jobs (with confirmation).

## Downloads (`src/processing`)

- Records are created incrementally from stored messages (attachments, plus avatars/custom emoji/stickers for the offline viewer) and processed by a small worker pool (3 concurrent requests, `credentials: 'omit'`).
- Validation: HTTP status, no HTML error pages, `Content-Length` match, exact size match against the API's `size` (bot mode), non-empty files. 429/5xx are retried with `Retry-After`/backoff; 404/410 → `missing`; 401/403 on signed links or an `ex` timestamp in the past → `expired` (no request is made for links known to be expired).
- File names keep the original where possible: invalid characters are replaced, Windows reserved names are suffixed, length is capped, and duplicates (case-insensitive) become `name (2).ext`. The assigned path is stored once, so resumes and repeated saves are consistent.
- Pausing aborts in-flight requests; aborted records stay `pending` and are picked up on resume. “Retry” resets failed/expired/missing records.

## Export (`src/export`)

- `writeExport` streams every output through an `OutputSink`: `DirectorySink` (File System Access API; creates a new sub-folder, never overwrites an existing one) or `ZipSink` (zip.js streaming writer into a `FileSystemWritableFileStream`; entries of unknown size use ZIP64 headers automatically, and `zip64` is forced when the archive is expected to exceed 4 GB or 60,000 entries; media is stored uncompressed, text deflated).
- **JSON**: header (exporter, conversation, range, completeness notes, gaps, counts) followed by messages, written message by message.
- **CSV**: RFC 4180, CRLF, UTF-8 with BOM; cells starting with `= + - @` are prefixed with `'` so spreadsheets do not execute text written by other users.
- **HTML viewer**: `index.html` (summary, completeness, part list, gaps, failed files) plus `html/part-NNNN.html` pages of 1,000 messages each, rendered without any external resources. Messages are grouped like Discord (same author within 7 minutes), with day separators, replies linking across parts, local attachments (images inline, video/audio players, file links), embeds, reactions, stickers, spoilers and an in-page filter. Times use the time zone the date range was picked in. All text is escaped; message HTML comes only from the whitelist sanitizer (page capture) or the markdown renderer that escapes before formatting (bot API).
- Memory: messages are read from IndexedDB in batches of 250; HTML parts are flushed in 64 KB chunks; reply targets are resolved with a sorted `BigUint64Array` of IDs (8 bytes per message) instead of loading messages.

## Job lifecycle

`collecting → downloading → ready` (saving can be repeated from `ready`).

| Action | Page capture | Bot API |
|---|---|---|
| Pause / resume | stops/starts recording in the tab | aborts the current request, keeps the cursor |
| Finish | user decides (warns about unreached boundaries and gaps) | automatic at the end of the range |
| Stop / cancel | “Cancel” in the tab panel discards the capture | “Stop and keep what was fetched” |
| Downloads | pause / resume / skip remaining / retry failed | same, plus automatic link refresh |
| Recovery | reloading the Discord tab re-attaches the capture | reopening the export page resumes from the cursor |

## What is not implemented, and why

| Feature | Status | Reason |
|---|---|---|
| Using the user's login token (as the analysed extension does) | **Not implemented** | Extracting the session token is exactly the self-bot pattern Discord's Terms forbid and penalise; it also resembles token-stealing malware. |
| Intercepting Discord's own network responses (patching `fetch`/XHR in the page) | **Not implemented** | Requires modifying the Discord client in the page, which Discord's platform manipulation policy forbids. |
| Automatic scrolling to load history | **Not implemented** | It would automate the user's account (Discord's self-bot rule). The user scrolls; the extension only reads. |
| Full-history export of DMs without scrolling | **Not possible safely** | The only authorized API route is a bot, and bots cannot read a user's DMs. |
| Exporting thread contents from the parent channel | Not implemented | Open the thread itself and export it (both methods). |
| Exact attachment sizes, user IDs for every message, who reacted (page capture) | Not available | Not present in the rendered page; use the bot method where possible. |
| Lottie (animated JSON) stickers in the HTML viewer | Shown by name | Rendering them would need a bundled animation library. |
| Firefox/Safari | Not supported | Saving relies on the Chromium File System Access API. |

## Testing

- `npm test` — Vitest (91 tests): snowflake/date math (DST), URL parsing, CDN helpers, file names, markdown and CSV safety, bot client rate limiting and pagination with a fake `fetch`, mapper (replies, forwards, Components V2, system messages), downloader validation, download runner and job runner (pause/resume/stop) with fake IndexedDB, storage merge/coverage/gap logic, export to an in-memory sink and to a ZIP that is read back with zip.js, and the DOM parser/capture session against Discord-like HTML fixtures (happy-dom).
- `npm run test:e2e` — Playwright loads the built extension into Chromium and runs both methods end to end: content script → background → IndexedDB → export page → downloads into OPFS → save to a folder and a ZIP (the native pickers are replaced by private-file-system handles), the popup and options pages, and the bot adapter against a fake `discord.com/api/v10` including a 429 retry. All requests are answered locally or blocked and DNS is disabled.
- The fixtures model Discord's markup as documented in `research_notes/`; they are not a substitute for checking against the live site after Discord UI changes.
