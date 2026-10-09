# Heute-Spalte und ruhigerer Kalender (Entwurf, 09.10.2026)

Ausgangspunkt waren drei Screenshots vom Rechner mit verschiedenen Stellungen
der beiden Ziehgriffe. Hendrik war mit dem Layout „noch nicht ganz zufrieden“,
wusste aber nicht, wie man es verbessert. Auf Nachfrage störten ihn:

* das Raster wird gequetscht (Griff weit unten: Einträge laufen über die
  Tageszahlen),
* schmal wird es unlesbar (Termine des Tages verschwinden, Chips werden zu
  „HNT Tr…“),
* das Verhältnis links/rechts: links zu viel Leere, rechts zu dicht.

Nicht gestört hat ihn die Lücke zwischen Tagesliste und Raster.

Bestehende Technik steht in `BETRIEB.md`, Abschnitte „Kalender“ und
„Fokus-Panel“. Was hier steht, ergänzt sie.

---

## 1. Am Rechner: Board | Heute | Kalender

Die Tagesliste zieht aus dem Streifen aus und wird eine eigene Spalte zwischen
Board und Kalender. Der Kalender bekommt dadurch die volle Höhe.

Hendriks Entscheidungen (gefragt, nicht angenommen):

* **Neben dem Kalender, nicht ganz links.** Klick auf einen Tag und das
  Ergebnis bleiben nah beieinander. Ganz links stünde der Inhalt 1200 px vom
  angeklickten Tag entfernt; eine Leiste über dem Board war die dritte Wahl.
* **📅 öffnet Heute und Kalender gemeinsam, 📋 schließt beide.** Ein Schalter,
  ein Zustand. Die Alternative („Heute bleibt immer stehen, der Umschalter
  blendet nur den Kalender“) war gefragt und ist verworfen.
* **Gewohnheiten und Timer bleiben Reiter rechts** (Kalender | Gewohnheiten |
  Timer), jeweils in voller Höhe. Sie wandern nicht in die Heute-Spalte.

Aussehen und Verhalten:

* Die Heute-Spalte hat eine feste Breite (300 px samt Abstand) und sieht aus
  wie eine Board-Spalte: grauer Kasten bis unten. Inhalt unverändert:
  Datum, Überfälliges, ToDos mit Abhaken, Termine, ＋-Knöpfe. Ein Klick auf
  einen Tag im Raster füllt sie wie bisher.
* Technisch bleibt alles EIN Panel (`#kalenderPanel`). Es wird um die
  Heute-Breite breiter und teilt sich innen per Grid in zwei Spalten. Damit
  bleiben Öffnen, Schließen, Animation und Umschalter unverändert.
* Der Breiten-Griff verstellt nur noch den Kalender-Teil. Die schmalste
  Stellung wird in diesem Aufbau so angehoben, dass ein Balken in einer Zelle
  noch etwa 9 Zeichen zeigt (gemessen, nicht geschätzt).
* Der Griff zwischen Tagesliste und Raster entfällt in diesem Aufbau.
* Das Raster zeigt seine Zellen wie im bisherigen Vollbild: ToDos im
  Klartext, so viele Balken, wie hineinpassen. Der Vollbild-Knopf ⤢ entfällt
  am Rechner, weil das Raster ohnehin die volle Höhe hat. Ebenso die
  senkrechte Vollbild-Geste.
* Gilt nur, wenn neben Heute und Kalender noch zwei Board-Spalten passen
  (`BOARD_MINDEST`). Darunter, bis zur Split-Grenze, bleibt der bisherige
  Aufbau (Tagesliste über dem Raster, mit Griff). Unterhalb der Split-Grenze
  (Handy) ändert sich am Aufbau nichts.

## 2. Getönte Kalendereinträge

Die Balken im Raster (Google-Termine, auch die mehrtägigen) bekommen statt der
satten Fläche mit weißer Schrift:

* hellen Grund in ihrer Farbe,
* eine farbige Kante links (nur am Anfang des Termins, nicht an der
  Fortsetzung nach einem Zeilenumbruch),
* dunkle Schrift aus derselben Farbe.

Hendrik hat das an seinen echten Einträgen gesehen: „Die neue Kalenderfarbe
gefällt mir.“ Gilt überall: Rechner, Handy, dunkler Modus.

## 3. Raster-Untergrenze

Die Untergrenze von 36 px je Rasterzeile stammt aus der Zeit, als in den
Zellen nur Punkte standen. Seit die Balken ihren Titel tragen, laufen sie bei
weit heruntergezogenem Griff über die Tageszahlen (Screenshot 2). Die
Untergrenze rechnet künftig mit der Zahl der Balkenspuren, die der Monat
tatsächlich braucht. CSS und `rasterMindest()` (Griff-Grenze) lesen denselben
Wert.

## 4. Bereichs-Spalten bis unten

Die grauen Bereichs-Spalten im Board reichen bis zum unteren Fensterrand
(Hendrik: „Ja, bis unten“). Die erste Spalte ohne Überschrift hat keinen
Kasten und bleibt deshalb unverändert. Brechen die Spalten in zwei Reihen um,
reichen sie nur bis zur längsten Spalte ihrer Reihe; sonst stünde die obere
Reihe wie eine Wand vor der unteren.

## Ablauf

Lokal mit `wrangler pages dev` testen, dann **nicht pushen**: Hendrik testet
selbst und gibt frei.
