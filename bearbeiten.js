"use strict";

/* ====================================================================
   Bearbeiten-Fenster (seit 19.11.2026). Markup #bearbeitenPopup in
   index.html, Aussehen wie das Neu-Fenster (style.css, "Anlegen-Fenster"
   und "Bearbeiten-Fenster").

   Bis dahin klappte die Karte selbst zu einer Bearbeiten-Zeile auf: Titel
   und Notiz gleich gross, darunter Pillen fuer Datum, Vorlauf, Bereich,
   Thema und Unterpunkt. Hendrik: "nicht so uebersichtlich, vielleicht ein
   Popup machen, den Titel etwas groesser und die Punkte unter der Notiz
   optisch besser machen." Jetzt dasselbe Fenster wie beim Anlegen:
     - Titel (gross) und Notiz als eine Gruppe,
     - Zeilen Bereich, Thema (nur wenn der Bereich Themen hat), bis und
       "Unter Heute ab" (nur mit Datum),
     - die Unterpunkte als eigene Gruppe mit Feld zum Hinzufuegen,
     - unten Abbrechen | Fertig.
   Den Bereich kann man jetzt bei JEDEM ToDo aendern (vorher nur bei "Ohne
   Bereich", sonst per Ziehen) - mein Call, das Feld steht ohnehin da.

   Unterpunkte gelten sofort (abhaken, loeschen, hinzufuegen) wie in der
   alten Zeile; Titel, Notiz, Bereich, Thema, Datum und Vorlauf erst mit
   "Fertig". Abbrechen verwirft nur diese.

   Bearbeitet wird immer ein ToDo der AKTIVEN Liste (state): wer aus Kalender
   oder Heute kommt, landet ueber springeZuToDo erst in der richtigen Liste.

   Braucht aus app.js: state, aktiveListe, findTodo, unterpunkteVon,
   addUnterpunkt, deleteUnterpunkt, toggleUnterpunkt, themenIn, nextOrder,
   ohneBereichId, istOhneBereich, OHNE_NAME, VORLAEUFE, editingId, render,
   save, passeNotizHoeheAn, symbolSvg.
   ==================================================================== */

const bearbeitenPopup     = document.getElementById("bearbeitenPopup");
const bearbeitenForm      = document.getElementById("bearbeitenForm");
const bearbeitenTitel     = document.getElementById("bearbeitenTitel");
const bearbeitenNotiz     = document.getElementById("bearbeitenNotiz");
const bearbeitenBereich   = document.getElementById("bearbeitenBereich");
const bearbeitenThemaZeile = document.getElementById("bearbeitenThemaZeile");
const bearbeitenThema     = document.getElementById("bearbeitenThema");
const bearbeitenBis       = document.getElementById("bearbeitenBis");
const bearbeitenBisWeg    = document.getElementById("bearbeitenBisWeg");
const bearbeitenVorlaufZeile = document.getElementById("bearbeitenVorlaufZeile");
const bearbeitenVorlauf   = document.getElementById("bearbeitenVorlauf");
const bearbeitenUpListe   = document.getElementById("bearbeitenUnterpunkte");
const bearbeitenUpNeu     = document.getElementById("bearbeitenUnterpunktNeu");

let bearbeitenId = null;   // id des ToDos im Fenster

function bearbeitenOffen() { return !bearbeitenPopup.hidden; }

// Wird von startEdit (app.js) gerufen - Doppelklick, Stift, Kalender, Heute.
function oeffneBearbeiten(id) {
  const t = findTodo(id);
  if (!t) return;
  bearbeitenId = id;
  bearbeitenTitel.value = t.text;
  bearbeitenNotiz.value = t.note || "";

  // Bereiche: "Ohne Bereich" zuerst, dann die der Liste in ihrer Reihenfolge
  // (wie im Neu-Fenster).
  const optionen = [new Option(OHNE_NAME, "")];
  for (const c of state.categories) {
    if (!istOhneBereich(c.id)) optionen.push(new Option(c.name, c.id));
  }
  bearbeitenBereich.replaceChildren(...optionen);
  bearbeitenBereich.value = istOhneBereich(t.categoryId) ? "" : t.categoryId;
  zeigeBearbeitenThema(t.themaId || "");

  bearbeitenVorlauf.replaceChildren(
    new Option("2 Wochen vorher (Standard)", ""),
    ...VORLAEUFE.map(v => new Option(v.name, String(v.tage))));
  bearbeitenVorlauf.value = typeof t.vorlauf === "number" ? String(t.vorlauf) : "";
  setzeBearbeitenBis(t.due || "");

  bearbeitenUpNeu.value = "";
  zeichneBearbeitenUnterpunkte();
  bearbeitenPopup.hidden = false;
  // Erst sichtbar hat das Notizfeld eine Hoehe, an der es wachsen kann.
  passeNotizHoeheAn(bearbeitenNotiz);
  // Bewusst KEIN Fokus (wie frueher beim Doppelklick): am Handy ginge sonst
  // die Tastatur auf und verdeckte die Notiz, die man lesen wollte.
}

function schliesseBearbeiten() {
  if (!bearbeitenOffen()) return false;
  bearbeitenPopup.hidden = true;
  bearbeitenId = null;
  editingId = null;
  if (document.activeElement && bearbeitenPopup.contains(document.activeElement)) document.activeElement.blur();
  return true;
}

// Themen gibt es nur in manchen Bereichen - die Zeile erscheint nur dann.
function zeigeBearbeitenThema(wert) {
  const bereich = bearbeitenBereich.value;
  const themen = bereich ? themenIn(bereich) : [];
  bearbeitenThemaZeile.hidden = !themen.length;
  bearbeitenThema.replaceChildren(new Option("Ohne Thema", ""), ...themen.map(th => new Option(th.name, th.id)));
  bearbeitenThema.value = themen.some(th => th.id === wert) ? wert : "";
}

function setzeBearbeitenBis(wert) {
  bearbeitenBis.value = wert || "";
  zeigeBearbeitenBis();
}

// Leer steht "kein Datum" ueber dem Feld, gesetzt das ✕ daneben; "Unter Heute
// ab" gibt es nur mit Datum.
function zeigeBearbeitenBis() {
  const hat = !!bearbeitenBis.value;
  bearbeitenBis.parentElement.classList.toggle("hat-wert", hat);
  bearbeitenBisWeg.hidden = !hat;
  bearbeitenVorlaufZeile.hidden = !hat;
}

// Die Unterpunkte als Zeilen: Kaestchen, Text, Papierkorb. Nach jeder Aenderung
// neu - die Aenderung selbst speichert app.js sofort.
function zeichneBearbeitenUnterpunkte() {
  const zeilen = unterpunkteVon(bearbeitenId).map(u => {
    const zeile = document.createElement("div");
    zeile.className = "bearbeiten-up" + (u.done ? " is-done" : "");

    const tap = document.createElement("label");
    tap.className = "check-tap";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "check";
    cb.checked = u.done;
    cb.setAttribute("aria-label", u.text);
    cb.addEventListener("change", () => {
      toggleUnterpunkt(u.id);
      zeichneBearbeitenUnterpunkte();
    });
    tap.appendChild(cb);

    const text = document.createElement("span");
    text.className = "bearbeiten-up-text";
    text.textContent = u.text;

    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "bearbeiten-up-weg";
    weg.title = "Unterpunkt löschen";
    weg.setAttribute("aria-label", `„${u.text}“ löschen`);
    weg.innerHTML = symbolSvg("papierkorb");
    weg.addEventListener("click", () => {
      deleteUnterpunkt(u.id);
      zeichneBearbeitenUnterpunkte();
    });

    zeile.append(tap, text, weg);
    return zeile;
  });
  bearbeitenUpListe.replaceChildren(...zeilen);
  bearbeitenUpListe.hidden = !zeilen.length;
}

function bearbeitenUnterpunktDazu() {
  const text = bearbeitenUpNeu.value.trim();
  if (!text || !bearbeitenId) return;
  addUnterpunkt(bearbeitenId, text);
  bearbeitenUpNeu.value = "";
  zeichneBearbeitenUnterpunkte();
  bearbeitenUpNeu.focus();
}

function speichereBearbeiten() {
  const t = findTodo(bearbeitenId);
  // Inzwischen weg (geloescht, Liste gewechselt): nichts zu speichern.
  if (!t) { schliesseBearbeiten(); render(); return; }
  const text = bearbeitenTitel.value.trim();
  if (!text) { bearbeitenTitel.focus(); return; }
  // Ein halb getippter Unterpunkt geht nicht verloren.
  if (bearbeitenUpNeu.value.trim()) addUnterpunkt(t.id, bearbeitenUpNeu.value);

  t.text = text;
  t.note = bearbeitenNotiz.value.trim() || null;
  t.due = bearbeitenBis.value || null;
  // Vorlauf nur mit Termin (siehe imVorlauf); leer = Standard.
  t.vorlauf = (t.due && bearbeitenVorlauf.value !== "") ? Number(bearbeitenVorlauf.value) : null;

  // Bereich und Thema. "Ohne Bereich" ist ein echter Eintrag in der Liste
  // (ohneBereichId) - fehlt er, entsteht er wie beim Anlegen.
  let bereich = bearbeitenBereich.value;
  if (!bereich || !state.categories.some(c => c.id === bereich)) {
    bereich = ohneBereichId(aktiveListe);
    if (!state.categories.some(c => c.id === bereich)) {
      state.categories.unshift({ id: bereich, name: OHNE_NAME });
    }
  }
  const thema = bearbeitenThemaZeile.hidden ? null : (bearbeitenThema.value || null);
  if (bereich !== t.categoryId || (t.themaId || null) !== thema) {
    t.categoryId = bereich;
    t.themaId = thema;
    // Termin-lose hinten in die neue Gruppe einreihen.
    if (!t.due && !t.done) t.order = nextOrder(bereich, thema);
  } else if (!t.due && !t.done && typeof t.order !== "number") {
    // Datum entfernt: ab jetzt sortiert es sich mit den termin-losen.
    t.order = nextOrder(t.categoryId, t.themaId);
  }

  schliesseBearbeiten();
  render();
  save();
}

// ---------- Verdrahtung ----------
bearbeitenForm.addEventListener("submit", e => { e.preventDefault(); speichereBearbeiten(); });
document.getElementById("bearbeitenAbbrechen").addEventListener("click", () => { schliesseBearbeiten(); render(); });
bearbeitenPopup.addEventListener("click", e => { if (e.target === bearbeitenPopup) { schliesseBearbeiten(); render(); } });
bearbeitenBereich.addEventListener("change", () => zeigeBearbeitenThema(""));
bearbeitenBis.addEventListener("input", zeigeBearbeitenBis);
bearbeitenBis.addEventListener("change", zeigeBearbeitenBis);
bearbeitenBisWeg.addEventListener("click", () => setzeBearbeitenBis(""));
bearbeitenNotiz.addEventListener("input", () => passeNotizHoeheAn(bearbeitenNotiz));
// Enter im Titel speichert (wie vorher in der Zeile), im Unterpunkt-Feld legt
// es den Punkt an - nicht das ganze Formular abschicken.
bearbeitenUpNeu.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  bearbeitenUnterpunktDazu();
});

// Escape in der Einfangphase: sonst klappte der Kalender-Handler im selben
// Druck noch etwas dahinter zu (wie beim Neu-Fenster).
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && schliesseBearbeiten()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    render();
  }
}, true);

// Fuer kalender.js: die Zurueck-Taste am Handy schliesst zuerst dieses Fenster.
window.bearbeitenSchliesseOberste = () => {
  if (!schliesseBearbeiten()) return false;
  render();
  return true;
};
window.oeffneBearbeiten = oeffneBearbeiten;
