/**
 * Schritt 1 des Logins: Code per Mail verschicken.
 *
 * Unbekannte Adressen bekommen eine klare Absage (404). Frueher stand hier
 * bewusst dieselbe generische Antwort wie bei bekannten Adressen, damit sich
 * nicht durchprobieren laesst, wer registriert ist. Bei einer Handvoll
 * bekannter Leute ohne oeffentliche Registrierung ist dieser Schutz aber
 * praktisch wertlos - waehrend die Verwirrung real war: man wartet auf einen
 * Code, der nie kommt. Sollte es hier je eine offene Registrierung geben,
 * gehoert die generische Antwort zurueck.
 */

import { hashHex } from "../../_lib/session.js";
import { sendeMail, huelle, absatz, kasten, fussnote } from "../../_lib/mail.js";

const GUELTIG_MINUTEN = 10;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function neuerCode() {
  // Modulo-Bias bei 2^32 / 10^6 ist verschwindend klein - fuer einen
  // 10-Minuten-Code ohne praktische Bedeutung.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}

// Der Code steht bewusst NICHT im Betreff: der taucht sonst in
// Push-Benachrichtigungen auf dem Sperrbildschirm und in jeder
// Postfach-Uebersicht auf.
function mailHtml(code) {
  return huelle("Dein Anmeldecode",
    kasten(code, true) +
    absatz(`Gib den Code in der ToDo-Liste ein. Er gilt ${GUELTIG_MINUTEN} Minuten
            und lässt sich nur einmal verwenden.`) +
    fussnote("Du hast das nicht angefordert? Dann ignoriere diese Mail einfach — ohne den Code passiert nichts.")
  );
}

function mailText(code) {
  return `Dein Anmeldecode fuer die ToDo-Liste:

${code}

Gueltig ${GUELTIG_MINUTEN} Minuten, nur einmal verwendbar.

Du hast das nicht angefordert? Dann ignoriere diese Mail einfach -
ohne den Code passiert nichts.`;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);
  if (!env.RESEND_KEY) return json({ error: "RESEND_KEY fehlt im Pages-Projekt" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus." }, 400);
  }

  // Datenbankzugriffe abgesichert: ein Fehler hier hat die Function frueher
  // abstuerzen lassen (Cloudflare-Fehler 1101 statt einer lesbaren Meldung).
  let nutzer, kuerzlich;
  try {
    nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!nutzer) {
      return json({ error: "Diese Adresse ist nicht freigeschaltet." }, 404);
    }
    // Mindestabstand zwischen zwei Anforderungen fuer dieselbe Adresse -
    // verhindert, dass ein Postfach mit Code-Mails geflutet wird.
    kuerzlich = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > datetime('now', '-60 seconds')"
    ).bind(email).first();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  if (kuerzlich.n > 0) {
    return json({ error: "Bitte kurz warten, bevor du einen neuen Code anforderst." }, 429);
  }

  const code = neuerCode();

  // Erst verschicken, DANACH speichern: schlaegt der Mailversand fehl, darf
  // kein gueltiger, aber nie zugestellter Code liegen bleiben - der wuerde
  // sonst die Ratenbegrenzung oben blockieren und einen sofortigen zweiten
  // Versuch verhindern, obwohl noch gar keine Mail unterwegs war.
  const versand = await sendeMail(env, {
    to: email,
    subject: "Dein Anmeldecode für die ToDo-Liste",
    html: mailHtml(code),
    text: mailText(code),
  });
  if (!versand.ok) return json({ error: versand.grund }, 502);

  try {
    await env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at)
       VALUES (?, ?, datetime('now', '+${GUELTIG_MINUTEN} minutes'))`
    ).bind(email, await hashHex(code)).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  return json({ ok: true });
}
