/**
 * Wer darf die ToDo-Liste benutzen?
 *
 * Erlaubt ist, wer in der users-Tabelle mit todo_zugang=1 steht - ein Konto
 * allein reicht nicht (es kann den Zugang selbst aufgegeben haben, siehe
 * api/auth/zugang-aufgeben.js).
 *
 * Bis Oktober 2026 gab es daneben fokus_zugang fuer die eigene Fokus-App,
 * und diese Datei war deren Spiegelung. Seit der Fusion gehoeren Gewohnheiten
 * und Timer zu dieser App und haengen an genau dieser Pruefung - die Spalte
 * fokus_zugang steht noch in der Datenbank, gelesen wird sie nicht mehr.
 */

import { angemeldeterNutzer } from "./session.js";
import { json } from "./listen.js";

async function zeile(env, email) {
  const adresse = String(email || "").trim().toLowerCase();
  if (!adresse) return null;
  return await env.DB.prepare(
    "SELECT todo_zugang FROM users WHERE email = ?"
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
 * Sonst kaeme jemand mit einer gueltigen Sitzung per curl direkt an die API,
 * ohne die Maske je gesehen zu haben.
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
  return { nutzer, nutzerId: nutzer.id };
}
