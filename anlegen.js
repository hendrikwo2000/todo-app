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
   - Termin kurz: Titel, Tag, Ganztaegig, von-bis. Ort, Wiederholung, Farbe,
     Notiz ueber "Mehr", das ins volle Termin-Formular fuehrt und das
     Getippte mitnimmt.
   Termin gibt es nur mit Schreibrecht bei Google (sonst endete es in einem
   403 - dieselbe Bedingung wie am runden Plus der Tages-Karte); ohne bleibt
   nur ToDo und der Umschalter verschwindet.

   Vorbelegung: steht der Kalender offen, gilt sein gewaehlter Tag fuer den
   Termin; in der Kalenderansicht am Handy zusaetzlich als "bis" des ToDos.

   Braucht aus app.js: state, aktiveListe, addTodoTo, ohneBereichId,
   istOhneBereich, OHNE_NAME, themenIn, uid, render, save, snackInfo,
   todayStr. Aus kalender.js: kalOffen, kalAuswahl, googleZustand, istSplit,
   isoVonDate, terminAnfrage, googleGeladen, ladeGoogle,
   oeffneTerminFormular, formularFelder, zeichneTerminPopup.
   ==================================================================== */

const anlegenPopup       = document.getElementById("anlegenPopup");
const anlegenForm        = document.getElementById("anlegenForm");
const anlegenReiter      = document.getElementById("anlegenReiter");
const anlegenUeberschrift = document.getElementById("anlegenUeberschrift");
const anlegenTitel       = document.getElementById("anlegenTitel");
const anlegenBereich     = document.getElementById("anlegenBereich");
const anlegenThemaZeile  = document.getElementById("anlegenThemaZeile");
const anlegenThema       = document.getElementById("anlegenThema");
const anlegenBis         = document.getElementById("anlegenBis");
const anlegenBisWeg      = document.getElementById("anlegenBisWeg");
const anlegenTag         = document.getElementById("anlegenTag");
const anlegenGanztags    = document.getElementById("anlegenGanztags");
const anlegenZeitZeile   = document.getElementById("anlegenZeitZeile");
const anlegenVon         = document.getElementById("anlegenVon");
const anlegenBisZeit     = document.getElementById("anlegenBisZeit");
const anlegenOk          = document.getElementById("anlegenOk");
const anlegenBereichLink = document.getElementById("anlegenBereichLink");
const anlegenMehr        = document.getElementById("anlegenMehr");

const ANLEGEN_PLATZHALTER = {
  todo: "Was ist zu tun?",
  termin: "Was steht an?",
  bereich: "Name, z. B. Haushalt oder Arbeit",
};

let anlegenArt = "todo";
let anlegenDauer = 60;       // Minuten - "von" verschieben nimmt "bis" mit
let anlegenSpeichert = false;

function anlegenTerminMoeglich() {
  return !!(googleZustand.verbunden && googleZustand.schreiben);
}

// Der Tag, an dem ein Termin vorbelegt startet: mit offenem Kalender dessen
// Auswahl, sonst heute.
function anlegenStartTag() {
  return (kalOffen && kalAuswahl) || todayStr();
}

// vorgabe.bereich: der Bereich, aus dem heraus geoeffnet wurde ("＋ ToDo" im
// Bereichskopf) - dann ist er vorgewaehlt.
function oeffneAnlegen(vorgabe = {}) {
  const todo = !!aktiveListe;
  const termin = anlegenTerminMoeglich();
  if (!todo && !termin) return;

  anlegenReiter.hidden = !(todo && termin);
  anlegenTitel.value = "";
  fuelleAnlegenBereiche();
  if (vorgabe.bereich && !istOhneBereich(vorgabe.bereich)
      && state.categories.some(c => c.id === vorgabe.bereich)) {
    anlegenBereich.value = vorgabe.bereich;
  }
  // In der Kalenderansicht am Handy hat ein neues ToDo den gewaehlten Tag als
  // "bis" (wie das ＋ an "ToDos" in der Tages-Karte); sonst keins.
  const kalAnsicht = kalOffen && !istSplit();
  setzeAnlegenBis(kalAnsicht ? anlegenStartTag() : "");
  anlegenTag.value = anlegenStartTag();
  // Wie das volle Termin-Formular: ganztaegig, 9-10 Uhr, wenn man umschaltet.
  anlegenGanztags.checked = true;
  anlegenVon.value = "09:00";
  anlegenBisZeit.value = "10:00";
  anlegenDauer = 60;
  waehleAnlegenArt(todo ? "todo" : "termin");
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
  anlegenArt = art;
  for (const k of anlegenReiter.children) k.setAttribute("aria-selected", String(k.dataset.art === art));
  // "Neuer Bereich" hat keinen Umschalter, dafuer eine Ueberschrift.
  const bereich = art === "bereich";
  if (bereich) anlegenReiter.hidden = true;
  anlegenUeberschrift.hidden = !bereich;
  anlegenTitel.placeholder = ANLEGEN_PLATZHALTER[art];
  for (const z of anlegenForm.querySelectorAll("[data-fuer]")) z.hidden = z.dataset.fuer !== art;
  zeigeAnlegenThema();
  anlegenZeitZeile.hidden = art !== "termin" || anlegenGanztags.checked;
  // Unten links Abbrechen, rechts genau EIN Link: bei ToDo "Neuer Bereich",
  // beim Termin "Mehr".
  anlegenBereichLink.hidden = art !== "todo" || !aktiveListe;
  anlegenMehr.hidden = art !== "termin";
  anlegenTitel.focus();
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

// "09:30" -> 570
function anlegenMinuten(hhmm) {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  return h * 60 + m;
}

// Beginn, Ende als Datum + Uhrzeit. Endet der Termin vor seinem Beginn, geht
// er ueber Mitternacht (23:00-01:00) - das Ende liegt dann am Folgetag.
function anlegenZeitraum() {
  const tag = anlegenTag.value || anlegenStartTag();
  if (anlegenGanztags.checked) {
    return { ganztags: true, startDatum: tag, endDatum: tag, vonZeit: "09:00", bisZeit: "10:00" };
  }
  const von = anlegenVon.value || "09:00";
  let dauer = anlegenMinuten(anlegenBisZeit.value || "10:00") - anlegenMinuten(von);
  if (dauer <= 0) dauer += 24 * 60;
  const [j, m, t] = tag.split("-").map(Number);
  const ende = new Date(j, m - 1, t, 0, anlegenMinuten(von) + dauer);
  const zwei = n => String(n).padStart(2, "0");
  return {
    ganztags: false, startDatum: tag, endDatum: isoVonDate(ende),
    vonZeit: von, bisZeit: `${zwei(ende.getHours())}:${zwei(ende.getMinutes())}`,
  };
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

  if (anlegenArt === "termin") {
    // Gegen den Doppeltipp - ein zweiter legte den Termin zweimal an.
    if (anlegenSpeichert) return;
    anlegenSpeichert = true;
    anlegenOk.disabled = true;
    const ok = await terminAnfrage("POST", {
      titel: text, ...anlegenZeitraum(), farbe: "", notiz: "", ort: "",
      zeitzone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
    });
    anlegenSpeichert = false;
    anlegenOk.disabled = false;
    if (!ok) return;   // terminAnfrage hat die Meldung schon gezeigt
    schliesseAnlegen();
    // Frisch holen wie nach dem vollen Formular: im Kalender steht dann, was
    // bei Google steht.
    googleGeladen = null;
    await ladeGoogle();
    snackInfo(`Termin „${text}“ angelegt`);
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
  addTodoTo(bereich, thema, text, anlegenBis.value || null, null);   // rendert und speichert selbst
  // Das neue ToDo kann ausserhalb des Bildes landen (anderer Bereich, im
  // Kalender gar nicht zu sehen) - kurz sagen, dass und wo es liegt.
  const wo = istOhneBereich(bereich) ? "" : ` in ${bereichName}${themaName ? " › " + themaName : ""}`;
  snackInfo(`„${text}“${wo} angelegt`);
}

// "Mehr": ins volle Termin-Formular, mit allem, was schon im Fenster steht.
function anlegenZumFormular() {
  const titel = anlegenTitel.value.trim();
  const zeitraum = anlegenZeitraum();
  schliesseAnlegen();
  oeffneTerminFormular(zeitraum.startDatum, null);
  if (!formularFelder) return;
  Object.assign(formularFelder, zeitraum, { titel });
  zeichneTerminPopup();
}

// ---------- Verdrahtung ----------
for (const k of anlegenReiter.children) {
  k.addEventListener("click", () => waehleAnlegenArt(k.dataset.art));
}
anlegenForm.addEventListener("submit", e => { e.preventDefault(); legeAusFensterAn(); });
document.getElementById("anlegenAbbrechen").addEventListener("click", schliesseAnlegen);
anlegenBereichLink.addEventListener("click", () => waehleAnlegenArt("bereich"));
anlegenMehr.addEventListener("click", anlegenZumFormular);
anlegenPopup.addEventListener("click", e => { if (e.target === anlegenPopup) schliesseAnlegen(); });
anlegenBereich.addEventListener("change", zeigeAnlegenThema);
anlegenBis.addEventListener("input", zeigeAnlegenBis);
anlegenBis.addEventListener("change", zeigeAnlegenBis);
anlegenBisWeg.addEventListener("click", () => setzeAnlegenBis(""));
anlegenGanztags.addEventListener("change", () => {
  anlegenZeitZeile.hidden = anlegenGanztags.checked;
});
// Beginn verschieben nimmt das Ende mit (Dauer bleibt) - wie im vollen
// Formular. Das Ende selbst aendert nur die Dauer.
anlegenVon.addEventListener("change", () => {
  if (!anlegenVon.value) return;
  const ende = (anlegenMinuten(anlegenVon.value) + anlegenDauer) % (24 * 60);
  const zwei = n => String(n).padStart(2, "0");
  anlegenBisZeit.value = `${zwei(Math.floor(ende / 60))}:${zwei(ende % 60)}`;
});
anlegenBisZeit.addEventListener("change", () => {
  let d = anlegenMinuten(anlegenBisZeit.value) - anlegenMinuten(anlegenVon.value);
  if (d <= 0) d += 24 * 60;
  anlegenDauer = d;
});

// Escape in der Einfangphase und mit stopImmediatePropagation: app.js und
// kalender.js haengen ihre Escape-Handler an denselben Knoten, der des
// Kalenders klappte im selben Druck sonst die ganze Kalenderansicht zu.
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && schliesseAnlegen()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

document.getElementById("fussPlus").addEventListener("click", () => oeffneAnlegen());
