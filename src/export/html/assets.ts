/** Inline stylesheet and script for the offline HTML viewer. */

export const VIEWER_CSS = `
:root {
  color-scheme: light dark;
  --bg: #313338; --bg-alt: #2b2d31; --bg-hover: #2e3035; --text: #dbdee1; --muted: #949ba4;
  --heading: #f2f3f5; --link: #00a8fc; --accent: #5865f2; --border: #3f4147;
  --code-bg: #2b2d31; --mention-bg: rgba(88,101,242,.3); --warn: #f0b232; --danger: #f23f43;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff; --bg-alt: #f2f3f5; --bg-hover: #f5f6f7; --text: #313338; --muted: #5c5e66;
    --heading: #060607; --link: #006ce7; --border: #e1e2e4; --code-bg: #f2f3f5; --mention-bg: rgba(88,101,242,.15);
    --warn: #a86500; --danger: #da373c;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 15px/1.375 "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.top { position: sticky; top: 0; z-index: 2; background: var(--bg-alt); border-bottom: 1px solid var(--border);
  padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.top h1 { font-size: 17px; margin: 0; color: var(--heading); }
.top .sub { color: var(--muted); font-size: 13px; }
.top .grow { flex: 1 1 auto; }
.pager { display: flex; gap: 12px; font-size: 14px; }
.pager .disabled { color: var(--muted); }
#filter { min-width: 220px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
main { padding: 8px 0 32px; }
.day { display: flex; align-items: center; margin: 20px 16px 8px; color: var(--muted); font-size: 12px; font-weight: 600; }
.day::before, .day::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
.day span { padding: 0 8px; }
.msg { position: relative; display: grid; grid-template-columns: 56px 1fr; padding: 2px 16px 2px 0; content-visibility: auto; contain-intrinsic-size: auto 48px; }
.msg:hover { background: var(--bg-hover); }
.msg.start { margin-top: 14px; }
.msg:target { background: rgba(250,168,26,.15); }
.gutter { display: flex; justify-content: center; }
.avatar { width: 40px; height: 40px; border-radius: 50%; margin-top: 2px; object-fit: cover; background: var(--bg-alt); }
.avatar.placeholder { display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; background: var(--accent); }
.gutter time { visibility: hidden; color: var(--muted); font-size: 11px; line-height: 22px; }
.msg:hover .gutter time { visibility: visible; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.author { color: var(--heading); font-weight: 600; }
.badge { font-size: 10px; font-weight: 700; background: var(--accent); color: #fff; border-radius: 4px; padding: 0 4px; }
.head time, .edited, .meta { color: var(--muted); font-size: 12px; }
.content { white-space: pre-wrap; overflow-wrap: anywhere; }
.content p { margin: 0; }
.content .d-mention, .reply .d-mention { background: var(--mention-bg); border-radius: 3px; padding: 0 2px; }
.content .d-emoji { width: 22px; height: 22px; vertical-align: -5px; object-fit: contain; }
.content .d-code, .content code { font-family: Consolas, "Andale Mono", monospace; background: var(--code-bg); border-radius: 4px; padding: 1px 4px; font-size: 13px; }
.content pre, .content .d-codeblock { background: var(--code-bg); border: 1px solid var(--border); border-radius: 4px; padding: 8px; white-space: pre-wrap; margin: 4px 0; }
.content pre code { background: none; padding: 0; }
.content blockquote, .content .d-quote { margin: 2px 0; padding-left: 10px; border-left: 4px solid var(--border); }
.content h1, .content h2, .content h3 { margin: 8px 0 4px; color: var(--heading); line-height: 1.3; }
.content h1 { font-size: 22px; } .content h2 { font-size: 19px; } .content h3 { font-size: 16px; }
.content small, .d-subtext { color: var(--muted); font-size: 12px; display: block; }
.content ul, .content ol { margin: 2px 0; padding-left: 22px; white-space: normal; }
.d-spoiler { background: var(--muted); color: transparent; border-radius: 3px; cursor: pointer; }
.d-spoiler.revealed { background: var(--code-bg); color: inherit; }
.system { color: var(--muted); font-style: italic; }
.system-icon { color: var(--muted); font-size: 18px; line-height: 22px; }
.reply { font-size: 13px; color: var(--muted); display: flex; gap: 6px; align-items: baseline; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.reply .ref-author { color: var(--heading); font-weight: 600; }
.label { font-size: 12px; color: var(--muted); }
.attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.attachment img, .attachment video { max-width: min(520px, 100%); max-height: 400px; border-radius: 6px; display: block; }
.attachment audio { max-width: 100%; }
.file { display: inline-flex; gap: 8px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-alt); }
.missing { border: 1px dashed var(--warn); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.missing .why { color: var(--warn); }
details.spoiler > summary { cursor: pointer; color: var(--muted); font-size: 13px; }
.embed { margin-top: 4px; max-width: 520px; background: var(--bg-alt); border-left: 4px solid var(--border); border-radius: 4px; padding: 8px 12px; }
.embed .e-provider, .embed .e-footer { color: var(--muted); font-size: 12px; }
.embed .e-author { font-size: 13px; font-weight: 600; }
.embed .e-title { font-weight: 600; color: var(--heading); }
.embed .e-desc { font-size: 14px; white-space: pre-wrap; }
.embed .e-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 6px; }
.embed .e-field b { display: block; font-size: 13px; }
.embed img { max-width: 100%; max-height: 300px; border-radius: 4px; margin-top: 6px; }
.reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.reaction { display: inline-flex; gap: 4px; align-items: center; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 8px; padding: 1px 6px; font-size: 13px; }
.reaction img { width: 16px; height: 16px; object-fit: contain; }
.sticker { width: 160px; height: 160px; object-fit: contain; margin-top: 4px; }
.poll { margin-top: 4px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; max-width: 520px; }
.poll ul { margin: 6px 0 0; padding-left: 18px; }
.hidden { display: none !important; }
.wrap { max-width: 980px; margin: 0 auto; padding: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
.card { background: var(--bg-alt); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.card b { display: block; font-size: 22px; color: var(--heading); }
.notes li { margin: 4px 0; }
.notes .warn { color: var(--warn); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
`;

/** Filtering within a page and click-to-reveal spoilers; works from file://. */
export const VIEWER_SCRIPT = `
(function () {
  var input = document.getElementById('filter');
  if (input) {
    var timer;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = input.value.trim().toLowerCase();
        var items = document.querySelectorAll('.msg, .day');
        for (var i = 0; i < items.length; i++) {
          var el = items[i];
          if (el.classList.contains('day')) { el.classList.toggle('hidden', q !== ''); continue; }
          var text = el.getAttribute('data-search') || '';
          el.classList.toggle('hidden', q !== '' && text.indexOf(q) === -1);
        }
      }, 150);
    });
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== document) {
      if (target.classList && target.classList.contains('d-spoiler')) {
        target.classList.toggle('revealed');
        return;
      }
      target = target.parentNode;
    }
  });
})();
`;
