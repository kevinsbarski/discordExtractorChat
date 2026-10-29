import { useEffect, useState } from 'react';
import { errorMessage } from '../../core/format';
import type { ApiUser } from '../../retrieval/bot/apiTypes';
import { DiscordBotClient } from '../../retrieval/bot/client';
import {
  clearBotToken,
  getBotToken,
  looksLikeBotToken,
  normalizeBotToken,
  setBotToken,
  type StoredBotToken,
} from '../../settings/botToken';
import { ErrorNotice } from '../../ui/components';

export function App() {
  const [stored, setStored] = useState<StoredBotToken | null>(null);
  const [input, setInput] = useState('');
  const [remember, setRemember] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getBotToken().then(setStored);
  }, []);

  const save = async () => {
    setError(null);
    setBotName(null);
    const token = normalizeBotToken(input);
    if (!looksLikeBotToken(token)) {
      setError('That does not look like a bot token. Copy it from Developer Portal → your application → Bot → Reset Token.');
      return;
    }
    setBusy(true);
    try {
      // Verify the token with one authorized request before storing it.
      const me = await new DiscordBotClient(token).get<ApiUser>('/users/@me');
      if (!me.bot) throw new Error('This token does not belong to a bot account. Only bot tokens are supported.');
      await setBotToken(token, remember);
      setStored(await getBotToken());
      setBotName(me.global_name || me.username);
      setInput('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    await clearBotToken();
    setStored(null);
    setBotName(null);
  };

  return (
    <div className="stack" style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 48px' }}>
      <h1>Local Chat Exporter for Discord</h1>
      <p className="muted">
        Exports conversations to JSON, HTML and CSV with their attachments. Everything stays on this computer: there is
        no server, account or paid service.
      </p>

      <section className="card stack">
        <h2>Ways to collect messages</h2>
        <div>
          <h3>Page capture (default)</h3>
          <p>
            Reads messages that Discord has already rendered in your browser while you scroll. It does not read or use your
            login token, does not call Discord's API and does not scroll or click for you, so it only behaves like you
            reading the conversation.
          </p>
          <ul className="plain">
            <li>You must scroll through the whole date range yourself; Discord only loads older messages as you scroll.</li>
            <li>“Jump to start date” opens the conversation at the start date (a normal page navigation); then scroll down.</li>
            <li>Works for server channels, threads, direct messages and group DMs you can open.</li>
            <li>
              Fidelity is limited to what is displayed: author IDs only when an avatar is shown, display names instead of
              usernames, reaction counts without who reacted, and approximate attachment sizes.
            </li>
            <li>Messages from blocked users, collapsed by Discord, are not captured unless you expand them.</li>
            <li>Discord can change its page layout at any time, which can break capture until the extension is updated.</li>
          </ul>
        </div>
        <div>
          <h3>Official bot API (optional)</h3>
          <p>
            Fetches the whole date range automatically through Discord's documented API, authenticated as a bot you create.
            Requests follow Discord's rate limits.
          </p>
          <ul className="plain">
            <li>Only server channels and threads where the bot is a member. Bots can never read your direct messages or group DMs.</li>
            <li>Someone with “Manage Server” must add the bot to the server.</li>
            <li>The bot needs View Channel and Read Message History, and the Message Content intent enabled.</li>
          </ul>
        </div>
      </section>

      <section className="card stack">
        <h2>Bot token</h2>
        {stored ? (
          <p className="ok">
            A bot token is set{stored.remembered ? ' and remembered on this device' : ' for this browser session'}.
            {botName ? ` Connected as ${botName}.` : ''}
          </p>
        ) : (
          <p className="muted">No bot token is set. Page capture works without one.</p>
        )}
        <ol className="plain small">
          <li>
            Open the{' '}
            <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
              Discord Developer Portal
            </a>
            , create an application, open <b>Bot</b> and click <b>Reset Token</b> to copy the token.
          </li>
          <li>
            On the same page, enable <b>Message Content Intent</b>.
          </li>
          <li>
            Under <b>OAuth2 → URL Generator</b> select the <code>bot</code> scope with <b>View Channels</b> and{' '}
            <b>Read Message History</b>, open the URL and add the bot to your server.
          </li>
          <li>Paste the token below.</li>
        </ol>
        <div className="row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Bot token"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button className="primary" disabled={busy || !input} onClick={() => void save()}>
            Verify &amp; save
          </button>
          {stored && (
            <button className="danger" onClick={() => void clear()}>
              Remove token
            </button>
          )}
        </div>
        <label className="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device (otherwise the token is forgotten when the browser closes)
        </label>
        <p className="muted small">
          The token is only sent to discord.com as the Authorization header of bot API requests. Never paste your personal
          account token: this extension does not support user tokens, and using them breaks Discord's Terms of Service.
        </p>
        <ErrorNotice message={error} />
      </section>

      <section className="card stack">
        <h2>Privacy</h2>
        <p>
          Messages are stored in this browser's extension storage (IndexedDB and the private file system) until you save or
          discard the export. Nothing is sent anywhere except requests to Discord's CDN for attachments and, if you use the
          bot method, to Discord's API.
        </p>
      </section>
      <p className="muted small">Not affiliated with Discord.</p>
    </div>
  );
}
