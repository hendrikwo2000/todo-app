/**
 * Serientermine im Google-Hauptkalender.
 *
 * Kein Routen-Handler, nur ein Modul fuer functions/api/google/termin.js.
 * Eigene Datei, weil hier die einzige Stelle ist, an der die App mehr tut als
 * einen Termin 1:1 an Google weiterzureichen: "diesen und alle folgenden"
 * gibt es in Googles Schnittstelle nicht, das muss man aus zwei Schritten
 * zusammensetzen (alte Serie enden lassen, neue anlegen).
 *
 * Begriffe:
 *   Serie    der Stammtermin mit `recurrence` (Google: recurringEventId)
 *   Ausgabe  ein einzelner Tag daraus; seine id ist "<serie>_<zeitpunkt>"
 *   Regel    die RRULE-Zeile, etwa "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10"
 *   Umfang   "dieser" | "folgende" | "alle" - wofuer eine Aenderung gilt
 */

import { terminRumpf, schreibeTermin, holeTermin, ausgabenDerSerie } from "./google.js";

// Genau das, was das Formular bauen kann - und nichts sonst. Die App schickt
// die Regel als Text; ohne dieses Muster ginge beliebiger Text mit unserem
// Token an Google.
const REGEL = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=[1-9]\d{0,2})?(;(COUNT=[1-9]\d{0,3}|UNTIL=\d{8}(T\d{6}Z)?))?$/;

export const UMFAENGE = new Set(["dieser", "folgende", "alle"]);

/**
 * Regel aus dem Rumpf lesen.
 *   undefined  Feld fehlt: an der Wiederholung aendert sich nichts
 *   ""         keine Wiederholung
 *   Text       neue Regel
 * Liefert { regel } oder { fehler }.
 */
export function regelLesen(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "regel")) return { regel: undefined };
  const roh = String(body.regel || "");
  if (!roh) return { regel: "" };
  if (!REGEL.test(roh)) return { fehler: "Wiederholung ist ungueltig" };
  return { regel: roh };
}

// ---------- Kleine Helfer rund um Datum und Regel ----------

function isoAusDatum(d) {
  return d.toISOString().slice(0, 10);
}

// Tage als reine Kalenderdaten rechnen (UTC), damit keine Sommerzeit dazwischen
// funkt: der 30. Maerz plus ein Tag ist der 31., egal wie lang der Tag war.
function plusTage(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoAusDatum(d);
}

function tageZwischen(von, bis) {
  return Math.round((Date.parse(bis + "T00:00:00Z") - Date.parse(von + "T00:00:00Z")) / 86400000);
}

// Das Kalenderdatum eines Google-Zeitpunkts ({date} oder {dateTime}). Google
// schreibt dateTime mit dem Versatz der Zeitzone des Termins, die ersten zehn
// Zeichen sind also das Datum vor Ort.
function datumVon(zeit) {
  return zeit.date || String(zeit.dateTime).slice(0, 10);
}

function gleicherZeitpunkt(a, b) {
  if (a.date || b.date) return datumVon(a) === datumVon(b);
  return Date.parse(a.dateTime) === Date.parse(b.dateTime);
}

function frueher(a, b) {
  if (a.date || b.date) return datumVon(a) < datumVon(b);
  return Date.parse(a.dateTime) < Date.parse(b.dateTime);
}

function regelZeile(recurrence) {
  return (recurrence || []).find(z => z.startsWith("RRULE:")) || null;
}

// Die Regel austauschen und alles andere (EXDATE, RDATE) stehen lassen. Wer
// eine Serie von ganztaegig auf Uhrzeit umstellt, verliert die EXDATE-Zeilen
// allerdings: deren Format haengt am Terminstart, und Google lehnt eine
// Mischung ab.
function ersetzeRegel(recurrence, zeile, formatWechsel) {
  const rest = (recurrence || []).filter(z => !z.startsWith("RRULE:") && !(formatWechsel && z.startsWith("EXDATE")));
  return zeile ? [zeile, ...rest] : rest;
}

// UNTIL muss zum Terminstart passen: bei ganztaegigen ein Datum, bei
// terminierten ein UTC-Zeitpunkt. Die App baut es passend, aber eine von
// Google uebernommene Regel kann nach dem Umschalten auf ganztaegig (oder
// zurueck) das falsche Format tragen.
export function passeUntilAn(zeile, ganztags) {
  return zeile.replace(/UNTIL=(\d{8})(T\d{6}Z)?/, (_, datum, zeit) =>
    ganztags ? `UNTIL=${datum}` : `UNTIL=${datum}${zeit || "T235959Z"}`);
}

// Eine Serie am Zeitpunkt `ausgabeStart` enden lassen: COUNT und ein altes
// UNTIL fliegen raus, das neue UNTIL liegt kurz VOR der Ausgabe - die gehoert
// ab jetzt zur neuen Serie.
export function schneideRegel(zeile, ausgabeStart, ganztags) {
  let until;
  if (ganztags) {
    until = plusTage(datumVon(ausgabeStart), -1).replace(/-/g, "");
  } else {
    const d = new Date(Date.parse(ausgabeStart.dateTime) - 1000);
    until = d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  }
  const ohne = zeile.replace(/;(COUNT|UNTIL)=[^;]*/g, "");
  return `${ohne};UNTIL=${until}`;
}

// Hatte die alte Serie eine feste Anzahl, bekommt die neue den Rest. Gezaehlt
// wird nach dem URSPRUENGLICHEN Zeitpunkt jeder Ausgabe - eine einzeln
// verschobene zaehlt da, wo sie herkam.
async function restRegel(token, kalenderId, serieId, zeile, ausgabeStart) {
  const treffer = /;COUNT=(\d+)/.exec(zeile);
  if (!treffer) return zeile;
  // Einen Tag Luft ueber den Zeitpunkt hinaus, genau gefiltert wird unten.
  const bis = new Date(Date.parse(datumVon(ausgabeStart) + "T00:00:00Z") + 2 * 86400000).toISOString();
  const ausgaben = await ausgabenDerSerie(token, kalenderId, serieId, bis);
  const vorher = ausgaben.filter(a => frueher(a.originalStartTime || a.start, ausgabeStart)).length;
  const rest = Number(treffer[1]) - vorher;
  return rest > 0 ? zeile.replace(/;COUNT=\d+/, ";COUNT=" + rest) : null;
}

// ---------- Die drei Wege ----------

export async function legeAn(token, kalenderId, felder, regel) {
  const rumpf = terminRumpf(felder);
  if (regel) rumpf.recurrence = [passeUntilAn(regel, felder.ganztags)];
  return schreibeTermin("POST", token, kalenderId, null, rumpf);
}

/**
 * Termin aendern.
 *
 *   id       der angetippte Termin (bei einer Serie: die Ausgabe)
 *   serieId  gesetzt, wenn er zu einer Serie gehoert
 *   umfang   nur bei Serien: "dieser" | "folgende" | "alle"
 *   regel    siehe regelLesen()
 */
export async function aendere(token, kalenderId, { id, serieId, umfang, felder, regel }) {
  if (!serieId) {
    // Einzeltermin. Bekommt er eine Wiederholung, wird er selbst zur Serie -
    // Google macht das aus einem PATCH mit `recurrence`.
    const rumpf = terminRumpf(felder);
    if (regel) rumpf.recurrence = [passeUntilAn(regel, felder.ganztags)];
    return schreibeTermin("PATCH", token, kalenderId, id, rumpf);
  }

  // Nur diese Ausgabe: Google fuehrt sie danach als Ausnahme der Serie. Die
  // Regel bleibt, wie sie ist - die App bietet diesen Weg gar nicht an, wenn
  // die Wiederholung geaendert wurde.
  if (umfang === "dieser") {
    return schreibeTermin("PATCH", token, kalenderId, id, terminRumpf(felder));
  }

  const serie = await holeTermin(token, kalenderId, serieId);
  const ausgabe = await holeTermin(token, kalenderId, id);
  const ausgabeStart = ausgabe.originalStartTime || ausgabe.start;
  const serieGanztags = !!serie.start.date;
  const alteZeile = regelZeile(serie.recurrence);
  const formatWechsel = serieGanztags !== !!felder.ganztags;

  // Ab der ERSTEN Ausgabe ist "diese und alle folgenden" dasselbe wie "alle" -
  // und das ist der sauberere Weg, weil keine leere Rest-Serie zurueckbleibt.
  if (umfang === "folgende" && !gleicherZeitpunkt(ausgabeStart, serie.start)) {
    let neueZeile;
    if (regel !== undefined) neueZeile = regel || null;
    else neueZeile = alteZeile ? await restRegel(token, kalenderId, serieId, alteZeile, ausgabeStart) : null;

    // Erst die neue Serie anlegen, dann die alte kuerzen. Scheitert der
    // zweite Schritt, stehen Termine doppelt da - sichtbar und von Hand zu
    // loeschen. Andersherum waeren sie im Fehlerfall still verschwunden.
    const rumpf = terminRumpf(felder);
    if (neueZeile) rumpf.recurrence = [passeUntilAn(neueZeile, felder.ganztags)];
    await schreibeTermin("POST", token, kalenderId, null, rumpf);
    if (alteZeile) {
      await schreibeTermin("PATCH", token, kalenderId, serieId, {
        recurrence: ersetzeRegel(serie.recurrence, schneideRegel(alteZeile, ausgabeStart, serieGanztags), false),
      });
    }
    return {};
  }

  // Alle - und keine Wiederholung mehr: aus der Serie wird ein Einzeltermin am
  // Tag, der im Formular steht. Neu anlegen statt die Regel am Stammtermin zu
  // leeren: der traegt das Datum der ERSTEN Ausgabe, und der Termin sollte
  // dann an einem Tag stehen, den man im Formular gar nicht gesehen hat.
  if (regel === "") {
    await schreibeTermin("POST", token, kalenderId, null, terminRumpf(felder));
    await schreibeTermin("DELETE", token, kalenderId, serieId, null);
    return {};
  }

  // Alle: die Serie verschiebt sich um denselben Abstand, um den der
  // angetippte Termin verschoben wurde. Wer die Ausgabe vom 16. auf den 17.
  // legt, meint "einen Tag spaeter" - nicht "die Serie beginnt am 17.".
  const verschiebung = tageZwischen(datumVon(ausgabeStart), felder.startDatum);
  const dauer = tageZwischen(felder.startDatum, felder.endDatum);
  const start = plusTage(datumVon(serie.start), verschiebung);
  const rumpf = terminRumpf({ ...felder, startDatum: start, endDatum: plusTage(start, dauer) });
  const zeile = regel !== undefined ? regel : alteZeile;
  if (zeile) rumpf.recurrence = ersetzeRegel(serie.recurrence, passeUntilAn(zeile, felder.ganztags), formatWechsel);
  return schreibeTermin("PATCH", token, kalenderId, serieId, rumpf);
}

export async function loesche(token, kalenderId, { id, serieId, umfang }) {
  if (!serieId || umfang === "dieser") return schreibeTermin("DELETE", token, kalenderId, id, null);
  if (umfang === "alle") return schreibeTermin("DELETE", token, kalenderId, serieId, null);

  const serie = await holeTermin(token, kalenderId, serieId);
  const ausgabe = await holeTermin(token, kalenderId, id);
  const ausgabeStart = ausgabe.originalStartTime || ausgabe.start;
  const alteZeile = regelZeile(serie.recurrence);
  if (!alteZeile || gleicherZeitpunkt(ausgabeStart, serie.start)) {
    return schreibeTermin("DELETE", token, kalenderId, serieId, null);
  }
  return schreibeTermin("PATCH", token, kalenderId, serieId, {
    recurrence: ersetzeRegel(serie.recurrence, schneideRegel(alteZeile, ausgabeStart, !!serie.start.date), false),
  });
}

// Fuers Formular: die Regel der Serie, damit es "Jede Woche" anzeigen kann.
export async function regelDerSerie(token, kalenderId, serieId) {
  const serie = await holeTermin(token, kalenderId, serieId);
  return { regel: regelZeile(serie.recurrence) };
}
