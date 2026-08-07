-- Migration: Bereichsfarbe (schmaler Farbstreifen, frei waehlbar)
--
-- Bringt eine BESTEHENDE Datenbank auf das Schema mit eigener Bereichsfarbe:
-- eine neue Spalte `lists.farbe`. NULL = keine Farbe gewaehlt (bisheriges
-- Aussehen, kein Streifen). Die erlaubten Werte (feste Palette, siehe FARBEN
-- in app.js) prueft die API in functions/api/todos.js, nicht die Datenbank -
-- wie bei den anderen freien Textfeldern hier.
--
-- REIN ADDITIV: nur ALTER TABLE ADD COLUMN. Bestehende Bereiche bleiben ohne
-- Farbe (farbe = NULL), bis man sie im UI setzt.
--
-- EINMALIG ausfuehren. Vorher Backup (Prinzip):
--   wrangler d1 export todo --output=todo-backup.sql
-- Dann:
--   wrangler d1 execute todo --remote --file=migration-farbe.sql
--
-- Rollback: die Spalte stoert alten Code nicht (er liest sie nicht).

ALTER TABLE lists ADD COLUMN farbe TEXT;
