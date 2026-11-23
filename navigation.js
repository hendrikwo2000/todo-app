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

// Kopfzeile am PC: sobald die Seite gescrollt ist, wird sie zur schmalen,
// durchscheinenden Leiste (style.css, html.kopf-klein; seit 19.11.2026).
// Dazu (seit 23.11.2026, Liquid Glass): die schwebende Leiste unten wird beim
// Runterscrollen schmaler (nur Symbole, html.leiste-klein) und beim
// Hochscrollen wieder voll - wie die Tab-Leiste in iOS 26.
let navLetztesY = window.scrollY;
function navKopfKlein() {
  const y = window.scrollY;
  document.documentElement.classList.toggle("kopf-klein", y > 4);
  if (Math.abs(y - navLetztesY) < 8) return;
  document.documentElement.classList.toggle("leiste-klein", y > navLetztesY && y > 60);
  navLetztesY = y;
}
window.addEventListener("scroll", navKopfKlein, { passive: true });
navKopfKlein();

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
