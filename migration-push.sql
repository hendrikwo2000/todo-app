-- Migration: Push-Benachrichtigungen (faellige ToDos)
--
-- Neue Tabelle fuer Web-Push-Anmeldungen. Ein Nutzer kann mehrere Zeilen haben
-- (z. B. mehrere Geraete) - endpoint ist pro Geraet/Browser eindeutig und
-- damit der Primaerschluessel fuer "gleiches Geraet meldet sich erneut an".
--
-- REIN ADDITIV: nur CREATE TABLE / CREATE INDEX. Kein DROP, keine Cascade-
-- Gefahr wie bei migration-boards.sql.
--
-- EINMALIG ausfuehren:
--   wrangler d1 execute todo --file=migration-push.sql
--
-- Rollback: die Tabelle stoert alten Code nicht (er liest sie nicht). Zum
-- Entfernen: DROP TABLE push_subscriptions.

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);
