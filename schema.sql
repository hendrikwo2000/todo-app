-- Schema der ToDo-App (Cloudflare D1 / SQLite).
--
-- Ersetzt den einen JSONBin-Datensatz, in dem frueher alles zusammen lag.
-- Aufbau: ein Nutzer hat mehrere Bereiche ("lists" - die Spalten im Board),
-- ein Bereich hat mehrere ToDos.
--
-- Bewusst KEINE Verschluesselung mehr: mit Spalten statt Chiffretext kann die
-- Datenbank sortieren und filtern, das Admin-Dashboard etwas anzeigen und
-- spaeter eine Liste zwischen Nutzern geteilt werden. Der Preis ist, dass der
-- Betreiber die Inhalte lesen kann - siehe README.
--
-- Einspielen:  wrangler d1 execute todo --file=schema.sql
-- oder die Datei im Dashboard unter D1 -> Console einfuegen.

-- ---------------------------------------------------------------- Nutzer ---
-- role steuert den Zugang zum Admin-Dashboard. Absichtlich eine Spalte und
-- keine fest verdrahtete Adresse im Code: ein zweiter Admin oder eine neue
-- Mailadresse ist damit ein UPDATE statt eines Deployments.
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------- Bereiche ---
-- id bleibt TEXT, damit die vorhandenen UUIDs aus JSONBin unveraendert
-- uebernommen werden koennen - die App erzeugt sie weiterhin selbst.
-- position ersetzt die fruehere Reihenfolge im Array: SQL kennt keine
-- inhaerente Sortierung, die Spaltenreihenfolge muss also explizit mit.
CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- ToDos ---
-- done ist INTEGER (0/1) - SQLite kennt keinen echten Boolean.
-- position wird nur bei ToDos OHNE Termin gebraucht; terminierte sortiert die
-- App nach due. Deshalb NULL erlaubt, genau wie das bisherige t.order.
CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  note         TEXT,
  due          TEXT,
  done         INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  position     INTEGER,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);

-- ------------------------------------------------------------ Warteliste ---
-- Getrennt von users: hier steht, wer fragen kommt. Beim Freischalten im
-- Admin-Dashboard entsteht daraus ein Eintrag in users, der Wartelisten-
-- Eintrag bleibt als Verlauf mit status='freigeschaltet' stehen.
CREATE TABLE waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'offen'
             CHECK (status IN ('offen', 'freigeschaltet', 'abgelehnt')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- Index ---
-- Das Board laedt immer "alle Bereiche eines Nutzers in Reihenfolge" und
-- danach "alle ToDos dieser Bereiche". Genau dafuer die beiden Indizes.
CREATE INDEX idx_lists_user  ON lists(user_id, position);
CREATE INDEX idx_todos_list  ON todos(list_id);
CREATE INDEX idx_waitlist_st ON waitlist(status, created_at);
