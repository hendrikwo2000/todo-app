"use strict";

/* ====================================================================
   Kalender – rechte Haelfte des Bildschirms

   Zeigt alle offenen ToDos MIT Termin aus ALLEN geladenen Listen (eigene
   und geteilte) sowie - falls verknuepft - die Termine aus Google Kalender:
   Monatsraster oben, Tagesliste darunter. Ein Tipp auf ein ToDo schliesst
   das Panel und oeffnet es im gewohnten Bearbeiten-Modus auf dem Board -
   der Kalender braucht dadurch keine eigene Speicher-, Wiederholungs- oder
   Unterpunkt-Logik. Google-Termine dagegen bearbeitet er selbst (Titel,
   Dauer, Farbe, Notiz) und legt sie an; dafuer traegt die Verknuepfung den
   Schreib-Scope, siehe functions/_lib/google.js.

   Laeuft NACH app.js und liest dessen Zustand direkt (daten, listen,
   aktiveListe). Eigene Datei nur, damit app.js nicht weiter waechst; die
   einzige Beruehrung in der Gegenrichtung ist window.kalenderNeuZeichnen()
   aus render().

   Zwei Modi, unterschieden allein an der Fensterbreite (SPLIT_AB):

   - Split (breites Fenster): der Kalender steht fest neben der Liste. Der
     body macht ihm per padding-right Platz, das Panel selbst bleibt
     position:fixed.
   - Umschalt-Modus (Handy, schmales Fenster): der Kalender legt sich als
     Panel ueber die Liste, mit abgedunkeltem Hintergrund.

   Bedient wird beides ueber denselben Umschalter "Liste | Kalender" - in der
   Kopfzeile der App, und noch einmal im Kalender an genau derselben Stelle,
   weil der im Umschalt-Modus die Kopfzeile verdeckt. Welche Ansicht zuletzt
   galt, steht in localStorage (ANSICHT_KEY) und wird beim naechsten Start
   wiederhergestellt. Dazu weiterhin: Wisch vom RECHTEN Bildschirmrand nach
   links zum Oeffnen (rechts, weil der linke Rand auf iOS/Android fuer
   "Zurueck" belegt ist), Escape, Hintergrund-Klick und Wisch nach rechts
   zum Schliessen.
   ==================================================================== */

const kalPanel       = document.getElementById("kalenderPanel");
const kalMonatName   = document.getElementById("kalMonatName");
const kalWochentage  = document.getElementById("kalWochentage");
const kalRaster      = document.getElementById("kalRaster");
const kalTagesliste  = document.getElementById("kalTagesliste");
const kalFilter      = document.getElementById("kalFilter");
const kalFilterKnopf = document.getElementById("kalFilterKnopf");
const kalOben        = document.getElementById("kalOben");
const kalLock        = document.getElementById("lock");

// Die beiden Dialoge liegen ausserhalb des Panels (siehe index.html) - unter
// dessen transform waere ein "Vollbild" nur so gross wie der Kalender.
const kalWahl        = document.getElementById("kalWahl");
const kalWahlBox     = kalWahl.querySelector(".kal-wahl-box");
const kalTerminPopup = document.getElementById("kalTerminPopup");
const kalTerminBox   = kalTerminPopup.querySelector(".kal-termin-popup-box");

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONAT_FORMAT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const TAG_FORMAT   = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const UHR_FORMAT   = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

// Schluessel der Sonder-Auswahl "Ueberfaellig" - steht anstelle eines
// ISO-Datums in kalAuswahl, weil Ueberfaelliges ueber viele Tage verstreut
// liegt und sonst in irgendeinem Vormonat verschwinden wuerde.

// Ab dieser Fensterbreite steht der Kalender NEBEN der Liste (Split) statt
// darueber. Die Zahl kommt aus dem Platz: rund 440px Kalender lassen darunter
// noch zwei Board-Spalten (min. 250px) uebrig - bei weniger bliebe eine
// einzige Spalte, und dann ist Umschalten ehrlicher als Nebeneinander.
// Gehoert zu --kal-breite und html.kal-split in style.css.
const SPLIT_AB = 1000;
// Was das Board neben dem Streifen mindestens braucht: zwei Spalten (je 250)
// plus Raender. Erst damit laesst sich die Split-Grenze aus einer selbst
// gezogenen Breite ausrechnen, statt fest bei SPLIT_AB zu stehen.
const BOARD_MINDEST = 520;
// Grenzen der ziehbaren Breite. Darunter passt das Raster nicht mehr sinnvoll
// in sieben Spalten, darueber bleibt vom Board zu wenig.
const BREITE_MIN = 360;
const BREITE_MAX = 720;
const BREITE_KEY = "kalBreite";

// 0 = keine eigene Breite gezogen. Dann gilt weiter --kal-breite aus dem CSS
// und die alte feste Grenze - wer nie zieht, merkt von der Aenderung nichts.
// Steht hier oben, weil pflegeBreit() schon beim Laden istSplit() ruft.
function gemerkteBreite() {
  const roh = Number(localStorage.getItem(BREITE_KEY));
  return roh >= BREITE_MIN && roh <= BREITE_MAX ? roh : 0;
}
// Gemerkte Ansicht: "liste" (Streifen zu), "kalender" oder "fokus". EIN
// Schluessel fuer beide Modi - wer den Streifen am Rechner zuklappt, will ihn
// beim naechsten Laden auch nicht sehen, und am Handy gilt dasselbe.
// Alte Werte ("tag" aus der Dreiteilung) werden beim Lesen als "kalender"
// verstanden - alles ausser "liste" und "fokus" heisst Kalender.
const ANSICHT_KEY = "kalAnsicht";

// Was steht im UNTEREN Teil des Streifens: "kalender" (Monatsraster) oder
// "fokus" (Gewohnheiten bzw. Timer). Die Tagesliste DARUEBER steht immer da
// und gehoert keinem der beiden - sie ist der Grund, warum es den Streifen
// gibt. Bis zum 13.08.2026 teilten sich alle drei denselben Platz; ein Blick
// auf die Gewohnheiten kostete damit genau die Antwort auf "was ist heute
// faellig", fuer die man aufgemacht hatte.
let kalUntenModus = "kalender";

function istSplit() {
  const eigen = gemerkteBreite();
  // Mit eigener Breite wandert die Grenze mit: ein schmal gezogener Streifen
  // erlaubt den Split frueher, ein breiter spaeter. Bei der Standardbreite
  // kommt rechnerisch dieselbe Grenze heraus wie vorher.
  return eigen ? window.innerWidth >= eigen + BOARD_MINDEST
               : window.innerWidth >= SPLIT_AB;
}

/**
 * Die Klasse `breit` am <html> sagt dem CSS, ob NEBENEINANDER ueberhaupt geht -
 * unabhaengig davon, ob gerade ein Panel offen ist. `kal-split` allein reicht
 * dafuer nicht mehr: seit es ein zweites Panel gibt (fokus.js), kann der
 * rechte Streifen auch ohne Kalender belegt sein, und Regeln wie "die
 * Umschalter-Zeile im Panel ausblenden" gelten dann trotzdem.
 */
function pflegeBreit() {
  document.documentElement.classList.toggle("breit", istSplit());
}
pflegeBreit();

let kalOffen = false;
let kalJahr = 0;         // angezeigter Monat
let kalMonatNr = 0;      // 0-basiert, wie bei Date
let kalAuswahl = null;   // ISO-Tag oder null (vor dem ersten Zeichnen)

// Vollbild: Tagesliste weg, Raster ueber die ganze Hoehe. Absichtlich NICHT
// gemerkt - beim naechsten Oeffnen saehe man eine App ohne Tagesliste und
// wuesste nicht, warum.
let kalVollbild = false;
// Wie viele Zeilen (Balken oder ToDo) eine Tageszelle im Vollbild traegt.
// 0 = noch nicht gemessen; gefuellt wird es aus der echten Zellenhoehe, weil
// die von der Bildschirmhoehe und der Zahl der Wochen abhaengt.
let vollbildPlaetze = 0;

// Wohin das Board gescrollt war, bevor der Kalender die Ansicht uebernahm.
// Unterhalb der Split-Grenze wird das Board ausgeblendet, und display:none
// wirft die Scrollposition weg - also merken wir sie selbst.
let listeScroll = 0;

// Liegt gerade ein eigener Verlaufseintrag fuer die Kalenderansicht? Nur
// unterhalb der Split-Grenze - im Split steht ohnehin beides nebeneinander.
let historieEintrag = false;
// Laeuft das Schliessen gerade AUS popstate heraus? Dann darf setzePanel den
// Eintrag nicht noch einmal zuruecknehmen, sonst schiebt sich der Verlauf
// gegenseitig und der Zurueck-Knopf springt zwei Schritte.
let ausPopstate = false;

// ---------- Google-Kalender (nur lesen) ----------
// Die Verbindung haelt der Server (functions/api/google/), die App bekommt
// fertige Termine und kennt kein Google-Token. `moeglich` bleibt false,
// solange im Pages-Projekt keine Zugangsdaten liegen - dann existiert die
// Funktion fuer den Nutzer gar nicht, statt ins Leere zu laufen.
let googleZustand = { moeglich: false, verbunden: false, email: null, schreiben: false, kalender: [], palette: {} };
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
let todoEingabeOffen = false;
// Steht der Quellen-Umschalter offen? Bewusst NICHT gemerkt: er ist eine
// Einstellung, die man selten anfasst, und zugeklappt gehoeren seine 37 px
// dem Tagesbereich. Dass etwas abgewaehlt ist, sieht man am gefaerbten
// Trichter im Kopf.
let filterOffen = false;

// Termin-Formular (eigener Dialog): offen ja/nein, welcher Termin (null =
// neuer), auf welchen Tag er sich bezieht, und die Feldwerte. Auch die liegen
// hier und nicht im DOM - der Dialog baut sich bei jeder Aenderung neu auf,
// ein halb ausgefuelltes Formular waere sonst weg.
let formularOffen = false;
let formularTermin = null;   // das Termin-Objekt, null = neuer Termin
let formularTag = null;      // ISO-Tag, auf den sich ein neuer Termin bezieht
let formularFelder = null;
let loeschFrage = false;

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
      googleZustand.palette = d.palette || {};
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
//
// Im Vollbild gilt der gemessene Platz der Zelle - abzueglich EINER Zeile.
// Die bleibt der Rest-Anzeige vorbehalten ("+3"): ohne sie fraessen an einem
// vollen Tag die Termine alle Zeilen auf, und die ToDos verschwaenden
// stillschweigend - ein Tag saehe erledigt aus, obwohl noch etwas ansteht.
// Vor der ersten Messung ein grosszuegiger Wert: zu viele Spuren kosten nur
// einen zweiten Zeichendurchgang, zu wenige zeigten beim ersten Bild zu wenig.
const MAX_SPUREN = 2;
function maxSpuren() {
  return kalVollbild ? Math.max(1, (vollbildPlaetze || 6) - 1) : MAX_SPUREN;
}

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

  const grenze = maxSpuren();
  const belegt = {};   // iso -> Set der schon vergebenen Spuren
  for (const e of sichtbar) {
    let spur = -1;
    for (let s = 0; s < grenze; s++) {
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
  zeichneFilter();
  zeichneWahl();
  // Das Raster arbeitet mit dem Spurenplan (feste Reihen), die Tagesliste mit
  // der zeitlichen Sortierung - zwei verschiedene Fragen an dieselben Daten.
  zeichneRaster(tage, baueSpurenplan(), heute);
  zeichneTagesliste(tage, tageTermine, ueberfaellige, heute);
  zeichneUnten();

  // Im Vollbild haengt der Zelleninhalt an der Zellenhoehe. Direkt hier
  // nachmessen, nicht per requestAnimationFrame: clientHeight erzwingt den
  // Umbruch selbst, ein eventueller zweiter Durchgang laeuft dadurch noch vor
  // dem Zeichnen (kein Aufblitzen) - und in einem Hintergrund-Tab, wo rAF gar
  // nicht feuert, bliebe die Messung sonst liegen.
  if (kalVollbild) messeVollbild();

  // Laeuft nebenher und zeichnet bei neuen Daten selbst noch einmal; ist der
  // Zeitraum schon geladen (oder gar kein Google verknuepft), kostet der
  // Aufruf nichts.
  ladeGoogle();
}

/* ---------- Vollbild ---------- */
// Hoehe einer Zeile im Raster: 15px Balken bzw. ToDo-Zeile plus 1px Luecke
// (siehe .kal-balken / .kal-tag-todo im CSS).
const ZEILE_HOCH = 16;
// Riegel gegen ein Hin und Her: waehrend des Nachlaufs wird nicht neu gemessen.
let messLauf = false;

/**
 * Wie viele Zeilen traegt eine Tageszelle im Vollbild?
 *
 * Gemessen statt geraten: die Zellenhoehe haengt am Bildschirm und daran, ob
 * der Monat vier, fuenf oder sechs Wochenzeilen hat. Ein fester Wert waere auf
 * dem einen Geraet zu knapp und auf dem anderen halb leer.
 *
 * Aendert sich der Wert, wird EINMAL neu gezeichnet; der zweite Durchgang
 * misst denselben Wert und bricht ab. Die Zellenhoehe haengt dank
 * grid-auto-rows: 1fr nicht am Inhalt, ein Hin und Her kann also gar nicht
 * entstehen - der Zaehler ist nur der Riegel davor, falls das CSS eines Tages
 * doch anders aussieht.
 */
function messeVollbild() {
  if (!kalVollbild || !kalOffen || messLauf) return;
  const zelle = kalRaster.querySelector(".kal-tag");
  if (!zelle) return;
  const zahl = zelle.querySelector(".kal-zahl");
  // Zellenhoehe minus Tageszahl, Innenabstand oben und der 3px Fuss des
  // Balken-/ToDo-Stapels.
  const frei = zelle.clientHeight - ((zahl && zahl.offsetHeight) || 14) - 5 - 3;
  const plaetze = Math.max(1, Math.floor(frei / ZEILE_HOCH));
  if (plaetze === vollbildPlaetze) return;
  vollbildPlaetze = plaetze;
  messLauf = true;
  try { zeichneKalender(); } finally { messLauf = false; }
}

function setzeVollbild(an) {
  if (kalVollbild === an) return;
  kalVollbild = an;
  vollbildPlaetze = 0;   // andere Hoehe, andere Zahl - neu messen
  kalPanel.classList.toggle("vollbild", an);
  zeichneKalender();   // zeichneUnten() raeumt den unteren Teil mit weg
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

  // Bei nur einer Quelle gibt es nichts zu waehlen - dann faellt auch der
  // Trichter im Kopf weg.
  const gibtsWas = quellen.length >= 2;
  // Ist irgendetwas abgewaehlt? Dann faerbt sich der Trichter, sonst wuesste
  // man bei zugeklapptem Filter nicht, warum im Raster etwas fehlt.
  const etwasAus = quellen.some(q => !quelleAn(q.schluessel));
  kalFilterKnopf.hidden = !gibtsWas;
  kalFilterKnopf.classList.toggle("aktiv", etwasAus);
  kalFilterKnopf.classList.toggle("offen", filterOffen);
  kalFilterKnopf.setAttribute("aria-expanded", String(filterOffen && gibtsWas));

  const zeigen = gibtsWas && filterOffen;
  kalFilter.hidden = !zeigen;
  kalFilter.innerHTML = "";
  if (!zeigen) return;

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

/* ---------- Monat und Jahr direkt waehlen ---------- */
/**
 * Eigener Dialog mit zwei Walzen: Monat links, Jahr rechts. Was in der Mitte
 * einrastet, gilt sofort - der Kalender dahinter zieht mit, geschlossen wird
 * ueber ✕ oder einen Tipp daneben.
 *
 * Frueher war das ein Block, der sich zwischen Kopfzeile und Raster schob -
 * er zog Raster und Tagesliste nach unten, am Handy bis aus dem Bild heraus.
 * Ein Dialog legt sich darueber und laesst den Kalender stehen, wo er ist.
 *
 * Davor stand hier ein Kachelraster mit Jahres-Pfeilen und einem
 * Zwei-Schritt-Weg (erst Jahr blaettern, dann Monat tippen). Das Rad braucht
 * dafuer nur eine Geste, und lange Monatsnamen passen wieder hinein - im
 * Raster mussten sie auf drei Buchstaben gekuerzt werden.
 */
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                "Juli", "August", "September", "Oktober", "November", "Dezember"];
let wahlOffen = false;
// Entwurfsstand des Rades. Gedreht wird zunaechst nur hier - erst "Übernehmen"
// traegt es in den Kalender. Vorher sprang der Kalender bei jedem
// Vorbeidrehen mit, und wer sich verdrehte, kam nur durch erneutes Drehen
// wieder zurueck: Schliessen war dann keine Rueckname mehr, sondern nur noch
// das Ende einer schon vollzogenen Aenderung.
let wahlJahr = null;
let wahlMonat = null;
// Steht das Rad schon im DOM? Ein Einrasten laesst den Kalender neu zeichnen,
// und der ruft zeichneWahl() mit - ohne dieses Flag baute sich das Rad dabei
// selbst neu auf, verloere seine Scrollposition und loeste damit das naechste
// Scroll-Ereignis aus. Eine Schleife, die man nicht mehr anhalten kann.
let radGebaut = false;
// Zeilenhoehe der Walzen in px. Gehoert zu --rad-zeile in style.css - die
// Rechnung "welcher Wert steht in der Mitte" haengt an genau dieser Zahl.
const RAD_ZEILE = 40;
// Wie weit die Jahreswalze reicht. Termine liegen praktisch nie weiter weg;
// wer doch dorthin will, blaettert mit den Pfeilen im Kopf des Kalenders.
const JAHR_ZURUECK = 5;
const JAHR_VOR = 10;

function schalteWahl() {
  wahlOffen = !wahlOffen;
  // Beim Aufklappen faengt der Entwurf da an, wo der Kalender gerade steht.
  if (wahlOffen) { wahlJahr = kalJahr; wahlMonat = kalMonatNr; }
  zeichneWahl();
}

function schliesseWahl() {
  if (!wahlOffen) return;
  wahlOffen = false;
  zeichneWahl();
}

function jahrBereich() {
  const jetzt = new Date().getFullYear();
  let von = jetzt - JAHR_ZURUECK, bis = jetzt + JAHR_VOR;
  // Wer ueber die Pfeile weit hinausgeblaettert hat, soll sein Jahr im Rad
  // trotzdem wiederfinden.
  if (kalJahr < von) von = kalJahr;
  if (kalJahr > bis) bis = kalJahr;
  const jahre = [];
  for (let j = von; j <= bis; j++) jahre.push(j);
  return jahre;
}

/**
 * Eine Walze: eine scrollbare Spalte, in der immer ein Wert in der Mitte
 * einrastet (scroll-snap). Ober- und unterhalb steht Luft von zwei Zeilen,
 * sonst kaeme der erste und letzte Wert nie in die Mitte.
 *
 * Gerechnet wird beim Anhalten, nicht bei jedem Scroll-Ereignis: waehrend des
 * Schwungs stuende sonst jeder durchlaufende Monat kurz im Kalender.
 */
function baueWalze(werte, aktiv, beiWahl) {
  const spalte = document.createElement("div");
  spalte.className = "kal-rad-spalte";

  const luft = () => {
    const d = document.createElement("div");
    d.className = "kal-rad-luft";
    return d;
  };
  spalte.appendChild(luft());

  werte.forEach((w, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kal-rad-wert" + (i === aktiv ? " gewaehlt" : "");
    b.textContent = w.text;
    b.dataset.radIndex = String(i);
    // Ein Tipp uebernimmt SOFORT und scrollt zusaetzlich hin. Nur zu scrollen
    // und auf das Einrasten zu warten waere elegantere Theorie: klickt jemand
    // den Wert an, der schon in der Mitte steht, bewegt sich nichts - und ohne
    // Scroll-Ereignis passierte dann auch nichts. Der Scroll-Handler unten
    // rechnet dasselbe Ergebnis noch einmal aus, das schadet nicht.
    b.addEventListener("click", () => {
      markiereWalze(spalte, i);
      beiWahl(werte[i].wert);
      spalte.scrollTo({ top: i * RAD_ZEILE, behavior: "smooth" });
    });
    spalte.appendChild(b);
  });

  spalte.appendChild(luft());

  let ruhe = null;
  spalte.addEventListener("scroll", () => {
    clearTimeout(ruhe);
    ruhe = setTimeout(() => {
      const i = Math.max(0, Math.min(werte.length - 1,
        Math.round(spalte.scrollTop / RAD_ZEILE)));
      markiereWalze(spalte, i);
      beiWahl(werte[i].wert);
    }, 120);
  });

  // Die Startposition kann hier noch nicht gesetzt werden: die Spalte haengt
  // noch nicht im Dokument, hat also keine Hoehe - und scrollTop bliebe still
  // auf 0. Sie wird deshalb gemerkt und nach dem Einhaengen gesetzt.
  spalte.dataset.radStart = String(aktiv);
  return spalte;
}

function markiereWalze(spalte, index) {
  for (const b of spalte.querySelectorAll(".kal-rad-wert")) {
    b.classList.toggle("gewaehlt", Number(b.dataset.radIndex) === index);
  }
}

function zeichneWahl() {
  kalWahl.hidden = !wahlOffen;
  kalMonatName.classList.toggle("offen", wahlOffen);
  if (!wahlOffen) {
    kalWahlBox.replaceChildren();
    radGebaut = false;
    return;
  }
  // Steht das Rad schon, gilt: Finger weg. Der Nutzer scrollt gerade darin.
  if (radGebaut) return;
  radGebaut = true;
  kalWahlBox.replaceChildren();

  const kopf = document.createElement("p");
  kopf.className = "kal-popup-kopf";
  kopf.appendChild(document.createTextNode("Monat wählen"));
  // Was gerade gewaehlt IST, in Worten. Die Markierung im Rad allein reichte
  // nicht: sie zeigt zwei Walzen getrennt, und welche Kombination daraus
  // gilt, musste man sich zusammenreimen.
  const stand = document.createElement("span");
  stand.className = "kal-wahl-stand";
  kopf.appendChild(stand);
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "kal-schliessen";
  zu.setAttribute("aria-label", "Abbrechen");
  zu.title = "Abbrechen";
  zu.textContent = "✕";
  zu.addEventListener("click", schliesseWahl);
  kopf.appendChild(zu);
  kalWahlBox.appendChild(kopf);

  const rad = document.createElement("div");
  rad.className = "kal-rad";

  // Das Fenster liegt UEBER den Walzen und zeigt, welche Zeile gilt. Als
  // eigenes Element, weil es sich nicht mitscrollen darf.
  const fenster = document.createElement("div");
  fenster.className = "kal-rad-fenster";
  rad.appendChild(fenster);

  rad.appendChild(baueWalze(
    MONATE.map((name, i) => ({ text: name, wert: i })),
    wahlMonat,
    monat => { wahlMonat = monat; zeigeWahlStand(); }));

  const jahre = jahrBereich();
  rad.appendChild(baueWalze(
    jahre.map(j => ({ text: String(j), wert: j })),
    jahre.indexOf(wahlJahr),
    jahr => { wahlJahr = jahr; zeigeWahlStand(); }));

  kalWahlBox.appendChild(rad);

  const fuss = document.createElement("div");
  fuss.className = "kal-wahl-fuss";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn primary";
  ok.textContent = "Übernehmen";
  ok.addEventListener("click", () => {
    // Werte sichern: schliesseWahl() zeichnet neu, und zeigeMonat() setzt
    // kalJahr/kalMonatNr - der Entwurf soll dabei nicht unter der Hand
    // ueberschrieben werden.
    const j = wahlJahr, m = wahlMonat;
    schliesseWahl();
    zeigeMonat(j, m);
  });
  fuss.appendChild(ok);
  kalWahlBox.appendChild(fuss);

  zeigeWahlStand();

  // Jetzt steht das Rad im Dokument und hat Hoehe - erst hier laesst sich der
  // gewaehlte Wert in die Mitte schieben. Ohne Animation: das Rad soll beim
  // Aufklappen dastehen, nicht erst hinfahren.
  for (const spalte of rad.querySelectorAll(".kal-rad-spalte")) {
    spalte.scrollTop = Number(spalte.dataset.radStart) * RAD_ZEILE;
  }
}

// Nur diese eine Zeile nachziehen, nicht das ganze Rad: das steht mitten im
// Scrollen und darf sich nicht unter dem Finger neu aufbauen.
function zeigeWahlStand() {
  const el = kalWahlBox.querySelector(".kal-wahl-stand");
  if (el) el.textContent = `${MONATE[wahlMonat]} ${wahlJahr}`;
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
  // Das CSS rechnet daraus die Wunsch- und die Mindesthoehe des Rasters (siehe
  // --kal-zeilen in style.css). Ein Monat mit 5 Wochen soll nicht so hoch sein
  // wie einer mit 6, und schrumpfen darf es nur bis zur Untergrenze.
  kalRaster.style.setProperty("--kal-zeilen", String(zeilen));
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
  // Rot faerbt nur faelliges ToDo-Datum, nie ein vergangener Termin. HEUTE
  // zaehlt mit: was heute drankommt, ist genauso dringend wie Liegengebliebenes
  // - die Regel im Raster ist damit schlicht "rot = da liegt was an".
  if (todosDesTages.length && iso <= heute) zelle.classList.add("faellig");
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

  // Im Vollbild stehen die ToDos im Klartext unter den Terminen - das ist der
  // eigentliche Gewinn der grossen Ansicht. Wie viele hineinpassen, sagt die
  // gemessene Zellenhoehe abzueglich der Balken, die diese WOCHE braucht (je
  // Woche, nicht je Tag - sonst staende jeder Tag auf anderer Hoehe).
  if (kalVollbild && (todosDesTages.length || ueberzaehlig[iso])) {
    const frei = Math.max(0, (vollbildPlaetze || 0) - (spurenJeWoche[wocheVon(tag)] || 0));
    // Termine, die schon im Raster keine Spur mehr bekommen haben, zaehlen in
    // dieselbe Restzahl - es geht um die Frage "was steht hier noch?", nicht
    // um die Herkunft.
    const restTermine = ueberzaehlig[iso] || 0;
    // Passt nicht alles, geht der letzte Platz an die "+n"-Zeile: lieber eine
    // ehrliche Restzahl als eine stillschweigend abgeschnittene Liste.
    const passtAlles = !restTermine && todosDesTages.length <= frei;
    const zeige = passtAlles ? todosDesTages.length : Math.max(0, frei - 1);
    const rest = todosDesTages.length - zeige + restTermine;

    const liste = document.createElement("span");
    liste.className = "kal-tag-todos";
    for (const t of todosDesTages.slice(0, zeige)) {
      const zeile = document.createElement("span");
      zeile.className = "kal-tag-todo";
      const punkt = document.createElement("span");
      punkt.className = "kal-punkt" + (t.farbe ? " farbe-" + t.farbe : "");
      zeile.appendChild(punkt);
      const text = document.createElement("span");
      text.className = "kal-tag-todo-text";
      text.textContent = t.text;
      zeile.appendChild(text);
      liste.appendChild(zeile);
    }
    if (rest > 0 && frei > 0) {
      const mehr = document.createElement("span");
      mehr.className = "kal-tag-mehr";
      mehr.textContent = "+" + rest;
      liste.appendChild(mehr);
    }
    zelle.appendChild(liste);
  }

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
  if (kalAuswahl) {
    const [j, m, t] = kalAuswahl.split("-").map(Number);
    titel = TAG_FORMAT.format(new Date(j, m - 1, t));
    todosDesTages = tage[kalAuswahl] || [];
    termineDesTages = tageTermine[kalAuswahl] || [];
  } else {
    // Sollte nicht vorkommen (jedes Oeffnen waehlt heute), aber ein leerer
    // Bereich ist die ehrlichere Antwort als eine erfundene.
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

  // Ein gewaehlter Tag hat feste Abschnitte, jeder mit eigener Ueberschrift -
  // der ToDo-Abschnitt auch dann, wenn er leer ist. Ein leerer Abschnitt ist
  // die ehrlichere Antwort auf "was ist an dem Tag?" als gar keiner, und das
  // ＋ sitzt genau da, wo man es sucht.
  if (kalAuswahl) {
    // Faelliges ist ROT - Ueberschrift und Zeilenrand. Das ist die Regel aus
    // dem Raster ("rot = da liegt was an"), hier zu Ende gefuehrt: wer den
    // Streifen aufmacht, soll sehen, was drueckt, ohne erst zu lesen.
    const faelligHeute = kalAuswahl === heute;

    // Liegengebliebenes gehoert an den Anfang des heutigen Tages: es ist
    // faellig, nur eben schon laenger. Bis zum 13.08.2026 lag es allein hinter
    // einem ⚠-Chip ueber dem Raster - wer nur auf "heute" schaute, sah es also
    // nie. Der Chip ist raus, seit es hier steht: derselbe Inhalt zweimal,
    // und die 41 px fehlten dem Tagesbereich. An anderen Tagen hat es nichts
    // zu suchen, dort ist es weder faellig noch entstanden.
    if (faelligHeute && ueberfaellige.length) {
      kalTagesliste.appendChild(baueGruppenKopf(
        `Überfällig (${ueberfaellige.length})`, null, null, true));
      for (const t of ueberfaellige) kalTagesliste.appendChild(baueEintrag(t, true, true));
    }

    kalTagesliste.appendChild(baueGruppenKopf("ToDos", aktiveListe
      ? () => {
          todoEingabeOffen = true;
          zeichneKalender();
          // Direkt ins Feld: am Handy geht damit die Tastatur gleich mit auf.
          const feld = kalTagesliste.querySelector(".kal-anlegen-feld");
          if (feld) feld.focus();
        } : null,
      "ToDo", faelligHeute && todosDesTages.length > 0));
    if (todoEingabeOffen && aktiveListe) kalTagesliste.appendChild(baueAnlegeZeile(kalAuswahl));
    for (const t of todosDesTages) {
      kalTagesliste.appendChild(baueEintrag(t, false, faelligHeute));
    }
    if (!todosDesTages.length) kalTagesliste.appendChild(baueLeerZeile("Nichts fällig."));

    // Termine stehen unter den ToDos: der Streifen beantwortet zuerst "was
    // muss ich heute tun", und die Termin-Ueberschrift samt Leerzeile schob
    // diese Antwort vorher jedes Mal nach unten aus dem Blick.
    //
    // Ganztaegige bekommen einen eigenen Abschnitt und stehen zuerst: sie
    // rahmen den Tag, statt in ihm zu liegen, und zwischen den Uhrzeiten
    // standen sie als zeitlose Zeilen ohne erkennbare Ordnung.
    const terminePlus = googleZustand.verbunden && googleZustand.schreiben
      ? () => oeffneTerminFormular(kalAuswahl, null) : null;
    const ganztags = termineDesTages.filter(e => e.termin.ganztags);
    const mitZeit  = termineDesTages.filter(e => !e.termin.ganztags);

    if (ganztags.length) {
      kalTagesliste.appendChild(baueGruppenKopf("Ganztägig", terminePlus, "Termin"));
      for (const e of ganztags) kalTagesliste.appendChild(baueTerminZeile(e.termin));
    }
    // Das ＋ haengt am ERSTEN sichtbaren Termin-Abschnitt, damit es genau
    // einmal vorkommt und immer an derselben Stelle steht: oben bei den
    // Terminen. Stehen keine ganztaegigen da, wandert es hierher.
    if (mitZeit.length || !ganztags.length) {
      kalTagesliste.appendChild(baueGruppenKopf("Termine",
        ganztags.length ? null : terminePlus, "Termin"));
      for (const e of mitZeit) kalTagesliste.appendChild(baueTerminZeile(e.termin));
      if (!mitZeit.length) {
        kalTagesliste.appendChild(baueLeerZeile(googleZustand.verbunden
          ? "Keine Termine." : "Kein Google-Kalender verbunden."));
      }
    }
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

/* ---------- Termin-Formular ---------- */

function zeitAus(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "09:00"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Formularwerte aus einem bestehenden Termin - oder Vorgaben fuer einen neuen.
function felderAusTermin(tag, t) {
  if (!t) {
    return { titel: "", ganztags: true, startDatum: tag, endDatum: tag,
             vonZeit: "09:00", bisZeit: "10:00", farbe: "", notiz: "", ort: "" };
  }
  if (t.ganztags) {
    // Google liefert das Ende ganztaegiger Termine als ersten Tag DANACH -
    // im Formular gehoert der letzte echte Tag hin.
    let ende = t.start;
    if (t.ende) {
      const d = new Date(t.ende + "T00:00:00");
      d.setDate(d.getDate() - 1);
      ende = isoVonDate(d);
      if (ende < t.start) ende = t.start;
    }
    return { titel: t.titel, ganztags: true, startDatum: t.start, endDatum: ende,
             vonZeit: "09:00", bisZeit: "10:00", farbe: t.colorId || "",
             notiz: t.beschreibung || "", ort: t.ort || "" };
  }
  const start = new Date(t.start);
  const ende = t.ende ? new Date(t.ende) : null;
  return {
    titel: t.titel, ganztags: false,
    startDatum: isNaN(start) ? tag : isoVonDate(start),
    endDatum: (ende && !isNaN(ende)) ? isoVonDate(ende) : (isNaN(start) ? tag : isoVonDate(start)),
    vonZeit: zeitAus(t.start), bisZeit: t.ende ? zeitAus(t.ende) : "10:00",
    farbe: t.colorId || "", notiz: t.beschreibung || "", ort: t.ort || "",
  };
}

/**
 * Termin anlegen oder bearbeiten - im eigenen Dialog, am Handy ueber den
 * ganzen Bildschirm.
 *
 * Vorher klappte das Formular in der Tagesliste auf. Dort teilte es sich die
 * Hoehe mit Raster und Liste, und am Handy war die Haelfte davon nicht zu
 * sehen: man tippte den Titel, scrollte zu den Datumsfeldern, scrollte
 * weiter zum Anlegen-Knopf. Neu und Bearbeiten teilen sich denselben Dialog -
 * es ist dasselbe Formular, nur mit anderer Ueberschrift.
 */
function oeffneTerminFormular(tag, termin) {
  formularOffen = true;
  formularTermin = termin || null;
  formularTag = tag;
  formularFelder = felderAusTermin(tag, termin);
  loeschFrage = false;
  todoEingabeOffen = false;
  zeichneKalender();
  zeichneTerminPopup();
  const feld = kalTerminBox.querySelector(".kal-form-titel");
  // Nur am Rechner von selbst ins Feld springen: am Handy schoebe die
  // Tastatur den halben Dialog aus dem Bild, bevor man ihn gesehen hat.
  if (feld && !("ontouchstart" in window)) feld.focus();
}

function schliesseTerminFormular() {
  if (!formularOffen) return;
  formularOffen = false;
  formularTermin = null;
  formularTag = null;
  formularFelder = null;
  loeschFrage = false;
  zeichneTerminPopup();
  zeichneKalender();
}

// Baut den Dialog neu. Bewusst NICHT aus zeichneKalender() heraus: das laeuft
// auch bei jedem Sync vom Server, und ein Formular, das einem beim Tippen
// unter den Fingern neu entsteht, verliert Fokus und Cursorposition.
function zeichneTerminPopup() {
  kalTerminPopup.hidden = !formularOffen;
  kalTerminBox.innerHTML = "";
  if (!formularOffen) return;

  const kopf = document.createElement("p");
  kopf.className = "kal-popup-kopf";
  kopf.appendChild(document.createTextNode(formularTermin ? "Termin bearbeiten" : "Neuer Termin"));
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "kal-schliessen";
  zu.setAttribute("aria-label", "Schließen");
  zu.textContent = "✕";
  zu.addEventListener("click", schliesseTerminFormular);
  kopf.appendChild(zu);
  kalTerminBox.appendChild(kopf);

  kalTerminBox.appendChild(baueTerminFormular(formularTag, formularTermin));
}

function baueTerminFormular(tag, termin) {
  const f = formularFelder;
  const box = document.createElement("div");
  box.className = "kal-form";

  const titel = document.createElement("input");
  titel.type = "text";
  titel.className = "kal-form-titel";
  titel.placeholder = "Titel des Termins";
  titel.value = f.titel;
  titel.addEventListener("input", () => { f.titel = titel.value; });
  box.appendChild(titel);

  // Ganztaegig blendet die Uhrzeitfelder weg - deshalb neu zeichnen.
  const schalter = document.createElement("label");
  schalter.className = "kal-form-schalter";
  const haken = document.createElement("input");
  haken.type = "checkbox";
  haken.checked = f.ganztags;
  haken.addEventListener("change", () => { f.ganztags = haken.checked; zeichneTerminPopup(); });
  schalter.appendChild(haken);
  schalter.appendChild(document.createTextNode(" Ganztägig"));
  box.appendChild(schalter);

  const datumZeile = (beschriftung, datumsWert, beimDatum, zeitWert, beimZeit) => {
    const zeile = document.createElement("div");
    zeile.className = "kal-form-zeile";
    const label = document.createElement("span");
    label.className = "kal-form-label";
    label.textContent = beschriftung;
    zeile.appendChild(label);
    const d = document.createElement("input");
    d.type = "date";
    d.value = datumsWert;
    d.addEventListener("change", () => beimDatum(d.value));
    zeile.appendChild(d);
    if (!f.ganztags) {
      const z = document.createElement("input");
      z.type = "time";
      z.value = zeitWert;
      z.addEventListener("change", () => beimZeit(z.value));
      zeile.appendChild(z);
    }
    return zeile;
  };
  box.appendChild(datumZeile("Von", f.startDatum, v => {
    f.startDatum = v;
    if (f.endDatum < v) f.endDatum = v;   // Ende zieht mit, statt ungueltig zu werden
  }, f.vonZeit, v => { f.vonZeit = v; }));
  box.appendChild(datumZeile("Bis", f.endDatum, v => { f.endDatum = v; }, f.bisZeit, v => { f.bisZeit = v; }));

  // Farbauswahl aus Googles eigener Palette - eine eigene Farbskala waere im
  // Google-Kalender hinterher nicht wiederzuerkennen.
  const farben = document.createElement("div");
  farben.className = "kal-form-farben";
  const knopfFarbe = (id, hex, name) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kal-farbe" + (String(f.farbe) === String(id) ? " gewaehlt" : "") + (id ? "" : " kal-farbe-standard");
    b.title = name;
    if (hex) b.style.background = hex;
    b.addEventListener("click", () => { f.farbe = id; zeichneTerminPopup(); });
    return b;
  };
  farben.appendChild(knopfFarbe("", null, "Farbe des Kalenders"));
  for (const [id, hex] of Object.entries(googleZustand.palette || {})) {
    farben.appendChild(knopfFarbe(id, farbWert(hex), "Farbe " + id));
  }
  box.appendChild(farben);

  const notiz = document.createElement("textarea");
  notiz.className = "kal-form-notiz";
  notiz.rows = 2;
  notiz.placeholder = "Notiz (optional)";
  notiz.value = f.notiz;
  notiz.addEventListener("input", () => { f.notiz = notiz.value; });
  box.appendChild(notiz);

  // Frueher stand hier nur ein vorhandener Ort als Text. Google nimmt das Feld
  // beim Schreiben genauso entgegen wie die Notiz - es gab keinen Grund, es
  // nicht bearbeitbar zu machen.
  const ortZeile = document.createElement("div");
  ortZeile.className = "kal-form-zeile";
  const ortLabel = document.createElement("span");
  ortLabel.className = "kal-form-label";
  ortLabel.textContent = "📍";
  const ortFeld = document.createElement("input");
  ortFeld.type = "text";
  ortFeld.placeholder = "Ort (optional)";
  ortFeld.value = f.ort;
  ortFeld.setAttribute("aria-label", "Ort");
  ortFeld.addEventListener("input", () => { f.ort = ortFeld.value; });
  ortZeile.append(ortLabel, ortFeld);
  box.appendChild(ortZeile);

  const knoepfe = document.createElement("div");
  knoepfe.className = "kal-form-knoepfe";

  const speichern = document.createElement("button");
  speichern.type = "button";
  speichern.className = "btn klein primary";
  speichern.textContent = termin ? "Speichern" : "Anlegen";
  speichern.addEventListener("click", () => speichereTermin(termin));
  knoepfe.appendChild(speichern);

  const abbrechen = document.createElement("button");
  abbrechen.type = "button";
  abbrechen.className = "btn klein";
  abbrechen.textContent = "Abbrechen";
  abbrechen.addEventListener("click", schliesseTerminFormular);
  knoepfe.appendChild(abbrechen);

  if (termin) {
    // Zwei Stufen: Loeschen bei Google ist endgueltig, und der Knopf sitzt
    // direkt neben "Speichern".
    const loeschen = document.createElement("button");
    loeschen.type = "button";
    loeschen.className = "btn klein gefahr";
    loeschen.textContent = loeschFrage ? "Wirklich löschen?" : "Löschen";
    loeschen.addEventListener("click", () => {
      if (!loeschFrage) { loeschFrage = true; zeichneTerminPopup(); return; }
      loescheTerminBeiGoogle(termin);
    });
    knoepfe.appendChild(loeschen);
  }

  box.appendChild(knoepfe);
  return box;
}

async function terminAnfrage(methode, rumpf) {
  try {
    const antwort = await fetch("/api/google/termin", {
      method: methode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rumpf),
    });
    if (antwort.ok) return true;
    const d = await antwort.json().catch(() => ({}));
    snackInfo(d.neuVerknuepfen
      ? "Dafür einmal in den Einstellungen trennen und neu verbinden."
      : (d.error || "Google hat die Änderung nicht angenommen."));
  } catch (e) {
    snackInfo("Keine Verbindung zu Google.");
  }
  return false;
}

async function speichereTermin(termin) {
  const f = formularFelder;
  if (!f || !f.titel.trim()) return;
  const rumpf = {
    ...f,
    titel: f.titel.trim(),
    zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
  };
  if (termin) rumpf.id = termin.id;
  const ok = await terminAnfrage(termin ? "PUT" : "POST", rumpf);
  if (!ok) return;
  schliesseTerminFormular();
  // Frisch holen statt von Hand nachzupflegen: so steht im Panel genau das,
  // was bei Google steht.
  googleGeladen = null;
  await ladeGoogle();
  snackInfo(termin ? "Termin geändert." : "Termin angelegt.");
}

async function loescheTerminBeiGoogle(termin) {
  const ok = await terminAnfrage("DELETE", { id: termin.id });
  if (!ok) return;
  schliesseTerminFormular();
  googleGeladen = null;
  await ladeGoogle();
  snackInfo("Termin gelöscht.");
}

/**
 * Anlege-Zeile unter dem gewaehlten Tag.
 *
 * Das ToDo landet in der gerade AKTIVEN Liste und dort ohne Bereich - der
 * Kalender kennt keinen Bereich, und "Ohne Bereich" ist genau der Auffang
 * dafuer; zuordnen laesst es sich danach auf dem Board wie jedes andere.
 *
 * Die Zeile schliesst sich nach dem Anlegen. Sie blieb einmal offen, damit man
 * mehrere hintereinander eintippen kann - nur gab es dann gar keinen Weg mehr
 * heraus: Escape leerte das Feld, schloss es aber nicht, und einen Abbrechen-
 * Knopf gab es nicht. Wer mehrere anlegen will, tippt wieder auf das ＋.
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
  alsToDo.textContent = "Anlegen";
  alsToDo.addEventListener("click", () => legeToDoAn(tag, feld.value));
  knoepfe.appendChild(alsToDo);

  const abbrechen = document.createElement("button");
  abbrechen.type = "button";
  abbrechen.className = "btn klein";
  abbrechen.textContent = "Abbrechen";
  abbrechen.addEventListener("click", schliesseAnlegeZeile);
  knoepfe.appendChild(abbrechen);

  zeile.appendChild(knoepfe);
  feld.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); legeToDoAn(tag, feld.value); }
    else if (e.key === "Escape") { e.stopPropagation(); schliesseAnlegeZeile(); }
  });
  return zeile;
}

// Escape stoppt oben die Weitergabe: sonst faenge der Panel-Handler den
// Tastendruck mit ab und schloesse gleich den ganzen Kalender.
function schliesseAnlegeZeile() {
  todoEingabeOffen = false;
  anlegenText = "";
  zeichneKalender();
}

function legeToDoAn(tag, text) {
  if (!text.trim() || !aktiveListe) return;
  const bereich = ohneBereichId(aktiveListe);
  if (!state.categories.some(c => c.id === bereich)) {
    state.categories.unshift({ id: bereich, name: OHNE_NAME });
  }
  anlegenText = "";
  todoEingabeOffen = false;
  addTodoTo(bereich, null, text, tag, null);   // rendert und speichert selbst
}

function baueGruppenKopf(text, beimPlus, einzahl, faellig) {
  const kopf = document.createElement("p");
  kopf.className = "kal-gruppe" + (faellig ? " faellig" : "");
  const beschriftung = document.createElement("span");
  beschriftung.textContent = text;
  kopf.appendChild(beschriftung);
  if (beimPlus) {
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "kal-gruppe-plus";
    plus.textContent = "＋";
    plus.title = `${einzahl || text} für diesen Tag anlegen`;
    plus.addEventListener("click", beimPlus);
    kopf.appendChild(plus);
  }
  return kopf;
}

function baueLeerZeile(text) {
  const p = document.createElement("p");
  p.className = "kal-leer";
  p.textContent = text;
  return p;
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

  // Darf die Verknuepfung schreiben, oeffnet ein Tipp den Termin zum
  // Bearbeiten - das ist dann die naheliegende Erwartung. Sonst bleibt es
  // beim Aufklappen der Details, und ohne Ort und Beschreibung gibt es gar
  // nichts anzutippen (ein Knopf, der mit "nichts da" antwortet, waere
  // schlechter als keiner).
  const bearbeitbar = googleZustand.verbunden && googleZustand.schreiben;
  const anklickbar = bearbeitbar || hatDetails;
  const knopf = document.createElement(anklickbar ? "button" : "div");
  knopf.className = "kal-eintrag kal-termin" + (offen ? " offen" : "") + (anklickbar ? "" : " kal-termin-still");
  if (anklickbar) {
    knopf.type = "button";
    knopf.addEventListener("click", () => {
      if (bearbeitbar) { oeffneTerminFormular(kalAuswahl, t); return; }
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

  // Herkunft nur bei WEITEREN Kalendern. Beim eigenen Hauptkalender stuende
  // hier der eigene Name (Google gibt als Bezeichnung die Mailadresse heraus,
  // die App setzt den Kontonamen ein) - der sagt nichts, was man nicht schon
  // weiss, und stand bei jedem einzelnen Termin.
  const herkunft = (kal && !kal.primaer) ? kalenderName(kal) : "";
  const meta = document.createElement("span");
  meta.className = "kal-eintrag-meta";
  meta.textContent = [zeitLabel(t), herkunft].filter(Boolean).join(" · ");
  text.appendChild(meta);

  knopf.appendChild(text);
  // Das Zeichen rechts sagt, was ein Tipp tut: Stift = oeffnet zum
  // Bearbeiten, Pfeil = klappt nur Ort und Notiz auf.
  if (bearbeitbar || hatDetails) {
    const zeichen = document.createElement("span");
    zeichen.className = "kal-termin-pfeil";
    zeichen.textContent = bearbeitbar ? "✏️" : (offen ? "▴" : "▾");
    knopf.appendChild(zeichen);
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

// Eine ToDo-Zeile der Tagesliste: Haken zum Erledigen + der Eintrag selbst,
// der wie gehabt zum ToDo auf dem Board springt. Der Rahmen gehoert der Zeile,
// nicht mehr dem Eintrag - sonst saehe der Haken aus, als stuende er neben der
// Karte statt darin.
function baueEintrag(t, mitDatum, faellig) {
  const zeile = document.createElement("div");
  zeile.className = "kal-todo-zeile" + (faellig ? " faellig" : "");

  // Der Kalender bearbeitet sonst nichts, aber Abhaken ist die eine Sache, die
  // man beim Blick auf "was ist heute faellig" tatsaechlich tun will. Laeuft
  // ueber toggleDone in app.js - mit boardId, denn die Tagesliste zeigt ToDos
  // aus allen Listen, nicht nur aus der gerade aktiven.
  const haken = document.createElement("label");
  haken.className = "kal-haken";
  haken.title = "Als erledigt abhaken";
  const kasten = document.createElement("input");
  kasten.type = "checkbox";
  kasten.className = "check";
  kasten.checked = !!t.done;
  kasten.addEventListener("change", () => toggleDone(t.id, t.boardId));
  haken.appendChild(kasten);
  zeile.appendChild(haken);

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
  zeile.appendChild(knopf);
  return zeile;
}

// ---------- Springen ----------
// Der Kalender bearbeitet selbst nichts: er holt die richtige Liste nach
// vorne und uebergibt an den Bearbeiten-Modus des Boards. Das kurze
// Aufblinken zeigt, wo man gelandet ist.
function springeZuToDo(boardId, todoId) {
  // Im Umschalt-Modus liegt der Kalender ueber dem Board und muss weichen,
  // sonst landet die Bearbeitung unsichtbar dahinter. Im Split steht das
  // Board schon daneben - dort waere Zuklappen ein ungefragter Rueckbau der
  // Ansicht, die man sich eingestellt hat.
  if (!istSplit()) schliesseKalender();
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
  // Im Vollbild gibt es keine Tagesliste. Ein Tipp fuehrt deshalb aus dem
  // Vollbild heraus zu genau diesem Tag - einen Tag nur zu markieren, dessen
  // Inhalt man gar nicht sehen kann, waere eine Sackgasse.
  if (kalVollbild) {
    kalAuswahl = iso;
    schliesseEingaben();
    setzeVollbild(false);
    return;
  }
  // Ein Tipp waehlt den Tag, ein zweiter auf denselben tut nichts. Frueher
  // schaltete er hier zwischen Tag und Fokus hin und her bzw. wählte ab - das
  // hatte seinen Grund, solange beide sich denselben Platz teilten. Seit die
  // Tagesliste immer dasteht, gibt es nichts wegzuschalten: ein leerer
  // Tagesbereich waere kein Zustand, den jemand haben will.
  kalAuswahl = iso;
  schliesseEingaben();
  setzePanel(kalOffen, true);
  aktualisiereAuswahl();
}

/**
 * Nur die Auswahl umhaengen, statt den ganzen Kalender neu zu zeichnen.
 *
 * Am Raster aendert ein Tageswechsel genau eine Klasse - alles andere
 * (Wochentage, Punkte, Balken, Zeilenzahl) bleibt, wie es ist. Es KOMPLETT neu
 * zu bauen hatte am Rechner eine haessliche Nebenwirkung: die angeklickte
 * Zelle verschwand mitsamt ihrem :hover aus dem Dokument, und der Ersatz
 * darunter bekam ihn erst beim naechsten Mausruck wieder. Fuer den Nutzer sah
 * das aus, als bliebe der Hover am alten Tag haengen.
 *
 * Die Tagesliste muss neu, die ist ja die eigentliche Antwort auf den Tipp.
 */
function aktualisiereAuswahl() {
  for (const zelle of kalRaster.querySelectorAll(".kal-tag")) {
    zelle.classList.toggle("gewaehlt", zelle.dataset.tag === kalAuswahl);
  }
  const todos = kalenderTermine();
  const heute = todayStr();
  zeichneTagesliste(nachTagen(todos), termineNachTagen(),
                    todos.filter(t => t.due < heute), heute);
}

// Halb ausgefuelltes Formular und offene Eingabe gehoeren zu EINEM Tag - beim
// Wechsel woandershin waeren sie nur noch Altlast.
function schliesseEingaben() {
  wahlOffen = false;
  formularOffen = false;
  formularTermin = null;
  formularTag = null;
  formularFelder = null;
  loeschFrage = false;
  todoEingabeOffen = false;
  anlegenText = "";
  kalWahl.hidden = true;
  kalTerminPopup.hidden = true;
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

// Einen Kalendertag weiter oder zurueck. Laeuft der neue Tag aus dem Monat
// heraus, blaettert das Raster mit - sonst zeigte es einen Monat, in dem der
// gewaehlte Tag gar nicht vorkommt.
function wechsleTag(schritt) {
  if (!kalAuswahl) return;
  const [j, m, t] = kalAuswahl.split("-").map(Number);
  const d = new Date(j, m - 1, t + schritt);
  kalAuswahl = isoVonDate(d);
  schliesseEingaben();
  if (d.getFullYear() !== kalJahr || d.getMonth() !== kalMonatNr) {
    kalJahr = d.getFullYear();
    kalMonatNr = d.getMonth();
  }
  zeichneKalender();
}

function springeZuHeute() {
  const heute = new Date();
  kalJahr = heute.getFullYear();
  kalMonatNr = heute.getMonth();
  // Der Tag wird immer gewaehlt, auch wenn unten gerade Fokus steht: sobald
  // jemand dorthin zurueckschaltet, soll der heutige Tag dastehen.
  kalAuswahl = todayStr();
  zeichneKalender();
}

// ---------- Oeffnen / Schliessen ----------
/**
 * Einzige Stelle, an der sich der Zustand des Panels niederschlaegt: Klassen,
 * Umschalter und der gemerkte Zustand haengen alle hier dran. Die vier
 * Aufrufer (Umschalter, Escape, Wisch, Wiederherstellen) setzen vorher
 * kalOffen und muessen sich sonst um nichts kuemmern.
 *
 * `sofort` laesst die Animation weg - beim Wiederherstellen nach dem Laden
 * soll der Kalender einfach dastehen und nicht erst hereinfahren.
 */
function setzePanel(offen, sofort) {
  const split = istSplit();
  // Unterhalb der Split-Grenze loesen Board und Kalender einander ab, statt
  // sich zu ueberlagern - dahinter liegt dann nichts mehr, was abgedunkelt
  // oder gegen Scrollen gesperrt werden muesste. Ob sich daran gerade etwas
  // aendert, muss VOR dem Umschalten der Klasse feststehen.
  const alsAnsicht = offen && !split;
  const wechselt = alsAnsicht !== document.documentElement.classList.contains("kal-ansicht");
  if (wechselt && alsAnsicht) listeScroll = window.scrollY;

  document.documentElement.classList.toggle("kal-split", offen && split);
  // Animiert wird nur im Split. Unterhalb loesen sich zwei Ansichten ab - da
  // faehrt nichts herein, und genau dieses Hereinfahren ruckelte, weil der
  // body gleichzeitig sein padding-right aenderte (ein Layout-Umbruch, der
  // nicht fluessig animieren kann).
  kalPanel.classList.toggle("animiert", !sofort && split);
  kalPanel.style.transform = offen ? "translateX(0)" : "";
  kalPanel.setAttribute("aria-hidden", offen ? "false" : "true");
  document.documentElement.classList.toggle("kal-offen", offen);
  document.documentElement.classList.toggle("kal-ansicht", alsAnsicht);
  // Zurueck zur Liste: dorthin, wo man sie verlassen hat.
  if (wechselt && !alsAnsicht) window.scrollTo(0, listeScroll);
  // Genau eines der beiden Segmente gilt: 📋 wenn der Streifen zu ist, sonst
  // 📅. WAS unten steht, sagen die Reiter dort - die Pille beantwortet nur
  // noch "Streifen auf oder zu".
  for (const seg of document.querySelectorAll(".ansicht-seg")) {
    const gilt = offen ? seg.dataset.ansicht === "kalender" : seg.dataset.ansicht === "liste";
    seg.setAttribute("aria-pressed", String(gilt));
  }
  // Der Zurueck-Knopf soll am Handy zur Liste fuehren statt die App zu
  // verlassen - fuer eine PWA vom Startbildschirm ist das der Unterschied
  // zwischen "eine Ansicht zurueck" und "weg".
  if (alsAnsicht && !historieEintrag) {
    historieEintrag = true;
    history.pushState({ kalender: true }, "");
  } else if (!alsAnsicht && historieEintrag) {
    historieEintrag = false;
    if (!ausPopstate) history.back();
  }

  try { localStorage.setItem(ANSICHT_KEY, offen ? kalUntenModus : "liste"); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

// Zurueck-Knopf des Browsers: eine Ansicht zurueck, nicht aus der App heraus.
// Der Eintrag ist zu diesem Zeitpunkt schon vom Browser abgeraeumt, deshalb
// darf setzePanel kein history.back() nachschieben.
window.addEventListener("popstate", () => {
  if (!historieEintrag) return;
  ausPopstate = true;
  historieEintrag = false;
  setzePanel(false);
  ausPopstate = false;
});

/**
 * Was steht unten: das Monatsraster oder Fokus. Die Sichtbarkeit haengt an
 * genau dieser Stelle, damit "immer genau eines" nicht an zwei Orten
 * entschieden wird. Die Tagesliste oben bleibt davon unberuehrt - nur das
 * Vollbild raeumt sie weg.
 *
 * Fokus gibt es nur mit Zugang UND eingeschaltetem Schalter in den
 * Einstellungen. Faellt eines der beiden weg, faellt ein gemerktes "fokus"
 * still auf den Kalender zurueck - sonst stuende der Streifen leer da.
 */
function fokusMoeglich() {
  return !!window.fokusHatZugang?.() && window.fokusImStreifen?.() !== false;
}

function zeichneUnten() {
  const mitFokus = fokusMoeglich();
  if (kalUntenModus === "fokus" && !mitFokus) kalUntenModus = "kalender";
  // Im Vollbild nimmt das Raster die ganze Hoehe - Fokus hat dort keinen Platz.
  // Der Modus bleibt gemerkt und steht beim Verlassen wieder da.
  const fokus = kalUntenModus === "fokus" && !kalVollbild;

  // Zwei Bloecke, genau einer sichtbar. Was INNERHALB des Kalender-Blocks
  // erscheint (Filter ja/nein), entscheidet zeichneFilter() selbst - vorher
  // wurden hier vier Einzelteile geschaltet, und jedes musste seine eigene
  // Entscheidung gegen diese hier verteidigen.
  kalOben.hidden = fokus;
  kalUnten.hidden = !fokus;
  if (fokus) window.fokusZeigen?.();
  else window.fokusVerstecken?.();

  // Die Tagesliste bleibt - nur im Vollbild nicht, dort gibt es sie nicht.
  kalTagesliste.hidden = kalVollbild;

  // Die Reiterzeile ueberlebt den Wechsel zum Kalender - sie ist der Weg
  // zurueck. Ohne Fokus (kein Zugang oder abgeschaltet) waere sie ein Reiter
  // allein.
  window.fokusReiterzeile?.(mitFokus && !kalVollbild);
  // Steht der Kalender vorn, markiert ihn niemand sonst: setzeReiter() in
  // fokus.js laeuft nur, wenn dort etwas gezeichnet wird.
  if (!fokus) {
    for (const seg of document.querySelectorAll(".fok-reiter-seg")) {
      seg.setAttribute("aria-selected", String(seg.dataset.fokReiter === "kalender"));
    }
  }
}

// Den oberen Teil umschalten, ohne den Streifen selbst anzufassen.
function setzeUnten(modus) {
  if (kalUntenModus === modus) return;
  kalUntenModus = modus;
  zeichneUnten();
  setzePanel(kalOffen, true);
}

// Gemerkte Ansicht wiederherstellen, einmalig. Haengt am ersten Zeichnen und
// nicht am Laden der Datei: erst danach steht fest, dass jemand angemeldet ist
// und Daten da sind. Vorher waere der Kalender leer und laege ausserdem hinter
// der Anmeldemaske.
let ansichtHergestellt = false;
function stelleAnsichtHer() {
  if (ansichtHergestellt) return;
  if (kalLock && !kalLock.classList.contains("hidden")) return;   // spaeter nochmal
  ansichtHergestellt = true;
  const gemerkt = localStorage.getItem(ANSICHT_KEY);
  // Ohne gemerkten Zustand entscheidet der Platz: am Rechner steht der
  // Streifen gleich daneben, am Handy naehme er der Liste den Bildschirm weg.
  // Alte Werte ("tag") heissen "kalender" - alles ausser "liste"/"fokus".
  const auf = gemerkt ? gemerkt !== "liste" : istSplit();
  if (!auf) { setzePanel(false, true); return; }
  // Ein gemerktes "fokus" gilt nur mit Zugang - zeichneUnten() faengt das ab.
  kalUntenModus = gemerkt === "fokus" ? "fokus" : "kalender";
  frischOeffnen();
  kalOffen = true;
  setzePanel(true, true);
  zeichneUnten();
}

// Jedes Oeffnen startet beim heutigen Tag UND in der normalen Ansicht. Ein
// gemerktes Vollbild saehe beim naechsten Mal aus wie eine kaputte App - die
// Tagesliste waere weg, ohne dass man wuesste, warum.
function frischOeffnen() {
  kalVollbild = false;
  vollbildPlaetze = 0;
  // Auch der Quellen-Umschalter startet zu: seine Zeile gehoert im Normalfall
  // dem Tagesbereich.
  filterOffen = false;
  kalPanel.classList.remove("vollbild");
  springeZuHeute();
}

function oeffneKalender(modus) {
  if (modus) kalUntenModus = modus;
  if (!kalOffen) frischOeffnen();
  else zeichneKalender();
  kalOffen = true;
  setzePanel(true);
  zeichneUnten();
}

// Fuer fokus.js: ob der Fokus-Teil gerade ueberhaupt zu sehen ist. Der
// Sekundentakt des Timers zeichnet sonst ins Verborgene.
window.kalenderIstOffen = () => kalOffen;
window.kalenderZeigtFokus = () => kalOffen && kalUntenModus === "fokus" && !kalVollbild;

function schliesseKalender() {
  if (!kalOffen) return;
  schliesseEingaben();
  kalOffen = false;
  setzePanel(false);
}

// ---------- Wischgeste ----------
const RAND = 24;        // Zone am rechten Bildschirmrand, in der das Ziehen beginnt
const SCHWELLE = 8;     // ab hier entscheidet sich waagerecht gegen senkrecht
const AUF_ANTEIL = 0.65;  // beim Oeffnen: so weit muss das Panel herein sein
const ZU_ANTEIL = 0.35;   // beim Schliessen: so weit muss es hinausgezogen sein

let geste = null;   // { x, y, achse, modus, breite, versatz }

/* Nach einem Wisch ueber dem Raster schiebt der Browser noch einen Klick nach.
   Der waehlte bisher einen Tag aus - und zwar den FALSCHEN: beim Blaettern
   folgt das Raster dem Finger nur gedaempft (MITGABE 0.35), der Finger wandert
   also relativ zu den Zellen und liegt am Ende ueber dem Nachbartag. Bei einem
   Wisch, der die Umblaetter-Schwelle nicht erreicht hat, sprang die Auswahl
   deshalb scheinbar grundlos einen Tag weiter.
   Der Riegel wird gesetzt, sobald aus der Beruehrung ein Wisch geworden ist,
   und beim naechsten Aufsetzen wieder geloest. Ein echter Tipp (unter der
   8-px-Schwelle) laeuft nie hier vorbei. */
let klickSchlucken = false;

// Keine Geste, solange ein Dialog offen ist oder gerade etwas gezogen wird -
// sonst kaempft der Kalender mit dem Drag & Drop des Boards.
function darfGeste() {
  // Im Split ist der Kalender kein Panel, das man hereinzieht, sondern eine
  // Spalte, die da ist oder nicht - das macht der Umschalter.
  if (istSplit()) return false;
  if (!einstellungenPopup.hidden) return false;
  if (formularOffen || wahlOffen) return false;
  if (kalLock && !kalLock.classList.contains("hidden")) return false;
  if (draggedId || draggedCat || draggedThema) return false;
  return true;
}

// Senkrecht ueber dem Raster wischen schaltet das Vollbild: nach OBEN schiebt
// das Raster die Tagesliste weg und wird gross, nach UNTEN laesst es sie wieder
// herein. Die Richtung folgt dem, was WANDERT: das Raster sitzt unten, es muss
// also nach oben, um den Bildschirm zu fuellen. (Bis zum 20.08.2026 war es
// andersherum - "wie ein Rollo" gedacht, aber Rollos zieht niemand von unten.)
// Vorher lag das auf einer Zwei-Finger-Zoomgeste - die war am Handy einhaendig
// kaum zu treffen.
//
// Nur ueber dem Raster: die Tagesliste darunter muss senkrecht scrollbar
// bleiben, und in der Kopfzeile wischt man zum Schliessen.
const ZOOM_WEG = 60;   // px, ab denen wirklich umgeschaltet wird

function setzeVersatz(v) {
  geste.versatz = v;
  kalPanel.style.transform = `translateX(${v}px)`;
}

/**
 * Welche Geste gehoert der Stelle, an der der Finger aufsetzt?
 *
 *   "monat" ueber dem Raster, "tag" ueber der Tagesliste, sonst "zu".
 *
 * Nur "monat" kennt beide Achsen: waagerecht blaettert den Monat, senkrecht
 * schaltet das Vollbild. Ueber der Tagesliste bleibt senkrecht das Scrollen.
 *
 * Aufgeteilt statt einheitlich, weil ein Wisch ueber dem Raster etwas anderes
 * bedeutet als einer ueber der Kopfzeile - und weil das Schliessen per Wisch
 * sonst ganz verloren ginge.
 */
function gestenZone(ziel) {
  if (!ziel || !ziel.closest) return "zu";
  // In einem Eingabefeld zieht man Text, nicht den Kalender.
  if (ziel.closest("input, textarea, select")) return null;
  if (ziel.closest("#kalRaster, #kalWochentage")) return "monat";
  if (ziel.closest("#kalTagesliste")) return "tag";
  // Blaettern bleibt auch im Split (ein Tablet quer hat Platz UND Finger),
  // nur Zuziehen nicht: die Spalte wandert nicht mit dem Finger.
  return istSplit() ? null : "zu";
}

// ---------- Ziehgriffe ----------
// Zwei Griffe teilen sich diese Mechanik: die Breite des Streifens (nur im
// Split) und die Aufteilung zwischen Tagesliste und unterem Teil. Pointer-
// Ereignisse statt Maus UND Touch: ein Weg fuer beide Eingaben.
//
//   achse    "breite" waagerecht, "hoehe" senkrecht
//   start    Wert beim Anfassen, in px
//   setze    wendet einen bereits geklemmten Wert an
//   zurueck  Doppelklick: gemerkten Wert vergessen
//   min/max  Grenzen; max als Funktion, weil das Fenster sich aendert
function klemme(wert, min, max) { return Math.min(max, Math.max(min, wert)); }

function zieheGriff(griff, o) {
  // Welcher Zeiger zieht gerade? Eigene Variable statt hasPointerCapture:
  // das Einfangen kann fehlschlagen (und tut es bei nachgebauten Ereignissen
  // immer), und dann duerfte der Griff nicht einfach tot sein.
  let anfang = 0, wertAnfang = 0, aktiv = null;

  griff.addEventListener("pointerdown", e => {
    anfang = o.achse === "breite" ? e.clientX : e.clientY;
    wertAnfang = o.start();
    aktiv = e.pointerId;
    // Haelt die Bewegung beim Griff, auch wenn der Zeiger ihn verlaesst.
    try { griff.setPointerCapture(e.pointerId); } catch (err) { /* geht auch ohne */ }
    griff.classList.add("zieht");
    e.preventDefault();
  });

  griff.addEventListener("pointermove", e => {
    if (aktiv !== e.pointerId) return;
    const jetzt = o.achse === "breite" ? e.clientX : e.clientY;
    // Der Streifen sitzt rechts: nach LINKS ziehen macht ihn breiter. Die
    // Hoehe waechst dagegen nach unten, daher das andere Vorzeichen.
    const weg = o.achse === "breite" ? anfang - jetzt : jetzt - anfang;
    o.setze(klemme(wertAnfang + weg, o.min, o.max()));
  });

  const loslassen = e => {
    if (aktiv !== e.pointerId) return;
    aktiv = null;
    try { griff.releasePointerCapture(e.pointerId); } catch (err) { /* war nie gefangen */ }
    griff.classList.remove("zieht");
  };
  griff.addEventListener("pointerup", loslassen);
  griff.addEventListener("pointercancel", loslassen);

  griff.addEventListener("dblclick", o.zurueck);

  // Die App ist durchgehend mit der Tastatur bedienbar - ein Griff, der nur
  // auf die Maus hoert, waere der erste Bruch darin.
  griff.addEventListener("keydown", e => {
    const runter = o.achse === "breite" ? "ArrowLeft" : "ArrowDown";
    const hoch = o.achse === "breite" ? "ArrowRight" : "ArrowUp";
    if (e.key !== runter && e.key !== hoch) return;
    // Bei "breite" zeigt ArrowLeft nach aussen, macht also GROESSER.
    const vorzeichen = o.achse === "breite" ? -1 : 1;
    const schritt = (e.shiftKey ? 64 : 16) * (e.key === hoch ? 1 : -1) * vorzeichen;
    o.setze(klemme(o.start() + schritt, o.min, o.max()));
    e.preventDefault();
  });
}

// Beim Blaettern folgt der Inhalt ein Stueck weit dem Finger - gedaempft, weil
// er ja nicht wirklich mitwandert. Ohne diese Rueckmeldung fuehlt sich der
// Wisch an, als haette man danebengegriffen.
const MITGABE = 0.35;
const BLAETTER_WEG = 55;   // px, ab denen wirklich umgeblaettert wird

function blaetterElemente(modus) {
  if (modus === "monat") return [kalWochentage, kalRaster];
  if (modus === "tag") return [kalTagesliste];
  return [];
}

function setzeBlaetterVersatz(dx) {
  for (const el of blaetterElemente(geste.modus)) {
    el.style.transform = dx ? `translateX(${dx * MITGABE}px)` : "";
    el.style.transition = dx ? "none" : "transform .18s";
  }
}

document.addEventListener("touchstart", e => {
  geste = null;
  klickSchlucken = false;   // neue Beruehrung, alter Riegel hat sich erledigt
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  if (!kalOffen) {
    if (!darfGeste()) return;
    if (window.innerWidth - t.clientX > RAND) return;
    geste = { x: t.clientX, y: t.clientY, achse: null, modus: "auf" };
  } else {
    if (!kalPanel.contains(e.target)) return;
    const zone = gestenZone(e.target);
    if (!zone) return;
    geste = { x: t.clientX, y: t.clientY, achse: null, modus: zone };
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
    if (Math.abs(dx) <= Math.abs(dy)) {
      // Ueberwiegend senkrecht. Ueber dem Raster ist das die Vollbild-Geste,
      // ueberall sonst Scrollen - das gehoert dem Browser.
      if (geste.modus !== "monat") { geste = null; return; }
      geste.achse = "y";
    } else {
      geste.achse = "x";
      kalPanel.classList.remove("animiert");
      if (geste.modus === "auf") {
        // Wie beim Knopf: jedes Oeffnen startet beim heutigen Tag, sonst haengt
        // das Panel noch im Monat, in dem man zuletzt geblaettert hat.
        frischOeffnen();
        kalPanel.setAttribute("aria-hidden", "false");
      }
    }
  }

  e.preventDefault();   // ab hier gehoert die Bewegung dem Panel
  // Ab hier ist es ein Wisch und kein Tipp mehr - der nachgeschobene Klick
  // darf keinen Tag mehr waehlen (siehe klickSchlucken).
  if (geste.modus === "monat") klickSchlucken = true;

  if (geste.achse === "y") {
    // Nach dem Umschalten ist die Geste erledigt (geste = null), sonst
    // schaltete ein Weiterziehen ueber die Schwelle hinaus gleich wieder
    // zurueck.
    if (dy < -ZOOM_WEG) { geste = null; setzeVollbild(true); }
    else if (dy > ZOOM_WEG) { geste = null; setzeVollbild(false); }
    return;
  }

  if (geste.modus === "monat" || geste.modus === "tag") {
    geste.dx = dx;
    setzeBlaetterVersatz(dx);
    return;
  }
  const roh = geste.modus === "auf" ? geste.breite + dx : dx;
  setzeVersatz(Math.min(geste.breite, Math.max(0, roh)));
}, { passive: false });

function gesteBeenden() {
  if (!geste) return;
  const g = geste;
  // Senkrecht ueber dem Raster: entweder war der Weg lang genug und das
  // Vollbild hat schon geschaltet (dann ist geste laengst null), oder es
  // bleibt, wie es war. Nichts zurueckzusetzen.
  if (g.achse === "y") { geste = null; return; }
  if (g.modus === "monat" || g.modus === "tag") {
    setzeBlaetterVersatz(0);
    geste = null;
    if (g.achse !== "x" || Math.abs(g.dx || 0) < BLAETTER_WEG) return;
    // Nach links wischen heisst vorwaerts - wie beim Umblaettern.
    const schritt = g.dx < 0 ? 1 : -1;
    if (g.modus === "monat") monatVerschieben(schritt);
    else wechsleTag(schritt);
    return;
  }
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
// Der Umschalter steckt zweimal im Dokument: in der Kopfzeile der App und im
// Kalender selbst (der die Kopfzeile im Umschalt-Modus verdeckt). Sichtbar ist
// immer nur einer, verdrahtet sind beide gleich.
// Zwei Segmente: 📋 raeumt den Streifen weg, 📅 oeffnet ihn. Ein Tipp auf die
// schon gewaehlte Ansicht tut nichts, wie bei jeder Pille.
for (const seg of document.querySelectorAll(".ansicht-seg")) {
  seg.addEventListener("click", () => {
    if (seg.dataset.ansicht === "liste") { schliesseKalender(); return; }
    if (kalOffen) { setzeUnten("kalender"); return; }
    oeffneKalender("kalender");
  });
}

// Die Reiter oben. Sie schalten BEIDES: ob oben das Raster oder Fokus steht
// (das hier) und welcher Fokus-Reiter (fokus.js).
// Reihenfolge zaehlt: setzeUnten("fokus") laesst fokusZeigen() beim ersten Mal
// auf den Gewohnheiten aufsetzen - die Wahl des Nutzers muss also DANACH
// kommen, sonst wird ein Tipp auf "Timer" still ueberschrieben.
for (const seg of document.querySelectorAll(".fok-reiter-seg")) {
  seg.addEventListener("click", () => {
    const welcher = seg.dataset.fokReiter;
    if (welcher === "kalender") { setzeUnten("kalender"); return; }
    setzeUnten("fokus");
    window.fokusReiter?.(welcher, true);
  });
}
document.getElementById("kalZu").addEventListener("click", schliesseKalender);

// Die gezogene Breite ueberschreibt --kal-breite am :root. Alles, was daran
// haengt (body-padding im Split, Panelbreite, Versatz der Snackbar), zieht von
// selbst mit - eine zweite Stelle mit einer Breite gibt es bewusst nicht.
function setzeBreite(px) {
  document.documentElement.style.setProperty("--kal-breite", Math.round(px) + "px");
  try { localStorage.setItem(BREITE_KEY, String(Math.round(px))); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

if (gemerkteBreite()) {
  document.documentElement.style.setProperty("--kal-breite", gemerkteBreite() + "px");
}

zieheGriff(document.getElementById("kalGriffBreite"), {
  achse: "breite",
  start: () => kalPanel.getBoundingClientRect().width,
  setze: px => { setzeBreite(px); pflegeSplit(); },
  zurueck: () => {
    localStorage.removeItem(BREITE_KEY);
    document.documentElement.style.removeProperty("--kal-breite");
    pflegeSplit();
  },
  min: BREITE_MIN,
  max: () => Math.max(BREITE_MIN, Math.min(BREITE_MAX, window.innerWidth - BOARD_MINDEST)),
});

kalMonatName.addEventListener("click", schalteWahl);
document.getElementById("kalZurueck").addEventListener("click", () => monatVerschieben(-1));
document.getElementById("kalVor").addEventListener("click", () => monatVerschieben(1));
// "Heute" ist ein Tipp auf einen Tag wie jeder andere. Umschalten muss er
// nicht mehr: er sitzt im Kalender-Kopf, den es im Fokus-Modus gar nicht gibt.
document.getElementById("kalHeute").addEventListener("click", springeZuHeute);
kalFilterKnopf.addEventListener("click", () => {
  filterOffen = !filterOffen;
  zeichneKalender();
});
document.getElementById("kalVollbild").addEventListener("click", () => setzeVollbild(!kalVollbild));
kalRaster.addEventListener("click", e => {
  if (klickSchlucken) { klickSchlucken = false; return; }
  const zelle = e.target.closest(".kal-tag");
  if (zelle) waehleTag(zelle.dataset.tag);
});
// Klick neben den Kasten schliesst - am Handy fuellt er den Bildschirm, dort
// bleibt nur die ✕ im Kopf.
kalWahl.addEventListener("click", e => { if (e.target === kalWahl) schliesseWahl(); });
kalTerminPopup.addEventListener("click", e => { if (e.target === kalTerminPopup) schliesseTerminFormular(); });

// Escape arbeitet sich von innen nach aussen: erst der offene Dialog, dann das
// Vollbild, erst zuletzt das Panel. Sonst raeumte ein Tastendruck alles auf
// einmal weg.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !kalOffen) return;
  if (formularOffen) { schliesseTerminFormular(); return; }
  if (wahlOffen) { schliesseWahl(); return; }
  if (kalVollbild) { setzeVollbild(false); return; }
  schliesseKalender();
});

// Gedrehtes Handy, geaenderte Fenstergroesse: die Zellen sind dann anders
// hoch, und die gemessene Zeilenzahl stimmt nicht mehr. Ein Monatswechsel
// misst von selbst nach (zeichneKalender), eine Drehung nicht.
//
// Ausserdem kann das Fenster ueber SPLIT_AB hinweg wachsen oder schrumpfen -
// aus dem Panel wird dann eine Spalte oder umgekehrt. Ohne diesen Abgleich
// bliebe ein am Handy geoeffneter Kalender nach dem Drehen ein Overlay, das
// die halbe Liste verdeckt.
// Auch nach dem Ziehen aufgerufen, nicht nur bei resize: mit einer eigenen
// Breite verschiebt sich die Split-Grenze selbst, das Fenster muss sich dafuer
// gar nicht aendern.
function pflegeSplit() {
  // Vor dem Ausstieg: die Klasse gilt auch bei zugeklapptem Kalender, das
  // Fokus-Panel haengt ebenfalls daran.
  pflegeBreit();
  if (!kalOffen) return;
  if (istSplit() !== document.documentElement.classList.contains("kal-split")) {
    setzePanel(true, true);
  }
  if (kalVollbild) messeVollbild();
}

window.addEventListener("resize", pflegeSplit);

// Aus render() aufgerufen: haelt das offene Panel auf Stand, wenn sich am
// Board etwas aendert (Abhaken, Sync vom Server). Zugeklappt kostet es nichts.
window.kalenderNeuZeichnen = function () {
  stelleAnsichtHer();
  if (kalOffen) zeichneKalender();
};

// Nach Verbinden/Trennen in den Einstellungen: alles zu Google vergessen und
// beim naechsten Zeichnen frisch holen (siehe app.js).
window.kalenderGoogleVergessen = function () {
  googleZustand = { moeglich: false, verbunden: false, email: null, schreiben: false, kalender: [], palette: {} };
  googleTermine = [];
  googleGeladen = null;
  googleAus = false;
  googleFehler = false;
  offeneTermine.clear();
  if (kalOffen) zeichneKalender();
};
