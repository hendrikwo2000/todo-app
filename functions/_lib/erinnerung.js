/**
 * Offene Gewohnheiten fuer die Abend-Erinnerung (api/push/pruefen.js).
 *
 * Bis Oktober 2026 hatte die eigene Fokus-App dafuer einen zweiten
 * Push-Weg (eigene Abo-Tabelle, eigener cron-job). Benutzt hat ihn niemand
 * (null Abos), und seit der Fusion gibt es nur noch die ToDo-Benachrichtigung.
 * Hendriks Entscheidung (gefragt): die offenen Gewohnheiten stehen NUR im
 * 17-Uhr-Lauf mit drin - morgens waeren alle offen, das waere Rauschen. Die
 * Zahl am App-Icon bleibt die der ToDos.
 *
 * "Offen" heisst wie im Streifen: nochOffen() aus _lib/heute.js. Eine
 * Obergrenze ohne Eintrag ruht und zaehlt nicht mit.
 */

import { montagVon } from "./tag.js";
import { nochOffen } from "./heute.js";

// Die Pruefung laeuft 3x taeglich (7, 12, 17 Uhr Berliner Zeit, siehe
// BETRIEB.md). Der Abendlauf ist der letzte - ab 15 Uhr, mit Luft fuer einen
// verspaeteten Anpinger. Gegenstueck zu istMorgenlauf() in whatsapp.js.
export function istAbendlauf(jetzt = new Date()) {
  const stunde = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(jetzt)
  );
  return stunde >= 15;
}

/**
 * Je Nutzer MIT Push-Abo: wie viele Gewohnheiten heute noch offen sind.
 * Liefert eine Map user_id -> Zahl, nur Eintraege > 0.
 */
export async function offeneGewohnheitenJeNutzer(env, heute) {
  const wocheStart = montagVon(heute);
  const nutzer = (await env.DB.prepare(
    "SELECT DISTINCT user_id FROM push_subscriptions"
  ).all()).results;

  const ergebnis = new Map();
  for (const { user_id } of nutzer) {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, typ, zielmenge, richtung, rhythmus, wochentage_maske, wochenziel, created_at
         FROM gewohnheiten WHERE user_id = ? AND archiviert = 0`
    ).bind(user_id).all()).results;
    if (!gewohnheiten.length) continue;

    // Fuer "heute offen" und "X Mal die Woche" reicht die laufende Woche.
    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l
         JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ? AND l.datum <= ?`
    ).bind(user_id, wocheStart, heute).all()).results;

    const zielVon = {};
    for (const g of gewohnheiten) zielVon[g.id] = g.zielmenge;
    const tageVon = {};
    for (const l of logs) {
      const eimer = tageVon[l.gewohnheit_id] || (tageVon[l.gewohnheit_id] = {});
      // Das Ziel, das beim Loggen galt - wie ueberall.
      eimer[l.datum] = {
        menge: l.menge,
        ziel: l.ziel_damals != null ? l.ziel_damals : zielVon[l.gewohnheit_id],
      };
    }

    let n = 0;
    for (const g of gewohnheiten) {
      if (nochOffen(g, tageVon[g.id] || {}, heute)) n++;
    }
    if (n > 0) ergebnis.set(user_id, n);
  }
  return ergebnis;
}

// Der Text der Benachrichtigung. Beides in einer Zeile, damit es eine
// Meldung bleibt und nicht zwei.
export function erinnerungsText(todos, gewohnheiten) {
  const teile = [];
  if (todos) teile.push(todos === 1 ? "1 ToDo ist fällig oder überfällig" : `${todos} ToDos sind fällig oder überfällig`);
  if (gewohnheiten) {
    teile.push(gewohnheiten === 1
      ? "1 Gewohnheit ist heute noch offen"
      : `${gewohnheiten} Gewohnheiten sind heute noch offen`);
  }
  return teile.join(", ") + ".";
}
