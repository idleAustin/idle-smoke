// Account recovery panel (Email Link, Callsign Recovery Code, Active Browser) and OAuth/recovery badge helpers for LobbyLoginScreen.

import { useState, type FormEvent } from 'react';
import { type PlayerProfile } from './shiftStorage';

export function OAuthIcon({ provider }: { provider: 'apple' | 'google' }) {
  if (provider === 'apple') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
      </svg>
    );
  }
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      <path d="M21 12.2c0-.7-.06-1.35-.18-2H12v3.8h5.06a4.33 4.33 0 0 1-1.88 2.85v2.35h3.04C20 17.55 21 15.1 21 12.2z" />
      <path d="M12 21c2.52 0 4.64-.83 6.18-2.25l-3.04-2.35c-.84.56-1.91.9-3.14.9-2.41 0-4.45-1.63-5.18-3.82H3.68v2.43A9 9 0 0 0 12 21z" />
      <path d="M6.82 13.48a5.42 5.42 0 0 1 0-3.46V7.59H3.68a9 9 0 0 0 0 8.32l3.14-2.43z" />
      <path d="M12 6.7c1.37 0 2.6.47 3.57 1.4l2.67-2.67C16.63 3.92 14.52 3 12 3a9 9 0 0 0-8.32 4.59l3.14 2.43C7.55 8.33 9.59 6.7 12 6.7z" />
    </svg>
  );
}

export function RecoveryCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="proto-recovery-code-row">
      <code className="proto-recovery-code">{code}</code>
      <button type="button" className="proto-copy-code-btn" onClick={handleCopy}>
        {copied ? 'Copied ✓' : 'Copy Code'}
      </button>
    </div>
  );
}

export function ForgotPasswordPanel({
  profile,
  initialIdentifier,
  onBack,
}: {
  profile: PlayerProfile;
  initialIdentifier: string;
  onBack: () => void;
}) {
  const [method, setMethod] = useState<'email' | 'code' | 'browser'>('email');
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [codeInput, setCodeInput] = useState('');
  const [newPass, setNewPass] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const handleRecoverySubmit = (event: FormEvent) => {
    event.preventDefault();
    if (method === 'email') {
      if (!identifier.includes('@')) {
        setNotice('Enter the email address linked to your account, or switch to Recovery Code / Active Browser.');
        return;
      }
      setNotice(`Reset link dispatched to ${identifier.trim().toLowerCase()}. Check your inbox.`);
      return;
    }
    if (method === 'code') {
      if (!identifier.trim() || !codeInput.trim() || newPass.trim().length < 4) {
        setNotice('Enter your Callsign, saved Recovery Code (RK-XXXX-XXXX), and a new 4+ char password.');
        return;
      }
      setNotice(`Recovery code verified for ${identifier.trim().toUpperCase()}. Password updated.`);
      return;
    }
    if (newPass.trim().length < 4) {
      setNotice('Enter a new password of at least 4 characters.');
      return;
    }
    setNotice(`Active browser token verified for ${profile.callsign}. Password reset complete.`);
  };

  return (
    <div className="proto-forgot-panel" role="region" aria-label="Account password recovery">
      <div className="proto-forgot-head">
        <div>
          <span className="eyebrow">ACCOUNT RECOVERY</span>
          <h3>Reset forgotten password</h3>
        </div>
        <button type="button" className="proto-link-btn" onClick={onBack}>← Back to Sign In</button>
      </div>

      <div className="proto-recovery-tabs" role="tablist" aria-label="Recovery method">
        <button
          type="button" role="tab" aria-selected={method === 'email'}
          className={`proto-auth-tab${method === 'email' ? ' active' : ''}`}
          onClick={() => { setMethod('email'); setNotice(null); }}
        >
          1. Email Link
        </button>
        <button
          type="button" role="tab" aria-selected={method === 'code'}
          className={`proto-auth-tab${method === 'code' ? ' active' : ''}`}
          onClick={() => { setMethod('code'); setNotice(null); }}
        >
          2. Recovery Code
        </button>
        <button
          type="button" role="tab" aria-selected={method === 'browser'}
          className={`proto-auth-tab${method === 'browser' ? ' active' : ''}`}
          onClick={() => { setMethod('browser'); setNotice(null); }}
        >
          3. Active Browser
        </button>
      </div>

      <form className="proto-login-form" onSubmit={handleRecoverySubmit}>
        {method === 'email' && (
          <>
            <p className="proto-sub">
              Guaranteed recovery. We&apos;ll send a one-time reset link to your verified email address.
            </p>
            <label className="proto-field-label">
              <span>ACCOUNT EMAIL ADDRESS</span>
              <input
                type="email" value={identifier} onChange={e => setIdentifier(e.target.value)}
                placeholder="you@email.com"
              />
            </label>
          </>
        )}

        {method === 'code' && (
          <>
            <p className="proto-sub">
              For Callsign-only accounts. Enter the backup code (`RK-XXXX-XXXX`) saved when you registered.
            </p>
            <label className="proto-field-label">
              <span>CALLSIGN</span>
              <input
                type="text" value={identifier} onChange={e => setIdentifier(e.target.value)}
                placeholder={profile.callsign}
              />
            </label>
            <label className="proto-field-label">
              <span>SAVED RECOVERY CODE</span>
              <input
                type="text" value={codeInput} onChange={e => setCodeInput(e.target.value)}
                placeholder="RK-84CC-16A0"
              />
            </label>
            <label className="proto-field-label">
              <span>NEW PASSWORD (4+ CHARS)</span>
              <input
                type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </>
        )}

        {method === 'browser' && (
          <>
            <div className="proto-callsign-caveat">
              <strong>ORIGINAL BROWSER SESSION ONLY</strong>
              <p>
                This browser currently holds an active session for <b>{profile.callsign}</b>. Outside this browser—without an email or recovery code—account recovery cannot be guaranteed.
              </p>
            </div>
            <label className="proto-field-label">
              <span>NEW PASSWORD FOR {profile.callsign}</span>
              <input
                type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          </>
        )}

        {notice && <span className="proto-valid" role="status">{notice}</span>}

        <button type="submit" className="ship proto-cta-primary">
          {method === 'email' ? 'Send Password Reset Link →' : 'Verify & Set New Password →'}
        </button>
      </form>
    </div>
  );
}
