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

if (
  !isBrowserTest &&
  (!process.env.VITE_APPLE_CLIENT_ID ||
    !process.env.VITE_GOOGLE_CLIENT_ID ||
    !process.env.ADMIN_EMAILS ||
    !process.env.ADMIN_PASSCODE)
) {
  try {
    const raw = execFileSync(
      'doppler',
      ['--no-check-version', 'secrets', 'download', '--no-file', '--format', 'json'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
    ).toString();
    const secrets = JSON.parse(raw) as Record<string, string>;
    for (const [key, val] of Object.entries(secrets)) {
      if (
        (key.startsWith('VITE_') || key === 'ADMIN_EMAILS' || key === 'ADMIN_PASSCODE') &&
        !process.env[key] &&
        typeof val === 'string'
      ) {
        process.env[key] = val;
      }
    }
  } catch {
    // Fallback gracefully when Doppler CLI is unavailable in CI/offline environments
  }
}

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
  // Browser tests use a fixed build; local dev pins to 127.0.0.1:5176 to match Google OAuth redirect URI.
  server: isBrowserTest ? { watch: null } : { host: '127.0.0.1', port: 5176, strictPort: true },
  // The Playwright server and an open dev preview must not rewrite each other's dependency cache.
  cacheDir: isBrowserTest ? 'node_modules/.vite-browser-tests' : 'node_modules/.vite',
});


