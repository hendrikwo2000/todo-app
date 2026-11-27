"use strict";

/* ====================================================================
   Liquid-Glass-Reaktion (seit 27.11.2026).

   Hendrik: "Alle Buttons haben keine schoene Hover- und Aktiv-Wirkung, soll wie
   Apples Liquid Glass aussehen". Das meiste macht style.css allein (Block
   "Liquid Glass reagiert"): heller werden beim Drueberfahren, federndes
   Aufquellen beim Druecken. Dieses Skript liefert nur zwei Dinge, die CSS nicht
   kann:

   1. Den LICHTFLECK. Bei Apples interaktivem Glas wandert ein Glanz unter dem
      Zeiger bzw. Finger mit. Hier setzt das Skript --mx / --my (Zeigerlage im
      Knopf, in px); die Glas-Knoepfe malen daraus einen Radialverlauf, dessen
      Staerke --licht (ein @property, damit er weich ein- und ausblendet) regelt.

   2. Den DRUCK, der lange genug stehen bleibt. :active dauert bei einem kurzen
      Tipp am Handy nur wenige Millisekunden - die Feder haette keine Zeit, sich
      zu zeigen. Darum bekommt das Element bei pointerdown das Attribut
      data-druck, das erst nach mindestens DRUCK_MIN ms (und nach dem Loslassen)
      wieder geht. Das CSS behandelt :active und [data-druck] gleich.

   Ohne das Skript bleibt alles bis auf den Lichtfleck und den langen Druck
   erhalten. Es greift in keine Logik ein: kein Klick wird abgefangen, nichts
   wird verhindert; es setzt nur Attribute/Variablen und liest sonst nichts.

   Dazu der alte iOS-Kniff: ohne einen touchstart-Zuhoerer am Dokument meldet
   iOS-Safari :active an Nicht-Links nicht zuverlaessig.
   ==================================================================== */
(function () {
  // Alles, was sich wie ein Knopf anfuehlt. Das CSS entscheidet, wer davon wie
  // reagiert - hier wird nur markiert.
  const KNOPF_AUSWAHL = [
    "button", "[role=\"button\"]", "summary", "a[href]", "label.check-tap",
    ".kal-tag", ".kal-eintrag", ".titel-schaltbar", ".switch", ".kal-form-reihe",
    ".zf-up", ".fuss-knopf", ".kopf-knopf",
  ].join(", ");
  const DRUCK_MIN = 170; // ms, so lange bleibt der Druck mindestens sichtbar

  const gedrueckt = new Map(); // Element -> Zeitpunkt des Druecks
  let rahmen = 0;
  let ziel = null;
  let zeigerX = 0;
  let zeigerY = 0;

  document.addEventListener("touchstart", function () {}, { passive: true });

  function knopfUnter(knoten) {
    if (!(knoten instanceof Element)) return null;
    const el = knoten.closest(KNOPF_AUSWAHL);
    return el && !el.disabled ? el : null;
  }

  // Zeigerlage relativ zum Knopf als --mx / --my; hoechstens einmal je Bild.
  function setzeLicht() {
    rahmen = 0;
    if (!ziel || !ziel.isConnected) return;
    const r = ziel.getBoundingClientRect();
    ziel.style.setProperty("--mx", (zeigerX - r.left).toFixed(1) + "px");
    ziel.style.setProperty("--my", (zeigerY - r.top).toFixed(1) + "px");
  }

  function merkeZeiger(e, el) {
    ziel = el;
    zeigerX = e.clientX;
    zeigerY = e.clientY;
    if (!rahmen) rahmen = requestAnimationFrame(setzeLicht);
  }

  document.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    const el = knopfUnter(e.target);
    if (el) merkeZeiger(e, el);
  }, { passive: true });

  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = knopfUnter(e.target);
    if (!el) return;
    merkeZeiger(e, el);
    el.setAttribute("data-druck", "");
    gedrueckt.set(el, performance.now());
  }, { passive: true });

  function loslassen() {
    gedrueckt.forEach(function (seit, el) {
      gedrueckt.delete(el);
      const rest = Math.max(0, DRUCK_MIN - (performance.now() - seit));
      setTimeout(function () { el.removeAttribute("data-druck"); }, rest);
    });
  }
  document.addEventListener("pointerup", loslassen, { passive: true });
  // Das Browser-Scrollen am Finger bricht den Zeiger ab - dann ist es kein Druck mehr.
  document.addEventListener("pointercancel", loslassen, { passive: true });
  window.addEventListener("blur", loslassen);
})();
