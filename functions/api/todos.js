/**
 * Proxy zwischen der ToDo-App und JSONBin.io.
 *
 * Warum es das gibt: vorher standen Bin-ID und Access-Key als Konstanten in
 * app.js. Die Datei wird als statische Seite ausgeliefert, jeder Besucher
 * konnte sie also lesen. Solange die Seite unter einer unbekannten
 * GitHub-Pages-Adresse lag, war das kalkuliert; unter todo.it-wolf.org ist es
 * das nicht mehr. Seit dem Umzug laufen alle Zugriffe hierueber, und die
 * Zugangsdaten liegen als Secrets im Pages-Projekt statt im Quelltext.
 *
 * Noetige Umgebungsvariablen (Pages -> Settings -> Environment variables):
 *   JSONBIN_ID        Bin-ID
 *   JSONBIN_KEY       Access-Key mit Lese- und Schreibrecht auf genau dieses Bin
 *   DASHBOARD_URL     (optional) Apps-Script-Endpunkt der Zweitsicherung
 *   DASHBOARD_SECRET  (optional) gemeinsames Geheimnis dafuer
 *
 * Was hier bewusst NICHT passiert: eine Zugriffspruefung. Die ToDos sind schon
 * auf dem Geraet mit AES-GCM verschluesselt, mitlesen bringt also nichts. Ein
 * PUT von aussen koennte den Stand aber ueberschreiben. Das war vorher mit dem
 * oeffentlichen Key genauso, wird durch diesen Proxy also nicht schlechter —
 * behoben ist es damit trotzdem nicht. Siehe README.
 */

const JSONBIN = "https://api.jsonbin.io/v3/b";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Der Stand darf nirgends zwischengespeichert werden: sonst zeigt ein
      // zweites Geraet nach einer Aenderung minutenlang das alte Board.
      "Cache-Control": "no-store",
    },
  });
}

// Fehlt eine Variable, ist das ein Einrichtungsfehler und keine Panne zur
// Laufzeit — deshalb eine Meldung, die sagt, was zu tun ist.
function config(env) {
  if (!env.JSONBIN_ID || !env.JSONBIN_KEY) return null;
  return { id: env.JSONBIN_ID, key: env.JSONBIN_KEY };
}

export async function onRequestGet({ env }) {
  const cfg = config(env);
  if (!cfg) return json({ error: "JSONBIN_ID/JSONBIN_KEY fehlen im Pages-Projekt" }, 500);

  let res;
  try {
    res = await fetch(`${JSONBIN}/${cfg.id}/latest`, {
      headers: { "X-Access-Key": cfg.key },
    });
  } catch (e) {
    return json({ error: "JSONBin nicht erreichbar" }, 502);
  }
  if (!res.ok) return json({ error: `JSONBin antwortete ${res.status}` }, 502);

  const body = await res.json();
  // Nur den Datensatz zurueckgeben, nicht JSONBins Metadaten-Huelle drumherum.
  return json(body.record ?? null);
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const cfg = config(env);
  if (!cfg) return json({ error: "JSONBIN_ID/JSONBIN_KEY fehlen im Pages-Projekt" }, 500);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  // Mindestpruefung: nur vollstaendige Chiffretext-Pakete durchlassen. Das
  // haelt keinen gezielten Angriff auf, verhindert aber, dass ein halb
  // fehlgeschlagener Client den Stand mit Bruchstuecken ueberschreibt.
  const ok = payload && payload.encrypted === true &&
    typeof payload.salt === "string" && typeof payload.iv === "string" &&
    typeof payload.data === "string" && typeof payload.iterations === "number";
  if (!ok) return json({ error: "Kein verschluesseltes Paket" }, 400);

  let res;
  try {
    res = await fetch(`${JSONBIN}/${cfg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Access-Key": cfg.key },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "JSONBin nicht erreichbar" }, 502);
  }
  if (!res.ok) return json({ error: `JSONBin antwortete ${res.status}` }, 502);

  // Zweitsicherung nach Google Drive. Lief frueher im Browser mit mode
  // "no-cors" — von hier aus ist es ein normaler Aufruf, und das Geheimnis
  // bleibt serverseitig. waitUntil haengt ihn hinter die Antwort, damit das
  // Speichern in der App nicht darauf wartet.
  if (env.DASHBOARD_URL && env.DASHBOARD_SECRET) {
    context.waitUntil(
      fetch(env.DASHBOARD_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ secret: env.DASHBOARD_SECRET, todos: payload }),
      }).catch(() => {})   // optional: ein Fehler hier darf das Speichern nicht kippen
    );
  }

  return json({ ok: true });
}
