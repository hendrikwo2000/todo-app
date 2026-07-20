/**
 * Eigenes Konto loeschen.
 *
 * Verlangt die eigene Mailadresse als Bestaetigung im Anfragekoerper. Das ist
 * nicht Sicherheit gegen Fremde - dafuer sorgt die Sitzung - sondern gegen
 * einen unbedachten Klick: der Vorgang loescht alle ToDos unwiderruflich.
 */

import { angemeldeterNutzer, loescheSessionCookie } from "../../_lib/session.js";
import { loescheKonto, istLetzterAdmin, meldeLoeschung } from "../../_lib/loeschen.js";

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return json({ error: "Nicht angemeldet" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const bestaetigung = String(body?.email || "").trim().toLowerCase();
  if (bestaetigung !== nutzer.email.toLowerCase()) {
    return json({ error: "Die Adresse stimmt nicht mit deinem Konto überein." }, 400);
  }

  try {
    if (await istLetzterAdmin(env, nutzer)) {
      return json({
        error: "Du bist der einzige Admin. Mach erst jemand anderen zum Admin.",
      }, 409);
    }
    await loescheKonto(env, nutzer);
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  // Nach dem Loeschen - ein Fehler beim Mailversand darf den Vorgang nicht
  // ruecknehmen, das Konto ist ohnehin weg.
  await meldeLoeschung(env, nutzer, false);

  return json({ ok: true }, 200, { "Set-Cookie": loescheSessionCookie(request) });
}
