-- Migration: Ueber-Themen einfuehren (optionale Ebene zwischen Bereich und ToDo)
--
-- Bringt eine BESTEHENDE Datenbank auf das Schema mit benannten Ueber-Themen:
-- eine neue Tabelle `themen` und eine neue Spalte `todos.thema_id`. Ein ToDo
-- kann damit optional einer benannten Gruppe innerhalb seines Bereichs
-- zugeordnet werden; ohne Zuordnung (thema_id NULL) bleibt alles wie bisher.
--
-- REIN ADDITIV: nur CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE INDEX.
-- Kein DROP, kein Tabellen-Neuaufbau - also KEINE Cascade-Gefahr wie bei
-- migration-boards.sql (dort loeschte der DROP von lists ueber den
-- Fremdschluessel beinahe alle ToDos). Bestehende Zeilen bleiben unangetastet,
-- thema_id ist bei allen alten ToDos automatisch NULL.
--
-- EINMALIG ausfuehren. Vorher trotzdem ein Backup ziehen (Prinzip):
--   wrangler d1 export todo --output=todo-backup.sql
-- Dann:
--   wrangler d1 execute todo --file=migration-themen.sql
--
-- Rollback: die Spalte/Tabelle stoert alten Code nicht (er liest sie nicht).
-- Zum harten Zuruecksetzen das Backup zurueckspielen.

-- 1) Neue Spalte an den ToDos. NULL = frei im Bereich (bisheriges Verhalten).
ALTER TABLE todos ADD COLUMN thema_id TEXT;

-- 2) Die Ueber-Themen selbst. Struktur wie lists, eine Ebene tiefer.
CREATE TABLE themen (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3) Index fuer "alle Themen eines Bereichs in Reihenfolge".
CREATE INDEX idx_themen_list ON themen(list_id, position);
