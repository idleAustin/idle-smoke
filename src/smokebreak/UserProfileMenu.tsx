import { useState, type FormEvent } from 'react';
import { type AuthProviderId, type PlayerProfile } from './shiftClient';

const PROVIDER_DISPLAY: Record<
  AuthProviderId,
  { badge: string; label: string; defaultHint: string }
> = {
  apple: {
    badge: ' Apple ID',
    label: 'Signed in with Apple',
    defaultHint: 'Linked via Apple ID',
  },
  google: {
    badge: 'G Google',
    label: 'Signed in with Google',
    defaultHint: 'Linked via Google Account',
  },
  password: {
    badge: '🔑 Password',
    label: 'Callsign + Password',
    defaultHint: 'PBKDF2-SHA256 verified callsign',
  },
  guest: {
    badge: 'Guest',
    label: 'Local Guest Session',
    defaultHint: 'Not linked to Apple or Google yet',
  },
};

function getInitials(callsign: string): string {
  const clean = callsign.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean.slice(0, 2) || 'SB';
}

/**
 * Far top-right circular user icon that opens Option C (Quick Profile Card Popover),
 * with a button to expand into Option B (Full 2-Tab Account Settings Modal).
 */
export function UserCircleTrigger({
  profile,
  isQuickCardOpen,
  isSettingsModalOpen,
  busy,
  showChangeModeAction,
  onToggleQuickCard,
  onOpenSettingsModal,
  onChangeMode,
  onSignOut,
}: {
  profile: PlayerProfile;
  isQuickCardOpen: boolean;
  isSettingsModalOpen: boolean;
  busy?: boolean;
  showChangeModeAction?: boolean;
  onToggleQuickCard: () => void;
  onOpenSettingsModal: () => void;
  onChangeMode?: () => void;
  onSignOut: () => void;
}) {
  const providerId: AuthProviderId = profile.authProvider ?? 'guest';
  const providerInfo = PROVIDER_DISPLAY[providerId];
  const subtitle = profile.authEmail ?? providerInfo.defaultHint;
  const isOpen = isQuickCardOpen || isSettingsModalOpen;

  return (
    <div className="proto-avatar-anchor" onPointerDown={e => e.stopPropagation()}>
      <button
        type="button"
        className={`proto-user-circle-btn ${isOpen ? 'is-open' : ''}`}
        onClick={onToggleQuickCard}
        aria-expanded={isOpen}
        aria-label={`Open profile card for ${profile.callsign}`}
        title={`${profile.callsign} (${providerInfo.label})`}
      >
        <svg
          className="proto-user-circle-svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span
          className={`proto-user-circle-dot ${providerId === 'guest' ? 'guest' : 'linked'}`}
        />
      </button>

      {isQuickCardOpen && (
        <div
          className="proto-discord-card hud-panel"
          role="dialog"
          aria-label="Quick User Profile Card"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="proto-discord-banner">
            <span className="proto-mobbin-provider-tag">{providerInfo.badge}</span>
          </div>

          <div className="proto-discord-body">
            <div className="proto-discord-avatar-row">
              <div className="proto-discord-avatar">{getInitials(profile.callsign)}</div>
              <button
                type="button"
                className="proto-acct-close-x"
                onClick={onToggleQuickCard}
                aria-label="Close profile card"
              >
                ✕
              </button>
            </div>

            <div className="proto-discord-identity">
              <strong>{profile.callsign}</strong>
              <small>{subtitle}</small>
            </div>

            <div className="proto-mobbin-stats-strip">
              <div>
                <span>BUTTS</span>
                <strong>{profile.lifetimeSmoked}</strong>
              </div>
              <div>
                <span>BEST</span>
                <strong>{profile.bestSmoked}</strong>
              </div>
              <div>
                <span>SHIFTS</span>
                <strong>{profile.shiftsCompleted}</strong>
              </div>
            </div>

            <div className="proto-discord-actions">
              <button
                type="button"
                className="ship proto-acct-open-profile-btn full"
                onClick={onOpenSettingsModal}
              >
                ⚙️ Open Profile &amp; Account Settings →
              </button>
              {showChangeModeAction && onChangeMode && (
                <button
                  type="button"
                  className="proto-acct-btn-secondary full"
                  onClick={() => {
                    onToggleQuickCard();
                    onChangeMode();
                  }}
                >
                  🗺️ Switch Game Mode / Map
                </button>
              )}
              <button
                type="button"
                className="proto-acct-btn-secondary full"
                disabled={busy}
                onClick={onSignOut}
              >
                ⇥ Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Option B: Full 2-Tab Account Settings Modal opened when clicking "Open Profile & Account Settings"
 * from the Option C Quick Profile Card.
 */
export function AccountSettingsModal({
  profile,
  busy,
  error,
  onClose,
  onSaveCallsign,
  onSignOut,
  onDeleteAccount,
}: {
  profile: PlayerProfile;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSaveCallsign?: (nextCallsign: string) => Promise<void>;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'profile' | 'danger'>('profile');
  const [confirmStep, setConfirmStep] = useState(false);
  const [editingCallsign, setEditingCallsign] = useState(false);
  const [callsignDraft, setCallsignDraft] = useState(profile.callsign);
  const [callsignBusy, setCallsignBusy] = useState(false);
  const [callsignError, setCallsignError] = useState<string | null>(null);

  const providerId: AuthProviderId = profile.authProvider ?? 'guest';
  const providerInfo = PROVIDER_DISPLAY[providerId];
  const subtitle = profile.authEmail ?? providerInfo.defaultHint;

  const submitCallsign = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSaveCallsign) return;
    setCallsignError(null);
    setCallsignBusy(true);
    try {
      await onSaveCallsign(callsignDraft.trim().toUpperCase());
      setEditingCallsign(false);
    } catch (err) {
      setCallsignError(err instanceof Error ? err.message : 'Invalid callsign');
    } finally {
      setCallsignBusy(false);
    }
  };

  return (
    <div
      className="proto-overlay proto-acct-modal-backdrop"
      role="dialog"
      aria-label="Account Settings Modal"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="proto-chatgpt-modal hud-panel">
        <header className="proto-chatgpt-head">
          <h3>Profile &amp; Account Settings</h3>
          <button
            type="button"
            className="proto-acct-close-x"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="proto-chatgpt-body">
          <nav className="proto-chatgpt-nav" aria-label="Account settings tabs">
            <button
              type="button"
              className={`proto-chatgpt-tab ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('profile');
                setConfirmStep(false);
              }}
            >
              <span>👤</span> Profile &amp; Session
            </button>
            <button
              type="button"
              className={`proto-chatgpt-tab ${activeTab === 'danger' ? 'active' : ''}`}
              onClick={() => setActiveTab('danger')}
            >
              <span>⚙️</span> Data &amp; Account
            </button>
          </nav>

          <div className="proto-chatgpt-pane">
            {error && (
              <div className="proto-error" role="alert" style={{ marginBottom: 10 }}>
                {error}
              </div>
            )}

            {activeTab === 'profile' ? (
              <div className="proto-chatgpt-section">
                <div className="proto-mobbin-menu-header">
                  <div className="proto-mobbin-avatar-lg">{getInitials(profile.callsign)}</div>
                  <div className="proto-mobbin-user-meta">
                    <div className="proto-mobbin-name-row">
                      <strong>{profile.callsign}</strong>
                      <span className="proto-mobbin-provider-tag">{providerInfo.badge}</span>
                    </div>
                    <small>{subtitle}</small>
                  </div>
                </div>

                {onSaveCallsign && (
                  <div className="proto-chatgpt-row">
                    {!editingCallsign ? (
                      <>
                        <div>
                          <strong>Operator Callsign</strong>
                          <small>Displayed on global and sector leaderboards ({profile.callsign}).</small>
                        </div>
                        <button
                          type="button"
                          className="proto-acct-btn-secondary"
                          onClick={() => {
                            setCallsignDraft(profile.callsign);
                            setCallsignError(null);
                            setEditingCallsign(true);
                          }}
                        >
                          Edit Callsign
                        </button>
                      </>
                    ) : (
                      <form className="callsign-form" onSubmit={submitCallsign} style={{ width: '100%' }}>
                        <input
                          className="callsign-input"
                          type="text"
                          value={callsignDraft}
                          maxLength={16}
                          onChange={e => setCallsignDraft(e.target.value.toUpperCase())}
                          aria-label="Edit operator callsign"
                          disabled={callsignBusy}
                        />
                        <button type="submit" className="callsign-save-btn" disabled={callsignBusy}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="callsign-cancel-btn"
                          disabled={callsignBusy}
                          onClick={() => setEditingCallsign(false)}
                        >
                          Cancel
                        </button>
                        {callsignError && <span className="callsign-error">{callsignError}</span>}
                      </form>
                    )}
                  </div>
                )}

                <div className="proto-chatgpt-row">
                  <div>
                    <strong>Career Progress</strong>
                    <small>
                      {profile.lifetimeSmoked} lifetime butts · Best shift: {profile.bestSmoked}{' '}
                      butts · {profile.shiftsCompleted} shifts
                    </small>
                  </div>
                  <span className="proto-chip">
                    {profile.unlockedEnvironments.length}/4 Spots
                  </span>
                </div>

                <div className="proto-chatgpt-row">
                  <div>
                    <strong>Sign out of this device</strong>
                    <small>Return to the login screen while keeping your cloud account safe.</small>
                  </div>
                  <button
                    type="button"
                    className="proto-acct-btn-secondary"
                    disabled={busy}
                    onClick={onSignOut}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="proto-chatgpt-section">
                <div className="proto-chatgpt-row danger-box">
                  <div>
                    <strong className="danger-text">Delete account</strong>
                    <small>
                      Permanently delete your account ({profile.callsign}), unlink{' '}
                      {providerInfo.badge}, and erase all {profile.shiftsCompleted} shifts from the
                      leaderboard.
                    </small>
                  </div>
                  {!confirmStep && (
                    <button
                      type="button"
                      className="proto-acct-btn-danger-outline"
                      disabled={busy}
                      onClick={() => setConfirmStep(true)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {confirmStep && (
                  <div className="proto-acct-danger-inline">
                    <span className="proto-acct-danger-title">
                      CONFIRM PERMANENT DELETION OF {profile.callsign}
                    </span>
                    <p>
                      This will immediately purge your profile, {providerInfo.badge} login, and all
                      shift records from Cloudflare D1.
                    </p>
                    <div className="proto-acct-danger-btn-row">
                      <button
                        type="button"
                        className="proto-acct-btn-secondary"
                        disabled={busy}
                        onClick={() => setConfirmStep(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="proto-acct-btn-danger-solid"
                        disabled={busy}
                        onClick={onDeleteAccount}
                      >
                        {busy ? 'Deleting...' : 'Yes, Permanently Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
