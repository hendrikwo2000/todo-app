/**
 * Gemeinsame Bausteine fuer den E-Mail-Code-Login.
 *
 * Kein eigener Routen-Handler (kein onRequest*-Export), deshalb ohne eigenen
 * Pfad - nur ein Modul, das die Auth-Endpunkte und todos.js importieren.
 */

export const COOKIE_NAME = "todo_session";

// Mehrere Konten im selben Browser, je Tab eines (gedacht fuer Admin +
// Testkonto). Das erste Konto bleibt in COOKIE_NAME - das sehen auch das
// Schul-Dashboard und alles, was von Mehrkonten nichts weiss. Alle weiteren
// Sitzungstoken stehen mit Punkt getrennt in diesem zweiten Cookie (base64url
// kennt keinen Punkt). Host-only, weil nur die ToDo-Liste sie lesen muss.
export const WEITERE_COOKIE = "todo_weitere";
export const MAX_KONTEN = 5;

// Welches der angemeldeten Konten ein Tab meint, schickt konto.js bei jeder
// API-Anfrage als Header mit. Echte Seitenaufrufe (Google verbinden) koennen
// keinen Header setzen, die haengen ?konto= an die Adresse.
const KONTO_HEADER = "X-Konto";

// Das Sitzungs-Cookie gilt fuer die ganze Domain, nicht nur fuer
// todo.it-wolf.org. Nur so sieht eine zweite App auf einer eigenen Subdomain
// (heute das Schul-Dashboard auf schule.it-wolf.org, bis Oktober 2026 auch die
// eigene Fokus-App) dieselbe Anmeldung - der geteilte Login haengt allein an
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
 * eine zweite App auf einer anderen Subdomain sieht die Anmeldung.
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

// ---------- Mehrere Konten im selben Browser ----------

/** Konto-ID, die der Tab ausdruecklich meint - oder null (= erstes Konto). */
export function gewaehltesKonto(request) {
  const roh = request.headers.get(KONTO_HEADER) || new URL(request.url).searchParams.get("konto");
  const id = Number(roh);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function alleTokens(request) {
  const haupt = liesCookie(request, COOKIE_NAME);
  const weitere = (liesCookie(request, WEITERE_COOKIE) || "").split(".").filter(Boolean);
  return [haupt, ...weitere].filter(Boolean).slice(0, MAX_KONTEN);
}

/**
 * Alle gueltigen Sitzungen dieses Browsers, in Cookie-Reihenfolge:
 * [{ token, haupt, nutzer: { id, email, name, role } }].
 *
 * Abgelaufene oder geloeschte Token fallen still heraus. Taucht ein Konto
 * doppelt auf (zweimal angemeldet), zaehlt nur der erste Eintrag.
 */
export async function browserSitzungen(request, env) {
  const tokens = alleTokens(request);
  if (!tokens.length) return [];
  const hashes = await Promise.all(tokens.map(hashHex));
  const { results } = await env.DB.prepare(
    `SELECT s.token_hash, u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash IN (${hashes.map(() => "?").join(",")})
        AND s.expires_at > datetime('now')`
  ).bind(...hashes).all();
  const zuHash = new Map((results || []).map(z => [z.token_hash, z]));
  const gesehen = new Set();
  const sitzungen = [];
  tokens.forEach((token, i) => {
    const z = zuHash.get(hashes[i]);
    if (!z || gesehen.has(z.id)) return;
    gesehen.add(z.id);
    sitzungen.push({
      token,
      haupt: i === 0,
      nutzer: { id: z.id, email: z.email, name: z.name, role: z.role },
    });
  });
  return sitzungen;
}

function weitereCookie(request, tokens) {
  if (!tokens.length) {
    return `${WEITERE_COOKIE}=; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`;
  }
  const maxAge = COOKIE_TAGE * 24 * 60 * 60;
  return `${WEITERE_COOKIE}=${tokens.join(".")}; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Set-Cookie-Zeilen, damit der Browser genau diese Token haelt - das erste
 * als Hauptsitzung, der Rest als weitere. Schreibt nur, was sich aendert.
 */
function kontenCookies(request, tokens) {
  if (!tokens.length) return loescheAlleKontenCookies(request);
  const hatteWeitere = !!liesCookie(request, WEITERE_COOKIE);
  const cookies = [];
  if (tokens[0] !== liesCookie(request, COOKIE_NAME)) cookies.push(...setzeSessionCookies(request, tokens[0]));
  if (tokens.length > 1 || hatteWeitere) cookies.push(weitereCookie(request, tokens.slice(1)));
  return cookies;
}

/** Alles weg: Hauptsitzung samt weiteren Konten (Abmelden ohne Datenbank). */
export function loescheAlleKontenCookies(request) {
  const weg = loescheSessionCookies(request);
  if (liesCookie(request, WEITERE_COOKIE)) weg.push(weitereCookie(request, []));
  return weg;
}

/**
 * Vor einer frischen Anmeldung klaeren, welche Cookies sie setzt.
 *
 * Normalfall wie immer: die neue Sitzung ersetzt die alte. Ist in diesem
 * Browser aber schon ein Admin angemeldet, kommt ein anderes Konto DAZU, statt
 * die bisherigen abzumelden - das ist die ganze Freischaltung fuer Mehrkonten,
 * normale Nutzer kommen nie in diesen Zweig. Meldet sich ein Konto an, das
 * schon dabei ist, bekommt es nur sein Token erneuert.
 *
 * Vor dem Verbrauchen des Codes aufrufen: bei vollem Browser (`zuviele`) soll
 * der Link gueltig bleiben.
 */
export async function anmeldungVorbereiten(request, env, nutzerId) {
  const sitzungen = await browserSitzungen(request, env);
  const mehrkonten = sitzungen.some(s => s.nutzer.role === "admin");
  const schonDa = sitzungen.some(s => s.nutzer.id === nutzerId);
  if (mehrkonten && !schonDa && sitzungen.length >= MAX_KONTEN) return { zuviele: true };
  return {
    zuviele: false,
    cookies(token) {
      if (!mehrkonten) return { cookies: setzeSessionCookies(request, token), zusaetzlich: false };
      const tokens = sitzungen.map(s => (s.nutzer.id === nutzerId ? token : s.token));
      if (!schonDa) tokens.push(token);
      return { cookies: kontenCookies(request, tokens), zusaetzlich: tokens.length > 1 };
    },
  };
}

/**
 * Nach Abmelden oder Kontoloeschung: die Cookies auf die Sitzungen
 * zurechtstutzen, die in der Datenbank noch gelten. Faellt das erste Konto
 * weg, rueckt das naechste nach - der Browser bleibt angemeldet, nur eben mit
 * einem Konto weniger.
 */
export async function cookiesNachAbmelden(request, env) {
  const rest = await browserSitzungen(request, env);
  return { cookies: kontenCookies(request, rest.map(s => s.token)), rest };
}

/**
 * Liefert { id, email, name, role } der aktuellen Sitzung, oder null.
 *
 * Die Rolle kommt bei JEDER Anfrage frisch aus der Datenbank statt aus dem
 * Cookie. Sonst behielte jemand, dem man Adminrechte entzogen hat, sie bis
 * zum Ablauf seiner Sitzung - bis zu 30 Tage.
 *
 * Meint der Tab ein bestimmtes Konto (`kontoId`), zaehlt nur die Sitzung
 * genau dieses Kontos. Ist sie weg, gibt es null statt still das erste Konto -
 * sonst speicherte ein Tab, der sich fuer "Test" haelt, ins Admin-Konto.
 */
export async function angemeldeterNutzer(request, env, kontoId = gewaehltesKonto(request)) {
  if (kontoId != null) {
    const treffer = (await browserSitzungen(request, env)).find(s => s.nutzer.id === kontoId);
    return treffer ? treffer.nutzer : null;
  }
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
