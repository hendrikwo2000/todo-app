# Kalender-Feinschliff (Entwurf, 20.08.2026)

Vier Änderungen am Kalender-Streifen. Grundlage ist Hendriks Befund: „funktioniert,
ist aber kantig". Der Streifen bleibt inhaltlich, wie er ist — Tagesliste oben,
darunter die Reiter Kalender / Gewohnheiten / Timer.

**Nicht Teil dieses Entwurfs:** eine Wochenansicht mit Zeitachse, das Tauschen von
Tagesliste und Raster, das Zusammenlegen von ToDos und Terminen in eine gemeinsame
Tagesagenda. Alles drei wurde besprochen und bewusst zurückgestellt.

Bestehende Technik steht in `BETRIEB.md`, Abschnitte „Kalender" und
„Google Kalender". Was hier steht, ergänzt sie, ersetzt sie nicht.

---

## 1. Am Handy eine eigene Ansicht statt eines Overlays

**Heute:** Unterhalb `SPLIT_AB` (1000 px) legt sich `.kalender` als Panel über die
Liste. `html.kal-offen:not(.kal-split)` sperrt das Scrollen, `.kal-hintergrund`
dunkelt ab, das Panel fährt per `transform` herein.

**Künftig:** Der Streifen ist dort eine gleichrangige Ansicht. Board und Kalender
lösen einander ab, statt sich zu überlagern.

* `.kal-hintergrund` bleibt unterhalb der Split-Grenze dauerhaft weg — nicht nur
  im Split wie bisher.
* Die Scroll-Sperre am `html` entfällt. Sie war nötig, weil hinter dem Overlay
  eine bedienbare Seite lag; ohne Overlay gibt es nichts zu sperren. **Damit
  behält die ToDo-Liste ihre Scrollposition**, wenn man zurückwechselt.
* Kein Hereinfahren mehr: `setzePanel()` setzt im Umschalt-Modus keine
  `transform`-Animation, die Ansicht steht einfach da. Das ist zugleich die
  Antwort auf „der Übergang ruckelt": animiert wurde `transform` am Panel,
  während der `body` gleichzeitig sein `padding-right` änderte — Letzteres ist
  ein Layout-Umbruch und kann nicht flüssig laufen.

**Unverändert bleiben:**

* Der Weg zwischen den Ansichten: der vorhandene 📋|📅-Umschalter in beiden
  Kopfzeilen. Keine neue Leiste am unteren Rand.
* Der Wisch vom rechten Bildschirmrand. Er führt weiter zurück zur Liste — nur
  heißt das jetzt „Ansicht wechseln" statt „Panel schließen". `gestenZone()`
  bleibt wie sie ist: über dem Raster blättert der Wisch den Monat, über der
  Tagesliste den Tag.
* `kalAnsicht` in `localStorage` und `stelleAnsichtHer()`.
* Der Vollbild-Knopf (`.kal-vollbild-knopf`) samt seiner Sonderregeln.
* Am PC im Split ändert sich **nichts**.

**Zusätzlich:** ein History-Eintrag beim Wechsel in den Kalender, damit der
Zurück-Knopf des Browsers zur Liste führt statt die PWA zu verlassen. Umzusetzen
über `history.pushState` beim Öffnen und `popstate` zum Zurückwechseln, nur
unterhalb der Split-Grenze. Der einzige Teil, der ohne die anderen funktioniert
und notfalls entfallen kann.

---

## 2. Zwei Ziehgriffe

Gleiche Mechanik für beide: `pointerdown` / `pointermove` / `setPointerCapture`,
damit Maus und Finger denselben Weg gehen. Beide Griffe sind fokussierbar und
lassen sich mit den Pfeiltasten bewegen (Schrittweite 16 px, mit Shift 64 px) —
die App ist sonst durchgehend mit der Tastatur bedienbar, das soll so bleiben.

### 2a. Breite des Streifens (nur im Split)

* Griff an der **linken Kante** des Streifens, etwa 6 px sichtbar, Trefferfläche
  mindestens 12 px.
* Grenzen: **360 bis 720 px**.
* Gemerkt in `localStorage` unter `kalBreite`. Fehlt der Schlüssel, gilt weiter
  `--kal-breite: min(440px, 38vw)` — wer nie zieht, merkt von der Änderung nichts.
* **Doppelklick auf den Griff löscht `kalBreite`** und stellt damit den heutigen
  Zustand wieder her.
* Beim Ziehen wird `--kal-breite` am `:root` gesetzt. Alles, was daran hängt
  (`html.kal-split body { padding-right }`, `.kalender { width }`,
  `.snackbar { left }`), zieht von selbst mit. **Keine zweite Stelle, an der eine
  Breite steht** — das ist die Bedingung dafür, dass der Griff wartbar bleibt.

**Die Split-Grenze wandert mit.** `istSplit()` gibt künftig zurück:

* ohne eigene Breite: `window.innerWidth >= SPLIT_AB` (also unverändert 1000 px),
* mit eigener Breite: `window.innerWidth >= kalBreite + BOARD_MINDEST`, wobei
  `BOARD_MINDEST` = 520 px ist (zwei Board-Spalten à 250 px plus Ränder).

Bei der heutigen Standardbreite kommt genau die alte Grenze heraus. Ein schmal
gezogener Streifen erlaubt den Split früher, ein breiter später. Der vorhandene
`resize`-Wächter, der beim Überqueren der Grenze `setzePanel()` nachzieht, gilt
unverändert — er muss nur nach dem Ziehen ebenfalls anlaufen, weil sich die
Grenze selbst verschoben haben kann.

### 2b. Aufteilung zwischen Tagesliste und Raster

* Waagerechter Griff **zwischen `.kal-liste` und `.kal-unten`**, im Split wie im
  Umschalt-Modus. Trefferfläche mindestens 24 px hoch — anders als der
  Breiten-Griff wird dieser auch mit dem Finger bedient.
* Gemerkt in `localStorage` unter `kalTeilung` als **Höhe der Tagesliste in
  Pixeln**.
* Ersetzt die heutige feste Reservierung `.kal-liste { min-height: min(360px,
  44vh) }`, die nur ab 780 px Fensterhöhe greift. Ohne gemerkten Wert bleibt
  genau dieses Verhalten als Voreinstellung stehen, samt der Grenze bei 780 px.
* Was nicht hineinpasst, scrollt in seinem eigenen Bereich. **Nichts wandert beim
  Tageswechsel** — das war der Grund gegen die Alternative „Tagesliste schrumpft
  auf ihren Inhalt".

**Falle: der gemerkte Wert darf beim Klemmen nicht überschrieben werden.** Auf
einem niedrigen Fenster greifen die Grenzen (das Raster braucht seine 36 px je
Zeile plus Kopf und Wochentage). Der Wert wird für die Anzeige geklemmt, aber
**nicht zurückgeschrieben** — sonst wäre die am großen Bildschirm eingestellte
Aufteilung nach einmaligem Öffnen am Handy dauerhaft verloren.

**Im Vollbild gibt es den Griff nicht.** `.kalender.vollbild` blendet die
Tagesliste ohnehin aus (`display: none`); ein Griff ohne etwas zu greifen wäre
eine tote Fläche.

---

## 3. Kein Springen mehr beim Nachladen

**Heute:** Beim Öffnen zeichnet der Kalender zuerst nur die ToDos. Treffen die
Google-Termine ein, bekommen die Wochen ihre Balkenspuren, alle Zeilen werden
höher, der ganze Streifen springt.

**Künftig zwei Maßnahmen:**

### 3a. Letzten Stand zwischenspeichern

* Die Antwort von `/api/google/termine` wird in `localStorage` abgelegt, Schlüssel
  aus **Nutzer-Kennung + Monat + gewählten Kalendern**.
* Beim Öffnen wird dieser Stand **sofort gezeichnet**, die Anfrage an Google läuft
  parallel; die frische Antwort ersetzt ihn still.
* Aufbewahrt werden die **letzten drei Monate**, ältere Einträge fliegen beim
  Schreiben raus. Ein voller Monat sind wenige Kilobyte, der Deckel ist nur die
  Vorsorge gegen unbegrenztes Wachstum.
* Schlägt das Schreiben fehl (voller Speicher), passiert nichts weiter — dann
  eben ohne Zwischenspeicher, wie beim vorhandenen `ANSICHT_KEY`.

**Der Zwischenspeicher muss an drei Stellen gelöscht werden**, sonst zeigt der
Kalender Termine, die dort nicht mehr hingehören:

1. beim **Abmelden**,
2. wenn `/api/google/termine` mit `getrennt` antwortet (Zugriff bei Google
   widerrufen — der Endpunkt löscht dort bereits die Kontozeile),
3. beim **Trennen** über die Einstellungen.

Die Nutzer-Kennung im Schlüssel ist die zweite Absicherung: Meldet sich am selben
Browser jemand anderes an, greift dessen Schlüssel gar nicht erst auf fremde
Daten zu.

**Der Preis, bewusst in Kauf genommen:** für einen Sekundenbruchteil steht beim
Öffnen ein minimal veralteter Stand da. Das ist besser als ein Raster, das sich
unter einem aufbaut.

### 3b. Zeilenhöhe während des Ladens halten

`spurenJeWoche` vom letzten Zeichnen merken und **als Untergrenze verwenden,
solange eine Anfrage läuft**. Danach gilt wieder der frisch gerechnete Wert. So
fällt das Raster nicht erst flach zusammen, um gleich darauf wieder aufzugehen.

---

## 4. Balkentitel nur, wo sie lesbar sind

**Heute** trägt jeder Balken seinen Titel. Bei rund 55 px Spaltenbreite bleibt
davon „Finn H…" oder „XLETI…" — der Text kostet Zellhöhe und sagt nichts.

**Künftig** bekommt nur ein Balken einen Titel, der über **mindestens zwei Tage**
reicht (`TITEL_AB_TAGEN` = 2). Eintägige Termine zeigen nur ihren Farbbalken; ihr
Name steht in der Tagesliste darunter, und der Balken behält `title` und
`aria-label` für Mauszeiger und Screenreader.

**Einschränkung, die beim Bauen sonst zur Falle wird:** Die Balken **einer Woche
müssen gleich hoch bleiben**, sonst versetzt sich die durchgezogene Linie eines
mehrtägigen Termins von Tag zu Tag (derselbe Grund, aus dem `spurenJeWoche` je
Woche und nicht je Tag gerechnet wird). Eine Zeile wird also nur dort flacher, wo
**kein** mehrtägiger Termin liegt. Im August 2026 wären das die Wochen 35 und 36;
die Wochen mit „Sommer Ferien" bleiben unverändert.

Im Vollbild bleibt es beim heutigen Verhalten — dort ist Platz, und die Zellen
sind breit genug für Text.

---

## Zu prüfen vor dem Push

Lokal mit `wrangler pages dev`, nicht nur nach Augenschein im Code:

* **Handy-Breite** (Gerätesimulation 375×812): Wechsel Liste ↔ Kalender ohne
  Abdunkeln, ohne Springen; Scrollposition der Liste bleibt erhalten; Wisch vom
  rechten Rand wechselt zurück; Monat- und Tag-Wisch im Streifen funktionieren
  weiter; Zurück-Knopf des Browsers.
* **Ziehgriffe**: beide Richtungen bis an die Grenzen, Doppelklick setzt zurück,
  Werte überleben ein Neuladen, Pfeiltasten bewegen.
* **Split-Grenze**: Fenster über die neue, mitgewanderte Grenze hinweg
  vergrößern und verkleinern; der Streifen darf nicht in einem Zwischenzustand
  hängen bleiben.
* **Geklemmter Wert**: breite Aufteilung einstellen, Fenster niedrig machen,
  wieder groß — die ursprüngliche Aufteilung muss zurück sein.
* **Zwischenspeicher**: zweites Öffnen desselben Monats zeigt sofort Termine;
  Abmelden leert ihn; Raster fällt beim Blättern nicht flach zusammen.
* **Balkentitel**: eine Woche mit und eine ohne mehrtägigen Termin nebeneinander,
  die durchgezogene Linie darf nicht aufreißen.

**Was voraussichtlich ungeprüft bleibt:** der `getrennt`-Zweig beim Löschen des
Zwischenspeichers, solange lokal keine echte Google-Verknüpfung besteht — dann
gegen eine nachgebaute Antwort prüfen und das hier vermerken. Ebenso echte
Finger-Gesten auf einem Gerät; die Gestenprüfung läuft wie beim letzten Mal über
synthetische Touch-Events.
