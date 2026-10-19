"use strict";

/* ====================================================================
   Fokus – die Gewohnheiten von heute

   Bis 18.10.2026 standen sie mit dem Timer im Kalender-Streifen unter einer
   Reiterzeile (Kalender | Gewohnheiten | Timer). Die Reiterzeile gibt es nicht
   mehr - Hendrik: sie stoerte ueber dem Kalender. Der Streifen zeigt immer das
   Raster. Der Timer ist seit demselben Tag eine Zeiterfassung mit eigener Datei
   (zeiterfassung.js); hier steht nichts mehr davon.

   Die GEWOHNHEITEN stehen zum Abhaken dort, wo der Tag steht: am PC (ab 1380 px,
   mit Heute-Spalte) als Abschnitt ganz unten in der Heute-Spalte (#fokHeute),
   am Tablet und Handy als Abschnitt unten in der Kachel "heute" ueber den ToDos
   (#fokOben in #tagOben), zusaetzlich einklappbar und standardmaessig zu, mit
   der Bilanz im Kopf. Das Element #fokInhalt zieht je nach Breite zwischen
   beiden um (fokPlatziere); gezeichnet wird immer mit zeichneFokus().

   Alles Weitere - Verlauf, Statistik, anlegen, aendern, ordnen, archivieren -
   steht in den Einstellungen bzw. im Fenster "Gewohnheiten" (gewohnheiten.js).
   Die Karten haben keinen Stift mehr (Hendrik, 19.10.2026: Bearbeiten geht in
   den Einstellungen). Der Link
   "Verlauf & mehr ›" unter den Gewohnheiten ist weg (Hendrik, 18.10.2026: ist
   in den Einstellungen).

   WOHER DIE DATEN KOMMEN
   Seit Oktober 2026 aus dieser App selbst (functions/api/gewohnheiten/*). Bis
   dahin reichte ein Durchreicher die Anfragen an die eigene Fokus-App
   (fokus.it-wolf.org) weiter - die ist in der ToDo-App aufgegangen. Die
   Heute-Liste kommt weiter fertig gerechnet an (gewohnheiten/heute); dieses
   Skript entscheidet nichts selbst, es zeichnet nur. Geschrieben wird ueber
   gewSchreibeTag() in gewohnheiten-daten.js, denselben Weg, den das Fenster
   benutzt - samt Offline-Warteschlange.

   Wer was ruft: kalender.js sagt ueber window.fokusHeute() (Heute-Spalte) und
   window.fokusOben() (Tagesansicht), wann die Gewohnheiten zu sehen sind; die
   Anmeldung kommt ueber window.fokusNeuZeichnen().
   ==================================================================== */

const fokInhalt       = document.getElementById("fokInhalt");
// Der Abschnitt in der Heute-Spalte (PC) und der unten in der Kachel "heute"
// (Tablet, Handy).
const fokHeuteBox     = document.getElementById("fokHeute");
const fokHeuteBilanz  = document.getElementById("fokHeuteBilanz");
const fokObenBox      = document.getElementById("fokOben");
const fokObenKopf     = document.getElementById("fokObenKopf");
const fokObenKoerper  = document.getElementById("fokObenKoerper");
const fokObenBilanz   = document.getElementById("fokObenBilanz");

// Ob die App angemeldet und geladen ist. Bis Oktober 2026 hing hier der
// Fokus-Zugang des Kontos; seit der Fusion bekommt jedes Konto Gewohnheiten.
// Gesetzt beim ersten render() (window.fokusNeuZeichnen).
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
let fokListe = null;        // Antwort von gewohnheiten/heute
let fokLaedt = false;
let fokFehler = "";

// ---------- Anzeige ----------
// Der Schalter "Anzeige" im Reiter Gewohnheiten (app.js). Ohne Antwort von
// dort: an. (Der Schalter im Reiter Timer gehoert zu zeiterfassung.js.)
function fokErlaubt() {
  const b = window.fokusBereiche?.() || { gewohnheiten: true };
  return b.gewohnheiten !== false;
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

// ---------- Laden ----------
async function ladeFokus() {
  if (fokLaedt) return;
  fokLaedt = true;
  const g = await fokApi("gewohnheiten/heute?heute=" + todayStr());
  fokLaedt = false;
  uebernimmListe(g);
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
function fokKnopf(text, klasse, aufruf) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "btn " + klasse;
  k.textContent = text;
  k.onclick = aufruf;
  return k;
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

function zeichneKarte(g) {
  const karte = document.createElement("div");
  karte.className = `fok-gew ${g.zustand}` + (g.typ === "menge" ? " mit-menge" : "");

  const haupt = document.createElement("div");
  haupt.className = "fok-gew-haupt";

  const name = document.createElement("div");
  name.className = "fok-gew-name";
  const nameText = document.createElement("span");
  nameText.textContent = g.name;
  name.append(nameText);
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

// ---------- Zeigen / Verstecken ----------
/**
 * Von kalender.js (zeichneHeuteSpalte) gerufen: `an` heisst, die Heute-Spalte steht
 * da (ab 1380 px, Streifen offen). Ob die Gewohnheiten darin erscheinen, haengt
 * zusaetzlich an der Anmeldung und am Schalter in den Einstellungen. Beim
 * Einschalten wird die Liste frisch geholt.
 */
window.fokusHeute = function (an) {
  const neu = !!an && fokBereit && fokErlaubt();
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
  const neu = !!an && fokBereit && fokErlaubt();
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

// Zurueck in der App ist der wahrscheinlichste Moment, in dem wieder Netz da
// ist - das "online"-Ereignis kommt nicht in jedem Browser zuverlaessig. Und an
// einem anderen Geraet kann inzwischen etwas abgehakt worden sein.
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  if (!fokBereit) return;
  await gewLiefereNach();
  ladeFokus();
});

// Aenderungen von anderswo (Fenster, Dialoge, nachgelieferte Offline-Eintraege,
// Einstellungen): die Liste frisch holen, solange sie zu sehen ist. Verborgen
// genuegt es nicht - beim naechsten Zeigen laedt fokusHeute()/fokusOben() ohnehin neu.
gewBeiAenderung(() => {
  if (fokBereit && (fokHeuteAn || fokObenAn)) ladeListe();
});

/**
 * Aus render() in app.js, wie window.kalenderNeuZeichnen. Der erste Aufruf
 * heisst: angemeldet, Daten da - ab jetzt gibt es Gewohnheiten. Der Anstoss an
 * den Streifen laeuft nicht in eine Schleife: beim naechsten Mal steigt die
 * Funktion oben aus.
 */
window.fokusNeuZeichnen = function () {
  if (fokBereit) return;
  fokBereit = true;
  // Was beim letzten Mal ohne Netz liegen geblieben ist, geht jetzt raus.
  gewLiefereNach();
  ladeFokus();
  window.kalenderNeuZeichnen?.();
};
