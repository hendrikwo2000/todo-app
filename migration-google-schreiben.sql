-- Migration: Google-Termine anlegen (Schreibberechtigung)
--
-- Neue Spalte `scopes`: was Google beim Verknuepfen tatsaechlich erteilt hat
-- (Leerzeichen-getrennte Liste). Daran erkennt die App, ob das gespeicherte
-- Token den Schreib-Scope calendar.events traegt - Verknuepfungen von VOR
-- dieser Aenderung tragen ihn nicht, und ein Anlege-Knopf, der dann in einen
-- 403 laeuft, waere schlechter als gar keiner.
--
-- Bestehende Zeilen bekommen NULL und gelten damit als "nur lesen", bis der
-- Nutzer einmal neu verknuepft. Genau richtig: mehr kann das alte Token nicht.
--
-- REIN ADDITIV: nur ADD COLUMN. Kein DROP, keine Cascade-Gefahr.
--
-- EINMALIG ausfuehren:
--   wrangler d1 execute todo --file=migration-google-schreiben.sql
--
-- Rollback: die Spalte stoert alten Code nicht (er liest sie nicht).

ALTER TABLE google_konten ADD COLUMN scopes TEXT;
