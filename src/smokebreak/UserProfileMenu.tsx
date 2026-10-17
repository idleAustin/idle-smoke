import { useEffect, useState, type FormEvent } from 'react';
import {
  addAdminTaglines,
  deleteAdminTagline,
  fetchAdminTaglines,
  updateAdminTagline,
  type AuthProviderId,
  type PlayerProfile,
  type TaglineCadence,
  type TaglineCollection,
  type TaglineItem,
} from './shiftClient';

const ADMIN_PASSCODE_SESSION_KEY = 'smokebreak.adminPasscode';

const CADENCE_OPTIONS: Array<{ value: TaglineCadence; label: string }> = [
  { value: '60s', label: 'Every 1 Minute' },
  { value: '5m', label: 'Every 5 Minutes' },
  { value: '15m', label: 'Every 15 Minutes' },
  { value: '1h', label: 'Every 1 Hour' },
  { value: 'daily', label: 'Daily Rotation' },
  { value: 'per_shift', label: 'Every Shift' },
];

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
  onTaglinesUpdated,
}: {
  profile: PlayerProfile;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSaveCallsign?: (nextCallsign: string) => Promise<void>;
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

  const [adminPasscode, setAdminPasscode] = useState<string>(() => {
    try {
      return globalThis.sessionStorage?.getItem(ADMIN_PASSCODE_SESSION_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(Boolean(profile.isAdmin));
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [adminCadence, setAdminCadence] = useState<TaglineCadence>('60s');
  const [adminTaglines, setAdminTaglines] = useState<TaglineItem[]>([]);
  const [newJokesDraft, setNewJokesDraft] = useState('');

  const providerId: AuthProviderId = profile.authProvider ?? 'guest';
  const providerInfo = PROVIDER_DISPLAY[providerId];
  const subtitle = profile.authEmail ?? providerInfo.defaultHint;

  const syncAdminState = (data: TaglineCollection, notifyParent = false) => {
    setAdminCadence(data.cadence);
    setAdminTaglines(data.taglines);
    if (notifyParent && onTaglinesUpdated) {
      const activeOnly = data.taglines.filter(t => t.isActive);
      onTaglinesUpdated({
        cadence: data.cadence,
        taglines: activeOnly,
      });
    }
  };

  useEffect(() => {
    if (activeTab !== 'admin') return;
    if (!profile.isAdmin && !adminPasscode) return;
    let cancelled = false;
    setAdminBusy(true);
    setAdminError(null);
    void fetchAdminTaglines(adminPasscode).then(res => {
      if (cancelled) return;
      setAdminBusy(false);
      if (res.ok) {
        setAdminUnlocked(true);
        syncAdminState(res.data, false);
      } else {
        setAdminUnlocked(false);
        setAdminError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, profile.isAdmin]);

  const submitAdminPasscode = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = passcodeInput.trim();
    if (!trimmed) return;
    setAdminBusy(true);
    setAdminError(null);
    const res = await fetchAdminTaglines(trimmed);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    setAdminPasscode(trimmed);
    try {
      globalThis.sessionStorage?.setItem(ADMIN_PASSCODE_SESSION_KEY, trimmed);
    } catch {
      // Ignore sessionStorage restrictions
    }
    setAdminUnlocked(true);
    syncAdminState(res.data, false);
  };

  const handleCadenceChange = async (nextCadence: TaglineCadence) => {
    setAdminBusy(true);
    setAdminError(null);
    setAdminNotice(null);
    const res = await updateAdminTagline({ cadence: nextCadence }, adminPasscode);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
    setAdminNotice(`Rotation cadence updated to ${nextCadence}.`);
  };

  const handleAddJokes = async (event: FormEvent) => {
    event.preventDefault();
    if (!newJokesDraft.trim()) return;
    setAdminBusy(true);
    setAdminError(null);
    setAdminNotice(null);
    const res = await addAdminTaglines(newJokesDraft, adminPasscode);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    setNewJokesDraft('');
    syncAdminState(res.data, true);
    setAdminNotice(`Added ${res.addedCount} tagline${res.addedCount === 1 ? '' : 's'} to database.`);
  };

  const handleToggleJoke = async (item: TaglineItem) => {
    setAdminBusy(true);
    setAdminError(null);
    const res = await updateAdminTagline({ id: item.id, isActive: !item.isActive }, adminPasscode);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
  };

  const handleDeleteJoke = async (id: number) => {
    setAdminBusy(true);
    setAdminError(null);
    const res = await deleteAdminTagline(id, adminPasscode);
    setAdminBusy(false);
    if (!res.ok) {
      setAdminError(res.error);
      return;
    }
    syncAdminState(res.data, true);
    setAdminNotice(`Deleted tagline #${id}.`);
  };

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
            <button
              type="button"
              className={`proto-chatgpt-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <span>🛠️</span> Admin · Taglines
            </button>
          </nav>

          <div className="proto-chatgpt-pane">
            {error && (
              <div className="proto-error" role="alert" style={{ marginBottom: 10 }}>
                {error}
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="proto-chatgpt-section">
                <div className="proto-mobbin-menu-header">
                  <div className="proto-mobbin-avatar-lg">{getInitials(profile.callsign)}</div>
                  <div className="proto-mobbin-user-meta">
                    <div className="proto-mobbin-name-row">
                      <strong>{profile.callsign}</strong>
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

            {activeTab === 'admin' && (
              <div className="proto-chatgpt-section">
                {adminError && (
                  <div className="proto-error" role="alert">
                    {adminError}
                  </div>
                )}
                {adminNotice && (
                  <div className="admin-notice" role="status">
                    {adminNotice}
                  </div>
                )}

                {!adminUnlocked ? (
                  <form className="proto-chatgpt-row admin-passcode-form" onSubmit={submitAdminPasscode}>
                    <div style={{ flex: 1 }}>
                      <strong>Admin Tagline Database</strong>
                      <small>
                        Unlocked automatically when signed in with your Admin Google/Apple email, or
                        enter your Doppler <code>ADMIN_PASSCODE</code> below.
                      </small>
                      <div className="admin-passcode-row">
                        <input
                          type="password"
                          className="callsign-input"
                          style={{ width: 200, textTransform: 'none' }}
                          placeholder="Enter ADMIN_PASSCODE"
                          value={passcodeInput}
                          onChange={e => setPasscodeInput(e.target.value)}
                          aria-label="Admin passcode"
                          disabled={adminBusy}
                        />
                        <button type="submit" className="ship" disabled={adminBusy}>
                          {adminBusy ? 'Verifying...' : 'Unlock Admin'}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="proto-chatgpt-row">
                      <div>
                        <strong>Rotation Cadence</strong>
                        <small>
                          Controls how often the top-bar joke rotates across all players.
                        </small>
                      </div>
                      <select
                        className="admin-cadence-select"
                        aria-label="Tagline rotation cadence"
                        value={adminCadence}
                        disabled={adminBusy}
                        onChange={e => handleCadenceChange(e.target.value as TaglineCadence)}
                      >
                        {CADENCE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <form className="admin-add-form" onSubmit={handleAddJokes}>
                      <label htmlFor="admin-joke-textarea">
                        <strong>Add or Bulk-Import Jokes ({adminTaglines.length} in DB)</strong>
                        <small>
                          Renders as: <em>&ldquo;idleSmoke — Where &lt;your joke&gt;&rdquo;</em> (e.g. <em>&ldquo;Where you&apos;re always allotted 15 minutes for a smoke break.&rdquo;</em>). Paste 1 or up to 250 lines at once.
                        </small>
                      </label>
                      <textarea
                        id="admin-joke-textarea"
                        className="admin-joke-textarea"
                        rows={3}
                        placeholder="you're always allotted 15 minutes for a smoke break.&#10;the productivity metrics are made up and the shift clock doesn't matter."
                        value={newJokesDraft}
                        onChange={e => setNewJokesDraft(e.target.value)}
                        disabled={adminBusy}
                      />
                      <div className="admin-add-actions">
                        <button type="submit" className="ship" disabled={adminBusy || !newJokesDraft.trim()}>
                          {adminBusy ? 'Saving...' : '+ Add / Bulk Import to DB'}
                        </button>
                      </div>
                    </form>

                    <div className="admin-joke-list" role="region" aria-label="Tagline database list">
                      {adminTaglines.map(item => (
                        <div
                          key={item.id}
                          className={`admin-joke-row ${item.isActive ? '' : 'is-inactive'}`}
                        >
                          <span className="admin-joke-id">#{item.id}</span>
                          <span className="admin-joke-text">Where {item.jokeText.replace(/^where\s+/i, '')}</span>
                          <div className="admin-joke-btns">
                            <button
                              type="button"
                              className="proto-acct-btn-secondary"
                              disabled={adminBusy}
                              onClick={() => handleToggleJoke(item)}
                            >
                              {item.isActive ? 'Active' : 'Paused'}
                            </button>
                            <button
                              type="button"
                              className="proto-acct-btn-danger-outline"
                              disabled={adminBusy}
                              onClick={() => handleDeleteJoke(item.id)}
                              aria-label={`Delete tagline ${item.id}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
