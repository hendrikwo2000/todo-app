/**
 * Gemeinsames rund um die Zeiterfassung (Tabelle zeiteintraege).
 *
 * Seit 18.10.2026 ist der Timer eine Stoppuhr, die optional auf ein ToDo bucht
 * (Hendriks Auftrag: "Zeit auf ein ToDo buchen ... also nicht einfach nur ein
 * Timer"). Bis dahin war er ein Countdown mit Standarddauer (fokus_sitzungen,
 * functions/_lib/fokus.js hat davon nur noch die Einstellungen).
 *
 * WARUM DIE ZEIT IN SQL GERECHNET WIRD
 * SQLite gibt Zeitstempel als 'YYYY-MM-DD HH:MM:SS' ohne Zonen-Suffix zurueck,
 * und `new Date("2026-08-07 12:00:00")` liest JavaScript als LOKALE Zeit. Die
 * Differenzen entstehen deshalb per strftime('%s') dort, wo auch die
 * Zeitstempel entstanden sind. Nach aussen gehen Zeitpunkte als ISO mit "Z".
 *
 * WARUM NICHT IM BROWSER MITGEZAEHLT WIRD
 * Die laufende Uhr ist reine Anzeige, gerechnet wird aus `start`. Nur so
 * uebersteht sie Reload, Handysperre und Geraetewechsel.
 */

// Laeuft die Uhr laenger, haelt sie hier an (Hendriks Wahl: "Deckel bei 4 h +
// Hinweis"). Wer vergisst zu stoppen, findet morgens keinen Eintrag ueber 14
// Stunden, sondern einen ueber 4 - und einen Hinweis, der zum Korrigieren fuehrt.
export const DECKEL_SEK = 4 * 60 * 60;

// Nachgetragen oder korrigiert: hoechstens ein Tag am Stueck. Laenger ist kein
// Arbeitsblock mehr, sondern ein Tippfehler im Datum.
export const MAX_EINTRAG_SEK = 24 * 60 * 60;

// Laengen fuer die Schnappschuss-Felder. Ein ToDo-Text kann lang sein, fuer
// Statistik und Export reicht der Anfang.
const MAX_TEXT = 300;
const MAX_ID = 100;

// Dauer in Sekunden - bei laufender Uhr bis jetzt.
export const SPALTEN = `
  id, start, ende, datum, todo_id, todo_text, liste_name, bereich_name,
  gekappt, nachgetragen,
  CAST(strftime('%s', COALESCE(ende, datetime('now'))) - strftime('%s', start) AS INTEGER) AS sek
`;

// 'YYYY-MM-DD HH:MM:SS' (UTC) -> ISO mit Z, das jeder Browser richtig liest.
function alsIso(sqlZeit) {
  return sqlZeit ? sqlZeit.replace(" ", "T") + "Z" : null;
}

export function alsEintrag(z) {
  return {
    id: z.id,
    start: alsIso(z.start),
    ende: alsIso(z.ende),
    datum: z.datum,
    sek: Math.max(0, z.sek || 0),
    todoId: z.todo_id || null,
    todoText: z.todo_text || "",
    listeName: z.liste_name || "",
    bereichName: z.bereich_name || "",
    gekappt: z.gekappt === 1,
    nachgetragen: z.nachgetragen === 1,
  };
}

export async function eintragVon(env, nutzerId, id) {
  return await env.DB.prepare(
    `SELECT ${SPALTEN} FROM zeiteintraege WHERE id = ? AND user_id = ?`
  ).bind(id, nutzerId).first();
}

/**
 * Der laufende Eintrag des Nutzers, oder null. Es gibt hoechstens einen -
 * start.js beendet einen alten, bevor es einen neuen anlegt.
 *
 * Ist die Uhr ueber den Deckel gelaufen, wird sie HIER angehalten (gekappt=1)
 * und null zurueckgegeben. Jeder Weg, der nach der laufenden Uhr fragt, kappt
 * also gleich mit - es braucht keinen Zeitplan, der das nachts erledigt.
 */
export async function laufenderEintrag(env, nutzerId) {
  const zeile = await env.DB.prepare(
    `SELECT ${SPALTEN} FROM zeiteintraege
      WHERE user_id = ? AND ende IS NULL
      ORDER BY start DESC LIMIT 1`
  ).bind(nutzerId).first();
  if (!zeile) return null;
  if (zeile.sek < DECKEL_SEK) return zeile;
  await env.DB.prepare(
    `UPDATE zeiteintraege SET ende = datetime(start, '+${DECKEL_SEK} seconds'), gekappt = 1
      WHERE id = ?`
  ).bind(zeile.id).run();
  return null;
}

// Kuerzer ist kein Arbeiten, sondern ein Fehlgriff: auf das falsche ToDo
// getippt und gleich gewechselt, oder Start und Stopp hintereinander. Solche
// Strecken stuenden sonst als "0 min" in der Liste.
export const MIN_SEK = 10;

// Die laufende Uhr anhalten und den fertigen Eintrag zurueckgeben - oder null,
// wenn er unter MIN_SEK lag und deshalb verworfen wurde. Ueber dem Deckel kappt
// schon laufenderEintrag - hier kommt nur an, was darunter liegt.
export async function beende(env, nutzerId, zeile) {
  if (zeile.sek < MIN_SEK) {
    await env.DB.prepare(
      "DELETE FROM zeiteintraege WHERE id = ? AND user_id = ? AND ende IS NULL"
    ).bind(zeile.id, nutzerId).run();
    return null;
  }
  await env.DB.prepare(
    "UPDATE zeiteintraege SET ende = datetime('now') WHERE id = ? AND user_id = ?"
  ).bind(zeile.id, nutzerId).run();
  return alsEintrag(await eintragVon(env, nutzerId, zeile.id));
}

/**
 * Die Buchung aus dem Anfragekoerper: welches ToDo, und wie es zum Zeitpunkt
 * der Buchung hiess. Geprueft wird nur die Form, nicht, ob es das ToDo gibt:
 * ein gerade angelegtes ToDo ist vielleicht noch nicht gespeichert, und die
 * Felder verraten niemandem etwas - der Eintrag gehoert dem Nutzer selbst, die
 * App loest die id mit ihren eigenen Listen auf.
 */
export function buchungAus(body) {
  const id = typeof body?.todoId === "string" ? body.todoId.trim().slice(0, MAX_ID) : "";
  if (!id) return { todoId: null, todoText: null, listeName: null, bereichName: null };
  const text = (wert) => (typeof wert === "string" ? wert.trim().slice(0, MAX_TEXT) : "") || null;
  return {
    todoId: id,
    todoText: text(body.todoText),
    listeName: text(body.listeName),
    bereichName: text(body.bereichName),
  };
}

/**
 * Ein Zeitpunkt aus dem Browser (ISO, z. B. von Date.toISOString()) als
 * 'YYYY-MM-DD HH:MM:SS' in UTC - oder null, wenn er nicht taugt.
 */
export function alsSqlZeit(wert) {
  if (typeof wert !== "string" || wert.length > 40) return null;
  const d = new Date(wert);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Von, bis und Datum eines nachgetragenen oder korrigierten Eintrags pruefen.
 * Gibt { start, ende } als SQL-Zeit zurueck oder { fehler }.
 */
export function pruefeStrecke(body) {
  const start = alsSqlZeit(body?.start);
  const ende = alsSqlZeit(body?.ende);
  if (!start || !ende) return { fehler: "Ungültige Uhrzeit" };
  const sek = (Date.parse(ende + "Z") - Date.parse(start + "Z")) / 1000;
  if (sek <= 0) return { fehler: "„Bis“ muss nach „Von“ liegen." };
  if (sek > MAX_EINTRAG_SEK) return { fehler: "Ein Eintrag kann höchstens 24 Stunden lang sein." };
  // Zwei Minuten Spielraum fuer eine falsch gehende Uhr im Geraet.
  if (Date.parse(ende + "Z") > Date.now() + 2 * 60 * 1000) {
    return { fehler: "Die Zeit liegt in der Zukunft." };
  }
  return { start, ende };
}
