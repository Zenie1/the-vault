// sw.js — The Vault Service Worker
// Caching strategy:
//   vault-shell-v1  : App shell files (cache-first)
//   vault-audio-v1  : Audio tracks (network-first online; cache fallback offline; LRU 15)
//   vault-covers-v1 : Cover images (cache-first, max 100)

const SHELL_VERSION   = 'v1';
const SHELL_CACHE     = `vault-shell-${SHELL_VERSION}`;
const AUDIO_CACHE     = 'vault-audio-v1';
const COVER_CACHE     = 'vault-covers-v1';
const AUDIO_MAX       = 15;
const COVER_MAX       = 100;
const AUDIO_MAX_AGE   = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// Metadata entry for LRU order (not a real URL — stored as cache entry)
const AUDIO_META_KEY  = '/_vault_audio_meta_';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/vault.js',
  '/session.js',
  '/firebase-config.js',
  '/artists.json',
  '/tracks.json',
  '/sw.js',
  '/swipe.js',
  '/visualizer.js',
  '/pitch-processor.js',
];

// ── Install ────────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => {
        // Add files individually so a single 404 doesn't block the whole install
        return Promise.allSettled(
          SHELL_FILES.map(url => cache.add(url).catch(() => {}))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('vault-shell-') && k !== SHELL_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Firebase, googleapis, CDN JS (those have their own caching)
  if (
    url.hostname.includes('firebaseio.com')   ||
    url.hostname.includes('googleapis.com')   ||
    url.hostname.includes('firebaseapp.com')  ||
    url.hostname.includes('gstatic.com')      ||
    url.hostname.includes('identitytoolkit')  ||
    url.hostname.includes('securetoken')      ||
    url.hostname.includes('github.com')       ||
    url.hostname.includes('githubusercontent') ||
    url.hostname === 'api.cloudinary.com'
  ) return;

  if (_isAudio(url, request)) {
    event.respondWith(_handleAudio(request));
    return;
  }

  if (_isImage(url)) {
    event.respondWith(_handleCover(request));
    return;
  }

  // App shell — same origin
  if (url.origin === self.location.origin) {
    event.respondWith(_handleShell(request));
  }
});

// ── URL classifiers ────────────────────────────────────────────────────────────
function _isAudio(url, req) {
  return (
    /\.(mp3|wav|ogg|flac|aac|m4a)(\?|$)/i.test(url.pathname) ||
    url.hostname.includes('cloudinary.com') ||
    req.destination === 'audio'
  );
}

function _isImage(url) {
  return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url.pathname);
}

// ── Shell handler: cache-first ─────────────────────────────────────────────────
async function _handleShell(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('The Vault is offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// ── Audio handler: network-first, cache fallback ───────────────────────────────
async function _handleAudio(request) {
  // Range requests: pass straight through; cache API doesn't buffer partial responses
  if (request.headers.get('Range')) {
    try {
      return await fetch(request);
    } catch {
      // Offline + range: try to serve full cached response (browser will re-range it)
      const cached = await caches.match(request.url, { cacheName: AUDIO_CACHE });
      return cached || new Response('', { status: 503 });
    }
  }

  try {
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Offline — serve from cache if available
    const cached = await caches.match(request, { cacheName: AUDIO_CACHE });
    if (cached) {
      _notifyClients({ type: 'SERVED_OFFLINE', url: request.url });
      return cached;
    }
    return new Response('', { status: 503 });
  }
}

// ── Cover handler: cache-first ────────────────────────────────────────────────
async function _handleCover(request) {
  const cache  = await caches.open(COVER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const keys = await cache.keys();
      if (keys.length >= COVER_MAX) await cache.delete(keys[0]);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 404 });
  }
}

// ── Message handler ────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  const { data, source } = event;
  if (!data || !data.type) return;

  switch (data.type) {
    case 'CACHE_TRACK':
      event.waitUntil(_cacheAudioTrack(data.url, data.trackId, source));
      break;
    case 'CACHE_ALL_TRACKS':
      event.waitUntil(_cacheAllTracks(data.tracks, source));
      break;
    case 'CLEAR_AUDIO_CACHE':
      event.waitUntil(_clearAudioCache(source));
      break;
    case 'GET_CACHE_INFO':
      event.waitUntil(_getCacheInfo(source));
      break;
    case 'GET_CACHED_URLS':
      event.waitUntil(_getCachedUrls(source));
      break;
  }
});

// ── Cache a single audio track ─────────────────────────────────────────────────
async function _cacheAudioTrack(url, trackId, source) {
  if (!url) return;
  const cache = await caches.open(AUDIO_CACHE);

  // Check existing — skip if fresh
  const existing = await cache.match(url);
  if (existing) {
    const cachedAt = parseInt(existing.headers.get('x-vault-cached-at') || '0');
    if (Date.now() - cachedAt < AUDIO_MAX_AGE) return;
    await cache.delete(url);
  }

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return;

    const blob    = await response.blob();
    const headers = new Headers(response.headers);
    headers.set('x-vault-cached-at', String(Date.now()));
    headers.set('x-vault-track-id',  String(trackId || ''));
    const sized   = blob.size;

    const stored = new Response(blob, { status: 200, statusText: 'OK', headers });

    // LRU eviction
    const meta = await _getAudioMeta(cache);
    const existing_idx = meta.findIndex(m => m.url === url);
    if (existing_idx !== -1) meta.splice(existing_idx, 1);
    while (meta.length >= AUDIO_MAX) {
      const oldest = meta.shift();
      await cache.delete(oldest.url);
    }
    meta.push({ url, trackId, cachedAt: Date.now(), size: sized });
    await _setAudioMeta(cache, meta);
    await cache.put(url, stored);

    _notifyClients({ type: 'TRACK_CACHED', url, trackId });
    if (source) source.postMessage({ type: 'TRACK_CACHED', url, trackId });
  } catch { /* silent fail */ }
}

// ── Cache all tracks (batch) ───────────────────────────────────────────────────
async function _cacheAllTracks(tracks, source) {
  if (!Array.isArray(tracks)) return;
  let done = 0;
  for (const { url, trackId } of tracks) {
    await _cacheAudioTrack(url, trackId);
    done++;
    if (source) source.postMessage({ type: 'CACHE_PROGRESS', done, total: tracks.length });
  }
}

// ── Clear audio cache ──────────────────────────────────────────────────────────
async function _clearAudioCache(source) {
  await caches.delete(AUDIO_CACHE);
  if (source) source.postMessage({ type: 'AUDIO_CACHE_CLEARED' });
}

// ── Get cache info (for admin panel) ──────────────────────────────────────────
async function _getCacheInfo(source) {
  if (!source) return;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const meta  = await _getAudioMeta(cache);
    let totalBytes = 0;
    const tracks = [];
    for (const m of meta) {
      totalBytes += m.size || 0;
      tracks.push({ url: m.url, trackId: m.trackId, size: m.size || 0, cachedAt: m.cachedAt });
    }
    source.postMessage({ type: 'CACHE_INFO', tracks, totalBytes });
  } catch {
    source.postMessage({ type: 'CACHE_INFO', tracks: [], totalBytes: 0 });
  }
}

// ── Get cached URLs (for offline track indicators) ────────────────────────────
async function _getCachedUrls(source) {
  if (!source) return;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const meta  = await _getAudioMeta(cache);
    source.postMessage({ type: 'CACHED_URLS', urls: meta.map(m => m.url) });
  } catch {
    source.postMessage({ type: 'CACHED_URLS', urls: [] });
  }
}

// ── LRU metadata helpers ───────────────────────────────────────────────────────
async function _getAudioMeta(cache) {
  try {
    const res = await cache.match(AUDIO_META_KEY);
    if (!res) return [];
    return await res.json();
  } catch { return []; }
}

async function _setAudioMeta(cache, meta) {
  await cache.put(
    AUDIO_META_KEY,
    new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
  );
}

// ── Broadcast to all open clients ─────────────────────────────────────────────
function _notifyClients(message) {
  self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
    clients.forEach(c => c.postMessage(message));
  });
}
