/**
 * Die Uhr anhalten und den Eintrag buchen.
 *
 * Kein Fehler, wenn keine laeuft: zwei Tabs koennen gleichzeitig stoppen, und
 * beim zweiten ist schlicht nichts mehr zu tun. War sie ueber den Deckel
 * gelaufen, hat laufenderEintrag sie schon gekappt - auch dann kommt
 * `beendet: null`, und die App holt den Stand samt Hinweis neu. Ebenso bei
 * einer Strecke unter MIN_SEK: die verwirft beende() als Fehlgriff.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { laufenderEintrag, beende } from "../../_lib/zeit.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const zeile = await laufenderEintrag(env, nutzerId);
    if (!zeile) return json({ ok: true, beendet: null });
    return json({ ok: true, beendet: await beende(env, nutzerId, zeile) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Stoppen" }, 500);
  }
}
