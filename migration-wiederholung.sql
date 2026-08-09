-- Migration: Wiederkehrende ToDos
--
-- Bringt eine BESTEHENDE Datenbank auf das Schema mit Wiederholungsmuster:
-- eine neue Spalte `todos.wiederholung`. NULL = keine Wiederholung
-- (bisheriges Verhalten unveraendert). Erlaubte Werte ("taeglich",
-- "woechentlich", "monatlich", "jaehrlich") prueft die API in
-- functions/api/todos.js, nicht die Datenbank - wie bei `lists.farbe`.
--
-- REIN ADDITIV: nur ALTER TABLE ADD COLUMN. Bestehende ToDos bleiben ohne
-- Wiederholung (wiederholung = NULL), bis man sie im UI setzt.
--
-- EINMALIG ausfuehren. Vorher Backup (Prinzip):
--   wrangler d1 export todo --output=todo-backup.sql
-- Dann:
--   wrangler d1 execute todo --remote --file=migration-wiederholung.sql
--
-- Rollback: die Spalte stoert alten Code nicht.

ALTER TABLE todos ADD COLUMN wiederholung TEXT;
