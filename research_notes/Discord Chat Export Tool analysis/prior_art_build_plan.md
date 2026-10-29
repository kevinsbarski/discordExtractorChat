# Prior art and build plan: open-source Discord chat exporters and the Chrome MV3 engineering behind an "export a Discord chat by date range, with attachments" extension (researched 2026-10-29)

Method note: GitHub facts (stars, push dates, releases, file contents) were pulled with the authenticated `gh` CLI and raw.githubusercontent.com on 2026-10-29. npm versions and weekly downloads come from registry.npmjs.org and api.npmjs.org for the week 2026-10-21 to 2026-10-27. Source files were read but never executed. "HEAD" in GitHub URLs means the default branch as of the research date.

---

## 1. DiscordChatExporter (DCE): how it fetches, rate-limits, renders, downloads media; limits, license, ToS stance, maintenance

### Takeaway
DCE is the reference design. It is MIT-licensed C#/.NET. The latest release is 2.48 (2026-08-27), and the project is officially in "maintenance" mode, meaning bug fixes only. It works like this:
- **Fetching:** it pages `GET /channels/{id}/messages?limit=100&after=…` chronologically. It first fetches a terminal "omega" message so the range is bounded at both ends.
- **Rate limits:** it waits on advisory `X-RateLimit-*` headers and retries 429/5xx responses using `Retry-After`.
- **HTML:** it streams minified HTML built from Razor templates, one author group at a time, using a custom Discord-markdown parser.
- **Media:** with `--media`, it downloads every referenced asset, including its own CDN JS/CSS, under hash-based file names. This makes exports work offline and lets later exports reuse the files.

Its code is reusable under MIT with the copyright notice kept. However, the templates are C# Razor and would have to be ported, and the README adds a non-standard political "Terms of use".

### Cited Findings
**Status / maintenance**
- Repo: 12,283 stars, last push 2026-10-27, not archived, MIT, C#. — [GitHub repo](https://github.com/Tyrrrz/DiscordChatExporter)
- Recent releases: 2.48 (2026-08-27), 2.47.3 (2026-06-26), 2.47.2 (2026-06-04), 2.47.1 (2026-03-21). — [Releases](https://github.com/Tyrrrz/DiscordChatExporter/releases)
- 2.48 changes: "Render polls in HTML exports", "Only display http(s) URLs as links in HTML export", "Fix reverse exports with an after boundary". — [Release 2.48](https://github.com/Tyrrrz/DiscordChatExporter/releases/tag/2.48)
- The README shows a "status: maintenance" badge. The author's status page defines maintenance mode as "no longer in active development". Only bug-related issues and PRs are accepted, and "new features are unlikely to be added". — [README](https://github.com/Tyrrrz/DiscordChatExporter), [Tyrrrz project-status](https://github.com/Tyrrrz/.github/blob/master/docs/project-status.md)
- README feature list:
  - cross-platform GUI and CLI
  - user or bot token
  - markdown, attachments, embeds, emoji
  - file partitioning, date ranges, message filtering
  - exports viewable offline
  - formats: HTML (dark/light), TXT, CSV, JSON — [README](https://github.com/Tyrrrz/DiscordChatExporter)
- The README lists Chat Analytics and DiscordChatExporter-frontend as related projects that consume DCE exports. — [README](https://github.com/Tyrrrz/DiscordChatExporter)

**Fetching (endpoints, pagination)**
- Base URI is `https://discord.com/api/v10/`. The `Authorization` header is the raw token for user tokens and `Bot {token}` for bots. The token kind is auto-detected by calling `users/@me` in each form and checking for HTTP 401. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- Message paging works as follows. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
  - Each request is `channels/{id}/messages?limit=100&after={boundary}` (or `before=` in `--reverse` mode).
  - Each batch is reversed into chronological order, because Discord returns batches newest first.
  - The boundary becomes the last message ID of the batch.
- Source comment: "Discord API doesn't allow us to provide both 'after' and 'before' parameters at the same time". DCE therefore works around it like this. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
  - It first fetches the "Omega" message, the last message before `before`, using `limit=1&before=…`.
  - It stops yielding once message IDs pass Omega.
  - It also computes progress from the timestamps of the Alpha, current and Omega messages.
- Discord's docs confirm the constraints. — [Discord docs: Get Channel Messages](https://docs.discord.com/developers/resources/message)
  - `before`, `after` and `around` "are mutually exclusive".
  - `limit` is 1–100, default 50.
  - Results come "from newest to oldest".
  - Guild channels need `VIEW_CHANNEL`. Without `READ_MESSAGE_HISTORY`, no messages are returned.
- Thread-starter messages arrive as content-less references. DCE resolves them with `around={id}&limit=1`. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- Thread listing differs by token type. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
  - User tokens can only use `channels/{id}/threads/search` (`sort_by=last_message_time`, `archived=true|false`, offset paging).
  - Bots use `guilds/{id}/threads/active` and `channels/{id}/threads/archived/{type}?before=`.
- Other endpoints used: `users/@me/guilds?limit=100&after=`, `users/@me/channels` (DMs), `guilds/{id}/channels`, `guilds/{id}/roles`, `guilds/{id}/members/{id}`, `channels/{id}/messages/{id}/reactions/{emoji}?limit=100&after=`. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- If every message in a batch is empty, DCE checks whether a bot lacks the MESSAGE_CONTENT intent. Discord's docs say apps without that intent receive empty `content`, `embeds`, `attachments` and `components` fields. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs), [Discord docs: Message](https://docs.discord.com/developers/resources/message)

**Date filters (`--after` / `--before`)**
- Both options are "Only include messages sent after/before this date or message ID" and are typed as `Snowflake?`. — [ExportCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/ExportCommandBase.cs)
- Documented example: `--after "2019-09-17 23:34" --before "2019-09-18"`. — [Using-the-CLI.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Using-the-CLI.md)
- Discord's docs on snowflakes: "Milliseconds since Discord Epoch… 1420070400000", with `timestamp = (snowflake >> 22) + 1420070400000`. You can generate a snowflake for a given time to use with `before`/`after`. — [Discord docs: Reference](https://docs.discord.com/developers/reference)

**Rate-limit handling (respectful practice)**
- **Advisory limits.** After each response, if `X-RateLimit-Remaining <= 0`, DCE waits `X-RateLimit-Reset-After + 1 s`, clamped to 0–60 s. — [DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/DiscordClient.cs), [RateLimitPreference.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Discord/RateLimitPreference.cs), [DiscordCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/DiscordCommandBase.cs)
  - Source comments say these headers are "typically way stricter than the actual rate limits enforced by the server". They also say full per-route bucket tracking is "way too much effort".
  - The client defaults to `RateLimitPreference.RespectAll`.
  - The CLI exposes `--respect-rate-limits` ("Whether to respect advisory rate limits").
- **Hard retries** use Polly. — [Http.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Utils/Http.cs)
  - API responses are retried up to 8 times on 429, 408 or ≥500.
  - The delay is `Retry-After + 1 s` when that header is present, otherwise `2^attempt + 1` s.
  - Asset downloads use a separate policy: up to 4 retries, exponential backoff starting at 1 s.
- `--parallel` ("how many channels can be exported in parallel") defaults to 1. — [ExportCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/ExportCommandBase.cs)
- Discord's official rate-limit rules. — [Discord docs: Rate Limits](https://docs.discord.com/developers/topics/rate-limits)
  - Headers: `X-RateLimit-Limit`, `-Remaining`, `-Reset`, `-Reset-After`, `-Bucket`. On 429 only: `-Global` and `-Scope` (user/global/shared).
  - The 429 body contains `retry_after` (seconds) and `global`.
  - "All bots can make up to 50 requests per second".
  - Invalid requests (401/403/429) are limited to "10,000 per 10 minutes". Beyond that, IPs are "automatically and temporarily restricted".
  - "rate limits should not be hard coded"; parse the headers instead.

**Partitioning and other options**
- `--partition` splits output by message count ("100") or file size ("10mb"). Files are named `name [part N].ext`. — [ExportCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/ExportCommandBase.cs), [MessageExporter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/MessageExporter.cs)
- Docs example: a 36-message channel partitioned every 10 messages produces 4 files. — [Using-the-CLI.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Using-the-CLI.md)
- Other options: `--include-threads`, `--filter` (filter DSL), `--reverse`, `--markdown` (default true), `--locale`, `--utc`. The default format is `HtmlDark`. — [ExportCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/ExportCommandBase.cs)
- CLI commands: `export`, `exportdm`, `exportguild`, `exportall`, `channels`, `dm`, `guilds`, `guide`. — [Using-the-CLI.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Using-the-CLI.md)

**Export formats**
- The `ExportFormat` enum has `PlainText` (.txt), `HtmlDark` and `HtmlLight` (.html), `Csv` (.csv) and `Json` (.json). — [ExportFormat.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/ExportFormat.cs)

**How the HTML is produced**
- Three Razor templates: `PreambleTemplate.cshtml`, `MessageGroupTemplate.cshtml`, `PostambleTemplate.cshtml`. They are compiled with the RazorBlade package, and each rendered chunk is minified with WebMarkupMin's `HtmlMinifier`. — [HtmlMessageWriter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/HtmlMessageWriter.cs), [Core .csproj](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/DiscordChatExporter.Core.csproj)
- Output is written incrementally through a `StreamWriter`, one message group at a time, so memory stays bounded. — [HtmlMessageWriter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/HtmlMessageWriter.cs)
- Messages are grouped when all of the following hold. — [HtmlMessageWriter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/HtmlMessageWriter.cs)
  - same author
  - at most 7 minutes apart
  - author's display name unchanged
  - the message is not a reply (replies always start a new group)
  - System notifications only group with other system notifications.
- The preamble loads external assets: highlight.js 9.15.6 and a solarized theme from cdnjs, lottie-web 5.8.1 from cdnjs (for animated stickers), and "gg sans" fonts from jsDelivr (`gh/Tyrrrz/DiscordFonts`). — [PreambleTemplate.cshtml](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/PreambleTemplate.cshtml)
- The highlight.js and lottie URLs go through `ResolveAssetUrlAsync`. With `--media` they are downloaded locally; without it, they stay remote URLs. — [PreambleTemplate.cshtml](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/PreambleTemplate.cshtml), [ExportContext.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/ExportContext.cs)
- The Tyrrrz/DiscordFonts repo declares no license (GitHub API license: none; last push 2023-02-18). — [Tyrrrz/DiscordFonts](https://github.com/Tyrrrz/DiscordFonts)

**Markdown parser and mention/emoji resolution**
- DCE uses its own markdown parser (`Markdown/Parsing/MarkdownParser.cs`), built from regex and string matchers. — [MarkdownParser.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Markdown/Parsing/MarkdownParser.cs)
  - Formatting rules: bold, italic (two variants), underline, spoiler, single- and multi-line quotes, headings, lists, inline and multi-line code.
  - Mention rules: @everyone/@here, user, channel and role mentions.
  - Emoji and link rules: standard, coded and custom emoji; auto, hidden and masked links.
  - Other rules: shrug, escaped symbols, timestamps.
  - The parse tree is rendered by `HtmlMarkdownVisitor` or `PlainTextMarkdownVisitor`.
- `ExportContext` pre-loads guild channels and roles, and fetches guild members on demand (`guilds/{id}/members/{id}`) to resolve mentions and name colours. A user's colour comes from their first role that has a colour. — [ExportContext.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/ExportContext.cs)

**Media download (`--media`, `--reuse-media`, `--media-dir`)**
- The three options behave as follows. — [ExportCommandBase.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Cli/Commands/Base/ExportCommandBase.cs), [Using-the-CLI.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Using-the-CLI.md)
  - `--media` downloads "user avatars, attached files, embedded images, etc."
  - `--reuse-media` reuses earlier downloads when you export to the same folder. It requires `--media`.
  - `--media-dir` sets the asset folder. By default it is created next to the export.
- File naming and safety. — [ExportAssetDownloader.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/ExportAssetDownloader.cs), [ExportContext.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/ExportContext.cs)
  - Each file is named `<original name truncated to 42 chars>-<SHA-256-derived hash of the normalized URL><ext>`.
  - Normalization removes the signature query parameters `ex`, `is` and `hm` for `cdn.discordapp.com` and `media.discordapp.net`, so re-signed URLs map to the same file.
  - A per-path async lock prevents duplicate concurrent downloads.
  - Relative paths are preferred, so the export folder can be moved without breaking links.
- Discord's docs on attachment URLs. — [Discord docs: Reference](https://docs.discord.com/developers/reference)
  - They "have signed URLs with a preset expiry time". `ex` is the expiry, `is` the issue time and `hm` the signature.
  - Fetching a message returns URLs that are valid at that time.
  - Standard (non-attachment) CDN endpoints are unsigned.
- DCE FAQ: without `--media`, media that is "changed or deleted… will no longer be displayed". — [Troubleshooting.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Troubleshooting.md)

**What DCE does not support (its FAQ)**
- It cannot export deleted messages, cannot export several formats at once, cannot add new messages to an existing export, and cannot re-upload or recreate chats. For a file too large to open, the advice is another program, partitioning, or PlainText. — [Troubleshooting.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Troubleshooting.md)

**License and reuse**
- License: "MIT License, Copyright (c) 2017-2026 Oleksii Holub". — [License.txt](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/License.txt)
- The README also has a "Terms of use" section: "By using this project or its source code, for any purpose and in any shape or form, you grant your implicit agreement to all the following statements". The statements condemn Russia's aggression against Ukraine, among others. — [README](https://github.com/Tyrrrz/DiscordChatExporter)

**What DCE says about user tokens and Discord's ToS**
- README: automating user accounts "is against Discord TOS and may result in you getting banned". It recommends a bot. — [README](https://github.com/Tyrrrz/DiscordChatExporter)
- Token docs. — [Token-and-IDs.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Token-and-IDs.md)
  - "Do not share your token! A token gives full access to an account. To reset a user token, change your account password."
  - "Automating user accounts violates Discord's terms of service and may result in account termination. Use at your own risk."
  - Users are told to obtain their own token manually through browser DevTools.
- FAQ: "Automating user accounts is technically against TOS, use at your discretion. Bot accounts don't have this restriction." — [Troubleshooting.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Troubleshooting.md)
- User reports (anecdotal) in discussion #889; no maintainer response appears in the thread. — [DCE Discussion #889](https://github.com/Tyrrrz/DiscordChatExporter/discussions/889)
  - 2026-03-11: a "Platform Manipulation" penalty disabled sending for two days after several roughly two-month exports in one week.
  - 2026-06-27: a user got a Community Guidelines email while exporting one server, despite respecting rate limits.

### Inferences
- Port DCE's algorithm, not its code, because the code is C#:
  - convert the date range to snowflakes;
  - fetch the Omega message first;
  - page `after=` with `limit=100`;
  - honour `X-RateLimit-Remaining`/`Reset-After` before the next call;
  - on 429, wait `retry_after`/`Retry-After` plus a buffer;
  - export channels one at a time.
- DCE's `ex/is/hm`-stripping plus content-hash naming is a good model for deduplication and "reuse media" in an extension.
- Reusing DCE's HTML/CSS structure is allowed under MIT if the notice is kept. The README's added "Terms of use" may still deter commercial reuse; this is a legal question, not a technical one. A clean-room renderer with original CSS avoids the issue.
- Do not bundle DCE's gg sans font files, since the DiscordFonts repo carries no license.
- Exports that link remote Discord attachment URLs will break once the signature expires. A durable export must include local copies of media, as DCE's own FAQ implies.

### Gaps
- The exact lifetime of Discord's signed attachment URLs is undocumented ("preset expiry time"). Secondary sources mention about 24 h, which is unverified.
- No legal analysis was found on whether DCE's "Terms of use" binds people who reuse its MIT code.
- The license of the gg sans font files was not confirmed.
- The CLI default value of `--respect-rate-limits` was not read. The `DiscordClient` constructor default is `RespectAll`.

---

## 2. Discrub and other open-source Discord export browser extensions

### Takeaway
Discrub is the only widely used Discord export extension with an open-source codebase, and that codebase is frozen.
- **Discrub Classic** (MIT, last release 1.12.11 on 2025-09-16):
  - MV3; built with Vite, the CRXJS beta, React, MUI and Redux
  - reads the token from Discord's `localStorage` through an injected iframe
  - streams ZIPs with conflux and StreamSaver
- **Current Discrub** (v2.2.7, about 200k users, Featured) is a separate "source-visible, all rights reserved" codebase. It cannot be reused.

Other open-source browser exporters are tiny and unvetted (0–3 stars). Adjacent projects are useful references for viewers and rendering: Discord History Tracker, DCE-frontend and discord-html-transcripts.

### Cited Findings
**Discrub Classic (pratherbytecraft/discrub-ext, formerly prathercc/discrub-ext)**
- The repo moved to pratherbytecraft/discrub-ext. It has 536 stars, MIT license, last push 2026-09-30, and the description "Legacy message manipulation and export tool for Discord." — [GitHub repo](https://github.com/pratherbytecraft/discrub-ext)
- README:
  - "Legacy — No Longer Actively Maintained… This is Discrub Classic… The current version of Discrub uses a new codebase and is delivered from the same Chrome Web Store and Firefox Add-ons listings (auto-updated)… it is no longer receiving updates."
  - "The code is now MIT-licensed… The 'Discrub' name and logo remain trademarks of prathercc — forks must rename their distribution." — [README](https://github.com/pratherbytecraft/discrub-ext)
- Last GitHub releases: 1.12.11 (2025-09-16), 1.12.10 (2025-06-30), 1.12.9 (2025-06-12). — [Releases](https://github.com/pratherbytecraft/discrub-ext/releases)
- Manifest. — [manifest.json](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/public/manifest.json)
  - `manifest_version: 3`, `permissions: ["storage"]` only, and no host_permissions.
  - A module service worker as background.
  - A content script on `*://discord.com/*`.
  - `web_accessible_resources` include `index.html`, `button_injection.html`, `resources/html/mitm.html` and `*/*.zip`.
- Its UI is extension HTML pages injected as iframes into Discord's page: `chrome.runtime.getURL("button_injection.html")` and `chrome.runtime.getURL("index.html")`. — [content.js](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/chrome/content.js)
- **Token acquisition:**
  - The content script creates an iframe, reads `iframe.contentWindow.localStorage`, and uses `storage.token` if it exists. — [content.js](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/chrome/content.js)
  - If no session is found, the user is asked to paste an "Authentication Token". Opening DevTools before Discrub can trigger this screen. — [Auth docs](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/docs/opening_the_extension_and_authentication.md)
- **Stack:** React 18, MUI 5 (+ x-date-pickers), Redux Toolkit, react-window, react-markdown, highlight.js, papaparse, date-fns(-tz), file-type, filenamify, `@transcend-io/conflux`, `streamsaver`. Dev dependencies: Vite 4, `@crxjs/vite-plugin ^2.0.0-beta.21`, TypeScript. — [package.json](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/package.json)
- **API usage:** base `https://discord.com/api/v10`, the channel messages endpoint with `limit`, and the search endpoint (`/messages/search`) with `min_id`/`max_id`. Those IDs are generated from dates as `((ms − 1420070400000) << 22)`. — [discord-service.ts](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/services/discord-service.ts)
- **Rate limits:**
  - On HTTP 429, Discrub waits the JSON body's `retry_after`. — [discord-service.ts](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/services/discord-service.ts)
  - Users can set a "Search Delay" and a "Modify Delay", and the FAQ suggests raising them if Discord rate-limits you. — [prevent_rate_limits.md](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/docs/faq/prevent_rate_limits.md)
- **Export formats:** `JSON`, `HTML`, `CSV`, `MEDIA`. — [export-type.ts](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/enum/export-type.ts)
  - HTML is built with `react-dom/server` `renderToString` on message components, with `hljs.highlightAuto` for code blocks and a "messages per page" setting that splits pages.
  - CSV uses `Papa.unparse`; JSON uses `JSON.stringify`. — [export-slice.tsx](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/features/export/export-slice.tsx)
- **Zipping and saving:**
  - A conflux `Writer` (a streaming ZIP writer) is piped into `streamSaver.createWriteStream("<name>.zip")`, with `streamSaver.mitm` pointed at the extension's own `mitm.html`. — [export-utils.js](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/features/export/export-utils.js)
  - `mitm.js` registers a service worker and pings it every 10 s "to prevent the sw from restarting". — [mitm.js](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/public/resources/js/mitm.js)
- **Media:** each URL is downloaded once using a dedupe map, and the file extension is detected with `fileTypeFromBlob`. Users choose which media types to include (images, videos, audio, embed images/videos). Avatars and role icons are also downloaded. — [export-slice.tsx](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/features/export/export-slice.tsx)
- Known issue, per its FAQ: "Exports are notorious for taking quite a long time to complete". Media downloads add time because files are fetched one by one. — [long_export_time.md](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/docs/faq/long_export_time.md)
- conflux: "Build and read zip files with whatwg streams in the browser", about 55 kB. Its "zip64 format" issue is still open. — [conflux README](https://github.com/transcend-io/conflux), [conflux #8](https://github.com/transcend-io/conflux/issues/8)

**Current Discrub (new codebase): not reusable**
- `pratherbytecraft/discrub` is "Source-visible". Its LICENSE: "All rights reserved. © 2024-2026 Prather Bytecraft… not licensed for use, redistribution, or modification by other parties without explicit permission". `discrub-core` is likewise "UNLICENSED". — [discrub LICENSE](https://github.com/pratherbytecraft/discrub/blob/HEAD/LICENSE), [discrub-core LICENSE](https://github.com/pratherbytecraft/discrub-core/blob/HEAD/LICENSE)
- Dependencies include React, MUI, Redux Toolkit, `@tanstack/react-virtual`, conflux, fflate, file-saver, idb-keyval, papaparse, react-markdown and i18next. The build uses plain Vite with `vite.config.extension.ts`; neither CRXJS nor WXT is among its dev dependencies. — [discrub package.json](https://github.com/pratherbytecraft/discrub/blob/HEAD/package.json)
- Chrome Web Store listing: about 200,000 users, 4.6/5 from 338 ratings, v2.2.7, updated 2026-10-27, Featured badge. — [CWS listing](https://chromewebstore.google.com/detail/discrub/plhdclenpaecffbcefjmpkkbdpkmhhbj)
  - It declares no data collection and says the Discord token stays in the browser.
  - An optional "supporter key" is sent to `api.pratherbytecraft.com` about once a day.

**Other projects**
- Discord History Tracker (chylex): MIT, v47.4 (2026-01-29). The main branch is now a .NET desktop app; an older browser-only version lives on a separate branch. — [DHT repo](https://github.com/chylex/Discord-History-Tracker)
- DiscordChatExporter-frontend (slatinsky): GPL-3.0. — [DCEF README](https://github.com/slatinsky/DiscordChatExporter-frontend)
  - It is a Discord-like viewer with search for DCE JSON exports, "Optimized to handle really large exports well".
  - It needs `--media --reuse-media --markdown false --format Json` and runs via Docker.
- discord-html-transcripts (ItzDerock): Apache-2.0, a bot-side transcript generator. The npm package 3.3.0 is deprecated: "broken due to a critical bug, please downgrade to =3.2.0". — [repo](https://github.com/ItzDerock/discord-html-transcripts), [npm](https://www.npmjs.com/package/discord-html-transcripts)
- Small, unvetted repos found by GitHub search (0–3 stars):
  - [rison1337/discord-export](https://github.com/rison1337/discord-export): MIT, "Local Discord message exporter for Chrome & Edge — HTML, JSON, CSV"
  - [johnaqu1no/DiscordExporter](https://github.com/johnaqu1no/DiscordExporter)
  - [akashthemagnificent-ux/discord-dm-export](https://github.com/akashthemagnificent-ux/discord-dm-export): "Manifest V3… LLM-readable transcripts"
  - [domz-1/discord-chat-exporter-extension](https://github.com/domz-1/discord-chat-exporter-extension)
  - [jub0t/discord-chat-export-extension](https://github.com/jub0t/discord-chat-export-extension)
- The extension under analysis: "Discord Chat Export Tool", about 20,000 users, 4.8/5 from 527 ratings, v1.7.0, updated 2026-09-03. Its listing says "Offers in-app purchases" and declares no data collection. — [CWS listing](https://chromewebstore.google.com/detail/lmoceiadfbnpofjbmgemloenlfkhhbhl)

### Inferences
- Three proven ways to get the token:
  - Discrub reads the token from `localStorage` through an iframe. It needs only the `storage` permission and no MAIN-world script, but it is brittle and the fallback is pasting the token manually.
  - The analyzed extension hooks XHR in the MAIN world at `document_start`.
  - DCE has the user paste the token.
- In all three cases the extension holds a full-access credential. It must stay in memory or `chrome.storage.session` and never leave the machine.
- Discrub Classic is a reusable MIT reference for React export UI, CSV/JSON and media dedupe, provided the result is renamed. Two parts of its save path are dated:
  - StreamSaver's service-worker trick can be replaced with `showSaveFilePicker` and a `FileSystemWritableFileStream` in an extension tab.
  - conflux lacks ZIP64 (see Q5).
- The market leader moved away from open source in 2024–2026, so no maintained open-source Discord export extension exists to fork.

### Gaps
- Discrub Classic makes cross-origin API calls from its extension iframe without host_permissions. How those calls deal with CORS was not checked.
- Architecture details of the new Discrub were not examined, since it cannot be reused.
- The small GitHub repos were not reviewed for quality or safety.

---

## 3. Extension framework options in 2026: Plasmo vs WXT vs CRXJS + Vite vs plain Vite

### Takeaway
- **WXT** is the safest default for a new project: very active (v0.21.5 on 2026-10-26), with declarative MAIN-world content scripts, `injectScript`, and built-in ZIP and publishing.
- **CRXJS** has revived (v2 stable, then 3.0.0 on npm on 2026-09-24) and suits a manifest-first Vite setup. Re-test MAIN-world and `document_start` behaviour first.
- **Plain Vite** is viable; the current Discrub uses it.
- **Plasmo**, which the analyzed extension uses, has had no main-branch commits since 2025-05-17 and has an open "is it maintained?" issue. Avoid it for new work.

### Cited Findings
- **WXT:** MIT, 10,674 stars, push 2026-10-29. Release `wxt-v0.21.5` came out 2026-10-26, there were commits on 2026-10-28/29, and npm shows 855,564 weekly downloads. — [WXT repo](https://github.com/wxt-dev/wxt), [WXT releases](https://github.com/wxt-dev/wxt/releases), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/wxt)
- **WXT's own comparison table** (WXT-authored, so possibly biased). — [WXT compare](https://wxt.dev/guide/resources/compare)
  - Plasmo is marked 🟡 Maintained: "Appears to be in maintenance mode with little to no maintainers nor feature development happening".
  - CRXJS is marked 🟡, pointing to "crxjs/chrome-extension-tools#974".
  - Only WXT and Plasmo create extension ZIPs and offer automated publishing.
  - CRXJS ❌ "Respects Content Script run_at" because "ESM-style loaders run asynchronously".
  - Plasmo's UI HMR is "React only", and its framework support is "Only React, Vue, and Svelte".
  - Outdated: footnote 3 says CRXJS "v2 stable hasn't been released yet". That is no longer true; see the CRXJS release line below.
- **WXT MAIN-world scripts.** — [WXT content scripts](https://wxt.dev/guide/essentials/content-scripts)
  - Declared with `defineContentScript({ world: 'MAIN' })`. The `world` option "Doesn't support MV2", and "Main world content scripts don't have access to the extension API".
  - WXT recommends `injectScript`, which works on MV2/MV3 and all browsers. On MV3 it is synchronous, so the script runs in step with the content script's `run_at`.
- **Plasmo:** MIT, 13,168 stars. Latest release v0.90.5 on 2025-05-17 (previously v0.90.2 on 2025-02-09). The last commits on the main branch are dated 2025-05-17. npm shows 477,150 weekly downloads. — [Plasmo repo](https://github.com/PlasmoHQ/plasmo), [releases](https://github.com/PlasmoHQ/plasmo/releases), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/plasmo)
- Plasmo issue #1345 (opened 2026-02-07, still open, 9 comments): "Is it ready to continue maintenance?… it hasn't been updated in a long time, and there seem to be quite a few bugs left." — [Plasmo #1345](https://github.com/PlasmoHQ/plasmo/issues/1345)
- Plasmo content scripts take `export const config: PlasmoCSConfig`, and `world: "MAIN"` needs Plasmo v0.65.0 or later. The analyzed extension, built with Plasmo, likely uses this. — [Plasmo docs](https://docs.plasmo.com/framework/content-scripts)
- **CRXJS (`@crxjs/vite-plugin`):** 4,180 stars. — [CRXJS repo](https://github.com/crxjs/chrome-extension-tools), [CRXJS releases](https://github.com/crxjs/chrome-extension-tools/releases), [npm](https://www.npmjs.com/package/@crxjs/vite-plugin), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/@crxjs/vite-plugin)
  - GitHub releases: vite-plugin-v2.4.0 (2026-03-16), v2.5.0 and v2.6.1 (2026-06-11), v2.7.0 (2026-06-19).
  - npm latest is 3.0.0 (2026-09-24), with 575,768 weekly downloads.
  - Commits continue through 2026-10-26 ("add Firefox E2E coverage").
- CRXJS issue #695, "CRXJS doesn't work with content script in 'MAIN' world", opened 2023-04-25 and closed 2025-12-07. It was caused by the loader calling `chrome.runtime.getURL`, which does not exist in the MAIN world. — [CRXJS #695](https://github.com/crxjs/chrome-extension-tools/issues/695)
- A search snippet says CRXJS docs state that MAIN-world scripts don't support HMR and need a full reload. The docs page itself (mintlify) now returns HTTP 410, so this is unverified. — [search-result source](https://www.mintlify.com/crxjs/chrome-extension-tools/concepts/content-scripts)
- Discrub Classic used Vite 4 with `@crxjs/vite-plugin ^2.0.0-beta.21`. The current Discrub uses plain Vite with a custom `vite.config.extension.ts`. — [Classic package.json](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/package.json), [current package.json](https://github.com/pratherbytecraft/discrub/blob/HEAD/package.json)

### Inferences
- The extension needs these entrypoints:
  - a MAIN-world `document_start` script on discord.com
  - an isolated content script as a bridge
  - a small service worker
  - a popup
  - an `export.html` tab page
  - optionally, an offscreen document
- WXT maps these to file-based entrypoints, generates the manifest, and zips and publishes. That makes it the lowest-risk choice in October 2026.
- Plasmo concepts translate directly: `export const config` becomes `defineContentScript({...})`, and Plasmo "tabs" pages become WXT unlisted HTML pages.
- If you choose CRXJS, prove on day one that a MAIN-world `run_at: document_start` script runs before Discord's first API call. Both #695 and WXT's "ESM loaders run asynchronously" criticism were problems in older versions.
- Plain Vite (or Rollup with several inputs plus a hand-written `manifest.json`) is fine for about five entrypoints. You give up HMR conveniences and automated ZIP/publish, which a simple npm script can replace.

### Gaps
- No independent build-speed or bundle-size benchmark of the frameworks was found.
- CRXJS #974 (cited by WXT) returned 404 as an issue and was not read; it may be a Discussion.
- CRXJS 3.0.0's changelog was not reviewed.

---

## 4. MV3 constraints and how to work within them

### Takeaway
- **Where the job runs:** run the long export in a visible extension tab, as the analyzed extension's `tabs/Export.html` does. Service workers are killed after 30 s idle, 5 min per event, or a fetch response slower than 30 s, and they have no DOM or `URL.createObjectURL`. Offscreen documents get only `chrome.runtime` and cannot be focused.
- **Network:** with host_permissions, extension pages can call discord.com and cdn.discordapp.com freely. Content scripts are bound by the page's CORS rules (since Chrome 85).
- **Token capture:** this needs a MAIN-world script. The manifest `world` key works from Chrome 111; `registerContentScripts` gained `world` in Chrome 102. Such scripts have no extension API access, and the page can interfere with them.
- **Saving:** stream to disk with `showSaveFilePicker`/`showDirectoryPicker` (Chrome 86+, needs a user gesture). Fall back to `chrome.downloads` (needs the `downloads` permission) or `<a download>` with a same-origin blob URL.
- **Memory:** never build strings near V8's ~1 GiB limit or rely on more than about 2 GB of in-memory blobs.

### Cited Findings
**Service-worker lifetime**
- A service worker is terminated in three cases, and "Receiving an event or calling an extension API resets this timer". — [SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) (page last updated 2023-05-02)
  - "After 30 seconds of inactivity."
  - "When a single request, such as an event or API call, takes longer than 5 minutes to process."
  - "When a fetch() response takes more than 30 seconds to arrive."
- Version history from the same page:
  - Chrome 109: messages from an offscreen document reset the timers.
  - Chrome 110: extension API calls reset the timers.
  - Chrome 114: opening a port no longer resets them.
  - Chrome 116: an active WebSocket extends the lifetime.
  - Chrome 120: alarms can repeat every 30 s.
- The page advises: "avoid keeping your service worker alive indefinitely… design your service worker to be resilient against unexpected termination". — [SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Service workers lack the DOM and `window`, so use the Offscreen API. — [Migrate to SW](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) (2023-03-09)
  - `XMLHttpRequest()` "can't be called from a service worker"; use `fetch()`.
  - `localStorage` is unavailable.
  - Timers "are canceled whenever the service worker is terminated", so use Alarms.
  - For long operations you may periodically call a trivial extension API, but only in exceptional cases. Indefinite lifetimes are reserved for enterprise and education.
- `URL.createObjectURL` is "not available in Service Workers due to its potential to create memory leaks". — [MDN createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)

**Offscreen documents**
- Available from Chrome 109 with the `"offscreen"` permission. — [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) (updated 2026-10-28)
- Reasons include `BLOBS` ("needs to interact with Blob objects"), `WORKERS`, `DOM_PARSER`, `LOCAL_STORAGE`, `IFRAME_SCRIPTING`, `DOM_SCRAPING`, `CLIPBOARD` and others.
- Limits:
  - only one open at a time
  - "The runtime API is the only extensions API supported"
  - "can't be focused"
  - only `AUDIO_PLAYBACK` has a lifetime limit (closes after 30 s without audio)

**Host permissions and CORS**
- Service workers and foreground pages "can talk to remote servers outside of its origin, as long as the extension requests host permissions". — [Network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- "Cross-origin requests are always treated as such in content scripts, even if the extension has host permissions." Message handlers should restrict which resources can be fetched rather than accept arbitrary URLs. — [Network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- The content-script CORS change "started in Chrome 85". Do cross-origin fetches from the background instead. A relay that fetches any URL is "effectively acting as an open proxy". — [Chromium: content-script fetches](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/)

**MAIN vs isolated world**
- Scripting API. — [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
  - `ExecutionWorld.MAIN` is "the execution environment shared with the host page's JavaScript".
  - `RegisteredContentScript.world` arrived in Chrome 102; `registerContentScripts` in Chrome 96.
  - `persistAcrossSessions` defaults to true.
  - It requires the `"scripting"` permission plus host permissions.
- Manifest `content_scripts`. — [Manifest content_scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) (2023-08-10)
  - `world` (ISOLATED | MAIN) and `run_at` (`document_start` | `document_end` | `document_idle`).
  - Warning: "There are risks involved when using the 'MAIN' world… The host page can access and interfere with the injected script."
- A Chromium Extensions forum reply says Chrome 111 implemented `world` in manifest.json; older versions ignored it. This comes from a search result and the thread was not read in full. — [Chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/_zKyp9XvIzY)
- MAIN-world scripts have no extension API access. — [WXT docs](https://wxt.dev/guide/essentials/content-scripts)

**Saving files**
- `chrome.downloads`. — [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) (updated 2026-10-28)
  - Needs the `"downloads"` permission.
  - `filename` is "relative to the Downloads directory… possibly containing subdirectories". Absolute paths or `..` cause errors.
  - `conflictAction` is `uniquify`, `overwrite` or `prompt`; `saveAs` opens a file chooser.
  - The page says nothing about `blob:` URLs.
- `<a download>` "only works for same-origin URLs, same-origin `blob:`, and `data:` schemes". — [MDN `<a>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a)
- File System Access pickers. — [MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker), [BCD Window.json](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json), [BCD FileSystemWritableFileStream.json](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemWritableFileStream.json)
  - `showSaveFilePicker` and `showDirectoryPicker` exist in Chrome 86+ and not in Firefox or Safari (BCD: experimental).
  - They need a secure context and "Transient user activation"; otherwise a `SecurityError` is thrown.
  - `FileSystemWritableFileStream`: Chrome 86, Firefox 111, Safari 26.
- Community answers (secondary, unverified):
  - A popup is destroyed when it loses focus, so call pickers from a full extension tab. — [Stack Overflow mirror](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/70294433/keeping-filesystemdirectoryhandle-object-in-chrome-extension)
  - A 2022 thread discourages using the API in popups. — [Chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/dXVaSBAfXGM)

**Memory and storage limits**
- Blob storage limits. — [Chromium blob storage README](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md)
  - In memory: "2GB" on 64-bit desktop (not ChromeOS/Android). ChromeOS gets RAM/5 and Android RAM/100.
  - Disk: `disk_size / 10` on desktop.
  - When memory fills, blobs are paged to disk.
- V8's maximum string length is 2^29 − 24 (~1 GiB) on 64-bit; going past it throws `RangeError: Invalid string length`. — [MDN String length](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length)
- MDN puts the 64-bit `ArrayBuffer` maximum at 2^33 (8 GiB), mentioned alongside Firefox 89. Chrome's exact limit is unconfirmed. — [MDN invalid array length](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_array_length)
- `chrome.storage`. — [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
  - `storage.session` is in-memory, "will not be persisted to disk", and is cleared on reload, update or restart. It holds 10 MB (1 MB in Chrome ≤111) and is not exposed to content scripts by default (`setAccessLevel` changes that).
  - `storage.local` holds 10 MB unless `unlimitedStorage` is requested.
  - "If you're working with sensitive user data, instead use storage.session."
- In Chromium, an origin may store "up to 60% of the total disk size", and Chrome uses at most 80% of the disk overall. Going over quota in IndexedDB, Cache or OPFS throws `QuotaExceededError`. — [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

### Inferences
Proposed architecture for an empty project, mirroring what the analyzed extension does and the documented rules:
1. **MAIN-world script** (`run_at: document_start`, `https://discord.com/*`). It observes the `authorization` header on Discord's own requests (as the analyzed extension does) and hands it to an isolated-world bridge script.
   - Use `window.postMessage` or a CustomEvent and check `event.source === window`.
   - Never put the token in the DOM; the analyzed extension's DOM-attribute handoff exposes it to any page script.
   - Offer a fallback where the user pastes a token.
2. **Bridge script** sends the token with `chrome.runtime.sendMessage` to the service worker, which stores it in `chrome.storage.session`, not `local`.
3. **Popup or action click** opens `chrome.tabs.create({url: 'export.html?channel=…'})`. The tab page does all the work:
   - date pickers, converting dates to snowflakes
   - the omega-bounded paging loop with header-driven waits
   - attachment downloads with small concurrency (2–4)
   - writing output through FSA streams
   The service worker only routes messages.
4. **host_permissions:**
   - Required: `https://discord.com/*` and `https://cdn.discordapp.com/*`.
   - Probably also `https://media.discordapp.net/*`, because DCE treats it as a Discord media host. The analyzed extension lacks it, which may break proxied or embedded media.
5. **Permissions:**
   - Need: `storage`, `scripting` (only if registering scripts at runtime).
   - Only if used: `downloads` (for the `chrome.downloads` fallback), `offscreen` (only if needed).
   - Drop: `tabs` (not needed for `chrome.tabs.create`); `identity` (unless used for sign-in).
6. **Never build one giant string.** Write HTML and JSON in chunks (one per message group or partition), staying far below the ~1 GiB string limit. Prefer streaming over large in-memory blobs (~2 GB in-memory cap).
7. **Make the job resumable.** Checkpoint the last exported message ID and the list of downloaded assets in IndexedDB/OPFS, so a closed tab or crash can resume. Show a `beforeunload` warning while an export is running.

### Gaps
- No official Chrome doc states that extension tab pages are free of the service worker's idle limits; this is inferred from the limits being specific to service workers.
- The effect of Chrome's Memory Saver or tab discarding on an extension tab running a long export was not verified.
- Whether `showDirectoryPicker` can be used from an offscreen document (which has no user activation) is undocumented.
- Whether `chrome.downloads.download` accepts `blob:` URLs created in extension pages is not stated in the docs.
- Chrome's exact `ArrayBuffer` cap is unconfirmed.

---

## 5. Zipping very large exports in the browser and streaming to disk

### Takeaway
For multi-GB exports, use a streaming ZIP writer with ZIP64 that writes straight into a `FileSystemWritableFileStream`.
- **zip.js** (BSD-3, ZIP64, workers, native CompressionStream, releases every few weeks): best fit.
- **client-zip** (MIT, 2.6 kB gz, streaming, ZIP64 when needed, store-only): also a good fit.
- **fflate** (MIT) is the fastest compressor and has streaming ZIP, but it advertises "files up to 4GB" and has an open issue about more than 65,535 files.
- **JSZip** holds the whole result in memory and can only read ZIP64 if it isn't "too big". Avoid it for large exports.
- **conflux** (Discrub's choice) has no ZIP64.

Media is usually already compressed, so STORE (level 0) is the sensible default.

### Cited Findings
- **fflate:** "High performance (de)compression in an 8kB package"; ZIP archiving costs "an extra 3 kB". — [fflate README](https://github.com/101arrowz/fflate), [releases](https://github.com/101arrowz/fflate/releases), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/fflate)
  - README table: streaming ✅, "Supports files up to 4GB" ✅, "Streaming ZIP support" ✅.
  - Latest v0.8.3 (2026-05-16), previously v0.8.2 (2024-02-07). MIT. About 115.6M weekly npm downloads.
- fflate issues:
  - #229 "zip does not support >65,535 files" (opened 2025-01-27, open). — [fflate #229](https://github.com/101arrowz/fflate/issues/229)
  - #81 "Support adding files larger than 4GB" (closed 2021; resolution not checked). — [fflate #81](https://github.com/101arrowz/fflate/issues/81)
  - #298 ZIP64 sentinel bug in `unzipSync` (2026-09-24, open). — [fflate #298](https://github.com/101arrowz/fflate/issues/298)
- **client-zip.** — [client-zip README](https://github.com/Touffy/client-zip), [npm](https://www.npmjs.com/package/client-zip)
  - Concatenates files into a ZIP "in the browser"; it "does not compress".
  - "6.4 kB minified, 2.6 kB gzipped", and its author says it is "40 times faster than the old JSZip".
  - v2 "will generate Zip64 archives" when needed, always marking "ZIP version 4.5", so "not readable by every ZIP reader".
  - `downloadZip` returns a `Response` immediately; `makeZip` returns a `ReadableStream`.
  - Inputs: File, Blob, Response or ReadableStream.
  - It can predict Content-Length from metadata, works in a ServiceWorker, and needs ES2020 BigInt.
  - Latest 2.5.1 (2026-09-14). MIT.
- client-zip's own benchmarks ("updated in may 2023", M1 Pro, Blob output, no compression; old library versions and author-run, so treat with care). — [client-zip README](https://github.com/Touffy/client-zip)

  | Chrome test | client-zip | fflate | zip.js | conflux | JSZip |
  |---|---|---|---|---|---|
  | 4 files, 539 MB | 2.48 s | 1.60 s | 4.25 s | 4.27 s | 3.92 s |
  | 12,044 fetched files, 130 MB | 4.60 s | 3.97 s | 7.51 s | 3.81 s | 6.30 s |

- **zip.js.** — [zip.js README](https://github.com/gildas-lormeau/zip.js), [releases](https://github.com/gildas-lormeau/zip.js/releases)
  - BSD-3-Clause, "designed to handle large amounts of data".
  - Features: "multi-core compression, native compression with compression streams… archives larger than 4GB with Zip64, split zip files, data encryption, incremental writing".
  - `ZipWriter` writes into a `WritableStream`.
  - Custom web workers via `new Worker(new URL(...), import.meta.url)`, which bundlers pick up.
  - Releases: 2.22.0 (2026-09-30), 2.23.0 (2026-10-03), 2.24.0 (2026-10-16). About 7.0M weekly npm downloads.
- **JSZip.** — [JSZip limitations](https://github.com/Stuk/jszip/blob/main/documentation/limitations.md), [npm](https://www.npmjs.com/package/jszip)
  - `generateAsync` and `async` "hold the full result in memory". The alternatives are `generateNodeStream` or a `StreamHelper` with `pause()`/`resume()`.
  - "ZIP64 files can be loaded, but only if the zip file is not 'too big'". Strings are UTF-16, so text takes double the memory.
  - License "(MIT OR GPL-3.0-or-later)"; 3.10.2 (2026-09-08).
- **conflux:** a streams-based writer of about 55 kB; ZIP64 issue #8 is open. — [conflux](https://github.com/transcend-io/conflux), [conflux #8](https://github.com/transcend-io/conflux/issues/8)
- **StreamSaver.js** (used by Discrub Classic): repo active, last push 2026-07-30. — [StreamSaver.js](https://github.com/jimmywarting/StreamSaver.js)
- `FileSystemWritableFileStream` is available in Chrome 86+, and the pickers require a user gesture. — [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemWritableFileStream.json), [MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)

### Inferences
- **Recommended path.** The user clicks "Export" in the tab, which calls `showSaveFilePicker({suggestedName: '<channel>_<from>_<to>.zip'})`, then `handle.createWritable()`, and pipes the ZIP stream into it.
  - With zip.js: `new ZipWriter(writable)`, then `add(name, ReadableStream, {level: 0})` for media and `level: 6` for HTML/JSON.
  - With client-zip: `makeZip(asyncGenerator).pipeTo(writable)`.
  - Feed media as `fetch(url).body` streams, so no file is fully buffered.
- **Even simpler: skip ZIP.** Use `showDirectoryPicker` and write `export/index.html` plus `export/media/<name>-<hash>.<ext>` directly. Users can open the HTML immediately. This also allows DCE-style "reuse media" by checking existing files before downloading.
- **Fallback without FSA** (for a Firefox port or a refused picker): partition the export into parts under 2 GB, build each ZIP as a Blob, and save it with `chrome.downloads` or `<a download>`.

### Gaps
- No independent 2025–2026 benchmarks were found. The client-zip numbers date from 2023 and older versions.
- It is unconfirmed whether fflate's streaming `Zip` now writes ZIP64 (#81's closure reason was not checked).

---

## 6. Rendering a self-contained HTML export

### Takeaway
Two proven patterns exist:
- **Pre-rendered static HTML** streamed in author groups and split into partitions. DCE does this with Razor and a custom markdown parser; Discrub Classic does it with `renderToString` and "messages per page".
- **JSON plus a viewer app.** DCE-frontend does this, and it needs extra infrastructure (Docker).

For an extension, chunked static HTML is the simpler choice:
- inline CSS, tiny inline JS, `loading="lazy"` media, `content-visibility: auto`
- partition by count or size, plus a raw `messages.json` for fidelity

For Discord-flavoured markdown in JS, `discord-markdown-parser` (Apache-2.0, built on simple-markdown, AST output) is the maintained option. `discord-markdown` is stale (2021), and `discord-markdown-ast-parser` is a Python package.

### Cited Findings
- DCE writes minified HTML incrementally per author group (Razor/RazorBlade and WebMarkupMin), groups messages within 7 minutes, and partitions by count or size. Without `--media`, its HTML references CDN JS, CSS and fonts. — [HtmlMessageWriter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/HtmlMessageWriter.cs), [PreambleTemplate.cshtml](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/PreambleTemplate.cshtml), [MessageExporter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/DiscordChatExporter.Core/Exporting/MessageExporter.cs)
- Discrub Classic renders React message components to strings with `renderToString`, highlights code with highlight.js, and splits output by a "messages per page" setting. — [export-slice.tsx](https://github.com/pratherbytecraft/discrub-ext/blob/HEAD/src/features/export/export-slice.tsx)
- DCE-frontend shows the JSON-plus-viewer model: "Optimized to handle really large exports well", with search. It needs JSON exports with `--markdown false` and runs as a Docker app. — [DCEF README](https://github.com/slatinsky/DiscordChatExporter-frontend)
- **discord-markdown-parser** (ItzDerock). — [README](https://github.com/ItzDerock/discord-markdown-parser), [npm](https://www.npmjs.com/package/discord-markdown-parser), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/discord-markdown-parser)
  - "based on the simple-markdown library, which is the same technology discord use".
  - "Designed to be used for discord-html-transcripts".
  - Parses into an AST and supports links, block quotes, inline quotes, code blocks, inline code, italics, spoilers, timestamps, bold, strikethrough, underline, channel/user/role mentions, @everyone/@here, emojis, slash-command mentions and guild-navigation mentions.
  - Has `normal` and `extended` (webhook/embed) modes and extendable rules.
  - TypeScript, Apache-2.0; 1.3.1 (2025-12-23); about 19.9k weekly downloads.
- **simple-markdown.** — [ariabuckles/simple-markdown](https://github.com/ariabuckles/simple-markdown), [@khanacademy/simple-markdown](https://www.npmjs.com/package/@khanacademy/simple-markdown)
  - `Khan/simple-markdown` now redirects to ariabuckles/simple-markdown, last pushed 2023-03-01; the old `simple-markdown` npm package is 0.7.3 (2021-01-08).
  - The maintained fork is `@khanacademy/simple-markdown` 4.0.2 (2026-10-27), in the Khan/perseus monorepo (`packages/simple-markdown`), MIT.
- **discord-markdown** (brussell98). — [README](https://github.com/brussell98/discord-markdown), [npm](https://www.npmjs.com/package/discord-markdown)
  - `toHTML()` output; fenced code includes highlight.js classes; options `embed`, `escapeHTML`, `discordOnly`, `discordCallback`.
  - npm 2.5.1 dates from 2021-09-17 (repo last pushed 2024-07-29), so it is stale.
- **discord-markdown-ast-parser** is a Python package (PyPI 1.0.6, MIT, w4rum) and not usable in a JS extension. — [GitHub](https://github.com/w4rum/discord-markdown-ast-parser), [PyPI](https://pypi.org/project/discord-markdown-ast-parser/)
- `<img loading="lazy">` "Defers loading the image until it reaches a calculated distance from the viewport". Loading "is only deferred when JavaScript is enabled". — [MDN img](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img)
- `content-visibility: auto` skips rendering off-screen descendants. web.dev measured 232 ms → 30 ms (7x) on a demo page. — [web.dev](https://web.dev/articles/content-visibility)
  - Use `contain-intrinsic-size` placeholders.
  - Supported in Chrome 85, Firefox 125 and Safari 18; Baseline since 2025-09-15.
- DCE 2.48 changed HTML exports to show only http(s) URLs as links. — [Release 2.48](https://github.com/Tyrrrz/DiscordChatExporter/releases/tag/2.48)
- V8 strings are capped at ~1 GiB. — [MDN String length](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length)

### Inferences
- **Recommended output structure:**
  - `index.html`: channel header, date range, links to parts.
  - `part-001.html`…: for example 5,000 messages or about 20 MB each.
  - `messages.json`: raw API message objects, which future-proofs the export and allows re-rendering.
  - `media/`
- **Each HTML part should be fully self-contained:**
  - inline CSS
  - a few lines of inline JS for spoilers and jump-to-reply
  - bundled highlight.js styles or pre-highlighted code
  - no CDN references, so it works offline indefinitely
- Render through a markdown AST (`discord-markdown-parser`) into escaped HTML. Resolve mentions from a pre-built map of users, roles and channels. Only linkify `http(s)` URLs.
- Use `loading="lazy"` and `decoding="async"` on images and `preload="none"` on videos. Apply `content-visibility: auto` to message groups so 10k-message parts stay smooth.
- Avoid a viewer that `fetch()`es JSON from `file://`. Browsers commonly block file-URL fetches; this was not verified here. If a viewer is wanted, embed JSON chunks in `<script type="application/json">` tags instead.

### Gaps
- No benchmark comparing static HTML with JSON-plus-viewer for 100k+ messages was found.
- Browser behaviour for `fetch()` from `file://` pages was not verified in this research.
- The highlight.js license and bundle size for local inclusion were not checked.

---

## 7. Chrome Web Store publishing: fee, review, policies, rejection or takedown risk, precedents

### Takeaway
- **Fee:** a one-time registration, US$5 per 2020 reporting. The official page says "one-time" without naming an amount.
- **Review:** "within a few days, but… up to a few weeks". It takes longer for new developers, new items and dangerous or broad permissions.
- **Policy obligations.** An extension that reads the user's Discord token and messages handles "authentication information" and "personal communications". It therefore needs:
  - a privacy policy and accurate Privacy-practices disclosures, even when everything stays local
  - Limited Use compliance
  - per-permission justifications
  - a narrow single purpose
  - no remote code
- **Biggest external risk: Discord.** Its Terms forbid unauthorised scraping and software; it banned Spy.pet-linked accounts in 2024; DCE users report temporary penalties in 2026.
- **No precedent found of Google removing a personal Discord exporter.** Discrub (~200k users, Featured) and the analyzed extension (~20k users) are both live.

### Cited Findings
- Registration: developers must "pay a one-time registration fee". The developer email cannot be changed after account creation. — [CWS Register](https://developer.chrome.com/docs/webstore/register) (2024-02-13)
- On 2020-03-12, 9to5Google reported the "$5 registration fee", now charged immediately at registration. — [9to5Google](https://9to5google.com/2020/03/12/chrome-web-store-fee/)
- Review process. — [CWS review process](https://developer.chrome.com/docs/webstore/review-process) (2021-12-10, old)
  - "For most extensions, review is completed within a few days, but it can take up to a few weeks"; contact support after 3 weeks.
  - Review takes longer for "new developers", "new extensions", "dangerous permission requests", "significant code changes", broad host permissions and sensitive execution permissions.
  - "Obfuscation is disallowed".
  - Rejection emails name the violated policy and explain how to appeal.
- Single purpose: "An extension must have a single purpose that is narrow and easy to understand." — [Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) (2024-07-10)
- Limited Use. — [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) (2022-11-01)
  - "Limit your use of user data to providing or improving your single purpose"; selling or other transfers are "completely prohibited".
  - No human reading of data except with explicit consent, for security, or under law.
  - An affirmative compliance statement must appear on the extension's website.
- User data FAQ. — [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
  - User data includes "Authentication information (such as logins, password, and authentication cookies)" and "Personal communications".
  - Extensions must "disclose how they handle user data, even when data is processed or stored locally"; any product handling user data needs a privacy policy.
  - Prominent disclosure must appear in the extension's UI, not only in the privacy policy.
  - Transmission must use "HTTPS, WSS".
- Privacy practices tab. — [Privacy practices tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) (2020-06-12)
  - Fields: single-purpose description, a justification for each permission, a remote-code declaration ("Extensions that call remote code and do not declare and justify it… will be rejected"), data-use disclosures with certification, and a privacy policy URL.
  - Broader-than-needed permissions "may cause your extension to be rejected".
- MV3 remote code rules. — [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) (2024-04-03)
  - "the full functionality of an extension must be easily discernible from its submitted code".
  - Banned: external `<script>`, `eval` of fetched strings, and interpreters for remote commands.
  - Allowed: fetching data, configuration and images.
- Discord Terms (effective 2025-09-29). — [Discord Terms](https://discord.com/terms)
  - Prohibited: "scraping our services without our written consent, including by using any robot, spider, crawler, scraper"; "using any unauthorized software designed to modify the services"; "selling, licensing, or otherwise commercializing content or data obtained from our services".
  - Discord "reserve[s] the right to suspend or terminate your account".
- Discord's self-bot article could not be fetched (HTTP 403). Search snippets attribute to it that self-bots violate Discord's API Terms and that Discord has "implemented a number of methods to detect this kind of abuse". — [Discord support: self-bots](https://support.discord.com/hc/en-us/articles/115002192352)
- DCE's docs quote the consequence as possible "account termination". — [Token-and-IDs.md](https://github.com/Tyrrrz/DiscordChatExporter/blob/HEAD/.docs/Token-and-IDs.md)
- Precedent: on 2024-04-26 Kotaku reported that Spy.pet had mined "billions of Discord messages from nearly 620 million users" and sold access. Discord banned the linked accounts and was "considering legal action". A spokesperson said "scraping its services and self-botting are violations" of the Terms and Community Guidelines. — [Kotaku](https://kotaku.com/discord-spy-pet-ban-minecraft-among-us-runescape-users-1851439154)
- Account penalties reported by DCE users in 2026 (anecdotal): a two-day "Platform Manipulation" restriction, and a Community Guidelines email. — [DCE Discussion #889](https://github.com/Tyrrrz/DiscordChatExporter/discussions/889)
- Live comparable listings: Discrub (~200,000 users, Featured, updated 2026-10-27) and Discord Chat Export Tool (~20,000 users, updated 2026-09-03). Both declare no data collection. — [Discrub CWS](https://chromewebstore.google.com/detail/discrub/plhdclenpaecffbcefjmpkkbdpkmhhbj), [Discord Chat Export Tool CWS](https://chromewebstore.google.com/detail/lmoceiadfbnpofjbmgemloenlfkhhbhl)
- Context: Google and Microsoft removed 19 extensions in 2025 that were "retrofitted with malicious code" to steal credentials and tokens. This comes from a search summary and the article was not read. — [PCWorld](https://www.pcworld.com/article/3224561/19-chrome-extensions-were-secretly-stealing-data-uninstall-these-now.html)

### Inferences
- **Lower Google-side risk:**
  - Keep all processing local, with no servers receiving tokens or messages.
  - Store the token only in `storage.session`.
  - Show a clear in-app disclosure ("your Discord token is used only to request your messages from discord.com and never leaves your browser") with consent before first use.
  - Publish a short privacy policy and declare "Authentication information" and "Personal communications" in the Privacy tab, with "not transmitted".
  - Request only the permissions you need and justify each one.
  - Do not obfuscate; minify only.
  - Single-purpose statement: "Export Discord conversations you can access, for a chosen date range, to local files".
- **Lower Discord-side risk** (rate-limit-respecting practices only):
  - Make every export explicitly user-initiated and scoped to one conversation and date range.
  - Send requests one at a time, honour `X-RateLimit-*` and `retry_after`, and add a small fixed delay between pages.
  - Do not crawl many channels in parallel.
  - Show a ToS warning like DCE's.
  - Offer a bot-token mode for server owners, as DCE does.
- Reusing DCE's MIT code inside a paid extension is permitted with attribution. The README's political "Terms of use" is a separate reputational and legal consideration.

### Gaps
- Google no longer states the fee amount on an official page; $5 rests on 2010/2020 reporting.
- No official review-time statistics have been published.
- No specific case was found of Google removing a Discord export extension, or of Discord acting against Discrub or similar personal exporters.
- Discord's brand and trademark rules for using "Discord" in an extension name or icon were not researched.
- The exact text of Discord's self-bot support article is unverified (403).

---

## 8. Costs: what is free vs paid, and whether any LLM or paid service is needed

### Takeaway
Building and running this extension can cost almost nothing:
- The frameworks and libraries are open source (MIT, BSD-3 and Apache-2.0).
- No hosting is needed when everything runs locally against Discord's API.
- The only mandatory fee is the one-time Chrome Web Store registration (US$5).

Money only enters if you monetize, for example ExtensionPay (5% per transaction) plus Stripe processing (2.9% + 30¢ for domestic cards), or a small licensing backend like Discrub's "supporter key" check. None of the reference tools needs an LLM or other paid API. "LLM-ready" exports seen in small repos are just text formats.

### Cited Findings
- **Library licenses (all free):**
  - WXT MIT; Plasmo MIT; `@crxjs/vite-plugin` MIT (npm) — [WXT](https://github.com/wxt-dev/wxt), [Plasmo](https://github.com/PlasmoHQ/plasmo), [npm CRXJS](https://www.npmjs.com/package/@crxjs/vite-plugin)
  - fflate MIT; client-zip MIT; zip.js BSD-3-Clause; JSZip "(MIT OR GPL-3.0-or-later)" — [fflate](https://github.com/101arrowz/fflate), [client-zip](https://github.com/Touffy/client-zip), [zip.js](https://github.com/gildas-lormeau/zip.js), [npm jszip](https://www.npmjs.com/package/jszip)
  - discord-markdown-parser Apache-2.0; `@khanacademy/simple-markdown` MIT — [discord-markdown-parser](https://github.com/ItzDerock/discord-markdown-parser), [npm](https://www.npmjs.com/package/@khanacademy/simple-markdown)
- **Chrome Web Store:** a one-time registration fee, reported as $5. — [CWS Register](https://developer.chrome.com/docs/webstore/register), [9to5Google](https://9to5google.com/2020/03/12/chrome-web-store-fee/)
- **ExtensionPay.** — [ExtensionPay](https://extensionpay.com/)
  - "5% transaction fee at time of charge"; no monthly fees, no up-front costs, "No credit card required"; money is "paid directly to your Stripe account".
  - Supports monthly, quarterly and yearly subscriptions, one-time payments, free trials and email-link login.
  - Users may see a prompt that the extension "can read and change your data on extensionpay.com".
- **Stripe:** "2.9% + 30¢" per successful domestic card transaction, "+ 1.5%" for international cards, "+ 1%" if currency conversion is needed; "no setup fees, monthly fees". — [Stripe pricing](https://stripe.com/pricing)
- **Comparable monetization:** Discrub's optional supporter key is sent to `api.pratherbytecraft.com` about once a day, a minimal licensing backend. The analyzed extension "Offers in-app purchases". — [Discrub CWS](https://chromewebstore.google.com/detail/discrub/plhdclenpaecffbcefjmpkkbdpkmhhbj), [Discord Chat Export Tool CWS](https://chromewebstore.google.com/detail/lmoceiadfbnpofjbmgemloenlfkhhbhl)
- **No AI in the reference tools' feature lists:**
  - DCE: export, partition, filter, media download. — [DCE README](https://github.com/Tyrrrz/DiscordChatExporter)
  - Discrub: edit/delete, sort/filter, export HTML/CSV/JSON. — [Discrub README](https://github.com/pratherbytecraft/discrub-ext)
- Small repos advertise "LLM-readable transcripts (Transcript + JSONL)" and "TOON… & JSON" output formats. — [discord-dm-export](https://github.com/akashthemagnificent-ux/discord-dm-export), [discord-chat-exporter-extension](https://github.com/domz-1/discord-chat-exporter-extension)

### Inferences
- **Minimum budget:** US$5 plus developer time. The privacy policy can be a static page on any free host (not researched).
- **Illustration:** for a US$5 one-time purchase through ExtensionPay and Stripe (domestic card), the fees come to about 0.25 + 0.145 + 0.30 ≈ US$0.70, or about 14%. This assumes the ExtensionPay fee is charged on top of Stripe's fee, which is not stated explicitly. Fixed per-transaction fees make very low prices inefficient.
- **No common export feature needs an LLM or paid API.** Fetching, rendering, markdown, zipping and saving are all handled by free local libraries. An "AI summary" would be an optional add-on with its own API costs and new CWS data-transfer disclosures, because the messages would leave the device.
- **The analyzed extension's `identity` permission** may serve sign-in for in-app purchases. This is speculation; verify in the code analysis. A purely local free tool does not need it.

### Gaps
- No current official Chrome page states the $5 fee amount.
- ExtensionPay's exact fee stacking with Stripe, and any extension permission it requires, were not verified beyond its homepage.
- The status of Chrome Web Store's own (legacy) payments was not researched.
