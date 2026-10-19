-- Migration: Stand-Zaehler je Liste (seit 19.10.2026)
--
-- Bringt eine BESTEHENDE Datenbank auf das Schema mit `boards.stand`. Jedes
-- erfolgreiche PUT /api/todos zaehlt ihn um eins hoch. Die App schickt beim
-- Speichern den Stand mit, auf dem ihre Aenderung beruht - passt er nicht mehr
-- (ein anderes Geraet hat inzwischen gespeichert), lehnt der Server mit 409 ab,
-- statt den neueren Inhalt still zu ueberschreiben. Die App mischt dann beide
-- Staende und speichert erneut. Hintergrund: BETRIEB.md, "Mehrere Geraete".
--
-- REIN ADDITIV: nur ALTER TABLE ADD COLUMN, alle Listen starten bei 0.
--
-- EINMALIG ausfuehren, und zwar VOR dem Deploy des Codes, der die Spalte liest
-- (sonst scheitert GET /api/todos mit "no such column"). Dann:
--   wrangler d1 execute todo --remote --file=migration-stand.sql
--
-- Rollback: die Spalte stoert alten Code nicht (er liest sie nicht).

ALTER TABLE boards ADD COLUMN stand INTEGER NOT NULL DEFAULT 0;
