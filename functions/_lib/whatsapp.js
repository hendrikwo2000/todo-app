/**
 * WhatsApp-Morgenliste: faellige ToDos und rote Google-Termine des Tages als
 * Nachricht ueber CallMeBot.
 *
 * CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/) ist
 * ein kostenloser Dienst fuer persoenlichen Gebrauch: er schickt von SEINER
 * Nummer an die eigene. Nummer und Schluessel stehen nur als Secrets im
 * Pages-Projekt (TELEFON, CALLMEBOT_KEY), nie im Code. Der Schluessel steckt
 * in der Abfrage-Adresse, deshalb darf diese Adresse in keiner Meldung stehen.
 *
 * Eigene Datei statt in pruefen.js, damit der Text und das Senden ohne
 * Datenbank und ohne Push-Schluessel testbar bleiben.
 */

const ENDPUNKT = "https://api.callmebot.com/whatsapp.php";

const MAX_EINTRAEGE = 8;
const MAX_ZEICHEN_PRO_TODO = 80;

// "2026-10-12" -> "12.10."
function kurzDatum(iso) {
  const [, monat, tag] = iso.split("-");
  return `${tag}.${monat}.`;
}

// Zeilenumbrueche und Mehrfach-Leerzeichen raus, lange Texte kuerzen: ein
// ToDo mit mehrzeiliger Notiz darf die Nachricht nicht sprengen.
function kuerzen(text) {
  const eins = String(text).replace(/\s+/g, " ").trim();
  return eins.length > MAX_ZEICHEN_PRO_TODO
    ? eins.slice(0, MAX_ZEICHEN_PRO_TODO - 1).trimEnd() + "…"
    : eins;
}

// todos: [{ text, due }], schon nach due aufsteigend sortiert (Ueberfaellige
// zuerst). heute: "2026-10-15". Ohne faellige ToDos: null, es wird dann nichts
// gesendet. Seit 18.10.2026 nur noch ToDos: die roten Google-Termine sind
// raus, damit keine Google-Daten an CallMeBot gehen (Google-Verifizierung).
export function baueMorgenNachricht(todos, heute) {
  if (!todos.length) return null;

  const bloecke = [];

  if (todos.length) {
    const sichtbar = todos.slice(0, MAX_EINTRAEGE);
    const zeilen = sichtbar.map((todo) =>
      todo.due < heute
        ? `• ${kuerzen(todo.text)} (seit ${kurzDatum(todo.due)})`
        : `• ${kuerzen(todo.text)}`
    );
    const rest = todos.length - sichtbar.length;
    if (rest > 0) zeilen.push(`+ ${rest} weitere`);

    const kopf = todos.length === 1
      ? `📋 1 ToDo fällig (${kurzDatum(heute)})`
      : `📋 ${todos.length} ToDos fällig (${kurzDatum(heute)})`;
    bloecke.push([kopf, ...zeilen]);
  }

  return bloecke.map((zeilen) => zeilen.join("\n")).join("\n\n");
}

// Die Pruefung laeuft 3x taeglich (7, 12, 17 Uhr Berliner Zeit, siehe
// BETRIEB.md). WhatsApp kommt nur beim ersten Lauf des Tages.
export function istMorgenlauf(jetzt = new Date()) {
  const stunde = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(jetzt)
  );
  return stunde < 10;
}

const warteDann = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

// Wirft bei Fehlschlag. CallMeBot meldet Fehler mit Status 201 und "ERROR" im
// Text, also zaehlt auch der Inhalt, nicht nur der Status. Bei Erfolg schickt
// der Dienst die Nummer im Antworttext zurueck, die Antwort wird deshalb nie
// weitergereicht, nur bei einem Fehler maskiert und gekuerzt.
export async function sendeWhatsapp(
  env,
  text,
  { fetchFunktion = fetch, warten = warteDann, versuche = 2, pauseMs = 3000 } = {}
) {
  if (!env.TELEFON) throw new Error("TELEFON fehlt im Pages-Projekt");
  if (!env.CALLMEBOT_KEY) throw new Error("CALLMEBOT_KEY fehlt im Pages-Projekt");

  const adresse =
    `${env.CALLMEBOT_ENDPUNKT || ENDPUNKT}` +
    `?phone=${encodeURIComponent(env.TELEFON)}` +
    `&text=${encodeURIComponent(text)}` +
    `&apikey=${encodeURIComponent(env.CALLMEBOT_KEY)}`;

  const verbergen = (t) =>
    [env.CALLMEBOT_KEY, env.TELEFON, env.TELEFON.replace(/^\+/, "")].reduce(
      (rest, geheim) => rest.split(geheim).join("***"),
      t
    );

  let letzterFehler;
  for (let versuch = 1; versuch <= versuche; versuch++) {
    try {
      const antwort = await fetchFunktion(adresse);
      const inhalt = await antwort.text();
      if (antwort.ok && !/error/i.test(inhalt)) return;
      letzterFehler = antwort.ok
        ? new Error(`CallMeBot meldet einen Fehler: ${verbergen(inhalt.replace(/<[^>]*>/g, "").trim()).slice(0, 120)}`)
        : new Error(`CallMeBot antwortet mit ${antwort.status}`);
    } catch (fehler) {
      letzterFehler = new Error(`CallMeBot nicht erreichbar: ${fehler.message}`);
    }
    if (versuch < versuche) await warten(pauseMs);
  }
  throw letzterFehler;
}
