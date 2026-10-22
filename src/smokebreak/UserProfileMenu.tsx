// Top-right user avatar trigger, quick profile popover card, and account settings modal.

import { useState, type FormEvent } from 'react';
import { AdminTaglinesPanel } from './AdminTaglinesPanel';
import { OperatorAvatar, type OperatorAvatarConfig } from './OperatorAvatar';
import { type AuthProviderId, type PlayerProfile, type TaglineCollection } from './shiftStorage';
import { UserProfilePrototype } from './UserProfilePrototype';

const PROVIDER_DISPLAY: Record<AuthProviderId, { badge: string; label: string; defaultHint: string }> = {
  apple: { badge: 'Apple ID', label: 'Signed in with Apple', defaultHint: 'Linked via Apple ID' },
  google: { badge: 'Google', label: 'Signed in with Google', defaultHint: 'Linked via Google Account' },
  password: { badge: 'Password', label: 'Callsign + Password', defaultHint: 'PBKDF2-SHA256 verified callsign' },
  guest: { badge: 'Guest', label: 'Local Guest Session', defaultHint: 'Not linked to Apple or Google yet' },
};

/**
 * Far top-right circular user icon that opens Option C (Quick Profile Card Popover),
 * with a button to expand into Option B (Full Account Settings Modal).
 */
export function UserCircleTrigger({
  profile, isQuickCardOpen, isSettingsModalOpen, busy,
  showChangeModeAction, onToggleQuickCard, onOpenSettingsModal, onChangeMode, onOpenScoreboard, onSignOut,
}: {
  profile: PlayerProfile;
  isQuickCardOpen: boolean;
  isSettingsModalOpen: boolean;
  busy?: boolean;
  showChangeModeAction?: boolean;
  onToggleQuickCard: () => void;
  onOpenSettingsModal: () => void;
  onChangeMode?: () => void;
  onOpenScoreboard?: () => void;
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
        <OperatorAvatar
          callsign={profile.callsign}
          isAdmin={profile.isAdmin}
          avatarConfig={profile.avatarConfig}
        />
        <span className={`proto-user-circle-dot ${providerId === 'guest' ? 'guest' : 'linked'}`} />
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
              <div className="proto-discord-avatar">
                <OperatorAvatar
                  callsign={profile.callsign}
                  isAdmin={profile.isAdmin}
                  avatarConfig={profile.avatarConfig}
                />
              </div>
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
              <div><span>BUTTS</span><strong>{profile.lifetimeSmoked}</strong></div>
              <div><span>BEST</span><strong>{profile.bestSmoked}</strong></div>
              <div><span>SHIFTS</span><strong>{profile.shiftsCompleted}</strong></div>
            </div>

            <div className="proto-discord-actions">
              <button
                type="button"
                className="ship proto-acct-open-profile-btn full"
                onClick={onOpenSettingsModal}
              >
                Open Profile &amp; Account Settings →
              </button>
              {onOpenScoreboard && (
                <button
                  type="button"
                  className="proto-acct-btn-secondary full"
                  onClick={() => { onToggleQuickCard(); onOpenScoreboard(); }}
                >
                  Global Scoreboard
                </button>
              )}
              {showChangeModeAction && onChangeMode && (
                <button
                  type="button"
                  className="proto-acct-btn-secondary full"
                  onClick={() => { onToggleQuickCard(); onChangeMode(); }}
                >
                  Switch Game Mode / Map
                </button>
              )}
              <button
                type="button"
                className="proto-acct-btn-secondary full"
                disabled={busy}
                onClick={onSignOut}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Full Account Settings Modal opened when clicking "Open Profile & Account Settings"
 * from the Quick Profile Card or via `/?profile=1`.
 */
export function AccountSettingsModal({
  profile, busy, error, onClose, onSaveCallsign, onSaveAvatarConfig,
  onSignOut, onDeleteAccount, onTaglinesUpdated,
}: {
  profile: PlayerProfile;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSaveCallsign?: (nextCallsign: string) => Promise<void>;
  onSaveAvatarConfig?: (avatarConfig: OperatorAvatarConfig | null) => Promise<void> | void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onTaglinesUpdated?: (collection: TaglineCollection) => void;
}) {
  const [activeTab, setActiveTab] = useState<'profile' | 'danger' | 'admin'>('profile');
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

  const callsignHeader = (
    <div className="proto-mobbin-user-meta">
      <div className="proto-mobbin-name-row">
        {!editingCallsign ? (
          onSaveCallsign ? (
            <button
              type="button"
              className="proto-mobbin-callsign-trigger"
              title="Click to edit callsign"
              aria-label={`Edit callsign ${profile.callsign}`}
              onClick={() => {
                setCallsignDraft(profile.callsign);
                setCallsignError(null);
                setEditingCallsign(true);
              }}
            >
              <strong>{profile.callsign}</strong>
              <span className="proto-mobbin-edit-hint" aria-hidden="true">EDIT</span>
            </button>
          ) : (
            <strong>{profile.callsign}</strong>
          )
        ) : (
          <form className="callsign-form" onSubmit={submitCallsign}>
            <input
              className="callsign-input"
              type="text"
              value={callsignDraft}
              maxLength={16}
              autoFocus
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
              onClick={() => {
                setEditingCallsign(false);
                setCallsignError(null);
              }}
            >
              Cancel
            </button>
          </form>
        )}
        <span className="proto-mobbin-provider-tag">{providerInfo.badge}</span>
        {profile.isAdmin && (
          <span
            className="proto-mobbin-provider-tag"
            style={{ borderColor: 'var(--as-accent-primary)', color: 'var(--as-accent-primary)' }}
          >
            ADMIN
          </span>
        )}
      </div>
      {callsignError && <span className="callsign-error">{callsignError}</span>}
      <small>{subtitle}</small>
    </div>
  );

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
              onClick={() => { setActiveTab('profile'); setConfirmStep(false); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Profile &amp; Session
            </button>
            <button
              type="button"
              className={`proto-chatgpt-tab ${activeTab === 'danger' ? 'active' : ''}`}
              onClick={() => setActiveTab('danger')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Data &amp; Account
            </button>
            {profile.isAdmin && (
              <button
                type="button"
                className={`proto-chatgpt-tab ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => setActiveTab('admin')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Admin · Taglines
              </button>
            )}
          </nav>

          <div className="proto-chatgpt-pane">
            {error && (
              <div className="proto-error" role="alert" style={{ marginBottom: 10 }}>
                {error}
              </div>
            )}

            {activeTab === 'profile' && (
              <UserProfilePrototype
                profile={profile}
                busy={busy}
                callsignHeader={callsignHeader}
                onSaveAvatarConfig={onSaveAvatarConfig}
                onSignOut={onSignOut}
              />
            )}

            {activeTab === 'danger' && (
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

            {profile.isAdmin && activeTab === 'admin' && (
              <AdminTaglinesPanel profile={profile} onTaglinesUpdated={onTaglinesUpdated} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
