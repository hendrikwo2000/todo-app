/**
 * Google-Verknuepfung loesen.
 *
 * Widerruft das Token ZUERST bei Google und loescht dann die Zeile. Nur zu
 * loeschen wuerde die Erlaubnis in den Google-Kontoeinstellungen stehen lassen -
 * "getrennt" waere dann eine halbe Wahrheit. Scheitert der Widerruf (Google
 * nicht erreichbar), loeschen wir trotzdem: sonst bliebe man hier haengen,
 * obwohl man weg will.
 */

import { json } from "../../_lib/listen.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { kontoFuer, loescheKonto, widerrufe } from "../../_lib/google.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const konto = await kontoFuer(env, nutzerId);
  if (konto) {
    await widerrufe(konto.refresh_token);
    await loescheKonto(env, nutzerId);
  }
  return json({ ok: true });
}
