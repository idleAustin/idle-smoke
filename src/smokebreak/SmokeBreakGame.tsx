// Top-level Smoke Break game controller managing shift state, 3D scene lifecycle, input handlers, and HUD/lobby overlays.

import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { isNativeMobile, triggerDragHaptic } from '../platform';
import { EnvironmentDeck, type EnvironmentId, getEnvironment } from './EnvironmentDeck';
import {
  FALLBACK_TAGLINES, deletePlayerAccount, fetchActiveTaglines,
  loginWithOAuth, loginWithPassword, signOutPlayerSession,
  updatePlayerAvatarConfig, updatePlayerCallsign,
} from './accountClient';
import {
  bootstrapPlayerSession, flushPendingShifts, startShiftSession, submitFinishedShift,
} from './shiftClient';
import {
  getCachedLeaderboard, getCachedPlayerProfile, resolveShiftEnvironment,
  type LeaderboardEntry, type LeaderboardResponse, type PlayerProfile,
  type ShiftFinishResult, type StartedShiftSession, type TaglineCadence, type TaglineItem,
} from './shiftStorage';
import {
  freshShiftSession, getDragRatio, isEditableEventTarget, isShiftDrumKeyCode,
  projectShiftProgression, recordShiftDrag, remainingMs,
} from './smokeBreak';
import {
  BreakReportDialog, SmokeBriefPanel, SmokeCommandHeader, SmokeCountdownOverlay, SmokeTallyPanel,
  getActivePromotionBanner,
} from './SmokeBreakHud';
import {
  SmokeBreakLobby, type GameModeId, type LobbyStep,
} from './SmokeBreakLobby';
import { SmokeBreakScene } from './SmokeBreakScene';
import { fetchSmokeSession, pickFresherSmokeSession, type SmokeSession } from './smokeSessionClient';
import { AccountSettingsModal } from './UserProfileMenu';
import { shouldOpenProfilePrototypeFromUrl } from './UserProfilePrototype';

/** Smoke Break Simulator: mash space to smoke as many cigarettes as possible before the break ends. */
export function SmokeBreakGame({
  finish, environmentId: controlledEnvId, onEnvironmentChange,
  lobbyStep: controlledLobbyStep, onLobbyStepChange,
  gameMode: controlledGameMode, onGameModeChange,
  activeSmokeSession: controlledSmokeSession, onSmokeSessionChange,
}: {
  finish(): void;
  environmentId?: EnvironmentId;
  onEnvironmentChange?: (id: EnvironmentId) => void;
  lobbyStep?: LobbyStep;
  onLobbyStepChange?: (step: LobbyStep) => void;
  gameMode?: GameModeId;
  onGameModeChange?: (mode: GameModeId) => void;
  activeSmokeSession?: SmokeSession | null;
  onSmokeSessionChange?: (session: SmokeSession | null) => void;
}) {
  const [session, dispatch] = useReducer(recordShiftDrag, undefined, freshShiftSession);
  const { state, pressOffsetsMs } = session;
  const [now, setNow] = useState(() => performance.now());
  const [error, setError] = useState(false);
  const [localEnvId, setLocalEnvId] = useState<EnvironmentId>('alleyway');
  const envId = controlledEnvId ?? localEnvId;
  const setEnvId = onEnvironmentChange ?? setLocalEnvId;
  const env = getEnvironment(envId);

  const [profile, setProfile] = useState<PlayerProfile>(() => getCachedPlayerProfile());
  const [localLobbyStep, setLocalLobbyStep] = useState<LobbyStep>(() =>
    profile.authProvider && profile.authProvider !== 'guest' ? 'modes' : 'login'
  );
  const lobbyStep = controlledLobbyStep ?? localLobbyStep;
  const setLobbyStep = onLobbyStepChange ?? setLocalLobbyStep;
  const lobbyStepRef = useRef(lobbyStep);
  lobbyStepRef.current = lobbyStep;

  const [localGameMode, setLocalGameMode] = useState<GameModeId>('campaign');
  const gameMode = controlledGameMode ?? localGameMode;
  const setGameMode = onGameModeChange ?? setLocalGameMode;

  const [localSmokeSession, setLocalSmokeSession] = useState<SmokeSession | null>(null);
  const activeSmokeSession =
    controlledSmokeSession !== undefined ? controlledSmokeSession : localSmokeSession;
  const setActiveSmokeSession = onSmokeSessionChange ?? setLocalSmokeSession;
  const activeSmokeSessionRef = useRef<SmokeSession | null>(activeSmokeSession);
  activeSmokeSessionRef.current = activeSmokeSession;
  const updateActiveSmokeSession = (next: SmokeSession | null) => {
    const resolved =
      next === null ? null : pickFresherSmokeSession(activeSmokeSessionRef.current, next);
    activeSmokeSessionRef.current = resolved;
    setActiveSmokeSession(resolved);
  };

  const [countdownRemaining, setCountdownRemaining] = useState(0);
  const countdownStartedRef = useRef(false);

  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse>(() => getCachedLeaderboard());
  const [shiftResult, setShiftResult] = useState<ShiftFinishResult | null>(null);
  const [isQuickCardOpen, setIsQuickCardOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(() =>
    shouldOpenProfilePrototypeFromUrl()
  );
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
      const { previousCallsign, profile: freshGuest, leaderboard: board } = await signOutPlayerSession();
      setProfile(freshGuest);
      setLeaderboard(board);
      updateActiveSmokeSession(null);
      setIsQuickCardOpen(false);
      setIsSettingsModalOpen(false);
      setStatusBanner(`✓ Signed out of ${previousCallsign} on this device. Your cloud account remains intact.`);
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
      const { deletedCallsign, profile: freshGuest, leaderboard: board } = await deletePlayerAccount();
      setProfile(freshGuest);
      setLeaderboard(board);
      updateActiveSmokeSession(null);
      setIsQuickCardOpen(false);
      setIsSettingsModalOpen(false);
      setStatusBanner(`🗑️ Permanently deleted account ${deletedCallsign} and all associated shifts.`);
      setLobbyStep('login');
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setAccountBusy(false);
    }
  };

  useEffect(() => {
    if (
      lobbyStep !== 'game' ||
      gameMode !== 'h2h' ||
      !activeSmokeSession ||
      state.startedAt !== undefined ||
      countdownStartedRef.current
    ) {
      return;
    }
    countdownStartedRef.current = true;
    setCountdownRemaining(3);
  }, [lobbyStep, gameMode, activeSmokeSession, state.startedAt]);

  useEffect(() => {
    if (countdownRemaining <= 0) return;
    const timer = setTimeout(() => {
      if (countdownRemaining === 1) {
        setCountdownRemaining(0);
        const startNow = performance.now();
        setNow(startNow);
        dispatch({ type: 'start_clock', now: startNow });
      } else {
        setCountdownRemaining(c => c - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdownRemaining]);

  const isLobbyOpen = (lobbyStep !== 'game' && state.startedAt === undefined) || countdownRemaining > 0;
  const isLobbyOpenRef = useRef(isLobbyOpen);
  isLobbyOpenRef.current = isLobbyOpen;

  const done = state.startedAt !== undefined && remainingMs(state, now) === 0;
  const doneRef = useRef(done);
  doneRef.current = done;
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SmokeBreakScene>();
  const drag = () => {
    if (!isLobbyOpenRef.current && !doneRef.current) dispatch(performance.now());
  };
  /** Touch devices tap anywhere on the screen; every finger that lands is a drag. */
  const [touch] = useState(() => isNativeMobile() || window.matchMedia('(pointer: coarse)').matches);
  const tap = (event: PointerEvent) => {
    if (
      isLobbyOpenRef.current ||
      event.button !== 0 ||
      (event.target as Element).closest(
        'button, input, form, .env-deck, .hud-command, .smoke-result, .proto-overlay, .proto-avatar-anchor, .proto-discord-card, .proto-chatgpt-modal, .proto-switcher'
      )
    ) return;
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
      if (loadedProfile.authProvider && loadedProfile.authProvider !== 'guest' && lobbyStepRef.current === 'login') {
        setLobbyStep('modes');
      }
    });
    fetchActiveTaglines().then(collection => {
      if (!active) return;
      setTaglines(collection.taglines);
      setTaglineCadence(collection.cadence);
      if (collection.cadence === 'daily') {
        setActiveJokeIndex(Math.floor(Date.now() / 86_400_000) % collection.taglines.length);
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
      setActiveJokeIndex(Math.floor(Date.now() / 86_400_000) % taglines.length);
      return;
    }
    if (taglineCadence === 'per_shift') return;
    const intervalMs =
      taglineCadence === '5m' ? 300_000
      : taglineCadence === '15m' ? 900_000
      : taglineCadence === '1h' ? 3_600_000
      : 60_000;
    const timerId = setInterval(() => {
      setActiveJokeIndex(prev => {
        if (taglines.length <= 1) return 0;
        let next = Math.floor(Math.random() * taglines.length);
        if (next === prev) next = (prev + 1) % taglines.length;
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
    startedShiftPromiseRef.current = startShiftSession({
      environmentId: env.id,
      sessionId: gameMode === 'h2h' ? activeSmokeSession?.sessionId : undefined,
    });
  }, [state.startedAt, env.id, gameMode, activeSmokeSession?.sessionId]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submittedRef = useRef(false);
  useEffect(() => {
    if (!done || submittedRef.current) return;
    submittedRef.current = true;
    void (async () => {
      const startedShift = startedShiftPromiseRef.current ? await startedShiftPromiseRef.current : null;
      const result = await submitFinishedShift({
        shiftId: startedShift?.shiftId,
        environmentId: startedShift?.environmentId ?? env.id,
        pressOffsetsMs,
        startedAt: startedShift?.startedAt ?? startedAtUnixRef.current ?? Math.floor(Date.now() / 1000),
        sessionId: gameMode === 'h2h' ? activeSmokeSession?.sessionId : undefined,
      });
      if (!mountedRef.current) return;
      setShiftResult(result);
      setProfile(result.profile);
      setLeaderboard(result.leaderboard);
      if (result.smokeSession) {
        updateActiveSmokeSession(result.smokeSession);
      }
    })();
  }, [done, env.id, pressOffsetsMs, gameMode, activeSmokeSession?.sessionId]);

  const resolvedSmokeSession = pickFresherSmokeSession(activeSmokeSession, shiftResult?.smokeSession);
  const activeSessionId = resolvedSmokeSession?.sessionId;
  const isSessionCompleted = Boolean(
    resolvedSmokeSession?.status === 'completed' &&
      resolvedSmokeSession.participants.every(p => p.finished)
  );

  useEffect(() => {
    if (!done || gameMode !== 'h2h' || !activeSessionId || isSessionCompleted) {
      return;
    }
    let mounted = true;
    const poll = async () => {
      const updated = await fetchSmokeSession(activeSessionId);
      if (!mounted || !updated) return;
      updateActiveSmokeSession(updated);
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [done, gameMode, activeSessionId, isSessionCompleted]);

  useEffect(() => {
    try {
      scene.current = new SmokeBreakScene(host.current!);
      scene.current.setEnvironmentLighting(env.lighting);
    } catch { setError(true); }
    return () => { scene.current?.dispose(); scene.current = undefined; };
  }, []);

  useEffect(() => { scene.current?.setEnvironmentLighting(env.lighting); }, [env]);

  // Every press is a drag; the press that finishes a cigarette stubs it out and lights the next.
  const last = useRef(state);
  useEffect(() => {
    const previous = last.current;
    last.current = state;
    if (state === previous || state.progress === previous.progress && state.smoked === previous.smoked) return;
    if (state.smoked > previous.smoked) scene.current?.finish();
    else scene.current?.inhale(state.progress / getDragRatio(state.smoked));
  }, [state]);

  const startedRef = useRef(state.startedAt !== undefined);
  startedRef.current = state.startedAt !== undefined;
  const isSettingsOpenRef = useRef(isSettingsModalOpen);
  isSettingsOpenRef.current = isSettingsModalOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      if (isLobbyOpenRef.current || doneRef.current || isSettingsOpenRef.current) return;
      if (!isShiftDrumKeyCode(event.code)) return;
      // Before shift starts, only Space starts the shift on keyboard (Digit1..Digit4 are EnvironmentDeck hotkeys)
      if (!startedRef.current && event.code !== 'Space') return;
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

  const shiftEnvIdRef = useRef<EnvironmentId>('alleyway');
  if (state.startedAt === undefined) {
    shiftEnvIdRef.current =
      gameMode === 'h2h' && activeSmokeSession
        ? activeSmokeSession.environmentId
        : resolveShiftEnvironment(env.id, profile.unlockedEnvironments);
  }
  const effectiveShiftEnvId = shiftEnvIdRef.current;

  const projected = projectShiftProgression(
    profile.lifetimeSmoked,
    profile.bestSmoked,
    profile.unlockedEnvironments,
    done ? state.smoked : 0,
    {
      environmentId: effectiveShiftEnvId,
      smokedByEnvironment: profile.smokedByEnvironment,
      promotionRoundsCleared: profile.promotionRoundsCleared,
      isAdmin: profile.isAdmin,
    }
  );
  const hasResolvedShift = shiftResult !== null;
  const reportSmoked = hasResolvedShift ? shiftResult.smoked : state.smoked;
  const reportLifetimeSmoked = hasResolvedShift ? shiftResult.profile.lifetimeSmoked : projected.lifetimeSmoked;
  const reportBestSmoked = hasResolvedShift ? shiftResult.profile.bestSmoked : projected.bestSmoked;
  const reportUnlockedEnvironments = hasResolvedShift
    ? shiftResult.profile.unlockedEnvironments : projected.unlockedEnvironments;
  const reportNewlyUnlocked = hasResolvedShift
    ? shiftResult.newlyUnlockedEnvironments : projected.newlyUnlockedEnvironments;
  const verifiedEnv = getEnvironment(effectiveShiftEnvId);
  const activePromotionBanner = getActivePromotionBanner(env, profile);

  const leaderboardEntries: LeaderboardEntry[] =
    leaderboard.entries.length > 0
      ? leaderboard.entries
      : done
        ? [{ rank: 1, callsign: profile.callsign, smoked: reportSmoked, environmentId: verifiedEnv.id, completedAt: 0, avatarConfig: profile.avatarConfig }]
        : [];

  const activeTagline = taglines[activeJokeIndex % Math.max(1, taglines.length)] ?? FALLBACK_TAGLINES[0];

  return (
    <main className="smoke-break" aria-label="Smoke break" onPointerDown={tap}>
      <SmokeCommandHeader
        env={env} activeJokeText={activeTagline.jokeText} done={done} seconds={seconds}
        profile={profile} isQuickCardOpen={isQuickCardOpen} isSettingsModalOpen={isSettingsModalOpen}
        accountBusy={accountBusy}
        showChangeModeAction={lobbyStep === 'game' && state.startedAt === undefined && countdownRemaining === 0}
        onToggleQuickCard={() => {
          if (isSettingsModalOpen) setIsSettingsModalOpen(false);
          else setIsQuickCardOpen(open => !open);
        }}
        onOpenSettingsModal={() => { setIsQuickCardOpen(false); setAccountError(null); setIsSettingsModalOpen(true); }}
        onChangeMode={() => {
          updateActiveSmokeSession(null);
          setLobbyStep('modes');
        }}
        onOpenScoreboard={() => {
          updateActiveSmokeSession(null);
          setLobbyStep('scoreboard');
        }}
        onSignOut={() => void handleSignOut()}
      />
      <section className="smoke-viewport" aria-label="Break area">
        <div
          className="env-backdrop" style={{ backgroundImage: `url(${env.image})` }}
          role="img" aria-label={`Environment backdrop: ${env.name}`}
        />
        <div className="env-vignette" />
        <div className="smoke-stage" ref={host} />
        {error && (
          <p className="smoke-fallback">3D view unavailable. You can still smoke: press space or tap the screen.</p>
        )}
        <SmokeBriefPanel
          envName={env.name}
          done={done}
          started={state.startedAt !== undefined}
          touch={touch}
          smoked={state.smoked}
          promotionBanner={activePromotionBanner}
        />
        <EnvironmentDeck
          current={env}
          onSelect={setEnvId}
          lifetimeSmoked={reportLifetimeSmoked}
          unlockedEnvironments={reportUnlockedEnvironments}
          unlockedPhase={profile.isAdmin ? 3 : profile.unlockedPhase}
          shiftStarted={state.startedAt !== undefined}
          hotkeysDisabled={isLobbyOpen || isSettingsModalOpen}
        />
        <SmokeTallyPanel
          smoked={state.smoked} progress={state.progress} remaining={remaining}
          lifetimeSmoked={reportLifetimeSmoked} bestSmoked={reportBestSmoked}
        />
        {countdownRemaining > 0 && (
          <SmokeCountdownOverlay count={countdownRemaining} sessionCode={activeSmokeSession?.code} />
        )}
        {lobbyStep !== 'game' && state.startedAt === undefined && (
          <SmokeBreakLobby
            step={lobbyStep} profile={profile} currentEnv={env}
            unlockedEnvironments={reportUnlockedEnvironments}
            leaderboardEntries={leaderboard.entries}
            leaderboard={leaderboard}
            activeSmokeSession={activeSmokeSession}
            onSmokeSessionChange={updateActiveSmokeSession}
            statusBanner={statusBanner} onDismissBanner={() => setStatusBanner(null)}
            onSelectEnvironment={setEnvId}
            onSaveCallsign={async next => { setProfile(await updatePlayerCallsign(next)); }}
            onLoginPassword={async (callsign, password, mode) => {
              setProfile(await loginWithPassword(callsign, password, undefined, mode));
            }}
            onLoginOAuth={async (provider, idToken, callsign) => {
              setProfile(await loginWithOAuth({ provider, idToken, callsign }));
            }}
            onCompleteLogin={() => setLobbyStep('modes')}
            onSelectMode={mode => {
              setGameMode(mode);
              if (mode !== 'h2h') updateActiveSmokeSession(null);
              setLobbyStep(mode === 'campaign' ? 'map' : mode === 'h2h' ? 'h2h' : 'game');
            }}
            onSetStep={setLobbyStep}
            onStartShift={() => setLobbyStep('game')}
          />
        )}
        {isSettingsModalOpen && (
          <AccountSettingsModal
            profile={profile} busy={accountBusy} error={accountError}
            onClose={() => setIsSettingsModalOpen(false)}
            onSaveCallsign={async next => { setProfile(await updatePlayerCallsign(next)); }}
            onSaveAvatarConfig={async nextConfig => {
              setProfile(await updatePlayerAvatarConfig(nextConfig));
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
            verifiedEnvironment={verifiedEnv} smoked={reportSmoked}
            lifetimeSmoked={reportLifetimeSmoked} bestSmoked={reportBestSmoked}
            newlyUnlockedEnvironments={reportNewlyUnlocked}
            profile={profile} leaderboardEntries={leaderboardEntries}
            gameMode={gameMode} smokeSession={resolvedSmokeSession}
            armed={armed} newShiftRef={newShift} onFinish={finish}
            onOpenModes={() => {
              updateActiveSmokeSession(null);
              setLobbyStep('modes');
              finish();
            }}
            onOpenScoreboard={() => {
              updateActiveSmokeSession(null);
              setLobbyStep('scoreboard');
              finish();
            }}
          />
        )}
      </section>
    </main>
  );
}
