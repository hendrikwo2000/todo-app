/**
 * Teilen-Link einer Liste holen, zuruecksetzen oder loeschen - NUR der
 * Ersteller.
 *
 *   POST { id }                   -> bestehenden Token zurueckgeben, beim
 *                                    ersten Mal einen anlegen
 *   POST { id, reset: true }      -> neuer Token, der alte Link laeuft ins Leere
 *   POST { id, loeschen: true }   -> gar kein Link mehr; die Liste ist nicht
 *                                    mehr teilbar, bis man neu teilt
 *
 * In allen drei Faellen bleiben bereits verknuepfte Personen drin - der Link
 * regelt nur, wer NEU dazukommen kann. Fuers Rauswerfen siehe mitglieder.js.
 * Bewusst getrennt: einen Link totzulegen und Leuten den Zugriff zu nehmen
 * sind zwei verschiedene Entscheidungen.
 *
 * Der Token liegt im Klartext (siehe schema.sql): der Ersteller muss den Link
 * jederzeit erneut kopieren koennen. Die App baut daraus
 * <origin>/?beitreten=<token>.
 */

import { neuesToken } from "../../_lib/session.js";
import { json, eigenesBoard } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzer, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);

  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf die Liste teilen." }, 403);

  if (body.loeschen) {
    await env.DB.prepare("UPDATE boards SET share_token = NULL WHERE id = ?").bind(id).run();
    return json({ token: null });
  }

  let token = board.share_token;
  if (!token || body.reset) {
    token = neuesToken();
    await env.DB.prepare("UPDATE boards SET share_token = ? WHERE id = ?").bind(token, id).run();
  }
  return json({ token });
}
