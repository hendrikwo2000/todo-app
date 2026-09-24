# Kalender nach Samsung-Vorbild (Entwurf, 24.09.2026)

Vier Änderungen am Kalender. Vorlage sind drei Screenshots aus dem Samsung
Kalender, die Hendrik geschickt hat (Termin bearbeiten, Wiederholen,
Monatsansicht mit Tages-Karte). Seine Entscheidungen stehen jeweils dabei.

Bestehende Technik steht in `BETRIEB.md`, Abschnitte „Kalender" und „Google
Kalender". Was hier steht, ergänzt sie.

---

## 1. Termin-Formular im Samsung-Layout

Aufbau von oben nach unten:

* **Titel** groß und randlos, rechts daneben ein **Farbpunkt**. Ein Tipp auf
  den Punkt klappt die Palette (Googles Termin-Farben plus „Farbe des
  Kalenders") direkt darunter auf. Die Farbreihe mitten im Formular entfällt.
* **Ganztägig** als Schiebeschalter, mit Uhr-Symbol.
* **Von → Bis nebeneinander**: je Seite das Datum oben („Mi., 16. Sept."), die
  Uhrzeit darunter, dazwischen ein Pfeil. Die nativen Datums- und Zeitfelder
  liegen unsichtbar darüber (gleiches Muster wie `.date-field` am ToDo).
* **Das Ende rückt sofort mit.** Ändert sich Beginn-Datum oder -Uhrzeit,
  wandert das Ende um denselben Betrag — die Dauer bleibt. 9–10 Uhr, Beginn auf
  11 → 11–12 Uhr. Ein Ende vor dem Beginn wird zu Beginn + 1 Stunde.
* Zeilen mit Symbol: **Ort**, **Wiederholung**, **Notizen**.
* Unten **Abbrechen | Speichern** als zwei Textknöpfe über die ganze Breite.
  Kein Löschen, keine Kopfzeile mit ✕.

**Bewusst weggelassen** (Hendrik: „brauche ich nicht"): Kalenderkonto,
Erinnerung, Videokonferenz, Anhang, Teilnehmer, Smiley.

**Löschen** wandert in die Detailansicht („Fenster davor") und fragt dort nach.
Wie Bearbeiten nur mit Schreibrecht bei Google.

## 2. Wiederholung

Eigene Seite im selben Dialog, mit „‹ Wiederholen" zurück:

* Ein Satz, was gerade gilt („Dieser Termin wird alle 2 Wochen wiederholt.").
* Auswahl: Nicht wiederholen · Jeden [n] Tag · Jede [n] Woche · Jeder [n]
  Monat · Jedes [n] Jahr. Samsungs „Nicht wieder anzeigen" ist ein
  Übersetzungsfehler, bei uns heißt es „Nicht wiederholen".
* Laufzeit (nur mit Wiederholung): Für immer · Bestimmte Anzahl [n] · Bis
  [Datum].
* Woche = Wochentag des Beginns, Monat = derselbe Tag im Monat. Keine
  Wochentags-Auswahl (nicht im Vorbild).

Technisch eine echte Google-Serie (`recurrence: ["RRULE:…"]`). Die App baut
die Regel selbst, der Server prüft sie gegen ein enges Muster.

**Serientermin ändern oder löschen** — Hendriks Wahl: drei Möglichkeiten wie
bei Samsung und Google.

* **Nur diesen Termin** — die Einzelausgabe wird zur Ausnahme. Entfällt, wenn
  die Wiederholung selbst geändert wurde (für eine einzelne Ausgabe ergibt
  das keinen Sinn).
* **Diesen und alle folgenden** — die alte Serie endet am Tag davor (UNTIL),
  ab hier beginnt eine neue. Hatte die alte eine feste Anzahl, bekommt die
  neue den Rest.
* **Alle Termine** — die Serie selbst ändert sich. Eine Verschiebung um n Tage
  verschiebt die ganze Serie um n Tage, die Uhrzeit gilt für alle.

Regeln, die das Formular nicht abbilden kann (etwa „jeden 3. Mittwoch" aus
Google), bleiben unangetastet, solange man die Wiederholung nicht anfasst.

## 3. Handy: Monat über den ganzen Bildschirm, Tag als Karte

Gilt nur unterhalb der Split-Grenze. Am Rechner bleibt alles, wie es ist.

* **Die Tagesliste oben entfällt am Handy.** Das Raster nimmt die ganze Höhe
  und zeigt die ToDos im Klartext, wie bisher nur im Vollbild. Den
  Vollbild-Knopf und die senkrechte Wischgeste braucht es dort nicht mehr.
* Die Reiter **Kalender | Gewohnheiten | Timer** bleiben oben. Gewohnheiten
  und Timer ersetzen das Raster.
* **Erster Tipp markiert, zweiter öffnet**: bei Tagen mit Einträgen die
  Tages-Karte, bei leeren Tagen direkt „Neuer Termin" (ohne Google-Schreibrecht
  die Karte, damit man ein ToDo anlegen kann).
* **Tages-Karte** über dem Raster: Kopf mit Tageszahl und Wochentag, darunter
  derselbe Inhalt wie die Tagesliste am Rechner (Überfällig, ToDos mit Haken,
  Termine). Unten ein Feld „Am 24. Sept. hinzufügen" — legt ein **ToDo** an —
  und ein rundes **＋** für einen neuen **Termin**. Wisch nach links/rechts
  blättert den Tag. Schließen: Tipp daneben, Escape, Zurück-Taste.
* Die **Zurück-Taste** schließt am Handy immer die oberste Ebene (Formular,
  Detail, Karte) statt gleich den ganzen Kalender.
* Nach dem Blättern in einen anderen Monat ist am Handy nichts gewählt (außer
  heute liegt darin) — die Auswahl dient dort nur noch als erster Tipp.

## 4. Filter als Menü

Der Trichter öffnet ein kleines Menü direkt darunter, statt eine Zeile
einzuschieben. Eine Zeile je Quelle mit Haken; Tipp daneben oder Escape
schließt.

---

## Nicht Teil dieses Entwurfs

* Die angeschnittenen Nachbar-Karten links und rechts wie bei Samsung — das
  Blättern per Wisch ist da, die Vorschau nicht.
* Ausnahmen einer Serie (einzeln gelöschte Termine) wandern bei „diesen und
  alle folgenden" nicht in die neue Serie mit.
* Die verschwommene Leiste am iPhone — wartet auf Screenshot und Gerät.

---

## Nachtrag 25.09.2026: zweite Runde

Nach dem ersten Test am Handy, Hendriks Entscheidungen:

* **Termin ansehen = Formular.** Ein Tipp auf einen Termin öffnet ihn im
  Formular. Alles außer Ort und Notiz ist direkt änderbar; Ort und Notiz
  behalten ihre Links und werden über „Bearbeiten“ zu Feldern. Unten
  „Löschen | Bearbeiten | Schließen“, nach einer Änderung „Abbrechen |
  Speichern“. Die Zwischenmaske entfällt.
* **Karussell wie Samsung** für Monat und Tag, Nachbarkarten schauen hervor.
* **Termin-Zeilen:** Startzeit, Farbbalken, Titel und Dauer.
* **ToDo in der Karte** über das kleine ＋ an „ToDos“; das große Feld unten
  entfällt.
* **iPhone:** Inhalt in der Homescreen-App 24 px tiefer, unter den
  Unschärfe-Streifen von iOS.

## Nachtrag 25.09.2026 abends: dritte Runde

* **Ansicht und Bearbeiten sehen verschieden aus.** Die Ansicht ist eine reine
  Ansicht: Titel und Zeiten als Text, kein Ganztägig-Schalter, Ort, Notiz und
  Wiederholung nur, wenn es sie gibt. Geändert wird über „Bearbeiten“,
  Abbrechen führt zurück zur Ansicht.
* **Farbe** beim Bearbeiten als kleines Menü unter dem Farbpunkt.
* **Ganztägige Termine** stehen mit Kalender-Symbol im selben Abschnitt
  „Termine“ wie die übrigen.
* **Nachbarkarten** deckend und abgedunkelt statt halb durchsichtig.

## Nachtrag 26.09.2026: vierte Runde

* **Ein Tipp** auf einen Tag öffnet die Tages-Karte, auch einen leeren.
* **Abbrechen beim Bearbeiten** schließt das Fenster wie Speichern (nicht
  mehr zurück in die Ansicht).
* **Mehrtägige Balken:** ein Tipp auf den Balken trifft den Tag darunter,
  nicht den ersten Tag des Termins.
* **Knopfreihe fest unten**, auch bei langer Notiz.
