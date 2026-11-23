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
   - ToDo: Titel, Bereich, Thema (sobald ein echter Bereich gewaehlt ist), bis;
   - ein neuer Bereich bzw. ein neues Thema entsteht seit 23.11.2026 gleich in
     der Zeile ueber ein kleines ＋ (Hendrik: "am Handy im Bereich und vielleicht
     auch bei Thema ein kleines Plus") - es fragt per textEingabe nach dem Namen
     und waehlt das Neue aus; der Link "Neuer Bereich" unten und der eigene
     Bereich-Modus des Fensters sind damit entfallen. Aus dem Kalender heraus
     (vorgabe.ohneBereich) gibt es das ＋ am Bereich weiterhin nicht - Hendriks
     Wahl vom 19.11.: dort ergibt ein neuer Bereich keinen Sinn.
   - Termin: seit 19.11.2026 gleich mit ALLEN Feldern (Hendrik: "wenn ich auf
     Termin gehe, sollen direkt alle Optionen sein, und ganz oben Titel und
     Notiz, 1 zu 1 wie bei ToDo"). Dafuer uebernimmt das volle
     Termin-Formular (kalender.js) an genau derselben Stelle, mit demselben
     Kopf und Umschalter (f.ausNeu, Klasse .wie-neu) - "ToDo" dort fuehrt
     hierher zurueck. Vorher gab es hier eine Kurzform und "Mehr".
   Termin gibt es nur mit Schreibrecht bei Google (sonst endete es in einem
   403 - dieselbe Bedingung wie am runden Plus der Tages-Karte); ohne bleibt
   nur ToDo und der Umschalter verschwindet.

   Vorbelegung: steht der Kalender offen, gilt sein gewaehlter Tag fuer den
   Termin; in der Kalenderansicht am Handy zusaetzlich als "bis" des ToDos.

   Braucht aus app.js: state, aktiveListe, addTodoTo, addThema, textEingabe,
   ohneBereichId, istOhneBereich, OHNE_NAME, themenIn, uid, render, save,
   snackInfo, todayStr. Aus kalender.js: kalOffen, kalAuswahl, googleZustand, istSplit,
   oeffneTerminFormular, formularFelder, zeichneTerminPopup, kalTerminBox.
   ==================================================================== */

const anlegenPopup       = document.getElementById("anlegenPopup");
const anlegenForm        = document.getElementById("anlegenForm");
const anlegenReiter      = document.getElementById("anlegenReiter");
const anlegenTitel       = document.getElementById("anlegenTitel");
const anlegenNotiz       = document.getElementById("anlegenNotiz");
const anlegenKopfTitel   = document.getElementById("anlegenKopfTitel");
const anlegenBereich     = document.getElementById("anlegenBereich");
const anlegenBereichPlus = document.getElementById("anlegenBereichPlus");
const anlegenThemaZeile  = document.getElementById("anlegenThemaZeile");
const anlegenThema       = document.getElementById("anlegenThema");
const anlegenThemaPlus   = document.getElementById("anlegenThemaPlus");
const anlegenBis         = document.getElementById("anlegenBis");
const anlegenBisWeg      = document.getElementById("anlegenBisWeg");
const anlegenOk          = document.getElementById("anlegenOk");

// Was beim Oeffnen mitkam (seit 19.11.2026): tag = Tag aus der Tageskarte
// (Termin-Beginn bzw. "bis"), ohneBereich = kein ＋ am Bereich (aus dem
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
  anlegenBereichPlus.hidden = anlegenVorgabe.ohneBereich;
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
  // Vom ＋ einer Thema-Zeile auf dem Board: das Thema gleich mit (seit 23.11.2026).
  if (vorgabe.thema) zeigeAnlegenThema(vorgabe.thema);
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
  // Der Umschalter: ToDo | Termin (Termin nur mit Schreibrecht bei Google).
  for (const k of anlegenReiter.children) {
    k.setAttribute("aria-selected", String(k.dataset.art === art));
    if (k.dataset.art === "termin") k.hidden = !anlegenTerminMoeglich();
  }
  anlegenReiter.hidden = [...anlegenReiter.children].filter(k => !k.hidden).length < 2;
  anlegenKopfTitel.textContent = "Neu";
  anlegenTitel.placeholder = "Was ist zu tun?";
  for (const z of anlegenForm.querySelectorAll("[data-fuer]")) z.hidden = z.dataset.fuer !== art;
  zeigeAnlegenThema();
  anlegenTitel.focus();
}

// Ins volle Termin-Formular, an derselben Stelle und im selben Kopf.
function anlegenZumTermin(titel, notiz) {
  schliesseAnlegen();
  oeffneTerminFormular(anlegenStartTag(), null);
  if (!formularFelder) return;
  Object.assign(formularFelder, {
    titel: titel.trim(), notiz: notiz || "", ausNeu: true,
    // Fuer den Rueckweg zu "ToDo": Tag und "ohne ＋ am Bereich" bleiben.
    neuVorgabe: { ...anlegenVorgabe },
  });
  zeichneTerminPopup();
  // Ins Titelfeld springen, damit die Tastatur gleich offen ist - auch am
  // Handy (seit 23.11.2026, Hendriks Wunsch; vorher nur am Rechner, weil die
  // Tastatur das halbe Fenster wegschob). Laeuft noch im selben Tipp, den iOS
  // fuer eine Tastatur braucht.
  const feld = kalTerminBox.querySelector(".kal-form-titel");
  if (feld) feld.focus();
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

// Die Zeile "Thema" gibt es, sobald ein echter Bereich gewaehlt ist - auch ohne
// vorhandene Themen, damit sich das erste gleich hier anlegen laesst (seit
// 23.11.2026; vorher nur mit vorhandenen Themen). "wahl" waehlt eins vor.
function zeigeAnlegenThema(wahl = "") {
  const bereich = anlegenBereich.value;
  const themen = bereich ? themenIn(bereich) : [];
  anlegenThemaZeile.hidden = !bereich;
  anlegenThema.replaceChildren(new Option("Ohne Thema", ""), ...themen.map(th => new Option(th.name, th.id)));
  anlegenThema.value = themen.some(th => th.id === wahl) ? wahl : "";
}

// Das ＋ am Bereich: Namen erfragen, Bereich anlegen und gleich auswaehlen. Das
// Fenster bleibt offen, was schon getippt ist, bleibt stehen.
async function neuerBereichImFenster() {
  // Seit 23.11.2026 das Fenster "Bereich" (app.js) - Name UND Farbe.
  const id = await bereichFenster(null);
  // Inzwischen zu (z. B. die Liste gewechselt): nichts mehr tun.
  if (!id || anlegenPopup.hidden) return;
  fuelleAnlegenBereiche();
  anlegenBereich.value = id;
  zeigeAnlegenThema();
}

// Das ＋ am Thema: ein neues Thema im gewaehlten Bereich (addThema fragt nach
// dem Namen) und gleich auswaehlen.
async function neuesThemaImFenster() {
  const bereich = anlegenBereich.value;
  if (!bereich) return;
  const id = await addThema(bereich);
  if (!id || anlegenPopup.hidden || anlegenBereich.value !== bereich) return;
  zeigeAnlegenThema(id);
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
  for (const k of anlegenSchnell.children) k.setAttribute("aria-pressed", String(!!hat && schnellTag(k.dataset.schnell) === anlegenBis.value));
}

// Schnellwahl "Heute / Morgen / Am Wochenende" (seit 23.11.2026). Wochenende =
// der naechste Samstag; ist schon Samstag oder Sonntag, dann heute.
const anlegenSchnell = document.getElementById("anlegenSchnell");
function schnellTag(art) {
  if (art !== "we") return addDaysStr(Number(art));
  const wt = new Date().getDay();   // 0 So ... 6 Sa
  return addDaysStr(wt === 6 || wt === 0 ? 0 : 6 - wt);
}
anlegenSchnell.addEventListener("click", e => {
  const k = e.target.closest("[data-schnell]");
  if (!k) return;
  const tag = schnellTag(k.dataset.schnell);
  setzeAnlegenBis(anlegenBis.value === tag ? "" : tag);
});

async function legeAusFensterAn() {
  const text = anlegenTitel.value.trim();
  if (!text) { anlegenTitel.focus(); return; }

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
document.getElementById("anlegenKopfZu").addEventListener("click", schliesseAnlegen);
anlegenBereichPlus.addEventListener("click", neuerBereichImFenster);
anlegenThemaPlus.addEventListener("click", neuesThemaImFenster);
anlegenPopup.addEventListener("click", e => { if (e.target === anlegenPopup) schliesseAnlegen(); });
anlegenBereich.addEventListener("change", () => zeigeAnlegenThema());
anlegenBis.addEventListener("input", zeigeAnlegenBis);
anlegenBis.addEventListener("change", zeigeAnlegenBis);
anlegenNotiz.addEventListener("input", () => passeNotizHoeheAn(anlegenNotiz));
anlegenBisWeg.addEventListener("click", () => setzeAnlegenBis(""));
// Escape in der Einfangphase und mit stopImmediatePropagation: app.js und
// kalender.js haengen ihre Escape-Handler an denselben Knoten, der des
// Kalenders klappte im selben Druck sonst die ganze Kalenderansicht zu.
document.addEventListener("keydown", e => {
  // Eine Eingabe darueber (Name fuer einen neuen Bereich/ein neues Thema)
  // schliesst sich selbst zuerst - sonst ginge mit ihr das ganze Fenster zu.
  if (document.querySelector(".eingabe-popup")) return;
  if (e.key === "Escape" && schliesseAnlegen()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// Das ＋ der Leiste (unter 1000 px) und das in der Kopfzeile am PC.
for (const k of document.querySelectorAll(".neu-knopf")) k.addEventListener("click", () => oeffneAnlegen());
