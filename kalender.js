"use strict";

/* ====================================================================
   Kalender – Panel am rechten Rand

   Zeigt alle offenen ToDos MIT Termin aus ALLEN geladenen Listen (eigene
   und geteilte): Monatsraster oben, Tagesliste darunter. Rein lesend -
   ein Tipp auf einen Eintrag schliesst das Panel und oeffnet das ToDo im
   gewohnten Bearbeiten-Modus auf dem Board. Deshalb braucht der Kalender
   keine eigene Speicher-, Wiederholungs- oder Unterpunkt-Logik.

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
const kalLock        = document.getElementById("lock");

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONAT_FORMAT = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const TAG_FORMAT   = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

// Schluessel der Sonder-Auswahl "Ueberfaellig" - steht anstelle eines
// ISO-Datums in kalAuswahl, weil Ueberfaelliges ueber viele Tage verstreut
// liegt und sonst in irgendeinem Vormonat verschwinden wuerde.
const UEBERFAELLIG = "ueberfaellig";

let kalOffen = false;
let kalJahr = 0;         // angezeigter Monat
let kalMonatNr = 0;      // 0-basiert, wie bei Date
let kalAuswahl = null;   // ISO-Tag, UEBERFAELLIG oder null (nichts gewaehlt)

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

// ---------- Zeichnen ----------
function zeichneKalender() {
  const termine = kalenderTermine();
  const tage = nachTagen(termine);
  const heute = todayStr();

  kalMonatName.textContent = MONAT_FORMAT.format(new Date(kalJahr, kalMonatNr, 1));

  // Ueberfaellig-Chip: nur wenn es welche gibt.
  const ueberfaellige = termine.filter(t => t.due < heute);
  kalUeberfaellig.hidden = ueberfaellige.length === 0;
  kalUeberfaellig.textContent = `⚠ Überfällig (${ueberfaellige.length})`;
  kalUeberfaellig.classList.toggle("gewaehlt", kalAuswahl === UEBERFAELLIG);

  zeichneRaster(tage, heute);
  zeichneTagesliste(tage, ueberfaellige, heute);
}

function zeichneRaster(tage, heute) {
  kalWochentage.innerHTML = "";
  for (const w of WOCHENTAGE) {
    const zelle = document.createElement("span");
    zelle.textContent = w;
    kalWochentage.appendChild(zelle);
  }

  kalRaster.innerHTML = "";
  // getDay() zaehlt ab Sonntag, das Raster beginnt aber am Montag.
  const ersterWochentag = (new Date(kalJahr, kalMonatNr, 1).getDay() + 6) % 7;
  const tageImMonat = new Date(kalJahr, kalMonatNr + 1, 0).getDate();

  // Leerzellen vor dem Monatsersten. Bewusst LEER statt blasser Nachbartage:
  // ein Tag ohne Punkte sieht frei aus - das darf er nur, wenn es stimmt.
  for (let i = 0; i < ersterWochentag; i++) {
    kalRaster.appendChild(document.createElement("span"));
  }

  for (let tag = 1; tag <= tageImMonat; tag++) {
    const iso = isoTag(kalJahr, kalMonatNr, tag);
    const eintraege = tage[iso] || [];
    const zelle = document.createElement("button");
    zelle.type = "button";
    zelle.className = "kal-tag";
    zelle.dataset.tag = iso;
    if (iso === heute) zelle.classList.add("heute");
    if (iso === kalAuswahl) zelle.classList.add("gewaehlt");
    if (eintraege.length && iso < heute) zelle.classList.add("ueberfaellig");
    if (eintraege.length > 3) zelle.classList.add("viele");

    const zahl = document.createElement("span");
    zahl.className = "kal-zahl";
    zahl.textContent = String(tag);
    zelle.appendChild(zahl);

    const punkte = document.createElement("span");
    punkte.className = "kal-punkte";
    for (const t of eintraege.slice(0, 3)) {
      const punkt = document.createElement("span");
      punkt.className = "kal-punkt" + (t.farbe ? " farbe-" + t.farbe : "");
      punkte.appendChild(punkt);
    }
    zelle.appendChild(punkte);

    if (eintraege.length) {
      zelle.title = eintraege.length === 1 ? "1 ToDo" : `${eintraege.length} ToDos`;
    }
    kalRaster.appendChild(zelle);
  }
}

function zeichneTagesliste(tage, ueberfaellige, heute) {
  kalTagesliste.innerHTML = "";

  let titel;
  let eintraege;
  let mitDatum = false;
  if (kalAuswahl === UEBERFAELLIG) {
    titel = "Überfällig";
    eintraege = ueberfaellige;
    mitDatum = true;   // liegt quer ueber viele Tage, das Datum gehoert dazu
  } else if (kalAuswahl) {
    const [j, m, t] = kalAuswahl.split("-").map(Number);
    titel = TAG_FORMAT.format(new Date(j, m - 1, t));
    eintraege = tage[kalAuswahl] || [];
  } else {
    titel = "";
    eintraege = [];
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

  if (!eintraege.length) {
    const leer = document.createElement("p");
    leer.className = "kal-leer";
    leer.textContent = kalAuswahl ? "Nichts fällig." : "In diesem Monat steht nichts an.";
    kalTagesliste.appendChild(leer);
    return;
  }

  for (const t of eintraege) kalTagesliste.appendChild(baueEintrag(t, mitDatum));
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
