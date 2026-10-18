/**
 * Alle fertigen Eintraege eines Zeitraums - fuer die Statistik und den
 * CSV-Export. Gruppiert wird in der App: nur sie kennt die aktuellen Namen
 * der ToDos, Listen und Bereiche (siehe Kommentar in schema-fokus.sql).
 *
 * Der Zeitraum geht nach `datum`, dem lokalen Tag des Starts - so landet eine
 * Strecke von 23:30 bis 0:30 dort, wo man sie begonnen hat.
 *
 * `?alle=1` statt von/bis liefert alles seit Beginn - der Reiter "Gesamt" der
 * Statistik (Hendrik: "wie viel Zeit gesamt in einige ToDos bzw. Bereiche
 * geflossen ist"). Ein Eintrag ist eine kurze Zeile; auch Jahre davon sind eine
 * Antwort, die der Browser in einem Rutsch verarbeitet.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { istDatum, tagPlus } from "../../_lib/tag.js";
import { SPALTEN, alsEintrag } from "../../_lib/zeit.js";

// Ein Jahr plus Rand - mehr fragt die Statistik mit von/bis nie an.
const MAX_TAGE = 400;

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const url = new URL(request.url);
  const alle = url.searchParams.get("alle") === "1";
  const von = url.searchParams.get("von") || "";
  const bis = url.searchParams.get("bis") || "";
  if (!alle) {
    if (!istDatum(von) || !istDatum(bis) || bis < von) {
      return json({ error: "Ungültiger Zeitraum" }, 400);
    }
    if (bis > tagPlus(von, MAX_TAGE)) return json({ error: "Zeitraum zu lang" }, 400);
  }

  try {
    const abfrage = alle
      ? env.DB.prepare(
          `SELECT ${SPALTEN} FROM zeiteintraege
            WHERE user_id = ? AND ende IS NOT NULL
            ORDER BY start DESC`
        ).bind(nutzerId)
      : env.DB.prepare(
          `SELECT ${SPALTEN} FROM zeiteintraege
            WHERE user_id = ? AND datum >= ? AND datum <= ? AND ende IS NOT NULL
            ORDER BY start DESC`
        ).bind(nutzerId, von, bis);
    const zeilen = await abfrage.all();
    return json({ eintraege: zeilen.results.map(alsEintrag) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}
