import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './styles/workstation.css';
import './styles/environment-and-leaderboard.css';
import './styles/lobby-login.css';
import './styles/lobby-modes-map.css';
import './styles/account-modal.css';
import './styles/hud.css';

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><App /></StrictMode>);

if (import.meta.hot) import.meta.hot.dispose(() => {
  root.unmount();
});

