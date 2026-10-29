/**
 * A trimmed model of Discord's rendered message list (web client, Oct 2026),
 * following the markup reconstructed from the client source in
 * research_notes/Discord web DOM/dom_structure.md: element IDs, ARIA
 * attributes and hashed class names such as `message__5126c`.
 * Used to test the read-only parser; it is not a copy of a real page.
 */
import { msToSnowflake } from '../../src/core/snowflake';

export const CHANNEL_ID = '1000000000000000010';

/** Snowflake for a UTC time on 2026-01-01 (plus a sequence number). */
export function idAtTime(time: string, seq = 1): string {
  return (BigInt(msToSnowflake(Date.parse(`2026-01-01T${time}Z`))) + BigInt(seq)).toString();
}

export const IDS = {
  first: idAtTime('10:00:00'),
  continuation: idAtTime('10:01:00'),
  reply: idAtTime('10:10:00'),
  join: idAtTime('10:20:00'),
  media: idAtTime('10:30:00'),
  forward: idAtTime('10:31:00'),
  other: idAtTime('10:40:00'),
};

const avatar = (userId: string, hash: string) => `https://cdn.discordapp.com/avatars/${userId}/${hash}.webp?size=80`;
const signed = 'ex=6a0b1c2d&amp;is=6a09ca9d&amp;hm=0123456789abcdef&amp;';
const cdn = (attachmentId: string, name: string) =>
  `https://cdn.discordapp.com/attachments/${CHANNEL_ID}/${attachmentId}/${name}?${signed}`;
const proxy = (attachmentId: string, name: string) =>
  `https://media.discordapp.net/attachments/${CHANNEL_ID}/${attachmentId}/${name}?${signed}=&amp;format=webp&amp;quality=lossless&amp;width=550&amp;height=309`;

export const BEGINNING_HEADER = `<div id="chat-messages-${CHANNEL_ID}-${CHANNEL_ID}" class="container__2b1a7"><h3 class="header__2b1a7">Welcome to #general!</h3></div>`;

export const CHANNEL_HTML = `
<main class="chatContent_a7d72e">
<div class="scroller__36d07" data-jump-section="global">
<ol class="scrollerInner__36d07" data-list-id="chat-messages" aria-label="Messages in #general" role="list">
  <span id="messagesNavigationDescription" class="navigationDescription__36d07" aria-hidden="true">Use the up and down arrow keys…</span>
  <li id="chat-messages-${CHANNEL_ID}-${IDS.first}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c groupStart__5126c wrapper_c19a55 cozy_c19a55 zalgo_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.first}" tabindex="-1" aria-setsize="-1" aria-roledescription="Message"
      aria-labelledby="message-username-${IDS.first} uid_1 message-content-${IDS.first} message-accessories-${IDS.first} uid_2 message-timestamp-${IDS.first}">
      <div class="contents_c19a55">
        <img src="${avatar('2000000000000000020', 'a1b2c3')}" aria-hidden="true" class="avatar_c19a55 clickable_c19a55" alt=" ">
        <h3 class="header_c19a55" aria-labelledby="message-username-${IDS.first} message-timestamp-${IDS.first}">
          <span id="message-username-${IDS.first}" class="headerText_c19a55"><span class="username_c19a55 desaturateUserColors__41f68 clickable_c19a55" aria-expanded="false" role="button" tabindex="0" data-text="Alice" style="color: rgb(52, 152, 219);">Alice</span></span>
          <span class="timestamp_c19a55 timestampInline_c19a55"><time aria-label="Thursday, January 1, 2026 at 10:00 AM" id="message-timestamp-${IDS.first}" datetime="2026-01-01T10:00:00.000Z"><i class="separator_c19a55" aria-hidden="true"> — </i>1/1/26, 10:00 AM</time></span>
        </h3>
        <div id="message-content-${IDS.first}" class="markup__75297 messageContent_c19a55">Hi <span class="mention wrapper_f61d60 interactive" role="button" tabindex="0">@Bob</span>, look <span class="emojiContainer_bae8cb" role="button" tabindex="0"><img aria-label=":wave:" src="https://cdn.discordapp.com/emojis/555.webp?size=48&amp;quality=lossless" alt=":wave:" draggable="false" class="emoji" data-type="emoji" data-id="555"></span> <strong>bold</strong> <code class="inline">x &lt; y</code> <a class="anchor_edefb8" href="https://example.com/page" title="https://example.com/page" rel="noreferrer noopener" target="_blank" role="button" tabindex="0">https://example.com/page</a> <img alt="😀" src="/assets/abc123.svg" class="emoji" data-type="emoji" data-name="grinning" draggable="false"><span class="obscured spoilerContent__299eb spoilerMarkdownContent__299eb hidden__299eb" role="button" aria-label="Spoiler" aria-expanded="false" tabindex="0"><span class="obscuredTextContent__299eb"><span aria-hidden="true" class="obscuredTextContentInner__299eb">secret</span></span></span>
<pre><div class="codeContainer__75297"><div class="codeActions__75297"><button>Copy</button></div><code class="scrollbarGhostHairline_c858fa hljs language-js">let a = 1;</code></div></pre><span class="timestamp_c19a55 timestampInline_c19a55"><time aria-label="Edited Thursday, January 1, 2026 at 10:05 AM" datetime="2026-01-01T10:05:00.000Z"><span class="edited_c19a55">(edited)</span></time></span></div>
      </div>
      <div id="message-accessories-${IDS.first}" class="container_b558d0">
        <div class="visualMediaItemContainer_cda674">
          <div class="imageWrapper imageWrapper_af017a imageZoom_af017a clickable_af017a">
            <a tabindex="-1" aria-hidden="true" class="originalLink_af017a" href="${cdn('3000000000000000030', 'photo.png')}" data-role="img" data-safe-src="${proxy('3000000000000000030', 'photo.png')}"></a>
            <div class="clickableWrapper_af017a" role="button" tabindex="0" aria-label="Image"><div class="loadingOverlay_af017a"><img class="lazyImg_b7c0f3" alt="Image" src="${proxy('3000000000000000030', 'photo.png')}"></div></div>
          </div>
        </div>
        <div class="fileWrapper__0ccae"><div class="file__0ccae">
          <img class="icon__0ccae" src="/assets/icon-file-acrobat.svg" alt="Attachment file type: acrobat" title="acrobat">
          <div class="fileInner__0ccae">
            <div class="filenameLinkWrapper__0ccae"><a class="fileNameLink__0ccae anchor_edefb8" href="${cdn('3000000000000000031', 'report%20final.pdf')}" rel="noreferrer noopener" target="_blank">report final.pdf</a></div>
            <div class="metadata__0ccae">1.25 MB</div>
          </div>
        </div></div>
        <div id="message-reactions-${IDS.first}" class="reactions_ec6b19" role="group">
          <div class="reaction_ec6b19 reactionInner_ec6b19 reactionMe_ec6b19"><img class="emoji" data-type="emoji" data-name="thumbsup" alt="👍" src="/assets/thumbsup.svg"><div class="reactionCount_ec6b19">3</div></div>
          <div><div class="reaction_ec6b19"><div class="reactionInner_ec6b19" role="button" tabindex="0" aria-pressed="false" aria-label="pog, 12 reactions, press to react"><img class="emoji" data-type="emoji" data-id="777" alt=":pog:" src="https://cdn.discordapp.com/emojis/777.webp?size=44&amp;animated=true"><div class="reactionCount_ec6b19">12</div></div></div></div>
        </div>
      </div>
    </div>
  </li>
  <li id="chat-messages-${CHANNEL_ID}-${IDS.continuation}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c wrapper_c19a55 cozy_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.continuation}" tabindex="-1" aria-roledescription="Message"
      aria-labelledby="message-username-${IDS.first} uid_1 message-content-${IDS.continuation} uid_2 message-timestamp-${IDS.continuation}">
      <div class="contents_c19a55">
        <span class="timestamp_c19a55 timestampVisibleOnHover_c19a55" aria-hidden="true"><time aria-label="10:01 AM" id="message-timestamp-${IDS.continuation}" datetime="2026-01-01T10:01:00.000Z">10:01</time></span>
        <div id="message-content-${IDS.continuation}" class="markup__75297 messageContent_c19a55">second line from Alice
with a newline<h1><span>Heading</span><span class="hiddenVisually_b18fe2">,</span></h1></div>
      </div>
    </div>
  </li>
  <div id="---new-messages-bar" class="divider__908e2 isUnread__908e2" role="separator" aria-label="new"><span class="unreadPill__908e2">new</span></div>
  <div class="backgroundFlash_c19a55" data-flash="true">
  <li id="chat-messages-${CHANNEL_ID}-${IDS.reply}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c hasReply__5126c groupStart__5126c wrapper_c19a55 cozy_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.reply}" aria-roledescription="Message"
      aria-labelledby="message-reply-context-${IDS.reply} uid_1 message-content-${IDS.reply} uid_2 message-timestamp-${IDS.reply}">
      <div id="message-reply-context-${IDS.reply}" class="repliedMessage_c19a55 messageSpine_c19a55" aria-label="Helper Bot replying to Alice">
        <img alt="" src="https://cdn.discordapp.com/avatars/2000000000000000020/a1b2c3.webp?size=16" class="replyAvatar_c19a55 clickable_c19a55">
        <span><span class="username_c19a55" data-text="@Alice">@Alice</span></span>
        <div class="repliedTextPreview_c19a55 clickable_c19a55" role="button"><div id="message-content-${IDS.first}" class="repliedTextContent_c19a55 markup__75297 messageContent_c19a55">Hi @Bob, look</div></div>
      </div>
      <div class="contents_c19a55">
        <img src="${avatar('2000000000000000021', 'ffeedd')}" aria-hidden="true" class="avatar_c19a55 clickable_c19a55" alt=" ">
        <img class="avatarDecoration_c19a55" src="https://cdn.discordapp.com/avatar-decoration-presets/x.png" alt=" " aria-hidden="true">
        <h3 class="header_c19a55" aria-describedby="message-reply-context-${IDS.reply}"><span id="message-username-${IDS.reply}" class="headerText_c19a55"><span class="username_c19a55" data-text="Helper Bot">Helper Bot</span><span role="img" aria-label="App" class="botTagCozy_c19a55 botTag_c19a55 botTagRegular__82f07 botTag__82f07 rem__82f07"><span class="botText__82f07">APP</span></span></span><span class="timestamp_c19a55"><time id="message-timestamp-${IDS.reply}" datetime="2026-01-01T10:10:00.000Z">1/1/26, 10:10 AM</time></span></h3>
        <div id="message-content-${IDS.reply}" class="markup__75297 messageContent_c19a55">Here is a preview <img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad link</a></div>
      </div>
      <div id="message-accessories-${IDS.reply}" class="container_b558d0">
        <article class="embedFull__623de embed__623de markup__75297" style="border-left-color: rgb(255, 0, 0); max-width: 516px;">
          <div class="gridContainer__623de"><div class="grid__623de">
            <div class="embedProvider__623de"><span>Example</span></div>
            <div class="embedAuthor__623de"><a class="embedAuthorNameLink__623de embedAuthorName__623de" href="https://example.com/writer">Writer</a></div>
            <div class="embedTitle__623de"><a class="embedTitleLink__623de anchor_edefb8" href="https://example.com/article">An article</a></div>
            <div class="embedDescription__623de">Short summary.</div>
            <div class="embedFields__623de"><div class="embedField__623de"><div class="embedFieldName__623de">Field</div><div class="embedFieldValue__623de">Value</div></div></div>
            <div class="embedMedia__623de embedImage__623de"><div class="imageContent"><a class="originalLink_af017a" href="https://images-ext-1.discordapp.net/external/abc/https/example.com/img.png"></a><img src="https://images-ext-1.discordapp.net/external/abc/https/example.com/img.png?width=400&amp;height=200" alt="Image"></div></div>
            <div class="embedFooter__623de"><span class="embedFooterText__623de">Footer text</span></div>
          </div></div>
        </article>
        <div class="inlineMediaEmbed__623de embed__623de"><a href="https://tenor.com/view/happy-123"></a><video src="https://media.discordapp.net/external/xyz/https/media.tenor.com/happy.mp4"></video></div>
      </div>
    </div>
  </li>
  </div>
  <li id="chat-messages-${CHANNEL_ID}-${IDS.join}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c systemMessage__5126c groupStart__5126c wrapper_c19a55 cozy_c19a55 isSystemMessage_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.join}" aria-roledescription="Message"
      aria-labelledby="message-content-${IDS.join}">
      <div class="contents_c19a55">
        <div id="message-content-${IDS.join}" class="markup__75297 messageContent_c19a55">
          <div class="container__235ca cozy__235ca">
            <div class="iconContainer__235ca"><div class="icon__235ca iconSize__235ca" style="background-image: url('/assets/join.svg')"></div></div>
            <div class="content__235ca"><div><span class="username_c19a55" data-text="Carol">Carol</span> joined the party.</div><span class="timestamp_c19a55"><time datetime="2026-01-01T10:20:00.000Z">1/1/26, 10:20 AM</time></span></div>
          </div>
        </div>
      </div>
    </div>
  </li>
  <div class="groupStart__5126c"><div role="article" class="blockedSystemMessage__7a70a"><div class="blockedMessageText__7a70a">1 blocked message — <span class="blockedAction__7a70a" role="button">Show message</span></div></div></div>
  <li id="chat-messages-${CHANNEL_ID}-${IDS.media}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c groupStart__5126c wrapper_c19a55 cozy_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.media}" aria-roledescription="Message"
      aria-labelledby="message-username-${IDS.media} uid_1 message-accessories-${IDS.media} uid_2 message-timestamp-${IDS.media}">
      <div class="contents_c19a55">
        <img src="/assets/788f05731f8aa02e.png" aria-hidden="true" class="avatar_c19a55" alt=" ">
        <h3 class="header_c19a55"><span id="message-username-${IDS.media}" class="headerText_c19a55"><span class="username_c19a55" data-text="Dave">Dave</span></span><span class="timestamp_c19a55"><time id="message-timestamp-${IDS.media}" datetime="2026-01-01T10:30:00.000Z">1/1/26, 10:30 AM</time></span></h3>
      </div>
      <div id="message-accessories-${IDS.media}" class="container_b558d0">
        <div class="wrapper_d2dae3"><video class="video_d2dae3" preload="metadata" src="${cdn('3000000000000000032', 'clip.mp4')}" poster="${proxy('3000000000000000032', 'clip.mp4')}"></video></div>
        <div role="region" aria-label="Voice Message" class="container_a8b1d2"><div class="waveform_a8b1d2"></div><audio preload="none"><source src="${cdn('3000000000000000033', 'voice-message.ogg')}"></audio></div>
        <div class="spoilerContent__299eb spoilerContainer__299eb attachmentContainer__299eb hidden__299eb" role="button" aria-label="Spoiler" aria-expanded="false">
          <div class="spoilerWarning__299eb">Spoiler</div>
          <div class="spoilerInnerContainer__299eb" aria-hidden="true"><div class="imageWrapper imageWrapper_af017a"><a class="originalLink_af017a" data-role="img" href="${cdn('3000000000000000034', 'SPOILER_cat.png')}"></a><img alt="A cat" src="${proxy('3000000000000000034', 'SPOILER_cat.png')}"></div></div>
        </div>
        <div class="stickerAsset_ccbe31"><img class="sticker_ccbe31" data-type="sticker" data-id="888" data-name="Wave Hello" data-format-type="1" alt="Sticker, Wave Hello" src="https://media.discordapp.net/stickers/888.webp?size=160" draggable="false"></div>
        <div role="img" aria-label="Sticker, Dance"><canvas data-type="sticker" data-id="889" data-name="Dance" data-format-type="3"></canvas></div>
        <span class="timestamp_c19a55"><time aria-label="Edited" datetime="2026-01-01T10:32:00.000Z">(edited)</time></span>
      </div>
    </div>
  </li>
  <li id="chat-messages-${CHANNEL_ID}-${IDS.forward}" class="messageListItem__5126c" aria-setsize="-1">
    <div class="message__5126c cozyMessage__5126c wrapper_c19a55 cozy_c19a55" role="article"
      data-list-item-id="chat-messages___chat-messages-${CHANNEL_ID}-${IDS.forward}" aria-roledescription="Message"
      aria-labelledby="message-username-${IDS.media} uid_1 message-content-${IDS.forward} message-accessories-${IDS.forward} uid_2 message-timestamp-${IDS.forward}">
      <div class="contents_c19a55"><div id="message-content-${IDS.forward}" class="markup__75297 messageContent_c19a55"></div></div>
      <div id="message-accessories-${IDS.forward}" class="container_b558d0">
        <div class="container__122e4"><div class="quote__122e4"></div><div class="content__122e4">
          <div class="headerContainer__122e4"><svg></svg><div class="headerText__122e4">Forwarded</div></div>
          <div id="message-content-${IDS.forward}" class="markup__75297 messageContent_c19a55">forwarded words</div>
          <div id="message-accessories-${IDS.forward}" class="container_b558d0"><div class="imageWrapper imageWrapper_af017a"><a class="originalLink_af017a" data-role="img" href="${cdn('3000000000000000035', 'fwd.jpg')}"></a></div></div>
          <div class="footerContainer__122e4" role="button" aria-label="Message originally sent in #news at 9:00"><div class="footerText__122e4">#news • 9:00</div></div>
        </div></div>
      </div>
    </div>
  </li>
  <li id="chat-messages-9999999999999999999-${IDS.other}" class="messageListItem__5126c" aria-setsize="-1">
    <div role="article" aria-labelledby="message-username-${IDS.other} message-content-${IDS.other}"><div id="message-content-${IDS.other}">from another channel</div></div>
  </li>
  <div class="divider__908e2 hasContent__908e2" role="separator" aria-label="January 2, 2026" data-list-item-id="chat-messages___divider-1"><span class="content__908e2">January 2, 2026</span></div>
  <div class="scrollerSpacer__36d07"></div>
</ol>
</div>
</main>`;
