/**
 * Konto samt Daten loeschen - gemeinsam genutzt vom Nutzer selbst
 * (api/auth/account.js) und von der Verwaltung (api/admin/waitlist.js).
 */

import { sendeMail, huelle, absatz, fussnote } from "./mail.js";

/**
 * Loescht Nutzer, seine Listen (mit Bereichen und ToDos), seine
 * Mitgliedschaften in fremden Listen, Sitzungen und offene Codes in EINER
 * Transaktion.
 *
 * Zwei Seiten der Listen: EIGENE Listen (owner_id = ich) verschwinden ganz,
 * auch fuer alle, mit denen ich sie geteilt hatte - dafuer erst deren
 * ToDos/Bereiche/Mitgliedschaften, dann die Liste. Listen, in die ich nur
 * EINGELADEN war, bleiben bestehen; von denen loese ich nur meine eigene
 * Mitgliedschaft.
 *
 * Die Kindtabellen werden ausdruecklich zuerst geleert, statt sich auf
 * ON DELETE CASCADE zu verlassen: ob SQLite das ausfuehrt, haengt an
 * PRAGMA foreign_keys, und darauf will ich mich nicht verlassen.
 *
 * Der Wartelisten-Eintrag faellt bewusst mit weg. Bliebe er stehen, waere
 * die Person in der Schwebe: kein Konto, aber "steht schon auf der Liste" -
 * sie koennte sich also nie wieder bewerben.
 */
export async function loescheKonto(env, nutzer) {
  await env.DB.batch([
    // Eigene Listen samt Inhalt und fremden Zugriffen.
    env.DB.prepare(
      "DELETE FROM todos WHERE list_id IN (SELECT id FROM lists WHERE board_id IN (SELECT id FROM boards WHERE owner_id = ?))"
    ).bind(nutzer.id),
    env.DB.prepare(
      "DELETE FROM lists WHERE board_id IN (SELECT id FROM boards WHERE owner_id = ?)"
    ).bind(nutzer.id),
    env.DB.prepare(
      "DELETE FROM board_members WHERE board_id IN (SELECT id FROM boards WHERE owner_id = ?)"
    ).bind(nutzer.id),
    env.DB.prepare("DELETE FROM boards WHERE owner_id = ?").bind(nutzer.id),
    // Meine Mitgliedschaften in fremden Listen loesen (die Listen bleiben).
    env.DB.prepare("DELETE FROM board_members WHERE user_id = ?").bind(nutzer.id),
    // Der Rest wie gehabt.
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(nutzer.id),
    env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(nutzer.email),
    env.DB.prepare("DELETE FROM waitlist WHERE email = ?").bind(nutzer.email),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(nutzer.id),
  ]);
}

/**
 * Verhindert, dass der letzte Admin verschwindet - egal ob er sich selbst
 * loescht oder geloescht wird. Ohne diese Pruefung kaeme niemand mehr an die
 * Verwaltung, und das faellt erst auf, wenn man sie braucht.
 */
export async function istLetzterAdmin(env, nutzer) {
  if (nutzer.role !== "admin") return false;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"
  ).first();
  return row.n <= 1;
}

// Bestaetigung nach dem Loeschen. Auch wenn man es selbst ausgeloest hat:
// war es jemand anderes, faellt es so sofort auf.
export async function meldeLoeschung(env, nutzer, durchAdmin) {
  const anrede = nutzer.name ? `Hallo ${nutzer.name}, ` : "";
  return await sendeMail(env, {
    to: nutzer.email,
    subject: durchAdmin ? "Dein Zugang wurde entfernt" : "Dein Konto wurde gelöscht",
    html: huelle(durchAdmin ? "Zugang entfernt" : "Konto gelöscht",
      absatz(durchAdmin
        ? `${anrede}dein Zugang zur ToDo-Liste wurde entfernt. Deine Bereiche
           und ToDos sind damit gelöscht.`
        : `${anrede}dein Konto bei der ToDo-Liste ist gelöscht. Deine Bereiche
           und ToDos wurden dabei mit entfernt.`) +
      absatz("Wiederherstellen lässt sich das nicht. Du kannst dich aber jederzeit neu auf die Warteliste eintragen.") +
      fussnote(durchAdmin
        ? "Fragen? Antworte einfach auf diese Mail."
        : "Warst du das nicht? Dann antworte auf diese Mail — dann schauen wir uns das an.")),
    text: durchAdmin
      ? `${anrede}dein Zugang zur ToDo-Liste wurde entfernt. Deine Bereiche und ToDos sind damit geloescht.\n\nWiederherstellen laesst sich das nicht. Du kannst dich aber jederzeit neu auf die Warteliste eintragen.`
      : `${anrede}dein Konto bei der ToDo-Liste ist geloescht. Deine Bereiche und ToDos wurden dabei mit entfernt.\n\nWiederherstellen laesst sich das nicht. Warst du das nicht? Dann antworte auf diese Mail.`,
  });
}
