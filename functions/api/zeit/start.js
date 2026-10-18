/**
 * Die Uhr starten - auf ein ToDo oder ohne.
 *
 * Laeuft schon eine, wird sie vorher beendet und gebucht. Das ist zugleich der
 * Weg fuer "Wechseln": von ToDo A auf B in einem Tipp, ohne erst zu stoppen.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute } from "../../_lib/tag.js";
import {
  laufenderEintrag, beende, eintragVon, alsEintrag, buchungAus,
} from "../../_lib/zeit.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const heute = String(body?.heute || "");
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  const b = buchungAus(body);

  try {
    // Eine noch laufende Uhr sauber beenden, statt sie liegen zu lassen - sonst
    // gaebe es zwei, und "die laufende Uhr" waere eine Luege.
    const alt = await laufenderEintrag(env, nutzerId);
    const beendet = alt ? await beende(env, nutzerId, alt) : null;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO zeiteintraege (id, user_id, start, datum, todo_id, todo_text, liste_name, bereich_name)
       VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`
    ).bind(id, nutzerId, heute, b.todoId, b.todoText, b.listeName, b.bereichName).run();

    return json({
      ok: true,
      laeuft: alsEintrag(await eintragVon(env, nutzerId, id)),
      // Damit die App sagen kann, was mit der alten Uhr passiert ist.
      beendet,
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Starten" }, 500);
  }
}
