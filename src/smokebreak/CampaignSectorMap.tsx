// Interactive blueprint sector map, 3-Phase strata switcher, and 3-round Promotion inspector for Campaign mode.

import { useEffect, useState } from 'react';
import {
  ENVIRONMENTS,
  getEnvironment,
  type CampaignPhaseId,
  type EnvironmentId,
  type SmokeEnvironment,
} from './EnvironmentDeck';
import {
  CAMPAIGN_PHASES,
  getCornyHypeCopy,
  getDragRatio,
  getUnlockedPhase,
  isPhasePromotionUnlocked,
} from './smokeBreak';
import { type LeaderboardEntry, type PlayerProfile } from './shiftStorage';

const LockSvg = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const CheckSvg = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const AwardSvg = () => (
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
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);

const hexColor = (num: number): string => `#${num.toString(16).padStart(6, '0')}`;

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
  const [selectedPhase, setSelectedPhase] = useState<CampaignPhaseId>(currentEnv.phase);
  const [selectedSectorId, setSelectedSectorId] = useState<EnvironmentId>(currentEnv.id);
  const [inspectingPromo, setInspectingPromo] = useState<boolean>(false);

  useEffect(() => {
    setSelectedPhase(currentEnv.phase);
    setSelectedSectorId(currentEnv.id);
  }, [currentEnv.id, currentEnv.phase]);

  const smokedByEnv: Partial<Record<EnvironmentId, number>> = {
    ...profile.smokedByEnvironment,
  };
  const hasAnySectorSmoked = Object.values(smokedByEnv).some(v => (v ?? 0) > 0);
  if (!hasAnySectorSmoked && profile.lifetimeSmoked > 0) {
    smokedByEnv.alleyway = profile.lifetimeSmoked;
  }

  const isAdmin = Boolean(profile.isAdmin);
  const promotionRoundsCleared = isAdmin ? 9 : (profile.promotionRoundsCleared ?? 0);
  const unlockedPhase = isAdmin ? 3 : (profile.unlockedPhase ?? getUnlockedPhase(promotionRoundsCleared));
  const isChairman = isAdmin || (profile.isChairman ?? promotionRoundsCleared >= 9);

  const activePhase =
    CAMPAIGN_PHASES.find(p => p.phase === selectedPhase) ?? CAMPAIGN_PHASES[0];
  const phaseSectors = ENVIRONMENTS.filter(s => s.phase === activePhase.phase);
  const hostSector = getEnvironment(activePhase.finalSectorId as EnvironmentId);

  const roundsClearedInPhase = Math.max(
    0,
    Math.min(3, promotionRoundsCleared - (activePhase.phase - 1) * 3)
  );
  const isPhasePromoted = roundsClearedInPhase >= 3;
  const promotionUnlocked =
    isAdmin ||
    isPhasePromoted ||
    (activePhase.phase <= unlockedPhase &&
      isPhasePromotionUnlocked(activePhase.phase, smokedByEnv, isAdmin));
  const nextRoundNumber = roundsClearedInPhase < 3 ? roundsClearedInPhase + 1 : 3;
  const nextRoundTarget =
    activePhase.promotionTargets[roundsClearedInPhase < 3 ? roundsClearedInPhase : 2];

  const activeSector =
    phaseSectors.find(s => s.id === selectedSectorId) ?? phaseSectors[0];
  const isActiveSectorUnlocked = isAdmin || unlockedEnvironments.includes(activeSector.id);
  const smokedInActiveSector = smokedByEnv[activeSector.id] ?? 0;
  const quotaPct = Math.min(
    100,
    Math.round((smokedInActiveSector / activeSector.sectorQuotaRequired) * 100)
  );
  const paceSmoked = Math.max(profile.bestSmoked, smokedInActiveSector);

  const handleSelectPhase = (phaseId: CampaignPhaseId) => {
    setSelectedPhase(phaseId);
    const firstInPhase = ENVIRONMENTS.find(s => s.phase === phaseId) ?? ENVIRONMENTS[0];
    setSelectedSectorId(firstInPhase.id);
    setInspectingPromo(false);
    if (isAdmin || unlockedEnvironments.includes(firstInPhase.id)) {
      onSelectEnvironment(firstInPhase.id);
    }
  };

  const handleSelectSector = (sector: SmokeEnvironment) => {
    setSelectedPhase(sector.phase);
    setSelectedSectorId(sector.id);
    setInspectingPromo(false);
    if (isAdmin || unlockedEnvironments.includes(sector.id)) {
      onSelectEnvironment(sector.id);
    }
  };

  const handleSelectPromotionPin = () => {
    const hostId = activePhase.finalSectorId as EnvironmentId;
    setSelectedSectorId(hostId);
    setInspectingPromo(true);
    if (isAdmin || unlockedEnvironments.includes(hostId)) {
      onSelectEnvironment(hostId);
    }
  };

  return (
    <div
      className="proto-overlay proto-variant-a-map"
      onPointerDown={e => e.stopPropagation()}
      role="region"
      aria-label="Campaign Sector Map"
    >
      <div className="proto-map-shell hud-panel">
        <header className="proto-map-topbar">
          <div className="proto-map-title-group">
            <button type="button" className="proto-nav-back-btn" onClick={onBackToModes}>
              ← Game Modes
            </button>
            <div>
              <span className="eyebrow">
                CAMPAIGN · {activePhase.code} · FACILITY BLUEPRINT
              </span>
              <h2>Campaign Map · Select Your Break Sector</h2>
            </div>
          </div>
          <div className="proto-map-user-pill">
            <span className="status-dot" />
            <span>{profile.callsign}</span>
            <small>· {profile.lifetimeSmoked} lifetime butts</small>
            <small>· {unlockedEnvironments.length}/12 Sectors</small>
            <small className="proto-sync-tag">
              · {isChairman ? 'Chairman of the Ash' : `Promo ${promotionRoundsCleared}/9`}
            </small>
          </div>
        </header>

        <div
          className="proto-phase-strata-bar"
          role="tablist"
          aria-label="Campaign socioeconomic phases"
        >
          {CAMPAIGN_PHASES.map(phase => {
            const phaseId = phase.phase as CampaignPhaseId;
            const unlocked = isAdmin || phaseId <= unlockedPhase;
            const active = phaseId === selectedPhase;
            const clearedCount = isAdmin
              ? 4
              : ENVIRONMENTS.filter(
                  s => s.phase === phaseId && (smokedByEnv[s.id] ?? 0) >= s.sectorQuotaRequired
                ).length;
            return (
              <button
                key={phaseId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`proto-phase-tab ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                onClick={() => handleSelectPhase(phaseId)}
              >
                <div className="proto-phase-tab-top">
                  <span className="proto-pin-code">{phase.code}</span>
                  <span
                    className={`status-pill ${unlocked ? 'status-pill-success' : 'status-pill-warning'}`}
                  >
                    {unlocked ? (
                      <>
                        <CheckSvg /> {clearedCount}/4 SECTORS
                      </>
                    ) : (
                      <>
                        <LockSvg /> LOCKED
                      </>
                    )}
                  </span>
                </div>
                <strong>{phase.name}</strong>
                <small>{phase.subtitle}</small>
              </button>
            );
          })}
        </div>

        <div className="proto-hype-telemetry-strip" role="status">
          <div className="proto-hype-copy-col">
            <span className="eyebrow">
              IN-SHIFT HYPE & DRAG RATIO TELEMETRY ({paceSmoked} BUTTS PACE)
            </span>
            <strong>{getCornyHypeCopy(paceSmoked).copy}</strong>
          </div>
          <div className="proto-hype-badges">
            <span className="status-pill status-pill-success">
              DRAG RATIO: {getDragRatio(paceSmoked)} DRAGS / BUTT
            </span>
          </div>
        </div>

        <div className="proto-map-layout">
          <div className="proto-blueprint-canvas">
            <div
              className="proto-blueprint-bg"
              style={{ backgroundImage: `url("${activeSector.image}")` }}
            />
            <div className="proto-blueprint-grid-overlay" />

            <svg className="proto-map-paths" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                points="17,70 37,34 56,68 73,30 85,62"
                fill="none"
                stroke="rgba(132, 204, 22, 0.45)"
                strokeWidth="0.8"
                strokeDasharray="2 2"
              />
            </svg>

            {phaseSectors.map((spot, idx) => {
              const unlocked = isAdmin || unlockedEnvironments.includes(spot.id);
              const selected = !inspectingPromo && spot.id === activeSector.id;
              const count = smokedByEnv[spot.id] ?? 0;
              const quotaMet = isAdmin || count >= spot.sectorQuotaRequired;
              return (
                <button
                  key={spot.id}
                  type="button"
                  style={{ left: spot.coords.x, top: spot.coords.y }}
                  className={`proto-map-pin ${selected ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`}
                  onClick={() => handleSelectSector(spot)}
                >
                  <span className="proto-pin-code">{spot.code}</span>
                  <span className="proto-pin-dot">
                    {quotaMet ? <CheckSvg /> : unlocked ? idx + 1 : <LockSvg />}
                  </span>
                  <strong className="proto-pin-title">{spot.name}</strong>
                  <small className="proto-pin-sub">
                    {count}/{spot.sectorQuotaRequired} butts · {spot.risk}
                  </small>
                </button>
              );
            })}

            <button
              type="button"
              style={{ left: '85%', top: '62%' }}
              className={`proto-map-pin proto-map-pin-promotion ${inspectingPromo ? 'selected' : ''} ${!promotionUnlocked ? 'locked' : ''}`}
              onClick={handleSelectPromotionPin}
            >
              <span className="proto-pin-code">PROMOTION · 3 ROUNDS</span>
              <span className="proto-pin-dot">
                {isPhasePromoted ? (
                  <CheckSvg />
                ) : promotionUnlocked ? (
                  <AwardSvg />
                ) : (
                  <LockSvg />
                )}
              </span>
              <strong className="proto-pin-title">{activePhase.promoTitle}</strong>
              <small className="proto-pin-sub">
                {isPhasePromoted
                  ? 'Promoted (3/3 Rounds)'
                  : `R1:${activePhase.promotionTargets[0]} · R2:${activePhase.promotionTargets[1]} · R3:${activePhase.promotionTargets[2]} butts`}
              </small>
            </button>
          </div>

          <aside className="proto-map-inspector">
            <div
              className="proto-inspector-preview"
              style={{ backgroundImage: `url("${activeSector.image}")` }}
            >
              <div className="proto-inspector-chip-row">
                <span className="proto-chip">{activeSector.sector}</span>
                {activeSector.isPlaceholderArt && (
                  <span className="status-pill status-pill-warning">
                    BLUEPRINT SVG PLACEHOLDER
                  </span>
                )}
              </div>
            </div>

            <div className="proto-inspector-body">
              <div className="proto-inspector-title-row">
                <div>
                  <h3>{inspectingPromo ? activePhase.promoTitle : activeSector.name}</h3>
                  <p className="proto-sub">
                    {activeSector.vibe} · {activeSector.weather}
                  </p>
                </div>
                <div
                  className="proto-lighting-pill"
                  title="Three.js EnvironmentLighting palette"
                >
                  <span
                    className="proto-swatch"
                    style={{ background: hexColor(activeSector.lighting.sky) }}
                  />
                  <span
                    className="proto-swatch"
                    style={{ background: hexColor(activeSector.lighting.sun) }}
                  />
                  <span
                    className="proto-swatch"
                    style={{ background: hexColor(activeSector.lighting.rim) }}
                  />
                  <small>3D LIGHT</small>
                </div>
              </div>

              <div className="proto-a-stats-row">
                <div>
                  <span>RISK LEVEL</span>
                  <strong>{activeSector.risk}</strong>
                </div>
                <div>
                  <span>SECTOR QUOTA</span>
                  <strong>
                    {smokedInActiveSector} / {activeSector.sectorQuotaRequired} butts
                  </strong>
                </div>
                <div>
                  <span>YOUR BEST</span>
                  <strong>{profile.bestSmoked} butts</strong>
                </div>
              </div>

              <div className="proto-sector-quota-meter">
                <div className="proto-sector-quota-labels">
                  <span>SECTOR COMPLETION PROGRESS</span>
                  <strong>{quotaPct}%</strong>
                </div>
                <meter
                  value={smokedInActiveSector}
                  max={activeSector.sectorQuotaRequired}
                />
              </div>

              {inspectingPromo ? (
                <div className="proto-promo-gauntlet-box">
                  <div className="proto-promo-gauntlet-head">
                    <div>
                      <span className="eyebrow">3-ROUND CHECKPOINTED PROMOTION</span>
                      <h4>{activePhase.promoTitle}</h4>
                    </div>
                    <span
                      className={`status-pill ${isPhasePromoted ? 'status-pill-success' : 'status-pill-warning'}`}
                    >
                      <AwardSvg />{' '}
                      {isPhasePromoted ? 'PROMOTED' : `ROUND 0${nextRoundNumber} OF 03`}
                    </span>
                  </div>

                  <div className="proto-promo-rounds-grid">
                    {activePhase.promotionTargets.map((target, idx) => {
                      const cleared = idx < roundsClearedInPhase;
                      const current =
                        idx === roundsClearedInPhase &&
                        !isPhasePromoted &&
                        promotionUnlocked;
                      return (
                        <div
                          key={target}
                          className={`proto-promo-round-cell ${cleared ? 'cleared' : ''} ${current ? 'current' : ''}`}
                        >
                          <span className="proto-pin-code">ROUND 0{idx + 1}</span>
                          <strong>{target} BUTTS</strong>
                          <small>
                            {cleared ? 'CHECKPOINT SAVED' : '15.0S SHIFT QUOTA'}
                          </small>
                        </div>
                      );
                    })}
                  </div>

                  <div className="proto-promo-sim-actions">
                    <button
                      type="button"
                      className="ship proto-cta-primary"
                      disabled={!promotionUnlocked}
                      onClick={() => {
                        onSelectEnvironment(hostSector.id);
                        onStartShift();
                      }}
                    >
                      {isPhasePromoted
                        ? `${activePhase.rewardSummary} · Replay ${hostSector.name} (15s Shift) →`
                        : `Start Round 0${nextRoundNumber} (15s Shift) · ${nextRoundTarget} Butts in ${hostSector.name} →`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="proto-mini-board">
                    <span className="eyebrow">SECTOR LEADERBOARD TOP 3</span>
                    <ol className="leaderboard-list">
                      {leaderboardEntries.slice(0, 3).map(entry => (
                        <li
                          key={`${entry.rank}-${entry.callsign}`}
                          className="leaderboard-row"
                        >
                          <span className="leaderboard-rank">#{entry.rank}</span>
                          <span className="leaderboard-callsign">{entry.callsign}</span>
                          <span className="leaderboard-score">{entry.smoked} butts</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <button
                    type="button"
                    className="ship proto-cta-primary"
                    disabled={!isActiveSectorUnlocked}
                    onClick={() => {
                      onSelectEnvironment(activeSector.id);
                      onStartShift();
                    }}
                  >
                    {isActiveSectorUnlocked
                      ? `Deploy to ${activeSector.name} (Start 15s Shift) →`
                      : `Locked · Clear Previous Sector Quota (${activeSector.sectorQuotaRequired} Butts)`}
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
