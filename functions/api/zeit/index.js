/**
 * Stand der Zeiterfassung fuer das Fenster hinter ⏱: die laufende Uhr, was
 * heute gebucht ist und gekappte Eintraege (Hinweis).
 *
 * Eine Anfrage beim Oeffnen und beim Zurueckkehren in die App. Laeuft die Uhr
 * schon laenger als der Deckel, haelt laufenderEintrag sie dabei an.
 *
 * Bis zum Umbau am Abend des 18.10.2026 kamen hier auch die zuletzt bebuchten
 * ToDos mit ("Zuletzt" in der alten Auswahl). Seitdem waehlt man aus einem
 * Dropdown nach Bereichen, das die App aus ihren eigenen Listen baut.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute } from "../../_lib/tag.js";
import { SPALTEN, laufenderEintrag, alsEintrag } from "../../_lib/zeit.js";

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const heute = new URL(request.url).searchParams.get("heute") || "";
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  try {
    // Zuerst die laufende Uhr: das kappt sie gegebenenfalls, und der gekappte
    // Eintrag soll in den Listen darunter schon auftauchen.
    const laeuft = await laufenderEintrag(env, nutzerId);

    const [heuteListe, gekappt] = await Promise.all([
      env.DB.prepare(
        `SELECT ${SPALTEN} FROM zeiteintraege
          WHERE user_id = ? AND datum = ? AND ende IS NOT NULL
          ORDER BY start DESC`
      ).bind(nutzerId, heute).all(),
      env.DB.prepare(
        `SELECT ${SPALTEN} FROM zeiteintraege
          WHERE user_id = ? AND gekappt = 1 AND ende IS NOT NULL
          ORDER BY start DESC LIMIT 5`
      ).bind(nutzerId).all(),
    ]);

    return json({
      laeuft: laeuft ? alsEintrag(laeuft) : null,
      heute: heuteListe.results.map(alsEintrag),
      gekappt: gekappt.results.map(alsEintrag),
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}
