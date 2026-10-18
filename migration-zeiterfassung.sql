-- Migration: Zeiterfassung statt Fokus-Countdown (18.10.2026)
--
-- Der Timer war ein 25-Minuten-Countdown ohne Bezug ("Fokusminuten pro
-- Woche"). Seit Hendriks Auftrag vom 18.10.2026 ist er eine Stoppuhr, die
-- optional auf ein ToDo bucht - mit Statistik nach Liste, Bereich und ToDo.
-- Neue Tabelle statt Umbau von fokus_sitzungen: dort ist geplante_min NOT NULL
-- und die Dauer steckt in echte_min ohne Endzeit; fuer einen Nachweis braucht
-- es echte Von-bis-Zeiten, die sich nachtraeglich korrigieren lassen.
--
-- REIN ADDITIV: neue Tabelle, Index, und eine Kopie der alten Sitzungen
-- (als "ohne ToDo", damit die bisherige Fokuszeit in der Statistik bleibt).
-- fokus_sitzungen bleibt unangetastet stehen, gelesen wird sie nicht mehr.
-- Alter Code liest die neue Tabelle nicht - kein Bruchfenster zwischen
-- Migration und Push. Mehrfach ausfuehrbar: IF NOT EXISTS und INSERT OR IGNORE
-- (die Kopie behaelt die ids der alten Sitzungen).
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-zeiterfassung.sql
--
-- Rollback: DROP TABLE zeiteintraege (die alten Sitzungen stehen ja noch da).

CREATE TABLE IF NOT EXISTS zeiteintraege (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start         TEXT NOT NULL,                 -- UTC, 'YYYY-MM-DD HH:MM:SS'
  ende          TEXT,                          -- UTC; NULL = die Uhr laeuft
  datum         TEXT NOT NULL,                 -- lokales Datum des Starts
  todo_id       TEXT,
  todo_text     TEXT,
  liste_name    TEXT,
  bereich_name  TEXT,
  gekappt       INTEGER NOT NULL DEFAULT 0,
  nachgetragen  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_zeit_user ON zeiteintraege(user_id, datum);

INSERT OR IGNORE INTO zeiteintraege (id, user_id, start, ende, datum)
SELECT id, user_id, gestartet_am,
       datetime(gestartet_am, '+' || (echte_min * 60) || ' seconds'),
       datum
  FROM fokus_sitzungen
 WHERE echte_min IS NOT NULL AND echte_min > 0;
