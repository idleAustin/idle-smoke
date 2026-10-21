import { useState } from 'react';
import { type EnvironmentId } from './smokebreak/EnvironmentDeck';
import { getCachedPlayerProfile } from './smokebreak/shiftStorage';
import { SmokeBreakGame } from './smokebreak/SmokeBreakGame';
import { type GameModeId, type LobbyStep } from './smokebreak/SmokeBreakLobby';
import { type SmokeSession } from './smokebreak/smokeSessionClient';

export function App() {
  const [shift, setShift] = useState(0);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>('alleyway');
  const [lobbyStep, setLobbyStep] = useState<LobbyStep>(() => {
    const profile = getCachedPlayerProfile();
    return profile.authProvider && profile.authProvider !== 'guest' ? 'modes' : 'login';
  });
  const [gameMode, setGameMode] = useState<GameModeId>('campaign');
  const [activeSmokeSession, setActiveSmokeSession] = useState<SmokeSession | null>(null);

  return (
    <SmokeBreakGame
      key={shift}
      finish={() => {
        if (gameMode === 'h2h') {
          setActiveSmokeSession(null);
          setLobbyStep('h2h');
        }
        setShift(s => s + 1);
      }}
      environmentId={environmentId}
      onEnvironmentChange={setEnvironmentId}
      lobbyStep={lobbyStep}
      onLobbyStepChange={setLobbyStep}
      gameMode={gameMode}
      onGameModeChange={setGameMode}
      activeSmokeSession={activeSmokeSession}
      onSmokeSessionChange={setActiveSmokeSession}
    />
  );
}
