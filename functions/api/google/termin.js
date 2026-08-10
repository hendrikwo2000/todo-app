/**
 * Ganztaegigen Termin im Google-Hauptkalender anlegen.
 *
 * POST { titel, datum: "2026-08-20" }
 *
 * Der einzige schreibende Zugriff der ganzen App auf Google - alles andere
 * liest nur. Deshalb hier eng gefasst: ganztaegig, im Hauptkalender, ein
 * Titel, sonst nichts. Wer mehr will (Uhrzeit, Ort, Gaeste), macht das in
 * Google selbst.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import {
  fehltEinrichtung, kontoFuer, loescheKonto, frischesZugriffToken,
  kalenderListe, legeTerminAn, darfSchreiben,
} from "../../_lib/google.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;
  if (fehltEinrichtung(env)) return json({ error: "Google ist auf diesem Server nicht eingerichtet" }, 400);

  const konto = await kontoFuer(env, nutzerId);
  if (!konto) return json({ error: "Kein Google-Konto verknüpft" }, 400);
  // Verknuepfungen von vor der Schreib-Erweiterung tragen den Scope nicht.
  // Frueh und mit klarer Ansage abbrechen, statt in Googles 403 zu laufen.
  if (!darfSchreiben(konto)) return json({ neuVerknuepfen: true }, 409);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }
  const titel = String((body && body.titel) || "").trim();
  const datum = String((body && body.datum) || "");
  if (!titel) return json({ error: "Titel fehlt" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return json({ error: "Datum fehlt oder ist ungueltig" }, 400);

  try {
    const token = await frischesZugriffToken(env, konto);
    const alle = await kalenderListe(token);
    const ziel = alle.find(k => k.primaer) || alle[0];
    if (!ziel) return json({ error: "Kein Kalender gefunden" }, 400);

    const angelegt = await legeTerminAn(token, ziel.id, { titel: titel.slice(0, 300), datum });
    return json({ ok: true, id: angelegt.id });
  } catch (e) {
    if (e && e.code === "getrennt") {
      await loescheKonto(env, nutzerId);
      return json({ getrennt: true }, 409);
    }
    if (e && e.code === "kein-schreibrecht") return json({ neuVerknuepfen: true }, 409);
    return json({ error: "Google hat den Termin nicht angenommen" }, 502);
  }
}
