import { useState } from 'react';
import { type EnvironmentId } from './smokebreak/EnvironmentDeck';
import { SmokeBreakGame } from './smokebreak/SmokeBreakGame';

export function App() {
  const [shift, setShift] = useState(0);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>('alleyway');
  return (
    <SmokeBreakGame
      key={shift}
      finish={() => setShift(s => s + 1)}
      environmentId={environmentId}
      onEnvironmentChange={setEnvironmentId}
    />
  );
}

