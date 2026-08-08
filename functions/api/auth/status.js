/**
 * Kurze Frage: gilt gerade eine Sitzung?
 *
 * Dafuer gibt es einen eigenen Endpunkt, statt /api/todos abzufragen: die
 * Anmeldemaske fragt im Sekundentakt nach, waehrend der Nutzer auf die Mail
 * wartet. Wer den Anmeldelink im selben Browser oeffnet, wird in einem
 * zweiten Tab angemeldet - dieser Endpunkt sorgt dafuer, dass der erste Tab
 * das mitbekommt und von selbst aufmacht, statt mit der Maske stehenzubleiben.
 *
 * `angemeldet` ist nur dann true, wenn die Sitzung gilt UND todo_zugang
 * gesetzt ist - sonst ginge die Maske fuer jemanden auf, den gleich darauf
 * /api/todos wieder abweist.
 *
 * Antwortet bewusst immer mit 200, auch wenn niemand angemeldet ist: ein 401
 * im Sekundentakt fuellt nur die Browser-Konsole mit roten Zeilen.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { darfRein } from "../../_lib/zugang.js";

export async function onRequestGet({ request, env }) {
  let angemeldet = false;
  try {
    if (env.DB) {
      const nutzer = await angemeldeterNutzer(request, env);
      angemeldet = !!nutzer && (await darfRein(env, nutzer.email));
    }
  } catch (e) {
    // Datenbank kurz weg: als "noch nicht angemeldet" behandeln, die naechste
    // Abfrage kommt in ein paar Sekunden ohnehin.
  }
  return new Response(JSON.stringify({ angemeldet }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
