import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { errorMessage, formatBytes, formatDateTime, plural } from '../../core/format';
import type { ExportFormats } from '../../core/types';
import { JobRunner, pickFolderSink, pickZipSink } from '../../jobs/jobRunner';
import { describeStage, type DownloadRecord, type ExportJob } from '../../jobs/model';
import { sendToBackground, sendToTab, type ExportPagePing } from '../../messaging/protocol';
import { iterateDownloads, tallyDownloads, type DownloadTally } from '../../storage/downloadStore';
import { storageEstimate } from '../../storage/fileCache';
import { getJob, getLatestJob } from '../../storage/jobStore';
import type { Gap } from '../../storage/messageStore';
import { ErrorNotice, FormatPicker, ProgressBar, Stat } from '../../ui/components';

async function loadProblems(jobId: string): Promise<{ records: DownloadRecord[]; total: number }> {
  const records: DownloadRecord[] = [];
  let total = 0;
  for await (const batch of iterateDownloads(jobId)) {
    for (const record of batch) {
      if (record.status === 'done' || record.status === 'pending') continue;
      total++;
      if (records.length < 200) records.push(record);
    }
  }
  return { records, total };
}

function conversationLabel(job: ExportJob): string {
  const c = job.conversation;
  return [c.channelName ?? (c.guildId ? `Channel ${c.channelId}` : 'Direct messages'), c.guildName].filter(Boolean).join(' · ');
}

export function App() {
  const [job, setJob] = useState<ExportJob | null | undefined>(undefined);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const runnerRef = useRef<JobRunner | null>(null);
  const [formats, setFormats] = useState<ExportFormats | null>(null);
  const [tally, setTally] = useState<DownloadTally | null>(null);
  const [problems, setProblems] = useState<{ records: DownloadRecord[]; total: number }>({ records: [], total: 0 });
  const [gaps, setGaps] = useState<{ total: number; gaps: Gap[] } | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const jobIdParam = new URLSearchParams(location.search).get('job');

  const refresh = useCallback(async () => {
    const current = jobIdParam ? await getJob(jobIdParam) : await getLatestJob();
    setJob(current ?? null);
    if (current) setFormats((f) => f ?? current.options.formats);
  }, [jobIdParam]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  // One runner per job; continue unfinished work automatically.
  const jobId = job?.id;

  // Answer the background's "is this job's page open?" so it focuses this tab
  // instead of opening another one.
  useEffect(() => {
    if (!jobId) return;
    const listener = (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      const ping = message as ExportPagePing | undefined;
      if (ping?.type !== 'export/ping' || ping.jobId !== jobId) return false;
      void browser.tabs.getCurrent().then((tab) =>
        sendResponse({ ok: true, data: { tabId: tab?.id, windowId: tab?.windowId } }),
      );
      return true;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [jobId]);
  useEffect(() => {
    if (!jobId) return;
    const runner = new JobRunner(jobId, rerender);
    runnerRef.current = runner;
    void runner.continueJob().then(refresh);
    void storageEstimate().then(setStorage);
    return () => {
      runner.dispose();
      runnerRef.current = null;
    };
  }, [jobId, refresh]);

  // Counting download records reads every record, so only do it when the stage changes.
  useEffect(() => {
    if (!job || job.stage === 'collecting') return;
    void tallyDownloads(job.id).then(setTally);
    if (job.stage !== 'ready') return;
    void loadProblems(job.id).then(setProblems);
    if (job.method === 'dom') void sendToBackground({ type: 'job/gaps', jobId: job.id }).then(setGaps).catch(() => undefined);
  }, [job?.id, job?.stage, job?.download.finishedAt, job?.saves.length]);

  const runner = runnerRef.current;
  const status = runner?.status ?? { activity: 'idle' as const };
  const busy = status.activity !== 'idle';

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e));
    } finally {
      await refresh();
    }
  };

  if (job === undefined) return <div className="page muted">Loading…</div>;
  if (job === null) {
    return (
      <div className="page stack">
        <h1>No export in progress</h1>
        <p className="muted">Open a Discord conversation and click the extension icon to start an export.</p>
      </div>
    );
  }

  const domCapture = job.method === 'dom';
  const stages = ['collecting', 'downloading', 'ready'] as const;
  const stageIndex = stages.indexOf(job.stage);

  const captureCommand = (command: 'pause' | 'resume' | 'finish') =>
    act(async () => {
      try {
        if (job.collect.tabId === undefined) throw new Error('no tab');
        await sendToTab(job.collect.tabId, { type: 'capture/command', jobId: job.id, command });
      } catch {
        if (command === 'finish') await sendToBackground({ type: 'capture/finish', jobId: job.id });
        else await sendToBackground({ type: 'capture/set-paused', jobId: job.id, paused: command === 'pause' });
      }
    });

  const goToDiscordTab = () =>
    act(async () => {
      if (job.collect.tabId !== undefined) {
        try {
          const tab = await browser.tabs.update(job.collect.tabId, { active: true });
          if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
          return;
        } catch {
          // Tab closed; open the conversation again.
        }
      }
      await browser.tabs.create({ url: job.conversation.url });
    });

  const save = (target: 'folder' | 'zip') =>
    act(async () => {
      if (!runner || !formats) return;
      if (!formats.html && !formats.json && !formats.csv) throw new Error('Choose at least one format.');
      setSavedMessage(null);
      // The picker must open directly from the click.
      const factory = target === 'folder' ? await pickFolderSink(job) : await pickZipSink(job);
      const result = await runner.saveTo(factory, formats);
      if (result) {
        setSavedMessage(
          `Saved ${plural(result.files, 'file')} (${formatBytes(result.bytes)}).` +
            (result.skipped.length ? ` ${result.skipped.length} cached file(s) were missing.` : '') +
            (target === 'folder' && formats.html ? ' Open index.html in the saved folder to browse the conversation.' : ''),
        );
      }
    });

  const discard = () =>
    act(async () => {
      if (!confirm('Delete this export and all of its stored data? Files you already saved are not affected.')) return;
      runner?.dispose();
      await sendToBackground({ type: 'job/discard', jobId: job.id });
    });

  const collectProgress =
    job.collect.newestMs !== undefined && job.range.endMs > job.range.startMs
      ? (Math.min(job.collect.newestMs, job.range.endMs) - job.range.startMs) / (job.range.endMs - job.range.startMs)
      : 0;
  const downloadState = status.download ?? job.download;
  const pendingDownloads = tally ? tally.pending : 0;
  const rateLimited = status.rateLimitedUntil && status.rateLimitedUntil > Date.now();
  const captureActive = Boolean(job.collect.lastActivityAt && Date.now() - job.collect.lastActivityAt < 15_000);

  return (
    <div className="page stack">
      <header className="stack">
        <div className="spread">
          <div>
            <h1>{conversationLabel(job)}</h1>
            <div className="muted">
              {job.range.startDate} → {job.range.endDate} ({job.range.timeZone}) ·{' '}
              {domCapture ? 'page capture' : 'official bot API'}
            </div>
          </div>
          <div className="steps">
            {['Collect messages', 'Download files', 'Save'].map((label, i) => (
              <span key={label} className={i === stageIndex ? 'current' : i < stageIndex ? 'done' : ''}>
                {i < stageIndex ? '✓ ' : ''}
                {label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <ErrorNotice message={error ?? status.lastError} />

      <section className="card stack">
        <div className="spread">
          <h2>1. Messages</h2>
          <span className="muted small">{job.stage === 'collecting' ? describeStage(job) : 'Done'}</span>
        </div>
        <div className="stats">
          <Stat label="messages" value={job.collect.messageCount.toLocaleString()} />
          <Stat label="attachments found" value={job.collect.attachmentCount.toLocaleString()} />
          <Stat label="oldest" value={job.collect.oldestMs ? formatDateTime(job.collect.oldestMs) : '—'} />
          <Stat label="newest" value={job.collect.newestMs ? formatDateTime(job.collect.newestMs) : '—'} />
        </div>
        {!domCapture && job.stage === 'collecting' && <ProgressBar value={collectProgress} max={1} />}
        {domCapture && (
          <ul className="plain small">
            <li className={job.collect.startReached ? 'ok' : 'warn'}>
              {job.collect.startReached ? 'Reached the start of the date range.' : 'Has not reached the start of the date range yet.'}
            </li>
            <li className={job.collect.endReached ? 'ok' : 'warn'}>
              {job.collect.endReached
                ? 'Reached the end of the date range (or the latest message).'
                : 'Has not reached the end of the date range yet.'}
            </li>
          </ul>
        )}
        {job.collect.warnings.map((warning) => (
          <div key={warning} className="card notice small">
            {warning}
          </div>
        ))}
        {rateLimited && <p className="muted small">Waiting for Discord's rate limit…</p>}

        {job.stage === 'collecting' && domCapture && (
          <>
            <p className="small">
              {captureActive
                ? 'Capture is running in the Discord tab. Scroll through the date range there; this page updates live.'
                : 'Capture is not active right now. Go to the Discord tab (reload it if needed) to continue scrolling.'}
            </p>
            <div className="row">
              <button onClick={() => void goToDiscordTab()}>Go to Discord tab</button>
              <button onClick={() => void captureCommand(job.paused ? 'resume' : 'pause')}>
                {job.paused ? 'Resume capture' : 'Pause capture'}
              </button>
              <button className="primary" onClick={() => void captureCommand('finish')}>
                Finish capture
              </button>
            </div>
          </>
        )}
        {job.stage === 'collecting' && !domCapture && (
          <div className="row">
            {busy ? (
              <button onClick={() => void act(() => runner!.pause())}>Pause</button>
            ) : (
              <button className="primary" onClick={() => void act(() => runner!.resume())}>
                {job.paused ? 'Resume' : 'Retry'}
              </button>
            )}
            <button onClick={() => void act(() => runner!.stopStage())}>Stop and keep what was fetched</button>
          </div>
        )}
      </section>

      <section className="card stack">
        <div className="spread">
          <h2>2. Attachments</h2>
          <span className="muted small">
            {job.options.downloadAttachments || job.options.downloadAssets ? (job.stage === 'downloading' ? describeStage(job) : '') : 'Turned off'}
          </span>
        </div>
        {(job.options.downloadAttachments || job.options.downloadAssets) && job.stage !== 'collecting' && (
          <>
            <div className="stats">
              <Stat label="downloaded" value={`${downloadState.done.toLocaleString()} / ${(downloadState.total || tally?.total || 0).toLocaleString()}`} />
              <Stat label="failed" value={downloadState.failed.toLocaleString()} />
              <Stat label="size" value={formatBytes(downloadState.bytes)} />
            </div>
            <ProgressBar value={downloadState.done + downloadState.failed} max={downloadState.total || tally?.total || 0} />
            <p className="muted small">
              Files are verified (HTTP status, size and type) and kept in the extension's private storage until you
              save. Includes avatars, custom emoji and stickers when that option is on.
            </p>
            <div className="row">
              {job.stage === 'downloading' &&
                (busy ? (
                  <button onClick={() => void act(() => runner!.pause())}>Pause downloads</button>
                ) : (
                  <button className="primary" onClick={() => void act(() => runner!.resume())}>
                    {job.paused ? 'Resume downloads' : 'Retry downloads'}
                  </button>
                ))}
              {job.stage === 'downloading' && (
                <button onClick={() => void act(() => runner!.stopStage())}>Skip remaining downloads</button>
              )}
              {job.stage === 'ready' && !busy && (problems.total > 0 || pendingDownloads > 0) && (
                <button onClick={() => void act(() => runner!.retryFailedDownloads())}>
                  Retry {plural(problems.total + pendingDownloads, 'unfinished download')}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>3. Save</h2>
        {job.stage !== 'ready' ? (
          <p className="muted">Saving becomes available once messages are collected and files are downloaded (or skipped).</p>
        ) : (
          <>
            {formats && <FormatPicker value={formats} onChange={setFormats} disabled={busy} />}
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void save('folder')}>
                Save to folder…
              </button>
              <button disabled={busy} onClick={() => void save('zip')}>
                Save as ZIP…
              </button>
              {status.activity === 'saving' && <button onClick={() => runner?.cancelSave()}>Cancel saving</button>}
            </div>
            {status.save && (
              <div className="stack">
                <ProgressBar value={status.save.filesWritten} max={status.save.totalFiles} />
                <span className="muted small">
                  {status.save.filesWritten} / {status.save.totalFiles} files · {formatBytes(status.save.bytesWritten)} ·{' '}
                  {status.save.detail}
                </span>
              </div>
            )}
            {savedMessage && <p className="ok">{savedMessage}</p>}
            <p className="muted small">
              The folder option creates a new sub-folder with <code>index.html</code>, <code>messages.json</code>,{' '}
              <code>messages.csv</code>, <code>attachments/</code> and <code>assets/</code>. ZIP archives switch to
              ZIP64 automatically for very large exports.
            </p>
            {job.saves.length > 0 && (
              <ul className="plain small">
                {job.saves.map((s) => (
                  <li key={s.at}>
                    {formatDateTime(s.at)} — {s.target === 'zip' ? 'ZIP' : 'folder'} “{s.name}”: {plural(s.files, 'file')},{' '}
                    {formatBytes(s.bytes)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {(job.errorCount > 0 || problems.total > 0 || (gaps?.total ?? 0) > 0 || job.cancelled) && (
        <section className="card stack">
          <h2>Problems</h2>
          {job.cancelled && <p className="warn">This export was stopped early; it contains only what was collected before that.</p>}
          {gaps && gaps.total > 0 && (
            <div>
              <b>{plural(gaps.total, 'possible gap')} in the capture</b>
              <p className="muted small">
                No captured message connects these neighbours, so messages may be missing between them. To fill a gap,
                start a new export of the same range and scroll slowly through these times.
              </p>
              <ul className="plain small">
                {gaps.gaps.slice(0, 10).map((g) => (
                  <li key={g.afterId}>
                    {formatDateTime(g.fromMs)} → {formatDateTime(g.toMs)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {problems.total > 0 && (
            <div className="problems">
              <b>{plural(problems.total, 'file')} not downloaded</b>
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.records.map((r) => (
                    <tr key={r.key}>
                      <td>{r.filename}</td>
                      <td>{r.status}</td>
                      <td>{r.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {domCapture && problems.records.some((r) => r.status === 'expired') && (
                <p className="muted small">
                  Expired links: Discord's attachment links are only valid for a limited time. Start a new capture of the
                  same range and download right away.
                </p>
              )}
            </div>
          )}
          {job.errors.length > 0 && (
            <div className="problems">
              <b>{plural(job.errorCount, 'error')}</b>
              <ul className="plain small">
                {job.errors
                  .slice(-20)
                  .reverse()
                  .map((e) => (
                    <li key={`${e.at}-${e.message}`}>
                      {formatDateTime(e.at)} ({e.stage}): {e.message}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <footer className="spread small muted">
        <span>
          Extension storage in use: {formatBytes(storage.usage)}
          {storage.quota ? ` of ${formatBytes(storage.quota)}` : ''}
        </span>
        <button className="danger" disabled={busy} onClick={() => void discard()}>
          Discard export
        </button>
      </footer>
    </div>
  );
}
