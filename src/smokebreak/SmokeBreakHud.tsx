// Heads-up display panels for active smoke breaks: top command bar, brief instructions, 3-2-1 countdown, butt tally, and post-shift report dialog.

import { type RefObject } from 'react';
import { formatWhereTagline } from './accountClient';
import { type EnvironmentId, getEnvironment, type SmokeEnvironment } from './EnvironmentDeck';
import { OperatorAvatar } from './OperatorAvatar';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';
import {
  BREAK_MS,
  CAMPAIGN_PHASES,
  getCornyHypeCopy,
  getDragRatio,
  isPhasePromotionUnlocked,
} from './smokeBreak';
import { type GameModeId } from './SmokeBreakLobby';
import { type SmokeSession } from './smokeSessionClient';
import { UserCircleTrigger } from './UserProfileMenu';

export function getActivePromotionBanner(
  env: SmokeEnvironment,
  profile: PlayerProfile
): string | null {
  if (profile.promotionRoundsCleared >= 9) return 'CHAIRMAN OF THE ASH · ALL PROMOTIONS CLEARED';
  const activePhaseNum = Math.floor(profile.promotionRoundsCleared / 3) + 1;
  const roundInPhase = (profile.promotionRoundsCleared % 3) + 1;
  const phaseMeta = CAMPAIGN_PHASES.find(p => p.phase === activePhaseNum);
  if (!phaseMeta || env.id !== phaseMeta.finalSectorId) return null;
  if (!isPhasePromotionUnlocked(activePhaseNum, profile.smokedByEnvironment)) return null;
  const target = phaseMeta.promotionTargets[roundInPhase - 1];
  return `PROMOTION ROUND ${roundInPhase}/3 · TARGET ${target} BUTTS`;
}

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
  onOpenScoreboard,
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
  onOpenScoreboard?: () => void;
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
        {showChangeModeAction && (
          <>
            <button type="button" className="hud-nav-back-btn" onClick={onChangeMode}>
              ← Modes / Map
            </button>
            {onOpenScoreboard && (
              <button
                type="button"
                className="hud-nav-back-btn"
                onClick={onOpenScoreboard}
                aria-label="Open Scoreboard"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
                <span>Scoreboard</span>
              </button>
            )}
          </>
        )}
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
          onOpenScoreboard={onOpenScoreboard}
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
  smoked = 0,
  promotionBanner = null,
}: {
  envName: string;
  done: boolean;
  started: boolean;
  touch: boolean;
  smoked?: number;
  promotionBanner?: string | null;
}) {
  const hype = getCornyHypeCopy(smoked);
  return (
    <section className="hud-panel smoke-brief" aria-label="Smoke break brief">
      <div className="smoke-brief-meta">
        <span className="eyebrow">ON BREAK · {BREAK_MS / 1000} SECONDS · {envName.toUpperCase()}</span>
        <span
          className={`smoke-drag-ratio-badge ratio-${hype.dragRatio}`}
          aria-label={`Active drag ratio: ${hype.badge}`}
        >
          {hype.badge}
        </span>
      </div>
      {promotionBanner && (
        <div className="smoke-promo-target-pill" aria-label="Active promotion target">
          {promotionBanner}
        </div>
      )}
      <h2>{done ? 'Break over. Back to the floor.' : !started ? 'Light up.' : 'Keep dragging.'}</h2>
      {started && !done && (
        <p className="smoke-hype-copy" role="status" aria-live="polite">
          {hype.copy}
        </p>
      )}
      <p>
        {!started
          ? touch
            ? <>Tap anywhere on the screen to take a drag. The clock starts on your first tap.</>
            : <>Mash <kbd>Space</kbd> or drum any keys (<kbd>A–Z</kbd> <kbd>0–9</kbd>) to take a drag. The clock starts on your first drag.</>
          : <>{touch ? 'Keep tapping. ' : 'Drum keys to chain drags. '}Each cigarette takes {hype.dragRatio} drags. The next one lights as soon as you stub one out.</>}
      </p>
    </section>
  );
}

export function SmokeCountdownOverlay({
  count,
  sessionCode,
}: {
  count: number;
  sessionCode?: string;
}) {
  return (
    <div
      className="proto-overlay proto-countdown-overlay"
      role="status"
      aria-live="assertive"
      aria-label={`Light up countdown: ${count}`}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="proto-countdown-card hud-panel">
        <span className="eyebrow">
          SMOKE SESSION {sessionCode ? `· CODE ${sessionCode}` : ''} · GET READY
        </span>
        <strong className="proto-countdown-digit">{count}</strong>
        <p className="proto-sub">Light-up countdown in progress…</p>
      </div>
    </div>
  );
}

export function SmokeTallyPanel({
  smoked,
  progress,
  remaining,
  lifetimeSmoked,
  bestSmoked,
}: {
  smoked: number;
  progress: number;
  remaining: number;
  lifetimeSmoked: number;
  bestSmoked: number;
}) {
  const dragRatio = getDragRatio(smoked);
  return (
    <section className="hud-panel smoke-tally" aria-label="Smoke break tally">
      <span className="eyebrow">BUTTS IN THE TRAY</span>
      <strong>{smoked}</strong>
      <span className="eyebrow">CURRENT CIGARETTE ({progress}/{dragRatio})</span>
      <meter aria-label="Current cigarette smoked" value={progress} max={dragRatio} />
      <span className="eyebrow">BREAK LEFT</span>
      <meter aria-label="Break time left" value={remaining} max={BREAK_MS} />
      <div className="smoke-tally-career" aria-label="Career smoke break stats">
        <span>LIFETIME: {lifetimeSmoked}</span>
        <span>BEST: {bestSmoked}</span>
      </div>
    </section>
  );
}

function resolveSessionOutcomeBanner(session: SmokeSession): string {
  const finished = session.participants.filter(p => p.finished);
  if (finished.length === 0) {
    return `SMOKE SESSION #${session.code} · Tallying crew butts…`;
  }
  const allDone = finished.length === session.participants.length;
  const leader = finished[0];
  const tiedWinners = finished.filter(
    p => p.smoked === leader.smoked && p.tapCount === leader.tapCount
  );
  if (!allDone) {
    return `CURRENT LEADER: ${leader.callsign} (${leader.smoked ?? 0} butts) · Waiting on ${session.participants.length - finished.length} more…`;
  }
  if (tiedWinners.length > 1) {
    return `SMOKE SESSION DRAW · ${tiedWinners.map(p => p.callsign).join(' & ')} tied at ${leader.smoked ?? 0} butts`;
  }
  return `SMOKE SESSION WINNER · ${leader.callsign} (${leader.smoked ?? 0} ${leader.smoked === 1 ? 'butt' : 'butts'})`;
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
  smokeSession = null,
  armed,
  newShiftRef,
  onFinish,
  onOpenModes,
  onOpenScoreboard,
}: {
  verifiedEnvironment: SmokeEnvironment;
  smoked: number;
  lifetimeSmoked: number;
  bestSmoked: number;
  newlyUnlockedEnvironments: readonly EnvironmentId[];
  profile: PlayerProfile;
  leaderboardEntries: readonly LeaderboardEntry[];
  gameMode?: GameModeId;
  smokeSession?: SmokeSession | null;
  armed: boolean;
  newShiftRef: RefObject<HTMLButtonElement>;
  onFinish(): void;
  onOpenModes?(): void;
  onOpenScoreboard?(): void;
}) {
  const plural = (n: number) => `${n} ${n === 1 ? 'cigarette' : 'cigarettes'}`;
  const sessionBanner =
    gameMode === 'h2h' && smokeSession ? resolveSessionOutcomeBanner(smokeSession) : null;

  return (
    <section
      className="hud-panel smoke-result"
      role="dialog"
      aria-labelledby="smoke-result-title"
      onPointerDown={e => e.stopPropagation()}
    >
      <span className="eyebrow">
        BREAK REPORT · {gameMode === 'h2h' ? 'SMOKE SESSION' : gameMode.toUpperCase()} · {verifiedEnvironment.name.toUpperCase()}
      </span>
      <h2 id="smoke-result-title">{plural(smoked)} in {BREAK_MS / 1000} seconds</h2>
      <p>Supervisor's waving you back in.</p>
      {sessionBanner && (
        <div className="unlock-banner" role="status">
          {sessionBanner}
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
      {gameMode === 'h2h' && smokeSession && (
        <section className="leaderboard-panel" aria-label="Smoke Session Scoreboard">
          <div className="leaderboard-header">
            <span className="eyebrow">SMOKE SESSION #{smokeSession.code} SCOREBOARD</span>
            <span className="leaderboard-meta">
              {smokeSession.participants.filter(p => p.finished).length}/{smokeSession.participants.length} FINISHED
            </span>
          </div>
          <ol className="leaderboard-list">
            {smokeSession.participants.map(p => (
              <li key={p.playerId} className="leaderboard-row">
                <span className="leaderboard-rank">#{p.rank}</span>
                <span className="leaderboard-callsign">
                  <span className="leaderboard-avatar">
                    <OperatorAvatar
                      callsign={p.callsign}
                      isAdmin={p.callsign === profile.callsign ? profile.isAdmin : false}
                      avatarConfig={
                        p.callsign === profile.callsign
                          ? (p.avatarConfig ?? profile.avatarConfig)
                          : p.avatarConfig
                      }
                    />
                  </span>
                  {p.callsign}
                </span>
                <span className="leaderboard-env">
                  {p.finished ? `${p.tapCount ?? 0} drags` : 'SMOKING…'}
                </span>
                <span className="leaderboard-score">
                  {p.finished ? `${p.smoked ?? 0} butts` : '—'}
                </span>
              </li>
            ))}
          </ol>
        </section>
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
              <span className="leaderboard-callsign">
                <span className="leaderboard-avatar">
                  <OperatorAvatar
                    callsign={entry.callsign}
                    isAdmin={entry.callsign === profile.callsign ? profile.isAdmin : false}
                    avatarConfig={
                      entry.callsign === profile.callsign
                        ? (entry.avatarConfig ?? profile.avatarConfig)
                        : entry.avatarConfig
                    }
                  />
                </span>
                {entry.callsign}
              </span>
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
        {onOpenScoreboard && (
          <button
            type="button"
            className="callsign-edit-btn"
            disabled={!armed}
            onClick={onOpenScoreboard}
          >
            Full Scoreboard
          </button>
        )}
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
