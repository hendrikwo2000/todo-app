/**
 * Durchreicher zur Fokus-App.
 *
 * Das Fokus-Panel in der ToDo-Liste (fokus.js) zeigt Gewohnheiten und Timer,
 * die Daten dazu liegen aber im anderen Pages-Projekt. Beide Apps benutzen
 * dieselbe D1-Datenbank, dieser Worker koennte die Tabellen also direkt lesen -
 * und genau das waere der Fehler: Flammen, Rhythmus und Obergrenzen-Regeln
 * (rund 1200 Zeilen in Fokus/web/functions) laegen dann an zwei Orten und
 * liefen mit der Zeit auseinander. Stattdessen fragt dieser Endpunkt die
 * Fokus-App selbst und reicht ihre Antwort durch.
 *
 * WARUM NICHT DIREKT AUS DEM BROWSER: Das Sitzungscookie ist SameSite=Lax
 * (functions/_lib/session.js). Ein fetch von todo.it-wolf.org nach
 * fokus.it-wolf.org bekaeme es nicht mit, die Fokus-App saehe also einen
 * Fremden. Von Worker zu Worker geht der Cookie-Kopf dagegen mit.
 *
 * PREIS: Ist die Fokus-App gerade nicht erreichbar (Deploy, Stoerung), liefert
 * dieser Endpunkt 502 und das Panel zeigt einen Fehler. Die ToDo-Liste selbst
 * bleibt davon unberuehrt - sie holt ihre Daten weiter aus der eigenen API.
 */

import { nutzerOderFehler } from "../../_lib/zugang.js";
import { json } from "../../_lib/listen.js";

// Wohin die Fokus-App gefragt wird. Ueber eine Variable ueberschreibbar, damit
// beim lokalen Testen der Dev-Server nebenan antwortet
// (FOKUS_BASIS=http://127.0.0.1:8792 in .dev.vars) statt der Live-App.
const STANDARD_BASIS = "https://fokus.it-wolf.org";

/**
 * Was das Panel darf - vollstaendig aufgezaehlt, kein freies Durchreichen.
 *
 * Ohne diese Liste haenge an /api/fokus/ die GANZE Fokus-API, auch
 * `DELETE /api/gewohnheiten` (Gewohnheit endgueltig loeschen) oder der Export.
 * Das Panel kann abhaken und den Timer bedienen, mehr soll es hier auch nicht
 * koennen - alles Weitere gehoert in die Fokus-App selbst.
 */
const ROUTEN = {
  "gewohnheiten/heute": { ziel: "/api/gewohnheiten/heute", methode: "GET" },
  "gewohnheiten/log":   { ziel: "/api/gewohnheiten/log",   methode: "PUT" },
  "timer":              { ziel: "/api/fokus",              methode: "GET" },
  "timer/start":        { ziel: "/api/fokus/start",        methode: "POST" },
  "timer/pause":        { ziel: "/api/fokus/pause",        methode: "POST" },
  "timer/stop":         { ziel: "/api/fokus/stop",         methode: "POST" },
};

export async function onRequest({ request, env, params }) {
  const pfad = (Array.isArray(params.pfad) ? params.pfad : [params.pfad]).join("/");
  const route = ROUTEN[pfad];
  // 404 statt 405 auch bei falscher Methode: was es hier nicht gibt, muss auch
  // nicht verraten, dass es das woanders gaebe.
  if (!route || route.methode !== request.method) {
    return json({ error: "Nicht gefunden" }, 404);
  }

  // Erst hier pruefen, nicht erst drueben: sonst waere dieser Endpunkt eine
  // offene Weiterleitung, ueber die jeder die Fokus-API anklopfen koennte.
  // fokusZugang kommt aus derselben Abfrage wie die Anmeldung.
  const { fokusZugang, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;
  if (!fokusZugang) {
    return json({ error: "Dieses Konto ist für den Fokus-Tracker nicht freigeschaltet." }, 403);
  }

  const basis = (env.FOKUS_BASIS || STANDARD_BASIS).replace(/\/+$/, "");
  const ziel = basis + route.ziel + new URL(request.url).search;

  // Nur das Noetigste weiterreichen. Vor allem der Cookie-Kopf - daran haengt
  // drueben die ganze Anmeldung.
  const kopf = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) kopf.set("cookie", cookie);
  if (request.headers.get("content-type")) {
    kopf.set("content-type", request.headers.get("content-type"));
  }

  let antwort;
  try {
    antwort = await fetch(ziel, {
      method: route.methode,
      headers: kopf,
      body: route.methode === "GET" ? undefined : await request.text(),
      redirect: "manual",
    });
  } catch (e) {
    return json({ error: "Der Fokus-Tracker ist gerade nicht erreichbar." }, 502);
  }

  // Antwort neu aufbauen statt durchzureichen: ein Set-Cookie von drueben hat
  // hier nichts zu suchen (die Sitzung verwaltet diese App), und der Rest der
  // Koepfe interessiert das Panel nicht.
  const text = await antwort.text();
  return new Response(text, {
    status: antwort.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
