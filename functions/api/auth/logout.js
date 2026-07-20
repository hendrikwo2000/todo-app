/**
 * Abmelden: Sitzung serverseitig loeschen und Cookie entwerten.
 *
 * Wichtig ist der erste Teil. Nur das Cookie zu loeschen wuerde reichen, damit
 * DIESER Browser nicht mehr reinkommt - das Token bliebe aber gueltig, und wer
 * es vorher abgegriffen hat, koennte es weiterbenutzen. Deshalb fliegt die
 * Zeile aus `sessions` raus.
 */

import { COOKIE_NAME, liesCookie, hashHex, loescheSessionCookie } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const token = liesCookie(request, COOKIE_NAME);
  if (token && env.DB) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashHex(token)).run();
    } catch (e) {
      // Cookie trotzdem entwerten - abmelden soll nie an der Datenbank
      // scheitern, sonst haengt jemand in einer Sitzung fest.
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": loescheSessionCookie(request),
    },
  });
}
