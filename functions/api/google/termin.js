/**
 * Termine im Google-Hauptkalender anlegen, aendern und loeschen.
 *
 *   POST   { titel, startDatum, endDatum, ganztags, vonZeit, bisZeit, farbe, notiz, zeitzone }
 *   PUT    dasselbe + { id }
 *   DELETE { id }
 *
 * Der einzige schreibende Zugriff der App auf Google. Bewusst eng gefasst:
 * immer der Hauptkalender, und nur die Felder, die das Panel auch anzeigt -
 * Ort, Gaeste und Erinnerungen bleiben unangetastet (deshalb PATCH statt PUT
 * Richtung Google, siehe _lib/google.js).
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import {
  fehltEinrichtung, kontoFuer, loescheKonto, frischesZugriffToken,
  kalenderListe, legeTerminAn, aendereTermin, loescheTermin, darfSchreiben,
} from "../../_lib/google.js";

const TAG = /^\d{4}-\d{2}-\d{2}$/;
const UHR = /^([01]\d|2[0-3]):[0-5]\d$/;
// Googles Termin-Palette hat die ids 1-11; alles andere waere geraten.
const FARBEN = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);

/** Gemeinsame Vorpruefung: angemeldet, verknuepft, darf schreiben. */
async function konteneNehmen(request, env) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return { antwort: fehler };
  if (fehltEinrichtung(env)) return { antwort: json({ error: "Google ist auf diesem Server nicht eingerichtet" }, 400) };

  const konto = await kontoFuer(env, nutzerId);
  if (!konto) return { antwort: json({ error: "Kein Google-Konto verknüpft" }, 400) };
  // Verknuepfungen von vor der Schreib-Erweiterung tragen den Scope nicht.
  // Frueh und mit klarer Ansage abbrechen, statt in Googles 403 zu laufen.
  if (!darfSchreiben(konto)) return { antwort: json({ neuVerknuepfen: true }, 409) };
  return { nutzerId, konto };
}

/** Felder aus dem Rumpf lesen und pruefen. */
function felderLesen(body, mitId) {
  const id = String((body && body.id) || "").trim();
  if (mitId && !id) return { fehler: "Termin-Kennung fehlt" };

  const titel = String((body && body.titel) || "").trim();
  if (!titel) return { fehler: "Titel fehlt" };

  const startDatum = String((body && body.startDatum) || "");
  if (!TAG.test(startDatum)) return { fehler: "Startdatum fehlt oder ist ungueltig" };

  let endDatum = String((body && body.endDatum) || "") || startDatum;
  if (!TAG.test(endDatum)) return { fehler: "Enddatum ist ungueltig" };
  // Ende vor Anfang waere fuer Google ein Fehler - hier still geradegezogen,
  // das ist freundlicher als eine Meldung ueber eine Eingabe, die der Nutzer
  // im Formular so gar nicht machen wollte.
  if (endDatum < startDatum) endDatum = startDatum;

  const ganztags = !!(body && body.ganztags);
  let vonZeit = String((body && body.vonZeit) || "");
  let bisZeit = String((body && body.bisZeit) || "");
  if (!ganztags) {
    if (!UHR.test(vonZeit) || !UHR.test(bisZeit)) return { fehler: "Uhrzeit fehlt oder ist ungueltig" };
    // Gleicher Tag und Ende nicht nach dem Anfang: eine Stunde daraus machen.
    if (endDatum === startDatum && bisZeit <= vonZeit) {
      const [h, m] = vonZeit.split(":").map(Number);
      bisZeit = `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      if (h + 1 > 23) bisZeit = "23:59";
    }
  }

  const farbe = String((body && body.farbe) || "");
  const notiz = String((body && body.notiz) || "").slice(0, 8000);
  // Zeitzonen-Namen sind IANA-Kennungen wie "Europe/Berlin"; alles andere
  // waere fremder Text in einer Anfrage, die wir mit unserem Token stellen.
  const zeitzone = /^[A-Za-z_+\-]+\/[A-Za-z_+\-/]+$/.test(String((body && body.zeitzone) || ""))
    ? body.zeitzone : "Europe/Berlin";

  return {
    id,
    felder: {
      titel: titel.slice(0, 300), ganztags, startDatum, endDatum, vonZeit, bisZeit,
      farbe: FARBEN.has(farbe) ? farbe : null, notiz, zeitzone,
    },
  };
}

async function zielKalender(token) {
  const alle = await kalenderListe(token);
  return alle.find(k => k.primaer) || alle[0] || null;
}

/** Fehlerbehandlung, die alle drei Wege teilen. */
async function mitFehlern(env, nutzerId, arbeit) {
  try {
    return await arbeit();
  } catch (e) {
    if (e && e.code === "getrennt") {
      await loescheKonto(env, nutzerId);
      return json({ getrennt: true }, 409);
    }
    if (e && e.code === "kein-schreibrecht") return json({ neuVerknuepfen: true }, 409);
    if (e && e.code === "weg") return json({ error: "Diesen Termin gibt es bei Google nicht mehr." }, 404);
    return json({ error: "Google hat die Änderung nicht angenommen" }, 502);
  }
}

async function rumpfLesen(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  const { antwort, nutzerId, konto } = await konteneNehmen(request, env);
  if (antwort) return antwort;
  const body = await rumpfLesen(request);
  if (!body) return json({ error: "Ungueltiges JSON" }, 400);
  const { fehler, felder } = felderLesen(body, false);
  if (fehler) return json({ error: fehler }, 400);

  return await mitFehlern(env, nutzerId, async () => {
    const token = await frischesZugriffToken(env, konto);
    const ziel = await zielKalender(token);
    if (!ziel) return json({ error: "Kein Kalender gefunden" }, 400);
    const angelegt = await legeTerminAn(token, ziel.id, felder);
    return json({ ok: true, id: angelegt.id });
  });
}

export async function onRequestPut({ request, env }) {
  const { antwort, nutzerId, konto } = await konteneNehmen(request, env);
  if (antwort) return antwort;
  const body = await rumpfLesen(request);
  if (!body) return json({ error: "Ungueltiges JSON" }, 400);
  const { fehler, felder, id } = felderLesen(body, true);
  if (fehler) return json({ error: fehler }, 400);

  return await mitFehlern(env, nutzerId, async () => {
    const token = await frischesZugriffToken(env, konto);
    const ziel = await zielKalender(token);
    if (!ziel) return json({ error: "Kein Kalender gefunden" }, 400);
    await aendereTermin(token, ziel.id, id, felder);
    return json({ ok: true });
  });
}

export async function onRequestDelete({ request, env }) {
  const { antwort, nutzerId, konto } = await konteneNehmen(request, env);
  if (antwort) return antwort;
  const body = await rumpfLesen(request);
  const id = String((body && body.id) || "").trim();
  if (!id) return json({ error: "Termin-Kennung fehlt" }, 400);

  return await mitFehlern(env, nutzerId, async () => {
    const token = await frischesZugriffToken(env, konto);
    const ziel = await zielKalender(token);
    if (!ziel) return json({ error: "Kein Kalender gefunden" }, 400);
    await loescheTermin(token, ziel.id, id);
    return json({ ok: true });
  });
}
