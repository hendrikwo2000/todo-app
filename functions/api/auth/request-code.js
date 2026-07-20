/**
 * Schritt 1 des Logins: Code per Mail verschicken.
 *
 * Antwortet absichtlich mit derselben generischen Nachricht, egal ob die
 * Adresse in `users` steht oder nicht - sonst liesse sich durch Ausprobieren
 * herausfinden, welche Adressen angemeldet sind. Nur wenn die Adresse
 * tatsaechlich bekannt ist, wird im Hintergrund wirklich ein Code erzeugt
 * und verschickt.
 */

import { hashHex } from "../../_lib/session.js";

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
    return json({ error: "Ungueltige Adresse" }, 400);
  }

  const nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();

  if (nutzer) {
    // Mindestabstand zwischen zwei Anforderungen fuer dieselbe Adresse -
    // verhindert, dass ein Postfach mit Code-Mails geflutet wird.
    const kuerzlich = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > datetime('now', '-60 seconds')"
    ).bind(email).first();
    if (kuerzlich.n > 0) {
      return json({ error: "Bitte kurz warten, bevor du einen neuen Code anforderst." }, 429);
    }

    const code = neuerCode();

    // Erst verschicken, DANACH speichern: schlaegt der Mailversand fehl, darf
    // kein gueltiger, aber nie zugestellter Code liegen bleiben - der wuerde
    // sonst die Ratenbegrenzung oben blockieren und einen sofortigen zweiten
    // Versuch verhindern, obwohl noch gar keine Mail unterwegs war.
    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ToDo-Liste <login@mail.it-wolf.org>",
        to: [email],
        subject: `Dein Anmeldecode: ${code}`,
        text: `Dein Anmeldecode fuer die ToDo-Liste:\n\n${code}\n\nGueltig 10 Minuten. Wenn du das nicht warst, ignoriere diese Mail.`,
      }),
    });
    // Anders als bei der generischen Antwort oben: ein Mailversand-Fehler
    // wird NICHT verschluckt. Bei nur einem Nutzer ist die Debug-Hilfe mehr
    // wert als der theoretische Enumerationsschutz einer stets gleichen
    // Antwort - sonst wartet man auf einen Code, der nie kommt, ohne zu
    // wissen warum.
    if (!mail.ok) return json({ error: "Mail konnte nicht verschickt werden" }, 502);

    const hash = await hashHex(code);
    await env.DB.prepare(
      "INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))"
    ).bind(email, hash).run();
  }

  return json({ ok: true, message: "Falls die Adresse bekannt ist, wurde ein Code verschickt." });
}
