/**
 * ToDo-Daten aus der D1-Datenbank (Bindung "DB").
 *
 * Loest den JSONBin-Proxy ab. Warum der Wechsel: JSONBin hat 10 000 Anfragen
 * im Monat, und die App schreibt bei JEDER Aenderung den kompletten Datensatz.
 * Mit mehreren Nutzern reicht das nicht. D1 erlaubt 100 000 geschriebene
 * Zeilen pro TAG und kann ausserdem sortieren, filtern und spaeter Listen
 * zwischen Nutzern teilen - was mit einem verschluesselten Klumpen nie ginge.
 *
 * Nach aussen bleibt die Schnittstelle gleich: GET liefert
 * { categories, todos }, PUT nimmt dasselbe entgegen. Die App muss die Form
 * ihres Zustands also nicht kennen lernen, nur den Weg dorthin.
 *
 * Der Zugriff laeuft ueber die Sitzung (siehe functions/_lib/session.js und
 * functions/api/auth/) - die Nutzer-ID kommt aus dem Sitzungs-Cookie, nicht
 * mehr aus einer festen Konstante. Damit ist die Mehrbenutzer-Trennung echt:
 * jede Sitzung sieht nur die Bereiche und ToDos ihres eigenen Nutzers.
 */

import { angemeldeterNutzer } from "../_lib/session.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Nirgends zwischenspeichern: sonst zeigt ein zweites Geraet nach einer
      // Aenderung minutenlang den alten Stand.
      "Cache-Control": "no-store",
    },
  });
}

// Liefert entweder die Nutzer-ID der aktuellen Sitzung oder eine fertige
// Fehlerantwort.
async function angemeldetOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };
  const nutzerId = await angemeldeterNutzer(request, env);
  if (!nutzerId) return { fehler: json({ error: "Nicht angemeldet" }, 401) };
  return { nutzerId };
}

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await angemeldetOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const listen = await env.DB.prepare(
      "SELECT id, name FROM lists WHERE user_id = ? ORDER BY position, name"
    ).bind(nutzerId).all();

    const todos = await env.DB.prepare(
      `SELECT t.id, t.list_id, t.text, t.note, t.due, t.done, t.position,
              t.created_at, t.completed_at
         FROM todos t
         JOIN lists l ON l.id = t.list_id
        WHERE l.user_id = ?`
    ).bind(nutzerId).all();

    // Zurueck in die Form, die die App seit jeher kennt: Bereiche heissen dort
    // "categories", die Zugehoerigkeit "categoryId", die Reihenfolge "order".
    return json({
      categories: listen.results.map(l => ({ id: l.id, name: l.name })),
      todos: todos.results.map(t => ({
        id: t.id,
        categoryId: t.list_id,
        text: t.text,
        note: t.note,
        due: t.due,
        done: t.done === 1,          // SQLite kennt keinen Boolean
        order: t.position,           // null bei terminierten ToDos, wie bisher
        createdAt: t.created_at,
        completedAt: t.completed_at,
      })),
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await angemeldetOderFehler(request, env);
  if (fehler) return fehler;

  let zustand;
  try {
    zustand = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  if (!zustand || !Array.isArray(zustand.categories) || !Array.isArray(zustand.todos)) {
    return json({ error: "Ungueltige Datenstruktur" }, 400);
  }
  if (zustand.categories.some(c => !c || typeof c.id !== "string" || typeof c.name !== "string")) {
    return json({ error: "Ungueltiger Bereich" }, 400);
  }
  if (zustand.todos.some(t => !t || typeof t.id !== "string" || typeof t.text !== "string")) {
    return json({ error: "Ungueltiges ToDo" }, 400);
  }

  // Die App schickt immer den vollstaendigen Zustand, also wird der alte
  // ersetzt statt abgeglichen. batch() laeuft als eine Transaktion - entweder
  // steht am Ende alles drin oder nichts, ein Abbruch mittendrin kann das
  // Board nicht halb geloescht zuruecklassen.
  //
  // Die ToDos werden ausdruecklich zuerst geloescht statt sich auf ON DELETE
  // CASCADE zu verlassen: ob SQLite das ausfuehrt, haengt an PRAGMA
  // foreign_keys, und darauf will ich mich hier nicht verlassen.
  const anweisungen = [
    env.DB.prepare(
      "DELETE FROM todos WHERE list_id IN (SELECT id FROM lists WHERE user_id = ?)"
    ).bind(nutzerId),
    env.DB.prepare("DELETE FROM lists WHERE user_id = ?").bind(nutzerId),
  ];

  // Die Reihenfolge der Spalten steckt im Array, nicht in den Daten - beim
  // Speichern wird sie deshalb aus dem Index gewonnen.
  zustand.categories.forEach((c, i) => {
    anweisungen.push(
      env.DB.prepare(
        "INSERT INTO lists (id, user_id, name, position) VALUES (?, ?, ?, ?)"
      ).bind(c.id, nutzerId, c.name, i)
    );
  });

  // ToDos ohne zugehoerigen Bereich wuerden am Fremdschluessel scheitern und
  // die ganze Transaktion kippen. Sie sind ohnehin unsichtbar - also raus.
  const bekannt = new Set(zustand.categories.map(c => c.id));
  for (const t of zustand.todos) {
    if (!bekannt.has(t.categoryId)) continue;
    anweisungen.push(
      env.DB.prepare(
        `INSERT INTO todos
           (id, list_id, text, note, due, done, position, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        t.id,
        t.categoryId,
        t.text,
        t.note ?? null,
        t.due ?? null,
        t.done ? 1 : 0,
        typeof t.order === "number" ? t.order : null,
        t.createdAt || new Date().toISOString(),
        t.completedAt ?? null
      )
    );
  }

  try {
    await env.DB.batch(anweisungen);
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }

  return json({ ok: true });
}
