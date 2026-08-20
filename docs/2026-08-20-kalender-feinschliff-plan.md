# Kalender-Feinschliff — Umsetzungsplan

> **Für agentische Umsetzung:** Dieser Plan wird Aufgabe für Aufgabe abgearbeitet.
> Die Schritte tragen Kästchen (`- [ ]`) zum Abhaken.

**Ziel:** Der Kalender-Streifen der ToDo-App verliert vier Kanten — am Handy das
Overlay, am Rechner die feste Aufteilung, beim Nachladen das Springen, im Raster
die unlesbaren Balkentitel.

**Vorgehen:** Sieben Aufgaben, jede für sich lauffähig und einzeln committet.
Aufgabe 1 und 2 betreffen nur den Umschalt-Modus, 3 und 4 bauen zwei Ziehgriffe
nach derselben Mechanik, 5 und 6 nehmen dem Nachladen das Springen, 7 räumt im
Raster auf. Die Reihenfolge ist bindend: 4 setzt auf der Griff-Mechanik aus 3
auf, 6 auf dem Zwischenspeicher aus 5.

**Grundlage:** [2026-08-20-kalender-feinschliff.md](2026-08-20-kalender-feinschliff.md)
(Entwurf, mit Hendrik abgestimmt). Bestehende Technik steht in `BETRIEB.md`,
Abschnitte „Kalender" und „Google Kalender".

**Technik:** Vanilla JS, kein Build-Schritt, kein Framework. Cloudflare Pages
mit Functions, D1 als Datenbank. Alles im Ordner `ToDo/web`.

---

## Global geltende Regeln

Jede Aufgabe hat diese Vorgaben implizit mit dabei.

* **Deutsche Bezeichner.** Variablen, Funktionen, CSS-Klassen und
  `localStorage`-Schlüssel auf Deutsch, wie im Bestand (`kalBreite`,
  `zieheGriff`, `.kal-griff`).
* **Keine neuen Abhängigkeiten.** Kein npm-Paket, keine CDN-Einbindung. Die
  Seite lädt heute genau `app.js`, `kalender.js`, `fokus.js` und `style.css`,
  und das bleibt so.
* **Reihenfolge der Skripte ist Pflicht:** `kalender.js` wird nach `app.js`
  geladen und liest dessen Zustand direkt (`daten`, `listen`, `aktiveListe`,
  `eigeneEmail`). Umgekehrt gibt es nur `window.kalenderNeuZeichnen?.()` und
  `window.kalenderGoogleVergessen?.()`.
* **Zeilenenden:** `core.autocrlf` steht auf `true`, alle Dateien im
  Arbeitsverzeichnis sind CRLF. Git regelt das beim Commit — keine Datei von
  Hand umstellen.
* **`--kal-breite` und `SPLIT_AB` gehören zusammen** und dürfen nie
  auseinanderlaufen (Kommentar in `style.css` und `kalender.js` sagt das
  ebenfalls). Nach Aufgabe 3 hängt die Split-Grenze rechnerisch an der Breite.
* **`BETRIEB.md` zieht mit.** Jede Aufgabe ergänzt ihren Abschnitt dort im
  selben Commit. Das ist in diesem Projekt kein Extra, sondern das Gedächtnis:
  BETRIEB.md erklärt jede Entscheidung samt Grund.
* **Commit-Nachrichten:** Deutsch, Umlaute als ASCII (`aendert`, `Groesse`),
  beschreiben die **Wirkung** statt der Datei, kein `feat:`/`fix:`-Präfix,
  Begründung nach Bindestrich wenn sie hilft. Trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` bleibt dran.
* **Nicht pushen ohne Hendriks Wort.** Ein Push auf `main` deployt sofort auf
  todo.it-wolf.org. Hendrik hat für diese Runde ausdrücklich gesagt, es soll
  noch nichts live gehen. Committen ja, pushen erst auf seine Freigabe.

---

## Vorbereitung: lokal angemeldet testen

Ohne das steht man vor der Anmeldemaske, denn der Login läuft über Mail und
lokal fehlt `RESEND_KEY`. Einmal pro Arbeitssitzung nötig.

- [ ] **V.1: Server starten**

Aus `ToDo/web` heraus (nicht aus einem Unterordner — sonst legt Wrangler ein
zweites `.wrangler/` mit leerer Datenbank an):

```bash
npx wrangler pages dev . --d1 DB=todo
```

Der Datenbankname **muss** `todo` heißen. Jeder andere Name legt kommentarlos
eine leere Datenbank an, und der Fehler erscheint erst tief im Worker als
„no such table". Standard-Port ist 8788.

- [ ] **V.2: Test-Sitzung in die lokale SQLite schreiben**

Server vorher stoppen, die Datei muss frei sein. Die lokale D1 liegt unter
`web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` — die
Datei **ohne** „metadata" im Namen.

```python
import hashlib, sqlite3, glob
token = "test-kalender"
h = hashlib.sha256(token.encode()).hexdigest()
pfad = [p for p in glob.glob(".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite")
        if "metadata" not in p][0]
db = sqlite3.connect(pfad)
db.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, '2126-01-01 00:00:00')", (h,))
db.commit()
```

- [ ] **V.3: Cookie im Browser setzen**

Reihenfolge beachten, sonst greift nichts:

```js
await fetch("/api/auth/logout", { method: "POST" });
document.cookie = "todo_session=test-kalender; path=/; max-age=99999999";
location.reload();
```

Drei Fallen: Liegt schon ein HttpOnly-`todo_session` im Browser, ignoriert
Chrome das Setzen **stillschweigend** — deshalb erst `logout`. `logout` löscht
aber auch die gerade angelegte Zeile, also erst logout, **dann** V.2, dann das
Cookie. Und `max-age` nicht vergessen, sonst ist es ein reines Sitzungs-Cookie.

- [ ] **V.4: Angemeldet?**

Erwartet: Das Board steht da, `document.cookie` enthält `todo_session`. Nach
jedem Neuladen kurz gegenprüfen — die App überschreibt das Cookie im Betrieb.

**Zu Google:** Ohne `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` meldet
`/api/google/status` `moeglich:false`, und es kommen keine Termine. Für die
Aufgaben 5 bis 7 braucht es deshalb eine **nachgebaute Antwort**: In der
Konsole `window.fetch` für `/api/google/termine` überschreiben und ein
Objekt mit `verbunden:true`, einer Kalenderliste und Terminen zurückgeben —
darunter mindestens ein mehrtägiger, ein eintägiger und einer über den
Wochenumbruch. Genau so ist die vorhandene Anzeige seinerzeit geprüft worden.

---

## Aufgabe 1: Am Handy eine eigene Ansicht statt eines Overlays

**Dateien:**
- Ändern: `kalender.js` (`setzePanel()` ab Zeile 1795, Wischgeste um 1974 und
  2058, `kalHintergrund` in Zeile 39 und 2150)
- Ändern: `style.css` (`html.kal-offen`-Regel bei 1583, `.kal-hintergrund` bei
  1630–1639)
- Ändern: `index.html` (Zeile 109, `#kalenderHintergrund`)
- Ändern: `BETRIEB.md` (Abschnitt „Kalender")

**Schnittstellen:**
- Verbraucht: `istSplit()`, `kalOffen`, `setzePanel(offen, sofort)`
- Liefert: die Klasse `html.kal-ansicht` am Wurzelelement, solange der Kalender
  unterhalb der Split-Grenze die aktive Ansicht ist. Aufgabe 2 hängt daran.

**Warum überhaupt:** Heute legt sich `.kalender` unterhalb von 1000 px über die
Liste, `.kal-hintergrund` dunkelt ab, `html` sperrt das Scrollen und das Panel
fährt per `transform` herein. Genau dieses Hereinfahren ruckelt, weil parallel
der `body` sein `padding-right` ändert — ein Layout-Umbruch, der nicht flüssig
animieren kann.

- [ ] **Schritt 1: Board ausblenden statt überlagern**

In `setzePanel()` nach dem Setzen von `kal-offen` ergänzen:

```js
// Unterhalb der Split-Grenze loesen Board und Kalender einander ab, statt sich
// zu ueberlagern. Das Board ganz auszublenden ist der Unterschied zwischen
// "Ansicht" und "Overlay": dahinter liegt nichts mehr, was mitscrollen,
// abgedunkelt oder gesperrt werden muesste.
document.documentElement.classList.toggle("kal-ansicht", offen && !split);
```

In `style.css` dazu:

```css
/* Der Kalender ist unterhalb der Split-Grenze eine eigene Ansicht. Das Board
   ist dann nicht verdeckt, sondern weg - siehe BETRIEB.md, Abschnitt
   "Kalender". */
html.kal-ansicht .app { display: none; }
```

- [ ] **Schritt 2: Scrollposition merken und zurückgeben**

`display: none` wirft die Scrollposition des Boards weg. Oben in `kalender.js`
neben die anderen Zustandsvariablen:

```js
let listeScroll = 0;   // wohin das Board gescrollt war, bevor der Kalender uebernahm
```

In `setzePanel()`, **vor** dem Umschalten der Klasse aus Schritt 1:

```js
const wechselt = (offen && !split) !== document.documentElement.classList.contains("kal-ansicht");
if (wechselt && offen && !split) listeScroll = window.scrollY;
```

und **nach** dem Umschalten:

```js
// Zurueck zur Liste: dorthin, wo man sie verlassen hat. Ohne das landet man
// nach jedem Blick in den Kalender wieder ganz oben.
if (wechselt && !(offen && !split)) window.scrollTo(0, listeScroll);
```

- [ ] **Schritt 3: Scroll-Sperre entfernen**

In `style.css` die Regel bei Zeile 1583 ersatzlos streichen:

```css
html.kal-offen:not(.kal-split),
html.kal-offen:not(.kal-split) body { overflow: hidden; }
```

Sie war nötig, weil hinter dem Overlay eine bedienbare Seite lag. Ohne Overlay
gibt es nichts zu sperren.

- [ ] **Schritt 4: Abdunkeln vollständig entfernen**

Halb entfernte Dinge sind in diesem Projekt teurer als ganz entfernte — es
fliegt alles:

* `index.html` Zeile 109: `<div id="kalenderHintergrund" class="kal-hintergrund"></div>`
* `style.css`: `.kal-hintergrund`, `.kal-hintergrund.sichtbar`,
  `html.kal-split .kal-hintergrund { display: none; }`
* `kalender.js` Zeile 39: die `kalHintergrund`-Konstante
* `kalender.js` Zeile 1800 und 1802: die beiden Zeilen in `setzePanel()`
* `kalender.js` Zeile 1974: `kalHintergrund.style.opacity = …` in der Wischgeste
* `kalender.js` Zeile 2058: `kalHintergrund.classList.add("sichtbar")`
* `kalender.js` Zeile 2150: der Klick-Auslöser `schliesseKalender`

Der Wisch folgt danach nur noch dem Panel selbst. Das ist kein Verlust: ohne
abgedunkelten Hintergrund gibt es nichts, dessen Deckkraft mitlaufen könnte.

- [ ] **Schritt 5: Kein Hereinfahren mehr im Umschalt-Modus**

In `setzePanel()`:

```js
// Animiert wird nur noch im Split. Unterhalb loesen sich zwei Ansichten ab -
// da faehrt nichts herein, und genau dieses Hereinfahren ruckelte, weil der
// body gleichzeitig sein padding-right aenderte.
kalPanel.classList.toggle("animiert", !sofort && split);
```

- [ ] **Schritt 6: Prüfen**

Server läuft, Fenster auf 375×812 (Gerätesimulation). Der Reihe nach:

1. Umschalter 📅 antippen. Erwartet: Kalender steht sofort da, **kein**
   Abdunkeln, **kein** Hereinfahren, kein Ruckeln.
2. Umschalter 📋. Erwartet: Board zurück, **an derselben Scrollposition**.
   Zum Prüfen vorher weit nach unten scrollen.
3. Wisch vom rechten Bildschirmrand nach links im Kalender. Erwartet: zurück
   zur Liste, wie bisher.
4. Wisch über dem Raster waagerecht. Erwartet: Monat blättert. Wisch über der
   Tagesliste: Tag blättert. (`gestenZone()` bleibt unangetastet.)
5. Zahnrad in der Kalender-Kopfzeile. Erwartet: Einstellungen öffnen sich —
   sie liegen außerhalb von `.app` und dürfen vom Ausblenden nicht betroffen
   sein. **Das ist der riskanteste Punkt dieser Aufgabe.**
6. Fenster auf 1200 px verbreitern. Erwartet: Split wie bisher, Board sichtbar
   neben dem Kalender, `html.kal-ansicht` ist weg.
7. Konsole: keine Fehler. Besonders auf `kalHintergrund is not defined` achten
   — ein übersehener Verweis aus Schritt 4.

- [ ] **Schritt 7: BETRIEB.md nachziehen**

Im Abschnitt „Kalender" den Absatz über die zwei Modi überarbeiten: Der
Umschalt-Modus ist kein Overlay mehr. Festhalten, **warum** das Board
ausgeblendet statt überlagert wird (dahinter liegt nichts, was gesperrt werden
müsste) und dass die Scrollposition deshalb von Hand gemerkt wird.

- [ ] **Schritt 8: Commit**

```bash
git add kalender.js style.css index.html BETRIEB.md
git commit
```

Nachricht:

```
Kalender: am Handy eine eigene Ansicht statt eines Overlays

Board und Kalender loesen einander ab - kein Abdunkeln, keine
Scroll-Sperre, kein Hereinfahren. Das Ruckeln beim Umschalten kam
daher, dass der body gleichzeitig sein padding-right aenderte.
Die Scrollposition der Liste wird gemerkt und zurueckgegeben.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 2: Der Zurück-Knopf führt zur Liste

**Dateien:**
- Ändern: `kalender.js` (`setzePanel()`, neuer `popstate`-Empfänger)
- Ändern: `BETRIEB.md` (Abschnitt „Kalender")

**Schnittstellen:**
- Verbraucht: `html.kal-ansicht` aus Aufgabe 1, `setzePanel(offen, sofort)`
- Liefert: nichts, worauf spätere Aufgaben aufbauen

**Warum:** Die App läuft als PWA vom Startbildschirm. Dort verlässt der
Zurück-Knopf heute die App, statt zur Liste zu gehen — sobald der Kalender eine
eigene Ansicht ist, erwartet man das andere.

- [ ] **Schritt 1: Eintrag beim Wechsel in den Kalender**

Oben in `kalender.js`:

```js
let historieEintrag = false;   // liegt gerade ein eigener Eintrag fuer die Kalenderansicht?
```

In `setzePanel()` ganz am Ende:

```js
// Nur unterhalb der Split-Grenze: dort ist der Kalender eine eigene Ansicht,
// und der Zurueck-Knopf soll zur Liste fuehren statt die PWA zu verlassen. Im
// Split steht ohnehin beides nebeneinander - ein Eintrag waere dort sinnlos.
const alsAnsicht = offen && !split;
if (alsAnsicht && !historieEintrag) {
  historieEintrag = true;
  history.pushState({ kalender: true }, "");
} else if (!alsAnsicht && historieEintrag) {
  historieEintrag = false;
  // Nur zuruecknehmen, wenn WIR den Eintrag gesetzt haben und nicht gerade
  // popstate laeuft - sonst schiebt sich der Verlauf gegenseitig.
  if (!ausPopstate) history.back();
}
```

- [ ] **Schritt 2: Auf den Zurück-Knopf reagieren**

```js
let ausPopstate = false;

window.addEventListener("popstate", () => {
  if (!historieEintrag) return;
  ausPopstate = true;
  historieEintrag = false;
  setzePanel(false);
  ausPopstate = false;
});
```

`ausPopstate` muss **vor** `setzePanel` deklariert stehen (oder als `var` bzw.
oben bei den anderen Zustandsvariablen), sonst greift Schritt 1 auf eine noch
nicht initialisierte Bindung zu.

- [ ] **Schritt 3: Prüfen**

1. Fenster 375×812, Kalender öffnen, Zurück-Knopf des Browsers. Erwartet:
   Liste, App bleibt offen.
2. Kalender öffnen, schließen, Zurück-Knopf. Erwartet: die App verlässt die
   Seite (der Eintrag wurde beim Schließen zurückgenommen) — es darf **nicht**
   erst der Kalender wieder aufgehen.
3. Fenster auf 1200 px, Kalender öffnen und schließen, Zurück-Knopf. Erwartet:
   kein Kalender-Verhalten, es passiert das Normale.
4. Mehrfach schnell hin und her schalten. Erwartet: `history.length` wächst
   nicht unbegrenzt.

- [ ] **Schritt 4: BETRIEB.md** — im Abschnitt „Kalender" festhalten, dass der
  Eintrag nur unterhalb der Split-Grenze existiert und warum `ausPopstate`
  nötig ist (sonst schiebt sich der Verlauf gegenseitig).

- [ ] **Schritt 5: Commit**

```
Kalender: Zurueck-Knopf fuehrt am Handy zur Liste statt aus der App

Nur unterhalb der Split-Grenze, wo der Kalender eine eigene Ansicht
ist - im Split steht ohnehin beides nebeneinander.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 3: Ziehgriff für die Breite des Streifens

**Dateien:**
- Ändern: `index.html` (im `<aside id="kalenderPanel">`, als erstes Kind)
- Ändern: `style.css` (neuer Block „Ziehgriffe", `:root { --kal-breite }` bei
  1594)
- Ändern: `kalender.js` (`istSplit()` bei Zeile 86, `SPLIT_AB` bei 69, neuer
  Abschnitt für die Griff-Mechanik)
- Ändern: `BETRIEB.md` (Abschnitt „Kalender")

**Schnittstellen:**
- Verbraucht: `istSplit()`, der `resize`-Wächter bei Zeile 2191
- Liefert: `zieheGriff(griff, optionen)` — die gemeinsame Mechanik, die
  Aufgabe 4 wiederverwendet. Signatur:

```js
/**
 * @param {HTMLElement} griff       das Griff-Element
 * @param {object} o
 * @param {"breite"|"hoehe"} o.achse
 * @param {() => number} o.start    Wert beim Anfassen (px)
 * @param {(wert:number) => void} o.setze   Wert anwenden (bereits geklemmt)
 * @param {() => void} o.zurueck    Doppelklick: gemerkten Wert vergessen
 * @param {number} o.min
 * @param {() => number} o.max      als Funktion, weil das Fenster sich aendert
 */
function zieheGriff(griff, o) { … }
```

- [ ] **Schritt 1: Die gemeinsame Griff-Mechanik**

Neuer Abschnitt in `kalender.js`, vor dem Wisch-Teil:

```js
// ---------- Ziehgriffe ----------
// Zwei Griffe teilen sich diese Mechanik: die Breite des Streifens (nur im
// Split) und die Aufteilung zwischen Tagesliste und Raster. Pointer-Events
// statt Maus- UND Touch-Ereignissen: ein Weg fuer Maus und Finger.
function zieheGriff(griff, o) {
  let anfang = 0, wertAnfang = 0;

  griff.addEventListener("pointerdown", e => {
    anfang = o.achse === "breite" ? e.clientX : e.clientY;
    wertAnfang = o.start();
    griff.setPointerCapture(e.pointerId);
    griff.classList.add("zieht");
    e.preventDefault();
  });

  griff.addEventListener("pointermove", e => {
    if (!griff.hasPointerCapture(e.pointerId)) return;
    const jetzt = o.achse === "breite" ? e.clientX : e.clientY;
    // Die Breite waechst nach LINKS (der Streifen sitzt rechts), die Hoehe
    // nach unten. Daher das Vorzeichen.
    const weg = o.achse === "breite" ? anfang - jetzt : jetzt - anfang;
    o.setze(klemme(wertAnfang + weg, o.min, o.max()));
  });

  const loslassen = e => {
    if (!griff.hasPointerCapture(e.pointerId)) return;
    griff.releasePointerCapture(e.pointerId);
    griff.classList.remove("zieht");
  };
  griff.addEventListener("pointerup", loslassen);
  griff.addEventListener("pointercancel", loslassen);

  griff.addEventListener("dblclick", o.zurueck);

  // Die App ist durchgehend mit der Tastatur bedienbar, das soll ein Griff
  // nicht brechen.
  griff.addEventListener("keydown", e => {
    const runter = o.achse === "breite" ? "ArrowLeft" : "ArrowDown";
    const hoch = o.achse === "breite" ? "ArrowRight" : "ArrowUp";
    if (e.key !== runter && e.key !== hoch) return;
    const schritt = (e.shiftKey ? 64 : 16) * (e.key === hoch ? 1 : -1);
    // Bei "breite" zeigt ArrowLeft nach aussen, macht also GROESSER.
    const vorzeichen = o.achse === "breite" ? -1 : 1;
    o.setze(klemme(o.start() + schritt * vorzeichen, o.min, o.max()));
    e.preventDefault();
  });
}

function klemme(wert, min, max) { return Math.min(max, Math.max(min, wert)); }
```

- [ ] **Schritt 2: Das Griff-Element**

In `index.html` als **erstes** Kind von `<aside id="kalenderPanel">`, vor
`<div class="kal-ansicht-zeile">`:

```html
    <!-- Zieht die Breite des Streifens. Nur im Split sichtbar - im
         Umschalt-Modus nimmt der Kalender ohnehin den ganzen Bildschirm. -->
    <div id="kalGriffBreite" class="kal-griff kal-griff-breite" role="separator"
         tabindex="0" aria-orientation="vertical"
         aria-label="Breite des Kalenders" title="Breite ziehen, Doppelklick setzt zurück"></div>
```

- [ ] **Schritt 3: CSS**

```css
/* ---------- Ziehgriffe ---------- */
.kal-griff { background: transparent; touch-action: none; }
.kal-griff:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Die Breite gibt es nur im Split. Der Griff liegt AUF der linken Kante,
   deshalb der halbe negative Versatz - sonst schoebe er den Inhalt. */
.kal-griff-breite { display: none; }
html.kal-split .kal-griff-breite {
  display: block;
  position: absolute;
  left: -6px; top: 0; bottom: 0;
  width: 12px;
  cursor: col-resize;
  z-index: 2;
}
.kal-griff-breite.zieht,
.kal-griff-breite:hover { background: var(--accent-soft); }
```

Ein eigener Positionierungskontext ist nicht nötig: `.kalender` ist bereits
`position: fixed` (Zeile 1642).

- [ ] **Schritt 4: Verdrahtung und Gedächtnis**

```js
const BREITE_MIN = 360;
const BREITE_MAX = 720;
const BREITE_KEY = "kalBreite";

function gemerkteBreite() {
  const roh = Number(localStorage.getItem(BREITE_KEY));
  return roh >= BREITE_MIN && roh <= BREITE_MAX ? roh : 0;   // 0 = keine eigene Breite
}

function setzeBreite(px) {
  document.documentElement.style.setProperty("--kal-breite", px + "px");
  try { localStorage.setItem(BREITE_KEY, String(Math.round(px))); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

// Beim Laden anwenden, sonst steht die eigene Breite erst nach dem ersten
// Ziehen wieder da.
if (gemerkteBreite()) {
  document.documentElement.style.setProperty("--kal-breite", gemerkteBreite() + "px");
}

zieheGriff(document.getElementById("kalGriffBreite"), {
  achse: "breite",
  start: () => kalPanel.getBoundingClientRect().width,
  setze: px => { setzeBreite(px); pflegeSplit(); },
  zurueck: () => {
    localStorage.removeItem(BREITE_KEY);
    document.documentElement.style.removeProperty("--kal-breite");
    pflegeSplit();
  },
  min: BREITE_MIN,
  max: () => Math.min(BREITE_MAX, window.innerWidth - BOARD_MINDEST),
});
```

- [ ] **Schritt 5: Die Split-Grenze wandert mit**

`istSplit()` bei Zeile 86 ersetzen:

```js
// Zwei Board-Spalten (min. 250 px) plus Raender. Bei der Standardbreite kommt
// damit genau die alte Grenze von SPLIT_AB heraus - wer nie zieht, merkt von
// der Aenderung nichts.
const BOARD_MINDEST = 520;

function istSplit() {
  const eigen = gemerkteBreite();
  return eigen
    ? window.innerWidth >= eigen + BOARD_MINDEST
    : window.innerWidth >= SPLIT_AB;
}
```

Und der `resize`-Wächter braucht dieselbe Prüfung nach dem Ziehen, weil sich
die Grenze selbst verschoben haben kann. Den vorhandenen Block bei Zeile 2191
in eine Funktion ziehen und von beiden Stellen aufrufen:

```js
function pflegeSplit() {
  pflegeBreit();
  if (!kalOffen) return;
  if (istSplit() !== document.documentElement.classList.contains("kal-split")) {
    setzePanel(true, true);
  }
  if (kalVollbild) messeVollbild();
}

window.addEventListener("resize", pflegeSplit);
```

- [ ] **Schritt 6: Prüfen**

1. Fenster 1400 px. Griff mit der Maus nach links ziehen. Erwartet: Streifen
   wird breiter, Board rückt mit, **kein** Versatz der Snackbar oder des
   Umschalters (alles hängt an `--kal-breite`).
2. Bis an beide Grenzen ziehen. Erwartet: bei 360 und 720 ist Schluss.
3. Neu laden. Erwartet: die gezogene Breite steht wieder da.
4. Doppelklick auf den Griff. Erwartet: zurück auf `min(440px, 38vw)`,
   `localStorage.getItem("kalBreite")` ist `null`.
5. Auf 700 px ziehen, dann das Fenster langsam verkleinern. Erwartet: der Split
   kippt bei rund 1220 px in den Umschalt-Modus, nicht erst bei 1000.
6. Ohne eigene Breite: Fenster über 1000 px hinweg verkleinern. Erwartet:
   Grenze unverändert bei 1000.
7. Griff mit Tab anfahren, Pfeiltasten. Erwartet: Links macht breiter, Rechts
   schmaler, Shift größere Schritte.
8. Fenster auf 375 px. Erwartet: Griff unsichtbar und nicht fokussierbar
   (`display: none` nimmt ihn auch aus der Tab-Reihenfolge).

- [ ] **Schritt 7: BETRIEB.md** — im Abschnitt „Kalender" den Absatz über die
  zwei Modi ergänzen: die Grenze ist nicht mehr fest, sondern
  `gemerkteBreite() + BOARD_MINDEST`, und ohne gemerkte Breite gilt weiter
  `SPLIT_AB`. Dazu der Hinweis, dass `--kal-breite` die **einzige** Stelle ist,
  an der eine Breite steht.

- [ ] **Schritt 8: Commit**

```
Kalender: Breite des Streifens laesst sich ziehen

Griff an der linken Kante, 360 bis 720 px, gemerkt; Doppelklick setzt
zurueck. Die Split-Grenze wandert mit - bei Standardbreite kommt genau
die alte Grenze von 1000 px heraus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 4: Ziehgriff für die Aufteilung

**Dateien:**
- Ändern: `index.html` (nach `<div id="kalTagesliste">`, Zeile 135)
- Ändern: `style.css` (Block „Ziehgriffe", `.kal-liste` bei 2116–2135)
- Ändern: `kalender.js` (Verdrahtung neben der aus Aufgabe 3)
- Ändern: `BETRIEB.md` (Abschnitt „Google Kalender", Unterabschnitt über das
  nachgebende Raster)

**Schnittstellen:**
- Verbraucht: `zieheGriff(griff, o)` und `klemme()` aus Aufgabe 3
- Liefert: nichts, worauf spätere Aufgaben aufbauen

**Warum:** `.kal-liste` hat heute `flex: 1` plus `min-height: min(360px, 44vh)`
ab 780 px Fensterhöhe. Der Platz ist also fest reserviert, auch wenn nur zwei
Zeilen drinstehen — im Screenshot ein Loch von rund 250 px über dem Raster.

Die Alternative „Tagesliste schrumpft auf ihren Inhalt" ist bewusst verworfen:
dann wanderte das Raster bei jedem Tageswechsel auf und ab.

- [ ] **Schritt 1: Das Griff-Element**

In `index.html` direkt nach `<div id="kalTagesliste" class="kal-liste"></div>`:

```html
    <!-- Teilt den Streifen zwischen Tagesliste und dem unteren Teil. Anders
         als der Breiten-Griff wird dieser auch mit dem Finger bedient, daher
         die groessere Trefferflaeche. -->
    <div id="kalGriffTeilung" class="kal-griff kal-griff-teilung" role="separator"
         tabindex="0" aria-orientation="horizontal"
         aria-label="Aufteilung zwischen Tagesliste und Kalender"
         title="Aufteilung ziehen, Doppelklick setzt zurück"></div>
```

- [ ] **Schritt 2: CSS**

```css
.kal-griff-teilung {
  flex: none;
  height: 24px;          /* Trefferflaeche fuer den Finger */
  margin: -8px 0;        /* optisch bleiben 8 px, gegriffen werden 24 */
  cursor: row-resize;
  position: relative;
}
/* Der sichtbare Strich in der Mitte der Trefferflaeche. */
.kal-griff-teilung::before {
  content: "";
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 36px; height: 3px;
  border-radius: 2px;
  background: var(--line);
}
.kal-griff-teilung.zieht::before, .kal-griff-teilung:hover::before { background: var(--accent); }
/* Im Vollbild gibt es keine Tagesliste - dann waere der Griff eine tote
   Flaeche. */
.kalender.vollbild .kal-griff-teilung { display: none; }
```

- [ ] **Schritt 3: Die Mindesthöhe weicht dem gemerkten Wert**

`.kal-liste` bekommt eine Variable, die im Normalfall nichts ändert:

```css
.kal-liste {
  flex: 1;
  min-height: 0;
  /* … unveraendert … */
}
@media (min-height: 780px) {
  /* Ohne eigenen Wert bleibt es bei der bisherigen Reservierung samt der
     Grenze bei 780 px - wer nie zieht, merkt nichts. Mit eigenem Wert
     entscheidet der Griff. */
  .kal-liste { min-height: var(--kal-teilung, min(360px, 44vh)); }
}
```

Wichtig: Bei gemerktem Wert muss zusätzlich `flex: none` gelten, sonst dehnt
`flex: 1` die Liste über den eingestellten Wert hinaus:

```css
html.kal-eigene-teilung .kal-liste { flex: none; height: var(--kal-teilung); }
```

- [ ] **Schritt 4: Verdrahtung**

```js
const TEILUNG_MIN = 120;
const TEILUNG_KEY = "kalTeilung";

// Was das Raster mindestens braucht: 36 px je Zeile (Untergrenze aus dem CSS)
// plus Monatskopf und Wochentage. Als Funktion, weil die Zeilenzahl mit dem
// Monat wechselt.
function rasterMindest() {
  const zeilen = Number(getComputedStyle(kalRaster).getPropertyValue("--kal-zeilen")) || 6;
  return zeilen * 36 + 84;
}

function setzeTeilung(px) {
  document.documentElement.classList.add("kal-eigene-teilung");
  document.documentElement.style.setProperty("--kal-teilung", Math.round(px) + "px");
  try { localStorage.setItem(TEILUNG_KEY, String(Math.round(px))); }
  catch (e) { /* voller Speicher - dann eben ungemerkt */ }
}

// Anwenden, ohne den gemerkten Wert zu ueberschreiben: auf einem niedrigen
// Fenster wird geklemmt, aber NICHT zurueckgeschrieben - sonst waere die am
// grossen Bildschirm eingestellte Aufteilung nach einmaligem Oeffnen am Handy
// dauerhaft verloren.
function wendeTeilungAn() {
  const roh = Number(localStorage.getItem(TEILUNG_KEY));
  if (!roh) { document.documentElement.classList.remove("kal-eigene-teilung"); return; }
  const max = kalPanel.clientHeight - rasterMindest();
  document.documentElement.classList.add("kal-eigene-teilung");
  document.documentElement.style.setProperty(
    "--kal-teilung", Math.round(klemme(roh, TEILUNG_MIN, Math.max(TEILUNG_MIN, max))) + "px");
}

zieheGriff(document.getElementById("kalGriffTeilung"), {
  achse: "hoehe",
  start: () => kalTagesliste.getBoundingClientRect().height,
  setze: setzeTeilung,
  zurueck: () => {
    localStorage.removeItem(TEILUNG_KEY);
    document.documentElement.classList.remove("kal-eigene-teilung");
    document.documentElement.style.removeProperty("--kal-teilung");
  },
  min: TEILUNG_MIN,
  max: () => Math.max(TEILUNG_MIN, kalPanel.clientHeight - rasterMindest()),
});
```

`wendeTeilungAn()` gehört an drei Stellen aufgerufen: einmal beim Laden, in
`pflegeSplit()` (das Fenster kann seine Höhe ändern) und in
`zeichneKalender()` nach dem Zeichnen des Rasters (die Zeilenzahl kann
gewechselt haben).

- [ ] **Schritt 5: Prüfen**

1. Fenster 1400×900, Kalender offen. Griff nach oben ziehen. Erwartet: Raster
   wird größer, Tagesliste kleiner, der Leerraum verschwindet.
2. Griff ganz nach unten. Erwartet: bei `rasterMindest()` ist Schluss, das
   Raster läuft **nicht** aus dem Panel.
3. Tag mit vielen ToDos wählen. Erwartet: die Tagesliste scrollt in sich, das
   Raster bleibt stehen. Auf einen leeren Tag wechseln. Erwartet: **nichts
   wandert**.
4. Neu laden. Erwartet: die Aufteilung steht wieder da.
5. Doppelklick. Erwartet: zurück auf die alte Reservierung.
6. **Der Klemm-Test:** Aufteilung großzügig einstellen, Fenster auf 500 px Höhe
   verkleinern (Raster bleibt vollständig sichtbar), dann wieder auf 900 px.
   Erwartet: die ursprüngliche Aufteilung ist zurück, `localStorage` enthält
   noch den großen Wert.
7. Vollbild-Knopf. Erwartet: Griff verschwindet mit der Tagesliste.
8. Am Handy (375×812) mit dem Finger ziehen. Erwartet: geht, und die Wischgeste
   zum Blättern kommt dem nicht dazwischen (`touch-action: none` am Griff).

- [ ] **Schritt 6: BETRIEB.md** — im Abschnitt über das nachgebende Raster
  ergänzen: Ohne eigenen Wert gilt alles wie bisher. Mit eigenem Wert
  entscheidet der Griff, und der gemerkte Wert wird beim Klemmen **nicht**
  zurückgeschrieben — mit dem Grund.

- [ ] **Schritt 7: Commit**

```
Kalender: Aufteilung zwischen Tagesliste und Raster laesst sich ziehen

Der Leerraum ueber dem Raster war fest reserviert. Jetzt entscheidet
ein Griff, was nicht passt scrollt in seinem Bereich - beim
Tageswechsel wandert nichts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 5: Google-Termine zwischenspeichern

**Dateien:**
- Ändern: `kalender.js` (`ladeGoogle()` ab Zeile 272,
  `window.kalenderGoogleVergessen` ab 2210)
- Ändern: `app.js` (`logout()` ab Zeile 644)
- Ändern: `BETRIEB.md` (Abschnitt „Google Kalender")

**Schnittstellen:**
- Verbraucht: `googleTermine`, `googleZustand`, `googleGeladen`,
  `zeitraumDesMonats()`, `quelleAn()`, `merkeNeueKalender()`, `eigeneEmail`
  (aus `app.js`)
- Liefert: `window.kalenderSpeicherLeeren()` — von `app.js` beim Abmelden
  aufgerufen. Keine Parameter, kein Rückgabewert.

**Warum:** Beim Öffnen zeichnet der Kalender zuerst nur die ToDos. Treffen die
Google-Termine ein, bekommen die Wochen ihre Balkenspuren, alle Zeilen werden
höher, der Streifen springt.

- [ ] **Schritt 1: Lesen und Schreiben**

```js
const SPEICHER_KEY = "kalTermineSpeicher";
const SPEICHER_MONATE = 3;

// Der Schluessel traegt die Kontoadresse: meldet sich am selben Browser jemand
// anderes an, greift dessen Schluessel gar nicht erst auf fremde Termine zu.
// app.js verschachtelt seinen Zwischenspeicher aus demselben Grund pro Konto.
function speicherSchluessel(von, ids) {
  return `${eigeneEmail || "?"}|${von}|${ids.join(",")}`;
}

function speicherLesen(schluessel) {
  try {
    const alles = JSON.parse(localStorage.getItem(SPEICHER_KEY) || "{}");
    return alles[schluessel] || null;
  } catch (e) { return null; }
}

function speicherSchreiben(schluessel, daten) {
  try {
    const alles = JSON.parse(localStorage.getItem(SPEICHER_KEY) || "{}");
    alles[schluessel] = daten;
    // Nur die juengsten Monate behalten. Ein voller Monat sind wenige
    // Kilobyte; der Deckel ist Vorsorge gegen unbegrenztes Wachstum, nicht
    // gegen ein akutes Problem.
    const schluessel_alle = Object.keys(alles);
    if (schluessel_alle.length > SPEICHER_MONATE) {
      for (const k of schluessel_alle.slice(0, schluessel_alle.length - SPEICHER_MONATE)) {
        delete alles[k];
      }
    }
    localStorage.setItem(SPEICHER_KEY, JSON.stringify(alles));
  } catch (e) { /* voller Speicher - dann eben ohne Zwischenspeicher */ }
}

window.kalenderSpeicherLeeren = function () {
  try { localStorage.removeItem(SPEICHER_KEY); } catch (e) { /* egal */ }
};
```

- [ ] **Schritt 2: Beim Laden zuerst den gemerkten Stand zeichnen**

In `ladeGoogle()`, direkt nach der Berechnung von `schluessel` und der
`googleGeladen`-Prüfung:

```js
  // Sofort zeichnen, was beim letzten Mal da war, dann still aktualisieren.
  // Der Preis: fuer einen Sekundenbruchteil steht ein minimal veralteter Stand
  // da. Das ist besser als ein Raster, das sich unter einem aufbaut.
  const gemerkt = speicherLesen(speicherSchluessel(von, ids));
  if (gemerkt && !googleTermine.length) {
    googleZustand.verbunden = true;
    googleZustand.palette = gemerkt.palette || {};
    if (Array.isArray(gemerkt.kalender)) googleZustand.kalender = gemerkt.kalender;
    googleTermine = Array.isArray(gemerkt.termine) ? gemerkt.termine : [];
    if (kalOffen) zeichneKalender();
  }
```

`googleZustand.moeglich` und `.schreiben` bleiben bewusst außen vor: Ob
geschrieben werden darf, entscheidet der Server. Ein aus dem Speicher
geholtes `schreiben: true` böte ein ＋ an, das in einen 403 laufen könnte.

- [ ] **Schritt 3: Frische Antwort merken, getrennt aufräumen**

Im `if (antwort.ok)`-Zweig, nach `googleAus = !d.verbunden;`:

```js
      if (d.verbunden && !d.fehler) {
        speicherSchreiben(speicherSchluessel(von, ids), {
          termine: googleTermine,
          kalender: googleZustand.kalender,
          palette: googleZustand.palette,
        });
      }
      // Zugriff bei Google widerrufen: der Endpunkt hat die Kontozeile schon
      // geloescht, hier muss der Zwischenspeicher mit - sonst zeigt der
      // Kalender Termine eines Kontos, das gar nicht mehr haengt.
      if (!d.verbunden) window.kalenderSpeicherLeeren();
```

Bei `d.fehler` wird **nicht** geschrieben: Eine Fehlermeldung ist kein
Terminstand, und der alte bleibt damit nutzbar.

- [ ] **Schritt 4: Trennen und Abmelden**

In `window.kalenderGoogleVergessen` (Zeile 2210) ergänzen:

```js
  window.kalenderSpeicherLeeren();
```

In `app.js`, in `logout()` **vor** dem `location.reload()`:

```js
  // Termine des abgemeldeten Kontos duerfen nicht liegen bleiben.
  window.kalenderSpeicherLeeren?.();
```

- [ ] **Schritt 5: Prüfen**

Mit nachgebauter Google-Antwort (siehe Vorbereitung).

1. Kalender öffnen, warten bis Termine da sind, schließen, wieder öffnen.
   Erwartet: Termine stehen **sofort** da, kein Aufbauen.
2. `localStorage.getItem("kalTermineSpeicher")` — erwartet: ein Objekt mit
   einem Schlüssel, der mit der Kontoadresse beginnt.
3. Vier verschiedene Monate durchblättern. Erwartet: höchstens drei Einträge
   im Speicher.
4. Nachgebaute Antwort auf `{verbunden: false}` umstellen, Kalender öffnen.
   Erwartet: Speicher ist leer, keine Termine mehr sichtbar.
5. Nachgebaute Antwort auf `{fehler: true}` umstellen. Erwartet: die Zeile
   „Google-Termine gerade nicht erreichbar" erscheint, der gemerkte Stand
   bleibt im `localStorage` stehen.
6. Abmelden. Erwartet: `kalTermineSpeicher` ist weg.
7. Google trennen (Einstellungen). Erwartet: ebenso.

- [ ] **Schritt 6: BETRIEB.md** — neuer Absatz im Abschnitt „Google Kalender":
  Warum zwischengespeichert wird, was der Schlüssel enthält und **warum die
  Kontoadresse darin steht**, die drei Löschstellen, und warum `moeglich` und
  `schreiben` nicht aus dem Speicher kommen.

- [ ] **Schritt 7: Commit**

```
Kalender: Termine stehen beim Oeffnen sofort da

Der letzte Stand liegt je Monat im Browser und wird still gegen Google
aktualisiert. Vorher baute sich das Raster unter einem auf, sobald die
Termine ankamen. Geleert wird beim Abmelden, beim Trennen und wenn
Google den Zugriff nicht mehr kennt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 6: Zeilenhöhe während des Ladens halten

**Dateien:**
- Ändern: `kalender.js` (`zeichneRaster()` ab Zeile 834)
- Ändern: `BETRIEB.md` (Abschnitt „Google Kalender")

**Schnittstellen:**
- Verbraucht: `googleLaedt`, `spurenJeWoche` aus `zeichneRaster()`
- Liefert: nichts, worauf spätere Aufgaben aufbauen

**Warum:** Der Zwischenspeicher aus Aufgabe 5 deckt den zweiten Besuch ab. Beim
ersten Öffnen eines Monats gibt es nichts zu merken — dann fällt das Raster
immer noch flach zusammen und geht wieder auf, sobald die Antwort da ist.

- [ ] **Schritt 1: Letzten Stand merken**

Oben in `kalender.js`:

```js
// Wie viele Spuren jede Woche beim letzten Zeichnen brauchte. Solange eine
// Anfrage laeuft, dient das als UNTERgrenze: das Raster faellt nicht erst
// flach zusammen, um gleich darauf wieder aufzugehen.
let spurenVorher = [];
```

- [ ] **Schritt 2: Als Untergrenze verwenden**

In `zeichneRaster()`, nach der Schleife, die `spurenJeWoche` füllt:

```js
  if (googleLaedt) {
    for (let w = 0; w < spurenJeWoche.length || w < spurenVorher.length; w++) {
      spurenJeWoche[w] = Math.max(spurenJeWoche[w] || 0, spurenVorher[w] || 0);
    }
  }
  spurenVorher = spurenJeWoche.slice();
```

- [ ] **Schritt 3: Beim Monatswechsel vergessen**

Ein anderer Monat hat andere Wochen — dessen Spurenzahl als Untergrenze wäre
geraten. In `springeZuHeute()` und überall, wo `kalMonatNr` gesetzt wird:

```js
  spurenVorher = [];
```

Am einfachsten in der Funktion, die den Monat wechselt (dort, wo heute schon
`zeichneKalender()` nach dem Setzen von `kalJahr`/`kalMonatNr` gerufen wird) —
eine Stelle, nicht drei.

- [ ] **Schritt 4: Prüfen**

1. Nachgebaute Antwort mit künstlicher Verzögerung versehen (etwa
   `await new Promise(r => setTimeout(r, 1500))`), `localStorage` leeren,
   Kalender öffnen. Erwartet: das Raster wächst einmal, wenn die Termine
   kommen — aber es fällt **nicht** vorher flach zusammen.
2. Innerhalb desselben Monats den Tag wechseln, während geladen wird.
   Erwartet: die Zeilenhöhe bleibt.
3. In den nächsten Monat blättern. Erwartet: die Höhe richtet sich nach dem
   neuen Monat, nicht nach dem alten.

- [ ] **Schritt 5: BETRIEB.md** — einen Absatz zu `spurenVorher` und warum es
  beim Monatswechsel geleert wird.

- [ ] **Schritt 6: Commit**

```
Kalender: Raster faellt beim Nachladen nicht mehr flach zusammen

Solange eine Anfrage laeuft, gilt die Spurenzahl des letzten Zeichnens
als Untergrenze. Beim Monatswechsel faellt sie weg - ein anderer Monat
hat andere Wochen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Aufgabe 7: Balkentitel nur, wo sie lesbar sind

**Dateien:**
- Ändern: `kalender.js` (`baueTagesZelle()` um Zeile 977, `zeichneRaster()` ab
  834)
- Ändern: `style.css` (`.kal-balken` im Kalender-Block)
- Ändern: `BETRIEB.md` (Abschnitt „Google Kalender")

**Schnittstellen:**
- Verbraucht: `spanne` und `eintrag` aus `baueTagesZelle()`, `spurenJeWoche`
- Liefert: nichts, worauf spätere Aufgaben aufbauen

**Warum:** Bei rund 55 px Spaltenbreite bleibt von „Finn Hausaufgaben" ein
„Finn H…" und von „XLETIX" ein „XLETI…". Der Text kostet Zellhöhe und sagt
nichts.

- [ ] **Schritt 1: Titel erst ab zwei Tagen**

In `baueTagesZelle()`, den Block ab `const text = document.createElement("span")`
(um Zeile 977) ersetzen:

```js
    // Titel nur, wo er lesbar ist. Massgeblich ist die Spanne in DIESER Zeile,
    // nicht die Gesamtlaenge des Termins: ein Ein-Tages-Abschnitt am
    // Wochenrand ist genauso schmal wie ein echter Ein-Tages-Termin. Der Name
    // steht ohnehin in der Tagesliste darunter.
    balken.title = eintrag.termin.titel;
    balken.setAttribute("aria-label", eintrag.termin.titel);
    if (spanne >= TITEL_AB_TAGEN) {
      const text = document.createElement("span");
      text.className = "kal-balken-text";
      text.textContent = eintrag.termin.titel;
      balken.appendChild(text);
    }
    stapel.appendChild(balken);
```

Oben bei den anderen Konstanten:

```js
const TITEL_AB_TAGEN = 2;
```

- [ ] **Schritt 2: Flachere Spur, wo kein Titel steht**

Die Balken **einer Woche** müssen gleich hoch bleiben, sonst versetzt sich die
durchgezogene Linie eines mehrtägigen Termins von Tag zu Tag — derselbe Grund,
aus dem `spurenJeWoche` je Woche und nicht je Tag gerechnet wird. Eine Zeile
wird also nur dort flacher, wo **kein** Balken einen Titel trägt.

In `zeichneRaster()`, bei der Schleife über `spurenJeWoche`, zusätzlich
mitrechnen, ob eine Woche überhaupt einen mehrtägigen Abschnitt hat:

```js
  // Traegt in dieser Woche irgendein Balken einen Titel? Wenn nein, darf die
  // Spur flach sein. Je WOCHE, nicht je Tag - sonst laegen gleiche Spuren in
  // einer Zeile auf verschiedenen Hoehen.
  const textJeWoche = [];
  for (let tag = 1; tag <= tageImMonat; tag++) {
    const w = wocheVon(tag);
    for (const eintrag of (plan[isoTag(kalJahr, kalMonatNr, tag)] || [])) {
      if (!eintrag) continue;
      // Mehrtaegig heisst: er reicht ueber diesen Tag hinaus oder kam von links.
      if (eintrag.weiterLinks || eintrag.weiterRechts) { textJeWoche[w] = true; break; }
      const naechster = plan[isoTag(kalJahr, kalMonatNr, tag + 1)] || [];
      if (naechster.some(e => e && e.termin.id === eintrag.termin.id)) { textJeWoche[w] = true; break; }
    }
  }
```

Und in `baueTagesZelle()` die Zelle markieren:

```js
  if (!textJeWoche[wocheVon(tag)]) zelle.classList.add("flache-spur");
```

(`textJeWoche` dazu in das `ctx`-Objekt aufnehmen, das `zeichneRaster()` an
`baueTagesZelle()` übergibt — dort stehen schon `spurenJeWoche` und `wocheVon`.)

CSS:

```css
/* Ohne Titel braucht der Balken keine Texthoehe. Gilt je Woche, damit die
   durchgezogene Linie eines mehrtaegigen Termins nicht aufreisst. */
.kal-tag.flache-spur .kal-balken { height: 6px; font-size: 0; }
```

- [ ] **Schritt 3: Prüfen**

Mit einer nachgebauten Antwort, die enthält: einen Termin über fünf Tage, einen
über zwei Tage, mehrere eintägige, und einen, der von Sonntag auf Montag läuft.

1. Erwartet: Der Fünf-Tage-Balken trägt seinen Titel einmal, durchgezogen.
2. Erwartet: Eintägige Termine zeigen nur ihren Farbbalken, ohne Text.
3. Mauszeiger auf einen eintägigen Balken. Erwartet: der Titel steht im
   Tooltip.
4. Der Sonntag-auf-Montag-Termin: Erwartet: Am Sonntag (Spanne 1) **kein**
   Titel, am Montag (Zeilenanfang, Spanne 1) ebenfalls keiner. Die Linie darf
   trotzdem nicht aufreißen — die Balken stehen in derselben Spur.
5. Eine Woche ohne mehrtägigen Termin neben einer mit. Erwartet: die Woche ohne
   ist erkennbar flacher, die Linie in der anderen ist ungebrochen.
6. Vollbild-Knopf. Erwartet: unverändertes Verhalten — dort sind die Zellen
   breit genug.

- [ ] **Schritt 4: BETRIEB.md** — im Absatz „Der Balken traegt seinen Titel"
  ergänzen: ab wann ein Titel gesetzt wird, warum die Spanne **in dieser Zeile**
  entscheidet und nicht die Gesamtlänge, und warum die flache Spur je Woche
  gilt.

- [ ] **Schritt 5: Commit**

```
Kalender: Balkentitel nur noch ab zwei Tagen

Bei 55 px Spaltenbreite blieb von einem Titel ohnehin nur "Finn H..."
uebrig - der Text kostete Zellhoehe und sagte nichts. Wochen ohne
mehrtaegigen Termin bekommen dadurch flachere Spuren.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Nach allen Aufgaben

- [ ] **Durchgang am Stück:** Fenster 375×812 und 1400×900, jeweils Kalender
  öffnen, blättern, Tag wählen, ToDo abhaken, Termin anlegen, Vollbild,
  Fokus-Reiter. Erwartet: keine Konsolenfehler, nichts springt.
- [ ] **Was ungeprüft geblieben ist, aufschreiben.** Voraussichtlich: der echte
  Google-Rundlauf (lokal ohne Zugangsdaten), der `getrennt`-Zweig beim Leeren
  des Zwischenspeichers, und echte Finger-Gesten auf einem Gerät. In BETRIEB.md
  vermerken — dieses Projekt hält so etwas ausdrücklich fest, statt Ungeprüftes
  als geprüft auszugeben.
- [ ] **Hendrik fragen, ob gepusht werden soll.** Push auf `main` deployt sofort
  auf todo.it-wolf.org.
