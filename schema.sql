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

-- ------------------------------------------------------------ Anmeldung ---
-- Login per E-Mail-Code statt Passwort: kein Hashing, kein
-- Zuruecksetzen-Flow, keine vergessenen Passwoerter. Wer sich anmelden darf,
-- steht in `users` - das IST hier die Zugangsbeschraenkung, es gibt bewusst
-- keine Registrierung.
--
-- Codes werden gehasht gespeichert (wie ein Passwort), nicht im Klartext -
-- falls die Datenbank je ausgelesen wird, sind angeforderte, noch gueltige
-- Codes damit nicht direkt nutzbar.
-- token_hash gehoert zum Anmeldelink in derselben Mail. Link und Code sind
-- zwei Wege zum selben Eintrag: was zuerst benutzt wird, verbraucht beide.
CREATE TABLE login_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  token_hash TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Einmal-Links fuer die Verwaltung (Freischalten direkt aus der
-- Benachrichtigungsmail). Getrennt von login_codes, weil hier nicht die
-- Person selbst handelt, sondern ein Admin ueber sie.
CREATE TABLE admin_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zweck       TEXT NOT NULL CHECK (zweck IN ('freischalten')),
  waitlist_id INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- token_hash ist der Primaerschluessel: das Cookie traegt den Klartext-Token,
-- die Datenbank kennt nur seinen Hash - wie bei den Codes, falls die
-- Datenbank je ausgelesen wird.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- Index ---
-- Das Board laedt immer "alle Bereiche eines Nutzers in Reihenfolge" und
-- danach "alle ToDos dieser Bereiche". Genau dafuer die beiden Indizes.
CREATE INDEX idx_lists_user     ON lists(user_id, position);
CREATE INDEX idx_todos_list     ON todos(list_id);
CREATE INDEX idx_waitlist_st    ON waitlist(status, created_at);
CREATE INDEX idx_login_codes_em ON login_codes(email, created_at);
CREATE INDEX idx_login_codes_tk ON login_codes(token_hash);
CREATE INDEX idx_sessions_user  ON sessions(user_id);
CREATE INDEX idx_admin_tokens   ON admin_tokens(token_hash);
