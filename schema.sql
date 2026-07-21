-- Schema der ToDo-App (Cloudflare D1 / SQLite).
--
-- Aufbau in Ebenen:
--   Liste (boards) -> Bereich (lists) -> [Ueber-Thema (themen)] -> ToDo (todos)
-- Eine "Liste" ist ein ganzes Board, das man teilen kann. Sie enthaelt
-- mehrere "Bereiche" (die Spalten), ein Bereich mehrere ToDos. Ein ToDo kann
-- optional einem "Ueber-Thema" zugeordnet sein - einer benannten Gruppe
-- INNERHALB eines Bereichs (todos.thema_id). Ohne Zuordnung liegt es frei im
-- Bereich; das Ueber-Thema ist also eine freiwillige Zwischenebene.
--
-- Historie: Frueher lag alles verschluesselt in einem JSONBin-Datensatz, dann
-- in D1 mit EINER Liste pro Nutzer (lists hing direkt an user_id). Seit den
-- geteilten Listen sitzt ueber den Bereichen die Ebene `boards`, und wer eine
-- Liste sehen darf, steht in `board_members` - nicht mehr am festen user_id.
--
-- Bewusst KEINE Verschluesselung: mit echten Spalten kann die Datenbank
-- sortieren, filtern und eine Liste zwischen Nutzern teilen. Der Preis ist,
-- dass der Betreiber die Inhalte lesen kann - siehe README/BETRIEB.
--
-- Einspielen (frische Datenbank):  wrangler d1 execute todo --file=schema.sql
-- Bestehende Datenbank umstellen:  siehe migration-boards.sql

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

-- --------------------------------------------------------------- Listen ---
-- Eine "Liste" ist die teilbare Einheit. owner_id ist der Ersteller: nur er
-- darf umbenennen, teilen, Zugriffe entziehen und die ganze Liste loeschen.
-- id bleibt TEXT, damit die App die UUIDs weiter selbst erzeugt.
--
-- share_token ist der aktuelle Einladungs-Token; NULL, solange die Liste nie
-- geteilt wurde. Er liegt bewusst im KLARTEXT (anders als Codes und
-- Sitzungstoken): der Ersteller muss den Link jederzeit erneut kopieren
-- koennen, und ein Hash liesse sich nicht zurueckrechnen. Der Token ist 32
-- Zufalls-Bytes, und er gewaehrt nur den Beitritt zu einer ToDo-Liste -
-- kein hohes Schutzgut. "Link zuruecksetzen" heisst: neuen Token setzen, der
-- alte Link laeuft damit ins Leere.
CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  share_token TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------- Mitgliedschaft ---
-- Wer eine Liste sehen und bearbeiten darf. Der Ersteller steht hier selbst
-- mit role='owner' - so ist "welche Listen sehe ich?" EINE Abfrage auf
-- board_members, ohne boards.owner_id gesondert zu behandeln.
--
-- position ist die Reihenfolge im Umschalter, pro Nutzer verschieden: die
-- eigene Liste und eine geteilte Liste koennen bei zwei Personen anders
-- herum stehen.
--
-- role: 'owner' oder 'member'. Beide duerfen den Inhalt (Bereiche, ToDos)
-- bearbeiten - Mitbearbeiten war die ausdrueckliche Vorgabe. Nur die
-- Verwaltung der Liste selbst bleibt dem owner vorbehalten.
CREATE TABLE board_members (
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  position  INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board_id, user_id)
);

-- -------------------------------------------------------------- Bereiche ---
-- Die Spalten im Board. Haengen jetzt an board_id (frueher user_id).
-- position ersetzt die fruehere Reihenfolge im Array: SQL kennt keine
-- inhaerente Sortierung, die Spaltenreihenfolge muss also explizit mit.
CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------- Ueber-Themen ---
-- Optionale benannte Gruppe INNERHALB eines Bereichs. Ein ToDo verweist ueber
-- todos.thema_id darauf oder liegt frei (thema_id NULL). Struktur wie lists,
-- nur eine Ebene tiefer: haengt an list_id, position ist die Reihenfolge in
-- der Spalte. Loescht man den Bereich, gehen seine Themen per CASCADE mit.
CREATE TABLE themen (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- ToDos ---
-- done ist INTEGER (0/1) - SQLite kennt keinen echten Boolean.
-- position wird nur bei ToDos OHNE Termin gebraucht; terminierte sortiert die
-- App nach due. Deshalb NULL erlaubt, genau wie das bisherige t.order.
-- thema_id ist die optionale Zuordnung zu einem Ueber-Thema desselben Bereichs
-- (NULL = frei im Bereich). Bewusst KEIN Fremdschluessel auf themen: die
-- Integritaet sichert der PUT-Pfad in api/todos.js (verwaiste thema_id wird
-- auf NULL gesetzt, das ToDo bleibt erhalten) - so gibt es hier keine
-- Cascade-Ueberraschung, die an PRAGMA foreign_keys haengt.
CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  thema_id     TEXT,
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
-- Login per E-Mail-Code statt Passwort: kein Hashing-Aufwand fuer den Nutzer,
-- kein Zuruecksetzen-Flow, keine vergessenen Passwoerter. Wer sich anmelden
-- darf, steht in `users` - das IST hier die Zugangsbeschraenkung, es gibt
-- bewusst keine Registrierung.
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
-- Das Board laedt "alle Listen eines Nutzers", dann "alle Bereiche dieser
-- Listen in Reihenfolge", dann "alle ToDos dieser Bereiche". Dafuer die
-- Indizes. idx_boards_token traegt den Beitritt ueber den Einladungslink.
CREATE INDEX idx_members_user   ON board_members(user_id, position);
CREATE INDEX idx_members_board  ON board_members(board_id);
CREATE INDEX idx_boards_owner   ON boards(owner_id);
CREATE INDEX idx_boards_token   ON boards(share_token);
CREATE INDEX idx_lists_board    ON lists(board_id, position);
CREATE INDEX idx_themen_list    ON themen(list_id, position);
CREATE INDEX idx_todos_list     ON todos(list_id);
CREATE INDEX idx_waitlist_st    ON waitlist(status, created_at);
CREATE INDEX idx_login_codes_em ON login_codes(email, created_at);
CREATE INDEX idx_login_codes_tk ON login_codes(token_hash);
CREATE INDEX idx_sessions_user  ON sessions(user_id);
CREATE INDEX idx_admin_tokens   ON admin_tokens(token_hash);
