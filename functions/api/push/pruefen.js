/**
 * Ziel eines externen, zeitgesteuerten Anpingens (z. B. cron-job.org) -
 * KEIN Nutzer-Endpunkt, deshalb keine Sitzung, sondern ein geteiltes
 * Geheimnis im Header. Cloudflare Pages kennt selbst keine Cron Triggers
 * (die gibt es nur fuer eigenstaendige Worker, siehe BETRIEB.md); ein
 * kostenloser externer Anpinger passt ohne zweites Cloudflare-Projekt in den
 * bestehenden Git-Push-Workflow.
 *
 * Prueft je Nutzer MIT mindestens einem Push-Abo, wie viele seiner ToDos
 * (ueber alle Listen, in denen er Mitglied ist) heute faellig oder bereits
 * ueberfaellig und nicht erledigt sind. Bei > 0 geht eine Push-Nachricht an
 * alle seine Geraete, mit der Zahl im Payload - der Service Worker setzt
 * daraus direkt das App-Icon-Badge (siehe sw.js), auch ohne dass die App
 * geoeffnet wird.
 *
 * Ungueltige Abos (Geraet abgemeldet, Browser-Push widerrufen: 404/410 vom
 * Push-Dienst) werden dabei gleich aus der Datenbank entfernt.
 */

import { json } from "../../_lib/listen.js";
import { sendeWebPush } from "../../_lib/webpush.js";

// "Heute" bewusst in der Zeitzone Europe/Berlin, nicht UTC - sonst faellt der
// Tageswechsel je nach Sommer-/Winterzeit bis zu zwei Stunden falsch, und ein
// ToDo mit due=heute wuerde rund um Mitternacht mal gezaehlt, mal nicht.
function heuteBerlin() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

async function pruefeUndSende(env) {
  const heute = heuteBerlin();

  const zaehlung = await env.DB.prepare(
    `SELECT u.id AS user_id, COUNT(DISTINCT t.id) AS n
       FROM users u
       JOIN push_subscriptions ps ON ps.user_id = u.id
       JOIN board_members m ON m.user_id = u.id
       JOIN lists l ON l.board_id = m.board_id
       JOIN todos t ON t.list_id = l.id
      WHERE t.done = 0 AND t.due IS NOT NULL AND t.due <= ?
      GROUP BY u.id
     HAVING n > 0`
  ).bind(heute).all();

  let versendet = 0, fehlgeschlagen = 0, entfernt = 0;

  for (const zeile of zaehlung.results) {
    const abos = await env.DB.prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
    ).bind(zeile.user_id).all();

    const payload = {
      title: "ToDo-Liste",
      body: zeile.n === 1
        ? "1 ToDo ist fällig oder überfällig."
        : `${zeile.n} ToDos sind fällig oder überfällig.`,
      badge: zeile.n,
      url: "/",
    };

    for (const abo of abos.results) {
      let ergebnis;
      try {
        ergebnis = await sendeWebPush(env, abo, payload);
      } catch (e) {
        fehlgeschlagen++;
        continue;
      }
      if (ergebnis.ok) {
        versendet++;
      } else if (ergebnis.status === 404 || ergebnis.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(abo.id).run();
        entfernt++;
      } else {
        fehlgeschlagen++;
      }
    }
  }

  return { nutzerBenachrichtigt: zaehlung.results.length, versendet, fehlgeschlagen, entfernt };
}

async function behandeln({ request, env }) {
  if (!env.PUSH_CRON_SECRET) {
    return json({ error: "PUSH_CRON_SECRET fehlt im Pages-Projekt" }, 500);
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ error: "VAPID-Schluessel fehlen im Pages-Projekt" }, 500);
  }
  const geheimnis = request.headers.get("X-Cron-Secret") || new URL(request.url).searchParams.get("geheimnis");
  if (geheimnis !== env.PUSH_CRON_SECRET) {
    return json({ error: "Nicht erlaubt" }, 403);
  }

  try {
    const ergebnis = await pruefeUndSende(env);
    return json({ ok: true, ...ergebnis });
  } catch (e) {
    return json({ error: "Fehler beim Pruefen: " + e.message }, 500);
  }
}

export const onRequestGet = behandeln;
export const onRequestPost = behandeln;
