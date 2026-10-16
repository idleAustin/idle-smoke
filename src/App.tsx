import { useState } from 'react';
import { type EnvironmentId } from './smokebreak/EnvironmentDeck';
import { SmokeBreakGame } from './smokebreak/SmokeBreakGame';
import { type GameModeId, type LobbyStep, type RivalOpponent } from './smokebreak/SmokeBreakLobby';

export function App() {
  const [shift, setShift] = useState(0);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>('alleyway');
  const [lobbyStep, setLobbyStep] = useState<LobbyStep>('login');
  const [gameMode, setGameMode] = useState<GameModeId>('campaign');
  const [selectedRival, setSelectedRival] = useState<RivalOpponent | null>(null);

  return (
    <SmokeBreakGame
      key={shift}
      finish={() => setShift(s => s + 1)}
      environmentId={environmentId}
      onEnvironmentChange={setEnvironmentId}
      lobbyStep={lobbyStep}
      onLobbyStepChange={setLobbyStep}
      gameMode={gameMode}
      onGameModeChange={setGameMode}
      selectedRival={selectedRival}
      onSelectRival={setSelectedRival}
    />
  );
}
