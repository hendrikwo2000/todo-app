-- Migration: Unterpunkte (Checkliste innerhalb eines ToDos)
--
-- Neue Tabelle `unterpunkte`. Ein Punkt gehoert zu genau einem ToDo
-- (todo_id, ECHTER Fremdschluessel mit CASCADE - anders als todos.thema_id,
-- das bewusst ohne Fremdschluessel auskommt, weil ein ToDo ein verschwundenes
-- Thema ueberleben soll. Ein Unterpunkt ohne sein ToDo ergibt dagegen keinen
-- Sinn). position ist der Index innerhalb des ToDos, wie bei themen.position
-- innerhalb eines Bereichs. Erlaubte Werte / Validierung siehe
-- functions/api/todos.js.
--
-- REIN ADDITIV: neue Tabelle, ruehrt nichts Bestehendes an.
--
-- EINMALIG ausfuehren. Vorher Backup (Prinzip):
--   wrangler d1 export todo --output=todo-backup.sql
-- Dann:
--   wrangler d1 execute <database-id> --remote --file=migration-unterpunkte.sql
--
-- Rollback: DROP TABLE unterpunkte (nimmt alle Checklisten mit).

CREATE TABLE unterpunkte (
  id       TEXT PRIMARY KEY,
  todo_id  TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  text     TEXT NOT NULL,
  done     INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_unterpunkte_todo ON unterpunkte(todo_id, position);
