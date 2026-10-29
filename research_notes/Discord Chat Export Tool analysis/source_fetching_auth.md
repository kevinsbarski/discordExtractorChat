# Discord Chat Export Tool (lmoceiadfbnpofjbmgemloenlfkhhbhl v1.7.0): data acquisition, auth, architecture, network endpoints and gating (static source analysis)

Evidence convention: every finding is from static reading of the installed, unmodified bundles. Nothing was executed. Each link points to the bundle file. The link text gives the Parcel module id, the original source alias (for example `~utils/discordHelper`), and where possible the character offset (`@N`) of the quoted snippet in the minified file. Quoted code is copied verbatim from the minified source, or from a js-beautify copy of it, which only changes whitespace. Readable per-module extracts used for this analysis are in `/private/tmp/claude-501/-Users-kevinsbarski-Desktop-projects-discordExtractorChat/8a5ead6e-8b8f-47ff-8036-6e5026f9462c/scratchpad/src-acquisition/app/` (`background.js`, `contents.js`, `popup.js`, `export.js`, `export_extra.js`, `upgrade.js`). They are derived copies in a temporary folder and may not persist.

Status labels: **[confirmed]** means read directly in the code. **[inferred]** means reasoned from the code and/or docs but not observed at runtime.

## 1. How the Discord token is obtained, moved around, stored and used

### Takeaway
The extension never asks for credentials. A MAIN-world script on discord.com patches `XMLHttpRequest.prototype.setRequestHeader` and copies Discord's own `authorization` header (the user-account token) into `<body data-token="…">`. When the popup asks, the content script reads that attribute and returns it. The popup then puts the token into the **query string of the Export tab URL** (`chrome-extension://…/tabs/Export.html?…&token=…`). The Export page reads it back from `location.search` and sends it verbatim as the `authorization` header on every Discord API call. The token is never written to `chrome.storage`, and no code path sends it to a non-Discord host. It does, however, sit in the discord.com DOM and in an extension tab URL.

### Cited Findings
- **[confirmed]** The MAIN-world script is not in the manifest's `content_scripts`, which lists only `contents.04ff201a.js` for `https://discord.com/*`. The service worker registers it at startup: `chrome.scripting.registerContentScripts([{id:"contentsInjected",js:[(0,a.default).split("/").pop().split("?")[0]],matches:["https://discord.com/*"],world:"MAIN",runAt:"document_start"}]).catch(e=>{})`. The bundle map resolves the file as `{"abzv4":"index.js","geOyG":"injected.a4186a2d.js"}`. — [static/background/index.js · 8ZbMf `./main-world-scripts` @1011282, hETck](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js); [manifest.json](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/manifest.json)
- **[confirmed]** Capture: `XMLHttpRequest.prototype.setRequestHeader=function(e,t){return this.headers[e]=t,"authorization"===e.toLowerCase()&&t&&document.body.setAttribute("data-token",t),i.apply(this,arguments)}`. It also wraps `open` (it stores `this._method`/`this._url`, which nothing uses) and `send` (pure pass-through). Only XHR is hooked; `window.fetch` is not patched. — [injected.a4186a2d.js · lmSC2 @1778](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/injected.a4186a2d.js)
- **[confirmed]** Reading the token: `function y(){let e=document.querySelector("body"),t=e.getAttribute("data-token");return t}` (exported as `getDataToken`). — [contents.04ff201a.js · cPwpL `~utils/discordHelper` @395901](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** The content script answers `chrome.runtime.onMessage` messages where `"getDetail"===e.action`. It replies with `{channelId:t,token:e,guilds:a,isUserMessage:o,icon:l,title:c,url:n,isError:i,needThread:u}`, where `e=getDataToken()`, `n=window.location.href` and `i=!t&&!a`. — [contents.04ff201a.js · 2CBF1 `~contents/index` @149193](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** The popup gets the active tab with `chrome.tabs.query({active:!0,currentWindow:!0})` and checks `r.startsWith("https://discord.com/")`. It then calls `chrome.tabs.sendMessage(c.id,{action:"getDetail"})` and keeps the whole reply, token included (`m(n)`). It never checks whether `token` is null. — [popup.100f6462.js · 5QXb8 `~popup/components/Main` @1680518](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** On "Start Exporting", the token goes into the URL: `a={startDate:p(e,"start"),endDate:p(c,"end"),...g()},r=new URLSearchParams(a),n=chrome.runtime.getURL(`/tabs/Export.html?${r}`);await chrome.tabs.create({url:n,active:!0})`. Here `g()` is the stored getDetail reply, so the URL carries `token`, `channelId`, `guilds`, `isUserMessage`, `icon`, `title`, `url`, `isError` and `needThread`. — [popup.100f6462.js · 5QXb8 @1680196](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** The Export page reads it back: `let e=new URLSearchParams(window.location.search),r=e.get("startDate"),n=e.get("endDate"),o=e.get("channelId"),i=e.get("guilds"),c=e.get("token"),l=e.get("isUserMessage"),…;t(r),a(n),R(o),E(i),T(c),O("true"===l),…,eB()`. It then passes `token:c` to every fetch helper. — [tabs/Export.be6c1dc7.js · 6uyrl `~tabs/components/Main` @1697975](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** How it is used: every Discord call sends `headers:{accept:"*/*","accept-language":"en-US,en;q=0.9",authorization:e}`, `method:"GET"`. The value is the raw captured string, with no `Bearer`/`Bot` prefix added. This header block appears 4 times in the helper. — [contents.04ff201a.js · cPwpL @388919](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); identical copy in [tabs/Export.be6c1dc7.js · cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Not persisted. The app code writes these chrome.storage keys, all through Plasmo `new Storage({area:"local"})`: `isPaid`, `expiry_date`, `subConfig`, `userData`, `login_time`, `customConfig`, `IS_REVIEWED`, `promotionConfig`, `FREE_MAX_TRAIL_COUNT`, `HAS_CONFIRMED_RATING`, `HAS_SHOWED_RATING_PROMPT`, `preferredExportFormat`, `pending_next_url`, plus Supabase's session key. None holds the Discord token, and the only `token` reads in app code are the DOM attribute and the URL param. — [tabs/Export.be6c1dc7.js · cMVDP `~components/CommonContext` @144916, jodCC `~hooks/useTrialLimit` @6607298, 1hQwp @6601775](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [static/background/index.js · 9BFy9 @2731](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** The token is not sent to non-Discord hosts. The app code has only three `fetch(` call sites:
  - `~utils/discordHelper`, which calls discord.com/api/v9.
  - `~core/api`, which calls worker-api.extbolt.com. The body is `{project_id, trial_product_id?}` with a *Supabase* bearer (see Q6).
  - The attachments dialog `fetch(o.url)`, which takes attachment URLs from Discord's message JSON and sends no auth header.

  Sentry is compiled in but has no DSN: `var a=e("@sentry/browser");let s=void 0;…function l(){if(!s)return;…`. The UI-side `~utils/sentry` is a stub: `function n(){return!1}function i(e,t){}function l(e){}`. — [static/background/index.js · ky5iB `~core/sentry` @10308/@10450](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js); [tabs/Export.be6c1dc7.js · kiLZw `~core/api`, 8Q3Zi @7070442, hCouT](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- Where the token is exposed (none of this was observed at runtime):
  - It sits as a DOM attribute on discord.com for the life of the page. Any script in that page can read it, including Discord's own code and other extensions' content scripts.
  - It sits in the Export tab's URL: the address bar, the tab URL that any extension with the `tabs` permission can read, and session-restore state.
  - Under Chrome's default `strict-origin-when-cross-origin` referrer policy, the query string should not leak through `Referer` on cross-origin subresource requests from the Export page.
- If Discord's web client has not sent an XHR with an `authorization` header since the page loaded, `data-token` is empty. The popup does not check this. `URLSearchParams` turns `null` into the string `"null"`, so the Export page would send `authorization: null`, get errors, retry 6 times and then show "Something went wrong".
- The captured value is the user-account token of the logged-in Discord web session. All API traffic is therefore user-account automation from a browser extension. Platform rules are covered by another researcher.

### Gaps
- Whether Chrome records `chrome-extension://…/tabs/Export.html?…token=…` in browsing history was not verified.
- Whether Discord's current web client still sends authorized requests through XHR (which the hook needs) or has moved to `fetch` cannot be checked without running Discord. Running it was out of scope (no login, no API calls).

## 2. Discord endpoints, query parameters and headers

### Takeaway
There are five Discord REST endpoints, all on `https://discord.com/api/v9`:
- Guild message search, used once per export to find a starting message.
- DM channel message search, the same role for DMs.
- `GET /channels/{id}/messages` with `limit=50` and `around`/`before`, which does the real paging.
- `GET /channels/{id}` and `GET /guilds/{id}`, for title, icon and forum detection.

The only headers sent are `accept`, `accept-language` and `authorization`. There is no `X-Super-Properties`, and none of `/users/@me`, `/users/@me/channels`, `/guilds/{id}/channels`, thread-listing or `/attachments/refresh-urls` is called.

### Cited Findings
- **[confirmed]** Guild search, used when the URL is not `@me`: `new URL(`https://discord.com/api/v9/guilds/${r}/messages/search`)` with `new URLSearchParams({channel_id:t,include_nsfw:"true",min_id:l(a),max_id:l(o)})`. — [contents.04ff201a.js · cPwpL `fetchGuildDiscordMessages` @388700/@388793](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** DM and group-DM search: `new URL(`https://discord.com/api/v9/channels/${t}/messages/search`)` with `{channel_id:t,_t:"1",min_id:l(r),max_id:l(a)}`. — [contents.04ff201a.js · cPwpL `fetchDiscordMessages` @389265/@389360](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Paging endpoint: `new URL(`https://discord.com/api/v9/channels/${e}/messages`)`, `l=new URLSearchParams({limit:"50"});t&&l.set("before",t),r&&l.set("around",r)`. — [contents.04ff201a.js · cPwpL `fetchDiscordChannelMessages` @389907/@389982](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Metadata calls go through the helper `E(e,t)`, a plain GET with the same 3 headers:
  - `https://discord.com/api/v9/channels/${e}` is used for the forum/media check (`r?.type===15||r?.type===16`), for the thread name (`r.name`) and for the DM icon (`r.icon` or `r?.recipients?.[0]`).
  - `https://discord.com/api/v9/guilds/${e}` is used for the guild icon.

  — [contents.04ff201a.js · cPwpL @396526, @397053, @397594](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** CDN URLs are built locally and never fetched with auth:
  - `https://cdn.discordapp.com/icons/${e}/${t}.${gif|png}`
  - `/channel-icons/${e}/${a}.png`
  - `/avatars/${r.id}/${r.avatar}.${ext}`
  - `/guilds/${t}/users/${r.id}/avatars/${a}.${ext}`
  - `/embed/avatars/${t}.png`, where the default-avatar index is `(BigInt(e.id)>>22n)%6n` or `discriminator%5`

  — [contents.04ff201a.js · cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Absence checks: there are no occurrences of `X-Super-Properties`, `x-discord-locale`, `x-debug-options`, `sort_by`, `sort_order`, `offset`, `refresh-urls`, `users/@me`, `discord.com/api/v10` or `webpackChunk` in any bundle. `discord.com/api/v9` appears 7 times in the content script and 7 times in the Export bundle (the same shared helper module). — all bundles, e.g. [tabs/Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Where the calls run:
  - The search and paging calls run in the **Export tab**, an extension page with origin `chrome-extension://lmoceiadfbnpofjbmgemloenlfkhhbhl`. The Export bundle imports `~utils/discordHelper`, and module cPwpL there is identical apart from minified identifier names.
  - The metadata calls run in the **content script** on discord.com, during `getDetail`.
  - The service worker makes no Discord API calls.

  — [tabs/Export.be6c1dc7.js · 6uyrl deps `"~utils/discordHelper":"cPwpL"`](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [static/background/index.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** Attachments:
  - The dialog fetches each selected attachment with `await fetch(o.url)` and writes it with `window.showDirectoryPicker({mode:"readwrite"})` → `getFileHandle(l,{create:!0})` → `createWritable()`. No `downloads` permission is needed. The only `chrome.downloads` string is a feature-detect inside the SheetJS library.
  - Thumbnails add `searchParams.append("format","jpeg")` to the attachment URL.

  — [tabs/Export.be6c1dc7.js · 8Q3Zi `~tabs/components/AttachmentsDialog` @7070157/@7070442/@7068740](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed, docs]** Get Channel Messages takes `around`/`before`/`after`/`limit`. Discord's docs say "The `before`, `after`, and `around` parameters are mutually exclusive" and give `limit` as "Max number of messages to return (1-100)", default 50. — [Discord docs: Message resource](https://docs.discord.com/developers/resources/message)
- **[confirmed, docs]** Search Guild Messages is `GET /guilds/{guild.id}/messages/search`:
  - `min_id`: "Get messages after this message ID". `max_id`: "Get messages before this message ID".
  - `channel_id`: array of snowflakes. `include_nsfw`: default false.
  - `sort_by`: `timestamp` (default). `sort_order`: default `desc`.
  - `limit`: 1-25, default 25. `offset`: max 9975.
  - The response `messages` is an array of arrays.
  - If the entity is not yet indexed, it returns HTTP 202 "Index not yet available. Try again later" with `retry_after`.

  The DM variant `/channels/{id}/messages/search` is not on that page. — [Discord docs: Message resource](https://docs.discord.com/developers/resources/message)

### Inferences
- The message requests come from an extension origin and lack the official web client's usual headers (`X-Super-Properties`, locale, timezone). That makes them easy for Discord to tell apart from normal client traffic.
- `_t:"1"` on the DM search is undocumented. It is probably a cache-buster or client flag; its meaning is unknown.
- Attachments are downloaded straight from the URLs in the fetched message JSON, with no `refresh-urls` step. Signed CDN links in old exports may therefore expire. The other researcher covers export formats.

### Gaps
- No public Discord documentation was found for `GET /channels/{id}/messages/search` (the DM search) in the docs page fetched.

## 3. From the chosen date range to API queries: snowflakes, paging direction, page size, stop conditions

### Takeaway
The popup turns the two picked days into local-midnight and local-23:59:59.999 timestamps. The Export page converts them to snowflakes with `(ms − 1420070400000) << 22` and runs **one** search with `min_id`/`max_id`, only to get a single anchor message. With no sort parameters, Discord's default is newest first, so the anchor is the newest indexed message in range.

It then walks **backwards** with `GET /channels/{id}/messages?limit=50`: first `around=<anchor>`, then `before=<oldest id of previous page>`. Each page is filtered client-side by the timestamp decoded from each message's snowflake. The run stops at the first page that has no in-range messages.

### Cited Findings
- **[confirmed]** Date input:
  - The popup has two HeroUI `DatePicker`s with `granularity:"day"`. The defaults are `z.add({years:-4})` for the start and now for the end, where `z=now(getLocalTimeZone())`.
  - The conversion is `p(t,e)`: `(t.includes("T")?parseZonedDateTime(t):toZoned(parseDate(t),getLocalTimeZone())).set("start"===e?{hour:0,minute:0,second:0,millisecond:0}:{hour:23,minute:59,second:59,millisecond:999}).toAbsoluteString()`.
  - The results are sent as the `startDate`/`endDate` URL params.

  — [popup.100f6462.js · 5QXb8 @1682445](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** Snowflake math: `let l=e=>(BigInt(new Date(e).getTime())-BigInt(14200704e5)<<22n).toString()`, where `14200704e5` = 1420070400000. It is exported as `toSnowflake` and used for `min_id`/`max_id`. — [contents.04ff201a.js · cPwpL @389764](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); Export copy @6611556 in [tabs/Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js). This matches Discord's documented formula: Discord Epoch "1420070400000", timestamp from snowflake = "(snowflake >> 22) + 1420070400000", snowflake from timestamp = "(timestamp_ms - DISCORD_EPOCH) << 22". — [Discord docs: Reference/Snowflakes](https://docs.discord.com/developers/reference)
- **[confirmed]** Fetch loop `eB()`, core logic. This is lightly simplified: Parcel's `(0,M.…)` / `(0,w.…)` / `(0,s.default)` call wrappers are removed and `…` marks omitted code; everything else is verbatim.
  ```
  if(!ex()){let e=a?await fetchDiscordMessages({channelId:o,token:c,startDate:u,endDate:h}):await fetchGuildDiscordMessages({channelId:o,guilds:i,token:c,startDate:u,endDate:h});…let r=e.messages?.[0]?.[0]?.id;if(!r){em(100),ev(p.DONE);return}eH({around:r})}
  let{messageList:f,nextMessageId:g}=await fetchDiscordChannelMessages({channelId:o,token:c,guilds:i,...ex()});
  …m=f.filter(e=>{let t=k(e.chatId),r=Number.isFinite(t)?t:dayjs(e.date).valueOf();return r>=v&&r<=C});
  if(d(e=>[...e,...m]),eu(l().length),eH({before:g}),…,m.length<1){em(100),ev(p.DONE);return}
  if(await wait(500),t.signal.aborted)return;n=0
  ```
  — [tabs/Export.be6c1dc7.js · 6uyrl @1696314–1697975](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Snowflake to time conversion for the client-side filter: `let k=e=>{try{return Number(BigInt(e)>>22n)+14200704e5}catch{return NaN}}`. `v`/`C` are `new Date(start/end).getTime()`. — [tabs/Export.be6c1dc7.js · 6uyrl @1692590](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** The cursor is `nextMessageId:r` with `r=e[e.length-1]?.id`, the last (oldest) element of the page Discord returned. So paging runs newest to oldest. Page size is the fixed `limit:"50"`. — [contents.04ff201a.js · cPwpL @391698](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Stop and terminal states:
  - The search returns no hit: DONE at 100%.
  - A page has zero in-range messages (`m.length<1`): DONE. This also covers an empty page at the start of the channel.
  - The user presses Pause (`eL.current.abort()` with `onabort`): SUSPENDED. Continue re-enters `eB()` with the saved `before` cursor.
  - The free-tier cap aborts the run (Q6).
  - More than 5 consecutive errors: SUSPENDED (Q5).

  — [tabs/Export.be6c1dc7.js · 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Progress is `Math.min(100,Math.max(0,(o-a)/(o-n)*100))`, where `a=k(nextMessageId)` and `n`/`o` are start/end. It only ever increases. The preview shows messages reversed (`[...C].reverse()`), 10 per page. — [tabs/Export.be6c1dc7.js · 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed, docs]** The search defaults the code relies on (it sends no sort params) are `sort_by` = `timestamp` and `sort_order` = `desc`, and `messages` is "A nested array of messages that match the query". — [Discord docs: Message resource](https://docs.discord.com/developers/resources/message)

### Inferences
- The method is a hybrid: server-side search finds the range end (the newest in-range message), and client-side timestamp filtering finds the range start. Request count ≈ 1 search + ceil(in-range messages / 50) + 1 channel-message pages. The first `around` page also returns up to ~25 newer messages, which the filter drops.
- HTTP 202 ("index not yet available") is a 2xx, so `t.ok` passes. `messages` is empty, so the run ends at once as DONE and shows "No messages found in this date range". The documented `retry_after` is ignored.
- If the newest in-range messages are not yet in the search index, messages newer than the anchor that fall outside the `around` window would be silently missed.
- The range follows the browser's local time zone because of `getLocalTimeZone()`. Within each page, Discord returns messages newest first, consistent with taking the last element as the cursor.

### Gaps
- Exactly how many messages Discord returns on each side of `around` with `limit=50` is not stated in the fetched docs.

## 4. How it identifies the current server, channel, DM or thread, and which conversation types it supports

### Takeaway
The IDs come only from the discord.com tab URL, read by the content script from `window.location.href`. The DOM is used only as a title fallback, and Discord's webpack stores are never touched. Supported: guild text channels, threads and forum posts (as thread URLs), DMs and group DMs (`/channels/@me/…`, which use DM search). Forum and media parent channels are refused with a prompt to open a post. There is one channel per export, with no multi-channel or whole-server export.

### Cited Findings
- **[confirmed]** The URL parsers in the content script are:
  - `getGuilds`: `window.location.href.match(/\/channels\/(\d+)/)`
  - `getThreadId`: `/\/channels\/(?:@me|\d+)\/\d+\/threads\/(\d+)/`
  - `getChannelId`: the thread id if present, else `/\/channels\/(?:@me|\d+)\/(\d+)/`
  - `getIsUserMessage`: `e.startsWith("https://discord.com/channels/@me/")`

  — [contents.04ff201a.js · cPwpL @395981/@396108/@397845](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Title: for a thread, `GET /channels/{threadId}` → `r.name`. Otherwise it reads the DOM, `document.querySelector('section[class^="title"]')?.children?.[0]?.querySelector("h1")`, and falls back to `"Channel"`. — [contents.04ff201a.js · cPwpL @396314](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Forum and media channels: `needThread = !getThreadId() && !isUserMessage && isThreadOnlyChannel(channelId, token)`, where the check is `r?.type===15||r?.type===16`. The popup then shows "This is a forum channel — its posts live in threads. Open the post you want to export, then reopen the extension." and disables Start (`isDisabled:c||t`). — [contents.04ff201a.js · 2CBF1/cPwpL @396526](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); [popup.100f6462.js · 5QXb8 @1681872](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** DMs and group DMs:
  - When `isUserMessage` is true, the Export page calls `fetchDiscordMessages`, the channel-scoped search.
  - The icon is `cdn.discordapp.com/channel-icons/${id}/${icon}.png` (group DM icon) or the avatar of `recipients?.[0]`.
  - The file name becomes `chatlogs-@me-${channelId}`; otherwise it is `chatlogs-${guildId}-${channelId}`.

  — [tabs/Export.be6c1dc7.js · 6uyrl @1695645](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [contents.04ff201a.js · cPwpL @397594](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Error states:
  - `isError=!t&&!a` (neither channel nor guild in the URL), or a non-discord.com tab: "This isn't a Discord page. Please open a Discord channel and try again."
  - `tabs.sendMessage` throws because no content script is present: "Please refresh the page, then reopen the extension to finish setup.", with a "Refresh Page" button that calls `chrome.tabs.reload(e)`.

  — [popup.100f6462.js · 5QXb8 @1679923](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** One conversation per run: the Export page takes a single `channelId` URL param, and nothing in the code loops over channels or calls guild channel listings. — [tabs/Export.be6c1dc7.js · 6uyrl @1697975](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- A thread opened as a channel (`/channels/{guild}/{threadId}`) works through the plain channel regex. A thread opened in full view (`…/threads/{id}`) works through the thread regex. Forum posts work because each post is a thread.
- `ptb.discord.com` and `canary.discord.com` are not covered: the manifest matches only `https://discord.com/*` and the popup checks `startsWith("https://discord.com/")`.
- For DMs, `guilds` reaches the Export page as the string `"null"`, because `URLSearchParams` stringifies `null`. This is harmless, since it is used only for file names and guild-member avatars.

### Gaps
- Behaviour on voice-channel text chat, announcement channels and stage channels was not specifically checked. Nothing in the code special-cases them beyond types 15 and 16.

## 5. Rate limiting and error handling

### Takeaway
Discord rate-limit signals are not handled at all. No `X-RateLimit-*` or `Retry-After` header is read, and `retry_after` in a 429 body is ignored. Any non-2xx response becomes a generic error. The loop is strictly sequential (one request in flight), sleeps a fixed **500 ms** after each successful page and **3,000 ms** after any error, and gives up after **6 consecutive failures**, pausing the run with an alert. There is no backoff or jitter.

### Cited Findings
- **[confirmed]** Error mapping in every helper: `if(!t.ok)throw Error(`HTTP error! status: ${t.status}`)`. There are no reads of `X-RateLimit`, `retry_after` or `Retry-After` anywhere in the app code. The only `Retry-After` string in the package is in Sentry's fetch transport (module 9FMPS, `"retry-after":r.headers.get("Retry-After")`), and that transport never runs because the DSN is undefined. — [contents.04ff201a.js · cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); [static/background/index.js · 9FMPS @654336](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** Fixed sleeps and retry cap: after a successful page, `if(await (0,w.wait)(500),t.signal.aborted)return;n=0`. On error, `catch(e){if(t.signal.aborted)return;if(console.error("Error occurred, retrying...",e),await (0,w.wait)(3e3),++n>5){ev(p.SUSPENDED),alert("Something went wrong. Please try again later.\n"+e.message);return}}`. Here `wait=e=>new Promise(t=>{setTimeout(t,e)})`. — [tabs/Export.be6c1dc7.js · 6uyrl @1697836/@1697845; 5Loqs `~utils/wait` @6620215](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Concurrency:
  - Every export-loop call is `await`ed inside `for(;;)`.
  - `getDetail` runs up to 3 lookups in parallel with `Promise.all([getIcon(e), getExportTitle(e), !getThreadId()&&!o&&isThreadOnlyChannel(t,e)])`.
  - The attachment downloader awaits each `fetch(o.url)` in turn, with no delay between files.

  — [contents.04ff201a.js · 2CBF1 @149193](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); [tabs/Export.be6c1dc7.js · 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed, docs]** The search endpoint answers HTTP 202 with a `retry_after` value when the index is not ready, and the docs say to retry after that time. The code does not. — [Discord docs: Message resource](https://docs.discord.com/developers/resources/message)

### Inferences
- The steady rate is at most 1 request per (round-trip time + 500 ms), roughly ≤2 requests/s or ≤100 messages/s. A 429 is retried after a fixed 3 s whatever its `retry_after` says. Six 429s in a row (~18 s) pause the run. Discord's per-route limits would usually be respected by accident rather than by design.
- The retry counter resets after every successful page, so a long run can absorb many isolated failures.

### Gaps
- Discord's actual per-route limits for user tokens on `/messages` and `/messages/search` are not published, so the real chance of 429s cannot be quantified statically.

## 6. Message caps, free vs paid limits, and license/subscription checks

### Takeaway
Free users are capped at **100 in-range messages per export run**. Clicking "Unlock More Free Exports" raises this to **200**: it asks for a 5-star review, opens the Chrome Web Store review page and sets the new limit with no verification. Paid status (`isPro`) comes from a third-party backend, `worker-api.extbolt.com`, using a Supabase (Google sign-in) session. It is cached in `chrome.storage.local` as `isPaid`, and the gate is enforced in the Export page's UI code. Downloads themselves are not gated.

### Cited Findings
- **[confirmed]** Constants: `MAIN_TAB="main"`, …, `ANONYMOUS_USER="00000000-0000-0000-0000-000000000000"`, `FREE_MAX_TRAIL_COUNT=100`, `REVIEWED_FREE_MAX_TRAIL_COUNT=200`, `PROXY="https://proxy.lazytech.workers.dev/"`. The raw source reads `…s="00000000-0000-0000-0000-000000000000",u=100,d=200,…`. — [tabs/Export.be6c1dc7.js · dhOOp `~utils/constant` @147555](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Trial logic (`useTrialLimit`):
  - The limit is stored under `key:"FREE_MAX_TRAIL_COUNT"` in chrome.storage.local, default 100.
  - The count is in-memory `useGetSet(0)` and is set from the fetch loop with `eu(l().length)`, the number of in-range messages collected in this run.
  - The check is `isTrailExpired:()=>a()>=e()`.
  - The rating prompt is ``alert(`Rate us 5 stars and export up to ${i.REVIEWED_FREE_MAX_TRAIL_COUNT} messages per run for free!`)``, where the constant is 200. It then calls `chrome.runtime.sendMessage({action:"openUrl",payload:{url:e}})` (with `e=(0,c.getExtensionReviewUrl)()`) and `t(i.REVIEWED_FREE_MAX_TRAIL_COUNT)` (new limit 200), and sets `HAS_CONFIRMED_RATING` (`d(!0)`) and `HAS_SHOWED_RATING_PROMPT` (`f(!0)`).

  — [tabs/Export.be6c1dc7.js · jodCC `~hooks/useTrialLimit` @6607298/@6607752](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Enforcement during fetching: `useEffect(()=>{if(es()&&!ec){eM(),alert("You've reached the free plan's export limit. Upgrade to Pro for unlimited exports."),eL.current.abort();return}},[es(),ec])`. The Continue button repeats the same check. The UI banner reads "Free plan exports up to {limit} messages". — [tabs/Export.be6c1dc7.js · 6uyrl @1698307/@1704730/@1699526](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** The license check runs in the `CommonProvider` used by the popup, Export and upgrade pages:
  - It calls `checkSubscriptionStatus()`, which POSTs to `https://worker-api.extbolt.com/api/v2/check-subscription-status`.
  - Headers: `"Content-Type":"application/json"` and `Authorization:`Bearer ${supabase access_token}`` (only when signed in).
  - Body: `{project_id:"61a31dd7-8c69-4e82-b15e-8b5134cd6e49", trial_product_id?}`.
  - The response `{isPro=!1,isReviewed=!1,expiry_date=null}` is stored as `isPaid`, `IS_REVIEWED` and `expiry_date` in chrome.storage.local.

  — [tabs/Export.be6c1dc7.js · kiLZw `~core/api` @414141/@414237; cMVDP @144916/@144983](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Paywall and other remote config:
  - `GET https://worker-api.extbolt.com/api/get-project-config?project_id=61a31dd7-…` is parsed by `toProduct()`. It picks a vendor among `["paddle","creem","polar"]` and maps variants to price/period/discount displays and a `management_url`.
  - `GET /api/get-project-config-v2?project_id=61a31dd7-…` is stored as "customConfig" and is not consumed by any UI.
  - `GET /api/get-project-config-v2?project_id=bbd6821f-2ff1-4afb-8aa4-298f4edef3e4` is stored as `promotionConfig`, a cross-promotion list.
  - A `markReviewed: "/api/user/mark-reviewed"` route is defined but `markAsReviewed` is never called.

  — [tabs/Export.be6c1dc7.js · kiLZw/74AKn @414727/@415873](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Subscribe flow:
  - If the user is not signed in: `sendToBackground({name:"signInWithGoogle",body:{nextUrl:H.url}})`. After OAuth, the background replaces `{email}` and opens the URL.
  - If signed in: `H.url.replace("{email}",email)` and then `chrome.runtime.sendMessage({action:"openUrl",payload:{url:a}})`.
  - The copy says "We use Paypal and Paddle…" and "7-day money-back guarantee".
  - The feature table still lists **"Delete Tweets" / "Delete Replies"**, apparently left over from a template for a different (Twitter) product.

  — [tabs/Export.be6c1dc7.js · 59r4Q `~popup/components/Upgrade` @3590241/@3590321/@3591241](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Downloads are not gated: `ExportDownloadButton` (1hQwp) and `exportToFile` (dFJOd) contain no `isPaid` or limit checks, and the Export page offers `formats:["html","csv","xlsx"]`. — [tabs/Export.be6c1dc7.js · 1hQwp/dFJOd/6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- The cap is per run and soft:
  - The counter lives in memory, so every new Export tab starts at 0.
  - The check runs after each 50-message page is appended, so a free run can overshoot by up to 49 messages.
  - Messages already fetched stay exportable after the abort.
- Paid status is decided server-side by ExtBolt but enforced only client-side, using the cached `isPaid` flag in `chrome.storage.local`.
- Signed-out users never send a bearer token, so they presumably always get `isPro:false`.

### Gaps
- What ExtBolt is (operator, terms, data retention) could not be confirmed. `extbolt.com` and `www.extbolt.com` did not resolve from the fetch tool, and a web search found no product page (the closest hits were the unrelated ExtensionPay, e.g. [ExtPay on GitHub](https://github.com/glench/ExtPay)).
- The live prices, vendor, checkout URLs and promotion list are fetched remotely and are not in the package.

## 7. Internal architecture: service worker, content script, injected script, extension pages, and how they communicate

### Takeaway
This is a Plasmo MV3 extension with five execution contexts:
1. **injected.a4186a2d.js** (MAIN world, registered at runtime by the service worker) captures the token into the DOM.
2. **contents.04ff201a.js** (isolated content script) reads the token and URL IDs, makes small metadata API calls and answers the popup's `getDetail`.
3. **popup** gathers context and the dates, then opens the Export tab with everything, token included, in its URL.
4. **tabs/Export.html** does all bulk fetching, preview, export and attachment downloads.
5. The **service worker** handles only Google sign-in (Supabase via `chrome.identity.launchWebAuthFlow`), `openUrl` tab opening, the MAIN-world registration and the uninstall URL.

Communication between them:
- Injected script → content script: the DOM attribute.
- Popup → content script: `chrome.tabs.sendMessage`.
- Popup → Export tab: URL parameters.
- UI pages → service worker: `chrome.runtime.sendMessage` and Plasmo `sendToBackground`.

### Cited Findings
- **[confirmed]** The service-worker entry `kgW6q` loads `e("./messaging"),e("../../../background/index"),e("./main-world-scripts")`. — [static/background/index.js · kgW6q](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** Plasmo messaging hub:
  - `chrome.runtime.onMessage.addListener((e,t,r)=>("signInWithGoogle"===e.name&&(0,a.default)({...e,sender:t},{send:e=>r(e)}),!0))`.
  - `chrome.runtime.onMessageExternal.addListener((e,t,r)=>(e?.name,!0))` does nothing.
  - `onConnect` only stores ports in `globalThis.__plasmoInternalPortMap`.
  - The library's `sendToBackground` is `i().sendMessage(e.extensionId??null,e)`.

  — [static/background/index.js · iG3ww `./messaging` @2044/@2144](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js); [tabs/Export.be6c1dc7.js · 92GyB `@plasmohq/messaging`](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Raw actions handled by the service worker:
  - `sentryCapture` relays to Sentry, which is disabled.
  - `"openUrl"` calls `chrome.tabs.create({url:t,active:!0})`. If the message carries `tabPayload`/`tabAction`, it waits for `tabs.onUpdated` with status `complete` and then calls `chrome.tabs.sendMessage(a.id,{action:i,payload:n})`. No sender uses this second part.
  - `"getCurrentTab"` calls `chrome.tabs.query({active:!0,currentWindow:!0})` and replies with the id. It has no sender in any bundle.
  - On startup it logs `"Live now; make now always the most precious time. Now will never come again."`.

  — [static/background/index.js · lSzt3 @1009516/@1009772/@1010038/@1010424](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** The `identity` permission is used only for Supabase Google OAuth (PKCE):
  1. `chrome.identity.getRedirectURL()`
  2. `supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:t,skipBrowserRedirect:!0}})`
  3. `chrome.identity.launchWebAuthFlow({url:r.url,interactive:!0})`
  4. `exchangeCodeForSession(p)`
  5. `o.set("login_time",new Date().toUTCString())`
  6. If `pending_next_url` is set, `chrome.tabs.create({url:g.replace("{email}",email)})`

  There are 0 occurrences of `getAuthToken`, `getProfileUserInfo` or `removeCachedAuthToken`. — [static/background/index.js · 9BFy9 `~background/messages/signInWithGoogle` @2812/@3046/@3376/@3421](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** Supabase client: `createClient("https://zjtlssppxzesxvhwokje.supabase.co","sb_publishable_pw4eZMXdHvK5ylFlUeFbow_KJtNQnQL",{auth:{storage:<Plasmo Storage area local>,autoRefreshToken:!0,persistSession:!0,detectSessionInUrl:!1,flowType:"pkce"}})`. On `"SIGNED_OUT"` it removes `userData` and `isPaid`. The bundled supabase-js session key template is `sb-${hostname.split(".")[0]}-auth-token`, plus a `-code-verifier` suffix during PKCE. — [static/background/index.js · 9q9KP `~core/supabase` @749345/@749514/@749766/@753231](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** The content script is a Plasmo CSUI. The React root mounts an overlay whose component renders `null` and only registers the `getDetail` listener. It also injects `data-text:~style.css`, ~238 KB of Tailwind, through `getStyle`. — [contents.04ff201a.js · 8c7fz/2CBF1/cQR1V](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- **[confirmed]** Popup:
  - Tabs Home, Upgrade and Profile. Profile shows the Google email, name and plan, plus "Manage Subscriptions" (`chrome.tabs.create({url:a.management_url})`) and Logout (`supabase.auth.signOut()`).
  - It silences logging with `console.log=function(){}`.
  - Support contact: `help@lazytechstudio.com`.

  — [popup.100f6462.js · 1Okmw/hhQG1/lyoyn @5914150/@5914711/@7572056](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** `tabs/upgrade.html` (module av7m5) just renders the Upgrade component. No bundle contains the string `upgrade.html`, so no code opens it. — [tabs/upgrade.47595dae.js · av7m5](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/upgrade.47595dae.js)
- **[confirmed]** `dist.ae9fd27b.js` is a Parcel lazy chunk of framer-motion feature modules (`./render/dom/motion.mjs`, …). Popup, Export and upgrade register it as `"1Bk25":"dist.ae9fd27b.js"` and load it with `getBundleURL("oUROn")+"../"+resolve("1Bk25")`. It contains no URLs and no app logic. — [dist.ae9fd27b.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/dist.ae9fd27b.js); [tabs/Export.be6c1dc7.js @1105014](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Permission use:
  - `scripting`: only `registerContentScripts` (0 `executeScript`).
  - `tabs`: `query`, `sendMessage`, `create`, `reload`, `onUpdated`, `onRemoved`.
  - `storage`: Plasmo `area:"local"` throughout. The app passes no `sync` or `session` area.
  - The manifest's `web_accessible_resources` lists `contents.95bad065.css`, which is missing from the package.

  — [static/background/index.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js); [manifest.json](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/manifest.json)

### Inferences
- The MAIN-world script is registered when the service worker starts (`.catch(e=>{})` swallows "duplicate id" errors). Discord tabs that were already open at install time have neither script until they are reloaded, which explains the popup's "Please refresh the page" state.
- The service worker is not part of data acquisition. All Discord traffic comes from the content script (metadata) and the Export tab (messages and attachments).

### Gaps
- Exact Chrome behaviour for `onMessageExternal` without an `externally_connectable` key was not checked. It does not matter here because the handler is a no-op.

## 8. Every external host the extension contacts, its purpose, and whether Discord data reaches it

### Takeaway
Apart from Discord (discord.com/api/v9 and cdn.discordapp.com), the extension contacts:
- Supabase `zjtlssppxzesxvhwokje.supabase.co`, for Google sign-in.
- ExtBolt `worker-api.extbolt.com`, for the subscription check and remote paywall/promo config.
- `chromewebstore.google.com`, for the review page and cross-promoted extensions.
- `forms.gle/5Y2msLvYxW9terAC6`, the uninstall survey.
- Payment and checkout URLs and promotion images supplied by remote config.

There is no analytics or telemetry: Sentry is bundled but disabled, and there is no GA, Mixpanel, Amplitude or PostHog. `proxy.lazytech.workers.dev` is declared but never used. No code path sends Discord tokens, IDs or message content to any non-Discord host. The Google email is put into payment URLs.

### Cited Findings
- **[confirmed]** Discord:
  - `https://discord.com/api/v9/*`, five endpoints, with the user token (Q2).
  - `https://cdn.discordapp.com/*`, for avatar/icon `<img>` URLs and attachment fetches.
  - Message-embed images use `proxyIconUrl||iconUrl` and `thumbnail.proxyUrl||thumbnail.url` taken from the message data.

  — [contents.04ff201a.js · cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js); [tabs/Export.be6c1dc7.js · ipbyC `~tabs/components/MessageTable`](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** `https://zjtlssppxzesxvhwokje.supabase.co` handles Supabase Auth (Google OAuth with PKCE, session refresh, sign-out). The client is created in the background and in all three UI bundles with publishable key `sb_publishable_pw4eZMXdHvK5ylFlUeFbow_KJtNQnQL`. The app code makes no `.from()`, `.rpc()`, `.functions.invoke` or `.channel()` calls. — [static/background/index.js · 9q9KP @749345](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** `https://worker-api.extbolt.com` is the license/paywall backend. It serves `POST /api/v2/check-subscription-status`, `GET /api/get-project-config`, `GET /api/get-project-config-v2` (two project ids) and the unused `POST /api/user/mark-reviewed`. Requests carry only `project_id`/`trial_product_id` and, when signed in, a Supabase JWT bearer. These calls run whenever the popup, Export or upgrade page mounts `CommonProvider`. — [tabs/Export.be6c1dc7.js · kiLZw/cMVDP @414141](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** `https://chromewebstore.google.com`:
  - The review prompt opens `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`.
  - The "MoreToolsDropdown" cross-promotion opens `https://chromewebstore.google.com/detail/${e.id}` and shows `<img src={e.image}>` from the remote `promotionConfig`, rotated every `ms("1m")`.

  — [tabs/Export.be6c1dc7.js · 5Y9UF @6609571, fKcC8 @6128223](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** `https://forms.gle/5Y2msLvYxW9terAC6` is the uninstall survey: `chrome.runtime.onInstalled.addListener(e=>{e.reason===chrome.runtime.OnInstalledReason.INSTALL&&chrome.runtime.setUninstallURL("https://forms.gle/5Y2msLvYxW9terAC6")})`. It is a static URL with no query parameters, and no welcome page is opened on install. — [static/background/index.js · lSzt3 @1010643](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** Payment and checkout hosts come from remote config. Vendor objects are `paddle`, `creem` and `polar`; variant `url`s are opened with `{email}` replaced by the Supabase/Google email, and `management_url` is opened as-is. These hosts are not in the package. — [tabs/Export.be6c1dc7.js · 74AKn/59r4Q @415873/@3590321](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [popup.100f6462.js · 1Okmw @5914150](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** `https://proxy.lazytech.workers.dev/` (a Cloudflare Workers host) is exported as `PROXY` from `~utils/constant` in the popup, Export and upgrade bundles. No other occurrence exists, so it is dead code. — [popup.100f6462.js · dhOOp @1404566](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- **[confirmed]** Telemetry:
  - The background bundles `@sentry/browser`, but the DSN is `void 0`. `initSentry` returns early and `captureException` is a no-op without a scope. All UI-side `~utils/sentry` modules are stubs.
  - The bundles contain no `google-analytics`, `googletagmanager`, `gtag(`, `mixpanel`, `amplitude`, `posthog`, `segment.io`, `plausible`, `hotjar` or `clarity.ms` strings.
  - Other URL strings in the background are Sentry SDK metadata or examples, not endpoints: `vitals.vercel-insights.com` (example value in Sentry's attribute schema), `docs.sentry.io`, `develop.sentry.dev`, `opentelemetry.io`, `console.aws.amazon.com`, `assets.myapp.com`, `example.com`.

  — [static/background/index.js · ky5iB @10308, Sentry conventions @374820](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- **[confirmed]** The remaining URL strings come from libraries and are never contacted: `github.com`, `w3.org`, `schemas.openxmlformats.org`/`schemas.microsoft.com`/`purl.org`/`docs.oasis-open.org`/`sheetjs.com` (SheetJS XLSX), `reactjs.org` (React error links), and icon-set homepages from react-icons metadata. — [tabs/Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- **[confirmed]** Discord data never flows to third parties in the code:
  - The ExtBolt request bodies contain only project ids.
  - The Supabase calls are auth only.
  - The uninstall URL is static.
  - Payment URLs receive only the Google email.
  - The Discord token, guild/channel IDs, usernames and message content stay in the content script, popup and Export tab memory, the Export tab URL, and the user's downloaded files.

  — [tabs/Export.be6c1dc7.js · kiLZw/59r4Q/6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- Implicit hosts in the sign-in flow:
  - The Supabase `/auth/v1/authorize?provider=google` redirect goes to Google's OAuth pages, `accounts.google.com`.
  - The flow returns to `https://lmoceiadfbnpofjbmgemloenlfkhhbhl.chromiumapp.org/`, the value of `chrome.identity.getRedirectURL()`, which Chrome intercepts.

  Neither host is a literal in the code.
- The Supabase JWT sent to ExtBolt carries the user's Google identity (email, and name/avatar in `user_metadata`). ExtBolt therefore learns who the paying user is, but nothing about their Discord account.
- Remote-config hosts (promotion images, checkout pages) can change server-side at any time without an extension update.
- The developer appears to be "LazyTech Studio", based on `help@lazytechstudio.com` and the `lazytech.workers.dev` subdomain. This is not verified externally; the manifest author string is Plasmo's template default.

### Gaps
- The actual promotion list, image hosts and checkout URLs served by ExtBolt could not be retrieved statically and were not fetched.
- ExtBolt's identity and privacy practices are unverified (see Q6 Gaps).
