/**
 * Warteliste verwalten - nur fuer Konten mit role='admin'.
 *
 * GET   liefert offene und erledigte Anfragen plus die Nutzerliste.
 * POST  { id, aktion: "freischalten" | "ablehnen" }
 *
 * Die Rechtepruefung passiert HIER, nicht im Browser. admin.html ist eine
 * statische Datei, die jeder laden kann - sie versteckt die Oberflaeche nur.
 * Verhindern muss es der Server.
 */

import { angemeldeterAdmin } from "../../_lib/session.js";
import { sendeMail, huelle, absatz, knopf, fussnote } from "../../_lib/mail.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function adminOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };
  const admin = await angemeldeterAdmin(request, env);
  // 404 statt 403: wer keine Adminrechte hat, soll nicht erfahren, dass es
  // hier ueberhaupt etwas gibt.
  if (!admin) return { fehler: json({ error: "Nicht gefunden" }, 404) };
  return { admin };
}

export async function onRequestGet({ request, env }) {
  const { fehler } = await adminOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const warteliste = await env.DB.prepare(
      "SELECT id, name, email, status, created_at FROM waitlist ORDER BY created_at DESC"
    ).all();
    const nutzer = await env.DB.prepare(
      "SELECT id, email, name, role, created_at FROM users ORDER BY created_at"
    ).all();
    return json({ warteliste: warteliste.results, nutzer: nutzer.results });
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { fehler } = await adminOderFehler(request, env);
  if (fehler) return fehler;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const id = Number(body?.id);
  const aktion = String(body?.aktion || "");
  if (!Number.isInteger(id) || !["freischalten", "ablehnen"].includes(aktion)) {
    return json({ error: "Ungueltige Anfrage" }, 400);
  }

  let eintrag;
  try {
    eintrag = await env.DB.prepare(
      "SELECT id, name, email, status FROM waitlist WHERE id = ?"
    ).bind(id).first();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  if (!eintrag) return json({ error: "Eintrag nicht gefunden" }, 404);
  if (eintrag.status !== "offen") {
    return json({ error: "Diese Anfrage wurde schon bearbeitet." }, 409);
  }

  if (aktion === "ablehnen") {
    try {
      await env.DB.prepare("UPDATE waitlist SET status = 'abgelehnt' WHERE id = ?").bind(id).run();
    } catch (e) {
      return json({ error: "Datenbankfehler" }, 500);
    }
    // Bewusst keine Mail: eine Absage ungefragt zuzustellen bringt niemandem
    // etwas. Wer nachfragt, bekommt eine persoenliche Antwort.
    return json({ ok: true });
  }

  // Freischalten: Konto anlegen und den Wartelisten-Eintrag als erledigt
  // markieren. batch() macht daraus eine Transaktion - sonst koennte ein
  // Abbruch dazwischen ein Konto ohne erledigten Eintrag hinterlassen, das
  // beim naechsten Klick am UNIQUE-Index scheitert.
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (email, name, role) VALUES (?, ?, 'user')")
        .bind(eintrag.email, eintrag.name),
      env.DB.prepare("UPDATE waitlist SET status = 'freigeschaltet' WHERE id = ?").bind(id),
    ]);
  } catch (e) {
    return json({ error: "Konto konnte nicht angelegt werden - existiert die Adresse schon?" }, 409);
  }

  // Willkommensmail. Ein Fehler hier darf die Freischaltung nicht
  // zurueckdrehen: das Konto steht, die Person kann sich anmelden.
  const url = new URL(request.url).origin;
  const versand = await sendeMail(env, {
    to: eintrag.email,
    subject: "Du bist freigeschaltet",
    html: huelle("Willkommen!",
      absatz(`Hallo ${eintrag.name}, dein Zugang zur ToDo-Liste ist da.
              Melde dich einfach mit dieser Mailadresse an - du bekommst dann
              jedes Mal einen kurzen Code per Mail, ein Passwort brauchst du nicht.`) +
      knopf("Zur ToDo-Liste", url) +
      fussnote("Fragen? Antworte einfach auf diese Mail.")),
    text: `Hallo ${eintrag.name},\n\ndein Zugang zur ToDo-Liste ist da. Melde dich mit dieser Mailadresse an:\n${url}\n\nEin Passwort brauchst du nicht - du bekommst jedes Mal einen kurzen Code per Mail.`,
  });

  return json({ ok: true, mailVerschickt: versand.ok });
}
