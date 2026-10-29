# Discord web client: message-list DOM (research notes)

Collected 2026-10-29. This is read-only research. I did not log in, used no account and made no Discord API calls. Downloaded code was read with grep/sed and never executed.

## 0. Evidence base, confidence legend, caveats

**Primary source.** The source is the prettified webpack modules of the Discord web client itself. The build is canary build 655813 (versionHash `0a3e787f…`, builtAt 2026-10-29T11:10:37Z), as mirrored in the public repo [Wumpus-Central/discrapper-canary](https://github.com/Wumpus-Central/discrapper-canary), commit `76beb1e338f2` (2026-10-29). Module permalinks below use the base:
`https://github.com/Wumpus-Central/discrapper-canary/blob/76beb1e338f28456fb1c134a5ee8267af69791a6/chunks/<module>.js`
(For example, `chunks/860227.js` holds the message element-ID builders.) English UI strings were decoded from the en-US message table in the same build (`chunks/459463.js`).

**Other sources**
- `window.GLOBAL_ENV` was read from the public `https://discord.com/app` HTML (2026-10-29): `CDN_HOST "cdn.discordapp.com"`, `MEDIA_PROXY_ENDPOINT "//media.discordapp.net"`, `ASSET_ENDPOINT "//discord.com"`, `IMAGE_PROXY_ENDPOINTS "//images-ext-1.discordapp.net"`, `API_ENDPOINT "//discord.com/api"`.
- Third-party DOM scrapers updated in 2026 corroborate the main selectors. Last-commit dates were taken from the GitHub API:
  - [steveseguin/social_stream `sources/discord.js`](https://github.com/steveseguin/social_stream/blob/HEAD/sources/discord.js), 2026-09-26
  - [henry-bao/discord-chat-exporter `src/content/scrape.ts`](https://github.com/henry-bao/discord-chat-exporter/blob/HEAD/src/content/scrape.ts), 2026-08-30
  - [choephix/my-agents `tampermonkey/discord-thread-markdown.user.js`](https://github.com/choephix/my-agents/blob/HEAD/tampermonkey/discord-thread-markdown.user.js), 2026-10-23
  - [contraconceptions/discord-clean-csv-exporter `core.js`](https://github.com/contraconceptions/discord-clean-csv-exporter/blob/HEAD/core.js), 2026-10-24
  - [bvolpato/copy-as-markdown `src/extractors/discord.ts`](https://github.com/bvolpato/copy-as-markdown/blob/HEAD/src/extractors/discord.ts), 2026-07-30
  - [creikey/fastcord `tools/capture/probes/layout.js`](https://github.com/creikey/fastcord/blob/HEAD/tools/capture/probes/layout.js), 2026-10-26
  - [jakez-gh/discord-exporter `core/selectors.js`](https://github.com/jakez-gh/discord-exporter/blob/HEAD/core/selectors.js), 2026-02-22

**Confidence tags**
- **[C-src]**: confirmed in the current client source (build 655813, 2026-10-29).
- **[C-3p]**: also used by one or more third-party scrapers changed in 2025–2026.
- **[Old]**: older source (before 2025) or undated community report.
- **[Inf]**: inferred, not directly verified.

**Caveats**
- All markup snippets below are **reconstructed from the React source** (JSX → DOM). They are not captures from a live logged-in session. Attribute order, wrapper `div`s added by tooltip or focus components, and runtime `uid_N` numbers will differ.
- The source is **Canary**. Stable usually trails by days to weeks, so verify on Stable before shipping.
- Hashed class names are given only as fallbacks. In this build two hash formats coexist: `name__5hex` (e.g. `message__5126c`, `embedTitle__623de`) and `name_6hex` (e.g. `username_c19a55`, `botTag_c19a55`).
  - A substring like `[class*="embedTitle_"]` matches both formats.
  - Word-anchored forms (`[class^="x_"], [class*=" x_"]`) avoid false hits such as `usernameText_`.
- Some **unhashed literal classes** exist, which is useful: `imageWrapper`, `emoji`, `jumboable`, `emoji-text`, `obscured`, `inline` (inline code), `hljs`, `language-<lang>`, `mention`, `channelMention`, `attachmentLink`, `interactive`, `highlight`. [C-src]
- No `data-author-id`, `data-user-id`, `data-message-id` or `data-channel-id` attribute exists anywhere in the client. A grep over all 20,764 modules found none. [C-src]
- aria-labels and visible strings are **localized**, so use them only as secondary hints.
- Snippets show `role="button"`/`tabindex="0"` on elements rendered by Discord's generic Clickable component (`939249.js`). That is [Inf]; I didn't open that module.

---

## 1. List container and list items

### Container [C-src][C-3p]
`471533.js` (main list render), `837381.js` (list props), `602034.js` (`data-list-id`), `33176.js` (classes), `381941.js` (constants), `436405.js` (keying).

```html
<div class="scroller__36d07 …" role="group" tabindex="-1">            <!-- scroll container (overflow) -->
  <div class="scrollerContent__36d07">
    [forum post action bar]
    <ol class="scrollerInner__36d07" role="list" data-list-id="chat-messages"
        aria-label="Messages in {channelName}" aria-orientation="vertical" tabindex="…">
      <span id="messagesNavigationDescription" class="navigationDescription__36d07" aria-hidden="true">Use the up and down arrow keys…</span>
      … channel stream items (see below) …
      <div class="scrollerSpacer__36d07"></div>                          <!-- always last child -->
    </ol>
  </div>
</div>
```

- Use `ol[data-list-id="chat-messages"]` as the stable hook. Its `aria-label` is localized ("Messages in …").
- The `ol` is not the scroller. Walk up to the first ancestor with `overflow-y: auto|scroll` (henry-bao does the same).
- The main chat renders the list component with `key = channel.id` (`436405.js` line ~2794). On every channel switch the whole list, including the `ol`, unmounts and remounts.

### Message items [C-src][C-3p]
- The ID builder is `375901.js`: `` `chat-messages-${channelId}-${messageId}` ``.

```html
<li id="chat-messages-{channelId}-{messageId}" class="messageListItem__5126c" aria-setsize="-1">
  <div role="article"
       data-list-item-id="chat-messages___chat-messages-{channelId}-{messageId}"
       tabindex="-1" aria-setsize="-1" aria-roledescription="Message"
       aria-labelledby="…see §2…" [aria-describedby="uid_N message-reactions-{messageId}"]
       class="message__5126c cozyMessage__5126c [groupStart__5126c] [mentioned__5126c] [systemMessage__5126c] wrapper_c19a55 cozy_c19a55 zalgo_c19a55 [hasReply_c19a55] [hasThread_c19a55] [isSystemMessage_c19a55] …">
    [reply context  div#message-reply-context-{id}]        <!-- §6 -->
    [slash-command line  div.executedCommand_c19a55 …]
    <div class="contents_c19a55">
      [system message renderer] | [header: avatar img + h3]  <!-- §3/§8 -->
      [div#message-content-{id}]                              <!-- §5, omitted only for system msgs (they use it inside) -->
    </div>
    [div#message-accessories-{id}]                            <!-- §7 -->
    [div.buttonContainer_c19a55 …]                            <!-- hover toolbar, only mounted after hover/focus -->
  </div>
</li>
```

- `role="article"` is forced by the layout component (`491182.js`). `aria-roledescription` is the localized string "Message".
- **Are items direct children of the `ol`? Usually, but not always.** [C-src]
  - After a jump with flash (any `/channels/…/{messageId}` link or "Jump"), the target `li` is wrapped in `<div data-flash="…" class="backgroundFlash…">`. The wrapper persists for the life of that component, because the flashKey is kept in a ref (`471533.js` `e6`, `nz`).
  - Messages inside an *expanded* blocked/ignored group are nested inside the group `div` (below).
  - So always use descendant queries: `ol[data-list-id="chat-messages"] li[id^="chat-messages-"]`. Never use `> li`.
- Parse the ID with `/^chat-messages-(\d+)-(\d+)$/`. Group 2 is the message ID; you can also take the last `-`-separated segment.

### Other children of the `ol` [C-src]
None of these are `li[id^="chat-messages-"]`, except the forum caveat noted under the channel-beginning header.

| Item | How to recognise it | Notes |
|---|---|---|
| Navigation description | `span#messagesNavigationDescription[aria-hidden]` | Always the first child. |
| Date divider | `div[role="separator"][aria-label="{date}"][data-list-item-id^="chat-messages___divider-"]`, containing `span.content__908e2` with the date text | Classes `divider__908e2 hasContent__908e2` (`922529.js`, `749314.js`, `682172.js`). |
| Unread ("NEW") divider | `div#---new-messages-bar[role="separator"]` | Its aria-label is "new" or "new, {date}" when merged with a date divider. It contains `span.unreadPill__908e2` with the text "new". The id constant `"---new-messages-bar"` is in `381941.js`. The "N new messages since…" top bar is rendered **outside** the `ol`. |
| Channel-beginning header ("Welcome to #x!" / DM intro) | `div#chat-messages-{channelId}-{channelId}`: a `div` (not `li`) whose message part equals the channel ID | Rendered by `314307.js` (`id: j(channelId, channelId)`). It is only rendered when the top of the history is loaded. **Its presence means "beginning reached".** **Forum-post caveat:** the first message of a forum post has `messageId == channelId`, so an `li#chat-messages-{c}-{c}` there is a real message. Distinguish by tag (`li` vs `div`) or by an inner `[role=article][aria-roledescription]`. |
| "More history" skeletons | Plain `div` with fixed `style="height:…"` and fake message shapes, no IDs | `key="has-more"` sits at the top while `hasMoreBefore`; `has-more-after` sits at the bottom. A `div` "buffer" can also appear. |
| "Load more" button | Button item (`key="load-more-before"`) | Appears only when most loaded messages are collapsed blocked messages. |
| Blocked / ignored / suspended / spam collapsed group | `div` (no id) with class `groupStart__5126c [expanded__7a70a]`. It contains `div[role="article"]` (no `aria-roledescription`, no id) with text "{n} blocked messages — Show", "{n} ignored messages — Show", "One message removed from a suspended account." (no Show) or "{n} messages hidden from likely spammer. — Show" | Class fallbacks: `blockedSystemMessage__7a70a`, `blockedMessageText__7a70a`, `blockedAction__7a70a` (the Show/Hide control). When expanded, real `li#chat-messages-…` items are nested inside. |
| Thread starter (top of a thread opened from a message) | `div.quotedChatMessage__5126c` containing a "Jump" control (`aria-label="Jump"`) and a `div[role="article"]` whose `id` is the `chat-messages-{threadId}-{starterMsgId}` id itself. **There is no `li`.** | `471533.js` `nK`/`nV` [C-src]; choephix [C-3p]. The inner `message-content-`/`message-username-` ids use the **original parent-channel message ID**, which equals the thread ID. Selector: `[id^="chat-messages-"]` (not `li[...]`) when processing threads. |
| Pending upload (your own, uploading) | A `div[role="article"]` directly in the `ol`, no `li` and no `chat-messages-` id | From `636922.js`. Skip it. |
| Summary dividers, conversation headers, forum post action bar, DM "wave" prompt | Various `div`s without `chat-messages-` ids | Skip them. |

---

## 2. Group start vs continuation; author of continuation messages

### `aria-labelledby` on the `[role=article]` [C-src]
Built in `860227.js`, function `fF`:

```
username/reply part :  isSystem ? "" : (isReply ? "message-reply-context-{id}" : "message-username-{groupId ?? id}") + " uid_A"
+ " message-content-{id}"      if type != DEFAULT or content != "" (omitted for GIF-only messages)
+ " message-accessories-{id}"  if embeds/attachments/stickers/codedLinks/components/thread/poll/THREAD_CREATED
+ " uid_B message-timestamp-{id}"  unless system message
+ " uid_C"                    if IS_GUILD_OFFICIAL flag
```

- `uid_A`, `uid_B` and `uid_C` are ids of hidden `<div style="display:none">` elements appended to `<body>`. Their texts are ",", "," and "Official message"; a fourth one with "Reactions" is used by `aria-describedby`. The ids come from `uniqueId("uid_")` (`264927.js`, `915089.js`).
- `aria-describedby` is `"uid_D message-reactions-{id}"` when the message has reactions.

Examples:
```text
group start 111 (text+image):  message-username-111 uid_12 message-content-111 message-accessories-111 uid_13 message-timestamp-111
continuation 112 (group 111):  message-username-111 uid_12 message-content-112 uid_13 message-timestamp-112
reply 113:                     message-reply-context-113 uid_12 message-content-113 uid_13 message-timestamp-113
system message 114:            message-content-114
```

So the user's hypothesis is **confirmed**: continuation messages reference `message-username-{groupStartId}`. Two exceptions:
- **Replies** start the token list with `message-reply-context-{id}` instead.
- **System messages** have no username or timestamp tokens at all.

### Which message gets a header [C-src]
`471533.js` `n_`:
- **System message**: no header.
- **Group start** (`message.id === groupId`), **compact mode**, or **reply**: full header (username, timestamp and, in cozy mode, avatar).
- **Otherwise (cozy continuation)**: no username or avatar. It gets only a hover timestamp `<span class="timestamp_c19a55 timestampVisibleOnHover_c19a55 alt_c19a55 …"><time id="message-timestamp-{id}" …>`.
- The `groupStart__5126c` class is applied when `id === groupId` **or** the type is REPLY.

**Grouping rules** (`857069.js`, functions `u`/`d`). A new group starts when any of these hold:
- the previous item is not a message;
- the message has a thread, or is a slash/context command;
- blocked or ignored status differs;
- the type is not DEFAULT (any non-default type starts a new group unless the previous message is a user message and this is not a REPLY), so **every reply starts a new group**;
- the previous message is a system message;
- the author ID differs;
- ephemeral or scheduled status differs;
- it is a webhook with a different `author.username`;
- the two messages fall on different days;
- the messages are more than **7 minutes** apart;
- the suppress-notifications rules differ;
- the `applicationId` differs.

Within a group, author ID and webhook username are identical. So **continuation author = group anchor's author**.

**The window edge is handled by the client.** The stream code sets `groupId` to the *first rendered message* when the real group start isn't loaded (`n = e.groupId === z?.groupId ? z.content.id : e.groupId`, `471533.js` ~6477). The first rendered message of any group therefore always renders a header. [C-src]

### Recommended rule [C-src]
1. Read `article.getAttribute('aria-labelledby')`.
   - The token `message-username-(\d+)` gives `gid`. If `gid === ownId`, this is a group start (or compact mode).
   - The token `message-reply-context-` means a reply, which is always a group start and has its own header.
   - No username or reply token means a system message.
2. Get the author from the `li`'s own `[id^="message-username-"]` if present. Otherwise use `document.getElementById('message-username-' + gid)` inside the same `ol`. As a fallback, walk `previousElementSibling` (Social Stream walks up to 50 siblings [C-3p]), or carry the last seen author forward while iterating in DOM order (henry-bao [C-3p]).
3. **Duplicate IDs exist.**
   - In compact mode, every message in a group renders `span#message-username-{gid}`.
   - So scope lookups to the `li` first. If you must go global, the first match in document order is the group anchor.

---

## 3. Author elements

`895597.js` (header), `799162.js` (username), `707554.js` (heading tag), `812299.js`, `709066.js` and `73638.js` (bot tag), `486020.js` and `3451.js` (avatar URLs).

```html
<!-- cozy group start, inside div.contents_c19a55 -->
<img src="https://cdn.discordapp.com/avatars/{userId}/{hash}.webp?size=80" aria-hidden="true" alt=" "
     class="avatar_c19a55 clickable_c19a55">
[<img class="avatarDecoration_c19a55" src="…" alt=" " aria-hidden="true">]
<h3 class="header_c19a55" aria-labelledby="message-username-{gid} message-timestamp-{id}"
    [aria-describedby="message-reply-context-{id}"]>
  <span id="message-username-{gid}" class="headerText_c19a55 [hasRoleIcon_c19a55] [hasBadges_c19a55]">
    [timeout icon + hidden text]
    <span class="username_c19a55 [clickable_c19a55]" data-text="{display name}" style="color: rgb(…)"
          role="button" tabindex="0">{display name}</span>
    [<span class="clanTagChiplet_c19a55 …">guild tag</span>]
    [badges]
    [<span role="img" aria-label="App|Verified App|Server|OP|Official Discord Message"
           class="botTagCozy_c19a55 botTag_c19a55 botTagRegular__82f07 botTag__82f07 rem__82f07">
        [verified ✓ svg]<span class="botText__82f07">APP</span></span>]
  </span>
  <span class="timestamp_c19a55 timestampInline_c19a55">
    <time aria-label="{full date}" id="message-timestamp-{id}" datetime="2026-10-29T10:15:00.000Z"><i class="separator_c19a55" aria-hidden="true"> — </i>{formatted}</time>
  </span>
</h3>
```

- **The heading tag is dynamic.** It is `h${level}` from a heading-level context (`707554.js`); in chat it is normally `h3`. Don't hard-code `h3`; anchor on `[id^="message-username-"]`. [C-src]
- **Display name** [C-src]: the `data-text` attribute of the inner username span (`[id^="message-username-"] [data-text]`). Its value is the shown name: server nickname, else global display name, else username. Inside reply previews it may be prefixed with "@" when the reply pings.
- The unique `@handle` and the user ID are **not in the DOM**, except inside avatar URLs. Social Stream, henry-bao and choephix use `[class*="username"]` text. [C-3p]
- **Bot/app tag** [C-src]:
  - Hook: `span[role="img"]` inside the username span, with localized `aria-label` "App", "Verified App", "Server" (crossposted from a followed channel), "OP" (forum original poster) or "Official Discord Message". Inner text is `APP`, `SERVER`, `OP` or `OFFICIAL`.
  - Class fallback: `[class*="botTag"]`. Note that Social Stream's `[class^='botTag_']` is fragile, because the class list starts with `botTagCozy_…`.
  - In compact mode the tag comes *before* the name.
- **Avatar src patterns** [C-src]; `size` is DPR-scaled:
  - User avatar: `https://cdn.discordapp.com/avatars/{userId}/{hash}.{webp|png}?size=…`. Animated hashes start with `a_` and add `&animated=true` (webp) when animating.
  - Guild/server avatar: `https://cdn.discordapp.com/guilds/{guildId}/users/{userId}/avatars/{hash}.{ext}?size=…`.
  - **Default avatars are relative bundled assets**, e.g. `/assets/788f05731f8aa02e.png` (6 variants, from `3451.js` `DEFAULT_AVATARS`). They carry **no user ID**. The web client does **not** use `cdn.discordapp.com/embed/avatars/N.png` for message avatars.
  - Special bots (Clyde, Nitro) also use `/assets/…`.
  - User ID regexes: `/\/avatars\/(\d+)\//` and `/\/guilds\/\d+\/users\/(\d+)\/avatars\//`. henry-bao uses `img[src*="/avatars/"]`. [C-3p]
- **Avatar location**: the avatar exists only on headers. Cozy group starts have it before the heading. In compact mode it appears only if the "show avatars in compact mode" setting is on. Continuation messages have no avatar.

---

## 4. Timestamps and the edited marker

Sources: `606049.js` (timestamp), `861986.js` (edited), `471533.js` `n_`, `888675.js` (system messages).
- **Every non-system message has `time#message-timestamp-{id}[datetime]` in the DOM, including cozy continuations.** [C-src]
  - Continuations render it in a `span` with class `timestampVisibleOnHover_c19a55`, so it is hidden by CSS but **always mounted**. Only the hover action toolbar is mounted lazily.
  - The continuation text is compact format: `<i aria-hidden>[</i>10:15 AM<i aria-hidden>] </i>`.
  - `datetime` is `Date#toISOString()` (UTC, ms precision).
  - **The snowflake also gives the exact time**: `(id >> 22) + 1420070400000`. Prefer it and use `datetime` as a cross-check (henry-bao does the same).
- The `aria-label` holds the full localized date (from the tooltip props) [C-src for value, Inf for exact placement].
- **System messages**: the timestamp is a `time[datetime]` **without an id**, inside the message content (§8). [C-src]
- **Edited marker** [C-src]:

```html
 <span class="timestamp_c19a55"><time aria-label="Edited {full date}" datetime="{editedTimestamp ISO}"><span class="edited_c19a55">(edited)</span></time></span>
```

  - It has no id. It is placed **at the end of `#message-content-{id}`** when the message has text (or in compact mode). Otherwise (attachment-only messages) it sits at the end of `#message-accessories-{id}`.
  - Rule: `time:not([id])` inside the content or accessories that contains `[class*="edited"]` → `editedAt = datetime`. Exclude it from extracted text.
  - Automod-reverted edits show "(reverted)".

---

## 5. Message content `#message-content-{id}`

Sources: `438729.js` (container), `91624.js`, `247186.js` (markdown renderers), `930101.js` and `788026.js` (emoji), `785562.js` (`<t:…>`), `302031.js` and `881013.js` (spoilers), `881140.js` (links), `441136.js` (code), `140735.js` (hidden SR text), `556300.js` and `332173.js` (channel mentions).

```html
<div id="message-content-{id}" class="markup__75297 messageContent_c19a55 [markupRtl_c19a55] [isSending_c19a55] [isFailed_c19a55]">…</div>
```

**General notes**
- It is always rendered for non-system messages, even when empty, *except while the current user is editing that message*. In that case it is replaced by the edit textarea. [C-src]
- If the message has the `SOURCE_MESSAGE_DELETED` flag (crossposts), the content is "[Original Message Deleted]".
- Text runs are `<span>`s. Paragraphs are `<p>`, and `strong`, `em`, `u` and `s` render as those tags. [C-src for `s`/`p`; others Inf from simple-markdown]

**Element by element**
- **Custom emoji** [C-src]: `<span class="emojiContainer… [clickable…]" role="button" tabindex="0"><img class="emoji [jumboable]" data-type="emoji" data-id="{emojiId}" alt=":name:" src="https://cdn.discordapp.com/emojis/{emojiId}.webp?size=…[&animated=true]" draggable="false"></span>`. Animated emoji use `animated=true` (webp) or `.gif` without webp.
- **Unicode emoji** [C-src]: the same `img.emoji[data-type="emoji"]` but with `data-name="{name}"`. `alt` is the original matched text (usually the emoji character), and `src` is a bundled `/assets/….svg` (Inf: exact path from emoji asset map). If no image is available: `<span class="emoji emoji-text">`.
- **User mention**: a `span` with literal class `mention` plus hashed `wrapper…` classes and `interactive`, text "@name". **No user ID or href.**
  - [Inf for the exact markup.] Supporting evidence: the client's own content click handler identifies mentions with `className.includes("mention") || className.includes("roleMention")` (`565265.js`) [C-src]. Channel mentions share the same clickable-span component (`332173.js`: `span` with `interactive`, `role` and tabindex) [C-src].
- **Role mention**: `span.roleMention__75297` with color style. [C-src class]
- **Channel mentions and Discord message links** [C-src]:
  - Rendered as `span.channelMention… [role="link"][tabindex="0"]`, e.g. "#channel › message".
  - **No `href`**: the original URL is only available in the context menu. Links to `discord.com/channels/…` therefore do *not* appear as `a[href]`.
- **Links** [C-src]: `<a href="{target}" title="{title or text}\n\n({target})" …>`. Masked links carry the real URL in `href` and in the title.
- **Inline code** [C-src]: `<code class="inline">…</code>`.
- **Code block** [C-src]:

```html
<pre><div class="codeContainer__75297">[<div class="codeActions__75297">copy button</div>]
     <code class="{scrollbar…} hljs language-{lang} …">…highlighted spans…</code></div></pre>
```

- **Spoiler (text)** [C-src]: `<span class="obscured spoilerContent__299eb spoilerMarkdownContent__299eb [hidden__299eb]" role="button" aria-label="Spoiler" aria-expanded="false" tabindex="0"><span class="obscuredTextContent__299eb"><span aria-hidden="true" class="obscuredTextContentInner__299eb">SECRET</span></span></span>`.
  - **The text is in the DOM while hidden.** When revealed: `role="presentation"`, `aria-expanded="true"`.
  - Hooks: literal class `obscured`, plus `aria-expanded`.
- **Block quote** [C-src]: `<div class="blockquoteContainer__75297"><div class="blockquoteDivider__75297"></div><blockquote>…</blockquote></div>`.
- **Headers, lists, subtext** [C-src]:
  - Headers render as `<h1|h2|h3><span>…</span><span class="hiddenVisually_b18fe2">,</span></h1>`.
  - Lists render as `<ul|ol [start]><li><span>…</span><span class="hiddenVisually_b18fe2">,</span></li></ul>`.
  - `-#` subtext renders as `<small><span>…</span></small>`.
  - **Strip `[class*="hiddenVisually"]`** when extracting text, or you will get stray commas.
- **`<t:unix:fmt>` timestamps** [C-src]: `<span class="timestamp__75297">{formatted text}</span>` inside a tooltip wrapper.
  - **There is no `datetime` attribute and no raw unix value in the DOM.** The full date appears only in the hover tooltip.
  - Relative format (`R`) re-renders over time.
  - Only the formatted text is recoverable.
- **Attachment link** (`<attachment:…>` syntax): `[role="link"].attachmentLink` with `href`. [C-src]
- **Text extraction checklist**:
  - drop the edited `time`;
  - drop `i[aria-hidden="true"]` separators;
  - drop `[class*="hiddenVisually"]`;
  - map `img.emoji` to its `alt`;
  - keep spoiler text (optionally wrap it in `||`);
  - keep `code` text verbatim.

---

## 6. Reply context `#message-reply-context-{id}`

Source: `448368.js` (rendered via `471533.js` `nw`; it appears as the first child of the article, before `contents`). [C-src]

```html
<div id="message-reply-context-{replyMsgId}" class="repliedMessage_c19a55 messageSpine_c19a55"
     aria-label="{author} replying to {repliedAuthor}">
  <div class="repliedMessageClickableSpine_c19a55" aria-label="Jump To Reply" role="button"></div>   <!-- optional -->
  <img alt="" src="https://cdn.discordapp.com/avatars/{refUserId}/{hash}.webp?size=16" class="replyAvatar_c19a55 clickable_c19a55">
  <!-- or <div class="replyBadge_c19a55"><svg class="replyIcon_c19a55"/></div> when compact / not loaded / blocked -->
  <span …><span class="username_c19a55 …" data-text="[@]{refDisplayName}">[@]{refDisplayName}</span>…</span>
  <div class="repliedTextPreview_c19a55 clickable_c19a55" role="button">
    <div id="message-content-{referencedMessageId}" class="repliedTextContent_c19a55 markup__75297 messageContent_c19a55">text…</div>
    <!-- OR, when the referenced message has no text: -->
    <span class="repliedTextPlaceholder_c19a55">Click to see attachment|sticker|command|voice message|message</span>
  </div>
  [trailing icon svg (image/sticker/command/mic)]
</div>
```

- **Referenced message ID**: yes, it comes from the inner `[id^="message-content-"]`, but **only when the referenced message has text**.
  - Placeholders ("Click to see attachment" etc.), "Blocked message", "Ignored message", "Message pinned.", poll questions (rendered as `div.repliedTextContent` without the id), "Message could not be loaded" and deleted references carry **no ID**.
  - That inner id duplicates the real message's own content id when that message is also in the list.
  - No `data-*` attribute holds the referenced ID.
- **Referenced author**:
  - Name: `[data-text]` inside the context (strip a leading "@").
  - User ID: from the 16 px `img` src when it is a custom avatar.
  - The context's `aria-label` "X replying to Y" is localized.
- **Deleted original**: `<div class="repliedTextPreview_c19a55"><span class="repliedTextPlaceholder_c19a55">Original message was deleted</span></div>`, with a `replyBadge` icon instead of an avatar and no username. Not-loaded: "Message could not be loaded".
- **Replies are group starts.** The reply message's own header is rendered normally, and its `h3` has `aria-describedby="message-reply-context-{id}"` when the reference is loaded.
- Used by choephix and henry-bao (`[id^="message-reply-context-"]`, `[class*="repliedTextContent"]`). [C-3p]

---

## 7. Accessories `#message-accessories-{id}`

Sources: `699352.js`, `91688.js` (`render()` ~8010), class map `803931.js`.

```html
<div id="message-accessories-{id}" class="container_b7e1cb">
  children, in this order: reported-message, forwarded snapshots, thread-role warning, poll, shared theme,
  coded links (invites etc.), gift codes, media-post embeds, ATTACHMENTS, CTA buttons, EMBEDS, obscure notice,
  activity invite, STICKERS, COMPONENTS, app-instance embed, premium upsell, edited tag (attachment-only),
  REACTIONS, publish bump, ephemeral notice ("Only you can see this"), thread accessory, safety notices
</div>
```

It is only rendered when at least one child exists. [C-src]

### Attachments
Sources: `91688.js` `renderAttachments`, mosaic `394839.js`, renderers `706403.js` and `44788.js`, image `144165.js` and `774702.js`, file `564771.js` and `745268.js`.

**Mosaic layout.** Visual items (images, videos, clips) go into one mosaic block. The layout depends on the item count:
- 1 item: single;
- 2 items: two columns;
- 3 items: one large plus two;
- 4 items: a 2×2 grid;
- 5 or more: 3-column rows.

Non-visual items (audio, files) go into a separate block below. [C-src]

**Image** (each image, single or mosaic) [C-src]:

```html
<div class="imageWrapper imageWrapper_af017a imageZoom_af017a clickable_af017a …" style="…">
  <a tabindex="-1" aria-hidden="true" class="originalLink_af017a"
     href="https://cdn.discordapp.com/attachments/{channelId}/{attachmentId}/{filename}?ex=…&is=…&hm=…&"
     data-role="img" data-safe-src="{media-proxy URL}"></a>
  <div class="clickableWrapper_af017a" role="button" tabindex="0" aria-label="{alt text or 'Image'}" aria-describedby="uid_N">
    <div class="loadingOverlay_af017a"><img alt="{description or 'Image'}" src="https://media.discordapp.net/attachments/…?…&format=webp&width=…&height=…"></div>
  </div>
</div>
```

  - `href` is `attachment.url` (the signed CDN URL; expiring `ex`/`is`/`hm` params). The client even logs "Found expired attachment link, clearing messages" (`547.js`).
  - `data-safe-src` defaults to the rendered `src` (media proxy).
  - `alt` is the attachment description (alt text). Exact proxy query params are [Inf].
  - Stable hooks: the literal class `imageWrapper`, plus `a[data-role="img"][href]`.
- **Video** [C-src props / Inf tag]: a `video` element. `src` is `attachment.url` (cdn) and `poster` is `proxy_url` with `format=webp`. Clips (the IS_CLIP flag) use a special player.
- **Audio file** [Inf]: an audio player with `<audio><source src="{attachment.url}"></audio>` plus filename and size.
- **Voice message** [C-src]: `<div role="region" aria-label="Voice Message" class="…">` containing a waveform, duration and `<audio …><source src="{attachment.url}"></audio>`.
- **Generic file** [C-src]:

```html
<div class="fileWrapper__0ccae"><div class="file__0ccae">
  <img class="icon__0ccae" src="…icon-file-{type}.svg" alt="Attachment file type: {type}" title="{type}">
  <div class="fileInner__0ccae">
    <div class="filenameLinkWrapper__0ccae"><a class="fileNameLink__0ccae" href="{attachment.url}">{filename}</a></div>
    <div class="…">{size, e.g. "1.2 MB"}</div>
  </div></div></div>
```

- **Text-file preview** (`.txt`, code): shows the filename, size and an expandable preview. [Inf markup]
- **Spoilered attachment** [C-src]:
  - Wrapper: `div.spoilerContent__299eb.spoilerContainer__299eb.attachmentContainer__299eb[.hidden__299eb.hiddenSpoiler__299eb][role="button"][aria-label="Spoiler"][aria-expanded="false"]`.
  - It contains a "Spoiler" warning `div` and `div.spoilerInnerContainer__299eb[aria-hidden="true"]` with the normal media inside. **The media and `a.originalLink` are still mounted.**
  - Spoiler filenames start with `SPOILER_` (constant in `381941.js`).
  - Sensitive-media obscuring uses the same wrapper, with aria-label "Content Warning: …".
- Third-party practice: henry-bao collects `a[href], img[src], video[src], source[src]` within accessories, and choephix also collects `video[poster]`. [C-3p]

### Embeds
Sources: `161573.js` and `411517.js`. [C-src]

```html
<article class="embedFull__623de embed__623de markup__75297 [spoilerEmbed__623de]" style="border-left-color: rgb(r,g,b); max-width: …">
  <div class="gridContainer__623de"><div class="grid__623de [hasThumbnail__623de]">
    [div.embedProvider__623de]
    [div.embedAuthor__623de > img.embedAuthorIcon__623de + (a.embedAuthorNameLink__623de[href] | span.embedAuthorName__623de)]
    [div.embedTitle__623de > a.embedTitleLink__623de[href] | text]
    [div.embedDescription__623de (markdown)]
    [div.embedFields__623de > div.embedField__623de (style grid-column for inline) > div.embedFieldName__623de + div.embedFieldValue__623de]
    [div.embedMedia__623de / div.embedImage__623de (image component w/ a.originalLink) / embedGalleryImagesWrapper__623de / embedVideo__623de]
    [div.embedThumbnail__623de img]
    [div.embedFooter__623de > img.embedFooterIcon__623de + span.embedFooterText__623de ("text • timestamp")]
  </div></div>
</article>
```

- **Colour**: the inline `border-left-color` style holds the exact embed colour. It is omitted for no colour or white.
- Image, GIF and video-only embeds render as `div.inlineMediaEmbed__623de.embed__623de` instead of an `article`.
- Stable tag hook: `#message-accessories-{id} article`. Everything else is class-substring only (`[class*="embedTitle_"]` etc.).
- Social Stream uses `[class^='embedDescription']`. [C-3p]

### Stickers
Sources: `91688.js` `ro`, `148355.js`, `378058.js`. [C-src][C-3p]
- PNG, APNG and GIF stickers: `<img class="…" data-type="sticker" data-id="{stickerId}" data-name="{name}" data-format-type="{1|2|4}" alt="Sticker, {name}[, {description}]" src="https://media.discordapp.net/stickers/{id}.{webp|png|gif}?size=…" draggable="false">`.
- Lottie stickers (format 3): `<div role="img" aria-label="Sticker, {name}…"><canvas data-type="sticker" data-id=… data-name=… data-format-type="3"></canvas></div>`. The source JSON is `https://discord.com/stickers/{id}.json` (`ASSET_ENDPOINT`).
- Social Stream reads `img[data-type='sticker']` and `canvas[data-type='sticker']`.

### Reactions
Sources: `930390.js`, `831688.js`, `815807.js`, `788026.js`. [C-src][C-3p]

```html
<div id="message-reactions-{id}" class="reactions…" role="group">
  <!-- before it scrolls into view: static placeholder -->
  <div class="reaction… reactionInner… [reactionMe…]"><img class="emoji" data-type="emoji" data-id|data-name=… alt="…"><div class="reactionCount…">3</div></div>
  <!-- once visible: interactive -->
  <div><div class="reaction… [reactionMe…]"><div class="reactionInner…" role="button" aria-pressed="false"
       aria-label="{emojiName}, 3 reactions, press to react"> …img.emoji… <div class="reactionCount…">3</div></div></div></div>
  [+N button for hidden reactions]  [add-reaction button]
</div>
```

- **aria-label formats** (en):
  - `"{name}, {n} reaction(s), press to react"`, or `"…, press to remove your reaction"` when you reacted (`aria-pressed="true"`).
  - Super reactions: `"{name}, {n} super reaction(s), press to super react"`.
  - `{name}` is the emoji name with `:`/`_` turned into spaces (custom emoji) or the unicode emoji's short name.
- **Robust parse**: iterate `[id^="message-reactions-"]` children that contain an `img.emoji`. Read the emoji from `data-id`/`data-name`/`alt` and the count from the trailing text (`[class*="reactionCount"]`). Don't depend on the aria-label, because the static placeholder has none.

### Polls [C-src for classes; markup details Inf]
- Container: `div.pollContainer_b7e1cb` inside the accessories.
- Inner classes: `container__0be77`, `header__0be77`, `question__0be77`, `prompt__0be77`, `answersContainer__4c520`, `answer__4c520`, `label__4c520`, `votesData__4c520`, `votePercentageBar__4c520`, `detailsText__0be77` (vote totals / time left).
- Class substrings only.
- Poll result messages (type POLL_RESULT) are system-style.

### Forwarded messages (message snapshots)
Source: `91688.js` `ix`/`iA`/`ip`. [C-src]

```html
<div id="message-accessories-{id}" …>
  <div class="container__122e4"><div class="quote__122e4"></div><div class="content__122e4">
    <div class="headerContainer__122e4"><svg/><div class="headerText__122e4">Forwarded</div></div>
    <div id="message-content-{id}" class="markup… messageContent…">{forwarded text}</div>   <!-- SAME id as the outer message -->
    <div id="message-accessories-{id}" …>{forwarded attachments/embeds}</div>               <!-- SAME id again -->
    <div class="footerContainer__122e4" role="button" aria-label="Message originally sent in {#channel|server} at {time}">
      [img.originIcon__122e4] <div class="footerText__122e4">{origin}  •  {time}</div></div>
  </div></div>
</div>
```

- The snapshot is merged into a copy of the forwarding message, so it **reuses the forwarding message's ID**.
- **Duplicate `message-content-{id}` and `message-accessories-{id}` inside the same article.** The outer content div is normally empty for forwards.
- Detection: a `[id^="message-content-"]` that has an ancestor `[id^="message-accessories-"]` is forwarded content. The "Forwarded" label and the footer are localized.
- The original message, channel and guild IDs are **not in the DOM**. The footer is only present when the origin is visible to you.

### Components / buttons [Inf]
- Rendered by the components module (`lm.Ay` in `91688.js`). Expect `button` elements (`role=button`) and link buttons (`a[href]`).
- Components V2 (containers, text displays, media galleries) reuse the markup and media renderers.
- Use class substrings only, or simply collect `button` text and `a[href]` inside the accessories.

### Thread accessory [C-src classes]
- A message with HAS_THREAD shows a thread summary below it (`threadMessageAccessory_c19a55`, `threadMessageAccessoryPreview_c19a55`, …).

---

## 8. System messages

Sources: `64369.js` (dispatcher), `888675.js` (layout), `224929.js` (classes), `143413.js` (predicate). [C-src]
- **What counts as a system message**: any message type not in the USER_MESSAGE set. Types handled include:
  - USER_JOIN, CHANNEL_PINNED_MESSAGE, GUILD_BOOST, GUILD_BOOST_TIER_1–3;
  - THREAD_CREATED, CALL, RECIPIENT_ADD/REMOVE, CHANNEL_NAME_CHANGE, CHANNEL_ICON_CHANGE, CHANNEL_FOLLOW_ADD;
  - STAGE_*, AUTO_MODERATION_ACTION, POLL_RESULT, GUILD_INCIDENT_*, PURCHASE_NOTIFICATION, VOICE_SESSION, and many more.
- **Markup**:

```html
<li id="chat-messages-{c}-{m}" class="messageListItem__5126c">
 <div role="article" aria-roledescription="Message" aria-labelledby="message-content-{m}[ message-accessories-{m}]"
      class="message__5126c cozyMessage__5126c systemMessage__5126c … isSystemMessage_c19a55 …">
  <div class="contents_c19a55">
   <div id="message-content-{m}" class="markup__75297 messageContent_c19a55">
    <div class="container__235ca cozy__235ca">
      <div class="iconContainer__235ca"><div class="icon__235ca iconSize__235ca" data-accessibility="desaturate"
           style="background-image: url('/assets/….svg')"></div></div>
      <div class="content__235ca"><div>
        {localized sentence with clickable username span(s), e.g. "Alice joined the party." /
         "Bob pinned a message to this channel. See all pinned messages." / "Carol started a thread: X …"}
        <span class="timestamp_c19a55 …"><time aria-label="…" datetime="…ISO…">…</time></span>   <!-- NO id -->
      </div></div>
    </div>
   </div>
  </div>
 </div>
</li>
```

- **Detection without classes**:
  - `aria-labelledby` does not start with `message-username-` or `message-reply-context-` (it starts with `message-content-`);
  - there is no `[id^="message-username-"]`;
  - the `time` element has no id.
- Class fallback: `[class*="systemMessage"]` (henry-bao [C-3p]).
- **Author**: no header, so the actor's name appears only inside the sentence. The username span is clickable and often `role="button"` [Inf]. The type has to be inferred from the localized sentence or the icon.
- Thread starter messages (inside threads) and the forum post first message use the `quotedChatMessage__5126c` wrapper styling (choephix uses `[class*="quotedChatMessage"]` [C-3p]).

---

## 9. List virtualisation and lifetime

Sources: `471533.js`, `868207.js` (ChannelMessages), `652215.js` (constants), `148494.js`, `547.js`, `326337.js`, `436405.js`.
- **There is no per-row virtualisation.** Every message in the in-memory window is rendered (`channelStream.map`). [C-src]
- **The window is bounded by the store, not by the viewport.** [C-src]
  - When loaded messages exceed **120**, `ChannelMessages.truncate` cuts the array down to **60**, removing from the side away from the scroll direction.
  - The removed messages move to in-memory `_before`/`_after` caches, so their `li`s are **unmounted**.
  - New incoming messages also trigger truncation (`ChannelMessages.receiveMessage`, `868207.js`; caller in `232835.js` passes `isAtBottom`):
    - If the user is **at the bottom**, the window is cut to the newest **60** (`truncateTop(60)`) on every received message.
    - Otherwise the bottom is cut to 60 once the window exceeds 120.
    - So in a busy channel viewed at the bottom, only about 60 messages stay mounted.
- **Fetch sizes in this build** [C-src]:
  - The initial fetch is computed from window height and font size, clamped to [10, **30**].
  - Load-more fetches `min(30, 2 × that)`.
  - A jump (`around`) fetches **30**.
  - In practice the DOM holds roughly 30–120 messages. Re-scrolling to cached ranges is served locally (`LOAD_MESSAGES_SUCCESS_CACHED`) without the network.
- **Placeholders**: skeleton divs mark "more before/after". Only the channel-beginning header `div#chat-messages-{c}-{c}` proves the top was reached. [C-src]
- **Channel switch** [C-src]: the list component is keyed by `channel.id`, so a new `ol[data-list-id="chat-messages"]` element is created. Re-query it, and re-attach any MutationObserver to the new element. Observe a stable ancestor (e.g. `document.body` or the chat column) with `childList+subtree`, or re-find the list on URL change.
- **Jump within the same channel** [Inf, consistent with source]: the same `ol` persists, but its children are replaced when the jumped-to range isn't contiguous. A `div[data-flash]` wrapper then appears around the target `li`.
- **Practical scraping loop**:
  1. Scroll the scroller up by about 0.85 × viewport.
  2. Wait for mutations, roughly 1–1.5 s (henry-bao waits up to 1,500 ms plus 120 ms).
  3. Harvest into a Map keyed by message ID. Never let a later author-less sighting overwrite a complete record.
  4. Stop when `#chat-messages-{c}-{c}` exists, or when there is no growth at `scrollTop≈0` after retries.
  5. Expect messages to disappear behind you, because of truncation.

---

## 10. Navigation to `/channels/{guild|@me}/{channelId}/{messageId}`, including synthetic snowflakes

- **Route → fetch** [C-src]. `CHANNEL_SELECT` with a `messageId` from the route `/channels/:guild/:channel/:message` (`547.js`) calls:
  - `jumpToMessage({channelId, messageId, flash: true, …})`, which calls
  - `fetchMessages({limit: 30, jump: {messageId}})`, which issues
  - `GET …/channels/{id}/messages?around={messageId}&limit=30` (`148494.js`).
- **The client tolerates IDs that match no message.**
  - After the `around` fetch it computes `hasMoreBefore`/`hasMoreAfter` by inserting the target ID into the returned IDs, de-duplicating, sorting and taking `indexOf(target)` (`148494.js` ~566).
  - The scroll target is then resolved by `l9()` (`471533.js` ~2887). If the target isn't a loaded message, it sorts `[target, ...loadedIds]` and scrolls to the **next message after the target** (`l[i+1]`), else the previous one.
  - The cached path (`_tryFetchMessagesCached`) compares `extractTimestamp(targetId)` with the loaded range's first and last timestamps. So **message IDs are treated as time positions by design.**
  - Discord's own code also jumps to thread starts using the channel ID as a message ID (`547.js` "Jumping to start of thread").
- **API side** [C-src docs]: Discord's developer docs say you can "generate a snowflake ID for that time" for pagination: `(timestamp_ms - 1420070400000) << 22` ([docs.discord.com/developers/reference](https://docs.discord.com/developers/reference), section "Snowflake IDs in Pagination", fetched 2026-10-29).
- **Conclusion: "jump to date" via a synthetic snowflake works.** [C-src logic; not live-tested]
  - Navigating to `https://discord.com/channels/{g}/{c}/{(ms-1420070400000)<<22}` loads about 30 messages around that instant.
  - It scrolls to the first message at or after that time, or the last one before it if nothing is newer.
  - It needs READ_MESSAGE_HISTORY.
  - The message `li` will **not** carry the synthetic ID. Read the real IDs from the DOM.
  - Use BigInt in JS to compute the ID: `((BigInt(ms) - 1420070400000n) << 22n).toString()`.
- **Third-party implementations / user reports**:
  - GitHub code search on 2026-10-29 (`jumpToDate discord`, `"jump to date" discord`, `jumpToMessage 1420070400000`, `1420070400000 "discord.com/channels"`) returned **0 hits**.
  - Web searches found no Vencord or BetterDiscord "jump to date" plugin.
  - The only user report found is the older community trick of replacing the message ID in a link with `0` to jump to the first message. It is described in Discord support community thread 360041397492 ([link](https://support.discord.com/hc/en-us/community/posts/360041397492/comments/360008181651); the page returns HTTP 403, so the date is unknown and probably 2019–2020) [Old]. It is consistent with the `l9` logic, since target 0 resolves to the first message.
- **Caveats**:
  - Opening the URL in an already-loaded tab via `history.pushState` alone may not trigger the router. Use a real navigation or Discord's in-app link click. A content script can set `location.href`, which reloads the app [Inf].
  - Flashing applies to the real resolved message, if any [Inf].

---

## 11. Minimal extraction recipe (all [C-src] unless noted)

```js
const list = document.querySelector('ol[data-list-id="chat-messages"]');
for (const li of list.querySelectorAll('[id^="chat-messages-"]')) {      // li items + thread-starter article div
  const [, channelId, id] = li.id.match(/^chat-messages-(\d+)-(\d+)$/) || [];
  const art = li.matches('[role="article"]') ? li : li.querySelector(':scope > [role="article"]'); // li's only child
  if (!art) continue;                                                    // e.g. welcome header div#chat-messages-{c}-{c}
  const labelled = art?.getAttribute('aria-labelledby') ?? '';
  const gid = labelled.match(/message-username-(\d+)/)?.[1];          // undefined for replies & system msgs
  const isReply = /message-reply-context-/.test(labelled);
  const isSystem = !gid && !isReply;
  const ownContent = li.querySelector(`[id="message-content-${id}"]:not([id^="message-reply-context-"] *):not([id^="message-accessories-"] *)`);
  const forwarded  = li.querySelector(`[id^="message-accessories-"] [id="message-content-${id}"]`);
  const nameEl = li.querySelector('[id^="message-username-"]:not([id^="message-reply-context-"] *) [data-text]');
  const author = nameEl?.dataset.text ?? (gid && document.getElementById('message-username-' + gid)?.querySelector('[data-text]')?.dataset.text);
  const avatar = li.querySelector('[id^="message-username-"]')?.closest('[class*="contents"]')?.querySelector(':scope > img[aria-hidden="true"]')?.src; // [Inf] structure-based
  const ts = li.querySelector(`time[id="message-timestamp-${id}"]`)?.dateTime ?? li.querySelector('time[datetime]')?.dateTime;
  const edited = ownContent?.querySelector('time:not([id])')?.dateTime ?? li.querySelector('[id^="message-accessories-"] > span time:not([id])')?.dateTime; // [Inf] 2nd path
  const reply = li.querySelector(`[id="message-reply-context-${id}"]`);
  const refId = reply?.querySelector('[id^="message-content-"]')?.id.slice('message-content-'.length);
  const acc = li.querySelector(`[id="message-accessories-${id}"]`);
  // images: acc.querySelectorAll('a[data-role="img"][href]'); files: acc.querySelectorAll('a[href*="/attachments/"]');
  // embeds: acc.querySelectorAll(':scope article'); stickers: acc.querySelectorAll('[data-type="sticker"]');
  // reactions: li.querySelectorAll(`[id="message-reactions-${id}"] img.emoji`)
}
```

The welcome header at the top is `list.querySelector(`[id="chat-messages-${channelId}-${channelId}"]:not(li)`)`.
