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
 *
 * Mit ?email= fragt die Maske nach genau der Adresse, auf deren Mail sie
 * wartet. Das braucht ein Browser mit mehreren Konten: dort ist ja schon
 * jemand angemeldet, und die Maske ginge sonst sofort wieder zu. `konto` und
 * `mehrere` sagen ihr, welches Konto der Tab danach zeigen soll.
 */

import { angemeldeterNutzer, browserSitzungen } from "../../_lib/session.js";
import { darfRein } from "../../_lib/zugang.js";

export async function onRequestGet({ request, env }) {
  let angemeldet = false;
  let konto = null;
  let mehrere = false;
  try {
    if (env.DB) {
      const gesucht = String(new URL(request.url).searchParams.get("email") || "").trim().toLowerCase();
      if (gesucht) {
        const sitzungen = await browserSitzungen(request, env);
        const treffer = sitzungen.find(s => s.nutzer.email.toLowerCase() === gesucht);
        angemeldet = !!treffer && (await darfRein(env, treffer.nutzer.email));
        konto = treffer ? treffer.nutzer.id : null;
        mehrere = sitzungen.length > 1;
      } else {
        const nutzer = await angemeldeterNutzer(request, env);
        angemeldet = !!nutzer && (await darfRein(env, nutzer.email));
      }
    }
  } catch (e) {
    // Datenbank kurz weg: als "noch nicht angemeldet" behandeln, die naechste
    // Abfrage kommt in ein paar Sekunden ohnehin.
  }
  return new Response(JSON.stringify({ angemeldet, konto, mehrere }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
