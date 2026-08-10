/**
 * Termine des verknuepften Google-Kontos fuer einen Zeitraum.
 *
 * GET /api/google/termine?von=2026-08-01&bis=2026-09-07&kalender=id1,id2
 *
 * Liefert IMMER die Kalenderliste mit (Name, Farbe, welcher der Hauptkalender
 * ist) - daraus baut das Panel seine Umschalter. Termine kommen nur fuer die
 * angefragten Kalender; ohne `kalender`-Parameter nur fuer den Hauptkalender,
 * damit der erste Abruf nach dem Verknuepfen nicht gleich Feiertage und
 * Geburtstage mitzieht.
 *
 * Fehlerfaelle antworten mit 200 und einem Merkmal im Rumpf statt mit einem
 * Statuscode: der Kalender soll bei einem Google-Problem seine ToDos weiter
 * anzeigen und nur eine Zeile dazuschreiben, nicht ins Leere laufen.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import {
  fehltEinrichtung, kontoFuer, loescheKonto, frischesZugriffToken,
  kalenderListe, termineVon, farbPalette,
} from "../../_lib/google.js";

// Obergrenze fuer gleichzeitig abgefragte Kalender. Wer 30 abonnierte
// Kalender hat, soll uns nicht 30 Google-Anfragen pro Monatswechsel kosten.
const MAX_KALENDER = 8;

function tagPruefen(wert, ersatz) {
  return /^\d{4}-\d{2}-\d{2}$/.test(wert || "") ? wert : ersatz;
}

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;
  if (fehltEinrichtung(env)) return json({ moeglich: false, verbunden: false });

  const konto = await kontoFuer(env, nutzerId);
  if (!konto) return json({ moeglich: true, verbunden: false });

  const url = new URL(request.url);
  const heute = new Date().toISOString().slice(0, 10);
  const von = tagPruefen(url.searchParams.get("von"), heute);
  const bis = tagPruefen(url.searchParams.get("bis"), heute);
  const gewuenscht = (url.searchParams.get("kalender") || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  try {
    const token = await frischesZugriffToken(env, konto);
    const kalender = await kalenderListe(token);

    // Nur bekannte Kalender abfragen: eine ungeprueft durchgereichte id waere
    // eine fremdgesteuerte Anfrage mit unserem Token.
    const erlaubt = new Set(kalender.map(k => k.id));
    let ziele = gewuenscht.filter(id => erlaubt.has(id));
    if (!ziele.length) {
      const haupt = kalender.find(k => k.primaer);
      ziele = haupt ? [haupt.id] : [];
    }
    ziele = ziele.slice(0, MAX_KALENDER);

    const listen = await Promise.all(
      ziele.map(id => termineVon(token, id, `${von}T00:00:00Z`, `${bis}T23:59:59Z`).catch(() => []))
    );
    const termine = listen.flat();

    // Farbe fertig aufgeloest mitgeben: eigene Termin-Farbe schlaegt die Farbe
    // des Kalenders. Die Palette dafuer nur holen, wenn ueberhaupt ein Termin
    // eine eigene Farbe traegt - sonst waere es eine Google-Anfrage umsonst.
    const kalenderFarbe = {};
    for (const k of kalender) kalenderFarbe[k.id] = k.farbe || null;
    let palette = {};
    if (termine.some(t => t.colorId)) {
      palette = await farbPalette(token).catch(() => ({}));
    }
    for (const t of termine) {
      t.farbe = (t.colorId && palette[t.colorId]) || kalenderFarbe[t.kalenderId] || null;
    }

    return json({
      moeglich: true,
      verbunden: true,
      email: konto.google_email,
      kalender,
      termine,
    });
  } catch (e) {
    if (e && e.code === "getrennt") {
      // Zugriff bei Google widerrufen oder Token abgelaufen: die tote Zeile
      // weg, damit die App wieder "verknuepfen" anbietet statt bei jedem
      // Oeffnen erneut in denselben Fehler zu laufen.
      await loescheKonto(env, nutzerId);
      return json({ moeglich: true, verbunden: false, getrennt: true });
    }
    return json({ moeglich: true, verbunden: true, email: konto.google_email, fehler: true, kalender: [], termine: [] });
  }
}
