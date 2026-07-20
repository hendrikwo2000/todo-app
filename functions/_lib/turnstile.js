/**
 * Bot-Schutz fuer das oeffentliche Wartelisten-Formular (Cloudflare Turnstile).
 *
 * Nur dort. Der Login braucht ihn nicht: dort kommen ohnehin nur bekannte
 * Adressen durch, und pro Adresse hoechstens eine Mail pro Minute.
 */

const PRUEF_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Gibt null zurueck, wenn alles in Ordnung ist - sonst einen Fehlertext.
 *
 * Ohne gesetztes TURNSTILE_SECRET wird NICHT geprueft. Das ist Absicht: so
 * laeuft die lokale Entwicklung ohne Schluessel weiter. In der Produktion
 * muss die Variable gesetzt sein, sonst ist das Formular ungeschuetzt - die
 * README sagt das ausdruecklich.
 */
export async function pruefeTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return null;
  if (!token) return "Bitte bestätige, dass du kein Bot bist.";

  const daten = new FormData();
  daten.append("secret", env.TURNSTILE_SECRET);
  daten.append("response", token);
  if (ip) daten.append("remoteip", ip);

  let res;
  try {
    res = await fetch(PRUEF_URL, { method: "POST", body: daten });
  } catch (e) {
    // Lieber durchlassen als alle aussperren, wenn Cloudflare klemmt: die
    // Ratenbegrenzung im Endpunkt greift ohnehin noch.
    return null;
  }
  if (!res.ok) return null;

  const ergebnis = await res.json().catch(() => null);
  if (!ergebnis) return null;
  return ergebnis.success ? null : "Die Bot-Prüfung ist fehlgeschlagen. Lade die Seite neu.";
}
