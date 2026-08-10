/**
 * Schritt 2 der Google-Verknuepfung: Rueckleitung von Google.
 *
 * Antwortet immer mit einer WEITERLEITUNG auf die Startseite, nie mit JSON -
 * hier landet ein echter Seitenaufruf des Browsers, kein fetch(). Das Ergebnis
 * steht als ?google=... in der Adresse, app.js zeigt daraus eine Meldung und
 * raeumt den Parameter wieder weg.
 */

import { nutzerOderFehler } from "../../_lib/zugang.js";
import { liesCookie } from "../../_lib/session.js";
import {
  fehltEinrichtung, tauscheCode, emailAusIdToken, speichereKonto,
} from "../../_lib/google.js";
import { STATE_COOKIE } from "./start.js";

function zurueck(request, ergebnis) {
  const ziel = new URL("/", request.url);
  ziel.searchParams.set("google", ergebnis);
  const sicher = ziel.protocol === "https:" ? " Secure;" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: ziel.toString(),
      "Set-Cookie": `${STATE_COOKIE}=; Path=/api/google; HttpOnly;${sicher} SameSite=Lax; Max-Age=0`,
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  // Wer hier ohne gueltige Sitzung ankommt (z. B. weil die Anmeldung
  // zwischendurch ablief), soll die Anmeldemaske sehen, keinen 401-Text.
  if (fehler) return zurueck(request, "keine-sitzung");
  if (fehltEinrichtung(env)) return zurueck(request, "nicht-eingerichtet");

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return zurueck(request, "abgebrochen");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erwartet = liesCookie(request, STATE_COOKIE);
  if (!code || !state || !erwartet || state !== erwartet) return zurueck(request, "abgelehnt");

  try {
    const daten = await tauscheCode(env, request, code);
    // Ohne refresh_token waere die Verknuepfung nach einer Stunde still tot.
    // Passiert, wenn access_type/prompt fehlen - lieber hier hart abbrechen
    // als eine Verbindung anbieten, die morgen nicht mehr geht.
    if (!daten.refresh_token) return zurueck(request, "kein-dauerzugriff");
    await speichereKonto(env, nutzerId, {
      email: emailAusIdToken(daten.id_token),
      refreshToken: daten.refresh_token,
      zugriffToken: daten.access_token,
      gueltigSekunden: daten.expires_in,
      // Was wirklich erteilt wurde - der Nutzer kann im Dialog einzelne
      // Berechtigungen abwaehlen, angefragt ist also nicht gleich erteilt.
      scopes: daten.scope || null,
    });
  } catch (e) {
    return zurueck(request, "fehlgeschlagen");
  }

  return zurueck(request, "verbunden");
}
