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

const berlinTag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
const berlinUhr = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// termin: { titel, ganztags, start } wie aus termineVon() in google.js.
function terminZeile(termin, heute) {
  const titel = kuerzen(termin.titel);
  if (termin.ganztags) return `• ${titel} (ganztägig)`;
  const start = new Date(termin.start);
  // Mehrtaegiger Termin, der schon vor heute begann: eine Uhrzeit von
  // gestern waere irrefuehrend.
  if (berlinTag.format(start) < heute) return `• ${titel} (läuft)`;
  return `• ${berlinUhr.format(start)} ${titel}`;
}

// Ganztaegige zuerst, dann nach Beginn. Google liefert nach Beginn sortiert,
// mischt dabei aber Ganztaegige und Terminierte nach Datum.
function nachBeginn(a, b) {
  return (Number(b.ganztags) - Number(a.ganztags)) || (Date.parse(a.start) - Date.parse(b.start));
}

// todos: [{ text, due }], schon nach due aufsteigend sortiert (Ueberfaellige
// zuerst). termine: die ROTEN Termine von heute (siehe roteTermineAm in
// google.js). heute: "2026-10-15". kalenderFehler: der Kalender liess sich
// nicht lesen - die Nachricht sagt das in einer Zeile, damit ein fehlender
// roter Termin nicht als "heute nichts" missverstanden wird. Weder faellige
// ToDos noch rote Termine: null, es wird dann nichts gesendet.
export function baueMorgenNachricht(todos, termine, heute, { kalenderFehler = false } = {}) {
  if (!todos.length && !termine.length) return null;

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

  if (termine.length) {
    const sichtbar = [...termine].sort(nachBeginn).slice(0, MAX_EINTRAEGE);
    const zeilen = sichtbar.map((termin) => terminZeile(termin, heute));
    const rest = termine.length - sichtbar.length;
    if (rest > 0) zeilen.push(`+ ${rest} weitere`);

    const anzahl = termine.length === 1 ? "1 roter Termin" : `${termine.length} rote Termine`;
    // Das Datum steht nur in der ersten Kopfzeile der Nachricht.
    const kopf = todos.length
      ? `🔴 ${anzahl} heute`
      : `🔴 ${anzahl} heute (${kurzDatum(heute)})`;
    bloecke.push([kopf, ...zeilen]);
  }

  if (kalenderFehler) bloecke.push(["⚠️ Kalender nicht lesbar"]);

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
