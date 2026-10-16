import { useEffect, useState, type FormEvent } from 'react';
import { ENVIRONMENTS, type EnvironmentId, type SmokeEnvironment } from './EnvironmentDeck';
import { type LeaderboardEntry, type PlayerProfile } from './shiftClient';

export type LobbyStep = 'login' | 'modes' | 'map' | 'h2h' | 'game';
export type GameModeId = 'campaign' | 'h2h' | 'sandbox';

export interface RivalOpponent {
  rank: number;
  callsign: string;
  smoked: number;
  environmentId: EnvironmentId;
}

const DEFAULT_RIVALS: readonly RivalOpponent[] = [
  { rank: 1, callsign: 'ASH-KING', smoked: 6, environmentId: 'alleyway' },
  { rank: 2, callsign: 'NIGHT-COOK', smoked: 5, environmentId: 'restaurant' },
  { rank: 3, callsign: 'B2-DRIFTER', smoked: 4, environmentId: 'parking-garage' },
];

const MAP_COORDS: Record<EnvironmentId, { x: string; y: string; code: string }> = {
  alleyway: { x: '22%', y: '68%', code: 'SEC-01' },
  restaurant: { x: '46%', y: '38%', code: 'SEC-02' },
  'parking-garage': { x: '68%', y: '62%', code: 'SEC-03' },
  dumpster: { x: '82%', y: '28%', code: 'SEC-04' },
};

export interface SmokeBreakLobbyProps {
  step: Exclude<LobbyStep, 'game'>;
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  leaderboardEntries: readonly LeaderboardEntry[];
  selectedRival: RivalOpponent | null;
  onSelectEnvironment: (id: EnvironmentId) => void;
  onSaveCallsign: (nextCallsign: string) => Promise<void>;
  onLoginPassword?: (callsign: string, password: string) => Promise<void>;
  onLoginOAuth?: (
    provider: 'apple' | 'google',
    idToken: string,
    callsign?: string
  ) => Promise<void>;
  onCompleteLogin: () => void;
  onSelectMode: (mode: GameModeId) => void;
  onSelectRival: (rival: RivalOpponent) => void;
  onSetStep: (step: LobbyStep) => void;
  onStartShift: () => void;
}

export function resolveRivalList(entries: readonly LeaderboardEntry[]): RivalOpponent[] {
  if (entries.length === 0) {
    return [...DEFAULT_RIVALS];
  }
  return entries.slice(0, 4).map(entry => ({
    rank: entry.rank,
    callsign: entry.callsign,
    smoked: entry.smoked,
    environmentId: entry.environmentId,
  }));
}

interface AppleAuthWindow extends Window {
  AppleID?: {
    auth: {
      init: (config: {
        clientId: string;
        scope: string;
        redirectURI: string;
        usePopup: boolean;
      }) => void;
      signIn: () => Promise<{
        authorization?: { id_token?: string };
        user?: { name?: { firstName?: string; lastName?: string } };
      }>;
    };
  };
}

function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function requestAppleIdToken(clientId: string): Promise<{ idToken: string; suggestedName?: string }> {
  await loadExternalScript(
    'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
  );
  const win = window as AppleAuthWindow;
  if (!win.AppleID?.auth) {
    throw new Error('Apple Sign-In SDK unavailable');
  }
  const normalizedPath = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : `${window.location.pathname}/`;
  const redirectURI =
    window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
      ? 'https://idle-smoke-staging.idleaustin.workers.dev/idle-smoke/'
      : `${window.location.origin}${normalizedPath}`;
  win.AppleID.auth.init({
    clientId,
    scope: 'name email',
    redirectURI,
    usePopup: true,
  });
  const response = await win.AppleID.auth.signIn();
  const idToken = response?.authorization?.id_token;
  if (!idToken) {
    throw new Error('Apple Sign-In did not return an ID token');
  }
  const firstName = response?.user?.name?.firstName ?? '';
  return { idToken, suggestedName: firstName || undefined };
}

function requestGoogleIdTokenPopup(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const nonce = globalThis.crypto.randomUUID();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('prompt', 'select_account');

    let settled = false;
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('smokebreak-oauth') : null;

    const finish = (idToken: string | null, err: string | null) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
      channel?.close();
      if (idToken) resolve(idToken);
      else reject(new Error(err || 'Google Sign-In cancelled'));
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; idToken?: string; error?: string } | null;
      if (data?.type === 'smokebreak-google-oauth') {
        finish(data.idToken ?? null, data.error ?? null);
      }
    };

    window.addEventListener('message', onMessage);
    if (channel) {
      channel.onmessage = event => {
        const data = event.data as { type?: string; idToken?: string; error?: string } | null;
        if (data?.type === 'smokebreak-google-oauth') {
          finish(data.idToken ?? null, data.error ?? null);
        }
      };
    }

    const popup = window.open(authUrl.toString(), 'smokebreak-google-oauth', 'width=500,height=640');
    if (!popup) {
      finish(null, 'Google Sign-In popup was blocked by the browser');
      return;
    }

    const timer = window.setInterval(() => {
      try {
        if (popup.location.origin === window.location.origin) {
          const hash = popup.location.hash.startsWith('#')
            ? popup.location.hash.slice(1)
            : popup.location.hash;
          const params = new URLSearchParams(hash);
          const idToken = params.get('id_token');
          const err = params.get('error');
          if (idToken || err) {
            popup.close();
            finish(idToken, err ? `Google Sign-In error: ${err}` : null);
          }
        }
      } catch {
        // Cross-origin while user is on accounts.google.com; wait until redirect back to origin
      }
    }, 250);
  });
}

function LoginScreen({
  profile,
  onSaveCallsign,
  onLoginPassword,
  onLoginOAuth,
  onCompleteLogin,
}: {
  profile: PlayerProfile;
  onSaveCallsign: (nextCallsign: string) => Promise<void>;
  onLoginPassword?: (callsign: string, password: string) => Promise<void>;
  onLoginOAuth?: (
    provider: 'apple' | 'google',
    idToken: string,
    callsign?: string
  ) => Promise<void>;
  onCompleteLogin: () => void;
}) {
  const [username, setUsername] = useState(
    profile.callsign.startsWith('SHIFT-') ? '' : profile.callsign
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash.includes('id_token=')) return;
    const rawHash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(rawHash);
    const idToken = params.get('id_token');
    const oauthErr = params.get('error');
    if (!idToken && !oauthErr) return;

    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const payload = {
      type: 'smokebreak-google-oauth',
      idToken: idToken ?? undefined,
      error: oauthErr ?? undefined,
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('smokebreak-oauth');
      ch.postMessage(payload);
      ch.close();
    }
    if (window.opener) {
      try {
        window.opener.postMessage(payload, window.location.origin);
      } catch {
        // Ignore cross-origin opener errors
      }
      window.close();
      return;
    }

    if (idToken && onLoginOAuth) {
      setBusy(true);
      onLoginOAuth('google', idToken)
        .then(() => {
          setBusy(false);
          onCompleteLogin();
        })
        .catch(err => {
          setError(err instanceof Error ? err.message : 'Google Sign-In failed');
          setBusy(false);
        });
    }
  }, [onLoginOAuth, onCompleteLogin]);

  const finishLogin = async (chosenHandle?: string) => {
    setError(null);
    const clean = (chosenHandle ?? username).trim().toUpperCase();
    if (password.trim().length > 0 && onLoginPassword) {
      const targetCallsign = clean || profile.callsign;
      if (!/^[A-Za-z0-9 _-]{2,16}$/.test(targetCallsign)) {
        setError('Username must be 2–16 characters (letters, numbers, - or _)');
        return;
      }
      setBusy(true);
      try {
        await onLoginPassword(targetCallsign, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
        setBusy(false);
        return;
      }
      setBusy(false);
      onCompleteLogin();
      return;
    }

    if (clean && clean !== profile.callsign) {
      if (!/^[A-Za-z0-9 _-]{2,16}$/.test(clean)) {
        setError('Username must be 2–16 characters (letters, numbers, - or _)');
        return;
      }
      setBusy(true);
      try {
        await onSaveCallsign(clean);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onCompleteLogin();
  };

  const handleOAuthClick = async (provider: 'apple' | 'google') => {
    setError(null);
    const appleClientId =
      typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_APPLE_CLIENT_ID as string | undefined) : undefined;
    const googleClientId =
      typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) : undefined;

    if (provider === 'apple' && !appleClientId) {
      setError('Apple Sign-In requires VITE_APPLE_CLIENT_ID (run ./scripts/setup-oauth-wizard.sh).');
      return;
    }
    if (provider === 'google' && !googleClientId) {
      setError('Google Sign-In requires VITE_GOOGLE_CLIENT_ID (run ./scripts/setup-oauth-wizard.sh).');
      return;
    }
    if (!onLoginOAuth) {
      await finishLogin(username || undefined);
      return;
    }

    setBusy(true);
    try {
      if (provider === 'apple') {
        const { idToken, suggestedName } = await requestAppleIdToken(appleClientId!);
        await onLoginOAuth('apple', idToken, username.trim() || suggestedName);
      } else {
        const idToken = await requestGoogleIdTokenPopup(googleClientId!);
        await onLoginOAuth('google', idToken, username.trim() || undefined);
      }
      setBusy(false);
      onCompleteLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${provider} sign-in failed`);
      setBusy(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void finishLogin();
  };

  return (
    <div
      className="proto-overlay proto-variant-a"
      onPointerDown={e => e.stopPropagation()}
      role="dialog"
      aria-label="Sign in to Smoke Break"
    >
      <div className="proto-a-card hud-panel">
        <div className="proto-step-indicator">
          <span className="active">1. SIGN IN</span>
          <span>→</span>
          <span>2. GAME MODE</span>
          <span>→</span>
          <span>3. MAP / LOBBY</span>
          <span>→</span>
          <span>4. SHIFT</span>
        </div>

        <div className="proto-login-header">
          <span className="eyebrow">idleMullet Universal Account · Web &amp; iOS</span>
          <h2>Sign in to clock your shifts</h2>
          <p className="proto-sub">
            Sync your campaign sectors, head-to-head rating, and lifetime butts across web and mobile.
          </p>
        </div>

        <div className="proto-sso-stack">
          <button
            type="button"
            className="proto-sso-btn apple"
            disabled={busy}
            onClick={() => void handleOAuthClick('apple')}
          >
            <span></span> Continue with Apple
          </button>
          <button
            type="button"
            className="proto-sso-btn google"
            disabled={busy}
            onClick={() => void handleOAuthClick('google')}
          >
            <span>G</span> Continue with Google
          </button>
        </div>

        <div className="proto-divider">
          <span>OR SIGN IN WITH CALLSIGN / EMAIL</span>
        </div>

        <form className="proto-login-form" onSubmit={handleSubmit}>
          <label className="proto-field-label">
            <span>USERNAME OR CALLSIGN</span>
            <input
              type="text"
              aria-label="Login callsign"
              value={username}
              maxLength={16}
              onChange={e => setUsername(e.target.value.toUpperCase())}
              placeholder={profile.callsign}
            />
          </label>
          <label className="proto-field-label">
            <span>PASSWORD</span>
            <input
              type="password"
              aria-label="Login password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          {error && (
            <span className="proto-error" role="alert">
              {error}
            </span>
          )}
          <button type="submit" className="ship proto-cta-primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign In & Choose Game Mode →'}
          </button>
        </form>

        <div className="proto-login-footer">
          <button type="button" className="proto-link-btn" onClick={onCompleteLogin}>
            Continue as Guest ({profile.callsign}) →
          </button>
        </div>
      </div>
    </div>
  );
}

function GameModeDeck({
  profile,
  currentEnv,
  unlockedEnvironments,
  leaderboardEntries,
  onSelectEnvironment,
  onSelectMode,
  onBackToLogin,
}: {
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  leaderboardEntries: readonly LeaderboardEntry[];
  onSelectEnvironment: (id: EnvironmentId) => void;
  onSelectMode: (mode: GameModeId) => void;
  onBackToLogin: () => void;
}) {
  const nextLocked = ENVIRONMENTS.find(e => !unlockedEnvironments.includes(e.id));
  const rivals = resolveRivalList(leaderboardEntries);
  const topRival = rivals[0];

  return (
    <div
      className="proto-overlay proto-modes-screen"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Select Game Mode"
    >
      <div className="proto-map-shell hud-panel">
        <header className="proto-map-topbar">
          <div>
            <div className="proto-step-indicator">
              <button type="button" className="proto-link-btn" onClick={onBackToLogin}>
                ✓ 1. SIGNED IN ({profile.callsign})
              </button>
              <span>→</span>
              <span className="active">2. SELECT GAME MODE</span>
              <span>→</span>
              <span>3. MAP / LOBBY</span>
              <span>→</span>
              <span>4. SHIFT</span>
            </div>
            <h2>Select How You Want to Smoke</h2>
          </div>
          <div className="proto-map-user-pill">
            <span className="status-dot" />
            <span>{profile.callsign}</span>
            <small>· {profile.lifetimeSmoked} butts</small>
            <small className="proto-sync-tag">· {unlockedEnvironments.length}/4 Spots</small>
          </div>
        </header>

        <div className="proto-modes-three-col">
          <article className="proto-mode-card featured">
            <div
              className="proto-mode-banner"
              style={{ backgroundImage: `url(${currentEnv.image})` }}
            >
              <span className="proto-pill-tag">CAMPAIGN</span>
              <span className="proto-chip">{unlockedEnvironments.length}/4 UNLOCKED</span>
            </div>
            <div className="proto-mode-body">
              <h3>Campaign · Sector Map</h3>
              <p className="proto-sub">
                Travel across the facility blueprint map. Hit butt quotas in each sector to unlock riskier smoke spots.
              </p>
              <div className="proto-mode-meta-box">
                <span>NEXT MAP UNLOCK</span>
                <strong>
                  {nextLocked
                    ? `${nextLocked.name} (${profile.lifetimeSmoked}/${nextLocked.unlockSmokedRequired} butts)`
                    : 'All 4 Sectors Unlocked ★'}
                </strong>
              </div>
              <button
                type="button"
                className="ship proto-cta-primary"
                onClick={() => onSelectMode('campaign')}
              >
                Open Sector Map →
              </button>
            </div>
          </article>

          <article className="proto-mode-card">
            <div className="proto-mode-banner h2h-banner">
              <span className="proto-chip">PVP VERSUS</span>
              <span className="proto-valid">● 1v1 DUEL</span>
            </div>
            <div className="proto-mode-body">
              <h3>Head-to-Head</h3>
              <p className="proto-sub">
                Face off against another employee in a 15-second cadence duel. Beat your rival's butt count before time expires.
              </p>
              <div className="proto-mode-meta-box">
                <span>CURRENT FLOOR RIVAL</span>
                <strong>
                  {topRival.callsign} · {topRival.smoked} butts
                </strong>
              </div>
              <button
                type="button"
                className="ship proto-cta-primary"
                onClick={() => onSelectMode('h2h')}
              >
                Matchmake 1v1 Duel →
              </button>
            </div>
          </article>

          <article className="proto-mode-card">
            <div className="proto-mode-banner sandbox-banner">
              <span className="proto-chip">CLASSIC</span>
              <span className="proto-id-hint">INSTANT SHIFT</span>
            </div>
            <div className="proto-mode-body">
              <h3>Sandbox · Free Break</h3>
              <p className="proto-sub">
                The traditional smoke break simulator. Pick any unlocked spot below and jump straight into the 3D scene.
              </p>
              <div className="proto-a-spot-pills">
                {ENVIRONMENTS.map(spot => {
                  const unlocked = unlockedEnvironments.includes(spot.id);
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      disabled={!unlocked}
                      className={`proto-spot-pill ${spot.id === currentEnv.id ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                      onClick={() => onSelectEnvironment(spot.id)}
                    >
                      <span>{unlocked ? spot.name : `🔒 ${spot.name}`}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="ship proto-cta-primary"
                onClick={() => onSelectMode('sandbox')}
              >
                Quick Smoke ({currentEnv.name}) →
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

function CampaignSectorMap({
  profile,
  currentEnv,
  unlockedEnvironments,
  leaderboardEntries,
  onSelectEnvironment,
  onBackToModes,
  onStartShift,
}: {
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  leaderboardEntries: readonly LeaderboardEntry[];
  onSelectEnvironment: (id: EnvironmentId) => void;
  onBackToModes: () => void;
  onStartShift: () => void;
}) {
  return (
    <div
      className="proto-overlay proto-variant-a-map"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Campaign Sector Map"
    >
      <div className="proto-map-shell hud-panel">
        <header className="proto-map-topbar">
          <div>
            <div className="proto-step-indicator">
              <span>✓ 1. SIGNED IN</span>
              <span>→</span>
              <button type="button" className="proto-link-btn" onClick={onBackToModes}>
                ✓ 2. MODE: CAMPAIGN (CHANGE)
              </button>
              <span>→</span>
              <span className="active">3. SELECT SECTOR ON MAP</span>
              <span>→</span>
              <span>4. SHIFT</span>
            </div>
            <h2>Campaign Map · Select Your Break Sector</h2>
          </div>
          <div className="proto-map-user-pill">
            <span className="status-dot" />
            <span>{profile.callsign}</span>
            <small>· {profile.lifetimeSmoked} lifetime butts</small>
          </div>
        </header>

        <div className="proto-map-layout">
          <div className="proto-blueprint-canvas">
            <div
              className="proto-blueprint-bg"
              style={{ backgroundImage: `url(${currentEnv.image})` }}
            />
            <div className="proto-blueprint-grid-overlay" />

            <svg className="proto-map-paths" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                points="22,68 46,38 68,62 82,28"
                fill="none"
                stroke="rgba(132, 204, 22, 0.45)"
                strokeWidth="0.8"
                strokeDasharray="2 2"
              />
            </svg>

            {ENVIRONMENTS.map((spot, idx) => {
              const unlocked = unlockedEnvironments.includes(spot.id);
              const selected = spot.id === currentEnv.id;
              const coords = MAP_COORDS[spot.id];
              return (
                <button
                  key={spot.id}
                  type="button"
                  style={{ left: coords.x, top: coords.y }}
                  className={`proto-map-pin ${selected ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`}
                  onClick={() => {
                    if (unlocked) onSelectEnvironment(spot.id);
                  }}
                >
                  <span className="proto-pin-code">{coords.code}</span>
                  <span className="proto-pin-dot">{unlocked ? idx + 1 : '🔒'}</span>
                  <strong className="proto-pin-title">{spot.name}</strong>
                  <small className="proto-pin-sub">
                    {unlocked ? spot.risk : `Unlock at ${spot.unlockSmokedRequired} butts`}
                  </small>
                </button>
              );
            })}
          </div>

          <aside className="proto-map-inspector">
            <div
              className="proto-inspector-preview"
              style={{ backgroundImage: `url(${currentEnv.image})` }}
            >
              <span className="proto-chip">{currentEnv.sector}</span>
            </div>

            <div className="proto-inspector-body">
              <h3>{currentEnv.name}</h3>
              <p className="proto-sub">
                {currentEnv.vibe} · {currentEnv.weather}
              </p>

              <div className="proto-a-stats-row">
                <div>
                  <span>RISK LEVEL</span>
                  <strong>{currentEnv.risk}</strong>
                </div>
                <div>
                  <span>YOUR BEST</span>
                  <strong>{profile.bestSmoked} butts</strong>
                </div>
                <div>
                  <span>SHIFT CLOCK</span>
                  <strong>15.0s</strong>
                </div>
              </div>

              <div className="proto-mini-board">
                <span className="eyebrow">SECTOR LEADERBOARD TOP 3</span>
                <ol className="leaderboard-list">
                  {leaderboardEntries.slice(0, 3).map(entry => (
                    <li key={`${entry.rank}-${entry.callsign}`} className="leaderboard-row">
                      <span className="leaderboard-rank">#{entry.rank}</span>
                      <span className="leaderboard-callsign">{entry.callsign}</span>
                      <span className="leaderboard-score">{entry.smoked} butts</span>
                    </li>
                  ))}
                </ol>
              </div>

              <button type="button" className="ship proto-cta-primary" onClick={onStartShift}>
                Deploy to {currentEnv.name} (Start 15s Shift) →
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function HeadToHeadLobby({
  profile,
  currentEnv,
  leaderboardEntries,
  selectedRival,
  onSelectRival,
  onBackToModes,
  onStartShift,
}: {
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  leaderboardEntries: readonly LeaderboardEntry[];
  selectedRival: RivalOpponent | null;
  onSelectRival: (rival: RivalOpponent) => void;
  onBackToModes: () => void;
  onStartShift: () => void;
}) {
  const rivals = resolveRivalList(leaderboardEntries);
  const activeRival = selectedRival ?? rivals[0];

  return (
    <div
      className="proto-overlay proto-variant-a"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Head-to-Head Matchmaking Lobby"
    >
      <div className="proto-h2h-shell hud-panel">
        <div className="proto-step-indicator">
          <span>✓ 1. SIGNED IN</span>
          <span>→</span>
          <button type="button" className="proto-link-btn" onClick={onBackToModes}>
            ✓ 2. MODE: HEAD-TO-HEAD (CHANGE)
          </button>
          <span>→</span>
          <span className="active">3. 1v1 MATCHUP</span>
          <span>→</span>
          <span>4. DUEL SHIFT</span>
        </div>

        <div className="proto-h2h-vs-banner">
          <div className="proto-fighter-card">
            <span className="eyebrow">CHALLENGER (YOU)</span>
            <strong>{profile.callsign}</strong>
            <small>Personal Best: {profile.bestSmoked} butts</small>
          </div>
          <div className="proto-vs-badge">VS</div>
          <div className="proto-fighter-card rival">
            <span className="eyebrow">OPPONENT</span>
            <strong>{activeRival.callsign}</strong>
            <small>Target Pace: {activeRival.smoked} butts / 15s</small>
          </div>
        </div>

        <div className="proto-h2h-rival-picker">
          <span className="eyebrow">PICK FLOOR RIVAL OR AUTO-MATCH</span>
          <div className="proto-a-spot-pills">
            {rivals.map(r => (
              <button
                key={`${r.rank}-${r.callsign}`}
                type="button"
                className={`proto-spot-pill ${activeRival.callsign === r.callsign ? 'active' : ''}`}
                onClick={() => onSelectRival(r)}
              >
                <span>
                  #{r.rank} {r.callsign}
                </span>
                <small>{r.smoked} butts</small>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="ship proto-cta-primary"
          onClick={() => {
            if (!selectedRival) {
              onSelectRival(activeRival);
            }
            onStartShift();
          }}
        >
          Start 1v1 Duel vs {activeRival.callsign} in {currentEnv.name} →
        </button>
      </div>
    </div>
  );
}

export function SmokeBreakLobby(props: SmokeBreakLobbyProps) {
  if (props.step === 'login') {
    return (
      <LoginScreen
        profile={props.profile}
        onSaveCallsign={props.onSaveCallsign}
        onLoginPassword={props.onLoginPassword}
        onLoginOAuth={props.onLoginOAuth}
        onCompleteLogin={props.onCompleteLogin}
      />
    );
  }

  if (props.step === 'modes') {
    return (
      <GameModeDeck
        profile={props.profile}
        currentEnv={props.currentEnv}
        unlockedEnvironments={props.unlockedEnvironments}
        leaderboardEntries={props.leaderboardEntries}
        onSelectEnvironment={props.onSelectEnvironment}
        onSelectMode={props.onSelectMode}
        onBackToLogin={() => props.onSetStep('login')}
      />
    );
  }

  if (props.step === 'h2h') {
    return (
      <HeadToHeadLobby
        profile={props.profile}
        currentEnv={props.currentEnv}
        leaderboardEntries={props.leaderboardEntries}
        selectedRival={props.selectedRival}
        onSelectRival={props.onSelectRival}
        onBackToModes={() => props.onSetStep('modes')}
        onStartShift={props.onStartShift}
      />
    );
  }

  return (
    <CampaignSectorMap
      profile={props.profile}
      currentEnv={props.currentEnv}
      unlockedEnvironments={props.unlockedEnvironments}
      leaderboardEntries={props.leaderboardEntries}
      onSelectEnvironment={props.onSelectEnvironment}
      onBackToModes={() => props.onSetStep('modes')}
      onStartShift={props.onStartShift}
    />
  );
}

