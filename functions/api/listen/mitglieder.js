/**
 * Zugriffe einer eigenen Liste sehen und entziehen - NUR der Ersteller.
 *
 *   GET  ?id=<liste>              -> wer hat Zugriff (nur echte Mitglieder)
 *   POST { id, userId }           -> diese eine Person entfernen (gezielt)
 *   POST { id, alle: true }       -> alle Mitglieder entfernen UND den Link
 *                                    zuruecksetzen, damit niemand mit dem alten
 *                                    Link erneut beitritt
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, eigenesBoard } from "../../_lib/listen.js";

export async function onRequestGet({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "Keine Liste angegeben" }, 400);

  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf die Zugriffe sehen." }, 403);

  const rows = await env.DB.prepare(
    `SELECT u.id, u.name, u.email
       FROM board_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.board_id = ? AND m.role = 'member'
      ORDER BY m.joined_at`
  ).bind(id).all();

  return json({ mitglieder: rows.results });
}

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);

  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf Zugriffe entziehen." }, 403);

  if (body.alle) {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM board_members WHERE board_id = ? AND role = 'member'").bind(id),
        // Link tot machen: die Liste ist danach nicht mehr geteilt.
        env.DB.prepare("UPDATE boards SET share_token = NULL WHERE id = ?").bind(id),
      ]);
    } catch (e) {
      return json({ error: "Datenbankfehler" }, 500);
    }
    return json({ ok: true, alle: true });
  }

  const userId = body.userId;
  if (!Number.isInteger(userId)) return json({ error: "Keine Person angegeben" }, 400);
  // role='member' im WHERE, damit sich der Ersteller nicht versehentlich selbst
  // aus der eigenen Liste entfernt.
  await env.DB.prepare(
    "DELETE FROM board_members WHERE board_id = ? AND user_id = ? AND role = 'member'"
  ).bind(id, userId).run();
  return json({ ok: true });
}
