"use strict";

/* ====================================================================
   Anlegen-Fenster (seit 15.11.2026). Ein Popup fuer alles Neue, geoeffnet vom
   ＋ der Leiste (navigation.js) - am Handy unten, darueber oben rechts.
   Markup #anlegenPopup in index.html, Aussehen in style.css
   ("Anlegen-Fenster").

   Ausserdem oeffnet "＋ ToDo" im Kopf eines Bereichs (ab Tablet-Breite) das
   Fenster mit diesem Bereich vorgewaehlt.

   Hendriks Wahlen (in drei Runden am selben Tag):
   - ein Popup "wie bei Bereich", ToDo immer vorgewaehlt;
   - Umschalter ToDo | Termin - "ich verwende viel ToDo und Termin, Bereich
     kaum": ein neuer Bereich ist nur noch der kleine Link unten;
   - ToDo: Titel, Bereich, (Thema, wenn der Bereich welche hat), bis;
   - Termin: seit 19.11.2026 gleich mit ALLEN Feldern (Hendrik: "wenn ich auf
     Termin gehe, sollen direkt alle Optionen sein, und ganz oben Titel und
     Notiz, 1 zu 1 wie bei ToDo"). Dafuer uebernimmt das volle
     Termin-Formular (kalender.js) an genau derselben Stelle, mit demselben
     Kopf und Umschalter (f.ausNeu, Klasse .wie-neu) - "ToDo" dort fuehrt
     hierher zurueck. Vorher gab es hier eine Kurzform und "Mehr".
   - Von "Neuer Bereich" fuehrt der Umschalter zurueck (seit 19.11.2026):
     dort erscheint er mit drittem Feld "Bereich".
   Termin gibt es nur mit Schreibrecht bei Google (sonst endete es in einem
   403 - dieselbe Bedingung wie am runden Plus der Tages-Karte); ohne bleibt
   nur ToDo und der Umschalter verschwindet.

   Vorbelegung: steht der Kalender offen, gilt sein gewaehlter Tag fuer den
   Termin; in der Kalenderansicht am Handy zusaetzlich als "bis" des ToDos.

   Braucht aus app.js: state, aktiveListe, addTodoTo, ohneBereichId,
   istOhneBereich, OHNE_NAME, themenIn, uid, render, save, snackInfo,
   todayStr. Aus kalender.js: kalOffen, kalAuswahl, googleZustand, istSplit,
   oeffneTerminFormular, formularFelder, zeichneTerminPopup, kalTerminBox.
   ==================================================================== */

const anlegenPopup       = document.getElementById("anlegenPopup");
const anlegenForm        = document.getElementById("anlegenForm");
const anlegenReiter      = document.getElementById("anlegenReiter");
const anlegenUeberschrift = document.getElementById("anlegenUeberschrift");
const anlegenTitel       = document.getElementById("anlegenTitel");
const anlegenNotiz       = document.getElementById("anlegenNotiz");
const anlegenKopfTitel   = document.getElementById("anlegenKopfTitel");
const anlegenBereich     = document.getElementById("anlegenBereich");
const anlegenThemaZeile  = document.getElementById("anlegenThemaZeile");
const anlegenThema       = document.getElementById("anlegenThema");
const anlegenBis         = document.getElementById("anlegenBis");
const anlegenBisWeg      = document.getElementById("anlegenBisWeg");
const anlegenOk          = document.getElementById("anlegenOk");
const anlegenBereichLink = document.getElementById("anlegenBereichLink");

const ANLEGEN_PLATZHALTER = {
  todo: "Was ist zu tun?",
  bereich: "Name, z. B. Haushalt oder Arbeit",
};

let anlegenArt = "todo";
// Was beim Oeffnen mitkam (seit 19.11.2026): tag = Tag aus der Tageskarte
// (Termin-Beginn bzw. "bis"), ohneBereich = kein Link "Neuer Bereich" (aus dem
// Kalender heraus ergibt ein neuer Bereich keinen Sinn - Hendriks Wahl).
let anlegenVorgabe = {};

function anlegenTerminMoeglich() {
  return !!(googleZustand.verbunden && googleZustand.schreiben);
}

// Der Tag, an dem ein Termin vorbelegt startet: mit offenem Kalender dessen
// Auswahl, sonst heute.
function anlegenStartTag() {
  return anlegenVorgabe.tag || (kalOffen && kalAuswahl) || todayStr();
}

// vorgabe.bereich: der Bereich, aus dem heraus geoeffnet wurde ("＋ ToDo" im
// Bereichskopf) - dann ist er vorgewaehlt. vorgabe.titel/.notiz: was schon
// getippt war (Rueckweg aus dem Termin-Formular). vorgabe.art = "termin":
// gleich der Termin (das runde ＋ der Tageskarte), vorgabe.tag/.ohneBereich
// siehe anlegenVorgabe.
function oeffneAnlegen(vorgabe = {}) {
  const todo = !!aktiveListe;
  const termin = anlegenTerminMoeglich();
  if (!todo && !termin) return;
  anlegenVorgabe = { tag: vorgabe.tag || null, ohneBereich: !!vorgabe.ohneBereich };
  // Ohne Liste gibt es nur Termine - dann gleich ins Termin-Formular. Ebenso,
  // wenn der Termin vorgewaehlt sein soll und es ihn gibt.
  if (!todo || (vorgabe.art === "termin" && termin)) {
    anlegenZumTermin(vorgabe.titel || "", vorgabe.notiz || "");
    return;
  }

  anlegenTitel.value = vorgabe.titel || "";
  anlegenNotiz.value = vorgabe.notiz || "";
  fuelleAnlegenBereiche();
  if (vorgabe.bereich && !istOhneBereich(vorgabe.bereich)
      && state.categories.some(c => c.id === vorgabe.bereich)) {
    anlegenBereich.value = vorgabe.bereich;
  }
  // In der Kalenderansicht am Handy hat ein neues ToDo den gewaehlten Tag als
  // "bis" (wie das ＋ an "ToDos" in der Tages-Karte); sonst keins.
  const kalAnsicht = kalOffen && !istSplit();
  setzeAnlegenBis(anlegenVorgabe.tag || (kalAnsicht ? anlegenStartTag() : ""));
  waehleAnlegenArt("todo");
  anlegenPopup.hidden = false;
  passeNotizHoeheAn(anlegenNotiz);
  anlegenTitel.focus();
}

// Vom Termin-Formular zurueck ("ToDo" in dessen Umschalter, kalender.js).
window.anlegenZuToDo = mit => oeffneAnlegen(mit || {});

function schliesseAnlegen() {
  if (anlegenPopup.hidden) return false;
  anlegenPopup.hidden = true;
  anlegenTitel.blur();
  return true;
}

function waehleAnlegenArt(art) {
  // Termin: das volle Formular uebernimmt (kalender.js), mit dem, was schon
  // getippt ist.
  if (art === "termin") { anlegenZumTermin(anlegenTitel.value, anlegenNotiz.value); return; }
  anlegenArt = art;
  const bereich = art === "bereich";
  // Der Umschalter: ToDo | Termin (Termin nur mit Schreibrecht bei Google),
  // bei "Neuer Bereich" zusaetzlich "Bereich" als gewaehltes Feld - so sieht
  // man, wo man ist, und kommt per Tipp zurueck.
  for (const k of anlegenReiter.children) {
    k.setAttribute("aria-selected", String(k.dataset.art === art));
    if (k.dataset.art === "termin") k.hidden = !anlegenTerminMoeglich();
    if (k.dataset.art === "bereich") k.hidden = !bereich;
  }
  anlegenReiter.hidden = [...anlegenReiter.children].filter(k => !k.hidden).length < 2;
  anlegenUeberschrift.hidden = true;
  anlegenKopfTitel.textContent = bereich ? "Neuer Bereich" : "Neu";
  anlegenNotiz.hidden = bereich;
  anlegenTitel.placeholder = ANLEGEN_PLATZHALTER[art];
  for (const z of anlegenForm.querySelectorAll("[data-fuer]")) z.hidden = z.dataset.fuer !== art;
  zeigeAnlegenThema();
  anlegenBereichLink.hidden = art !== "todo" || anlegenVorgabe.ohneBereich;
  anlegenTitel.focus();
}

// Ins volle Termin-Formular, an derselben Stelle und im selben Kopf.
function anlegenZumTermin(titel, notiz) {
  schliesseAnlegen();
  oeffneTerminFormular(anlegenStartTag(), null);
  if (!formularFelder) return;
  Object.assign(formularFelder, {
    titel: titel.trim(), notiz: notiz || "", ausNeu: true,
    // Fuer den Rueckweg zu "ToDo": Tag und "ohne Neuer Bereich" bleiben.
    neuVorgabe: { ...anlegenVorgabe },
  });
  zeichneTerminPopup();
  // Wie beim Formular selbst: von allein ins Titelfeld nur am Rechner (am
  // Handy schoebe die Tastatur das halbe Fenster weg).
  const feld = kalTerminBox.querySelector(".kal-form-titel");
  if (feld && !("ontouchstart" in window)) feld.focus();
}

// "Ohne Bereich" zuerst, dann die Bereiche der aktiven Liste in ihrer
// Reihenfolge. Der Sonder-Bereich selbst steht nicht noch einmal darin.
function fuelleAnlegenBereiche() {
  const optionen = [new Option(OHNE_NAME, "")];
  for (const c of state.categories) {
    if (!istOhneBereich(c.id)) optionen.push(new Option(c.name, c.id));
  }
  anlegenBereich.replaceChildren(...optionen);
  anlegenBereich.value = "";
}

// Themen gibt es nur in manchen Bereichen - die Zeile erscheint nur dann.
function zeigeAnlegenThema() {
  const themen = anlegenArt === "todo" && anlegenBereich.value ? themenIn(anlegenBereich.value) : [];
  anlegenThemaZeile.hidden = !themen.length;
  anlegenThema.replaceChildren(new Option("Ohne Thema", ""), ...themen.map(th => new Option(th.name, th.id)));
  anlegenThema.value = "";
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

async function legeAusFensterAn() {
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
  const thema = anlegenThemaZeile.hidden ? null : (anlegenThema.value || null);
  const bereichName = state.categories.find(c => c.id === bereich)?.name || OHNE_NAME;
  const themaName = thema ? state.themen.find(th => th.id === thema)?.name : null;
  schliesseAnlegen();
  addTodoTo(bereich, thema, text, anlegenBis.value || null, anlegenNotiz.value);   // rendert und speichert selbst
  // Das neue ToDo kann ausserhalb des Bildes landen (anderer Bereich, im
  // Kalender gar nicht zu sehen) - kurz sagen, dass und wo es liegt.
  const wo = istOhneBereich(bereich) ? "" : ` in ${bereichName}${themaName ? " › " + themaName : ""}`;
  snackInfo(`„${text}“${wo} angelegt`);
}

// ---------- Verdrahtung ----------
for (const k of anlegenReiter.children) {
  k.addEventListener("click", () => waehleAnlegenArt(k.dataset.art));
}
anlegenForm.addEventListener("submit", e => { e.preventDefault(); legeAusFensterAn(); });
document.getElementById("anlegenAbbrechen").addEventListener("click", schliesseAnlegen);
anlegenBereichLink.addEventListener("click", () => waehleAnlegenArt("bereich"));
anlegenPopup.addEventListener("click", e => { if (e.target === anlegenPopup) schliesseAnlegen(); });
anlegenBereich.addEventListener("change", zeigeAnlegenThema);
anlegenBis.addEventListener("input", zeigeAnlegenBis);
anlegenBis.addEventListener("change", zeigeAnlegenBis);
anlegenNotiz.addEventListener("input", () => passeNotizHoeheAn(anlegenNotiz));
anlegenBisWeg.addEventListener("click", () => setzeAnlegenBis(""));
// Escape in der Einfangphase und mit stopImmediatePropagation: app.js und
// kalender.js haengen ihre Escape-Handler an denselben Knoten, der des
// Kalenders klappte im selben Druck sonst die ganze Kalenderansicht zu.
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && schliesseAnlegen()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// Das ＋ der Leiste (unter 1000 px) und das in der Kopfzeile am PC.
for (const k of document.querySelectorAll(".neu-knopf")) k.addEventListener("click", () => oeffneAnlegen());
