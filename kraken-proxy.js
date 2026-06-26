// Cloudflare Worker — kraken-proxy
// Proxies krakenfiles token requests server-side so the browser doesn't hit CORS.
//
// Deploy steps (free, 2 min):
//   1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. Paste this whole file, click Save & Deploy
//   3. Copy the worker URL (e.g. https://kraken-proxy.YOUR_NAME.workers.dev)
//   4. Paste it into KRAKEN_PROXY at the top of vault.js

const ALLOWED_ORIGIN = 'https://zenie1.github.io';

const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const id  = url.pathname.replace(/^\/+|\/+$/g, ''); // trim slashes

    if (!id || !/^[a-zA-Z0-9]+$/.test(id)) {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const upstream = await fetch(`https://krakenfiles.com/api/file/${id}/token`, {
      method: 'POST',
    });
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        ...CORS,
      },
    });
  },
};
