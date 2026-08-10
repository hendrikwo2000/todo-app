-- Migration: Google-Kalender verknuepfen (nur lesen)
--
-- Eine Zeile je Nutzer: das Refresh-Token, mit dem der Server sich bei Google
-- jederzeit ein frisches Zugriffs-Token holen kann, plus dieses Zugriffs-Token
-- als Zwischenspeicher (es gilt eine Stunde - ohne Speicher wuerde JEDER
-- Termin-Abruf einen zusaetzlichen Umtausch bei Google kosten).
--
-- Ein Google-Konto pro Nutzer, deshalb ist user_id direkt der Primaerschluessel.
-- Mehrere Konten waeren die Ausnahme und liessen sich spaeter additiv
-- nachruesten (eigene id + UNIQUE(user_id, google_email)).
--
-- Die Tokens liegen im KLARTEXT. Verschluesseln braeuchte einen Schluessel,
-- der auf demselben Server liegt - das schuetzt gegen niemanden, der die
-- Datenbank ohnehin lesen kann, und taeuscht Sicherheit vor. Der Schutz sitzt
-- am Zugang zur Datenbank, wie bei den Sitzungen auch.
--
-- REIN ADDITIV: nur CREATE TABLE. Kein DROP, keine Cascade-Gefahr wie bei
-- migration-boards.sql.
--
-- EINMALIG ausfuehren:
--   wrangler d1 execute todo --file=migration-google.sql
--
-- Rollback: DROP TABLE google_konten. Alter Code liest die Tabelle nicht.

CREATE TABLE google_konten (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email   TEXT,
  refresh_token  TEXT NOT NULL,
  zugriff_token  TEXT,
  zugriff_bis    TEXT,
  verbunden_am   TEXT NOT NULL DEFAULT (datetime('now'))
);
