/**
 * Neue eigene Liste anlegen. Hoechstens MAX_EIGENE_LISTEN eigene pro Person;
 * geteilte Listen zaehlen nicht mit. Der Ersteller wird gleich als 'owner'
 * eingetragen, damit "welche Listen sehe ich?" eine einzige Abfrage bleibt.
 */

import { angemeldeterNutzer } from "../../_lib/session.js";
import { json, MAX_EIGENE_LISTEN, eigeneAnzahl, naechstePosition } from "../../_lib/listen.js";

export async function onRequestPost({ request, env }) {
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Ungueltiges JSON" }, 400); }
  const name = (body && typeof body.name === "string" ? body.name : "").trim();
  if (!name) return json({ error: "Name fehlt" }, 400);
  if (name.length > 80) return json({ error: "Name zu lang" }, 400);

  const anzahl = await eigeneAnzahl(env, nutzer.id);
  if (anzahl >= MAX_EIGENE_LISTEN) {
    return json({ error: `Mehr als ${MAX_EIGENE_LISTEN} eigene Listen gehen nicht.` }, 409);
  }

  const id = crypto.randomUUID();
  const pos = await naechstePosition(env, nutzer.id);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO boards (id, owner_id, name) VALUES (?, ?, ?)")
        .bind(id, nutzer.id, name),
      env.DB.prepare("INSERT INTO board_members (board_id, user_id, role, position) VALUES (?, ?, 'owner', ?)")
        .bind(id, nutzer.id, pos),
    ]);
  } catch (e) {
    return json({ error: "Datenbankfehler beim Anlegen" }, 500);
  }

  // Gleiche Form wie ein Eintrag in `listen` aus /api/todos.
  return json({
    id, name, rolle: "owner", istEigen: true,
    besitzerName: nutzer.name || "", geteilt: false, token: null, mitglieder: 0,
  });
}
