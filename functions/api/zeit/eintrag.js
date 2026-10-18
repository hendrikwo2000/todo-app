/**
 * Einen Eintrag nachtragen (POST), korrigieren (PUT) oder loeschen (DELETE).
 *
 * Hendriks Wahl: "Bearbeiten, loeschen, nachtragen" - wer vergisst zu starten
 * oder zu stoppen, soll die Zahlen hinterher richtig stellen koennen, sonst
 * taugen sie nicht als Nachweis.
 *
 * Die laufende Uhr ist hier nicht zu haben (ende IS NULL): ihr Ende kennt noch
 * niemand, und ihr ToDo wechselt man ueber "Wechseln".
 *
 * PUT mit nur { id, gekapptOk: true } bestaetigt einen gekappten Eintrag, ohne
 * ihn zu aendern ("Passt so" am Hinweis). Jede echte Korrektur bestaetigt ihn
 * ebenfalls.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { istDatum } from "../../_lib/tag.js";
import { eintragVon, alsEintrag, buchungAus, pruefeStrecke } from "../../_lib/zeit.js";

async function vorbereiten(request, env) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return { fehler };
  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return { fehler: leseFehler };
  return { nutzerId, body: body || {} };
}

// Strecke, Datum und Buchung aus dem Koerper - gemeinsam fuer POST und PUT.
function felderAus(body) {
  const strecke = pruefeStrecke(body);
  if (strecke.fehler) return { fehler: strecke.fehler };
  const datum = String(body.datum || "");
  if (!istDatum(datum)) return { fehler: "Ungültiges Datum" };
  return { ...strecke, datum, ...buchungAus(body) };
}

export async function onRequestPost({ request, env }) {
  const { nutzerId, body, fehler } = await vorbereiten(request, env);
  if (fehler) return fehler;

  const f = felderAus(body);
  if (f.fehler) return json({ error: f.fehler }, 400);

  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO zeiteintraege
         (id, user_id, start, ende, datum, todo_id, todo_text, liste_name, bereich_name, nachgetragen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(id, nutzerId, f.start, f.ende, f.datum, f.todoId, f.todoText, f.listeName, f.bereichName).run();
    return json({ ok: true, eintrag: alsEintrag(await eintragVon(env, nutzerId, id)) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const { nutzerId, body, fehler } = await vorbereiten(request, env);
  if (fehler) return fehler;

  const id = String(body.id || "");
  try {
    const alt = id ? await eintragVon(env, nutzerId, id) : null;
    if (!alt) return json({ error: "Eintrag nicht gefunden" }, 404);
    if (!alt.ende) return json({ error: "Die Uhr läuft noch – erst stoppen." }, 409);

    if (body.gekapptOk === true) {
      await env.DB.prepare(
        "UPDATE zeiteintraege SET gekappt = 0 WHERE id = ? AND user_id = ?"
      ).bind(id, nutzerId).run();
      return json({ ok: true, eintrag: alsEintrag(await eintragVon(env, nutzerId, id)) });
    }

    const f = felderAus(body);
    if (f.fehler) return json({ error: f.fehler }, 400);
    await env.DB.prepare(
      `UPDATE zeiteintraege
          SET start = ?, ende = ?, datum = ?, todo_id = ?, todo_text = ?,
              liste_name = ?, bereich_name = ?, gekappt = 0
        WHERE id = ? AND user_id = ?`
    ).bind(f.start, f.ende, f.datum, f.todoId, f.todoText, f.listeName, f.bereichName, id, nutzerId).run();
    return json({ ok: true, eintrag: alsEintrag(await eintragVon(env, nutzerId, id)) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const { nutzerId, body, fehler } = await vorbereiten(request, env);
  if (fehler) return fehler;

  const id = String(body.id || "");
  if (!id) return json({ error: "Kein Eintrag angegeben" }, 400);
  try {
    // Die laufende Uhr bleibt auch hier aussen vor - die haelt man an.
    const r = await env.DB.prepare(
      "DELETE FROM zeiteintraege WHERE id = ? AND user_id = ? AND ende IS NOT NULL"
    ).bind(id, nutzerId).run();
    if (!r.meta?.changes) return json({ error: "Eintrag nicht gefunden" }, 404);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Löschen" }, 500);
  }
}
