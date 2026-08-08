/**
 * Sich selbst Zugang zum Fokus-Tracker holen.
 *
 * Setzt fokus_zugang=1 fuer das eigene, bereits angemeldete Konto - kein
 * Admin noetig. Wer ueberhaupt bis hierher kommt, hat schon ein Konto (ist
 * fuer die ToDo-Liste freigeschaltet); die zweite App holt man sich seit
 * 08.08.2026 selbst, siehe Kommentar bei todo_zugang in schema.sql.
 *
 * Kein Mailversand hier noetig: die Sitzung gilt schon fuer beide Apps
 * (geteiltes Cookie), ein Klick auf fokus.it-wolf.org reicht danach sofort.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzer, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    await env.DB.prepare("UPDATE users SET fokus_zugang = 1 WHERE id = ?").bind(nutzer.id).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  return json({ ok: true });
}
