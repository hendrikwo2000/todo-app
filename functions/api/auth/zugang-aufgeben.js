/**
 * Eigenen ToDo-Zugang aufgeben - ohne die ToDos selbst zu loeschen.
 *
 * Anders als "Konto löschen" (account.js): die Daten bleiben unangetastet,
 * nur der Zugang ist weg. Wer zurueck will, meldet sich einfach erneut an -
 * der naechste Login-Versuch schaltet automatisch wieder frei (siehe
 * request-code.js).
 *
 * Fuer role='admin' gesperrt: gleiche Vorsicht wie beim Rollen-Schalter und
 * beim Loeschen im Dashboard - der Haupt-Account soll sich nicht per Klick
 * selbst aus der eigenen ToDo-Liste aussperren koennen, auch wenn /admin
 * selbst (rollenbasiert, nicht todo_zugang-basiert) davon unberuehrt bliebe.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzer, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  if (nutzer.role === "admin") {
    return json({ error: "Als Admin kannst du dir hier nicht selbst den Zugang entziehen." }, 400);
  }

  try {
    await env.DB.prepare("UPDATE users SET todo_zugang = 0 WHERE id = ?").bind(nutzer.id).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  return json({ ok: true });
}
