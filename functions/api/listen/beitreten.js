/**
 * Einer geteilten Liste ueber den Einladungs-Token beitreten. Setzt eine
 * angemeldete Sitzung voraus - der Link fuehrt sonst erst durch die Anmeldung
 * und wird danach eingeloest.
 *
 * Wer schon Mitglied ist (oder selbst der Ersteller), tritt nicht doppelt bei;
 * die Antwort verweist dann nur auf die Liste. So ist der Aufruf beim erneuten
 * Oeffnen des Links harmlos.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, rolleIn, naechstePosition } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const token = body && typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "Kein Link angegeben" }, 400);

  const board = await env.DB.prepare(
    "SELECT id, owner_id, name FROM boards WHERE share_token = ?"
  ).bind(token).first();
  if (!board) return json({ error: "Der Link ist ungueltig oder wurde zurueckgesetzt." }, 404);

  // Eigene Liste oder schon Mitglied: nichts tun, nur auf die Liste zeigen.
  if (board.owner_id === nutzer.id) return json({ id: board.id, name: board.name, schon: true });
  const rolle = await rolleIn(env, board.id, nutzer.id);
  if (rolle) return json({ id: board.id, name: board.name, schon: true });

  const pos = await naechstePosition(env, nutzer.id);
  try {
    await env.DB.prepare(
      "INSERT INTO board_members (board_id, user_id, role, position) VALUES (?, ?, 'member', ?)"
    ).bind(board.id, nutzer.id, pos).run();
  } catch (e) {
    return json({ error: "Beitreten hat nicht geklappt." }, 500);
  }
  return json({ id: board.id, name: board.name });
}
