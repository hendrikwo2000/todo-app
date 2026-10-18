"use strict";

/* ====================================================================
   Fokus – Gewohnheiten von heute und der Fokus-Timer

   Zwei Dinge, die bis 18.10.2026 im Kalender-Streifen unter einer Reiterzeile
   standen (Kalender | Gewohnheiten | Timer). Die Reiterzeile gibt es nicht mehr -
   Hendrik: sie stoerte ueber dem Kalender. Der Streifen zeigt immer das Raster.

   - Die GEWOHNHEITEN stehen zum Abhaken dort, wo der Tag steht: am PC (ab 1380 px,
     mit Heute-Spalte) als Abschnitt ganz unten in der Heute-Spalte (#fokHeute),
     am Tablet und Handy als Abschnitt unten in der Kachel "heute" ueber den ToDos
     (#fokOben in #tagOben), zusaetzlich einklappbar und standardmaessig zu, mit
     der Bilanz im Kopf. Das
     Element #fokInhalt zieht je nach Breite zwischen beiden um (fokPlatziere);
     gezeichnet wird immer mit zeichneFokus().
   - Der TIMER ist ein Knopf in der Kopfzeile (.timer-knopf, zweimal im Dokument:
     App-Kopfzeile und Kalender, wie das Zahnrad). Er zeigt die Restzeit, solange
     eine Sitzung laeuft; ein Tipp oeffnet ein kleines Fenster (#timerPopup) mit
     Ring und Start/Pause/Stopp.

   Alles Weitere - Verlauf, Statistik, Fokuszeit pro Woche, anlegen, aendern, ordnen,
   archivieren - steht in den Einstellungen bzw. im Fenster "Gewohnheiten"
   (gewohnheiten.js); der Stift an einer Karte oeffnet gleich den Bearbeiten-Dialog.
   Die Links "Verlauf & mehr ›" unter den Gewohnheiten und "Fokuszeit pro Woche ›"
   beim Timer gibt es nicht mehr (Hendrik, 18.10.2026: ist in den Einstellungen).

   WOHER DIE DATEN KOMMEN
   Seit Oktober 2026 aus dieser App selbst (functions/api/gewohnheiten/* und
   functions/api/fokus/*). Bis dahin reichte ein Durchreicher die Anfragen an
   die eigene Fokus-App (fokus.it-wolf.org) weiter - die ist in der ToDo-App
   aufgegangen. Die Heute-Liste kommt weiter fertig gerechnet an
   (gewohnheiten/heute); dieses Skript entscheidet nichts selbst, es zeichnet
   nur. Geschrieben wird ueber gewSchreibeTag() in gewohnheiten-daten.js,
   denselben Weg, den das Fenster benutzt - samt Offline-Warteschlange.

   Wer was ruft: kalender.js sagt ueber window.fokusHeute() (Heute-Spalte) und
   window.fokusOben() (Tagesansicht), wann die Gewohnheiten zu sehen sind; app.js
   meldet geaenderte Schalter ueber window.fokusEinstellungGeaendert(); die
   Anmeldung kommt ueber window.fokusNeuZeichnen().
   ==================================================================== */

const fokTimerBox     = document.getElementById("fokTimer");
const fokTimerPopup   = document.getElementById("timerPopup");
const fokTimerHinweis = document.getElementById("fokTimerHinweis");
const fokInhalt       = document.getElementById("fokInhalt");
const fokZeitText     = document.getElementById("fokZeit");
const fokGeplantText  = document.getElementById("fokGeplant");
const fokKnopfReihe   = document.getElementById("fokKnoepfe");
const fokRing         = document.getElementById("fokRingFuellung");
// Die Timer-Knoepfe: einer in der App-Kopfzeile, einer im Kalender.
const fokTimerKnoepfe = document.querySelectorAll(".timer-knopf");
// Der Abschnitt in der Heute-Spalte (PC) und der unten in der Kachel "heute"
// (Tablet, Handy).
const fokHeuteBox     = document.getElementById("fokHeute");
const fokHeuteBilanz  = document.getElementById("fokHeuteBilanz");
const fokObenBox      = document.getElementById("fokOben");
const fokObenKopf     = document.getElementById("fokObenKopf");
const fokObenKoerper  = document.getElementById("fokObenKoerper");
const fokObenBilanz   = document.getElementById("fokObenBilanz");

// Umfang des Fortschrittsrings (r=52 im SVG). Ueber stroke-dasharray/-offset
// wird daraus der gefuellte Anteil.
const RING_UMFANG = 2 * Math.PI * 52;

// Ob die App angemeldet und geladen ist. Bis Oktober 2026 hing hier der
// Fokus-Zugang des Kontos; seit der Fusion bekommt jedes Konto Gewohnheiten
// und Timer. Gesetzt beim ersten render() (window.fokusNeuZeichnen).
let fokBereit = false;
// Ob die Gewohnheiten gerade als Abschnitt in der Heute-Spalte stehen (PC,
// Streifen offen, Gewohnheiten eingeschaltet) bzw. unter der Tagesansicht
// (Tablet, Handy, Tagesansicht zu sehen).
let fokHeuteAn = false;
let fokObenAn = false;
// Die Kachel "heute" (#tagOben), in die der Abschnitt gehoert. Sie wird bei jedem
// Zeichnen geleert, dabei fliegt der Abschnitt raus - kalender.js reicht sie bei
// jedem Zeichnen neu herein (fokusOben), fokPlatziere haengt ihn wieder an.
let fokObenHost = null;
// Der Abschnitt in der Kachel ist einklappbar und startet zu; die Wahl bleibt pro
// Geraet gemerkt.
const FOK_OBEN_KEY = "fokObenOffen";
let fokObenOffen = false;
try { fokObenOffen = localStorage.getItem(FOK_OBEN_KEY) === "1"; }
catch (e) { /* kein Speicher - dann eben zu */ }
// Das Timer-Fenster offen? Und hat die Antwort der API schon einmal geklappt -
// davor bote "Start" etwas an, das vielleicht gar nicht stimmt.
let fokTimerOffen = false;
let fokTimerGeladen = false;
let fokListe = null;        // Antwort von gewohnheiten/heute
let fokSitzung = null;      // { geplanteMin, verstrichenSek, pausiert } oder null
let fokStandardMin = 25;
let fokBasisMs = 0;         // wann verstrichenSek gemessen wurde
let fokGemeldet = false;    // Sitzungsende schon gemeldet?
let fokLaedt = false;
let fokFehler = "";

// ---------- Bereiche ----------
// Was angezeigt wird - zwei Schalter in den Einstellungen ("Anzeige", app.js).
// Ohne Antwort von dort: beides.
function fokErlaubt(was) {
  const b = window.fokusBereiche?.() || { gewohnheiten: true, timer: true };
  return was === "timer" ? b.timer !== false : b.gewohnheiten !== false;
}

// Wohnen die Gewohnheiten gerade in der Heute-Spalte (PC) statt unter der
// Tagesansicht? Das entscheidet allein die Breite (istDrei in kalender.js).
function fokAmTag() {
  return !!window.kalenderDreispaltig?.();
}

// Die Gewohnheiten-Liste (#fokInhalt) an ihren Platz bringen: am PC in die
// Heute-Spalte, sonst in den Abschnitt unter der Tagesansicht. Dasselbe Element
// zieht um, damit alle Verweise darauf (und das Zeichnen) unveraendert bleiben.
function fokPlatziere() {
  const amTag = fokAmTag();
  const ziel = amTag ? fokHeuteBox : fokObenKoerper;
  if (fokInhalt.parentElement !== ziel) ziel.appendChild(fokInhalt);
  fokHeuteBox.hidden = !(amTag && fokHeuteAn);
  // Ans Ende der Kachel "heute" - dort steht er nach dem Zeichnen der Kachel.
  if (fokObenHost && fokObenBox.parentElement !== fokObenHost) fokObenHost.appendChild(fokObenBox);
  fokObenBox.hidden = amTag || !fokObenAn;
  fokObenBox.classList.toggle("zu", !fokObenOffen);
  fokObenKopf.setAttribute("aria-expanded", String(fokObenOffen));
  // Am PC steht die Liste immer da, solange der Abschnitt steht - sonst nur
  // aufgeklappt.
  fokInhalt.hidden = amTag ? !fokHeuteAn : !(fokObenAn && fokObenOffen);
}

// Die Tagesbilanz ("2 von 5") steht am Abschnitt - am PC in der Heute-Spalte,
// sonst im Kopf des einklappbaren Abschnitts, damit man sie zugeklappt sieht.
function fokSetzeBilanz(text) {
  fokHeuteBilanz.textContent = text;
  fokObenBilanz.textContent = text;
}

// ---------- Zugriff auf die API ----------
// Ueber gewApi() aus gewohnheiten-daten.js: eine Anfrage, die nie wirft.
function fokApi(pfad, optionen) {
  return gewApi("/api/" + pfad, optionen);
}

function fokSchreibe(pfad, koerper, methode = "POST") {
  return fokApi(pfad, { method: methode, body: JSON.stringify(koerper || {}) });
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
    fokApi("fokus?heute=" + heute),
  ]);
  fokLaedt = false;

  uebernimmListe(g);
  if (t.ok) {
    uebernimmSitzung(t.daten.offen);
    fokStandardMin = t.daten.einstellungen?.arbeitMin || 25;
    fokTimerGeladen = true;
  }
  zeichneFokus();
}

/**
 * Die Antwort von gewohnheiten/heute uebernehmen. Ohne Netz gilt die zuletzt
 * gesehene Liste von HEUTE - eine von gestern waere falsch (anderer Rhythmus,
 * andere Haken) -, mit dem obendrauf, was seitdem offline abgehakt wurde.
 */
function uebernimmListe(antwort) {
  if (antwort.ok) {
    fokFehler = "";
    fokListe = antwort.daten;
    gewMerke(GEW_HEUTE_SCHLUESSEL, antwort.daten);
    legeWartendesUeber();
    return;
  }
  const gemerkt = antwort.status === 0 ? gewLies(GEW_HEUTE_SCHLUESSEL) : null;
  if (gemerkt && gemerkt.heute === todayStr()) {
    fokFehler = "";
    fokListe = gemerkt;
    legeWartendesUeber();
    return;
  }
  fokFehler = antwort.daten.error || "Die Gewohnheiten lassen sich gerade nicht laden.";
}

// Offline Abgehaktes auf die Karten legen - sonst spraenge eine Karte beim
// naechsten Laden zurueck, solange ihr Eintrag noch nicht beim Server ist.
function legeWartendesUeber() {
  if (!fokListe) return;
  for (const g of fokListe.gewohnheiten) {
    const e = gewWartetHeute(g.id);
    if (e) setzeKarteOertlich(g, e.menge, e.loeschen);
  }
}

// Eine Karte ohne Server umstellen - dieselbe Rechnung wie log.js. "ruht" ist
// eine Obergrenze ohne Eintrag (siehe ruhtHeute in functions/_lib/heute.js).
function setzeKarteOertlich(g, menge, loeschen) {
  if (loeschen) { g.menge = 0; g.zustand = g.obergrenze ? "ruht" : "offen"; return; }
  g.menge = g.typ === "binaer" ? (menge >= 1 ? 1 : 0) : menge;
  g.zustand = gewStatusVon(g, g.menge, g.ziel);
}

// Nur die Liste, nach einem Haken. Die Antwort von log.js hat den neuen Stand
// schon geliefert - hier geht es um das Drumherum: bei "X Mal die Woche"
// verschwindet die Gewohnheit mit dem erreichten Ziel ganz aus der Liste.
async function ladeListe() {
  uebernimmListe(await fokApi("gewohnheiten/heute?heute=" + todayStr()));
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
  // Die Dauer stellt man in den Einstellungen ein - hier steht nur, welche
  // gerade gilt.
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

function minutenText(n) {
  return `${n} ${n === 1 ? "Minute" : "Minuten"}`;
}

/**
 * "3 Tage" hinter der Flamme. Die Einheit kommt vom Server
 * (`straehneEinheit`), statt dass hier geraten wird: fast immer "Tage", nur
 * "X Mal die Woche" im Reihen-Modus zaehlt Wochen (flammenEinheit in
 * functions/_lib/tag.js).
 */
function flammenText(n, einheit) {
  return gewMitEinheit(n, einheit || "Tage");
}

function mengeText(g) {
  const einheit = g.einheit ? " " + g.einheit : "";
  if (g.obergrenze) return `${g.menge} von höchstens ${g.ziel}${einheit}`;
  return `${g.menge} von ${g.ziel}${einheit}`;
}

/**
 * Der Stift, der eine Gewohnheit zum Bearbeiten oeffnet. Sitzt direkt hinter
 * dem Namen und nicht am rechten Rand: dort waere er der Nachbar des Hakens,
 * und der wird jeden Tag getroffen. Dieselbe Form wie im Fenster.
 */
function fokStift(g) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "fok-stift";
  k.textContent = "✎";
  k.title = "Bearbeiten";
  k.setAttribute("aria-label", `${g.name} bearbeiten`);
  k.onclick = () => window.gewOeffneBearbeiten?.(g.id);
  return k;
}

function zeichneKarte(g) {
  const karte = document.createElement("div");
  karte.className = `fok-gew ${g.zustand}` + (g.typ === "menge" ? " mit-menge" : "");

  const haupt = document.createElement("div");
  haupt.className = "fok-gew-haupt";

  const name = document.createElement("div");
  name.className = "fok-gew-name";
  const nameText = document.createElement("span");
  nameText.textContent = g.name;
  name.append(nameText, fokStift(g));
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

  // Offline abgehakt und noch nicht beim Server. Die Karte zeigt schon den
  // neuen Stand - ohne diesen Hinweis saehe sie aus, als waere alles im Kasten.
  if (gewWartetHeute(g.id)) {
    const wartet = document.createElement("span");
    wartet.className = "fok-wartet";
    wartet.textContent = "↻ nicht gespeichert";
    zeile.appendChild(wartet);
  }

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
    eingabe.max = String(GEW_MAX_MENGE);
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
  haken.onclick = async () => {
    if (g.zustand !== "erledigt") {
      setzeTag(g, g.typ !== "menge" ? 1 : (g.obergrenze ? 0 : g.ziel));
      return;
    }
    // Der einzige Tipp hier, der etwas wegnimmt: aus "50 von 60" wird eine 0.
    // Statt einer Rueckfrage, die den haeufigen Fall (versehentlich abgehakt)
    // mit einem zweiten Tipp belastet, gibt es den Weg zurueck hinterher -
    // wie bisher in der Fokus-App. Weil die 0 bei einer Obergrenze selbst
    // schon gruen ist, braucht das Wiederoeffnen dort das Loeschen.
    const vorher = g.menge;
    if (!await setzeTag(g, 0, g.obergrenze)) return;
    showUndo(`„${g.name}“ wieder offen`, () => setzeTag(g, vorher));
  };
  karte.appendChild(haken);

  return karte;
}

// Der Timer-Knopf in den Kopfzeilen: nur da, wenn der Timer eingeschaltet ist,
// und mit der Restzeit, solange eine Sitzung laeuft.
function aktualisiereKnoepfe() {
  const da = fokBereit && fokErlaubt("timer");
  for (const k of fokTimerKnoepfe) {
    k.hidden = !da;
    k.classList.toggle("laeuft", !!fokSitzung);
    k.querySelector(".timer-zeit").textContent = fokSitzung ? fokZeit(restSek()) : "";
    k.title = fokSitzung ? "Fokus-Timer läuft – antippen" : "Fokus-Timer";
  }
}

// Inhalt des Timer-Fensters: der Timer selbst, sobald die API einmal geantwortet
// hat, vorher ein Hinweis.
function zeigeTimerInhalt() {
  fokTimerBox.hidden = !fokTimerGeladen;
  fokTimerHinweis.hidden = fokTimerGeladen;
  if (!fokTimerGeladen) {
    fokTimerHinweis.textContent = fokLaedt ? "Lädt …" : "Der Timer lässt sich gerade nicht laden.";
    return;
  }
  zeichneTimer();
}

function zeichneFokus() {
  // Zuerst der Timer (Knopf, offenes Fenster): er gehoert nicht zu den
  // Gewohnheiten und soll auch dann nachziehen, wenn keine zu sehen sind.
  aktualisiereKnoepfe();
  if (fokTimerOffen) zeigeTimerInhalt();
  if (!fokHeuteAn && !fokObenAn) return;
  fokPlatziere();

  fokInhalt.replaceChildren();

  if (fokFehler) {
    // Die Meldung steht im Inhaltsbereich; mit dem Knopf kommt man zu einem
    // neuen Versuch.
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = fokFehler;
    const nochmal = fokKnopf("Nochmal versuchen", "klein", ladeFokus);
    fokInhalt.append(p, nochmal);
    fokSetzeBilanz("");
    return;
  }

  if (!fokListe) {
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = "Lädt …";
    fokInhalt.appendChild(p);
    return;
  }

  // Selbst gerechnet statt erledigt/gesamt vom Server: nach einem Haken ohne
  // Netz stimmen die Serverzahlen nicht mehr. Ruhende Obergrenzen zaehlen
  // nicht mit - dieselbe Regel wie in heute.js.
  const zaehlend = fokListe.gewohnheiten.filter(g => g.zustand !== "ruht");
  const erledigt = zaehlend.filter(g => g.zustand === "erledigt").length;
  fokSetzeBilanz(zaehlend.length
    ? (erledigt === zaehlend.length ? "alles erledigt" : `${erledigt} von ${zaehlend.length}`)
    : "");

  // Noch gar keine Gewohnheit - der Fall fuer jedes neue Konto. Statt einer
  // leeren Flaeche gleich der Weg zur ersten.
  if (fokListe.aktive === 0) {
    const p = document.createElement("p");
    p.className = "fok-hinweis";
    p.textContent = "Noch keine Gewohnheit. Leg deine erste an – zum Abhaken oder mit Zielmenge.";
    const neu = fokKnopf("＋ Gewohnheit anlegen", "klein", () => window.gewOeffneNeu?.());
    fokInhalt.append(p, neu);
    return;
  }

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
// Gibt zurueck, ob es geklappt hat - der Haken braucht das fuer "Rueckgaengig".
async function setzeTag(g, menge, loeschen) {
  const r = await gewSchreibeTag(g, todayStr(), menge, loeschen === true);
  if (!r.ok) return false;
  // Sofort sichtbar aus der Antwort; die frische Liste holt der Hoerer unten.
  if (r.offline) {
    setzeKarteOertlich(g, menge, loeschen === true);
  } else {
    g.menge = r.menge;
    g.ziel = r.ziel ?? g.ziel;
    // Eine geloeschte Obergrenze ist im Streifen "ruht", nicht "offen" -
    // dieselbe Unterscheidung wie in heute.js.
    g.zustand = r.status === "offen" && g.obergrenze ? "ruht" : r.status;
    g.straehne = r.straehne;
  }
  zeichneFokus();
  return true;
}

async function starteSitzung() {
  // Der Klick ist die Geste, die Browser fuer Tonausgabe verlangen - beim
  // Ablauf des Timers gibt es keine mehr. Deshalb hier schon aufwecken.
  weckeTon();
  document.title = FOK_TITEL;
  const antwort = await fokSchreibe("fokus/start", { heute: todayStr() });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Start fehlgeschlagen."); return; }
  if (antwort.daten.vorherBeendet) {
    snackInfo(`Vorherige Sitzung mit ${antwort.daten.vorherBeendet.echteMin} Min. abgeschlossen`);
  }
  uebernimmSitzung(antwort.daten.offen);
  zeichneFokus();
}

async function schaltePause() {
  const antwort = await fokSchreibe("fokus/pause", {});
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
 * Darunter gibt es nichts zu verlieren.
 */
async function beendeSitzung(automatisch) {
  if (!automatisch && verstrichenSek() >= 60) {
    // Dieselbe Deckelung wie in beendeSitzung() (functions/_lib/fokus.js): eine
    // 45-Minuten-Sitzung kann keine 70 Minuten ins Log schreiben.
    const min = Math.min(Math.round(verstrichenSek() / 60), fokSitzung.geplanteMin);
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
  const antwort = await fokSchreibe("fokus/stop", {});
  uebernimmSitzung(null);
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Beenden fehlgeschlagen."); return; }
  const minuten = antwort.daten.sitzung ? antwort.daten.sitzung.echteMin : geplant;
  if (automatisch) meldeFertig(minuten);
  else snackInfo(`Sitzung beendet — ${minutenText(minuten)}`);
  zeichneFokus();
  // Die Wochenstatistik im Fenster hat jetzt eine Sitzung mehr.
  gewMeldeAenderung("timer");
}

// ---------- Signal am Sitzungsende ----------
// Drei Wege, weil jeder einzelne ausfallen kann: der Tab-Titel geht immer, der
// Ton nur, wenn der Browser Audio erlaubt, die Benachrichtigung nur mit
// Erlaubnis. Die Benachrichtigung kam bis Oktober 2026 aus der Fokus-App -
// mit deren Wegfall sitzt sie hier.
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
  // badgeErlaubt (app.js) ist der App-eigene An/Aus-Zustand der
  // Benachrichtigungen. Notification.permission allein reicht nicht: die
  // bleibt "granted", auch wenn der Schalter in den Einstellungen aus steht.
  if (typeof badgeErlaubt !== "undefined" && badgeErlaubt === true
      && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Fokus-Sitzung fertig", { body: `${minutenText(minuten)} geschafft.`, icon: "icon-192.png" });
    } catch (e) { /* manche Browser erlauben das nur aus einem Service Worker */ }
  }
  snackInfo(`Fokus-Sitzung fertig — ${minutenText(minuten)}`);
}

// ---------- Zeigen / Verstecken ----------
/**
 * Von kalender.js (zeichneHeuteSpalte) gerufen: `an` heisst, die Heute-Spalte steht
 * da (ab 1380 px, Streifen offen). Ob die Gewohnheiten darin erscheinen, haengt
 * zusaetzlich an der Anmeldung und am Schalter in den Einstellungen. Beim
 * Einschalten wird die Liste frisch geholt.
 */
window.fokusHeute = function (an) {
  const neu = !!an && fokBereit && fokErlaubt("gewohnheiten");
  const war = fokHeuteAn;
  fokHeuteAn = neu;
  fokPlatziere();
  if (!neu) return;
  zeichneFokus();
  if (!war) ladeFokus();
};

/**
 * Von kalender.js (zeichneTagOben) gerufen: `an` heisst, die Tagesansicht ueber den
 * ToDos steht da (Tablet, Handy, Fenster unter 1380 px, Board sichtbar), und `host`
 * ist ihre Kachel (#tagOben), frisch gezeichnet. Der Abschnitt gehoert ans Ende
 * dieser Kachel und steht und faellt mit ihr.
 */
window.fokusOben = function (an, host) {
  fokObenHost = an ? (host || fokObenHost) : null;
  const neu = !!an && fokBereit && fokErlaubt("gewohnheiten");
  const war = fokObenAn;
  fokObenAn = neu;
  fokPlatziere();
  if (!neu) return;
  zeichneFokus();
  if (!war) ladeFokus();
};

// Ein Tipp auf den Kopf klappt den Abschnitt in der Kachel auf und zu; die Wahl
// bleibt pro Geraet gemerkt.
fokObenKopf.addEventListener("click", () => {
  fokObenOffen = !fokObenOffen;
  try { localStorage.setItem(FOK_OBEN_KEY, fokObenOffen ? "1" : "0"); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
  fokPlatziere();
});

/**
 * Aus app.js, wenn ein Schalter unter "Anzeige" umgelegt wurde: der Timer-Knopf
 * kommt oder geht. Die Gewohnheiten raeumen selbst um (kalender.js zeichnet neu).
 */
window.fokusEinstellungGeaendert = function () {
  aktualisiereKnoepfe();
  if (fokTimerOffen && !fokErlaubt("timer")) schliesseTimer();
};

// ---------- Timer-Fenster ----------
function oeffneTimer() {
  fokTimerOffen = true;
  fokTimerPopup.hidden = false;
  // Die Knopfreihe neu bauen: beim letzten Mal stand sie vielleicht anders.
  letzteKnopfLage = "";
  zeigeTimerInhalt();
  // Den Stand frisch holen - an einem anderen Geraet kann eine Sitzung laufen.
  ladeFokus();
}

function schliesseTimer() {
  fokTimerOffen = false;
  fokTimerPopup.hidden = true;
}

for (const k of fokTimerKnoepfe) k.addEventListener("click", oeffneTimer);
document.getElementById("timerZu").addEventListener("click", schliesseTimer);
fokTimerPopup.addEventListener("click", e => { if (e.target === fokTimerPopup) schliesseTimer(); });

// Escape schliesst zuerst das Timer-Fenster. In der Einfangphase und mit
// stopImmediatePropagation, wie bei den Dialogen der Gewohnheiten
// (gewohnheiten.js): sonst schlossen die Escape-Handler in app.js und kalender.js
// im selben Tastendruck noch den Streifen dahinter. Steht eine Rueckfrage
// (bestaetigen(), "Sitzung beenden?") offen, hat die Vorrang - sie faengt Escape
// selbst ab.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !fokTimerOffen) return;
  if (document.querySelector(".eingabe-popup")) return;
  schliesseTimer();
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// Fuer die Zurueck-Taste am Handy (schliesseObersteEbene in kalender.js).
window.fokusSchliesseOberste = function () {
  if (!fokTimerOffen) return false;
  schliesseTimer();
  return true;
};

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
  aktualisiereKnoepfe();
  if (fokTimerOffen) zeichneTimer();
}, 1000);

// Zurueck im Tab: der Fertig-Hinweis im Titel hat seinen Zweck erfuellt. Eine
// Sitzung, die waehrenddessen ablief, wird jetzt nachtraeglich beendet -
// gedrosselte Hintergrund-Timer koennen den Schlag oben verschlafen haben.
// Und zurueck in der App ist der wahrscheinlichste Moment, in dem wieder Netz
// da ist - das "online"-Ereignis kommt nicht in jedem Browser zuverlaessig.
// Die Sitzung wird immer neu geholt: der Knopf in der Kopfzeile steht ja
// dauernd da und soll keine laengst beendete Sitzung anzeigen.
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  document.title = FOK_TITEL;
  if (!fokBereit) return;
  await gewLiefereNach();
  ladeFokus();
});

// Aenderungen von anderswo (Fenster, Dialoge, nachgelieferte Offline-Eintraege,
// Einstellungen): die Liste frisch holen, solange sie zu sehen ist. Verborgen
// genuegt es nicht - beim naechsten Zeigen laedt fokusHeute()/fokusOben() ohnehin neu.
// Eine geaenderte Standarddauer oder Zaehlweise holt auch den Timer neu.
gewBeiAenderung(was => {
  if (!fokBereit) return;
  if (was === "einstellungen") { ladeFokus(); return; }
  if (was !== "timer" && (fokHeuteAn || fokObenAn)) ladeListe();
});

/**
 * Aus render() in app.js, wie window.kalenderNeuZeichnen. Der erste Aufruf
 * heisst: angemeldet, Daten da - ab jetzt gibt es Gewohnheiten und Timer-Knopf.
 * Der Anstoss an den Streifen laeuft nicht in eine Schleife: beim naechsten Mal
 * steigt die Funktion oben aus.
 */
window.fokusNeuZeichnen = function () {
  if (fokBereit) return;
  fokBereit = true;
  aktualisiereKnoepfe();
  // Was beim letzten Mal ohne Netz liegen geblieben ist, geht jetzt raus.
  gewLiefereNach();
  // Sitzung und Standarddauer gleich holen: der Knopf in der Kopfzeile zeigt
  // sonst erst nach dem ersten Oeffnen, dass eine Sitzung laeuft.
  ladeFokus();
  window.kalenderNeuZeichnen?.();
};
