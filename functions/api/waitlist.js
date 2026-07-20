/**
 * Oeffentliches Eintragen in die Warteliste.
 *
 * Der einzige Endpunkt der App, den jeder ohne Anmeldung benutzen darf -
 * entsprechend vorsichtig: nur zwei Felder, beide laengenbegrenzt, und ein
 * Mindestabstand zwischen Eintragungen.
 *
 * Durch Cloudflare Turnstile gegen Bots geschuetzt. Zusaetzlich hoechstens
 * ein Eintrag pro Minute ueber alle Adressen - falls Turnstile mal ausfaellt
 * oder umgangen wird, bremst das immer noch.
 */

import { sendeMail, huelle, absatz, kasten, knopf, fussnote } from "../_lib/mail.js";
import { pruefeTurnstile } from "../_lib/turnstile.js";
import { hashHex, neuesToken } from "../_lib/session.js";

const MAX_NAME = 80;
const MAX_EMAIL = 254;   // RFC-Obergrenze fuer Mailadressen

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Gegen HTML-Einschleusung in der Benachrichtigungsmail: Name und Adresse
// stammen von Fremden und landen in einem HTML-Dokument.
function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();

  if (!name) return json({ error: "Bitte einen Namen angeben." }, 400);
  if (name.length > MAX_NAME) return json({ error: "Der Name ist zu lang." }, 400);
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus." }, 400);
  }

  const botFehler = await pruefeTurnstile(
    env, body?.turnstile, request.headers.get("CF-Connecting-IP"));
  if (botFehler) return json({ error: botFehler }, 400);

  try {
    // Schon freigeschaltet? Dann gehoert die Person nicht auf die Warteliste,
    // sondern soll sich einfach anmelden.
    const nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (nutzer) {
      return json({ error: "Diese Adresse ist bereits freigeschaltet - melde dich einfach an." }, 409);
    }

    const vorhanden = await env.DB.prepare(
      "SELECT status FROM waitlist WHERE email = ?"
    ).bind(email).first();
    if (vorhanden) {
      // Bewusst dieselbe freundliche Antwort bei 'offen' und 'abgelehnt' -
      // eine Absage muss man niemandem ins Gesicht sagen.
      //
      // `message` steht nur hier, im Sonderfall. Im Normalfall unten schweigt
      // der Server dazu, und die App schreibt ihren eigenen Text mit der
      // eingetragenen Adresse darin - so sieht der Eintragende gleich, ob er
      // sich vertippt hat.
      return json({ ok: true, message: "Diese Adresse war schon eingetragen — wir melden uns." });
    }

    // Grobe Bremse gegen automatisiertes Zumuellen: hoechstens ein Eintrag
    // pro Minute ueber ALLE Adressen. Bei erwarteten Einzeleintragungen faellt
    // das niemandem auf.
    const kuerzlich = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM waitlist WHERE created_at > datetime('now', '-60 seconds')"
    ).first();
    if (kuerzlich.n > 0) {
      return json({ error: "Gerade zu viele Anfragen. Bitte kurz warten." }, 429);
    }

    const eingefuegt = await env.DB.prepare(
      "INSERT INTO waitlist (name, email) VALUES (?, ?)"
    ).bind(name, email).run();

    const url = new URL(request.url).origin;

    // Einmal-Link, mit dem die Anfrage direkt aus der Mail freigeschaltet
    // werden kann - ohne Umweg ueber das Dashboard. Sieben Tage gueltig,
    // danach bleibt der Weg ueber die Verwaltung.
    const freiToken = neuesToken();
    await env.DB.prepare(
      `INSERT INTO admin_tokens (zweck, waitlist_id, token_hash, expires_at)
       VALUES ('freischalten', ?, ?, datetime('now', '+7 days'))`
    ).bind(eingefuegt.meta.last_row_id, await hashHex(freiToken)).run();
    const freiLink = `${url}/freischalten?t=${freiToken}`;

    // Bestaetigung an den Eintragenden. Ohne sie steht man da und weiss
    // nicht, ob das Formular ueberhaupt etwas getan hat.
    await sendeMail(env, {
      to: email,
      subject: "Du stehst auf der Warteliste",
      html: huelle("Du stehst auf der Warteliste",
        absatz(`Hallo ${escape(name)}, wir haben deine Anfrage für die
                ToDo-Liste bekommen. Sobald dein Zugang freigeschaltet ist,
                bekommst du noch eine Mail — dann kannst du dich mit dieser
                Adresse anmelden.`) +
        fussnote("Du musst nichts weiter tun. Diese Mail dient nur als Bestätigung.")),
      text: `Hallo ${name},\n\nwir haben deine Anfrage fuer die ToDo-Liste bekommen. Sobald dein Zugang freigeschaltet ist, bekommst du noch eine Mail - dann kannst du dich mit dieser Adresse anmelden.\n\nDu musst nichts weiter tun.`,
    });

    // Benachrichtigung an die Verwaltung. ADMIN_MAIL hat Vorrang, damit die
    // Benachrichtigungen nicht daran haengen, wer gerade Adminrechte hat;
    // ohne die Variable gehen sie wie bisher an alle Admin-Konten.
    const empfaenger = env.ADMIN_MAIL
      ? [env.ADMIN_MAIL]
      : (await env.DB.prepare("SELECT email FROM users WHERE role = 'admin'").all())
          .results.map(a => a.email);

    // Fehler hier duerfen die Eintragung nicht kippen - fuer den
    // Eintragenden hat es geklappt, und im Dashboard steht der Eintrag.
    for (const an of empfaenger) {
      await sendeMail(env, {
        to: an,
        subject: `Neue Wartelisten-Anfrage: ${name}`,
        html: huelle("Neue Wartelisten-Anfrage",
          kasten(`<strong>${escape(name)}</strong><br>${escape(email)}`) +
          knopf("Freischalten", freiLink) +
          absatz(`<span style="color:#8b8e96;font-size:13px;">Der Link gilt 7 Tage.
                  Ablehnen oder später entscheiden geht in der
                  <a href="${url}/admin" style="color:#4f63d2;">Verwaltung</a>.</span>`) +
          fussnote("Diese Mail geht an die hinterlegte Verwaltungsadresse.")),
        text: `Neue Wartelisten-Anfrage:\n\n${name}\n${email}\n\nFreischalten: ${freiLink}\n(7 Tage gueltig)\n\nVerwaltung: ${url}/admin`,
      });
    }
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  return json({ ok: true });
}
