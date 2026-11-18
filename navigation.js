"use strict";

/* ====================================================================
   Die Leiste ToDos | Kalender | ＋ | Zeit | Einstellungen (seit 15.11.2026).
   Ein einziges Element (#fusszeile in index.html - der Name stammt aus der
   ersten Fassung, die es nur am Handy gab).

   Seit 19.11.2026 steht sie nur noch UNTEN, am Handy und am iPad (alles unter
   1000 px, der Split-Grenze in kalender.js). Am PC gibt es sie nicht mehr:
   Hendrik hat den Kalender dort immer an, Kalender und Heute schalten die
   Einstellungen, und Uhr, ＋ und Zahnrad stehen als eigene Knoepfe in der
   Kopfzeile (.kopf-knoepfe in index.html). Vorher hing navigation.js die
   Leiste am PC/iPad in die Kopfzeile bzw. in die Zeile oben im Kalender um.
   Die Knoepfe sind an ihren Klassen verdrahtet (.fuss-ansicht in
   kalender.js, .timer-knopf in zeiterfassung.js, .ein-knopf in app.js,
   .neu-knopf in anlegen.js) - die Kopfzeilen-Knoepfe am PC tragen dieselben.

   Zweite Aufgabe: Einstellungen und Zeit sind unten wie eigene Ansichten -
   ihre Fenster lassen die Leiste stehen (style.css), das Feld leuchtet, und
   ein Tipp auf ein anderes Feld schliesst sie (Hendrik: "wenn man auf
   Einstellungen geht, verschwindet die Fusszeile, soll nicht so sein").
   ==================================================================== */

const navLeiste = document.getElementById("fusszeile");
navLeiste.classList.add("unten");

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
