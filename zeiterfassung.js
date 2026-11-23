"use strict";

/* ====================================================================
   Zeiterfassung – eine Stoppuhr, die auf ToDos bucht (seit 18.10.2026)

   Vorher war der Timer ein 25-Minuten-Countdown ohne Bezug ("Fokusminuten pro
   Woche"). Hendriks Auftrag: "Zeit auf ein ToDo buchen, das heisst, ich druecke
   oben die Stoppuhr und kann ein ToDo auswaehlen, woran ich arbeite." Seine
   Entscheidungen dazu (gefragt, nicht angenommen):
   - Die Uhr zaehlt HOCH, ohne Pause-Taste: Stopp beendet den Eintrag,
     Weitermachen ist ein neuer. Jeder Eintrag hat so echte Von-bis-Zeiten.
   - Ein ToDo ist optional.
   - Einstieg NUR ueber ⏱ oben, und ALLES steht im Fenster dahinter.
     An den ToDo-Karten steht bewusst keine Zeit ("sonst wird das ueberladen").
   - Eintraege lassen sich bearbeiten, loeschen und nachtragen.
   - Laeuft die Uhr ueber 4 Stunden, haelt der Server sie dort an (gekappt),
     und das Fenster zeigt einen Hinweis zum Korrigieren.
   - Abhaken stoppt die Uhr, wenn sie auf genau diesem ToDo laeuft.
   - Statistik gruppiert nach Liste › Bereich › ToDo; Serien-ToDos (jede
     Ausgabe ist eine eigene Zeile in todos) zaehlen zusammen - gleicher Name
     im selben Bereich ist eine Zeile. Dazu ein CSV-Export als Nachweis.

   Zweite Runde am selben Abend (wieder gefragt, mit Skizzen):
   - Statt Suche und Vorschlagsliste ein DROPDOWN nach Liste › Bereich mit der
     Bereichsfarbe, oben ein Feld zum Eingrenzen. Auswaehlen, dann "Starten".
     Seit 19.11.2026 keine aufklappende Liste mehr, sondern eine Zeile, die eine
     eigene Seite aufschiebt (ztDropdown, Hendriks Wahl nach Mockup).
   - "Wechseln" ist weg ("ich waehle ein ToDo aus und arbeite daran, warum
     wechseln"). Bei laufender Uhr steht oben dasselbe Dropdown: wer ohne ToDo
     gestartet hat oder sich vertippt hat, waehlt dort, und die Zeit zaehlt AB
     START darauf (PUT /api/zeit/laufend). Darunter ein runder Stopp-Knopf.
   - "Heute gebucht" ist eine einklappbare Zeile, standardmaessig zu.
   - Nachtragen: Kopf wie die anderen Fenster, Dropdown, Tag als Heute/Gestern/
     Kalender, Dauer-Knoepfe, die "Bis" setzen.
   - Statistik: vierter Zeitraum "Gesamt" - alles seit Beginn.

   Seit 02.11.2026 laesst sich ⏱ am Rechner auch auf ein ToDo ziehen, dann
   laeuft die Uhr ohne Fenster darauf (siehe "Uhr auf ein ToDo ziehen").

   Gerechnet wird auf dem Server (functions/_lib/zeit.js), die Uhr hier ist
   reine Anzeige ab dem Stand der letzten Antwort.

   Namen: alles auf oberster Ebene beginnt mit `zt`, CSS-Klassen mit `zt-`.
   Wer was ruft: app.js meldet ueber window.zeitNeuZeichnen() (jedes render),
   window.zeitBeiAbhaken(id) (toggleDone) und window.zeitEinstellungGeaendert()
   (Schalter "Anzeige"); kalender.js fragt window.zeitSchliesseOberste() (Zurueck-
   Taste) und window.zeitFensterOffen() (keine Rand-Wischgeste).
   ==================================================================== */

// ---------- Elemente ----------
const ztKnoepfe       = document.querySelectorAll(".timer-knopf");
const ztPopup         = document.getElementById("timerPopup");
const ztHinweisEl     = document.getElementById("ztHinweis");
const ztInhaltEl      = document.getElementById("ztInhalt");
const ztGekapptEl     = document.getElementById("ztGekappt");
const ztStartBlock    = document.getElementById("ztStartBlock");
const ztUhrEl         = document.getElementById("ztUhr");
const ztHeuteKopf     = document.getElementById("ztHeuteKopf");
const ztHeuteSummeEl  = document.getElementById("ztHeuteSumme");
const ztHeuteListeEl  = document.getElementById("ztHeuteListe");

const ztFenster       = document.getElementById("zeitFenster");
const ztZeitraumEl    = document.getElementById("ztZeitraum");
const ztZeitraumName  = document.getElementById("ztZeitraumName");
const ztZurueckEl     = document.getElementById("ztZurueck");
const ztVorEl         = document.getElementById("ztVor");
const ztDiagrammEl    = document.getElementById("ztDiagramm");
const ztDiagrammNamen = document.getElementById("ztDiagrammNamen");
const ztGesamtEl      = document.getElementById("ztGesamt");
const ztBaumEl        = document.getElementById("ztBaum");
const ztEintraegeEl   = document.getElementById("ztEintraege");
const ztExportEl      = document.getElementById("ztExport");
const ztStatHinweisEl = document.getElementById("ztStatHinweis");

const ztDialog        = document.getElementById("ztDialog");
const ztDialogTitel   = document.getElementById("ztDialogTitel");
const ztDatumEl       = document.getElementById("ztDatum");
const ztVonEl         = document.getElementById("ztVon");
const ztBisEl         = document.getElementById("ztBis");
const ztDialogDauer   = document.getElementById("ztDialogDauer");
const ztDialogMsg     = document.getElementById("ztDialogMsg");
const ztDialogLoeschen = document.getElementById("ztDialogLoeschen");
const ztTagChips      = [...ztDialog.querySelectorAll(".zt-tag-wahl .zt-chip")];
const ztDauerChips    = [...ztDialog.querySelectorAll(".zt-dauer-wahl .zt-chip")];

// Wie DECKEL_SEK in functions/_lib/zeit.js. Gekappt wird dort - hier dient der
// Wert nur dazu, im richtigen Moment neu zu laden.
const ZT_DECKEL_SEK = 4 * 60 * 60;
// So viele Eintraege zeigt die Statistik, bevor "Alle anzeigen" kommt.
const ZT_EINTRAEGE_ERST = 30;

// ---------- Zustand ----------
let ztBereit = false;     // angemeldet und Daten da (erstes zeitNeuZeichnen)
let ztOffen = false;      // Fenster hinter ⏱ offen
let ztGeladen = false;    // GET /api/zeit hat mindestens einmal geklappt
let ztLadeNr = 0;         // nur die juengste Antwort zaehlt
let ztFehler = "";
let ztLaeuft = null;      // laufender Eintrag (Form: alsEintrag in _lib/zeit.js)
let ztBasisMs = 0;        // wann ztLaeuft.sek gemessen wurde
let ztDeckelGemeldet = false;
let ztHeute = [];         // heute fertig gebuchte Eintraege, neueste zuerst
let ztGekappt = [];       // gekappte Eintraege, die noch einen Hinweis brauchen
let ztAuswahl = {};       // im Dropdown gewaehlt, bevor "Starten" kommt; {} = ohne
let ztHeuteOffen = false; // "Heute gebucht" aufgeklappt
let zfOffen = false;      // Fokus-Bildschirm zu sehen (seit 19.11.2026)
let zfGeprueft = false;   // nach dem ersten Laden geprueft, ob er wieder auf soll

// ---------- Kleine Helfer ----------
function ztApi(pfad, optionen) {
  return gewApi("/api/zeit" + pfad, optionen);
}

function ztSchreibe(pfad, koerper, methode = "POST") {
  return ztApi(pfad, { method: methode, body: JSON.stringify(koerper || {}) });
}

function ztZwei(n) { return String(n).padStart(2, "0"); }

// Eine Schreibweise fuer alle Summen und Eintraege: "50 min", "1 h 35".
function ztDauer(sek) {
  const min = Math.round(sek / 60);
  if (min < 1) return sek > 0 ? "< 1 min" : "0 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${ztZwei(m)}` : `${h} h`;
}

// Die laufende Uhr im Fenster: 0:23:41.
function ztUhrText(sek) {
  const s = Math.max(0, Math.floor(sek));
  return `${Math.floor(s / 3600)}:${ztZwei(Math.floor(s % 3600 / 60))}:${ztZwei(s % 60)}`;
}

// Am Knopf in der Kopfzeile ist es enger: unter einer Stunde 23:41.
function ztKnopfText(sek) {
  const s = Math.max(0, Math.floor(sek));
  return s < 3600 ? `${Math.floor(s / 60)}:${ztZwei(s % 60)}` : ztUhrText(s);
}

const ZT_UHRZEIT = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const ZT_WOCHENTAG = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const ZT_MONAT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const ZT_MONAT_KURZ = new Intl.DateTimeFormat("de-DE", { month: "short" });

function ztUhrzeit(iso) { return ZT_UHRZEIT.format(new Date(iso)); }
function ztVonBis(e) { return `${ztUhrzeit(e.start)}–${ztUhrzeit(e.ende)}`; }

// "YYYY-MM-DD" eines lokalen Date.
function ztTag(d) { return `${d.getFullYear()}-${ztZwei(d.getMonth() + 1)}-${ztZwei(d.getDate())}`; }
// Ein "YYYY-MM-DD" als lokales Date (mittags - kein Sommerzeit-Randfall).
function ztAlsDatum(tag) { return new Date(tag + "T12:00:00"); }
function ztTagPlus(tag, n) { const d = ztAlsDatum(tag); d.setDate(d.getDate() + n); return ztTag(d); }
// "Mo 13.10."
function ztTagKurz(tag) {
  const d = ztAlsDatum(tag);
  return `${ZT_WOCHENTAG.format(d).replace(".", "")} ${ztZwei(d.getDate())}.${ztZwei(d.getMonth() + 1)}.`;
}
// "13.10.2026"
function ztTagLang(tag) {
  const d = ztAlsDatum(tag);
  return `${ztZwei(d.getDate())}.${ztZwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// "HH:MM" <-> Minuten seit Mitternacht.
function ztMinVon(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
}
function ztHhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${ztZwei(Math.floor(m / 60))}:${ztZwei(m % 60)}`;
}

// Ein Suchfeld nur mit Maus gleich in den Fokus: am Handy klappte sonst die
// Tastatur auf und verdeckte genau die Liste, aus der man waehlen will.
function ztFokussiere(feld) {
  if (window.matchMedia("(hover: hover)").matches) feld.focus();
}

function ztVerstrichen() {
  if (!ztLaeuft) return 0;
  return ztLaeuft.sek + (Date.now() - ztBasisMs) / 1000;
}

// Der Schalter "Anzeige" im Reiter Timer (app.js, pro Geraet).
function ztErlaubt() {
  const b = window.fokusBereiche?.() || { timer: true };
  return b.timer !== false;
}

function ztHinweisZeile(text) {
  const p = document.createElement("p");
  p.className = "zt-leer";
  p.textContent = text;
  return p;
}

// ---------- ToDos aus app.js ----------
// Die App haelt alle Listen im Speicher (`listen`, `daten`). Daraus kommen die
// aktuellen Namen - gespeichert sind nur die zum Zeitpunkt der Buchung.

function ztFundAus(t, boardId, bereiche, themen) {
  const meta = listen.find(b => b.id === boardId);
  const cat = bereiche[t.categoryId];
  const mitBereich = !!cat && !istOhneBereich(cat.id);
  // Das Ueber-Thema (Gruppe im Bereich), falls das ToDo in einem steht.
  const thema = mitBereich && t.themaId ? (themen || []).find(th => th.id === t.themaId) : null;
  return {
    todo: t,
    boardId,
    listeName: meta ? meta.name : "",
    bereichId: mitBereich ? cat.id : null,
    bereichName: mitBereich ? cat.name : "",
    themaName: thema ? thema.name : "",
    farbe: mitBereich ? (cat.farbe || null) : null,
  };
}

function ztBereicheVon(d) {
  const bereiche = {};
  for (const c of (d.categories || [])) bereiche[c.id] = c;
  return bereiche;
}

// Ein ToDo in allen Listen suchen, mit Liste und Bereich drumherum.
function ztFindeTodo(id) {
  if (!id) return null;
  for (const boardId in daten) {
    const d = daten[boardId] || {};
    const t = (d.todos || []).find(x => x.id === id);
    if (t) return ztFundAus(t, boardId, ztBereicheVon(d), d.themen);
  }
  return null;
}

// Was mit einer Buchung zum Server geht: die id und die Namen von jetzt.
function ztBuchungAus(fund) {
  if (!fund) return {};
  return {
    todoId: fund.todo.id,
    todoText: fund.todo.text,
    listeName: fund.listeName,
    bereichName: fund.bereichName,
  };
}

// Name eines Eintrags: der aktuelle, solange es das ToDo gibt.
function ztNameVon(e) {
  if (!e.todoId) return "Ohne ToDo";
  const f = ztFindeTodo(e.todoId);
  return f ? f.todo.text : (e.todoText || "Gelöschtes ToDo");
}

// Mit nur einer Liste (bei den meisten "Meine ToDos") sagt ihr Name nichts und
// stand zu praesent im Knopf (Hendrik, 19.10.2026) - dann bleibt nur der Bereich.
// Steht das ToDo in einem Ueber-Thema, folgt es hinter dem Bereich ("Projekte ›
// Kapitel 3"). Gebucht wird das Thema nicht mit, es kommt immer live vom ToDo.
function ztOrtVon(e) {
  if (!e.todoId) return "";
  const f = ztFindeTodo(e.todoId);
  const liste = listen.length > 1 ? (f ? f.listeName : e.listeName) : "";
  const bereich = f ? f.bereichName : e.bereichName;
  const ort = [liste, bereich].filter(Boolean).join(" · ");
  const thema = f ? f.themaName : "";
  return thema ? (ort ? `${ort} › ${thema}` : thema) : ort;
}

// Die Bereichsfarbe als CSS-Wert - nur aus der festen Palette (FARBEN in
// app.js), damit kein fremder Text in einem style-Wert landet.
function ztFarbwert(farbe) {
  return FARBEN.some(f => f.id === farbe) ? `var(--farbe-${farbe})` : "";
}

/* ====================================================================
   Die Auswahl: offene ToDos nach Liste › Bereich, mit Bereichsfarbe
   ==================================================================== */

// Wie auf dem Board: mit Termin zuerst (frueheste oben), dann die ohne in ihrer
// Reihenfolge.
function ztTodoReihenfolge(a, b) {
  if (!!a.due !== !!b.due) return a.due ? -1 : 1;
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  return (a.order ?? 0) - (b.order ?? 0);
}

/**
 * Die offenen ToDos aller Listen, je Liste nach Bereichen in der Reihenfolge des
 * Boards, "Ohne Bereich" zuletzt. Je Bereich zuerst die freien ToDos, dann die
 * Ueber-Themen mit ihren ToDos (`frei`, `themen`), wie am Board. Weg bleiben
 * erledigte. Mit Suchtext nur, was passt: am ToDo-Text oder am Namen von Bereich bzw. Thema (dann der ganze
 * Bereich bzw. das ganze Thema).
 */
function ztGruppen(suche) {
  const q = suche.trim().toLocaleLowerCase("de");
  const passtName = name => !!q && name.toLocaleLowerCase("de").includes(q);
  const gruppen = [];
  for (const b of listen) {
    const d = daten[b.id] || {};
    const bereichMap = ztBereicheVon(d);
    const bereiche = [];
    let ohne = null;
    for (const c of (d.categories || [])) {
      const ohneBereich = istOhneBereich(c.id);
      const bereichPasst = !ohneBereich && passtName(c.name);
      // "Ohne Bereich" kennt keine Themen (wie am Board).
      const themenDa = ohneBereich ? [] : (d.themen || []).filter(th => th.categoryId === c.id);
      const offen = (d.todos || []).filter(t => t.categoryId === c.id && !t.done);
      const sortiert = (liste, themaPasst) => liste
        .filter(t => !q || bereichPasst || themaPasst || t.text.toLocaleLowerCase("de").includes(q))
        .sort(ztTodoReihenfolge)
        .map(t => ztFundAus(t, b.id, bereichMap, d.themen));
      // Ein ToDo mit einem Thema, das es nicht mehr gibt, zaehlt als frei.
      const frei = sortiert(offen.filter(t => !themenDa.some(th => th.id === t.themaId)), false);
      const themen = themenDa
        .map(th => ({ name: th.name, todos: sortiert(offen.filter(t => t.themaId === th.id), passtName(th.name)) }))
        .filter(th => th.todos.length);
      if (!frei.length && !themen.length) continue;
      const g = { name: ohneBereich ? "Ohne Bereich" : c.name, farbe: ohneBereich ? null : c.farbe, frei, themen };
      if (ohneBereich) ohne = g; else bereiche.push(g);
    }
    if (ohne) bereiche.push(ohne);
    if (bereiche.length) gruppen.push({ name: b.name, bereiche });
  }
  return gruppen;
}

const ztDropdowns = [];

// Der Termin als farbiger Text rechts in der Zeile (seit 19.11.2026 statt des
// Chips): rot = dringend (ueberfaellig, heute, morgen) wie der Streifen an der
// Karte, sonst gelbbraun wie "bis" an der Karte. Das Jahr nur, wenn es nicht das
// laufende ist.
function ztTerminText(due) {
  const s = document.createElement("span");
  s.className = "zt-seite-datum" + (isUrgent(due) ? " dringend" : "");
  s.textContent = due.slice(0, 4) === todayStr().slice(0, 4) ? formatDateShort(due) : formatDate(due);
  const hinweis = dueInfo(due)?.badge;
  s.title = hinweis ? `${hinweis} · ${formatDate(due)}` : formatDate(due);
  return s;
}

// Der Farbpunkt eines Bereichs; ohne Farbe ein leerer Ring.
function ztPunkt(farbe) {
  const p = document.createElement("span");
  p.className = "zt-punkt";
  p.setAttribute("aria-hidden", "true");
  const wert = ztFarbwert(farbe);
  if (wert) p.style.setProperty("--zt-farbe", wert); else p.classList.add("leer");
  return p;
}

const ZT_PFEIL = '<svg class="zt-wahl-pfeil" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const ZT_HAKEN = '<svg class="zt-seite-haken" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/**
 * Die Auswahl eines ToDos - im Fenster (vor dem Start und bei laufender Uhr)
 * und im Eintrag-Dialog dieselbe. Seit 19.11.2026 nach Apple-Art (Hendriks
 * Wahl "eigene Seite"): in `host` steht nur eine Zeile "ToDo  ● Name ›". Ein
 * Tipp schiebt in `box` (das Fenster drumherum) eine eigene Seite herein: oben
 * "‹ Zurück" und der Titel, darunter das Suchfeld und alle offenen ToDos nach
 * Bereich, gestaltet wie die Einstellungen (Bereich klein ueber der Gruppe mit
 * Farbpunkt, Termin als farbiger Text, Haken am gewaehlten). Ein Tipp waehlt
 * und fuehrt zurueck. Vorher klappte die Liste im Fenster auf und blaetterte
 * mit eigenem Balken ("Liste im Kasten"); jetzt blaettert das ganze Fenster.
 *
 * `buchung()` sagt, was gerade gewaehlt ist ({ todoId, todoText, listeName,
 * bereichName } oder {}), `beiWahl(fund)` bekommt die Wahl (null = ohne ToDo),
 * `ohneText()` steht in der Zeile, wenn nichts gewaehlt ist.
 */
function ztDropdown(host, { buchung, beiWahl, ohneText, box }) {
  const gruppe = document.createElement("div");
  gruppe.className = "anlegen-gruppe zt-wahl-gruppe";
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "zt-wahl-zeile";
  gruppe.appendChild(knopf);
  host.replaceChildren(gruppe);

  const seite = document.createElement("div");
  seite.className = "zt-seite";
  seite.hidden = true;
  const kopf = document.createElement("div");
  kopf.className = "zt-seite-kopf";
  const zurueck = document.createElement("button");
  zurueck.type = "button";
  zurueck.className = "zt-seite-zurueck";
  zurueck.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Zurück</span>';
  const titel = document.createElement("span");
  titel.className = "zt-seite-titel";
  titel.textContent = "ToDo";
  // Ein leerer Platzhalter rechts haelt den Titel in der Mitte.
  kopf.append(zurueck, titel, document.createElement("span"));
  const suche = document.createElement("label");
  suche.className = "zt-suche";
  suche.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg>';
  const filter = document.createElement("input");
  filter.type = "search";
  filter.placeholder = "Suchen";
  filter.autocomplete = "off";
  filter.enterKeyHint = "search";
  filter.setAttribute("aria-label", "ToDos suchen");
  suche.appendChild(filter);
  const liste = document.createElement("div");
  liste.className = "zt-seite-liste";
  liste.setAttribute("role", "listbox");
  liste.setAttribute("aria-label", "ToDo wählen");
  seite.append(kopf, suche, liste);
  box.appendChild(seite);

  const dd = { offen: false };

  function zeichneKnopf() {
    const b = buchung() || {};
    const f = b.todoId ? ztFindeTodo(b.todoId) : null;
    const etikett = document.createElement("span");
    etikett.className = "zt-wahl-etikett";
    etikett.textContent = "ToDo";
    const wert = document.createElement("span");
    wert.className = "zt-wahl-wert" + (b.todoId ? "" : " ohne");
    if (b.todoId) wert.appendChild(ztPunkt(f?.farbe));
    const name = document.createElement("span");
    name.className = "zt-wahl-name";
    name.textContent = b.todoId ? ztNameVon(b) : ohneText();
    wert.appendChild(name);
    knopf.replaceChildren(etikett, wert);
    knopf.insertAdjacentHTML("beforeend", ZT_PFEIL);
    // Wo das ToDo steht (Liste · Bereich › Thema), fuer die Maus als Hinweis.
    const ort = ztOrtVon(b);
    knopf.title = ort || "";
    knopf.setAttribute("aria-label", `ToDo: ${name.textContent}${ort ? ", " + ort : ""}`);
  }

  function zeile(fund, gewaehltId) {
    const k = document.createElement("button");
    k.type = "button";
    k.className = "zt-seite-zeile";
    k.setAttribute("role", "option");
    const gewaehlt = (fund ? fund.todo.id : null) === (gewaehltId || null);
    k.setAttribute("aria-selected", String(gewaehlt));
    const name = document.createElement("span");
    name.className = "zt-seite-name";
    name.textContent = fund ? fund.todo.text : "Ohne ToDo";
    k.appendChild(name);
    if (fund?.todo.due) k.appendChild(ztTerminText(fund.todo.due));
    if (gewaehlt) k.insertAdjacentHTML("beforeend", ZT_HAKEN);
    k.onclick = () => { dd.schliesse(); beiWahl(fund); };
    return k;
  }

  function neueGruppe() {
    const g = document.createElement("div");
    g.className = "anlegen-gruppe zt-seite-gruppe";
    return g;
  }

  function zeichneListe() {
    const gewaehltId = (buchung() || {}).todoId || null;
    liste.replaceChildren();
    const text = filter.value;
    if (!text.trim()) {
      const g = neueGruppe();
      g.appendChild(zeile(null, gewaehltId));
      liste.appendChild(g);
    }
    const gruppen = ztGruppen(text);
    for (const l of gruppen) {
      // Der Listenname nur, wenn es mehrere Listen gibt (Hendrik, 19.10.2026:
      // "Meine ToDos ist mir zu praesent").
      if (listen.length > 1) {
        const lk = document.createElement("div");
        lk.className = "zt-seite-listenname";
        lk.textContent = l.name;
        liste.appendChild(lk);
      }
      for (const b of l.bereiche) {
        const abschnitt = document.createElement("div");
        abschnitt.className = "zt-seite-abschnitt";
        const bn = document.createElement("span");
        bn.textContent = b.name;
        abschnitt.append(ztPunkt(b.farbe), bn);
        liste.appendChild(abschnitt);
        const g = neueGruppe();
        for (const fund of b.frei) g.appendChild(zeile(fund, gewaehltId));
        // Die Themen als kleine graue Zwischenzeile in der Gruppe, ihre ToDos
        // ein Stueck eingerueckt (wie seit 19.10.2026).
        for (const th of b.themen) {
          const tk = document.createElement("div");
          tk.className = "zt-seite-thema";
          tk.textContent = th.name;
          g.appendChild(tk);
          for (const fund of th.todos) {
            const k = zeile(fund, gewaehltId);
            k.classList.add("im-thema");
            g.appendChild(k);
          }
        }
        liste.appendChild(g);
      }
    }
    if (!gruppen.length) {
      liste.appendChild(ztHinweisZeile(text.trim() ? "Kein offenes ToDo gefunden." : "Keine offenen ToDos."));
    }
  }

  dd.zeichne = () => { zeichneKnopf(); if (dd.offen) zeichneListe(); };
  dd.oeffne = () => {
    for (const anderes of ztDropdowns) if (anderes !== dd) anderes.schliesse();
    dd.offen = true;
    filter.value = "";
    zeichneListe();
    seite.hidden = false;
    box.classList.add("zt-seite-offen");
    box.scrollTop = 0;
    ztFokussiere(filter);
  };
  dd.schliesse = () => {
    if (!dd.offen) return;
    const hatteFokus = seite.contains(document.activeElement);
    dd.offen = false;
    seite.hidden = true;
    box.classList.remove("zt-seite-offen");
    zeichneKnopf();
    // Mit der Tastatur weiter an der Zeile, von der man kam.
    if (hatteFokus) knopf.focus({ preventScroll: true });
  };

  knopf.addEventListener("click", dd.oeffne);
  zurueck.addEventListener("click", dd.schliesse);
  filter.addEventListener("input", zeichneListe);
  // Enter nimmt den ersten Treffer - wer tippt, will nicht noch zielen.
  filter.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    liste.querySelector(".zt-seite-zeile")?.click();
  });

  ztDropdowns.push(dd);
  zeichneKnopf();
  return dd;
}

// ---------- Laden ----------
function ztUebernimmLaufend(e) {
  ztLaeuft = e || null;
  ztBasisMs = Date.now();
  ztDeckelGemeldet = false;
}

async function ztLade() {
  const nr = ++ztLadeNr;
  const antwort = await ztApi("?heute=" + todayStr());
  if (nr !== ztLadeNr) return;   // inzwischen kam eine neuere Anfrage
  if (antwort.ok) {
    ztFehler = "";
    ztGeladen = true;
    ztUebernimmLaufend(antwort.daten.laeuft);
    // Nach dem Neuladen (oder einem neuen Service-Worker-Stand) wieder da,
    // wenn der Fokus-Bildschirm offen war, als die Seite ging.
    if (!zfGeprueft) {
      zfGeprueft = true;
      if (ztLaeuft && zfGemerkt()) zfZeige();
    }
    ztHeute = antwort.daten.heute || [];
    ztGekappt = antwort.daten.gekappt || [];
  } else {
    ztFehler = antwort.status === 0
      ? "Keine Verbindung – die Zeiterfassung braucht Netz."
      : (antwort.daten.error || "Die Zeiterfassung lässt sich gerade nicht laden.");
  }
  ztZeichne();
}

// ---------- Zeichnen: Knopf in der Kopfzeile ----------
function ztZeichneKnoepfe() {
  const da = ztBereit && ztErlaubt();
  const sek = ztVerstrichen();
  for (const k of ztKnoepfe) {
    k.hidden = !da;
    k.classList.toggle("laeuft", !!ztLaeuft);
    // Ein gekappter Eintrag wartet auf einen Blick: Punkt am Knopf.
    k.classList.toggle("hinweis", !ztLaeuft && ztGekappt.length > 0);
    k.querySelector(".timer-zeit").textContent = ztLaeuft ? ztKnopfText(sek) : "";
    const ziehen = k.draggable
      ? (ztLaeuft ? " – auf ein anderes ToDo ziehen wechselt" : " – auf ein ToDo ziehen startet die Uhr") : "";
    k.title = (ztLaeuft ? `Uhr läuft: ${ztNameVon(ztLaeuft)}` : "Zeiterfassung") + ziehen;
  }
}

// ---------- Zeichnen: Eintraege ----------
function ztEintragZeile(e, mitDatum) {
  const zeile = document.createElement("div");
  zeile.className = "zt-eintrag";

  const text = document.createElement("div");
  text.className = "zt-eintrag-text";
  const name = document.createElement("span");
  name.className = "zt-eintrag-name" + (e.todoId ? "" : " ohne");
  name.textContent = ztNameVon(e);
  const zeit = document.createElement("span");
  zeit.className = "zt-eintrag-zeit";
  const teile = [];
  if (mitDatum) teile.push(ztTagKurz(e.datum));
  teile.push(ztVonBis(e));
  if (e.gekappt) teile.push("bei 4 h angehalten");
  else if (e.nachgetragen) teile.push("nachgetragen");
  zeit.textContent = teile.join(" · ");
  text.append(name, zeit);

  const dauer = document.createElement("span");
  dauer.className = "zt-eintrag-dauer";
  dauer.textContent = ztDauer(e.sek);

  const stift = document.createElement("button");
  stift.type = "button";
  stift.className = "gw-stift";
  stift.innerHTML = GEW_STIFT_SVG;
  stift.title = "Bearbeiten";
  stift.setAttribute("aria-label", `Eintrag „${ztNameVon(e)}“ ${ztVonBis(e)} bearbeiten`);
  stift.onclick = () => ztOeffneDialog(e);

  zeile.append(text, dauer, stift);
  return zeile;
}

// ---------- Zeichnen: Fenster ----------
function ztZeichneGekappt() {
  ztGekapptEl.hidden = !ztGekappt.length;
  ztGekapptEl.replaceChildren();
  if (!ztGekappt.length) return;
  const e = ztGekappt[0];
  const p = document.createElement("p");
  p.textContent = `Die Uhr lief länger als 4 Stunden und wurde angehalten: „${ztNameVon(e)}“, `
    + `${ztTagKurz(e.datum)} ${ztVonBis(e)}. Stimmt die Zeit?`
    + (ztGekappt.length > 1 ? ` (noch ${ztGekappt.length - 1} weitere)` : "");
  const knoepfe = document.createElement("div");
  knoepfe.className = "zt-gekappt-knoepfe";
  const korrigieren = document.createElement("button");
  korrigieren.type = "button";
  korrigieren.className = "btn klein primary";
  korrigieren.textContent = "Korrigieren";
  korrigieren.onclick = () => ztOeffneDialog(e);
  const passt = document.createElement("button");
  passt.type = "button";
  passt.className = "btn klein";
  passt.textContent = "Passt so";
  passt.onclick = async () => {
    const antwort = await ztSchreibe("/eintrag", { id: e.id, gekapptOk: true }, "PUT");
    if (!antwort.ok) { snackInfo(antwort.daten.error || "Hat nicht geklappt."); return; }
    ztLade();
  };
  knoepfe.append(korrigieren, passt);
  ztGekapptEl.append(p, knoepfe);
}

function ztZeichneHeute() {
  const summe = ztHeute.reduce((s, e) => s + e.sek, 0);
  ztHeuteSummeEl.textContent = ztHeute.length ? ztDauer(summe) : "noch nichts";
  ztHeuteKopf.setAttribute("aria-expanded", String(ztHeuteOffen));
  // Der Pfeil › dreht sich per CSS ([aria-expanded="true"]), seit 19.11.2026.
  ztHeuteListeEl.hidden = !ztHeuteOffen;
  ztHeuteListeEl.replaceChildren();
  if (!ztHeuteOffen) return;
  if (!ztHeute.length) {
    ztHeuteListeEl.appendChild(ztHinweisZeile("Heute noch nichts gebucht."));
    return;
  }
  for (const e of ztHeute) ztHeuteListeEl.appendChild(ztEintragZeile(e, false));
}

function ztZeichne() {
  ztZeichneKnoepfe();
  zfZeichne();
  if (!ztOffen) return;
  ztInhaltEl.hidden = !ztGeladen;
  ztHinweisEl.hidden = ztGeladen && !ztFehler;
  ztHinweisEl.textContent = ztFehler || "Lädt …";
  if (!ztGeladen) return;
  ztZeichneGekappt();
  ztStartBlock.hidden = !!ztLaeuft;
  ztUhrEl.hidden = !ztLaeuft;
  if (ztLaeuft) {
    ztDdStart.schliesse();
    ztDdLaufend.zeichne();
  } else {
    ztDdLaufend.schliesse();
    ztDdStart.zeichne();
  }
  ztZeichneHeute();
}

// ---------- Aktionen ----------
function ztStarte() { return ztStarteMit(ztAuswahl, null); }

// laeuftText: Meldung fuer den Weg ohne Fenster (Uhr aufs ToDo gezogen), sonst
// null - dann zeigt das offene Fenster selbst, dass die Uhr laeuft.
async function ztStarteMit(buchung, laeuftText) {
  const antwort = await ztSchreibe("/start", { heute: todayStr(), ...buchung });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Start fehlgeschlagen."); return; }
  // Lief schon eine (anderes Geraet, anderer Tab, oder beim Ziehen die eigene),
  // hat der Server sie gebucht.
  const vorher = antwort.daten.beendet;
  ztUebernimmLaufend(antwort.daten.laeuft);
  ztAuswahl = {};
  const teile = [];
  if (vorher) teile.push(`${ztDauer(vorher.sek)} auf „${ztNameVon(vorher)}“ gebucht`);
  if (laeuftText) teile.push(laeuftText);
  if (teile.length) snackInfo(teile.join(", "));
  // Seit 19.11.2026: wer die Uhr startet, sieht den Fokus-Bildschirm - auch
  // nach "Starten" im Fenster und nach dem Ziehen auf ein ToDo.
  if (ztOffen) ztSchliesse();
  zfZeige();
  ztZeichne();
  await ztLade();
  ztNachAenderung();
  // Die Uhr an der Karte ist jetzt blau.
  render();
}

/* ---------- Uhr auf ein ToDo ziehen (seit 02.11.2026) ----------
 * Hendrik: die Auswahl im Fenster sei umstaendlich. Am Rechner zieht man ⏱
 * jetzt mit der Maus auf eine Karte am Board oder eine ToDo-Zeile der
 * Heute-Ansicht, und die Uhr laeuft auf diesem ToDo - ohne Fenster. Seine Wahl
 * dabei: laeuft sie schon, wird NEU gestartet (die bisherige Zeit bleibt beim
 * alten ToDo, /start bucht sie), nicht umgebucht; an den Karten erscheint
 * nichts Neues; das Fenster bleibt, wie es ist.
 * Nur mit Maus (hover + feiner Zeiger): Hendrik startet die Uhr am Rechner, und
 * am Finger soll ein langes Druecken auf ⏱ nicht ploetzlich etwas ziehen.
 */
const ZT_ZIEH_TYP = "application/x-todo-uhr";
const ztMitMaus = window.matchMedia("(hover: hover) and (pointer: fine)");
let ztZiehtUhr = false;
let ztZielEl = null;

function ztSetzeZiehbar() { for (const k of ztKnoepfe) k.draggable = ztMitMaus.matches; }
ztSetzeZiehbar();
// Maus an- oder abgesteckt (Tablet mit Tastatur): der Tooltip erklaert das
// Ziehen nur, wo es geht.
ztMitMaus.addEventListener?.("change", () => { ztSetzeZiehbar(); ztZeichneKnoepfe(); });

for (const k of ztKnoepfe) {
  k.addEventListener("dragstart", e => {
    ztZiehtUhr = true;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(ZT_ZIEH_TYP, "1");
  });
  k.addEventListener("dragend", () => {
    ztZiehtUhr = false;
    ztMarkiereZiel(null);
  });
}

// Karte am Board (liegt immer in der aktiven Liste) oder Zeile der
// Heute-Ansicht (traegt ihre Liste selbst, data-board) - nur offene ToDos.
function ztZielAus(el) {
  const z = el.closest?.("li.todo[data-id], .kal-todo-zeile[data-id]");
  if (!z) return null;
  const boardId = z.dataset.board || aktiveListe;
  const t = (daten[boardId]?.todos || []).find(x => x.id === z.dataset.id);
  return t && !t.done ? { el: z, todo: t } : null;
}

function ztMarkiereZiel(el) {
  if (ztZielEl === el) return;
  ztZielEl?.classList.remove("zt-ziel");
  ztZielEl = el;
  ztZielEl?.classList.add("zt-ziel");
}

// Am Dokument statt an jeder Karte: Board und Heute-Ansicht zeichnen ihre
// Zeilen staendig neu. Die Ablage-Zonen des Boards steigen selbst aus, solange
// keine Karte, kein Bereich und kein Thema am Zeiger haengt.
document.addEventListener("dragover", e => {
  if (!ztZiehtUhr) return;
  const ziel = ztZielAus(e.target);
  ztMarkiereZiel(ziel ? ziel.el : null);
  if (!ziel) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("drop", e => {
  if (!ztZiehtUhr) return;
  const ziel = ztZielAus(e.target);
  ztMarkiereZiel(null);
  if (!ziel) return;
  e.preventDefault();
  ztStarteAuf(ziel.todo.id);
});

async function ztStarteAuf(todoId) {
  // Laeuft schon darauf: nur den Fokus-Bildschirm zeigen.
  if (ztLaeuft && ztLaeuft.todoId === todoId) { zfZeige(); return; }
  const fund = ztFindeTodo(todoId);
  if (!fund) return;
  // Keine Meldung "Uhr laeuft auf ..." mehr - das sagt jetzt der
  // Fokus-Bildschirm. Lief vorher eine, meldet ztStarteMit die gebuchte Zeit.
  await ztStarteMit(ztBuchungAus(fund), null);
}

/**
 * Der laufenden Uhr ein ToDo geben - ab ihrem Start (Hendrik: "dann wird von
 * Beginn an die Zeit darauf gebucht"). Auch zurueck auf "ohne".
 * Stand die Uhr schon auf einem anderen ToDo, hing die ganze bisherige Zeit
 * dort - sie wuerde stillschweigend umziehen (Hendrik, 19.10.2026: "geht das
 * sofort, das soll mit einer Meldung oder gar nicht gehen"). Deshalb vorher eine
 * Rueckfrage. Ohne ToDo bis dahin bleibt es ohne, so war es gedacht.
 */
async function ztOrdneZu(fund) {
  const b = ztBuchungAus(fund);
  if ((b.todoId || null) === (ztLaeuft?.todoId || null)) return;
  if (ztLaeuft?.todoId) {
    const ok = await bestaetigen({
      titel: "Zeit umbuchen?",
      text: `Die bisherigen ${ztDauer(ztVerstrichen())} von „${ztNameVon(ztLaeuft)}“ zählen dann ${fund ? `auf „${fund.todo.text}“` : "auf kein ToDo"}.`,
      okText: "Umbuchen",
      icon: "🔁",
      neutral: true,
    });
    if (!ok) return;
    // Waehrenddessen gestoppt (anderes Geraet, Abhaken) oder umgehaengt: dann
    // gibt es nichts mehr umzubuchen.
    if (!ztLaeuft) { ztZeichne(); return; }
  }
  const antwort = await ztSchreibe("/laufend", b, "PUT");
  if (!antwort.ok) {
    snackInfo(antwort.daten.error || "Zuordnen fehlgeschlagen.");
    ztLade();
    return;
  }
  ztUebernimmLaufend(antwort.daten.laeuft);
  snackInfo(fund ? `Die Zeit seit dem Start zählt jetzt auf „${fund.todo.text}“` : "Die Uhr läuft jetzt ohne ToDo");
  ztZeichne();
}

/**
 * Die Uhr anhalten. `abgehakt`: das ToDo, auf dem sie lief, wurde gerade
 * erledigt (window.zeitBeiAbhaken) - dann sagt die Meldung, warum.
 */
async function ztStoppe(abgehakt) {
  const antwort = await ztSchreibe("/stop", {});
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Stoppen fehlgeschlagen."); return; }
  ztUebernimmLaufend(null);
  const e = antwort.daten.beendet;
  if (e) {
    snackInfo(abgehakt
      ? `Uhr gestoppt – ${ztDauer(e.sek)} auf „${ztNameVon(e)}“ gebucht`
      : `${ztDauer(e.sek)} auf „${ztNameVon(e)}“ gebucht`);
  }
  ztZeichne();
  await ztLade();
  ztNachAenderung();
  render();
}

// Statistik nachziehen, wenn sie offen ist.
function ztNachAenderung() {
  if (ztFensterIstOffen()) ztLadeStatistik();
}

// ---------- Die beiden Dropdowns im Fenster ----------
const ztDdStart = ztDropdown(document.getElementById("ztDdStart"), {
  buchung: () => ztAuswahl,
  beiWahl: fund => { ztAuswahl = ztBuchungAus(fund); ztDdStart.zeichne(); },
  ohneText: () => "Ohne ToDo",
  box: ztPopup.querySelector(".timer-box"),
});
const ztDdLaufend = ztDropdown(document.getElementById("ztDdLaufend"), {
  buchung: () => ztLaeuft || {},
  beiWahl: ztOrdneZu,
  ohneText: () => "Jetzt zuordnen",
  box: ztPopup.querySelector(".timer-box"),
});

// ---------- Fenster oeffnen / schliessen ----------
function ztOeffne() {
  ztOffen = true;
  ztPopup.hidden = false;
  ztAuswahl = {};
  ztHeuteOffen = false;
  for (const dd of ztDropdowns) dd.schliesse();
  ztZeichne();
  ztLade();
}

function ztSchliesse() {
  ztOffen = false;
  ztPopup.hidden = true;
  ztDdStart.schliesse();
  ztDdLaufend.schliesse();
}

// Laeuft die Uhr, holt der Knopf den Fokus-Bildschirm zurueck (seit 19.11.2026);
// sonst oeffnet er das Fenster.
for (const k of ztKnoepfe) k.addEventListener("click", () => (ztLaeuft ? zfZeige() : ztOeffne()));
document.getElementById("timerZu").addEventListener("click", ztSchliesse);
ztPopup.addEventListener("click", e => { if (e.target === ztPopup) ztSchliesse(); });
document.getElementById("ztStarten").addEventListener("click", ztStarte);
ztHeuteKopf.addEventListener("click", () => { ztHeuteOffen = !ztHeuteOffen; ztZeichneHeute(); });
document.getElementById("ztNachtragen").addEventListener("click", () => ztOeffneDialog(null));
document.getElementById("ztStatistikOeffnen").addEventListener("click", () => {
  // Aus dem Zeit-Fenster heraus fuehrt "‹ Zeit" dorthin zurueck (es bleibt
  // darunter offen).
  setzeZurueck(ztFenster, "Zeit");
  ztOeffneStatistik();
});
document.getElementById("ztStatistikEinstellungen").addEventListener("click", () => {
  // Aus den Einstellungen heraus: die schliessen, wie beim Fenster Gewohnheiten.
  einstellungenVerlassenFuer(document.getElementById("zeitFenster"));
  ztOeffneStatistik();
});

/* ====================================================================
   Dialog: Eintrag nachtragen oder korrigieren
   ==================================================================== */

let ztDialogEintrag = null;   // der bearbeitete Eintrag, null = nachtragen
let ztDialogBuchung = {};     // { todoId, todoText, listeName, bereichName } oder {}

const ztDdDialog = ztDropdown(document.getElementById("ztDdDialog"), {
  buchung: () => ztDialogBuchung,
  beiWahl: fund => { ztDialogBuchung = ztBuchungAus(fund); ztDdDialog.zeichne(); },
  ohneText: () => "Ohne ToDo",
  box: ztDialog.querySelector(".zt-dialog-box"),
});

// Aus Tag und Uhrzeiten die Strecke. Liegt "Bis" nicht nach "Von", geht sie
// ueber Mitternacht - 23:30 bis 0:30 ist eine Stunde, kein Fehler.
function ztDialogStrecke() {
  const datum = ztDatumEl.value, von = ztVonEl.value, bis = ztBisEl.value;
  if (!datum || !von || !bis) return null;
  const start = new Date(`${datum}T${von}`);
  const ende = new Date(`${datum}T${bis}`);
  if (isNaN(start) || isNaN(ende)) return null;
  const ueberNacht = ende <= start;
  if (ueberNacht) ende.setDate(ende.getDate() + 1);
  return { start, ende, datum, ueberNacht };
}

// Dauer-Zeile und welche Schnellwahl gerade zutrifft.
function ztZeichneDialogDauer() {
  const s = ztDialogStrecke();
  const min = s ? Math.round((s.ende - s.start) / 60000) : null;
  ztDialogDauer.textContent = s
    ? `= ${ztDauer(min * 60)}` + (s.ueberNacht ? " (bis zum nächsten Tag)" : "")
    : "";
  for (const c of ztTagChips) {
    c.setAttribute("aria-pressed", String(ztDatumEl.value === addDaysStr(Number(c.dataset.tag))));
  }
  for (const c of ztDauerChips) {
    c.setAttribute("aria-pressed", String(min === Number(c.dataset.min)));
  }
}

function ztOeffneDialog(e) {
  ztDialogEintrag = e;
  ztDialogTitel.textContent = e ? "Eintrag bearbeiten" : "Zeit nachtragen";
  ztDialogLoeschen.hidden = !e;
  ztDialogMsg.textContent = "";
  if (e) {
    // Die Buchung, wie sie ist - auch fuer ein inzwischen geloeschtes ToDo,
    // sonst ginge beim Korrigieren der Uhrzeit der Name verloren.
    const f = e.todoId ? ztFindeTodo(e.todoId) : null;
    ztDialogBuchung = f ? ztBuchungAus(f)
      : e.todoId ? { todoId: e.todoId, todoText: e.todoText, listeName: e.listeName, bereichName: e.bereichName }
      : {};
    const start = new Date(e.start), ende = new Date(e.ende);
    ztDatumEl.value = ztTag(start);
    ztVonEl.value = ztHhmm(start.getHours() * 60 + start.getMinutes());
    ztBisEl.value = ztHhmm(ende.getHours() * 60 + ende.getMinutes());
  } else {
    // Vorschlag: die letzte halbe Stunde bis jetzt, auf 5 Minuten abgerundet.
    ztDialogBuchung = {};
    const bis = new Date();
    bis.setMinutes(bis.getMinutes() - bis.getMinutes() % 5, 0, 0);
    const von = new Date(bis.getTime() - 30 * 60 * 1000);
    ztDatumEl.value = ztTag(von);
    ztVonEl.value = ztHhmm(von.getHours() * 60 + von.getMinutes());
    ztBisEl.value = ztHhmm(bis.getHours() * 60 + bis.getMinutes());
  }
  ztDatumEl.max = todayStr();
  ztDdDialog.schliesse();
  ztDdDialog.zeichne();
  ztZeichneDialogDauer();
  ztDialog.hidden = false;
}

function ztSchliesseDialog() {
  ztDdDialog.schliesse();
  ztDialog.hidden = true;
  ztDialogEintrag = null;
}

async function ztSpeichereDialog() {
  const s = ztDialogStrecke();
  if (!s) { ztDialogMsg.textContent = "Bitte Tag, Von und Bis ausfüllen."; return; }
  const koerper = {
    start: s.start.toISOString(),
    ende: s.ende.toISOString(),
    datum: s.datum,
    ...ztDialogBuchung,
  };
  const neu = !ztDialogEintrag;
  if (!neu) koerper.id = ztDialogEintrag.id;
  const antwort = await ztSchreibe("/eintrag", koerper, neu ? "POST" : "PUT");
  if (!antwort.ok) { ztDialogMsg.textContent = antwort.daten.error || "Speichern fehlgeschlagen."; return; }
  ztSchliesseDialog();
  snackInfo(neu ? `${ztDauer(antwort.daten.eintrag.sek)} nachgetragen` : "Eintrag gespeichert");
  ztLade();
  ztNachAenderung();
}

async function ztLoescheDialog() {
  const e = ztDialogEintrag;
  if (!e) return;
  const ok = await bestaetigen({
    titel: "Eintrag löschen?",
    text: `${ztDauer(e.sek)} auf „${ztNameVon(e)}“, ${ztTagKurz(e.datum)} ${ztVonBis(e)}.`,
  });
  if (!ok) return;
  const antwort = await ztSchreibe("/eintrag", { id: e.id }, "DELETE");
  if (!antwort.ok) { ztDialogMsg.textContent = antwort.daten.error || "Löschen fehlgeschlagen."; return; }
  ztSchliesseDialog();
  snackInfo("Eintrag gelöscht");
  ztLade();
  ztNachAenderung();
}

// Heute / Gestern setzen den Tag; das Datumsfeld daneben kann jeden anderen.
for (const c of ztTagChips) {
  c.addEventListener("click", () => {
    ztDatumEl.value = addDaysStr(Number(c.dataset.tag));
    ztZeichneDialogDauer();
  });
}
// Die Dauer-Knoepfe setzen "Bis" ab "Von" - die haeufigste Frage beim
// Nachtragen ist "wie lange", nicht "bis wann".
for (const c of ztDauerChips) {
  c.addEventListener("click", () => {
    const min = Number(c.dataset.min);
    let von = ztMinVon(ztVonEl.value);
    if (von === null) {
      const jetzt = new Date();
      von = jetzt.getHours() * 60 + jetzt.getMinutes() - min;
      ztVonEl.value = ztHhmm(von);
    }
    ztBisEl.value = ztHhmm(von + min);
    ztZeichneDialogDauer();
  });
}
for (const feld of [ztDatumEl, ztVonEl, ztBisEl]) feld.addEventListener("input", ztZeichneDialogDauer);
document.getElementById("ztDialogZu").addEventListener("click", ztSchliesseDialog);
document.getElementById("ztDialogAbbrechen").addEventListener("click", ztSchliesseDialog);
document.getElementById("ztDialogSpeichern").addEventListener("click", ztSpeichereDialog);
ztDialogLoeschen.addEventListener("click", ztLoescheDialog);
ztDialog.addEventListener("click", e => { if (e.target === ztDialog) ztSchliesseDialog(); });

/* ====================================================================
   Fenster: Statistik
   ==================================================================== */

let ztZeitraum = "woche";      // "woche" | "monat" | "jahr" | "gesamt"
let ztAnker = "";              // ein Tag im gezeigten Zeitraum
let ztStatEintraege = [];
let ztStatGeladen = false;
let ztStatNr = 0;
let ztStatAlle = false;        // alle Eintraege zeigen statt der ersten 30
const ztAufgeklappt = new Set(); // Schluessel der aufgeklappten Knoten

function ztFensterIstOffen() { return !ztFenster.hidden; }

// ISO-Kalenderwoche (Montag als erster Tag, Woche 1 enthaelt den 4. Januar).
function ztKw(tag) {
  const d = ztAlsDatum(tag);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const erste = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - erste) / 86400000 - 3 + (erste.getDay() + 6) % 7) / 7);
}

// Der erste Tag mit einem Eintrag - Beginn des Zeitraums "Gesamt".
function ztErsterTag() {
  let erster = todayStr();
  for (const e of ztStatEintraege) if (e.datum < erster) erster = e.datum;
  return erster;
}

function ztGrenzen() {
  if (ztZeitraum === "gesamt") return { von: ztErsterTag(), bis: todayStr() };
  const d = ztAlsDatum(ztAnker);
  if (ztZeitraum === "woche") {
    const von = ztTagPlus(ztAnker, -((d.getDay() + 6) % 7));
    return { von, bis: ztTagPlus(von, 6) };
  }
  if (ztZeitraum === "monat") {
    const von = ztTag(new Date(d.getFullYear(), d.getMonth(), 1, 12));
    const bis = ztTag(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
    return { von, bis };
  }
  return { von: `${d.getFullYear()}-01-01`, bis: `${d.getFullYear()}-12-31` };
}

function ztZeitraumText({ von, bis }) {
  if (ztZeitraum === "gesamt") {
    if (!ztStatGeladen) return "Alles seit Beginn";
    return ztStatEintraege.length ? `seit ${ztTagLang(von)}` : "Noch nichts gebucht";
  }
  if (ztZeitraum === "woche") {
    const v = ztAlsDatum(von), b = ztAlsDatum(bis);
    return `KW ${ztKw(von)} · ${ztZwei(v.getDate())}.${ztZwei(v.getMonth() + 1)}.–`
      + `${ztZwei(b.getDate())}.${ztZwei(b.getMonth() + 1)}.${b.getFullYear()}`;
  }
  if (ztZeitraum === "monat") return ZT_MONAT.format(ztAlsDatum(von));
  return von.slice(0, 4);
}

// Fuer den Dateinamen beim Export.
function ztZeitraumKurz({ von }) {
  if (ztZeitraum === "gesamt") return "gesamt";
  if (ztZeitraum === "woche") {
    // Das Jahr der KW ist das ihres Donnerstags (KW 1 kann im Dezember beginnen).
    return `${ztTagPlus(von, 3).slice(0, 4)}-KW${ztZwei(ztKw(von))}`;
  }
  if (ztZeitraum === "monat") return von.slice(0, 7);
  return von.slice(0, 4);
}

async function ztLadeStatistik() {
  const g = ztGrenzen();
  const nr = ++ztStatNr;
  const antwort = await ztApi(ztZeitraum === "gesamt"
    ? "/eintraege?alle=1"
    : `/eintraege?von=${g.von}&bis=${g.bis}`);
  if (nr !== ztStatNr) return;
  if (!antwort.ok) {
    ztStatGeladen = false;
    ztStatHinweisEl.hidden = false;
    ztStatHinweisEl.textContent = antwort.status === 0
      ? "Ohne Verbindung gibt es keine Statistik."
      : (antwort.daten.error || "Die Statistik konnte nicht geladen werden.");
    ztZeichneStatistik();
    return;
  }
  ztStatHinweisEl.hidden = true;
  ztStatGeladen = true;
  ztStatEintraege = antwort.daten.eintraege || [];
  ztZeichneStatistik();
}

// Ein Monats-Eimer, "2026-10".
function ztMonatsEimer(schluessel, name) {
  return { schluessel, name, sek: 0, jetzt: todayStr().startsWith(schluessel), monat: true };
}

/**
 * Balken: Woche = 7 Tage, Monat = jeder Tag, Jahr = 12 Monate, Gesamt = jeder
 * Monat seit dem ersten Eintrag (ueber zwei Jahre hinweg: jedes Jahr, sonst
 * wuerden die Balken zu Strichen).
 */
function ztEimer(g) {
  const eimer = [];
  let schluesselVon = e => e.datum;
  if (ztZeitraum === "jahr") {
    const namen = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    for (let m = 0; m < 12; m++) eimer.push(ztMonatsEimer(`${g.von.slice(0, 4)}-${ztZwei(m + 1)}`, namen[m]));
    schluesselVon = e => e.datum.slice(0, 7);
  } else if (ztZeitraum === "gesamt") {
    const startJahr = Number(g.von.slice(0, 4)), startMonat = Number(g.von.slice(5, 7));
    const endJahr = Number(g.bis.slice(0, 4)), endMonat = Number(g.bis.slice(5, 7));
    const monate = (endJahr - startJahr) * 12 + endMonat - startMonat + 1;
    if (monate > 24) {
      for (let j = startJahr; j <= endJahr; j++) {
        eimer.push({ schluessel: String(j), name: String(j), sek: 0, jetzt: j === endJahr, jahr: true });
      }
      schluesselVon = e => e.datum.slice(0, 4);
    } else {
      for (let i = 0; i < monate; i++) {
        const d = new Date(startJahr, startMonat - 1 + i, 1, 12);
        const schluessel = `${d.getFullYear()}-${ztZwei(d.getMonth() + 1)}`;
        // Bis zwoelf Balken passt der Monatsname, darueber nur der Januar mit Jahr.
        const name = monate <= 12 ? ZT_MONAT_KURZ.format(d).replace(".", "")
          : (d.getMonth() === 0 || i === 0 ? String(d.getFullYear()) : "");
        eimer.push(ztMonatsEimer(schluessel, name));
      }
      schluesselVon = e => e.datum.slice(0, 7);
    }
  } else {
    for (let tag = g.von; tag <= g.bis; tag = ztTagPlus(tag, 1)) {
      const d = ztAlsDatum(tag);
      let name = "";
      if (ztZeitraum === "woche") name = ZT_WOCHENTAG.format(d).replace(".", "").slice(0, 2);
      else if ([1, 8, 15, 22, 29].includes(d.getDate())) name = String(d.getDate());
      eimer.push({ schluessel: tag, name, sek: 0, jetzt: tag === todayStr() });
    }
  }
  const nach = new Map(eimer.map(e => [e.schluessel, e]));
  for (const e of ztStatEintraege) {
    const ziel = nach.get(schluesselVon(e));
    if (ziel) ziel.sek += e.sek;
  }
  return eimer;
}

// Wert ueber einem Balken: "1,5 h", ab zehn Stunden ohne Nachkomma.
function ztStunden(sek) {
  const h = sek / 3600;
  return (h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace(".", ",")) + " h";
}

function ztEimerName(e) {
  if (e.jahr) return e.schluessel;
  if (e.monat) return ZT_MONAT.format(ztAlsDatum(e.schluessel + "-01"));
  return ztTagKurz(e.schluessel);
}

function ztZeichneDiagramm(g) {
  const eimer = ztEimer(g);
  const hoechst = Math.max(1, ...eimer.map(e => e.sek));
  const dicht = eimer.length > 12;
  ztDiagrammEl.classList.toggle("zt-dicht", dicht);
  ztDiagrammNamen.classList.toggle("zt-dicht", dicht);
  ztDiagrammEl.replaceChildren();
  ztDiagrammNamen.replaceChildren();
  for (const e of eimer) {
    const spalte = document.createElement("div");
    spalte.className = "gw-diagramm-spalte" + (e.jetzt ? " jetzt" : "");
    const wert = document.createElement("div");
    wert.className = "gw-diagramm-wert";
    // Am dichten Monat haetten 31 Zahlen keinen Platz - dort steht der Wert im
    // Tooltip.
    wert.textContent = !dicht && e.sek >= 60 ? ztStunden(e.sek) : "";
    const saeule = document.createElement("div");
    saeule.className = "gw-diagramm-saeule";
    saeule.style.height = e.sek ? `${Math.round(e.sek / hoechst * 100)}%` : "0";
    saeule.title = `${ztEimerName(e)}: ${ztDauer(e.sek)}`;
    spalte.append(wert, saeule);
    ztDiagrammEl.appendChild(spalte);
    const n = document.createElement("span");
    n.textContent = e.name;
    ztDiagrammNamen.appendChild(n);
  }
}

/**
 * Die Eintraege zu einem Baum Liste › Bereich › ToDo. Gleicher Name im selben
 * Bereich ist EIN Blatt - so stehen alle Ausgaben eines Serien-ToDos zusammen
 * (Hendriks Wahl). ToDos ohne Bereich haengen direkt an der Liste, wie auf dem
 * Board die Zone "Ohne Bereich". Fuer ein geloeschtes ToDo gelten die Namen vom
 * Zeitpunkt der Buchung.
 */
function ztBaueBaum() {
  const wurzel = { kinder: new Map() };
  let ohneSek = 0;
  const knoten = (eltern, schluessel, name, art) => {
    let k = eltern.kinder.get(schluessel);
    if (!k) { k = { schluessel, name, art, sek: 0, kinder: new Map() }; eltern.kinder.set(schluessel, k); }
    return k;
  };
  for (const e of ztStatEintraege) {
    if (!e.todoId) { ohneSek += e.sek; continue; }
    const f = ztFindeTodo(e.todoId);
    const listeName = f ? f.listeName : (e.listeName || "Ohne Liste");
    const listeKey = f ? `b:${f.boardId}` : `n:${listeName}`;
    const liste = knoten(wurzel, listeKey, listeName, "liste");
    liste.sek += e.sek;
    let eltern = liste;
    const bereichName = f ? f.bereichName : e.bereichName;
    if (bereichName) {
      const bereichKey = `${listeKey}|${f && f.bereichId ? "c:" + f.bereichId : "n:" + bereichName}`;
      eltern = knoten(liste, bereichKey, bereichName, "bereich");
      eltern.sek += e.sek;
    }
    const name = f ? f.todo.text : (e.todoText || "Gelöschtes ToDo");
    const blatt = knoten(eltern, `${eltern.schluessel}|t:${name.trim().toLocaleLowerCase("de")}`, name, "todo");
    blatt.sek += e.sek;
  }
  return { wurzel, ohneSek };
}

function ztKnotenZeile(k, tiefe) {
  const offen = ztAufgeklappt.has(k.schluessel);
  const hatKinder = k.kinder.size > 0;
  const zeile = document.createElement(hatKinder ? "button" : "div");
  if (hatKinder) {
    zeile.type = "button";
    zeile.setAttribute("aria-expanded", String(offen));
    zeile.onclick = () => {
      if (offen) ztAufgeklappt.delete(k.schluessel); else ztAufgeklappt.add(k.schluessel);
      ztZeichneBaum();
    };
  }
  zeile.className = `zt-knoten zt-${k.art}`;
  zeile.style.setProperty("--tiefe", tiefe);
  const pfeil = document.createElement("span");
  pfeil.className = "zt-knoten-pfeil";
  pfeil.setAttribute("aria-hidden", "true");
  pfeil.textContent = hatKinder ? (offen ? "▾" : "▸") : "";
  const name = document.createElement("span");
  name.className = "zt-knoten-name";
  name.textContent = k.name;
  const sek = document.createElement("span");
  sek.className = "zt-knoten-summe";
  sek.textContent = ztDauer(k.sek);
  zeile.append(pfeil, name, sek);
  return zeile;
}

function ztZeichneBaum() {
  ztBaumEl.replaceChildren();
  const { wurzel, ohneSek } = ztBaueBaum();
  const nachSumme = m => [...m.values()].sort((a, b) => b.sek - a.sek);
  const zeichne = (k, tiefe) => {
    ztBaumEl.appendChild(ztKnotenZeile(k, tiefe));
    if (ztAufgeklappt.has(k.schluessel)) for (const kind of nachSumme(k.kinder)) zeichne(kind, tiefe + 1);
  };
  for (const k of nachSumme(wurzel.kinder)) zeichne(k, 0);
  if (ohneSek > 0) {
    ztBaumEl.appendChild(ztKnotenZeile(
      { schluessel: "ohne", name: "Ohne ToDo", art: "frei", sek: ohneSek, kinder: new Map() }, 0));
  }
}

function ztZeichneEintraege() {
  ztEintraegeEl.replaceChildren();
  const zeigen = ztStatAlle ? ztStatEintraege : ztStatEintraege.slice(0, ZT_EINTRAEGE_ERST);
  for (const e of zeigen) ztEintraegeEl.appendChild(ztEintragZeile(e, true));
  if (zeigen.length < ztStatEintraege.length) {
    const mehr = document.createElement("button");
    mehr.type = "button";
    mehr.className = "lock-link zt-mehr";
    mehr.textContent = `Alle ${ztStatEintraege.length} Einträge anzeigen`;
    mehr.onclick = () => { ztStatAlle = true; ztZeichneEintraege(); };
    ztEintraegeEl.appendChild(mehr);
  }
}

function ztZeichneStatistik() {
  const g = ztGrenzen();
  for (const k of ztZeitraumEl.querySelectorAll("button")) {
    k.setAttribute("aria-selected", String(k.dataset.zeitraum === ztZeitraum));
  }
  ztZeitraumName.textContent = ztZeitraumText(g);
  // "Gesamt" laesst sich nicht blaettern; die Pfeile behalten ihren Platz,
  // damit der Text darunter nicht springt.
  const gesamt = ztZeitraum === "gesamt";
  ztZurueckEl.style.visibility = gesamt ? "hidden" : "";
  ztVorEl.style.visibility = gesamt ? "hidden" : "";
  // In die Zukunft gibt es nichts zu sehen.
  ztVorEl.disabled = gesamt || g.bis >= todayStr();

  const leer = !ztStatEintraege.length;
  ztZeichneDiagramm(g);
  ztGesamtEl.textContent = ztDauer(ztStatEintraege.reduce((s, e) => s + e.sek, 0));
  ztExportEl.disabled = leer || !ztStatGeladen;
  ztZeichneBaum();
  ztZeichneEintraege();
  if (ztStatGeladen && leer) {
    ztEintraegeEl.appendChild(ztHinweisZeile(gesamt
      ? "Noch nichts gebucht."
      : "In diesem Zeitraum ist nichts gebucht."));
  }
}

function ztOeffneStatistik() {
  ztAnker = todayStr();
  ztStatAlle = false;
  ztStatEintraege = [];
  ztStatGeladen = false;
  ztFenster.hidden = false;
  ztFenster.querySelector(".gw-blaettern").scrollTop = 0;
  ztZeichneStatistik();
  ztLadeStatistik();
}

function ztSchliesseStatistik() {
  ztFenster.hidden = true;
}

function ztBlaettere(richtung) {
  const g = ztGrenzen();
  ztAnker = richtung < 0 ? ztTagPlus(g.von, -1) : ztTagPlus(g.bis, 1);
  ztStatAlle = false;
  ztZeichneStatistik();
  ztLadeStatistik();
}

for (const k of ztZeitraumEl.querySelectorAll("button")) {
  k.addEventListener("click", () => {
    if (ztZeitraum === k.dataset.zeitraum) return;
    // Der neue Zeitraum enthaelt den bisher gezeigten Tag - nicht zurueck auf heute.
    ztZeitraum = k.dataset.zeitraum;
    ztStatAlle = false;
    ztStatEintraege = [];
    ztStatGeladen = false;
    ztZeichneStatistik();
    ztLadeStatistik();
  });
}
ztZurueckEl.addEventListener("click", () => ztBlaettere(-1));
ztVorEl.addEventListener("click", () => ztBlaettere(1));
document.getElementById("zeitFensterZu").addEventListener("click", ztSchliesseStatistik);
ztFenster.addEventListener("click", e => { if (e.target === ztFenster) ztSchliesseStatistik(); });

// ---------- CSV-Export ----------
// Semikolon und BOM, damit ein deutsches Excel die Datei per Doppelklick richtig
// oeffnet (Spalten getrennt, Umlaute heil). Felder mit = + - @ vorn bekommen ein
// Hochkomma, sonst liest Excel einen ToDo-Text wie "=1+1" als Formel.
function ztCsvFeld(wert) {
  let s = String(wert ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ztExportiere() {
  if (!ztStatEintraege.length) return;
  const zeilen = [["Datum", "Von", "Bis", "Dauer (h:mm)", "Stunden", "ToDo", "Liste", "Bereich"]];
  // Aelteste zuerst - so liest man einen Nachweis.
  for (const e of [...ztStatEintraege].reverse()) {
    const f = e.todoId ? ztFindeTodo(e.todoId) : null;
    const min = Math.round(e.sek / 60);
    zeilen.push([
      ztTagLang(e.datum),
      ztUhrzeit(e.start),
      ztUhrzeit(e.ende),
      `${Math.floor(min / 60)}:${ztZwei(min % 60)}`,
      (e.sek / 3600).toFixed(2).replace(".", ","),
      e.todoId ? ztNameVon(e) : "",
      f ? f.listeName : (e.listeName || ""),
      f ? f.bereichName : (e.bereichName || ""),
    ]);
  }
  const text = "﻿" + zeilen.map(z => z.map(ztCsvFeld).join(";")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `zeiterfassung-${ztZeitraumKurz(ztGrenzen())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

ztExportEl.addEventListener("click", ztExportiere);

/* ====================================================================
   Escape, Zurueck-Taste, Takt, Anbindung an app.js
   ==================================================================== */

// Von innen nach aussen: ein offenes Dropdown, Dialog, Statistik, Fenster.
// Sagt, ob etwas zu war.
function ztSchliesseOberste() {
  const offen = ztDropdowns.find(dd => dd.offen);
  if (offen) { offen.schliesse(); return true; }
  if (!ztDialog.hidden) { ztSchliesseDialog(); return true; }
  if (ztFensterIstOffen()) { ztSchliesseStatistik(); return true; }
  if (ztOffen) { ztSchliesse(); return true; }
  if (zfOffen) { zfAusblenden(); return true; }
  return false;
}

// In der Einfangphase und mit stopImmediatePropagation, wie bei den Fenstern
// der Gewohnheiten: sonst schloessen die Escape-Handler in app.js und
// kalender.js im selben Tastendruck noch den Streifen dahinter. Eine offene
// Rueckfrage (bestaetigen()) hat Vorrang, sie faengt Escape selbst ab.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (document.querySelector(".eingabe-popup")) return;
  if (ztSchliesseOberste()) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

window.zeitSchliesseOberste = ztSchliesseOberste;
window.zeitFensterOffen = () => ztOffen || zfOffen || ztFensterIstOffen() || !ztDialog.hidden;

// Ein Schlag pro Sekunde, nur bei laufender Uhr. Er zeichnet nur; erreicht die
// Uhr den Deckel, holt er den Stand neu - gekappt hat dann der Server.
setInterval(() => {
  if (!ztLaeuft) return;
  if (ztVerstrichen() >= ZT_DECKEL_SEK && !ztDeckelGemeldet) {
    ztDeckelGemeldet = true;
    ztLade().then(() => {
      if (!ztLaeuft) snackInfo("Die Uhr lief 4 Stunden und wurde angehalten.");
    });
    return;
  }
  ztZeichneKnoepfe();
  if (zfOffen) zfUhrEl.textContent = ztUhrText(ztVerstrichen());
}, 1000);

// Zurueck in der App: an einem anderen Geraet kann die Uhr gestartet oder
// gestoppt worden sein, und der Knopf soll keine laengst beendete zeigen.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ztBereit) ztLade();
});

/**
 * Aus render() in app.js. Der erste Aufruf heisst: angemeldet, Daten da - ab
 * jetzt gibt es den Knopf, und der Stand wird gleich geholt, damit er eine
 * laufende Uhr von einem anderen Geraet zeigt. Spaetere Aufrufe zeichnen das
 * offene Fenster nach (ein ToDo kann umbenannt, verschoben oder erledigt
 * worden sein) - auch ein offenes Dropdown, das seinen Suchtext behaelt.
 */
window.zeitNeuZeichnen = function () {
  if (ztBereit) {
    if (ztOffen) ztZeichne();
    if (!ztDialog.hidden) ztDdDialog.zeichne();
    zfZeichne();
    return;
  }
  ztBereit = true;
  ztZeichneKnoepfe();
  ztLade();
};

// Aus toggleDone in app.js: das ToDo wurde gerade erledigt.
window.zeitBeiAbhaken = function (id) {
  if (ztLaeuft && ztLaeuft.todoId === id) ztStoppe(true);
};

// Aus app.js, wenn der Schalter "Anzeige" im Reiter Timer umgelegt wurde.
window.zeitEinstellungGeaendert = function () {
  ztZeichneKnoepfe();
  if (ztOffen && !ztErlaubt()) ztSchliesse();
  if (zfOffen && !ztErlaubt()) zfAusblenden();
  // Die Uhr an den Karten kommt oder geht mit dem Schalter.
  render();
};

// Fuer app.js (Uhr an der Karte, seit 19.11.2026).
window.zeitErlaubt = () => ztBereit && ztErlaubt();
window.zeitLaeuftAuf = id => !!ztLaeuft && ztLaeuft.todoId === id;
window.zeitStarteAuf = id => ztStarteAuf(id);

/* ====================================================================
   Fokus-Bildschirm (seit 19.11.2026)
   Hendrik: "wenn ich in einem ToDo drin bin mit der Zeit, soll ein Focus
   Screen kommen, wo ich nur die Zeit und das aktuelle ToDo sehe und im Notfall
   den ausmachen kann, wenn ich noch was gucken muss." Seine Wahl aus zwei
   Skizzen: mit Notiz, abhakbaren Unterpunkten und "Erledigt".
   - Geht auf bei jedem Start (Uhr an der Karte, "Starten" im Fenster, Ziehen)
     und beim Tipp auf die laufende Uhr in Kopf bzw. Leiste.
   - "Ausblenden" (auch Escape, Zurueck-Taste) laesst die Uhr laufen.
   - War er offen, als die Seite ging, ist er nach dem Neuladen wieder da
     (gemerkt pro Geraet) - ausgeblendet bleibt ausgeblendet.
   - "Zeiterfassung" oben rechts oeffnet das Fenster darueber: dort ordnet man
     einer Uhr ohne ToDo eins zu, traegt nach, sieht die Statistik.
   - Erledigt hakt das ToDo ab, das stoppt die Uhr (wie bisher beim Abhaken).
   ==================================================================== */
const zfEl = document.getElementById("zeitFokus");
const zfOrtEl = document.getElementById("zfOrt");
const zfTitelEl = document.getElementById("zfTitel");
const zfUhrEl = document.getElementById("zfUhr");
const zfGruppeEl = document.getElementById("zfGruppe");
const zfNotizEl = document.getElementById("zfNotiz");
const zfUpEl = document.getElementById("zfUnterpunkte");
const zfErledigtEl = document.getElementById("zfErledigt");
const ZF_KEY = "zeitFokusOffen";

function zfGemerkt() {
  try { return localStorage.getItem(ZF_KEY) === "1"; } catch (e) { return false; }
}
function zfMerke(offen) {
  try { localStorage.setItem(ZF_KEY, offen ? "1" : "0"); } catch (e) { /* dann eben nicht */ }
}

function zfZeige() {
  if (!ztLaeuft || !ztErlaubt()) return;
  zfOffen = true;
  zfEl.hidden = false;
  zfMerke(true);
  zfZeichne();
}

function zfAusblenden() {
  if (!zfOffen) return;
  zfOffen = false;
  zfEl.hidden = true;
  zfMerke(false);
}

function zfZeichne() {
  if (!zfOffen) return;
  // Gestoppt (hier, an einem anderen Geraet, durch Abhaken oder den Deckel):
  // der Bildschirm geht von selbst.
  if (!ztLaeuft) { zfAusblenden(); return; }
  const fund = ztLaeuft.todoId ? ztFindeTodo(ztLaeuft.todoId) : null;
  zfTitelEl.textContent = ztNameVon(ztLaeuft);
  zfTitelEl.classList.toggle("ohne", !ztLaeuft.todoId);
  const ort = ztOrtVon(ztLaeuft);
  zfOrtEl.textContent = ort || (ztLaeuft.todoId ? "" : "Über „Zeiterfassung“ lässt sich ein ToDo zuordnen");
  zfOrtEl.style.setProperty("--zt-farbe", ztFarbwert(fund?.farbe));
  zfOrtEl.classList.toggle("mit-farbe", !!fund?.farbe);
  zfUhrEl.textContent = ztUhrText(ztVerstrichen());

  const notiz = notizKompakt(fund?.todo.note);
  zfNotizEl.textContent = notiz;
  zfNotizEl.hidden = !notiz;
  const punkte = fund ? (daten[fund.boardId]?.unterpunkte || []).filter(u => u.todoId === fund.todo.id) : [];
  zfUpEl.replaceChildren(...punkte.map(u => {
    const zeile = document.createElement("label");
    zeile.className = "zf-up" + (u.done ? " is-done" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "check";
    cb.checked = u.done;
    cb.addEventListener("change", () => toggleUnterpunkt(u.id, fund.boardId));
    const text = document.createElement("span");
    text.textContent = u.text;
    zeile.append(cb, text);
    return zeile;
  }));
  zfUpEl.hidden = !punkte.length;
  zfGruppeEl.hidden = !notiz && !punkte.length;
  zfErledigtEl.hidden = !fund || fund.todo.done;
}

document.getElementById("zfAusblenden").addEventListener("click", zfAusblenden);
document.getElementById("zfMehr").addEventListener("click", ztOeffne);
document.getElementById("zfStopp").addEventListener("click", () => ztStoppe(false));
zfErledigtEl.addEventListener("click", () => {
  const fund = ztLaeuft?.todoId ? ztFindeTodo(ztLaeuft.todoId) : null;
  if (!fund || fund.todo.done) return;
  // toggleDone ruft zeitBeiAbhaken - das stoppt die Uhr und meldet die Zeit.
  toggleDone(fund.todo.id, fund.boardId);
});
