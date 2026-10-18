/**
 * Welche Konten sind in diesem Browser angemeldet?
 *
 * Fuer die Kontenliste in den Einstellungen und auf der Anmeldemaske. Liefert
 * nur, was der Browser ohnehin schon hat - die Sitzungstoken stecken ja in
 * seinen Cookies. `mehrkonten` ist true, sobald eines der Konten Admin ist;
 * nur dann zeigt die App Liste und "Weiteres Konto" (siehe session.js,
 * anmeldungVorbereiten - dieselbe Bedingung gilt dort serverseitig).
 *
 * Antwortet immer mit 200, auch ohne jede Sitzung: die Anmeldemaske fragt
 * hier bei jedem Oeffnen nach.
 */

import { browserSitzungen, gewaehltesKonto, MAX_KONTEN } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  let konten = [];
  try {
    if (env.DB) {
      const sitzungen = await browserSitzungen(request, env);
      const gewaehlt = gewaehltesKonto(request);
      konten = sitzungen.map(s => ({
        id: s.nutzer.id,
        name: s.nutzer.name || "",
        email: s.nutzer.email,
        admin: s.nutzer.role === "admin",
        // Das Konto, das dieser Tab gerade zeigt: das gewaehlte, sonst das erste.
        aktiv: gewaehlt != null ? s.nutzer.id === gewaehlt : s.haupt,
      }));
    }
  } catch (e) {
    // Datenbank kurz weg: dann eben keine Liste - Anmelden geht trotzdem.
  }
  return new Response(JSON.stringify({
    konten,
    mehrkonten: konten.some(k => k.admin),
    max: MAX_KONTEN,
  }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
