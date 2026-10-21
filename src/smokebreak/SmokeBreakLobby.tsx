// Multi-step pre-shift lobby coordinator, 3-card game mode deck, and 2-digit code Smoke Session lobby router.

import { useEffect, useState } from 'react';
import { CampaignSectorMap } from './CampaignSectorMap';
import {
  ENVIRONMENTS,
  type CampaignPhaseId,
  type EnvironmentId,
  type SmokeEnvironment,
  getEnvironment,
} from './EnvironmentDeck';
import { LoginScreen } from './LobbyLoginScreen';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';
import { type SmokeSession } from './smokeSessionClient';
import { SmokeSessionLobby } from './SmokeSessionLobby';

export type LobbyStep = 'login' | 'modes' | 'map' | 'h2h' | 'game';
export type GameModeId = 'campaign' | 'h2h' | 'sandbox';

export interface SmokeBreakLobbyProps {
  step: Exclude<LobbyStep, 'game'>;
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  leaderboardEntries: readonly LeaderboardEntry[];
  activeSmokeSession: SmokeSession | null;
  onSmokeSessionChange: (session: SmokeSession | null) => void;
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
  onSetStep: (step: LobbyStep) => void;
  onStartShift: () => void;
  statusBanner?: string | null;
  onDismissBanner?: () => void;
}

function GameModeDeck({
  profile,
  currentEnv,
  unlockedEnvironments,
  onSelectEnvironment,
  onSelectMode,
}: {
  profile: PlayerProfile;
  currentEnv: SmokeEnvironment;
  unlockedEnvironments: readonly EnvironmentId[];
  onSelectEnvironment: (id: EnvironmentId) => void;
  onSelectMode: (mode: GameModeId) => void;
}) {
  const [sandboxPhase, setSandboxPhase] = useState<CampaignPhaseId>(currentEnv.phase);

  useEffect(() => {
    setSandboxPhase(currentEnv.phase);
  }, [currentEnv.phase]);

  const nextLocked = ENVIRONMENTS.find(e => !unlockedEnvironments.includes(e.id));
  const phaseSpots = ENVIRONMENTS.filter(e => e.phase === sandboxPhase);

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
            <span className="eyebrow">GAME MODES · PRE-SHIFT BRIEFING</span>
            <h2>Select How You Want to Smoke</h2>
          </div>
          <div className="proto-map-user-pill">
            <span className="status-dot" />
            <span>{profile.callsign}</span>
            <small>· {profile.lifetimeSmoked} butts</small>
            <small className="proto-sync-tag">· {unlockedEnvironments.length}/12 Spots</small>
          </div>
        </header>

        <div className="proto-modes-three-col">
          <article className="proto-mode-card featured">
            <div
              className="proto-mode-banner"
              style={{ backgroundImage: `url("${currentEnv.image}")` }}
            >
              <span className="proto-pill-tag">CAMPAIGN</span>
              <span className="proto-chip">{unlockedEnvironments.length}/12 UNLOCKED</span>
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
                    ? `${nextLocked.name} (Quota ${nextLocked.sectorQuotaRequired} butts)`
                    : 'All 12 Sectors Unlocked'}
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
              <span className="proto-chip">PARTY CODE</span>
              <span className="proto-valid">● 2-DIGIT ROOM</span>
            </div>
            <div className="proto-mode-body">
              <h3>Smoke Session</h3>
              <p className="proto-sub">
                Start a session to generate a 2-digit code or enter a code to join coworkers nearby. Everyone lights up on a 3-2-1 countdown.
              </p>
              <div className="proto-mode-meta-box">
                <span>HOW IT WORKS</span>
                <strong>2-Digit Code · 3-2-1 Light Up · Ranked Podium</strong>
              </div>
              <button
                type="button"
                className="ship proto-cta-primary"
                onClick={() => onSelectMode('h2h')}
              >
                Open Smoke Session →
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
              <div className="proto-sandbox-spot-header">
                <span className="eyebrow">SELECT SPOT</span>
                <div className="env-phase-switcher" role="group" aria-label="Sandbox phase">
                  {([1, 2, 3] as const).map(phaseId => {
                    const phaseLocked =
                      !profile.isAdmin &&
                      phaseId > (profile.unlockedPhase ?? 1) &&
                      !unlockedEnvironments.some(id => getEnvironment(id).phase === phaseId);
                    return (
                      <button
                        key={phaseId}
                        type="button"
                        className={`env-phase-pill ${sandboxPhase === phaseId ? 'active' : ''} ${phaseLocked ? 'is-locked' : ''}`}
                        aria-pressed={sandboxPhase === phaseId}
                        onClick={() => setSandboxPhase(phaseId)}
                      >
                        P{phaseId}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="proto-a-spot-pills">
                {phaseSpots.map(spot => {
                  const unlocked = Boolean(profile.isAdmin) || unlockedEnvironments.includes(spot.id);
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      disabled={!unlocked}
                      className={`proto-spot-pill ${spot.id === currentEnv.id ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                      onClick={() => onSelectEnvironment(spot.id)}
                    >
                      <span>{spot.name}</span>
                      {!unlocked && <small>[LOCKED]</small>}
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
        onSelectEnvironment={props.onSelectEnvironment}
        onSelectMode={props.onSelectMode}
      />
    );
  }

  if (props.step === 'h2h') {
    return (
      <SmokeSessionLobby
        profile={props.profile}
        currentEnv={props.currentEnv}
        activeSession={props.activeSmokeSession}
        onSessionChange={props.onSmokeSessionChange}
        onSelectEnvironment={props.onSelectEnvironment}
        onBackToModes={() => props.onSetStep('modes')}
        onStartSessionShift={session => {
          props.onSmokeSessionChange(session);
          props.onStartShift();
        }}
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
