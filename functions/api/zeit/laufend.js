/**
 * Der laufenden Uhr ein ToDo zuordnen (oder es wieder wegnehmen) - ab ihrem
 * Start, ohne sie anzuhalten.
 *
 * Hendriks Wunsch, 18.10.2026: "Wenn ich ohne ToDo arbeite, soll ich waehrend
 * der Zeit ein ToDo hinzufuegen [koennen], dann wird von Beginn an die Zeit
 * darauf gebucht." Derselbe Weg korrigiert ein falsch gewaehltes ToDo - deshalb
 * gibt es kein "Wechseln" mehr, das einen zweiten Eintrag angefangen haette.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { laufenderEintrag, eintragVon, alsEintrag, buchungAus } from "../../_lib/zeit.js";

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const b = buchungAus(body);

  try {
    // laufenderEintrag kappt eine Uhr ueber dem Deckel - dann laeuft keine mehr,
    // und die App holt den Stand samt Hinweis neu.
    const zeile = await laufenderEintrag(env, nutzerId);
    if (!zeile) return json({ error: "Die Uhr läuft gerade nicht." }, 409);

    await env.DB.prepare(
      `UPDATE zeiteintraege
          SET todo_id = ?, todo_text = ?, liste_name = ?, bereich_name = ?
        WHERE id = ? AND user_id = ? AND ende IS NULL`
    ).bind(b.todoId, b.todoText, b.listeName, b.bereichName, zeile.id, nutzerId).run();

    return json({ ok: true, laeuft: alsEintrag(await eintragVon(env, nutzerId, zeile.id)) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}
