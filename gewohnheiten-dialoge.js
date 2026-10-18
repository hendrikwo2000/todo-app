"use strict";

/* ====================================================================
   Gewohnheiten – Dialoge und Einstellungen

   - "Neue Gewohnheit" / "Gewohnheit bearbeiten" (#gewDialog)
   - "Tag nachtragen" aus dem Verlauf (#gewTagDialog)
   - der Reiter "Gewohnheiten" in den Einstellungen (Timer, Flamme)

   Uebernommen aus der Fokus-App (Oktober 2026), mit denselben Regeln: die
   Art (Abhaken/Menge) und die Ziel-Art (Mindestens/Hoechstens) lassen sich
   nur wechseln, solange kein Tag erfasst ist; der Rhythmus jederzeit. Der
   Server prueft beides verbindlich, hier ist es nur die Anzeige.

   Geoeffnet werden die Dialoge aus dem Fenster (gewohnheiten.js) und aus dem
   Streifen (fokus.js: Stift an der Karte, "Gewohnheit anlegen").
   ==================================================================== */

const gewDialog = document.getElementById("gewDialog");
const gewTagDialog = document.getElementById("gewTagDialog");

let gewBearbeitet = null;
let gewTypWahl = "binaer";
let gewRichtungWahl = "mindestens";
let gewRhythmusWahl = "taeglich";
let gewWochentageWahl = new Set();   // Indizes 0 = Mo .. 6 = So

function gewFeld(id) { return document.getElementById(id); }

/* ------------------------------------------------- Anlegen / Bearbeiten */

function gewSetzeTypWahl(typ) {
  gewTypWahl = typ;
  for (const knopf of gewFeld("gewTyp").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.typ === typ));
  }
  gewFeld("gewZielFeld").hidden = typ !== "menge";
  gewFeld("gewRichtungFeld").hidden = typ !== "menge";
}

function gewSetzeRichtungWahl(richtung) {
  gewRichtungWahl = richtung;
  for (const knopf of gewFeld("gewRichtung").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.richtung === richtung));
  }
  // 0 ist nur als Obergrenze sinnvoll ("gar keine Zigarette") - als Soll waere
  // es immer erfuellt. Der Server prueft dasselbe nochmal.
  const obergrenze = richtung === "hoechstens";
  gewFeld("gewZiel").min = obergrenze ? "0" : "1";
  gewFeld("gewZielLabel").textContent = obergrenze ? "Höchstens pro Tag" : "Ziel pro Tag";
  if (!obergrenze && Number(gewFeld("gewZiel").value) < 1) gewFeld("gewZiel").value = "1";
}

function gewSetzeRhythmusWahl(rhythmus) {
  gewRhythmusWahl = rhythmus;
  for (const knopf of gewFeld("gewRhythmus").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.rhythmus === rhythmus));
  }
  gewFeld("gewWochentageFeld").hidden = rhythmus !== "wochentage";
  gewFeld("gewWochenzielFeld").hidden = rhythmus !== "x_pro_woche";
}

function gewSetzeWochentag(index, gewaehlt) {
  if (gewaehlt) gewWochentageWahl.add(index);
  else gewWochentageWahl.delete(index);
  const knopf = gewFeld("gewWochentage").querySelector(`button[data-tag="${index}"]`);
  if (knopf) knopf.setAttribute("aria-pressed", String(gewWochentageWahl.has(index)));
}

/**
 * Den Dialog oeffnen - leer zum Anlegen (g = null) oder mit einer Gewohnheit
 * aus dem Bestand zum Bearbeiten.
 */
function gewOeffneDialog(g) {
  gewBearbeitet = g || null;
  gewFeld("gewDialogTitel").textContent = g ? "Gewohnheit bearbeiten" : "Neue Gewohnheit";
  gewFeld("gewDialogIcon").textContent = g ? "✏️" : "✨";
  gewFeld("gewName").value = g ? g.name : "";
  // != null, nicht truthy: bei einer Obergrenze ist 0 eine gueltige Zielmenge
  // und wuerde sonst beim Bearbeiten kommentarlos auf 30 springen.
  gewFeld("gewZiel").value = g && g.zielmenge != null ? g.zielmenge : 30;
  gewFeld("gewEinheit").value = (g && g.einheit) || "";
  gewFeld("gewDialogMsg").textContent = "";
  gewFeld("gewArchivieren").hidden = !g;
  gewSetzeTypWahl(g ? g.typ : "binaer");

  // Art und Ziel-Art nur ohne erfassten Tag wechselbar - sonst liesse sich die
  // Historie nicht mehr eindeutig deuten (aus jedem Haekchen wuerde "Menge 1",
  // aus einem gruenen Tag ein roter).
  const hatHistorie = !!(g && gewBestand.logs[g.id] && Object.keys(gewBestand.logs[g.id]).length);
  for (const knopf of gewFeld("gewTyp").querySelectorAll("button")) knopf.disabled = hatHistorie;
  gewFeld("gewTypHinweis").hidden = !hatHistorie;
  gewSetzeRichtungWahl((g && g.richtung) || "mindestens");
  for (const knopf of gewFeld("gewRichtung").querySelectorAll("button")) knopf.disabled = hatHistorie;
  gewFeld("gewRichtungHinweis").hidden = !hatHistorie;

  gewWochentageWahl = new Set();
  const maske = (g && g.wochentageMaske) || 0;
  for (const knopf of gewFeld("gewWochentage").querySelectorAll("button")) {
    const i = Number(knopf.dataset.tag);
    const gewaehlt = (maske & (1 << i)) !== 0;
    if (gewaehlt) gewWochentageWahl.add(i);
    knopf.setAttribute("aria-pressed", String(gewaehlt));
  }
  gewFeld("gewWochenziel").value = (g && g.wochenziel) || 3;
  gewSetzeRhythmusWahl(g ? g.rhythmus : "taeglich");

  gewDialog.hidden = false;
  // Nur beim Anlegen: dort ist das Feld leer und der naechste Schritt sicher
  // das Tippen. Beim Bearbeiten schoebe sich am Handy sonst nur die Tastatur
  // ueber den halben Dialog.
  if (!g) gewFeld("gewName").focus();
}

for (const knopf of gewFeld("gewTyp").querySelectorAll("button")) {
  knopf.onclick = () => gewSetzeTypWahl(knopf.dataset.typ);
}
for (const knopf of gewFeld("gewRichtung").querySelectorAll("button")) {
  knopf.onclick = () => gewSetzeRichtungWahl(knopf.dataset.richtung);
}
for (const knopf of gewFeld("gewRhythmus").querySelectorAll("button")) {
  knopf.onclick = () => gewSetzeRhythmusWahl(knopf.dataset.rhythmus);
}
for (const knopf of gewFeld("gewWochentage").querySelectorAll("button")) {
  const i = Number(knopf.dataset.tag);
  knopf.onclick = () => gewSetzeWochentag(i, !gewWochentageWahl.has(i));
}

gewFeld("gewAbbrechen").onclick = () => { gewDialog.hidden = true; };

gewFeld("gewSpeichern").onclick = async () => {
  if (gewRhythmusWahl === "wochentage" && !gewWochentageWahl.size) {
    gewFeld("gewDialogMsg").textContent = "Mindestens ein Wochentag muss ausgewählt sein.";
    return;
  }
  let wochentageMaske = 0;
  for (const i of gewWochentageWahl) wochentageMaske |= (1 << i);

  const koerper = {
    name: gewFeld("gewName").value.trim(),
    typ: gewTypWahl,
    zielmenge: Number(gewFeld("gewZiel").value),
    einheit: gewFeld("gewEinheit").value.trim(),
    richtung: gewRichtungWahl,
    rhythmus: gewRhythmusWahl,
    wochentageMaske,
    wochenziel: Number(gewFeld("gewWochenziel").value),
    // Damit der Server weiss, ab welchem Tag ein geaendertes Ziel gilt.
    heute: todayStr(),
  };
  const warNeu = !gewBearbeitet;
  if (gewBearbeitet) koerper.id = gewBearbeitet.id;

  const antwort = await gewApi("/api/gewohnheiten", {
    method: warNeu ? "POST" : "PATCH",
    body: JSON.stringify(koerper),
  });
  if (!antwort.ok) {
    gewFeld("gewDialogMsg").textContent = antwort.status === 0
      ? "Keine Verbindung – Anlegen und Ändern brauchen Netz."
      : (antwort.daten.error || "Speichern fehlgeschlagen.");
    return;
  }
  gewDialog.hidden = true;
  await gewLadeBestand();
  if (gewIstOffen()) gewZeichneAktuell();
  gewMeldeAenderung("bestand");
  snackInfo(warNeu ? "Gewohnheit angelegt" : "Gespeichert");
};

gewFeld("gewArchivieren").onclick = async () => {
  if (!gewBearbeitet) return;
  const g = gewBearbeitet;
  gewDialog.hidden = true;
  if (!await gewArchivieren(g, true)) gewDialog.hidden = false;
};

// Enter im Namensfeld speichert - sonst muesste man zur Maus greifen, obwohl
// der Finger schon auf der Tastatur liegt.
gewFeld("gewName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); gewFeld("gewSpeichern").click(); }
});

/**
 * Aus dem Streifen: der Stift an einer Karte. Die Heute-Liste kennt Rhythmus
 * und Wochentage nicht, der Dialog braucht aber alles - deshalb erst den
 * Bestand holen, falls er noch nicht da ist.
 */
window.gewOeffneBearbeiten = async function (id) {
  if (!gewBestand.geladen || !gewBestand.gewohnheiten.some(g => g.id === id)) {
    const r = await gewLadeBestand();
    if (!r.ok) { snackInfo(r.fehler || "Keine Verbindung."); return; }
  }
  const g = gewBestand.gewohnheiten.find(x => x.id === id);
  if (!g) { snackInfo("Diese Gewohnheit gibt es nicht mehr."); return; }
  gewOeffneDialog(g);
};

window.gewOeffneNeu = function () {
  gewOeffneDialog(null);
};

/* ------------------------------------------------------- Tag nachtragen */

let gewTagGewohnheit = null;
let gewTagDatum = null;

function gewOeffneTag(g, datum) {
  gewTagGewohnheit = g;
  gewTagDatum = datum;
  const tag = gewTagVon(g.id, datum);
  // Das Ziel dieses Tages, nicht das aktuelle: an einem Tag vor drei Wochen
  // zaehlt, was damals galt.
  const ziel = tag ? tag.ziel : g.zielmenge;
  gewFeld("gewTagTitel").textContent = g.name;
  gewFeld("gewTagDatum").textContent = `${gewWochentagVon(datum)}, ${gewFormatDatum(datum)}`;
  gewFeld("gewTagMsg").textContent = "";

  const istMenge = g.typ === "menge";
  const obergrenze = gewIstObergrenze(g);
  const zielWort = obergrenze ? "Höchstens" : "Ziel";
  gewFeld("gewTagLabel").textContent = istMenge
    ? (g.einheit ? `Menge in ${g.einheit} (${zielWort} ${ziel})` : `Menge (${zielWort} ${ziel})`)
    : "Status";
  const wert = tag ? tag.menge : 0;
  gewFeld("gewTagMenge").value = String(wert);
  gewFeld("gewTagMengeFeld").hidden = !istMenge;
  gewFeld("gewTagStatus").hidden = istMenge;
  // Bei einer Obergrenze ist die 0 ein erledigter Tag - zurueck auf "offen"
  // kommt man dort nur ueber diesen Weg, und nur wenn es etwas zu loeschen gibt.
  gewFeld("gewTagLoeschen").hidden = !(istMenge && obergrenze && tag);

  gewTagDialog.hidden = false;

  // Auf das Zahlenfeld bewusst KEIN focus(): am Handy schoebe sich die
  // Tastatur ueber den halben Dialog, obwohl -/+ direkt daneben stehen.
  if (!istMenge) {
    const erledigt = wert >= 1 ? "1" : "0";
    for (const knopf of gewFeld("gewTagStatus").querySelectorAll("button")) {
      knopf.setAttribute("aria-pressed", String(knopf.dataset.wert === erledigt));
    }
  }
}

for (const knopf of gewFeld("gewTagStatus").querySelectorAll("button")) {
  knopf.onclick = () => {
    gewFeld("gewTagMenge").value = knopf.dataset.wert;
    for (const b of gewFeld("gewTagStatus").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b === knopf));
    }
  };
}

gewFeld("gewTagMinus").onclick = () => {
  gewFeld("gewTagMenge").value = String(Math.max(0, Number(gewFeld("gewTagMenge").value) - 1));
};
gewFeld("gewTagPlus").onclick = () => {
  gewFeld("gewTagMenge").value = String(Math.min(GEW_MAX_MENGE, Number(gewFeld("gewTagMenge").value) + 1));
};
gewFeld("gewTagAbbrechen").onclick = () => { gewTagDialog.hidden = true; };

async function gewSpeichereTag(menge, loeschen) {
  const g = gewTagGewohnheit;
  const vorher = gewBestand.straehnen[g.id] || 0;
  const r = await gewSchreibeTag(g, gewTagDatum, menge, loeschen);
  if (!r.ok) { gewFeld("gewTagMsg").textContent = "Speichern fehlgeschlagen."; return; }
  gewTagDialog.hidden = true;
  // Nur melden, wenn die Flamme durch einen NACHGETRAGENEN Tag gewachsen ist -
  // beim Abhaken von heute sieht man die Zahl ohnehin.
  if (!r.offline && gewTagDatum !== todayStr() && r.straehne > vorher) {
    snackInfo(`${gewFormatDatum(gewTagDatum)} nachgetragen — Flamme jetzt `
      + gewMitEinheit(r.straehne, gewFlammenEinheitVon(g)));
  }
}

gewFeld("gewTagSpeichern").onclick = () => {
  const menge = Number(gewFeld("gewTagMenge").value);
  if (!Number.isInteger(menge) || menge < 0) {
    gewFeld("gewTagMsg").textContent = "Ganze Zahl ab 0 eingeben.";
    return;
  }
  if (menge > GEW_MAX_MENGE) {
    gewFeld("gewTagMsg").textContent = `Höchstens ${GEW_MAX_MENGE} eingeben.`;
    return;
  }
  gewSpeichereTag(menge, false);
};
gewFeld("gewTagLoeschen").onclick = () => gewSpeichereTag(0, true);
gewFeld("gewTagMenge").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); gewFeld("gewTagSpeichern").click(); }
});

// Klick neben den Kasten schliesst den Dialog - wie Abbrechen.
for (const dialog of [gewDialog, gewTagDialog]) {
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.hidden = true; });
}

/* --------------------------------------------------------- Einstellungen */
/* Zwei Abschnitte im Reiter "Gewohnheiten" der Einstellungen: "Gewohnheiten"
   (Zaehlweise der Flamme, Weg ins Fenster, Export) und "Fokus-Timer"
   (Standarddauer). Beide Werte gelten pro KONTO (Tabelle fokus_einstellungen),
   anders als die Schalter im Abschnitt "Kalender-Streifen", die pro Geraet
   gelten. */

let gewEinstellungen = { arbeitMin: 25, flammenModus: "absolut" };

/**
 * Der Schalter fuer die Zaehlweise. Angehakt = "In Reihe". Der Hinweis darunter
 * ist die EINZIGE Stelle, an der die beiden Bedeutungen erklaert werden - auf
 * der Karte steht in beiden Faellen nur "🔥 <Zahl> Tage" (Hendriks Vorgabe vom
 * 15.08.2026: die Anzeige sieht gleich aus, nur die Zahl ist eine andere).
 */
function gewZeichneFlammenSchalter() {
  const reihe = gewEinstellungen.flammenModus === "reihe";
  gewFeld("gewFlammenSwitch").checked = reihe;
  gewFeld("gewFlammenLabel").textContent = reihe ? "In Reihe" : "Insgesamt";
  gewFeld("gewFlammenHinweis").textContent = reihe
    ? "Tage am Stück. Ein ausgelassener Tag setzt die Flamme zurück auf null."
    : "Alle erledigten Tage zusammen. Ein ausgelassener Tag kostet nichts, er bringt nur nichts.";
}

function gewZeichneDauer() {
  gewFeld("gewDauerWert").textContent = `${gewFeld("gewDauer").value} Min`;
}

/**
 * Aus oeffneEinstellungen() in app.js. Zeigt erst den gemerkten Stand und
 * holt dann den echten - die Werte koennen an einem anderen Geraet geaendert
 * worden sein.
 */
window.gewEinstellungenZeigen = async function () {
  gewZeichneFlammenSchalter();
  gewFeld("gewDauer").value = String(gewEinstellungen.arbeitMin);
  gewZeichneDauer();

  // Der Bestand wird gleich mitgeladen, damit das Fenster "Verlauf, Statistik
  // & Verwalten" beim Antippen sofort steht statt erst "Lädt …" zu zeigen.
  const [fokus] = await Promise.all([
    gewApi(`/api/fokus?heute=${todayStr()}`),
    gewBestand.geladen ? Promise.resolve() : gewLadeBestand(),
  ]);
  if (fokus.ok && fokus.daten.einstellungen) {
    gewEinstellungen = {
      arbeitMin: fokus.daten.einstellungen.arbeitMin || 25,
      flammenModus: fokus.daten.einstellungen.flammenModus || "absolut",
    };
    gewZeichneFlammenSchalter();
    gewFeld("gewDauer").value = String(gewEinstellungen.arbeitMin);
    gewZeichneDauer();
  }
};

gewFeld("gewFlammenSwitch").addEventListener("change", async () => {
  const neu = gewFeld("gewFlammenSwitch").checked ? "reihe" : "absolut";
  const antwort = await gewApi("/api/fokus/einstellungen", {
    method: "PUT",
    body: JSON.stringify({ flammenModus: neu }),
  });
  if (!antwort.ok) {
    // Zurueckstellen, sonst zeigt der Schalter etwas, das nicht gespeichert
    // ist - und springt beim naechsten Laden unerklaerlich zurueck.
    gewZeichneFlammenSchalter();
    snackInfo(antwort.daten.error || "Speichern fehlgeschlagen.");
    return;
  }
  gewEinstellungen.flammenModus = antwort.daten.flammenModus;
  gewBestand.flammenModus = antwort.daten.flammenModus;
  gewZeichneFlammenSchalter();
  // Jede Flammen-Zahl aendert sich, und die Rechnung gehoert dem Server:
  // Streifen und Fenster holen neu.
  gewMeldeAenderung("einstellungen");
});

gewFeld("gewDauer").addEventListener("input", gewZeichneDauer);

gewFeld("gewDauerSpeichern").addEventListener("click", async () => {
  const arbeitMin = Number(gewFeld("gewDauer").value);
  const antwort = await gewApi("/api/fokus/einstellungen", {
    method: "PUT",
    body: JSON.stringify({ arbeitMin }),
  });
  if (!antwort.ok) { snackInfo(antwort.daten.error || "Speichern fehlgeschlagen."); return; }
  gewEinstellungen.arbeitMin = antwort.daten.arbeitMin;
  gewMeldeAenderung("einstellungen");
  snackInfo(`Standarddauer: ${gewEinstellungen.arbeitMin} Minuten`);
});

gewFeld("gewVerwaltenOeffnen").addEventListener("click", () => gewFensterOeffnen("verwalten"));
