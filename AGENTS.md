## Code Organization

### File size

| File type | Golden target | Soft limit | Action threshold |
|-----------|---------------|------------|------------------|
| Source files | 200-400 lines | 400-600 lines (split if mixing responsibilities) | 600+ lines: propose a split by responsibility before adding code. |
| Test files | 200-600 lines | 600-800 lines (split if covering multiple areas) | 800+ lines: avoid exceeding 800 lines; propose a split by domain area before adding more tests. |

Exceptions: generated code, large config/data files, and test fixtures are exempt.

Never split tightly coupled code just to meet a line count. Cohesion takes priority over size.

### Structure

- Give each file one responsibility that can be described in a single sentence.
- Organize by feature, with clear module boundaries.
- Extract shared logic (business logic, utilities, data access, UI components) only when it is used in more than one place or obscures a file's main logic.
- Do not add wrapper layers, barrel files, or single-function files without a concrete need.
- Use descriptive file names. Start each new file with a short header comment stating its purpose.

### Refactoring

- Preserve existing behavior.
- Do not combine refactors and feature changes in the same change.
- Run relevant tests before and after, and report any failures.
- Update imports and references in the same change that moves code.


## Project Rules

### Done criteria

- Finish a change green on `npm run typecheck`, `npm run knip`, and `npm run test:unit`, the checks CI runs. Knip fails on unused exports and dependencies, so remove dead code in the same change.
- Tests for server code live in `src/smokebreak/` because `test:unit` runs `vitest run src`.

### Docs to read first

- Read `docs/architecture.md` before changing `server/` or the shared game rules.
- Read `SECURITY.md` before touching auth, tokens, or admin routes.
- Read `docs/mobile.md` before touching `src/platform/` or Capacitor config.

### Shared client/server code

- `server/shiftVerifier.js`, `server/authVerifier.js`, `server/starSchema.js`, and `server/storeQueries.js` are bundled into the browser and run in Cloudflare Workers. Keep them to Web APIs (`globalThis.crypto`, not `node:crypto`).
- A new endpoint changes `server/shiftApi.js` (or `server/playerAuthRoutes.js`), `server/storeQueries.js`, and both stores (`sqliteDb.js` and `d1Schema.js`). Keep handlers runtime-agnostic.
- A schema change goes in `STAR_SCHEMA_DDL` (`starSchema.js`) and `server/schema.sql` together.

### Score integrity

- The server computes every shift total by replaying `pressOffsetsMs`. Accept drag offsets from the client and derive totals on the server.
- A change to `press()`, `BREAK_MS`, or `PRESSES_PER_CIGARETTE` affects the client, the verifier, and shifts already verified. Treat it as a breaking change.

### Secrets

- Doppler project `idle-smoke`, configs `dev`, `stg`, `prd`. Vite reads Doppler on its own at startup.
- `doppler configure --json` prints the CLI token. List secrets with `doppler --no-check-version secrets --only-names`.

### Commits and releases

- Use conventional commits, because they drive versioning. `fix:` and `perf:` ship a patch, `feat:` ships a minor, and `type!:` ships a major when merged to `main`. `chore:`, `docs:`, `test:`, and `ci:` do not release.
- `main` is protected: CI ("Lint, Typecheck & Tests") and Snyk must pass.

### Fixed ports and paths

- Dev runs on `127.0.0.1:5176` to match the Google OAuth redirect URI. Keep that port.
- Production is served under `/idle-smoke/` (`BASE_URL`). Browser tests run at `/` on port 4173 with an in-memory database and one worker.

### Local state

- `dist/`, `data/*.sqlite*`, `.kennel-hub/`, and `.boilerplate/` are gitignored local state. Leave them out of commits.

### Oversized files

- All source files in `server/` and `src/` have been split into the 200–400 line golden threshold, and all test files in `src/` and `e2e/` are within the 200–600 line golden threshold (and under 800 lines). Any source file reaching 600+ lines or test file exceeding 800 lines requires a proposed split by responsibility before adding code to it.

### Subagents

- Custom agents live in `.agents/agents/`. The roster and file ownership are in `docs/agents.md`.
- Delegate by ownership. Work that crosses a boundary goes back through the parent agent.
- Propose a refactor first and keep it separate from feature changes.

### Vocabulary

- **Shift:** one 15-second break. **Callsign:** a player's display name. **Sector:** an environment on the map (`SECTOR 01` to `04`).
- **Drag** is the player-facing action. The code also calls it `press` and `tap` (`press()`, `tap_count`, `pressOffsetsMs`).
