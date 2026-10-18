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
import { neuesToken, gewaehltesKonto, mitCookies } from "../../_lib/session.js";
import { fehltEinrichtung, zustimmungsAdresse } from "../../_lib/google.js";

export const STATE_COOKIE = "google_state";
// Mit mehreren Konten im Browser: welches Konto der Tab meinte. Google reicht
// nur `state` durch, die Rueckleitung kann also keinen eigenen Header haben.
export const KONTO_COOKIE = "google_konto";

export async function onRequestGet({ request, env }) {
  const { fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  if (fehltEinrichtung(env)) {
    return json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fehlen im Pages-Projekt" }, 500);
  }

  const state = neuesToken();
  const sicher = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  const konto = gewaehltesKonto(request);
  return new Response(null, {
    status: 302,
    headers: mitCookies({
      Location: zustimmungsAdresse(env, request, state),
      "Cache-Control": "no-store",
    }, [
      // 10 Minuten reichen fuer die Zustimmung und lassen nichts liegen.
      // SameSite=Lax ist Pflicht: das Cookie muss die Rueckleitung VON Google
      // ueberleben, bei Strict kaeme es dort nicht mit.
      `${STATE_COOKIE}=${state}; Path=/api/google; HttpOnly;${sicher} SameSite=Lax; Max-Age=600`,
      konto
        ? `${KONTO_COOKIE}=${konto}; Path=/api/google; HttpOnly;${sicher} SameSite=Lax; Max-Age=600`
        : `${KONTO_COOKIE}=; Path=/api/google; HttpOnly;${sicher} SameSite=Lax; Max-Age=0`,
    ]),
  });
}
