/**
 * Google-Kalender, ausschliesslich LESEND.
 *
 * Kein Routen-Handler (kein onRequest*-Export), nur ein Modul fuer die
 * Endpunkte unter functions/api/google/.
 *
 * Ablauf: OAuth 2.0 Authorization Code. Der geheime Client-Schluessel bleibt
 * im Worker, der Browser sieht nie ein Google-Token - er fragt immer nur
 * unseren eigenen Endpunkt. Das Refresh-Token liegt in `google_konten` und
 * ueberlebt damit Neuladen, Geraetewechsel und geschlossene Tabs; der
 * Browser-only-Weg (Google Identity Services im Frontend) haette dafuer bei
 * jedem Besuch eine neue Zustimmung gebraucht.
 *
 * WICHTIG zum Ablauf des Refresh-Tokens: solange die App in der Google Cloud
 * Console im Status "Testing" steht, verfaellt es nach 7 Tagen und die
 * Verknuepfung bricht woechentlich. Die App muss auf "In Produktion" stehen -
 * auch ohne Google-Verifizierung. Siehe BETRIEB.md.
 */

const AUTH_URL   = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL  = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE   = "https://www.googleapis.com/calendar/v3";

// openid+email nur, um die verknuepfte Adresse anzeigen zu koennen ("verbunden
// als ..."). calendar.readonly liest Kalenderliste und Termine,
// calendar.events erlaubt zusaetzlich das ANLEGEN eines Termins aus dem
// Kalender-Panel heraus. Beide zusammen, weil calendar.events allein die
// Kalenderliste nicht sicher abdeckt.
//
// Wer vor der Erweiterung verknuepft hat, hat calendar.events NICHT im Token -
// deshalb merkt sich `google_konten.scopes`, was tatsaechlich erteilt wurde,
// und die App bietet das Anlegen nur an, wenn es gedeckt ist (siehe
// darfSchreiben).
export const SCOPE_SCHREIBEN = "https://www.googleapis.com/auth/calendar.events";
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  SCOPE_SCHREIBEN,
].join(" ");

export function darfSchreiben(konto) {
  return !!(konto && typeof konto.scopes === "string" && konto.scopes.includes(SCOPE_SCHREIBEN));
}

// Muss ZEICHENGENAU mit einer der in der Google Cloud Console eingetragenen
// Weiterleitungs-URIs uebereinstimmen, sonst lehnt Google mit
// "redirect_uri_mismatch" ab. Wird aus der aufgerufenen Adresse abgeleitet,
// damit lokal (http://localhost:8790) und live (https://todo.it-wolf.org)
// dieselbe Datei funktioniert - beide muessen bei Google hinterlegt sein.
export function weiterleitungsZiel(request) {
  return new URL("/api/google/callback", request.url).origin + "/api/google/callback";
}

export function fehltEinrichtung(env) {
  return !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET;
}

export function zustimmungsAdresse(env, request, state) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", weiterleitungsZiel(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  // offline + consent sind zusammen noetig, damit Google ein Refresh-Token
  // herausgibt. Ohne prompt=consent kommt bei einer ZWEITEN Zustimmung
  // desselben Kontos keins mehr - die Verknuepfung waere dann nach einer
  // Stunde tot, ohne dass beim ersten Test etwas auffaellt.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

// Fehler, die den Nutzer betreffen (Zugriff bei Google widerrufen, Token
// ungueltig), tragen code="getrennt" - die Endpunkte raeumen dann die Zeile
// weg und die App bietet neu zu verknuepfen an.
function getrenntFehler(text) {
  const e = new Error(text);
  e.code = "getrennt";
  return e;
}

async function tokenAnfrage(felder) {
  const antwort = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(felder),
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    // invalid_grant heisst: der Nutzer hat den Zugriff bei Google entzogen
    // oder das Token ist abgelaufen (Testing-Status, siehe Kopfkommentar).
    if (daten.error === "invalid_grant") throw getrenntFehler("Google-Zugriff nicht mehr gueltig");
    throw new Error("Google-Anmeldung fehlgeschlagen: " + (daten.error || antwort.status));
  }
  return daten;
}

export async function tauscheCode(env, request, code) {
  return await tokenAnfrage({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: weiterleitungsZiel(request),
  });
}

/**
 * E-Mail-Adresse aus dem id_token lesen.
 *
 * Ohne Signaturpruefung, und das ist hier in Ordnung: das Token kommt aus
 * unserer EIGENEN, direkten HTTPS-Antwort von Google, nicht aus dem Browser -
 * es gibt keinen Weg, auf dem jemand ein gefaelschtes unterschieben koennte.
 * Die Adresse ist ausserdem reine Anzeige ("verbunden als ..."), an ihr haengt
 * keine Berechtigung.
 */
export function emailAusIdToken(idToken) {
  try {
    const teil = String(idToken).split(".")[1];
    const roh = atob(teil.replace(/-/g, "+").replace(/_/g, "/"));
    const nutzlast = JSON.parse(decodeURIComponent(escape(roh)));
    return nutzlast.email || null;
  } catch (e) {
    return null;
  }
}

export async function kontoFuer(env, nutzerId) {
  return await env.DB.prepare(
    "SELECT user_id, google_email, refresh_token, zugriff_token, zugriff_bis, scopes FROM google_konten WHERE user_id = ?"
  ).bind(nutzerId).first();
}

export async function speichereKonto(env, nutzerId, { email, refreshToken, zugriffToken, gueltigSekunden, scopes }) {
  await env.DB.prepare(
    `INSERT INTO google_konten (user_id, google_email, refresh_token, zugriff_token, zugriff_bis, scopes, verbunden_am)
     VALUES (?, ?, ?, ?, datetime('now', ?), ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       google_email = excluded.google_email,
       refresh_token = excluded.refresh_token,
       zugriff_token = excluded.zugriff_token,
       zugriff_bis = excluded.zugriff_bis,
       scopes = excluded.scopes,
       verbunden_am = excluded.verbunden_am`
  ).bind(nutzerId, email, refreshToken, zugriffToken || null,
         `+${Math.max(60, gueltigSekunden || 3600)} seconds`, scopes || null).run();
}

export async function loescheKonto(env, nutzerId) {
  await env.DB.prepare("DELETE FROM google_konten WHERE user_id = ?").bind(nutzerId).run();
}

/**
 * Gueltiges Zugriffs-Token, notfalls frisch geholt.
 *
 * 60 Sekunden Sicherheitsabstand vor dem Ablauf - sonst laeuft das Token
 * ausgerechnet zwischen Pruefung und Abruf ab.
 */
export async function frischesZugriffToken(env, konto) {
  // zugriff_bis kommt aus SQLites datetime() und ist UTC ohne Zeitzonen-
  // Kennung ("2026-08-11 09:15:00"). Ohne das angehaengte "Z" wuerde der
  // Worker es als Ortszeit lesen und je nach Zone stundenweise danebenliegen.
  if (konto.zugriff_token && konto.zugriff_bis) {
    const bis = Date.parse(String(konto.zugriff_bis).replace(" ", "T") + "Z");
    if (bis && bis - Date.now() > 60_000) return konto.zugriff_token;
  }

  const daten = await tokenAnfrage({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: konto.refresh_token,
    grant_type: "refresh_token",
  });
  await env.DB.prepare(
    "UPDATE google_konten SET zugriff_token = ?, zugriff_bis = datetime('now', ?) WHERE user_id = ?"
  ).bind(daten.access_token, `+${Math.max(60, daten.expires_in || 3600)} seconds`, konto.user_id).run();
  return daten.access_token;
}

async function hole(pfad, token, params) {
  const url = new URL(API_BASE + pfad);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const antwort = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (antwort.status === 401 || antwort.status === 403) throw getrenntFehler("Google verweigert den Zugriff");
  if (!antwort.ok) throw new Error("Google antwortet mit " + antwort.status);
  return await antwort.json();
}

/**
 * Die Kalender des Kontos - Name und Farbe fuer die Umschalter im Panel.
 * `primaer` markiert den Hauptkalender: nur der ist nach dem Verknuepfen
 * eingeschaltet, sonst pflastern Feiertage und Geburtstage sofort den Monat zu.
 */
export async function kalenderListe(token) {
  const daten = await hole("/users/me/calendarList", token, { maxResults: "250", minAccessRole: "reader" });
  return (daten.items || []).map(k => ({
    id: k.id,
    name: k.summaryOverride || k.summary || k.id,
    farbe: k.backgroundColor || null,
    primaer: !!k.primary,
  }));
}

/**
 * Farbpalette fuer EINZELNE Termine.
 *
 * In Google kann jeder Termin eine eigene Farbe tragen (`colorId`), die die
 * Farbe seines Kalenders ueberschreibt. Die id ist nur ein Schluessel wie "5" -
 * den Hexwert dazu kennt allein dieser Endpunkt. Er ist fuer alle Konten
 * gleich und aendert sich praktisch nie, wird deshalb nur geholt, wenn im
 * Zeitraum ueberhaupt ein Termin eine eigene Farbe hat.
 */
export async function farbPalette(token) {
  const daten = await hole("/colors", token, {});
  const palette = {};
  for (const [id, wert] of Object.entries((daten && daten.event) || {})) {
    palette[id] = wert.background || null;
  }
  return palette;
}

/**
 * Termine eines Kalenders im Zeitraum.
 *
 * singleEvents=true laesst GOOGLE die Serientermine in Einzeltermine
 * aufloesen - sonst muesste die App RRULE, Ausnahmen und Zeitzonen selbst
 * nachrechnen. Ganztaegige Termine liefert Google als {date}, terminierte als
 * {dateTime}; daran erkennt der Aufrufer sie auch.
 */
export async function termineVon(token, kalenderId, vonIso, bisIso) {
  const daten = await hole(`/calendars/${encodeURIComponent(kalenderId)}/events`, token, {
    timeMin: vonIso,
    timeMax: bisIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  return (daten.items || [])
    .filter(e => e.status !== "cancelled")
    .map(e => ({
      id: e.id,
      kalenderId,
      colorId: e.colorId || null,   // eigene Farbe des Termins, siehe farbPalette()
      titel: e.summary || "(ohne Titel)",
      ganztags: !!(e.start && e.start.date),
      start: (e.start && (e.start.dateTime || e.start.date)) || null,
      ende: (e.end && (e.end.dateTime || e.end.date)) || null,
      ort: e.location || null,
      beschreibung: e.description ? String(e.description).slice(0, 500) : null,
    }))
    .filter(e => e.start);
}

/**
 * Ganztaegigen Termin anlegen.
 *
 * Ganztaegig, weil er im Panel aus einer TAGES-Zelle heraus entsteht - eine
 * Uhrzeit gibt es an der Stelle gar nicht. Google erwartet das Ende als ersten
 * Tag DANACH (exklusiv), deshalb der Tag Aufschlag.
 */
export async function legeTerminAn(token, kalenderId, { titel, datum }) {
  const ende = new Date(datum + "T00:00:00");
  ende.setDate(ende.getDate() + 1);
  const endeIso = `${ende.getFullYear()}-${String(ende.getMonth() + 1).padStart(2, "0")}-${String(ende.getDate()).padStart(2, "0")}`;

  const antwort = await fetch(`${API_BASE}/calendars/${encodeURIComponent(kalenderId)}/events`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: titel, start: { date: datum }, end: { date: endeIso } }),
  });
  if (antwort.status === 401) throw getrenntFehler("Google verweigert den Zugriff");
  // 403 heisst hier fast immer: das Token traegt den Schreib-Scope nicht,
  // weil die Verknuepfung aelter ist als diese Funktion.
  if (antwort.status === 403) {
    const e = new Error("Keine Schreibberechtigung");
    e.code = "kein-schreibrecht";
    throw e;
  }
  if (!antwort.ok) throw new Error("Google antwortet mit " + antwort.status);
  return await antwort.json();
}

export async function widerrufe(token) {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch (e) { /* Trennen bei uns gilt trotzdem - siehe trennen.js */ }
}
