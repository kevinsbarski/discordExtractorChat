import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { addDays, buildDateRange, toIsoDate } from '../../core/dateRange';
import { buildChannelUrl, parseDiscordUrl, type DiscordLocation } from '../../core/discordUrl';
import { errorMessage, plural } from '../../core/format';
import { DEFAULT_OPTIONS, type ExportFormats, type RetrievalMethod } from '../../core/types';
import { describeStage, type ExportJob } from '../../jobs/model';
import { sendToBackground, sendToTab, type PageInfo } from '../../messaging/protocol';
import { getBotToken, type StoredBotToken } from '../../settings/botToken';
import { ErrorNotice, FormatPicker } from '../../ui/components';

type TabState =
  | { kind: 'loading' }
  | { kind: 'not-discord' }
  | { kind: 'no-conversation'; tabId: number }
  | { kind: 'ready'; tabId: number; info: PageInfo; location: DiscordLocation };

/** Makes sure our content script is running in the tab (tabs opened before install don't have it). */
async function pingTab(tabId: number): Promise<PageInfo> {
  try {
    return await sendToTab(tabId, { type: 'content/ping' });
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/discord.js'] });
    return sendToTab(tabId, { type: 'content/ping' });
  }
}

const today = () => toIsoDate(new Date());

export function App() {
  const [tab, setTab] = useState<TabState>({ kind: 'loading' });
  const [job, setJob] = useState<ExportJob | null>(null);
  const [method, setMethod] = useState<RetrievalMethod>('dom');
  const [startDate, setStartDate] = useState(() => addDays(today(), -30));
  const [endDate, setEndDate] = useState(today);
  const [formats, setFormats] = useState<ExportFormats>(DEFAULT_OPTIONS.formats);
  const [downloadAttachments, setDownloadAttachments] = useState(true);
  const [downloadAssets, setDownloadAssets] = useState(true);
  const [botToken, setBotToken] = useState<StoredBotToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshJob = useCallback(async () => {
    const { job: latest } = await sendToBackground({ type: 'job/get' });
    setJob(latest);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setBotToken(await getBotToken());
        await refreshJob();
        const [active] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!active?.id || !active.url?.startsWith('https://discord.com/')) {
          setTab({ kind: 'not-discord' });
          return;
        }
        const location = parseDiscordUrl(active.url);
        if (!location) {
          setTab({ kind: 'no-conversation', tabId: active.id });
          return;
        }
        const info = await pingTab(active.id);
        setTab({ kind: 'ready', tabId: active.id, info, location });
      } catch (e) {
        setError(errorMessage(e));
        setTab({ kind: 'not-discord' });
      }
    })();
    const timer = setInterval(() => void refreshJob().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [refreshJob]);

  const applyPreset = (days: number) => {
    setEndDate(today());
    setStartDate(addDays(today(), -days));
  };

  const start = async () => {
    if (tab.kind !== 'ready') return;
    setError(null);
    try {
      const range = buildDateRange(startDate, endDate);
      if (method === 'bot' && !tab.location.guildId) {
        throw new Error('Bots cannot read direct messages or group DMs. Use page capture for this conversation.');
      }
      if (method === 'bot' && !botToken) throw new Error('Add your bot token in the options first.');
      if (!formats.html && !formats.json && !formats.csv) throw new Error('Choose at least one export format.');
      if (job && !confirm('Starting a new export discards the current one (including anything not saved yet). Continue?')) return;
      setBusy(true);
      const { job: created } = await sendToBackground({
        type: 'job/create',
        input: {
          method,
          range,
          tabId: tab.tabId,
          options: { ...DEFAULT_OPTIONS, formats, downloadAttachments, downloadAssets },
          conversation: {
            guildId: tab.location.guildId,
            channelId: tab.location.channelId,
            channelName: tab.info.channelName,
            guildName: tab.info.guildName,
            url: buildChannelUrl(tab.location),
          },
        },
      });
      if (method === 'dom') await sendToTab(tab.tabId, { type: 'capture/start', job: created });
      window.close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const captureCommand = async (command: 'pause' | 'resume' | 'finish') => {
    if (!job) return;
    setError(null);
    try {
      const tabId = job.collect.tabId;
      if (tabId === undefined) throw new Error('missing tab');
      await sendToTab(tabId, { type: 'capture/command', jobId: job.id, command });
    } catch {
      // The capture tab is closed or reloaded: update the job directly.
      if (command === 'finish') await sendToBackground({ type: 'capture/finish', jobId: job.id });
      else await sendToBackground({ type: 'capture/set-paused', jobId: job.id, paused: command === 'pause' });
    }
    await refreshJob();
  };

  const discard = async () => {
    if (!job || !confirm('Discard this export and delete its stored data?')) return;
    try {
      if (job.method === 'dom' && job.stage === 'collecting' && job.collect.tabId !== undefined) {
        await sendToTab(job.collect.tabId, { type: 'capture/command', jobId: job.id, command: 'cancel' }).catch(() => undefined);
      }
      await sendToBackground({ type: 'job/discard', jobId: job.id });
      setJob(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openProgress = async () => {
    if (!job) return;
    await sendToBackground({ type: 'job/open-export-page', jobId: job.id });
    window.close();
  };

  const conversationLabel =
    tab.kind === 'ready'
      ? [tab.info.channelName, tab.info.guildName].filter(Boolean).join(' · ') ||
        (tab.location.guildId ? `Channel ${tab.location.channelId}` : 'Direct messages')
      : '';

  return (
    <div className="popup stack">
      <div className="spread">
        <h1>Chat Exporter</h1>
        <button className="link small" onClick={() => void browser.runtime.openOptionsPage()}>
          Help &amp; settings
        </button>
      </div>

      {job && (
        <div className="card stack">
          <div className="spread">
            <b>Current export</b>
            <span className="muted small">{describeStage(job)}</span>
          </div>
          <div className="small">
            {[job.conversation.channelName, job.conversation.guildName].filter(Boolean).join(' · ') || job.conversation.channelId}
            <br />
            {job.range.startDate} → {job.range.endDate} · {plural(job.collect.messageCount, 'message')}
          </div>
          <div className="row">
            {job.method === 'dom' && job.stage === 'collecting' && (
              <>
                <button onClick={() => void captureCommand(job.paused ? 'resume' : 'pause')}>
                  {job.paused ? 'Resume capture' : 'Pause capture'}
                </button>
                <button className="primary" onClick={() => void captureCommand('finish')}>
                  Finish capture
                </button>
              </>
            )}
            <button onClick={() => void openProgress()}>Open progress</button>
            <button className="danger" onClick={() => void discard()}>
              Discard
            </button>
          </div>
        </div>
      )}

      {tab.kind === 'loading' && <p className="muted">Checking this tab…</p>}
      {tab.kind === 'not-discord' && (
        <div className="card">
          Open a Discord conversation at <code>discord.com/channels/…</code> in this tab, then click the extension icon again.
        </div>
      )}
      {tab.kind === 'no-conversation' && (
        <div className="card">Open the server channel, thread or direct message you want to export, then try again.</div>
      )}

      {tab.kind === 'ready' && (
        <div className="stack">
          <div>
            <div className="muted small">Conversation</div>
            <b>{conversationLabel}</b>
          </div>

          <div className="stack">
            <label className={`choice ${method === 'dom' ? 'selected' : ''}`}>
              <input type="radio" name="method" checked={method === 'dom'} onChange={() => setMethod('dom')} />
              <span>
                <b>Capture from this page</b> (recommended)
                <br />
                <span className="muted small">
                  Reads messages as you scroll through them. Works for DMs and servers. No login data is used and no
                  extra requests are made — you scroll through the date range yourself.
                </span>
              </span>
            </label>
            <label className={`choice ${method === 'bot' ? 'selected' : ''}`}>
              <input type="radio" name="method" checked={method === 'bot'} onChange={() => setMethod('bot')} />
              <span>
                <b>Official bot API</b> (optional)
                <br />
                <span className="muted small">
                  Fetches the full date range automatically using your own bot. Server channels only, and the bot must
                  be in the server.{' '}
                  {botToken ? <span className="ok">Bot token set.</span> : <span className="warn">No bot token set.</span>}
                </span>
              </span>
            </label>
          </div>

          <div className="dates">
            <label>
              Start date
              <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              End date
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <div className="row presets">
            <span className="muted small">Last</span>
            <button onClick={() => applyPreset(0)}>Today</button>
            <button onClick={() => applyPreset(7)}>7 days</button>
            <button onClick={() => applyPreset(30)}>30 days</button>
            <button onClick={() => applyPreset(365)}>1 year</button>
          </div>

          <div className="stack">
            <FormatPicker value={formats} onChange={setFormats} />
            <label className="check">
              <input type="checkbox" checked={downloadAttachments} onChange={(e) => setDownloadAttachments(e.target.checked)} />
              Download attachments
            </label>
            <label className="check">
              <input type="checkbox" checked={downloadAssets} onChange={(e) => setDownloadAssets(e.target.checked)} />
              Download avatars, custom emoji and stickers (for the offline viewer)
            </label>
          </div>

          <button className="primary" disabled={busy} onClick={() => void start()}>
            {method === 'dom' ? 'Export — start capturing' : 'Export'}
          </button>
          {method === 'dom' && (
            <p className="muted small">
              A panel appears in the Discord tab. Scroll through the whole date range, then click <b>Finish</b>.
            </p>
          )}
        </div>
      )}

      <ErrorNotice message={error} />
    </div>
  );
}
