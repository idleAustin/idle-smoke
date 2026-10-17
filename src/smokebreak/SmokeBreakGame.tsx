import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { isNativeMobile, triggerDragHaptic } from '../platform';
import { EnvironmentDeck, type EnvironmentId, getEnvironment } from './EnvironmentDeck';
import {
  FALLBACK_TAGLINES,
  bootstrapPlayerSession,
  deletePlayerAccount,
  fetchActiveTaglines,
  flushPendingShifts,
  formatWhereTagline,
  getCachedLeaderboard,
  getCachedPlayerProfile,
  loginWithOAuth,
  loginWithPassword,
  resolveShiftEnvironment,
  signOutPlayerSession,
  startShiftSession,
  submitFinishedShift,
  updatePlayerCallsign,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type PlayerProfile,
  type ShiftFinishResult,
  type StartedShiftSession,
  type TaglineCadence,
  type TaglineItem,
} from './shiftClient';
import {
  BREAK_MS,
  PRESSES_PER_CIGARETTE,
  freshShiftSession,
  isEditableEventTarget,
  projectShiftProgression,
  recordShiftDrag,
  remainingMs,
} from './smokeBreak';
import { BreakReportDialog } from './SmokeBreakHud';
import {
  SmokeBreakLobby,
  type GameModeId,
  type LobbyStep,
  type RivalOpponent,
} from './SmokeBreakLobby';
import { SmokeBreakScene } from './SmokeBreakScene';
import { AccountSettingsModal, UserCircleTrigger } from './UserProfileMenu';

/** Smoke Break Simulator: mash space to smoke as many cigarettes as possible before the break ends. */
export function SmokeBreakGame({
  finish,
  environmentId: controlledEnvId,
  onEnvironmentChange,
  lobbyStep: controlledLobbyStep,
  onLobbyStepChange,
  gameMode: controlledGameMode,
  onGameModeChange,
  selectedRival: controlledRival,
  onSelectRival: onControlledRivalChange,
}: {
  finish(): void;
  environmentId?: EnvironmentId;
  onEnvironmentChange?: (id: EnvironmentId) => void;
  lobbyStep?: LobbyStep;
  onLobbyStepChange?: (step: LobbyStep) => void;
  gameMode?: GameModeId;
  onGameModeChange?: (mode: GameModeId) => void;
  selectedRival?: RivalOpponent | null;
  onSelectRival?: (rival: RivalOpponent) => void;
}) {
  const [session, dispatch] = useReducer(recordShiftDrag, undefined, freshShiftSession);
  const { state, pressOffsetsMs } = session;
  const [now, setNow] = useState(() => performance.now());
  const [error, setError] = useState(false);
  const [localEnvId, setLocalEnvId] = useState<EnvironmentId>('alleyway');
  const envId = controlledEnvId ?? localEnvId;
  const setEnvId = onEnvironmentChange ?? setLocalEnvId;
  const env = getEnvironment(envId);

  const [localLobbyStep, setLocalLobbyStep] = useState<LobbyStep>('login');
  const lobbyStep = controlledLobbyStep ?? localLobbyStep;
  const setLobbyStep = onLobbyStepChange ?? setLocalLobbyStep;

  const [localGameMode, setLocalGameMode] = useState<GameModeId>('campaign');
  const gameMode = controlledGameMode ?? localGameMode;
  const setGameMode = onGameModeChange ?? setLocalGameMode;

  const [localRival, setLocalRival] = useState<RivalOpponent | null>(null);
  const selectedRival = controlledRival !== undefined ? controlledRival : localRival;
  const setSelectedRival = onControlledRivalChange ?? setLocalRival;

  const [profile, setProfile] = useState<PlayerProfile>(() => getCachedPlayerProfile());
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse>(() => getCachedLeaderboard());
  const [shiftResult, setShiftResult] = useState<ShiftFinishResult | null>(null);
  const [isQuickCardOpen, setIsQuickCardOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [taglines, setTaglines] = useState<readonly TaglineItem[]>(FALLBACK_TAGLINES);
  const [taglineCadence, setTaglineCadence] = useState<TaglineCadence>('60s');
  const [activeJokeIndex, setActiveJokeIndex] = useState<number>(() =>
    Math.floor(Math.random() * FALLBACK_TAGLINES.length)
  );

  const handleSignOut = async () => {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const { previousCallsign, profile: freshGuest, leaderboard: board } =
        await signOutPlayerSession();
      setProfile(freshGuest);
      setLeaderboard(board);
      setIsQuickCardOpen(false);
      setIsSettingsModalOpen(false);
      setStatusBanner(
        `✓ Signed out of ${previousCallsign} on this device. Your cloud account remains intact.`
      );
      setLobbyStep('login');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to sign out');
    } finally {
      setAccountBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    setAccountBusy(true);
    setAccountError(null);
    try {
      const { deletedCallsign, profile: freshGuest, leaderboard: board } =
        await deletePlayerAccount();
      setProfile(freshGuest);
      setLeaderboard(board);
      setIsQuickCardOpen(false);
      setIsSettingsModalOpen(false);
      setStatusBanner(
        `🗑️ Permanently deleted account ${deletedCallsign} and all associated shifts.`
      );
      setLobbyStep('login');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setAccountBusy(false);
    }
  };

  const isLobbyOpen = lobbyStep !== 'game' && state.startedAt === undefined;
  const isLobbyOpenRef = useRef(isLobbyOpen);
  isLobbyOpenRef.current = isLobbyOpen;

  const done = state.startedAt !== undefined && remainingMs(state, now) === 0;
  const doneRef = useRef(done);
  doneRef.current = done;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SmokeBreakScene>();
  const drag = () => {
    if (isLobbyOpenRef.current) return;
    if (!doneRef.current) dispatch(performance.now());
  };
  /** Touch devices tap anywhere on the screen; every finger that lands is a drag. */
  const [touch] = useState(() => isNativeMobile() || window.matchMedia('(pointer: coarse)').matches);
  const tap = (event: PointerEvent) => {
    if (
      isLobbyOpenRef.current ||
      event.button !== 0 ||
      (event.target as Element).closest(
        'button, input, form, .env-deck, .hud-command, .smoke-result, .proto-overlay, .proto-avatar-anchor, .proto-discord-card, .proto-chatgpt-modal'
      )
    ) {
      return;
    }
    if ((event.pointerType === 'touch' || isNativeMobile()) && !doneRef.current) {
      void triggerDragHaptic();
    }
    drag();
  };
  // A finger still mashing when time runs out must not land on Start new shift.
  const [armed, setArmed] = useState(false);
  const newShift = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (armed) newShift.current?.focus(); }, [armed]);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setArmed(true), 800);
    return () => clearTimeout(id);
  }, [done]);

  useEffect(() => {
    let active = true;
    bootstrapPlayerSession().then(({ profile: loadedProfile, leaderboard: loadedBoard }) => {
      if (!active) return;
      setProfile(loadedProfile);
      setLeaderboard(loadedBoard);
    });
    fetchActiveTaglines().then(collection => {
      if (!active) return;
      setTaglines(collection.taglines);
      setTaglineCadence(collection.cadence);
      if (collection.cadence === 'daily') {
        const dayIndex = Math.floor(Date.now() / 86_400_000) % collection.taglines.length;
        setActiveJokeIndex(dayIndex);
      } else {
        setActiveJokeIndex(Math.floor(Math.random() * collection.taglines.length));
      }
    });
    const onOnline = () => {
      flushPendingShifts().then(({ profile: syncedProfile, leaderboard: syncedBoard }) => {
        if (!active) return;
        setProfile(syncedProfile);
        setLeaderboard(syncedBoard);
      });
    };
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (taglines.length <= 1) return;
    if (taglineCadence === 'daily') {
      const dayIndex = Math.floor(Date.now() / 86_400_000) % taglines.length;
      setActiveJokeIndex(dayIndex);
      return;
    }
    if (taglineCadence === 'per_shift') {
      return;
    }
    const intervalMs =
      taglineCadence === '5m'
        ? 300_000
        : taglineCadence === '15m'
          ? 900_000
          : taglineCadence === '1h'
            ? 3_600_000
            : 60_000;
    const timerId = setInterval(() => {
      setActiveJokeIndex(prev => {
        if (taglines.length <= 1) return 0;
        let next = Math.floor(Math.random() * taglines.length);
        if (next === prev) {
          next = (prev + 1) % taglines.length;
        }
        return next;
      });
    }, intervalMs);
    return () => clearInterval(timerId);
  }, [taglines, taglineCadence]);

  const startedAtUnixRef = useRef<number | null>(null);
  const startedShiftPromiseRef = useRef<Promise<StartedShiftSession | null> | null>(null);
  useEffect(() => {
    if (state.startedAt === undefined || startedShiftPromiseRef.current !== null) return;
    startedAtUnixRef.current = Math.floor(Date.now() / 1000);
    startedShiftPromiseRef.current = startShiftSession({ environmentId: env.id });
  }, [state.startedAt, env.id]);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (!done || submittedRef.current) return;
    submittedRef.current = true;
    let active = true;
    (async () => {
      const startedShift = startedShiftPromiseRef.current ? await startedShiftPromiseRef.current : null;
      const result = await submitFinishedShift({
        shiftId: startedShift?.shiftId,
        environmentId: startedShift?.environmentId ?? env.id,
        pressOffsetsMs,
        startedAt: startedShift?.startedAt ?? startedAtUnixRef.current ?? Math.floor(Date.now() / 1000),
      });
      if (!active) return;
      setShiftResult(result);
      setProfile(result.profile);
      setLeaderboard(result.leaderboard);
    })();
    return () => { active = false; };
  }, [done, env.id, pressOffsetsMs]);

  useEffect(() => {
    try {
      scene.current = new SmokeBreakScene(host.current!);
      scene.current.setEnvironmentLighting(env.lighting);
    }
    catch { setError(true); }
    return () => { scene.current?.dispose(); scene.current = undefined; };
  }, []);

  useEffect(() => {
    scene.current?.setEnvironmentLighting(env.lighting);
  }, [env]);

  // Every press is a drag; the press that finishes a cigarette stubs it out and lights the next.
  const last = useRef(state);
  useEffect(() => {
    const previous = last.current;
    last.current = state;
    if (state === previous) return;
    if (state.smoked > previous.smoked) scene.current?.finish();
    else scene.current?.inhale(state.progress / PRESSES_PER_CIGARETTE);
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (!event.repeat) drag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (state.startedAt === undefined || done) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [state.startedAt, done]);

  const remaining = remainingMs(state, now);
  const seconds = Math.ceil(remaining / 1000);

  const projected = projectShiftProgression(
    profile.lifetimeSmoked,
    profile.bestSmoked,
    profile.unlockedEnvironments,
    done ? state.smoked : 0
  );
  const hasResolvedShift = shiftResult !== null;
  const reportSmoked = hasResolvedShift ? shiftResult.smoked : state.smoked;
  const reportLifetimeSmoked = hasResolvedShift
    ? shiftResult.profile.lifetimeSmoked
    : projected.lifetimeSmoked;
  const reportBestSmoked = hasResolvedShift ? shiftResult.profile.bestSmoked : projected.bestSmoked;
  const reportUnlockedEnvironments = hasResolvedShift
    ? shiftResult.profile.unlockedEnvironments
    : projected.unlockedEnvironments;
  const reportNewlyUnlocked = hasResolvedShift
    ? shiftResult.newlyUnlockedEnvironments
    : projected.newlyUnlockedEnvironments;
  const verifiedEnv = getEnvironment(resolveShiftEnvironment(env.id, profile.unlockedEnvironments));

  const leaderboardEntries: LeaderboardEntry[] =
    leaderboard.entries.length > 0
      ? leaderboard.entries
      : done
        ? [
            {
              rank: 1,
              callsign: profile.callsign,
              smoked: reportSmoked,
              environmentId: verifiedEnv.id,
              completedAt: 0,
            },
          ]
        : [];

  const activeTagline = taglines[activeJokeIndex % Math.max(1, taglines.length)] ?? FALLBACK_TAGLINES[0];

  return <main className="smoke-break" aria-label="Smoke break" onPointerDown={tap}>
    <header className="hud-command hud-panel" onPointerDown={e => e.stopPropagation()}>
      <div className="hud-brand">
        <span className="eyebrow">idleSmoke · {env.sector}</span>
        <strong className="hud-tagline">
          <span className="hud-tagline-brand">idleSmoke</span>
          <span className="hud-tagline-copy">
            {' — '}{formatWhereTagline(activeTagline.jokeText)}
          </span>
        </strong>
      </div>
      <div className="hud-right-group">
        <div className={`shift-clock ${done ? 'complete' : 'running'}`} role="timer" aria-label="Smoke break time remaining">0:{String(seconds).padStart(2, '0')}</div>
        <UserCircleTrigger
          profile={profile}
          isQuickCardOpen={isQuickCardOpen}
          isSettingsModalOpen={isSettingsModalOpen}
          busy={accountBusy}
          showChangeModeAction={lobbyStep === 'game' && state.startedAt === undefined}
          onToggleQuickCard={() => {
            if (isSettingsModalOpen) {
              setIsSettingsModalOpen(false);
            } else {
              setIsQuickCardOpen(open => !open);
            }
          }}
          onOpenSettingsModal={() => {
            setIsQuickCardOpen(false);
            setAccountError(null);
            setIsSettingsModalOpen(true);
          }}
          onChangeMode={() => setLobbyStep('modes')}
          onSignOut={() => void handleSignOut()}
        />
      </div>
    </header>
    <section className="smoke-viewport" aria-label="Break area">
      <div
        className="env-backdrop"
        style={{ backgroundImage: `url(${env.image})` }}
        role="img"
        aria-label={`Environment backdrop: ${env.name}`}
      />
      <div className="env-vignette" />
      <div className="smoke-stage" ref={host} />
      {error && <p className="smoke-fallback">3D view unavailable. You can still smoke: press space or tap the screen.</p>}
      <section className="hud-panel smoke-brief">
        <span className="eyebrow">ON BREAK · {BREAK_MS / 1000} SECONDS · {env.name.toUpperCase()}</span>
        <h2>{done ? 'Break over. Back to the floor.' : state.startedAt === undefined ? 'Light up.' : 'Keep dragging.'}</h2>
        <p>{state.startedAt === undefined
          ? touch
            ? <>Tap anywhere on the screen to take a drag. The clock starts on your first tap.</>
            : <>Mash <kbd>Space</kbd> or click to take a drag. The clock starts on your first drag.</>
          : <>{touch ? 'Keep tapping. ' : ''}Each cigarette takes {PRESSES_PER_CIGARETTE} drags. The next one lights as soon as you stub one out.</>}</p>
      </section>
      <EnvironmentDeck
        current={env}
        onSelect={setEnvId}
        lifetimeSmoked={reportLifetimeSmoked}
        unlockedEnvironments={reportUnlockedEnvironments}
      />
      <section className="hud-panel smoke-tally" aria-label="Smoke break tally">
        <span className="eyebrow">BUTTS IN THE TRAY</span>
        <strong>{state.smoked}</strong>
        <span className="eyebrow">CURRENT CIGARETTE</span>
        <meter aria-label="Current cigarette smoked" value={state.progress} max={PRESSES_PER_CIGARETTE} />
        <span className="eyebrow">BREAK LEFT</span>
        <meter aria-label="Break time left" value={remaining} max={BREAK_MS} />
        <div className="smoke-tally-career" aria-label="Career smoke break stats">
          <span>LIFETIME: {reportLifetimeSmoked}</span>
          <span>BEST: {reportBestSmoked}</span>
          {gameMode === 'h2h' && selectedRival && (
            <span>VS {selectedRival.callsign}: {selectedRival.smoked}</span>
          )}
        </div>
      </section>
      {lobbyStep !== 'game' && state.startedAt === undefined && (
        <SmokeBreakLobby
          step={lobbyStep}
          profile={profile}
          currentEnv={env}
          unlockedEnvironments={reportUnlockedEnvironments}
          leaderboardEntries={leaderboard.entries}
          selectedRival={selectedRival}
          statusBanner={statusBanner}
          onDismissBanner={() => setStatusBanner(null)}
          onSelectEnvironment={setEnvId}
          onSaveCallsign={async nextCallsign => {
            const updated = await updatePlayerCallsign(nextCallsign);
            setProfile(updated);
          }}
          onLoginPassword={async (callsign, password) => {
            const updated = await loginWithPassword(callsign, password);
            setProfile(updated);
          }}
          onLoginOAuth={async (provider, idToken, callsign) => {
            const updated = await loginWithOAuth({ provider, idToken, callsign });
            setProfile(updated);
          }}
          onCompleteLogin={() => setLobbyStep('modes')}
          onSelectMode={mode => {
            setGameMode(mode);
            if (mode === 'campaign') setLobbyStep('map');
            else if (mode === 'h2h') setLobbyStep('h2h');
            else setLobbyStep('game');
          }}
          onSelectRival={setSelectedRival}
          onSetStep={setLobbyStep}
          onStartShift={() => setLobbyStep('game')}
        />
      )}
      {isSettingsModalOpen && (
        <AccountSettingsModal
          profile={profile}
          busy={accountBusy}
          error={accountError}
          onClose={() => setIsSettingsModalOpen(false)}
          onSaveCallsign={async nextCallsign => {
            const updated = await updatePlayerCallsign(nextCallsign);
            setProfile(updated);
          }}
          onSignOut={() => void handleSignOut()}
          onDeleteAccount={() => void handleDeleteAccount()}
          onTaglinesUpdated={next => {
            if (next.taglines.length > 0) {
              setTaglines(next.taglines);
              setActiveJokeIndex(idx => idx % next.taglines.length);
            }
            setTaglineCadence(next.cadence);
          }}
        />
      )}
      {done && (
        <BreakReportDialog
          verifiedEnvironment={verifiedEnv}
          smoked={reportSmoked}
          lifetimeSmoked={reportLifetimeSmoked}
          bestSmoked={reportBestSmoked}
          newlyUnlockedEnvironments={reportNewlyUnlocked}
          profile={profile}
          leaderboardEntries={leaderboardEntries}
          gameMode={gameMode}
          rival={selectedRival}
          armed={armed}
          newShiftRef={newShift}
          onFinish={finish}
          onOpenModes={() => {
            setLobbyStep('modes');
            finish();
          }}
        />
      )}
    </section>
  </main>;
}

