const CACHE_NAME = 'gaze-relay-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/tfjs/3.21.0/tf.min.js',
  'https://unpkg.com/@tensorflow-models/facemesh@0.0.5/dist/facemesh.js',
  'https://cdnjs.cloudflare.com/ajax/libs/webgazer/3.3.0/webgazer.js',
  'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js'
];

// Install Event: Cache all core assets and CDNs
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache, storing offline assets...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Serve from cache first, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Optionally cache new dynamic requests if needed
        return networkResponse;
      }).catch(() => {
        console.log('Fetch failed offline for: ', event.request.url);
      });
    })
  );
});
