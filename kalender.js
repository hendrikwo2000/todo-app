"use strict";

/* ====================================================================
   Kalender – Panel am rechten Rand

   Zeigt alle offenen ToDos MIT Termin aus ALLEN geladenen Listen (eigene
   und geteilte) sowie - falls verknuepft - die Termine aus Google Kalender:
   Monatsraster oben, Tagesliste darunter. Rein lesend - ein Tipp auf ein
   ToDo schliesst das Panel und oeffnet es im gewohnten Bearbeiten-Modus auf
   dem Board, ein Tipp auf einen Google-Termin klappt dessen Details auf.
   Deshalb braucht der Kalender keine eigene Speicher-, Wiederholungs- oder
   Unterpunkt-Logik - und fuer Google gar keine Schreibrechte.

   Laeuft NACH app.js und liest dessen Zustand direkt (daten, listen,
   aktiveListe). Eigene Datei nur, damit app.js nicht weiter waechst; die
   einzige Beruehrung in der Gegenrichtung ist window.kalenderNeuZeichnen()
   aus render().

   Aufruf: Wisch vom RECHTEN Bildschirmrand nach links (rechts, weil der
   linke Rand auf iOS/Android fuer "Zurueck" belegt ist), am Rechner der
   Knopf in der Kopfzeile. Escape, Hintergrund-Klick, ✕ oder ein Wisch
   nach rechts schliessen wieder.
   ==================================================================== */

const kalPanel       = document.getElementById("kalenderPanel");
const kalHintergrund = document.getElementById("kalenderHintergrund");
const kalMonatName   = document.getElementById("kalMonatName");
const kalUeberfaellig = document.getElementById("kalUeberfaellig");
const kalWochentage  = document.getElementById("kalWochentage");
const kalRaster      = document.getElementById("kalRaster");
const kalTagesliste  = document.getElementById("kalTagesliste");
const kalFilter      = document.getElementById("kalFilter");
const kalLock        = document.getElementById("lock");

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONAT_FORMAT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const TAG_FORMAT   = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const UHR_FORMAT   = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// Schluessel der Sonder-Auswahl "Ueberfaellig" - steht anstelle eines
// ISO-Datums in kalAuswahl, weil Ueberfaelliges ueber viele Tage verstreut
// liegt und sonst in irgendeinem Vormonat verschwinden wuerde.
const UEBERFAELLIG = "ueberfaellig";

let kalOffen = false;
let kalJahr = 0;         // angezeigter Monat
let kalMonatNr = 0;      // 0-basiert, wie bei Date
let kalAuswahl = null;   // ISO-Tag, UEBERFAELLIG oder null (nichts gewaehlt)

// ---------- Google-Kalender (nur lesen) ----------
// Die Verbindung haelt der Server (functions/api/google/), die App bekommt
// fertige Termine und kennt kein Google-Token. `moeglich` bleibt false,
// solange im Pages-Projekt keine Zugangsdaten liegen - dann existiert die
// Funktion fuer den Nutzer gar nicht, statt ins Leere zu laufen.
let googleZustand = { moeglich: false, verbunden: false, email: null, schreiben: false, kalender: [] };
let googleTermine = [];      // Termine des geladenen Zeitraums
let googleGeladen = null;    // Schluessel aus Monat + eingeschalteten Kalendern
let googleLaedt = false;
let googleFehler = false;
let googleAus = false;       // geklaert: nicht verknuepft / nicht eingerichtet

function ladeMenge(schluessel) {
  try { return new Set(JSON.parse(localStorage.getItem(schluessel) || "[]")); }
  catch (e) { return new Set(); }
}
function speichereMenge(schluessel, menge) {
  try { localStorage.setItem(schluessel, JSON.stringify([...menge])); } catch (e) { /* voller Speicher */ }
}

// Ausgeschaltete Quellen ("liste:<id>" / "gcal:<id>") und alle je gesehenen.
// Zwei Mengen statt einer: ein NEU auftauchender Google-Kalender soll
// ausgeschaltet starten (ausser dem Hauptkalender), eine spaetere eigene
// Entscheidung darf davon aber nie wieder ueberschrieben werden.
let quellenAus = ladeMenge("kalQuellenAus");
let quellenBekannt = ladeMenge("kalQuellenBekannt");

// Aufgeklappte Google-Termine (Ort/Beschreibung), Schluessel ist die Termin-id.
let offeneTermine = new Set();

// Halb getippter Titel im Anlege-Feld. Das Panel zeichnet sich bei jeder
// Aenderung neu; ohne diesen Zwischenspeicher waere der Text dann weg.
let anlegenText = "";

// Schluessel der Kalenderwochen-Spalte im selben Umschalt-Vorrat wie die
// Listen und Kalender - sie ist zwar keine Datenquelle, wird aber genauso
// an- und abgeschaltet und soll sich genauso merken lassen.
const KW_QUELLE = "kw";

function quelleAn(schluessel) { return !quellenAus.has(schluessel); }

// Google gibt fuer den Hauptkalender die E-MAIL-ADRESSE als Bezeichnung
// heraus; einen Anzeigenamen liefert die Kalender-Schnittstelle nicht mit.
// Der Name aus dem ToDo-Konto steht naeher an dem, was man erwartet - und
// kostet keine zusaetzliche Google-Berechtigung.
function kalenderName(kal) {
  if (!kal) return "";
  if (kal.primaer && typeof eigenerName === "string" && eigenerName.trim()) return eigenerName;
  return kal.name;
}

function schalteQuelle(schluessel) {
  if (quellenAus.has(schluessel)) quellenAus.delete(schluessel);
  else quellenAus.add(schluessel);
  speichereMenge("kalQuellenAus", quellenAus);
  zeichneKalender();
}

// ---------- Daten ----------
// Flache Liste aller offenen ToDos mit Termin, quer ueber alle Listen.
// Erledigte bleiben draussen (der Kalender beantwortet "was kommt noch").
// Wiederkehrende ToDos, deren naechster Termin noch aussteht, ebenfalls:
// nochNichtFaellig() versteckt sie auf dem Board bis zum Faelligkeitstag,
// und der Kalender haelt sich an dieselbe Regel - sonst zeigt er etwas,
// das man auf dem Board nicht findet.
function kalenderTermine() {
  const listenName = {};
  for (const b of listen) listenName[b.id] = b.name;

  const termine = [];
  for (const boardId in daten) {
    if (!quelleAn("liste:" + boardId)) continue;   // Liste im Filter abgewaehlt
    const d = daten[boardId] || {};
    const bereiche = {};
    for (const c of (d.categories || [])) bereiche[c.id] = c;
    for (const t of (d.todos || [])) {
      if (t.done || !t.due) continue;
      if (nochNichtFaellig(t)) continue;
      const cat = bereiche[t.categoryId];
      termine.push({
        id: t.id,
        text: t.text,
        due: t.due,
        wiederholung: t.wiederholung || null,
        boardId,
        boardName: listenName[boardId] || "",
        bereich: (cat && !istOhneBereich(cat.id)) ? cat.name : "",
        farbe: cat ? (cat.farbe || null) : null,
      });
    }
  }
  termine.sort((a, b) => (a.due === b.due ? 0 : (a.due < b.due ? -1 : 1)));
  return termine;
}

// { "2026-08-11": [termin, ...] }
function nachTagen(termine) {
  const tage = {};
  for (const t of termine) (tage[t.due] = tage[t.due] || []).push(t);
  return tage;
}

function isoTag(jahr, monat, tag) {
  return `${jahr}-${String(monat + 1).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

// Ortszeit-Datum eines Date-Objekts. toISOString() waere hier falsch: das
// rechnet nach UTC um, und ein Termin um 00:30 landete einen Tag zu frueh.
function isoVonDate(d) {
  return isoTag(d.getFullYear(), d.getMonth(), d.getDate());
}

// ---------- Google-Termine holen ----------
// Zeitraum ist der angezeigte Monat plus eine Woche Rand - so sind die
// Nachbartage schon da, wenn man blaettert, und ein Monatswechsel kostet
// genau einen Abruf.
function zeitraumDesMonats() {
  const von = new Date(kalJahr, kalMonatNr, 1);
  von.setDate(von.getDate() - 7);
  const bis = new Date(kalJahr, kalMonatNr + 1, 0);
  bis.setDate(bis.getDate() + 7);
  return { von: isoVonDate(von), bis: isoVonDate(bis) };
}

// Neu aufgetauchte Kalender: der Hauptkalender startet AN, alles andere AUS -
// sonst pflastern Feiertage und Geburtstage den Monat gleich beim ersten
// Verknuepfen zu. Einmal gesehene Kalender fasst die Regel nie wieder an.
function merkeNeueKalender(kalender) {
  let neu = false;
  for (const k of kalender) {
    const schluessel = "gcal:" + k.id;
    if (quellenBekannt.has(schluessel)) continue;
    quellenBekannt.add(schluessel);
    if (!k.primaer) quellenAus.add(schluessel);
    neu = true;
  }
  if (neu) {
    speichereMenge("kalQuellenBekannt", quellenBekannt);
    speichereMenge("kalQuellenAus", quellenAus);
  }
}

async function ladeGoogle() {
  // Einmal geklaert, dass nichts verknuepft ist: nicht bei jedem Monatswechsel
  // erneut nachfragen. app.js setzt das nach Verbinden/Trennen zurueck.
  if (googleLaedt || googleAus) return;
  const ids = googleZustand.kalender.filter(k => quelleAn("gcal:" + k.id)).map(k => k.id);
  const { von, bis } = zeitraumDesMonats();
  const schluessel = `${von}|${ids.join(",")}`;
  if (googleGeladen === schluessel) return;

  googleLaedt = true;
  try {
    const adresse = `/api/google/termine?von=${von}&bis=${bis}`
      + (ids.length ? `&kalender=${encodeURIComponent(ids.join(","))}` : "");
    const antwort = await fetch(adresse);
    if (antwort.ok) {
      const d = await antwort.json();
      googleZustand.moeglich = !!d.moeglich;
      googleZustand.verbunden = !!d.verbunden;
      googleZustand.email = d.email || null;
      googleZustand.schreiben = !!d.schreiben;
      if (Array.isArray(d.kalender)) {
        googleZustand.kalender = d.kalender;
        merkeNeueKalender(d.kalender);
      }
      googleTermine = Array.isArray(d.termine) ? d.termine : [];
      googleFehler = !!d.fehler;
      googleGeladen = schluessel;
      googleAus = !d.verbunden;
      if (!d.verbunden) { googleTermine = []; googleZustand.kalender = []; }
    } else {
      // Serverseitiges Problem (z. B. Tabelle google_konten fehlt noch): nicht
      // bei jedem Neuzeichnen erneut dagegenlaufen.
      googleAus = true;
    }
  } catch (e) {
    googleFehler = true;   // offline oder Server weg - ToDos bleiben sichtbar
  }
  googleLaedt = false;
  if (kalOffen) zeichneKalender();
}

// An welchen Tagen steht ein Termin? Ganztaegige koennen ueber mehrere Tage
// gehen - Google liefert deren Ende als ersten Tag DANACH, deshalb der Tag
// Abzug. Terminierte haengen an ihrem Starttag; ueber Mitternacht laufende
// bleiben bewusst an einem Tag stehen, alles andere waere fuer eine
// Monatsuebersicht mehr Rauschen als Nutzen.
function tageEinesTermins(t) {
  if (!t.ganztags) {
    const d = new Date(t.start);
    return isNaN(d) ? [] : [isoVonDate(d)];
  }
  const start = new Date(t.start + "T00:00:00");
  if (isNaN(start)) return [];
  const endeRoh = t.ende ? new Date(t.ende + "T00:00:00") : null;
  const ende = (endeRoh && !isNaN(endeRoh) && endeRoh > start)
    ? new Date(endeRoh.getTime() - 86400000) : start;
  const tage = [];
  for (const d = new Date(start); d <= ende && tage.length < 62; d.setDate(d.getDate() + 1)) {
    tage.push(isoVonDate(d));
  }
  return tage;
}

// Ein Eintrag je Termin UND Tag, mit dem Wissen, ob der Termin an diesem Tag
// weitergeht: nur damit kann das Raster einen durchgezogenen Balken ueber
// mehrere Tage zeichnen statt an jedem Tag einen einzelnen Punkt.
function termineNachTagen() {
  const tage = {};
  if (!googleZustand.verbunden) return tage;
  for (const t of googleTermine) {
    if (!quelleAn("gcal:" + t.kalenderId)) continue;
    const spanne = tageEinesTermins(t);
    spanne.forEach((tag, i) => {
      (tage[tag] = tage[tag] || []).push({
        termin: t,
        weiterLinks: i > 0,
        weiterRechts: i < spanne.length - 1,
      });
    });
  }
  // Innerhalb eines Tages: ganztaegige zuerst, dann nach Uhrzeit.
  for (const tag in tage) {
    tage[tag].sort((a, b) => {
      if (a.termin.ganztags !== b.termin.ganztags) return a.termin.ganztags ? -1 : 1;
      return String(a.termin.start) < String(b.termin.start) ? -1 : 1;
    });
  }
  return tage;
}

// Wie viele Balken-Reihen ("Spuren") eine Tageszelle hoechstens zeigt. Zwei
// statt drei, seit die Balken ihren Titel tragen und dadurch deutlich hoeher
// sind - drei Reihen wuerden das Raster so weit aufblaehen, dass fuer die
// Tagesliste darunter kaum Platz bliebe.
const MAX_SPUREN = 2;

/**
 * Spurenplan fuers Monatsraster.
 *
 * Jeder Termin bekommt EINE Reihe, die er ueber alle seine Tage behaelt.
 * Vorher wurden die Balken je Tag neu einsortiert - kam an einem Tag ein
 * Einzeltermin dazu, rutschte der mehrtaegige in eine andere Reihe oder fiel
 * ganz aus der Anzeige, und die durchgezogene Linie riss auf.
 *
 * Sortiert wird nach LAENGE zuerst: die langen Termine belegen ihre Spur als
 * Erste, an einem vollen Tag weicht also eher ein Einzeltermin unter das "+".
 * Genau so bleibt die Linie garantiert ungebrochen.
 *
 * Liefert { plan, ueberzaehlig }:
 *   plan[iso][spur] = { termin, weiterLinks, weiterRechts } (Luecken = leer)
 *   ueberzaehlig[iso] = Anzahl Termine, die an dem Tag keine Spur bekamen
 */
function baueSpurenplan() {
  const plan = {};
  const ueberzaehlig = {};
  if (!googleZustand.verbunden) return { plan, ueberzaehlig };

  const sichtbar = googleTermine
    .filter(t => quelleAn("gcal:" + t.kalenderId))
    .map(t => ({ termin: t, tage: tageEinesTermins(t) }))
    .filter(e => e.tage.length);

  sichtbar.sort((a, b) => {
    if (a.tage.length !== b.tage.length) return b.tage.length - a.tage.length;
    if (a.termin.ganztags !== b.termin.ganztags) return a.termin.ganztags ? -1 : 1;
    return String(a.termin.start) < String(b.termin.start) ? -1 : 1;
  });

  const belegt = {};   // iso -> Set der schon vergebenen Spuren
  for (const e of sichtbar) {
    let spur = -1;
    for (let s = 0; s < MAX_SPUREN; s++) {
      if (e.tage.every(tag => !(belegt[tag] && belegt[tag].has(s)))) { spur = s; break; }
    }
    if (spur < 0) {
      for (const tag of e.tage) ueberzaehlig[tag] = (ueberzaehlig[tag] || 0) + 1;
      continue;
    }
    e.tage.forEach((tag, i) => {
      (belegt[tag] = belegt[tag] || new Set()).add(spur);
      const reihen = plan[tag] = plan[tag] || [];
      reihen[spur] = {
        termin: e.termin,
        weiterLinks: i > 0,
        weiterRechts: i < e.tage.length - 1,
      };
    });
  }
  return { plan, ueberzaehlig };
}

// Google liefert Farben als "#7986cb". Vor dem Einsetzen in einen style-Wert
// pruefen: alles andere waere fremder Text in unserem CSS.
function farbWert(hex) {
  return /^#[0-9a-f]{3,8}$/i.test(String(hex || "")) ? hex : null;
}

// Schrift auf dem farbigen Balken: dunkel auf hellen Google-Farben, weiss auf
// dunklen. Ohne das ist ein Titel auf Gelb (#f6bf26) schlicht nicht zu lesen.
// Relative Helligkeit nach WCAG, Schwelle empirisch auf die Google-Palette
// gelegt.
function kontrastFarbe(hex) {
  const roh = String(hex).replace("#", "");
  const voll = roh.length === 3 ? roh.split("").map(c => c + c).join("") : roh.slice(0, 6);
  const kanal = i => {
    const v = parseInt(voll.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const helligkeit = 0.2126 * kanal(0) + 0.7152 * kanal(2) + 0.0722 * kanal(4);
  return helligkeit > 0.45 ? "#1f2430" : "#ffffff";
}

function zeitLabel(t) {
  if (t.ganztags) return "Ganztägig";
  const start = new Date(t.start);
  if (isNaN(start)) return "";
  const ende = t.ende ? new Date(t.ende) : null;
  const von = UHR_FORMAT.format(start);
  if (!ende || isNaN(ende)) return von;
  const bis = UHR_FORMAT.format(ende);
  return bis === von ? von : `${von}–${bis}`;
}

// ---------- Zeichnen ----------
function zeichneKalender() {
  const todos = kalenderTermine();
  const tage = nachTagen(todos);
  const tageTermine = termineNachTagen();
  const heute = todayStr();

  kalMonatName.textContent = MONAT_FORMAT.format(new Date(kalJahr, kalMonatNr, 1));

  // Ueberfaellig-Chip: nur wenn es welche gibt. Zaehlt AUSSCHLIESSLICH ToDos -
  // ein vergangener Google-Termin ist nicht "ueberfaellig", den kann man nicht
  // nachholen.
  const ueberfaellige = todos.filter(t => t.due < heute);
  kalUeberfaellig.hidden = ueberfaellige.length === 0;
  kalUeberfaellig.textContent = `⚠ Überfällig (${ueberfaellige.length})`;
  kalUeberfaellig.classList.toggle("gewaehlt", kalAuswahl === UEBERFAELLIG);

  zeichneFilter();
  // Das Raster arbeitet mit dem Spurenplan (feste Reihen), die Tagesliste mit
  // der zeitlichen Sortierung - zwei verschiedene Fragen an dieselben Daten.
  zeichneRaster(tage, baueSpurenplan(), heute);
  zeichneTagesliste(tage, tageTermine, ueberfaellige, heute);

  // Laeuft nebenher und zeichnet bei neuen Daten selbst noch einmal; ist der
  // Zeitraum schon geladen (oder gar kein Google verknuepft), kostet der
  // Aufruf nichts.
  ladeGoogle();
}

// Eine Pille je Quelle: ToDo-Listen zuerst, dann die Google-Kalender.
// Erscheint erst ab zwei Quellen - bei einer Liste ohne Google gibt es nichts
// zu filtern und das Panel bleibt so schlicht wie vorher.
function zeichneFilter() {
  const quellen = listen.map(b => ({
    schluessel: "liste:" + b.id, name: b.name, art: "liste",
  }));
  if (googleZustand.verbunden) {
    for (const k of googleZustand.kalender) {
      quellen.push({ schluessel: "gcal:" + k.id, name: kalenderName(k), farbe: farbWert(k.farbe), art: "gcal" });
    }
  }
  // Die Kalenderwoche steht am Ende: sie ist eine Anzeige-Einstellung, keine
  // Datenquelle - und sie ist immer da, auch ohne Google.
  quellen.push({ schluessel: KW_QUELLE, name: "KW", art: "kw" });

  kalFilter.hidden = quellen.length < 2;
  kalFilter.innerHTML = "";
  if (quellen.length < 2) return;

  for (const q of quellen) {
    const pille = document.createElement("button");
    pille.type = "button";
    pille.className = "kal-pille kal-pille-" + q.art + (quelleAn(q.schluessel) ? "" : " aus");
    pille.addEventListener("click", () => schalteQuelle(q.schluessel));

    // Dieselben zwei Formen wie im Raster: Punkt fuer eine ToDo-Liste,
    // Balken fuer einen Google-Kalender. Die KW-Pille traegt keine Marke -
    // sie schaltet keine Eintraege, sondern eine Spalte.
    if (q.art !== "kw") {
      const marke = document.createElement("span");
      marke.className = q.art === "gcal" ? "kal-balken kal-balken-marke" : "kal-punkt";
      if (q.art === "gcal" && q.farbe) marke.style.background = q.farbe;
      pille.appendChild(marke);
    }

    const name = document.createElement("span");
    name.textContent = q.name;
    pille.appendChild(name);
    kalFilter.appendChild(pille);
  }
}

/**
 * Kalenderwoche nach ISO 8601 (in Deutschland die uebliche Zaehlung):
 * Woche 1 ist die Woche mit dem ersten Donnerstag des Jahres, die Woche
 * beginnt am Montag.
 *
 * Selbst gerechnet statt aus einem abonnierten Google-Kalender gelesen: die
 * Zahl steht damit immer da - offline, ohne Google-Verknuepfung und ohne von
 * der Beschriftung eines fremden Kalenders abzuhaengen.
 *
 * Der Umweg ueber den DONNERSTAG derselben Woche erledigt den Jahreswechsel:
 * er liegt immer in dem Jahr, zu dem die Woche zaehlt.
 */
function kalenderwoche(datum) {
  const d = new Date(datum.getFullYear(), datum.getMonth(), datum.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const ersterDonnerstag = new Date(d.getFullYear(), 0, 4);
  ersterDonnerstag.setDate(ersterDonnerstag.getDate() - ((ersterDonnerstag.getDay() + 6) % 7) + 3);
  return 1 + Math.round((d - ersterDonnerstag) / (7 * 24 * 60 * 60 * 1000));
}

function zeichneRaster(tage, spuren, heute) {
  const { plan, ueberzaehlig } = spuren;
  const kwAn = quelleAn(KW_QUELLE);
  kalRaster.classList.toggle("ohne-kw", !kwAn);
  kalWochentage.classList.toggle("ohne-kw", !kwAn);

  kalWochentage.innerHTML = "";
  // Erste Spalte gehoert der Kalenderwoche - im Kopf nur ein leises "KW".
  if (kwAn) {
    const kwKopf = document.createElement("span");
    kwKopf.className = "kal-kw kal-kw-kopf";
    kwKopf.textContent = "KW";
    kalWochentage.appendChild(kwKopf);
  }
  for (const w of WOCHENTAGE) {
    const zelle = document.createElement("span");
    zelle.textContent = w;
    kalWochentage.appendChild(zelle);
  }

  kalRaster.innerHTML = "";
  // getDay() zaehlt ab Sonntag, das Raster beginnt aber am Montag.
  const ersterWochentag = (new Date(kalJahr, kalMonatNr, 1).getDay() + 6) % 7;
  const tageImMonat = new Date(kalJahr, kalMonatNr + 1, 0).getDate();
  const wocheVon = tag => Math.floor((ersterWochentag + tag - 1) / 7);

  // Wie viele Spuren jede WOCHE braucht. Je Woche gerechnet, nicht je Tag:
  // innerhalb einer Zeile muessen die Balken derselben Spur auf gleicher Hoehe
  // liegen, sonst versetzt sich die Linie von Tag zu Tag. Ruhige Wochen
  // bleiben dafuer flach.
  const spurenJeWoche = [];
  for (let tag = 1; tag <= tageImMonat; tag++) {
    const reihen = plan[isoTag(kalJahr, kalMonatNr, tag)] || [];
    const w = wocheVon(tag);
    spurenJeWoche[w] = Math.max(spurenJeWoche[w] || 0, reihen.length);
  }

  const zeilen = Math.ceil((ersterWochentag + tageImMonat) / 7);
  for (let zeile = 0; zeile < zeilen; zeile++) {
    // Wochenzahl aus dem Montag der Zeile - der darf ruhig im Vor- oder
    // Folgemonat liegen, Date rechnet das von selbst um.
    if (kwAn) {
      const kw = document.createElement("span");
      kw.className = "kal-kw";
      kw.textContent = String(kalenderwoche(new Date(kalJahr, kalMonatNr, zeile * 7 - ersterWochentag + 1)));
      kalRaster.appendChild(kw);
    }

    for (let spalte = 0; spalte < 7; spalte++) {
      const tag = zeile * 7 + spalte - ersterWochentag + 1;
      // Leerzellen vor dem Monatsersten und nach dem Letzten. Bewusst LEER
      // statt blasser Nachbartage: ein Tag ohne Punkte sieht frei aus - das
      // darf er nur, wenn es stimmt.
      if (tag < 1 || tag > tageImMonat) {
        kalRaster.appendChild(document.createElement("span"));
        continue;
      }
      kalRaster.appendChild(baueTagesZelle(tag, spalte, {
        tage, plan, ueberzaehlig, spurenJeWoche, wocheVon, heute, tageImMonat,
      }));
    }
  }
}

function baueTagesZelle(tag, spalte, ctx) {
  const { tage, plan, ueberzaehlig, spurenJeWoche, wocheVon, heute, tageImMonat } = ctx;
  const iso = isoTag(kalJahr, kalMonatNr, tag);
  const todosDesTages = tage[iso] || [];
  const reihen = plan[iso] || [];
  const termineImRaster = reihen.filter(Boolean).length;
  // "+" nur, wenn wirklich etwas WEGGELASSEN wurde - nicht schon, sobald an
  // einem Tag vier Dinge stehen, die alle sichtbar sind.
  const versteckt = Math.max(0, todosDesTages.length - 3) + (ueberzaehlig[iso] || 0);
  const zelle = document.createElement("button");
  zelle.type = "button";
  zelle.className = "kal-tag";
  zelle.dataset.tag = iso;
  if (iso === heute) zelle.classList.add("heute");
  if (iso === kalAuswahl) zelle.classList.add("gewaehlt");
  // Rot faerbt nur ueberfaelliges ToDo-Datum, nie ein vergangener Termin.
  if (todosDesTages.length && iso < heute) zelle.classList.add("ueberfaellig");
  if (versteckt > 0) zelle.classList.add("viele");

  const zahl = document.createElement("span");
  zahl.className = "kal-zahl";
  zahl.textContent = String(tag);
  zelle.appendChild(zahl);

  // Punkt = ToDo, Balken = Termin. Zwei Formen statt zweier Farbtoene: die
  // Farben gehoeren jetzt den Bereichen bzw. Google und koennen sich
  // gleichen, die Form bleibt eindeutig.
  const punkte = document.createElement("span");
  punkte.className = "kal-punkte";
  for (const t of todosDesTages.slice(0, 3)) {
    const punkt = document.createElement("span");
    punkt.className = "kal-punkt" + (t.farbe ? " farbe-" + t.farbe : "");
    punkte.appendChild(punkt);
  }
  zelle.appendChild(punkte);

  // Ein mehrtaegiger Termin bekommt EINEN Balken am Anfang seines Abschnitts
  // in dieser Zeile, der ueber alle seine Tage reicht und den Titel EINMAL
  // traegt - wie im Papierkalender. Technisch ueber die Breite (siehe
  // --spanne im CSS): der Balken laeuft aus seiner Zelle heraus ueber die
  // folgenden. Die decken ihre Spur mit einem unsichtbaren Platzhalter ab,
  // damit die Reihenhoehe stimmt und nichts doppelt gezeichnet wird.
  const stapel = document.createElement("span");
  stapel.className = "kal-balken-stapel";
  for (let s = 0; s < (spurenJeWoche[wocheVon(tag)] || 0); s++) {
    const eintrag = reihen[s];
    const balken = document.createElement("span");

    // Leere Spur oder Fortsetzung eines Balkens, der links begonnen hat.
    const fortsetzung = eintrag && eintrag.weiterLinks && spalte > 0;
    if (!eintrag || fortsetzung) {
      balken.className = "kal-balken kal-balken-luecke";
      stapel.appendChild(balken);
      continue;
    }

    // Wie viele Tage reicht der Abschnitt in DIESER Zeile noch?
    let spanne = 1;
    while (spalte + spanne <= 6 && tag + spanne <= tageImMonat) {
      const naechste = plan[isoTag(kalJahr, kalMonatNr, tag + spanne)] || [];
      if (!naechste[s] || naechste[s].termin.id !== eintrag.termin.id) break;
      spanne++;
    }

    balken.className = "kal-balken"
      + (eintrag.weiterLinks ? " weiter-links" : "")
      + (eintrag.weiterRechts && spalte + spanne > 6 ? " weiter-rechts" : "");
    balken.style.setProperty("--spanne", String(spanne));
    const farbe = farbWert(eintrag.termin.farbe);
    if (farbe) {
      balken.style.background = farbe;
      balken.style.color = kontrastFarbe(farbe);
    }
    const text = document.createElement("span");
    text.className = "kal-balken-text";
    text.textContent = eintrag.termin.titel;
    balken.appendChild(text);
    stapel.appendChild(balken);
  }
  zelle.appendChild(stapel);

  const termineGesamt = termineImRaster + (ueberzaehlig[iso] || 0);
  if (todosDesTages.length || termineGesamt) {
    const teile = [];
    if (todosDesTages.length) teile.push(todosDesTages.length === 1 ? "1 ToDo" : `${todosDesTages.length} ToDos`);
    if (termineGesamt) teile.push(termineGesamt === 1 ? "1 Termin" : `${termineGesamt} Termine`);
    zelle.title = teile.join(", ");
  }
  return zelle;
}

function zeichneTagesliste(tage, tageTermine, ueberfaellige, heute) {
  kalTagesliste.innerHTML = "";

  let titel;
  let todosDesTages;
  let termineDesTages = [];
  let mitDatum = false;
  if (kalAuswahl === UEBERFAELLIG) {
    titel = "Überfällig";
    todosDesTages = ueberfaellige;
    mitDatum = true;   // liegt quer ueber viele Tage, das Datum gehoert dazu
  } else if (kalAuswahl) {
    const [j, m, t] = kalAuswahl.split("-").map(Number);
    titel = TAG_FORMAT.format(new Date(j, m - 1, t));
    todosDesTages = tage[kalAuswahl] || [];
    termineDesTages = tageTermine[kalAuswahl] || [];
  } else {
    titel = "";
    todosDesTages = [];
  }

  if (titel) {
    const kopf = document.createElement("h3");
    kopf.className = "kal-liste-kopf";
    kopf.textContent = titel;
    if (kalAuswahl === heute) {
      const heuteChip = document.createElement("span");
      heuteChip.className = "kal-heute-chip";
      heuteChip.textContent = "heute";
      kopf.appendChild(heuteChip);
    }
    kalTagesliste.appendChild(kopf);
  }

  // Termine oben (ganztaegig, dann nach Uhrzeit - so sortiert sie
  // termineNachTagen), ToDos darunter: die haben keine Uhrzeit und gehoeren
  // nicht in die Zeitachse des Tages.
  //
  // Die Zwischenueberschriften erscheinen nur, wenn der Tag BEIDES enthaelt -
  // ueber einer einzelnen Sorte waeren sie eine Beschriftung ohne Gegenstueck.
  const beides = termineDesTages.length > 0 && todosDesTages.length > 0;
  if (beides) kalTagesliste.appendChild(baueGruppenKopf("Termine"));
  for (const eintrag of termineDesTages) kalTagesliste.appendChild(baueTerminZeile(eintrag.termin));
  if (beides) kalTagesliste.appendChild(baueGruppenKopf("ToDos"));
  for (const t of todosDesTages) kalTagesliste.appendChild(baueEintrag(t, mitDatum));

  if (!todosDesTages.length && !termineDesTages.length) {
    const leer = document.createElement("p");
    leer.className = "kal-leer";
    leer.textContent = kalAuswahl ? "Nichts fällig." : "In diesem Monat steht nichts an.";
    kalTagesliste.appendChild(leer);
  }

  // Anlegen direkt fuer den gewaehlten Tag - nur bei einem echten Datum, im
  // Ueberfaellig-Ausschnitt gibt es keinen Tag, auf den es sich beziehen
  // koennte.
  if (kalAuswahl && kalAuswahl !== UEBERFAELLIG && aktiveListe) {
    kalTagesliste.appendChild(baueAnlegeZeile(kalAuswahl));
  }

  // Eine Zeile statt einer stillen Luecke, wenn Google gerade nicht mag -
  // sonst sieht ein Tag leer aus, obwohl nur die Termine fehlen.
  if (googleFehler && googleZustand.verbunden) {
    const hinweis = document.createElement("p");
    hinweis.className = "kal-leer kal-google-fehler";
    hinweis.textContent = "Google-Termine gerade nicht erreichbar.";
    kalTagesliste.appendChild(hinweis);
  }
}

/**
 * Anlege-Zeile unter dem gewaehlten Tag.
 *
 * Das ToDo landet in der gerade AKTIVEN Liste und dort ohne Bereich - der
 * Kalender kennt keinen Bereich, und "Ohne Bereich" ist genau der Auffang
 * dafuer; zuordnen laesst es sich danach auf dem Board wie jedes andere.
 * Das Panel bleibt offen, damit man mehrere Tage hintereinander befuellen
 * kann.
 */
function baueAnlegeZeile(tag) {
  const zeile = document.createElement("div");
  zeile.className = "kal-anlegen";

  const feld = document.createElement("input");
  feld.type = "text";
  feld.className = "kal-anlegen-feld";
  feld.placeholder = "Für diesen Tag anlegen …";
  feld.value = anlegenText;
  zeile.appendChild(feld);

  // Beim Neuzeichnen (jedes Anlegen rendert das Panel neu) den Tippstand
  // halten - sonst verliert man den halb geschriebenen Titel, sobald
  // irgendwo anders etwas passiert.
  feld.addEventListener("input", () => { anlegenText = feld.value; });

  const knoepfe = document.createElement("div");
  knoepfe.className = "kal-anlegen-knoepfe";

  const alsToDo = document.createElement("button");
  alsToDo.type = "button";
  alsToDo.className = "btn klein primary";
  alsToDo.textContent = "＋ ToDo";
  alsToDo.addEventListener("click", () => legeToDoAn(tag, feld.value));
  knoepfe.appendChild(alsToDo);

  // Der Termin-Knopf erscheint nur, wenn die Verknuepfung wirklich schreiben
  // darf - eine aeltere traegt den Scope nicht, und ein Knopf, der dann in
  // einen Fehler laeuft, waere schlechter als keiner.
  if (googleZustand.verbunden && googleZustand.schreiben) {
    const alsTermin = document.createElement("button");
    alsTermin.type = "button";
    alsTermin.className = "btn klein";
    alsTermin.textContent = "＋ Termin";
    alsTermin.title = "Ganztägiger Termin in deinem Google-Kalender";
    alsTermin.addEventListener("click", () => legeTerminAn(tag, feld.value));
    knoepfe.appendChild(alsTermin);
  }

  zeile.appendChild(knoepfe);
  feld.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); legeToDoAn(tag, feld.value); }
    else if (e.key === "Escape") { anlegenText = ""; feld.value = ""; feld.blur(); }
  });
  return zeile;
}

function legeToDoAn(tag, text) {
  if (!text.trim() || !aktiveListe) return;
  const bereich = ohneBereichId(aktiveListe);
  if (!state.categories.some(c => c.id === bereich)) {
    state.categories.unshift({ id: bereich, name: OHNE_NAME });
  }
  anlegenText = "";
  addTodoTo(bereich, null, text, tag, null);   // rendert und speichert selbst
  fokussiereAnlegeFeld();
}

async function legeTerminAn(tag, text) {
  const titel = text.trim();
  if (!titel) return;
  anlegenText = "";
  zeichneKalender();
  try {
    const antwort = await fetch("/api/google/termin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titel, datum: tag }),
    });
    if (!antwort.ok) {
      const d = await antwort.json().catch(() => ({}));
      snackInfo(d.neuVerknuepfen
        ? "Dafür einmal in den Einstellungen trennen und neu verbinden."
        : "Google hat den Termin nicht angenommen.");
      return;
    }
    // Frisch holen statt den neuen Termin von Hand einzusortieren: so steht
    // im Panel genau das, was bei Google steht.
    googleGeladen = null;
    await ladeGoogle();
    snackInfo("Termin angelegt.");
  } catch (e) {
    snackInfo("Termin konnte nicht angelegt werden.");
  }
  fokussiereAnlegeFeld();
}

// Nach dem Anlegen zurueck ins Feld, damit der naechste Eintrag ohne
// Mausweg folgt. Auf dem Handy haelt das nebenbei die Tastatur offen.
function fokussiereAnlegeFeld() {
  const feld = kalTagesliste.querySelector(".kal-anlegen-feld");
  if (feld) feld.focus();
}

function baueGruppenKopf(text) {
  const kopf = document.createElement("p");
  kopf.className = "kal-gruppe";
  kopf.textContent = text;
  return kopf;
}

// Google-Termin: rein lesend, ein Tipp klappt Ort und Beschreibung auf.
function baueTerminZeile(t) {
  const box = document.createElement("div");
  box.className = "kal-termin-box";

  const kal = googleZustand.kalender.find(k => k.id === t.kalenderId);
  // Farbe kommt fertig aufgeloest vom Server (eigene Termin-Farbe schlaegt
  // Kalender-Farbe); der Rueckgriff auf den Kalender faengt nur aeltere
  // Antworten ohne das Feld ab.
  const farbe = farbWert(t.farbe) || farbWert(kal && kal.farbe);
  const offen = offeneTermine.has(t.id);
  const hatDetails = !!(t.ort || t.beschreibung);

  // Ohne Ort und Beschreibung gibt es nichts aufzuklappen - dann auch kein
  // Knopf, der auf einen Tipp mit "nichts da" antwortet.
  const knopf = document.createElement(hatDetails ? "button" : "div");
  knopf.className = "kal-eintrag kal-termin" + (offen ? " offen" : "") + (hatDetails ? "" : " kal-termin-still");
  if (hatDetails) {
    knopf.type = "button";
    knopf.addEventListener("click", () => {
      if (offeneTermine.has(t.id)) offeneTermine.delete(t.id);
      else offeneTermine.add(t.id);
      zeichneKalender();
    });
  }

  // Kraeftiger Farbbalken am linken Rand statt eines kleinen Punktes: das ist
  // der sichtbare Unterschied zur ToDo-Zeile und traegt zugleich die
  // Google-Farbe gross genug, um sie ueberhaupt zu erkennen.
  if (farbe) knopf.style.borderLeftColor = farbe;

  const text = document.createElement("span");
  text.className = "kal-eintrag-text";

  const titel = document.createElement("span");
  titel.className = "kal-eintrag-titel";
  titel.textContent = t.titel;
  text.appendChild(titel);

  const meta = document.createElement("span");
  meta.className = "kal-eintrag-meta";
  meta.textContent = [zeitLabel(t), kalenderName(kal)].filter(Boolean).join(" · ");
  text.appendChild(meta);

  knopf.appendChild(text);
  if (hatDetails) {
    const pfeil = document.createElement("span");
    pfeil.className = "kal-termin-pfeil";
    pfeil.textContent = offen ? "▴" : "▾";
    knopf.appendChild(pfeil);
  }
  box.appendChild(knopf);

  if (offen) {
    const details = document.createElement("div");
    details.className = "kal-termin-details";
    if (t.ort) {
      const ort = document.createElement("p");
      ort.textContent = "📍 " + t.ort;
      details.appendChild(ort);
    }
    if (t.beschreibung) {
      const bes = document.createElement("p");
      // Beschreibungen kommen aus Google teils als HTML - als TEXT einsetzen,
      // nie als Markup. textContent macht genau das.
      bes.textContent = t.beschreibung.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      details.appendChild(bes);
    }
    box.appendChild(details);
  }
  return box;
}

function baueEintrag(t, mitDatum) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "kal-eintrag";
  knopf.addEventListener("click", () => springeZuToDo(t.boardId, t.id));

  const punkt = document.createElement("span");
  punkt.className = "kal-punkt" + (t.farbe ? " farbe-" + t.farbe : "");
  knopf.appendChild(punkt);

  const text = document.createElement("span");
  text.className = "kal-eintrag-text";

  const titel = document.createElement("span");
  titel.className = "kal-eintrag-titel";
  titel.textContent = t.text;
  if (t.wiederholung) {
    const wdh = document.createElement("span");
    wdh.className = "kal-wdh";
    wdh.textContent = "🔁";
    titel.appendChild(wdh);
  }
  text.appendChild(titel);

  // Herkunft: Listenname nur, wenn es NICHT die gerade aktive Liste ist -
  // sonst steht bei jedem Eintrag dieselbe Selbstverstaendlichkeit.
  const teile = [];
  if (mitDatum) teile.push(formatDate(t.due));
  if (t.boardId !== aktiveListe && t.boardName) teile.push(t.boardName);
  if (t.bereich) teile.push(t.bereich);
  if (teile.length) {
    const meta = document.createElement("span");
    meta.className = "kal-eintrag-meta";
    meta.textContent = teile.join(" › ");
    text.appendChild(meta);
  }

  knopf.appendChild(text);
  return knopf;
}

// ---------- Springen ----------
// Der Kalender bearbeitet selbst nichts: er schliesst sich, holt die
// richtige Liste nach vorne und uebergibt an den Bearbeiten-Modus des
// Boards. Das kurze Aufblinken zeigt, wo man gelandet ist.
function springeZuToDo(boardId, todoId) {
  schliesseKalender();
  if (boardId !== aktiveListe) wechsleListe(boardId);
  startEdit(todoId);
  const karte = document.querySelector(`.todo[data-id="${todoId}"]`);
  if (!karte) return;
  karte.scrollIntoView({ behavior: "smooth", block: "center" });
  karte.classList.add("kal-treffer");
  setTimeout(() => karte.classList.remove("kal-treffer"), 1600);
}

// ---------- Auswahl / Navigation ----------
function waehleTag(iso) {
  kalAuswahl = (kalAuswahl === iso) ? null : iso;
  zeichneKalender();
}

// Beim Monatswechsel den ersten Tag MIT Terminen waehlen - ein leerer
// Detailbereich unter einem vollen Raster sieht aus wie ein Fehler.
function zeigeMonat(jahr, monat) {
  kalJahr = jahr;
  kalMonatNr = monat;
  const tage = nachTagen(kalenderTermine());
  const treffer = Object.keys(tage)
    .filter(iso => iso.startsWith(`${jahr}-${String(monat + 1).padStart(2, "0")}`))
    .sort();
  kalAuswahl = treffer[0] || null;
  zeichneKalender();
}

function monatVerschieben(schritt) {
  const d = new Date(kalJahr, kalMonatNr + schritt, 1);
  zeigeMonat(d.getFullYear(), d.getMonth());
}

function springeZuHeute() {
  const heute = new Date();
  kalJahr = heute.getFullYear();
  kalMonatNr = heute.getMonth();
  kalAuswahl = todayStr();
  zeichneKalender();
}

// ---------- Oeffnen / Schliessen ----------
function setzePanel(offen) {
  kalPanel.classList.add("animiert");
  kalPanel.style.transform = offen ? "translateX(0)" : "";
  kalHintergrund.style.opacity = "";
  kalHintergrund.classList.toggle("sichtbar", offen);
  kalPanel.setAttribute("aria-hidden", offen ? "false" : "true");
  document.documentElement.classList.toggle("kal-offen", offen);
}

function oeffneKalender() {
  if (!kalOffen) springeZuHeute();   // jedes Oeffnen startet beim heutigen Tag
  else zeichneKalender();
  kalOffen = true;
  setzePanel(true);
}

function schliesseKalender() {
  if (!kalOffen) return;
  kalOffen = false;
  setzePanel(false);
}

// ---------- Wischgeste ----------
const RAND = 24;        // Zone am rechten Bildschirmrand, in der das Ziehen beginnt
const SCHWELLE = 8;     // ab hier entscheidet sich waagerecht gegen senkrecht
const AUF_ANTEIL = 0.65;  // beim Oeffnen: so weit muss das Panel herein sein
const ZU_ANTEIL = 0.35;   // beim Schliessen: so weit muss es hinausgezogen sein

let geste = null;   // { x, y, achse, modus, breite, versatz }

// Keine Geste, solange ein Dialog offen ist oder gerade etwas gezogen wird -
// sonst kaempft der Kalender mit dem Drag & Drop des Boards.
function darfGeste() {
  if (!einstellungenPopup.hidden) return false;
  if (kalLock && !kalLock.classList.contains("hidden")) return false;
  if (draggedId || draggedCat || draggedThema) return false;
  return true;
}

function setzeVersatz(v) {
  geste.versatz = v;
  kalPanel.style.transform = `translateX(${v}px)`;
  kalHintergrund.style.opacity = String(1 - v / geste.breite);
}

document.addEventListener("touchstart", e => {
  geste = null;
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  if (!kalOffen) {
    if (!darfGeste()) return;
    if (window.innerWidth - t.clientX > RAND) return;
    geste = { x: t.clientX, y: t.clientY, achse: null, modus: "auf" };
  } else {
    if (!kalPanel.contains(e.target)) return;
    geste = { x: t.clientX, y: t.clientY, achse: null, modus: "zu" };
  }
  geste.breite = kalPanel.getBoundingClientRect().width || 320;
  geste.versatz = geste.modus === "auf" ? geste.breite : 0;
}, { passive: true });

document.addEventListener("touchmove", e => {
  if (!geste) return;
  const t = e.touches[0];
  const dx = t.clientX - geste.x;
  const dy = t.clientY - geste.y;

  if (!geste.achse) {
    if (Math.abs(dx) < SCHWELLE && Math.abs(dy) < SCHWELLE) return;
    // Ueberwiegend senkrecht: das ist Scrollen, nicht unsere Geste.
    if (Math.abs(dx) <= Math.abs(dy)) { geste = null; return; }
    geste.achse = "x";
    kalPanel.classList.remove("animiert");
    if (geste.modus === "auf") {
      // Wie beim Knopf: jedes Oeffnen startet beim heutigen Tag, sonst haengt
      // das Panel noch im Monat, in dem man zuletzt geblaettert hat.
      springeZuHeute();
      kalHintergrund.classList.add("sichtbar");
      kalPanel.setAttribute("aria-hidden", "false");
    }
  }

  e.preventDefault();   // ab hier gehoert die Bewegung dem Panel
  const roh = geste.modus === "auf" ? geste.breite + dx : dx;
  setzeVersatz(Math.min(geste.breite, Math.max(0, roh)));
}, { passive: false });

function gesteBeenden() {
  if (!geste) return;
  const g = geste;
  geste = null;
  if (g.achse !== "x") return;
  const auf = g.modus === "auf"
    ? g.versatz < g.breite * AUF_ANTEIL
    : g.versatz < g.breite * ZU_ANTEIL;
  if (auf) {
    // Ohne den bereits gesetzten Zustand: der Inhalt steht schon, nur der
    // Rest des Weges wird animiert.
    kalOffen = true;
    setzePanel(true);
  } else {
    kalOffen = false;
    setzePanel(false);
  }
}
document.addEventListener("touchend", gesteBeenden);
document.addEventListener("touchcancel", gesteBeenden);

// ---------- Verdrahtung ----------
document.getElementById("kalenderBtn").addEventListener("click", oeffneKalender);
document.getElementById("kalZu").addEventListener("click", schliesseKalender);
kalHintergrund.addEventListener("click", schliesseKalender);
document.getElementById("kalZurueck").addEventListener("click", () => monatVerschieben(-1));
document.getElementById("kalVor").addEventListener("click", () => monatVerschieben(1));
document.getElementById("kalHeute").addEventListener("click", springeZuHeute);
kalUeberfaellig.addEventListener("click", () => {
  kalAuswahl = kalAuswahl === UEBERFAELLIG ? null : UEBERFAELLIG;
  zeichneKalender();
});
kalRaster.addEventListener("click", e => {
  const zelle = e.target.closest(".kal-tag");
  if (zelle) waehleTag(zelle.dataset.tag);
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && kalOffen) schliesseKalender();
});

// Aus render() aufgerufen: haelt das offene Panel auf Stand, wenn sich am
// Board etwas aendert (Abhaken, Sync vom Server). Zugeklappt kostet es nichts.
window.kalenderNeuZeichnen = function () {
  if (kalOffen) zeichneKalender();
};

// Nach Verbinden/Trennen in den Einstellungen: alles zu Google vergessen und
// beim naechsten Zeichnen frisch holen (siehe app.js).
window.kalenderGoogleVergessen = function () {
  googleZustand = { moeglich: false, verbunden: false, email: null, kalender: [] };
  googleTermine = [];
  googleGeladen = null;
  googleAus = false;
  googleFehler = false;
  offeneTermine.clear();
  if (kalOffen) zeichneKalender();
};
