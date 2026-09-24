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
   - Umschalt-Modus (Handy, schmales Fenster): der Kalender ist eine eigene
     Ansicht. Das Raster fuellt sie, ein Tag oeffnet sich als Karte darueber
     (seit 24.09.2026, nach dem Samsung Kalender).

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
const kalDetailPopup = document.getElementById("kalDetailPopup");
const kalDetailBox   = kalDetailPopup.querySelector(".kal-detail-popup-box");
// Tages-Karte (nur am Handy, siehe oeffneTagKarte) und die Rueckfrage bei
// Serienterminen und beim Loeschen (siehe frage).
const kalTagPopup    = document.getElementById("kalTagPopup");
const kalTagKarte    = kalTagPopup.querySelector(".kal-tagkarte");
const kalTagKopf     = kalTagPopup.querySelector(".kal-tagkarte-kopf");
const kalTagListe    = kalTagPopup.querySelector(".kal-tagkarte-liste");
const kalTagFeld     = kalTagPopup.querySelector(".kal-tagkarte-feld");
const kalTagPlus     = kalTagPopup.querySelector(".kal-tagkarte-plus");
const kalFrage       = document.getElementById("kalFrage");
const kalFrageBox    = kalFrage.querySelector(".kal-frage-box");

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
// Jeder Balken traegt seinen Titel, auch der eintaegige. Vom 20. bis zum
// 21.08.2026 war das anders (TITEL_AB_TAGEN = 2): bei rund 55 px
// Spaltenbreite blieb von einem Titel nur "Finn H..." uebrig, und der Text
// kostete Zellhoehe. Hendriks Entscheidung nach einem Tag damit: ein
// abgeschnittener Name sagt mehr als ein namenloser Farbbalken - im Raster
// steht sonst nur "da ist was", ohne zu verraten, was.

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
 * Fuellt das Raster die ganze Ansicht? Am Rechner nur im Vollbild, am Handy
 * immer (seit 24.09.2026): dort steht keine Tagesliste mehr neben dem Raster,
 * ein Tag zeigt seinen Inhalt in der Tages-Karte. Die Zellen tragen dann ihre
 * ToDos im Klartext statt als Punkte - wie bisher nur im Vollbild.
 */
function rasterVoll() {
  return kalVollbild || !istSplit();
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

// Wie viele Balkenspuren jede Woche beim letzten Zeichnen brauchte, und fuer
// welchen Monat das galt. Solange eine Google-Anfrage laeuft, dient das als
// UNTERgrenze: das Raster faellt nicht erst flach zusammen, um gleich darauf
// wieder aufzugehen. Der Monat gehoert dazu, weil ein anderer Monat andere
// Wochen hat - dessen Spurenzahl waere geraten. Gepruefet wird das in
// zeichneRaster selbst und nicht an den drei Stellen, die den Monat setzen:
// eine Stelle kann man nicht vergessen, drei schon.
let spurenVorher = [];
let spurenVorherMonat = "";

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

// Der Termin, der gerade in der Zwischenmaske steht (null = keine offen).
// Das frueher hier stehende Set offeneTermine ist mit ihr entfallen: Ort und
// Beschreibung klappten in der Tagesliste auf und schoben dabei alles darunter
// nach unten - eine lange Notiz machte den halben Tag unsichtbar.
let detailTermin = null;

// Halb getippter Titel im Anlege-Feld. Das Panel zeichnet sich bei jeder
// Aenderung neu; ohne diesen Zwischenspeicher waere der Text dann weg.
let anlegenText = "";
let todoEingabeOffen = false;
// Steht das Quellen-Menue offen? Bewusst NICHT gemerkt: es ist eine
// Einstellung, die man selten anfasst, und offen liegt es ueber dem Raster.
// Dass etwas abgewaehlt ist, sieht man am gefaerbten Trichter im Kopf.
let filterOffen = false;

// Termin-Formular (eigener Dialog): offen ja/nein, welcher Termin (null =
// neuer), auf welchen Tag er sich bezieht, und die Feldwerte. Auch die liegen
// hier und nicht im DOM - der Dialog baut sich bei jeder Aenderung neu auf,
// ein halb ausgefuelltes Formular waere sonst weg.
let formularOffen = false;
let formularTermin = null;   // das Termin-Objekt, null = neuer Termin
let formularTag = null;      // ISO-Tag, auf den sich ein neuer Termin bezieht
let formularFelder = null;

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

// ---------- Zwischenspeicher fuer Google-Termine ----------
// Beim Oeffnen zeichnete der Kalender erst nur die ToDos; trafen die Termine
// ein, bekamen die Wochen ihre Balkenspuren und der ganze Streifen sprang.
// Der letzte Stand liegt deshalb im Browser und wird sofort gezeichnet, die
// Anfrage an Google laeuft parallel und ersetzt ihn still.
const SPEICHER_KEY = "kalTermineSpeicher";
const SPEICHER_EINTRAEGE = 6;   // sechs, nicht drei: der erste Abruf eines
// Monats geht OHNE Kalender-IDs raus (die Liste kennt die App da noch
// nicht), der zweite mit - pro Monat entstehen also zwei Eintraege.

// Die Kontoadresse gehoert in den Schluessel: meldet sich am selben Browser
// jemand anderes an, greift dessen Schluessel gar nicht erst auf fremde
// Termine zu. app.js verschachtelt seinen Zwischenspeicher aus demselben
// Grund pro Konto.
function speicherSchluessel(von, ids) {
  return (eigeneEmail || "?") + "|" + von + "|" + ids.join(",");
}

function speicherAlles() {
  try { return JSON.parse(localStorage.getItem(SPEICHER_KEY) || "{}"); }
  catch (e) { return {}; }
}

function speicherLesen(schluessel) {
  return speicherAlles()[schluessel] || null;
}

function speicherSchreiben(schluessel, daten) {
  try {
    const alles = speicherAlles();
    // Neu einsortieren, damit der zuletzt geholte Monat am Ende steht - die
    // Reihenfolge der Schluessel entscheidet, wer beim Aufraeumen faellt.
    delete alles[schluessel];
    alles[schluessel] = daten;
    const namen = Object.keys(alles);
    // Ein voller Monat sind wenige Kilobyte; der Deckel ist Vorsorge gegen
    // unbegrenztes Wachstum, nicht gegen ein akutes Problem.
    for (const k of namen.slice(0, Math.max(0, namen.length - SPEICHER_EINTRAEGE))) {
      delete alles[k];
    }
    localStorage.setItem(SPEICHER_KEY, JSON.stringify(alles));
  } catch (e) { /* voller Speicher - dann eben ohne Zwischenspeicher */ }
}

// Von app.js beim Abmelden gerufen, hier beim Trennen und wenn Google den
// Zugriff nicht mehr kennt. Termine eines Kontos, das nicht mehr haengt,
// duerfen nicht liegen bleiben.
window.kalenderSpeicherLeeren = function () {
  try { localStorage.removeItem(SPEICHER_KEY); } catch (e) { /* dann eben nicht */ }
};

async function ladeGoogle() {
  // Einmal geklaert, dass nichts verknuepft ist: nicht bei jedem Monatswechsel
  // erneut nachfragen. app.js setzt das nach Verbinden/Trennen zurueck.
  if (googleLaedt || googleAus) return;
  const ids = googleZustand.kalender.filter(k => quelleAn("gcal:" + k.id)).map(k => k.id);
  const { von, bis } = zeitraumDesMonats();
  const schluessel = `${von}|${ids.join(",")}`;
  if (googleGeladen === schluessel) return;

  // Sofort zeichnen, was beim letzten Mal da war. Der Preis ist ein
  // Sekundenbruchteil mit minimal veraltetem Stand - besser als ein Raster,
  // das sich unter einem aufbaut. `moeglich` und `schreiben` kommen bewusst
  // NICHT von hier: ob geschrieben werden darf, entscheidet der Server, und
  // ein gemerktes schreiben:true boete ein Plus an, das in einen 403 liefe.
  const gemerkt = speicherLesen(speicherSchluessel(von, ids));
  if (gemerkt && !googleTermine.length) {
    googleZustand.verbunden = true;
    googleZustand.palette = gemerkt.palette || {};
    if (Array.isArray(gemerkt.kalender)) googleZustand.kalender = gemerkt.kalender;
    googleTermine = Array.isArray(gemerkt.termine) ? gemerkt.termine : [];
    if (kalOffen) zeichneKalender();
  }

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
      // Bei einem Fehler bleibt stehen, was schon da ist - in der Regel der
      // gemerkte Stand. Sonst holte ihn der Zwischenspeicher herauf und die
      // Fehlerantwort raeumte ihn im selben Atemzug wieder weg; genau das
      // Springen, gegen das der Speicher gebaut ist.
      if (!d.fehler) googleTermine = Array.isArray(d.termine) ? d.termine : [];
      googleFehler = !!d.fehler;
      googleGeladen = schluessel;
      googleAus = !d.verbunden;
      if (!d.verbunden) { googleTermine = []; googleZustand.kalender = []; }
      // Bei d.fehler wird NICHT geschrieben: eine Fehlermeldung ist kein
      // Terminstand, und der alte bleibt damit brauchbar.
      if (d.verbunden && !d.fehler) {
        speicherSchreiben(speicherSchluessel(von, ids), {
          termine: googleTermine,
          kalender: googleZustand.kalender,
          palette: googleZustand.palette,
        });
      }
      // Zugriff bei Google widerrufen: der Endpunkt hat die Kontozeile schon
      // geloescht, hier muss der Zwischenspeicher mit.
      if (!d.verbunden) window.kalenderSpeicherLeeren();
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
// Im Vollbild (und am Handy) gilt der gemessene Platz der Zelle - abzueglich
// EINER Zeile.
// Die bleibt der Rest-Anzeige vorbehalten ("+3"): ohne sie fraessen an einem
// vollen Tag die Termine alle Zeilen auf, und die ToDos verschwaenden
// stillschweigend - ein Tag saehe erledigt aus, obwohl noch etwas ansteht.
// Vor der ersten Messung ein grosszuegiger Wert: zu viele Spuren kosten nur
// einen zweiten Zeichendurchgang, zu wenige zeigten beim ersten Bild zu wenig.
const MAX_SPUREN = 2;
function maxSpuren() {
  return rasterVoll() ? Math.max(1, (vollbildPlaetze || 6) - 1) : MAX_SPUREN;
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
  zeichneTagKarte(tage, tageTermine, ueberfaellige, heute);
  zeichneUnten();
  // Ein anderer Monat kann eine Rasterzeile mehr oder weniger haben - damit
  // aendert sich, wie weit die Aufteilung geklemmt werden muss.
  wendeTeilungAn();

  // Im Vollbild haengt der Zelleninhalt an der Zellenhoehe. Direkt hier
  // nachmessen, nicht per requestAnimationFrame: clientHeight erzwingt den
  // Umbruch selbst, ein eventueller zweiter Durchgang laeuft dadurch noch vor
  // dem Zeichnen (kein Aufblitzen) - und in einem Hintergrund-Tab, wo rAF gar
  // nicht feuert, bliebe die Messung sonst liegen.
  if (rasterVoll()) messeVollbild();

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
  if (!rasterVoll() || !kalOffen || messLauf) return;
  const zelle = kalRaster.querySelector(".kal-tag");
  // Ohne Hoehe (das Raster ist ausgeblendet, weil Gewohnheiten oder Timer
  // vorn stehen) gibt es nichts zu messen - es kaeme ein einziger Platz heraus.
  if (!zelle || !zelle.clientHeight) return;
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

// Eine Zeile je Quelle: ToDo-Listen zuerst, dann die Google-Kalender.
// Erscheint erst ab zwei Quellen - bei einer Liste ohne Google gibt es nichts
// zu filtern und das Panel bleibt so schlicht wie vorher.
//
// Seit 24.09.2026 ein Menue unter dem Trichter. Vorher schob sich eine
// Pillenreihe zwischen Kopf und Wochentage und drueckte das Raster nach unten.
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
  quellen.push({ schluessel: KW_QUELLE, name: "Kalenderwochen", art: "kw" });

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
    const an = quelleAn(q.schluessel);
    const zeile = document.createElement("button");
    zeile.type = "button";
    zeile.className = "kal-filter-zeile" + (an ? "" : " aus");
    zeile.setAttribute("role", "menuitemcheckbox");
    zeile.setAttribute("aria-checked", String(an));
    zeile.addEventListener("click", () => schalteQuelle(q.schluessel));

    // Dieselben zwei Formen wie im Raster: Punkt fuer eine ToDo-Liste,
    // Balken fuer einen Google-Kalender. Die KW-Zeile traegt keine Marke -
    // sie schaltet keine Eintraege, sondern eine Spalte. Der leere Platzhalter
    // haelt die Namen trotzdem auf einer Linie.
    const marke = document.createElement("span");
    if (q.art === "kw") marke.className = "kal-filter-leer";
    else {
      marke.className = q.art === "gcal" ? "kal-balken kal-balken-marke" : "kal-punkt";
      if (q.art === "gcal" && q.farbe) marke.style.background = q.farbe;
    }
    zeile.appendChild(marke);

    const name = document.createElement("span");
    name.className = "kal-filter-name";
    name.textContent = q.name;
    zeile.appendChild(name);

    const haken = document.createElement("span");
    haken.className = "kal-filter-haken";
    haken.setAttribute("aria-hidden", "true");
    haken.textContent = an ? "✓" : "";
    zeile.appendChild(haken);
    kalFilter.appendChild(zeile);
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

  // Solange fuer diesen Monat noch keine frische Antwort da ist, mindestens so
  // hoch bleiben wie beim letzten Zeichnen. Nicht nur waehrend googleLaedt:
  // das erste Zeichnen passiert VOR der Anfrage, und genau dort faellt das
  // Raster sonst flach zusammen.
  const monatSchluessel = kalJahr + "-" + kalMonatNr;
  if ((googleLaedt || !googleGeladen) && spurenVorherMonat === monatSchluessel) {
    const bis = Math.max(spurenJeWoche.length, spurenVorher.length);
    for (let w = 0; w < bis; w++) {
      spurenJeWoche[w] = Math.max(spurenJeWoche[w] || 0, spurenVorher[w] || 0);
    }
  }
  spurenVorher = spurenJeWoche.slice();
  spurenVorherMonat = monatSchluessel;

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
    // title und aria-label zusaetzlich zum sichtbaren Text: der ist bei
    // schmalen Spalten abgeschnitten, hier steht er vollstaendig.
    balken.title = eintrag.termin.titel;
    balken.setAttribute("aria-label", eintrag.termin.titel);
    const text = document.createElement("span");
    text.className = "kal-balken-text";
    text.textContent = eintrag.termin.titel;
    balken.appendChild(text);
    stapel.appendChild(balken);
  }
  zelle.appendChild(stapel);

  // Im Vollbild und am Handy stehen die ToDos im Klartext unter den Terminen -
  // das ist der eigentliche Gewinn der grossen Ansicht. Wie viele hineinpassen, sagt die
  // gemessene Zellenhoehe abzueglich der Balken, die diese WOCHE braucht (je
  // Woche, nicht je Tag - sonst staende jeder Tag auf anderer Hoehe).
  if (rasterVoll() && (todosDesTages.length || ueberzaehlig[iso])) {
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

// Schreibt den Inhalt eines Tages nach `ziel`: am Rechner in die Tagesliste
// neben dem Raster, am Handy in die Tages-Karte (`karte`). Die Karte hat ihren
// eigenen Kopf und unten Feld und Plus - Tagestitel und die ＋ an den
// Abschnitten entfallen dort, sonst gaebe es jeden Weg zweimal.
function zeichneTagesliste(tage, tageTermine, ueberfaellige, heute, ziel = kalTagesliste, karte = false) {
  ziel.innerHTML = "";

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

  if (titel && !karte) {
    const kopf = document.createElement("h3");
    kopf.className = "kal-liste-kopf";
    kopf.textContent = titel;
    if (kalAuswahl === heute) {
      const heuteChip = document.createElement("span");
      heuteChip.className = "kal-heute-chip";
      heuteChip.textContent = "heute";
      kopf.appendChild(heuteChip);
    }
    ziel.appendChild(kopf);
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
      ziel.appendChild(baueGruppenKopf(
        `Überfällig (${ueberfaellige.length})`, null, null, true, "⚠️"));
      for (const t of ueberfaellige) ziel.appendChild(baueEintrag(t, true, true));
    }

    ziel.appendChild(baueGruppenKopf("ToDos", aktiveListe && !karte
      ? () => {
          todoEingabeOffen = true;
          zeichneKalender();
          // Direkt ins Feld: am Handy geht damit die Tastatur gleich mit auf.
          const feld = kalTagesliste.querySelector(".kal-anlegen-feld");
          if (feld) feld.focus();
        } : null,
      "ToDo", faelligHeute && todosDesTages.length > 0, "☑️"));
    if (!karte && todoEingabeOffen && aktiveListe) ziel.appendChild(baueAnlegeZeile(kalAuswahl));
    for (const t of todosDesTages) {
      ziel.appendChild(baueEintrag(t, false, faelligHeute));
    }
    if (!todosDesTages.length) ziel.appendChild(baueLeerZeile("Nichts fällig."));

    // Termine stehen unter den ToDos: der Streifen beantwortet zuerst "was
    // muss ich heute tun", und die Termin-Ueberschrift samt Leerzeile schob
    // diese Antwort vorher jedes Mal nach unten aus dem Blick.
    //
    // Ganztaegige bekommen einen eigenen Abschnitt und stehen zuerst: sie
    // rahmen den Tag, statt in ihm zu liegen, und zwischen den Uhrzeiten
    // standen sie als zeitlose Zeilen ohne erkennbare Ordnung.
    const terminePlus = !karte && googleZustand.verbunden && googleZustand.schreiben
      ? () => oeffneTerminFormular(kalAuswahl, null) : null;
    const ganztags = termineDesTages.filter(e => e.termin.ganztags);
    const mitZeit  = termineDesTages.filter(e => !e.termin.ganztags);

    if (ganztags.length) {
      ziel.appendChild(baueGruppenKopf("Ganztägig", terminePlus, "Termin", false, "📅"));
      for (const e of ganztags) ziel.appendChild(baueTerminZeile(e.termin));
    }
    // Das ＋ haengt am ERSTEN sichtbaren Termin-Abschnitt, damit es genau
    // einmal vorkommt und immer an derselben Stelle steht: oben bei den
    // Terminen. Stehen keine ganztaegigen da, wandert es hierher.
    if (mitZeit.length || !ganztags.length) {
      ziel.appendChild(baueGruppenKopf("Termine",
        ganztags.length ? null : terminePlus, "Termin", false, "📅"));
      for (const e of mitZeit) ziel.appendChild(baueTerminZeile(e.termin));
      if (!mitZeit.length) {
        ziel.appendChild(baueLeerZeile(googleZustand.verbunden
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
    ziel.appendChild(hinweis);
  }
}

/* ---------- Termin-Formular ---------- */
/*
 * Aufbau nach dem Samsung Kalender (seit 24.09.2026, Vorlage von Hendrik):
 * Titel mit Farbpunkt, Ganztaegig als Schalter, Von -> Bis NEBENEINANDER,
 * darunter je eine Zeile mit Symbol fuer Ort, Wiederholung und Notizen, unten
 * nur Abbrechen und Speichern. Geloescht wird in der Zwischenmaske davor.
 * Kalenderkonto, Erinnerung, Videokonferenz, Anhang und Teilnehmer aus der
 * Vorlage sind bewusst nicht dabei ("brauche ich nicht").
 */

function zeitAus(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "09:00" : uhrVon(d);
}

// Datum im Formular so, wie Samsung es zeigt: "Mi., 16. Sept.". Die nativen
// Felder zeigten je nach Browser 16.09.2026 - und fuer zwei Zeitpunkte
// nebeneinander ist das Jahr am Handy zu breit.
const FORM_DATUM = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
const BIS_DATUM  = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", year: "numeric" });
const STUNDE = 60 * 60 * 1000;

function datumAusIso(iso) {
  const [j, m, t] = String(iso).split("-").map(Number);
  return new Date(j, m - 1, t);
}

// Datum + Uhrzeit als Zeitpunkt in Ortszeit.
function zeitpunkt(datum, zeit) {
  const d = datumAusIso(datum);
  const [h, min] = String(zeit || "00:00").split(":").map(Number);
  d.setHours(h || 0, min || 0, 0, 0);
  return d;
}

function uhrVon(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tagePlus(iso, n) {
  const d = datumAusIso(iso);
  d.setDate(d.getDate() + n);
  return isoVonDate(d);
}

// Math.round, weil ein Tag mit Zeitumstellung 23 oder 25 Stunden hat.
function tageZwischen(von, bis) {
  return Math.round((datumAusIso(bis) - datumAusIso(von)) / 86400000);
}

/**
 * Beginn aendern - das Ende rueckt sofort mit, die Dauer bleibt. Hendriks
 * Wunsch: Beginn auf 9 Uhr, und das Ende steht gleich auf 10, nicht erst nach
 * dem Speichern. (Der Server zog ein Ende vor dem Beginn schon immer gerade,
 * nur sah man es im Formular nicht.)
 */
function setzeBeginn(f, datum, zeit) {
  if (f.ganztags) {
    const tage = Math.max(0, tageZwischen(f.startDatum, f.endDatum));
    f.startDatum = datum;
    f.endDatum = tagePlus(datum, tage);
    return;
  }
  let dauer = zeitpunkt(f.endDatum, f.bisZeit) - zeitpunkt(f.startDatum, f.vonZeit);
  if (!(dauer > 0)) dauer = STUNDE;
  f.startDatum = datum;
  f.vonZeit = zeit;
  const ende = new Date(zeitpunkt(datum, zeit).getTime() + dauer);
  f.endDatum = isoVonDate(ende);
  f.bisZeit = uhrVon(ende);
}

// Ende aendern. Laege es danach nicht HINTER dem Beginn, wird daraus Beginn
// plus eine Stunde - dieselbe Regel, die der Server beim Speichern anwendet.
function setzeEnde(f, datum, zeit) {
  f.endDatum = datum;
  f.bisZeit = zeit;
  if (f.ganztags) {
    if (f.endDatum < f.startDatum) f.endDatum = f.startDatum;
    return;
  }
  if (zeitpunkt(f.endDatum, f.bisZeit) <= zeitpunkt(f.startDatum, f.vonZeit)) {
    const ende = new Date(zeitpunkt(f.startDatum, f.vonZeit).getTime() + STUNDE);
    f.endDatum = isoVonDate(ende);
    f.bisZeit = uhrVon(ende);
  }
}

/* ---------- Wiederholung ---------- */
// So, wie das Formular sie kennt:
//   art        "keine" | "tag" | "woche" | "monat" | "jahr" | "fremd"
//   intervall  jede n-te Woche usw.
//   laufzeit   "immer" | "anzahl" | "bis"
// "fremd" ist eine Regel aus Google, die sich hier nicht abbilden laesst
// (etwa "jeden 3. Mittwoch"). Sie bleibt unangetastet, bis man etwas anderes
// waehlt.
const WDH_FREQ = { tag: "DAILY", woche: "WEEKLY", monat: "MONTHLY", jahr: "YEARLY" };
const WDH_NAMEN = {
  tag:   ["Jeden", "Tag", "Tage"],
  woche: ["Jede", "Woche", "Wochen"],
  monat: ["Jeden", "Monat", "Monate"],
  jahr:  ["Jedes", "Jahr", "Jahre"],
};

function keineWiederholung() {
  return { art: "keine", intervall: 1, laufzeit: "immer", anzahl: 10, bis: "" };
}

// UNTIL aus Google als Kalendertag: bei ganztaegigen steht dort ein Datum,
// bei terminierten ein UTC-Zeitpunkt - der gehoert zum Tag in Ortszeit.
function untilAlsIso(until) {
  if (/^\d{8}$/.test(until)) return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until);
  return m ? isoVonDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))) : "";
}

// RRULE -> Formular. BYDAY bei woechentlichen und BYMONTHDAY bei monatlichen
// Serien sind erlaubt, solange es EIN Wert ist: so legt Googles eigene
// Oberflaeche ganz gewoehnliche Serien an, und es sagt nichts anderes als der
// Starttag.
function regelAlsWiederholung(zeile) {
  const w = keineWiederholung();
  if (!zeile) return w;
  const teile = {};
  for (const stueck of zeile.replace(/^RRULE:/, "").split(";")) {
    const [k, v] = stueck.split("=");
    teile[k] = v;
  }
  const art = Object.keys(WDH_FREQ).find(a => WDH_FREQ[a] === teile.FREQ);
  const bekannt = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST"]);
  if (art === "woche" && /^[A-Z]{2}$/.test(teile.BYDAY || "")) bekannt.add("BYDAY");
  if (art === "monat" && /^\d{1,2}$/.test(teile.BYMONTHDAY || "")) bekannt.add("BYMONTHDAY");
  if (!art || Object.keys(teile).some(k => !bekannt.has(k))) return { ...w, art: "fremd" };
  w.art = art;
  w.intervall = Math.min(99, Math.max(1, Number(teile.INTERVAL) || 1));
  if (teile.COUNT) { w.laufzeit = "anzahl"; w.anzahl = Number(teile.COUNT) || 10; }
  else if (teile.UNTIL) { w.laufzeit = "bis"; w.bis = untilAlsIso(teile.UNTIL); }
  return w;
}

// Formular -> RRULE ("" = keine). UNTIL bei ganztaegigen als Datum, sonst als
// UTC-Zeitpunkt am ENDE des gewaehlten Tages in Ortszeit: ein Termin am
// letzten Tag zaehlt so noch mit, einer am Tag danach nicht mehr.
function baueRegel(w, ganztags) {
  if (!WDH_FREQ[w.art]) return "";
  let zeile = "RRULE:FREQ=" + WDH_FREQ[w.art];
  if (w.intervall > 1) zeile += ";INTERVAL=" + w.intervall;
  if (w.laufzeit === "anzahl") zeile += ";COUNT=" + w.anzahl;
  else if (w.laufzeit === "bis" && w.bis) {
    if (ganztags) zeile += ";UNTIL=" + w.bis.replace(/-/g, "");
    else {
      const ende = zeitpunkt(w.bis, "23:59");
      ende.setSeconds(59);
      zeile += ";UNTIL=" + ende.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    }
  }
  return zeile;
}

// Vorgabe fuer "Bis", passend zum Rhythmus: bei "jedes Jahr" waere ein Monat
// spaeter nur ein einziger Termin.
function standardBis(art, start) {
  const monate = { tag: 1, woche: 3, monat: 12, jahr: 60 }[art] || 1;
  const d = datumAusIso(start);
  d.setMonth(d.getMonth() + monate);
  return isoVonDate(d);
}

function wdhRhythmus(w) {
  const [jede, eins, mehr] = WDH_NAMEN[w.art];
  return w.intervall > 1 ? `alle ${w.intervall} ${mehr}` : `${jede.toLowerCase()} ${eins}`;
}

function wdhEnde(w) {
  if (w.laufzeit === "anzahl") return `, ${w.anzahl}-mal`;
  if (w.laufzeit === "bis" && w.bis) return `, bis ${BIS_DATUM.format(datumAusIso(w.bis))}`;
  return "";
}

// Fuer die Zeile im Formular: "Alle 2 Wochen, 10-mal".
function wiederholungText(w) {
  if (w.art === "keine") return "Nicht wiederholen";
  if (w.art === "fremd") return "Eigene Regel aus Google";
  const text = wdhRhythmus(w) + wdhEnde(w);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Fuer den Satz oben auf der Wiederholen-Seite.
function wiederholungSatz(w) {
  if (w.art === "keine") return "Dieser Termin wird nicht wiederholt.";
  if (w.art === "fremd") {
    return "Diese Serie folgt einer Regel aus Google, die sich hier nicht einstellen lässt. "
      + "Sie bleibt, wie sie ist – außer du wählst hier etwas anderes.";
  }
  return `Dieser Termin wird ${wdhRhythmus(w)} wiederholt${wdhEnde(w)}.`;
}

// Formularwerte aus einem bestehenden Termin - oder Vorgaben fuer einen neuen.
function felderAusTermin(tag, t) {
  // Was nicht von Google kommt, sondern nur zum Formular gehoert: welche Seite
  // offen ist, ob die Palette aufgeklappt ist, und die Wiederholung.
  // regelAlt ist die Regel beim Oeffnen ("" = keine). null heisst: der Termin
  // gehoert zu einer Serie, deren Regel noch geladen wird (ladeRegel).
  const zusatz = {
    seite: "formular", farbWahl: false, speichert: false,
    wiederholung: keineWiederholung(), wdhAngefasst: false,
    regelAlt: t && t.serieId ? null : "", regelFehlt: false,
  };
  if (!t) {
    return { ...zusatz, titel: "", ganztags: true, startDatum: tag, endDatum: tag,
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
    return { ...zusatz, titel: t.titel, ganztags: true, startDatum: t.start, endDatum: ende,
             vonZeit: "09:00", bisZeit: "10:00", farbe: t.colorId || "",
             notiz: t.beschreibung || "", ort: t.ort || "" };
  }
  const start = new Date(t.start);
  const ende = t.ende ? new Date(t.ende) : null;
  return {
    ...zusatz,
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
 * weiter zum Anlegen-Knopf. Neu und Bearbeiten teilen sich denselben Dialog.
 */
function oeffneTerminFormular(tag, termin) {
  formularOffen = true;
  formularTermin = termin || null;
  formularTag = tag;
  formularFelder = felderAusTermin(tag, termin);
  todoEingabeOffen = false;
  zeichneKalender();
  zeichneTerminPopup();
  if (termin && termin.serieId) ladeRegel(formularFelder, termin.serieId);
  const feld = kalTerminBox.querySelector(".kal-form-titel");
  // Nur am Rechner von selbst ins Feld springen: am Handy schoebe die
  // Tastatur den halben Dialog aus dem Bild, bevor man ihn gesehen hat.
  if (feld && !("ontouchstart" in window)) feld.focus();
}

// Die Regel einer Serie holen. Google liefert sie bei den aufgeloesten
// Einzelterminen nicht mit - nur der Stammtermin kennt sie.
async function ladeRegel(f, serieId) {
  let regel = null;
  try {
    const antwort = await fetch("/api/google/termin?serie=" + encodeURIComponent(serieId));
    if (antwort.ok) regel = (await antwort.json()).regel || "";
  } catch (e) { /* bleibt null */ }
  // Inzwischen geschlossen oder ein anderer Termin offen: nichts mehr tun.
  if (formularFelder !== f) return;
  if (regel === null) {
    // Ohne Regel bleibt die Wiederholung gesperrt - gespeichert wird dann
    // ohne sie, also unveraendert.
    f.regelFehlt = true;
  } else {
    f.regelAlt = regel;
    f.wiederholung = regelAlsWiederholung(regel);
  }
  // Nur die eine Zeile nachziehen: wer gerade den Titel tippt, soll dabei
  // nicht den Cursor verlieren.
  aktualisiereWdhZeile();
}

function schliesseTerminFormular() {
  if (!formularOffen) return;
  formularOffen = false;
  formularTermin = null;
  formularTag = null;
  formularFelder = null;
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
  const f = formularFelder;
  // Eine sichtbare Ueberschrift gibt es nicht mehr (Samsung hat keine) - der
  // Name des Dialogs steht fuer Screenreader trotzdem da.
  kalTerminBox.setAttribute("aria-label", formularTermin ? "Termin bearbeiten" : "Neuer Termin");
  kalTerminBox.appendChild(f.seite === "wiederholung"
    ? baueWiederholungSeite(f)
    : baueTerminFormular(formularTag, formularTermin));
  // Erst jetzt hat das Notizfeld eine Hoehe, an der es wachsen kann.
  const notiz = kalTerminBox.querySelector(".kal-form-notiz");
  if (notiz) passeNotizHoeheAn(notiz);
}

// Linien-Symbole wie in der Vorlage. Feste Zeichenketten, kein fremder Text -
// deshalb darf hier innerHTML stehen.
const FORM_SYMBOLE = {
  uhr:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  ort:   '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
  wdh:   '<path d="M4.5 11V9.5A3.5 3.5 0 0 1 8 6h11.5l-3-3M19.5 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4.5l3 3"/>',
  notiz: '<rect x="5.5" y="3.5" width="13" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/>',
};

function formSymbol(name) {
  const span = document.createElement("span");
  span.className = "kal-form-symbol";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" `
    + `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FORM_SYMBOLE[name]}</svg>`;
  return span;
}

/**
 * Datum oder Uhrzeit als grosser Text, das native Feld liegt darueber.
 * Am Finger faengt es den Tipp selbst ab (unsichtbar, volle Flaeche) - nur so
 * oeffnet iOS seinen Picker zuverlaessig. Mit der Maus liegt es ohne
 * Trefferflaeche da und wird per showPicker geoeffnet; ein unsichtbares
 * Datumsfeld naehme einen Mausklick sonst als Klick in ein Segment, und es
 * passierte scheinbar nichts. Dasselbe Muster wie .date-field am ToDo.
 *
 * `teil` markiert die vier Felder des Zeitraums: die zieht
 * aktualisiereZeitraum() an Ort und Stelle nach, statt den Dialog neu zu
 * bauen - am Rechner schloesse ein Neubau den Uhrzeit-Picker, sobald die
 * Stunde gewaehlt ist, und die Minute bliebe unerreichbar.
 */
function baueWahlFeld(typ, wert, text, beiAenderung, klasse, name, teil) {
  const feld = document.createElement("label");
  feld.className = "kal-form-wahl " + klasse;
  if (teil) feld.dataset.teil = teil;
  const anzeige = document.createElement("span");
  anzeige.className = "kal-form-wahl-text";
  anzeige.textContent = text;
  const eingabe = document.createElement("input");
  eingabe.type = typ;
  eingabe.value = wert;
  // Ohne required bieten manche Picker "Loeschen" an - ein Termin ohne Datum
  // ist aber keiner.
  eingabe.required = true;
  eingabe.setAttribute("aria-label", name);
  eingabe.addEventListener("change", () => { if (eingabe.value) beiAenderung(eingabe.value); });
  feld.addEventListener("click", e => {
    if (e.target === eingabe) return;
    e.preventDefault();
    openDatePicker(eingabe);
  });
  feld.append(anzeige, eingabe);
  return feld;
}

function aktualisiereZeitraum() {
  const f = formularFelder;
  if (!f) return;
  const werte = {
    "start-datum": [f.startDatum, FORM_DATUM.format(datumAusIso(f.startDatum))],
    "start-uhr":   [f.vonZeit, f.vonZeit],
    "ende-datum":  [f.endDatum, FORM_DATUM.format(datumAusIso(f.endDatum))],
    "ende-uhr":    [f.bisZeit, f.bisZeit],
  };
  for (const feld of kalTerminBox.querySelectorAll(".kal-form-wahl[data-teil]")) {
    const [wert, text] = werte[feld.dataset.teil];
    feld.querySelector(".kal-form-wahl-text").textContent = text;
    const eingabe = feld.querySelector("input");
    if (eingabe.value !== wert) eingabe.value = wert;
  }
}

function aktualisiereWdhZeile() {
  const f = formularFelder;
  const knopf = kalTerminBox.querySelector(".kal-form-wdh");
  if (!f || !knopf) return;
  const laedt = f.regelAlt === null;
  knopf.disabled = laedt;
  knopf.querySelector(".kal-form-wdh-text").textContent = laedt
    ? (f.regelFehlt ? "Serientermin" : "Wird geladen …")
    : wiederholungText(f.wiederholung);
}

// Farbe des Hauptkalenders - die gilt, solange der Termin keine eigene hat.
function hauptkalenderFarbe() {
  const k = googleZustand.kalender.find(x => x.primaer) || googleZustand.kalender[0];
  return farbWert(k && k.farbe);
}

function baueTerminFormular(tag, termin) {
  const f = formularFelder;
  const box = document.createElement("div");
  box.className = "kal-form";

  // --- Titel mit Farbpunkt ---
  const titelZeile = document.createElement("div");
  titelZeile.className = "kal-form-titelzeile";
  const titel = document.createElement("input");
  titel.type = "text";
  titel.className = "kal-form-titel";
  titel.placeholder = "Titel";
  titel.setAttribute("aria-label", "Titel des Termins");
  titel.value = f.titel;
  titel.addEventListener("input", () => {
    f.titel = titel.value;
    titelZeile.classList.remove("fehlt");
  });
  titelZeile.appendChild(titel);

  // Die Farbe als Punkt neben dem Titel, wie bei Samsung. Vorher stand die
  // ganze Palette als Reihe mitten im Formular, auch wenn man sie nie anfasst.
  const punkt = document.createElement("button");
  punkt.type = "button";
  punkt.className = "kal-form-farbpunkt";
  const hex = f.farbe ? farbWert((googleZustand.palette || {})[f.farbe]) : hauptkalenderFarbe();
  if (hex) punkt.style.background = hex;
  else punkt.classList.add("leer");
  punkt.title = "Farbe wählen";
  punkt.setAttribute("aria-label", "Farbe wählen");
  punkt.setAttribute("aria-expanded", String(f.farbWahl));
  punkt.addEventListener("click", () => { f.farbWahl = !f.farbWahl; zeichneTerminPopup(); });
  titelZeile.appendChild(punkt);
  box.appendChild(titelZeile);

  // Googles eigene Palette - eine eigene Farbskala waere im Google-Kalender
  // hinterher nicht wiederzuerkennen. Mit der Wahl klappt sie wieder zu.
  if (f.farbWahl) {
    const farben = document.createElement("div");
    farben.className = "kal-form-farben";
    const knopfFarbe = (id, farbe, name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kal-farbe" + (String(f.farbe) === String(id) ? " gewaehlt" : "") + (id ? "" : " kal-farbe-standard");
      b.title = name;
      b.setAttribute("aria-label", name);
      if (farbe) b.style.background = farbe;
      b.addEventListener("click", () => { f.farbe = id; f.farbWahl = false; zeichneTerminPopup(); });
      return b;
    };
    farben.appendChild(knopfFarbe("", hauptkalenderFarbe(), "Farbe des Kalenders"));
    for (const [id, wert] of Object.entries(googleZustand.palette || {})) {
      farben.appendChild(knopfFarbe(id, farbWert(wert), "Farbe " + id));
    }
    box.appendChild(farben);
  }

  // --- Ganztaegig ---
  const ganz = document.createElement("label");
  ganz.className = "kal-form-reihe";
  const ganzText = document.createElement("span");
  ganzText.className = "kal-form-reihe-text";
  ganzText.textContent = "Ganztägig";
  const schalter = document.createElement("input");
  schalter.type = "checkbox";
  schalter.className = "kal-schalter";
  schalter.setAttribute("role", "switch");
  schalter.checked = f.ganztags;
  // Hier darf neu gebaut werden: die Uhrzeitfelder kommen oder gehen.
  schalter.addEventListener("change", () => { f.ganztags = schalter.checked; zeichneTerminPopup(); });
  ganz.append(formSymbol("uhr"), ganzText, schalter);
  box.appendChild(ganz);

  // --- Von -> Bis nebeneinander ---
  const zeitraum = document.createElement("div");
  zeitraum.className = "kal-form-zeitraum";
  const seite = (datum, zeit, beiDatum, beiZeit, wer, teil) => {
    const block = document.createElement("div");
    block.className = "kal-form-zeitpunkt";
    block.appendChild(baueWahlFeld("date", datum, FORM_DATUM.format(datumAusIso(datum)),
      beiDatum, "kal-form-datum", wer + " – Datum", teil + "-datum"));
    if (!f.ganztags) {
      block.appendChild(baueWahlFeld("time", zeit, zeit, beiZeit, "kal-form-uhr",
        wer + " – Uhrzeit", teil + "-uhr"));
    }
    return block;
  };
  const pfeil = document.createElement("span");
  pfeil.className = "kal-form-pfeil";
  pfeil.setAttribute("aria-hidden", "true");
  pfeil.textContent = "→";
  zeitraum.append(
    seite(f.startDatum, f.vonZeit,
      v => { setzeBeginn(f, v, f.vonZeit); aktualisiereZeitraum(); },
      v => { setzeBeginn(f, f.startDatum, v); aktualisiereZeitraum(); }, "Beginn", "start"),
    pfeil,
    seite(f.endDatum, f.bisZeit,
      v => { setzeEnde(f, v, f.bisZeit); aktualisiereZeitraum(); },
      v => { setzeEnde(f, f.endDatum, v); aktualisiereZeitraum(); }, "Ende", "ende"));
  box.appendChild(zeitraum);

  // --- Ort ---
  const ort = document.createElement("label");
  ort.className = "kal-form-reihe";
  const ortFeld = document.createElement("input");
  ortFeld.type = "text";
  ortFeld.className = "kal-form-eingabe";
  ortFeld.placeholder = "Ort";
  ortFeld.setAttribute("aria-label", "Ort");
  ortFeld.value = f.ort;
  ortFeld.addEventListener("input", () => { f.ort = ortFeld.value; });
  ort.append(formSymbol("ort"), ortFeld);
  box.appendChild(ort);

  // --- Wiederholung: fuehrt auf die eigene Seite ---
  const wdh = document.createElement("button");
  wdh.type = "button";
  wdh.className = "kal-form-reihe kal-form-wdh";
  const wdhText = document.createElement("span");
  wdhText.className = "kal-form-reihe-text kal-form-wdh-text";
  const weiter = document.createElement("span");
  weiter.className = "kal-form-weiter";
  weiter.setAttribute("aria-hidden", "true");
  weiter.textContent = "›";
  wdh.append(formSymbol("wdh"), wdhText, weiter);
  wdh.addEventListener("click", () => { f.seite = "wiederholung"; zeichneTerminPopup(); });
  box.appendChild(wdh);

  // --- Notizen ---
  const notizReihe = document.createElement("label");
  notizReihe.className = "kal-form-reihe kal-form-reihe-oben";
  const notiz = document.createElement("textarea");
  notiz.className = "kal-form-eingabe kal-form-notiz";
  notiz.rows = 1;
  notiz.placeholder = "Notizen";
  notiz.setAttribute("aria-label", "Notizen");
  notiz.value = f.notiz;
  notiz.addEventListener("input", () => { f.notiz = notiz.value; passeNotizHoeheAn(notiz); });
  notizReihe.append(formSymbol("notiz"), notiz);
  box.appendChild(notizReihe);

  // --- Unten: Abbrechen | Speichern, wie in der Vorlage ---
  const fuss = document.createElement("div");
  fuss.className = "kal-form-fuss";
  const abbrechen = document.createElement("button");
  abbrechen.type = "button";
  abbrechen.className = "kal-fuss-knopf";
  abbrechen.textContent = "Abbrechen";
  abbrechen.addEventListener("click", schliesseTerminFormular);
  const speichern = document.createElement("button");
  speichern.type = "button";
  speichern.className = "kal-fuss-knopf primaer";
  speichern.textContent = "Speichern";
  speichern.disabled = f.speichert;
  speichern.addEventListener("click", () => speichereTermin(termin));
  fuss.append(abbrechen, speichern);
  box.appendChild(fuss);

  // Die Zeile steht schon im Kasten, aber noch nicht im Dialog - deshalb den
  // Text hier direkt setzen statt ueber aktualisiereWdhZeile().
  const laedt = f.regelAlt === null;
  wdh.disabled = laedt;
  wdhText.textContent = laedt ? (f.regelFehlt ? "Serientermin" : "Wird geladen …") : wiederholungText(f.wiederholung);
  return box;
}

function zurueckZumFormular() {
  if (!formularFelder) return;
  formularFelder.seite = "formular";
  zeichneTerminPopup();
}

/**
 * Die Wiederholen-Seite, nach der Vorlage: ein Satz, was gerade gilt, darunter
 * die Rhythmen mit Zahl und - sobald sich etwas wiederholt - die Laufzeit.
 *
 * Diese Seite baut sich NICHT neu, solange sie offen ist: jede Aenderung zieht
 * nur Satz, Worte und Sichtbarkeit an Ort und Stelle nach. Sonst verloere eine
 * Zahl beim Tippen nach jeder Ziffer den Fokus.
 */
function baueWiederholungSeite(f) {
  const w = f.wiederholung;
  const seite = document.createElement("div");
  seite.className = "kal-wdh";

  const kopf = document.createElement("div");
  kopf.className = "kal-wdh-kopf";
  const zurueck = document.createElement("button");
  zurueck.type = "button";
  zurueck.className = "kal-wdh-zurueck";
  zurueck.setAttribute("aria-label", "Zurück zum Termin");
  zurueck.textContent = "‹";
  zurueck.addEventListener("click", zurueckZumFormular);
  const ueberschrift = document.createElement("h3");
  ueberschrift.textContent = "Wiederholen";
  kopf.append(zurueck, ueberschrift);
  seite.appendChild(kopf);

  const satz = document.createElement("p");
  satz.className = "kal-wdh-satz";
  seite.appendChild(satz);

  const laufzeit = document.createElement("div");
  laufzeit.className = "kal-wdh-laufzeit";

  const nachziehen = () => {
    satz.textContent = wiederholungSatz(w);
    laufzeit.hidden = !WDH_FREQ[w.art];
  };
  const angefasst = () => { f.wdhAngefasst = true; nachziehen(); };

  const radio = (name, an, beiWahl) => {
    const r = document.createElement("input");
    r.type = "radio";
    r.name = name;
    r.checked = an;
    r.addEventListener("change", () => { if (r.checked) beiWahl(); });
    return r;
  };
  const zeile = () => {
    const z = document.createElement("label");
    z.className = "kal-wdh-zeile";
    return z;
  };
  const zahlFeld = (wert, max) => {
    const z = document.createElement("input");
    z.type = "number";
    z.className = "kal-wdh-zahl";
    z.inputMode = "numeric";
    z.min = "1";
    z.max = String(max);
    z.value = String(wert);
    return z;
  };
  const ganzeZahl = (roh, max) => Math.min(max, Math.max(1, Math.round(Number(roh)) || 1));

  // --- Rhythmus ---
  const gruppe = document.createElement("div");
  gruppe.className = "kal-wdh-gruppe";
  const keine = zeile();
  keine.append(radio("kal-wdh-art", w.art === "keine", () => { w.art = "keine"; angefasst(); }),
               document.createTextNode("Nicht wiederholen"));
  gruppe.appendChild(keine);

  for (const art of ["tag", "woche", "monat", "jahr"]) {
    const [jede, eins, mehr] = WDH_NAMEN[art];
    const z = zeile();
    const vor = document.createElement("span");
    const nach = document.createElement("span");
    const zahl = zahlFeld(w.art === art ? w.intervall : 1, 99);
    zahl.setAttribute("aria-label", `Wie oft: ${mehr}`);
    // "Jeden 1 Tag" liest sich schief - ab 2 heisst es "Alle 2 Tage".
    const beschrifte = n => { vor.textContent = n > 1 ? "Alle" : jede; nach.textContent = n > 1 ? mehr : eins; };
    beschrifte(Number(zahl.value));
    const knopf = radio("kal-wdh-art", w.art === art, () => {
      w.art = art;
      w.intervall = ganzeZahl(zahl.value, 99);
      angefasst();
    });
    // Ein Tipp in die Zahl waehlt die Zeile gleich mit - wer "3" tippt, meint
    // diesen Rhythmus.
    const nimm = () => {
      if (!knopf.checked) knopf.checked = true;
      w.art = art;
      w.intervall = ganzeZahl(zahl.value, 99);
      angefasst();
    };
    zahl.addEventListener("focus", nimm);
    zahl.addEventListener("input", () => {
      beschrifte(ganzeZahl(zahl.value, 99));
      if (zahl.value) nimm();   // leer waehrend des Tippens: noch nichts uebernehmen
    });
    zahl.addEventListener("change", () => { zahl.value = String(ganzeZahl(zahl.value, 99)); nimm(); });
    z.append(knopf, vor, zahl, nach);
    gruppe.appendChild(z);
  }
  seite.appendChild(gruppe);

  // --- Laufzeit ---
  const titel = document.createElement("p");
  titel.className = "kal-wdh-ueberschrift";
  titel.textContent = "Laufzeit";
  laufzeit.appendChild(titel);
  const gruppe2 = document.createElement("div");
  gruppe2.className = "kal-wdh-gruppe";

  const anzahlExtra = document.createElement("span");
  anzahlExtra.className = "kal-wdh-extra";
  const anzahl = zahlFeld(w.anzahl, 999);
  anzahl.setAttribute("aria-label", "Anzahl der Termine");
  anzahl.addEventListener("input", () => {
    if (!anzahl.value) return;
    w.anzahl = ganzeZahl(anzahl.value, 999);
    angefasst();
  });
  anzahl.addEventListener("change", () => { anzahl.value = String(ganzeZahl(anzahl.value, 999)); w.anzahl = Number(anzahl.value); angefasst(); });
  anzahlExtra.append(anzahl, document.createTextNode("Termine"));

  const bisFeld = baueWahlFeld("date", w.bis || f.startDatum,
    w.bis ? BIS_DATUM.format(datumAusIso(w.bis)) : "", v => {
      w.bis = v < f.startDatum ? f.startDatum : v;
      bisFeld.querySelector(".kal-form-wahl-text").textContent = BIS_DATUM.format(datumAusIso(w.bis));
      bisFeld.querySelector("input").value = w.bis;
      angefasst();
    }, "kal-wdh-bis", "Wiederholen bis");
  bisFeld.querySelector("input").min = f.startDatum;

  const zeigeExtras = () => {
    anzahlExtra.hidden = w.laufzeit !== "anzahl";
    bisFeld.hidden = w.laufzeit !== "bis";
  };
  const laufzeitWahl = (wert, text, extra) => {
    const z = zeile();
    z.append(radio("kal-wdh-laufzeit", w.laufzeit === wert, () => {
      w.laufzeit = wert;
      if (wert === "bis" && !w.bis) {
        w.bis = standardBis(w.art, f.startDatum);
        bisFeld.querySelector(".kal-form-wahl-text").textContent = BIS_DATUM.format(datumAusIso(w.bis));
        bisFeld.querySelector("input").value = w.bis;
      }
      zeigeExtras();
      angefasst();
    }), document.createTextNode(text));
    if (extra) z.appendChild(extra);
    gruppe2.appendChild(z);
  };
  laufzeitWahl("immer", "Für immer");
  laufzeitWahl("anzahl", "Bestimmte Anzahl", anzahlExtra);
  laufzeitWahl("bis", "Bis", bisFeld);
  zeigeExtras();
  laufzeit.appendChild(gruppe2);
  seite.appendChild(laufzeit);

  nachziehen();
  return seite;
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
  if (!f || f.speichert) return;
  if (!f.titel.trim()) {
    // Vorher passierte hier einfach nichts - man tippte auf Speichern, und
    // der Dialog blieb stumm stehen.
    const zeile = kalTerminBox.querySelector(".kal-form-titelzeile");
    if (zeile) zeile.classList.add("fehlt");
    const feld = kalTerminBox.querySelector(".kal-form-titel");
    if (feld) feld.focus();
    snackInfo("Bitte einen Titel eingeben.");
    return;
  }
  const w = f.wiederholung;
  if (w.laufzeit === "bis" && (!w.bis || w.bis < f.startDatum)) w.bis = f.startDatum;
  const regelNeu = baueRegel(w, f.ganztags);
  // Die Regel geht nur mit, wenn sie wirklich neu ist. Eine unangetastete
  // Serie - auch eine, deren Regel das Formular gar nicht abbilden kann -
  // bleibt so bei Google stehen, wie sie ist.
  const regelGeaendert = termin
    ? f.wdhAngefasst && w.art !== "fremd" && f.regelAlt !== null && regelNeu !== f.regelAlt
    : !!regelNeu;

  const rumpf = {
    titel: f.titel.trim(), ganztags: f.ganztags,
    startDatum: f.startDatum, endDatum: f.endDatum, vonZeit: f.vonZeit, bisZeit: f.bisZeit,
    farbe: f.farbe, notiz: f.notiz, ort: f.ort,
    zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
  };
  if (regelGeaendert) rumpf.regel = regelNeu;
  if (termin) {
    rumpf.id = termin.id;
    if (termin.serieId) {
      // Eine geaenderte Wiederholung gilt fuer die Serie, nie fuer einen
      // einzelnen Tag daraus - "Nur diesen Termin" entfaellt dann.
      const umfang = await frageUmfang("Änderung speichern", !regelGeaendert, false);
      if (!umfang || formularFelder !== f) return;
      rumpf.serieId = termin.serieId;
      rumpf.umfang = umfang;
    }
  }

  // Gegen den Doppeltipp: eine zweite Anfrage legte den Termin zweimal an.
  f.speichert = true;
  const knopf = kalTerminBox.querySelector(".kal-fuss-knopf.primaer");
  if (knopf) knopf.disabled = true;
  const ok = await terminAnfrage(termin ? "PUT" : "POST", rumpf);
  f.speichert = false;
  if (!ok) { if (knopf) knopf.disabled = false; return; }
  schliesseTerminFormular();
  // Frisch holen statt von Hand nachzupflegen: so steht im Panel genau das,
  // was bei Google steht - bei einer Serie auch alle anderen Tage.
  googleGeladen = null;
  await ladeGoogle();
  snackInfo(termin ? "Termin geändert." : "Termin angelegt.");
}

// Loeschen sitzt seit 24.09.2026 in der Zwischenmaske, nicht mehr im
// Formular. Die Rueckfrage bleibt: bei Google ist Loeschen endgueltig.
async function loescheTerminBeiGoogle(termin) {
  const rumpf = { id: termin.id };
  if (termin.serieId) {
    const umfang = await frageUmfang(`„${termin.titel}“ löschen`, true, true);
    if (!umfang) return;
    rumpf.serieId = termin.serieId;
    rumpf.umfang = umfang;
  } else {
    const ja = await frage(`„${termin.titel}“ löschen?`, "Der Termin wird auch bei Google gelöscht.",
      [{ wert: "ja", text: "Löschen", gefahr: true }]);
    if (!ja) return;
  }
  const ok = await terminAnfrage("DELETE", rumpf);
  if (!ok) return;
  schliesseTerminDetail();
  googleGeladen = null;
  await ladeGoogle();
  snackInfo("Termin gelöscht.");
}

/* ---------- Rueckfrage ---------- */
/**
 * Kleiner Dialog mit Knoepfen, liefert als Promise den gewaehlten Wert - oder
 * null fuer Abbrechen, Tipp daneben, Escape und Zurueck-Taste. Eigenes Element
 * ganz oben (#kalFrage), weil es sich sowohl ueber das Formular als auch ueber
 * die Zwischenmaske legt.
 */
let frageAufloesen = null;

function frage(titel, text, optionen) {
  // Eine noch offene Frage gilt als abgebrochen, bevor die naechste kommt.
  if (frageAufloesen) beantworteFrage(null);
  return new Promise(aufloesen => {
    frageAufloesen = aufloesen;
    kalFrageBox.replaceChildren();
    const kopf = document.createElement("p");
    kopf.className = "kal-frage-titel";
    kopf.textContent = titel;
    kalFrageBox.appendChild(kopf);
    if (text) {
      const erklaerung = document.createElement("p");
      erklaerung.className = "kal-frage-text";
      erklaerung.textContent = text;
      kalFrageBox.appendChild(erklaerung);
    }
    const knoepfe = document.createElement("div");
    knoepfe.className = "kal-frage-knoepfe";
    for (const o of optionen) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn" + (o.gefahr ? " gefahr" : "");
      b.textContent = o.text;
      b.addEventListener("click", () => beantworteFrage(o.wert));
      knoepfe.appendChild(b);
    }
    const abbrechen = document.createElement("button");
    abbrechen.type = "button";
    abbrechen.className = "btn";
    abbrechen.textContent = "Abbrechen";
    abbrechen.addEventListener("click", () => beantworteFrage(null));
    knoepfe.appendChild(abbrechen);
    kalFrageBox.appendChild(knoepfe);
    kalFrage.hidden = false;
    if (!("ontouchstart" in window)) knoepfe.firstChild.focus();
  });
}

function beantworteFrage(wert) {
  const aufloesen = frageAufloesen;
  frageAufloesen = null;
  kalFrage.hidden = true;
  kalFrageBox.replaceChildren();
  if (aufloesen) aufloesen(wert);
}

// Die drei Wege bei einer Serie - wie bei Samsung und Google.
function frageUmfang(titel, mitDiesem, gefahr) {
  const optionen = [];
  if (mitDiesem) optionen.push({ wert: "dieser", text: "Nur diesen Termin", gefahr });
  optionen.push({ wert: "folgende", text: "Diesen und alle folgenden", gefahr },
                { wert: "alle", text: "Alle Termine der Serie", gefahr });
  return frage(titel, "Dieser Termin gehört zu einer Serie.", optionen);
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

// Das Symbol steht vor der Beschriftung: ToDos und Termine unterscheiden sich
// dadurch schon am Rand, bevor man das Wort gelesen hat. Vorher sahen beide
// Ueberschriften gleich aus (dieselbe graue Kapitaelchen-Zeile) und die
// Abschnitte liefen ineinander.
function baueGruppenKopf(text, beimPlus, einzahl, faellig, symbol) {
  const kopf = document.createElement("p");
  kopf.className = "kal-gruppe" + (faellig ? " faellig" : "");
  const beschriftung = document.createElement("span");
  beschriftung.className = "kal-gruppe-text";
  if (symbol) {
    const zeichen = document.createElement("span");
    zeichen.className = "kal-gruppe-symbol";
    zeichen.setAttribute("aria-hidden", "true");
    zeichen.textContent = symbol;
    beschriftung.appendChild(zeichen);
  }
  beschriftung.appendChild(document.createTextNode(text));
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

// Google-Termin: ein Tipp oeffnet die Zwischenmaske (siehe
// oeffneTerminDetail). Bearbeitet wird erst aus ihr heraus - vorher landete
// man beim blossen Nachsehen sofort im Formular und musste "Abbrechen"
// treffen, um nichts zu veraendern.
function baueTerminZeile(t) {
  const box = document.createElement("div");
  box.className = "kal-termin-box";

  const kal = googleZustand.kalender.find(k => k.id === t.kalenderId);
  // Farbe kommt fertig aufgeloest vom Server (eigene Termin-Farbe schlaegt
  // Kalender-Farbe); der Rueckgriff auf den Kalender faengt nur aeltere
  // Antworten ohne das Feld ab.
  const farbe = farbWert(t.farbe) || farbWert(kal && kal.farbe);

  const knopf = document.createElement("button");
  knopf.className = "kal-eintrag kal-termin";
  knopf.type = "button";
  knopf.addEventListener("click", () => oeffneTerminDetail(t));

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
  // Das Winkelzeichen rechts sagt: hier geht etwas auf. Ein Stift stand hier
  // frueher und versprach zu viel - er fuehrte direkt ins Formular.
  const zeichen = document.createElement("span");
  zeichen.className = "kal-termin-pfeil";
  zeichen.textContent = "›";
  knopf.appendChild(zeichen);
  box.appendChild(knopf);
  return box;
}

/* ---------- Zwischenmaske: Termin ansehen ---------- */

// Klickbare Links aus einem Text: alles, was mit http:// oder https://
// anfaengt. Bewusst nur diese beiden Schemata - "javascript:" waere hier ein
// offenes Scheunentor, und der Text kommt von fremden Kalendern.
// Der Rest bleibt Text (textContent), nie Markup.
function textMitLinks(roh) {
  const stueck = document.createDocumentFragment();
  const muster = /https?:\/\/[^\s<>"']+/g;
  let zuletzt = 0;
  let treffer;
  while ((treffer = muster.exec(roh)) !== null) {
    if (treffer.index > zuletzt) {
      stueck.appendChild(document.createTextNode(roh.slice(zuletzt, treffer.index)));
    }
    // Satzzeichen am Ende gehoeren zum Satz, nicht zur Adresse.
    let adresse = treffer[0].replace(/[.,;:!?)\]]+$/, "");
    const a = document.createElement("a");
    a.href = adresse;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = adresse;
    stueck.appendChild(a);
    zuletzt = treffer.index + adresse.length;
  }
  if (zuletzt < roh.length) stueck.appendChild(document.createTextNode(roh.slice(zuletzt)));
  return stueck;
}

// Google liefert Beschreibungen teils als HTML. Tags fliegen raus, aber
// Zeilenumbrueche bleiben erhalten: eine Liste, die zu einem einzigen Absatz
// zusammenlaeuft, ist im Dialog schlechter lesbar als im Kalender selbst.
function beschreibungAlsText(roh) {
  return roh
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Der Zeitraum in Worten - im Dialog steht mehr Platz zur Verfuegung als in
// der Zeile, also auch das Datum und bei mehrtaegigen Terminen beide Enden.
function detailZeitraum(t) {
  const tageDrin = tageEinesTermins(t);
  const ersterTag = tageDrin[0];
  const letzterTag = tageDrin[tageDrin.length - 1];
  const alsDatum = iso => {
    if (!iso) return "";
    const [j, m, tg] = iso.split("-").map(Number);
    return TAG_FORMAT.format(new Date(j, m - 1, tg));
  };
  if (t.ganztags) {
    return ersterTag === letzterTag
      ? `${alsDatum(ersterTag)} · ganztägig`
      : `${alsDatum(ersterTag)} – ${alsDatum(letzterTag)} · ganztägig`;
  }
  const zeit = zeitLabel(t);
  return [alsDatum(ersterTag), zeit].filter(Boolean).join(" · ");
}

function oeffneTerminDetail(termin) {
  detailTermin = termin;
  zeichneTerminDetail();
}

function schliesseTerminDetail() {
  if (!detailTermin) return;
  detailTermin = null;
  zeichneTerminDetail();
}

// Wie beim Formular bewusst NICHT aus zeichneKalender() heraus: das laeuft bei
// jedem Sync, und ein Dialog, der einem unter den Fingern neu entsteht,
// verliert die Scrollposition in einer langen Notiz.
function zeichneTerminDetail() {
  kalDetailPopup.hidden = !detailTermin;
  kalDetailBox.innerHTML = "";
  if (!detailTermin) return;
  const t = detailTermin;

  const kopf = document.createElement("p");
  kopf.className = "kal-popup-kopf";
  kopf.appendChild(document.createTextNode("Termin"));
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "kal-schliessen";
  zu.setAttribute("aria-label", "Schließen");
  zu.textContent = "✕";
  zu.addEventListener("click", schliesseTerminDetail);
  kopf.appendChild(zu);
  kalDetailBox.appendChild(kopf);

  const inhalt = document.createElement("div");
  inhalt.className = "kal-detail";

  const kal = googleZustand.kalender.find(k => k.id === t.kalenderId);
  const farbe = farbWert(t.farbe) || farbWert(kal && kal.farbe);

  const titel = document.createElement("h4");
  titel.className = "kal-detail-titel";
  if (farbe) titel.style.borderLeftColor = farbe;
  titel.textContent = t.titel || "(ohne Titel)";
  inhalt.appendChild(titel);

  const zeitZeile = document.createElement("p");
  zeitZeile.className = "kal-detail-zeit";
  zeitZeile.textContent = detailZeitraum(t);
  inhalt.appendChild(zeitZeile);

  // Herkunft wie in der Zeile nur bei WEITEREN Kalendern - beim eigenen
  // Hauptkalender stuende hier der eigene Name.
  if (kal && !kal.primaer) {
    const quelle = document.createElement("p");
    quelle.className = "kal-detail-quelle";
    quelle.textContent = kalenderName(kal);
    inhalt.appendChild(quelle);
  }

  // Serientermin: nur der Hinweis, nicht die Regel - die kennt Google nur am
  // Stammtermin, und fuers Ansehen lohnt die zusaetzliche Anfrage nicht.
  if (t.serieId) {
    const serie = document.createElement("p");
    serie.className = "kal-detail-quelle";
    serie.textContent = "🔁 Wiederholt sich";
    inhalt.appendChild(serie);
  }

  // Der Ort fuehrt zu Google Maps. Die Adresse steht als Text da UND als
  // Link: wer nur nachsehen will, liest sie, wer hinmuss, tippt sie an.
  // Der maps-Link ist plattformneutral (Web); auf dem Handy uebernimmt ihn
  // die installierte Karten-App von selbst.
  if (t.ort) {
    const zeile = document.createElement("p");
    zeile.className = "kal-detail-ort";
    zeile.appendChild(document.createTextNode("📍 "));
    const a = document.createElement("a");
    a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(t.ort);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = t.ort;
    a.title = "Auf Google Maps zeigen";
    zeile.appendChild(a);
    inhalt.appendChild(zeile);
  }

  if (t.beschreibung) {
    const text = beschreibungAlsText(t.beschreibung);
    if (text) {
      const notiz = document.createElement("div");
      notiz.className = "kal-detail-notiz";
      notiz.appendChild(textMitLinks(text));
      inhalt.appendChild(notiz);
    }
  }

  const knoepfe = document.createElement("div");
  knoepfe.className = "kal-form-knoepfe";
  // Bearbeiten und Loeschen nur mit Schreibrecht: ohne es waeren die Knoepfe
  // ein Versprechen, das die Verknuepfung nicht halten kann.
  const darf = googleZustand.verbunden && googleZustand.schreiben;
  if (darf) {
    const bearbeiten = document.createElement("button");
    bearbeiten.type = "button";
    bearbeiten.className = "btn klein primary";
    bearbeiten.textContent = "Bearbeiten";
    bearbeiten.addEventListener("click", () => {
      const tag = kalAuswahl;
      schliesseTerminDetail();
      oeffneTerminFormular(tag, t);
    });
    knoepfe.appendChild(bearbeiten);
  }
  const schliessen = document.createElement("button");
  schliessen.type = "button";
  schliessen.className = "btn klein";
  schliessen.textContent = "Schließen";
  schliessen.addEventListener("click", schliesseTerminDetail);
  knoepfe.appendChild(schliessen);
  // Loeschen sitzt seit 24.09.2026 hier und nicht mehr im Formular: dort
  // stehen unten nur noch Abbrechen und Speichern, wie im Samsung Kalender.
  if (darf) {
    const loeschen = document.createElement("button");
    loeschen.type = "button";
    loeschen.className = "btn klein gefahr";
    loeschen.textContent = "Löschen";
    loeschen.addEventListener("click", () => loescheTerminBeiGoogle(t));
    knoepfe.appendChild(loeschen);
  }
  inhalt.appendChild(knoepfe);

  kalDetailBox.appendChild(inhalt);
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
  // Am Handy (seit 24.09.2026, wie im Samsung Kalender): der erste Tipp
  // markiert, der zweite auf denselben Tag oeffnet ihn - siehe oeffneTag().
  if (!istSplit()) {
    if (iso === kalAuswahl) { oeffneTag(iso); return; }
    kalAuswahl = iso;
    schliesseEingaben();
    aktualisiereAuswahl();
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

/* ---------- Tages-Karte (Handy) ---------- */
/**
 * Am Handy fuellt das Raster die Ansicht (seit 24.09.2026, nach dem Samsung
 * Kalender); ein Tag zeigt seinen Inhalt in einer Karte darueber. Drin steht
 * dasselbe wie in der Tagesliste am Rechner - es ist dieselbe Funktion -, und
 * unten ein Feld fuer ein neues ToDo samt rundem Plus fuer einen Termin.
 *
 * Geschlossen wird mit einem Tipp daneben, Escape oder der Zurueck-Taste
 * (siehe schliesseObersteEbene). Wisch nach links oder rechts blaettert den
 * Tag, wie in der Tagesliste.
 */
let tagKarteOffen = false;
const KARTE_WOCHENTAG = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const KARTE_KURZ = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

// Leer heisst: kein ToDo, kein Termin - und am heutigen Tag auch nichts
// Ueberfaelliges, denn das steht dort mit in der Karte.
function tagIstLeer(iso) {
  const todos = kalenderTermine();
  if (todos.some(t => t.due === iso)) return false;
  if (iso === todayStr() && todos.some(t => t.due < iso)) return false;
  return !(termineNachTagen()[iso] || []).length;
}

// Der zweite Tipp auf einen Tag. Leer heisst "da will ich etwas eintragen" -
// also gleich der neue Termin. Ohne Schreibrecht bei Google oeffnet auch ein
// leerer Tag die Karte: dort laesst sich wenigstens ein ToDo anlegen.
function oeffneTag(iso) {
  if (tagIstLeer(iso) && googleZustand.verbunden && googleZustand.schreiben) {
    oeffneTerminFormular(iso, null);
    return;
  }
  oeffneTagKarte();
}

function oeffneTagKarte() {
  if (!kalAuswahl) return;
  tagKarteOffen = true;
  kalTagPopup.hidden = false;
  kalTagFeld.value = "";
  kalTagListe.scrollTop = 0;
  zeichneKalender();   // zeichnet die Karte mit
}

function schliesseTagKarte() {
  if (!tagKarteOffen) return;
  tagKarteOffen = false;
  kalTagPopup.hidden = true;
  kalTagFeld.value = "";
  kalTagFeld.blur();
}

// Kopf und Liste neu, das Feld unten NICHT: wer gerade tippt, soll dabei weder
// Fokus noch Text verlieren, wenn im Hintergrund etwas synchronisiert.
function zeichneTagKarte(tage, tageTermine, ueberfaellige, heute) {
  if (!tagKarteOffen || !kalAuswahl) return;
  const datum = datumAusIso(kalAuswahl);

  kalTagKopf.replaceChildren();
  const zahl = document.createElement("span");
  zahl.className = "kal-tagkarte-zahl";
  zahl.textContent = String(datum.getDate());
  const wochentag = document.createElement("span");
  wochentag.className = "kal-tagkarte-wochentag";
  wochentag.textContent = KARTE_WOCHENTAG.format(datum);
  const unter = document.createElement("span");
  unter.className = "kal-tagkarte-unter";
  unter.textContent = MONAT_FORMAT.format(datum);
  if (kalAuswahl === heute) {
    const chip = document.createElement("span");
    chip.className = "kal-heute-chip";
    chip.textContent = "heute";
    unter.appendChild(chip);
  }
  kalTagKopf.append(zahl, wochentag, unter);

  zeichneTagesliste(tage, tageTermine, ueberfaellige, heute, kalTagListe, true);

  kalTagFeld.placeholder = `Am ${KARTE_KURZ.format(datum)} hinzufügen`;
  // Ohne aktive Liste weiss das Feld nicht, wohin mit dem ToDo; ohne
  // Schreibrecht bei Google fuehrte das Plus in einen 403.
  kalTagFeld.hidden = !aktiveListe;
  kalTagPlus.hidden = !(googleZustand.verbunden && googleZustand.schreiben);
}

// Halb ausgefuelltes Formular und offene Eingabe gehoeren zu EINEM Tag - beim
// Wechsel woandershin waeren sie nur noch Altlast.
function schliesseEingaben() {
  wahlOffen = false;
  formularOffen = false;
  formularTermin = null;
  formularTag = null;
  formularFelder = null;
  if (frageAufloesen) beantworteFrage(null);
  todoEingabeOffen = false;
  anlegenText = "";
  detailTermin = null;
  kalWahl.hidden = true;
  kalTerminPopup.hidden = true;
  kalDetailPopup.hidden = true;
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
  // Am Handy gibt es keine Tagesliste, die leer aussehen koennte - dort ist die
  // Auswahl nur der erste von zwei Tipps. Ein von selbst gewaehlter Tag
  // oeffnete sich sonst schon beim ERSTEN Tipp. Heute bleibt gewaehlt.
  if (!istSplit()) {
    const heute = todayStr();
    kalAuswahl = heute.startsWith(`${jahr}-${String(monat + 1).padStart(2, "0")}`) ? heute : null;
  } else {
    kalAuswahl = treffer[0] || null;
  }
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
  // Erst die oberste Ebene (Rueckfrage, Formular, Detail, Karte ...): am Handy
  // ist die Zurueck-Taste DER Weg, so etwas zu schliessen. Der Kalender
  // bleibt dabei offen - also den Eintrag, den der Browser gerade abgeraeumt
  // hat, gleich wieder setzen.
  if (schliesseObersteEbene()) {
    history.pushState({ kalender: true }, "");
    return;
  }
  ausPopstate = true;
  historieEintrag = false;
  // schliesseKalender() statt nur setzePanel(false): sonst blieb kalOffen
  // stehen, und der 📅-Knopf oeffnete den Kalender danach nicht mehr - er
  // hielt ihn fuer offen (gefunden am 24.09.2026).
  schliesseKalender();
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

  // Die Tagesliste bleibt - nur im Vollbild nicht und am Handy nicht (dort
  // zeigt die Tages-Karte den Tag).
  kalTagesliste.hidden = rasterVoll();

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
  // Auch das Quellen-Menue startet zu - offen laege es ueber dem Raster.
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
  schliesseTagKarte();
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
  // Auf einem Ziehgriff gehoert die Bewegung dem Griff. Ohne das koennte ein
  // leicht schraeger Zug am Handy als Wisch durchgehen und das Panel zumachen,
  // waehrend man die Aufteilung einstellt.
  if (ziel.closest(".kal-griff")) return null;
  // Die Tages-Karte blaettert den Tag, wie die Tagesliste am Rechner.
  if (ziel.closest(".kal-tagkarte")) return "tag";
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
  if (modus === "tag") return [tagKarteOffen ? kalTagKarte : kalTagesliste];
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
    // Die Karte liegt ausserhalb des Panels (wie alle Dialoge), gehoert fuer
    // die Geste aber dazu.
    const inKarte = tagKarteOffen && kalTagKarte.contains(e.target);
    if (!kalPanel.contains(e.target) && !inKarte) return;
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
      // ueberall sonst Scrollen - das gehoert dem Browser. Am Handy fuellt das
      // Raster die Ansicht ohnehin, dort gibt es kein Vollbild zu schalten.
      if (geste.modus !== "monat" || !istSplit()) { geste = null; return; }
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
  if (geste.modus === "monat" || geste.modus === "tag") klickSchlucken = true;

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

const TEILUNG_MIN = 120;
const TEILUNG_KEY = "kalTeilung";

// Was das Raster mindestens braucht: 36 px je Zeile (dieselbe Untergrenze wie
// im CSS) plus Monatskopf und Wochentage. Als Funktion, weil die Zeilenzahl
// mit dem Monat wechselt.
function rasterMindest() {
  const zeilen = Number(getComputedStyle(kalRaster).getPropertyValue("--kal-zeilen")) || 6;
  return zeilen * 36 + 84;
}

// Wie hoch die Tagesliste hoechstens werden darf. Gerechnet wird ab ihrer
// OBERKANTE bis zum Panelboden, nicht ab der Panelhoehe: ueber der Liste
// stehen noch Kopfzeile und Umschalter, und wer die mitzaehlt, drueckt das
// Raster unter seine Mindesthoehe.
function teilungMax() {
  const panel = kalPanel.getBoundingClientRect();
  const oben = kalTagesliste.getBoundingClientRect().top - panel.top;
  return Math.max(TEILUNG_MIN, panel.height - oben - rasterMindest());
}

function setzeTeilung(px) {
  document.documentElement.classList.add("kal-eigene-teilung");
  document.documentElement.style.setProperty("--kal-teilung", Math.round(px) + "px");
  try { localStorage.setItem(TEILUNG_KEY, String(Math.round(px))); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

// Anwenden, OHNE den gemerkten Wert zu ueberschreiben. Auf einem niedrigen
// Fenster greifen die Grenzen - wuerde das Ergebnis zurueckgeschrieben, waere
// die am grossen Bildschirm eingestellte Aufteilung nach einmaligem Oeffnen am
// Handy dauerhaft verloren.
function wendeTeilungAn() {
  const roh = Number(localStorage.getItem(TEILUNG_KEY));
  if (!roh) {
    document.documentElement.classList.remove("kal-eigene-teilung");
    document.documentElement.style.removeProperty("--kal-teilung");
    return;
  }
  document.documentElement.classList.add("kal-eigene-teilung");
  document.documentElement.style.setProperty(
    "--kal-teilung", Math.round(klemme(roh, TEILUNG_MIN, teilungMax())) + "px");
}

zieheGriff(document.getElementById("kalGriffTeilung"), {
  achse: "hoehe",
  start: () => kalTagesliste.getBoundingClientRect().height,
  setze: setzeTeilung,
  zurueck: () => {
    localStorage.removeItem(TEILUNG_KEY);
    document.documentElement.classList.remove("kal-eigene-teilung");
    document.documentElement.style.removeProperty("--kal-teilung");
  },
  min: TEILUNG_MIN,
  max: teilungMax,
});

wendeTeilungAn();

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
  zeichneFilter();
});
// Ein Tipp neben das Menue schliesst es, wie bei jedem Menue. Der Tipp selbst
// geht trotzdem durch: wer daneben auf einen Tag tippt, will den Tag. In der
// Einfangphase, damit das Menue schon zu ist, wenn der Tag reagiert.
document.addEventListener("click", e => {
  if (!filterOffen) return;
  if (kalFilter.contains(e.target) || kalFilterKnopf.contains(e.target)) return;
  filterOffen = false;
  zeichneFilter();
}, true);
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
kalDetailPopup.addEventListener("click", e => { if (e.target === kalDetailPopup) schliesseTerminDetail(); });
kalTagPopup.addEventListener("click", e => { if (e.target === kalTagPopup) schliesseTagKarte(); });
kalFrage.addEventListener("click", e => { if (e.target === kalFrage) beantworteFrage(null); });
// Nach einem Wisch in der Karte schiebt der Browser noch einen Klick nach -
// der darf keinen Eintrag oeffnen (siehe klickSchlucken).
kalTagKarte.addEventListener("click", e => {
  if (!klickSchlucken) return;
  klickSchlucken = false;
  e.stopPropagation();
  e.preventDefault();
}, true);
kalTagFeld.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (!kalTagFeld.value.trim() || !kalAuswahl) return;
  const text = kalTagFeld.value;
  kalTagFeld.value = "";
  legeToDoAn(kalAuswahl, text);   // rendert und speichert selbst, die Karte zieht mit
});
kalTagPlus.addEventListener("click", () => { if (kalAuswahl) oeffneTerminFormular(kalAuswahl, null); });

// Schliesst die oberste offene Ebene und sagt, ob es eine gab. Escape und die
// Zurueck-Taste arbeiten sich damit von innen nach aussen: Rueckfrage,
// Formular (von der Wiederholen-Seite erst zurueck ins Formular), Detail,
// Monatswahl, Filter, zuletzt die Tages-Karte. "Bearbeiten" loest die
// Zwischenmaske ab, statt sich darueberzulegen - Formular und Detail sind
// also nie gleichzeitig offen.
function schliesseObersteEbene() {
  if (frageAufloesen) { beantworteFrage(null); return true; }
  if (formularOffen) {
    if (formularFelder && formularFelder.seite === "wiederholung") zurueckZumFormular();
    else schliesseTerminFormular();
    return true;
  }
  if (detailTermin) { schliesseTerminDetail(); return true; }
  if (wahlOffen) { schliesseWahl(); return true; }
  if (filterOffen) { filterOffen = false; zeichneFilter(); return true; }
  if (tagKarteOffen) { schliesseTagKarte(); return true; }
  return false;
}

// Escape arbeitet sich von innen nach aussen: erst der offene Dialog, dann das
// Vollbild, erst zuletzt das Panel. Sonst raeumte ein Tastendruck alles auf
// einmal weg.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !kalOffen) return;
  if (schliesseObersteEbene()) return;
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
  // Die Fensterhoehe entscheidet mit, wie weit die Aufteilung geklemmt wird.
  wendeTeilungAn();
  if (!kalOffen) return;
  if (istSplit() !== document.documentElement.classList.contains("kal-split")) {
    setzePanel(true, true);
    // Handy <-> Rechner: die Zellen tragen dort anderes (Klartext oder
    // Punkte), die Tages-Karte gibt es nur am Handy und das Vollbild nur am
    // Rechner - also frisch zeichnen statt nur nachzumessen.
    schliesseTagKarte();
    if (!istSplit() && kalVollbild) { kalVollbild = false; kalPanel.classList.remove("vollbild"); }
    vollbildPlaetze = 0;
    zeichneKalender();
    return;
  }
  if (rasterVoll()) messeVollbild();
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
  window.kalenderSpeicherLeeren();
  // Vergessen heisst vergessen: sonst hielte die Untergrenze das Raster auf
  // der Hoehe von Terminen, die es nach dem Trennen gar nicht mehr gibt.
  spurenVorher = [];
  googleZustand = { moeglich: false, verbunden: false, email: null, schreiben: false, kalender: [], palette: {} };
  googleTermine = [];
  googleGeladen = null;
  googleAus = false;
  googleFehler = false;
  // Eine offene Zwischenmaske zeigt einen Termin, den es nach dem Trennen
  // nicht mehr gibt - und ihr Bearbeiten-Knopf liefe ins Leere.
  detailTermin = null;
  zeichneTerminDetail();
  if (kalOffen) zeichneKalender();
};
