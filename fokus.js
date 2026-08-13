"use strict";

/* ====================================================================
   Fokus-Panel – Gewohnheiten von heute und der Fokus-Timer

   Zeigt in der ToDo-Liste, was der Fokus-Tracker (fokus.it-wolf.org) fuer
   heute vorsieht: die Gewohnheiten der Tagesansicht zum Abhaken und den
   Timer zum Starten, Pausieren und Beenden. Alles Weitere - anlegen,
   aendern, Verlauf, Statistik, Dauer einstellen - bleibt drueben.

   WOHER DIE DATEN KOMMEN
   Nicht aus der Datenbank direkt, obwohl beide Apps dieselbe benutzen:
   ueber /api/fokus/ (functions/api/fokus/[[pfad]].js) fragt der Worker die
   Fokus-App und reicht ihre Antwort durch. Damit liegen Flammen-, Rhythmus-
   und Obergrenzen-Regeln weiter an genau einem Ort. Die Heute-Liste kommt
   fertig gerechnet an (gewohnheiten/heute) - dieses Panel entscheidet
   nichts selbst, es zeichnet nur.

   WO ES STEHT
   Kein eigenes Panel: Fokus fuellt #kalUnten und tritt damit an die Stelle des
   MONATSRASTERS - oben wechseln sich Raster und Fokus ab, die Tagesliste
   darunter bleibt stehen. Bis zum 13.08.2026 teilten sich alle drei den
   unteren Platz; ein Blick auf die Gewohnheiten kostete damit den Blick auf
   "was ist heute faellig", und genau dafuer ist der Streifen da.

   Wer das umschaltet, entscheidet kalender.js (kalObenModus). Diese Datei
   liefert nur den Inhalt und wird ueber window.fokusZeigen() /
   window.fokusVerstecken() ein- und ausgeblendet; window.fokusHatZugang()
   sagt umgekehrt, ob es Fokus ueberhaupt gibt.

   Die REITERZEILE (Tag | Gewohnheiten | Timer) steht zwar hier im Markup,
   gehoert aber dem Streifen: sie schaltet auch den Tag ein und aus. Ihre
   Klick-Handler liegen deshalb geschlossen in kalender.js und rufen von dort
   window.fokusReiter(); ihre Sichtbarkeit steuert window.fokusReiterzeile().
   Seit dem 13.08.2026 gibt es dafuer kein 🔥 mehr in der Kopfzeile - drei
   Knoepfe waren dort einer zu viel, und ob es den Fokus im Streifen ueberhaupt
   gibt, steht jetzt als Schalter in den Einstellungen (window.fokusImStreifen
   in app.js).

   Frueher war das ein zweites Panel unter dem Kalender, mit eigener
   Hoehenmessung und eigenem Umschalter. Beide Teile stritten sich um denselben
   Platz - der Umbau am 13.08.2026 hat daraus einen Bereich mit drei Inhalten
   gemacht.
   ==================================================================== */

const fokKopf        = document.getElementById("fokKopf");
const fokTimerBox    = document.getElementById("fokTimer");
const fokInhalt      = document.getElementById("fokInhalt");
const fokBilanzText  = document.getElementById("fokBilanz");
const fokZeitText    = document.getElementById("fokZeit");
const fokGeplantText = document.getElementById("fokGeplant");
const fokKnopfReihe  = document.getElementById("fokKnoepfe");
const fokRing        = document.getElementById("fokRingFuellung");

// Umfang des Fortschrittsrings (r=52 im SVG). Ueber stroke-dasharray/-offset
// wird daraus der gefuellte Anteil.
const RING_UMFANG = 2 * Math.PI * 52;

// Wie in Fokus' _lib/tag.js - Deckel gegen Vertipper im Zahlenfeld.
const FOK_MAX_MENGE = 99999;

// Ob der Fokus-Teil gerade sichtbar ist. Der gemerkte Zustand liegt nicht mehr
// hier, sondern in kalAnsicht (kalender.js) - es ist eine Ansicht von dreien.
let fokSichtbar = false;
let fokZugang = false;
// Welcher Reiter gilt: "gewohnheiten" oder "timer".
let fokReiter = "gewohnheiten";
// Hat der Nutzer den Reiter selbst gewaehlt? Dann bleibt seine Wahl stehen -
// sonst darf eine laufende Sitzung beim Oeffnen den Timer nach vorn holen.
let fokReiterGewaehlt = false;
let fokListe = null;        // Antwort von gewohnheiten/heute
let fokSitzung = null;      // { geplanteMin, verstrichenSek, pausiert } oder null
let fokStandardMin = 25;
let fokBasisMs = 0;         // wann verstrichenSek gemessen wurde
let fokGemeldet = false;    // Sitzungsende schon gemeldet?
let fokLaedt = false;
let fokFehler = "";

// ---------- Zugriff auf die Fokus-API ----------
async function fokApi(pfad, optionen = {}) {
  try {
    const antwort = await fetch("/api/fokus/" + pfad, {
      credentials: "same-origin",
      ...optionen,
    });
    let daten = {};
    try { daten = await antwort.json(); } catch (e) { /* leere Antwort */ }
    return { ok: antwort.ok, status: antwort.status, daten };
  } catch (e) {
    // Offline oder Server weg. Das Panel sagt es, die ToDo-Liste laeuft weiter.
    return { ok: false, status: 0, daten: { error: "Keine Verbindung zum Fokus-Tracker." } };
  }
}

function fokSchreibe(pfad, koerper, methode = "POST") {
  return fokApi(pfad, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(koerper || {}),
  });
}

// ---------- Laden ----------
// Die Sitzung kommt als Stand von JETZT; ab dann zaehlt die Anzeige selbst
// weiter. Gerechnet wird trotzdem immer aus dem Serverwert, nie aufaddiert -
// so ueberlebt der Countdown Reload, Tabwechsel und Handysperre.
function uebernimmSitzung(offen) {
  fokSitzung = offen || null;
  fokBasisMs = Date.now();
  if (fokSitzung) fokGemeldet = false;
}

function verstrichenSek() {
  if (!fokSitzung) return 0;
  const dazu = fokSitzung.pausiert ? 0 : (Date.now() - fokBasisMs) / 1000;
  return fokSitzung.verstrichenSek + dazu;
}

function restSek() {
  if (!fokSitzung) return 0;
  return Math.max(0, fokSitzung.geplanteMin * 60 - verstrichenSek());
}

async function ladeFokus() {
  if (fokLaedt) return;
  fokLaedt = true;
  const heute = todayStr();
  const [g, t] = await Promise.all([
    fokApi("gewohnheiten/heute?heute=" + heute),
    fokApi("timer?heute=" + heute),
  ]);
  fokLaedt = false;

  if (!g.ok) {
    fokFehler = g.daten.error || "Der Fokus-Tracker antwortet nicht.";
  } else {
    fokFehler = "";
    fokListe = g.daten;
  }
  if (t.ok) {
    uebernimmSitzung(t.daten.offen);
    fokStandardMin = t.daten.einstellungen?.arbeitMin || 25;
    // Laeuft gerade etwas, ist der Timer das, weswegen man aufmacht - solange
    // man nicht selbst schon auf einen Reiter getippt hat.
    if (fokSitzung && !fokReiterGewaehlt) fokReiter = "timer";
  }
  zeichneFokus();
}

// Nur die Liste, nach einem Haken. Die Antwort von log.js hat den neuen Stand
// schon geliefert - hier geht es um das Drumherum: die Tagesbilanz, und bei
// "X Mal die Woche" verschwindet die Gewohnheit mit dem erreichten Ziel ganz
// aus der Liste.
async function ladeListe() {
  const antwort = await fokApi("gewohnheiten/heute?heute=" + todayStr());
  if (antwort.ok) { fokListe = antwort.daten; fokFehler = ""; }
  zeichneFokus();
}

// ---------- Zeichnen ----------
function fokZeit(sekunden) {
  const s = Math.max(0, Math.round(sekunden));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fokKnopf(text, klasse, aufruf) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "btn " + klasse;
  k.textContent = text;
  k.onclick = aufruf;
  return k;
}

/**
 * Zeit, Ring und Knopfreihe des Timers.
 *
 * Laeuft im Sekundentakt, deshalb wird nur gesetzt, nicht neu gebaut - die
 * SVG-Struktur steht fest in index.html. Einzig die Knopfreihe wechselt ihren
 * Inhalt (Start bzw. Pause/Stopp), und das nur bei einem Zustandswechsel.
 */
let letzteKnopfLage = "";
function zeichneTimer() {
  const laeuft = !!fokSitzung;
  fokTimerBox.classList.toggle("laeuft", laeuft);
  fokZeitText.textContent = laeuft
    ? fokZeit(restSek())
    : `${fokStandardMin}:00`;
  // Die Dauer stellt man drueben ein - hier steht nur, welche gerade gilt.
  fokGeplantText.textContent = laeuft
    ? `von ${fokSitzung.geplanteMin} Min` + (fokSitzung.pausiert ? " · pausiert" : "")
    : "Standarddauer";

  const anteil = laeuft
    ? Math.min(1, verstrichenSek() / (fokSitzung.geplanteMin * 60))
    : 0;
  fokRing.style.strokeDasharray = String(RING_UMFANG);
  fokRing.style.strokeDashoffset = String(RING_UMFANG * (1 - anteil));

  const lage = !laeuft ? "aus" : (fokSitzung.pausiert ? "pause" : "an");
  if (lage === letzteKnopfLage) return;
  letzteKnopfLage = lage;
  fokKnopfReihe.replaceChildren();
  if (!laeuft) {
    fokKnopfReihe.appendChild(fokKnopf("▶ Start", "fok-start", starteSitzung));
  } else {
    fokKnopfReihe.appendChild(fokKnopf(
      fokSitzung.pausiert ? "▶ Weiter" : "⏸ Pause", "", schaltePause));
    fokKnopfReihe.appendChild(fokKnopf("⏹ Stopp", "", () => beendeSitzung(false)));
  }
}

/**
 * Reiter umschalten. `vomNutzer` unterscheidet den Klick von der automatischen
 * Wahl beim Oeffnen - nur der Klick friert die Entscheidung ein.
 */
function setzeReiter(welcher, vomNutzer) {
  fokReiter = welcher;
  if (vomNutzer) fokReiterGewaehlt = true;
  for (const seg of document.querySelectorAll(".fok-reiter-seg")) {
    seg.setAttribute("aria-selected", String(seg.dataset.fokReiter === welcher));
  }
  const timerVorn = welcher === "timer";
  fokTimerBox.hidden = !fokSichtbar || !timerVorn || !!fokFehler;
  fokInhalt.hidden = !fokSichtbar || timerVorn;
  // Die Tagesbilanz gehoert zu den Gewohnheiten - im Timer stuende sie ohne
  // Bezug neben der Uhr.
  fokBilanzText.hidden = timerVorn;
  if (timerVorn && fokSichtbar) zeichneTimer();
}

/**
 * "3 Tage" bzw. "1 Woche" hinter der Flamme.
 *
 * Bei "X Mal die Woche" zaehlt die Straehne ganze WOCHEN, nicht Tage (siehe
 * straehneXProWoche in Fokus' _lib/tag.js) - der Server schickt die passende
 * Einheit deshalb mit, statt dass hier geraten wird.
 */
function minutenText(n) {
  return `${n} ${n === 1 ? "Minute" : "Minuten"}`;
}

function flammenText(n, einheit) {
  if (einheit === "Wochen") return `${n} ${n === 1 ? "Woche" : "Wochen"}`;
  return `${n} ${n === 1 ? "Tag" : "Tage"}`;
}

function mengeText(g) {
  const einheit = g.einheit ? " " + g.einheit : "";
  if (g.obergrenze) return `${g.menge} von höchstens ${g.ziel}${einheit}`;
  return `${g.menge} von ${g.ziel}${einheit}`;
}

function zeichneKarte(g) {
  const karte = document.createElement("div");
  karte.className = `fok-gew ${g.zustand}` + (g.typ === "menge" ? " mit-menge" : "");

  const haupt = document.createElement("div");
  haupt.className = "fok-gew-haupt";

  const name = document.createElement("div");
  name.className = "fok-gew-name";
  name.textContent = g.name;
  haupt.appendChild(name);

  const zeile = document.createElement("div");
  zeile.className = "fok-gew-zeile";

  if (g.typ === "menge") {
    const t = document.createElement("span");
    t.textContent = mengeText(g);
    zeile.appendChild(t);
  }
  if (g.wochenziel) {
    const w = document.createElement("span");
    w.textContent = `${g.wochenErledigt} von ${g.wochenziel} diese Woche`;
    zeile.appendChild(w);
  }

  const flamme = document.createElement("span");
  flamme.className = "fok-flammen-zahl" + (g.straehne > 0 ? " aktiv" : "");
  flamme.textContent = g.straehne > 0
    ? `🔥 ${flammenText(g.straehne, g.straehneEinheit)}`
    : "keine Flamme";
  zeile.appendChild(flamme);

  haupt.appendChild(zeile);
  karte.appendChild(haupt);

  if (g.typ === "menge") {
    const feld = document.createElement("div");
    feld.className = "fok-menge";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `${g.name}: Menge um 1 verringern`);
    // Bei 0 gar nicht erst schicken: bei einer Obergrenze legte die 0 sonst
    // einen erledigten Tag an, obwohl man nur "nichts" verringert hat.
    minus.onclick = () => { if (g.menge > 0) setzeTag(g, g.menge - 1); };
    feld.appendChild(minus);

    const eingabe = document.createElement("input");
    eingabe.type = "number";
    eingabe.min = "0";
    eingabe.max = String(FOK_MAX_MENGE);
    eingabe.step = "1";
    eingabe.value = String(g.menge);
    eingabe.setAttribute("aria-label", `${g.name}: Menge für heute`);
    // change statt input: sonst schiesst jeder Tastendruck eine Anfrage ab.
    eingabe.onchange = () => setzeTag(g, Number(eingabe.value));
    feld.appendChild(eingabe);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `${g.name}: Menge um 1 erhöhen`);
    plus.onclick = () => setzeTag(g, g.menge + 1);
    feld.appendChild(plus);

    karte.appendChild(feld);
  }

  // Ein Tipp = Ziel erreicht (oder wieder auf null). Bei einer Obergrenze ist
  // "geschafft" das Gegenteil: nicht die Grenze ausreizen, sondern gar nichts
  // davon gemacht zu haben - der Haken springt deshalb auf 0.
  const haken = document.createElement("button");
  haken.type = "button";
  haken.className = "fok-haken" + (g.zustand === "erledigt" ? " an" : "");
  haken.textContent = "✓";
  haken.title = g.zustand === "erledigt" ? "Wieder öffnen"
    : g.obergrenze ? "Heute nichts davon"
    : "Als erledigt markieren";
  haken.setAttribute("aria-label", `${g.name}: ${haken.title}`);
  haken.onclick = () => {
    if (g.zustand !== "erledigt") {
      setzeTag(g, g.typ !== "menge" ? 1 : (g.obergrenze ? 0 : g.ziel));
    } else {
      // Weil die 0 bei einer Obergrenze selbst schon gruen ist, braucht das
      // Wiederoeffnen dort das ausdrueckliche Loeschen.
      setzeTag(g, 0, g.obergrenze);
    }
  };
  karte.appendChild(haken);

  return karte;
}

function zeichneFokus() {
  aktualisiereSegmente();
  if (!fokSichtbar) return;

  fokInhalt.replaceChildren();

  if (fokFehler) {
    // Bei einem Fehler bleibt der Timer weg (setzeReiter prueft fokFehler mit)
    // und die Meldung steht im Inhaltsbereich: ein Start-Knopf koennte hier nur
    // in eine zweite Fehlermeldung laufen.
    setzeReiter("gewohnheiten");
    fokInhalt.hidden = false;
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = fokFehler;
    const nochmal = fokKnopf("Nochmal versuchen", "klein", ladeFokus);
    fokInhalt.append(p, nochmal);
    fokBilanzText.textContent = "";
    return;
  }

  setzeReiter(fokReiter);

  if (!fokListe) {
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = "Lädt …";
    fokInhalt.appendChild(p);
    return;
  }

  fokBilanzText.textContent = fokListe.gesamt
    ? (fokListe.erledigt === fokListe.gesamt
        ? "alles erledigt"
        : `${fokListe.erledigt} von ${fokListe.gesamt}`)
    : "";

  if (!fokListe.gewohnheiten.length) {
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = fokListe.wochenFertig.length
      ? "Heute ist nichts mehr dran."
      : "Heute ist keine Gewohnheit dran.";
    fokInhalt.appendChild(p);
  } else {
    for (const g of fokListe.gewohnheiten) fokInhalt.appendChild(zeichneKarte(g));
  }

  // Der einzige Grund, aus dem eine Gewohnheit heute lautlos fehlt.
  if (fokListe.wochenFertig.length) {
    const p = document.createElement("p");
    p.className = "fok-woche-fertig";
    p.textContent = `Diese Woche schon geschafft: ${fokListe.wochenFertig.join(", ")}`;
    fokInhalt.appendChild(p);
  }
}

// ---------- Schreiben ----------
async function setzeTag(g, menge, loeschen) {
  const antwort = await fokSchreibe("gewohnheiten/log", {
    gewohnheitId: g.id,
    datum: todayStr(),
    heute: todayStr(),
    menge,
    loeschen: loeschen === true,
  }, "PUT");

  if (!antwort.ok) {
    snackInfo(antwort.daten.error || "Konnte nicht gespeichert werden.");
    return;
  }
  // Sofort sichtbar aus der Antwort, danach die Liste frisch - siehe ladeListe.
  g.menge = antwort.daten.menge;
  g.ziel = antwort.daten.ziel;
  g.zustand = antwort.daten.status;
  g.straehne = antwort.daten.straehne;
  zeichneFokus();
  ladeListe();
}

async function starteSitzung() {
  // Der Klick ist die Geste, die Browser fuer Tonausgabe verlangen - beim
  // Ablauf des Timers gibt es keine mehr. Deshalb hier schon aufwecken.
  weckeTon();
  const antwort = await fokSchreibe("timer/start", { heute: todayStr() });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Start fehlgeschlagen."); return; }
  if (antwort.daten.vorherBeendet) {
    snackInfo(`Vorherige Sitzung mit ${antwort.daten.vorherBeendet.echteMin} Min. abgeschlossen`);
  }
  uebernimmSitzung(antwort.daten.offen);
  zeichneFokus();
}

async function schaltePause() {
  const antwort = await fokSchreibe("timer/pause", {});
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Hat nicht geklappt."); return; }
  uebernimmSitzung(antwort.daten.offen);
  zeichneFokus();
}

/**
 * Sitzung beenden - von Hand oder weil der Countdown abgelaufen ist.
 *
 * Die Rueckfrage gibt es nur beim Abbruch von Hand und erst ab einer Minute:
 * eine geloggte Sitzung laesst sich nachtraeglich nicht mehr aendern, ein
 * Fehlgriff neben "Pause" bliebe also fuer immer in der Wochenstatistik.
 * Darunter gibt es nichts zu verlieren. Dieselbe Regel wie in der Fokus-App.
 */
async function beendeSitzung(automatisch) {
  if (!automatisch && verstrichenSek() >= 60) {
    const min = Math.round(verstrichenSek() / 60);
    const weiter = await bestaetigen({
      icon: "⏹",
      titel: "Sitzung beenden?",
      text: `${min} ${min === 1 ? "Minute wird" : "Minuten werden"} so geloggt, wie sie jetzt `
          + `${min === 1 ? "steht" : "stehen"}. Ändern lässt sich das hinterher nicht mehr.`,
      okText: "Beenden",
    });
    if (!weiter) return;
  }
  const geplant = fokSitzung ? fokSitzung.geplanteMin : 0;
  const antwort = await fokSchreibe("timer/stop", {});
  uebernimmSitzung(null);
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Beenden fehlgeschlagen."); return; }
  const minuten = antwort.daten.sitzung ? antwort.daten.sitzung.echteMin : geplant;
  if (automatisch) meldeFertig(minuten);
  else snackInfo(`Sitzung beendet — ${minutenText(minuten)}`);
  zeichneFokus();
}

// ---------- Signal am Sitzungsende ----------
// Zwei Wege, weil jeder einzelne ausfallen kann: der Tab-Titel geht immer, der
// Ton nur, wenn der Browser Audio erlaubt. Eine Browser-Benachrichtigung gibt
// es hier bewusst NICHT - die schickt die Fokus-App schon, und bei zwei
// offenen Tabs meldete sich dasselbe Sitzungsende sonst doppelt.
let fokTon = null;
function weckeTon() {
  try {
    fokTon = fokTon || new (window.AudioContext || window.webkitAudioContext)();
    if (fokTon.state === "suspended") fokTon.resume();
  } catch (e) { /* kein Ton, kein Beinbruch */ }
}

function piep() {
  try {
    weckeTon();
    if (!fokTon) return;
    // Zwei kurze Toene: ein einzelner geht im Alltagslaerm unter, ein langer
    // erschrickt.
    [0, 0.28].forEach((versatz, i) => {
      const ton = fokTon.createOscillator();
      const lautstaerke = fokTon.createGain();
      ton.frequency.value = i === 0 ? 660 : 880;
      ton.connect(lautstaerke).connect(fokTon.destination);
      const start = fokTon.currentTime + versatz;
      lautstaerke.gain.setValueAtTime(0.0001, start);
      lautstaerke.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      lautstaerke.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      ton.start(start);
      ton.stop(start + 0.24);
    });
  } catch (e) { /* Audio blockiert - Titel und Snackbar bleiben */ }
}

const FOK_TITEL = document.title;
function meldeFertig(minuten) {
  // Der Titel ist der Weg zu jemandem, der gerade in einem anderen Tab ist.
  if (document.hidden) document.title = "✓ Fokus fertig";
  piep();
  snackInfo(`Fokus-Sitzung fertig — ${minutenText(minuten)}`);
}

// ---------- Zeigen / Verstecken ----------
/**
 * Von kalender.js gerufen, wenn der untere Teil des Streifens auf Fokus
 * umschaltet. Jedes Zeigen beginnt bei den Gewohnheiten; ob eine laufende
 * Sitzung den Timer nach vorn holt, entscheidet ladeFokus() gleich danach.
 */
window.fokusZeigen = function () {
  if (fokSichtbar) { zeichneFokus(); return; }
  fokSichtbar = true;
  fokReiterGewaehlt = false;
  fokReiter = "gewohnheiten";
  zeichneFokus();
  ladeFokus();
};

window.fokusVerstecken = function () {
  fokSichtbar = false;
  fokTimerBox.hidden = true;
  fokInhalt.hidden = true;
};

/**
 * Die Reiterzeile steht auch dann da, wenn unten gerade der TAG vorn ist -
 * sie ist der Weg zwischen allen dreien. Ueber ihre Sichtbarkeit entscheidet
 * deshalb der Streifen (zeichneUnten in kalender.js) und nicht das
 * Zeigen/Verstecken des Fokus-Inhalts.
 */
window.fokusReiterzeile = function (sichtbar) {
  fokKopf.hidden = !sichtbar;
};

// Fuer kalender.js: ohne Zugang gibt es die Fokus-Reiter gar nicht.
window.fokusHatZugang = () => fokZugang;

// Die Reiter-Klicks liegen in kalender.js, weil "Tag" dort hingehoert und ein
// halb geteilter Umschalter zwei Wahrheiten haette. Von dort kommt der Aufruf.
window.fokusReiter = setzeReiter;

/**
 * Restzeit einer laufenden Sitzung am Timer-Reiter. Frueher stand sie am 🔥 in
 * der Kopfzeile; die gibt es nicht mehr, und ein zugeklappter Streifen zeigt
 * jetzt gar keine Restzeit - dafuer laeuft die Meldung am Sitzungsende und der
 * Tab-Titel weiter.
 */
function aktualisiereSegmente() {
  const reiter = document.querySelector('.fok-reiter-seg[data-fok-reiter="timer"]');
  if (!reiter) return;
  reiter.classList.toggle("laeuft", !!fokSitzung);
  reiter.textContent = fokSitzung ? `Timer ${fokZeit(restSek())}` : "Timer";
}

// ---------- Takt ----------
// Ein Schlag pro Sekunde, nur bei laufender Sitzung. Er zeichnet nur;
// gerechnet wird aus dem Startzeitpunkt vom Server.
setInterval(() => {
  if (!fokSitzung) return;
  if (!fokSitzung.pausiert && !fokGemeldet && restSek() <= 0) {
    fokGemeldet = true;   // vor dem await, sonst feuert der naechste Schlag nochmal
    beendeSitzung(true);
    return;
  }
  aktualisiereSegmente();
  if (fokSichtbar && fokReiter === "timer" && window.kalenderZeigtFokus?.()) zeichneTimer();
}, 1000);

// Zurueck im Tab: der Fertig-Hinweis im Titel hat seinen Zweck erfuellt. Und
// eine Sitzung, die waehrenddessen ablief, wird jetzt nachtraeglich beendet -
// gedrosselte Hintergrund-Timer koennen den Schlag oben verschlafen haben.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  document.title = FOK_TITEL;
  if (fokZugang && fokSichtbar) ladeFokus();
});

// ---------- Verdrahtung ----------
// Hier gar keine mehr: die Reiter schalten seit dem Wegfall der Flamme auch
// den Tag ein und aus, und diese Entscheidung gehoert dem Streifen. Die
// Klick-Handler stehen deshalb geschlossen in kalender.js und rufen von dort
// window.fokusReiter() - genauso wie Escape und die Wischgeste schon immer.

/**
 * Aus render() in app.js, wie window.kalenderNeuZeichnen.
 *
 * Hier faellt die Entscheidung, ob es das Panel ueberhaupt gibt: `fokusZugang`
 * steht erst nach dem Bootstrap fest (/api/todos), vorher weiss niemand, ob
 * dieses Konto den Fokus-Tracker benutzen darf.
 */
window.fokusNeuZeichnen = function () {
  const vorher = fokZugang;
  fokZugang = window.hatFokusZugang?.() === true;
  if (fokZugang === vorher) return;
  aktualisiereSegmente();
  // Am Zugang haengt jetzt die ganze Reiterzeile, nicht mehr nur ein Segment:
  // frisch geholt muss sie erscheinen, aufgegeben verschwinden - und im
  // zweiten Fall faellt ein offener Fokus-Reiter auf den Tag zurueck. Beides
  // entscheidet zeichneUnten() in kalender.js. Der Aufruf laeuft nicht in eine
  // Schleife: beim naechsten Mal ist fokZugang unveraendert und die Funktion
  // steigt oben aus.
  window.kalenderNeuZeichnen?.();
};
