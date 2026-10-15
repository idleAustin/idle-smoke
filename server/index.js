import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const app = express();
app.disable('x-powered-by');

// Standard HTTP security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const INDEX_HTML = existsSync(INDEX_HTML_PATH) ? readFileSync(INDEX_HTML_PATH, 'utf8') : null;
const PORT = parseInt(process.env.PORT || '8080', 10);

// Health check endpoint for Cloud Run and load balancers
app.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
});

// Serve static assets for /idle-smoke, /idle-smoke-break, and root requests
if (existsSync(DIST_DIR)) {
  app.use('/idle-smoke', express.static(DIST_DIR));
  app.use('/idle-smoke-break', express.static(DIST_DIR));
  app.use(express.static(DIST_DIR));
}

// Single-page application fallback for client-side routing
if (INDEX_HTML !== null) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      return next();
    }
    res.type('html').send(INDEX_HTML);
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[idle-smoke] production server listening on port ${PORT}`);
});
