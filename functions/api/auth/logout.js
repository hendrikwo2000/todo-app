/**
 * Abmelden: Sitzung serverseitig loeschen und Cookie entwerten.
 *
 * Wichtig ist der erste Teil. Nur das Cookie zu loeschen wuerde reichen, damit
 * DIESER Browser nicht mehr reinkommt - das Token bliebe aber gueltig, und wer
 * es vorher abgegriffen hat, koennte es weiterbenutzen. Deshalb fliegt die
 * Zeile aus `sessions` raus.
 *
 * Mit mehreren Konten im Browser (siehe session.js) meldet das nur das Konto
 * des Tabs ab. Die Antwort sagt, wie viele Konten uebrig sind und welches
 * jetzt vorne steht - danach richtet sich der Tab beim Neuladen.
 */

import {
  COOKIE_NAME, liesCookie, hashHex, loescheAlleKontenCookies, mitCookies,
  browserSitzungen, gewaehltesKonto, cookiesNachAbmelden,
} from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  let cookies = null;
  let rest = [];
  if (env.DB) {
    try {
      // Ohne ausdrueckliches Konto wie immer das erste. Mit Konto nur genau
      // dessen Sitzung - ist sie schon weg, wird gar nichts geloescht, statt
      // versehentlich das erste Konto abzumelden.
      const konto = gewaehltesKonto(request);
      let token = null;
      if (konto == null) {
        token = liesCookie(request, COOKIE_NAME);
      } else {
        const ziel = (await browserSitzungen(request, env)).find(s => s.nutzer.id === konto);
        token = ziel ? ziel.token : null;
      }
      if (token) {
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
          .bind(await hashHex(token)).run();
      }
      ({ cookies, rest } = await cookiesNachAbmelden(request, env));
    } catch (e) {
      // Cookie trotzdem entwerten - abmelden soll nie an der Datenbank
      // scheitern, sonst haengt jemand in einer Sitzung fest. Mit mehreren
      // Konten fliegen dann eben alle raus.
      cookies = null;
      rest = [];
    }
  }
  if (!cookies) cookies = loescheAlleKontenCookies(request);
  return new Response(JSON.stringify({
    ok: true,
    uebrig: rest.length,
    naechstes: rest.length ? rest[0].nutzer.id : null,
  }), {
    status: 200,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, cookies),
  });
}
