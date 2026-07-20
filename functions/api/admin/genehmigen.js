/**
 * Freischalten per Einmal-Link aus der Benachrichtigungsmail.
 *
 * GET  liefert, um wen es geht (nur lesen).
 * POST schaltet frei und verbraucht den Link.
 *
 * Warum die Trennung: Mailprogramme und Sicherheitsscanner oeffnen Links in
 * Mails teilweise von sich aus, um sie zu pruefen. Wuerde schon das Oeffnen
 * freischalten, koennte ein Scanner das ungefragt tun. Deshalb passiert beim
 * Oeffnen nichts - erst der Klick auf den Knopf schickt das POST.
 *
 * Der Link ersetzt keine Anmeldung: wer ihn hat, kann genau diese eine
 * Anfrage freischalten, sonst nichts. Er ist einmal verwendbar und laeuft
 * nach sieben Tagen ab.
 */

import { hashHex } from "../../_lib/session.js";
import { sendeWillkommen } from "../../_lib/willkommen.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Sucht den Token und den zugehoerigen Wartelisten-Eintrag.
async function hole(env, token) {
  if (!token) return null;
  return await env.DB.prepare(
    `SELECT a.id AS token_id, a.used_at, w.id AS wid, w.name, w.email, w.status
       FROM admin_tokens a
       JOIN waitlist w ON w.id = a.waitlist_id
      WHERE a.token_hash = ? AND a.zweck = 'freischalten'
        AND a.expires_at > datetime('now')`
  ).bind(await hashHex(token)).first();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);
  const token = new URL(request.url).searchParams.get("t") || "";

  let eintrag;
  try {
    eintrag = await hole(env, token);
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  if (!eintrag) return json({ error: "Dieser Link ist ungültig oder abgelaufen." }, 404);
  if (eintrag.used_at || eintrag.status !== "offen") {
    return json({ erledigt: true, name: eintrag.name, email: eintrag.email, status: eintrag.status });
  }
  return json({ name: eintrag.name, email: eintrag.email, status: eintrag.status });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  let eintrag;
  try {
    eintrag = await hole(env, String(body?.t || ""));
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  if (!eintrag) return json({ error: "Dieser Link ist ungültig oder abgelaufen." }, 404);
  if (eintrag.used_at || eintrag.status !== "offen") {
    return json({ error: "Diese Anfrage wurde schon bearbeitet." }, 409);
  }

  // Konto anlegen, Eintrag abhaken und Token entwerten - in einem Rutsch,
  // damit kein Zwischenzustand entstehen kann.
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (email, name, role) VALUES (?, ?, 'user')")
        .bind(eintrag.email, eintrag.name),
      env.DB.prepare("UPDATE waitlist SET status = 'freigeschaltet' WHERE id = ?").bind(eintrag.wid),
      env.DB.prepare("UPDATE admin_tokens SET used_at = datetime('now') WHERE id = ?")
        .bind(eintrag.token_id),
    ]);
  } catch (e) {
    return json({ error: "Konto konnte nicht angelegt werden - existiert die Adresse schon?" }, 409);
  }

  const versand = await sendeWillkommen(env, {
    name: eintrag.name,
    email: eintrag.email,
    url: new URL(request.url).origin,
  });

  return json({ ok: true, name: eintrag.name, email: eintrag.email, mailVerschickt: versand.ok });
}
