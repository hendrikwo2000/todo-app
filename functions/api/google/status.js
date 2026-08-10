/**
 * Ist ein Google-Konto verknuepft, und welches?
 *
 * Antwortet absichtlich IMMER mit 200 - auch wenn nichts verknuepft ist. Die
 * App fragt das beim Oeffnen der Einstellungen und des Kalenders; ein 404
 * wuerde die Browser-Konsole bei jedem zweiten Klick rot faerben, ohne dass
 * etwas kaputt waere. Gleiche Ueberlegung wie bei /api/auth/status.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { fehltEinrichtung, kontoFuer, darfSchreiben } from "../../_lib/google.js";

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  // Ohne hinterlegte Zugangsdaten gibt es die Funktion faktisch nicht - die
  // App blendet den Verknuepfen-Knopf dann aus, statt in einen Fehler zu laufen.
  if (fehltEinrichtung(env)) return json({ moeglich: false, verbunden: false });

  const konto = await kontoFuer(env, nutzerId);
  return json({
    moeglich: true,
    verbunden: !!konto,
    email: konto ? konto.google_email : null,
    // Aeltere Verknuepfungen tragen den Schreib-Scope nicht - die App bietet
    // das Anlegen dann gar nicht erst an und bittet stattdessen ums neu
    // Verknuepfen.
    schreiben: darfSchreiben(konto),
  });
}
