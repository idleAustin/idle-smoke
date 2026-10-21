// Universal account sign-in screen supporting Apple ID, Google OAuth popup flow, email-first / callsign-only password auth, and account recovery.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ForgotPasswordPanel, OAuthIcon, RecoveryCodeBadge,
  buildDemoRecoveryCode, generateRandomCallsign,
} from './LobbyLoginRecoveryPanel';
import { type PlayerProfile } from './shiftStorage';

interface AppleAuthWindow extends Window {
  AppleID?: {
    auth: {
      init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
      signIn: () => Promise<{
        authorization?: { id_token?: string };
        user?: { name?: { firstName?: string; lastName?: string } };
      }>;
    };
  };
}

function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = Object.assign(document.createElement('script'), { src, async: true });
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function requestAppleIdToken(clientId: string): Promise<{ idToken: string; suggestedName?: string }> {
  await loadExternalScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  const win = window as AppleAuthWindow;
  if (!win.AppleID?.auth) throw new Error('Apple Sign-In SDK unavailable');
  const normalizedPath = window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
  const redirectURI =
    window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
      ? 'https://idle-smoke-staging.idleaustin.workers.dev/idle-smoke/'
      : `${window.location.origin}${normalizedPath}`;
  win.AppleID.auth.init({ clientId, scope: 'name email', redirectURI, usePopup: true });
  const response = await win.AppleID.auth.signIn();
  const idToken = response?.authorization?.id_token;
  if (!idToken) throw new Error('Apple Sign-In did not return an ID token');
  return { idToken, suggestedName: response?.user?.name?.firstName || undefined };
}

function requestGoogleIdTokenPopup(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const normalizedOrigin =
      window.location.hostname === 'localhost'
        ? `${window.location.protocol}//127.0.0.1:${window.location.port}`
        : window.location.origin;
    const normalizedPath = window.location.pathname.startsWith('/idle-smoke')
      ? '/idle-smoke/'
      : window.location.pathname.endsWith('/') ? window.location.pathname : `${window.location.pathname}/`;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', `${normalizedOrigin}${normalizedPath}`);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('nonce', globalThis.crypto.randomUUID());
    authUrl.searchParams.set('prompt', 'select_account');

    let settled = false;
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('smokebreak-oauth') : null;
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
      if (data?.type === 'smokebreak-google-oauth') finish(data.idToken ?? null, data.error ?? null);
    };

    window.addEventListener('message', onMessage);
    if (channel) {
      channel.onmessage = event => {
        const data = event.data as { type?: string; idToken?: string; error?: string } | null;
        if (data?.type === 'smokebreak-google-oauth') finish(data.idToken ?? null, data.error ?? null);
      };
    }

    const popup = window.open(authUrl.toString(), 'smokebreak-google-oauth', 'width=500,height=640');
    if (!popup) { finish(null, 'Google Sign-In popup was blocked by the browser'); return; }

    const timer = window.setInterval(() => {
      try {
        if (popup.location.origin === window.location.origin) {
          const params = new URLSearchParams(popup.location.hash.replace(/^#/, ''));
          const idToken = params.get('id_token');
          const err = params.get('error');
          if (idToken || err) { popup.close(); finish(idToken, err ? `Google Sign-In error: ${err}` : null); }
        }
      } catch { /* cross-origin while user is on accounts.google.com */ }
    }, 250);
  });
}

export function LoginScreen({
  profile, statusBanner, onDismissBanner, onSaveCallsign,
  onLoginPassword, onLoginOAuth, onCompleteLogin,
}: {
  profile: PlayerProfile;
  statusBanner?: string | null;
  onDismissBanner?: () => void;
  onSaveCallsign: (nextCallsign: string) => Promise<void>;
  onLoginPassword?: (callsign: string, password: string, mode?: 'login' | 'register') => Promise<void>;
  onLoginOAuth?: (provider: 'apple' | 'google', idToken: string, callsign?: string) => Promise<void>;
  onCompleteLogin: () => void;
}) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(profile.callsign.startsWith('SHIFT-') ? '' : profile.callsign);
  const [password, setPassword] = useState('');
  const [callsignOnly, setCallsignOnly] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [showOfflineOption, setShowOfflineOption] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recoveryCode = useMemo(() => buildDemoRecoveryCode(username || profile.callsign), [username, profile.callsign]);
  const showCallsignCaveat = callsignOnly || (Boolean(username.trim()) && !username.includes('@'));
  const isRegisterCallsignMode = authMode === 'register' && showCallsignCaveat;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.hash.includes('id_token=')) return;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const idToken = params.get('id_token');
    const oauthErr = params.get('error');
    if (!idToken && !oauthErr) return;

    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const payload = { type: 'smokebreak-google-oauth', idToken: idToken ?? undefined, error: oauthErr ?? undefined };
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('smokebreak-oauth');
      ch.postMessage(payload);
      ch.close();
    }
    if (window.opener) {
      try { window.opener.postMessage(payload, window.location.origin); } catch { /* cross-origin */ }
      window.close();
      return;
    }
    if (idToken && onLoginOAuth) {
      setBusy(true);
      onLoginOAuth('google', idToken)
        .then(() => { setBusy(false); onCompleteLogin(); })
        .catch(err => { setError(err instanceof Error ? err.message : 'Google Sign-In failed'); setBusy(false); });
    }
  }, [onLoginOAuth, onCompleteLogin]);

  const finishLogin = async (chosenHandle?: string) => {
    setError(null);
    const rawTrimmed = (chosenHandle ?? username).trim();
    const isEmail = rawTrimmed.includes('@');
    const clean = isEmail ? rawTrimmed.toLowerCase() : rawTrimmed.toUpperCase();

    if (onLoginPassword) {
      if (!clean) {
        setError(authMode === 'register' ? 'Choose a callsign or enter your email address to create an account' : 'Enter your callsign or email address to sign in');
        return;
      }
      if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) { setError('Enter a valid email address'); return; }
      if (!isEmail && !/^[A-Za-z0-9 _-]{2,16}$/.test(clean)) { setError('Callsign must be 2–16 characters (letters, numbers, - or _)'); return; }
      if (password.trim().length < 4) {
        setError(authMode === 'register' ? 'Create a password of at least 4 characters' : 'Enter your password (4+ characters) to sign in');
        return;
      }
      setBusy(true);
      try { await onLoginPassword(clean, password, authMode); } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setBusy(false);
        return;
      }
      setBusy(false);
      onCompleteLogin();
      return;
    }

    if (clean && clean !== profile.callsign) {
      if (!/^[A-Za-z0-9 _-]{2,16}$/.test(clean)) { setError('Callsign must be 2–16 characters (letters, numbers, - or _)'); return; }
      setBusy(true);
      try { await onSaveCallsign(clean); } catch (err) {
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
    const appleClientId = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_APPLE_CLIENT_ID as string | undefined) : undefined;
    const googleClientId = typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) : undefined;

    if (provider === 'apple' && !appleClientId) { setError('Apple Sign-In requires VITE_APPLE_CLIENT_ID (run ./scripts/setup-oauth-wizard.sh).'); return; }
    if (provider === 'google' && !googleClientId) { setError('Google Sign-In requires VITE_GOOGLE_CLIENT_ID (run ./scripts/setup-oauth-wizard.sh).'); return; }
    if (!onLoginOAuth) { await finishLogin(username || undefined); return; }

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

  const handleToggleCallsignMode = () => {
    setError(null);
    if (showCallsignCaveat) {
      setCallsignOnly(false);
      if (!username.includes('@')) setUsername('');
    } else {
      setCallsignOnly(true);
      setUsername(generateRandomCallsign(username));
    }
  };

  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void finishLogin(); };

  return (
    <div
      className="proto-overlay proto-login-backdrop"
      onPointerDown={e => e.stopPropagation()}
      role="dialog"
      aria-label="Sign in to Smoke Break"
    >
      <section className="proto-b-sheet hud-panel">
        <div className="proto-login-header">
          <h2>Take fifteen.</h2>
          <p className="proto-sub">
            Authenticate with Apple, Google, or your email address to clock verified shifts.
          </p>
        </div>

        {statusBanner && (
          <div className="proto-acct-toast" role="status">
            <span>{statusBanner}</span>
            {onDismissBanner && <button type="button" className="proto-link-btn" onClick={onDismissBanner}>Dismiss</button>}
          </div>
        )}

        {forgotOpen ? (
          <ForgotPasswordPanel profile={profile} initialIdentifier={username} onBack={() => setForgotOpen(false)} />
        ) : (
          <>
            <div className="proto-b-sso-grid">
              <button type="button" className="proto-sso-btn apple" disabled={busy} onClick={() => void handleOAuthClick('apple')}>
                <OAuthIcon provider="apple" /> Apple
              </button>
              <button type="button" className="proto-sso-btn google" disabled={busy} onClick={() => void handleOAuthClick('google')}>
                <OAuthIcon provider="google" /> Google
              </button>
            </div>

            <div className="proto-divider"><span>OR EMAIL &amp; PASSWORD</span></div>

            <div className="proto-b-drawer">
              <div className="proto-auth-tabs" role="tablist" aria-label="Account authentication mode">
                <button
                  type="button" role="tab" aria-selected={authMode === 'login'}
                  className={`proto-auth-tab${authMode === 'login' ? ' active' : ''}`}
                  onClick={() => { setAuthMode('login'); setError(null); }}
                >
                  Returning · Sign In
                </button>
                <button
                  type="button" role="tab" aria-selected={authMode === 'register'}
                  className={`proto-auth-tab${authMode === 'register' ? ' active' : ''}`}
                  onClick={() => { setAuthMode('register'); setError(null); }}
                >
                  New Hire · Create Account
                </button>
              </div>

              <form className="proto-login-form" onSubmit={handleSubmit}>
                <label className="proto-field-label">
                  <div className="proto-label-row">
                    <span>
                      {authMode === 'login'
                        ? 'EMAIL ADDRESS OR CALLSIGN'
                        : showCallsignCaveat
                          ? 'CALLSIGN ONLY (NO EMAIL)'
                          : 'EMAIL ADDRESS (GUARANTEED RECOVERY)'}
                    </span>
                    {authMode === 'register' && (
                      <button type="button" className="proto-inline-switch-btn" onClick={handleToggleCallsignMode}>
                        {showCallsignCaveat ? 'Use Email Instead (Recommended)' : 'Prefer Callsign-only (no email)?'}
                      </button>
                    )}
                  </div>
                  <div className="proto-callsign-input-row">
                    <input
                      type="text" aria-label="Login callsign" value={username} maxLength={120}
                      onChange={e => setUsername(e.target.value)}
                      placeholder={
                        authMode === 'login'
                          ? 'you@email.com or ASH-KING'
                          : showCallsignCaveat
                            ? 'ASH-LYNX-42'
                            : 'you@email.com'
                      }
                    />
                    {isRegisterCallsignMode && (
                      <button
                        type="button" className="proto-randomize-btn"
                        onClick={() => { setUsername(generateRandomCallsign(username)); setError(null); }}
                      >
                        ↻ Randomize
                      </button>
                    )}
                  </div>
                </label>

                {isRegisterCallsignMode && (
                  <div className="proto-callsign-caveat" role="note">
                    <strong>NO EMAIL · RECOVERY NOT GUARANTEED</strong>
                    <p>
                      If you lose this recovery code and are not on your original browser, we cannot guarantee you&apos;ll be able to log back in.
                    </p>
                    <RecoveryCodeBadge code={recoveryCode} />
                  </div>
                )}

                <label className="proto-field-label">
                  <div className="proto-label-row">
                    <span>{authMode === 'register' ? 'CREATE PASSWORD (4+ CHARS)' : 'PASSWORD'}</span>
                    {authMode === 'login' && (
                      <button type="button" className="proto-inline-switch-btn" onClick={() => setForgotOpen(true)}>
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password" aria-label="Login password" value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  />
                </label>
                {error && <span className="proto-error" role="alert">{error}</span>}
                <button type="submit" className="ship proto-cta-primary" disabled={busy}>
                  {busy
                    ? authMode === 'register' ? 'Creating account...' : 'Signing in...'
                    : authMode === 'register' ? 'Create Account & Choose Game Mode →' : 'Sign In & Choose Game Mode →'}
                </button>
              </form>
            </div>
          </>
        )}

        <div className="proto-d-subfooter">
          <button
            type="button" className="proto-guest-muted-link"
            aria-expanded={showOfflineOption} onClick={() => setShowOfflineOption(prev => !prev)}
          >
            <span>Need a temporary offline badge?</span>
            <span aria-hidden="true">{showOfflineOption ? '▴' : '▾'}</span>
          </button>
          {showOfflineOption && (
            <div className="proto-d-offline-reveal">
              <small>Temporary badges do not sync progress across devices.</small>
              <button type="button" className="proto-guest-ghost-btn" disabled={busy} onClick={onCompleteLogin}>
                Clock a single unsynced shift as {profile.callsign} →
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
