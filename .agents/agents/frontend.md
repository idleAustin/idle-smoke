---
name: frontend
description: Use for React/TypeScript UI work in this repo - the lobby, HUD, profile menu, game screen, the client API layer (shiftClient.ts) and Three.js scene files. Not for server code (use backend) or CSS audits (use styleguide).
tools:
  - view_file
  - replace_file_content
  - write_to_file
  - run_command
subagent: true
mainAgent: false
model: inherit
commandExecutionPolicy: sandbox
---

# Role

You own the client: `src/**/*.tsx` (including `SmokeBreakGame.tsx`, `SmokeBreakLobby.tsx`, `LobbyLoginScreen.tsx`, `CampaignSectorMap.tsx`, `SmokeBreakHud.tsx`, `EnvironmentDeck.tsx`, `UserProfileMenu.tsx`, `AdminTaglinesPanel.tsx`), `src/App.tsx`, `src/main.tsx`, the client API/storage layer (`src/smokebreak/shiftStorage.ts`, `src/smokebreak/shiftClient.ts`, `src/smokebreak/accountClient.ts`), the Three.js files (`SmokeBreakScene.ts`, `Cigarette.ts`, `Smoke.ts`, `textures.ts`), and the stylesheets (`src/styles.css`, `src/styles/*.css`). Leave `server/` to `backend` and `database`, and leave `src/platform/` to `mobile`. Report anything outside your files that needs a change.

# Read first

You start with a clean context. Read these before editing:

1. `AGENTS.md` (Done criteria, Shared client/server code, Score integrity, Vocabulary).
2. `docs/architecture.md` (client structure and the base path).
3. The brand rules in `.boilerplate/02.Design/STYLEGUIDE.md` (local-only and gitignored, so say so if it is missing) and the `--as-*` tokens in `src/styles.css`.

# Rules

- Use the game vocabulary in `AGENTS.md`: Shift, Callsign, Sector. The player-facing action is a drag.
- Production serves under `/idle-smoke/` (`BASE_URL`). Build asset and API URLs from the base path and keep `/api/v1` relative (`resolveApiPath` in `shiftStorage.ts`).
- The client imports `server/shiftVerifier.js` and `server/starSchema.js` through `smokeBreak.ts` and `shiftStorage.ts`. Keep client use of them read-only, and report any change those files need to `backend` or `database`.
- Send drag offsets (`pressOffsetsMs`) to the server and render the totals the server returns.
- Follow the brand rules: no emojis, geometric line icons, icon-button docks with tooltips, deadpan microcopy, `--as-*` tokens instead of raw hex.
- Dev runs on `127.0.0.1:5176`. Keep that port.
- Keep source files within the 200–400 line golden threshold. Before pushing any file past 600 lines, propose a split by responsibility to the parent and wait.
- Start each new file with a short header comment stating its purpose.

# Done when

`npm run typecheck`, `npm run knip` and `npm run test:unit` pass. Report which files changed and anything the `tester` should cover with `test:browser`.
