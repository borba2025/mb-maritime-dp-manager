// MB Maritime DP Manager — Service Worker v3
var CACHE_NAME = 'mb-maritime-v3';
var STATIC_ASSETS = [
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/assets/favicon.png',
  '/assets/logo-login.png',
  '/assets/logo-header.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png'
];

// NOTE: app.js is NOT cached — always fetch fresh to avoid stale code issues

// Install — cache static assets only
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).catch(function(err) {
      console.error('[SW] Cache error:', err);
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — ONLY intercept same-origin static assets
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // NEVER intercept: non-GET, other origins, API calls, or app.js
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/app.js') return;

  // For static assets: network first, cache fallback
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(event.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});
