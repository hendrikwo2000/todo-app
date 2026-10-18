/**
 * Schritt 2 des Logins: Code pruefen, Sitzung anlegen.
 *
 * Bei Erfolg kommt ein Sitzungs-Cookie zurueck (HttpOnly - fuer Skripte im
 * Browser unsichtbar, anders als das fruehere Passwort in localStorage).
 */

import { hashHex, zeitgleich, neuesToken, mitCookies, anmeldungVorbereiten, MAX_KONTEN, SESSION_ABLAUF_SQL } from "../../_lib/session.js";
import { darfRein } from "../../_lib/zugang.js";

function json(body, status = 200, cookies = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, cookies),
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

  // Alle Datenbankzugriffe abgesichert: ein Fehler hier hat die Function
  // frueher abstuerzen lassen (Cloudflare-Fehler 1101 statt lesbarer Meldung).
  try {
    const nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    // Hier bleibt die Meldung bewusst generisch - anders als beim Anfordern
    // des Codes. Wer schon einen Code eintippt, kennt die Adresse ohnehin;
    // was er nicht erfahren soll, ist WARUM es nicht klappt, weil das beim
    // Durchraten von Codes hilft.
    if (!nutzer) return json({ error: "Falscher oder abgelaufener Code" }, 401);
    // todo_zugang kann zwischen Codeversand und Einloesen entzogen worden
    // sein (selten, aber die Pruefung ist billig) - lieber hier noch einmal
    // ehrlich absagen als eine Sitzung fuer ein gesperrtes Konto anzulegen.
    if (!(await darfRein(env, email))) {
      return json({ error: "Diese Adresse ist für die ToDo-Liste nicht freigeschaltet." }, 403);
    }

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

    // Erst nach dem richtigen Code (sonst verriete die Meldung beim Raten
    // etwas), aber vor dem Verbrauchen: der Code bleibt dann gueltig.
    const plan = await anmeldungVorbereiten(request, env, nutzer.id);
    if (plan.zuviele) {
      return json({ error: `Höchstens ${MAX_KONTEN} Konten gleichzeitig – melde erst eins ab.` }, 409);
    }

    // Verbraucht - loeschen, damit derselbe Code nicht zweimal funktioniert.
    await env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(eintrag.id).run();

    const token = neuesToken();
    await env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, ${SESSION_ABLAUF_SQL})`
    ).bind(await hashHex(token), nutzer.id).run();

    // `konto` + `zusaetzlich` braucht nur die Anmeldemaske eines Browsers mit
    // mehreren Konten: dann zeigt der Tab ab jetzt das neue.
    const { cookies, zusaetzlich } = plan.cookies(token);
    return json({ ok: true, konto: nutzer.id, zusaetzlich }, 200, cookies);
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
}
