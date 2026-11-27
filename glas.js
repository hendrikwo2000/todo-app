"use strict";

/* ====================================================================
   Druck-Rueckmeldung (seit 27.11.2026, ruhige Fassung in Runde 3).

   Hendrik: "Alle Buttons haben keine schoene Hover- und Aktiv-Wirkung, soll wie
   Apples Liquid Glass aussehen". Das meiste macht style.css allein (Block
   "Liquid Glass reagiert"). Dieses Skript liefert nur eine Sache, die CSS nicht
   kann:

   Den DRUCK, der lange genug stehen bleibt. :active dauert bei einem kurzen
   Tipp am Handy nur wenige Millisekunden - die Rueckmeldung (Farbwechsel,
   kleines Schwellen) haette keine Zeit, sich zu zeigen. Darum bekommt das
   Element bei pointerdown das Attribut data-druck, das erst nach mindestens
   DRUCK_MIN ms (und nach dem Loslassen) wieder geht. Das CSS behandelt :active
   und [data-druck] gleich.

   (Die erste Fassung hatte hier auch einen Lichtfleck, der dem Zeiger folgte.
   Das war zu viel Effekt - "sieht aus wie KI-Slop" - und ist wieder raus.)

   Ohne das Skript bleibt alles bis auf den langen Druck erhalten. Es greift in
   keine Logik ein: kein Klick wird abgefangen, nichts wird verhindert; es setzt
   nur ein Attribut.

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
  const DRUCK_MIN = 150; // ms, so lange bleibt der Druck mindestens sichtbar

  const gedrueckt = new Map(); // Element -> Zeitpunkt des Druecks

  document.addEventListener("touchstart", function () {}, { passive: true });

  function knopfUnter(knoten) {
    if (!(knoten instanceof Element)) return null;
    const el = knoten.closest(KNOPF_AUSWAHL);
    return el && !el.disabled ? el : null;
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = knopfUnter(e.target);
    if (!el) return;
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
