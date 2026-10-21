# idleSmoke · Smoke Break Simulator

A 3D idle-game take on the workplace smoke break. Each shift is a 15-second break: drag to take 12 drags and finish a cigarette, then fit in as many as you can before time runs out. Smoke more across your career to unlock new break spots and climb the leaderboard.

Runs in the browser and ships to iOS and Android through Capacitor.

## Gameplay

- **Shift:** 15 seconds. Each cigarette takes 12 drags.
- **Environments:** four break spots that unlock by lifetime cigarettes smoked.

  | Environment | Unlocks at |
  |-------------|-----------|
  | Alleyway | 0 |
  | Behind a Restaurant | 5 |
  | Parking Garage | 15 |
  | Dumpster | 30 |

- **Modes:** Campaign, Head-to-Head (1v1 duel lobby against leaderboard rivals), and Sandbox.
- **Accounts:** callsign with password, or Apple / Google sign-in. Players can delete their account from the profile menu.
- **Anti-cheat:** the client records the millisecond offset of every drag. The server replays them on `POST /api/v1/shifts/finish` and rejects impossible shifts.

## Tech stack

| Area | Tools |
|------|-------|
| Client | React 18, TypeScript, Vite, Three.js |
| Mobile | Capacitor 8 (iOS, Android) |
| Server | Express on Node (local, Docker), Cloudflare Worker (production) |
| Storage | SQLite locally, Cloudflare D1 in staging and production |
| Tests | Vitest (unit), Playwright (browser) |
| Secrets | Doppler |
| CI/CD | GitHub Actions, Wrangler |

## Getting started

Requires Node `>=22.12.0` (`nvm use` reads [`.nvmrc`](.nvmrc)) and the [Doppler CLI](https://docs.doppler.com/docs/install-cli).

```bash
nvm use
npm ci
doppler --no-check-version setup --project idle-smoke --config dev
npm run dev
```

The dev server runs at `http://127.0.0.1:5176/idle-smoke/`. The port is pinned to match the Google OAuth redirect URI. Vite serves the `/api/v1/*` routes itself, backed by a local SQLite file at `data/smokebreak.sqlite`.

### Environment variables

Secrets and OAuth client IDs live in Doppler (`dev`, `stg`, `prd`), not in local `.env` files. Vite pulls them from Doppler automatically at startup. [`.env.example`](.env.example) lists the non-secret defaults.

| Variable | Purpose |
|----------|---------|
| `VITE_APPLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` | OAuth client IDs for sign-in |
| `ADMIN_EMAILS`, `ADMIN_PASSCODE` | Access to the admin tagline manager |
| `BASE_URL`, `DOMAIN`, `PORT`, `NODE_ENV` | Hosting configuration |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploys |
| `SNYK_TOKEN` | Security scans |

`scripts/setup-oauth-wizard.sh` walks through creating the Apple and Google OAuth credentials.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Vite dev server with the local API |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm start` | Serve `dist/` and the API with Express (`server/index.js`) |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run knip` | Find unused code and dependencies |
| `npm run test:unit` | Vitest suite in `src/` |
| `npm run test:browser` | Playwright end-to-end test |
| `npm test` | Unit and browser tests |
| `npm run mobile:sync` | Build and sync web assets into the native projects |
| `npm run ios:open`, `npm run android:open` | Open the native project in Xcode or Android Studio |
| `npm run db:inspect` | Inspect the local SQLite database |
| `npm run db:d1:init` | Initialize the D1 schema |
| `npm run db:staging`, `npm run db:live` | Inspect remote D1 databases |
| `npm run version:next` | Print the next release version |

## Project layout

```
src/
  main.tsx, App.tsx      App entry
  smokebreak/            Game: scene, HUD, lobby, profile menu, API client, tests
  platform/              Web/native abstraction (storage, haptics)
  styles/                Modular feature stylesheets (workstation, lobby, HUD, account modal)
server/
  index.js               Express server and Node API middleware
  worker.js              Cloudflare Worker entry
  shiftApi.js            Shift, leaderboard, and tagline /api/v1 route handlers
  playerAuthRoutes.js    Player registration, auth, SSO, and account route handlers
  shiftVerifier.js       Deterministic shift rules and replay verification
  authVerifier.js        Callsign, password hashing, SSO, and session token helpers
  starSchema.js          Star-schema DDL, seed data, and environment unlock rules
  storeQueries.js        Shared SQL constants and query helpers for SQLite and D1
  sqliteDb.js            Local SQLite store
  d1Schema.js            Cloudflare D1 store and schema bootstrap
  schema.sql             Database schema
tests/browser/           Playwright specs
plans/                   Architecture and refactoring implementation plans
scripts/                 Versioning, DB inspection, OAuth setup
public/environments/     Environment backdrops
```

`src/smokebreak/` imports its game rules from `server/shiftVerifier.js`, `server/authVerifier.js`, and `server/starSchema.js`, so the client and the server verifier always agree.

## API

All routes are under `/api/v1`. Request bodies are capped at 16 KB.

| Route | Purpose |
|-------|---------|
| `POST /auth/login` | Callsign and password login or registration |
| `POST /auth/oauth` | Apple / Google sign-in |
| `POST /players` | Create a player |
| `GET /players/me`, `PATCH /players/me`, `DELETE /players/me` | Read, update, or delete the current player |
| `POST /shifts/start`, `POST /shifts/finish` | Begin a shift and submit it for verification |
| `GET /leaderboard` | Top players |
| `GET /taglines` | Rotating taglines |
| `/admin/taglines` | Tagline management (admin only) |

## Testing

```bash
npm run test:unit      # fast, no browser
npm run test:browser   # Playwright against a dev server with an in-memory database
```

The browser test runs with one worker because software WebGL is CPU-heavy and parallel scenes make timed gestures drift.

## Deployment

- **Pull requests to `main`:** CI typechecks, runs Knip and unit tests, builds, then deploys to the Cloudflare staging Worker (`idle-smoke-staging`).
- **Pushes to `main`:** the same validation, then a deploy to production at `idlemullet.com/idle-smoke`, followed by a version tag and GitHub release.
- **Versioning:** [`scripts/version.mjs`](scripts/version.mjs) derives the version from conventional commits since the last `vX.Y.Z` tag. `fix:` and `perf:` bump patch, `feat:` bumps minor, `type!:` or `BREAKING CHANGE` bumps major. Other commit types don't release.
- **Docker:** the [`Dockerfile`](Dockerfile) builds a minimal Node image that serves `dist/` and the API on port 8080.
- **Security:** a weekly and per-PR Snyk scan runs from `.github/workflows/snyk.yml`. See [`SECURITY.md`](SECURITY.md) for the security model and how to report a vulnerability.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): how the two runtimes, shared game rules, shift verification and data model fit together.
- [`docs/mobile.md`](docs/mobile.md): Capacitor setup for iOS and Android, and what's still missing before a native build works.
- [`SECURITY.md`](SECURITY.md): security controls, known limitations, and vulnerability reporting.
- [`docs/agents.md`](docs/agents.md): the project subagents in `.agents/agents/`, what each owns, and how to add one.

## Contributing

Follow the code organization rules in [`AGENTS.md`](AGENTS.md): file size limits, one responsibility per file, and refactors kept separate from feature changes. Use conventional commit messages so releases version correctly.
