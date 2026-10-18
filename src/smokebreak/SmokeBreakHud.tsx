// Heads-up display panels for active smoke breaks: top command bar, brief instructions, butt tally, and post-shift report dialog.

import { type RefObject } from 'react';
import { formatWhereTagline } from './accountClient';
import { type EnvironmentId, getEnvironment, type SmokeEnvironment } from './EnvironmentDeck';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';
import { BREAK_MS, PRESSES_PER_CIGARETTE } from './smokeBreak';
import { type GameModeId, type RivalOpponent } from './SmokeBreakLobby';
import { UserCircleTrigger } from './UserProfileMenu';

export function SmokeCommandHeader({
  env,
  activeJokeText,
  done,
  seconds,
  profile,
  isQuickCardOpen,
  isSettingsModalOpen,
  accountBusy,
  showChangeModeAction,
  onToggleQuickCard,
  onOpenSettingsModal,
  onChangeMode,
  onSignOut,
}: {
  env: SmokeEnvironment;
  activeJokeText: string;
  done: boolean;
  seconds: number;
  profile: PlayerProfile;
  isQuickCardOpen: boolean;
  isSettingsModalOpen: boolean;
  accountBusy: boolean;
  showChangeModeAction: boolean;
  onToggleQuickCard: () => void;
  onOpenSettingsModal: () => void;
  onChangeMode: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="hud-command hud-panel" onPointerDown={e => e.stopPropagation()}>
      <div className="hud-brand">
        <span className="eyebrow">idleSmoke · {env.sector}</span>
        <strong className="hud-tagline">
          <span className="hud-tagline-brand">idleSmoke</span>
          <span className="hud-tagline-copy">
            {' — '}{formatWhereTagline(activeJokeText)}
          </span>
        </strong>
      </div>
      <div className="hud-right-group">
        <div
          className={`shift-clock ${done ? 'complete' : 'running'}`}
          role="timer"
          aria-label="Smoke break time remaining"
        >
          0:{String(seconds).padStart(2, '0')}
        </div>
        <UserCircleTrigger
          profile={profile}
          isQuickCardOpen={isQuickCardOpen}
          isSettingsModalOpen={isSettingsModalOpen}
          busy={accountBusy}
          showChangeModeAction={showChangeModeAction}
          onToggleQuickCard={onToggleQuickCard}
          onOpenSettingsModal={onOpenSettingsModal}
          onChangeMode={onChangeMode}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}

export function SmokeBriefPanel({
  envName,
  done,
  started,
  touch,
}: {
  envName: string;
  done: boolean;
  started: boolean;
  touch: boolean;
}) {
  return (
    <section className="hud-panel smoke-brief">
      <span className="eyebrow">ON BREAK · {BREAK_MS / 1000} SECONDS · {envName.toUpperCase()}</span>
      <h2>{done ? 'Break over. Back to the floor.' : !started ? 'Light up.' : 'Keep dragging.'}</h2>
      <p>
        {!started
          ? touch
            ? <>Tap anywhere on the screen to take a drag. The clock starts on your first tap.</>
            : <>Mash <kbd>Space</kbd> or click to take a drag. The clock starts on your first drag.</>
          : <>{touch ? 'Keep tapping. ' : ''}Each cigarette takes {PRESSES_PER_CIGARETTE} drags. The next one lights as soon as you stub one out.</>}
      </p>
    </section>
  );
}

export function SmokeTallyPanel({
  smoked,
  progress,
  remaining,
  lifetimeSmoked,
  bestSmoked,
  gameMode,
  selectedRival,
}: {
  smoked: number;
  progress: number;
  remaining: number;
  lifetimeSmoked: number;
  bestSmoked: number;
  gameMode: GameModeId;
  selectedRival: RivalOpponent | null;
}) {
  return (
    <section className="hud-panel smoke-tally" aria-label="Smoke break tally">
      <span className="eyebrow">BUTTS IN THE TRAY</span>
      <strong>{smoked}</strong>
      <span className="eyebrow">CURRENT CIGARETTE</span>
      <meter aria-label="Current cigarette smoked" value={progress} max={PRESSES_PER_CIGARETTE} />
      <span className="eyebrow">BREAK LEFT</span>
      <meter aria-label="Break time left" value={remaining} max={BREAK_MS} />
      <div className="smoke-tally-career" aria-label="Career smoke break stats">
        <span>LIFETIME: {lifetimeSmoked}</span>
        <span>BEST: {bestSmoked}</span>
        {gameMode === 'h2h' && selectedRival && (
          <span>VS {selectedRival.callsign}: {selectedRival.smoked}</span>
        )}
      </div>
    </section>
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
  gameMode = 'sandbox',
  rival = null,
  armed,
  newShiftRef,
  onFinish,
  onOpenModes,
}: {
  verifiedEnvironment: SmokeEnvironment;
  smoked: number;
  lifetimeSmoked: number;
  bestSmoked: number;
  newlyUnlockedEnvironments: readonly EnvironmentId[];
  profile: PlayerProfile;
  leaderboardEntries: readonly LeaderboardEntry[];
  gameMode?: GameModeId;
  rival?: RivalOpponent | null;
  armed: boolean;
  newShiftRef: RefObject<HTMLButtonElement>;
  onFinish(): void;
  onOpenModes?(): void;
}) {
  const plural = (n: number) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;
  const h2hOutcome =
    gameMode === 'h2h' && rival
      ? smoked > rival.smoked
        ? `1v1 VICTORY · Beat ${rival.callsign} (${smoked} to ${rival.smoked} butts)`
        : smoked === rival.smoked
          ? `1v1 DRAW · Tied ${rival.callsign} (${smoked} butts each)`
          : `1v1 DEFEAT · ${rival.callsign} smoked ${rival.smoked} butts (you had ${smoked})`
      : null;

  return (
    <section
      className="hud-panel smoke-result"
      role="dialog"
      aria-labelledby="smoke-result-title"
      onPointerDown={e => e.stopPropagation()}
    >
      <span className="eyebrow">
        BREAK REPORT · {gameMode.toUpperCase()} · {verifiedEnvironment.name.toUpperCase()}
      </span>
      <h2 id="smoke-result-title">{plural(smoked)} in {BREAK_MS / 1000} seconds</h2>
      <p>Supervisor's waving you back in.</p>
      {h2hOutcome && (
        <div className="unlock-banner" role="status">
          {h2hOutcome}
        </div>
      )}
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
      <div className="smoke-result-actions">
        <button type="button" className="ship" ref={newShiftRef} disabled={!armed} onClick={onFinish}>
          Start new shift
        </button>
        {onOpenModes && (
          <button
            type="button"
            className="callsign-edit-btn"
            disabled={!armed}
            onClick={onOpenModes}
          >
            Change Mode / Map
          </button>
        )}
      </div>
    </section>
  );
}
