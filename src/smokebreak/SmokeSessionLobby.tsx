// Pre-shift 2-digit code Smoke Session lobby for creating a session, joining by code, and syncing the waiting-room crew roster.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getEnvironment, type EnvironmentId, type SmokeEnvironment } from './EnvironmentDeck';
import { OperatorAvatar } from './OperatorAvatar';
import { type PlayerProfile } from './shiftStorage';
import {
  createSmokeSession,
  fetchSmokeSession,
  joinSmokeSessionByCode,
  startSmokeSessionById,
  type SmokeSession,
} from './smokeSessionClient';

export interface SmokeSessionLobbyProps {
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  activeSession: SmokeSession | null;
  onSessionChange: (session: SmokeSession | null) => void;
  onSelectEnvironment: (id: EnvironmentId) => void;
  onBackToModes: () => void;
  onStartSessionShift: (session: SmokeSession) => void;
}

export function SmokeSessionLobby({
  profile,
  currentEnv,
  activeSession,
  onSessionChange,
  onSelectEnvironment,
  onBackToModes,
  onStartSessionShift,
}: SmokeSessionLobbyProps) {
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacksRef = useRef({
    onSelectEnvironment,
    onSessionChange,
    onStartSessionShift,
  });
  callbacksRef.current = {
    onSelectEnvironment,
    onSessionChange,
    onStartSessionShift,
  };

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.status === 'active') {
      callbacksRef.current.onSelectEnvironment(activeSession.environmentId);
      callbacksRef.current.onStartSessionShift(activeSession);
      return;
    }

    const sessionId = activeSession.sessionId;
    let mounted = true;
    const timer = setInterval(async () => {
      const updated = await fetchSmokeSession(sessionId);
      if (!mounted || !updated) return;
      callbacksRef.current.onSessionChange(updated);
      if (updated.status === 'active') {
        callbacksRef.current.onSelectEnvironment(updated.environmentId);
        callbacksRef.current.onStartSessionShift(updated);
      }
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [activeSession?.sessionId, activeSession?.status, activeSession?.environmentId]);

  const handleHostSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createSmokeSession(currentEnv.id);
      onSessionChange(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Smoke Session');
    } finally {
      setBusy(false);
    }
  };

  const handleJoinSession = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = codeInput.replace(/\D/g, '').slice(0, 2);
    if (cleaned.length !== 2) {
      setError('Enter a 2-digit code (00–99).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const joined = await joinSmokeSessionByCode(cleaned);
      onSelectEnvironment(joined.environmentId);
      onSessionChange(joined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join Smoke Session');
    } finally {
      setBusy(false);
    }
  };

  const handleStartSession = async () => {
    if (!activeSession) return;
    setBusy(true);
    setError(null);
    try {
      const started = await startSmokeSessionById(activeSession.sessionId);
      onSessionChange(started);
      onSelectEnvironment(started.environmentId);
      onStartSessionShift(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Smoke Session');
    } finally {
      setBusy(false);
    }
  };

  const isHost = Boolean(
    activeSession &&
      (activeSession.hostPlayerId === profile.playerId ||
        activeSession.participants.some(p => p.isHost && p.callsign === profile.callsign))
  );
  const hostCallsign =
    activeSession?.participants.find(p => p.isHost)?.callsign ?? 'Session Creator';

  return (
    <div
      className="proto-overlay proto-variant-a"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Smoke Session Lobby"
    >
      <div className="proto-h2h-shell hud-panel">
        <header className="proto-map-topbar">
          <div className="proto-map-title-group">
            <button
              type="button"
              className="proto-nav-back-btn"
              onClick={() => {
                onSessionChange(null);
                onBackToModes();
              }}
            >
              ← Game Modes
            </button>
            <div>
              <span className="eyebrow">GROUP BREAK · 2-DIGIT ROOM CODE</span>
              <h2>Smoke Session</h2>
            </div>
          </div>
          <div className="proto-map-user-pill">
            <span className="status-dot" />
            <span>{profile.callsign}</span>
            <small>· {currentEnv.name}</small>
          </div>
        </header>

        {error && (
          <div className="proto-session-error" role="alert">
            {error}
          </div>
        )}

        {!activeSession ? (
          <div className="proto-session-split-grid">
            <section className="proto-session-card">
              <span className="eyebrow">CREATE ROOM · HOST</span>
              <h3>Start a Smoke Session</h3>
              <p className="proto-sub">
                Generate a 2-digit code for coworkers nearby. Once everyone is in the room, you trigger the 3-2-1 light-up countdown.
              </p>
              <div className="proto-mode-meta-box">
                <span>SELECTED BREAK SPOT</span>
                <strong>{currentEnv.name}</strong>
              </div>
              <button
                type="button"
                className="ship proto-cta-primary"
                disabled={busy}
                onClick={() => void handleHostSession()}
              >
                {busy ? 'Generating Code…' : 'Generate 2-Digit Code →'}
              </button>
            </section>

            <section className="proto-session-card">
              <span className="eyebrow">ENTER CODE · JOIN CREW</span>
              <h3>Join with 2-Digit Code</h3>
              <p className="proto-sub">
                Type the 2-digit code from the session creator's screen to step into the break circle.
              </p>
              <form className="proto-session-join-form" onSubmit={e => void handleJoinSession(e)}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{2}"
                  maxLength={2}
                  aria-label="2-digit session code"
                  placeholder="00"
                  className="proto-session-code-input"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
                <button
                  type="submit"
                  className="ship proto-cta-primary"
                  disabled={busy || codeInput.length !== 2}
                >
                  {busy ? 'Joining…' : 'Join Session →'}
                </button>
              </form>
            </section>
          </div>
        ) : (
          <div className="proto-session-waiting">
            <div className="proto-session-code-banner">
              <div>
                <span className="eyebrow">SHARE THIS 2-DIGIT CODE WITH YOUR CREW</span>
                <p className="proto-sub">
                  Spot: <strong>{getEnvironment(activeSession.environmentId).name}</strong> · 3-2-1 countdown starts when everyone is in.
                </p>
              </div>
              <div className="proto-session-code-display" aria-label="Active 2-digit session code">
                <span className="eyebrow">CODE</span>
                <strong>{activeSession.code}</strong>
              </div>
            </div>

            <div className="proto-session-roster">
              <div className="leaderboard-header">
                <span className="eyebrow">
                  CREW IN THE CIRCLE ({activeSession.participants.length})
                </span>
                <span className="leaderboard-meta">WAITING TO LIGHT UP</span>
              </div>
              <ol className="leaderboard-list">
                {activeSession.participants.map((participant, idx) => (
                  <li key={`${participant.playerId}-${idx}`} className="leaderboard-row">
                    <span className="leaderboard-rank">#{idx + 1}</span>
                    <span className="leaderboard-callsign">
                      <span className="leaderboard-avatar">
                        <OperatorAvatar
                          callsign={participant.callsign}
                          isAdmin={
                            participant.callsign === profile.callsign ? profile.isAdmin : false
                          }
                          avatarConfig={
                            participant.callsign === profile.callsign
                              ? (participant.avatarConfig ?? profile.avatarConfig)
                              : participant.avatarConfig
                          }
                        />
                      </span>
                      {participant.callsign}
                    </span>
                    <span className="leaderboard-env">
                      {participant.isHost ? 'SESSION CREATOR' : 'READY'}
                    </span>
                    <span className="leaderboard-score">IN ROOM</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="proto-session-actions">
              {isHost ? (
                <button
                  type="button"
                  className="ship proto-cta-primary"
                  disabled={busy}
                  onClick={() => void handleStartSession()}
                >
                  {busy
                    ? 'Starting Countdown…'
                    : `Start Smoke Session (${activeSession.participants.length} in room) →`}
                </button>
              ) : (
                <div className="proto-mode-meta-box" role="status">
                  <span>WAITING ON HOST</span>
                  <strong>
                    Waiting for {hostCallsign} to start the 3-2-1 light-up countdown…
                  </strong>
                </div>
              )}
              <button
                type="button"
                className="proto-nav-back-btn"
                disabled={busy}
                onClick={() => onSessionChange(null)}
              >
                Leave Session
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

