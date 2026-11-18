// sw.js: the service worker that lets the app install and work offline.
// Network first: always try GitHub Pages for the newest copy, so each merged
// change shows up. If the device is offline, fall back to the saved copy.
// All paths are relative, because the site lives at /<repository>/, not at the root.

const CACHE = "age-capstruct-v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "capstruct.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "data/cdss.csv",
  "data/assumptions.csv",
  "data/banker_schedule.csv",
  "data/example_firms.csv",
  "data/ebit_scenarios.csv",
];

// Save a copy of every file when the app is first installed.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// Remove copies saved by older versions of this file.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only this site's own files. The app makes no requests to other websites.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())
        )
      )
  );
});
