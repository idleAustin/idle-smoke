import { createD1Store, ensureD1Schema } from './d1Schema.js';
import { handleApiRequest, isApiPathname } from './shiftApi.js';
import { MAX_BODY_BYTES } from './shiftVerifier.js';
import { buildDateDimRow } from './starSchema.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

let initializedDateKey = null;

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Reads a Web Fetch Request body up to MAX_BODY_BYTES without buffering oversized payloads.
 * @param {Request} request
 * @returns {Promise<{ ok: true, rawBody: string | undefined } | { ok: false }>}
 */
async function readBoundedRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return { ok: true, rawBody: undefined };
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return { ok: false };
  }
  if (!request.body) {
    return { ok: true, rawBody: '' };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, rawBody: new TextDecoder().decode(merged) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.DB && isApiPathname(url.pathname)) {
      const { date_key } = buildDateDimRow();
      if (initializedDateKey !== date_key) {
        initializedDateKey = await ensureD1Schema(env.DB);
      }

      const bodyResult = await readBoundedRequestBody(request);
      if (!bodyResult.ok) {
        return withSecurityHeaders(
          new Response(JSON.stringify({ error: 'Payload exceeds 16kb limit' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          })
        );
      }

      const result = await handleApiRequest(
        {
          method: request.method,
          pathname: url.pathname,
          authHeader: request.headers.get('authorization'),
          rawBody: bodyResult.rawBody,
          contentLength: request.headers.get('content-length'),
          clientIp:
            request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for'),
        },
        createD1Store(env.DB)
      );

      return withSecurityHeaders(
        new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      );
    }

    // Subpath routing for idlemullet.com/idle-smoke
    if (url.pathname.startsWith('/idle-smoke')) {
      const subpath = url.pathname.replace(/^\/idle-smoke(?:-break)?/, '') || '/';
      const assetUrl = new URL(subpath, request.url);
      let response = await env.ASSETS.fetch(new Request(assetUrl, request));

      // SPA fallback: return index.html for client routes (unless requesting a missing static file)
      if (response.status === 404 && !subpath.startsWith('/assets/') && !subpath.includes('.')) {
        response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }

      return withSecurityHeaders(response);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },
};
