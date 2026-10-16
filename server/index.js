import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { createSqliteStore, openSqliteDb } from './sqliteDb.js';
import { handleApiRequest, isApiPathname } from './shiftApi.js';
import { MAX_BODY_BYTES } from './shiftVerifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const INDEX_HTML = existsSync(INDEX_HTML_PATH) ? readFileSync(INDEX_HTML_PATH, 'utf8') : null;
const PORT = parseInt(process.env.PORT || '8080', 10);

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ ok: true, rawBody: string } | { ok: false }>}
 */
function readRawRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let exceeded = false;

    req.on('data', chunk => {
      if (exceeded) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        exceeded = true;
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (exceeded) {
        resolve({ ok: false });
        return;
      }
      resolve({ ok: true, rawBody: Buffer.concat(chunks).toString('utf8') });
    });

    req.on('error', reject);
  });
}

/**
 * Shared Node HTTP / Connect / Express middleware for /api/v1/* routes.
 * @param {ReturnType<typeof createSqliteStore>} store
 */
export function createNodeApiMiddleware(store) {
  return async (req, res, next) => {
    const rawUrl = req.originalUrl || req.url || '/';
    const pathname = rawUrl.split('?')[0];
    if (!isApiPathname(pathname)) {
      return next();
    }

    const bodyResult = await readRawRequestBody(req);
    if (!bodyResult.ok) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Payload exceeds 16kb limit' }));
      return;
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : (forwardedFor ?? req.socket?.remoteAddress ?? '127.0.0.1');

    const result = await handleApiRequest(
      {
        method: req.method || 'GET',
        pathname,
        authHeader: req.headers.authorization,
        rawBody: bodyResult.rawBody,
        contentLength: req.headers['content-length'],
        clientIp,
      },
      store
    );

    res.statusCode = result.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result.body));
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} [db]
 */
export function createApp(db = openSqliteDb()) {
  const app = express();
  app.disable('x-powered-by');
  const store = createSqliteStore(db);

  // Standard HTTP security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Health check endpoint for Cloud Run and load balancers
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.status(200).send('OK');
  });

  // Server-authoritative API routes (/api/v1/* and subpath-prefixed /idle-smoke(-break)?/api/v1/*)
  app.use(createNodeApiMiddleware(store));

  // Serve static assets for /idle-smoke, /idle-smoke-break, and root requests
  if (existsSync(DIST_DIR)) {
    app.use('/idle-smoke', express.static(DIST_DIR));
    app.use('/idle-smoke-break', express.static(DIST_DIR));
    app.use(express.static(DIST_DIR));
  }

  // Single-page application fallback for client-side routing
  if (INDEX_HTML !== null) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' || isApiPathname(req.path)) {
        return next();
      }
      res.type('html').send(INDEX_HTML);
    });
  }

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[idle-smoke] production server listening on port ${PORT}`);
  });
}
