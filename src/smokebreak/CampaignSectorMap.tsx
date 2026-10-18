// Interactive blueprint sector map and environment inspector for Campaign mode.

import { ENVIRONMENTS, type EnvironmentId, type SmokeEnvironment } from './EnvironmentDeck';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';

const MAP_COORDS: Record<EnvironmentId, { x: string; y: string; code: string }> = {
  alleyway: { x: '22%', y: '68%', code: 'SEC-01' },
  restaurant: { x: '46%', y: '38%', code: 'SEC-02' },
  'parking-garage': { x: '68%', y: '62%', code: 'SEC-03' },
  dumpster: { x: '82%', y: '28%', code: 'SEC-04' },
};

export function CampaignSectorMap({
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
