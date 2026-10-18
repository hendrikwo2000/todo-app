"use strict";

/* ====================================================================
   Zeiterfassung – eine Stoppuhr, die auf ToDos bucht (seit 18.10.2026)

   Vorher war der Timer ein 25-Minuten-Countdown ohne Bezug ("Fokusminuten pro
   Woche"). Hendriks Auftrag: "Zeit auf ein ToDo buchen, das heisst, ich druecke
   oben die Stoppuhr und kann ein ToDo auswaehlen, woran ich arbeite." Seine
   Entscheidungen dazu (gefragt, nicht angenommen):
   - Die Uhr zaehlt HOCH, ohne Pause-Taste: Stopp beendet den Eintrag,
     Weitermachen ist ein neuer. Jeder Eintrag hat so echte Von-bis-Zeiten.
   - Ein ToDo ist optional ("Ohne ToDo starten").
   - Einstieg NUR ueber ⏱ oben, und ALLES steht im Fenster dahinter: Auswahl
     bzw. laufende Uhr, darunter das heute Gebuchte, Nachtragen, Statistik.
     An den ToDo-Karten steht bewusst keine Zeit ("sonst wird das ueberladen").
   - Eintraege lassen sich bearbeiten, loeschen und nachtragen.
   - Laeuft die Uhr ueber 4 Stunden, haelt der Server sie dort an (gekappt),
     und das Fenster zeigt einen Hinweis zum Korrigieren.
   - Abhaken stoppt die Uhr, wenn sie auf genau diesem ToDo laeuft.
   - Statistik gruppiert nach Liste › Bereich › ToDo; Serien-ToDos (jede
     Ausgabe ist eine eigene Zeile in todos) zaehlen zusammen - gleicher Name
     im selben Bereich ist eine Zeile. Dazu ein CSV-Export als Nachweis.

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
const ztUhrEl         = document.getElementById("ztUhr");
const ztUhrTodoEl     = document.getElementById("ztUhrTodo");
const ztUhrZeitEl     = document.getElementById("ztUhrZeit");
const ztWahlEl        = document.getElementById("ztWahl");
const ztWahlTitelEl   = document.getElementById("ztWahlTitel");
const ztWahlAbbrEl    = document.getElementById("ztWahlAbbrechen");
const ztSucheEl       = document.getElementById("ztSuche");
const ztWahlListeEl   = document.getElementById("ztWahlListe");
const ztOhneTodoEl    = document.getElementById("ztOhneTodo");
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
const ztDialogTodoEl  = document.getElementById("ztDialogTodo");
const ztDialogWahlEl  = document.getElementById("ztDialogWahl");
const ztDialogSuche   = document.getElementById("ztDialogSuche");
const ztDialogListe   = document.getElementById("ztDialogListe");
const ztDatumEl       = document.getElementById("ztDatum");
const ztVonEl         = document.getElementById("ztVon");
const ztBisEl         = document.getElementById("ztBis");
const ztDialogDauer   = document.getElementById("ztDialogDauer");
const ztDialogMsg     = document.getElementById("ztDialogMsg");
const ztDialogLoeschen = document.getElementById("ztDialogLoeschen");

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
let ztZuletzt = [];       // zuletzt bebuchte ToDo-ids, neueste zuerst
let ztWechselt = false;   // Auswahl bei laufender Uhr offen ("Wechseln")

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

// Die Suche nur mit Maus gleich in den Fokus: am Handy klappte sonst die
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

// ---------- ToDos aus app.js ----------
// Die App haelt alle Listen im Speicher (`listen`, `daten`). Daraus kommen die
// aktuellen Namen - gespeichert sind nur die zum Zeitpunkt der Buchung.

function ztFundAus(t, boardId, bereiche) {
  const meta = listen.find(b => b.id === boardId);
  const cat = bereiche[t.categoryId];
  const mitBereich = !!cat && !istOhneBereich(cat.id);
  return {
    todo: t,
    boardId,
    listeName: meta ? meta.name : "",
    bereichId: mitBereich ? cat.id : null,
    bereichName: mitBereich ? cat.name : "",
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
    if (t) return ztFundAus(t, boardId, ztBereicheVon(d));
  }
  return null;
}

// Alle offenen ToDos aus allen Listen - ohne die noch unsichtbare naechste
// Ausgabe einer Serie (nochNichtFaellig), die man auf dem Board auch nicht sieht.
function ztOffeneTodos() {
  const funde = [];
  for (const b of listen) {
    const d = daten[b.id] || {};
    const bereiche = ztBereicheVon(d);
    for (const t of (d.todos || [])) {
      if (t.done || nochNichtFaellig(t)) continue;
      funde.push(ztFundAus(t, b.id, bereiche));
    }
  }
  return funde;
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

function ztOrtVon(e) {
  if (!e.todoId) return "";
  const f = ztFindeTodo(e.todoId);
  const liste = f ? f.listeName : e.listeName;
  const bereich = f ? f.bereichName : e.bereichName;
  return [liste, bereich].filter(Boolean).join(" · ");
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
    ztHeute = antwort.daten.heute || [];
    ztGekappt = antwort.daten.gekappt || [];
    ztZuletzt = antwort.daten.zuletzt || [];
    if (!ztLaeuft) ztWechselt = false;
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
    k.title = ztLaeuft ? `Uhr läuft: ${ztNameVon(ztLaeuft)}` : "Zeiterfassung";
  }
}

// ---------- Zeichnen: Auswahl ----------
function ztWahlKnopf(fund, beiWahl) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "zt-wahl-eintrag";
  const text = document.createElement("span");
  text.className = "zt-wahl-text";
  text.textContent = fund ? fund.todo.text : "Ohne ToDo";
  k.appendChild(text);
  if (fund) {
    const ort = document.createElement("span");
    ort.className = "zt-wahl-ort";
    ort.textContent = [fund.listeName, fund.bereichName].filter(Boolean).join(" · ");
    k.appendChild(ort);
    if (fund.todo.due && fund.todo.due < todayStr()) k.classList.add("ueberfaellig");
  }
  k.onclick = () => beiWahl(fund);
  return k;
}

function ztWahlTitel(text) {
  const t = document.createElement("div");
  t.className = "zt-wahl-abschnitt";
  t.textContent = text;
  return t;
}

function ztWahlHinweis(text) {
  const p = document.createElement("p");
  p.className = "zt-wahl-hinweis";
  p.textContent = text;
  return p;
}

/**
 * Die Auswahl in `ziel` zeichnen - im Fenster und im Dialog dieselbe.
 * Ohne Suchtext: "Heute fällig" (inkl. ueberfaellig) und "Zuletzt"; mit
 * Suchtext die Treffer aus allen offenen ToDos. `beiWahl(fund)` bekommt das
 * gewaehlte ToDo, null heisst "ohne". `ausser` laesst ein ToDo weg (das, auf
 * dem die Uhr gerade laeuft), `mitOhne` haengt "Ohne ToDo" als Eintrag an.
 */
function ztZeichneWahl(ziel, suche, beiWahl, { ausser = null, mitOhne = false } = {}) {
  ziel.replaceChildren();
  const offen = ztOffeneTodos().filter(f => f.todo.id !== ausser);
  const q = suche.trim().toLocaleLowerCase("de");

  if (q) {
    const treffer = offen
      .map(f => ({ f, stelle: f.todo.text.toLocaleLowerCase("de").indexOf(q) }))
      .filter(x => x.stelle >= 0)
      // Wo das Wort vorn steht, ist es eher gemeint.
      .sort((a, b) => (a.stelle === 0) === (b.stelle === 0)
        ? a.f.todo.text.localeCompare(b.f.todo.text, "de")
        : (a.stelle === 0 ? -1 : 1))
      .slice(0, 8);
    if (!treffer.length) ziel.appendChild(ztWahlHinweis("Kein offenes ToDo gefunden."));
    for (const x of treffer) ziel.appendChild(ztWahlKnopf(x.f, beiWahl));
  } else {
    const heute = todayStr();
    const faellig = offen
      .filter(f => f.todo.due && f.todo.due <= heute)
      .sort((a, b) => a.todo.due === b.todo.due
        ? a.todo.text.localeCompare(b.todo.text, "de")
        : (a.todo.due < b.todo.due ? -1 : 1));
    const schon = new Set(faellig.map(f => f.todo.id));
    const zuletzt = ztZuletzt
      .map(id => offen.find(f => f.todo.id === id))
      .filter(f => f && !schon.has(f.todo.id))
      .slice(0, 3);

    if (faellig.length) {
      ziel.appendChild(ztWahlTitel("Heute fällig"));
      for (const f of faellig.slice(0, 6)) ziel.appendChild(ztWahlKnopf(f, beiWahl));
      if (faellig.length > 6) ziel.appendChild(ztWahlHinweis(`… und ${faellig.length - 6} weitere – über die Suche`));
    }
    if (zuletzt.length) {
      ziel.appendChild(ztWahlTitel("Zuletzt"));
      for (const f of zuletzt) ziel.appendChild(ztWahlKnopf(f, beiWahl));
    }
    if (!faellig.length && !zuletzt.length) {
      ziel.appendChild(ztWahlHinweis(offen.length
        ? "Heute ist nichts fällig. Such dir ein ToDo oder starte ohne."
        : "Keine offenen ToDos."));
    }
  }
  if (mitOhne) {
    ziel.appendChild(ztWahlTitel("Oder"));
    ziel.appendChild(ztWahlKnopf(null, beiWahl));
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

function ztZeichneUhr() {
  ztUhrEl.hidden = !ztLaeuft;
  if (!ztLaeuft) return;
  ztUhrTodoEl.replaceChildren();
  const name = document.createElement("span");
  name.className = "zt-uhr-name" + (ztLaeuft.todoId ? "" : " ohne");
  name.textContent = ztNameVon(ztLaeuft);
  ztUhrTodoEl.appendChild(name);
  const ort = ztOrtVon(ztLaeuft);
  if (ort) {
    const o = document.createElement("span");
    o.className = "zt-uhr-ort";
    o.textContent = ort;
    ztUhrTodoEl.appendChild(o);
  }
  ztUhrZeitEl.textContent = ztUhrText(ztVerstrichen());
  document.getElementById("ztWechseln").setAttribute("aria-expanded", String(ztWechselt));
}

function ztZeichneAuswahl() {
  const zeigen = !ztLaeuft || ztWechselt;
  ztWahlEl.hidden = !zeigen;
  if (!zeigen) return;
  ztWahlTitelEl.textContent = ztLaeuft ? "Wechseln zu …" : "Woran arbeitest du?";
  ztWahlAbbrEl.hidden = !ztLaeuft;
  // Laeuft die Uhr schon ohne ToDo, ist "ohne" kein Wechsel.
  ztOhneTodoEl.hidden = !!ztLaeuft && !ztLaeuft.todoId;
  ztOhneTodoEl.textContent = ztLaeuft ? "Ohne ToDo weiter" : "Ohne ToDo starten";
  ztZeichneWahl(ztWahlListeEl, ztSucheEl.value, ztStarte, { ausser: ztLaeuft?.todoId || null });
}

function ztZeichneHeute() {
  const summe = ztHeute.reduce((s, e) => s + e.sek, 0);
  ztHeuteSummeEl.textContent = ztHeute.length ? ztDauer(summe) : "";
  ztHeuteListeEl.replaceChildren();
  if (!ztHeute.length) {
    ztHeuteListeEl.appendChild(ztWahlHinweis("Heute noch nichts gebucht."));
    return;
  }
  for (const e of ztHeute) ztHeuteListeEl.appendChild(ztEintragZeile(e, false));
}

function ztZeichne() {
  ztZeichneKnoepfe();
  if (!ztOffen) return;
  ztInhaltEl.hidden = !ztGeladen;
  ztHinweisEl.hidden = ztGeladen && !ztFehler;
  ztHinweisEl.textContent = ztFehler || "Lädt …";
  if (!ztGeladen) return;
  ztZeichneGekappt();
  ztZeichneUhr();
  ztZeichneAuswahl();
  ztZeichneHeute();
}

// ---------- Aktionen ----------
async function ztStarte(fund) {
  const antwort = await ztSchreibe("/start", { heute: todayStr(), ...ztBuchungAus(fund) });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Start fehlgeschlagen."); return; }
  const vorher = antwort.daten.beendet;
  ztUebernimmLaufend(antwort.daten.laeuft);
  ztWechselt = false;
  ztSucheEl.value = "";
  if (vorher) snackInfo(`${ztDauer(vorher.sek)} auf „${ztNameVon(vorher)}“ gebucht`);
  ztZeichne();
  await ztLade();
  ztNachAenderung();
}

/**
 * Die Uhr anhalten. `abgehakt`: das ToDo, auf dem sie lief, wurde gerade
 * erledigt (window.zeitBeiAbhaken) - dann sagt die Meldung, warum.
 */
async function ztStoppe(abgehakt) {
  const antwort = await ztSchreibe("/stop", {});
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Stoppen fehlgeschlagen."); return; }
  ztUebernimmLaufend(null);
  ztWechselt = false;
  const e = antwort.daten.beendet;
  if (e) {
    snackInfo(abgehakt
      ? `Uhr gestoppt – ${ztDauer(e.sek)} auf „${ztNameVon(e)}“ gebucht`
      : `${ztDauer(e.sek)} auf „${ztNameVon(e)}“ gebucht`);
  }
  ztZeichne();
  await ztLade();
  ztNachAenderung();
}

// Statistik nachziehen, wenn sie offen ist.
function ztNachAenderung() {
  if (ztFensterIstOffen()) ztLadeStatistik();
}

// ---------- Fenster oeffnen / schliessen ----------
function ztOeffne() {
  ztOffen = true;
  ztPopup.hidden = false;
  ztWechselt = false;
  ztSucheEl.value = "";
  ztZeichne();
  ztLade();
}

function ztSchliesse() {
  ztOffen = false;
  ztPopup.hidden = true;
}

for (const k of ztKnoepfe) k.addEventListener("click", ztOeffne);
document.getElementById("timerZu").addEventListener("click", ztSchliesse);
ztPopup.addEventListener("click", e => { if (e.target === ztPopup) ztSchliesse(); });
document.getElementById("ztStopp").addEventListener("click", () => ztStoppe(false));
document.getElementById("ztWechseln").addEventListener("click", () => {
  ztWechselt = !ztWechselt;
  ztSucheEl.value = "";
  ztZeichne();
  if (ztWechselt) ztFokussiere(ztSucheEl);
});
ztWahlAbbrEl.addEventListener("click", () => { ztWechselt = false; ztSucheEl.value = ""; ztZeichne(); });
ztOhneTodoEl.addEventListener("click", () => ztStarte(null));
ztSucheEl.addEventListener("input", ztZeichneAuswahl);
// Enter in der Suche nimmt den ersten Treffer - wer tippt, will nicht noch zielen.
ztSucheEl.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  ztWahlListeEl.querySelector(".zt-wahl-eintrag")?.click();
});
document.getElementById("ztNachtragen").addEventListener("click", () => ztOeffneDialog(null));
document.getElementById("ztStatistikOeffnen").addEventListener("click", () => ztOeffneStatistik());
document.getElementById("ztStatistikEinstellungen").addEventListener("click", () => {
  // Aus den Einstellungen heraus: die schliessen, wie beim Fenster Gewohnheiten.
  if (!einstellungenPopup.hidden) einstellungenPopup.hidden = true;
  ztOeffneStatistik();
});

/* ====================================================================
   Dialog: Eintrag nachtragen oder korrigieren
   ==================================================================== */

let ztDialogEintrag = null;   // der bearbeitete Eintrag, null = nachtragen
let ztDialogBuchung = {};     // { todoId, todoText, listeName, bereichName } oder {}

function ztZeichneDialogTodo() {
  const b = ztDialogBuchung;
  ztDialogTodoEl.replaceChildren();
  const name = document.createElement("span");
  name.className = "zt-todo-knopf-name" + (b.todoId ? "" : " ohne");
  name.textContent = b.todoId ? ztNameVon(b) : "Ohne ToDo";
  const pfeil = document.createElement("span");
  pfeil.className = "zt-todo-knopf-pfeil";
  pfeil.setAttribute("aria-hidden", "true");
  pfeil.textContent = ztDialogWahlEl.hidden ? "▾" : "▴";
  ztDialogTodoEl.append(name, pfeil);
  ztDialogTodoEl.setAttribute("aria-expanded", String(!ztDialogWahlEl.hidden));
}

function ztZeichneDialogWahl() {
  ztZeichneWahl(ztDialogListe, ztDialogSuche.value, fund => {
    ztDialogBuchung = ztBuchungAus(fund);
    ztDialogWahlEl.hidden = true;
    ztZeichneDialogTodo();
  }, { mitOhne: true });
}

// Aus Datum und Uhrzeiten die Strecke. Liegt "Bis" nicht nach "Von", geht sie
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

function ztZeichneDialogDauer() {
  const s = ztDialogStrecke();
  ztDialogDauer.textContent = s
    ? `= ${ztDauer((s.ende - s.start) / 1000)}` + (s.ueberNacht ? " (bis zum nächsten Tag)" : "")
    : "";
}

function ztOeffneDialog(e) {
  ztDialogEintrag = e;
  ztDialogTitel.textContent = e ? "Eintrag bearbeiten" : "Zeit nachtragen";
  ztDialogLoeschen.hidden = !e;
  ztDialogMsg.textContent = "";
  ztDialogWahlEl.hidden = true;
  ztDialogSuche.value = "";
  if (e) {
    // Die Buchung, wie sie ist - auch fuer ein inzwischen geloeschtes ToDo,
    // sonst ginge beim Korrigieren der Uhrzeit der Name verloren.
    ztDialogBuchung = e.todoId
      ? { todoId: e.todoId, todoText: e.todoText, listeName: e.listeName, bereichName: e.bereichName }
      : {};
    const f = e.todoId ? ztFindeTodo(e.todoId) : null;
    if (f) ztDialogBuchung = ztBuchungAus(f);
    const start = new Date(e.start), ende = new Date(e.ende);
    ztDatumEl.value = ztTag(start);
    ztVonEl.value = `${ztZwei(start.getHours())}:${ztZwei(start.getMinutes())}`;
    ztBisEl.value = `${ztZwei(ende.getHours())}:${ztZwei(ende.getMinutes())}`;
  } else {
    // Vorschlag: die letzte halbe Stunde bis jetzt, auf 5 Minuten abgerundet.
    ztDialogBuchung = {};
    const bis = new Date();
    bis.setMinutes(bis.getMinutes() - bis.getMinutes() % 5, 0, 0);
    const von = new Date(bis.getTime() - 30 * 60 * 1000);
    ztDatumEl.value = ztTag(von);
    ztVonEl.value = `${ztZwei(von.getHours())}:${ztZwei(von.getMinutes())}`;
    ztBisEl.value = `${ztZwei(bis.getHours())}:${ztZwei(bis.getMinutes())}`;
  }
  ztDatumEl.max = todayStr();
  ztZeichneDialogTodo();
  ztZeichneDialogDauer();
  ztDialog.hidden = false;
}

function ztSchliesseDialog() {
  ztDialog.hidden = true;
  ztDialogEintrag = null;
}

async function ztSpeichereDialog() {
  const s = ztDialogStrecke();
  if (!s) { ztDialogMsg.textContent = "Bitte Datum, Von und Bis ausfüllen."; return; }
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

ztDialogTodoEl.addEventListener("click", () => {
  ztDialogWahlEl.hidden = !ztDialogWahlEl.hidden;
  ztDialogSuche.value = "";
  ztZeichneDialogTodo();
  if (!ztDialogWahlEl.hidden) { ztZeichneDialogWahl(); ztFokussiere(ztDialogSuche); }
});
ztDialogSuche.addEventListener("input", ztZeichneDialogWahl);
ztDialogSuche.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  ztDialogListe.querySelector(".zt-wahl-eintrag")?.click();
});
for (const feld of [ztDatumEl, ztVonEl, ztBisEl]) feld.addEventListener("input", ztZeichneDialogDauer);
document.getElementById("ztDialogAbbrechen").addEventListener("click", ztSchliesseDialog);
document.getElementById("ztDialogSpeichern").addEventListener("click", ztSpeichereDialog);
ztDialogLoeschen.addEventListener("click", ztLoescheDialog);
ztDialog.addEventListener("click", e => { if (e.target === ztDialog) ztSchliesseDialog(); });

/* ====================================================================
   Fenster: Statistik
   ==================================================================== */

let ztZeitraum = "woche";      // "woche" | "monat" | "jahr"
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

function ztGrenzen() {
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
  const antwort = await ztApi(`/eintraege?von=${g.von}&bis=${g.bis}`);
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

// Balken: Woche = 7 Tage, Monat = jeder Tag, Jahr = 12 Monate.
function ztEimer(g) {
  const eimer = [];
  if (ztZeitraum === "jahr") {
    const namen = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    for (let m = 0; m < 12; m++) {
      const schluessel = `${g.von.slice(0, 4)}-${ztZwei(m + 1)}`;
      eimer.push({ schluessel, name: namen[m], sek: 0, jetzt: todayStr().startsWith(schluessel) });
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
    const ziel = nach.get(ztZeitraum === "jahr" ? e.datum.slice(0, 7) : e.datum);
    if (ziel) ziel.sek += e.sek;
  }
  return eimer;
}

// Wert ueber einem Balken: "1,5 h", ab zehn Stunden ohne Nachkomma.
function ztStunden(sek) {
  const h = sek / 3600;
  return (h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace(".", ",")) + " h";
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
    saeule.title = `${ztZeitraum === "jahr" ? e.schluessel : ztTagKurz(e.schluessel)}: ${ztDauer(e.sek)}`;
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
  // In die Zukunft gibt es nichts zu sehen.
  ztVorEl.disabled = g.bis >= todayStr();

  const leer = !ztStatEintraege.length;
  ztZeichneDiagramm(g);
  ztGesamtEl.textContent = ztDauer(ztStatEintraege.reduce((s, e) => s + e.sek, 0));
  ztExportEl.disabled = leer || !ztStatGeladen;
  ztZeichneBaum();
  ztZeichneEintraege();
  if (ztStatGeladen && leer) {
    ztEintraegeEl.appendChild(ztWahlHinweis("In diesem Zeitraum ist nichts gebucht."));
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
    ztZeitraum = k.dataset.zeitraum;
    // Der neue Zeitraum enthaelt den bisher gezeigten Tag - nicht zurueck auf heute.
    ztStatAlle = false;
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
    const d = ztAlsDatum(e.datum);
    const min = Math.round(e.sek / 60);
    zeilen.push([
      `${ztZwei(d.getDate())}.${ztZwei(d.getMonth() + 1)}.${d.getFullYear()}`,
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

// Von innen nach aussen: Dialog, Statistik, Fenster. Sagt, ob etwas zu war.
function ztSchliesseOberste() {
  if (!ztDialog.hidden) { ztSchliesseDialog(); return true; }
  if (ztFensterIstOffen()) { ztSchliesseStatistik(); return true; }
  if (ztOffen) { ztSchliesse(); return true; }
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
window.zeitFensterOffen = () => ztOffen || ztFensterIstOffen() || !ztDialog.hidden;

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
  if (ztOffen && !ztUhrEl.hidden) ztUhrZeitEl.textContent = ztUhrText(ztVerstrichen());
}, 1000);

// Zurueck in der App: an einem anderen Geraet kann die Uhr gestartet oder
// gestoppt worden sein, und der Knopf soll keine laengst beendete zeigen.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ztBereit) ztLade();
});

/**
 * Aus render() in app.js. Der erste Aufruf heisst: angemeldet, Daten da - ab
 * jetzt gibt es den Knopf, und der Stand wird gleich geholt, damit er eine
 * laufende Uhr von einem anderen Geraet zeigt. Spaetere Aufrufe zeichnen nur
 * das offene Fenster nach (ein ToDo kann umbenannt oder erledigt worden sein).
 */
window.zeitNeuZeichnen = function () {
  if (ztBereit) {
    if (ztOffen) ztZeichne();
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
};
