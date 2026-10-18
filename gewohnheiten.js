"use strict";

/* ====================================================================
   Gewohnheiten in den Einstellungen – Verlauf, Statistik, Fokuszeit, Verwalten

   Seit Oktober 2026 steht hier, was bis dahin die eigene Fokus-App
   (fokus.it-wolf.org) konnte und der Streifen nicht: der Monatskalender je
   Gewohnheit samt Nachtragen, die Erfuellungsquote, die Fokusminuten pro
   Woche und das Verwalten (anlegen, aendern, ordnen, archivieren, loeschen).

   Bis 18.10.2026 war das ein EIGENES Fenster (Hendriks Entscheidung im
   Oktober, gefragt; verworfen wurden eine eigene Seite - wirkte wie eine
   zweite App - und weitere Reiter im Streifen). Dann wollte er alles direkt in
   den Einstellungen haben: der Reiter "Verlauf & mehr" (Verlauf, Statistik,
   Fokuszeit) und, im Reiter "Gewohnheiten", der Abschnitt "Verwalten". Der
   Streifen bleibt zum schnellen Abhaken, seine Links "Verlauf & mehr ›" und
   "Fokuszeit pro Woche ›" oeffnen die Einstellungen an der passenden Stelle
   (oeffneEinstellungenBei in app.js). Die Ansicht-Pille in der Kopfzeile bleibt
   bei zwei Segmenten (ein drittes hatte er schon einmal verworfen).

   Gezeichnet wird, was gerade offen ist (gewZeichneAktuell): Statistik und
   Fokuszeit holen beim Zeichnen Daten vom Server, der Verlauf braucht den
   Bestand. Die Verwalten-Liste zeichnet sich immer mit - sie kostet nichts.

   Daten und Regeln kommen aus gewohnheiten-daten.js, die Dialoge (Gewohnheit
   anlegen/bearbeiten, Tag nachtragen) aus gewohnheiten-dialoge.js.
   ==================================================================== */

const gewKalRaster = document.getElementById("gewKalRaster");

// Welche Gewohnheit und welcher Monat im Verlauf zu sehen sind. Die Gewohnheit
// faellt beim Zeichnen auf die erste aktive zurueck, wenn sie leer ist oder
// ins Archiv zeigt.
const gewVerlauf = { gewohnheitId: null, monat: "" };
// Zeitraum der Statistik, in Tagen (7/30/90).
let gewStatTage = 30;
// Laedt der Bestand gerade? Dann steht "Lädt …" statt eines leeren Kalenders.
let gewLaedt = false;
let gewLadeFehler = "";

// Ein grauer Hinweis an Stelle des Inhalts - leer, lädt, Fehler.
function gewHinweis(text) {
  const p = document.createElement("p");
  p.className = "ein-hinweis gw-leer";
  p.textContent = text;
  return p;
}

/* ------------------------------------------------------------- Zeichnen */

// Steht der Abschnitt gerade aufgeklappt auf dem Schirm? Nur dann lohnt sich das
// Zeichnen (und die Anfrage ans Netz).
function gewAbschnittOffen(name) {
  if (einstellungenPopup.hidden) return false;
  const d = document.querySelector(`#einstellungenHaupt details[data-abschnitt="${name}"]`);
  return !!d && d.open;
}

function gewZeichneAktuell() {
  // Die Verwalten-Liste steht immer im DOM und wird bei jeder Aenderung
  // mitgezeichnet - auch wenn die Einstellungen zu sind (Dialog aus dem
  // Streifen heraus).
  gewZeichneVerwalten();
  if (gewAbschnittOffen("verlauf")) gewZeichneVerlauf();
  if (gewAbschnittOffen("statistik")) gewZeichneStatistik();
  if (gewAbschnittOffen("fokuszeit")) gewZeichneFokuszeit();
}

// Waehrend des ersten Ladens bzw. nach einem Fehler: statt des Inhalts ein
// Hinweis. Gibt true zurueck, wenn er steht und der Aufrufer aufhoeren soll.
function gewOhneBestand(behaelter) {
  if (gewBestand.geladen) return false;
  behaelter.replaceChildren(gewHinweis(gewLaedt ? "Lädt …" : (gewLadeFehler || "Keine Verbindung.")));
  return true;
}

/* -------------------------------------------------------------- Stift */

// Derselbe Stift, aber gezeichnet statt als Schriftzeichen: das ✎ sah im Verlauf
// klein und fremd zwischen den Pillen aus (Hendrik, 18.10.2026). Er sitzt jetzt
// IN der gewaehlten Pille (siehe gewZeichneKalWahl).
const GEW_STIFT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'
  + '<path d="m15 5 4 4"/></svg>';

// Der Stift an den Zeilen der Verwalten-Liste, gezeichnet wie der in der Pille
// im Verlauf (GEW_STIFT_SVG). Die Karten im Streifen (fokus.js) haben weiter das
// Schriftzeichen ✎ - es ist dieselbe Handlung.
function gewStiftKnopf(g) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "gw-stift";
  k.innerHTML = GEW_STIFT_SVG;
  k.title = "Bearbeiten";
  k.setAttribute("aria-label", `${g.name} bearbeiten`);
  k.onclick = () => gewOeffneDialog(g);
  return k;
}

function gewStiftInPille(g) {
  const k = document.createElement("button");
  k.type = "button";
  k.className = "gw-pille-stift";
  k.innerHTML = GEW_STIFT_SVG;
  k.title = "Bearbeiten";
  k.setAttribute("aria-label", `${g.name} bearbeiten`);
  k.onclick = () => gewOeffneDialog(g);
  return k;
}

/* ------------------------------------------------------------- Verlauf */
/* Ein Monatskalender pro Gewohnheit, umschaltbar ueber die Pillen darueber.
   Nachtragen laeuft ueber die Zellen (gewOeffneTag in gewohnheiten-dialoge.js).
   Eine zweite Blickrichtung ("Nach Tag": ein Tag, alle Gewohnheiten) gab es
   in der Fokus-App einmal - am 11.08.2026 ausprobiert und verworfen, nicht
   wieder einbauen. */

function gewZeichneVerlauf() {
  const wahl = document.getElementById("gewKalWahl");
  const monatText = document.getElementById("gewKalMonat");
  if (gewOhneBestand(gewKalRaster)) {
    wahl.replaceChildren();
    monatText.textContent = "";
    return;
  }

  const aktive = gewBestand.gewohnheiten.filter(g => !g.archiviert);
  if (!aktive.length) {
    gewVerlauf.gewohnheitId = null;
    wahl.replaceChildren();
    monatText.textContent = "";
    document.getElementById("gewKalZurueck").disabled = true;
    document.getElementById("gewKalVor").disabled = true;
    document.getElementById("gewLegendeGeplant").hidden = true;
    document.getElementById("gewLegendeUeberschritten").hidden = true;
    gewKalRaster.replaceChildren(gewHinweis("Noch keine Gewohnheit angelegt – im Reiter „Gewohnheiten“ unter „Verwalten“ geht es los."));
    return;
  }

  if (!gewVerlauf.gewohnheitId || !aktive.some(g => g.id === gewVerlauf.gewohnheitId)) {
    gewVerlauf.gewohnheitId = aktive[0].id;
  }
  if (!gewVerlauf.monat) gewVerlauf.monat = gewBestand.heute.slice(0, 7);

  gewZeichneKalWahl();
  gewZeichneKalender();
}

function gewZeichneKalWahl() {
  const wahl = document.getElementById("gewKalWahl");
  wahl.replaceChildren();
  for (const g of gewBestand.gewohnheiten.filter(x => !x.archiviert)) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = g.name;
    const gewaehlt = g.id === gewVerlauf.gewohnheitId;
    knopf.setAttribute("aria-selected", String(gewaehlt));
    knopf.onclick = () => {
      gewVerlauf.gewohnheitId = g.id;
      gewZeichneKalWahl();
      gewZeichneKalender();
    };
    // Der Stift gehoert zur gewaehlten Gewohnheit und sitzt in ihrer Pille.
    // Hier muss er sein: Gewohnheiten, die heute nicht dran sind, tauchen im
    // Streifen gar nicht auf - ohne diesen Knopf kaeme man an sie nur noch
    // ueber "Verwalten" in den Einstellungen.
    if (gewaehlt) {
      const huelle = document.createElement("span");
      huelle.className = "gw-pille-gewaehlt";
      huelle.append(knopf, gewStiftInPille(g));
      wahl.appendChild(huelle);
    } else {
      wahl.appendChild(knopf);
    }
  }
}

function gewZeichneKalender() {
  const g = gewBestand.gewohnheiten.find(x => x.id === gewVerlauf.gewohnheitId);
  gewKalRaster.replaceChildren();
  if (!g) return;

  const heute = gewBestand.heute;
  document.getElementById("gewKalZurueck").disabled = gewVerlauf.monat <= gewBestand.historieAb.slice(0, 7);
  document.getElementById("gewKalVor").disabled = gewVerlauf.monat >= heute.slice(0, 7);

  // "teilweise" gibt es nur bei Mindestens-Mengen, "ueberschritten" nur bei
  // Obergrenzen - Abhaken kennt keins von beiden (status() in _lib/tag.js).
  const obergrenze = gewIstObergrenze(g);
  document.getElementById("gewLegendeTeilweise").hidden = !(g.typ === "menge" && !obergrenze);
  document.getElementById("gewLegendeUeberschritten").hidden = !obergrenze;

  const [jahr, monat] = gewVerlauf.monat.split("-").map(Number);
  document.getElementById("gewKalMonat").textContent = new Date(Date.UTC(jahr, monat - 1, 1))
    .toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

  for (const name of GEW_WOCHENTAGE) {
    const kopf = document.createElement("div");
    kopf.className = "gw-kal-kopfzelle";
    kopf.textContent = name;
    gewKalRaster.appendChild(kopf);
  }

  let irgendeinNichtGeplant = false;
  for (const d of gewMonatsRaster(gewVerlauf.monat)) {
    if (d.slice(0, 7) !== gewVerlauf.monat) {
      const leer = document.createElement("div");
      leer.className = "gw-zelle leer";
      gewKalRaster.appendChild(leer);
      continue;
    }

    const zukunft = d > heute;
    const geplant = gewIstGeplant(g, d);
    const tag = gewTagVon(g.id, d);
    if (!geplant) irgendeinNichtGeplant = true;
    // Tage, an denen es die Gewohnheit noch gar nicht gab. Sonst saehen sie
    // aus wie verpasste Tage, obwohl die Statistik sie nicht mitzaehlt. Ein
    // nachgetragener Eintrag hebt das auf - der ist echt.
    const vorAnlegen = !tag && !!g.angelegtAm && d < g.angelegtAm;

    const zelle = document.createElement("button");
    zelle.type = "button";
    // gewZustandVon() statt tag.status: bei einer Obergrenze ist auch ein Tag
    // ohne Eintrag gruen.
    zelle.className = "gw-zelle "
      + (!geplant ? "nicht-geplant" : vorAnlegen ? "vor-anlegen" : gewZustandVon(g, d))
      + (d === heute ? " heute" : "")
      + (zukunft ? " zukunft" : "");
    const tagZahl = document.createElement("span");
    tagZahl.className = "gw-zelle-tag";
    tagZahl.textContent = String(Number(d.slice(8, 10)));
    zelle.appendChild(tagZahl);

    // Menge/Ziel direkt in der Zelle - das damalige Ziel, nicht das aktuelle.
    // Nicht in der Zukunft und nicht vor dem Anlegen: dort waere "0/60" keine
    // Aussage, nur eine Null, die nach Versaeumnis aussieht.
    if (geplant && g.typ === "menge" && !zukunft && !vorAnlegen) {
      const menge = document.createElement("span");
      menge.className = "gw-zelle-menge";
      menge.textContent = `${tag ? tag.menge : 0}/${tag ? tag.ziel : g.zielmenge}`;
      zelle.appendChild(menge);
    }

    zelle.title = `${gewWochentagVon(d)}, ${gewFormatDatum(d)}`
      + (!geplant ? " — nicht geplant"
        : vorAnlegen ? " — davor gab es die Gewohnheit noch nicht"
        : tag ? `: ${tag.menge}${g.typ === "menge" ? " / " + tag.ziel + (g.einheit ? " " + g.einheit : "") : ""}`
        : gewStillerTagZaehlt(g, d) ? " — nichts eingetragen, also im Rahmen"
        : "");
    if (gewWartetNoch(g.id, d)) zelle.title += " (noch nicht gespeichert)";

    if (zukunft || !geplant) zelle.disabled = true;
    // Nach einer Wischgeste kommt noch ein click auf der Zelle unter dem
    // Finger - der soll den Tag-Dialog nicht aufreissen.
    else zelle.onclick = () => { if (!gewGewischt) gewOeffneTag(g, d); };

    gewKalRaster.appendChild(zelle);
  }

  document.getElementById("gewLegendeGeplant").hidden = !irgendeinNichtGeplant;
}

/**
 * Einen Monat weiter oder zurueck - der eine Weg fuer Knoepfe und Wischgeste.
 * Die Grenzen stehen hier und nicht nur als `disabled` an den Knoepfen: eine
 * Wischgeste laesst sich nicht deaktivieren.
 */
function gewBlaettereMonat(schritte) {
  const ziel = gewMonatPlus(gewVerlauf.monat, schritte);
  if (ziel > gewBestand.heute.slice(0, 7)) return;
  if (ziel < gewBestand.historieAb.slice(0, 7)) return;
  gewVerlauf.monat = ziel;
  gewZeichneKalender();
}

document.getElementById("gewKalZurueck").onclick = () => gewBlaettereMonat(-1);
document.getElementById("gewKalVor").onclick = () => gewBlaettereMonat(1);

/**
 * Wischen wechselt den Monat - am Handy der natuerliche Griff, die Pfeile
 * sitzen weit weg vom Daumen. Ein Wisch endet mit einem click auf der Zelle,
 * unter der der Finger losgelaufen ist; `gewGewischt` merkt das kurz. Und ein
 * senkrechter Wisch ist Scrollen, kein Blaettern: er muss deutlich waagerechter
 * sein als hoch.
 */
const GEW_WISCH_MINDEST = 50;
let gewWischStart = null;
let gewGewischt = false;

gewKalRaster.addEventListener("touchstart", e => {
  gewWischStart = e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : null;
}, { passive: true });

gewKalRaster.addEventListener("touchend", e => {
  if (!gewWischStart) return;
  const ende = e.changedTouches[0];
  const dx = ende.clientX - gewWischStart.x;
  const dy = ende.clientY - gewWischStart.y;
  gewWischStart = null;
  if (Math.abs(dx) < GEW_WISCH_MINDEST || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  gewGewischt = true;
  setTimeout(() => { gewGewischt = false; }, 400);
  // Nach links wischen heisst vorwaerts, wie beim Blaettern in allem anderen.
  gewBlaettereMonat(dx < 0 ? 1 : -1);
}, { passive: true });

/* ------------------------------------------------------------ Statistik */
// Erfuellungsquote je Gewohnheit ueber ein festes Fenster - anders als die
// Flamme. Gerechnet vom Server (functions/api/gewohnheiten/statistik.js).

let gewStatAnfrage = 0;
async function gewZeichneStatistik() {
  const liste = document.getElementById("gewStatListe");
  for (const b of document.querySelectorAll("#gewStatZeitraum button")) {
    b.setAttribute("aria-selected", String(Number(b.dataset.tage) === gewStatTage));
  }
  if (!liste.children.length) liste.replaceChildren(gewHinweis("Lädt …"));

  // Wer schnell zwischen 7/30/90 wechselt, soll nicht die Antwort einer
  // aelteren Anfrage zu sehen bekommen.
  const nummer = ++gewStatAnfrage;
  const antwort = await gewApi(`/api/gewohnheiten/statistik?heute=${todayStr()}&tage=${gewStatTage}`);
  if (nummer !== gewStatAnfrage) return;

  if (!antwort.ok) {
    liste.replaceChildren(gewHinweis(antwort.status === 0
      ? "Ohne Verbindung gibt es keine Statistik."
      : "Statistik konnte nicht geladen werden."));
    return;
  }
  const eintraege = antwort.daten.gewohnheiten || [];
  if (!eintraege.length) {
    liste.replaceChildren(gewHinweis("Noch keine Gewohnheit für eine Statistik."));
    return;
  }

  liste.replaceChildren();
  for (const g of eintraege) {
    const karte = document.createElement("div");
    karte.className = "gw-karte";
    const name = document.createElement("div");
    name.className = "gw-karte-name";
    name.textContent = g.name;
    const zeile = document.createElement("div");
    zeile.className = "gw-karte-zeile";
    karte.append(name, zeile);

    if (g.geplant === 0) {
      // z. B. "X Mal die Woche" ohne eine einzige volle Woche im Zeitraum -
      // kommt bei "7 Tage" leicht vor.
      zeile.textContent = `Noch keine geplanten ${g.einheit} in diesem Zeitraum`;
      liste.appendChild(karte);
      continue;
    }

    const quote = Math.round((g.erledigt / g.geplant) * 100);
    // Die Einheit gehoert zum Nenner und steht hinter "von", also im Dativ.
    // laufendeWoche: statt einer Quote ueber volle Wochen der Stand der
    // angebrochenen - passiert bei "7 Tage".
    zeile.textContent = `${g.erledigt} von ${gewMitEinheit(g.geplant, g.einheit, true)}`
      + (g.laufendeWoche ? " diese Woche" : "") + ` (${quote} %)`;

    const balken = document.createElement("div");
    balken.className = "gw-balken";
    const fuellung = document.createElement("i");
    fuellung.style.width = `${Math.min(100, quote)}%`;
    fuellung.className = quote >= 80 ? "gut" : quote >= 40 ? "mittel" : "wenig";
    balken.appendChild(fuellung);
    karte.appendChild(balken);

    liste.appendChild(karte);
  }
}

for (const knopf of document.querySelectorAll("#gewStatZeitraum button")) {
  knopf.onclick = () => {
    gewStatTage = Number(knopf.dataset.tage);
    gewZeichneStatistik();
  };
}

/* ------------------------------------------------------------ Fokuszeit */
// Die Wochenstatistik des Timers. Den Timer selbst gibt es nur im Streifen -
// zwei Start-Knoepfe an zwei Orten waeren einer zu viel.

async function gewZeichneFokuszeit() {
  const antwort = await gewApi(`/api/fokus?heute=${todayStr()}`);
  const diagramm = document.getElementById("gewDiagramm");
  const namen = document.getElementById("gewDiagrammNamen");
  const hinweis = document.getElementById("gewFokuszeitHinweis");
  if (!antwort.ok) {
    hinweis.hidden = false;
    hinweis.textContent = antwort.status === 0
      ? "Ohne Verbindung gibt es keine Wochenstatistik."
      : "Die Wochenstatistik konnte nicht geladen werden.";
    return;
  }
  hinweis.hidden = true;
  const d = antwort.daten;
  document.getElementById("gewMinHeute").textContent = d.heuteMin;
  document.getElementById("gewMinWoche").textContent = d.dieseWoche;
  document.getElementById("gewMinSchnitt").textContent = d.schnitt;

  diagramm.replaceChildren();
  namen.replaceChildren();
  const hoechst = Math.max(1, ...d.wochen.map(w => w.minuten));
  d.wochen.forEach((w, i) => {
    const spalte = document.createElement("div");
    spalte.className = "gw-diagramm-spalte" + (i === d.wochen.length - 1 ? " jetzt" : "");
    const wert = document.createElement("div");
    wert.className = "gw-diagramm-wert";
    wert.textContent = w.minuten || "";
    const saeule = document.createElement("div");
    saeule.className = "gw-diagramm-saeule";
    // Prozent der hoechsten Woche, nicht absolut: sonst waere bei einer
    // ruhigen Woche gar nichts zu sehen.
    saeule.style.height = `${Math.round(w.minuten / hoechst * 100)}%`;
    saeule.title = `Woche ab ${gewFormatDatum(w.start)}: ${w.minuten} Min.`;
    spalte.append(wert, saeule);
    diagramm.appendChild(spalte);

    const beschriftung = document.createElement("span");
    beschriftung.textContent = w.start.slice(8) + "." + w.start.slice(5, 7) + ".";
    namen.appendChild(beschriftung);
  });
}

/* ------------------------------------------------------------ Verwalten */
/* Reihenfolge, Bearbeiten und Archiv an einem Ort: dem Abschnitt "Verwalten" in
   den Einstellungen (Reiter "Gewohnheiten"). Zwischen Oktober und dem
   18.10.2026 war das ein Reiter im Fenster, weil die Einstellungen "schon voll
   genug" waren - seit sie Reiter haben, wollte Hendrik es direkt dort.
   Hoch/Runter statt Ziehen: Ziehen braucht am Handy eigene Pointer-Behandlung
   und kollidiert mit dem Scrollen - zwei Pfeile treffen immer. */

function gewZeichneVerwalten() {
  const liste = document.getElementById("gewVerwaltenListe");
  const archiv = document.getElementById("gewArchivListe");
  if (gewOhneBestand(liste)) { archiv.replaceChildren(); return; }

  const aktive = gewBestand.gewohnheiten.filter(g => !g.archiviert);
  const archiviert = gewBestand.gewohnheiten.filter(g => g.archiviert);
  gewZeichneEinstellungsSubtexte();

  liste.replaceChildren();
  if (!aktive.length) liste.appendChild(gewHinweis("Noch keine Gewohnheit. Leg deine erste an – zum Abhaken oder mit Zielmenge."));
  aktive.forEach((g, i) => {
    const zeile = document.createElement("div");
    zeile.className = "gw-zeile";
    const name = document.createElement("span");
    name.className = "gw-zeile-name";
    name.textContent = g.name;
    zeile.append(name, gewStiftKnopf(g));
    for (const [richtung, zeichen, titel] of [[-1, "↑", "nach oben"], [1, "↓", "nach unten"]]) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "btn klein gw-pfeil-klein";
      knopf.textContent = zeichen;
      knopf.title = `${g.name} ${titel}`;
      knopf.setAttribute("aria-label", `${g.name} ${titel}`);
      knopf.disabled = richtung < 0 ? i === 0 : i === aktive.length - 1;
      knopf.onclick = () => gewVerschiebe(i, i + richtung);
      zeile.appendChild(knopf);
    }
    liste.appendChild(zeile);
  });

  archiv.replaceChildren();
  document.getElementById("gewArchivLeer").hidden = archiviert.length > 0;
  for (const g of archiviert) {
    const zeile = document.createElement("div");
    zeile.className = "gw-zeile";
    const name = document.createElement("span");
    name.className = "gw-zeile-name";
    name.textContent = g.name;
    zeile.appendChild(name);

    const zurueck = document.createElement("button");
    zurueck.type = "button";
    zurueck.className = "btn klein";
    zurueck.textContent = "Zurückholen";
    zurueck.onclick = () => gewArchivieren(g, false);
    zeile.appendChild(zurueck);

    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "btn klein gefahr";
    weg.textContent = "Löschen";
    weg.onclick = () => gewLoeschen(g);
    zeile.appendChild(weg);

    archiv.appendChild(zeile);
  }
}

/**
 * Die neue Reihenfolge zum Server schicken - immer die vollstaendige Liste
 * (siehe functions/api/gewohnheiten/reihenfolge.js). Immer nur eine Anfrage
 * unterwegs; waehrenddessen wird nur der zuletzt gewuenschte Stand gemerkt,
 * damit sich viermal schnelles Tippen nicht in falscher Reihenfolge ueberholt.
 */
let gewSortiertGerade = false;
let gewSortierNachtrag = null;
async function gewSendeReihenfolge(ids) {
  if (gewSortiertGerade) { gewSortierNachtrag = ids; return; }
  gewSortiertGerade = true;
  const antwort = await gewApi("/api/gewohnheiten/reihenfolge", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  gewSortiertGerade = false;

  if (!antwort.ok) {
    // Der Server hat sie nicht uebernommen - dann darf sie auf dem Schirm
    // auch nicht stehenbleiben.
    gewSortierNachtrag = null;
    snackInfo(antwort.daten.error || "Sortieren fehlgeschlagen.");
    await gewLadeBestand();
    gewZeichneAktuell();
    gewMeldeAenderung("bestand");
    return;
  }
  if (gewSortierNachtrag) {
    const naechste = gewSortierNachtrag;
    gewSortierNachtrag = null;
    await gewSendeReihenfolge(naechste);
    return;
  }
  // Erst wenn alles durch ist: der Streifen holt sich die neue Reihenfolge.
  gewMeldeAenderung("bestand");
}

// Die Liste springt sofort um, ohne auf den Server zu warten. Die archivierten
// haengen hinten dran, damit die Positionen lueckenlos bleiben, falls eine
// davon spaeter zurueckgeholt wird.
function gewVerschiebe(von, nach) {
  const aktive = gewBestand.gewohnheiten.filter(g => !g.archiviert);
  if (nach < 0 || nach >= aktive.length) return;
  [aktive[von], aktive[nach]] = [aktive[nach], aktive[von]];
  gewBestand.gewohnheiten = [...aktive, ...gewBestand.gewohnheiten.filter(g => g.archiviert)];
  gewZeichneVerwalten();
  gewSendeReihenfolge(gewBestand.gewohnheiten.map(g => g.id));
}

async function gewArchivieren(g, archivieren) {
  const antwort = await gewApi("/api/gewohnheiten", {
    method: "PATCH",
    body: JSON.stringify({ id: g.id, archiviert: archivieren }),
  });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Hat nicht geklappt."); return false; }
  await gewLadeBestand();
  gewZeichneAktuell();
  gewMeldeAenderung("bestand");
  snackInfo(archivieren ? "Archiviert — unter „Verwalten“ wieder zu holen" : "Wieder aktiv");
  return true;
}

async function gewLoeschen(g) {
  // Die Zahl der Tage gehoert in die Rueckfrage: sie ist das, was tatsaechlich
  // verloren geht - der Name allein sagt nichts darueber.
  const tage = Object.keys(gewBestand.logs[g.id] || {}).length;
  const ok = await bestaetigen({
    titel: "Endgültig löschen?",
    text: `„${g.name}“ und alle eingetragenen Tage werden gelöscht.`
      + (tage ? ` Allein in den letzten zwei Jahren ${tage === 1 ? "ist das 1 Tag" : `sind das ${tage} Tage`}.` : "")
      + " Das lässt sich nicht rückgängig machen.",
  });
  if (!ok) return;
  const antwort = await gewApi("/api/gewohnheiten", {
    method: "DELETE",
    body: JSON.stringify({ id: g.id }),
  });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Löschen fehlgeschlagen."); return; }
  await gewLadeBestand();
  gewZeichneAktuell();
  gewMeldeAenderung("bestand");
  snackInfo("Gelöscht");
}

/* ----------------------------------------------------------- Verdrahtung */

// Verlauf, Statistik und Fokuszeit werden erst gezeichnet, wenn ihr Abschnitt
// aufgeklappt wird; danach bei jeder Aenderung, solange er offen ist.
for (const name of ["verlauf", "statistik", "fokuszeit"]) {
  document.querySelector(`#einstellungenHaupt details[data-abschnitt="${name}"]`)
    .addEventListener("toggle", e => { if (e.target.open) gewZeichneAktuell(); });
}
document.getElementById("gewNeuKnopf").addEventListener("click", () => gewOeffneDialog(null));

/**
 * Schliesst die oberste offene Ebene der Gewohnheiten und sagt, ob es eine
 * gab: erst den Tag-Dialog, dann den Bearbeiten-Dialog. Die Einstellungen
 * darunter schliessen Escape (app.js) und die Zurueck-Taste (kalender.js).
 * Escape (unten) und die Zurueck-Taste am Handy (schliesseObersteEbene in
 * kalender.js) arbeiten sich damit von innen nach aussen.
 */
function gewSchliesseOberste() {
  for (const id of ["gewTagDialog", "gewDialog"]) {
    const el = document.getElementById(id);
    if (!el.hidden) { el.hidden = true; return true; }
  }
  return false;
}

// In der Einfangphase und mit stopImmediatePropagation: sonst schloessen die
// Escape-Handler in app.js und kalender.js im selben Tastendruck noch den
// Kalender-Streifen dahinter. Steht eine Rueckfrage (bestaetigen()) offen, hat
// die Vorrang - sie faengt Escape selbst ab.
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (document.querySelector(".eingabe-popup")) return;
  if (gewSchliesseOberste()) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

window.gewSchliesseOberste = gewSchliesseOberste;

/**
 * Aenderungen von anderswo. "tag" und "bestand" kommen mit frischem Bestand
 * (gewSchreibeTag bzw. die Dialoge haben ihn schon nachgezogen) - neu zeichnen
 * reicht. Nachgelieferte Offline-Eintraege und eine andere Zaehlweise der
 * Flamme brauchen den Bestand frisch vom Server.
 */
gewBeiAenderung(async was => {
  if (einstellungenPopup.hidden) return;
  if (was === "timer") {
    if (gewAbschnittOffen("fokuszeit")) gewZeichneFokuszeit();
    return;
  }
  if (was === "nachgeliefert" || was === "einstellungen") await gewLadeBestand();
  gewZeichneAktuell();
});
