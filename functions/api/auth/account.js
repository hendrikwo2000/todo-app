/**
 * Eigenes Konto loeschen.
 *
 * Verlangt die eigene Mailadresse als Bestaetigung im Anfragekoerper. Das ist
 * nicht Sicherheit gegen Fremde - dafuer sorgt die Sitzung - sondern gegen
 * einen unbedachten Klick: der Vorgang loescht alle ToDos unwiderruflich.
 */

import { loescheAlleKontenCookies, cookiesNachAbmelden, mitCookies } from "../../_lib/session.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { loescheKonto, istLetzterAdmin, meldeLoeschung } from "../../_lib/loeschen.js";

function json(body, status = 200, cookies = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, cookies),
  });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  const { nutzer, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

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

  // Die Sitzungen des Kontos sind mit ihm weg. Waren im Browser weitere
  // Konten angemeldet, bleiben die - frueher entwertete das Loeschen immer das
  // erste Cookie, egal welches Konto weg war.
  let cookies, rest = [];
  try {
    ({ cookies, rest } = await cookiesNachAbmelden(request, env));
  } catch (e) {
    cookies = loescheAlleKontenCookies(request);
  }
  return json({
    ok: true,
    uebrig: rest.length,
    naechstes: rest.length ? rest[0].nutzer.id : null,
  }, 200, cookies);
}
