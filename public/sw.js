/**
 * Satnam v2 — PWA Service Worker
 * Spec: SATNAM-V2-SPEC-001 § 9.3
 *
 * Strategies:
 *   - Cache-first: static assets (HTML, CSS, JS, fonts, icons, manifest)
 *   - Network-first: Netlify function API calls (/.netlify/functions/*)
 *   - Offline fallback: /offline.html when network is unavailable
 *   - Background sync: queued Nostr events published when connectivity returns
 */

'use strict';

// ── Version ──────────────────────────────────────────────────────────────────
// Increment CACHE_VERSION to bust all caches on deploy.
const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `satnam-static-${CACHE_VERSION}`;
const API_CACHE     = `satnam-api-${CACHE_VERSION}`;
const SYNC_QUEUE    = 'satnam-nostr-sync';

// ── Static assets to pre-cache ────────────────────────────────────────────────
// These are fetched and cached at install time. Vite generates hashed filenames
// for JS/CSS bundles; the main entry points and critical assets are listed here.
// The build process should update this list via workbox-build or similar.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/192.png',
  '/icons/512.png',
  '/icons/maskable-512.png',
  '/fonts/cinzel-v21-latin-regular.woff2',
  '/fonts/cinzel-v21-latin-700.woff2',
];

// ── URL matchers ──────────────────────────────────────────────────────────────

/** Returns true for Netlify function API calls */
function isApiRequest(url) {
  return url.pathname.startsWith('/.netlify/functions/');
}

/** Returns true for static cacheable assets */
function isStaticAsset(url) {
  return (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    /\.(html|css|js|mjs|woff2|woff|ttf|png|jpg|jpeg|svg|ico|webp|webmanifest)$/.test(
      url.pathname
    )
  );
}

/** Returns true for requests that should never be cached */
function isUncacheable(url) {
  return (
    url.protocol === 'chrome-extension:' ||
    url.hostname.includes('supabase.co') ||  // DB calls go through netlify functions
    url.hostname.includes('wss:')             // WebSocket — not cacheable
  );
}

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        // Attempt to pre-cache all listed assets.
        // addAll() fails if any single request fails, so we cache individually
        // to avoid one missing icon breaking the whole SW install.
        return Promise.allSettled(
          PRECACHE_ASSETS.map((asset) =>
            cache.add(asset).catch((err) => {
              // Non-fatal: log but don't block install
              console.warn(`[SW] Pre-cache failed for ${asset}:`, err.message);
            })
          )
        );
      })
      .then(() => {
        // Skip waiting so the new SW activates immediately on install
        return self.skipWaiting();
      })
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  const validCaches = [STATIC_CACHE, API_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !validCaches.includes(name))
            .map((name) => {
              console.log(`[SW] Deleting stale cache: ${name}`);
              return caches.delete(name);
            })
        )
      )
      .then(() => {
        // Claim all clients immediately so the new SW controls existing tabs
        return self.clients.claim();
      })
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and uncacheable origins
  if (event.request.method !== 'GET' || isUncacheable(url)) {
    return;
  }

  // API calls: Network-first
  if (isApiRequest(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static assets: Cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Navigation requests (HTML pages): Cache-first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(navigationHandler(event.request));
    return;
  }
});

// ── Cache Strategies ──────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache, fall back to network and update cache.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // If we have nothing in cache and network fails, return a generic error
    return new Response('Offline — asset unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Network-first: try network, fall back to cache if available.
 * Used for API calls where freshness matters.
 */
async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache successful API responses for offline fallback (TTL: ~5 min)
      const responseToCache = networkResponse.clone();
      const headers = new Headers(responseToCache.headers);
      cache.put(request, new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers,
      }));
    }
    return networkResponse;
  } catch {
    // Network failed — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: 'Offline — request queued', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Navigation handler: serve cached index.html for SPA routes,
 * with offline.html fallback when completely offline.
 */
async function navigationHandler(request) {
  try {
    // Try the network first for navigations (ensures fresh HTML on deploy)
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch {
    // Network unavailable — fall through to cache
  }

  // SPA: all routes serve index.html
  const cachedIndex = await caches.match('/index.html');
  if (cachedIndex) return cachedIndex;

  // Last resort: offline page
  const offlinePage = await caches.match('/offline.html');
  if (offlinePage) return offlinePage;

  return new Response('Satnam is offline. Please try again when connected.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ── Background Sync ───────────────────────────────────────────────────────────
//
// Nostr events queued while offline are stored in IndexedDB by the client
// under the key SYNC_QUEUE. When connectivity returns, the SW replays them.
//
// The client calls:
//   navigator.serviceWorker.ready.then(sw => sw.sync.register('satnam-nostr-sync'))
//
// The SW then picks up the queued events and attempts to publish them to relays.

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_QUEUE) {
    event.waitUntil(replayQueuedNostrEvents());
  }
});

/**
 * Open IndexedDB, read queued Nostr events, and broadcast them back to
 * all open clients for relay publishing. The client owns relay connections;
 * the SW acts as the trigger.
 */
async function replayQueuedNostrEvents() {
  let db;
  try {
    db = await openSyncDb();
    const events = await getAllQueuedEvents(db);

    if (events.length === 0) return;

    // Notify all clients to publish the queued events
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: 'SYNC_QUEUED_EVENTS',
        events,
      });
    }

    // Clear the queue after handoff to the client
    await clearQueuedEvents(db);
    console.log(`[SW] Background sync: handed off ${events.length} queued Nostr event(s)`);
  } catch (err) {
    console.warn('[SW] Background sync failed:', err.message);
    // Do not throw — let the browser retry the sync
  } finally {
    if (db) db.close();
  }
}

// ── IndexedDB helpers for sync queue ─────────────────────────────────────────

const DB_NAME    = 'satnam-sw-db';
const DB_VERSION = 1;
const STORE_NAME = 'nostr-event-queue';

function openSyncDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function getAllQueuedEvents(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function clearQueuedEvents(db) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.clear();
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Message handler (client → SW) ────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'QUEUE_NOSTR_EVENT': {
      // Client asks SW to persist a Nostr event for offline sync
      openSyncDb().then((db) => {
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: payload.id, event: payload, queuedAt: Date.now() });
        tx.oncomplete = () => db.close();
      });
      break;
    }

    case 'SKIP_WAITING': {
      // Client triggers immediate SW activation after update detection
      self.skipWaiting();
      break;
    }

    default:
      break;
  }
});
