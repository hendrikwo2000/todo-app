"use strict";

/* ====================================================================
   Fusszeile am Handy (seit 15.11.2026): ToDos | Kalender | ＋ | Zeit |
   Einstellungen. Markup in index.html, Aussehen in style.css ("Fusszeile am
   Handy"). Hier steht nur, was die Leiste NEU kann: das ＋ und sein Menue.
   Alle anderen Knoepfe haengen an der vorhandenen Verdrahtung (Ansicht in
   kalender.js, Uhr in zeiterfassung.js, Zahnrad in app.js).

   Was das ＋ anbietet, haengt an der Ansicht (Hendriks Wahl: kleines Menue):
     ToDo-Ansicht: ToDo (wie "＋ ToDo" oben, landet ohne Bereich), Bereich.
     Kalender:     Termin am gewaehlten Tag (nur mit Schreibrecht bei Google,
                   sonst endete es in einem 403 - dieselbe Bedingung wie am
                   runden Plus der Tages-Karte), ToDo mit dem gewaehlten Tag als
                   "bis" (oeffnet die Tages-Karte mit der Anlege-Zeile, derselbe
                   Weg wie das ＋ an "ToDos" dort).
   Bleibt nur EIN Eintrag uebrig, fuehrt das ＋ ihn gleich aus - ein Menue mit
   einer einzigen Zeile waere nur ein Tipp mehr.

   Braucht aus app.js: aktiveListe, addTodoOhneBereich, addCategory,
   todayStr. Aus kalender.js: kalOffen, kalAuswahl, googleZustand,
   todoEingabeOffen, schliesseEingaben, aktualisiereAuswahl,
   oeffneTagKarte, oeffneTerminFormular, kalTagKarte.
   ==================================================================== */

const fussPlus     = document.getElementById("fussPlus");
const fussMenue    = document.getElementById("fussMenue");
const fussSchleier = document.getElementById("fussSchleier");

// Dieselbe Strichzeichnung wie die Leiste selbst (24er-Raster, Kontur in
// currentColor) - Emojis neben Linien-Symbolen saehen zusammengewuerfelt aus.
const FUSS_SYMBOL = {
  todo: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.3 12.2l2.5 2.5 4.9-5.1"/>',
  bereich: '<rect x="3.5" y="4.5" width="7" height="15" rx="2"/><rect x="13.5" y="4.5" width="7" height="10" rx="2"/>',
  termin: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
};

function fussEintraege() {
  if (kalOffen) {
    const liste = [];
    if (googleZustand.verbunden && googleZustand.schreiben) {
      liste.push({ art: "termin", text: "Termin", tun: fussNeuerTermin });
    }
    if (aktiveListe) liste.push({ art: "todo", text: "ToDo", tun: fussToDoAmTag });
    return liste;
  }
  if (!aktiveListe) return [];
  return [
    { art: "todo", text: "ToDo", tun: addTodoOhneBereich },
    { art: "bereich", text: "Bereich", tun: addCategory },
  ];
}

function fussGewaehlterTag() {
  if (!kalAuswahl) kalAuswahl = todayStr();
  return kalAuswahl;
}

function fussNeuerTermin() {
  oeffneTerminFormular(fussGewaehlterTag(), null);
}

// Wie ein Tipp auf den Tag (waehleTag am Handy) - nur dass die Anlege-Zeile
// gleich offen ist und das Feld den Fokus hat, damit die Tastatur aufgeht.
function fussToDoAmTag() {
  fussGewaehlterTag();
  schliesseEingaben();
  aktualisiereAuswahl();
  todoEingabeOffen = true;
  oeffneTagKarte();
  kalTagKarte.querySelector(".kal-anlegen-feld")?.focus();
}

function fussMenueAuf() {
  const eintraege = fussEintraege();
  if (!eintraege.length) return;
  if (eintraege.length === 1) { eintraege[0].tun(); return; }
  fussMenue.replaceChildren(...eintraege.map(e => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "fuss-menue-eintrag";
    knopf.setAttribute("role", "menuitem");
    knopf.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${FUSS_SYMBOL[e.art]}</svg>`;
    knopf.append(e.text);
    knopf.addEventListener("click", () => { fussMenueZu(); e.tun(); });
    return knopf;
  }));
  fussMenue.hidden = false;
  fussSchleier.hidden = false;
  fussPlus.setAttribute("aria-expanded", "true");
}

function fussMenueZu() {
  if (fussMenue.hidden) return false;
  fussMenue.hidden = true;
  fussSchleier.hidden = true;
  fussPlus.setAttribute("aria-expanded", "false");
  return true;
}

fussPlus.addEventListener("click", () => { if (!fussMenueZu()) fussMenueAuf(); });
// Der Schleier liegt auch ueber der Leiste: ein zweiter Tipp aufs ＋ trifft
// ihn und schliesst das Menue, wie man es erwartet.
fussSchleier.addEventListener("click", fussMenueZu);

// In der Einfangphase und mit stopImmediatePropagation: app.js und kalender.js
// haengen ihre Escape-Handler an denselben Knoten, und der des Kalenders
// klappte im selben Druck sonst die ganze Kalenderansicht zu.
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && fussMenueZu()) e.stopImmediatePropagation();
}, true);
