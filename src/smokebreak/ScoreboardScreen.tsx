// Standalone Global Scoreboard screen featuring a 3-tier stepped podium rostrum, phase scope filters, challenger list, and sticky player standing bar.

import { useState } from 'react';
import { getEnvironment, type EnvironmentId } from './EnvironmentDeck';
import { OperatorAvatar } from './OperatorAvatar';
import {
  type LeaderboardEntry,
  type LeaderboardResponse,
  type PlayerProfile,
} from './shiftStorage';
import { BREAK_MS, getDragRatio } from './smokeBreak';
import { type SmokeSession } from './smokeSessionClient';

type ScoreboardScopeId = 'ALL' | 'P1' | 'P2' | 'P3' | 'SESSION';

export const SCOREBOARD_SCOPES: readonly { id: ScoreboardScopeId; label: string }[] = [
  { id: 'ALL', label: 'ALL SECTORS' },
  { id: 'P1', label: 'PHASE 01' },
  { id: 'P2', label: 'PHASE 02' },
  { id: 'P3', label: 'PHASE 03' },
  { id: 'SESSION', label: 'SMOKE SESSION' },
];

const PODIUM_SLOTS = [2, 1, 3] as const;

const TrophySvg = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

export function shouldOpenScoreboardFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('scoreboard');
}

export function estimateShiftDrags(smoked: number): number {
  let drags = 0;
  for (let i = 0; i < smoked; i += 1) drags += getDragRatio(i);
  return drags;
}

export function formatShiftDragPace(smoked: number): string {
  return `${(estimateShiftDrags(smoked) / (BREAK_MS / 1000)).toFixed(1)} drags/s`;
}

function formatRelativeAge(completedAt: number): string {
  if (!completedAt) return 'VERIFIED';
  const diffMin = Math.max(1, Math.floor((Math.floor(Date.now() / 1000) - completedAt) / 60));
  if (diffMin < 60) return `${diffMin}M AGO`;
  const diffHr = Math.floor(diffMin / 60);
  return diffHr < 24 ? `${diffHr}H AGO` : `${Math.floor(diffHr / 24)}D AGO`;
}

function resolveRankEntries(
  entries: readonly LeaderboardEntry[],
  profile: PlayerProfile,
  scope: ScoreboardScopeId
): LeaderboardEntry[] {
  const merged = [...entries];
  const latestEnv =
    profile.unlockedEnvironments[profile.unlockedEnvironments.length - 1] ?? 'alleyway';
  if (
    profile.bestSmoked > 0 &&
    !merged.some(e => e.callsign === profile.callsign && e.smoked >= profile.bestSmoked)
  ) {
    merged.push({
      rank: merged.length + 1,
      callsign: profile.callsign,
      smoked: profile.bestSmoked,
      environmentId: latestEnv,
      completedAt: 0,
      avatarConfig: profile.avatarConfig,
    });
  }
  return merged
    .filter(e => {
      if (scope === 'ALL' || scope === 'SESSION') return true;
      const targetPhase = scope === 'P1' ? 1 : scope === 'P2' ? 2 : 3;
      return getEnvironment(e.environmentId).phase === targetPhase;
    })
    .sort((a, b) => b.smoked - a.smoked || a.completedAt - b.completedAt)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export function ScoreboardScreen({
  leaderboard,
  profile,
  unlockedEnvironments,
  activeSmokeSession,
  onBackToModes,
  onDeployToSector,
  onOpenSmokeSession,
}: {
  leaderboard: LeaderboardResponse;
  profile: PlayerProfile;
  unlockedEnvironments: readonly EnvironmentId[];
  activeSmokeSession: SmokeSession | null;
  onBackToModes: () => void;
  onDeployToSector: (envId: EnvironmentId) => void;
  onOpenSmokeSession: () => void;
}) {
  const [scope, setScope] = useState<ScoreboardScopeId>('ALL');
  const [expandedRank, setExpandedRank] = useState<number | null>(null);

  const filtered = resolveRankEntries(leaderboard.entries, profile, scope);
  const challengers = filtered.slice(3, 10);
  const topSmoked = filtered[0]?.smoked ?? 0;
  const playerRow = filtered.find(e => e.callsign === profile.callsign);
  const defaultDeployEnv =
    unlockedEnvironments[unlockedEnvironments.length - 1] ?? 'alleyway';

  const totalSmoked = Math.max(leaderboard.stats.totalSmoked, profile.lifetimeSmoked);
  const totalShifts = Math.max(leaderboard.stats.totalShifts, profile.shiftsCompleted);
  const totalPlayers = Math.max(leaderboard.stats.totalPlayers, filtered.length, 1);

  return (
    <div
      className="proto-overlay proto-scoreboard-screen"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Global Scoreboard"
    >
      <div className="proto-map-shell proto-sb-shell hud-panel">
        <header className="proto-map-topbar proto-sb-topbar">
          <div className="proto-map-title-group">
            <button type="button" className="proto-nav-back-btn" onClick={onBackToModes}>
              ← Game Modes
            </button>
            <div>
              <span className="eyebrow">
                FACILITY TELEMETRY · VERIFIED 15.0S SHIFT STANDINGS
              </span>
              <h2>Global Scoreboard &amp; Podium</h2>
            </div>
          </div>

          <div className="proto-map-user-pill proto-sb-telemetry-pill">
            <span className="status-dot" />
            <span>{totalSmoked.toLocaleString()} butts</span>
            <small>· {totalShifts.toLocaleString()} shifts</small>
            <small className="proto-sync-tag">· {totalPlayers.toLocaleString()} operators</small>
          </div>
        </header>

        <div className="proto-sb-variant-a">
          <div className="proto-sb-scope-bar" role="tablist" aria-label="Scoreboard scope filter">
            {SCOREBOARD_SCOPES.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={scope === tab.id}
                className={`proto-sb-scope-pill ${scope === tab.id ? 'active' : ''}`}
                onClick={() => setScope(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <span className="proto-sb-scope-count">{filtered.length} VERIFIED SHIFTS</span>
          </div>

          {scope === 'SESSION' ? (
            <div className="proto-sb-session-box">
              <div className="proto-sb-session-head">
                <div>
                  <span className="eyebrow">2-DIGIT PARTY ROOM · LIVE CREW STANDINGS</span>
                  <h3>
                    {activeSmokeSession
                      ? `Smoke Session #${activeSmokeSession.code}`
                      : 'No Active Smoke Session Joined'}
                  </h3>
                </div>
                <button
                  type="button"
                  className="ship proto-sb-inline-cta"
                  onClick={onOpenSmokeSession}
                >
                  Open Smoke Session Lobby →
                </button>
              </div>
              {activeSmokeSession ? (
                <ol className="proto-sb-challenger-list">
                  {activeSmokeSession.participants.map(p => (
                    <li
                      key={p.playerId}
                      className={`proto-sb-row ${p.callsign === profile.callsign ? 'is-you' : ''}`}
                    >
                      <div className="proto-sb-row-main">
                        <span className="proto-sb-rank">#{p.rank}</span>
                        <span className="proto-sb-avatar">
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
                        <div className="proto-sb-ident">
                          <strong>{p.callsign}</strong>
                          <small>
                            {p.finished
                              ? `${p.tapCount ?? 0} verified drags`
                              : 'SMOKING IN PROGRESS'}
                          </small>
                        </div>
                        <strong className="proto-sb-score">{p.smoked ?? 0} butts</strong>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="proto-sb-empty">
                  <p>
                    Start or join a 2-digit Smoke Session room to race coworkers on a synchronized
                    3-2-1 countdown.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="proto-sb-podium-stage" aria-label="Top 3 Podium">
                {PODIUM_SLOTS.map(slotRank => {
                  const entry = filtered.find(e => e.rank === slotRank);
                  const rankLabel =
                    slotRank === 1 ? 'CHAMPION' : slotRank === 2 ? '2ND PLACE' : '3RD PLACE';
                  if (!entry) {
                    return (
                      <article
                        key={`open-slot-${slotRank}`}
                        className={`proto-sb-podium-col rank-${slotRank} is-unclaimed`}
                      >
                        <div className="proto-sb-podium-figure">
                          <span className="proto-sb-podium-crown">
                            {slotRank === 1 && <TrophySvg />} {rankLabel}
                          </span>
                          <div className="proto-sb-podium-avatar-wrap">
                            <div className="proto-sb-podium-avatar">—</div>
                            <span className="proto-sb-podium-medal">#{slotRank}</span>
                          </div>
                          <strong className="proto-sb-podium-callsign">OPEN SLOT</strong>
                          <span className="proto-sb-podium-sector">UNCLAIMED</span>
                        </div>
                        <div className="proto-sb-pedestal">
                          <span className="proto-sb-pedestal-watermark" aria-hidden="true">
                            0{slotRank}
                          </span>
                          <div className="proto-sb-podium-score">
                            <strong>—</strong>
                            <span>BUTTS / 15S</span>
                          </div>
                          <span className="proto-sb-podium-pace">No shift logged</span>
                          <button
                            type="button"
                            className="proto-sb-sector-jump"
                            onClick={() => onDeployToSector(defaultDeployEnv)}
                          >
                            Claim #{slotRank} Slot →
                          </button>
                        </div>
                      </article>
                    );
                  }

                  const sec = getEnvironment(entry.environmentId);
                  const unlocked =
                    Boolean(profile.isAdmin) || unlockedEnvironments.includes(sec.id);
                  return (
                    <article
                      key={`${entry.rank}-${entry.callsign}`}
                      className={`proto-sb-podium-col rank-${slotRank} ${entry.callsign === profile.callsign ? 'is-you' : ''}`}
                    >
                      <div className="proto-sb-podium-figure">
                        <span className="proto-sb-podium-crown">
                          {slotRank === 1 && <TrophySvg />} {rankLabel}
                        </span>
                        <div className="proto-sb-podium-avatar-wrap">
                          <div className="proto-sb-podium-avatar">
                            <OperatorAvatar
                              callsign={entry.callsign}
                              isAdmin={entry.callsign === profile.callsign ? profile.isAdmin : false}
                              avatarConfig={
                                entry.callsign === profile.callsign
                                  ? (entry.avatarConfig ?? profile.avatarConfig)
                                  : entry.avatarConfig
                              }
                            />
                          </div>
                          <span className="proto-sb-podium-medal">#{slotRank}</span>
                        </div>
                        <strong className="proto-sb-podium-callsign">
                          {entry.callsign}
                          {entry.callsign === profile.callsign && (
                            <span className="proto-sb-you-tag">YOU</span>
                          )}
                        </strong>
                        <span className="proto-sb-podium-sector">
                          {sec.code} · {sec.name}
                        </span>
                      </div>

                      <div className="proto-sb-pedestal">
                        <span className="proto-sb-pedestal-watermark" aria-hidden="true">
                          0{slotRank}
                        </span>
                        <div className="proto-sb-podium-score">
                          <strong>{entry.smoked}</strong>
                          <span>BUTTS / 15S</span>
                        </div>
                        <span className="proto-sb-podium-pace">
                          {formatShiftDragPace(entry.smoked)}
                        </span>
                        <button
                          type="button"
                          className="proto-sb-sector-jump"
                          disabled={!unlocked}
                          onClick={() => onDeployToSector(sec.id)}
                        >
                          {unlocked ? `Smoke ${sec.name} →` : `${sec.code} [LOCKED]`}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {challengers.length > 0 && (
                <ol className="proto-sb-challenger-list" aria-label="Challenger rankings">
                  {challengers.map(entry => {
                    const sec = getEnvironment(entry.environmentId);
                    const unlocked =
                      Boolean(profile.isAdmin) || unlockedEnvironments.includes(sec.id);
                    const expanded = expandedRank === entry.rank;
                    return (
                      <li
                        key={`${entry.rank}-${entry.callsign}-${entry.completedAt}`}
                        className={`proto-sb-row ${entry.callsign === profile.callsign ? 'is-you' : ''} ${expanded ? 'expanded' : ''}`}
                      >
                        <button
                          type="button"
                          className="proto-sb-row-main"
                          aria-expanded={expanded}
                          onClick={() => setExpandedRank(expanded ? null : entry.rank)}
                        >
                          <span className="proto-sb-rank">#{entry.rank}</span>
                          <span className="proto-sb-avatar">
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
                          <div className="proto-sb-ident">
                            <strong>
                              {entry.callsign}
                              {entry.callsign === profile.callsign && (
                                <span className="proto-sb-you-tag">YOU</span>
                              )}
                            </strong>
                            <small>
                              {sec.code} · {sec.name}
                            </small>
                          </div>
                          <span className="proto-sb-gap-chip">
                            -{Math.max(0, topSmoked - entry.smoked)} butts
                          </span>
                          <strong className="proto-sb-score">{entry.smoked} butts</strong>
                        </button>
                        {expanded && (
                          <div className="proto-sb-row-drawer">
                            <div>
                              <span>SECTOR</span>
                              <strong>{sec.sector}</strong>
                            </div>
                            <div>
                              <span>DRAG PACE</span>
                              <strong>{formatShiftDragPace(entry.smoked)}</strong>
                            </div>
                            <div>
                              <span>LOGGED</span>
                              <strong>{formatRelativeAge(entry.completedAt)}</strong>
                            </div>
                            <button
                              type="button"
                              className="ship proto-sb-drawer-btn"
                              disabled={!unlocked}
                              onClick={() => onDeployToSector(sec.id)}
                            >
                              {unlocked ? `Deploy to ${sec.name} →` : 'Sector Locked'}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}

          <footer className="proto-sb-you-bar" aria-label="Your current standing">
            <div className="proto-sb-you-left">
              <span className="proto-sb-avatar you">
                <OperatorAvatar
                  callsign={profile.callsign}
                  isAdmin={profile.isAdmin}
                  avatarConfig={profile.avatarConfig}
                />
              </span>
              <div>
                <span className="eyebrow">YOUR STANDING · {profile.callsign}</span>
                <strong>
                  {playerRow
                    ? `Rank #${playerRow.rank} (${playerRow.smoked} butts)`
                    : `Unranked · Best ${profile.bestSmoked} butts`}
                </strong>
              </div>
            </div>
            <div className="proto-sb-you-metrics">
              <div>
                <span>BEST SHIFT</span>
                <strong>{profile.bestSmoked} butts</strong>
              </div>
              <div>
                <span>LIFETIME</span>
                <strong>{profile.lifetimeSmoked} butts</strong>
              </div>
              <div>
                <span>SHIFTS</span>
                <strong>{profile.shiftsCompleted}</strong>
              </div>
            </div>
            <button
              type="button"
              className="ship proto-sb-you-cta"
              onClick={() => onDeployToSector(defaultDeployEnv)}
            >
              Deploy Shift to Climb →
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
