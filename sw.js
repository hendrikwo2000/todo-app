"use strict";

/* ====================================================================
   Service Worker - cached nur die App-Shell (statische Dateien), damit
   die Seite auch ohne Internet ueberhaupt laedt. /api/* wird bewusst NICHT
   angefasst - die eigentlichen ToDo-Daten cached app.js selbst in
   localStorage (ein einziger Cache-Mechanismus fuer Daten statt zwei).

   Strategie: network-first mit Cache-Fallback, nicht cache-first. Ein Push
   auf main deployt sofort live (kein Build-Schritt, keine gehashten
   Dateinamen) - so sieht "online" immer die neueste Version, "offline" die
   zuletzt gecachte.

   WICHTIG: Bei jeder Aenderung an einer der unten aufgelisteten Dateien
   diese Versionsnummer hochzaehlen, sonst bleibt ein wiederkehrender Nutzer
   auf dem alten Stand haengen (activate() raeumt den alten Cache nur auf,
   wenn sich der Name aendert). Siehe BETRIEB.md.
   ==================================================================== */
const CACHE_NAME = "todo-shell-v1";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nur eigene, statische GETs behandeln - /api/* und fremde Origins normal
  // durchlassen, damit app.js deren Fehlerbehandlung unveraendert greift.
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((antwort) => {
        const kopie = antwort.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopie));
        return antwort;
      })
      .catch(() => caches.match(event.request)
        .then((gecacht) => gecacht || caches.match("/index.html")))
  );
});
