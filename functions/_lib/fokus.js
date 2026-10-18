/**
 * Die persoenlichen Einstellungen aus fokus_einstellungen - heute nur noch die
 * Zaehlweise der Flamme.
 *
 * Bis 18.10.2026 lag hier auch der Fokus-Countdown (Sitzungen in
 * fokus_sitzungen, Standarddauer in arbeit_min). Seitdem ist der Timer eine
 * Stoppuhr, die auf ToDos bucht - siehe functions/_lib/zeit.js. Die Spalte
 * arbeit_min und die Tabelle fokus_sitzungen stehen noch in der Datenbank
 * (nur additive Aenderungen), gelesen werden sie nicht mehr.
 */

import { FLAMMEN_MODUS_STANDARD } from "./tag.js";

/**
 * Die persoenlichen Einstellungen. Ohne eigene Zeile die Vorgabe aus dem
 * Schema - so muss niemand erst etwas einstellen.
 */
export async function einstellungenVon(env, nutzerId) {
  const zeile = await env.DB.prepare(
    "SELECT flammen_modus FROM fokus_einstellungen WHERE user_id = ?"
  ).bind(nutzerId).first();
  return {
    flammenModus: (zeile && zeile.flammen_modus) || FLAMMEN_MODUS_STANDARD,
  };
}

// Zaehlweise der Flamme allein - fuer die drei Gewohnheiten-Endpunkte.
export async function flammenModusVon(env, nutzerId) {
  return (await einstellungenVon(env, nutzerId)).flammenModus;
}
