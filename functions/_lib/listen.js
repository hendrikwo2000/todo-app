/**
 * Gemeinsame Bausteine rund um die "Listen" (boards) - die teilbare Ebene
 * ueber den Bereichen. Von todos.js und den Endpunkten unter api/listen/
 * genutzt.
 *
 * Rollen: 'owner' darf die Liste verwalten (umbenennen, teilen, Zugriffe
 * entziehen, loeschen), 'member' darf den Inhalt mitbearbeiten. Wer eine
 * Liste ueberhaupt sehen darf, steht in board_members.
 */

// Fuer den Anfang zwei EIGENE Listen pro Person. Geteilte Listen zaehlen NICHT
// mit - sie kommen obendrauf. Eine Zahl, kein Deployment, falls das mal steigt.
export const MAX_EIGENE_LISTEN = 2;

export function json(body, status = 200) {
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

// Alle Listen, die ein Nutzer sehen darf - mit Rolle, Besitzer (fuer das
// "von Max"-Schild) und, nur bei eigenen, dem Teilen-Token.
export async function listenFuer(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.name, b.owner_id, b.share_token, m.role, m.position,
            u.name AS owner_name
       FROM board_members m
       JOIN boards b ON b.id = m.board_id
       JOIN users  u ON u.id = b.owner_id
      WHERE m.user_id = ?
      ORDER BY m.position, b.created_at`
  ).bind(userId).all();
  return rows.results;
}

// Rolle des Nutzers in einer Liste, oder null wenn er keinen Zugriff hat.
// Reicht fuer die Bearbeitungspruefung: owner UND member duerfen den Inhalt
// aendern, also zaehlt nur "nicht null".
export async function rolleIn(env, boardId, userId) {
  const r = await env.DB.prepare(
    "SELECT role FROM board_members WHERE board_id = ? AND user_id = ?"
  ).bind(boardId, userId).first();
  return r ? r.role : null;
}

// Board laden, aber nur wenn der Nutzer der BESITZER ist - sonst null. Der
// Torwaechter fuer alle Verwaltungsaktionen.
export async function eigenesBoard(env, boardId, userId) {
  return await env.DB.prepare(
    "SELECT id, owner_id, name, share_token FROM boards WHERE id = ? AND owner_id = ?"
  ).bind(boardId, userId).first();
}

// Anzahl eigener Listen - fuers Limit beim Anlegen.
export async function eigeneAnzahl(env, userId) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM boards WHERE owner_id = ?"
  ).bind(userId).first();
  return r.n;
}

// Naechste freie Position im Umschalter dieses Nutzers - damit eine neu
// angelegte oder beigetretene Liste hinten einsortiert wird.
export async function naechstePosition(env, userId) {
  const r = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM board_members WHERE user_id = ?"
  ).bind(userId).first();
  return r.p;
}
