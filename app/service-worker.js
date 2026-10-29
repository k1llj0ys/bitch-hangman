/*
 * Bitch Hangman — service worker.
 *
 * Purpose: let the game start from the local cache when the machine is offline.
 * It only ever caches same-origin files that ship with the game. Requests to any
 * other origin are ignored entirely (the game makes none, but this guarantees a
 * stray request can never be served, modified, or logged by this worker).
 */
'use strict';

// Bump this whenever a shell file changes: the activate handler deletes every
// older cache, so a stale app.js/styles.css can never keep being served.
var CACHE_NAME = 'bitch-hangman-shell-v6';

var SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './crypto.js',
  './default-keys.js',
  './game-logic.js',
  './key-management.js',
  './manifest.json',
  './assets/icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache what we can; a single miss must not break the install.
      return Promise.all(SHELL.map(function (asset) {
        return cache.add(asset).catch(function () {
          return null;
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === CACHE_NAME ? null : caches.delete(name);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Same-origin only. Anything else is left completely alone.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy).catch(function () {
              return null;
            });
          });
        }
        return response;
      }).catch(function () {
        // Offline and not cached: fall back to the app shell when navigating.
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
