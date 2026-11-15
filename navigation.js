"use strict";

/* ====================================================================
   Die Leiste ToDos | Kalender | ＋ | Zeit | Einstellungen (seit 15.11.2026).
   Ein einziges Element (#fusszeile in index.html - der Name stammt aus der
   ersten Fassung, die es nur am Handy gab), das je nach Lage umzieht:
     Handy (bis 560 px):           unten am Bildschirmrand  (Klasse .unten)
     breiter, Liste sichtbar:      oben rechts in der Kopfzeile  (.oben)
     breiter, Kalender als eigene
     Ansicht (iPad hoch):          in die Zeile oben im Kalender (.oben),
                                   weil der Kalender dort die Kopfzeile verdeckt
   Hendriks Wahl am PC: "gleiche Leiste oben" statt "+ ToDo  + Bereich  ⏱ ⚙️
   📋|📅". Umziehen statt zweimal im Dokument: die Knoepfe sind an ihren
   Klassen verdrahtet (.fuss-ansicht in kalender.js, .timer-knopf in
   zeiterfassung.js, .ein-knopf in app.js, #fussPlus in anlegen.js) und
   behalten so ihre Zustaende - die laufende Uhr, das gedrueckte Segment.

   Zweite Aufgabe: Einstellungen und Zeit sind am Handy wie eigene Ansichten -
   ihre Fenster lassen die Leiste stehen (style.css), das Feld leuchtet, und
   ein Tipp auf ein anderes Feld schliesst sie (Hendrik: "wenn man auf
   Einstellungen geht, verschwindet die Fusszeile, soll nicht so sein").
   ==================================================================== */

const navLeiste   = document.getElementById("fusszeile");
const navKopf     = document.querySelector(".topbar");
const navKalZeile = document.querySelector(".kal-ansicht-zeile");
const navHandy    = window.matchMedia("(max-width: 560px)");

function platziereLeiste() {
  let ziel, vor;
  if (navHandy.matches) {
    ziel = document.body;
    vor = document.getElementById("anlegenPopup");
  } else if (document.documentElement.classList.contains("kal-ansicht")) {
    ziel = navKalZeile;
    vor = document.getElementById("kalZu");
  } else {
    ziel = navKopf;
    vor = document.getElementById("listenMenue");
  }
  const unten = ziel === document.body;
  navLeiste.classList.toggle("unten", unten);
  navLeiste.classList.toggle("oben", !unten);
  if (navLeiste.parentElement !== ziel) ziel.insertBefore(navLeiste, vor);
}

navHandy.addEventListener("change", platziereLeiste);
// Kalender auf/zu setzt Klassen am <html> (setzePanel in kalender.js) - daran
// haengt, ob die Kopfzeile ueberhaupt zu sehen ist.
new MutationObserver(platziereLeiste)
  .observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
platziereLeiste();

// ---------- Fenster der Leiste ----------
// Einstellungen samt den Fenstern, die man aus ihnen oeffnet (Hilfe, Verlauf
// & Statistik der Gewohnheiten), und Zeit samt Statistik.
function navSchliesseEinstellungen(auchHauptfenster) {
  if (auchHauptfenster) einstellungenPopup.hidden = true;
  gewFensterSchliessen();
  hilfeSchliessen();
}

function navSchliesseZeit(auchHauptfenster) {
  if (auchHauptfenster && !document.getElementById("timerPopup").hidden) ztSchliesse();
  ztSchliesseStatistik();
}

// In der Einfangphase, also VOR dem eigentlichen Knopf: wer auf "Zeit" tippt,
// waehrend die Einstellungen offen sind, bekommt erst die Einstellungen zu und
// dann das Zeit-Fenster - sonst laegen beide uebereinander. Ein Tipp auf das
// eigene Feld schliesst nur die Unterfenster (Hilfe, Statistik), das
// Hauptfenster oeffnet der Knopf danach ohnehin neu.
navLeiste.addEventListener("click", e => {
  const knopf = e.target.closest(".fuss-knopf");
  if (!knopf) return;
  const einstellungen = knopf.classList.contains("ein-knopf");
  const zeit = knopf.classList.contains("timer-knopf");
  navSchliesseEinstellungen(!einstellungen);
  navSchliesseZeit(!zeit);
}, true);
