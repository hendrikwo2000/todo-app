/**
 * ToDo-Daten aus der D1-Datenbank (Bindung "DB").
 *
 * Zwei Aufgaben:
 *   GET  - Bootstrap: alle Listen, die der angemeldete Nutzer sehen darf,
 *          samt ihrer Bereiche und ToDos in EINER Antwort. Die App haelt
 *          danach alle Listen im Speicher und schaltet lokal um.
 *   PUT  - EINE Liste speichern: { boardId, categories, todos }. Anders als
 *          frueher wird nur diese eine Liste ersetzt, nicht der ganze Nutzer -
 *          so kann das Speichern einer Liste nie eine andere plaetten.
 *
 * Zugriff laeuft ueber die Sitzung (functions/_lib/session.js). Wer eine Liste
 * sehen/bearbeiten darf, steht in board_members - owner UND member duerfen den
 * Inhalt aendern (Mitbearbeiten war die Vorgabe), nur die Verwaltung der Liste
 * selbst bleibt dem owner (siehe functions/api/listen/).
 *
 * Bewusst NICHT konfliktfrei: schreibt eine Liste, wird ihr kompletter Inhalt
 * ersetzt. Bearbeiten zwei Leute dieselbe Liste im selben Moment, gewinnt der
 * spaetere Speichervorgang. Fuer wenige Leute, die selten zeitgleich tippen,
 * ist das vertretbar; echtes gleichzeitiges Bearbeiten waere ein ToDo-fuer-
 * ToDo-Abgleich statt "alles auf einmal" - ein spaeterer Schritt.
 */

import { angemeldeterNutzer } from "../_lib/session.js";
import { json, listenFuer, rolleIn } from "../_lib/listen.js";

// Liefert entweder die Nutzer-ID der aktuellen Sitzung oder eine fertige
// Fehlerantwort.
async function angemeldetOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };
  const nutzer = await angemeldeterNutzer(request, env);
  if (!nutzer) return { fehler: json({ error: "Nicht angemeldet" }, 401) };
  return { nutzerId: nutzer.id, nutzer };
}

export async function onRequestGet({ request, env }) {
  const { nutzerId, nutzer, fehler } = await angemeldetOderFehler(request, env);
  if (fehler) return fehler;

  try {
    // 1) Alle Listen des Nutzers (mit Rolle, Besitzer, Token).
    const listen = await listenFuer(env, nutzerId);

    // 2) Mitgliederzahl je eigener Liste - fuer das "geteilt mit N"-Schild in
    //    den Einstellungen. Nur echte Mitglieder, der owner zaehlt nicht mit.
    const zaehlung = await env.DB.prepare(
      `SELECT board_id, COUNT(*) AS n
         FROM board_members
        WHERE role = 'member'
          AND board_id IN (SELECT id FROM boards WHERE owner_id = ?)
        GROUP BY board_id`
    ).bind(nutzerId).all();
    const mitglieder = {};
    for (const r of zaehlung.results) mitglieder[r.board_id] = r.n;

    // 3) Alle Bereiche, Ueber-Themen und ToDos aller zugaenglichen Listen in je
    //    einer Abfrage, danach in JS nach Liste gruppiert.
    const bereiche = await env.DB.prepare(
      `SELECT l.id, l.board_id, l.name
         FROM lists l
         JOIN board_members m ON m.board_id = l.board_id
        WHERE m.user_id = ?
        ORDER BY l.board_id, l.position, l.name`
    ).bind(nutzerId).all();

    const themen = await env.DB.prepare(
      `SELECT th.id, th.list_id, th.name, l.board_id
         FROM themen th
         JOIN lists l ON l.id = th.list_id
         JOIN board_members m ON m.board_id = l.board_id
        WHERE m.user_id = ?
        ORDER BY th.list_id, th.position, th.name`
    ).bind(nutzerId).all();

    const todos = await env.DB.prepare(
      `SELECT t.id, t.list_id, t.thema_id, t.text, t.note, t.due, t.done,
              t.position, t.created_at, t.completed_at, l.board_id
         FROM todos t
         JOIN lists l ON l.id = t.list_id
         JOIN board_members m ON m.board_id = l.board_id
        WHERE m.user_id = ?`
    ).bind(nutzerId).all();

    // Leere Huelle je Liste, damit auch eine Liste ohne Bereiche auftaucht.
    const daten = {};
    for (const b of listen) daten[b.id] = { categories: [], themen: [], todos: [] };
    for (const l of bereiche.results) {
      (daten[l.board_id] || (daten[l.board_id] = { categories: [], themen: [], todos: [] }))
        .categories.push({ id: l.id, name: l.name });
    }
    for (const th of themen.results) {
      const eimer = daten[th.board_id];
      if (!eimer) continue;
      eimer.themen.push({ id: th.id, categoryId: th.list_id, name: th.name });
    }
    for (const t of todos.results) {
      const eimer = daten[t.board_id];
      if (!eimer) continue;
      eimer.todos.push({
        id: t.id,
        categoryId: t.list_id,
        themaId: t.thema_id,       // null = frei im Bereich
        text: t.text,
        note: t.note,
        due: t.due,
        done: t.done === 1,        // SQLite kennt keinen Boolean
        order: t.position,         // null bei terminierten ToDos, wie bisher
        createdAt: t.created_at,
        completedAt: t.completed_at,
      });
    }

    return json({
      // Optik: die App blendet den Verwaltungs-Zugang ein oder aus.
      // /api/admin/* prueft selbst nochmal.
      admin: nutzer.role === "admin",
      email: nutzer.email,
      name: nutzer.name,
      nutzerId: nutzerId,
      // Reine Metadaten je Liste; der Inhalt steht in daten[id].
      listen: listen.map(b => ({
        id: b.id,
        name: b.name,
        rolle: b.role,                       // 'owner' | 'member'
        istEigen: b.role === "owner",
        besitzerName: b.owner_name || "",
        // Nur beim owner: der Teilen-Token (Klartext) und die Zahl der Geteilten.
        geteilt: b.role === "owner" ? !!b.share_token : undefined,
        token: b.role === "owner" ? (b.share_token || null) : undefined,
        mitglieder: b.role === "owner" ? (mitglieder[b.id] || 0) : undefined,
      })),
      daten,
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

  const boardId = zustand && zustand.boardId;
  if (typeof boardId !== "string" || !boardId) {
    return json({ error: "Keine Liste angegeben" }, 400);
  }
  // themen ist optional (aeltere Clients kennen es nicht) - fehlt es, als leer
  // behandeln, statt die ganze Liste abzulehnen.
  const themen = Array.isArray(zustand.themen) ? zustand.themen : [];
  if (!Array.isArray(zustand.categories) || !Array.isArray(zustand.todos)) {
    return json({ error: "Ungueltige Datenstruktur" }, 400);
  }
  if (zustand.categories.some(c => !c || typeof c.id !== "string" || typeof c.name !== "string")) {
    return json({ error: "Ungueltiger Bereich" }, 400);
  }
  if (themen.some(th => !th || typeof th.id !== "string" || typeof th.name !== "string"
                     || typeof th.categoryId !== "string")) {
    return json({ error: "Ungueltiges Ueber-Thema" }, 400);
  }
  if (zustand.todos.some(t => !t || typeof t.id !== "string" || typeof t.text !== "string")) {
    return json({ error: "Ungueltiges ToDo" }, 400);
  }

  // Darf der Nutzer diese Liste bearbeiten? owner und member ja, sonst nicht.
  const rolle = await rolleIn(env, boardId, nutzerId);
  if (!rolle) return json({ error: "Kein Zugriff auf diese Liste" }, 403);

  // Nur DIESE Liste ersetzen. batch() laeuft als eine Transaktion - entweder
  // steht am Ende alles drin oder nichts. Kindtabellen ausdruecklich zuerst,
  // nicht auf ON DELETE CASCADE verlassen (haengt an PRAGMA foreign_keys).
  // Reihenfolge: todos (haengt an lists und themen), dann themen (haengt an
  // lists), dann lists.
  const anweisungen = [
    env.DB.prepare(
      "DELETE FROM todos WHERE list_id IN (SELECT id FROM lists WHERE board_id = ?)"
    ).bind(boardId),
    env.DB.prepare(
      "DELETE FROM themen WHERE list_id IN (SELECT id FROM lists WHERE board_id = ?)"
    ).bind(boardId),
    env.DB.prepare("DELETE FROM lists WHERE board_id = ?").bind(boardId),
  ];

  // Die Reihenfolge der Spalten steckt im Array-Index, nicht in den Daten.
  const bekannt = new Set(zustand.categories.map(c => c.id));
  zustand.categories.forEach((c, i) => {
    anweisungen.push(
      env.DB.prepare(
        "INSERT INTO lists (id, board_id, name, position) VALUES (?, ?, ?, ?)"
      ).bind(c.id, boardId, c.name, i)
    );
  });

  // Ueber-Themen: nur die zu einem bekannten Bereich, sonst schluege der
  // (fehlende, aber im Code gewahrte) Bezug fehl. themaZuBereich merkt sich,
  // in welchem Bereich ein Thema liegt - damit ein ToDo gleich nur dann sein
  // thema_id behaelt, wenn das Thema wirklich in SEINEM Bereich sitzt.
  // position ist der Index innerhalb des Bereichs (pro Bereich neu gezaehlt).
  const themaZuBereich = new Map();
  const themaZaehler = {};
  for (const th of themen) {
    if (!bekannt.has(th.categoryId)) continue;
    const pos = (themaZaehler[th.categoryId] = (themaZaehler[th.categoryId] ?? -1) + 1);
    themaZuBereich.set(th.id, th.categoryId);
    anweisungen.push(
      env.DB.prepare(
        "INSERT INTO themen (id, list_id, name, position) VALUES (?, ?, ?, ?)"
      ).bind(th.id, th.categoryId, th.name, pos)
    );
  }

  // ToDos ohne zugehoerigen Bereich wuerden am Fremdschluessel scheitern und
  // die ganze Transaktion kippen. Sie sind ohnehin unsichtbar - also raus.
  // thema_id nur behalten, wenn das Thema existiert UND im selben Bereich liegt;
  // sonst NULL (ToDo bleibt erhalten und rutscht frei in den Bereich).
  for (const t of zustand.todos) {
    if (!bekannt.has(t.categoryId)) continue;
    const themaId = themaZuBereich.get(t.themaId) === t.categoryId ? t.themaId : null;
    anweisungen.push(
      env.DB.prepare(
        `INSERT INTO todos
           (id, list_id, thema_id, text, note, due, done, position, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        t.id,
        t.categoryId,
        themaId,
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
