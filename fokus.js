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
   Wie der Kalender, mit dem es sich den rechten Streifen teilt:
   - breites Fenster (istSplit aus kalender.js): das Panel steht UNTER dem
     Kalender, nur so hoch wie sein Inhalt (hoechstens 45vh). Beide duerfen
     gleichzeitig offen sein, 📅 und 🔥 sind dort zwei Ein/Aus-Knoepfe.
   - schmales Fenster: das Panel legt sich ueber die Liste, und es gilt
     genau eine Ansicht - 📋 | 📅 | 🔥 ist dort eine echte Auswahl.

   Laeuft NACH kalender.js und benutzt dessen istSplit(),
   schliesseKalender() und kalenderIstOffen(). In der Gegenrichtung gibt es
   window.fokusIstOffen() und window.fokusSchliessen().
   ==================================================================== */

const fokPanel       = document.getElementById("fokusPanel");
const fokHintergrund = document.getElementById("fokusHintergrund");
const fokTimerBox    = document.getElementById("fokTimer");
const fokInhalt      = document.getElementById("fokInhalt");
const fokBilanzText  = document.getElementById("fokBilanz");

// Gemerkter Zustand, eigener Schluessel neben kalAnsicht: die beiden Panels
// sind im Split unabhaengig, ein gemeinsamer Wert koennte sie gar nicht beide
// abbilden.
const FOK_KEY = "fokAnsicht";

// Wie in Fokus' _lib/tag.js - Deckel gegen Vertipper im Zahlenfeld.
const FOK_MAX_MENGE = 99999;

let fokOffen = false;
let fokZugang = false;
let fokListe = null;        // Antwort von gewohnheiten/heute
let fokSitzung = null;      // { geplanteMin, verstrichenSek, pausiert } oder null
let fokStandardMin = 25;
let fokBasisMs = 0;         // wann verstrichenSek gemessen wurde
let fokGemeldet = false;    // Sitzungsende schon gemeldet?
let fokLaedt = false;
let fokFehler = "";
let fokHergestellt = false;

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

function zeichneTimer() {
  fokTimerBox.replaceChildren();

  const zeit = document.createElement("span");
  zeit.className = "fok-zeit" + (fokSitzung ? " laeuft" : "");
  zeit.textContent = fokSitzung
    ? fokZeit(restSek())
    : `${fokStandardMin} Min`;
  fokTimerBox.appendChild(zeit);

  const knoepfe = document.createElement("div");
  knoepfe.className = "fok-knoepfe";

  if (!fokSitzung) {
    knoepfe.appendChild(fokKnopf("▶ Start", "fok-start", starteSitzung));
  } else {
    knoepfe.appendChild(fokKnopf(
      fokSitzung.pausiert ? "▶ Weiter" : "⏸ Pause", "klein", schaltePause));
    knoepfe.appendChild(fokKnopf("⏹ Stopp", "klein", () => beendeSitzung(false)));
  }
  fokTimerBox.appendChild(knoepfe);

  // Die Dauer stellt man drueben ein - hier steht nur, welche gerade gilt.
  if (fokSitzung) {
    const hinweis = document.createElement("span");
    hinweis.className = "fok-geplant";
    hinweis.textContent = `von ${fokSitzung.geplanteMin} Min`
      + (fokSitzung.pausiert ? " · pausiert" : "");
    fokTimerBox.appendChild(hinweis);
  }
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
  if (!fokOffen) return;

  // Bei einem Fehler bleibt der Timer weg: er zeigte sonst die zuletzt
  // bekannte Dauer und einen Start-Knopf, der nur in eine zweite Fehlermeldung
  // laufen kann.
  fokTimerBox.hidden = !!fokFehler;
  if (!fokFehler) zeichneTimer();
  fokInhalt.replaceChildren();

  if (fokFehler) {
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = fokFehler;
    const nochmal = fokKnopf("Nochmal versuchen", "klein", ladeFokus);
    fokInhalt.append(p, nochmal);
    fokBilanzText.textContent = "";
    return;
  }

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

  messeHoehe();
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

// ---------- Oeffnen / Schliessen ----------
/**
 * Einzige Stelle, an der sich der Zustand des Panels niederschlaegt - Klassen,
 * gemerkter Wert und die Hoehenmessung haengen alle hier dran.
 *
 * `sofort` laesst die Animation weg, beim Wiederherstellen nach dem Laden.
 */
function setzeFokPanel(offen, sofort) {
  const split = istSplit();
  fokPanel.hidden = !fokZugang;
  document.documentElement.classList.toggle("fok-offen", offen);
  document.documentElement.classList.toggle("fok-split", offen && split);
  fokPanel.classList.toggle("animiert", !sofort);
  fokPanel.style.transform = offen ? "translateX(0)" : "";
  // Im Split verdunkelt nichts - die Liste daneben bleibt bedienbar.
  fokHintergrund.classList.toggle("sichtbar", offen && !split);
  fokPanel.setAttribute("aria-hidden", offen ? "false" : "true");
  aktualisiereSegmente();
  messeHoehe();
  try { localStorage.setItem(FOK_KEY, offen ? "auf" : "zu"); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

/**
 * Wie hoch das Panel im Split gerade ist. Der Kalender darueber endet an
 * diesem Wert (`bottom: var(--fok-hoehe)` in style.css) - ohne die Messung
 * muesste seine Hoehe fest sein, und ein Panel mit zwei Gewohnheiten naehme
 * genauso viel Platz weg wie eines mit zehn.
 */
function messeHoehe() {
  const teilen = fokOffen && istSplit() && window.kalenderIstOffen?.();
  const wert = teilen ? fokPanel.offsetHeight : 0;
  document.documentElement.style.setProperty("--fok-hoehe", wert + "px");
}
// Der Beobachter faengt alles ab, was die Hoehe von innen aendert (eine Karte
// mehr, ein Timer, der eine Zeile dazubekommt). Von aussen stoesst kalender.js
// die Messung an, sobald sich dort ein Panel oeffnet oder schliesst.
if (window.ResizeObserver) new ResizeObserver(messeHoehe).observe(fokPanel);
window.fokusHoeheMessen = messeHoehe;

function oeffneFokus() {
  // Im schmalen Fenster liegt immer nur EIN Panel vor der Liste.
  if (!istSplit()) schliesseKalender();
  fokOffen = true;
  setzeFokPanel(true);
  zeichneFokus();
  ladeFokus();
}

function schliesseFokus() {
  if (!fokOffen) return;
  fokOffen = false;
  setzeFokPanel(false);
}

// Aus kalender.js, wenn dort im schmalen Fenster ein Panel aufgeht.
window.fokusSchliessen = schliesseFokus;
window.fokusIstOffen = () => fokOffen;

/**
 * Der Zustand der drei Segmente - in allen drei Ecken, in denen der Umschalter
 * steckt (Kopfzeile, Kalender, Fokus-Panel).
 *
 * 🔥 traegt im Split zusaetzlich die Restzeit einer laufenden Sitzung, damit
 * man das Panel zumachen kann und trotzdem sieht, wie lange noch. Am Handy ist
 * dafuer kein Platz - dort wird daraus ein Punkt (style.css).
 */
function aktualisiereSegmente() {
  for (const seg of document.querySelectorAll(".ansicht-seg")) {
    const art = seg.dataset.ansicht;
    if (art === "fokus") {
      seg.hidden = !fokZugang;
      seg.setAttribute("aria-pressed", String(fokOffen));
      const rest = seg.querySelector(".fok-rest");
      if (rest) {
        rest.hidden = !fokSitzung;
        if (fokSitzung) rest.textContent = fokZeit(restSek());
      }
      seg.classList.toggle("laeuft", !!fokSitzung);
    } else if (art === "liste") {
      seg.setAttribute("aria-pressed",
        String(!fokOffen && !window.kalenderIstOffen?.()));
    }
  }
}

// Gemerkte Ansicht wiederherstellen, einmalig - wie beim Kalender erst, wenn
// feststeht, dass jemand angemeldet ist und Zugang hat.
function stelleFokusHer() {
  if (fokHergestellt || !fokZugang) return;
  fokHergestellt = true;
  const gemerkt = localStorage.getItem(FOK_KEY);
  // Ohne gemerkten Zustand entscheidet der Platz: am Rechner steht das Panel
  // gleich da, am Handy naehme es der Liste den Bildschirm weg.
  let auf = gemerkt ? gemerkt === "auf" : istSplit();
  // Im schmalen Fenster gilt genau eine Ansicht. Sind beide gemerkt (am
  // Rechner geoeffnet, am Handy geladen), behaelt der Kalender den Vorrang -
  // er ist der aeltere Teil der App.
  if (auf && !istSplit() && window.kalenderIstOffen?.()) auf = false;
  if (!auf) { setzeFokPanel(false, true); return; }
  fokOffen = true;
  setzeFokPanel(true, true);
  zeichneFokus();
  ladeFokus();
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
  if (fokOffen) zeichneTimer();
}, 1000);

// Zurueck im Tab: der Fertig-Hinweis im Titel hat seinen Zweck erfuellt. Und
// eine Sitzung, die waehrenddessen ablief, wird jetzt nachtraeglich beendet -
// gedrosselte Hintergrund-Timer koennen den Schlag oben verschlafen haben.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  document.title = FOK_TITEL;
  if (fokZugang && fokOffen) ladeFokus();
});

// ---------- Verdrahtung ----------
for (const seg of document.querySelectorAll(".ansicht-seg")) {
  seg.addEventListener("click", () => {
    if (seg.dataset.ansicht === "fokus") {
      // Im Split ein Ein/Aus-Knopf, im schmalen Fenster eine Auswahl - dort
      // tut ein Klick auf die schon gewaehlte Ansicht nichts.
      if (istSplit() && fokOffen) schliesseFokus();
      else oeffneFokus();
    } else if (seg.dataset.ansicht === "liste") {
      schliesseFokus();
    }
  });
}
document.getElementById("fokZu").addEventListener("click", schliesseFokus);
fokHintergrund.addEventListener("click", schliesseFokus);

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && fokOffen) schliesseFokus();
});

// Wandert das Fenster ueber die Split-Grenze, wird aus dem Overlay eine Spalte
// oder umgekehrt. Ohne diesen Abgleich bliebe ein am Handy geoeffnetes Panel
// nach dem Drehen ein Overlay, das die halbe Liste verdeckt.
window.addEventListener("resize", () => {
  if (!fokOffen) { messeHoehe(); return; }
  if (istSplit() !== document.documentElement.classList.contains("fok-split")) {
    setzeFokPanel(true, true);
  }
  messeHoehe();
});

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
  if (fokZugang !== vorher) {
    aktualisiereSegmente();
    fokPanel.hidden = !fokZugang;
    // Zugang gerade aufgegeben: das Panel darf nicht offen stehenbleiben.
    if (!fokZugang && fokOffen) schliesseFokus();
  }
  stelleFokusHer();
};
