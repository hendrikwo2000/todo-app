"use strict";

/* ====================================================================
   Anlegen-Fenster (seit 15.11.2026). Ein Popup fuer alles Neue - Hendriks
   Wunsch: "ein Popup wie bei Bereich", und weil man viel oefter ToDos als
   Bereiche anlegt, ist ToDo immer vorgewaehlt. Markup #anlegenPopup in
   index.html, Aussehen in style.css ("Anlegen-Fenster").

   Wer es oeffnet und was der Umschalter zeigt:
     ＋ unten am Handy, Liste:     ToDo | Bereich
     ＋ unten am Handy, Kalender:  ToDo | Termin  (bis = gewaehlter Tag;
                                   Termin nur mit Schreibrecht bei Google -
                                   dieselbe Bedingung wie am runden Plus der
                                   Tages-Karte, sonst endete es in einem 403)
     "＋ ToDo" oben (iPad/Rechner): ToDo | Bereich, ToDo gewaehlt
     "＋ Bereich" oben:             ToDo | Bereich, Bereich gewaehlt
     "＋ ToDo anlegen" im leeren Board: wie "＋ ToDo"
   Das "+ ToDo" unten in jedem Bereich bleibt das schnelle Feld direkt im
   Bereich (Hendriks Wahl).

   Felder fuer ein ToDo (Hendriks Wahl): Titel, Bereich (vorbelegt "Ohne
   Bereich"), bis. Die Notiz kommt wie bisher ueber Bearbeiten dazu. "Termin"
   im Umschalter oeffnet das Termin-Formular und nimmt den getippten Titel mit.

   Braucht aus app.js: state, aktiveListe, addTodoTo, ohneBereichId,
   istOhneBereich, OHNE_NAME, uid, render, save, snackInfo, todayStr.
   Aus kalender.js: kalOffen, kalAuswahl, googleZustand, istSplit,
   oeffneTerminFormular, formularFelder, zeichneTerminPopup, kalTerminBox.
   ==================================================================== */

const anlegenPopup        = document.getElementById("anlegenPopup");
const anlegenForm         = document.getElementById("anlegenForm");
const anlegenReiter       = document.getElementById("anlegenReiter");
const anlegenTitel        = document.getElementById("anlegenTitel");
const anlegenBereichZeile = document.getElementById("anlegenBereichZeile");
const anlegenBereich      = document.getElementById("anlegenBereich");
const anlegenBisZeile     = document.getElementById("anlegenBisZeile");
const anlegenBis          = document.getElementById("anlegenBis");
const anlegenBisWeg       = document.getElementById("anlegenBisWeg");

const ANLEGEN_PLATZHALTER = {
  todo: "Was ist zu tun?",
  bereich: "Name, z. B. Haushalt oder Arbeit",
};

let anlegenArt = "todo";

// Im Kalender gilt der gewaehlte Tag - wie beim ＋ in der Tages-Karte.
function anlegenTag() {
  if (!kalAuswahl) kalAuswahl = todayStr();
  return kalAuswahl;
}

function anlegenTerminMoeglich() {
  return !!(googleZustand.verbunden && googleZustand.schreiben);
}

/**
 * Oeffnet das Fenster. `art` ist die vorgewaehlte Art ("todo" oder
 * "bereich"); `imKalender` schaltet den Umschalter auf ToDo | Termin.
 */
function oeffneAnlegen(art = "todo", imKalender = false) {
  const arten = [];
  if (aktiveListe) arten.push("todo");
  if (imKalender) { if (anlegenTerminMoeglich()) arten.push("termin"); }
  else if (aktiveListe) arten.push("bereich");
  if (!arten.length) return;
  // Bleibt nur der Termin (keine Liste), gibt es nichts umzuschalten.
  if (arten.length === 1 && arten[0] === "termin") { oeffneTerminFormular(anlegenTag(), null); return; }

  for (const k of anlegenReiter.children) k.hidden = !arten.includes(k.dataset.art);
  anlegenReiter.hidden = arten.length < 2;
  anlegenTitel.value = "";
  fuelleAnlegenBereiche();
  setzeAnlegenBis(imKalender ? anlegenTag() : "");
  waehleAnlegenArt(arten.includes(art) ? art : arten[0]);
  anlegenPopup.hidden = false;
  anlegenTitel.focus();
}

function schliesseAnlegen() {
  if (anlegenPopup.hidden) return false;
  anlegenPopup.hidden = true;
  anlegenTitel.blur();
  return true;
}

function waehleAnlegenArt(art) {
  if (art === "termin") {
    // Termine haben ihr eigenes Formular (Uhrzeit, Ort, Wiederholung ...) -
    // der Umschalter fuehrt dorthin und nimmt den Titel mit.
    const titel = anlegenTitel.value.trim();
    const tag = anlegenBis.value || anlegenTag();
    schliesseAnlegen();
    oeffneTerminFormular(tag, null);
    if (titel && formularFelder) {
      formularFelder.titel = titel;
      zeichneTerminPopup();
    }
    return;
  }
  anlegenArt = art;
  for (const k of anlegenReiter.children) k.setAttribute("aria-selected", String(k.dataset.art === art));
  anlegenTitel.placeholder = ANLEGEN_PLATZHALTER[art];
  anlegenBereichZeile.hidden = art !== "todo";
  anlegenBisZeile.hidden = art !== "todo";
  anlegenTitel.focus();
}

// "Ohne Bereich" zuerst, dann die Bereiche der aktiven Liste in ihrer
// Reihenfolge. Der Sonder-Bereich selbst steht nicht noch einmal darin.
function fuelleAnlegenBereiche() {
  const ohne = document.createElement("option");
  ohne.value = "";
  ohne.textContent = OHNE_NAME;
  const rest = state.categories.filter(c => !istOhneBereich(c.id)).map(c => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    return o;
  });
  anlegenBereich.replaceChildren(ohne, ...rest);
  anlegenBereich.value = "";
}

function setzeAnlegenBis(wert) {
  anlegenBis.value = wert || "";
  zeigeAnlegenBis();
}

// Leer steht "kein Datum" ueber dem Feld (Klasse), gesetzt das ✕ daneben.
function zeigeAnlegenBis() {
  const hat = !!anlegenBis.value;
  anlegenBis.parentElement.classList.toggle("hat-wert", hat);
  anlegenBisWeg.hidden = !hat;
}

function legeAusFensterAn() {
  const text = anlegenTitel.value.trim();
  if (!text) { anlegenTitel.focus(); return; }

  if (anlegenArt === "bereich") {
    state.categories.push({ id: uid(), name: text });
    schliesseAnlegen();
    render();
    save();
    snackInfo(`Bereich „${text}“ angelegt`);
    return;
  }

  let bereich = anlegenBereich.value;
  if (!bereich || !state.categories.some(c => c.id === bereich)) {
    bereich = ohneBereichId(aktiveListe);
    if (!state.categories.some(c => c.id === bereich)) {
      state.categories.unshift({ id: bereich, name: OHNE_NAME });
    }
  }
  const name = state.categories.find(c => c.id === bereich)?.name || OHNE_NAME;
  schliesseAnlegen();
  addTodoTo(bereich, null, text, anlegenBis.value || null, null);   // rendert und speichert selbst
  // Das neue ToDo kann ausserhalb des Bildes landen (anderer Bereich, im
  // Kalender gar nicht zu sehen) - kurz sagen, dass und wo es liegt.
  snackInfo(istOhneBereich(bereich) ? `„${text}“ angelegt` : `„${text}“ in ${name} angelegt`);
}

// ---------- Verdrahtung ----------
for (const k of anlegenReiter.children) {
  k.addEventListener("click", () => waehleAnlegenArt(k.dataset.art));
}
anlegenForm.addEventListener("submit", e => { e.preventDefault(); legeAusFensterAn(); });
document.getElementById("anlegenAbbrechen").addEventListener("click", schliesseAnlegen);
anlegenPopup.addEventListener("click", e => { if (e.target === anlegenPopup) schliesseAnlegen(); });
anlegenBis.addEventListener("input", zeigeAnlegenBis);
anlegenBis.addEventListener("change", zeigeAnlegenBis);
anlegenBisWeg.addEventListener("click", () => { setzeAnlegenBis(""); });

// Escape in der Einfangphase und mit stopImmediatePropagation: app.js und
// kalender.js haengen ihre Escape-Handler an denselben Knoten, der des
// Kalenders klappte im selben Druck sonst die ganze Kalenderansicht zu.
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && schliesseAnlegen()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// Das ＋ unten: im Kalender (am Handy eine eigene Ansicht) ToDo | Termin.
document.getElementById("fussPlus").addEventListener("click", () => {
  oeffneAnlegen("todo", kalOffen && !istSplit());
});
document.getElementById("addTodoBtn").addEventListener("click", () => oeffneAnlegen("todo"));
document.getElementById("addCatBtn").addEventListener("click", () => oeffneAnlegen("bereich"));
