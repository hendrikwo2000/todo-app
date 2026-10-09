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
selbst und gibt frei. So geschehen, live am 09.10.2026.

## Zweite Runde (09.10.2026 abends, nach Hendriks Test)

* **Darkmode:** die Farbe steckt in der Schrift, der Grund ist nur dunkel
  getönt (Variante „leuchtende Schrift“, gewählt aus drei Varianten an seinen
  Einträgen). Die erste Fassung wurde bei Gelb und Orange braun.
* **iPad:** der Drei-Spalten-Aufbau beginnt bei 1180 px statt 1380 px, das
  Board hat dort eine Spalte (rund 270 px). Seine Wahl gegen „Heute-Spalte
  schmaler“ und „iPad so lassen“.
* **Spalten bis unten:** zurückgebaut („finde ich etwas komisch“).
* **Neuer Bereich:** beginnt die nächste Reihe links statt allein unten in
  der Mitte. Gewählt gegen „in die Lücke darunter“ und „alles in einer
  Reihe, waagerecht scrollen“.

## Dritte Runde (09.10.2026 abends, nach seinem Test am iPad)

* **iPad:** die eigene Heute-Spalte verschwindet dort wieder, die
  Tagesansicht steht über den ToDos, der Kalender rechts in voller Höhe. Die
  eigene Spalte gibt es erst ab 1380 px (Board behält zwei Spalten).
* **1000–1380 px** (kleine Laptops) genauso wie das iPad. Damit entfallen der
  gestapelte Streifen, sein Teilungs-Griff und das Kalender-Vollbild ganz.
* **Handy:** in der ToDo-Übersicht steht oben die Tagesansicht (heute).
  **Einklappbar am Kopf**, gemerkt pro Gerät (gewählt gegen einen Schalter in
  den Einstellungen und gegen beides).
* **Kalender zu:** die Tagesansicht oben bleibt an Handy und iPad (zeigt
  heute), am Rechner ab 1380 px geht sie mit dem Kalender.
* **Monatswechsel:** im aktuellen Monat heute, sonst der Erste. Vorher blieb
  der Tagesbereich in Monaten ohne ToDos leer.
