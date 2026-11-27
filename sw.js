"use strict";

/* ====================================================================
   Service Worker - cached nur die App-Shell (statische Dateien), damit
   die Seite auch ohne Internet ueberhaupt laedt. /api/* wird bewusst NICHT
   angefasst - die eigentlichen ToDo-Daten cached app.js selbst in
   localStorage (ein einziger Cache-Mechanismus fuer Daten statt zwei).

   Strategie: network-first mit Cache-Fallback, nicht cache-first. Ein Push
   auf main deployt sofort live (kein Build-Schritt, keine gehashten
   Dateinamen) - so sieht "online" immer die neueste Version, "offline" die
   zuletzt gecachte. Seit 23.11.2026 mit Frist: antwortet das Netz nicht
   binnen NETZ_FRIST, kommt die gecachte Fassung (siehe fetch unten).

   WICHTIG: Bei jeder Aenderung an einer der unten aufgelisteten Dateien
   diese Versionsnummer hochzaehlen, sonst bleibt ein wiederkehrender Nutzer
   auf dem alten Stand haengen (activate() raeumt den alten Cache nur auf,
   wenn sich der Name aendert). Siehe BETRIEB.md.
   ==================================================================== */
const CACHE_NAME = "todo-shell-v88";

// Jede Datei hier MUSS es geben: die Installation bricht bei einem einzigen 404
// komplett ab, und dann gibt es gar keinen Offline-Start mehr. fokus.js fehlte
// bis Oktober 2026 in der Liste - offline fehlten dann Gewohnheiten und Timer.
//
// Kein "/index.html" mehr (bis 23.11.2026 stand es hier): Cloudflare Pages
// leitet es per 308 auf "/" um. cache.addAll legte die UMGELEITETE Antwort ab,
// und Safari (Chrome ebenso) verwirft eine solche Antwort bei einer
// Navigation - der Kaltstart vom Home-Bildschirm (start_url war
// "./index.html") ging offline ins Leere. Die Seite ist "/".
const SHELL_FILES = [
  "/",
  "/style.css",
  "/konto.js",
  "/app.js",
  "/kalender.js",
  "/gewohnheiten-daten.js",
  "/fokus.js",
  "/gewohnheiten.js",
  "/gewohnheiten-dialoge.js",
  "/zeiterfassung.js",
  "/hilfe.js",
  "/anlegen.js",
  "/bearbeiten.js",
  "/navigation.js",
  "/schalter.js",
  "/glas.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// So lange wartet eine Anfrage aufs Netz, bevor die gecachte Fassung kommt.
// Ohne Frist hing der Start bei schlechtem Netz (Funkloch, Bahn), bis das
// Betriebssystem aufgab - das kann eine Minute dauern. Die Frist gilt fuer
// den Kopf der Antwort, nicht fuer den ganzen Inhalt: ein langsamer, aber
// laufender Abruf wird nicht abgeschnitten.
const NETZ_FRIST = 3000;

// Nur saubere Antworten in den Cache: 200er, eigene Herkunft, nicht
// umgeleitet. Bis 23.11.2026 landete hier auch jeder 404/500 und hat die gute
// gecachte Fassung ueberschrieben.
function taugtFuerCache(antwort) {
  return antwort && antwort.ok && antwort.type === "basic" && !antwort.redirected;
}

// Eine umgeleitete Antwort als NEUE Response ablegen: die traegt kein
// redirected-Flag, und Safari nimmt sie auch fuer eine Navigation an.
async function ohneUmleitung(antwort) {
  if (!antwort.redirected) return antwort;
  return new Response(await antwort.blob(), {
    status: antwort.status,
    statusText: antwort.statusText,
    headers: antwort.headers,
  });
}

self.addEventListener("install", (event) => {
  // Statt cache.addAll: dieselbe Alles-oder-nichts-Regel, aber jede Antwort
  // geht vorher durch ohneUmleitung().
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const antworten = await Promise.all(SHELL_FILES.map(async (pfad) => {
      const antwort = await fetch(pfad, { cache: "no-cache" });
      if (!antwort.ok) throw new Error(pfad + " antwortet mit " + antwort.status);
      return [pfad, await ohneUmleitung(antwort)];
    }));
    await Promise.all(antworten.map(([pfad, antwort]) => cache.put(pfad, antwort)));
    await self.skipWaiting();
  })());
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

/* ====================================================================
   Push-Benachrichtigungen. Payload kommt von functions/api/push/pruefen.js:
   { title, body, badge (Zahl faelliger ToDos), url }.

   setAppBadge() im selben Event wie showNotification() gesetzt - so
   aktualisiert sich die Zahl auf dem Home-Bildschirm-Icon (iOS 16.4+/
   Android) auch dann, wenn die App gerade gar nicht offen ist. showNotification()
   ist Pflicht: ohne sie zeigen Chrome/Safari sonst selbst eine generische
   Meldung ("Seite wurde aktualisiert"), das waere schlechter als die echte.
   ==================================================================== */
self.addEventListener("push", (event) => {
  let daten = {};
  try { daten = event.data ? event.data.json() : {}; } catch (e) { /* leer bleibt */ }

  const titel = daten.title || "ToDo-Liste";
  const optionen = {
    body: daten.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: daten.url || "/" },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(titel, optionen);
    if (typeof daten.badge === "number" && "setAppBadge" in self.registration) {
      await self.registration.setAppBadge(daten.badge).catch(() => {});
    }
  })());
});

// Klick auf die Benachrichtigung: vorhandenes Fenster fokussieren statt
// immer ein neues zu oeffnen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clientsList) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) return c.focus();
    }
    return self.clients.openWindow(ziel);
  })());
});

// Gecachte Fassung einer Anfrage. Navigationen (das HTML der App) fallen
// immer auf "/" zurueck - gleich, ob sie als "/", "/index.html" (alte
// Home-Bildschirm-Symbole tragen das noch als Startadresse) oder mit
// ?beitreten=/?weiter= kommen. ignoreVary, weil eine Navigation andere
// Kopfzeilen schickt als der Abruf bei der Installation.
async function ausCache(anfrage, istNavigation) {
  const cache = await caches.open(CACHE_NAME);
  const optionen = { ignoreSearch: true, ignoreVary: true };
  const treffer = await cache.match(anfrage, optionen);
  if (treffer && !treffer.redirected) return treffer;
  return istNavigation ? cache.match("/", optionen) : undefined;
}

// Kam die Seite selbst gerade aus dem Cache (Netz weg oder zu langsam),
// nehmen CSS und Skripte fuer kurze Zeit sofort ihre gecachte Fassung, statt
// jede noch einmal NETZ_FRIST zu warten - sonst stand die App erst nach 6
// statt 3 s da. Nebenbei passen HTML und Skripte so zum selben Stand. Der
// Abruf im Hintergrund laeuft trotzdem und frischt den Cache auf. Geht der
// Service Worker zwischendurch schlafen, ist der Wert weg - dann gilt eben
// wieder die Frist.
const CACHE_ZUERST_MS = 10000;
let cacheZuerstBis = 0;

function mitFrist(versprechen, ms) {
  return new Promise((ok, fehler) => {
    const uhr = setTimeout(() => fehler(new Error("Frist")), ms);
    versprechen.then(
      (wert) => { clearTimeout(uhr); ok(wert); },
      (grund) => { clearTimeout(uhr); fehler(grund); });
  });
}

self.addEventListener("fetch", (event) => {
  const anfrage = event.request;
  const url = new URL(anfrage.url);
  // Nur eigene, statische GETs behandeln - /api/* und fremde Origins normal
  // durchlassen, damit app.js deren Fehlerbehandlung unveraendert greift.
  if (anfrage.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const istNavigation = anfrage.mode === "navigate";
  // Navigationen ohne ?-Teil ablegen, sonst sammelte jeder Einladungslink
  // einen eigenen Eintrag.
  const schluessel = istNavigation ? url.origin + url.pathname : anfrage;

  let ablage = Promise.resolve();
  const netz = fetch(anfrage).then((antwort) => {
    // Eine Navigation auf /index.html bekommt hier den 308 als
    // "opaqueredirect" - der geht unveraendert an den Browser, der ihm folgt,
    // landet aber nicht im Cache (taugtFuerCache).
    if (taugtFuerCache(antwort)) {
      const kopie = antwort.clone();
      ablage = caches.open(CACHE_NAME).then((cache) => cache.put(schluessel, kopie));
    }
    return antwort;
  });
  // Der Abruf darf zu Ende laufen und den Cache auffrischen, auch wenn die
  // Seite nach der Frist schon die gecachte Fassung bekommen hat.
  event.waitUntil(netz.then(() => ablage).catch(() => {}));

  event.respondWith((async () => {
    if (!istNavigation && Date.now() < cacheZuerstBis) {
      const gecacht = await ausCache(anfrage, false);
      if (gecacht) return gecacht;
    }
    try {
      return await mitFrist(netz, NETZ_FRIST);
    } catch (e) {
      const gecacht = await ausCache(anfrage, istNavigation);
      if (gecacht) {
        if (istNavigation) cacheZuerstBis = Date.now() + CACHE_ZUERST_MS;
        return gecacht;
      }
      // Nichts im Cache (erster Besuch bei langsamem Netz): weiter aufs Netz
      // warten. Ist es ganz weg, scheitert das wie vor dem Service Worker.
      return netz;
    }
  })());
});
