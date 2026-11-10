"use strict";

/* ====================================================================
   Fenster "Gewohnheiten" – Verlauf, Statistik

   Seit Oktober 2026 steht hier, was bis dahin die eigene Fokus-App
   (fokus.it-wolf.org) konnte und der Streifen nicht: der Monatskalender je
   Gewohnheit samt Nachtragen und die Erfuellungsquote. (Die Fokusminuten pro
   Woche standen bis 18.10.2026 auch hier; seitdem ist der Timer eine
   Zeiterfassung mit eigener Statistik, siehe zeiterfassung.js.) Das Verwalten (anlegen, aendern, ordnen, archivieren, loeschen) war
   bis 18.10.2026 ein vierter Reiter hier; es steht jetzt als Abschnitt
   "Verwalten" direkt in den Einstellungen (Reiter "Gewohnheiten"), wird aber
   weiter in dieser Datei gezeichnet (gewZeichneVerwalten).

   Hendriks Entscheidung (gefragt): ein EIGENES Fenster, geoeffnet nur noch aus
   den Einstellungen (Eintrag "Verlauf & mehr" im Reiter "Gewohnheiten"; die
   Links bei den Gewohnheiten und beim Timer gibt es seit 18.10.2026 nicht mehr).
   Abhaken steht in fokus.js, und die Ansicht-Pille in der
   Kopfzeile bleibt bei zwei Segmenten (ein drittes hatte er schon einmal
   verworfen). Verworfen wurden eine eigene Seite (wirkte wie eine zweite App)
   und weitere Reiter im Streifen (dort fehlte der Platz; seit 18.10.2026 gibt
   es im Streifen gar keine Reiter mehr).

   Daten und Regeln kommen aus gewohnheiten-daten.js, die Dialoge (Gewohnheit
   anlegen/bearbeiten, Tag nachtragen) aus gewohnheiten-dialoge.js.

   Das Fenster steht in index.html AUSSERHALB des Kalender-Panels - dasselbe
   transform-Problem wie bei den Kalender-Dialogen (position:fixed richtete
   sich sonst am Panel aus).
   ==================================================================== */

const gewFenster = document.getElementById("gewFenster");
const gewAnsichten = {
  verlauf: document.getElementById("gewVerlauf"),
  statistik: document.getElementById("gewStatistik"),
};
// Die Fokuszeit war bis 18.10.2026 der dritte Reiter hier, dann kurz ein
// eigenes Fenster; seitdem gibt es stattdessen die Statistik der Zeiterfassung
// (zeiterfassung.js).
// Die Kalender aller Gewohnheiten, untereinander (seit 10.11.2026).
const gewKalListe = document.getElementById("gewKalListe");

let gewReiter = "verlauf";
// Welcher Monat im Verlauf zu sehen ist (gilt fuer alle Kalender), und zu
// welcher Gewohnheit das Fenster beim Oeffnen springen soll (Tipp auf ihren
// Namen unter "heute"; null = oben bleiben).
const gewVerlauf = { monat: "", springeZu: null };
// Zeitraum der Statistik, in Tagen (7/30/90).
let gewStatTage = 30;
// Laedt der Bestand gerade? Dann steht "Lädt …" statt eines leeren Kalenders.
let gewLaedt = false;
let gewLadeFehler = "";

function gewIstOffen() { return !gewFenster.hidden; }

// Ein grauer Hinweis an Stelle des Inhalts - leer, lädt, Fehler.
function gewHinweis(text) {
  const p = document.createElement("p");
  p.className = "ein-hinweis gw-leer";
  p.textContent = text;
  return p;
}

/* -------------------------------------------------------------- Oeffnen */

/**
 * Das Fenster oeffnen, mit dem genannten Reiter vorn. Jedes Oeffnen holt den
 * Bestand frisch - der Streifen hat inzwischen vielleicht abgehakt, und ein
 * Tag kann gewechselt haben.
 */
async function gewFensterOeffnen(reiter = "verlauf", gewohnheitId = null) {
  // Aus den Einstellungen heraus: die schliessen, sonst laegen zwei
  // Vollbilder uebereinander und Escape muesste zweimal.
  if (!einstellungenPopup.hidden) einstellungenPopup.hidden = true;
  gewVerlauf.springeZu = gewohnheitId;
  // Jedes Oeffnen beginnt beim aktuellen Monat.
  gewVerlauf.monat = "";
  gewFenster.hidden = false;
  gewLaedt = !gewBestand.geladen;
  gewLadeFehler = "";
  gewZeigeReiter(reiter);

  const r = await gewLadeBestand();
  gewLaedt = false;
  gewLadeFehler = r.ok ? "" : r.fehler;
  if (r.offline) snackInfo("Offline — letzter bekannter Stand");
  if (gewIstOffen()) gewZeichneAktuell();
  // Gesprungen wird nur beim Oeffnen, nicht bei jedem spaeteren Neuzeichnen.
  gewVerlauf.springeZu = null;
}

function gewFensterSchliessen() {
  gewFenster.hidden = true;
}

function gewZeigeReiter(name) {
  gewReiter = gewAnsichten[name] ? name : "verlauf";
  for (const [k, el] of Object.entries(gewAnsichten)) el.hidden = k !== gewReiter;
  for (const seg of gewFenster.querySelectorAll(".ein-reiter-seg")) {
    seg.setAttribute("aria-selected", String(seg.dataset.gwReiter === gewReiter));
  }
  // Fuer das CSS: unter dem vorderen Reiter ist die Ecke des Rahmens eckig.
  gewFenster.dataset.reiter = gewReiter;
  // Jeder Reiter beginnt oben - sonst stuende die Statistik halb gescrollt da,
  // weil man im Verlauf nach unten gewischt hatte.
  gewFenster.querySelector(".gw-blaettern").scrollTop = 0;
  gewZeichneAktuell();
}

function gewZeichneAktuell() {
  // Die Verwalten-Liste steht in den Einstellungen, immer im DOM - sie wird bei
  // jeder Aenderung mitgezeichnet, auch wenn das Fenster zu ist.
  gewZeichneVerwalten();
  if (!gewIstOffen()) return;
  if (gewReiter === "statistik") gewZeichneStatistik();
  else gewZeichneVerlauf();
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
// klein und fremd aus (Hendrik, 18.10.2026). Er steht seit 10.11.2026 im Kopf
// jedes Kalenders (gewZeichneBlock), davor sass er in der gewaehlten Pille.
const GEW_STIFT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'
  + '<path d="m15 5 4 4"/></svg>';

// Der Stift an den Zeilen der Verwalten-Liste und im Kopf jedes Kalenders im
// Verlauf. Die Karten im Streifen (fokus.js) haben keinen: dort oeffnet ein Tipp
// auf den Namen den Verlauf.
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

/* ------------------------------------------------------------- Verlauf */
/* Seit 10.11.2026 ALLE Gewohnheiten auf einmal: je ein Monatskalender,
   untereinander, ein gemeinsamer Monat oben (Pfeile und Wischen blaettern alle
   zugleich). Bis dahin war es ein Kalender, umschaltbar ueber Pillen - Hendrik:
   "alle Gewohnheiten auf einmal sehen, oben umschalten finde ich nicht gut".
   Gewaehlt unter zwei Skizzen, die andere war eine Wochen-Tabelle (Gewohnheiten
   als Zeilen, sieben Tage als Spalten).
   Nachtragen laeuft ueber die Zellen: Abhaken schaltet direkt um
   (gewSchalteTag), Mengen oeffnen gewOeffneTag in gewohnheiten-dialoge.js.
   Eine Blickrichtung "Nach Tag" (ein Tag, alle Gewohnheiten) gab es in der
   Fokus-App einmal - am 11.08.2026 ausprobiert und verworfen, nicht wieder
   einbauen. */

function gewZeichneVerlauf() {
  const monatText = document.getElementById("gewKalMonat");
  const zurueck = document.getElementById("gewKalZurueck");
  const vor = document.getElementById("gewKalVor");
  if (gewOhneBestand(gewKalListe)) {
    monatText.textContent = "";
    return;
  }

  const aktive = gewBestand.gewohnheiten.filter(g => !g.archiviert);
  if (!gewVerlauf.monat) gewVerlauf.monat = gewBestand.heute.slice(0, 7);

  const [jahr, monat] = gewVerlauf.monat.split("-").map(Number);
  monatText.textContent = aktive.length
    ? new Date(Date.UTC(jahr, monat - 1, 1))
      .toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
    : "";
  zurueck.disabled = !aktive.length || gewVerlauf.monat <= gewBestand.historieAb.slice(0, 7);
  vor.disabled = !aktive.length || gewVerlauf.monat >= gewBestand.heute.slice(0, 7);

  if (!aktive.length) {
    for (const id of ["gewLegendeTeilweise", "gewLegendeUeberschritten", "gewLegendeGeplant"]) {
      document.getElementById(id).hidden = true;
    }
    gewKalListe.replaceChildren(gewHinweis("Noch keine Gewohnheit angelegt – in den Einstellungen unter „Gewohnheiten“ geht es los."));
    return;
  }

  let nichtGeplant = false;
  const bloecke = aktive.map(g => {
    const block = gewZeichneBlock(g);
    if (block.dataset.nichtGeplant) nichtGeplant = true;
    return block;
  });
  gewKalListe.replaceChildren(...bloecke);

  // Die Legende zeigt, was in IRGENDEINEM der Kalender vorkommen kann:
  // "teilweise" nur bei Mindestens-Mengen, "ueberschritten" nur bei Obergrenzen
  // (status() in _lib/tag.js), "nicht geplant" nur, wenn es den Tag im Monat gibt.
  const mitMenge = aktive.filter(g => g.typ === "menge");
  document.getElementById("gewLegendeTeilweise").hidden = !mitMenge.some(g => !gewIstObergrenze(g));
  document.getElementById("gewLegendeUeberschritten").hidden = !mitMenge.some(g => gewIstObergrenze(g));
  document.getElementById("gewLegendeGeplant").hidden = !nichtGeplant;
  document.getElementById("gewKalHinweis").textContent = mitMenge.length
    ? "Ein Tipp auf einen Tag hakt ihn ab oder öffnet ihn wieder, bei Mengen trägst du die Zahl ein. Wischen wechselt den Monat."
    : "Ein Tipp auf einen Tag hakt ihn ab oder öffnet ihn wieder. Wischen wechselt den Monat.";

  // Aus der Liste unter "heute" geoeffnet: zu genau dieser Gewohnheit springen.
  // Nur beim Oeffnen (gewFensterOeffnen loescht das Ziel danach) - ein Neuzeichnen
  // nach dem Abhaken soll nicht wegspringen.
  if (gewVerlauf.springeZu) gewSpringeZuBlock(gewVerlauf.springeZu);
}

/** Ein Kalender: Kopf mit Name, Flamme und Stift, darunter das Raster. */
function gewZeichneBlock(g) {
  const block = document.createElement("section");
  block.className = "gw-kal-block";
  block.dataset.id = g.id;
  block.setAttribute("aria-label", g.name);

  const kopf = document.createElement("div");
  kopf.className = "gw-kal-block-kopf";
  const name = document.createElement("span");
  name.className = "gw-kal-block-name";
  name.textContent = g.name;
  kopf.appendChild(name);
  const flamme = gewBestand.straehnen[g.id] || 0;
  if (flamme > 0) {
    const f = document.createElement("span");
    f.className = "gw-kal-block-flamme";
    f.textContent = `🔥 ${gewMitEinheit(flamme, gewFlammenEinheitVon(g))}`;
    kopf.appendChild(f);
  }
  kopf.appendChild(gewStiftKnopf(g));
  block.appendChild(kopf);

  const raster = document.createElement("div");
  raster.className = "gw-kal-raster";
  for (const name of GEW_WOCHENTAGE) {
    const kopfzelle = document.createElement("div");
    kopfzelle.className = "gw-kal-kopfzelle";
    kopfzelle.textContent = name;
    raster.appendChild(kopfzelle);
  }

  const heute = gewBestand.heute;
  for (const d of gewMonatsRaster(gewVerlauf.monat)) {
    if (d.slice(0, 7) !== gewVerlauf.monat) {
      const leer = document.createElement("div");
      leer.className = "gw-zelle leer";
      raster.appendChild(leer);
      continue;
    }

    const zukunft = d > heute;
    const geplant = gewIstGeplant(g, d);
    const tag = gewTagVon(g.id, d);
    if (!geplant) block.dataset.nichtGeplant = "1";
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

    zelle.title = `${g.name}, ${gewWochentagVon(d)}, ${gewFormatDatum(d)}`
      + (!geplant ? " — nicht geplant"
        : vorAnlegen ? " — davor gab es die Gewohnheit noch nicht"
        : tag ? `: ${tag.menge}${g.typ === "menge" ? " / " + tag.ziel + (g.einheit ? " " + g.einheit : "") : ""}`
        : gewStillerTagZaehlt(g, d) ? " — nichts eingetragen, also im Rahmen"
        : "");
    if (gewWartetNoch(g.id, d)) zelle.title += " (noch nicht gespeichert)";

    if (zukunft || !geplant) zelle.disabled = true;
    // Nach einer Wischgeste kommt noch ein click auf der Zelle unter dem
    // Finger - der soll weder umschalten noch den Tag-Dialog aufreissen.
    // Abhaken schaltet direkt um (gewSchalteTag), Mengen brauchen eine Zahl
    // und behalten den Dialog.
    else zelle.onclick = () => {
      if (gewGewischt) return;
      if (g.typ === "menge") gewOeffneTag(g, d);
      else gewSchalteTag(g, d, zelle);
    };

    raster.appendChild(zelle);
  }
  block.appendChild(raster);
  return block;
}

/**
 * Den Kalender einer Gewohnheit oben in den blaetternden Kasten holen, knapp
 * unter den klebenden Monatskopf. Von Hand gerechnet statt scrollIntoView:
 * das schoebe auch Vorfahren mit, und der Monatskopf wuerde ihn verdecken.
 */
function gewSpringeZuBlock(id) {
  const block = [...gewKalListe.children].find(b => b.dataset.id === id);
  if (!block) return;
  const kasten = gewFenster.querySelector(".gw-blaettern");
  const kopf = gewFenster.querySelector(".gw-kal-kopf");
  const abstand = block.getBoundingClientRect().top - kasten.getBoundingClientRect().top;
  kasten.scrollTop += abstand - kopf.offsetHeight - 16;
}

/**
 * Abhak-Gewohnheiten: ein Tipp auf einen Tag schaltet ihn direkt um, offen <->
 * erledigt, ohne den Dialog "Tag nachtragen". Hendrik am 10.11.2026 - vorher
 * waren es drei Tipps (Tag, Erledigt, Speichern). Gegen einen Fehlgriff steht
 * "Rueckgaengig" in der Leiste, wie beim Abhaken unter "heute".
 *
 * Ein zweiter Tipp auf denselben Tag, solange der erste noch beim Server ist,
 * wird verschluckt: beide laesen sonst denselben alten Stand und schrieben
 * dasselbe. Die Zelle wird so lange blass (`.schaltet`); gezeichnet wird sie
 * danach ohnehin neu (gewMeldeAenderung in gewSchreibeTag).
 */
const gewSchaltetGerade = new Set();

async function gewSchalteTag(g, datum, zelle) {
  const schluessel = `${g.id}|${datum}`;
  if (gewSchaltetGerade.has(schluessel)) return;
  gewSchaltetGerade.add(schluessel);
  zelle?.classList.add("schaltet");
  try {
    const tag = gewTagVon(g.id, datum);
    const vorher = tag && tag.menge >= 1 ? 1 : 0;
    const neu = vorher ? 0 : 1;
    const flammeVorher = gewBestand.straehnen[g.id] || 0;
    const r = await gewSchreibeTag(g, datum, neu);
    if (!r.ok) { zelle?.classList.remove("schaltet"); return; }

    let text = `${gewFormatDatum(datum).slice(0, 6)} ${neu ? "erledigt" : "wieder offen"}`;
    // Ohne Netz hat gewSchreibeTag schon "gemerkt" gemeldet - die Leiste hier
    // ersetzt das, also muss es mit hinein.
    if (r.offline) text += " – ohne Verbindung gemerkt";
    else if (neu && datum !== gewBestand.heute && r.straehne > flammeVorher) {
      // Kurz wie auf der Karte: am Handy passt die Leiste so in eine Zeile.
      text += ` – 🔥 ${gewMitEinheit(r.straehne, gewFlammenEinheitVon(g))}`;
    }
    showUndo(text, () => gewSchreibeTag(g, datum, vorher));
  } finally {
    gewSchaltetGerade.delete(schluessel);
  }
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
  gewZeichneVerlauf();
}

document.getElementById("gewKalZurueck").onclick = () => gewBlaettereMonat(-1);
document.getElementById("gewKalVor").onclick = () => gewBlaettereMonat(1);

/**
 * Wischen wechselt den Monat - am Handy der natuerliche Griff, die Pfeile
 * sitzen weit weg vom Daumen. Ein Wisch endet mit einem click auf der Zelle,
 * unter der der Finger losgelaufen ist; `gewGewischt` merkt das kurz. Und ein
 * senkrechter Wisch ist Scrollen, kein Blaettern: er muss deutlich waagerechter
 * sein als hoch. Seit alle Gewohnheiten untereinander stehen, horcht die ganze
 * Liste: ein Wisch auf irgendeinem Kalender blaettert alle.
 */
const GEW_WISCH_MINDEST = 50;
let gewWischStart = null;
let gewGewischt = false;

gewKalListe.addEventListener("touchstart", e => {
  gewWischStart = e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : null;
}, { passive: true });

gewKalListe.addEventListener("touchend", e => {
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
  snackInfo(archivieren ? "Archiviert — in den Einstellungen unter „Verwalten“ wieder zu holen" : "Wieder aktiv");
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

for (const seg of gewFenster.querySelectorAll(".ein-reiter-seg")) {
  seg.addEventListener("click", () => gewZeigeReiter(seg.dataset.gwReiter));
}
document.getElementById("gewFensterZu").addEventListener("click", gewFensterSchliessen);
// Klick neben den Kasten schliesst, wie bei den Einstellungen. Am Handy fuellt
// das Fenster den Bildschirm, dort bleibt das ✕.
gewFenster.addEventListener("click", e => { if (e.target === gewFenster) gewFensterSchliessen(); });
document.getElementById("gewNeuKnopf").addEventListener("click", () => gewOeffneDialog(null));

/**
 * Schliesst die oberste offene Ebene der Gewohnheiten und sagt, ob es eine
 * gab: erst den Tag-Dialog, dann den Bearbeiten-Dialog, dann das Fenster.
 * Escape (unten) und die Zurueck-Taste am Handy (schliesseObersteEbene in
 * kalender.js) arbeiten sich damit von innen nach aussen.
 */
function gewSchliesseOberste() {
  for (const id of ["gewTagDialog", "gewDialog"]) {
    const el = document.getElementById(id);
    if (!el.hidden) { el.hidden = true; return true; }
  }
  if (gewIstOffen()) { gewFensterSchliessen(); return true; }
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

// Fuer kalender.js (keine Rand-Wischgeste, solange ein Fenster offen ist).
// Eigener Name, NICHT window.gewIstOffen: eine Funktionsdeklaration auf oberster
// Ebene IST window.gewIstOffen - die zu ueberschreiben liess gewIstOffen() sich
// selbst endlos aufrufen (beim Bau des Fokuszeit-Fensters passiert).
window.gewEinFensterOffen = () => gewIstOffen();
window.gewSchliesseOberste = gewSchliesseOberste;
window.gewFensterOeffnen = gewFensterOeffnen;

/**
 * Aenderungen von anderswo. "tag" und "bestand" kommen mit frischem Bestand
 * (gewSchreibeTag bzw. die Dialoge haben ihn schon nachgezogen) - neu zeichnen
 * reicht. Nachgelieferte Offline-Eintraege und eine andere Zaehlweise der
 * Flamme brauchen den Bestand frisch vom Server.
 */
gewBeiAenderung(async was => {
  // Das Fenster ODER die Einstellungen (mit der Gewohnheiten-Liste) offen?
  const einstellungenOffen = !einstellungenPopup.hidden;
  if (!gewIstOffen() && !einstellungenOffen) return;
  if (was === "nachgeliefert" || was === "einstellungen") await gewLadeBestand();
  gewZeichneAktuell();
});
