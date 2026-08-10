/**
 * Schritt 1 der Google-Verknuepfung: zur Zustimmungsseite weiterleiten.
 *
 * Ein GET mit 302 statt einer JSON-Antwort, weil der Browser die Seite
 * wirklich verlassen muss - ein fetch() koennte den Zustimmungsdialog nicht
 * anzeigen.
 *
 * `state` schuetzt gegen untergeschobene Rueckleitungen: derselbe Zufallswert
 * geht an Google UND in ein kurzlebiges Cookie; callback.js laesst nur durch,
 * was beides vorweisen kann.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { neuesToken } from "../../_lib/session.js";
import { fehltEinrichtung, zustimmungsAdresse } from "../../_lib/google.js";

export const STATE_COOKIE = "google_state";

export async function onRequestGet({ request, env }) {
  const { fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  if (fehltEinrichtung(env)) {
    return json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fehlen im Pages-Projekt" }, 500);
  }

  const state = neuesToken();
  const sicher = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: zustimmungsAdresse(env, request, state),
      // 10 Minuten reichen fuer die Zustimmung und lassen nichts liegen.
      // SameSite=Lax ist Pflicht: das Cookie muss die Rueckleitung VON Google
      // ueberleben, bei Strict kaeme es dort nicht mit.
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/api/google; HttpOnly;${sicher} SameSite=Lax; Max-Age=600`,
      "Cache-Control": "no-store",
    },
  });
}
