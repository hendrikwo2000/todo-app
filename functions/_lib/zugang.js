/**
 * Wer darf die ToDo-Liste benutzen?
 *
 * Gespiegelt aus Fokus/web/functions/_lib/zugang.js - dort zuerst entstanden,
 * weil Fokus von Anfang an eine eigene Berechtigung neben dem blossen Konto
 * brauchte. Seit die Warteliste auch ueber fokus.it-wolf.org Konten anlegen
 * kann (quelle='fokus'), braucht ToDo dieselbe Trennung: ein Konto in `users`
 * heisst nicht mehr automatisch "hat ToDo-Zugang".
 *
 * Erlaubt ist, wer in der GETEILTEN users-Tabelle mit todo_zugang=1 steht.
 */

import { angemeldeterNutzer } from "./session.js";
import { json } from "./listen.js";

// Liest beide Zugangsspalten in einem Rutsch: todo_zugang fuer die eigentliche
// Pruefung, fokus_zugang nur zum Weiterreichen (Einstellungen zeigen, ob die
// andere App schon freigeschaltet ist, ohne dafuer eine zweite Abfrage zu
// brauchen).
async function zeile(env, email) {
  const adresse = String(email || "").trim().toLowerCase();
  if (!adresse) return null;
  return await env.DB.prepare(
    "SELECT todo_zugang, fokus_zugang FROM users WHERE email = ?"
  ).bind(adresse).first();
}

export async function darfRein(env, email) {
  const z = await zeile(env, email);
  return !!(z && z.todo_zugang);
}

/**
 * Angemeldet UND freigeschaltet - oder eine fertige Fehlerantwort in `fehler`.
 *
 * Die Pruefung sitzt in JEDEM Daten-Endpunkt, nicht nur an der Anmeldemaske.
 * Sonst kaeme jemand mit einer gueltigen Fokus-Sitzung per curl direkt an die
 * ToDo-API, ohne die Maske je gesehen zu haben.
 */
export async function nutzerOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };

  let nutzer, z;
  try {
    nutzer = await angemeldeterNutzer(request, env);
    if (nutzer) z = await zeile(env, nutzer.email);
  } catch (e) {
    return { fehler: json({ error: "Datenbankfehler" }, 500) };
  }
  if (!nutzer) return { fehler: json({ error: "Nicht angemeldet" }, 401) };

  // 403, nicht 401: angemeldet ist die Person ja. Ein 401 wuerde die App in die
  // Anmeldemaske schicken, wo sie sich endlos im Kreis anmelden koennte.
  if (!z || !z.todo_zugang) {
    return { fehler: json({ error: "Dieses Konto ist für die ToDo-Liste nicht freigeschaltet." }, 403) };
  }
  return { nutzer, nutzerId: nutzer.id, fokusZugang: !!z.fokus_zugang };
}
