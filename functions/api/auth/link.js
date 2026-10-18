/**
 * Anmeldelink aus der Mail einloesen.
 *
 * Ein Klick, Sitzung, fertig - kein Code abtippen. Der Code in derselben Mail
 * bleibt als Ausweg fuer den Geraetewechsel bestehen; beide Wege zeigen auf
 * denselben Datenbankeintrag, was zuerst benutzt wird, verbraucht beide.
 *
 * Antwortet mit einer Weiterleitung statt JSON: der Aufruf kommt aus einem
 * Mailprogramm, nicht aus der App.
 *
 * Bis Oktober 2026 teilte sich login_codes mit der eigenen Fokus-App; deren
 * Adresse leitet seitdem hierher weiter, auch mit einem alten Anmeldelink
 * (/api/auth/link?t=...). Genau wie beim Anfordern eines Codes
 * (request-code.js) gilt: ein
 * gueltiger Link IST der Login-Versuch, der todo_zugang gleich mit setzt -
 * kein separater "gesperrt"-Fall mehr noetig.
 */

import { hashHex, neuesToken, mitCookies, anmeldungVorbereiten, SESSION_ABLAUF_SQL } from "../../_lib/session.js";

function weiter(ziel, cookies = []) {
  return new Response(null, {
    status: 302,
    headers: mitCookies({ Location: ziel, "Cache-Control": "no-store" }, cookies),
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DB) return weiter("/?login=fehler");

  const token = url.searchParams.get("t") || "";
  if (!token) return weiter("/?login=fehler");

  try {
    const eintrag = await env.DB.prepare(
      `SELECT id, email FROM login_codes
        WHERE token_hash = ? AND expires_at > datetime('now')`
    ).bind(await hashHex(token)).first();
    // Abgelaufen oder schon benutzt: zurueck zur Anmeldung mit Hinweis,
    // statt einer nackten Fehlerseite.
    if (!eintrag) return weiter("/?login=abgelaufen");

    const nutzer = await env.DB.prepare("SELECT id, todo_zugang FROM users WHERE email = ?")
      .bind(eintrag.email).first();
    if (!nutzer) return weiter("/?login=fehler");
    // Vor dem Verbrauchen pruefen: ist der Browser schon voll, bleibt der Link
    // gueltig, und man kann erst ein Konto abmelden.
    const plan = await anmeldungVorbereiten(request, env, nutzer.id);
    if (plan.zuviele) return weiter("/?login=zuviele");
    if (!nutzer.todo_zugang) {
      await env.DB.prepare("UPDATE users SET todo_zugang = 1 WHERE id = ?").bind(nutzer.id).run();
    }

    const sitzung = neuesToken();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(eintrag.id),
      env.DB.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, ${SESSION_ABLAUF_SQL})`
      ).bind(await hashHex(sitzung), nutzer.id),
    ]);

    // Kam das Konto zu den schon angemeldeten dazu, soll der Tab, in dem der
    // Link aufgeht, genau dieses Konto zeigen - konto.js liest ?konto=.
    const { cookies, zusaetzlich } = plan.cookies(sitzung);
    return weiter(zusaetzlich ? `/?konto=${nutzer.id}` : "/", cookies);
  } catch (e) {
    return weiter("/?login=fehler");
  }
}
