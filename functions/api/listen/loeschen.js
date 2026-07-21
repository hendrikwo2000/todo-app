/**
 * Ganze Liste loeschen - NUR der Ersteller (owner). Nimmt Bereiche, ToDos und
 * alle Zugriffe mit. Das Konto bleibt: Listen loeschen und Konto loeschen sind
 * ausdruecklich zwei verschiedene Dinge.
 *
 * Wer nur mitliest (member), verlaesst die Liste stattdessen ueber
 * verlassen.js - er darf sie nicht fuer alle anderen loeschen.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, eigenesBoard } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);

  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf die Liste loeschen." }, 403);

  // Kindtabellen ausdruecklich zuerst, nicht auf ON DELETE CASCADE verlassen
  // (haengt an PRAGMA foreign_keys). Alles in einer Transaktion.
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM todos WHERE list_id IN (SELECT id FROM lists WHERE board_id = ?)").bind(id),
      env.DB.prepare("DELETE FROM lists WHERE board_id = ?").bind(id),
      env.DB.prepare("DELETE FROM board_members WHERE board_id = ?").bind(id),
      env.DB.prepare("DELETE FROM boards WHERE id = ? AND owner_id = ?").bind(id, nutzer.id),
    ]);
  } catch (e) {
    return json({ error: "Datenbankfehler beim Loeschen" }, 500);
  }

  return json({ ok: true });
}
