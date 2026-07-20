/**
 * Schritt 2 des Logins: Code pruefen, Sitzung anlegen.
 *
 * Bei Erfolg kommt ein Sitzungs-Cookie zurueck (HttpOnly - fuer Skripte im
 * Browser unsichtbar, anders als das fruehere Passwort in localStorage).
 */

import { hashHex, zeitgleich, neuesToken, setzeSessionCookie } from "../../_lib/session.js";

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

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  if (!email || !/^\d{6}$/.test(code)) return json({ error: "Ungueltige Eingabe" }, 400);

  const nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  // Generische Fehlermeldung, egal ob die Adresse existiert oder der Code
  // falsch ist - siehe request-code.js fuer die gleiche Ueberlegung.
  if (!nutzer) return json({ error: "Falscher oder abgelaufener Code" }, 401);

  const eintrag = await env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
      WHERE email = ? AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (!eintrag) return json({ error: "Falscher oder abgelaufener Code" }, 401);
  if (eintrag.attempts >= 5) {
    return json({ error: "Zu viele Versuche - fordere einen neuen Code an" }, 401);
  }

  const hash = await hashHex(code);
  if (!zeitgleich(hash, eintrag.code_hash)) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(eintrag.id).run();
    return json({ error: "Falscher oder abgelaufener Code" }, 401);
  }

  // Verbraucht - loeschen, damit derselbe Code nicht zweimal funktioniert.
  await env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(eintrag.id).run();

  const token = neuesToken();
  const tokenHash = await hashHex(token);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))"
  ).bind(tokenHash, nutzer.id).run();

  return json({ ok: true }, 200, { "Set-Cookie": setzeSessionCookie(request, token) });
}
