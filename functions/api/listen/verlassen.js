/**
 * Eine geteilte Liste verlassen ("Verknuepfung loesen") - fuer Mitglieder.
 * Entfernt nur die eigene Mitgliedschaft, die Liste selbst bleibt fuer die
 * anderen bestehen.
 *
 * Der Ersteller kann NICHT verlassen - fuer ihn gaebe es keinen Sinn, die
 * eigene Liste ohne sie zu loeschen zurueckzulassen. Er nutzt loeschen.js.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, rolleIn } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);

  const rolle = await rolleIn(env, id, nutzer.id);
  if (!rolle) return json({ error: "Du bist mit dieser Liste nicht verknuepft." }, 404);
  if (rolle === "owner") {
    return json({ error: "Deine eigene Liste kannst du nur loeschen, nicht verlassen." }, 400);
  }

  await env.DB.prepare(
    "DELETE FROM board_members WHERE board_id = ? AND user_id = ?"
  ).bind(id, nutzer.id).run();
  return json({ ok: true });
}
