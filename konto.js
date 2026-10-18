"use strict";

/* ====================================================================
   Mehrere Konten im selben Browser, je Tab eines.

   Gedacht fuer Admin + Testkonto: Tab 1 zeigt das eine, Tab 2 das andere,
   und keiner meldet den anderen ab. Die Sitzungen selbst haelt der Server in
   HttpOnly-Cookies (functions/_lib/session.js). Hier steht nur, WELCHES Konto
   dieser Tab meint:
   - sessionStorage "konto": das Konto dieses Tabs. Lebt so lange wie der Tab,
     ueberlebt Neuladen und Seitenwechsel im selben Tab (auch den Umweg ueber
     Google beim Verbinden).
   - localStorage "kontoZuletzt": das zuletzt gewaehlte - Startwert fuer
     jeden neuen Tab.

   Ist nichts gesetzt, laeuft alles wie vor den Mehrkonten: kein Header, der
   Server nimmt das erste Konto. Gesetzt wird es nur, solange wirklich mehr
   als ein Konto angemeldet ist - normale Nutzer kommen nie dahin.

   Wer das Konto wechselt, laedt danach neu: Speicherschluessel
   (kontoSchluessel) und der Zustand der App haengen am Konto und werden nur
   beim Laden bestimmt.

   Muss als ERSTES Skript laufen: app.js, kalender.js und die Gewohnheiten
   lesen ihre Schluessel schon beim Laden, und jeder fetch soll den Header
   tragen.
   ==================================================================== */
(function () {
  const TAB_SCHLUESSEL = "konto";
  const ZULETZT_SCHLUESSEL = "kontoZuletzt";
  const HEADER = "X-Konto";

  // Gesperrter Speicher (privates Fenster, Blocker) darf die App nicht
  // umwerfen - dann gibt es eben nur das erste Konto.
  function lies(speicher, name) {
    try { return speicher.getItem(name); } catch (e) { return null; }
  }
  function schreib(speicher, name, wert) {
    try {
      if (wert == null) speicher.removeItem(name);
      else speicher.setItem(name, String(wert));
    } catch (e) { /* siehe oben */ }
  }
  function alsId(wert) {
    const id = Number(wert);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  // Der Anmeldelink (/api/auth/link) haengt ?konto=<id> an, wenn das Konto
  // zu den schon angemeldeten dazukam - der Tab, in dem er aufgeht, soll
  // genau dieses zeigen. Danach raus aus der Adresszeile.
  const url = new URL(location.href);
  if (url.searchParams.has("konto")) {
    const id = alsId(url.searchParams.get("konto"));
    url.searchParams.delete("konto");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (id) {
      schreib(sessionStorage, TAB_SCHLUESSEL, id);
      schreib(localStorage, ZULETZT_SCHLUESSEL, id);
    }
  }

  let tabKonto = alsId(lies(sessionStorage, TAB_SCHLUESSEL));
  if (!tabKonto) {
    tabKonto = alsId(lies(localStorage, ZULETZT_SCHLUESSEL));
    if (tabKonto) schreib(sessionStorage, TAB_SCHLUESSEL, tabKonto);
  }

  /** ID des Kontos, das dieser Tab zeigt - oder null (= erstes Konto). */
  window.kontoDesTabs = () => tabKonto;

  /** Dieser Tab (und jeder neue) zeigt ab dem naechsten Laden Konto `id`. */
  window.kontoWaehlen = (id) => {
    tabKonto = alsId(id);
    schreib(sessionStorage, TAB_SCHLUESSEL, tabKonto);
    schreib(localStorage, ZULETZT_SCHLUESSEL, tabKonto);
  };

  /** Zurueck zum Normalfall: nur noch ein Konto, kein Header. */
  window.kontoVergessen = () => {
    tabKonto = null;
    schreib(sessionStorage, TAB_SCHLUESSEL, null);
    schreib(localStorage, ZULETZT_SCHLUESSEL, null);
  };

  /**
   * localStorage-Schluessel je Konto. Ohne die Trennung teilten sich zwei
   * Tabs den Offline-Speicher - eine offline abgehakte Gewohnheit aus dem
   * Test-Tab landete dann beim Nachliefern im Admin-Konto. Im Normalfall
   * bleibt der Schluessel, wie er immer war.
   */
  window.kontoSchluessel = (name) => (tabKonto ? `${name}@${tabKonto}` : name);

  /** Fuer echte Seitenaufrufe nach /api/..., die keinen Header tragen koennen. */
  window.kontoAdresse = (pfad) => {
    if (!tabKonto) return pfad;
    const ziel = new URL(pfad, location.origin);
    ziel.searchParams.set("konto", tabKonto);
    return ziel.pathname + ziel.search;
  };

  // Jede eigene API-Anfrage traegt das Konto des Tabs. Eine Huelle um fetch
  // statt dreissig angepasster Aufrufe: so kann keine Stelle es vergessen,
  // auch keine, die erst spaeter dazukommt.
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = function (eingabe, optionen) {
    if (!tabKonto) return fetchOriginal(eingabe, optionen);
    const istRequest = typeof Request !== "undefined" && eingabe instanceof Request;
    const ziel = new URL(istRequest ? eingabe.url : String(eingabe), location.href);
    if (ziel.origin !== location.origin || !ziel.pathname.startsWith("/api/")) {
      return fetchOriginal(eingabe, optionen);
    }
    const headers = new Headers((optionen && optionen.headers) || (istRequest ? eingabe.headers : undefined));
    headers.set(HEADER, String(tabKonto));
    return fetchOriginal(eingabe, Object.assign({}, optionen, { headers }));
  };

  // Dasselbe fuer Links auf /api/... (Gewohnheiten-Export): kurz vor dem
  // Klick das Konto anhaengen.
  document.addEventListener("click", (e) => {
    if (!tabKonto || !e.target.closest) return;
    const link = e.target.closest('a[href^="/api/"]');
    if (link) link.setAttribute("href", window.kontoAdresse(link.getAttribute("href")));
  }, true);
})();
