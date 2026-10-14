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
 *
 * Zusaetzlich geht beim ersten Lauf des Tages (Berliner Zeit vor 10 Uhr) eine
 * WhatsApp an das Konto in WHATSAPP_NUTZER (E-Mail): mit den NAMEN der
 * faelligen und ueberfaelligen ToDos (gleiche Regel wie oben: nicht erledigt,
 * mit Termin (due), heute oder frueher) und den ROTEN Terminen des Tages aus
 * dem verknuepften Google-Kalender. Jedes der beiden reicht als Ausloeser.
 * Ohne WHATSAPP_NUTZER passiert nichts. Ein Fehler dabei stoert den Push nie,
 * und ein nicht lesbarer Kalender haelt die ToDo-Liste nicht auf.
 * ?whatsapp=jetzt erzwingt den Versand auch ausserhalb des Morgenlaufs
 * (braucht dasselbe Geheimnis wie der Rest).
 */

import { json } from "../../_lib/listen.js";
import { sendeWebPush } from "../../_lib/webpush.js";
import { fehltEinrichtung, kontoFuer, frischesZugriffToken, roteTermineAm } from "../../_lib/google.js";
import { baueMorgenNachricht, istMorgenlauf, sendeWhatsapp } from "../../_lib/whatsapp.js";

// "Heute" bewusst in der Zeitzone Europe/Berlin, nicht UTC - sonst faellt der
// Tageswechsel je nach Sommer-/Winterzeit bis zu zwei Stunden falsch, und ein
// ToDo mit due=heute wuerde rund um Mitternacht mal gezaehlt, mal nicht.
function heuteBerlin() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

// Rote Termine von heute aus dem Google-Konto des WhatsApp-Nutzers. Wirft nie:
// ein Google-Problem (Zugriff widerrufen, Google nicht erreichbar) darf die
// ToDo-Liste nicht aufhalten. Ohne Google-Einrichtung oder ohne verknuepftes
// Konto ist "keine Termine" die richtige Antwort, kein Fehler.
async function leseRoteTermine(env, heute) {
  if (fehltEinrichtung(env)) return { termine: [], fehler: null };
  try {
    const nutzer = await env.DB.prepare(
      "SELECT id FROM users WHERE lower(email) = lower(?)"
    ).bind(env.WHATSAPP_NUTZER).first();
    const konto = nutzer && await kontoFuer(env, nutzer.id);
    if (!konto) return { termine: [], fehler: null };

    const token = await frischesZugriffToken(env, konto);
    return { termine: await roteTermineAm(token, heute), fehler: null };
  } catch (e) {
    return { termine: [], fehler: e.message };
  }
}

// Gibt zurueck, was passiert ist (steht in der JSON-Antwort fuer cron-job.org).
async function sendeMorgenliste(env, heute, erzwingen) {
  if (!env.WHATSAPP_NUTZER) return "nicht eingerichtet";
  if (!erzwingen && !istMorgenlauf()) return "uebersprungen (nicht der Morgenlauf)";

  // DISTINCT, weil jemand ueber mehrere Wege in derselben Liste stehen kann.
  const faellig = await env.DB.prepare(
    `SELECT DISTINCT t.id, t.text, t.due, t.position
       FROM users u
       JOIN board_members m ON m.user_id = u.id
       JOIN lists l ON l.board_id = m.board_id
       JOIN todos t ON t.list_id = l.id
      WHERE lower(u.email) = lower(?)
        AND t.done = 0 AND t.due IS NOT NULL AND t.due <= ?
      ORDER BY t.due, t.position, t.id`
  ).bind(env.WHATSAPP_NUTZER, heute).all();

  const rot = await leseRoteTermine(env, heute);
  const hinweis = rot.fehler ? `; Kalender nicht lesbar: ${rot.fehler}` : "";

  const text = baueMorgenNachricht(faellig.results, rot.termine, heute, { kalenderFehler: !!rot.fehler });
  if (!text) return "nichts faellig" + hinweis;

  await sendeWhatsapp(env, text);
  return `gesendet (${faellig.results.length} ToDos, ${rot.termine.length} rote Termine)` + hinweis;
}

async function pruefeUndSende(env, erzwingeWhatsapp = false) {
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

  let whatsapp;
  try {
    whatsapp = await sendeMorgenliste(env, heute, erzwingeWhatsapp);
  } catch (e) {
    whatsapp = "fehlgeschlagen: " + e.message;
  }

  return { nutzerBenachrichtigt: zaehlung.results.length, versendet, fehlgeschlagen, entfernt, whatsapp };
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
    const erzwingen = new URL(request.url).searchParams.get("whatsapp") === "jetzt";
    const ergebnis = await pruefeUndSende(env, erzwingen);
    return json({ ok: true, ...ergebnis });
  } catch (e) {
    return json({ error: "Fehler beim Pruefen: " + e.message }, 500);
  }
}

export const onRequestGet = behandeln;
export const onRequestPost = behandeln;
