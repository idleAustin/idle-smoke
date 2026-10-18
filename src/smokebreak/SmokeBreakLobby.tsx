// Multi-step pre-shift lobby coordinator, 3-card game mode deck, and 1v1 head-to-head matchmaking screen.

import { CampaignSectorMap } from './CampaignSectorMap';
import { ENVIRONMENTS, type EnvironmentId, type SmokeEnvironment } from './EnvironmentDeck';
import { LoginScreen } from './LobbyLoginScreen';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';

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

export interface SmokeBreakLobbyProps {
  step: Exclude<LobbyStep, 'game'>;
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  leaderboardEntries: readonly LeaderboardEntry[];
  selectedRival: RivalOpponent | null;
  onSelectEnvironment: (id: EnvironmentId) => void;
  onSaveCallsign: (nextCallsign: string) => Promise<void>;
  onLoginPassword?: (
    callsign: string,
    password: string,
    mode?: 'login' | 'register'
  ) => Promise<void>;
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
  statusBanner?: string | null;
  onDismissBanner?: () => void;
}

function resolveRivalList(entries: readonly LeaderboardEntry[]): RivalOpponent[] {
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
        statusBanner={props.statusBanner}
        onDismissBanner={props.onDismissBanner}
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
