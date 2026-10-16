import { useState, type FormEvent, type RefObject } from 'react';
import { type EnvironmentId, getEnvironment, type SmokeEnvironment } from './EnvironmentDeck';
import { type LeaderboardEntry, type PlayerProfile } from './shiftClient';
import { BREAK_MS } from './smokeBreak';

export function CallsignBadge({
  callsign,
  onSave,
}: {
  callsign: string;
  onSave: (nextCallsign: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(callsign);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid callsign');
    }
  };

  if (!editing) {
    return (
      <div className="callsign-badge" aria-label="Employee callsign badge">
        <span className="status-dot" />
        <span className="callsign-label">BADGE · {callsign}</span>
        <button
          type="button"
          className="callsign-edit-btn"
          aria-label="Edit employee callsign"
          onClick={() => {
            setDraft(callsign);
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form className="callsign-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="callsign-input"
        aria-label="Employee callsign"
        value={draft}
        maxLength={16}
        onChange={e => setDraft(e.target.value)}
        autoFocus
      />
      <button type="submit" className="callsign-save-btn">Save</button>
      <button
        type="button"
        className="callsign-cancel-btn"
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
      >
        Cancel
      </button>
      {error && <span className="callsign-error" role="alert">{error}</span>}
    </form>
  );
}

export function BreakReportDialog({
  verifiedEnvironment,
  smoked,
  lifetimeSmoked,
  bestSmoked,
  newlyUnlockedEnvironments,
  profile,
  leaderboardEntries,
  armed,
  newShiftRef,
  onFinish,
}: {
  verifiedEnvironment: SmokeEnvironment;
  smoked: number;
  lifetimeSmoked: number;
  bestSmoked: number;
  newlyUnlockedEnvironments: readonly EnvironmentId[];
  profile: PlayerProfile;
  leaderboardEntries: readonly LeaderboardEntry[];
  armed: boolean;
  newShiftRef: RefObject<HTMLButtonElement>;
  onFinish(): void;
}) {
  const plural = (n: number) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;

  return (
    <section
      className="hud-panel smoke-result"
      role="dialog"
      aria-labelledby="smoke-result-title"
      onPointerDown={e => e.stopPropagation()}
    >
      <span className="eyebrow">BREAK REPORT · {verifiedEnvironment.name.toUpperCase()}</span>
      <h2 id="smoke-result-title">{plural(smoked)} in {BREAK_MS / 1000} seconds</h2>
      <p>Supervisor's waving you back in.</p>
      <dl className="break-report-stats" aria-label="Shift and career stats">
        <div>
          <dt>VERIFIED SHIFT</dt>
          <dd>{smoked} {smoked === 1 ? 'butt' : 'butts'}</dd>
        </div>
        <div>
          <dt>LIFETIME BUTTS</dt>
          <dd>{lifetimeSmoked}</dd>
        </div>
        <div>
          <dt>PERSONAL BEST</dt>
          <dd>{bestSmoked}</dd>
        </div>
      </dl>
      {newlyUnlockedEnvironments.length > 0 && (
        <div className="unlock-banner" role="status">
          NEW BREAK SPOT UNLOCKED: {newlyUnlockedEnvironments.map(id => getEnvironment(id).name).join(', ')}
        </div>
      )}
      <section className="leaderboard-panel" aria-label="Global Top 10 Leaderboard">
        <div className="leaderboard-header">
          <span className="eyebrow">GLOBAL TOP 10 LEADERBOARD</span>
          <span className="leaderboard-meta">{profile.callsign}</span>
        </div>
        <ol className="leaderboard-list">
          {leaderboardEntries.slice(0, 10).map(entry => (
            <li key={`${entry.rank}-${entry.callsign}-${entry.completedAt}`} className="leaderboard-row">
              <span className="leaderboard-rank">#{entry.rank}</span>
              <span className="leaderboard-callsign">{entry.callsign}</span>
              <span className="leaderboard-env">{getEnvironment(entry.environmentId).name}</span>
              <span className="leaderboard-score">{entry.smoked} butts</span>
            </li>
          ))}
        </ol>
      </section>
      <button type="button" className="ship" ref={newShiftRef} disabled={!armed} onClick={onFinish}>
        Start new shift
      </button>
    </section>
  );
}
