# Discord Chat Export Tool v1.7.0: user-facing options and the export pipeline (static source analysis)

Method and conventions. Everything here comes from static reading of the installed extension at `/Users/kevinsbarski/Library/Application Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/`. No extension code was executed or loaded. Each bundle was parsed as text with acorn and split into its Parcel modules. Parcel production bundles keep every import specifier next to the target module id (for example `"~utils/exportToHTML":"3ueND"`), so the developer's own source files (Plasmo `~` alias paths) can be named exactly. Code quotes come from prettier-formatted copies of those modules. Whitespace differs from the minified originals, but identifiers and string literals are identical. Any module can be found in the original bundle by searching for its id (e.g. `3ueND`). Citations give bundle file + Parcel module id + original source path. "Confirmed" means read directly in code; anything under "Inferences" goes beyond what the code states.

Developer modules in `tabs/Export.be6c1dc7.js`:
- `b3pW7` entry
- `5SGtt ~tabs/Export`
- `6uyrl ~tabs/components/Main`
- `1hQwp ~components/ExportDownloadButton`
- `dFJOd ~utils/exportToFile`
- `3ueND ~utils/exportToHTML`
- `ipbyC ~tabs/components/MessageTable`
- `8Q3Zi ~tabs/components/AttachmentsDialog`
- `cPwpL ~utils/discordHelper`
- `j4mq9 ~utils/fomartDate` (sic)
- `5Loqs ~utils/wait`
- `jodCC ~hooks/useTrialLimit`
- `dm9Lh ~hooks/useGetSetStorage`
- `5Y9UF ~utils/getExtensionReviewUrl`
- `dhOOp ~utils/constant`
- `cMVDP ~components/CommonContext`
- `59r4Q ~popup/components/Upgrade`
- `1IiDE ~components/SegmentedTabs`
- `fKcC8 ~components/MoreToolsDropdown`
- `4QNeE ~components/ErrorBoundary`
- `kiLZw ~core/api`
- `74AKn ~core/projectConfig`
- `iavfN ~core/supabase`
- `hCouT ~utils/sentry`
- `kpeVt data-text:~style.css`
- `bkXdL data-base64:~assets/defaultUser.png`
- `7ansJ xlsx` (SheetJS)

Developer modules in `popup.100f6462.js`:
- `9gSao ../../popup/index.tsx`
- `lyoyn ~popup/Popup`
- `5QXb8 ~popup/components/Main`
- `1Okmw ~popup/components/Profile`
- `hhQG1 ~utils/silentConsoleLog`

Other bundles:
- `contents.04ff201a.js`: `2CBF1 ~contents/index` (plus the same `cPwpL` discordHelper)
- `tabs/upgrade.47595dae.js`: `av7m5 ~tabs/upgrade`

## 1. What does the UI offer in the popup and the Export tab, and what is gated as premium?

### Takeaway
The popup has a single export control: a Start/End date picker (day granularity, browser-local time zone, no presets) and a "Start Exporting" button. It always exports the one channel, DM or thread open in the active Discord tab. Everything else is on the Export tab:
- a progress bar with Pause/Continue
- a split "Download Messages" button whose menu offers HTML/CSV/XLSX
- a separate "Attachments" download dialog
- a 10-per-page preview

There are no include/exclude toggles, file-naming, splitting, channel-selection or language options. The only premium gate is a client-side per-run message cap for free users: 100 messages, or 200 after clicking a "rate us" prompt. Free users get every format and the attachment downloader.

### Cited Findings

**Popup shell and tabs**
- Root render: `CommonProvider` > `HeroUIProvider` > `div` `className:"w-[420px] min-h-[400px]"` holding `Popup`, plus a footer `["V",t.version]` from `chrome.runtime.getManifest()`. It also calls `disableConsoleLogInProduction()`, which sets `console.log = function () {}`. — [popup.100f6462.js, 9gSao ../../popup/index.tsx + hhQG1 ~utils/silentConsoleLog](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Popup header:
  - icon + `chrome.i18n.getMessage("extensionNameInExt")`
  - when signed out, a button `"Not Signed In"` (`"Signing in…"` while pending) that calls `sendToBackground({ name: "signInWithGoogle" })`
  - when signed in, the Google avatar and `user_metadata.full_name`
  - a `"Pro"` pill: `bg-[#006FEE]` if paid (opens Profile), `bg-[#999999]` if free (opens Upgrade)

  — [popup.100f6462.js, lyoyn ~popup/Popup](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Popup tabs: `Tab { title: "Home" }`, `{ title: "Upgrade" }`, `{ title: "Profile" }`, keyed by `MAIN_TAB = "main"`, `UPGRADE_TAB = "Upgrade"`, `PROFILE_TAB = "PROFILE"`. The constants `STATISTICS_TAB = "Statistics"` and `HELP_TAB = "HELP"` exist but no tab uses them. — [popup.100f6462.js, lyoyn + dhOOp ~utils/constant](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)

**Popup Home tab (`5QXb8 ~popup/components/Main`)**
- On open, the popup queries the active tab. If the URL starts with `https://discord.com/`, it sends `chrome.tabs.sendMessage(c.id, { action: "getDetail" })` to the content script. — [popup.100f6462.js, 5QXb8](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Status and error copy:
  - `"Loading Discord channel..."`
  - channel card = HeroUI `User` with `name: g()?.title`, `description: g()?.url`, `avatarProps: { src: g()?.icon }`
  - `"Please refresh the page, then reopen the extension to finish setup."` with button `"Refresh Page"` (reloads the Discord tab and closes the popup)
  - `"This is a forum channel — its posts live in threads. Open the post you want to export, then reopen the extension."`
  - `"This isn't a Discord page. Please open a Discord channel and try again."`

  — [popup.100f6462.js, 5QXb8](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Date range: two HeroUI `DatePicker`s, `label: "Start Date"` with `defaultValue: z.add({ years: -4 })` and `label: "End date"` with `defaultValue: z`, where `z = (0, s.now)((0, s.getLocalTimeZone)())`. Both use `granularity: "day"`, `name: "startDate"` / `"endDate"`. No other inputs exist. — [popup.100f6462.js, 5QXb8](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Time zone handling: each value is parsed with `t.includes("T") ? parseZonedDateTime(t) : toZoned(parseDate(t), getLocalTimeZone())`. It is then set to `{ hour: 0, minute: 0, second: 0, millisecond: 0 }` (start) or `{ hour: 23, minute: 59, second: 59, millisecond: 999 }` (end) and serialized with `.toAbsoluteString()` (an absolute UTC instant). — [popup.100f6462.js, 5QXb8](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- `"Start Exporting"` (`type: "submit"`, `isDisabled: c || t`) builds `new URLSearchParams({ startDate, endDate, ...g() })` and opens `chrome.runtime.getURL(`/tabs/Export.html?${r}`)` via `chrome.tabs.create({ url: n, active: !0 })`. — [popup.100f6462.js, 5QXb8](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- `g()` is the content script's `getDetail` reply `{ channelId, token, guilds, isUserMessage, icon, title, url, isError, needThread }`. The Discord token therefore travels in the Export tab's URL query string. This is relevant to the auth researcher. — [contents.04ff201a.js, 2CBF1 ~contents/index](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- The content-script component returns `null` (no visible UI inside Discord). It only answers `getDetail`. — [contents.04ff201a.js, 2CBF1](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- The date picker locale is fixed by HeroUIProvider's default `locale:g="en-US"`; the popup passes no `locale`. — [popup.100f6462.js, HeroUIProvider code](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)

**What gets exported (scope)**
- `getChannelId` returns the thread id when the URL matches `/\/channels\/(?:@me|\d+)\/\d+\/threads\/(\d+)/`, otherwise the channel id from `/\/channels\/(?:@me|\d+)\/(\d+)/`. `getGuilds` uses `/\/channels\/(\d+)/`. DMs are detected by `startsWith("https://discord.com/channels/@me/")`. Forum and media channels are detected by the channel API returning `type === 15 || type === 16`. — [Export.be6c1dc7.js, cPwpL ~utils/discordHelper](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Title: the thread name from `/api/v9/channels/{threadId}`, else the DOM `section[class^="title"]` `h1` text, else `"Channel"`.
- Icon: guild icon `https://cdn.discordapp.com/icons/${e}/${t}.${gif|png}`, group-DM icon `https://cdn.discordapp.com/channel-icons/${e}/${a}.png`, or the first DM recipient's avatar.

  — [Export.be6c1dc7.js, cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

**Export tab (`tabs/Export.html` → `5SGtt ~tabs/Export` → `6uyrl ~tabs/components/Main`)**
- Page shell: `tabs/Export.html` contains only `<div id="__plasmo">` and `<script src="/tabs/Export.be6c1dc7.js" defer>`. The page renders `ErrorBoundary` > `CommonProvider` > `HeroUIProvider` > `Main` and sets the tab title with `useTitle(chrome.i18n.getMessage("extensionNameInExt"))`. — [tabs/Export.html](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.html); [Export.be6c1dc7.js, 5SGtt](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Inputs come only from the URL: `e.get("startDate")`, `"endDate"`, `"channelId"`, `"guilds"`, `"token"`, `"isUserMessage"`, `"icon"`, `"title"`, `"url"`. The fetch starts automatically (`eB()`) once storage has loaded. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Header:
  - icon + extension name
  - `MoreToolsDropdown`
  - `"Unlock More Free Exports"` (hidden when `getHasConfirmedRating()` or paid)
  - `"Upgrade to Pro"` (hidden when paid)
  - a disabled `"Pro"` badge (shown when paid)

  — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Channel card:
  - icon, or the first letter of the title, or `"#"`
  - the title linked to the Discord URL (`title: "Open this channel in Discord"`)
  - a status chip showing `"Running"` / `"Paused"` / `"Done"` (an `"Error"` style is defined, but no code path sets it)
  - a date chip `YYYY/MM/DD → YYYY/MM/DD` via `dayjs(...).format("YYYY/MM/DD")`

  — [Export.be6c1dc7.js, 6uyrl + dhOOp](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Progress area:
  - label `"Export progress"` and `[Math.round(eC()), "%"]`
  - a `role: "progressbar"`
  - `"Pause"` while Running (`eL.current.abort()`)
  - `"Continue"` while Paused
  - stat tiles `"Messages"` and `"Attachments"` with counts

  — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Format and download control: `ExportDownloadButton` with `formats: ["html", "csv", "xlsx"]`, `subject: "Messages"`, `showHint: !1`.
  - Main button: `"Download"` + `"Messages"` + `"·"` + the format label, plus a count badge. It shows `["Exporting ", Z.label, "..."]` while running and is disabled when the count is 0.
  - Chevron: `aria-label: "Choose another export format"` opens `role: "menu"` / `aria-label: "Export format"`, listing `"Download all as "` + label with these descriptions:
    - CSV `"Opens in Excel, Numbers or Google Sheets"`
    - XLSX `"Native Excel workbook, one sheet"`
    - HTML `"Searchable page with filter, paging and links"`
    - JSON `"Raw records for scripts and imports"` is defined but not offered on this page

  — [Export.be6c1dc7.js, 1hQwp + 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The last chosen format persists via `useStorage({ key: "preferredExportFormat", instance: new Storage({ area: "local" }) }, V[0])`, so HTML is the default until another format is picked. The hint `"The format you pick becomes your default next time."` is hidden on this page. — [Export.be6c1dc7.js, 1hQwp](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `"Attachments"` button with a count badge (`isDisabled: !Q.length`) opens the AttachmentsDialog (see Q4). — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Free banner (hidden when paid): `["Free plan exports up to ", ef(), " messages"]`, `"Upgrade to Pro for unlimited exports across every channel."`, `"Upgrade Now"`. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Preview:
  - heading `"Preview"` and counter `[eF, "–", eS, " of ", total]`
  - `MessageTable` showing 10 rows per page (`Math.ceil(l().length / 10)`), `["Page ", J, " of ", ea]`, HeroUI `Pagination`
  - empty states `"Fetching messages from Discord…"` / `"No messages found in this date range"`
  - per-row error fallback `"⚠️ Failed to render this message — click to see details"` (sections "Error", "Component stack", "Raw message data") and toast `"Some messages failed to render"`

  — [Export.be6c1dc7.js, 6uyrl + ipbyC](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Toasts and page-level error copy:
  - `"HTML exported"`, `` `${e.toUpperCase()} exported` ``, `` `${e.toUpperCase()} export failed` ``
  - ErrorBoundary: `"Something went wrong while rendering the page."`, `"The export task may have produced unexpected data. The error has been logged to the DevTools console."`, `"Reload page"`

  — [Export.be6c1dc7.js, 6uyrl + 4QNeE](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- MoreToolsDropdown cross-promotes other extensions from a remote list:
  - source: `getPromotionConfig`, project id `"bbd6821f-2ff1-4afb-8aa4-298f4edef3e4"` on `https://worker-api.extbolt.com`
  - rotates the shown item every minute: `setInterval(e, (0, u.default)("1m"))`
  - each item opens `` `https://chromewebstore.google.com/detail/${e.id}` ``
  - menu `aria-label: "ACME features"`
  - hidden when the list is empty

  — [Export.be6c1dc7.js, fKcC8 + kiLZw](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

**Options that do not exist (searched for and absent)**
- No date presets: `"Last 7"`, `"Last 30"`, `"Yesterday"`, `"This month"` and `"preset"` all have 0 occurrences in the popup bundle. — [popup.100f6462.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- None of the developer modules contain:
  - channel, DM or server pickers or multi-select
  - include/exclude toggles for attachments, images, videos, other files, avatars, embeds or reactions
  - a filename field
  - output splitting
  - a language selector

  ("Split" and "Language" occur 0 times in developer code; their hits are inside libraries.) — [popup.100f6462.js developer modules](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js); [Export.be6c1dc7.js developer modules](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

**i18n**
- `_locales` has 55 locales with only these keys:
  - `extensionName` and `extensionDescription` (all 55)
  - `extensionNameInExt` (22: ar, de, en, en_AU, en_GB, en_US, es, es_419, fa, fr, hi, it, ja, ko, lt, pt_BR, pt_PT, ru, tr, vi, zh_CN, zh_TW)

  English: "Discord Chat Export Tool" / "Effortlessly export Discord messages, photos, videos, and all files with just one click!". — [_locales/en/messages.json](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/_locales/en/messages.json)
- All in-app copy is hard-coded English JSX. The only runtime i18n call is `chrome.i18n.getMessage("extensionNameInExt")` (popup header, Export header, Export tab title). No `i18next` appears among the dependency specifiers. — [Export.be6c1dc7.js, 5SGtt + 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [popup.100f6462.js, lyoyn](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)

**Premium / paid gating**
- Constants: `FREE_MAX_TRAIL_COUNT = 100`, `REVIEWED_FREE_MAX_TRAIL_COUNT = 200`. — [Export.be6c1dc7.js, dhOOp ~utils/constant](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `useTrialLimit`:
  - reads the limit from chrome.storage.local key `"FREE_MAX_TRAIL_COUNT"` (default 100)
  - `isTrailExpired: () => a() >= e()`, where `a` is an in-memory per-run counter (`useGetSet(0)`)
  - `promptForRating` runs `alert(`Rate us 5 stars and export up to ${i.REVIEWED_FREE_MAX_TRAIL_COUNT} messages per run for free!`)`, opens `` `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews` ``, sets the limit to 200 and sets `HAS_CONFIRMED_RATING` true

  — [Export.be6c1dc7.js, jodCC + 5Y9UF](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Enforcement: after each page, `eu(l().length)` sets the counter to the number of messages collected. An effect then runs `if (es() && !ec) { eM(), alert("You've reached the free plan's export limit. Upgrade to Pro for unlimited exports."), eL.current.abort(); }`. "Continue" performs the same check before resuming. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Paid status: storage key `"isPaid"` is set from `isPro` in the response of `POST https://worker-api.extbolt.com/api/v2/check-subscription-status` with `project_id: "61a31dd7-8c69-4e82-b15e-8b5134cd6e49"` and a Supabase bearer token. — [Export.be6c1dc7.js, cMVDP + kiLZw](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Upgrade component (popup Upgrade tab, Export-tab "Upgrade" modal, and `tabs/upgrade.html`):
  - feature table `"Feature"` / `"Free"` / `"Pro"` with rows `"Delete Tweets"` `"≤ 1 time"` `"Unlimited"` and `"Delete Replies"` ✓ ✓, which is leftover copy from a different product
  - plan selector `SegmentedTabs` `"aria-label": "Plan period"`
  - `" 7-day money-back guarantee"`
  - `"Subscribe"` (needs Google sign-in first)
  - `"We use Paypal and Paddle to process purchases and do not know your card details. No Paypal account is needed."`

  — [Export.be6c1dc7.js, 59r4Q ~popup/components/Upgrade](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Pricing is remote:
  - source: `fetchProjectConfig` (`/api/get-project-config`), vendors `["paddle", "creem", "polar"]`
  - display: `period_suffix: r ? "lifetime" : "/mo"`, `billing_label: r ? "One-time payment" : `${s(n)} billed ${a} ${1 === a ? "month" : "months"}``

  — [Export.be6c1dc7.js, 74AKn ~core/projectConfig](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Upgrade page: `document.title = "Upgrade Your Plan"`, heading `"Upgrade"`. — [tabs/upgrade.47595dae.js, av7m5 ~tabs/upgrade](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/upgrade.47595dae.js)
- Profile tab:
  - `"Account information:"`, `"User Email: "`, `"User Name: "`, `"User Plan:"` with Pro/Free
  - `"Manage Subscriptions"` (opens `management_url`), `"Logout"`, `"Sign in with Google"`
  - support e-mail `"help@lazytechstudio.com"`

  — [popup.100f6462.js, 1Okmw ~popup/components/Profile](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)

### Inferences
- The free cap is checked only after each 50-message page and only by aborting further fetches, so a free run can end above 100 (or 200). For example, 50 + 49 in-range messages = 99, so the run continues to 149. Everything already collected stays downloadable in every format.
- The cap value, the "rated" flag and the per-run counter are all client-side; the 200 limit is granted on click without verifying a review.
- The "Delete Tweets"/"Delete Replies" table, the "ACME features" label and the remote multi-extension promotion list point to a developer template shared across several extensions. The identity strings in code are LazyTech Studio (`help@lazytechstudio.com`), `proxy.lazytech.workers.dev` and `worker-api.extbolt.com`. This matters because the manifest author is the Plasmo default.
- Because HeroUIProvider defaults to `en-US`, the date fields likely display in US month/day/year order whatever the browser language.

### Gaps
- Remote-config-driven text (prices, plan names, promotion items) can't be reconstructed statically.
- `customConfig` (from `/api/get-project-config-v2`) and `IS_REVIEWED` are loaded into context, but no consumer was found in the developer modules, so any effect on gating is unknown.

## 2. Which export formats exist, and how is each generated?

### Takeaway
Three formats are offered: HTML, CSV and XLSX.
- **HTML:** React `renderToStaticMarkup` (from `react-dom/server.browser`) renders each message into markup, which is wrapped in a hand-written template string.
- **CSV and XLSX:** SheetJS Community Edition 0.18.5 builds them (`json_to_sheet` → `book_append_sheet(..., "Sheet1")` → `XLSX.write`).
- **JSON:** a branch exists in `exportToFile` but no UI path offers it.

There is no TXT, PDF, Markdown or DOCX writer, and no papaparse, jsPDF, html2canvas or docx library.

### Cited Findings
- The Export tab passes `formats: ["html", "csv", "xlsx"]`. The button component also defines a `json` entry; its fallback list is `p = ["csv", "xlsx"]`. — [Export.be6c1dc7.js, 6uyrl + 1hQwp](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Dispatch: `if ("html" === e) { exportToHTML({ data: z, title: U(), icon: N(), url: K(), filename: t }); toast.success("HTML exported") }`. Otherwise the messages are flattened and passed to `exportToFile(r, t, e)`. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `exportToFile`:
  - JSON: `JSON.stringify(e, null, 2)` → `new Blob([r], { type: "application/json" })`
  - otherwise: `n.utils.json_to_sheet(e)`, `n.utils.book_new()`, `n.utils.book_append_sheet(i, o, "Sheet1")`, then `n.write(i, { type: "array", bookType: "xlsx" })` or `bookType: "csv"`, else `throw Error("Unsupported format")`
  - output Blob `{ type: "application/octet-stream" }`

  — [Export.be6c1dc7.js, dFJOd ~utils/exportToFile](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- SheetJS identity: banner `/*! xlsx.js (C) 2013-present SheetJS -- http://sheetjs.com` and `en.version="0.18.5"` in the module imported as `"xlsx"` (7ansJ). — [Export.be6c1dc7.js, 7ansJ](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- HTML generation: `(0, s.default).renderToStaticMarkup((0, n.jsx)(o.MessageRow, { item: e }))` per message, `u.map(h).join("")`, then `` `<!DOCTYPE html><html>${f}${g}</html>` ``. — [Export.be6c1dc7.js, 3ueND ~utils/exportToHTML](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- CSV/XLSX flattening:
  - `attachments: e.attachments?.map((e) => e?.url).join("\n")`
  - `embeds` become lines `` `Author: ${e.author.name}` ``, `` `Title: ${e.title}` ``, `` `Description: ${e.description}` ``, `` `Footer: ${e.footer.text}` `` joined by `"\n---\n"`
  - fallbacks: `"[unrenderable embed]"` and `_error: "Failed to flatten message"`

  — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The per-message record (and therefore the CSV/XLSX columns) is `{ chatId, messageType, authorName, avatar, content, attachments, embeds, stickers, poll, date, referenceMessage, referenceMessageDate, referenceMessageAuthor }`.
  - `date: (0, n.formatDate)(e.timestamp)` produces `dayjs(e).format("YYYY/MM/DD HH:mm")`
  - `referenceMessageDate: i?.timestamp` is raw

  — [Export.be6c1dc7.js, cPwpL + j4mq9](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- SheetJS `sheet_add_json` stores object/array values as raw cells: `!s||"object"!=typeof s||s instanceof Date?( ...typed cell... ):i[f]=s`. The CSV row writer emits an empty field for a cell with no `v` and no formula: `if(null!=p.v){...}else null==p.f||p.F?u="":...`. — [Export.be6c1dc7.js, 7ansJ](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- CSV byte format:
  - `XLSX.write` with `type:"array"` re-enters as binary: `"array"==n.type){n.type="binary";var o=le(e,n);return n.type="array",ey(o)}`
  - CSV is written as `case"csv":return c8(ls(...),n,"﻿")`, where `c8` prepends the BOM and UTF-8 encodes (`case"binary":return ro(a)`)
  - defaults `FS ","` and `RS "\n"`; a field is quoted when it contains the separator, a newline or `"`

  — [Export.be6c1dc7.js, 7ansJ](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- No other format writers: every developer module was read in full, and none produces TXT, PDF or Markdown. The Export bundle's full dependency-specifier inventory (283 distinct top-level names, including some non-package tokens picked up by the regex) contains no papaparse, jspdf, html2canvas, docx, jszip or fflate. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- In CSV and XLSX the `stickers` (array) and `poll` (object or undefined) columns come out blank. CSV-blank follows directly from the row-writer code; XLSX-blank is inferred because the cell has no `v`.
- CSV is UTF-8 with a BOM, so Excel shows Unicode correctly.
- Column order follows first-seen key order: chatId, messageType, authorName, avatar, content, attachments, embeds, stickers, poll, date, referenceMessage, referenceMessageDate, referenceMessageAuthor.
- `date` is a text cell in local time without seconds or zone, e.g. "2024/05/01 13:45", while `referenceMessageDate` is Discord's raw ISO timestamp. Date formats are therefore inconsistent within one file, and neither is a native Excel date.
- `chatId` stays text, so snowflakes don't lose precision.
- The JSON export is dead code in v1.7.0.

### Gaps
- No file was produced (static analysis only); exact Excel rendering was not observed.

## 3. HTML export: what does the output look like?

### Takeaway
The HTML export is one document: `<!DOCTYPE html>`, a `<head>` holding the extension's entire compiled Tailwind/HeroUI stylesheet (~230 KB) in a `<style>` tag, and a `<body>`. The body holds a channel header and a Discord-dark list of messages: avatar, name, time, reply quote, markdown-rendered content, embed cards, sticker and poll chips, and inline image/video/audio players or file links.

It contains no JavaScript. Despite the menu text ("Searchable page with filter, paging and links"), it has no search, filter or paging.

All media (attachments, avatars, embed thumbnails, the channel icon) are remote `cdn.discordapp.com`-style URLs. The only base64 image is the default-avatar fallback. The file is therefore self-contained for styling but not for media, and attachment links are signed URLs that expire.

### Cited Findings
- Assembly:
  - head: `` f = `<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>${c.default}</style></head>` ``
  - body: `'<body style="margin:0;padding:0;background-color:#313338;"><div class="min-h-screen bg-[#313338]">' + l + `<div class="flex flex-col bg-[#313338]">${p}</div>` + "</div></body>"`
  - document: `` `<!DOCTYPE html><html>${f}${g}</html>` ``, then `new Blob([v], { type: "text/html" })`
  - Nothing else is concatenated, so no `<script>` is emitted.

  — [Export.be6c1dc7.js, 3ueND ~utils/exportToHTML](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The inlined CSS is the import `data-text:~style.css` (module kpeVt, 238,088 chars of JS source). Its text starts `*,:before,:after{box-sizing:border-box;border:0 solid #e5e7eb}:before,:after{--tw-content:""}`, contains 1,610 `--heroui` occurrences, and includes classes used by the rows (`bg-[#313338]`, `max-w-[300px]`). — [Export.be6c1dc7.js, kpeVt](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The shipped `tabs/upgrade.850787d0.css` (232,906 bytes) has the same 1,610 `--heroui` occurrences and the `bg-discord-surface` class, i.e. the same stylesheet. — [tabs/upgrade.850787d0.css](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/upgrade.850787d0.css)
- Header block: `<img src={icon} className="w-12 h-12 rounded-full">`, an `<h1>` with the title, and `<a href={url} target="_blank" className="text-sm text-[#00aff4] hover:underline">{url}</a>` on `bg-[#2b2d31]` / `bg-[#232428]` panels. If rendering fails, it falls back to an escaped title `div`. — [Export.be6c1dc7.js, 3ueND](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Message order is oldest first: `z = Array.isArray(C) ? [...C].reverse() : []` is what gets exported. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Row (`MessageRow`) layout:
  - avatar: `<img src={C(e?.avatar)}>` with `C = (e) => ("string" != typeof e || !e || e.endsWith("null.png") ? i.default : e)`, where `i` is `data-base64:~assets/defaultUser.png`
  - author: `text-[15px] font-semibold text-[#f2f3f5]`
  - time: `formatDate(e?.date)` in `text-[#949ba4]`
  - hover row tint `hover:bg-white/[0.03]`

  — [Export.be6c1dc7.js, ipbyC ~tabs/components/MessageTable](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Replies: a quote block (`border-l-2 border-[#5865f2]/70`) showing `["@", e.referenceMessageAuthor || "unknown"]`, the reply's date, and the referenced text as plain (non-markdown) text. — [Export.be6c1dc7.js, ipbyC](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Markdown uses `markdown-to-jsx` with `forceInline: !1`, `disableParsingRawHTML: !0` and overrides:
  - `h2`, `h3`, `strong`, `em`
  - `a` (`target: "_blank"`, `rel: "noopener noreferrer"`, `text-[#00aff4]`)
  - `ul`, `ol`, `li`, `p`
  - `code`: a styled block when a language class is present (`bg-[#2b2d31] p-3 ... font-mono`), else inline `bg-[#1e1f22] px-1.5`
  - all inside an error boundary that falls back to `whitespace-pre-wrap` plain text

  Preprocessing turns `\n` into `"  \n"` (hard breaks) and trims stray spaces inside `**`, `*`, `__`, `~~` markers. — [Export.be6c1dc7.js, ipbyC](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Discord tokens are rewritten to text before rendering (also in the CSV/XLSX `content`):
  - `<@id>` / `<@!id>` → `@{global_name|username|id}` via `mentions`
  - `<@&id>` → `@{role name}` or `@&{id}`
  - `<#id>` → `#{name}` or `#{id}`
  - custom emoji `/<a?:([a-zA-Z0-9_]+):\d+>/g` → `` `:${t}:` `` (no image)
  - `/<t:(\d+)(?::([a-zA-Z]))?>/g` → `new Date(r).toISOString()`

  — [Export.be6c1dc7.js, cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Special message types:
  - system messages become sentences such as `` `${t} pinned a message.` ``, `` `${t} joined the server.` ``, `` `${t} boosted the server.` ``, `` `${t} created a thread${...}.` ``, `"Poll closed."`, `` `[AutoMod] ${...}` ``
  - forwarded messages: `message_snapshots[0].message` content is appended as `"[Forwarded]\n…"`, and its attachments, embeds, stickers and poll are merged in
  - voice messages (`(8192 & e.flags) == 8192`) get `"[Voice message]"`

  — [Export.be6c1dc7.js, cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Embeds:
  - Rendering: a card with `borderLeft: 4px solid {color}` (default `#5865f2`), author icon (`proxyIconUrl || iconUrl`) + name, title, description (markdown), footer text, and a thumbnail `<img src={thumbnail.proxyUrl || thumbnail.url}>` capped at 80 px.
  - Kept by the transform: only `type, title, description, color, fields, author, thumbnail, footer`. There is no `image`, `video`, `url`, `timestamp` or `provider`.
  - `fields` are captured but not rendered.

  — [Export.be6c1dc7.js, ipbyC + cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Stickers render as a text chip `["🟣 sticker: ", e?.name || e?.id]`; only `{ id, name }` is kept. Polls render as `["📊 ", e.poll.question || "Poll"]` plus a bullet list of answer texts; there are no vote counts. — [Export.be6c1dc7.js, ipbyC + cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Attachments by category:
  - `"image"` → `<a href={url} target="_blank"><img src={url} className="max-w-[300px] ...">`
  - `"video"` → `<video controls><source src={url} type={contentType || "video/mp4"}>`
  - `"audio"` → `<audio controls><source ... "audio/mpeg">`
  - other → `<a href={url} download target="_blank">{filename || url}</a>`

  Category rule: `e.height || t?.startsWith("image/") ? "image" : t?.startsWith("video/") ? "video" : t?.startsWith("audio/") ? "audio" : "other"`. — [Export.be6c1dc7.js, ipbyC + cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Avatar URLs are built by the extension:
  - member avatar `` `https://cdn.discordapp.com/guilds/${t}/users/${r.id}/avatars/${a}.${e}` ``
  - user avatar `` `https://cdn.discordapp.com/avatars/${r.id}/${r.avatar}.${e}` `` (`gif` when the hash starts `a_`)
  - default `` `https://cdn.discordapp.com/embed/avatars/${t}.png` ``

  — [Export.be6c1dc7.js, cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Reactions are never read: the string "reactions" appears 0 times in the Export bundle. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Failure handling: a row that throws becomes `<div style="padding:8px 16px;color:#f23f42;...">⚠️ Failed to render message {id}: {error}</div>`, with values escaped by a `&<>"'` map. — [Export.be6c1dc7.js, 3ueND](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Discord's 2023 announcement (as reported) says:
  - attachment links carry a signature (`hm`) valid until an expiration timestamp (`ex`)
  - "all links to files uploaded to Discord servers will expire after 24 hours" once enforcement rolls out
  - "the API will automatically return valid, non-expired URLs" when messages are retrieved
  - links shared outside Discord expire only once authentication enforcement rolls out

  Article dated Nov 4, 2023. — [BleepingComputer](https://www.bleepingcomputer.com/news/security/discord-will-switch-to-temporary-file-links-to-block-malware-delivery)

### Inferences
- A saved HTML file is styled offline but needs network access for every image, video, avatar and file link. Attachment links are the API's signed `cdn.discordapp.com/attachments/...` URLs, so after the expiry window those images, videos and files may stop loading once Discord's enforcement applies. Avatar and icon URLs are constructed from hashes without signatures and break only if the user or server changes them. (Code + BleepingComputer.)
- Discord-specific markdown gaps follow from the override list and markdown-to-jsx semantics; none of this was verified by rendering:
  - spoilers `||x||` stay literal
  - `__x__` (underline in Discord) becomes bold
  - block quotes, `-#` subtext and `#` h1 headings get only Tailwind-reset styling
- Each HTML file carries about 230 KB of mostly unused CSS regardless of message count.
- Times are mixed: message times are local "YYYY/MM/DD HH:mm", while converted `<t:…>` timestamps are UTC ISO strings.
- Threads are not followed: only the open channel or thread is exported, and thread-starter/created messages appear as system text.
- The `download` attribute on "other" file links points cross-origin, so browsers will likely open the link rather than force a download. This is general browser behavior, not tested.

### Gaps
- No HTML was generated (static only), so appearance is reconstructed from class names.
- Whether Discord currently enforces link expiry outside its client was not verified; the source is the 2023 announcement.

## 4. How are attachments downloaded?

### Takeaway
Attachment download is a separate, manual step in the Export tab's "Download Attachments" modal. Only message attachments are covered, including those inside forwarded messages; avatars, emoji, stickers and embed images are never downloaded.

The user filters by category, ticks files and picks a folder (`showDirectoryPicker`). The Export tab page then fetches each selected file one at a time from its `cdn.discordapp.com` URL and writes it with `createWritable`. There is no concurrency, retry, size limit, HTTP-status check or signed-URL refresh, and no paid gate.

### Cited Findings
- Attachment list: `Q = C.reduce((e, t) => e.concat(Array.isArray(t?.attachments) ? t.attachments : []), [])` over all collected messages. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Each message contributes `[...f(e.attachments), ...f(a?.attachments)]` (its own plus the first forwarded snapshot's), each item `{ category, contentType, filename, url: e.url }`. — [Export.be6c1dc7.js, cPwpL](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Modal UI:
  - header `"Download Attachments"`
  - `Tabs` titled `` `All (${e.length})` ``, `` `Photos (${m.image?.length || 0})` ``, `Videos (n)`, `Audios (n)`, `Others (n)`, each disabled when empty
  - a 4-column thumbnail grid with checkbox and filename
  - `"Select All"` checkbox
  - button `` `Download Selected (${a?.length || 0})` `` / `"Downloading..."`
  - `isDismissable: !1`, `isKeyboardDismissDisabled: !0`
  - selection cleared on tab change: `useEffect(() => { c([]) }, [l])`

  — [Export.be6c1dc7.js, 8Q3Zi ~tabs/components/AttachmentsDialog](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Thumbnails: `new URL(e.url)` + `a.searchParams.append("format", "jpeg")`; audio and other files show a `FaRegFileAlt` icon instead. — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Folder selection:
  - unsupported browser: `if (!("showDirectoryPicker" in window)) toast.error("Your browser does not support directory selection. Please use Chrome or Edge.")`
  - pick: `e = await window.showDirectoryPicker({ mode: "readwrite" })`
  - user cancel (`AbortError`) returns silently; other errors toast `"Failed to select directory"`

  — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Sequential loop: `for (let o of a) try { let a = await fetch(o.url), i = await a.blob(), c = o.filename || "download", l = await v(e, c), s = await e.getFileHandle(l, { create: !0 }), d = await s.createWritable(); (await d.write(i), await d.close(), r++, toast.loading(`Download Progress: ${r}/${t}`, { id: n })) } catch (e) { toast.error(`Failed to download ${o.filename}`) }`, followed by `toast.success("All files downloaded successfully!", { id: n })`. — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Name collisions: `v()` loops `await e.getFileHandle(o)` and, while the name exists, tries `` `${a} (${i})${n}` ``. — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- What the loop never does: check `response.ok` or status, retry, use an AbortSignal, or check size or count. The dialog takes no paid prop (only `attachments`, `isOpen`, `onOpenChange`). — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `refresh-urls`, `refresh_urls` and `media.discordapp.net` occur 0 times in all bundles (Export, popup, background, contents, upgrade, dist). — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [static/background/index.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- `host_permissions` are `"https://discord.com/*", "https://cdn.discordapp.com/*"`. — [manifest.json](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/manifest.json)
- `PROXY = "https://proxy.lazytech.workers.dev/"` is exported from `~utils/constant` but never referenced (`.PROXY` occurs 0 times; "proxy.lazytech" appears once per bundle, at its definition). — [Export.be6c1dc7.js, dhOOp](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- **Fetch context:** the fetch runs in the Export tab page (`chrome-extension://…/tabs/Export.html`). Cross-origin reads from cdn.discordapp.com succeed because of the host permission; no service worker or page context is involved.
- **Silent failures:** because status is never checked, an expired or forbidden URL that returns an error body (403/404) would be saved as the "file" and counted as success. The final "All files downloaded successfully!" toast appears even when some files failed.
- **Memory:** each file is buffered fully in memory (`blob()`) before writing, one file at a time, so peak RAM is roughly the largest single attachment.
- **Expiry:** URLs are freshly signed when the run fetches the messages (per the API behavior reported by BleepingComputer), so downloading soon after the run works. Leaving the Export tab open past the expiry window would break downloads, with no refresh path.
- **Thumbnails:** `format=jpeg` thumbnails for videos may not render from cdn.discordapp.com (unverified).

### Gaps
- Not tested at runtime: behavior on 403/expired links, Chrome's File System Access restrictions on certain file types and folders, or very large files.

## 5. Packaging and saving: zip library, save mechanism, folder structure, file names

### Takeaway
Nothing is zipped, and there is no zip library in the developer code.
- **Message exports** are single files saved by clicking a temporary `<a download>` pointing at a `blob:` URL. This hands the file to Chrome's normal download flow, which is why no `downloads` permission is needed.
- **Attachments** are written straight into a user-chosen folder via the File System Access API (`showDirectoryPicker` → `getFileHandle({create:true})` → `createWritable`). The folder is flat, files keep Discord's original names, and collisions get " (n)" suffixes.
- **Filenames:** `chatlogs-<serverId>-<channelId>` or `chatlogs-@me-<channelId>`. CSV and XLSX add an extension; the HTML download name has none in code.
- **Only zip code in the bundle:** SheetJS's internal zip writer, which builds the XLSX container with stored (uncompressed) entries by default.

### Cited Findings
- Save mechanism for message files: `new Blob(...)` → `URL.createObjectURL` → `document.createElement("a")` → `.download = …` → `document.body.appendChild` → `.click()` → `URL.revokeObjectURL` → `removeChild`. — [Export.be6c1dc7.js, dFJOd + 3ueND](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Base filename: `` let t = `chatlogs-${G()}-${A()}`; if (P() && (t = `chatlogs-@me-${A()}`) ``, where G = `guilds` (server id), A = `channelId` (the thread id when a thread is open) and P = `isUserMessage`. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Extensions: `` o.download = `${t}.json` `` and `` s.download = `${t}.${r}` `` (csv/xlsx). HTML uses `m.download = o`, where `o` is the bare filename. — [Export.be6c1dc7.js, dFJOd + 3ueND](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Attachments are saved via `showDirectoryPicker({ mode: "readwrite" })`, `getFileHandle(l, { create: !0 })` and `createWritable()`, using `o.filename || "download"` with " (n)" de-duplication. There are no subfolders. — [Export.be6c1dc7.js, 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- None of the following appear among Parcel dependency specifiers or in developer modules: JSZip, fflate, client-zip, zip.js, conflux, StreamSaver. `showSaveFilePicker`, OPFS `navigator.storage.getDirectory`/`navigator.storage` and `indexedDB.open` occur 0 times across all bundles. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The bundle's `STORE`/`DEFLATE`/`compression` hits are all inside SheetJS (module 7ansJ): `["compression",!1]` is the default and the zip method is `i=(r||{}).compression?8:0`. The extension calls `n.write(i, { type: "array", bookType: "xlsx" })` without `compression`. — [Export.be6c1dc7.js, 7ansJ + dFJOd](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `chrome.downloads` appears only inside SheetJS's own `writeFile` helper (`"function"==typeof(chrome.downloads||{}).download ... chrome.downloads.download({url:i,filename:e,saveAs:!0})`), which the extension never calls. The manifest has no `"downloads"` permission. — [Export.be6c1dc7.js, 7ansJ](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [manifest.json](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/manifest.json)

### Inferences
- Message exports land wherever Chrome saves downloads (the default folder, or a Save As dialog if the user enabled "ask where to save").
- The HTML name has no extension in code, so Chrome most likely derives `.html` from the Blob type `text/html`. Not verified at runtime.
- The resulting layout is one file per click (`chatlogs-<serverId>-<channelId>.csv|.xlsx`, or the HTML) plus, optionally, a flat folder of attachments. The HTML points at CDN URLs, not at the downloaded files, so the two outputs aren't linked for offline viewing.
- XLSX files are larger than necessary because their zip entries are stored uncompressed.

### Gaps
- The exact final HTML filename on disk (whether ".html" or ".htm" is appended) was not observed.

## 6. Performance on large exports; why a dedicated Export tab; what dist.ae9fd27b.js is

### Takeaway
There is no large-export machinery. All work runs on the Export tab's main thread, and every message is kept in one in-memory React state array.

Fetching is paced: 50 messages per request, a 500 ms pause between pages, and on error a 3 s wait with at most 5 consecutive retries before auto-pausing. Progress is time-based, and Pause/Continue work through an AbortController and a saved cursor.

HTML, CSV and XLSX are generated synchronously, in memory, in one shot. There are no Web Workers, IndexedDB/OPFS buffering, streaming writes or output splitting for message exports.

The service worker does no export work; the dedicated tab hosts the long-running loop and the DOM and File System APIs. dist.ae9fd27b.js is a lazily loaded framer-motion animation chunk used by HeroUI components, unrelated to exporting.

### Cited Findings
- Paging:
  - requests use `new URLSearchParams({ limit: "50" })` with `before` or `around` on `` `https://discord.com/api/v9/channels/${e}/messages` ``
  - the first step queries `/api/v9/guilds/${r}/messages/search` (`channel_id`, `include_nsfw: "true"`, `min_id`, `max_id`), or `/api/v9/channels/${t}/messages/search` for DMs, to find the newest in-range message id
  - the loop then requests `around` that id, then `before` the oldest id of each page

  — [Export.be6c1dc7.js, cPwpL + 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Date filtering:
  - the snowflake is converted to ms with `Number(BigInt(e) >> 22n) + 14200704e5` and kept if `r >= v && r <= C`
  - the run stops when a page has no in-range messages (`m.length < 1` → `em(100), ev(p.DONE)`) or when the search finds nothing

  — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Pacing and backoff: `await (0, w.wait)(500)` between pages. On error: `await (0, w.wait)(3e3)`; once `++n > 5`, it sets `ev(p.SUSPENDED)` and calls `alert("Something went wrong. Please try again later.\n" + e.message)`. HTTP errors are thrown generically as `` `HTTP error! status: ${t.status}` `` with no Retry-After handling. — [Export.be6c1dc7.js, 6uyrl + cPwpL + 5Loqs](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Progress is `Math.min(100, Math.max(0, ((o - a) / (o - n)) * 100))`, where `a` is the cursor's timestamp and `o`/`n` are the end/start dates. It only ever increases (`i > eC() && em(i)`). — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Cancel and resume: `eL = useRef(new AbortController())`. Pause calls `eL.current.abort()`, and `t.signal.onabort` sets SUSPENDED. Continue calls `eB()` again, which resumes from the stored cursor `eH({ before: g })`. — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Memory model:
  - each page is appended with `d((e) => [...e, ...m])` into one array (react-use `useGetSet`)
  - the attachment list is rebuilt on every render via `reduce` + `concat`
  - the preview renders only 10 rows

  — [Export.be6c1dc7.js, 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Generation: a single `await new Promise((e) => setTimeout(e, 0))` yield, then synchronous work. HTML is `u.map(h).join("")` → one string → Blob; CSV/XLSX are a full SheetJS workbook → `XLSX.write`. — [Export.be6c1dc7.js, 6uyrl + 3ueND + dFJOd](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The Export bundle's only `new Worker` is in Supabase realtime-js (`_startWorkerHeartbeat(){... this.workerRef=new Worker(e)`), not export code. IndexedDB and OPFS are absent. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- Service worker role:
  - message handlers: `"openUrl"` (`chrome.tabs.create`), `"getCurrentTab"`, a Sentry relay, and `signInWithGoogle`
  - registers the MAIN-world script (`matches:["https://discord.com/*"],world:"MAIN",runAt:"document_start"`)
  - the string "discord" appears exactly once
  - no `chrome.offscreen` or `chrome.alarms`

  — [static/background/index.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- dist.ae9fd27b.js is 243,721 bytes and 241 Parcel modules. Its module `7A8qz` is `var o=e("framer-motion").domAnimation`, exported as default. — [dist.ae9fd27b.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/dist.ae9fd27b.js)
- Each page bundle registers `"1Bk25":"dist.ae9fd27b.js"` in its Parcel bundle manifest. Each has exactly one load site: `getBundleURL(...)+"../"+...resolve("1Bk25")).then(()=>t.bundle.root("7A8qz"))`. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [popup.100f6462.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js); [tabs/upgrade.47595dae.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/upgrade.47595dae.js)
- The loader (module 3D0UT) appends `<link rel="preload" as="script">` and an async `<script src=…>` to `<head>`. The importers are HeroUI `LazyMotion` wrappers in modules with `displayName="HeroUI.Ripple"`, `"HeroUI.PopoverContent"`, `"HeroUI.ModalContent"`, `"HeroUI.FreeSoloPopover"`, plus one more chunk (5Lm1b). — [Export.be6c1dc7.js, modules 3D0UT, e1hG8, idsJC, 7DJdn, b2Le6, aAStN, 5Lm1b](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- **Why a tab:** `<a download>` needs a DOM, and `showDirectoryPicker` needs a window and a user gesture, so these flows can't run in an MV3 service worker. A tab also keeps a multi-minute fetch loop alive regardless of service-worker idle limits. The code gives no explicit rationale; this is inferred from the APIs used.
- **Throughput:** at most about 100 messages per second (50 per page plus a 500 ms pause), lower in practice because each request adds latency. Not measured.
- **Large exports:**
  - the tab can freeze during HTML generation (synchronous `renderToStaticMarkup` for every message)
  - peak memory is roughly the message array + the full HTML string + its Blob copy, or the SheetJS workbook + output buffer
  - appends copy the whole array each page and the attachment `concat` accumulation repeats per render, so total work grows quadratically with export size
- **Rate limits:** there is no explicit 429/Retry-After handling. A long rate-limit window would exhaust the 5 retries (about 15 s) and auto-pause the run, after which the user can press Continue.

### Gaps
- No runtime profiling was done, so real memory ceilings and timings are unknown.

## 7. UI framework and libraries in the bundles

### Takeaway
The stack:
- React 18.2.0 with HeroUI (`@heroui/*`) on react-aria / react-stately
- Tailwind CSS via tailwind-variants and tailwind-merge
- framer-motion, @internationalized/date (date pickers), dayjs (formatting)
- markdown-to-jsx, react-hot-toast, react-icons, react-use
- SheetJS 0.18.5
- Plasmo's @plasmohq/storage and @plasmohq/messaging
- Supabase JS 2.101.1 (Google sign-in / subscription)
- Sentry in the background worker (page-level Sentry is stubbed)

Absent: Ant Design, MUI, Mantine, i18next, moment, date-fns, and any zip, PDF or CSV-parser library.

### Cited Findings
- Dependency specifiers in tabs/Export.be6c1dc7.js:
  - HeroUI: `@heroui/react`, `@heroui/button`, `@heroui/date-picker`, `@heroui/calendar`, `@heroui/date-input`, `@heroui/modal`, `@heroui/table`, `@heroui/tabs`, `@heroui/pagination`, `@heroui/dropdown`, `@heroui/popover`, `@heroui/checkbox`, `@heroui/spinner`, `@heroui/user`, `@heroui/avatar`, `@heroui/theme`, `@heroui/system`
  - react-aria and dates: `@react-aria/*`, `@react-stately/*`, `@internationalized/date`
  - styling and animation: `framer-motion`, `tailwind-variants`, `tailwind-merge`, `clsx`, `classnames`
  - utilities: `react-icons/ri|fi|fa|ai|io`, `react-use`, `react-hot-toast`, `markdown-to-jsx`, `dayjs`, `ms`, `nanoid`
  - export and render: `xlsx`, `react-dom/server.browser`
  - platform: `@plasmohq/storage`, `@plasmohq/messaging`, `@supabase/supabase-js`

  — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The popup has the same UI stack plus `react-icons/md`, `react-icons/fa6`, and no `xlsx`, `markdown-to-jsx` or `react-dom/server`. — [popup.100f6462.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- Version strings: `version:"18.2.0",rendererPackageName:"react-dom"`; SheetJS `en.version="0.18.5"`; `` "X-Client-Info":`supabase-js-${s}/2.101.1` `` and `"X-Client-Info":"storage-js/2.101.1"`. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- HeroUIProvider signature: `({children:t,navigate:e,disableAnimation:c,useHref:a,disableRipple:d=!1,skipFramerMotionAnimations:u=c,reducedMotion:v="never",validationBehavior:p,locale:g="en-US",...})`. — [popup.100f6462.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)
- The inlined stylesheet uses a Tailwind preflight: `*,:before,:after{box-sizing:border-box;border:0 solid #e5e7eb}:before,:after{--tw-content:""}`. It contains no "tailwindcss v" banner. — [Export.be6c1dc7.js, kpeVt](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [tabs/upgrade.850787d0.css](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/upgrade.850787d0.css)
- The background bundle includes `@sentry/browser`, `@sentry/core`, `@supabase/*` and `@plasmohq/storage`. — [static/background/index.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/static/background/index.js)
- The page-level `~utils/sentry` is a stub: `function o() { return !1; }` (isSentryEnabled), empty `captureException` and `initSentry`. — [Export.be6c1dc7.js, hCouT](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The content script bundles React, `@plasmo-static-common/csui`, `dayjs` and the discordHelper. — [contents.04ff201a.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/contents.04ff201a.js)
- None of the bundles' dependency-specifier lists contain antd, @mui, @mantine, i18next, moment, date-fns, jszip, fflate, papaparse, jspdf, html2canvas or docx. — [Export.be6c1dc7.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js); [popup.100f6462.js](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/popup.100f6462.js)

### Inferences
- The `--tw-content` preflight style suggests Tailwind v3, the usual pairing for HeroUI 2.x; it is not confirmed by a banner.

### Gaps
- The minified code does not embed version strings for HeroUI, framer-motion, dayjs, markdown-to-jsx or react-hot-toast.

## 8. Hard caps and free vs paid output differences

### Takeaway
The only product cap is the free-tier per-run message limit: 100, or 200 after clicking "Unlock More Free Exports". It is enforced client-side by aborting the fetch loop. Paid users have no message, file-size or attachment cap anywhere in code.

Free and paid output is identical: same formats, no watermark or branding, attachment downloads available.

Technical caps come only from SheetJS (XLSX cells over 32,767 characters throw; sheets over 1,048,576 rows are clamped by buggy code) and from browser memory.

### Cited Findings
- Free limit constants, storage and enforcement: `FREE_MAX_TRAIL_COUNT = 100`, `REVIEWED_FREE_MAX_TRAIL_COUNT = 200`, `isTrailExpired: () => a() >= e()`, plus the abort/alert effect in Main. — [Export.be6c1dc7.js, dhOOp + jodCC + 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- User-facing copy:
  - `"Free plan exports up to "` n `" messages"`
  - `"Upgrade to Pro for unlimited exports across every channel."`
  - `"You've reached the free plan's export limit. Upgrade to Pro for unlimited exports."`
  - `"Rate us 5 stars and export up to 200 messages per run for free!"`

  — [Export.be6c1dc7.js, 6uyrl + jodCC](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- `isPaid` (`ec`) appears in Main only to hide upgrade buttons and banners and in the limit check. The download handler `eI`, `exportToHTML`, `exportToFile` and `AttachmentsDialog` never read it. — [Export.be6c1dc7.js, 6uyrl + 3ueND + dFJOd + 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- The HTML template contains no watermark or branding: just head (meta + style), the channel header (icon/title/url) and the message rows. — [Export.be6c1dc7.js, 3ueND](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- SheetJS XLSX cell guard: `if(e.v.length>32767)throw Error("Text length must not exceed 32767 characters")`. The extension catches it and shows the `"XLSX export failed"` toast (`${e.toUpperCase()} export failed`). — [Export.be6c1dc7.js, 7ansJ + 6uyrl](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- SheetJS XLSX range clamp: `if(d.e.c>16383||d.e.r>1048575){if(t.WTF)throw Error("Range "+u+" exceeds format limit A1:XFD1048576");d.e.c=Math.min(d.e.c,16383),d.e.r=Math.min(d.e.c,1048575),u=al(d)}`. Note that the row clamp uses `d.e.c`. — [Export.be6c1dc7.js, 7ansJ](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)
- No message-count limit for paid users (the loop runs until a page has no in-range messages), and no file-size or attachment-count limit in the attachment loop. — [Export.be6c1dc7.js, 6uyrl + 8Q3Zi](file:///Users/kevinsbarski/Library/Application%20Support/Google/Chrome/Default/Extensions/lmoceiadfbnpofjbmgemloenlfkhhbhl/1.7.0_0/tabs/Export.be6c1dc7.js)

### Inferences
- With 13 columns (last index 12), an XLSX export of more than 1,048,575 messages would have its range clamped to row index 12 by the SheetJS bug, i.e. silently truncated to about 12 messages. This is irrelevant for normal channels and could only affect paid users.
- The 32,767-character cell limit is unlikely to bite: message content is far shorter, though a message with many long attachment URLs or large embeds could approach it.
- In practice the binding limits for big paid exports are time (pacing) and tab memory (Q6), not coded caps.

### Gaps
- Server-side subscription logic was not examined: what `checkSubscriptionStatus` returns, and trial grants via `trial_product_id`.
