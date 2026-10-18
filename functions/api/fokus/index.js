/**
 * Die persoenlichen Einstellungen (Zaehlweise der Flamme) fuer die
 * Einstellungen der App.
 *
 * Bis 18.10.2026 der Bootstrap des Fokus-Countdowns (laufende Sitzung,
 * Standarddauer, Wochenstatistik). Der Timer ist seitdem eine Stoppuhr mit
 * eigenen Endpunkten unter /api/zeit; hier ist nur die Einstellung geblieben.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { einstellungenVon } from "../../_lib/fokus.js";

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    return json({ einstellungen: await einstellungenVon(env, nutzerId) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}
