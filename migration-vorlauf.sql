-- Migration: Vorlauf fuer ToDos mit Termin (02.11.2026)
--
-- Ein Termin am ToDo heisst "bis": das ToDo steht schon vorher unter Heute,
-- standardmaessig ab 14 Tagen. Die neue Spalte `todos.vorlauf` haelt eine
-- eigene Einstellung in Tagen; NULL = Standard der App (bisherige ToDos
-- bekommen damit von selbst die 14 Tage). Den Rahmen (0 bis 3650) prueft die
-- API in functions/api/todos.js, nicht die Datenbank - wie bei `wiederholung`.
--
-- REIN ADDITIV: nur ALTER TABLE ADD COLUMN, kein Neuaufbau, also keine
-- Cascade-Falle. Alter Code liest die Spalte nicht und schreibt sie beim
-- Speichern nicht mit (NULL) - darum zuerst migrieren, dann pushen.
--
-- EINMALIG ausfuehren:
--   wrangler d1 execute todo --remote --file=migration-vorlauf.sql
--
-- Rollback: die Spalte stoert alten Code nicht.

ALTER TABLE todos ADD COLUMN vorlauf INTEGER;
