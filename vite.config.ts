import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNodeApiMiddleware } from './server/index.js';
import { createSqliteStore, openSqliteDb } from './server/sqliteDb.js';

/** Release version from git tags and commit messages; see scripts/version.mjs. */
let version = '0.1.0';
try {
  version = execFileSync('node', [fileURLToPath(new URL('./scripts/version.mjs', import.meta.url))]).toString().trim();
} catch {
  // fallback before first commit
}

/** Short commit of the build: CI's checkout, else the local repo, else unknown. */
function buildCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const isBrowserTest = process.env.SMOKE_BROWSER_TEST === '1';

function smokeBreakApiPlugin(): Plugin {
  return {
    name: 'smoke-break-api',
    configureServer(server) {
      const db = openSqliteDb(isBrowserTest ? ':memory:' : undefined);
      const store = createSqliteStore(db);
      server.middlewares.use(createNodeApiMiddleware(store));
      server.httpServer?.once('close', () => {
        try {
          db.close();
        } catch {
          // ignore close errors on shutdown
        }
      });
    },
  };
}

export default defineConfig({
  base: isBrowserTest ? '/' : (process.env.BASE_URL ?? '/idle-smoke/'),
  plugins: [react(), smokeBreakApiPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(buildCommit()),
  },
  // Browser tests use a fixed build; cloud-sync file events must not reload mid-gesture.
  server: isBrowserTest ? { watch: null } : undefined,
  // The Playwright server and an open dev preview must not rewrite each other's dependency cache.
  cacheDir: isBrowserTest ? 'node_modules/.vite-browser-tests' : 'node_modules/.vite',
});


