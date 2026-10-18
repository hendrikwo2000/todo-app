/**
 * Die persoenliche Einstellung aendern: die Zaehlweise der Flamme.
 *
 * Bis 18.10.2026 stand hier auch die Standarddauer des Fokus-Countdowns
 * (arbeit_min). Den Countdown gibt es nicht mehr - die Spalte bleibt in der
 * Tabelle stehen und wird beim Speichern nicht angefasst.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { istFlammenModus } from "../../_lib/tag.js";

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const flammenModus = String(body?.flammenModus || "");
  if (!istFlammenModus(flammenModus)) {
    return json({ error: "Unbekannte Zählweise für die Flamme" }, 400);
  }

  try {
    // arbeit_min fehlt im INSERT absichtlich: eine neue Zeile bekommt die
    // Schema-Vorgabe, eine bestehende behaelt ihren Wert.
    await env.DB.prepare(
      `INSERT INTO fokus_einstellungen (user_id, flammen_modus) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET flammen_modus = excluded.flammen_modus`
    ).bind(nutzerId, flammenModus).run();

    return json({ ok: true, flammenModus });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}
