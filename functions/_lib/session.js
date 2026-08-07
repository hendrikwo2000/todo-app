/**
 * Gemeinsame Bausteine fuer den E-Mail-Code-Login.
 *
 * Kein eigener Routen-Handler (kein onRequest*-Export), deshalb ohne eigenen
 * Pfad - nur ein Modul, das die Auth-Endpunkte und todos.js importieren.
 */

export const COOKIE_NAME = "todo_session";

// Das Sitzungs-Cookie gilt fuer die ganze Domain, nicht nur fuer
// todo.it-wolf.org. Nur so sieht eine zweite App auf einer eigenen Subdomain
// (fokus.it-wolf.org) dieselbe Anmeldung - der geteilte Login haengt allein an
// diesem Attribut, nicht am Hosting-Ort.
const COOKIE_DOMAIN = ".it-wolf.org";

// Sitzungen laufen nicht von selbst ab - nur Abmelden oder Kontoloeschung
// beendet sie. In der Datenbank steht dafuer ein weit entferntes Datum,
// damit die Abfrage "expires_at > now" einfach bleiben kann.
export const SESSION_ABLAUF_SQL = "datetime('now', '+100 years')";

// Browser deckeln Cookies inzwischen bei 400 Tagen (Chrome und Safari
// kuerzen laengere Werte stillschweigend). Laenger anzugeben bringt also
// nichts; nach 400 Tagen ohne Besuch meldet man sich einmal neu an.
const COOKIE_TAGE = 400;

export async function hashHex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Vergleich ohne fruehen Ausstieg - siehe todos.js fuer die ausfuehrliche
// Begruendung. Hier fuer Codes und (indirekt) Sitzungstoken verwendet.
export function zeitgleich(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function neuesToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function liesCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const teil of header.split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich === -1) continue;
    if (teil.slice(0, gleich).trim() === name) return teil.slice(gleich + 1).trim();
  }
  return null;
}

// Secure nur bei HTTPS setzen - sonst wuerde der Browser das Cookie beim
// lokalen Testen mit "wrangler pages dev" (http://127.0.0.1) verwerfen.
function secureFlag(request) {
  return new URL(request.url).protocol === "https:" ? " Secure;" : "";
}

/**
 * Domain nur auf der echten Domain setzen.
 *
 * Auf 127.0.0.1 (wrangler pages dev) und auf den *.pages.dev-Vorschauadressen
 * wuerde der Browser ein fremdes Domain-Attribut still verwerfen: das Cookie
 * kaeme gar nicht erst an, und die Anmeldung braeche ohne sichtbaren Fehler.
 */
function domainFlag(request) {
  const host = new URL(request.url).hostname;
  const eigen = host === "it-wolf.org" || host.endsWith(".it-wolf.org");
  return eigen ? ` Domain=${COOKIE_DOMAIN};` : "";
}

// Dasselbe Cookie OHNE Domain-Attribut, auf sofort abgelaufen gesetzt.
//
// Vor der Umstellung war das Cookie host-only (nur todo.it-wolf.org). Bliebe
// es liegen, lagen zwei Cookies gleichen Namens nebeneinander - der Browser
// schickt beide, und welches der Server zuerst liest, ist nicht definiert.
// Loeschen matcht auf Name + Domain + Pfad, das domainweite bleibt also stehen.
function altesHostCookieWeg(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`;
}

/**
 * Alle Set-Cookie-Zeilen fuer eine frische Sitzung.
 *
 * Array statt einem String, weil beim Umstieg zwei Zeilen noetig sind: die neue
 * domainweite - und die Loeschung der alten host-only. Ein Objekt-Literal in
 * den Antwort-Headern kann "Set-Cookie" nur einmal enthalten, deshalb muessen
 * die Aufrufer sie einzeln anhaengen (siehe mitCookies).
 */
export function setzeSessionCookies(request, token) {
  const maxAge = COOKIE_TAGE * 24 * 60 * 60;
  const domain = domainFlag(request);
  const neu = `${COOKIE_NAME}=${token}; Path=/;${domain} HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=${maxAge}`;
  return domain ? [altesHostCookieWeg(request), neu] : [neu];
}

/**
 * Stiller Umstieg vom alten host-only- auf das domainweite Cookie.
 *
 * Wird bei jedem GET /api/todos mitgeschickt: derselbe Token, nur mit
 * Domain-Attribut, plus die Loeschung der alten Zeile. Kein Datenbankzugriff,
 * kein Abmelden - beim naechsten Oeffnen der Liste ist das Cookie migriert und
 * die zweite App auf fokus.it-wolf.org sieht die Anmeldung.
 *
 * Leeres Array auf allen Hosts ohne Domain-Attribut (lokal, *.pages.dev) -
 * dort wuerde das alte Cookie sonst geloescht, ohne dass ein neues ankommt.
 */
export function umstiegAufDomainCookie(request) {
  const token = liesCookie(request, COOKIE_NAME);
  if (!token || !domainFlag(request)) return [];
  return setzeSessionCookies(request, token);
}

// Beim Abmelden beide Varianten entwerten - wer sich vor der Umstellung
// angemeldet hat, haengt sonst an einem Cookie fest, das niemand mehr loescht.
export function loescheSessionCookies(request) {
  const domain = domainFlag(request);
  const weg = [altesHostCookieWeg(request)];
  if (domain) {
    weg.push(`${COOKIE_NAME}=; Path=/;${domain} HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`);
  }
  return weg;
}

/**
 * Antwort-Header aus einem Objekt bauen und die Cookie-Zeilen einzeln
 * anhaengen. `new Headers({...})` allein wuerde bei zwei Set-Cookie-Werten
 * einen davon verschlucken.
 */
export function mitCookies(basis, cookies = []) {
  const headers = new Headers(basis);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

/**
 * Liefert { id, email, name, role } der aktuellen Sitzung, oder null.
 *
 * Die Rolle kommt bei JEDER Anfrage frisch aus der Datenbank statt aus dem
 * Cookie. Sonst behielte jemand, dem man Adminrechte entzogen hat, sie bis
 * zum Ablauf seiner Sitzung - bis zu 30 Tage.
 */
export async function angemeldeterNutzer(request, env) {
  const token = liesCookie(request, COOKIE_NAME);
  if (!token) return null;
  const hash = await hashHex(token);
  const sitzung = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  ).bind(hash).first();
  if (!sitzung) return null;
  return await env.DB.prepare(
    "SELECT id, email, name, role FROM users WHERE id = ?"
  ).bind(sitzung.user_id).first();
}

// Wie oben, aber null fuer alle ohne Adminrechte.
export async function angemeldeterAdmin(request, env) {
  const nutzer = await angemeldeterNutzer(request, env);
  return nutzer && nutzer.role === "admin" ? nutzer : null;
}
