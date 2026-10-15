const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
  }
};
