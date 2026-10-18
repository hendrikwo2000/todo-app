"use strict";

/* ====================================================================
   Gewohnheiten – der gemeinsame Datenteil

   Seit Oktober 2026 wohnen Gewohnheiten und Timer ganz in der ToDo-App, die
   eigene Fokus-App (fokus.it-wolf.org) faellt weg. Zwei Stellen zeigen
   Gewohnheiten:
   - der Streifen (fokus.js): nur heute, als fertig gerechnete Liste vom
     Server (GET /api/gewohnheiten/heute),
   - das Fenster "Gewohnheiten" (gewohnheiten.js): Verlauf, Statistik,
     Verwalten. Das braucht den ganzen Bestand (GET /api/gewohnheiten).

   Hier steht, was beide brauchen:
   - gewApi(): eine Anfrage, die nie wirft,
   - der Bestand fuer das Fenster,
   - die Spiegel der Server-Regeln (Status, Obergrenze, geplant, stille
     Tage). Gegenstueck in functions/_lib/tag.js und heute.js - aendert sich
     eine Regel dort, muss sie hier mit,
   - die Offline-Warteschlange fuer Tage,
   - gewSchreibeTag(), der einzige Schreibweg fuer einen Tag.

   Alle Namen auf oberster Ebene beginnen mit "gew": die Skripte teilen sich
   ohne Modulsystem einen globalen Namensraum mit app.js, kalender.js und
   fokus.js. Ein doppelter Name waere ein SyntaxError, der die ganze App
   stillegt.
   ==================================================================== */

const GEW_WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Spiegel von MAX_MENGE in functions/_lib/tag.js. Hier nur, damit die Felder
// gar nicht erst mehr annehmen - verbindlich prueft der Server.
const GEW_MAX_MENGE = 99999;

/* ---------------------------------------------------------------- Datum */

// Kalendertage verschieben. Rechnung in UTC, damit die Sommerzeit-Umstellung
// keinen Tag verschluckt oder doppelt.
function gewTagPlus(datum, n) {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t) + n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// 0 = Mo .. 6 = So. Bit (1 << i) ist die Stelle in gewohnheit.wochentageMaske.
function gewWochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

function gewMontagVon(datum) {
  return gewTagPlus(datum, -gewWochentagIndex(datum));
}

function gewWochentagVon(datum) {
  return GEW_WOCHENTAGE[gewWochentagIndex(datum)];
}

function gewFormatDatum(iso) {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}

// Monat um n verschieben, als "YYYY-MM". Monate sind unterschiedlich lang,
// eine Tages-Verschiebung wuerde das nicht sauber treffen.
function gewMonatPlus(jahrMonat, n) {
  const [j, m] = jahrMonat.split("-").map(Number);
  const gesamt = j * 12 + (m - 1) + n;
  return `${Math.floor(gesamt / 12)}-${String((gesamt % 12) + 1).padStart(2, "0")}`;
}

// 42 Tage (6 Wochen) ab dem Montag vor/am Monatsersten. Feste Zellenzahl haelt
// die Hoehe beim Blaettern konstant.
function gewMonatsRaster(jahrMonat) {
  const start = gewMontagVon(`${jahrMonat}-01`);
  const tage = [];
  for (let i = 0; i < 42; i++) tage.push(gewTagPlus(start, i));
  return tage;
}

/**
 * Zahl mit passender Einheit. "🔥 2 Tage" steht fuer sich (Nominativ),
 * "5 von 14 Tagen" hinter "von" (Dativ). Der Schluessel ist die Mehrzahl,
 * weil statistik.js und flammenEinheit() sie so schicken.
 */
const GEW_EINHEIT_FORMEN = {
  Tage: { eins: "Tag", viele: "Tage", vieleDativ: "Tagen" },
  Wochen: { eins: "Woche", viele: "Wochen", vieleDativ: "Wochen" },
};
function gewMitEinheit(zahl, schluessel, dativ = false) {
  const form = GEW_EINHEIT_FORMEN[schluessel];
  if (!form) return `${zahl} ${schluessel || "Mal"}`;
  return `${zahl} ${zahl === 1 ? form.eins : (dativ ? form.vieleDativ : form.viele)}`;
}

/* ----------------------------------------------------------------- Netz */

/**
 * Eine API-Anfrage. Gibt { ok, status, daten } zurueck und wirft nie - jeder
 * Aufrufer entscheidet selbst, was ein Fehlschlag bedeutet. status 0 heisst:
 * keine Verbindung.
 */
async function gewApi(pfad, optionen = {}) {
  try {
    const antwort = await fetch(pfad, {
      credentials: "same-origin",
      cache: "no-store",
      headers: optionen.body ? { "Content-Type": "application/json" } : undefined,
      ...optionen,
    });
    let daten = {};
    try { daten = await antwort.json(); } catch (e) { /* leere Antwort */ }
    return { ok: antwort.ok, status: antwort.status, daten };
  } catch (e) {
    return { ok: false, status: 0, daten: { error: "Keine Verbindung." } };
  }
}

/* --------------------------------------------------------------- Bestand */

// Was das Fenster zeichnet. Der Streifen braucht ihn nicht - er bekommt seine
// Heute-Liste fertig gerechnet.
const gewBestand = {
  geladen: false,
  gewohnheiten: [],
  logs: {},        // { gewohnheitId: { "2026-08-07": { menge, ziel, status } } }
  straehnen: {},
  flammenModus: "absolut",
  historieAb: "",
  heute: "",
};

// Der zuletzt geladene Bestand im localStorage: ohne ihn stuende das Fenster
// ohne Netz leer da, und ohne Liste laesst sich nichts nachtragen.
//
// Alle drei Schluessel je Konto (konto.js): mit zwei Konten in zwei Tabs
// lieferte sonst der eine Tab die offline gemerkten Haken des anderen nach.
const GEW_STAND_SCHLUESSEL = kontoSchluessel("gew_stand");
// Die Heute-Liste des Streifens, aus demselben Grund (App unterwegs neu
// oeffnen ist der haeufigste Offline-Moment).
const GEW_HEUTE_SCHLUESSEL = kontoSchluessel("gew_heute");

function gewMerke(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); }
  catch (e) { /* zu gross oder gesperrt: dann eben ohne */ }
}

function gewLies(schluessel) {
  try { return JSON.parse(localStorage.getItem(schluessel)); }
  catch (e) { return null; }
}

function gewUebernimmBestand(d) {
  if (!d || !Array.isArray(d.gewohnheiten)) return false;
  gewBestand.gewohnheiten = d.gewohnheiten;
  gewBestand.logs = d.logs || {};
  gewBestand.straehnen = d.straehnen || {};
  gewBestand.flammenModus = d.flammenModus || "absolut";
  gewBestand.historieAb = d.historieAb || "";
  gewBestand.heute = d.heute || todayStr();
  gewBestand.geladen = true;
  return true;
}

/**
 * Den ganzen Bestand holen. Ohne Netz (status 0) faellt er auf den zuletzt
 * gemerkten zurueck - nur dann: ein 500er ist eine Antwort des Servers, da
 * waere ein stillschweigend alter Bestand irrefuehrend.
 */
async function gewLadeBestand() {
  const antwort = await gewApi(`/api/gewohnheiten?heute=${todayStr()}`);
  if (antwort.ok) {
    gewUebernimmBestand(antwort.daten);
    gewMerke(GEW_STAND_SCHLUESSEL, antwort.daten);
    gewLegeWarteschlangeUeber();
    return { ok: true };
  }
  if (antwort.status === 0 && gewUebernimmBestand(gewLies(GEW_STAND_SCHLUESSEL))) {
    gewLegeWarteschlangeUeber();
    return { ok: true, offline: true };
  }
  return { ok: false, status: antwort.status, fehler: antwort.daten.error || "Laden fehlgeschlagen." };
}

/* ---------------------------------------------------- Regeln (Spiegel) */

/**
 * Eine Obergrenze statt eines Solls. Versteht beide Formen: die Gewohnheit
 * aus dem Bestand (typ + richtung) und die Karte der Heute-Liste, die das
 * schon fertig als `obergrenze` mitbringt.
 */
function gewIstObergrenze(g) {
  if (typeof g.obergrenze === "boolean") return g.obergrenze;
  return g.typ === "menge" && g.richtung === "hoechstens";
}

// Status eines Tages - Spiegel von status() in functions/_lib/tag.js. Sonst
// kommt er immer vom Server; offline gibt es niemanden, der ihn liefert.
function gewStatusVon(g, menge, ziel) {
  const m = Number(menge) || 0;
  if (g.typ === "binaer") return m >= 1 ? "erledigt" : "offen";
  const z = Number(ziel) || 0;
  if (gewIstObergrenze(g)) return m > z ? "ueberschritten" : "erledigt";
  if (z > 0 && m >= z) return "erledigt";
  return m > 0 ? "teilweise" : "offen";
}

function gewTagVon(gewohnheitId, datum) {
  return (gewBestand.logs[gewohnheitId] || {})[datum] || null;
}

// Gehoert ein Datum zum Rhythmus? Bei 'taeglich' und 'x_pro_woche' ist jeder
// Tag geplant - der Unterschied zeigt sich erst im Wochenziel.
function gewIstGeplant(g, datum) {
  if (g.rhythmus !== "wochentage") return true;
  return (g.wochentageMaske & (1 << gewWochentagIndex(datum))) !== 0;
}

/**
 * Zaehlt ein Tag OHNE Eintrag als erledigt? Nur bei einer Obergrenze, nur in
 * der Vergangenheit, nur ab dem Anlegen - Spiegel von stillerTagZaehlt() in
 * functions/_lib/tag.js.
 */
function gewStillerTagZaehlt(g, datum) {
  if (!gewIstObergrenze(g)) return false;
  if (datum >= gewBestand.heute) return false;
  return !g.angelegtAm || datum >= g.angelegtAm;
}

// Status fuer die Anzeige: der Eintrag, wenn es einen gibt, sonst "erledigt"
// bei einer stillen Obergrenze und ansonsten "offen".
function gewZustandVon(g, datum) {
  const tag = gewTagVon(g.id, datum);
  if (tag) return tag.status;
  return gewStillerTagZaehlt(g, datum) ? "erledigt" : "offen";
}

// Einheit hinter der Flammen-Zahl - Spiegel von flammenEinheit() in
// functions/_lib/tag.js. Nur "X Mal die Woche" zaehlt im Reihen-Modus WOCHEN.
function gewFlammenEinheitVon(g) {
  return (gewBestand.flammenModus === "reihe" && g.rhythmus === "x_pro_woche") ? "Wochen" : "Tage";
}

/* ------------------------------------------------- Offline-Warteschlange */

/**
 * Ohne Verbindung gehen Abhaken und Mengen nicht verloren: sie landen in einer
 * Warteschlange im localStorage und werden nachgeliefert, sobald wieder Netz
 * da ist. Die Karte springt sofort um, als waere es durchgegangen.
 *
 * Bewusst NUR fuer Tage - der einzige Schreibweg, der unterwegs passiert.
 * Gewohnheiten anlegen/aendern und der Timer brauchen Netz. Beim Timer ist das
 * Absicht: er rechnet serverseitig aus dem Startzeitpunkt, eine Stunde spaeter
 * nachgereicht waere die Sitzung schlicht gelogen.
 *
 * Die Flamme rechnet die Warteschlange nicht mit - sie haengt an der ganzen
 * Historie. Sie bleibt stehen und stimmt nach dem Nachliefern wieder.
 */
const GEW_WARTE_SCHLUESSEL = kontoSchluessel("gew_warteschlange");

let gewWarteschlange = gewLies(GEW_WARTE_SCHLUESSEL) || [];

function gewSpeichereWarteschlange() {
  try {
    if (gewWarteschlange.length) localStorage.setItem(GEW_WARTE_SCHLUESSEL, JSON.stringify(gewWarteschlange));
    else localStorage.removeItem(GEW_WARTE_SCHLUESSEL);
  } catch (e) { /* voller Speicher: lieber nichts merken als abstuerzen */ }
}

// Ein Tag, ein Eintrag: zehnmal "+" hinterlaesst nicht zehn Anfragen, sondern
// den letzten Stand. Der Server kennt ohnehin nur "setzen".
function gewMerkeOffline(gewohnheitId, datum, menge, loeschen) {
  gewWarteschlange = gewWarteschlange.filter(e => !(e.gewohnheitId === gewohnheitId && e.datum === datum));
  gewWarteschlange.push({ gewohnheitId, datum, menge, loeschen });
  gewSpeichereWarteschlange();
}

function gewWartetNoch(gewohnheitId, datum) {
  return gewWarteschlange.some(e => e.gewohnheitId === gewohnheitId && e.datum === datum);
}

function gewWartetHeute(gewohnheitId) {
  return gewWarteschlange.find(e => e.gewohnheitId === gewohnheitId && e.datum === todayStr()) || null;
}

// Einen Tag im geladenen Bestand setzen, ohne Server - dieselbe Rechnung, die
// log.js sonst macht: vorhandene Tage behalten ihr damaliges Ziel, "offen"
// heisst kein Eintrag.
function gewSetzeTagOertlich(g, datum, menge, loeschen) {
  const eimer = gewBestand.logs[g.id] || (gewBestand.logs[g.id] = {});
  const alt = eimer[datum];
  const ziel = alt ? alt.ziel : g.zielmenge;
  const wert = g.typ === "binaer" ? (menge >= 1 ? 1 : 0) : menge;
  const zustand = loeschen ? "offen" : gewStatusVon(g, wert, ziel);
  if (zustand === "offen") delete eimer[datum];
  else eimer[datum] = { menge: wert, ziel, status: zustand };
}

// Nach jedem Laden: was noch in der Warteschlange steht, ist neuer als der
// Serverstand und gehoert wieder obendrauf.
function gewLegeWarteschlangeUeber() {
  for (const e of gewWarteschlange) {
    const g = gewBestand.gewohnheiten.find(x => x.id === e.gewohnheitId);
    if (g) gewSetzeTagOertlich(g, e.datum, e.menge, e.loeschen);
  }
}

let gewLiefertNach = false;

/**
 * Die Warteschlange abarbeiten - beim Start, beim Zurueckkehren in die App und
 * sobald der Browser wieder online meldet.
 */
async function gewLiefereNach() {
  if (gewLiefertNach || !gewWarteschlange.length) return;
  gewLiefertNach = true;

  const rest = [];
  let erfolg = 0;
  for (const e of gewWarteschlange) {
    const antwort = await gewApi("/api/gewohnheiten/log", {
      method: "PUT",
      body: JSON.stringify({
        gewohnheitId: e.gewohnheitId, datum: e.datum, menge: e.menge, loeschen: e.loeschen,
        // "heute" IMMER frisch: der Server laesst nur einen Tag Abstand zu
        // seiner eigenen Zeit zu (pruefeHeute in _lib/tag.js).
        heute: todayStr(),
      }),
    });
    // Weiter kein Netz (0) oder abgemeldet (401): aufheben, das erledigt sich
    // von selbst. Alles andere ist eine echte Absage - die bliebe beim
    // naechsten Versuch dieselbe, also weg damit statt endlos zu klopfen.
    if (antwort.status === 0 || antwort.status === 401) rest.push(e);
    else if (antwort.ok) erfolg++;
  }

  const verworfen = gewWarteschlange.length - rest.length - erfolg;
  gewWarteschlange = rest;
  gewSpeichereWarteschlange();
  gewLiefertNach = false;

  if (erfolg || verworfen) gewMeldeAenderung("nachgeliefert");
  if (verworfen) {
    snackInfo(verworfen === 1
      ? "1 Eintrag ließ sich nicht nachtragen"
      : `${verworfen} Einträge ließen sich nicht nachtragen`);
  } else if (erfolg) {
    snackInfo(erfolg === 1 ? "1 Eintrag nachgetragen" : `${erfolg} Einträge nachgetragen`);
  }
}

window.addEventListener("online", gewLiefereNach);

/* ------------------------------------------------------------ Aenderungen */

/**
 * Wer etwas aendert, meldet es hier; Streifen und Fenster hoeren zu und
 * zeichnen sich neu. So muss keiner den anderen kennen.
 * `was`: "tag" (ein Tag gesetzt), "bestand" (Gewohnheit angelegt, geaendert,
 * archiviert, geloescht, sortiert), "einstellungen", "nachgeliefert".
 */
const gewHoerer = [];
function gewBeiAenderung(fn) { gewHoerer.push(fn); }
function gewMeldeAenderung(was) {
  for (const fn of gewHoerer) {
    try { fn(was); } catch (e) { console.error(e); }
  }
}

/* -------------------------------------------------------------- Schreiben */

/**
 * Einen Tag speichern - der einzige Schreibweg fuer Gewohnheiten, aus dem
 * Streifen (heute) wie aus dem Verlauf (Nachtragen).
 *
 * `g` braucht id und typ, dazu entweder richtung (Bestand) oder obergrenze
 * (Karte der Heute-Liste) und das Ziel (zielmenge bzw. ziel) fuer den
 * Offline-Status. `loeschen` stellt einen Tag ausdruecklich auf "offen" -
 * noetig nur bei einer Obergrenze, wo die 0 selbst schon erledigt ist.
 *
 * Antwort: { ok, offline, status, menge, ziel, straehne }.
 */
async function gewSchreibeTag(g, datum, menge, loeschen = false) {
  const antwort = await gewApi("/api/gewohnheiten/log", {
    method: "PUT",
    body: JSON.stringify({ gewohnheitId: g.id, datum, heute: todayStr(), menge, loeschen }),
  });

  // Kein Netz: merken und trotzdem umspringen lassen. Nur bei Status 0 - ein
  // 400/403/500 ist eine Absage, die beim naechsten Versuch genauso ausfiele.
  if (antwort.status === 0) {
    gewMerkeOffline(g.id, datum, menge, loeschen);
    const ausBestand = gewBestand.gewohnheiten.find(x => x.id === g.id);
    if (gewBestand.geladen && ausBestand) gewSetzeTagOertlich(ausBestand, datum, menge, loeschen);
    const wert = g.typ === "binaer" ? (menge >= 1 ? 1 : 0) : menge;
    const tag = gewTagVon(g.id, datum);
    const ziel = tag ? tag.ziel : (g.ziel ?? g.zielmenge);
    const status = loeschen ? "offen" : gewStatusVon(g, wert, ziel);
    snackInfo("Ohne Verbindung gemerkt – wird nachgetragen");
    gewMeldeAenderung("tag");
    return { ok: true, offline: true, status, menge: wert, ziel, straehne: null };
  }
  if (!antwort.ok) {
    snackInfo(antwort.daten.error || "Konnte nicht gespeichert werden.");
    return { ok: false };
  }

  const d = antwort.daten;
  if (gewBestand.geladen) {
    const eimer = gewBestand.logs[g.id] || (gewBestand.logs[g.id] = {});
    // Nicht an der Menge festmachen: bei einer Obergrenze ist die gespeicherte
    // 0 ein gruener Tag. "Offen" gibt es nur ohne Eintrag.
    if (d.status === "offen") delete eimer[datum];
    else eimer[datum] = { menge: d.menge, ziel: d.ziel, status: d.status };
    gewBestand.straehnen[g.id] = d.straehne;
  }
  gewMeldeAenderung("tag");
  return { ok: true, offline: false, status: d.status, menge: d.menge, ziel: d.ziel, straehne: d.straehne };
}

/* --------------------------------------------------------------- Abmelden */

// Beim Abmelden weg: sonst blitzte der Bestand des vorherigen Kontos auf, wenn
// sich danach jemand anderes an demselben Geraet anmeldet.
window.gewVergiss = function () {
  try {
    localStorage.removeItem(GEW_STAND_SCHLUESSEL);
    localStorage.removeItem(GEW_HEUTE_SCHLUESSEL);
    localStorage.removeItem(GEW_WARTE_SCHLUESSEL);
  } catch (e) { /* egal */ }
  gewWarteschlange = [];
  gewBestand.geladen = false;
};
