/**
 * Liste umbenennen - NUR der Ersteller (owner). Der Name gilt fuer alle, die
 * die Liste sehen; es gibt bewusst keinen eigenen Namen pro Person.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, eigenesBoard } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const id = body && body.id;
  const name = (body && typeof body.name === "string" ? body.name : "").trim();
  if (typeof id !== "string" || !id) return json({ error: "Keine Liste angegeben" }, 400);
  if (!name) return json({ error: "Name fehlt" }, 400);
  if (name.length > 80) return json({ error: "Name zu lang" }, 400);

  // eigenesBoard liefert nur, wenn der Nutzer der Besitzer ist - das ist die
  // Rechtepruefung. Ein 403 statt 404, damit die App den Grund zeigen kann.
  const board = await eigenesBoard(env, id, nutzer.id);
  if (!board) return json({ error: "Nur der Ersteller darf die Liste umbenennen." }, 403);

  await env.DB.prepare("UPDATE boards SET name = ? WHERE id = ?").bind(name, id).run();
  return json({ ok: true, name });
}
