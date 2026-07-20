/**
 * Gemeinsame Bausteine fuer den E-Mail-Code-Login.
 *
 * Kein eigener Routen-Handler (kein onRequest*-Export), deshalb ohne eigenen
 * Pfad - nur ein Modul, das die Auth-Endpunkte und todos.js importieren.
 */

export const COOKIE_NAME = "todo_session";
const SESSION_TAGE = 30;

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

export function setzeSessionCookie(request, token) {
  const maxAge = SESSION_TAGE * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=${maxAge}`;
}

export function loescheSessionCookie(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secureFlag(request)} SameSite=Lax; Max-Age=0`;
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
