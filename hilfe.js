"use strict";

/* ====================================================================
   Hilfe (seit 19.10.2026)

   Ein Fenster mit aufklappbaren Abschnitten - Erste Schritte, ToDos,
   Bereiche & Themen, Listen & Teilen, Farben, Kalender, Gewohnheiten & Zeit.
   Der Text steht fest in index.html (#hilfeFenster), hier nur das Oeffnen
   und Schliessen. Hendriks Wahl: Zeile oben in den Einstellungen, eigenes
   Fenster wie "Verlauf & Statistik", und beim allerersten Start geht es
   einmal von selbst auf.

   Wie in den Einstellungen ist immer nur ein Abschnitt offen (ein Akkordeon),
   und aus den Einstellungen heraus startet das Fenster mit allem zu.
   ==================================================================== */

const hilfeFenster = document.getElementById("hilfeFenster");
const hilfeAbschnitte = [...hilfeFenster.querySelectorAll("details.ein-abschnitt")];
let hilfeZurueck = null;   // was vorher den Fokus hatte

// abschnitt: data-hilfe des Abschnitts, der offen starten soll (oder keiner).
function hilfeOeffnen(abschnitt = null) {
  // Aus den Einstellungen heraus: die schliessen, sonst laegen zwei
  // Vollbilder uebereinander (wie beim Fenster "Gewohnheiten").
  if (!einstellungenPopup.hidden) einstellungenPopup.hidden = true;
  for (const d of hilfeAbschnitte) d.open = d.dataset.hilfe === abschnitt;
  hilfeZurueck = document.activeElement;
  hilfeFenster.hidden = false;
  hilfeFenster.querySelector(".ein-blaettern").scrollTop = 0;
  document.getElementById("hilfeZu").focus();
}

function hilfeSchliessen() {
  if (hilfeFenster.hidden) return false;
  hilfeFenster.hidden = true;
  // Zurueck dorthin, wo man herkam - ausser das war das Zahnrad hinter den
  // inzwischen geschlossenen Einstellungen, dann eben nirgends.
  if (hilfeZurueck && hilfeZurueck.isConnected && hilfeZurueck.offsetParent) hilfeZurueck.focus();
  hilfeZurueck = null;
  return true;
}

// Ein Akkordeon: geht ein Abschnitt auf, klappen die anderen zu.
for (const d of hilfeAbschnitte) {
  d.addEventListener("toggle", () => {
    if (d.open) for (const andere of hilfeAbschnitte) if (andere !== d) andere.open = false;
  });
}

document.getElementById("hilfeOeffnen").addEventListener("click", () => hilfeOeffnen());
document.getElementById("hilfeZu").addEventListener("click", hilfeSchliessen);
hilfeFenster.addEventListener("click", e => { if (e.target === hilfeFenster) hilfeSchliessen(); });

// In der Einfangphase und mit stopImmediatePropagation, wie bei den Fenstern
// der Zeiterfassung: sonst schloessen die Escape-Handler in app.js und
// kalender.js im selben Tastendruck noch den Kalender dahinter.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || hilfeFenster.hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  hilfeSchliessen();
}, true);

// Fuer kalender.js: die Zurueck-Taste am Handy schliesst zuerst die Hilfe.
window.hilfeSchliesseOberste = hilfeSchliessen;

// Aus app.js nach dem ersten Zeichnen: ein neues Konto ohne jede Liste
// bekommt die Hilfe einmal von selbst, mit "Erste Schritte" offen. Bestehende
// Nutzer sehen davon nichts. Gemerkt pro Geraet.
window.hilfeBeimErstenStart = function () {
  try {
    if (localStorage.getItem("hilfeGezeigt")) return;
    localStorage.setItem("hilfeGezeigt", "1");
  } catch (e) { /* ohne Speicher eben jedes Mal - besser als nie */ }
  hilfeOeffnen("start");
};
