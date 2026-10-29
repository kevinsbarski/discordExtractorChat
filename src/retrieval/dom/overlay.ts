import { formatDate, formatDateTime, plural } from '../../core/format';
import type { CaptureView } from './captureSession';

/**
 * Floating status panel shown inside the Discord tab during a capture, so the
 * user can scroll and see progress in the same place. Rendered in a closed
 * shadow root; all dynamic text is set with `textContent`.
 */

export interface OverlayCallbacks {
  onPause(): void;
  onResume(): void;
  onFinish(): void;
  onCancel(): void;
  onJumpToStart(): void;
  onCheckGaps(): void;
  onReturn(): void;
}

export interface OverlayInfo {
  conversationLabel: string;
  range: { startMs: number; endMs: number; startDate: string; endDate: string };
}

const STYLE = `
:host { all: initial; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e3e5e8; background: #1e1f22;
  border: 1px solid #3f4147; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.45); overflow: hidden; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #2b2d31; cursor: default; }
.title { font-weight: 700; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #80848e; }
.dot.on { background: #23a55a; } .dot.warn { background: #f0b232; } .dot.err { background: #f23f43; }
.icon { background: none; border: 0; color: #b5bac1; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
.body { padding: 10px 12px 12px; display: grid; gap: 6px; }
.muted { color: #949ba4; }
.big { font-size: 15px; font-weight: 600; color: #f2f3f5; }
.ok { color: #23a55a; } .todo { color: #f0b232; } .err { color: #f23f43; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
button.btn { font: inherit; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; background: #4e5058; color: #fff; }
button.btn:hover { filter: brightness(1.1); }
button.primary { background: #5865f2; } button.danger { background: transparent; color: #f23f43; border: 1px solid #f23f43; }
button.btn:disabled { opacity: .5; cursor: default; }
.hint { font-size: 12px; color: #949ba4; border-top: 1px solid #3f4147; padding-top: 6px; }
.panel.min .body { display: none; }
`;

export class CaptureOverlay {
  private readonly host: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private gapsText = '';

  constructor(
    private readonly info: OverlayInfo,
    callbacks: OverlayCallbacks,
    doc: Document = document,
  ) {
    this.host = doc.createElement('local-chat-exporter-panel');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    root.append(style);

    const make = (tag: string, cls = '', text = '') => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text) node.textContent = text;
      return node;
    };

    const panel = make('div', 'panel');
    const head = make('div', 'head');
    this.el.dot = make('span', 'dot');
    this.el.title = make('span', 'title', 'Chat Exporter');
    const minimize = make('button', 'icon', '–') as HTMLButtonElement;
    minimize.title = 'Minimize';
    minimize.addEventListener('click', () => panel.classList.toggle('min'));
    head.append(this.el.dot, this.el.title, minimize);

    const body = make('div', 'body');
    this.el.conversation = make('div', 'muted', info.conversationLabel);
    this.el.range = make('div', 'muted', `Range: ${formatDate(info.range.startMs)} → ${formatDate(info.range.endMs)}`);
    this.el.count = make('div', 'big', '0 messages');
    this.el.start = make('div');
    this.el.end = make('div');
    this.el.status = make('div', 'muted');
    this.el.gaps = make('div', 'muted');

    const buttons = make('div', 'row');
    const button = (label: string, cls: string, onClick: () => void) => {
      const b = make('button', `btn ${cls}`, label) as HTMLButtonElement;
      b.addEventListener('click', onClick);
      buttons.append(b);
      return b;
    };
    this.el.pause = button('Pause', '', () => (this.el.pause.dataset.paused === '1' ? callbacks.onResume() : callbacks.onPause()));
    this.el.jump = button('Jump to start date', '', () => callbacks.onJumpToStart());
    this.el.jump.title =
      'Opens the conversation at the first message on or after the start date (a normal page navigation, like opening a message link). Then scroll down.';
    this.el.checkGaps = button('Check gaps', '', () => callbacks.onCheckGaps());
    this.el.finish = button('Finish', 'primary', () => callbacks.onFinish());
    this.el.cancel = button('Cancel', 'danger', () => callbacks.onCancel());
    this.el.back = button('Return to conversation', 'primary', () => callbacks.onReturn());

    const hint = make(
      'div',
      'hint',
      'Discord only loads messages as you scroll. Scroll (or press Page Up / Page Down) through the whole date range; this extension reads what appears and never scrolls or requests messages itself.',
    );

    body.append(this.el.conversation, this.el.range, this.el.count, this.el.start, this.el.end, this.el.status, this.el.gaps, buttons, hint);
    panel.append(head, body);
    root.append(panel);
    doc.documentElement.append(this.host);
  }

  setGaps(text: string): void {
    this.gapsText = text;
    this.el.gaps.textContent = text;
  }

  render(view: CaptureView): void {
    const { range } = this.info;
    this.el.count.textContent = `${plural(view.storedCount, 'message')} · ${plural(view.attachmentCount, 'attachment')}`;

    if (view.startReached) {
      this.el.start.className = 'ok';
      this.el.start.textContent = '✓ Reached the start of the range';
    } else {
      this.el.start.className = 'todo';
      const oldest = view.oldestMs ?? view.visibleOldestMs;
      this.el.start.textContent = `↑ Scroll up to ${formatDate(range.startMs)}${oldest ? ` (oldest so far: ${formatDateTime(oldest)})` : ''}`;
    }
    if (view.endReached) {
      this.el.end.className = 'ok';
      this.el.end.textContent = '✓ Reached the end of the range';
    } else {
      this.el.end.className = 'todo';
      const newest = view.newestMs ?? view.visibleNewestMs;
      this.el.end.textContent = `↓ Scroll down to ${formatDate(range.endMs)} or the latest message${newest ? ` (newest so far: ${formatDateTime(newest)})` : ''}`;
    }

    const statusText: Record<CaptureView['state'], string> = {
      capturing: 'Capturing — keep scrolling.',
      paused: 'Paused. Nothing is recorded until you resume.',
      'other-conversation': 'You are viewing a different conversation. Capture resumes when you return.',
      'waiting-for-list': 'Waiting for Discord to show the messages…',
      stopped: 'Capture stopped.',
      error: `Could not save captured messages: ${view.error ?? 'unknown error'}. If the extension was updated or reloaded, reload this tab.`,
    };
    this.el.status.textContent = statusText[view.state];
    this.el.status.className = view.state === 'error' ? 'err' : 'muted';
    this.el.dot.className = `dot ${view.state === 'capturing' ? 'on' : view.state === 'error' ? 'err' : 'warn'}`;
    this.el.title.textContent = view.state === 'capturing' ? 'Capturing messages' : 'Chat Exporter';

    const paused = view.state === 'paused';
    this.el.pause.textContent = paused ? 'Resume' : 'Pause';
    this.el.pause.dataset.paused = paused ? '1' : '0';
    this.el.back.style.display = view.state === 'other-conversation' ? '' : 'none';
    this.el.gaps.textContent = this.gapsText;
  }

  setBusy(busy: boolean): void {
    for (const key of ['pause', 'jump', 'checkGaps', 'finish', 'cancel']) {
      (this.el[key] as HTMLButtonElement).disabled = busy;
    }
  }

  remove(): void {
    this.host.remove();
  }
}
