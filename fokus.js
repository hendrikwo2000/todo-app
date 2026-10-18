"use strict";

/* ====================================================================
   Fokus-Panel – Gewohnheiten von heute und der Fokus-Timer

   Zeigt im Kalender-Streifen die Gewohnheiten der Tagesansicht zum Abhaken
   und den Timer zum Starten, Pausieren und Beenden. Alles Weitere - Verlauf,
   Statistik, Fokuszeit pro Woche, anlegen, aendern, ordnen, archivieren -
   steht im Fenster "Gewohnheiten" (gewohnheiten.js). Der Knopf "Verlauf &
   mehr" am Ende der Liste oeffnet es, der Stift an einer Karte gleich den
   Bearbeiten-Dialog.

   WOHER DIE DATEN KOMMEN
   Seit Oktober 2026 aus dieser App selbst (functions/api/gewohnheiten/* und
   functions/api/fokus/*). Bis dahin reichte ein Durchreicher die Anfragen an
   die eigene Fokus-App (fokus.it-wolf.org) weiter - die ist in der ToDo-App
   aufgegangen. Die Heute-Liste kommt weiter fertig gerechnet an
   (gewohnheiten/heute); dieses Panel entscheidet nichts selbst, es zeichnet
   nur. Geschrieben wird ueber gewSchreibeTag() in gewohnheiten-daten.js,
   denselben Weg, den das Fenster benutzt - samt Offline-Warteschlange.

   WO ES STEHT
   Kein eigenes Panel: Fokus fuellt #kalUnten und tritt damit an die Stelle des
   MONATSRASTERS - unten wechseln sich Raster und Fokus ab. Ganz oben steht
   dabei unveraendert die Tagesliste; sie gehoert keiner der beiden Ansichten,
   denn sie ist die Antwort, fuer die man den Streifen aufmacht ("was ist heute
   faellig"). Bis zum 13.08.2026 teilten sich alle drei denselben Platz - ein
   Blick auf die Gewohnheiten kostete damit genau diese Antwort.

   Wer das umschaltet, entscheidet kalender.js (kalUntenModus, Werte
   "kalender"/"fokus"). Diese Datei liefert nur den Inhalt und wird ueber
   window.fokusZeigen() / window.fokusVerstecken() ein- und ausgeblendet;
   window.fokusHatZugang() sagt umgekehrt, ob es Fokus ueberhaupt gibt.

   Die REITERZEILE (Kalender | Gewohnheiten | Timer) steht zwar hier im Markup,
   gehoert aber dem Streifen: sie schaltet auch das Raster ein und aus. Ihre
   Klick-Handler liegen deshalb geschlossen in kalender.js und rufen von dort
   window.fokusReiter(); ihre Sichtbarkeit steuert window.fokusReiterzeile().
   Ob es die beiden Fokus-Reiter gibt, steht seit Oktober 2026 als zwei
   Schalter in den Einstellungen ("Bereiche", window.fokusBereiche in app.js)
   - jeder Reiter fuer sich. Davor war es ein Schalter fuer beide.

   Frueher war das ein zweites Panel unter dem Kalender, mit eigener
   Hoehenmessung und eigenem Umschalter. Beide Teile stritten sich um denselben
   Platz - drei Umbauten am 13.08.2026 haben daraus erst einen Bereich mit drei
   Inhalten und dann die heutige Zweiteilung gemacht.
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

// Ob der Fokus-Teil gerade sichtbar ist. Der gemerkte Zustand liegt nicht mehr
// hier, sondern in kalAnsicht (kalender.js) - es ist eine Ansicht von dreien.
let fokSichtbar = false;
// Ob die App angemeldet und geladen ist. Bis Oktober 2026 hing hier der
// Fokus-Zugang des Kontos; seit der Fusion bekommt jedes Konto Gewohnheiten
// und Timer. Gesetzt beim ersten render() (window.fokusNeuZeichnen).
let fokBereit = false;
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

// ---------- Bereiche ----------
// Welche der beiden Fokus-Reiter es gibt - zwei Schalter in den Einstellungen
// (app.js). Ohne Antwort von dort: beide.
function fokErlaubt(reiter) {
  const b = window.fokusBereiche?.() || { gewohnheiten: true, timer: true };
  return reiter === "timer" ? b.timer !== false : b.gewohnheiten !== false;
}

// Der gewuenschte Reiter, wenn es ihn gibt - sonst der andere.
function fokPassenderReiter(wunsch) {
  if (fokErlaubt(wunsch)) return wunsch;
  return wunsch === "timer" ? "gewohnheiten" : "timer";
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
    // Laeuft gerade etwas, ist der Timer das, weswegen man aufmacht - solange
    // man nicht selbst schon auf einen Reiter getippt hat.
    if (fokSitzung && !fokReiterGewaehlt && fokErlaubt("timer")) fokReiter = "timer";
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

// Der leise Weg zu Verlauf, Statistik und Fokuszeit - am Ende der Liste und
// unter dem Timer. Sie stehen in den Einstellungen (Reiter "Verlauf & mehr"),
// der Aufruf klappt den passenden Abschnitt auf. Bis 18.10.2026 war es ein
// eigenes Fenster.
function fokMehrKnopf(text, abschnitt) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "fok-mehr-knopf";
  k.textContent = text;
  k.onclick = () => window.oeffneEinstellungenBei?.("verlauf", abschnitt);
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

/**
 * Reiter umschalten. `vomNutzer` unterscheidet den Klick von der automatischen
 * Wahl beim Oeffnen - nur der Klick friert die Entscheidung ein.
 */
function setzeReiter(welcher, vomNutzer) {
  fokReiter = fokPassenderReiter(welcher);
  if (vomNutzer) fokReiterGewaehlt = true;
  for (const seg of document.querySelectorAll(".fok-reiter-seg")) {
    seg.setAttribute("aria-selected", String(seg.dataset.fokReiter === fokReiter));
  }
  const timerVorn = fokReiter === "timer";
  fokTimerBox.hidden = !fokSichtbar || !timerVorn || !!fokFehler;
  fokInhalt.hidden = !fokSichtbar || timerVorn;
  // Die Tagesbilanz gehoert zu den Gewohnheiten - im Timer stuende sie ohne
  // Bezug neben der Uhr.
  fokBilanzText.hidden = timerVorn;
  if (timerVorn && fokSichtbar) zeichneTimer();
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

  // Selbst gerechnet statt erledigt/gesamt vom Server: nach einem Haken ohne
  // Netz stimmen die Serverzahlen nicht mehr. Ruhende Obergrenzen zaehlen
  // nicht mit - dieselbe Regel wie in heute.js.
  const zaehlend = fokListe.gewohnheiten.filter(g => g.zustand !== "ruht");
  const erledigt = zaehlend.filter(g => g.zustand === "erledigt").length;
  fokBilanzText.textContent = zaehlend.length
    ? (erledigt === zaehlend.length ? "alles erledigt" : `${erledigt} von ${zaehlend.length}`)
    : "";

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

  fokInhalt.appendChild(fokMehrKnopf("Verlauf & mehr ›", "verlauf"));
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
 * Von kalender.js gerufen, wenn der untere Teil des Streifens auf Fokus
 * umschaltet. Jedes Zeigen beginnt bei den Gewohnheiten (oder beim Timer,
 * wenn es nur den gibt); ob eine laufende Sitzung den Timer nach vorn holt,
 * entscheidet ladeFokus() gleich danach.
 */
window.fokusZeigen = function () {
  if (fokSichtbar) { zeichneFokus(); return; }
  fokSichtbar = true;
  fokReiterGewaehlt = false;
  fokReiter = fokPassenderReiter("gewohnheiten");
  zeichneFokus();
  ladeFokus();
};

window.fokusVerstecken = function () {
  fokSichtbar = false;
  fokTimerBox.hidden = true;
  fokInhalt.hidden = true;
};

/**
 * Die Reiterzeile steht auch dann da, wenn unten gerade der KALENDER vorn
 * ist - sie ist der Weg zwischen allen dreien. Ueber ihre Sichtbarkeit
 * entscheidet deshalb der Streifen (zeichneUnten in kalender.js) und nicht das
 * Zeigen/Verstecken des Fokus-Inhalts. Welche der beiden Fokus-Reiter darin
 * stehen, sagen die Schalter in den Einstellungen.
 */
window.fokusReiterzeile = function (sichtbar) {
  fokKopf.hidden = !sichtbar;
  for (const seg of document.querySelectorAll(".fok-reiter-seg")) {
    const welcher = seg.dataset.fokReiter;
    if (welcher !== "kalender") seg.hidden = !fokErlaubt(welcher);
  }
  // Ein gerade abgeschalteter Reiter darf nicht vorn stehen bleiben.
  if (fokSichtbar && !fokErlaubt(fokReiter)) setzeReiter(fokReiter);
};

// Fuer kalender.js: ohne Anmeldung gibt es die Fokus-Reiter gar nicht.
window.fokusHatZugang = () => fokBereit;

// Die Reiter-Klicks liegen in kalender.js, weil "Kalender" dort hingehoert und
// ein halb geteilter Umschalter zwei Wahrheiten haette. Von dort kommt der
// Aufruf.
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

// Zurueck im Tab: der Fertig-Hinweis im Titel hat seinen Zweck erfuellt. Eine
// Sitzung, die waehrenddessen ablief, wird jetzt nachtraeglich beendet -
// gedrosselte Hintergrund-Timer koennen den Schlag oben verschlafen haben.
// Und zurueck in der App ist der wahrscheinlichste Moment, in dem wieder Netz
// da ist - das "online"-Ereignis kommt nicht in jedem Browser zuverlaessig.
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  document.title = FOK_TITEL;
  if (!fokBereit) return;
  await gewLiefereNach();
  if (fokSichtbar) ladeFokus();
});

// ---------- Verdrahtung ----------
// Die Reiter schalten auch den Kalender ein und aus, und diese Entscheidung
// gehoert dem Streifen. Die Klick-Handler stehen deshalb geschlossen in
// kalender.js und rufen von dort window.fokusReiter() - genauso wie Escape
// und die Wischgeste.

// Unter dem Timer: der Weg zu seiner Wochenstatistik in den Einstellungen.
document.getElementById("fokTimerMehr")
  .addEventListener("click", () => window.oeffneEinstellungenBei?.("verlauf", "fokuszeit"));

// Aenderungen von anderswo (Fenster, Dialoge, nachgelieferte Offline-Eintraege,
// Einstellungen): die Liste frisch holen, solange sie zu sehen ist. Verborgen
// genuegt es nicht - beim naechsten Zeigen laedt fokusZeigen() ohnehin neu.
gewBeiAenderung(was => {
  if (!fokBereit || !fokSichtbar) return;
  if (was === "einstellungen") ladeFokus();
  else if (was !== "timer") ladeListe();
});

/**
 * Aus render() in app.js, wie window.kalenderNeuZeichnen. Der erste Aufruf
 * heisst: angemeldet, Daten da - ab jetzt gibt es die Fokus-Reiter. Der
 * Anstoss an den Streifen laeuft nicht in eine Schleife: beim naechsten Mal
 * steigt die Funktion oben aus.
 */
window.fokusNeuZeichnen = function () {
  if (fokBereit) return;
  fokBereit = true;
  aktualisiereSegmente();
  // Was beim letzten Mal ohne Netz liegen geblieben ist, geht jetzt raus.
  gewLiefereNach();
  window.kalenderNeuZeichnen?.();
};
