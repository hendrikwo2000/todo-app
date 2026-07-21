-- Migration: EINE Liste pro Nutzer  ->  teilbare Listen (boards + board_members)
--
-- Bringt eine BESTEHENDE Datenbank vom alten Stand (lists haengen direkt an
-- user_id) auf das neue Schema (schema.sql): ueber den Bereichen sitzt die
-- Ebene `boards`, Zugriff steht in `board_members`.
--
-- Fuer jeden vorhandenen Nutzer entsteht genau eine Liste "Meine Liste", in
-- die seine bisherigen Bereiche und ToDos unveraendert wandern. Nichts geht
-- verloren, es kommt nur eine Klammer darum.
--
-- EINMALIG ausfuehren. Vorher ein Backup ziehen:
--   wrangler d1 export todo --output=todo-backup.sql
-- Dann:
--   wrangler d1 execute todo --file=migration-boards.sql
--
-- Rollback bei Bedarf: das Backup zurueckspielen.

-- Waehrend des Umbaus keine Fremdschluessel erzwingen: die lists-Tabelle wird
-- neu aufgebaut (SQLite kann keine Spalte einfach entfernen), und todos zeigt
-- darauf. D1 erzwingt Fremdschluessel ohnehin nicht von selbst; diese Zeile
-- ist die ausdrueckliche Absicherung.
PRAGMA foreign_keys = OFF;

-- 1) Neue Tabellen anlegen -------------------------------------------------
CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  share_token TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE board_members (
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  position  INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board_id, user_id)
);

-- 2) Je Nutzer eine Liste "Meine Liste" + Owner-Mitgliedschaft -------------
-- Deterministische id 'board-u<userId>', damit Schritt 3 die Bereiche ohne
-- Zwischentabelle zuordnen kann.
INSERT INTO boards (id, owner_id, name)
  SELECT 'board-u' || id, id, 'Meine Liste' FROM users;

INSERT INTO board_members (board_id, user_id, role, position)
  SELECT 'board-u' || id, id, 'owner', 0 FROM users;

-- 3) Bereiche (lists) umhaengen: neue Tabelle mit board_id statt user_id ----
CREATE TABLE lists_neu (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO lists_neu (id, board_id, name, position, created_at)
  SELECT id, 'board-u' || user_id, name, position, created_at FROM lists;

DROP TABLE lists;
ALTER TABLE lists_neu RENAME TO lists;

-- 4) Indizes des neuen Schemas ---------------------------------------------
-- idx_lists_user ist mit der alten lists-Tabelle verschwunden.
CREATE INDEX idx_members_user  ON board_members(user_id, position);
CREATE INDEX idx_members_board ON board_members(board_id);
CREATE INDEX idx_boards_owner  ON boards(owner_id);
CREATE INDEX idx_boards_token  ON boards(share_token);
CREATE INDEX idx_lists_board   ON lists(board_id, position);

PRAGMA foreign_keys = ON;
