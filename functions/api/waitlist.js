/**
 * Oeffentliches Eintragen in die Warteliste.
 *
 * Der einzige Endpunkt der App, den jeder ohne Anmeldung benutzen darf -
 * entsprechend vorsichtig: nur zwei Felder, beide laengenbegrenzt, und ein
 * Mindestabstand zwischen Eintragungen.
 *
 * Bewusst OHNE Bot-Schutz (kein Turnstile). Solange die Adresse nirgends
 * verlinkt ist, ist das Risiko gering; kommt Muell an, waere Turnstile der
 * naechste Schritt - it-wolf.org nutzt es bereits.
 */

import { sendeMail, huelle, absatz, kasten, knopf, fussnote } from "../_lib/mail.js";

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
      return json({ ok: true, message: "Du stehst schon auf der Liste." });
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

    await env.DB.prepare("INSERT INTO waitlist (name, email) VALUES (?, ?)")
      .bind(name, email).run();

    const url = new URL(request.url).origin;

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
          absatz("Im Dashboard kannst du die Anfrage freischalten oder ablehnen.") +
          knopf("Zur Verwaltung", `${url}/admin`) +
          fussnote("Diese Mail geht an die hinterlegte Verwaltungsadresse.")),
        text: `Neue Wartelisten-Anfrage:\n\n${name}\n${email}\n\nDashboard: ${url}/admin`,
      });
    }
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  return json({ ok: true, message: "Eingetragen - du bekommst eine Mail, sobald du freigeschaltet bist." });
}
