"use strict";

/* ====================================================================
   ToDo-Liste – Board-Ansicht (Cloud-Version)
   - Eigenes, einklappbares Eingabefeld pro Spalte (Termin per Kalender-Icon)
   - Bereichsname und ToDo werden per Doppelklick bearbeitet
   - Erledigte ToDos unten in jeder Spalte (einklappbar, aufräumbar)
   - Verschieben zwischen Bereichen UND Umsortieren termin-loser ToDos
     per Drag & Drop
   - Heller / dunkler Modus
   Daten liegen in einer Cloudflare-D1-Datenbank und werden bei jeder
   Aenderung ueber /api/todos zurueckgeschrieben, damit alle Geraete
   denselben Stand sehen.
   ==================================================================== */

// ---------- Cloud-Speicher ----------
// Alles laeuft ueber /api/todos (siehe functions/api/todos.js). Die App kennt
// weder Datenbank noch Zugangsdaten - wer angemeldet ist, entscheidet das
// Sitzungs-Cookie, und der Server liefert nur die eigenen Daten aus.
const API_BASE = "/api/todos";

// Mehrere Listen (boards) liegen zugleich im Speicher. `state` zeigt immer auf
// die gerade aktive Liste - so arbeitet der ganze Render- und Bearbeiten-Code
// unveraendert auf state.categories / state.todos weiter, ohne von den Listen
// zu wissen.
let listen = [];           // Metadaten je Liste (Form siehe /api/todos)
let daten = {};            // { [listeId]: { categories, themen, todos } }
let aktiveListe = null;    // id der aktiven Liste (oder null: keine Liste)
let state = { categories: [], themen: [], todos: [], unterpunkte: [] };
let editingId = null;      // id des ToDos, das gerade bearbeitet wird
let editingCat = null;     // id des Bereichs, dessen Name gerade bearbeitet wird
let editingThema = null;   // id des Ueber-Themas, dessen Name gerade bearbeitet wird
let draggedId = null;      // id des ToDos, das gerade gezogen wird
let draggedCat = null;     // id des Bereichs, der gerade umsortiert wird
let draggedThema = null;   // id des Ueber-Themas, das gerade gezogen wird
// Wo gerade ein Eingabefeld aufgeklappt ist: Bereich plus Ziel-Thema. Ein ToDo
// kann frei im Bereich (addingThema null) oder in einem Ueber-Thema entstehen.
let addingCat = null;      // Bereich, dessen Eingabefeld gerade aufgeklappt ist
let addingThema = null;    // Ueber-Thema fuer das offene Eingabefeld (null = frei)
let farbePickerFuer = null; // id des Bereichs, dessen Farbauswahl gerade offen ist
let themaWerkzeugeFuer = null; // id des Bereichs, dessen "+Thema"/Farbe-Zeile offen ist
let unterpunktEingabeOffen = null; // id des ToDos, dessen "+Unterpunkt"-Feld im Bearbeiten-Dialog offen ist

// Feste Palette fuer die Bereichsfarbe (Punkt am Namen + Streifen am
// Bereich). Muss zu FARBEN_ERLAUBT in functions/api/todos.js passen.
const FARBEN = [
  { id: "blau",    name: "Blau"   },
  { id: "tuerkis", name: "Türkis" },
  { id: "gruen",   name: "Grün"   },
  { id: "lila",    name: "Lila"   },
  { id: "pink",    name: "Pink"   },
  { id: "grau",    name: "Grau"   },
];

// Wiederholungsmuster fuer ToDos. Muss zu WIEDERHOLUNG_ERLAUBT in
// functions/api/todos.js passen.
const WIEDERHOLUNGEN = [
  { id: "taeglich",     name: "Täglich"     },
  { id: "woechentlich", name: "Wöchentlich" },
  { id: "monatlich",    name: "Monatlich"   },
  { id: "jaehrlich",    name: "Jährlich"    },
];

// Eingeklappte Erledigt-Bereiche pro Kategorie (in localStorage gemerkt).
let doneCollapsed = {};
try { doneCollapsed = JSON.parse(localStorage.getItem("doneCollapsed") || "{}"); }
catch (e) { doneCollapsed = {}; }

// Eingeklappte Ueber-Themen, Schluessel ist die Themen-id (ebenfalls gemerkt).
let themaCollapsed = {};
try { themaCollapsed = JSON.parse(localStorage.getItem("themaCollapsed") || "{}"); }
catch (e) { themaCollapsed = {}; }

// ---------- DOM-Referenzen ----------
const board        = document.getElementById("board");
const addCatBtn    = document.getElementById("addCatBtn");
const addTodoBtn   = document.getElementById("addTodoBtn");
const saveStatusEl = document.getElementById("saveStatus");
const themeSwitch      = document.getElementById("themeSwitch");
const themeSwitchLabel = document.getElementById("themeSwitchLabel");
const pushSwitch       = document.getElementById("pushSwitch");
const pushSwitchLabel  = document.getElementById("pushSwitchLabel");
const pushSwitchWrap   = document.getElementById("pushSwitchWrap");
const pushHinweis      = document.getElementById("pushHinweis");
const einstellungenBtn = document.getElementById("einstellungenBtn");
const listenMenue  = document.getElementById("listenMenue");
const snackbar     = document.getElementById("snackbar");
const titel        = document.getElementById("titel");
const einstellungenPopup = document.getElementById("einstellungenPopup");
const offlineBanner = document.getElementById("offlineBanner");

// Oeffentlicher Sitekey des Turnstile-Widgets fuer todo.it-wolf.org. Darf im
// Quelltext stehen - der geheime Schluessel liegt als TURNSTILE_SECRET im
// Pages-Projekt und verlaesst den Server nie.
const TURNSTILE_SITEKEY = "0x4AAAAAAD59Ii7T3CeedSfa";
let turnstileId = null;

// Oeffentlicher VAPID-Schluessel fuer Push-Benachrichtigungen - wie der
// Turnstile-Sitekey unbedenklich im Quelltext, der private Schluessel liegt
// als VAPID_PRIVATE_KEY im Pages-Projekt (siehe functions/_lib/webpush.js).
const VAPID_PUBLIC_KEY = "BGDQTQDoRHFvbkqBEc5t_-A_Xa-QyUIzzN56qZigMR5jSCU8wF7HNv1EHOG91lFrQaui2xElzlLLCLkvdKjnypA";

// Werden beim Laden aus der Server-Antwort gesetzt. istAdmin ist nur fuer
// die Optik - /api/admin/* prueft die Rolle selbst nochmal.
let istAdmin = false;
let eigeneEmail = "";
let eigenerName = "";
// Ob das Konto zusaetzlich Zugang zum Fokus-Tracker hat - fuer den
// Abschnitt "Fokus-Tracker" in den Einstellungen.
let fokusZugang = false;

// ---------- Hilfsfunktionen ----------
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

// ---------- Sonder-Bereich "Ohne Bereich" ----------
// Ein Auffangbereich fuer ToDos, die (noch) zu keinem Bereich gehoeren.
// Technisch ein ganz normaler Eintrag in `lists` - kein Schema-Sonderfall -,
// nur an einer deterministischen id erkennbar: "ohnebereich:" + boardId.
// Deterministisch, damit zwei Geraete nie zwei davon anlegen; pro Board
// eindeutig, weil die boardId es ist. Die Spalte erscheint immer ganz links
// und nur, solange sie ToDos enthaelt (oder gerade befuellt wird) - siehe
// synchronisiereOhneBereich(). Kein Umbenennen, kein Loeschen, keine Themen.
const OHNE_PREFIX = "ohnebereich:";
const OHNE_NAME = "Ohne Bereich";
function ohneBereichId(boardId) { return OHNE_PREFIX + boardId; }
function istOhneBereich(catId) { return typeof catId === "string" && catId.startsWith(OHNE_PREFIX); }

// Datum n Tage ab heute als "YYYY-MM-DD".
function addDaysStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return addDaysStr(0); }

// Naechstes Datum fuer ein Wiederholungsmuster, ausgehend von einem
// gegebenen "YYYY-MM-DD" (nicht von heute, siehe addDaysStr). Rechnet ueber
// lokale Date-Methoden (nicht new Date(iso) - das parst als UTC und kann je
// nach Zeitzone einen Tag verschieben). Bei Monat/Jahr auf den letzten Tag
// des Zielmonats geklemmt, falls der Ausgangstag dort nicht existiert (31.
// Januar + 1 Monat -> 28./29. Februar, nicht in den Maerz uebergelaufen).
function naechsteFaelligkeit(iso, muster) {
  const [y, m, d] = iso.split("-").map(Number);
  const datum = new Date(y, m - 1, d);
  if (muster === "taeglich") {
    datum.setDate(datum.getDate() + 1);
  } else if (muster === "woechentlich") {
    datum.setDate(datum.getDate() + 7);
  } else if (muster === "monatlich") {
    const zielTag = datum.getDate();
    datum.setDate(1);                     // sicher auf den 1. springen...
    datum.setMonth(datum.getMonth() + 1); // ...dann den Monat weiterschalten...
    const letzterTag = new Date(datum.getFullYear(), datum.getMonth() + 1, 0).getDate();
    datum.setDate(Math.min(zielTag, letzterTag)); // ...zielTag setzen, geklemmt.
  } else if (muster === "jaehrlich") {
    const zielTag = datum.getDate();
    const zielMonat = datum.getMonth();
    datum.setDate(1);
    datum.setFullYear(datum.getFullYear() + 1);
    const letzterTag = new Date(datum.getFullYear(), zielMonat + 1, 0).getDate();
    datum.setMonth(zielMonat);
    datum.setDate(Math.min(zielTag, letzterTag));
  } else {
    return iso; // unbekanntes Muster - unveraendert zurueck, sollte nie vorkommen
  }
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
}

// Wiederholt naechsteFaelligkeit(), bis das Ergebnis nicht mehr in der
// Vergangenheit liegt - wer spaet abhakt, bekommt keinen sofort
// ueberfaelligen Folgetermin, sondern den naechsten ECHT anstehenden.
function folgeTermin(iso, muster) {
  let naechster = naechsteFaelligkeit(iso, muster);
  const heute = todayStr();
  while (naechster < heute) naechster = naechsteFaelligkeit(naechster, muster);
  return naechster;
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Kurzform fuer das Kalender-Icon, z. B. "15.07."
function formatDateShort(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

function dueInfo(iso) {
  if (!iso) return null;
  const today = todayStr();
  if (iso < today) return { cls: "overdue", badge: "Überfällig" };
  if (iso === today) return { cls: "today", badge: "Heute" };
  if (iso === addDaysStr(1)) return { cls: "", badge: "Morgen" };
  return { cls: "", badge: "" };
}

// ---------- App-Icon-Badge (installierte PWA) ----------
// Zaehlt UEBER ALLE Listen (nicht nur die aktive): faellige/ueberfaellige,
// nicht erledigte ToDos. Der Push im Hintergrund (siehe sw.js) setzt dieselbe
// Zahl auch ohne offene App; hier zusaetzlich bei jedem Rendern, damit sie
// sich sofort senkt, sobald man ein ToDo abhakt - waehrend die App offen ist,
// kann kein Push das nachholen.
let letzteBadgeZahl = null;
function aktualisiereBadge() {
  if (!("setAppBadge" in navigator)) return;
  const heute = todayStr();
  let n = 0;
  for (const id in daten) {
    for (const t of (daten[id].todos || [])) {
      if (!t.done && t.due && t.due <= heute) n++;
    }
  }
  if (n === letzteBadgeZahl) return;
  letzteBadgeZahl = n;
  if (n > 0) navigator.setAppBadge(n).catch(() => {});
  else navigator.clearAppBadge().catch(() => {});
}

// Dringlich = ueberfaellig, heute oder morgen faellig. Steuert die Ampelfarben
// (Streifen am ToDo und Zaehler neben der Bereichs-Ueberschrift).
function isUrgent(iso) { return !!iso && iso <= addDaysStr(1); }

// Neu erzeugte Ausgabe eines wiederkehrenden ToDos (siehe toggleDone): bis zum
// Faelligkeitstag unsichtbar, damit man nach dem Abhaken nicht sofort wieder
// dieselbe Zeile sieht. NUR wiederkehrende ToDos - ein normales ToDo mit
// Zukunftstermin bleibt wie bisher sofort sichtbar (Morgen-Anzeige, rote
// Dringlichkeit ab morgen bleiben fuer den Normalfall unangetastet).
function nochNichtFaellig(t) {
  return !t.done && !!t.wiederholung && !!t.due && t.due > todayStr();
}

// Nativen Kalender-Dialog eines Datumsfelds oeffnen. Das Feld selbst bleibt
// unsichtbar (siehe .date-field im CSS), showPicker braucht es aber im Layout.
function openDatePicker(input) {
  if (typeof input.showPicker === "function") {
    try { input.showPicker(); return; } catch (e) { /* Fallback unten */ }
  }
  input.focus();
  input.click();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------- Heller / dunkler Modus ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeSwitch.checked = theme === "dark";
  themeSwitchLabel.textContent = theme === "dark" ? "Dunkel" : "Hell";
}

// ---------- Zugang ----------
// Login per Anmeldelink (Code als Ausweg) statt Passwort - Endpunkte in
// functions/api/auth/. Die Sitzung lebt in einem HttpOnly-Cookie, das der
// Browser bei jeder gleichseitigen Anfrage von selbst mitschickt; anders als
// das fruehere Passwort in localStorage kommt kein Skript im Browser mehr
// an das Sitzungstoken heran.
//
// canSave bleibt false, bis der vorhandene Stand wirklich gelesen wurde -
// sonst wuerde die erste Aenderung nach einem Ladefehler das Board leer
// ueberschreiben. Wird auch nach einer erfolgreichen Wiederherstellung aus
// dem lokalen Cache (offline) true, weil dann ebenfalls ein echter,
// nicht-leerer Stand vorliegt.
let canSave = false;
// Beste bekannte Einschaetzung, aus echten fetch-Ergebnissen abgeleitet -
// bewusst nicht navigator.onLine direkt (das meldet z. B. bei einem WLAN
// ohne echtes Internet faelschlich "online").
let serverErreichbar = true;

// ---------- Anmeldemaske ----------
// Normalfall: Adresse eintragen, Mail oeffnen, Link klicken - fertig. Diese
// Maske bleibt dabei stehen; angemeldet wird man durch den Link im anderen
// Tab. Das Codefeld ist der Ausweg fuer den Geraetewechsel.
// Turnstile-Widget nur im Wartelisten-Schritt zeigen. Der Login braucht es
// nicht: dort kommen ohnehin nur bekannte Adressen durch.
//
// Das Skript laedt async - wenn der Nutzer schneller ist, wird spaeter
// nachgeholt. Ohne geladenes Skript bleibt turnstileId null; die Function
// laesst dann durch, solange sie kein Token erwartet.
function zeigeTurnstile(an) {
  const kasten = document.getElementById("lockTurnstile");
  kasten.hidden = !an;
  if (!an) return;
  if (!window.turnstile) {
    // Skript noch unterwegs - gleich nochmal versuchen.
    setTimeout(() => { if (!kasten.hidden) zeigeTurnstile(true); }, 400);
    return;
  }
  if (turnstileId === null) {
    turnstileId = window.turnstile.render(kasten, {
      sitekey: TURNSTILE_SITEKEY,
      theme: "auto",
      // Unsichtbar: das Widget zeigt sich nur, wenn Turnstile jemanden
      // wirklich pruefen will. Der Normalfall - stilles Durchwinken - laeuft
      // ohne einen Pixel Oberflaeche ab. Das ist mehr als reine Optik: ein
      // Kaestchen "Ich bin kein Roboter" ist fuer den Eintragenden eine
      // zusaetzliche Huerde, die er in 99 % der Faelle gar nicht braucht.
      appearance: "interaction-only",
    });
    // Kein Ladehinweis mit Zeitschaltung hier: ein fehlendes iframe ist der
    // Normalfall, kein Fehler. Ob es geklappt hat, zeigt allein das Token -
    // und das wird beim Absenden geprueft.
  } else {
    // Nach einem Absenden ist das Token verbraucht.
    window.turnstile.reset(turnstileId);
  }
}

function turnstileToken() {
  if (turnstileId === null || !window.turnstile) return "";
  return window.turnstile.getResponse(turnstileId) || "";
}

function login() {
  return new Promise(resolve => {
    const overlay  = document.getElementById("lock");
    const form     = document.getElementById("lockForm");
    const email    = document.getElementById("lockEmail");
    const code     = document.getElementById("lockCode");
    const name     = document.getElementById("lockName");
    const msg      = document.getElementById("lockMsg");
    const umschalt = document.getElementById("lockSwitch");
    const erfolg   = document.getElementById("lockErfolg");
    const button   = form.querySelector("button[type=submit]");
    let schritt = "email";
    let aktuelleEmail = "";
    let wartetAufLink = null;

    const setzeMeldung = (text, gut) => {
      msg.textContent = text;
      msg.classList.toggle("ok", !!gut);
    };

    // Waehrend die Maske auf den Anmeldelink wartet, regelmaessig nachsehen,
    // ob inzwischen eine Sitzung besteht. Wer den Link im selben Browser
    // oeffnet, ist danach in einem zweiten Tab angemeldet - ohne diese
    // Abfrage bliebe dieser hier auf der Anmeldemaske stehen und man muesste
    // doch wieder den Code abtippen, obwohl der Link laengst geklickt wurde.
    const hoerAufZuWarten = () => {
      clearInterval(wartetAufLink);
      wartetAufLink = null;
    };

    const warteAufLink = () => {
      hoerAufZuWarten();
      wartetAufLink = setInterval(async () => {
        try {
          const res = await fetch("/api/auth/status", { cache: "no-store" });
          const daten = await res.json();
          if (!daten.angemeldet) return;
          hoerAufZuWarten();
          overlay.classList.add("hidden");
          resolve();
        } catch (e) { /* offline oder kurz gestoert - beim naechsten Mal wieder */ }
      }, 3000);
    };

    const zeigeEmailSchritt = () => {
      schritt = "email";
      hoerAufZuWarten();
      erfolg.hidden = true;
      form.hidden = false;
      document.getElementById("lockHint").textContent = "Mit deiner E-Mail-Adresse anmelden.";
      name.hidden = true;
      email.hidden = false;
      code.hidden = true;
      zeigeTurnstile(false);
      button.textContent = "Anmeldelink anfordern";
      umschalt.hidden = false;
      umschalt.textContent = "Noch keinen Zugang? Eintragen";
      setzeMeldung("");
      overlay.classList.remove("hidden");
      email.focus();
    };

    // Dritter Schritt: Warteliste. Kein eigener Bildschirm, sondern dieselbe
    // Maske mit einem zusaetzlichen Namensfeld - wer hier landet, kam gerade
    // von "Diese Adresse ist nicht freigeschaltet" und soll nicht erst
    // woandershin navigieren muessen.
    const zeigeWartelisteSchritt = () => {
      schritt = "warteliste";
      hoerAufZuWarten();
      erfolg.hidden = true;
      form.hidden = false;
      document.getElementById("lockHint").textContent =
        "Trag dich ein — du bekommst eine Mail, sobald du freigeschaltet bist.";
      name.hidden = false;
      email.hidden = false;
      code.hidden = true;
      button.textContent = "Eintragen";
      zeigeTurnstile(true);
      umschalt.hidden = false;
      umschalt.textContent = "Zurück zur Anmeldung";
      setzeMeldung("");
      name.focus();
    };

    const zeigeCodeSchritt = () => {
      schritt = "code";
      // Der Hinweis auf die Wartezeit ist wichtiger, als er aussieht: die
      // Zustellung haengt an Gmail und dauert bei einer frisch eingerichteten
      // Sendedomain gern mal eine halbe Minute. Ohne den Hinweis wirkt das wie
      // ein Fehler, und man fordert unnoetig einen zweiten Code an.
      document.getElementById("lockHint").textContent =
        `Mail an ${aktuelleEmail} geschickt — kann eine halbe Minute dauern. ` +
        `Klick dort auf „Jetzt anmelden“, dann geht es hier von selbst weiter.`;
      warteAufLink();
      name.hidden = true;
      email.hidden = true;
      code.hidden = false;
      code.value = "";
      zeigeTurnstile(false);
      button.textContent = "Anmelden";
      // Auf dem Code-Schritt waere der Umschalter nur verwirrend - hier geht
      // es nicht mehr um die Frage, ob man einen Zugang hat.
      umschalt.hidden = true;
      setzeMeldung("");
      code.focus();
    };

    // Meldung des Servers uebernehmen, wenn es eine gibt - der weiss genauer,
    // was schiefging als jeder pauschale Text hier.
    const serverMeldung = async (res, standard) => {
      try {
        const daten = await res.json();
        if (daten && daten.error) return daten.error;
      } catch (e) { /* keine JSON-Antwort */ }
      return standard;
    };

    umschalt.onclick = () => {
      if (schritt === "warteliste") zeigeEmailSchritt();
      else zeigeWartelisteSchritt();
    };

    document.getElementById("lockErfolgZurueck").onclick = zeigeEmailSchritt;

    form.onsubmit = async e => {
      e.preventDefault();
      setzeMeldung("");
      button.disabled = true;
      const beschriftung = button.textContent;
      button.textContent = schritt === "code" ? "Prüfe …" : "Moment …";
      try {
        if (schritt === "email") {
          aktuelleEmail = email.value.trim();
          if (!aktuelleEmail) return;
          const res = await fetch("/api/auth/request-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aktuelleEmail }),
          });
          if (!res.ok) {
            const text = await serverMeldung(res, "Code konnte nicht verschickt werden.");
            // Unbekannte Adresse: direkt in den Wartelisten-Modus wechseln,
            // statt es dem Nutzer als Sackgasse zu praesentieren. Die Adresse
            // bleibt stehen, es fehlt nur noch der Name.
            if (res.status === 404) {
              zeigeWartelisteSchritt();
              setzeMeldung(text + " Trag dich ein, dann schalte ich dich frei.");
            } else {
              setzeMeldung(text);
              email.focus();
            }
            return;
          }
          zeigeCodeSchritt();
        } else if (schritt === "warteliste") {
          const wunschName = name.value.trim();
          const wunschEmail = email.value.trim();
          if (!wunschName || !wunschEmail) {
            setzeMeldung("Bitte Name und Adresse ausfüllen.");
            return;
          }
          // Erst hier zaehlt es: liegt kein Token vor, ist die Pruefung
          // entweder noch unterwegs oder blockiert. Beides erklaeren, statt
          // den Server eine kryptische Absage schicken zu lassen.
          const bot = turnstileToken();
          if (turnstileId !== null && !bot) {
            // Zwei ganz verschiedene Faelle, die sich nur daran unterscheiden
            // lassen, ob das Widget Platz einnimmt: entweder Turnstile will
            // wirklich etwas von einem (dann steht da ein Kaestchen und man
            // muss es anklicken), oder es kommt gar nicht durch.
            const sichtbar = document.getElementById("lockTurnstile").offsetHeight > 10;
            setzeMeldung(sichtbar
              ? "Bitte bestätige oben noch kurz, dass du kein Bot bist."
              : "Die Bot-Prüfung ist noch nicht durch — kurz warten und nochmal. " +
                "Bleibt es dabei, blockiert sie vermutlich ein Werbeblocker.");
            return;
          }
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: wunschName, email: wunschEmail, turnstile: bot }),
          });
          if (!res.ok) {
            setzeMeldung(await serverMeldung(res, "Eintragen hat nicht geklappt."));
            return;
          }
          const daten = await res.json().catch(() => ({}));
          // Formular weg, Bestaetigung her. Vorher blieb die Maske stehen und
          // nur eine kleine gruene Zeile darunter aenderte sich - zu wenig
          // fuer den Abschluss eines Vorgangs.
          document.getElementById("lockErfolgText").textContent =
            daten.message ||
            `Wir haben deine Anfrage für ${wunschEmail} bekommen. ` +
            `Sobald du freigeschaltet bist, kommt eine Mail.`;
          zeigeTurnstile(false);
          form.hidden = true;
          erfolg.hidden = false;
          name.value = "";
          if (turnstileId !== null && window.turnstile) window.turnstile.reset(turnstileId);
        } else {
          const eingegeben = code.value.trim();
          if (!/^\d{6}$/.test(eingegeben)) { setzeMeldung("Sechsstelligen Code eingeben."); return; }
          const res = await fetch("/api/auth/verify-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aktuelleEmail, code: eingegeben }),
          });
          if (!res.ok) {
            setzeMeldung("Falscher oder abgelaufener Code.");
            code.value = "";
            code.focus();
            return;
          }
          hoerAufZuWarten();
          overlay.classList.add("hidden");
          resolve();
        }
      } finally {
        button.disabled = false;
        // Nur zuruecksetzen, wenn der Schrittwechsel die Beschriftung nicht
        // ohnehin schon neu gesetzt hat.
        if (button.textContent === "Moment …" || button.textContent === "Prüfe …") {
          button.textContent = beschriftung;
        }
      }
    };

    zeigeEmailSchritt();

    // /api/auth/link leitet bei einem abgelaufenen oder schon benutzten Link
    // hierher zurueck. Ohne Hinweis stuende man wieder vor der Maske und
    // wuesste nicht, warum der Klick nichts gebracht hat.
    const grund = new URLSearchParams(location.search).get("login");
    if (grund) {
      setzeMeldung(grund === "abgelaufen"
        ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an."
        : "Die Anmeldung über den Link hat nicht geklappt.");
      // Aus der Adresszeile nehmen, damit ein Neuladen den Hinweis nicht
      // wiederholt.
      history.replaceState(null, "", location.pathname);
    }
  });
}

// Abmelden: Sitzung serverseitig loeschen, dann die Seite neu laden. Der
// Neustart ist Absicht - er wirft den Board-Zustand aus dem Speicher, statt
// die fremden ToDos bis zum naechsten Login sichtbar zu lassen.
async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    // Auch wenn der Aufruf scheitert, neu laden - dann greift spaetestens
    // die Sitzungspruefung beim naechsten Abruf.
  }
  location.reload();
}

// Angemeldet, aber kein todo_zugang. Hier hilft kein zweiter Versuch,
// deshalb ein eigener Kasten statt einer Zeile in der Anmeldemaske - siehe
// #lockGesperrt in index.html.
function zeigeGesperrt(text) {
  document.getElementById("lockForm").hidden = true;
  document.getElementById("lockErfolg").hidden = true;
  document.getElementById("lockGesperrt").hidden = false;
  document.getElementById("lockGesperrtText").textContent =
    text || "Dieses Konto ist für die ToDo-Liste nicht freigeschaltet.";
  document.getElementById("lock").classList.remove("hidden");
}
document.getElementById("lockAbmelden").addEventListener("click", logout);

// ---------- Umschalter-Menue ----------
// Kleines Aufklappmenue am Titel, um zwischen den Listen zu wechseln.
function aktualisiereMenue() {
  listenMenue.innerHTML = "";
  for (const b of listen) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menue-eintrag" + (b.id === aktiveListe ? " aktiv" : "");
    const name = document.createElement("span");
    name.textContent = b.name;
    btn.appendChild(name);
    if (!b.istEigen && b.besitzerName) {
      const von = document.createElement("span");
      von.className = "menue-von";
      von.textContent = `von ${b.besitzerName}`;
      btn.appendChild(von);
    }
    btn.addEventListener("click", () => wechsleListe(b.id));
    listenMenue.appendChild(btn);
  }
}
function toggleMenue() {
  if (listenMenue.hidden) { aktualisiereMenue(); listenMenue.hidden = false; }
  else listenMenue.hidden = true;
}
function schliesseMenue() { listenMenue.hidden = true; }

// ---------- Einstellungen ----------
// Ein Dialog mit mehreren Ansichten: Hauptansicht (Listen + Konto),
// Zugriff-verwalten, Abmelde-, Zugang-aufgeben- und Loesch-Rueckfrage.
const einAnsichten = {
  haupt:          document.getElementById("einstellungenHaupt"),
  mitglieder:     document.getElementById("mitgliederAnsicht"),
  abmelden:       document.getElementById("kontoAbmeldenFrage"),
  zugangAufgeben: document.getElementById("todoZugangAufgebenFrage"),
  loeschen:       document.getElementById("kontoLoeschenFrage"),
};
function zeigeEinAnsicht(name) {
  for (const [k, el] of Object.entries(einAnsichten)) el.hidden = k !== name;
}

// Akkordeon der Hauptansicht: je Oeffnen klappen die anderen Abschnitte zu -
// die <details> werden nie neu gerendert, darum reicht eine einmalige
// Verdrahtung auf das native "toggle"-Event (deckt auch Tastaturbedienung
// ab, nicht nur Klicks).
document.querySelectorAll("#einstellungenHaupt > details.ein-abschnitt").forEach(det => {
  det.addEventListener("toggle", () => {
    if (det.open) {
      document.querySelectorAll("#einstellungenHaupt > details.ein-abschnitt").forEach(other => {
        if (other !== det) other.open = false;
      });
    }
  });
});

// Bei jedem Oeffnen auf denselben Ausschnitt zurueck - "Meine Listen" ist
// laut Erst-Hinweis der haeufigste Grund fuers Zahnrad, der Rest faengt zu.
function resetAkkordeon() {
  document.querySelectorAll("#einstellungenHaupt > details.ein-abschnitt").forEach(det => {
    det.open = det.dataset.abschnitt === "listen";
  });
}

// Fokus-Tracker-Zeile: Status-Text und "aktiv"-Farbe. Eigene Funktion statt
// Teil von aktualisiereEinSubtexte(), weil sie auch direkt nach dem Freischalten
// (ohne Akkordeon-Kontext) aufgerufen wird.
function aktualisiereFokusLink() {
  document.getElementById("subFokus").textContent = fokusZugang ? "aktiv" : "nicht aktiv";
  document.getElementById("fokusLink").classList.toggle("aktiv", fokusZugang);
}

// Kurztext in jeder Kopfzeile, auch zugeklappt sichtbar - Antwort auf "ich
// finde Dinge nicht wieder": man sieht schon vor dem Aufklappen, was
// ungefaehr drinsteckt.
function aktualisiereEinSubtexte() {
  const eigeneZahl = listen.filter(b => b.istEigen).length;
  document.getElementById("subListen").textContent = eigeneZahl === 1 ? "1 Liste" : `${eigeneZahl} Listen`;

  const geteiltZahl = listen.filter(b => !b.istEigen).length;
  document.getElementById("subGeteilt").textContent = geteiltZahl === 1 ? "1 Liste" : `${geteiltZahl} Listen`;

  aktualisiereFokusLink();
  document.getElementById("subKonto").textContent = eigeneEmail;
}

function oeffneEinstellungen() {
  schliesseMenue();
  zeichneListen();
  resetAkkordeon();
  document.getElementById("kontoMsg").textContent = "";
  // Verwaltung nur fuer Admins - der Abschnitt bleibt sonst ausgeblendet.
  document.getElementById("adminAbschnitt").hidden = !istAdmin;
  document.getElementById("kontoAdminBadge").hidden = !istAdmin;

  // Als Admin nicht selbst den ToDo-Zugang aufgeben koennen (kein hartes
  // Aussperr-Risiko, /admin haengt an der Rolle - aber eine unnoetig
  // verwirrende Zwischenlage, siehe Kommentar im Endpunkt).
  document.getElementById("todoZugangAufgebenStart").hidden = istAdmin;
  document.getElementById("todoZugangAdminHinweis").hidden = !istAdmin;

  zeigeEinAnsicht("haupt");
  einstellungenPopup.hidden = false;
  aktualisierePushSchalter();
}

// Kleiner Knopf fuer die Listen-Zeilen.
function machBtn(text, fn, extra) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn klein" + (extra ? " " + extra : "");
  b.textContent = text;
  b.addEventListener("click", fn);
  return b;
}

// Die beiden Abschnitte "Meine Listen" und "Geteilt mit mir" neu aufbauen.
function zeichneListen() {
  const eigeneBox = document.getElementById("eigeneListen");
  const geteiltBox = document.getElementById("geteilteListen");
  eigeneBox.innerHTML = "";
  geteiltBox.innerHTML = "";

  const eigene = listen.filter(b => b.istEigen);
  const geteilt = listen.filter(b => !b.istEigen);

  for (const b of eigene) eigeneBox.appendChild(baueEigeneZeile(b));

  // "＋ neue Liste" sperren, sobald zwei eigene Listen bestehen.
  const voll = eigene.length >= 2;
  document.getElementById("neueListe").disabled = voll;
  const hinweis = document.getElementById("neueListeHinweis");
  hinweis.hidden = !voll;
  if (voll) hinweis.textContent = "Mehr als zwei eigene Listen gehen (noch) nicht.";

  document.getElementById("geteiltAbschnitt").hidden = geteilt.length === 0;
  for (const b of geteilt) geteiltBox.appendChild(baueGeteilteZeile(b));

  aktualisiereEinSubtexte();
}

function baueEigeneZeile(b) {
  const row = document.createElement("div");
  row.className = "listen-zeile";

  const kopf = document.createElement("div");
  kopf.className = "lz-kopf";
  const name = document.createElement("span");
  name.className = "lz-name" + (b.id === aktiveListe ? " aktiv" : "");
  name.textContent = b.name;
  kopf.appendChild(name);
  row.appendChild(kopf);

  const knoepfe = document.createElement("div");
  knoepfe.className = "lz-knoepfe";
  knoepfe.appendChild(machBtn("Teilen", () => teileListe(b)));
  knoepfe.appendChild(machBtn("Umbenennen", () => benenneListeUm(b)));
  // Loeschen bewusst als Symbol statt dritter Text-Knopf - selbe Optik wie
  // beim Bereich/Thema, faellt dadurch schon von der Form her als eigene,
  // seltener genutzte Aktion auf statt gleichrangig neben Teilen/Umbenennen.
  const loeschBtn = document.createElement("button");
  loeschBtn.type = "button";
  loeschBtn.className = "act del lz-loeschen";
  loeschBtn.title = "Liste löschen";
  loeschBtn.textContent = "🗑️";
  loeschBtn.addEventListener("click", () => loescheListe(b));
  knoepfe.appendChild(loeschBtn);
  row.appendChild(knoepfe);

  if (b.mitglieder > 0) {
    const verwalten = document.createElement("button");
    verwalten.type = "button";
    verwalten.className = "lz-geteilt";
    verwalten.textContent = `Geteilt mit ${b.mitglieder} · Zugriff verwalten`;
    verwalten.addEventListener("click", () => oeffneMitglieder(b));
    row.appendChild(verwalten);
  } else if (b.geteilt) {
    const info = document.createElement("div");
    info.className = "lz-geteilt-info";
    info.textContent = "Link erstellt – noch niemand beigetreten.";
    row.appendChild(info);
  }
  return row;
}

function baueGeteilteZeile(b) {
  const row = document.createElement("div");
  row.className = "listen-zeile";

  const kopf = document.createElement("div");
  kopf.className = "lz-kopf";
  const name = document.createElement("span");
  name.className = "lz-name" + (b.id === aktiveListe ? " aktiv" : "");
  name.textContent = b.name;
  const von = document.createElement("span");
  von.className = "lz-von";
  von.textContent = b.besitzerName ? `von ${b.besitzerName}` : "geteilt";
  kopf.appendChild(name);
  kopf.appendChild(von);
  row.appendChild(kopf);

  const knoepfe = document.createElement("div");
  knoepfe.className = "lz-knoepfe";
  knoepfe.appendChild(machBtn("Verknüpfung lösen", () => verlasseListe(b), "gefahr"));
  row.appendChild(knoepfe);
  return row;
}

// ---------- Listen-Aktionen ----------
async function teileListe(b) {
  try {
    const res = await fetch("/api/listen/teilen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.token) { snackInfo(d.error || "Teilen hat nicht geklappt."); return; }
    b.token = d.token;
    b.geteilt = true;
    const url = `${location.origin}/?beitreten=${d.token}`;
    if (await kopiere(url)) snackInfo("Link kopiert – jetzt verschicken.");
    else await textEingabe({
      titel: "Link teilen",
      text: "Kopiere den Link und verschick ihn:",
      wert: url, okText: "Fertig", icon: "🔗", readonly: true,
    });
    zeichneListen();
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

// Kern des Umbenennens: Server rufen, dann den lokalen Zustand nachziehen.
// Wird sowohl vom Titel (Doppelklick) als auch von den Einstellungen genutzt.
async function benenneListeMit(b, name) {
  name = (name || "").trim();
  if (!name || name === b.name) return;
  try {
    const res = await fetch("/api/listen/umbenennen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, name }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Umbenennen hat nicht geklappt."); return; }
    b.name = name;
    if (b.id === aktiveListe) zeichneTitel();
    zeichneListen();
    aktualisiereMenue();
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

async function benenneListeUm(b) {
  const name = await textEingabe({
    titel: "Liste umbenennen",
    wert: b.name,
    platzhalter: "z. B. Meine ToDos",
    okText: "Speichern",
  });
  if (name === null) return;
  benenneListeMit(b, name);
}

async function loescheListe(b) {
  const ok = await bestaetigen({
    titel: "Liste löschen?",
    text: `Liste „${b.name}“ mit allen Bereichen und ToDos löschen? `
      + `Das gilt auch für Personen, mit denen du geteilt hast.`,
    okText: "Löschen",
  });
  if (!ok) return;
  try {
    const res = await fetch("/api/listen/loeschen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Löschen hat nicht geklappt."); return; }
    loeschePending(b.id);
    entferneListeLokal(b.id);
    snackInfo("Liste gelöscht.");
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

async function verlasseListe(b) {
  const ok = await bestaetigen({
    titel: "Verknüpfung lösen?",
    text: `Verknüpfung zu „${b.name}“ lösen? `
      + `Die Liste selbst bleibt für die anderen bestehen.`,
    okText: "Lösen",
    icon: "🔗",
  });
  if (!ok) return;
  try {
    const res = await fetch("/api/listen/verlassen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Hat nicht geklappt."); return; }
    entferneListeLokal(b.id);
    snackInfo("Verknüpfung gelöst.");
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

// Eine Liste aus dem lokalen Zustand nehmen und, falls sie aktiv war, auf eine
// andere umschalten (oder auf "keine Liste").
function entferneListeLokal(id) {
  listen = listen.filter(b => b.id !== id);
  delete daten[id];
  if (aktiveListe === id) {
    aktiveListe = listen.length ? listen[0].id : null;
    if (aktiveListe) localStorage.setItem("aktiveListe", aktiveListe);
    else localStorage.removeItem("aktiveListe");
    editingId = editingCat = addingCat = null;
  }
  zeigeAktiveListe();
  zeichneListen();
  aktualisiereMenue();
  render();
}

async function neueListeAnlegen() {
  const name = await textEingabe({
    titel: "Neue Liste",
    platzhalter: "z. B. Meine ToDos",
    okText: "Anlegen",
    icon: "＋",
  });
  if (!name) return;
  try {
    const res = await fetch("/api/listen/neu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Anlegen hat nicht geklappt."); return; }
    listen.push(d);
    daten[d.id] = { categories: [], themen: [], todos: [] };
    aktiveListe = d.id;
    localStorage.setItem("aktiveListe", d.id);
    editingId = editingCat = addingCat = null;
    zeigeAktiveListe();
    zeichneListen();
    aktualisiereMenue();
    render();
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

// ---------- Zugriff verwalten (Mitglieder) ----------
let mitgliederListeId = null;

async function oeffneMitglieder(b) {
  mitgliederListeId = b.id;
  document.getElementById("mitgliederTitel").textContent = `„${b.name}“ – Zugriff`;
  document.getElementById("mitgliederListe").innerHTML = "";
  document.getElementById("mitgliederLeer").hidden = true;
  document.getElementById("alleEntfernen").hidden = true;
  zeigeEinAnsicht("mitglieder");
  try {
    const res = await fetch(`/api/listen/mitglieder?id=${encodeURIComponent(b.id)}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Konnte nicht laden."); zeigeEinAnsicht("haupt"); return; }
    zeichneMitglieder(d.mitglieder || []);
  } catch (e) { snackInfo("Server nicht erreichbar."); zeigeEinAnsicht("haupt"); }
}

function zeichneMitglieder(leute) {
  const box = document.getElementById("mitgliederListe");
  box.innerHTML = "";
  document.getElementById("mitgliederLeer").hidden = leute.length > 0;
  document.getElementById("alleEntfernen").hidden = leute.length === 0;
  for (const p of leute) {
    const row = document.createElement("div");
    row.className = "listen-zeile mitglied";
    const kopf = document.createElement("div");
    kopf.className = "lz-kopf";
    const n = document.createElement("span");
    n.className = "lz-name";
    n.textContent = p.name || p.email;
    const m = document.createElement("span");
    m.className = "lz-von";
    m.textContent = p.email;
    kopf.appendChild(n);
    kopf.appendChild(m);
    row.appendChild(kopf);
    const kn = document.createElement("div");
    kn.className = "lz-knoepfe";
    kn.appendChild(machBtn("Entfernen", () => entfernePerson(p), "gefahr"));
    row.appendChild(kn);
    box.appendChild(row);
  }
}

async function entfernePerson(p) {
  try {
    const res = await fetch("/api/listen/mitglieder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mitgliederListeId, userId: p.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Entfernen hat nicht geklappt."); return; }
    const b = listen.find(x => x.id === mitgliederListeId);
    if (b && typeof b.mitglieder === "number") b.mitglieder = Math.max(0, b.mitglieder - 1);
    if (b) oeffneMitglieder(b);   // Liste neu laden
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

async function alleEntfernen() {
  const ok = await bestaetigen({
    titel: "Alle entfernen?",
    text: "Alle Personen entfernen und den Link zurücksetzen? "
      + "Danach kommt niemand mehr mit dem alten Link hinein.",
    okText: "Entfernen",
  });
  if (!ok) return;
  try {
    const res = await fetch("/api/listen/mitglieder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: mitgliederListeId, alle: true }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Hat nicht geklappt."); return; }
    const b = listen.find(x => x.id === mitgliederListeId);
    if (b) { b.mitglieder = 0; b.geteilt = false; b.token = null; }
    zeichneListen();
    zeigeEinAnsicht("haupt");
    snackInfo("Zugriff entzogen, Link zurückgesetzt.");
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

// ---------- Einer geteilten Liste beitreten ----------
// Ausgeloest durch ?beitreten=<token> in der Adresse (der Teilen-Link). Laeuft
// erst NACH loadState, also ist die Anmeldung an dieser Stelle schon erledigt.
async function evtlBeitreten() {
  const token = new URLSearchParams(location.search).get("beitreten");
  if (!token) return;
  // Aus der Adresszeile nehmen, damit ein Neuladen nicht erneut beitritt.
  history.replaceState(null, "", location.pathname);
  try {
    const res = await fetch("/api/listen/beitreten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { snackInfo(d.error || "Der Link hat nicht funktioniert."); return; }
    // Frisch laden, damit die neue Liste samt Daten da ist, dann hinschalten.
    await loadState();
    if (d.id && daten[d.id]) {
      aktiveListe = d.id;
      localStorage.setItem("aktiveListe", d.id);
      zeigeAktiveListe();
    }
    snackInfo(d.schon ? "Diese Liste hattest du schon." : `„${d.name}“ hinzugefügt.`);
  } catch (e) { snackInfo("Server nicht erreichbar."); }
}

// ---------- Konto loeschen ----------
async function kontoLoeschen() {
  const feld = document.getElementById("kontoLoeschenEmail");
  const msg = document.getElementById("kontoMsg");
  const eingabe = feld.value.trim().toLowerCase();
  // Auch der Server prueft das nochmal - hier nur, um den Fehler sofort zu
  // zeigen statt nach einer Serverrunde.
  if (eingabe !== eigeneEmail.toLowerCase()) {
    msg.textContent = "Die Adresse stimmt nicht.";
    feld.focus();
    return;
  }
  const knopf = document.getElementById("kontoLoeschenJa");
  knopf.disabled = true;
  try {
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: eingabe }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      msg.textContent = d.error || "Löschen hat nicht geklappt.";
      knopf.disabled = false;
      return;
    }
    // Konto ist weg - ein eventueller alter Pending-Eintrag darf beim
    // naechsten Anmelden (egal ob dieselbe oder eine andere Adresse) nicht
    // wieder auftauchen.
    const pendingAlle = pendingLesen();
    delete pendingAlle[eigeneEmail];
    pendingSchreiben(pendingAlle);
    location.reload();
  } catch (e) {
    msg.textContent = "Server nicht erreichbar.";
    knopf.disabled = false;
  }
}

// ---------- Kleine Helfer ----------
// Kurzhinweis in der Snackbar ohne Rueckgaengig-Knopf.
function snackInfo(text) {
  clearTimeout(undoTimer);
  snackbar.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = text;
  snackbar.appendChild(s);
  snackbar.classList.add("show");
  undoTimer = setTimeout(hideSnackbar, 3500);
}

// In die Zwischenablage kopieren. Kann scheitern (unsicherer Kontext, keine
// Freigabe) - dann faengt der Aufrufer das mit dem Eingabe-Dialog ab.
async function kopiere(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { return false; }
}

// Eigener Eingabe-Dialog als Ersatz fuer das nackte prompt() des Browsers.
// Gibt ein Promise zurueck: der getrimmte Text bei "OK"/Enter, null bei
// Abbrechen/Escape/Klick daneben. Mit readonly wird nur ein Text zum Kopieren
// angezeigt (dann ohne Abbrechen-Knopf). Baut denselben Kasten wie die anderen
// Dialoge, damit die Optik einheitlich bleibt.
function textEingabe(optionen) {
  const o = optionen || {};
  const okText = o.okText || "OK";
  const icon = o.icon || "✏️";
  const readonly = !!o.readonly;
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "admin-popup eingabe-popup";
    const box = document.createElement("div");
    box.className = "admin-popup-box";
    overlay.appendChild(box);

    const ic = document.createElement("div");
    ic.className = "admin-popup-icon";
    ic.textContent = icon;
    box.appendChild(ic);

    const h = document.createElement("h2");
    h.textContent = o.titel || "";
    box.appendChild(h);

    if (o.text) {
      const p = document.createElement("p");
      p.textContent = o.text;
      box.appendChild(p);
    }

    const feld = document.createElement("input");
    feld.type = "text";
    feld.className = "eingabe-feld";
    feld.value = o.wert || "";
    feld.placeholder = o.platzhalter || "";
    feld.setAttribute("autocomplete", "off");
    if (readonly) feld.readOnly = true;
    box.appendChild(feld);

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn primary";
    ok.textContent = okText;
    box.appendChild(ok);

    let ab = null;
    if (!readonly) {
      ab = document.createElement("button");
      ab.type = "button";
      ab.className = "lock-link";
      ab.textContent = "Abbrechen";
      box.appendChild(ab);
    }

    let fertig = false;
    const schliess = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      document.removeEventListener("keydown", aufTaste, true);
      overlay.remove();
      resolve(ergebnis);
    };
    const nimm = () => schliess(readonly ? "" : feld.value.trim());
    // In der Capture-Phase abfangen und stoppen, damit Escape/Enter nicht auch
    // den Dialog dahinter (Einstellungen) schliesst oder abschickt.
    const aufTaste = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); schliess(null); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); nimm(); }
    };
    document.addEventListener("keydown", aufTaste, true);
    ok.addEventListener("click", nimm);
    if (ab) ab.addEventListener("click", () => schliess(null));
    overlay.addEventListener("click", e => { if (e.target === overlay) schliess(null); });

    document.body.appendChild(overlay);
    feld.focus();
    feld.select();
  });
}

// Eigener Rueckfrage-Dialog als Ersatz fuer das nackte confirm() des Browsers.
// Gibt ein Promise<boolean> zurueck. Selber Kasten wie textEingabe(), nur ohne
// Eingabefeld und mit "gefahr"-Knopf statt "primary".
function bestaetigen(optionen) {
  const o = optionen || {};
  const okText = o.okText || "Löschen";
  const icon = o.icon || "🗑️";
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "admin-popup eingabe-popup";
    const box = document.createElement("div");
    box.className = "admin-popup-box";
    overlay.appendChild(box);

    const ic = document.createElement("div");
    ic.className = "admin-popup-icon";
    ic.textContent = icon;
    box.appendChild(ic);

    const h = document.createElement("h2");
    h.textContent = o.titel || "";
    box.appendChild(h);

    if (o.text) {
      const p = document.createElement("p");
      p.textContent = o.text;
      box.appendChild(p);
    }

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn gefahr";
    ok.textContent = okText;
    box.appendChild(ok);

    const ab = document.createElement("button");
    ab.type = "button";
    ab.className = "lock-link";
    ab.textContent = "Abbrechen";
    box.appendChild(ab);

    let fertig = false;
    const schliess = (ergebnis) => {
      if (fertig) return;
      fertig = true;
      document.removeEventListener("keydown", aufTaste, true);
      overlay.remove();
      resolve(ergebnis);
    };
    const aufTaste = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); schliess(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); schliess(true); }
    };
    document.addEventListener("keydown", aufTaste, true);
    ok.addEventListener("click", () => schliess(true));
    ab.addEventListener("click", () => schliess(false));
    overlay.addEventListener("click", e => { if (e.target === overlay) schliess(false); });

    document.body.appendChild(overlay);
    ok.focus();
  });
}

// Aktive Liste direkt im Titel umbenennen (nur eigene Listen). Der Titel wird
// kurz zum Eingabefeld: Enter oder Klick daneben uebernimmt, Escape verwirft.
function starteTitelUmbenennen() {
  const meta = listen.find(b => b.id === aktiveListe);
  if (!meta || !meta.istEigen) return;
  schliesseMenue();
  const alt = meta.name;
  titel.innerHTML = "";
  titel.classList.remove("titel-schaltbar");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "titel-edit";
  input.value = alt;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-label", "Listenname");
  titel.appendChild(input);
  input.focus();
  input.select();

  let fertig = false;
  const abschluss = (speichern) => {
    if (fertig) return;
    fertig = true;
    const neu = input.value.trim();
    zeichneTitel();   // Titel-Optik (Name + Pfeil) wiederherstellen
    if (speichern && neu && neu !== alt) benenneListeMit(meta, neu);
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); abschluss(true); }
    else if (e.key === "Escape") { e.preventDefault(); abschluss(false); }
  });
  input.addEventListener("blur", () => abschluss(true));
  input.addEventListener("click", e => e.stopPropagation());
}

// ---------- Aktive Liste ----------
// `state` auf die aktive Liste zeigen lassen und den Kopf anpassen: Titel wird
// zum Listennamen, der Umschalter erscheint ab zwei Listen, "＋ Bereich" ist
// nur mit aktiver Liste nutzbar.
function zeigeAktiveListe() {
  state = (aktiveListe && daten[aktiveListe]) || { categories: [], themen: [], todos: [], unterpunkte: [] };
  if (!Array.isArray(state.categories)) state.categories = [];
  if (!Array.isArray(state.themen)) state.themen = [];
  if (!Array.isArray(state.todos)) state.todos = [];
  if (!Array.isArray(state.unterpunkte)) state.unterpunkte = [];
  zeichneTitel();
  addCatBtn.disabled = !aktiveListe;
  addTodoBtn.disabled = !aktiveListe;
}

// Titel = Name der aktiven Liste. Ab zwei Listen kommt ein kleiner Pfeil dazu
// und der Titel wird anklickbar (Klick oeffnet das Umschaltmenue). Bei eigenen
// Listen benennt ein Doppelklick direkt hier um.
function zeichneTitel() {
  const meta = listen.find(b => b.id === aktiveListe);
  const mehrere = listen.length >= 2;
  const eigen = !!(meta && meta.istEigen);
  titel.innerHTML = "";
  const name = document.createElement("span");
  name.className = "titel-name";
  name.textContent = meta ? meta.name : "ToDo-Liste";
  titel.appendChild(name);
  if (mehrere) {
    const pfeil = document.createElement("span");
    pfeil.className = "titel-pfeil";
    pfeil.textContent = "▾";
    titel.appendChild(pfeil);
  }
  titel.classList.toggle("titel-schaltbar", mehrere);
  titel.title = [
    mehrere ? "Klick: Liste wechseln" : "",
    eigen ? "Doppelklick: umbenennen" : "",
  ].filter(Boolean).join(" · ");
}

// Zwischen den Listen umschalten. Laufende Bearbeitungen der alten Liste
// verwerfen, damit sie nicht in der neuen landen.
function wechsleListe(id) {
  if (!daten[id]) return;
  aktiveListe = id;
  localStorage.setItem("aktiveListe", id);
  editingId = editingCat = addingCat = null;
  schliesseMenue();
  zeigeAktiveListe();
  render();
}

// ---------- Lokaler Cache & Offline-Sync ----------
// Zwei getrennte localStorage-Schluessel: CACHE_KEY spiegelt schlicht die
// letzte erfolgreiche Serverantwort (Lesegrundlage fuer den Offline-Start),
// PENDING_KEY haelt Listen mit noch nicht gespeicherten Aenderungen fest -
// verschachtelt pro Konto (eigeneEmail), damit auf einem gemeinsam
// genutzten Geraet ein Kontowechsel keine fremden, ungesicherten
// Aenderungen verwirft oder verliert.
const CACHE_KEY = "todoCache";
const PENDING_KEY = "todoPending";

function ladeCacheLokal() {
  try {
    const roh = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!roh || !Array.isArray(roh.listen) || typeof roh.daten !== "object") return null;
    return roh;
  } catch (e) { return null; }
}

function speichereCacheLokal() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      listen, daten, eigeneEmail, eigenerName, istAdmin, fokusZugang,
    }));
  } catch (e) { /* z. B. voller Speicher - der Cache ist nur ein Fallback */ }
}

// Noch nicht hochgeladene Aenderungen haben Vorrang vor jedem anderen,
// zwangslaeufig aelteren Stand (frischer GET oder lokaler Cache-Spiegel) -
// sonst wuerde genau der Rettungsmechanismus die eigene Bearbeitung wieder
// verschwinden lassen. Setzt eigeneEmail voraus, muss also NACH dessen
// Zuweisung aufgerufen werden.
function mischePendingEin() {
  const pending = pendingFuerKonto();
  for (const boardId of Object.keys(pending)) {
    if (daten[boardId]) {
      const p = pending[boardId];
      daten[boardId] = { categories: p.categories, themen: p.themen || [], todos: p.todos };
    }
  }
}

function pendingLesen() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}

function pendingSchreiben(map) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)); }
  catch (e) { /* z. B. voller Speicher - der Cache ist nur ein Fallback */ }
}

function pendingFuerKonto() {
  return pendingLesen()[eigeneEmail] || {};
}

// Aktuellen Stand von `boardId` als noch nicht gespeichert vormerken -
// immer der komplette Inhalt, nie ein Diff, weil PUT /api/todos ohnehin nur
// den kompletten Inhalt kennt (siehe save()).
function setzePending(boardId, boardName) {
  if (!eigeneEmail) return;
  const map = pendingLesen();
  if (!map[eigeneEmail]) map[eigeneEmail] = {};
  const inhalt = daten[boardId] || { categories: [], themen: [], todos: [] };
  map[eigeneEmail][boardId] = {
    categories: inhalt.categories,
    themen: inhalt.themen || [],
    todos: inhalt.todos,
    name: boardName,
    seit: new Date().toISOString(),
  };
  pendingSchreiben(map);
}

function loeschePending(boardId) {
  if (!eigeneEmail) return;
  const map = pendingLesen();
  if (map[eigeneEmail] && map[eigeneEmail][boardId]) {
    delete map[eigeneEmail][boardId];
    pendingSchreiben(map);
  }
}

function zeigeOffline(sichtbar) {
  if (offlineBanner) offlineBanner.hidden = !sichtbar;
}

// Banner-Sichtbarkeit aus dem tatsaechlichen Zustand ableiten, statt sie an
// einzelnen Stellen einzeln zu setzen - so kann sie nie mit dem echten
// Pending-Stand auseinanderlaufen.
function aktualisiereOfflineAnzeige() {
  const nochOffen = Object.keys(pendingFuerKonto()).length > 0;
  // serverErreichbar statt navigator.onLine: Letzteres kennt nur den
  // Netzwerkadapter, nicht ob unser Server tatsaechlich antwortet (WLAN ohne
  // echtes Internet meldet sich faelschlich "online").
  zeigeOffline(!serverErreichbar || nochOffen);
}

let synchronisiereLaeuft = false;
async function versucheAusstehendeZuSynchronisieren() {
  if (synchronisiereLaeuft || !navigator.onLine) return;
  const pending = pendingFuerKonto();
  const ids = Object.keys(pending);
  if (!ids.length) return;
  synchronisiereLaeuft = true;
  // Sequenziell, nicht parallel: schlaegt eine Liste mit 401 fehl, zeigt
  // save() genau einmal das Login-Overlay - danach ist die Sitzung fuer
  // alle weiteren Listen in dieser Schleife wieder gueltig.
  const synchronisiert = [];
  for (const id of ids) {
    const name = (pending[id] && pending[id].name) || "Liste";
    const ergebnis = await save(id);
    if (ergebnis === "ok") synchronisiert.push(name);
  }
  synchronisiereLaeuft = false;
  if (synchronisiert.length) {
    snackInfo("Offline-Änderungen synchronisiert: " + synchronisiert.join(", "));
  }
}

// ---------- Laden & Speichern ----------
// Kein Server erreichbar (kein Netz, oder eine Fehlerantwort): aus dem
// lokalen Cache wiederherstellen statt das Board leerzuraeumen - inklusive
// eigener, in dieser Offline-Phase gemachter Aenderungen (mischePendingEin).
// Gibt es gar keinen Cache (z. B. allererster Besuch offline), bleibt nur
// die ehrliche Leermeldung in render().
function wiederherstellenAusCache() {
  const cache = ladeCacheLokal();
  if (!cache) { listen = []; daten = {}; aktiveListe = null; return; }
  listen = cache.listen;
  daten = cache.daten;
  eigeneEmail = cache.eigeneEmail || "";
  eigenerName = cache.eigenerName || "";
  istAdmin = !!cache.istAdmin;
  fokusZugang = !!cache.fokusZugang;
  canSave = true;
  document.getElementById("kontoName").textContent = eigenerName || "Konto";
  document.getElementById("kontoAdresse").textContent = eigeneEmail;
  einstellungenBtn.hidden = false;
  mischePendingEin();
  const gemerkt = localStorage.getItem("aktiveListe");
  aktiveListe = (gemerkt && listen.some(b => b.id === gemerkt))
    ? gemerkt
    : (listen.length ? listen[0].id : null);
}

async function loadState() {
  while (true) {
    let res;
    try {
      res = await fetch(API_BASE, { cache: "no-store" });
    } catch (e) {
      serverErreichbar = false;
      wiederherstellenAusCache();
      setStatus("⚠ Server nicht erreichbar", "err");
      zeigeAktiveListe();
      return;
    }
    if (res.status === 401) { await login(); continue; }
    if (res.status === 403) {
      // Angemeldet, aber kein todo_zugang (z. B. ein reines Fokus-Konto, oder
      // gerade selbst aufgegeben) - ein zweiter Anmeldeversuch mit derselben
      // Sitzung wuerde daran nichts aendern, deshalb eigener Kasten statt
      // der Anmeldemaske.
      const daten = await res.json().catch(() => ({}));
      zeigeGesperrt(daten.error);
      return;
    }
    if (!res.ok) {
      serverErreichbar = false;
      wiederherstellenAusCache();
      setStatus("⚠ Server nicht erreichbar", "err");
      zeigeAktiveListe();
      return;
    }
    serverErreichbar = true;

    const antwort = (await res.json()) || {};
    canSave = true;
    istAdmin = antwort.admin === true;
    fokusZugang = antwort.fokusZugang === true;
    eigeneEmail = antwort.email || "";
    eigenerName = antwort.name || "";
    // Name als Ueberschrift im Konto-Abschnitt, Adresse darunter.
    document.getElementById("kontoName").textContent = eigenerName || "Konto";
    document.getElementById("kontoAdresse").textContent = eigeneEmail;
    // Erst jetzt anzeigen: vorher stuenden die Knoepfe auch auf dem
    // Sperrbildschirm.
    einstellungenBtn.hidden = false;
    zeigeHinweise();

    listen = Array.isArray(antwort.listen) ? antwort.listen : [];
    daten = antwort.daten && typeof antwort.daten === "object" ? antwort.daten : {};
    // Jede Liste bekommt eine saubere Huelle - auch eine ohne Bereiche.
    for (const b of listen) {
      const d = daten[b.id] || (daten[b.id] = { categories: [], themen: [], todos: [], unterpunkte: [] });
      if (!Array.isArray(d.categories)) d.categories = [];
      if (!Array.isArray(d.themen)) d.themen = [];
      if (!Array.isArray(d.todos)) d.todos = [];
      if (!Array.isArray(d.unterpunkte)) d.unterpunkte = [];
    }

    // Noch nicht hochgeladene Aenderungen aus einer vorigen Offline-Phase
    // haben Vorrang vor diesem frischen, aber aelteren Serverstand - sonst
    // wuerde der gerade gelungene GET sie stillschweigend ueberschreiben.
    // Das eigentliche Nachreichen uebernimmt
    // versucheAusstehendeZuSynchronisieren() nicht-blockierend nach dem
    // ersten render() (siehe init()).
    mischePendingEin();
    speichereCacheLokal();

    // Aktive Liste: die gemerkte, sonst die erste, sonst keine.
    const gemerkt = localStorage.getItem("aktiveListe");
    aktiveListe = (gemerkt && listen.some(b => b.id === gemerkt))
      ? gemerkt
      : (listen.length ? listen[0].id : null);
    zeigeAktiveListe();
    return;
  }
}

let saving = false, pendingSave = false;
// boardId: Standard ist die aktive Liste, aber dieselbe Funktion reicht nach
// einem Reconnect auch andere, offline geaenderte Listen nach (siehe
// versucheAusstehendeZuSynchronisieren) - eine einzige Stelle, die den
// Pending-Zustand pflegt, statt einer zweiten, parallelen Implementierung.
// Rueckgabe "ok" | "verboten" | "fehler" | undefined (uebersprungen).
async function save(boardId = aktiveListe) {
  if (!canSave || !boardId) return;
  if (saving) { pendingSave = true; return; }
  saving = true;
  setStatus("Speichere …", "");
  const boardMeta = listen.find(b => b.id === boardId);
  const boardName = boardMeta ? boardMeta.name : "Liste";
  const ziel = daten[boardId] || { categories: [], themen: [], todos: [], unterpunkte: [] };
  const body = JSON.stringify({
    boardId,
    categories: ziel.categories,
    themen: ziel.themen || [],
    todos: ziel.todos,
    unterpunkte: ziel.unterpunkte || [],
  });
  let ergebnis = "fehler";
  try {
    let res = await fetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    // Sitzung inzwischen abgelaufen (z. B. ein sehr lange offener Tab) -
    // einmal neu anmelden und den Speicherversuch wiederholen.
    if (res.status === 401) {
      await login();
      res = await fetch(API_BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }
    if (res.status === 403) {
      // Kein Zugriff mehr - Liste wurde geloescht oder die Freigabe entzogen.
      // Der Server ist erreichbar, nur der Zugriff fehlt: erneutes
      // Versuchen wuerde nie klappen, also aufraeumen statt pending zu
      // lassen.
      serverErreichbar = true;
      loeschePending(boardId);
      setStatus("⚠ Nicht gespeichert", "err");
      snackInfo(boardName + ": kein Zugriff mehr, nicht gespeichert.");
      ergebnis = "verboten";
    } else if (!res.ok) {
      throw new Error("HTTP " + res.status);
    } else {
      serverErreichbar = true;
      setStatus("Gespeichert ✓", "ok");
      loeschePending(boardId);
      speichereCacheLokal();
      ergebnis = "ok";
    }
  } catch (e) {
    // Netzwerkfehler oder Server-Fehler: nicht verloren, sondern lokal
    // vormerken - wird beim naechsten Reconnect automatisch nachgereicht.
    serverErreichbar = false;
    setStatus("⚠ Nicht gespeichert", "err");
    setzePending(boardId, boardName);
    speichereCacheLokal();
  } finally {
    saving = false;
    aktualisiereOfflineAnzeige();
    if (pendingSave) { pendingSave = false; save(); }
  }
  return ergebnis;
}

let statusTimer = null;
function setStatus(text, cls) {
  saveStatusEl.textContent = text;
  saveStatusEl.className = "save-status" + (cls ? " " + cls : "");
  clearTimeout(statusTimer);
  if (cls === "ok") {
    statusTimer = setTimeout(() => { saveStatusEl.textContent = ""; }, 1800);
  }
}

// ---------- Aktionen: ToDos ----------
function findTodo(id) { return state.todos.find(t => t.id === id); }

// Alle Unterpunkte eines ToDos, in gespeicherter Reihenfolge (das GET liefert
// sie schon sortiert, die Reihenfolge bleibt beim Filtern erhalten).
function unterpunkteVon(todoId) {
  return state.unterpunkte.filter(u => u.todoId === todoId);
}

function addUnterpunkt(todoId, text) {
  text = (text || "").trim();
  if (!text) return;
  state.unterpunkte.push({ id: uid(), todoId, text, done: false });
  // Ein frisch hinzugefuegter Punkt ist immer offen - war das ToDo bereits
  // erledigt (z. B. nachtraeglich noch einen Punkt ergaenzt), darf es das
  // nicht bleiben, sonst waere die Checkliste auf der Karte unsichtbar (die
  // blendet sich ja gerade bei erledigten ToDos aus). toggleDone() rendert
  // und speichert schon selbst, deshalb hier nicht doppelt.
  const t = findTodo(todoId);
  if (t && t.done) toggleDone(t.id);
  else { render(); save(); }
  const feld = document.querySelector(`[data-neuer-unterpunkt="${todoId}"]`);
  if (feld) feld.focus();
}

function deleteUnterpunkt(id) {
  state.unterpunkte = state.unterpunkte.filter(x => x.id !== id);
  render();
  save();
}

// Abhaken eines Unterpunkts kann das ToDo automatisch mitziehen: letzter
// offener Punkt abgehakt -> ToDo erledigt; Punkt an einem erledigten ToDo
// wieder geoeffnet -> ToDo wieder offen. Beide Faelle laufen ueber
// toggleDone() (nicht direkt t.done setzen), damit z. B. eine Wiederholung
// beim Automatik-Abhaken genauso ausgeloest wird wie beim manuellen.
function toggleUnterpunkt(id) {
  const u = state.unterpunkte.find(x => x.id === id);
  if (!u) return;
  u.done = !u.done;
  const t = findTodo(u.todoId);
  if (t) {
    const geschwister = unterpunkteVon(u.todoId);
    const alleFertig = geschwister.length > 0 && geschwister.every(x => x.done);
    if (u.done && alleFertig && !t.done) { toggleDone(t.id); return; }
    if (!u.done && t.done) { toggleDone(t.id); return; }
  }
  render();
  save();
}

// Naechste freie Sortiernummer fuer termin-lose, offene ToDos einer Gruppe.
// Gruppe = Bereich + Ueber-Thema (null = frei), denn jede Gruppe wird fuer
// sich sortiert; so landet ein neues ToDo hinten in genau seiner Gruppe.
function nextOrder(catId, themaId) {
  const tid = themaId || null;
  const orders = state.todos
    .filter(t => t.categoryId === catId && (t.themaId || null) === tid
                 && !t.done && !t.due && typeof t.order === "number")
    .map(t => t.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function addTodoTo(categoryId, themaId, text, due, note) {
  text = (text || "").trim();
  if (!text) return false;
  const todo = {
    id: uid(),
    categoryId: categoryId,
    themaId: themaId || null,
    text: text,
    due: due || null,
    note: (note && note.trim()) ? note.trim() : null,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  if (!todo.due) todo.order = nextOrder(categoryId, todo.themaId);
  state.todos.push(todo);
  addingCat = null;   // Eingabe nach dem Hinzufuegen wieder einklappen
  addingThema = null;
  render();
  save();
  return true;
}

// Der globale "＋ ToDo"-Knopf im Kopf: legt - falls noetig - den Sonder-Bereich
// "Ohne Bereich" an und klappt dort das gewohnte Eingabefeld auf. So braucht die
// schnelle Erfassung keinen eigenen Dialog; Termin und Notiz gehen wie ueberall.
// Ohne eingegebenes ToDo verschwindet die Spalte beim naechsten render() wieder
// (synchronisiereOhneBereich haelt sie nur, solange das Feld offen ist).
function addTodoOhneBereich() {
  if (!aktiveListe) return;
  const id = ohneBereichId(aktiveListe);
  if (!state.categories.some(c => c.id === id)) state.categories.unshift({ id, name: OHNE_NAME });
  openAdd(id, null);
}

function toggleDone(id) {
  const t = findTodo(id);
  if (!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? new Date().toISOString() : null;
  // Wieder geoeffnete termin-lose ToDos ans Ende ihrer offenen Gruppe setzen.
  if (!t.done && !t.due && typeof t.order !== "number") t.order = nextOrder(t.categoryId, t.themaId);
  // Haupt-Haekchen manuell gesetzt (oder durch den letzten Unterpunkt ausgeloest,
  // siehe toggleUnterpunkt): alle Unterpunkte ziehen nach. Beim OEFFNEN dagegen
  // KEINE Kaskade - man will das ToDo zurueckholen, nicht den Haken-Fortschritt
  // verlieren (siehe Kommentar in toggleUnterpunkt).
  if (t.done) {
    state.unterpunkte.forEach(u => { if (u.todoId === t.id) u.done = true; });
  }
  // Wiederkehrendes ToDo abgehakt: sofort die naechste Ausgabe anlegen. Baut
  // das neue ToDo direkt (nicht ueber addTodoTo()) - die Funktion raeumt
  // nebenbei ein offenes Schnell-Anlege-Feld weg, was hier ein voellig
  // unbeteiligtes, gerade offenes Eingabefeld anderswo auf dem Board
  // schliessen wuerde.
  if (t.done && t.wiederholung && t.due) {
    const neuesTodo = {
      id: uid(),
      categoryId: t.categoryId,
      themaId: t.themaId,
      text: t.text,
      due: folgeTermin(t.due, t.wiederholung),
      note: t.note,
      wiederholung: t.wiederholung,
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    state.todos.push(neuesTodo);
    // Checkliste mitnehmen, aber frisch unangehakt - sonst muesste man sie bei
    // jeder Wiederholung neu eintippen (z. B. eine wiederkehrende Einkaufsliste).
    unterpunkteVon(t.id).forEach(u => {
      state.unterpunkte.push({ id: uid(), todoId: neuesTodo.id, text: u.text, done: false });
    });
  }
  render();
  save();
}

function deleteTodo(id) {
  const idx = state.todos.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.todos[idx];
  const removedUnterpunkte = unterpunkteVon(id);
  state.todos.splice(idx, 1);
  state.unterpunkte = state.unterpunkte.filter(u => u.todoId !== id);
  if (editingId === id) editingId = null;
  render();
  save();
  showUndo(`„${removed.text}“ gelöscht`, () => {
    state.todos.splice(Math.min(idx, state.todos.length), 0, removed);
    state.unterpunkte.push(...removedUnterpunkte);
    render();
    save();
  });
}

// ---------- Rückgängig-Hinweis (Snackbar) ----------
let undoTimer = null;
function showUndo(message, undoFn) {
  clearTimeout(undoTimer);
  snackbar.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.className = "snack-undo";
  btn.textContent = "Rückgängig";
  btn.addEventListener("click", () => { clearTimeout(undoTimer); hideSnackbar(); undoFn(); });
  snackbar.appendChild(span);
  snackbar.appendChild(btn);
  snackbar.classList.add("show");
  undoTimer = setTimeout(hideSnackbar, 5000);
}
function hideSnackbar() { snackbar.classList.remove("show"); }

function startEdit(id) {
  editingId = id;
  unterpunktEingabeOffen = null;
  render();
  const input = document.querySelector(`[data-edit-text="${id}"]`);
  if (input) { input.focus(); input.select(); }
}

function saveEdit(id) {
  const t = findTodo(id);
  if (!t) return;
  const textInput = document.querySelector(`[data-edit-text="${id}"]`);
  const dateInput = document.querySelector(`[data-edit-date="${id}"]`);
  const noteInput = document.querySelector("[data-edit-note]");
  const text = textInput.value.trim();
  if (!text) { textInput.focus(); return; }
  t.text = text;
  t.due = dateInput.value || null;
  t.note = noteInput && noteInput.value.trim() ? noteInput.value.trim() : null;
  const wiederholungSelect = document.querySelector(`[data-edit-wiederholung="${id}"]`);
  t.wiederholung = (t.due && wiederholungSelect && wiederholungSelect.value) ? wiederholungSelect.value : null;
  // Bereich-Auswahl (nur bei ToDos, die gerade "Ohne Bereich" liegen). Ein
  // Wechsel in einen echten Bereich stellt das ToDo dort frei ein (ohne Thema)
  // und reiht das termin-lose ToDo hinten in den Zielbereich ein.
  const bereichSelect = document.querySelector(`[data-edit-bereich="${id}"]`);
  if (bereichSelect && bereichSelect.value && bereichSelect.value !== t.categoryId) {
    t.categoryId = bereichSelect.value;
    t.themaId = null;
    if (!t.due && !t.done) t.order = nextOrder(t.categoryId, null);
  }
  // Ueber-Thema aus dem Dropdown (nur da, wenn der Bereich Themen hat). Beim
  // Wechsel das termin-lose ToDo hinten in die neue Gruppe einsortieren.
  const themaSelect = document.querySelector(`[data-edit-thema="${id}"]`);
  if (themaSelect) {
    const neu = themaSelect.value || null;
    if ((t.themaId || null) !== neu) {
      t.themaId = neu;
      if (!t.due && !t.done) t.order = nextOrder(t.categoryId, neu);
    }
  }
  editingId = null;
  unterpunktEingabeOffen = null;
  render();
  save();
}

function cancelEdit() {
  editingId = null;
  unterpunktEingabeOffen = null;
  render();
}

// ---------- Aktionen: Bereiche ----------
async function addCategory() {
  if (!aktiveListe) return;   // ohne Liste gibt es nichts, wozu ein Bereich passt
  const name = await textEingabe({
    titel: "Neuer Bereich",
    platzhalter: "z. B. Haushalt oder Arbeit",
    okText: "Anlegen",
    icon: "＋",
  });
  if (!name) return;
  state.categories.push({ id: uid(), name: name });
  render();
  save();
}

// Bereichsname per Doppelklick direkt in der Ueberschrift bearbeiten.
function startRenameCategory(catId) {
  editingCat = catId;
  render();
  const input = document.querySelector(`[data-edit-cat="${catId}"]`);
  if (input) { input.focus(); input.select(); }
}

function saveCategoryName(catId) {
  const cat = state.categories.find(c => c.id === catId);
  const input = document.querySelector(`[data-edit-cat="${catId}"]`);
  if (!cat || !input) return;
  const name = input.value.trim();
  editingCat = null;
  if (!name || name === cat.name) { render(); return; }
  cat.name = name;
  render();
  save();
}

function cancelRenameCategory() {
  editingCat = null;
  render();
}

async function deleteCategory(catId) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return;
  const count = state.todos.filter(t => t.categoryId === cat.id).length;
  const msg = count
    ? `Bereich „${cat.name}“ und ${count} darin enthaltene ToDo(s) wirklich löschen?`
    : `Bereich „${cat.name}“ wirklich löschen?`;
  const ok = await bestaetigen({ titel: "Bereich löschen?", text: msg, okText: "Löschen" });
  if (!ok) return;
  state.todos = state.todos.filter(t => t.categoryId !== cat.id);
  state.themen = state.themen.filter(th => th.categoryId !== cat.id);
  state.categories = state.categories.filter(c => c.id !== cat.id);
  render();
  save();
}

// ---------- Aktionen: Ueber-Themen ----------
// Ein Ueber-Thema ist eine benannte Gruppe innerhalb eines Bereichs. Anlegen,
// umbenennen und loeschen laufen bewusst wie bei den Bereichen, nur eine Ebene
// tiefer - so muss man sich keine zweite Bedienlogik merken.
function themenIn(catId) {
  return state.themen.filter(th => th.categoryId === catId);
}

async function addThema(catId) {
  const name = await textEingabe({
    titel: "Neues Über-Thema",
    text: "Eine Gruppe innerhalb dieses Bereichs.",
    platzhalter: "z. B. Urlaub",
    okText: "Anlegen",
    icon: "＋",
  });
  if (!name) return;
  state.themen.push({ id: uid(), categoryId: catId, name: name });
  render();
  save();
}

// Themen-Name per Doppelklick direkt in der Ueberschrift bearbeiten.
function startRenameThema(themaId) {
  editingThema = themaId;
  render();
  const input = document.querySelector(`[data-edit-thema-name="${themaId}"]`);
  if (input) { input.focus(); input.select(); }
}

function saveThemaName(themaId) {
  const th = state.themen.find(x => x.id === themaId);
  const input = document.querySelector(`[data-edit-thema-name="${themaId}"]`);
  if (!th || !input) return;
  const name = input.value.trim();
  editingThema = null;
  if (!name || name === th.name) { render(); return; }
  th.name = name;
  render();
  save();
}

function cancelRenameThema() {
  editingThema = null;
  render();
}

// Thema loeschen loest nur die Gruppierung: die ToDos bleiben und rutschen frei
// in den Bereich (thema_id -> null). Bewusst weniger drastisch als beim Bereich,
// wo die ToDos mitgehen - ein Thema ist ja nur eine Klammer um sie herum.
async function deleteThema(themaId) {
  const th = state.themen.find(x => x.id === themaId);
  if (!th) return;
  const drin = state.todos.filter(t => t.themaId === themaId);
  if (drin.length) {
    const anzahl = drin.length;
    const ok = await bestaetigen({
      titel: "Thema auflösen?",
      text: `Thema „${th.name}“ auflösen? Die ${anzahl} ToDo(s) darin `
        + `rücken zurück in den Bereich, gelöscht wird nichts.`,
      okText: "Auflösen",
      icon: "🧩",
    });
    if (!ok) return;
    for (const t of drin) {
      t.themaId = null;
      // Termin-lose neu einreihen, damit sie nicht auf einer fremden Order sitzen.
      if (!t.done && !t.due) t.order = nextOrder(t.categoryId, null);
    }
  }
  state.themen = state.themen.filter(x => x.id !== themaId);
  if (editingThema === themaId) editingThema = null;
  if (addingThema === themaId) { addingThema = null; addingCat = null; }
  render();
  save();
}

function toggleDoneCollapse(catId) {
  doneCollapsed[catId] = !doneCollapsed[catId];
  localStorage.setItem("doneCollapsed", JSON.stringify(doneCollapsed));
  render();
}

function openAdd(catId, themaId) { addingCat = catId; addingThema = themaId || null; render(); }
function closeAdd() { addingCat = null; addingThema = null; render(); }

// Aktuell offene Eingabe uebernehmen (Enter ODER Klick aus dem Feld heraus).
function commitAddFromDOM() {
  if (!addingCat) return;
  const widget = document.querySelector(".col-add.open");
  if (!widget) return;
  const text = widget.querySelector(".add-text").value;
  const due = widget.querySelector(".add-date").value;
  const note = widget.querySelector(".add-note").value;
  if (text.trim()) addTodoTo(addingCat, addingThema, text, due, note);
  else closeAdd();
}

// Laufende Bearbeitung uebernehmen (Klick aus der Bearbeiten-Zeile heraus).
function commitEditFromDOM() {
  if (!editingId) return;
  const textInput = document.querySelector(`[data-edit-text="${editingId}"]`);
  if (!textInput) return;
  if (textInput.value.trim()) saveEdit(editingId);
  else cancelEdit();
}

// ---------- Drag & Drop: Umsortieren ----------
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.todo.undated:not(.dragging)')];
  let closest = { offset: -Infinity, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

// Reihenfolge der termin-losen ToDos aus der aktuellen DOM-Anordnung uebernehmen.
function persistOrderFromDOM(openList) {
  const ids = [...openList.querySelectorAll(".todo.undated")].map(li => li.dataset.id);
  ids.forEach((id, i) => { const t = findTodo(id); if (t) t.order = i; });
}

// Spalte links/rechts der Maus finden (zum Einsortieren beim Spalten-Drag).
// Die Spalten brechen bei genug Bereichen per flex-wrap in mehrere Zeilen um -
// deshalb zuerst die Zeile unter der Maus bestimmen (alle Spalten einer
// flex-Zeile teilen sich denselben oberen Rand, auch bei unterschiedlicher
// Hoehe durch unterschiedlich viele ToDos) und erst danach links/rechts
// einordnen. Reiner X-Abgleich liess eine in Zeile 2 gezogene Spalte
// faelschlich in Zeile 1 springen.
function getColumnAfter(container, x, y) {
  const cols = [...container.querySelectorAll(".column:not(.col-dragging)")];
  if (!cols.length) return null;

  const zeilen = [];
  for (const col of cols) {
    const box = col.getBoundingClientRect();
    let zeile = zeilen.find(z => Math.abs(z.top - box.top) < 1);
    if (!zeile) { zeile = { top: box.top, bottom: box.bottom, cols: [] }; zeilen.push(zeile); }
    zeile.bottom = Math.max(zeile.bottom, box.bottom);
    zeile.cols.push({ col, box });
  }
  zeilen.sort((a, b) => a.top - b.top);

  let zielIndex = zeilen.findIndex(z => y >= z.top && y <= z.bottom);
  if (zielIndex === -1) {
    let bestDist = Infinity;
    zeilen.forEach((z, i) => {
      const dist = y < z.top ? z.top - y : y - z.bottom;
      if (dist < bestDist) { bestDist = dist; zielIndex = i; }
    });
  }

  let closest = { offset: -Infinity, el: null };
  for (const { col, box } of zeilen[zielIndex].cols) {
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: col };
  }
  if (closest.el) return closest.el;

  // Maus steht rechts von allen Spalten dieser Zeile: ans Zeilenende, also vor
  // die erste Spalte der naechsten Zeile (oder ganz ans Ende, wenn letzte Zeile).
  const naechsteZeile = zeilen[zielIndex + 1];
  return naechsteZeile ? naechsteZeile.cols[0].col : null;
}

// Bereichs-Reihenfolge aus der aktuellen DOM-Anordnung uebernehmen.
function persistColumnOrderFromDOM() {
  const ids = [...board.querySelectorAll(".column")].map(c => c.dataset.cat);
  state.categories.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  // "Ohne Bereich" bleibt immer ganz vorne, egal wohin eine Spalte gezogen
  // wurde (stabiler Sort, die uebrigen Bereiche behalten ihre Reihenfolge).
  state.categories.sort((a, b) => (istOhneBereich(a.id) ? 0 : 1) - (istOhneBereich(b.id) ? 0 : 1));
}

// ---------- Sortierung ----------
function sortOpen(a, b) {
  // 1) ToDos mit Termin zuerst (nach Datum), 2) termin-lose nach manueller Reihenfolge.
  const ag = a.due ? 0 : 1, bg = b.due ? 0 : 1;
  if (ag !== bg) return ag - bg;
  if (ag === 0) {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
  }
  const ao = typeof a.order === "number" ? a.order : Infinity;
  const bo = typeof b.order === "number" ? b.order : Infinity;
  if (ao !== bo) return ao - bo;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}
function sortDone(a, b) {
  return (a.completedAt || "") < (b.completedAt || "") ? 1 : -1;
}

// Ob auf dem Konto (ueber alle eigenen UND geteilten Listen) irgendwo schon
// mal ein ToDo angelegt wurde. Der Erste-ToDo-Hinweis (grosser Knopf,
// Kalender-Tipp) soll nur einmal im Leben des Kontos auftauchen, nicht bei
// jedem neuen oder leergeraeumten Bereich - deshalb hier ueber "daten" (alle
// geladenen Listen), nicht nur ueber den aktiven Bereich.
function kontoHatJeToDoGehabt() {
  return Object.values(daten).some(d => d.todos && d.todos.length);
}

// ---------- Hinweise (einmalige Tipps unter dem Kopf) ----------
// "pointer: coarse" statt User-Agent-Sniffing: zuverlaessiger fuer "ist das
// primaere Eingabegeraet ein Finger" als eine Breitenpruefung allein.
function istMobil() {
  return matchMedia("(pointer: coarse)").matches;
}
// Schon als App gestartet (Home-Bildschirm-Icon)? Dann erledigt sich der Tipp
// von selbst. navigator.standalone ist Safaris eigene, nicht standardisierte
// Variante davon.
function istStandalone() {
  return matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function baueHinweis(schluessel, text) {
  const p = document.createElement("p");
  p.className = "hinweis";
  const span = document.createElement("span");
  span.textContent = text;
  const zu = document.createElement("button");
  zu.type = "button";
  zu.title = "Hinweis ausblenden";
  zu.textContent = "✕";
  zu.addEventListener("click", () => {
    localStorage.setItem(schluessel, "1");
    p.remove();
  });
  p.appendChild(span);
  p.appendChild(zu);
  return p;
}

// Einmal nach dem Anmelden aufgerufen. Jeder Tipp hat sein eigenes
// "gesehen"-Flag in localStorage - unabhaengig voneinander ausblendbar.
function zeigeHinweise() {
  const leiste = document.getElementById("hinweisleiste");
  if (istMobil() && !istStandalone() && !localStorage.getItem("hinweisHomeGesehen")) {
    leiste.appendChild(baueHinweis("hinweisHomeGesehen",
      "📱 Zum Home-Bildschirm hinzufügen (Teilen- bzw. Menü-Symbol des Browsers) — startet dann wie eine eigene App."));
  }
  if (!localStorage.getItem("hinweisEinstellungenGesehen")) {
    leiste.appendChild(baueHinweis("hinweisEinstellungenGesehen",
      "⚙️ Unter Einstellungen kannst du Listen umbenennen, teilen oder eine neue anlegen."));
  }
}

// ---------- Rendern ----------
// Haelt den Sonder-Bereich "Ohne Bereich" im Gleichlauf mit seinen ToDos: legt
// ihn an, sobald ein bereichsloses ToDo existiert (oder das Eingabefeld dort
// gerade offen ist), und raeumt ihn weg, sobald das letzte weg ist. Zentral aus
// render() aufgerufen - deckt Anlegen, Loeschen, Wegziehen, Zuordnen und
// Rueckgaengig in einem Zug ab, statt an jeder einzelnen Stelle.
function synchronisiereOhneBereich() {
  if (!aktiveListe) return;
  const id = ohneBereichId(aktiveListe);
  // editingId wie in renderColumn: ein aus dem Kalender angesprungenes, noch
  // nicht faelliges ToDo braucht seine Spalte, sonst zeigt der Sprung ins Leere.
  const hatTodos = state.todos.some(t => t.categoryId === id
    && (!nochNichtFaellig(t) || editingId === t.id));
  const wirdBefuellt = addingCat === id;   // offenes Eingabefeld haelt die Spalte
  const idx = state.categories.findIndex(c => c.id === id);
  if ((hatTodos || wirdBefuellt) && idx < 0) state.categories.unshift({ id, name: OHNE_NAME });
  else if (!hatTodos && !wirdBefuellt && idx >= 0) state.categories.splice(idx, 1);
}

function render() {
  aktualisiereBadge();
  // Offenes Kalender-Panel mitziehen (siehe kalender.js). Zugeklappt und
  // solange die Datei noch nicht geladen ist, kostet der Aufruf nichts.
  if (window.kalenderNeuZeichnen) window.kalenderNeuZeichnen();
  synchronisiereOhneBereich();
  if (addingCat && !state.categories.some(c => c.id === addingCat)) { addingCat = null; addingThema = null; }
  if (addingThema && !state.themen.some(th => th.id === addingThema)) addingThema = null;
  if (editingCat && !state.categories.some(c => c.id === editingCat)) editingCat = null;
  if (editingThema && !state.themen.some(th => th.id === editingThema)) editingThema = null;
  board.innerHTML = "";

  // Noch gar keine Liste: erst eine anlegen, dann gibt es Bereiche.
  if (!aktiveListe) {
    const wrap = document.createElement("div");
    wrap.className = "empty leer-liste";
    const p = document.createElement("p");
    if (!canSave) {
      // Weder Server noch lokaler Cache verfuegbar - vermutlich der
      // allererste Besuch ohne Internet. Der "Anlegen"-Knopf braucht
      // zwingend eine Verbindung und waere hier nur eine Enttaeuschung.
      p.textContent = "Keine Internetverbindung, und auf diesem Gerät liegt noch nichts Gespeichertes. Bitte einmal mit Internet öffnen.";
      wrap.appendChild(p);
    } else {
      p.textContent = "Du hast noch keine Liste.";
      const btn = document.createElement("button");
      btn.className = "btn primary";
      btn.textContent = "＋ Erste Liste anlegen";
      btn.addEventListener("click", neueListeAnlegen);
      wrap.appendChild(p);
      wrap.appendChild(btn);
    }
    board.appendChild(wrap);
    return;
  }

  if (!state.categories.length) {
    const wrap = document.createElement("div");
    wrap.className = "empty leer-liste";
    const p = document.createElement("p");
    p.textContent = "Noch keine ToDos.";
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "＋ ToDo anlegen";
    btn.addEventListener("click", addTodoOhneBereich);
    wrap.appendChild(p);
    wrap.appendChild(btn);
    board.appendChild(wrap);
    return;
  }

  // "Ohne Bereich" immer ganz links, egal wie die echten Bereiche sortiert sind.
  // Array.sort ist stabil, die Reihenfolge der uebrigen Bereiche bleibt also.
  const spalten = state.categories.slice()
    .sort((a, b) => (istOhneBereich(a.id) ? 0 : 1) - (istOhneBereich(b.id) ? 0 : 1));
  spalten.forEach(cat => board.appendChild(renderColumn(cat)));

  // Eingabefeld der gerade offenen Stelle fokussieren (frei oder in einem Thema).
  if (addingCat) {
    const input = document.querySelector(".col-add.open .add-text");
    if (input) input.focus();
  }
}

function renderColumn(cat) {
  const istOhne = istOhneBereich(cat.id);
  // Ausnahme editingId: ein noch nicht faelliges, wiederkehrendes ToDo ist
  // hier sonst unsichtbar - aus dem Kalender kann man es aber anspringen,
  // und dann muss die Karte auch da sein (siehe kalender.js).
  const inCat = state.todos.filter(t => t.categoryId === cat.id
    && (!nochNichtFaellig(t) || editingId === t.id));
  const open = inCat.filter(t => !t.done);           // pro Gruppe sortiert, nicht global
  const done = inCat.filter(t => t.done).sort(sortDone);
  const themen = istOhne ? [] : themenIn(cat.id);    // "Ohne Bereich" kennt keine Themen

  const col = document.createElement("section");
  col.className = "column" + (istOhne ? " ohne-bereich" : "");
  col.dataset.cat = cat.id;
  if (!istOhne && cat.farbe) col.dataset.farbe = cat.farbe;

  // --- Kopf --- ("Ohne Bereich" bekommt keinen: kein Kasten, keine
  // Ueberschrift, die ToDos stehen frei auf dem Board. Der Drag-Hinweis
  // wandert stattdessen als Tooltip auf die Spalte selbst.)
  if (istOhne) {
    col.title = "ToDos ohne Bereich — zieh eins in einen Bereich oder ordne es beim Bearbeiten zu";
  } else {
    const head = document.createElement("div");
    head.className = "col-head";
    col.appendChild(head);

    if (editingCat === cat.id) {
      // Loeschen gibt es nur hier: wer den Bereich anfasst, hat ihn per
      // Doppelklick bewusst geoeffnet. Die Farbauswahl sitzt seit der
      // Klick-Werkzeugzeile (siehe baueAddKnopfzeile) nicht mehr hier.
      head.className = "col-head editing";
      head.innerHTML = `
        <input type="text" class="cat-edit" data-edit-cat="${cat.id}"
               value="${escapeHtml(cat.name)}" autocomplete="off">
        <div class="col-actions">
          <button type="button" class="act del" title="Bereich löschen" data-act="del">🗑️</button>
        </div>`;
      const input = head.querySelector(".cat-edit");
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") saveCategoryName(cat.id);
        else if (e.key === "Escape") cancelRenameCategory();
      });
      head.querySelector('[data-act="del"]').addEventListener("click", () => deleteCategory(cat.id));
    } else {
      // Ampel am Zaehler: 0 = grau, offene ToDos = blau, etwas Dringendes = rot.
      // Zaehlt alle offenen des Bereichs, auch die in Ueber-Themen.
      const countCls = ampelKlasse(open);
      head.innerHTML = `
        <h2 class="col-title">
          <span class="name">${escapeHtml(cat.name)}</span>
          <span class="col-count ${countCls}">${open.length}</span>
        </h2>`;

      // Spalte am Titel anfassen und umsortieren; Klick zeigt Farbe/Thema-
      // Werkzeuge, Doppelklick benennt um - Timer trennt die drei wie schon
      // beim Thema-Kopf (toggle in renderThemaGruppe).
      const title = head.querySelector(".col-title");
      title.draggable = true;
      title.title = "Klick: Farbe & Thema · Doppelklick: umbenennen · ziehen: verschieben";
      let titelKlickTimer = null;
      title.addEventListener("click", () => {
        clearTimeout(titelKlickTimer);
        titelKlickTimer = setTimeout(() => toggleThemaWerkzeuge(cat.id), 220);
      });
      title.addEventListener("dblclick", () => {
        clearTimeout(titelKlickTimer);
        startRenameCategory(cat.id);
      });
      title.addEventListener("dragstart", e => {
        draggedCat = cat.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "cat:" + cat.id);
        col.classList.add("col-dragging");
      });
      title.addEventListener("dragend", () => {
        draggedCat = null;
        col.classList.remove("col-dragging");
        render();
      });

      // ＋ ToDo steht immer da; Farbe und ＋ Thema nur nach Klick auf den
      // Titel (siehe toggleThemaWerkzeuge) - beides braucht man seltener.
      if (!(addingCat === cat.id && addingThema === null)) {
        head.appendChild(baueAddKnopfzeile(cat));
      }
    }
  }

  // --- Das aufgeklappte Eingabefeld fuer ein freies ToDo ---
  // "Ohne Bereich" bekommt keine eigene Werkzeugzeile - der globale "＋ ToDo"
  // im Header legt genau dort an, eine zweite waere redundant.
  if (addingCat === cat.id && addingThema === null) col.appendChild(baueAddWidget(cat, null));

  // --- Freie ToDos (ohne Ueber-Thema), direkt in der Spalte ---
  const frei = open.filter(t => !t.themaId).sort(sortOpen);
  const freieUl = document.createElement("ul");
  freieUl.className = "todo-list frei";
  freieUl.dataset.thema = "";
  frei.forEach(t => freieUl.appendChild(renderTodo(t)));
  col.appendChild(freieUl);

  // Leer-Hinweis nur, wenn im Bereich wirklich gar nichts Offenes und kein
  // Thema steht - sonst tragen die Themen die Struktur. Der grosse Knopf
  // erscheint nur vorm allerersten ToDo auf dem ganzen Konto - danach reicht
  // das kleine "＋ ToDo" oben, sonst naggt der Knopf bei jedem neuen oder
  // leergeraeumten Bereich erneut.
  if (!open.length && !themen.length) {
    if (!kontoHatJeToDoGehabt()) {
      const wrap = document.createElement("div");
      wrap.className = "empty-cta";
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Keine offenen ToDos.";
      const btn = document.createElement("button");
      btn.className = "btn primary";
      btn.textContent = "＋ ToDo anlegen";
      btn.addEventListener("click", () => openAdd(cat.id, null));
      wrap.appendChild(empty);
      wrap.appendChild(btn);
      col.appendChild(wrap);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Keine offenen ToDos.";
      col.appendChild(empty);
    }
  }

  // --- Ueber-Themen als eigene Gruppen darunter ---
  themen.forEach(th => col.appendChild(renderThemaGruppe(cat, th, open)));

  // --- Erledigte ToDos (einklappbar) ---
  if (done.length) {
    const section = document.createElement("div");
    section.className = "done-section";
    const collapsed = !!doneCollapsed[cat.id];

    const dhead = document.createElement("div");
    dhead.className = "done-head";

    const toggle = document.createElement("button");
    toggle.className = "done-toggle" + (collapsed ? " collapsed" : "");
    toggle.innerHTML = `<span class="arrow">▾</span> Erledigt (${done.length})`;
    toggle.addEventListener("click", () => toggleDoneCollapse(cat.id));
    dhead.appendChild(toggle);

    section.appendChild(dhead);

    if (!collapsed) {
      const doneList = document.createElement("ul");
      doneList.className = "todo-list done";
      done.forEach(t => doneList.appendChild(renderTodo(t)));
      section.appendChild(doneList);
    }
    col.appendChild(section);
  }

  // --- Drag & Drop: die Spalte selbst ist die "frei"-Ablage. Ueber-Themen
  //     fangen ihre eigenen Drops mit stopPropagation ab (verdrahteDropZone),
  //     sonst wuerde ein Ablegen im Thema auch die Spalte als "frei" treffen. ---
  verdrahteDropZone(col, cat, null, freieUl);
  // Themen koennen nur in echte Bereiche gezogen werden - "Ohne Bereich"
  // kennt grundsaetzlich keine Themen (siehe Kopf dieser Funktion).
  if (!istOhne) verdrahteThemaDropZone(col, cat);

  return col;
}

// Ablagezone fuer das Verschieben eines GANZEN Themas (samt seiner ToDos) in
// einen anderen Bereich oder zum Umsortieren innerhalb des eigenen. Getrennt
// von verdrahteDropZone (die ist fuer einzelne ToDos, haengt an draggedId) -
// beide sitzen auf demselben col-Element, stoeren sich aber nicht: jede
// prueft ihre eigene Zustandsvariable und steigt sonst sofort aus, bevor sie
// das Event stoppen wuerde.
function verdrahteThemaDropZone(col, cat) {
  col.addEventListener("dragover", e => {
    if (!draggedThema) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    col.classList.add("drop-target");
  });
  col.addEventListener("dragleave", e => {
    if (!draggedThema) return;
    if (!col.contains(e.relatedTarget)) col.classList.remove("drop-target");
  });
  col.addEventListener("drop", e => {
    if (!draggedThema) return;
    e.preventDefault();
    col.classList.remove("drop-target");
    const th = state.themen.find(x => x.id === draggedThema);
    if (!th) return;
    const vorId = getThemaAfter(col, e.clientY, draggedThema);
    verschiebeThema(th, cat.id, vorId);
    render();
    save();
  });
}

// Welches Thema in der Spalte kommt (der Mausposition nach) direkt NACH der
// Ablagestelle? null = ganz ans Ende. exceptId blendet das gerade gezogene
// Thema aus (sonst stoerte seine alte Position den Vergleich beim
// Umsortieren innerhalb derselben Spalte). Gleiches Prinzip wie
// getDragAfterElement/getColumnAfter weiter oben, nur ohne deren
// Mehrzeilen-Sonderfall - Themen stehen immer einspaltig untereinander.
function getThemaAfter(col, y, exceptId) {
  const gruppen = [...col.querySelectorAll(".thema-gruppe")]
    .filter(g => g.dataset.thema !== exceptId);
  let closest = { offset: -Infinity, id: null };
  for (const g of gruppen) {
    const box = g.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, id: g.dataset.thema };
  }
  return closest.id;
}

// Thema in einen (moeglicherweise anderen) Bereich einsortieren, an der
// Stelle vor vorThemaId (null = ans Ende). Fuer die gespeicherte Position
// zaehlt nur die relative Reihenfolge INNERHALB derselben categoryId (siehe
// functions/api/todos.js) - dazwischenliegende Themen anderer Bereiche
// stoeren die Zaehlung nicht. Die ToDos des Themas ziehen im categoryId mit
// um, sonst erkennt der Speicherpfad sie beim naechsten Speichern als
// verwaist (categoryId passt nicht mehr zum Thema) und loest thema_id
// stillschweigend auf NULL auf - die ToDos blieben dann im ALTEN Bereich
// zurueck statt dem Thema zu folgen.
function verschiebeThema(th, zielCatId, vorThemaId) {
  const ohneIhn = state.themen.filter(x => x.id !== th.id);
  th.categoryId = zielCatId;
  let einfuegeAn = ohneIhn.length;
  if (vorThemaId) {
    const idx = ohneIhn.findIndex(x => x.id === vorThemaId);
    if (idx !== -1) einfuegeAn = idx;
  }
  ohneIhn.splice(einfuegeAn, 0, th);
  state.themen = ohneIhn;
  state.todos.forEach(t => { if (t.themaId === th.id) t.categoryId = zielCatId; });
}

// Baut eine Ueber-Thema-Gruppe: Klapp-Kopf (umbenennen/aufloesen/＋) und darunter
// die offenen ToDos des Themas. `open` sind alle offenen ToDos des Bereichs.
function renderThemaGruppe(cat, th, open) {
  const offen = open.filter(t => t.themaId === th.id).sort(sortOpen);
  const collapsed = !!themaCollapsed[th.id];

  const gruppe = document.createElement("div");
  gruppe.className = "thema-gruppe";
  gruppe.dataset.thema = th.id;

  const head = document.createElement("div");
  if (editingThema === th.id) {
    // Wie beim Bereich: Aufloesen gibt es nur im Bearbeiten-Modus.
    head.className = "thema-head editing";
    head.innerHTML = `
      <input type="text" class="thema-edit" data-edit-thema-name="${th.id}"
             value="${escapeHtml(th.name)}" autocomplete="off">
      <button type="button" class="act del" title="Thema auflösen" data-act="del-thema">🗑️</button>`;
    const input = head.querySelector(".thema-edit");
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") saveThemaName(th.id);
      else if (e.key === "Escape") cancelRenameThema();
    });
    head.querySelector('[data-act="del-thema"]').addEventListener("click", () => deleteThema(th.id));
  } else {
    head.className = "thema-head" + (collapsed ? " collapsed" : "");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "thema-toggle";
    toggle.innerHTML =
      `<span class="arrow">▾</span>` +
      `<span class="thema-name">${escapeHtml(th.name)}</span>` +
      `<span class="thema-count ${ampelKlasse(offen)}">${offen.length}</span>`;
    toggle.title = "Klick: ein-/ausklappen · Doppelklick: umbenennen · ziehen: verschieben";
    toggle.draggable = true;
    // Timer trennt Einfach- (einklappen) von Doppelklick (umbenennen), wie am Titel.
    let klickTimer = null;
    toggle.addEventListener("click", () => {
      clearTimeout(klickTimer);
      klickTimer = setTimeout(() => toggleThemaCollapse(th.id), 220);
    });
    toggle.addEventListener("dblclick", () => {
      clearTimeout(klickTimer);
      startRenameThema(th.id);
    });
    toggle.addEventListener("dragstart", e => {
      draggedThema = th.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "thema:" + th.id);
      gruppe.classList.add("thema-dragging");
    });
    toggle.addEventListener("dragend", () => {
      draggedThema = null;
      gruppe.classList.remove("thema-dragging");
      document.querySelectorAll(".column.drop-target").forEach(c => c.classList.remove("drop-target"));
      render();
    });
    head.appendChild(toggle);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "thema-add";
    plus.textContent = "＋";
    plus.title = "ToDo in diesem Thema";
    plus.addEventListener("click", () => openAdd(cat.id, th.id));
    head.appendChild(plus);
  }
  gruppe.appendChild(head);

  if (!collapsed) {
    const ul = document.createElement("ul");
    ul.className = "todo-list thema-list";
    ul.dataset.thema = th.id;
    offen.forEach(t => ul.appendChild(renderTodo(t)));
    gruppe.appendChild(ul);

    if (addingCat === cat.id && addingThema === th.id) {
      gruppe.appendChild(baueAddWidget(cat, th.id));
    }
    // Kein eigener Hinweis mehr fuer ein leeres Thema - das ＋ am Thema-Namen
    // (oben im head) deckt das Anlegen bereits ab.
    verdrahteDropZone(gruppe, cat, th.id, ul);
  } else {
    // Eingeklappt trotzdem als Ablage nutzbar (ohne Live-Umsortieren).
    verdrahteDropZone(gruppe, cat, th.id, null);
  }

  return gruppe;
}

// Ampel-Klasse fuer einen Zaehler offener ToDos: grau/blau/rot.
function ampelKlasse(offene) {
  return !offene.length ? "zero" : (offene.some(t => isUrgent(t.due)) ? "urgent" : "normal");
}

function toggleThemaCollapse(themaId) {
  themaCollapsed[themaId] = !themaCollapsed[themaId];
  localStorage.setItem("themaCollapsed", JSON.stringify(themaCollapsed));
  render();
}

// Werkzeugzeile am Spaltenkopf: neues freies ToDo bzw. neues Ueber-Thema. Nur
// fuer echte Bereiche - "Ohne Bereich" hat keine eigene Werkzeugzeile.
// Klick auf den Bereichstitel oeffnet/schliesst die Werkzeugzeile mit
// Farbpunkt und "+Thema" (siehe baueAddKnopfzeile). Farbauswahl geht beim
// Umschalten immer zu, sonst koennte sie beim naechsten Oeffnen der
// Werkzeugzeile ungefragt schon wieder offenstehen.
function toggleThemaWerkzeuge(catId) {
  themaWerkzeugeFuer = themaWerkzeugeFuer === catId ? null : catId;
  farbePickerFuer = null;
  render();
}

function baueAddKnopfzeile(cat) {
  const zeile = document.createElement("div");
  zeile.className = "col-tools";

  // Farbe, ＋ ToDo, ＋ Thema - in dieser Reihenfolge. Farbe und ＋ Thema
  // stehen seltener im Weg als ein ToDo - deshalb nur sichtbar, solange fuer
  // DIESEN Bereich die Werkzeuge aufgeklappt sind.
  const farbeOffen = themaWerkzeugeFuer === cat.id && farbePickerFuer === cat.id;
  if (themaWerkzeugeFuer === cat.id) {
    const farbeBtn = document.createElement("button");
    farbeBtn.type = "button";
    farbeBtn.className = "farbe-punkt" + (cat.farbe ? " farbe-" + cat.farbe : "");
    farbeBtn.dataset.farbeFuer = cat.id;
    farbeBtn.title = "Bereichsfarbe";
    farbeBtn.addEventListener("click", e => {
      e.stopPropagation();
      farbePickerFuer = farbeOffen ? null : cat.id;
      render();
    });
    zeile.appendChild(farbeBtn);

    if (farbeOffen) {
      const popup = document.createElement("div");
      popup.className = "farbe-popup";
      popup.dataset.farbeFuer = cat.id;
      popup.innerHTML = FARBEN.map(f => `<button type="button"
            class="farbe-swatch farbe-${f.id}${cat.farbe === f.id ? " aktiv" : ""}"
            data-farbe-wahl="${f.id}" title="${f.name}"></button>`).join("") +
        `<button type="button" class="farbe-swatch farbe-keine${!cat.farbe ? " aktiv" : ""}"
                data-farbe-wahl="" title="Keine Farbe">✕</button>`;
      popup.querySelectorAll("[data-farbe-wahl]").forEach(sw => {
        sw.addEventListener("click", e => {
          e.stopPropagation();
          cat.farbe = sw.dataset.farbeWahl || null;
          farbePickerFuer = null;
          render();
          save();
        });
      });
      zeile.appendChild(popup);
    }
  }

  const todoBtn = document.createElement("button");
  todoBtn.type = "button";
  todoBtn.className = "col-add-btn";
  todoBtn.textContent = "＋ ToDo";
  todoBtn.addEventListener("click", () => openAdd(cat.id, null));
  zeile.appendChild(todoBtn);

  if (themaWerkzeugeFuer === cat.id) {
    const themaBtn = document.createElement("button");
    themaBtn.type = "button";
    themaBtn.className = "col-thema-btn";
    themaBtn.textContent = "＋ Thema";
    themaBtn.title = "Über-Thema anlegen — eine Gruppe innerhalb des Bereichs";
    themaBtn.addEventListener("click", () => addThema(cat.id));
    zeile.appendChild(themaBtn);
  }
  return zeile;
}

// Das aufgeklappte Eingabefeld. Ziel ist Bereich + Ueber-Thema (themaId null =
// frei). Gleiches Feld fuer beide Faelle - nur das Ziel unterscheidet sich.
function baueAddWidget(cat, themaId) {
  // Beim allerersten ToDo auf dem ganzen Konto kurz erklaeren, wofuer das
  // Kalender-Icon da ist - danach kennt man's, auch in einem neuen Bereich.
  const istErstesTodo = !kontoHatJeToDoGehabt();
  const add = document.createElement("div");
  add.className = "col-add open";
  add.innerHTML = `
    <div class="add-line">
      <input type="text" class="add-text" placeholder="z. B. Wäsche waschen" autocomplete="off">
      <span class="date-field">
        <button type="button" class="add-icon add-cal">📅</button>
        <input type="date" class="add-date" tabindex="-1" aria-label="Termin">
      </span>
      <button type="button" class="add-icon date-clear" title="Termin entfernen" hidden>✕</button>
    </div>
    ${istErstesTodo ? `<p class="add-hint">📅 antippen, um ein Datum zu setzen — optional.</p>` : ""}
    <textarea class="add-note" placeholder="Notiz (optional) …" rows="2"></textarea>`;

  const textInput = add.querySelector(".add-text");
  const dateInput = add.querySelector(".add-date");
  const noteInput = add.querySelector(".add-note");
  const calBtn    = add.querySelector(".add-cal");
  const clearBtn  = add.querySelector(".date-clear");

  const syncDateUi = () => updateDateButton(calBtn, clearBtn, dateInput.value);
  syncDateUi();

  textInput.addEventListener("keydown", e => {
    if (e.key === "Enter") addTodoTo(cat.id, themaId, textInput.value, dateInput.value, noteInput.value);
    else if (e.key === "Escape") closeAdd();
  });

  // Notizfeld: Strg/Cmd+Enter uebernimmt, Escape bricht ab (Enter = Zeilenumbruch).
  noteInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addTodoTo(cat.id, themaId, textInput.value, dateInput.value, noteInput.value);
    else if (e.key === "Escape") closeAdd();
  });

  calBtn.addEventListener("click", () => openDatePicker(dateInput));
  clearBtn.addEventListener("click", () => { dateInput.value = ""; syncDateUi(); textInput.focus(); });
  dateInput.addEventListener("change", syncDateUi);

  return add;
}

// Eine Drop-/Sortierzone verdrahten. Ziehen hierher setzt Bereich + Ueber-Thema
// (themaId null = frei in der Spalte); termin-lose ToDos der GLEICHEN Gruppe
// lassen sich innerhalb live umsortieren. Fuer Themen-Gruppen wird das Event
// gestoppt, damit es nicht zusaetzlich die Spalte (frei) trifft.
function verdrahteDropZone(zone, cat, themaId, ul) {
  const tid = themaId || null;

  zone.addEventListener("dragover", e => {
    if (!draggedId) return;
    const dragged = findTodo(draggedId);
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (tid !== null) e.stopPropagation();

    const gleicheGruppe = dragged.categoryId === cat.id
      && (dragged.themaId || null) === tid && !dragged.due && !dragged.done;
    if (gleicheGruppe && ul) {
      const draggingEl = ul.querySelector(".todo.dragging");
      if (draggingEl) {
        const after = getDragAfterElement(ul, e.clientY);
        if (after == null) ul.appendChild(draggingEl);
        else ul.insertBefore(draggingEl, after);
      }
      zone.classList.remove("drop-target");
    } else {
      zone.classList.add("drop-target");
    }
  });

  zone.addEventListener("dragleave", e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove("drop-target");
  });

  zone.addEventListener("drop", e => {
    if (!draggedId) return;
    e.preventDefault();
    if (tid !== null) e.stopPropagation();
    zone.classList.remove("drop-target");
    const id = draggedId || e.dataTransfer.getData("text/plain");
    const t = id && findTodo(id);
    if (!t) return;
    const wechsel = t.categoryId !== cat.id || (t.themaId || null) !== tid;
    if (wechsel) {
      // In eine andere Spalte oder ein anderes Thema (auch "heraus" = frei).
      t.categoryId = cat.id;
      t.themaId = tid;
      if (!t.due && !t.done) t.order = nextOrder(cat.id, tid);
      render(); save();
    } else if (!t.due && !t.done && ul) {
      // Innerhalb derselben Gruppe neu sortieren.
      persistOrderFromDOM(ul);
      render(); save();
    }
  });
}

// Kalender-Icon zeigt den gewaehlten Termin an; das ✕ raeumt ihn wieder weg.
function updateDateButton(calBtn, clearBtn, value) {
  const has = !!value;
  calBtn.classList.toggle("active", has);
  calBtn.textContent = has ? `📅 ${formatDateShort(value)}` : "📅";
  calBtn.title = has ? `Termin ${formatDate(value)} – zum Ändern klicken` : "Termin wählen";
  clearBtn.hidden = !has;
}

// Analog zu updateDateButton: zeigt das Wiederholungsmuster kompakt im Knopf
// ("🔁 Wöchentlich"), damit der Bearbeiten-Dialog kein breites <select> mehr
// dauerhaft in der Zeile braucht - Klick oeffnet die Auswahl (siehe renderTodo).
function updateWiederholungButton(btn, value) {
  const muster = WIEDERHOLUNGEN.find(w => w.id === value);
  btn.classList.toggle("active", !!muster);
  btn.textContent = muster ? `🔁 ${muster.name}` : "🔁";
  btn.title = muster ? `Wiederholt sich ${muster.name.toLowerCase()} – zum Ändern klicken` : "Wiederholung festlegen";
}

// Checklisten-Abschnitt im Bearbeiten-Dialog: bestehende Punkte (Haekchen,
// Text, Loeschen). Das Eingabefeld fuer einen NEUEN Punkt sitzt seit der
// Kompakt-Zeile hinter dem ✓-Knopf in .edit-buttons (siehe renderTodo), nicht
// mehr hier. Kein Umbenennen weiterhin - Tippfehler heisst loeschen und neu
// anlegen.
function baueUnterpunkteBearbeiten(t) {
  const box = document.createElement("div");
  box.className = "edit-unterpunkte";

  unterpunkteVon(t.id).forEach(u => {
    const zeile = document.createElement("div");
    zeile.className = "edit-unterpunkt-zeile";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "check";
    cb.checked = u.done;
    cb.addEventListener("change", () => toggleUnterpunkt(u.id));
    const cbTap = document.createElement("label");
    cbTap.className = "check-tap";
    cbTap.appendChild(cb);
    zeile.appendChild(cbTap);

    const text = document.createElement("span");
    text.className = "edit-unterpunkt-text" + (u.done ? " is-done" : "");
    text.textContent = u.text;
    zeile.appendChild(text);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "act del";
    del.title = "Unterpunkt löschen";
    del.textContent = "🗑️";
    del.addEventListener("click", () => deleteUnterpunkt(u.id));
    zeile.appendChild(del);

    box.appendChild(zeile);
  });

  return box;
}

// Checkliste auf der Karte selbst - direkt abhakbar, nicht nur im
// Bearbeiten-Dialog (sonst waere Abhaken einzelner Punkte im Alltag
// umstaendlich, z. B. beim Einkaufen). Blendet sich aus, sobald das ToDo
// selbst erledigt ist, wie die Notiz auch. null, wenn keine Punkte da sind -
// dann haengt renderTodo nichts an.
function baueUnterpunkteAnzeige(t) {
  const liste = unterpunkteVon(t.id);
  if (!liste.length) return null;
  const box = document.createElement("ul");
  box.className = "unterpunkte";
  liste.forEach(u => {
    const zeile = document.createElement("li");
    zeile.className = "unterpunkt" + (u.done ? " is-done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "check";
    cb.checked = u.done;
    cb.addEventListener("change", () => toggleUnterpunkt(u.id));
    const cbTap = document.createElement("label");
    cbTap.className = "check-tap";
    cbTap.appendChild(cb);
    zeile.appendChild(cbTap);

    const text = document.createElement("span");
    text.textContent = u.text;
    zeile.appendChild(text);

    box.appendChild(zeile);
  });
  return box;
}

function renderTodo(t) {
  const li = document.createElement("li");
  // Streifen-Ampel: blau ohne Termin, gelb mit Termin, rot wenn dringend.
  const stripe = t.done ? "" : (isUrgent(t.due) ? " urgent" : (t.due ? " dated" : ""));
  li.className = "todo" + (t.done ? " is-done" : stripe);
  li.dataset.id = t.id;

  // --- Bearbeiten-Modus ---
  if (editingId === t.id) {
    const wrap = document.createElement("div");
    wrap.className = "edit-row";
    // Ueber-Thema-Auswahl nur, wenn der Bereich ueberhaupt Themen hat. Das ist
    // der verlaessliche (auch mobile) Weg, ein ToDo zuzuordnen oder wieder frei
    // zu stellen - Drag & Drop ist nur der Desktop-Komfort obendrauf.
    const themenDesBereichs = themenIn(t.categoryId);
    const themaWahl = themenDesBereichs.length ? `
      <select class="edit-thema" data-edit-thema="${t.id}" aria-label="Über-Thema">
        <option value="">— kein Über-Thema —</option>
        ${themenDesBereichs.map(th =>
          `<option value="${escapeHtml(th.id)}"${th.id === t.themaId ? " selected" : ""}>${escapeHtml(th.name)}</option>`
        ).join("")}
      </select>` : "";
    // Bereich-Auswahl nur bei ToDos, die gerade "Ohne Bereich" liegen - der
    // verlaessliche (auch mobile) Weg, sie einem Bereich zuzuordnen. Zugeordnete
    // ToDos verschiebt man wie bisher per Drag & Drop.
    const echteBereiche = state.categories.filter(c => !istOhneBereich(c.id));
    const bereichWahl = (istOhneBereich(t.categoryId) && echteBereiche.length) ? `
      <select class="edit-thema edit-bereich" data-edit-bereich="${t.id}" aria-label="Bereich zuordnen">
        <option value="">— Ohne Bereich —</option>
        ${echteBereiche.map(c =>
          `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
        ).join("")}
      </select>` : "";
    const unterpunktOffen = unterpunktEingabeOffen === t.id;
    wrap.innerHTML = `
      <input type="text" data-edit-text="${t.id}" value="${escapeHtml(t.text)}">
      <textarea data-edit-note placeholder="Notiz (optional)" rows="2"></textarea>
      ${bereichWahl}${themaWahl}
      <div class="edit-buttons">
        <span class="date-field">
          <button type="button" class="add-icon add-cal" data-act="cal">📅</button>
          <input type="date" data-edit-date="${t.id}" value="${t.due || ""}" tabindex="-1" aria-label="Termin">
        </span>
        <button type="button" class="add-icon date-clear" title="Termin entfernen" hidden>✕</button>
        <span class="date-field">
          <button type="button" class="add-icon" data-act="wiederholung" hidden>🔁</button>
          <select class="edit-wiederholung" data-edit-wiederholung="${t.id}" aria-label="Wiederholung" tabindex="-1">
            <option value="">Wiederholt sich nicht</option>
            ${WIEDERHOLUNGEN.map(w =>
              `<option value="${w.id}"${t.wiederholung === w.id ? " selected" : ""}>${w.name}</option>`
            ).join("")}
          </select>
        </span>
        ${unterpunktOffen
          ? `<input type="text" class="edit-unterpunkt-neu" data-neuer-unterpunkt="${t.id}" placeholder="＋ Unterpunkt" autocomplete="off">`
          : `<button type="button" class="add-icon" data-act="unterpunkt" title="Unterpunkt hinzufügen">✅</button>`}
        <button class="btn primary" data-act="save">OK</button>
        <button class="btn" data-act="cancel">Abbrechen</button>
      </div>`;
    wrap.appendChild(baueUnterpunkteBearbeiten(t));
    const textInput = wrap.querySelector(`[data-edit-text="${t.id}"]`);
    const noteInput = wrap.querySelector("[data-edit-note]");
    const dateInput = wrap.querySelector(`[data-edit-date="${t.id}"]`);
    const calBtn    = wrap.querySelector('[data-act="cal"]');
    const clearBtn  = wrap.querySelector(".date-clear");
    const wiederholungSelect = wrap.querySelector(".edit-wiederholung");
    const wiederholungBtn = wrap.querySelector('[data-act="wiederholung"]');
    noteInput.value = t.note || "";

    const syncDateUi = () => {
      updateDateButton(calBtn, clearBtn, dateInput.value);
      wiederholungBtn.hidden = !dateInput.value;
      updateWiederholungButton(wiederholungBtn, wiederholungSelect.value);
    };
    syncDateUi();
    calBtn.addEventListener("click", () => openDatePicker(dateInput));
    clearBtn.addEventListener("click", () => { dateInput.value = ""; syncDateUi(); textInput.focus(); });
    dateInput.addEventListener("change", syncDateUi);
    wiederholungBtn.addEventListener("click", () => openDatePicker(wiederholungSelect));
    wiederholungSelect.addEventListener("change", () => updateWiederholungButton(wiederholungBtn, wiederholungSelect.value));

    const unterpunktBtn = wrap.querySelector('[data-act="unterpunkt"]');
    if (unterpunktBtn) {
      unterpunktBtn.addEventListener("click", () => {
        unterpunktEingabeOffen = t.id;
        render();
        const feld = document.querySelector(`[data-neuer-unterpunkt="${t.id}"]`);
        if (feld) feld.focus();
      });
    }
    const unterpunktNeuInput = wrap.querySelector(".edit-unterpunkt-neu");
    if (unterpunktNeuInput) {
      // Enter delegiert an blur() statt selbst addUnterpunkt aufzurufen: sonst
      // wuerde der re-render() aus addUnterpunkt das (dann verwaiste) alte
      // Feld aus dem DOM nehmen, was seinerseits ein blur ausloest - und ohne
      // diesen Umweg damit denselben Unterpunkt ein zweites Mal anlegen wuerde.
      unterpunktNeuInput.addEventListener("keydown", e => { if (e.key === "Enter") unterpunktNeuInput.blur(); });
      unterpunktNeuInput.addEventListener("blur", () => addUnterpunkt(t.id, unterpunktNeuInput.value));
    }

    textInput.addEventListener("keydown", e => {
      if (e.key === "Enter") saveEdit(t.id);
      if (e.key === "Escape") cancelEdit();
    });
    noteInput.addEventListener("keydown", e => { if (e.key === "Escape") cancelEdit(); });
    wrap.querySelector('[data-act="save"]').addEventListener("click", () => saveEdit(t.id));
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", cancelEdit);
    li.appendChild(wrap);
    return li;
  }

  if (!t.done && !t.due) li.classList.add("undated");

  // --- Drag & Drop: ToDo ist ziehbar ---
  li.draggable = true;
  li.addEventListener("dragstart", e => {
    draggedId = t.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", t.id);
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => {
    draggedId = null;
    li.classList.remove("dragging");
    document.querySelectorAll(".column.drop-target").forEach(c => c.classList.remove("drop-target"));
    render();  // Live-Vorschau wieder mit den Daten abgleichen
  });

  // --- Checkbox ---
  // Eigenes <label> vergroessert die Tippflaeche unsichtbar (.check-tap in
  // style.css) - bei einer echten Checkbox der einzige Weg dafuer ganz ohne
  // eigene Klick-Weiterleitung per JS.
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "check";
  cb.checked = t.done;
  cb.title = t.done ? "Wieder als offen markieren" : "Als erledigt abhaken";
  cb.addEventListener("change", () => toggleDone(t.id));
  const cbTap = document.createElement("label");
  cbTap.className = "check-tap";
  cbTap.appendChild(cb);
  li.appendChild(cbTap);

  // --- Text + Termin (Doppelklick = bearbeiten) ---
  const main = document.createElement("div");
  main.className = "todo-main";
  main.title = "Doppelklick zum Bearbeiten";
  main.addEventListener("dblclick", () => startEdit(t.id));

  const txt = document.createElement("div");
  txt.className = "todo-text";
  txt.textContent = t.text;
  main.appendChild(txt);

  if (t.due) {
    const info = dueInfo(t.due);
    const due = document.createElement("span");
    due.className = "due" + (!t.done && info && info.cls ? " " + info.cls : "");
    const symbol = t.wiederholung ? "🔁 " : "";
    due.textContent = `${symbol}📅 ${formatDate(t.due)}`;
    const titelTeile = [];
    if (!t.done && info && info.badge) titelTeile.push(info.badge);
    if (t.wiederholung) {
      const muster = WIEDERHOLUNGEN.find(w => w.id === t.wiederholung);
      if (muster) titelTeile.push(`wiederholt sich ${muster.name.toLowerCase()}`);
    }
    if (titelTeile.length) due.title = titelTeile.join(" · ");
    main.appendChild(due);
  }

  if (t.note && !t.done) {
    const note = document.createElement("div");
    note.className = "todo-note";
    note.textContent = t.note;
    main.appendChild(note);
  }
  if (!t.done) {
    const liste = baueUnterpunkteAnzeige(t);
    if (liste) main.appendChild(liste);
  }
  li.appendChild(main);

  // --- Aktionen ---
  // Erledigte oeffnet man wieder, indem man den Haken rausnimmt.
  const actions = document.createElement("div");
  actions.className = "actions";

  const del = document.createElement("button");
  del.className = "act del";
  del.title = "Endgültig löschen";
  del.textContent = "🗑️";
  del.addEventListener("click", () => deleteTodo(t.id));
  actions.appendChild(del);

  li.appendChild(actions);
  return li;
}

// ---------- Ereignisse ----------
addCatBtn.addEventListener("click", addCategory);
addTodoBtn.addEventListener("click", addTodoOhneBereich);
themeSwitch.addEventListener("change", () => {
  const next = themeSwitch.checked ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
});

// Titel ist Umschalter und Umbenenn-Griff in einem: kurzer Klick oeffnet ab
// zwei Listen das Menue, Doppelklick benennt die aktive eigene Liste um. Der
// Timer trennt Einfach- von Doppelklick - sonst klappte jeder Umbenenn-
// Doppelklick nebenbei auch das Menue auf.
let titelKlickTimer = null;
titel.addEventListener("click", () => {
  if (titel.querySelector(".titel-edit")) return;   // laeuft gerade das Umbenennen
  clearTimeout(titelKlickTimer);
  titelKlickTimer = setTimeout(() => {
    if (listen.length >= 2) toggleMenue();
  }, 220);
});
titel.addEventListener("dblclick", () => {
  clearTimeout(titelKlickTimer);
  const meta = listen.find(b => b.id === aktiveListe);
  if (meta && meta.istEigen) starteTitelUmbenennen();
});
// Klick irgendwo sonst schliesst das offene Menue.
document.addEventListener("click", e => {
  if (listenMenue.hidden) return;
  if (titel.contains(e.target) || listenMenue.contains(e.target)) return;
  schliesseMenue();
});

// Der ehemalige Abmelden-Knopf oeffnet jetzt die Einstellungen.
einstellungenBtn.addEventListener("click", oeffneEinstellungen);
document.getElementById("neueListe").addEventListener("click", neueListeAnlegen);

document.getElementById("kontoAbmelden")
  .addEventListener("click", () => zeigeEinAnsicht("abmelden"));
document.getElementById("kontoAbmeldenJa").addEventListener("click", logout);
document.getElementById("kontoAbmeldenZurueck")
  .addEventListener("click", () => zeigeEinAnsicht("haupt"));

document.getElementById("kontoLoeschenStart").addEventListener("click", () => {
  const feld = document.getElementById("kontoLoeschenEmail");
  feld.value = "";
  document.getElementById("kontoMsg").textContent = "";
  zeigeEinAnsicht("loeschen");
  feld.focus();
});
document.getElementById("kontoLoeschenJa").addEventListener("click", kontoLoeschen);
document.getElementById("kontoLoeschenZurueck")
  .addEventListener("click", () => zeigeEinAnsicht("haupt"));
document.getElementById("kontoLoeschenEmail").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); kontoLoeschen(); }
});

// Vor der Freischaltung: Klick holt den Zugang (wie frueher der Knopf), der
// Link fuehrt noch nirgends hin. Danach ist es ein ganz normaler Link zur
// anderen App - der Browser uebernimmt, kein weiterer Klick-Handler noetig.
document.getElementById("fokusLink").addEventListener("click", async e => {
  if (fokusZugang) return;
  e.preventDefault();
  try {
    const res = await fetch("/api/auth/fokus-zugang", { method: "POST" });
    if (!res.ok) { snackInfo("Hat nicht geklappt - bitte nochmal versuchen."); return; }
    fokusZugang = true;
    aktualisiereFokusLink();
    snackInfo("Zugang zum Fokus-Tracker freigeschaltet.");
  } catch (e) {
    snackInfo("Hat nicht geklappt - bitte nochmal versuchen.");
  }
});

document.getElementById("todoZugangAufgebenStart")
  .addEventListener("click", () => zeigeEinAnsicht("zugangAufgeben"));
document.getElementById("todoZugangAufgebenZurueck")
  .addEventListener("click", () => zeigeEinAnsicht("haupt"));
document.getElementById("todoZugangAufgebenJa").addEventListener("click", async () => {
  try {
    await fetch("/api/auth/zugang-aufgeben", { method: "POST" });
  } catch (e) { /* egal - der Gesperrt-Kasten zeigt den Zustand ohnehin an */ }
  einstellungenPopup.hidden = true;
  zeigeGesperrt("Du hast deinen ToDo-Zugang aufgegeben.");
});

document.getElementById("mitgliederZurueck")
  .addEventListener("click", () => zeigeEinAnsicht("haupt"));
document.getElementById("alleEntfernen").addEventListener("click", alleEntfernen);

document.getElementById("einstellungenZu")
  .addEventListener("click", () => { einstellungenPopup.hidden = true; });
einstellungenPopup.addEventListener("click", e => {
  if (e.target === einstellungenPopup) einstellungenPopup.hidden = true;
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!listenMenue.hidden) schliesseMenue();
  if (!einstellungenPopup.hidden) einstellungenPopup.hidden = true;
  if (farbePickerFuer) { farbePickerFuer = null; render(); }
  if (themaWerkzeugeFuer) { themaWerkzeugeFuer = null; farbePickerFuer = null; render(); }
});

// Spalten umsortieren: Board ist die Ablagezone fuer Bereichs-Drags.
board.addEventListener("dragover", e => {
  if (!draggedCat) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const draggingCol = board.querySelector(".column.col-dragging");
  if (!draggingCol) return;
  const after = getColumnAfter(board, e.clientX, e.clientY);
  if (after == null) board.appendChild(draggingCol);
  else board.insertBefore(draggingCol, after);
});
board.addEventListener("drop", e => {
  if (!draggedCat) return;
  e.preventDefault();
  persistColumnOrderFromDOM();
  render();
  save();
});

// Klick ausserhalb des offenen Eingabe-/Bearbeiten-Felds = Aenderung uebernehmen.
document.addEventListener("mousedown", e => {
  if (addingCat) {
    const widget = document.querySelector(".col-add.open");
    if (widget && !widget.contains(e.target)) { commitAddFromDOM(); return; }
  }
  if (editingId) {
    const row = document.querySelector(".edit-row");
    if (row && !row.contains(e.target)) { commitEditFromDOM(); return; }
  }
  if (editingCat) {
    // Auf den ganzen Kopf pruefen, nicht nur auf das Eingabefeld: sonst wuerde
    // ein Klick auf den Loeschen-Knopf erst neu rendern und ginge dabei verloren.
    const head = document.querySelector(".col-head.editing");
    if (head && !head.contains(e.target)) saveCategoryName(editingCat);
  }
  if (editingThema) {
    // Wie beim Bereich: ganzen Thema-Kopf pruefen (Aufloesen-Knopf inklusive).
    const head = document.querySelector(".thema-head.editing");
    if (head && !head.contains(e.target)) saveThemaName(editingThema);
  }
  if (farbePickerFuer) {
    // Punkt UND Popup pruefen: ein Klick auf den Punkt selbst soll ihn
    // zumachen duerfen (der eigene Toggle-Handler regelt das), nicht schon
    // dieser Aussen-Check.
    const popup = document.querySelector(`.farbe-popup[data-farbe-fuer="${farbePickerFuer}"]`);
    const punkt = document.querySelector(`.farbe-punkt[data-farbe-fuer="${farbePickerFuer}"]`);
    const drin = (popup && popup.contains(e.target)) || (punkt && punkt.contains(e.target));
    if (!drin) { farbePickerFuer = null; render(); }
  }
  if (themaWerkzeugeFuer) {
    const head = document.querySelector(`.column[data-cat="${themaWerkzeugeFuer}"] .col-head`);
    if (head && !head.contains(e.target)) { themaWerkzeugeFuer = null; farbePickerFuer = null; render(); }
  }
});

// ---------- Start ----------
applyTheme(
  localStorage.getItem("theme") ||
  (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);

// ---------- Offline: App-Shell-Cache & Sync-Ausloeser ----------
// Cached nur die statischen Dateien (siehe sw.js) - die ToDo-Daten selbst
// laufen weiter ueber localStorage (Lokaler Cache & Offline-Sync oben).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ---------- Push-Benachrichtigungen ----------
// PushManager existiert im Safari-Tab auf dem iPhone gar nicht (erst ab
// iOS 16.4, und nur fuer eine vom Home-Bildschirm gestartete, installierte
// App) - der Schalter in den Einstellungen blendet sich dann aus und zeigt
// stattdessen den Hinweis.
function base64UrlZuBytes(base64url) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const roh = atob(base64);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

const pushUnterstuetzt = () => "serviceWorker" in navigator && "PushManager" in window;

async function aktuelleSubscription() {
  if (!pushUnterstuetzt()) return null;
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

// Bei jedem Oeffnen der Einstellungen den Schalter auf den echten Stand
// bringen - eine Berechtigung kann sich auch ausserhalb der App aendern
// (z. B. in den iOS-Systemeinstellungen entzogen).
async function aktualisierePushSchalter() {
  if (!pushUnterstuetzt()) {
    pushSwitchWrap.hidden = true;
    pushHinweis.hidden = false;
    pushHinweis.textContent = "Auf dem iPhone nur verfügbar, wenn die App vom Home-Bildschirm aus geöffnet ist.";
    return;
  }
  pushSwitchWrap.hidden = false;
  pushHinweis.hidden = true;
  const sub = await aktuelleSubscription().catch(() => null);
  const an = !!sub && Notification.permission === "granted";
  pushSwitch.checked = an;
  pushSwitchLabel.textContent = an ? "An" : "Aus";
}

async function schaltePushUm() {
  if (pushSwitch.checked) {
    try {
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== "granted") { pushSwitch.checked = false; return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlZuBytes(VAPID_PUBLIC_KEY),
      });
      const roh = sub.toJSON();
      const res = await fetch("/api/push/abonnieren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: roh.endpoint, keys: roh.keys }),
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        pushSwitch.checked = false;
        snackInfo("Anmelden hat nicht geklappt.");
        return;
      }
      pushSwitchLabel.textContent = "An";
    } catch (e) {
      pushSwitch.checked = false;
      snackInfo("Benachrichtigungen ließen sich nicht aktivieren.");
    }
  } else {
    try {
      const sub = await aktuelleSubscription();
      if (sub) {
        await fetch("/api/push/abbestellen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch (e) { /* Schalter bleibt trotzdem aus */ }
    pushSwitchLabel.textContent = "Aus";
  }
}
if (pushSwitch) pushSwitch.addEventListener("change", schaltePushUm);

window.addEventListener("offline", () => {
  serverErreichbar = false;
  zeigeOffline(true);
});
window.addEventListener("online", () => {
  // Optimistisch, aber nicht blind: der naechste echte Speicherversuch in
  // versucheAusstehendeZuSynchronisieren() korrigiert serverErreichbar
  // zurueck auf false, falls das Netz nur zum Schein da ist.
  serverErreichbar = true;
  aktualisiereOfflineAnzeige();
  versucheAusstehendeZuSynchronisieren();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") versucheAusstehendeZuSynchronisieren();
});

(async function init() {
  await loadState();
  await evtlBeitreten();   // ?beitreten=<token> aus dem Teilen-Link einloesen
  aktualisiereMenue();
  render();
  aktualisiereOfflineAnzeige();
  versucheAusstehendeZuSynchronisieren();
})();
