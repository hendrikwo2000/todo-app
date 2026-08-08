/**
 * Willkommensmail nach dem Freischalten - mit Anmeldelink darin.
 *
 * Warum hier und nicht zweimal im Code: freigeschaltet wird an zwei Stellen,
 * im Dashboard (api/admin/waitlist.js) und per Einmal-Link aus der
 * Benachrichtigungsmail (api/admin/genehmigen.js). Beide schicken dieselbe
 * Mail, und beide sollen sie gleich schicken.
 *
 * Der Knopf meldet direkt an, statt nur auf die Startseite zu zeigen. Vorher
 * war der Weg fuer einen neuen Nutzer: Mail lesen, Startseite oeffnen, Adresse
 * eintragen, auf eine ZWEITE Mail warten, deren Link klicken. Vier Schritte,
 * um das zu tun, was die erste Mail schon haette tun koennen.
 *
 * Der Link liegt in `login_codes` wie ein normaler Anmeldelink und wird vom
 * selben Endpunkt eingeloest - dieselbe Pruefung, derselbe Einmal-Verbrauch.
 */

import { hashHex, neuesToken } from "./session.js";
import { sendeMail, huelle, absatz, knopf, fussnote } from "./mail.js";

// Sieben Tage. Der Code-Login gilt zehn Minuten, das passt hier nicht: eine
// Willkommensmail liegt auch mal ein Wochenende ungelesen im Postfach, und
// ein toter Knopf darin waere genau der schlechte erste Eindruck, den das
// Ganze vermeiden soll. Wer Zugriff auf das Postfach hat, koennte sich
// ohnehin jederzeit selbst einen Anmeldelink schicken lassen - die Frist
// verschenkt also nichts, was nicht sowieso offen laege.
const GUELTIG_TAGE = 7;

// Fest verdrahtet, weil ToDo's eigener request.url-Ursprung fuer eine
// Fokus-Freischaltung nicht passt (diese Function laeuft immer auf der
// ToDo-Seite, auch wenn ueber die Fokus-Warteliste freigeschaltet wurde).
// Gleiche Abwaegung wie TODO_URL in Fokus/web/functions/api/waitlist.js:
// lokal ist dieser eine Link (fuer quelle='fokus') dadurch nicht testbar,
// production schon.
const FOKUS_URL = "https://fokus.it-wolf.org";

/**
 * Legt einen Anmeldelink an und verschickt die Willkommensmail.
 * Liefert das Ergebnis von sendeMail ({ ok, grund }).
 *
 * `url` ist der Ursprung DIESER Anfrage (https://todo.it-wolf.org, lokal
 * auch mal 127.0.0.1:PORT) - nur fuer quelle='todo' tatsaechlich verwendet.
 * `quelle`: 'todo' oder 'fokus', woher die Wartelisten-Anfrage kam (siehe
 * waitlist.quelle in schema.sql) - bestimmt, auf welche App der Anmeldelink
 * zeigt. Ein frisch freigeschaltetes Konto hat immer GENAU EINE der beiden
 * Berechtigungen, nie beide (die zweite App holt sich der Nutzer seither
 * selbst, siehe Kommentar bei todo_zugang) - deshalb kein Fall fuer "beide".
 */
export async function sendeWillkommen(env, { name, email, url, quelle = "todo" }) {
  const istFokus = quelle === "fokus";
  const zielUrl = istFokus ? FOKUS_URL : url;
  const zugangText = istFokus ? "zum Fokus-Tracker" : "zur ToDo-Liste";
  const knopfText = istFokus ? "Zum Fokus-Tracker" : "Zur ToDo-Liste";

  // Schlaegt das Anlegen fehl, geht die Mail trotzdem raus - nur eben ohne
  // Direktanmeldung. Eine Freischaltung ohne jede Nachricht waere schlimmer
  // als eine mit einem Schritt mehr.
  let link = null;
  try {
    const token = neuesToken();
    // code_hash ist NOT NULL, der Code-Weg soll hier aber gar nicht erst
    // existieren: ein Hash ueber ein zufaelliges 32-Byte-Token laesst sich
    // nicht erraten, damit ist die Spalte gefuellt und der Weg tot.
    await env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+${GUELTIG_TAGE} days'))`
    ).bind(email, await hashHex(neuesToken()), await hashHex(token)).run();
    link = `${zielUrl}/api/auth/link?t=${token}`;
  } catch (e) {
    link = null;
  }

  const html = link
    ? huelle("Willkommen!",
        absatz(`Hallo ${name}, dein Zugang ${zugangText} ist da.
                Ein Klick und du bist drin — kein Passwort, kein Code.`) +
        knopf("Jetzt anmelden", link) +
        absatz(`<span style="color:#8b8e96;font-size:13px;">Der Link gilt
                ${GUELTIG_TAGE} Tage. Danach kommst du jederzeit über
                <a href="${zielUrl}" style="color:#4f63d2;">${zielUrl.replace(/^https?:\/\//, "")}</a>
                rein — Adresse eintragen, Link aus der Mail klicken.</span>`) +
        fussnote("Fragen? Antworte einfach auf diese Mail."))
    : huelle("Willkommen!",
        absatz(`Hallo ${name}, dein Zugang ${zugangText} ist da.
                Klick unten, gib deine Adresse ein und du bekommst einen
                Anmeldelink — ein Passwort brauchst du nicht.`) +
        knopf(knopfText, zielUrl) +
        fussnote("Fragen? Antworte einfach auf diese Mail."));

  const text = link
    ? `Hallo ${name},\n\ndein Zugang ${zugangText} ist da. Mit diesem Link bist du sofort angemeldet:\n\n${link}\n\nDer Link gilt ${GUELTIG_TAGE} Tage. Danach kommst du jederzeit ueber ${zielUrl} rein - Adresse eintragen, Link aus der Mail klicken.`
    : `Hallo ${name},\n\ndein Zugang ${zugangText} ist da:\n${zielUrl}\n\nGib dort deine Adresse ein, dann bekommst du einen Anmeldelink. Ein Passwort brauchst du nicht.`;

  return await sendeMail(env, { to: email, subject: "Du bist freigeschaltet", html, text });
}
