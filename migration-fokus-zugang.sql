-- Migration: eigenstaendiger Fokus-Zugang statt Umgebungsvariable
--
-- Bisher stand die Erlaubnisliste fuer den Fokus-Tracker (fokus.it-wolf.org)
-- in der Umgebungsvariable FOKUS_ZUGANG auf dessen eigenem Cloudflare-Pages-
-- Projekt - von todo.it-wolf.org/admin aus nicht einsehbar oder aenderbar.
-- Ab jetzt sitzt die Berechtigung in der Datenbank und laesst sich aus
-- demselben Dashboard vergeben wie der ToDo-Zugang.
--
-- users.fokus_zugang: 0/1, unabhaengig von role. Ein ToDo-Konto gibt weiterhin
-- NICHT automatisch Fokus-Zugang - siehe Kommentar in schema.sql.
--
-- waitlist.quelle: haelt fest, ueber welche App-Maske ("todo" oder "fokus")
-- sich jemand eingetragen hat. Bestehende Zeilen bekommen den Default 'todo' -
-- korrekt, weil es bislang nur die ToDo-Maske gab.
--
-- REIN ADDITIV: nur ALTER TABLE ADD COLUMN. Bestehender Code (ToDo wie Fokus)
-- liest die neuen Spalten nicht, solange er nicht auf den neuen Stand
-- aktualisiert ist - kein Bruchfenster zwischen Migration und Push.
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-fokus-zugang.sql
--
-- Rollback: beide Spalten stoeren alten Code nicht (er liest sie nicht).

ALTER TABLE users ADD COLUMN fokus_zugang INTEGER NOT NULL DEFAULT 0
  CHECK (fokus_zugang IN (0, 1));

ALTER TABLE waitlist ADD COLUMN quelle TEXT NOT NULL DEFAULT 'todo'
  CHECK (quelle IN ('todo', 'fokus'));
