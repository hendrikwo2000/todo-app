"use strict";

/* ====================================================================
   Gleitende Schalter-Linse (seit 24.11.2026).

   Hendrik: die Umschalter (ToDo | Termin, die Reiter, die Leiste unten) sind
   "noch kantig" - die helle Flaeche soll wie bei Apple unter den Knoepfen
   GLEITEN, beim Tippen und beim Ziehen mit dem Finger, ueberall, wo es so
   einen Schalter gibt.

   So geht es: ein Schalter ist ein Behaelter mit Knoepfen, von denen einer
   aria-selected="true" (Reiter) oder aria-pressed="true" (Leiste) traegt. Bis
   hierher war die Flaeche der Hintergrund des gewaehlten Knopfs - er sprang.
   Jetzt bekommt der Behaelter die Klasse .hat-linse, und die Flaeche ist sein
   ::before (style.css, "Gleitende Schalter-Linse"), dessen Lage und Breite
   dieses Skript als --lx / --lb / --lt / --lh setzt. Ein Pseudo-Element statt
   eines echten Kindes, weil anlegen.js und andere ueber .children laufen und
   ein zusaetzliches Kind mitzaehlen wuerde.

   Behaelter: .anlegen-reiter (Neu: ToDo | Termin), .ein-reiter
   (Einstellungen, Gewohnheiten), .gw-pillen (Zeitraeume der Statistiken) und
   #fusszeile (die Leiste unten).

   Drei Dinge, die nicht auf der Hand liegen:
   - ToDo | Termin sind ZWEI Fenster (anlegen.js, kalender.js): beim Umschalten
     geht das eine zu und das andere auf, jedes mit eigenem Schalter. Damit die
     Linse trotzdem hinueber GLEITET, merkt sich jeder Schalter, wo seine Linse
     stand (z.index); der neue Schalter mit demselben Schluessel startet dort
     und rutscht an seinen Platz (schalterGeber).
   - Aendert sich nur die Groesse (Leiste wird schmaler, Schrift laedt), springt
     die Linse sofort mit - gleiten soll sie nur, wenn der Nutzer wechselt.
   - Beim Ziehen kommt der Klick auf den Zielknopf von hier (.click()); der
     echte Klick, den der Browser nach dem Loslassen nachschiebt, wird
     geschluckt (schalterKlickSperre), sonst wuerde der Wechsel doppelt laufen.
   ==================================================================== */

const SCHALTER_WAHL = ".anlegen-reiter, .ein-reiter, .gw-pillen";
const SCHALTER_LEISTE_KNOEPFE = ".fuss-ansicht, .timer-knopf, .ein-knopf";
const SCHALTER_ZIEH_SCHWELLE = 5;   // px, ab denen aus einem Tipp ein Zug wird

const alleSchalter = new Set();
let schalterKlickSperre = 0;

// Die Feder: eine gedaempfte Schwingung mit ~4 % Ueberschwingen, als CSS
// linear()-Kurve. Wo linear() fehlt, bleibt der cubic-bezier aus style.css.
function setzeFeder() {
  if (!window.CSS || !CSS.supports("transition-timing-function", "linear(0, 1)")) return;
  const zeta = 0.72, omega = 2 * Math.PI * 2.1, dauer = 0.5, schritte = 40;
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const punkte = [];
  for (let i = 0; i <= schritte; i++) {
    const t = (i / schritte) * dauer;
    const y = 1 - Math.exp(-zeta * omega * t) * (Math.cos(omegaD * t) + (zeta * omega / omegaD) * Math.sin(omegaD * t));
    punkte.push(i === schritte ? "1" : y.toFixed(4));
  }
  document.documentElement.style.setProperty("--feder", "linear(" + punkte.join(", ") + ")");
}

// Die Knoepfe, zwischen denen die Linse wandert - nur die sichtbaren, von links
// nach rechts.
function schalterKnoepfe(z) {
  const liste = z.leiste
    ? [...z.beh.querySelectorAll(SCHALTER_LEISTE_KNOEPFE)]
    : [...z.beh.querySelectorAll(":scope > button")];
  return liste.filter(k => k.offsetWidth > 0).sort((a, b) => a.offsetLeft - b.offsetLeft);
}

function schalterSichtbar(id) {
  const e = document.getElementById(id);
  return !!e && !e.hidden;
}

// Welcher Knopf gilt? Bei den Reitern der mit aria-selected/-pressed, in der
// Leiste dasselbe wie in style.css: ein offenes Fenster (Einstellungen, Zeit)
// geht vor der Ansicht ToDos | Kalender.
function schalterAktiv(z, knoepfe) {
  if (z.leiste) {
    const ein = knoepfe.find(k => k.classList.contains("ein-knopf"));
    const zeit = knoepfe.find(k => k.classList.contains("timer-knopf"));
    if (ein && (schalterSichtbar("einstellungenPopup") || schalterSichtbar("gewFenster") || schalterSichtbar("hilfeFenster"))) return ein;
    if (zeit && (schalterSichtbar("timerPopup") || schalterSichtbar("zeitFenster"))) return zeit;
    return knoepfe.find(k => k.getAttribute("aria-pressed") === "true") || null;
  }
  return knoepfe.find(k => k.getAttribute("aria-selected") === "true" || k.getAttribute("aria-pressed") === "true") || null;
}

// Linse unter einen Knopf legen. sofort = ohne Gleiten.
function schalterSetze(z, k, sofort) {
  const beh = z.beh;
  if (sofort) beh.classList.add("linse-sofort");
  beh.style.setProperty("--lx", k.offsetLeft + "px");
  beh.style.setProperty("--lb", k.offsetWidth + "px");
  if (!z.leiste) {
    beh.style.setProperty("--lt", k.offsetTop + "px");
    beh.style.setProperty("--lh", k.offsetHeight + "px");
  }
  // Die Leiste legt Oberkante und Hoehe selbst fest (style.css), damit die
  // Linse ihrer wechselnden Hoehe folgt.
  if (sofort) {
    void beh.offsetWidth;   // erst den Sprung auswerten lassen, dann Gleiten wieder erlauben
    beh.classList.remove("linse-sofort");
  }
}

// Wenn ein anderer Schalter mit demselben Schluessel gerade verschwunden ist
// (anderes Fenster, neu gezeichnet), steht seine Linse noch dort: deren Nummer.
function schalterGeber(z) {
  const jetzt = Date.now();
  for (const y of alleSchalter) {
    if (y === z || y.schluessel !== z.schluessel || y.index == null) continue;
    const weg = !y.beh.isConnected || y.beh.offsetWidth === 0;
    if ((y.sichtbar && weg) || (!y.sichtbar && y.verborgenUm && jetzt - y.verborgenUm < 400)) {
      y.sichtbar = false;
      y.verborgenUm = 0;
      return y.index;
    }
  }
  return null;
}

// Prueft einen Schalter und legt die Linse an die richtige Stelle. "sofort"
// kommt vom ResizeObserver (nur die Groesse hat sich geaendert).
function schalterPruefe(z, sofort) {
  const beh = z.beh;
  const da = beh.isConnected && beh.offsetWidth > 0;
  if (!da) {
    if (z.sichtbar) { z.sichtbar = false; z.verborgenUm = Date.now(); }
    return;
  }
  if (z.zieht) return;   // der Finger fuehrt gerade
  const knoepfe = schalterKnoepfe(z);
  const k = schalterAktiv(z, knoepfe);
  if (!k) return;
  // Die Groesse, bei der die Linse gelegt wurde: der ResizeObserver meldet beim
  // ersten Beobachten IMMER eine "Aenderung" (0 -> Groesse) und wuerde sonst die
  // Linse mitten im Gleiten ans Ziel springen lassen (so ging das Gleiten
  // zwischen ToDo und Termin verloren, 24.11.2026).
  z.breite = beh.offsetWidth;
  z.hoehe = beh.offsetHeight;
  if (!z.sichtbar) {
    z.sichtbar = true;
    const von = schalterGeber(z);
    const start = (von != null && knoepfe[von]) || k;
    schalterSetze(z, start, true);
    if (start !== k) schalterSetze(z, k, false);
  } else {
    schalterSetze(z, k, !!sofort);
  }
  z.index = knoepfe.indexOf(k);
}

// Ziehen mit Finger oder Maus: die Linse folgt, beim Loslassen waehlt der
// naechste Knopf.
function schalterZiehen(z) {
  const beh = z.beh;
  let ds = null;

  beh.addEventListener("pointerdown", e => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (beh.scrollWidth > beh.clientWidth + 1) return;   // scrollt selbst (schmale Zeitraum-Pillen)
    const knoepfe = schalterKnoepfe(z);
    if (knoepfe.length < 2) return;
    // In der Leiste zieht nur, wer auf einem der Schalt-Knoepfe anfaengt (nicht auf "Neu").
    if (z.leiste && !knoepfe.some(k => k.contains(e.target))) return;
    const aktiv = schalterAktiv(z, knoepfe);
    if (!aktiv) return;
    ds = {
      id: e.pointerId, x0: e.clientX, lx0: aktiv.offsetLeft, breite: aktiv.offsetWidth,
      knoepfe, aktiv, bewegt: false,
    };
  });

  beh.addEventListener("pointermove", e => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = e.clientX - ds.x0;
    if (!ds.bewegt) {
      if (Math.abs(dx) < SCHALTER_ZIEH_SCHWELLE) return;
      ds.bewegt = true;
      z.zieht = true;
      try { beh.setPointerCapture(ds.id); } catch (_) { /* nachgebaute Zeiger kennen keine Erfassung */ }
      beh.classList.add("linse-zieht");
      beh.style.setProperty("--ls", "1.07");
    }
    const erster = ds.knoepfe[0];
    const letzter = ds.knoepfe[ds.knoepfe.length - 1];
    const min = erster.offsetLeft;
    const max = letzter.offsetLeft + letzter.offsetWidth - ds.breite;
    const x = Math.max(min, Math.min(max, ds.lx0 + dx));
    ds.x = x;
    beh.style.setProperty("--lx", x + "px");
    // Breite des Knopfs, ueber dem die Mitte gerade liegt (bei gleich breiten Knoepfen unveraendert).
    const mitte = x + ds.breite / 2;
    const naechster = ds.knoepfe.reduce((a, b) =>
      Math.abs(b.offsetLeft + b.offsetWidth / 2 - mitte) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - mitte) ? b : a);
    beh.style.setProperty("--lb", naechster.offsetWidth + "px");
  });

  const ende = (e, abbruch) => {
    if (!ds || e.pointerId !== ds.id) return;
    const war = ds;
    ds = null;
    if (!war.bewegt) return;   // war ein Tipp: der normale Klick macht den Rest
    z.zieht = false;
    beh.classList.remove("linse-zieht");
    beh.style.removeProperty("--ls");
    try { beh.releasePointerCapture(war.id); } catch (_) { /* s. o. */ }
    schalterKlickSperre = Date.now() + 400;
    const mitte = (war.x ?? war.lx0) + war.breite / 2;
    let ziel = war.knoepfe.reduce((a, b) =>
      Math.abs(b.offsetLeft + b.offsetWidth / 2 - mitte) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - mitte) ? b : a);
    if (abbruch) ziel = war.aktiv;
    // Die Linse steht jetzt am Ziel - das merkt sich der Nachfolger-Schalter
    // (anderes Fenster), damit er nicht von der alten Stelle aus startet.
    z.index = war.knoepfe.indexOf(ziel);
    if (ziel !== war.aktiv) ziel.click();
    // Hat der Klick nichts geaendert (gesperrt, abgelehnt), gleitet die Linse zurueck.
    setTimeout(() => schalterPruefe(z, false), 0);
  };
  beh.addEventListener("pointerup", e => ende(e, false));
  beh.addEventListener("pointercancel", e => ende(e, true));

  // Der Klick, den der Browser nach einem Zug nachschiebt, ist keiner.
  beh.addEventListener("click", e => {
    if (e.isTrusted && Date.now() < schalterKlickSperre) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

function schalterBinde(beh, leiste) {
  if (beh._schalter) return;
  const z = {
    beh, leiste: !!leiste,
    schluessel: beh.dataset.schalter || beh.id || beh.getAttribute("aria-label") || "",
    sichtbar: false, verborgenUm: 0, index: null, zieht: false, weg: 0, breite: 0, hoehe: 0,
  };
  beh._schalter = z;
  // Verwaiste Schalter (ihr Fenster wurde neu gezeichnet) nach einer Sekunde vergessen.
  for (const y of alleSchalter) {
    if (y.beh.isConnected) continue;
    if (!y.weg) y.weg = Date.now();
    else if (Date.now() - y.weg > 1000) alleSchalter.delete(y);
  }
  alleSchalter.add(z);
  beh.classList.add("hat-linse");
  schalterZiehen(z);
  groessenBeobachter.observe(beh);
  schalterPruefe(z, false);
}

const groessenBeobachter = new ResizeObserver(eintraege => {
  for (const e of eintraege) {
    const z = e.target._schalter;
    if (!z) continue;
    // Nur wenn sich die Groesse seit dem Legen wirklich geaendert hat.
    if (z.sichtbar && e.target.offsetWidth === z.breite && e.target.offsetHeight === z.hoehe) continue;
    schalterPruefe(z, true);
  }
});

function schalterPruefeAlle() {
  for (const z of [...alleSchalter]) schalterPruefe(z, false);
}

// Neue Schalter erkennen (das Termin-Fenster zeichnet seinen bei jedem Neuaufbau
// neu) und auf Wechsel reagieren: aria-selected/-pressed bei den Knoepfen,
// hidden bei den Fenstern (die Leiste folgt den offenen Fenstern).
const schalterBeobachter = new MutationObserver(aenderungen => {
  for (const a of aenderungen) {
    for (const n of a.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches(SCHALTER_WAHL)) schalterBinde(n);
      for (const b of n.querySelectorAll(SCHALTER_WAHL)) schalterBinde(b);
    }
  }
  schalterPruefeAlle();
});

function schalterStart() {
  setzeFeder();
  for (const b of document.querySelectorAll(SCHALTER_WAHL)) schalterBinde(b);
  const leiste = document.getElementById("fusszeile");
  if (leiste) schalterBinde(leiste, true);
  schalterBeobachter.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["aria-selected", "aria-pressed", "hidden"],
  });
  // Schrift geladen -> Knopfbreiten stimmen erst jetzt.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const z of alleSchalter) schalterPruefe(z, true); });
}
schalterStart();
