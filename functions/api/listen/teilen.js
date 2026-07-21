/**
 * Teilen-Link einer Liste holen oder zuruecksetzen - NUR der Ersteller.
 *
 * Ohne reset: gibt den bestehenden Token zurueck, legt beim ersten Mal einen
 * an. Mit { reset: true }: neuer Token, der alte Link laeuft ins Leere -
 * bereits verknuepfte Personen bleiben aber (fuers Rauswerfen siehe
 * mitglieder.js).
 *
 * Der Token liegt im Klartext (siehe schema.sql): der Ersteller muss den Link
 * jederzeit erneut kopieren koennen. Die App baut daraus
 * <origin>/?beitreten=<token>.
 */

import { angemeldeterNutzer, neuesToken } from "../../_lib/session.js";
import { json, eigenesBoard } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);

  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf die Liste teilen." }, 403);

  let token = board.share_token;
  if (!token || body.reset) {
    token = neuesToken();
    await env.DB.prepare("UPDATE boards SET share_token = ? WHERE id = ?").bind(token, id).run();
  }
  return json({ token });
}
