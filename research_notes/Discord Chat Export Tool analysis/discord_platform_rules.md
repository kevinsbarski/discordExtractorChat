# Discord Platform Rules for Chat-History Exporters (messages + attachments, date-ranged, from a logged-in browser session) — as of 29 Oct 2026

Research method note (applies to all sections): official developer docs were read from the source of discord.com/developers/docs, the `discord/discord-api-docs` GitHub repo at `main` (last pushed 2026-10-29). Help-Center and policy texts were read as full article bodies through Discord's public Zendesk Help Center API on 2026-10-29. The discord.com Terms, Guidelines, Privacy and Platform-Manipulation pages were downloaded on the same day. No Discord account was used and no Discord API endpoint was called. The only request to Discord infrastructure was one header-only check of a public static CDN image, reported in the attachments section. "Unofficial" marks material from community reverse-engineering docs (docs.discord.food / discord-userdoccers) or from third-party tools. Discord does not endorse those sources.

## 1. Message-fetching endpoints: Get Channel Messages, message search, permissions, API versions

### Takeaway
`GET /channels/{id}/messages` is the core export primitive. It accepts one of `around`/`before`/`after` plus `limit` (1–100, default 50) and always returns newest-to-oldest. It needs `VIEW_CHANNEL`, and without `READ_MESSAGE_HISTORY` it returns no messages. Discord officially documented message search (`GET /guilds/{id}/messages/search`) for bots on 19 March 2026. It returns 25 results per page, allows offsets up to 9,975, supports `min_id`/`max_id` snowflake bounds and may answer 202 "index not yet available". The web client uses API v9. v10 is the latest version, and DiscordChatExporter calls v10 with user tokens.

### Cited Findings
- Verbatim from the official docs: "Retrieves the messages in a channel. Returns an array of message objects from newest to oldest on success." — [Discord Docs: Get Channel Messages](https://discord.com/developers/docs/resources/message#get-channel-messages)
- Permissions, verbatim: "If operating on a guild channel, this endpoint requires the current user to have the `VIEW_CHANNEL` permission. If the channel is a voice channel, they must _also_ have the `CONNECT` permission. If the current user is missing the `READ_MESSAGE_HISTORY` permission in the channel, then no messages will be returned." This means missing history permission produces an empty array, not a 403. — [Discord Docs: Get Channel Messages](https://discord.com/developers/docs/resources/message#get-channel-messages)
- Query parameters are `around?`, `before?` and `after?` (snowflakes) and `limit?`, described as "Max number of messages to return (1-100)" with default 50. Verbatim: "The `before`, `after`, and `around` parameters are mutually exclusive, only one may be passed at a time." — [Discord Docs: Get Channel Messages query params](https://discord.com/developers/docs/resources/message#get-channel-messages-query-string-params)
- Get Channel Message (a single message) requires both `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY`. — [Discord Docs: Get Channel Message](https://discord.com/developers/docs/resources/message#get-channel-message)
- DiscordChatExporter (DCE) is the de-facto reference exporter. Its client pages with `limit=100` and `after=<boundary>`, starting from `Snowflake.Zero` when no start date is given. It reverses each batch because, in its own code comment, "Messages in batches are always returned from newest to oldest". It explains its range handling this way: "Because Discord API doesn't allow us to provide both 'after' and 'before' parameters at the same time, we have to establish at least one end of the boundary manually". It does that by first fetching the last message before the end bound with `limit=1&before=`. — [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- DCE's base URI is `https://discord.com/api/v10/`. It sends a user token as the raw `Authorization` value and a bot token as `Bot <token>`. — [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- **Search (official, new in 2026):** the Change Log entry for March 19, 2026 says: "We've added documentation for the Search Guild Messages endpoint, which allows bots to search for messages within a guild using a variety of filters… This endpoint requires the `READ_MESSAGE_HISTORY` permission and the `MESSAGE_CONTENT` Privileged Intent." It also added error code `110000`. — [Discord Docs: Change Log (March 19, 2026)](https://discord.com/developers/docs/change-log)
- Search Guild Messages parameters:
  - `limit` is "1-25, default 25" and `offset` is "max 9975".
  - `max_id` means "Get messages before this message ID" and `min_id` means "Get messages after this message ID".
  - Filters: `content` (max 1024 characters), `channel_id` (max 500), `author_id`, `author_type` (user/bot/webhook), `mentions`, `mentions_role_id`, `mention_everyone`, `replied_to_user_id`, `replied_to_message_id`, `pinned`, `has` (image/sound/video/file/sticker/embed/link/poll/snapshot), `embed_type`, `embed_provider`, `link_hostname`, `attachment_filename`, `attachment_extension` and `include_nsfw` (default false).
  - Sorting: `sort_by` takes timestamp (default) or relevance, and `sort_order` takes asc or desc (default desc).
  - There is no separate calendar-date parameter. Date ranges are expressed as `min_id`/`max_id` snowflakes.
  - Source: [Discord Docs: Search Guild Messages](https://discord.com/developers/docs/resources/message#search-guild-messages)
- Search behaviour, verbatim:
  - "Returns a list of messages without the `reactions` key."
  - "If the entity you are searching is not yet indexed, the endpoint will return a 202 accepted response… `{"message": "Index not yet available. Try again later", "code": 110000, "documents_indexed": 0, "retry_after": 2}`."
  - "search may return slightly fewer results than the limit specified when messages have not been accessed for a long time. Clients should not rely on the length of the `messages` array to paginate results… when messages are actively being created or deleted, the `total_results` field may not be accurate."
  - The response also carries `doing_deep_historical_index`. `messages` is a nested array, and the docs say "surrounding context is no longer returned".
  - Source: [Discord Docs: Search Guild Messages](https://discord.com/developers/docs/resources/message#search-guild-messages)
- Search Embed Types footnote: "Messages sent before February 24, 2026 may not be properly indexed under the `gif` embed type." — [Discord Docs: Search Guild Messages](https://discord.com/developers/docs/resources/message#search-guild-messages-search-embed-types)
- (Unofficial) DMs and group DMs use a separate, user-only route, `GET /channels/{channel.id}/messages/search`. Its description reads "match a search query in the private channel". The guild route is marked as usable by both users and bots. Further routes exist: `/guilds/{id}/messages/search/tabs`, `/channels/{id}/messages/search/tabs` and `/users/@me/messages/search/tabs`. — [docs.discord.food: Messages (Search)](https://docs.discord.food/resources/message#search-guild-messages)
- API versions (official table): v10 and v9 are "Available"; v8, v7 and v6 are "Deprecated"; v6 is still marked as the default when no version is given; v5, v4 and v3 are "Discontinued". — [Discord Docs: API Versioning](https://discord.com/developers/docs/reference#api-versioning)
- (Unofficial) The same table on docs.discord.food marks v9 as "✓ Client", i.e. the default used by the official client. — [docs.discord.food: API Versioning](https://docs.discord.food/reference#api-versioning)
- v9 vs v10 differences that matter to an exporter:
  - v9 added threads. Older versions "will not receive any Gateway Events for threads" (April 28, 2021). — [Discord Docs: Change Log (API v9)](https://discord.com/developers/docs/change-log)
  - v10 (February 14, 2022) requires the message content intent for bots to receive content fields. It decommissioned `GET /channels/{id}/threads/active` in favour of `GET /guilds/{id}/threads/active`, and "Requests to v10 and higher will no longer be supported on `discordapp.com` (this does **not** affect `cdn.discordapp.com`)". — [Discord Docs: Change Log (API v10)](https://discord.com/developers/docs/change-log)
- Message-type versioning, verbatim: "Type `19` and `20` are only available in API v8 and above. In v6, they are represented as type `0`. Additionally, type `21` is only available in API v9 and above." — [Discord Docs: Message Types](https://discord.com/developers/docs/resources/message#message-object-message-types)
- On October 17, 2023 a global rate limit was added for API calls to `discordapp.com/*`. Verbatim: "please make sure you are making calls to `discord.com/*`". — [Discord Docs: Change Log (Oct 17, 2023)](https://discord.com/developers/docs/change-log)
- Official authentication docs list only bot tokens (`Bot …`), OAuth2 bearer tokens and Basic auth for OAuth2 token endpoints. A raw user-session token is not a documented authentication method. — [Discord Docs: Authentication](https://discord.com/developers/docs/reference#authentication)
- **Recent change, channel obfuscation (August 12, 2026, breaking):** verbatim, "Soon, users will be unable to view channels they don't have access to, so we are updating bots to follow the same rule." For bots, `GET /guilds/{guild.id}/channels` "will start omitting channels that your bot lacks `VIEW_CHANNEL` for on November 16, 2026". Over the Gateway, such channels are named `"___hidden___"` and carry the `CHANNEL_OBFUSCATED` flag (`1 << 17`). — [Discord Docs: Change Log (Aug 12, 2026)](https://discord.com/developers/docs/change-log)
- Pins moved to a paginated endpoint on June 25, 2025: `GET /channels/{id}/messages/pins` with `before` (an ISO8601 pin timestamp) and `limit` (1–50), returning `items` and `has_more`. The old `/channels/{id}/pins` routes are deprecated. — [Discord Docs: Get Channel Pins](https://discord.com/developers/docs/resources/message#get-channel-pins)

### Inferences
- An exporter should treat an empty page as "maybe no permission" as well as "no messages", because missing `READ_MESSAGE_HISTORY` yields an empty array rather than an error.
- `before`/`after`/`around` are mutually exclusive and pages are always newest-first. A date-range export therefore needs one bound as the cursor (for example `after=<start snowflake>`), client-side filtering against the other bound, and per-batch re-ordering. This is DCE's approach.
- Search cannot replace full pagination for an archive. Results exclude `reactions`, can be short or stale, cap out at offset 9,975 (25 × 400 = 10,000 hits per query) and need `max_id` windowing for deeper history. For bots it is also gated on `MESSAGE_CONTENT`. Search is mainly useful for locating messages, for example by author or file type.
- A browser extension running inside discord.com that issues `/api/v9/...` requests matches the web client's version (unofficial source). v10 also works for user tokens per DCE. A tool hitting `discordapp.com` would face the extra global limit.
- Once channel obfuscation reaches users, hidden channels will no longer appear in metadata to user sessions either. An exporter should not expect to list or enumerate channels the account cannot view.

### Gaps
- The official docs do not say whether user-account (non-bot) callers are subject to the `MESSAGE_CONTENT` gate on guild search. The intent concept applies to applications. Only unofficial docs describe user-account access.
- I could not confirm from an official source that the current web client still uses v9 rather than v10. Only docs.discord.food states it.
- Exact per-route bucket sizes for `GET /channels/{id}/messages` are not documented. Discord says they must not be hard-coded.

## 2. Snowflakes and date-range mechanics

### Takeaway
A snowflake's top 42 bits are milliseconds since the Discord epoch, 1420070400000 (2015-01-01T00:00:00Z). Discord officially endorses building a pagination bound from a time as `(timestamp_ms − 1420070400000) << 22`. IDs are 64-bit strings, and all date math must be done in UTC epoch milliseconds.

### Cited Findings
- Verbatim: "Timestamp | 63 to 22 | 42 bits | Milliseconds since Discord Epoch, the first second of 2015 or 1420070400000. | `(snowflake >> 22) + 1420070400000`". The remaining bits are worker ID (21–17), process ID (16–12) and increment (11–0). — [Discord Docs: Snowflakes](https://discord.com/developers/docs/reference#snowflakes)
- Verbatim: "snowflake IDs are just numbers with a timestamp, so when dealing with pagination where you want results from the beginning of time (in Discord Epoch, but `0` works here too) or before/after a specific time you can generate a snowflake ID for that time… `(timestamp_ms - DISCORD_EPOCH) << 22`". — [Discord Docs: Snowflake IDs in Pagination](https://discord.com/developers/docs/reference#snowflake-ids-in-pagination)
- Verbatim: "Because Snowflake IDs are up to 64 bits in size (e.g. a uint64), they are always returned as strings in the HTTP API to prevent integer overflows in some languages." — [Discord Docs: Snowflakes](https://discord.com/developers/docs/reference#snowflakes)
- Message `timestamp` and `edited_timestamp` are ISO8601. Discord "utilizes the ISO8601 format… for most Date/Times returned in our models". — [Discord Docs: ISO8601 Date/Time](https://discord.com/developers/docs/reference#iso8601-datetime)
- Markdown timestamps, verbatim: "Timestamps are expressed in **seconds** and display the given timestamp in the user's timezone and locale." Note this is seconds, unlike snowflakes, which use milliseconds. — [Discord Docs: Message Formatting](https://discord.com/developers/docs/reference#message-formatting)
- DCE checks range ends by comparing message timestamps to the snowflake dates. It skips the export when the last message before `before` predates `after`, and it stops when `message.Id > omegaMessage.Id`. — [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)

### Inferences
- Building IDs from calendar dates:
  - Start bound: `after = (Date.UTC(startLocalMidnight→UTC) − 1420070400000) << 22`, minus 1 to be inclusive. A generated snowflake has zero low bits, so `after` with exactly that ID already includes everything created in that millisecond or later.
  - End bound: `before = (endExclusiveUtcMs − 1420070400000) << 22`.
- Use 64-bit integers (BigInt in JavaScript). JavaScript `Number` loses precision above 2^53, and current snowflakes are around 2^60.
- Time-zone pitfalls:
  - A "date" picked in a UI is local. It must be converted to a UTC instant, with DST-aware handling, before snowflake conversion. Otherwise ranges shift by the UTC offset.
  - The ISO8601 `timestamp` should be parsed with its offset.
  - `<t:…>` values are seconds and must not be fed into snowflake math without multiplying by 1000.
  - Edited messages keep their original ID and date. A range filter on snowflakes therefore selects by send time, not edit time.

### Gaps
- None material. The behaviour of `after` with a synthetic ID that exactly equals a real message ID is not documented. The edge case is negligible.

## 3. Rate limits, penalties, and what is known about user-account limits and anti-abuse

### Takeaway
- Discord rate-limits per route (bucketed, keyed on top-level resource IDs) and globally. The documented global limit is 50 requests per second for bots. 429 responses carry `retry_after`, `global` and an optional `code`, plus `Retry-After` and `X-RateLimit-Scope` headers.
- The invalid-request limit is 10,000 responses with status 401, 403 or 429 per 10 minutes per IP, and it triggers a temporary Cloudflare ban.
- User tokens are subject to the same system. Since roughly late February 2026, multiple users report that bulk exports with user tokens trigger automated "platform abuse/spam" enforcement: forced logouts of all devices, password resets and account-standing violations.

### Cited Findings
- Verbatim: "Limits are applied to individual bots and users both on a per-route basis and globally. Individuals are determined using a request's authentication—for example, a bot token for a bot." Also: "**rate limits should not be hard coded into your app**." — [Discord Docs: Rate Limits](https://discord.com/developers/docs/topics/rate-limits)
- Per-route limits "often account for top-level resources within the path… currently limited to channels (`channel_id`), guilds (`guild_id`), and webhooks". This means `/channels/1234` and `/channels/9876` are limited independently. — [Discord Docs: Rate Limits](https://discord.com/developers/docs/topics/rate-limits)
- Headers:
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds), `X-RateLimit-Reset-After` (seconds, may be decimal) and `X-RateLimit-Bucket` are returned on normal responses.
  - "`X-RateLimit-Global` - Returned only on HTTP 429 responses if the rate limit encountered is the global rate limit."
  - "`X-RateLimit-Scope` - Returned only on HTTP 429 responses. Value can be `user` (per bot or user limit), `global` (per bot or user global limit), or `shared` (per resource limit)."
  - Source: [Discord Docs: Rate Limits — Header Format](https://discord.com/developers/docs/topics/rate-limits#header-format)
- 429 body fields: `message` (string), `retry_after` (float, seconds), `global` (boolean), `code?` (integer). Verbatim: "Your application should rely on the `Retry-After` header or `retry_after` field to determine when to retry the request." — [Discord Docs: Rate Limits — Exceeding a Rate Limit](https://discord.com/developers/docs/topics/rate-limits#exceeding-a-rate-limit)
- Verbatim: "All bots can make up to 50 requests per second to our API. If no authorization header is provided, then the limit is applied to the IP address." — [Discord Docs: Global Rate Limit](https://discord.com/developers/docs/topics/rate-limits#global-rate-limit)
- Invalid-request limit, verbatim: "IP addresses that make too many invalid HTTP requests are automatically and temporarily restricted from accessing the Discord API. Currently, this limit is **10,000 per 10 minutes**. An invalid request is one that results in **401**, **403**, or **429** statuses… *429 errors returned with `X-RateLimit-Scope: shared` are not counted against you.*" The docs also mention "(a sustained 16 to 17 requests per second)". — [Discord Docs: Invalid Request Limit aka Cloudflare bans](https://discord.com/developers/docs/topics/rate-limits#invalid-request-limit-aka-cloudflare-bans)
- (Unofficial) The ban "leads to a **24 hour ban**". The official docs say only "temporarily". — [docs.discord.food: Rate Limits](https://docs.discord.food/topics/rate-limits); contrast with [Discord Docs: Rate Limits](https://discord.com/developers/docs/topics/rate-limits)
- (Unofficial) "User authorization _usually_ only returns the **Retry-After**, **X-RateLimit-Global**, and **X-RateLimit-Scope** headers." User tokens therefore usually do not get `X-RateLimit-Remaining`/`Reset-After` to pace against. — [docs.discord.food: Rate Limits](https://docs.discord.food/topics/rate-limits)
- (Unofficial) The `X-Super-Properties` header, a base64 JSON client fingerprint sent by official clients: "While including this header is not required, it is highly recommended due to its significance in anti-abuse systems." — [docs.discord.food: Client Properties](https://docs.discord.food/reference#client-properties)
- The Developer Terms prohibit API use that "(ii) compromises, breaks, or circumvents any of our technical processes or security measures… or (iv) exceeds any API rate, call, or other usage limits we set in our sole discretion… or that we believe constitutes excessive or abusive usage." The Developer Policy adds: "You agree to, and will not attempt to circumvent, such limitations." — [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service); [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- DCE's code comment, verbatim: "Discord has advisory rate limits (communicated via response headers), but they are typically way stricter than the actual rate limits enforced by the server. The user may choose to ignore the advisory rate limits… if they want to prioritize speed over compliance (and safety of their account/bot)."
  - When `Remaining` is 0, DCE waits for `Reset-After` plus 1 second, capped at 60 seconds.
  - Its settings are "Always respect", "Respect for user tokens", "Respect for bot tokens" and "Always ignore".
  - Sources: [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs); [DCE RateLimitPreference.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/RateLimitPreference.cs)
- **2026 enforcement wave, anecdotal (user reports in DCE issue #1497, opened March 1, 2026):**
  - Original report: "it works with a new auth token, but the next time I try - my account is blocked, and I have to reset my password… The reason for the block is because of discords platform abuse - saying that it might be sending spam messages… the last week, this has happened 8 times."
  - Contributor 96-LB: "Using this program with a user token has always been against Discord's terms of service. They seem to be taking measures to enforce it more now, perhaps because of the large amount of people trying to export their data to leave the platform after the latest age verification news."
  - Another contributor: "Export worked for 3 minutes across 14 channels and then all devices were logged out. An abuse notification email and a password reset email was sent to my inbox immediately after."
  - Later commenters report "about 7 violations and a limited and restricted reputation" and "Got 5 violations now" (April 2026).
  - Source: [DCE issue #1497](https://github.com/Tyrrrz/DiscordChatExporter/issues/1497)
- Community attempts to reduce flags included a PR that adds `X-Super-Properties` to user-account requests. It was opened March 15, 2026, and closed August 27, 2026 without being merged (the GitHub API reports `merged_at: null`). A tester reported it "working for a few hours on an account that got disabled twice without this change". — [DCE PR #1510](https://github.com/Tyrrrz/DiscordChatExporter/pull/1510); [DCE issue #1508 (closed as duplicate)](https://github.com/Tyrrrz/DiscordChatExporter/issues/1508)

### Inferences
- A respectful cadence for a user-session exporter:
  - Make one request at a time per channel, with no parallel channel fan-out.
  - Always honour `Retry-After`/`retry_after` and back off exponentially on repeated 429s.
  - Stop immediately on 401 (the token is invalid) and on 403 (no permission). Each one counts toward the 10,000/10-minute invalid-request ban.
  - Stay far below 50 requests per second.
  - Because user tokens often lack `Remaining` headers (unofficial), self-throttling to a few requests per second is the only proactive pacing available.
- Enforcement in 2026 appears to be driven by behaviour and fingerprints (high-volume history reads from a session that does not look like the official client), not only by 429 counts. This is anecdotal.
- An extension that issues requests from inside the real discord.com page inherits the browser's real User-Agent and cookies. That does not make the activity compliant, though: it is still automation of a user account (see section 6). The Developer Terms forbid circumventing "security measures". Adding headers specifically to evade anti-abuse detection would therefore itself be a policy problem.

### Gaps
- Discord publishes no numbers for user-account anti-abuse heuristics. Everything about 2026 detection comes from anecdotal user reports, and none of it is confirmed by Discord.
- I found no official per-route limit for `GET /channels/{id}/messages` or for search, and no documented "messages per day" read ceiling for users.
- I could not verify whether the reported 2026 enforcement actions ("Platform Manipulation"/spam labels) are permanent or escalate. Users report temporary limits, forced logouts and password resets.

## 4. Attachments and CDN: signed URLs, refresh, hosts, size limits, CORS, asset URL formats

### Takeaway
Attachment URLs on `cdn.discordapp.com/attachments/...` are signed with `ex` (expiry, hex Unix time), `is` (issued, hex) and `hm` (signature) query parameters. Discord announced this in October 2023 and enforced it around December 2023. Press reports put validity at about 24 hours. The documented way to get fresh URLs is to re-fetch the message. Clients also use an undocumented `POST /attachments/refresh-urls` (up to 50 URLs per call). Avatars, emoji and stickers use unsigned, non-expiring CDN paths.

The current default upload limit is 20 MiB, raised from 10 MiB in Aug/Sep 2026. Nitro Basic allows 50 MB and Nitro up to 1 GB. Boost Level 2 servers allow 50 MB and Level 3 servers 100 MB.

In an extension, content scripts are bound by the page's CORS rules. The extension's service worker or pages, given host permissions, are not.

### Cited Findings
- Verbatim from the official docs: "Attachments uploaded to Discord's CDN (like user and bot-uploaded images) have signed URLs with a preset expiry time. Discord automatically refreshes attachment CDN URLs that appear within the client, so when your app receives a payload with a signed URL (like when you fetch a message), it will be valid… The standard CDN endpoints listed above are not signed, so they will not expire." Parameter meanings: "ex | Hex timestamp indicating when an attachment CDN URL will expire"; "is | Hex timestamp indicating when the URL was issued"; "hm | Unique signature that remains valid until the URL's expiration". — [Discord Docs: Signed Attachment CDN URLs](https://discord.com/developers/docs/reference#signed-attachment-cdn-urls)
- Introduction and timing:
  - BleepingComputer (November 4, 2023) quotes Discord's developer team: "attachment CDN URLs have 3 new URL parameters: ex, is, and hm", "These changes will roll out later this year", "Any links within the client will be auto refreshed", and "The API will automatically return valid, non-expired URLs when you access resources" containing attachment URLs.
  - The article's own wording, not attributed to Discord, is that links "will expire after 24 hours".
  - Source: [BleepingComputer, Nov 2023](https://www.bleepingcomputer.com/news/security/discord-will-switch-to-temporary-file-links-to-block-malware-delivery)
- (Unofficial) Refresh endpoint: `POST /attachments/refresh-urls` is marked usable by bots. Its JSON parameter is `attachment_urls` ("The URLs of the attachments to refresh (1-50)"), and it returns `refreshed_urls: [{original, refreshed}]`. Verbatim: "The provided URLs do not have to be valid or signed. Existing query string parameters are preserved." — [docs.discord.food: Refresh Attachment URLs](https://docs.discord.food/topics/cloud-uploads#refresh-attachment-urls)
- (Unofficial) Signed-URL refresh "does not apply to URLs present in user-generated content, such as message content or embed descriptions". Pasted CDN links inside message text are not auto-refreshed. — [docs.discord.food: Signed Attachment URLs](https://docs.discord.food/reference#signed-attachment-urls)
- A third-party proxy project describes calling `discord.com/api/v9/attachments/refresh-urls` and reports that expired links return 404 "This content is no longer available" (secondary source). — [useapi.net on DEV Community](https://dev.to/useapi/discord-cdn-proxy-211c)
- DCE's FAQ notes that exported media can disappear unless downloaded. Verbatim: "if media, such as images and user avatars, is changed or deleted, it will no longer be displayed. To avoid this, export using the 'Download media' (`--media`) option." — [DCE Troubleshooting](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Troubleshooting.md)
- Attachment object fields include `id`, `filename`, `title?`, `description?` (alt text), `content_type?`, `size` (bytes), `url`, `proxy_url`, `height?`/`width?`, `placeholder?` (thumbhash), `ephemeral?`, `duration_secs?`, `waveform?`, `flags?` and Clip-related fields. — [Discord Docs: Attachment Object](https://discord.com/developers/docs/resources/message#attachment-object)
- `proxy_url` (media.discordapp.net), verbatim: "The proxy url supports images and videos (which have a defined `width` and `height`) as well as audio files, which are passed through unmodified. For all other attachment types, the proxy returns a `415: Unsupported Media Type` error." — [Discord Docs: Attachment Object](https://discord.com/developers/docs/resources/message#attachment-object-attachment-structure)
- Attachment flags: `IS_CLIP` (1<<0), `IS_THUMBNAIL` (1<<1), `IS_REMIX` (1<<2, deprecated), `IS_SPOILER` (1<<3), `CONTAINS_EXPLICIT_CONTENT` (1<<4), `IS_ANIMATED` (1<<5), `CONTAINS_GORE_CONTENT` (1<<6) and `CONTAINS_SELF_HARM_CONTENT` (1<<7). The content-scanning flags were documented October 28, 2026, and the docs note they "may not be present on the initial message and can be added later". — [Discord Docs: Attachment Flags](https://discord.com/developers/docs/resources/message#attachment-object-attachment-flags); [Change Log (Oct 28, 2026)](https://discord.com/developers/docs/change-log)
- Spoilers (June 24, 2026): `is_spoiler` sets the `IS_SPOILER` flag. "The legacy `SPOILER_` filename prefix will continue to mark attachments as a spoiler." — [Discord Docs: Change Log (June 24, 2026)](https://discord.com/developers/docs/change-log)
- Upload limits (each one bounds the largest single file an exporter may need to download):
  - Developer Change Log, September 3, 2026: "The default file upload limit has been increased from 10 MiB to 20 MiB for users, bots, webhooks, and interaction responses!" — [Discord Docs: Change Log (Sep 3, 2026)](https://discord.com/developers/docs/change-log)
  - The earlier change took effect January 16, 2025, when the default fell from 25 MiB to 10 MiB. — [Discord Docs: Change Log (Dec 16, 2024)](https://discord.com/developers/docs/change-log)
  - Reference docs: "The default limit is `20 MiB` for all users, but may be higher for users depending on their Nitro status or by the server's Boost Tier." — [Discord Docs: Uploading Files](https://discord.com/developers/docs/reference#uploading-files)
  - Help Center: "As of August 2026, the free upload limit is 20MB (up from 10MB)… Nitro Basic offers 50MB and Nitro offers up to 1GB." Also: "We're currently experimenting with various file upload size limits. Select users may have the ability to upload larger file sizes." — [Discord Help: File Attachments FAQ](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ)
  - Nitro page: "Share larger files up to 1GB" (Nitro) and "Share larger files up to 50 MB!" (Nitro Basic). — [Discord Help: What are Nitro & Nitro Basic?](https://support.discord.com/hc/en-us/articles/115000435108-What-are-Nitro-Nitro-Basic)
  - Boosting: Level 2 gives "50MB Upload Limit for all members (server only)" and Level 3 gives "100MB Upload Limit". An experiment lets some servers buy "Larger File Uploads (5 Boosts)" to raise the limit to 250 MB. — [Discord Help: Server Boosting FAQ](https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ)
- CORS:
  - A 2023 discord-api-docs issue reported that `cdn.discordapp.com` returned `Access-Control-Allow-Origin` set to a specific origin while the media proxy (`media.discordapp.net`) returned a wildcard. The reporter later attributed the mismatch to browser caching, and Discord staff could not reproduce it. — [discord-api-docs issue #6047](https://github.com/discord/discord-api-docs/issues/6047)
  - My own header-only check on 2026-10-29 09:27 UTC of a public static asset, `https://cdn.discordapp.com/embed/avatars/0.png`, returned `access-control-allow-origin: *`, `access-control-allow-methods: GET` and `cache-control: public, max-age=14400` for Origins `https://discord.com`, `chrome-extension://lmoceiadfbnpofjbmgemloenlfkhhbhl` and `https://example.com`. Attachment paths were not tested. — [cdn.discordapp.com default avatar](https://cdn.discordapp.com/embed/avatars/0.png)
  - A community Q&A reports browser fetches of a CDN attachment failing CORS while working in Postman (community source, an archived mirror). — [Stack Overflow mirror: download blob attachment from discord](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/73939384/download-blob-file-attachment-from-discord-using-rest-api)
- Chrome extension rules (Google docs):
  - Extension origins (the service worker and extension pages) can "talk to remote servers outside of its origin, as long as the extension requests host permissions."
  - "Cross-origin requests are always treated as such in content scripts, even if the extension has host permissions."
  - Security advice: "do not allow content scripts to request an arbitrary URL". A malicious page "may be able to forge such messages".
  - Source: [Chrome for Developers: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- CDN URL formats (unsigned; base `https://cdn.discordapp.com/`):
  - Custom Emoji: `emojis/{emoji_id}.png`. The docs "highly recommend requesting emojis as WebP".
  - User Avatar: `avatars/{user_id}/{user_avatar}.png`.
  - Guild Member Avatar: `guilds/{guild_id}/users/{user_id}/avatars/{member_avatar}.png`.
  - Default User Avatar: `embed/avatars/{index}.png`, where index is `(user_id >> 22) % 6` for new usernames and `discriminator % 5` for legacy ones.
  - Sticker: `stickers/{sticker_id}.png` (PNG/APNG), `.json` (Lottie) or `.gif`. "Sticker GIFs do not use the CDN base URL, and can be accessed at `https://media.discordapp.net/stickers/<sticker_id>.gif`."
  - Role Icon, Guild Icon and others follow the same pattern.
  - Size can be set with `?size=` (a power of two from 16 to 4096). Animated hashes start with `a_` and can be fetched as animated WebP with `?animated=true`.
  - Source: [Discord Docs: Image Formatting / CDN Endpoints](https://discord.com/developers/docs/reference#image-formatting)
- Lottie sticker format, verbatim: "the sticker will be available as PNG if its `format_type` is `PNG` or `APNG`, GIF if its `format_type` is `GIF`, and as Lottie if its `format_type` is `LOTTIE`." Format types: PNG 1, APNG 2, LOTTIE 3, GIF 4. — [Discord Docs: CDN Endpoints](https://discord.com/developers/docs/reference#image-formatting-cdn-endpoints); [Discord Docs: Sticker Format Types](https://discord.com/developers/docs/resources/sticker#sticker-object-sticker-format-types)

### Inferences
- An exporter must download attachments promptly after fetching each message page, while the `ex` deadline holds. If downloads lag, it should re-fetch the message or (unofficially) call refresh-urls. It should store files locally rather than storing signed links, which will die. Links pasted inside message text are not refreshed.
- `size` is known before download and can be checked against expected maxima: 20 MiB default and up to 1 GB for Nitro senders. Files may be large, so streaming and quota-aware downloads are needed.
- Downloading from a content script running on discord.com depends on the CDN's CORS headers. Static assets appeared to send `*`; attachment behaviour is unverified. Downloading from the extension service worker with `host_permissions` for `cdn.discordapp.com`/`media.discordapp.net` avoids CORS entirely.
- A message-passing design should send attachment IDs or validated CDN URLs, never arbitrary URLs, to the privileged context, per Chrome's guidance.
- Spoilered and content-scan-flagged media (explicit, gore, self-harm) should probably be marked in the export rather than silently inlined.

### Gaps
- The exact signed-URL lifetime is not stated in official docs. "24 hours" comes from press. Its first-party source is a Discord Developers server announcement I could not access. The `ex` value is authoritative per URL.
- `POST /attachments/refresh-urls` is undocumented officially. I found no official statement on whether user tokens may use it or what its rate limit is.
- CORS headers on signed `attachments/` URLs, as opposed to static assets, were not verified, by design: no signed URL was fetched.
- I found no official statement on attachment retention for messages whose files are later deleted. DCE notes deleted media disappears.

## 5. Content types an exporter must handle, and which need extra endpoints

### Takeaway
Messages are heterogeneous, and a faithful exporter must handle:
- About 37 documented message types, including many system messages.
- Replies (`referenced_message`), forwards (`message_snapshots`, a minimal immutable copy with no author) and thread starters.
- Embeds (including `poll_result` and the new `components` link-preview type), attachments with spoiler and scan flags, and voice messages (flag 1<<13, `waveform`, `duration_secs`).
- Stickers (PNG/APNG/Lottie/GIF), custom and animated emoji, reactions including super ("burst") reactions, polls, and Components V2 layouts (flag 1<<15) whose text and media live inside `components`.
- Discord's own markdown and mention syntax.

Several things need extra calls: who reacted, poll voters, archived and private threads, forum and media posts, pins, and possibly attachment URL refresh.

### Cited Findings
- Documented message types (value, then name):
  - 0 DEFAULT, 1 RECIPIENT_ADD, 2 RECIPIENT_REMOVE, 3 CALL, 4 CHANNEL_NAME_CHANGE, 5 CHANNEL_ICON_CHANGE, 6 CHANNEL_PINNED_MESSAGE, 7 USER_JOIN
  - 8 GUILD_BOOST, 9–11 GUILD_BOOST_TIER_1..3, 12 CHANNEL_FOLLOW_ADD, 14–17 discovery messages
  - 18 THREAD_CREATED, 19 REPLY, 20 CHAT_INPUT_COMMAND, 21 THREAD_STARTER_MESSAGE, 22 GUILD_INVITE_REMINDER, 23 CONTEXT_MENU_COMMAND, 24 AUTO_MODERATION_ACTION
  - 25 ROLE_SUBSCRIPTION_PURCHASE, 26 INTERACTION_PREMIUM_UPSELL, 27–29 and 31 STAGE_*, 32 GUILD_APPLICATION_PREMIUM_SUBSCRIPTION, 36–39 GUILD_INCIDENT_*, 44 PURCHASE_NOTIFICATION, 46 POLL_RESULT
  - Source: [Discord Docs: Message Types](https://discord.com/developers/docs/resources/message#message-object-message-types)
- Message object fields an exporter sees include `author` (a webhook author when `webhook_id` is set), `content`, `timestamp`, `edited_timestamp`, `mentions`, `mention_roles`, `mention_channels`, `attachments`, `embeds`, `reactions`, `pinned`, `type`, `flags`, `message_reference`, `message_snapshots`, `referenced_message`, `interaction_metadata`, `thread`, `components`, `sticker_items`, `position`, `role_subscription_data`, `poll`, `call` and `shared_client_theme`. — [Discord Docs: Message Object](https://discord.com/developers/docs/resources/message#message-object)
- `attachments` is described as "any attached files that are not referenced in embeds or components". — [Discord Docs: Message Structure](https://discord.com/developers/docs/resources/message#message-object-message-structure)
- `referenced_message`, verbatim: "only returned for messages with a `type` of `19` (REPLY), `21` (THREAD_STARTER_MESSAGE), or `23` (CONTEXT_MENU_COMMAND). If… the `referenced_message` field is not present, the backend did not attempt to fetch the message… If the field exists but is null, the referenced message was deleted." — [Discord Docs: Message Structure](https://discord.com/developers/docs/resources/message#message-object-message-structure)
- Message flags include `IS_CROSSPOST`, `SUPPRESS_EMBEDS`, `HAS_THREAD` ("this message has an associated thread, with the same id as the message"), `EPHEMERAL`, `SUPPRESS_NOTIFICATIONS` (1<<12), `IS_VOICE_MESSAGE` (1<<13), `HAS_SNAPSHOT` (1<<14) and `IS_COMPONENTS_V2` (1<<15). — [Discord Docs: Message Flags](https://discord.com/developers/docs/resources/message#message-object-message-flags)
- Forwards: a forward is a message reference with `type` FORWARD (1) whose coupled field is `message_snapshot`.
  - Verbatim: "`author` will be excluded"; "Currently we support only 1 snapshot"; "`message_snapshots` are taken the moment a forward message is created, and are **immutable**."
  - The snapshot subset is `type`, `content`, `embeds`, `attachments`, `timestamp`, `edited_timestamp`, `flags`, `mentions`, `mention_roles`, `stickers`, `sticker_items` and `components`. Nesting depth is limited to 1.
  - Sources: [Discord Docs: Message Reference Types / Forwards](https://discord.com/developers/docs/resources/message#message-reference-types); [Message Snapshot Object](https://discord.com/developers/docs/resources/message#message-snapshot-object)
  - Rollout began July 15, 2024. Since April 14, 2026, apps must be able to read a message's content in order to forward it. — [Discord Docs: Change Log](https://discord.com/developers/docs/change-log)
- Thread starter messages (type 21) "will never have content, embeds, or attachments, mainly just the `message_reference` and `referenced_message` fields." Poll result messages (type 46) carry a `poll_result` embed. — [Discord Docs: Message Reference Content Attribution](https://discord.com/developers/docs/resources/message#message-reference-content-attribution)
- Voice messages, verbatim: "They cannot be edited. Only a single audio attachment is allowed… The attachment has additional fields: `duration_secs` and `waveform`… The `waveform` is… 1 byte per datapoint encoded in base64… no more than 256 datapoints… As of 2023-04-14, clients upload a 1 channel, 48000 Hz, 32kbps Opus stream in an OGG container." — [Discord Docs: Voice Messages](https://discord.com/developers/docs/resources/message#voice-messages)
- Reactions:
  - The reaction object has `count` ("including super reacts"), `count_details{burst, normal}`, `me`, `me_burst`, `emoji` and `burst_colors`.
  - Get Reactions is `GET /channels/{id}/messages/{id}/reactions/{emoji}` with `type` (0 NORMAL, 1 BURST), `after` (a user ID) and `limit` (1–100, default 25). The emoji must be URL-encoded, with custom emoji written as `name:id`.
  - Sources: [Discord Docs: Reaction Object](https://discord.com/developers/docs/resources/message#reaction-object); [Get Reactions](https://discord.com/developers/docs/resources/message#get-reactions)
- Polls: `poll` is a message field, and voters need `GET /channels/{channel.id}/polls/{message.id}/answers/{answer_id}` (`after`, `limit` 1–100, default 25). — [Discord Docs: Get Answer Voters](https://discord.com/developers/docs/resources/poll#get-answer-voters)
- Embed types are `rich`, `image`, `video`, `gifv`, `article`, `link`, `poll_result` and `components` ("link preview built from Discord components", Component Embeds, 2026). — [Discord Docs: Embed Types](https://discord.com/developers/docs/resources/message#embed-object-embed-types)
- Components:
  - Types: 1 Action Row, 2 Button, 3 String Select, 5–8 User/Role/Mentionable/Channel Select, 9 Section, 10 Text Display ("Markdown text"), 11 Thumbnail, 12 Media Gallery, 13 File, 14 Separator, 17 Container. Types 4, 18, 19 and 21–23 are modal-only.
  - Components V2 launched April 22, 2025 and is enabled per message by `1 << 15`. With it, "The `poll` and `stickers` fields are disabled". The limit is now up to 40 components per message (April 29, 2025).
  - Sources: [Discord Docs: Component Types](https://discord.com/developers/docs/components/reference#component-object-component-types); [Change Log (Apr 22 & 29, 2025)](https://discord.com/developers/docs/change-log)
- Threads, forums and media channels:
  - Channel types are PUBLIC_THREAD 11, PRIVATE_THREAD 12, ANNOUNCEMENT_THREAD 10, GUILD_FORUM 15 ("Channel that can only contain threads") and GUILD_MEDIA 16.
  - The threads guide, verbatim: "threads in forum channels behave in the same way as in text channels—meaning they use the same endpoints".
  - Sources: [Discord Docs: Channel Types](https://discord.com/developers/docs/resources/channel#channel-object-channel-types); [Threads topic](https://discord.com/developers/docs/topics/threads)
- Thread listing endpoints:
  - `GET /channels/{id}/threads/archived/public` (`before` = ISO8601, `limit`; ordered by `archive_timestamp` descending; requires `READ_MESSAGE_HISTORY`).
  - `.../archived/private` (requires `READ_MESSAGE_HISTORY` and `MANAGE_THREADS`).
  - `GET /channels/{id}/users/@me/threads/archived/private` (joined private threads; ordered by `id`).
  - `GET /guilds/{id}/threads/active`.
  - Sources: [Discord Docs: List Public Archived Threads](https://discord.com/developers/docs/resources/channel#list-public-archived-threads); [List Active Guild Threads](https://discord.com/developers/docs/resources/guild#list-active-guild-threads)
- DCE comment, verbatim: "User accounts can only fetch threads using the search endpoint". It calls `channels/{id}/threads/search?sort_by=last_message_time&sort_order=desc&archived=…&offset=…` with user tokens and the archived-threads endpoints with bot tokens. — [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- (Unofficial) Search Threads is `GET /channels/{channel.id}/threads/search`, which "Requires the `READ_MESSAGE_HISTORY` permission" and can also return 202 "not yet indexed". — [docs.discord.food: Channels (Search Threads)](https://docs.discord.food/resources/channel#search-threads)
- Markdown and mentions (official):
  - Mention and object syntax: `<@USER_ID>`, `<@!USER_ID>` (deprecated), `<#CHANNEL_ID>`, `<@&ROLE_ID>`, `<@$GAME_ID>` (game profile), `</NAME:COMMAND_ID>`, `<:NAME:ID>`, `<a:NAME:ID>` and `<t:TIMESTAMP[:STYLE]>`.
  - Timestamp styles: t, T, d, D, f (default), F, s, S, R.
  - Guild navigation: `<id:customize|browse|guide|linked-roles>`.
  - Standard emoji are Unicode and are rendered with Twemoji on desktop and Android.
  - Source: [Discord Docs: Message Formatting](https://discord.com/developers/docs/reference#message-formatting)
- Markdown (Help Center):
  - Text styles: `*italics*`, `**bold**`, `__underline__`, `~~strikethrough~~`.
  - Headers: `#`, `##` and `###` "as the first character(s) in a new line".
  - Subtext: "add a (-# ) before the text… the (-#) must be at the very beginning of the line".
  - Masked links: brackets around the text, then the URL in parentheses.
  - Lists, code blocks (single and triple backticks), block quotes (`>` and `>>>`), and spoilers (`||text||`, "negated by a code block").
  - Source: [Discord Help: Markdown Text 101](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline)
- `mention_channels` is unreliable: "Only crossposted messages (via Channel Following) currently include `mention_channels` at all." — [Discord Docs: Message Structure](https://discord.com/developers/docs/resources/message#message-object-message-structure)

### Inferences
- Endpoints beyond `GET /channels/{id}/messages` that a complete export needs:
  - Reactors per emoji, with a separate pass for burst reactions (`type=1`), paginated by user ID.
  - Poll voters per answer.
  - Thread discovery: archived public and private (permission-gated), joined private and active threads, or for user tokens the (unofficial) thread search. Then message pagination inside each thread.
  - Forum and media channels: each post is a thread.
  - Pins via the new pins endpoint.
  - Attachment URL refresh for slow downloads.
  - Guild/channel/member metadata to resolve `<@id>`/`<@&id>`/`<#id>` into names. Channel mentions in particular cannot be resolved from `mention_channels`.
- Components V2 messages can have no `content`, with all text in Text Display components and media referenced inside Media Gallery/File components. Files referenced in components may be missing from `attachments`. A renderer that only reads `content`/`attachments`/`embeds` will silently drop content.
- Forwarded messages have no author in the snapshot. The exporter should show "forwarded from <channel/guild>" from `message_reference`. The original may be inaccessible to the exporting user.
- Unknown future message types and component types should be preserved raw (for example as JSON) rather than dropped.

### Gaps
- Message types 30, 33–35, 40–43, 45 and any above 46 are absent from the official table. Undocumented or newer types may appear in real data.
- I did not verify poll object sub-fields (`answers`, `results`, `is_finalized`) in detail. See [Discord Docs: Poll](https://discord.com/developers/docs/resources/poll) for the field list.
- Whether user accounts can call the official archived-thread endpoints (DCE implies they cannot) is not documented officially.

## 6. Terms and policy: self-bots, scraping, client modification, privacy, enforcement

### Takeaway
Every relevant Discord text prohibits what a token-capturing exporter extension does:
- The self-bots support article: "Automating normal user accounts (generally called 'self-bots') outside of the OAuth2/bot API is forbidden, and can result in an account termination."
- Community Guideline #14: "Do not use self-bots or user-bots."
- The Terms of Service ban scraping "by using any robot, spider, crawler, scraper, or other automatic device, process, or software" and "unauthorized software designed to modify the services".
- The Platform Manipulation policy: "Don't modify the Discord client for any reason — including automating account actions".
- The Developer Policy forbids any Application to "request or attempt to obtain… login tokens" and to "mine or scrape any data".

Enforcement ranges from warnings to permanent removal. In 2026 it visibly includes automated lockouts of exporter users. I found no public takedown by Discord of an exporter tool.

### Cited Findings
- Support article "Automated User Accounts (Self-Bots)", created 2017-10-17, body last edited 2024-04-05, verbatim: "Discord's API provides a separate type of user account dedicated to automation, called a bot account… Automating normal user accounts (generally called 'self-bots') outside of the OAuth2/bot API is forbidden, and can result in an account termination if found." — [Discord Help: Automated User Accounts (Self-Bots)](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots)
- Developer docs, verbatim: "Developers must abide by the terms of service, which includes refraining from automating standard user accounts (generally called 'self-bots') outside of the OAuth2/bot API." — [Discord Docs: Bot vs User Accounts](https://discord.com/developers/docs/topics/oauth2#bot-vs-user-accounts)
- Community Guidelines (Effective September 29, 2025; Last Updated August 29, 2025):
  - #14: "Do not use self-bots or user-bots. Each account must be associated with a human, not a bot."
  - #13 bans facilitating spam tools, including "token generators".
  - #3: "Do not share or threaten to share the personally identifiable information (PII) of an individual without consent."
  - Enforcement, verbatim: "issuing warnings, removing content, temporarily suspending account access to Discord, or permanently removing violative accounts and servers, and even reporting them to law enforcement."
  - Source: [Discord Community Guidelines](https://discord.com/guidelines)
- Terms of Service (Effective September 29, 2025; Last Updated August 29, 2025), verbatim:
  - "Don't use the services to do harm to Discord. Among other things, this includes trying to gain access to, intentionally overburdening, or attacking our systems; scraping our services without our written consent, including by using any robot, spider, crawler, scraper, or other automatic device, process, or software; selling, licensing, or otherwise commercializing content or data obtained from our services; … using any unauthorized software designed to modify the services; … copying, dismantling, or reverse engineering any of our services."
  - Also: "You may not copy, modify, create derivative works based upon, distribute… any of our software or services."
  - Also: "we reserve the right to suspend or terminate your account and/or your access to some or all of our services with or without notice."
  - Source: [Discord Terms of Service](https://discord.com/terms)
- Platform Manipulation Policy Explainer (dated March 15, 2024), verbatim:
  - "Spam can be sent by… user accounts modified to perform automated actions (self-bots). Making modifications to the Discord client for the purpose of spam or any other reason is not allowed under this policy."
  - Under "How to Avoid Violating": "Don't modify the Discord client for any reason — including automating account actions or altering the appearance or layout of Discord."
  - Source: [Discord Platform Manipulation Policy Explainer](https://discord.com/safety/platform-manipulation-policy-explainer)
- Developer Policy (Effective July 8, 2024), verbatim:
  - #4: "Do not collect, solicit, or deceive users into providing passwords or other credentials. Under no circumstances may you or your Application request or attempt to obtain login credentials from Discord users. This includes information such as passwords or account access or login tokens."
  - #3: "Do not enable your Application to bypass or circumvent Discord's privacy, safety, and/or security features."
  - #15: use API Data only "as necessary to provide your Application's stated… functionality".
  - #17: no disclosure to data brokers.
  - #18: no selling.
  - #20: "Do not mine or scrape any data, content, or information available on or through Discord services."
  - #21: "Do not use message content obtained through the APIs to train machine learning or AI models… unless express permission is granted by Discord."
  - Source: [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- Developer Terms of Service (Effective July 8, 2024), verbatim:
  - Definition: "'Application' (or 'app') means any application (including any bot, game, activity, website, or other client) that accesses or uses our APIs."
  - Section 5: provide a privacy policy, "promptly delete the API Data when… the applicable user requests you delete it", and protect API Data with "(i) encryption of the data at rest".
  - "API Data includes your developer credentials and access tokens."
  - Source: [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
- Privacy Policy, on other users' content, verbatim:
  - "If you share content within larger spaces, that content may be accessed by many people, including people you do not know."
  - "When you add your content to the services, you are telling us to make that content available to certain people or communities. Who can access that information is determined by who can access a particular space."
  - Source: [Discord Privacy Policy](https://discord.com/privacy)
- DCE's own warnings:
  - README: "While **DiscordChatExporter** allows it, automating user accounts is against Discord TOS and may result in you getting banned."
  - Token doc: "Automating user accounts violates Discord's terms of service and may result in account termination. Use at your own risk."
  - Troubleshooting: "Automating user accounts is technically against TOS… Bot accounts don't have this restriction."
  - Sources: [DCE Readme](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/Readme.md); [DCE Token-and-IDs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Token-and-IDs.md); [DCE Troubleshooting](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Troubleshooting.md)
- Enforcement in practice (2026, anecdotal): see section 3. Reports describe:
  - account blocks citing "platform abuse"/spam
  - "all devices were logged out", with abuse-notification and password-reset emails
  - multiple violations recorded in account "Standing"
  - a user who exported a channel as legal evidence and was banned: "I got banned today too… I was completely unaware it violated Discord's Terms of Service."
  - Source: [DCE issue #1497](https://github.com/Tyrrrz/DiscordChatExporter/issues/1497)
- Bot data access transparency (contrast with bots): users can see a bot's "Data Access" tab, and all bots get "Metadata about messages (e.g., day and time sent)". — [Discord Help: Visibility of Bot Data Access](https://support.discord.com/hc/en-us/articles/7933951485975-Visibility-of-Bot-Data-Access)

### Inferences
- The extension under study captures the `authorization` header by patching `XMLHttpRequest` inside discord.com and then automates API reads. That squarely matches four texts:
  1. self-bot / user-bot automation (support article; Guideline #14)
  2. "unauthorized software designed to modify the services" and automated scraping (ToS)
  3. "modify the Discord client for any reason" (Platform Manipulation)
  4. obtaining "account access or login tokens" (Developer Policy #4)
- Point 4 applies because an extension that "accesses or uses our APIs" fits the Developer Terms' definition of "Application". The user's own consent does not appear to create an exception in any of these texts.
- Exporting other people's messages and media turns the export into a store of third-party personal data. Developer Terms Section 5 (GDPR/CCPA compliance, deletion on request, encryption at rest) and Guideline #3 (no PII sharing without consent) become relevant if the extension uploads, syncs or shares exports. Keeping exports local and user-controlled is the lowest-risk posture.
- Discord's position has not softened over time. The self-bot article dates to 2017 and was edited in 2024. The ToS, Guidelines and Privacy Policy were refreshed together, effective September 29, 2025. Enforcement against exporter traffic visibly intensified from late February 2026 (anecdotal).

### Gaps
- I found no public statement, DMCA notice or takedown by Discord targeting DiscordChatExporter, Discrub, Discord History Tracker or browser-extension exporters. DCE remains public on GitHub, last pushed 2026-10-27.
- I found no official Discord statement explaining the 2026 detection changes or tying them to the age-assurance rollout. The link is a DCE contributor's speculation.
- I did not review the Chrome Web Store's own developer program policies (for example "Limited Use" of user data), which would also bind a published extension.

## 7. Sanctioned alternatives: data package and bot-based export

### Takeaway
The only first-party, ToS-safe way for a user to get their history is "Request your data" (Settings → Data & Privacy). It takes up to 30 days. The link stays valid for 30 days. The package contains only messages the user sent, as JSON with ID, timestamp, contents and attachment CDN links, and no one else's messages.

A bot can legitimately export server channels it has been added to. It needs `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` plus the `MESSAGE_CONTENT` privileged intent. Since June 10, 2026 that intent is self-serve below 10,000 users. A bot cannot read a user's DMs or group DMs with others, and it must be added by a server admin.

### Cited Findings
- Data request steps and timing, verbatim:
  - "To request a copy of your personal data from your account's entire history, go to your User Settings."
  - "The data request process can take up to 30 days to complete. You must wait for your current request to finish before submitting a new one. Discord will send a download link to the email address linked to your account."
  - "Your request will be canceled if you disable or delete your account before receiving the download link."
  - An email-verified account is required. On desktop you can choose which data to receive; on mobile, only all of it.
  - Source: [Discord Help: Requesting a Copy of your Data](https://support.discord.com/hc/en-us/articles/360004027692-Requesting-a-Copy-of-your-Data)
- Package contents (article edited 2026-09-25), verbatim:
  - "The messages folder contains all the messages that you have sent on Discord… broken down separately into folders based on Direct Messages, Group Messages, and channels."
  - Per message: "ID… Timestamp… Contents: Your message. Attachments: A CDN link to any images, or files you included in your message."
  - "If you manually delete a message - it is no longer stored in Discord and therefore will not be included in your Data Package."
  - "Your Data Package only includes servers you are a member of at the time of the request as well as any recently-departed servers."
  - "The download link will remain active for 30 days."
  - Source: [Discord Help: Your Discord Data Package](https://support.discord.com/hc/en-us/articles/360004957991-Your-Discord-Data-Package)
- Privacy Policy, verbatim: "you can request a copy of your data in the Data & Privacy section of your User Settings. You should receive your data packet within 30 days. Data is delivered in common digital formats, including JSON and any other file format you used when uploading attachments to the services." — [Discord Privacy Policy](https://discord.com/privacy)
- Bots vs users, verbatim: "Bots are added to guilds through the OAuth2 API, and cannot accept normal invites. Bots cannot have friends or be added to or join Group DMs… Bots have an entirely separate set of rate limits." — [Discord Docs: Bot vs User Accounts](https://discord.com/developers/docs/topics/oauth2#bot-vs-user-accounts)
- Message Content intent, verbatim: "the `content`, `embeds`, `attachments`, `components`, and `poll` fields in message objects all contain message content and therefore require the intent." Exceptions include "Content in messages that an app sends" and "Content in DMs with the app". Without the intent, apps "will receive empty values in the `content`, `embeds`, `attachments`, and `components` fields while `poll` will be omitted." — [Discord Docs: Message Content Intent](https://discord.com/developers/docs/events/gateway#message-content-intent); [Message Object](https://discord.com/developers/docs/resources/message#message-object)
- **Recent change, June 10, 2026:** "Apps with fewer than 10,000 users can access privileged intents by enabling them in the Developer Portal. When an app has more than 10,000 unique users who can see your app across all the servers it's in, it requires review… you will be notified annually to reapply." This replaced the older server-count-based threshold. — [Discord Docs: Privileged Intent Access Review](https://discord.com/developers/docs/events/gateway#privileged-intent-access-review); [Change Log (June 10, 2026)](https://discord.com/developers/docs/change-log)
- Bot rate limit: "All bots can make up to 50 requests per second." The same per-route and invalid-request rules apply. — [Discord Docs: Rate Limits](https://discord.com/developers/docs/topics/rate-limits)
- DCE supports bot tokens. Its bot-token guide (Developer Portal → Bot → Reset Token) warns: "Resetting the token will invalidate the old one." When a bot sees all-empty messages, DCE checks that `MESSAGE_CONTENT` is enabled. — [DCE Token-and-IDs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Token-and-IDs.md); [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- A DCE user describes the practical limit of bots, verbatim: "I cannot export chats from servers that I do not own or administer. Therefore, this type of bot would not work for me." — [DCE issue #1508](https://github.com/Tyrrrz/DiscordChatExporter/issues/1508)
- (Unofficial) An OAuth2 route, `GET /users/{user.id}/messages`, with scope `dm_channels.messages.read`, exists. It requires both DM participants to have authorized the app and returns "a maximum of 200 messages and up to 72 hours of history". — [docs.discord.food: List DM Messages](https://docs.discord.food/resources/message#list-dm-messages)

### Inferences
- For "export my own DMs and group DMs with everyone's messages", no sanctioned path exists today. The data package covers only the user's side. Bots cannot join DMs or group DMs. The OAuth2 DM-messages scope (unofficial docs) is tiny and needs both parties' authorization.
- For server channels, a bot-based exporter is the compliant route, given admin cooperation. A small private bot (under 10,000 users) can now self-enable `MESSAGE_CONTENT`.
- Data-package attachment links are CDN URLs and are probably signed and expiring like other attachment URLs. This is not confirmed (see Gaps). They may need refreshing or prompt downloading.

### Gaps
- The Help Center does not say whether data-package attachment links are signed or expire, or whether it includes files above a size threshold.
- I found no official statement on whether a user may legitimately use OAuth2 `messages.read`-type scopes for personal archiving of server channels. No such general-purpose scope is documented officially.

## 8. Security of handling a user token

### Takeaway
A Discord user token is a bearer credential that "gives full access to an account" (DCE docs). Changing the password resets it. Discord also force-invalidates sessions when it detects abuse. Login-time MFA does not protect a stolen token, because the API authenticates on the `Authorization` header alone (inference supported by the docs' auth model).

Token-stealer malware typically:
- harvests tokens from browser or Discord LevelDB local storage or by hooking the client
- validates them against Discord endpoints such as billing/payment routes
- exfiltrates them via Discord webhooks

A legitimate extension must look nothing like this: no off-device transmission, no billing or account-modifying calls, minimal permissions, transparent code.

### Cited Findings
- DCE docs, verbatim: "**Do not share your token!** A token gives full access to an account. To reset a user token, change your account password. To reset a bot token, click on Reset Token in the bot settings." — [DCE Token-and-IDs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Token-and-IDs.md)
- DCE's documented manual method for getting the user token pushes into the client's `webpackChunkdiscord_app` and calls `getToken()`. A second method uses the network monitor. Both show how exposed the token is inside the web client's page context. — [DCE Token-and-IDs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/.docs/Token-and-IDs.md)
- Official auth model: "For all authentication types, authentication is performed with the `Authorization` HTTP header in the format `Authorization: TOKEN_TYPE TOKEN`." Bot tokens are prefixed `Bot`. User tokens are undocumented, and DCE sends them raw. — [Discord Docs: Authentication](https://discord.com/developers/docs/reference#authentication); [DCE DiscordClient.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Discord/DiscordClient.cs)
- Developer Terms: "API Data includes your developer credentials and access tokens." Tokens must be kept "encrypted in any files or other materials accessible by third parties". — [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
- Discord's ToS: "You are responsible for the security of your account… we (strongly) recommend that you use that password only for your Discord account and that you enable two-factor authentication." — [Discord Terms of Service](https://discord.com/terms)
- Discord Help on compromise: "a good first step is to reset your password and ensure that Multi-Factor Authentication is enabled". Also: "always avoid clicking on links or downloading files from unknown or untrusted sources." — [Discord Help: My Discord Account was Hacked or Compromised](https://support.discord.com/hc/en-us/articles/24160905919511-My-Discord-Account-was-Hacked-or-Compromised)
- Discord's MFA guidance recommends passkeys as "phishing resistant". The article describes login factors and backup codes. It says nothing about protecting already-issued tokens. — [Discord Help: Setting up Multi-Factor Authentication](https://support.discord.com/hc/en-us/articles/219576828-Setting-up-Multi-Factor-Authentication)
- Session invalidation observed in 2026 enforcement: "all devices were logged out. An abuse notification email and a password reset email was sent". Another user: "I tried to do it again, and immediately the token was invalidated." — [DCE issue #1497](https://github.com/Tyrrrz/DiscordChatExporter/issues/1497)
- Token-grabber malware patterns (K7 Labs, April 2022):
  - It builds paths to the LevelDB directories of the Discord app and Chrome, Opera, Brave and Yandex, "searches for files ending with .log or .ldb extension", and matches tokens by regex (`[\w-]{24}\.[\w-]{6}\.[\w-]{27}` and `mfa\.[\w-]{84}`).
  - It validates them by sending the token "in the Authorization Header", including to "/billing/payment-sources".
  - It collects email, phone, MFA status and billing data, plus the IP via ipinfo.io, and exfiltrates via "a Discord webhook URL".
  - "If the user changes their Discord credentials, a new token is generated and the malware sends the new details."
  - Source: [K7 Labs: The Discord Token Grab](https://labs.k7computing.com/index.php/the-discord-token-grab/)
- Chrome's extension security guidance: content scripts should not be allowed to make privileged requests for arbitrary URLs ("do not allow content scripts to request an arbitrary URL"). — [Chrome for Developers: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

### Inferences
- Possession of the token alone authorizes API calls as the user. MFA is enforced at login, and per Discord's own guidance on certain sensitive account actions, not on ordinary reads. MFA therefore does not mitigate token reuse for reading message history. This is inferred from the header-only auth model, and Discord does not state it explicitly.
- Token lifetime: rotating the password invalidates it (DCE docs and K7). Discord's anti-abuse can force-invalidate sessions. An exporter must handle 401 by stopping and asking the user to re-authenticate, never by retrying (which also protects against the invalid-request ban). The effect of explicit logout or "log out all devices" on tokens was not confirmed from an official source.
- Patching `XMLHttpRequest` in the page to read the `authorization` header is the same capture technique used by token-grabber extensions. Hooking client requests is a known grabber vector. A legitimate extension should therefore:
  - keep the token in memory or session-scoped storage only
  - never send it, or exports, to any server, webhook, analytics or remote logging (Discord webhooks are the classic exfiltration channel)
  - call only the read endpoints it needs, never `users/@me/billing/*`, payment, email or phone, or account-modifying endpoints
  - request minimal host permissions (`discord.com/api`, `cdn.discordapp.com`, `media.discordapp.net`)
  - avoid remote code and obfuscation
  - document its behaviour plainly
- Even a perfectly local, transparent extension remains a self-bot under Discord's rules (section 6). Security hygiene reduces harm to the user but does not create compliance.

### Gaps
- No official Discord document confirms that password change invalidates all existing user tokens. That rests on DCE docs, the K7 analysis and user reports. The effect of logout, "log out of all devices" or MFA enablement on existing tokens is also unconfirmed.
- I found no 2025–2026 primary vendor report specifically about a malicious Chrome extension capturing Discord tokens through XHR or fetch hooks. GitHub proof-of-concept "token grabber" extensions exist per search listings, but I could not open them (403), so they are not cited as findings.
- The format of current user tokens and whether the legacy `mfa.`-prefixed token format still exists were not verified for 2026.
