# Subagents

Project subagents live in [`.agents/agents/`](../.agents/agents/), one markdown file per agent. The primary agent delegates to them with `invoke_subagent`. This page is the only place the roster is listed.

## Roster

| Agent | Use it for | Mode |
|-------|------------|------|
| `database` | Schema, queries, migrations, SQLite and D1 stores | writes |
| `backend` | Endpoints, auth, rate limiting, shift verifier | writes |
| `frontend` | React UI, `shiftClient.ts`, Three.js scene | writes |
| `styleguide` | Brand and design-token audit of UI and CSS | report only |
| `refactoring` | Splitting oversized or mixed-responsibility files | writes, two phases |
| `score-integrity` | Gate for changes to drag, shift timing and verifier rules | report only |
| `tester` | vitest and Playwright tests | writes tests only |
| `security-reviewer` | Auth, tokens, CORS, admin routes, secrets | report only |
| `mobile` | Capacitor iOS and Android | writes |

All agents use `model: inherit`, `mainAgent: false` and the default `sandbox` command policy. They run only as delegates of the primary agent.

## File ownership

Write-capable agents edit only the paths they own. Work that crosses a boundary returns to the parent agent, which sequences it.

| Agent | Owns |
|-------|------|
| `database` | `server/schema.sql`, `server/starSchema.js`, `server/storeQueries.js`, `server/sqliteDb.js`, `server/d1Schema.js`, `scripts/db-inspect.mjs`, D1 bindings in `wrangler.jsonc` |
| `backend` | `server/shiftApi.js`, `server/playerAuthRoutes.js`, `server/index.js`, `server/worker.js`, `server/shiftVerifier.js`, `server/authVerifier.js` |
| `frontend` | `src/**/*.tsx`, `src/App.tsx`, `src/main.tsx`, `src/smokebreak/shiftStorage.ts`, `src/smokebreak/shiftClient.ts`, `src/smokebreak/accountClient.ts`, `SmokeBreakScene.ts`, `Cigarette.ts`, `Smoke.ts`, `textures.ts`, `src/styles.css`, `src/styles/*.css` |
| `tester` | `src/**/*.test.ts`, `tests/browser/**`, `playwright.config.ts` |
| `mobile` | `capacitor.config.ts`, `src/platform/**`, `ios/`, `android/` |
| `refactoring` | Only the files the parent names, plus their importers |
| `styleguide`, `score-integrity`, `security-reviewer` | None. They report only. |

## Cross-layer sequence

For a feature that spans layers, the parent runs agents in this order and checks each result before the next:

1. `database` for the schema and stores.
2. `backend` for the endpoint.
3. `frontend` for the UI.
4. `tester` for unit and browser tests.
5. `score-integrity` and `security-reviewer` as gates when drag rules, auth or tokens changed.
6. `styleguide` after UI changes.

Run refactors on their own, never inside a feature change.

## Adding an agent

1. Create `.agents/agents/<name>.md`. The `name` must match the filename and avoid the built-in names `research`, `browser`, `self` and `image-generator`.
2. Set `name` and `description` in the YAML frontmatter. The description decides when the parent delegates, so state when to use the agent and when not to.
3. List only exact tool names in `tools`. A misspelled tool name can make a subagent hang.
4. Start the body with the files the agent owns and the docs it must read first, because subagents start with a clean context.
5. Point to `AGENTS.md` for shared rules and add only role-specific ones.
6. Add the agent to the tables above. Keep ownership paths from overlapping.
7. Leave a `README.md` out of `.agents/agents/`, because it could be parsed as an agent.

