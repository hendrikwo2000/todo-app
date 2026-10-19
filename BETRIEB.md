# Betrieb

Technische Dokumentation. Für die Bedienung siehe [README.md](README.md).

Läuft als Cloudflare-Pages-Projekt auf `todo.it-wolf.org`, deployt automatisch
aus diesem Repo (Branch `main`, kein Build-Schritt).

Die Daten liegen in einer Cloudflare-D1-Datenbank (Bindung `DB`, Schema in
[schema.sql](schema.sql)) — nicht verschlüsselt: echte Spalten statt
Chiffretext erlauben Sortieren, Filtern und geteilte Listen. Der Preis:
der Betreiber kann die Inhalte lesen.

Aufbau in vier Ebenen: **Liste** (`boards`) → **Bereich** (`lists`, die
Spalten) → optional **Über-Thema** (`themen`, eine benannte Gruppe innerhalb
des Bereichs) → **ToDo** (`todos`, `thema_id` NULL = frei im Bereich). Wer
eine Liste sehen und bearbeiten darf, steht in `board_members`. Siehe
[Listen und Teilen](#listen-und-teilen).

## Login

Anmeldelink statt Passwort: wer sich anmelden darf, steht in der Tabelle
`users` — es gibt keine offene Registrierung (nur die Warteliste, siehe
unten). Ein Konto allein reicht seit dem symmetrischen Zugangsmodell (siehe
„Warteliste und Verwaltung") aber nicht mehr automatisch für DIESE App -
dafür braucht es zusätzlich `todo_zugang=1`. Fehlt die Spalte noch (z. B. ein
reines Fokus-Konto), setzt der Login-Versuch selbst sie mit — kein Umweg über
die Warteliste nötig, siehe dort.

Ablauf: Adresse eintragen → `/api/auth/request-code` verschickt über
[Resend](https://resend.com) eine Mail mit **Link** (ein Klick, fertig) und
einem sechsstelligen **Code** als Ausweg für den Gerätewechsel. Der Link geht
an `/api/auth/link`, der Code an `/api/auth/verify-code`; beide zeigen auf
denselben Datenbankeintrag, was zuerst benutzt wird, verbraucht beide. Gültig
sind sie zehn Minuten (Ausnahme: der Link aus der Willkommensmail, sieben
Tage, siehe unten).

Die wartende Anmeldemaske fragt alle drei Sekunden `/api/auth/status` ab und
geht von selbst auf, sobald der Link geklickt wurde — sonst stünde man vor dem
Codefeld, obwohl man längst angemeldet ist. Der Endpunkt antwortet absichtlich
immer mit 200, sonst färbt die Sekundentakt-Abfrage die Browser-Konsole rot.

Danach ein `HttpOnly`-Sitzungscookie. Sitzungen laufen **nicht von selbst ab** —
nur Abmelden oder Kontolöschung beendet sie. Das Cookie selbst ist auf 400 Tage
gesetzt, weil Browser längere Werte stillschweigend kürzen. Codes und
Sitzungstoken liegen nur gehasht in der Datenbank. Abmelden über
`/api/auth/logout` löscht die Sitzung serverseitig, nicht nur das Cookie — ein
abgegriffenes Token wird damit ebenfalls ungültig.

### Cookie gilt für die ganze Domain

Das Sitzungscookie ist auf `Domain=.it-wolf.org` gesetzt, nicht auf
`todo.it-wolf.org`. Nur dadurch sieht das **Schul-Dashboard** (eigenes
Pages-Projekt, gleiche D1) dieselbe Anmeldung — der geteilte Login hängt allein
an diesem Attribut, nicht am Hosting-Ort. Bis Oktober 2026 galt dasselbe für
die eigene Fokus-App (fokus.it-wolf.org); die ist in dieser App aufgegangen.

Die Domain wird **nur auf it-wolf.org-Hosts** gesetzt (`domainFlag` in
`_lib/session.js`). Auf `127.0.0.1` und den `*.pages.dev`-Vorschauadressen würde
der Browser ein fremdes Domain-Attribut still verwerfen — das Cookie käme gar
nicht erst an, und die Anmeldung bräche ohne sichtbaren Fehler.

Vor der Umstellung war das Cookie *host-only*. Diese alten Cookies räumt jede
Antwort mit `Set-Cookie` gezielt mit ab (zweite Zeile, gleicher Name, **ohne**
Domain, `Max-Age=0`) — sonst lägen zwei Cookies gleichen Namens nebeneinander,
der Browser schickt beide, und welches der Server zuerst liest, ist nicht
definiert. Deshalb liefern `setzeSessionCookies` und `loescheSessionCookies` ein
**Array**; die Aufrufer hängen die Zeilen mit `mitCookies()` einzeln an, weil ein
Objekt-Literal `Set-Cookie` nur einmal enthalten kann.

Der Umstieg passiert **still**: `GET /api/todos` setzt bei jeder Anfrage den
vorhandenen Token einmal neu, jetzt mit Domain (`umstiegAufDomainCookie`). Kein
Datenbankzugriff, kein Zwangs-Logout — beim nächsten Öffnen der Liste ist das
Cookie migriert.

Unbekannte Adressen bekommen eine klare Absage („Diese Adresse ist nicht
freigeschaltet"), die App wechselt dann von selbst zum Wartelisten-Formular.
Das verrät, welche Adressen registriert sind — bei einer Handvoll bekannter
Leute ohne offene Registrierung ist das vertretbar. Käme je eine öffentliche
Registrierung dazu, gehört hier die generische Antwort zurück.

### Variablen

Unter *Pages → Settings → Environment variables*:

| Variable | Zweck |
| --- | --- |
| `RESEND_KEY` | Resend-API-Key mit Sending-Zugriff auf `mail.it-wolf.org` |
| `ADMIN_MAIL` | optional: Adresse für Wartelisten-Benachrichtigungen. Ohne sie gehen sie an alle Konten mit `role='admin'` |
| `TURNSTILE_SECRET` | Geheimer Schlüssel des Turnstile-Widgets. Fehlt er, findet **keine** Bot-Prüfung statt |
| `VAPID_PUBLIC_KEY` | Öffentlicher Push-Schlüssel — steckt zusätzlich (unbedenklich) offen in `app.js` |
| `VAPID_PRIVATE_KEY` | Privater Push-Schlüssel, signiert die Push-Nachrichten. Siehe [Benachrichtigungen](#benachrichtigungen) |
| `PUSH_CRON_SECRET` | Geteiltes Geheimnis für `/api/push/pruefen` — ohne korrekten Header antwortet der Endpunkt mit 403 |
| `GOOGLE_CLIENT_ID` | OAuth-Client-ID für die Google-Kalender-Verknüpfung. Fehlt sie, bleibt der ganze Abschnitt in den Einstellungen unsichtbar |
| `GOOGLE_CLIENT_SECRET` | Zugehöriger geheimer Schlüssel — verlässt den Worker nie. Siehe [Google Kalender](#google-kalender) |

Absenderadresse ist `login@mail.it-wolf.org` (fest im Code, keine Mailbox
nötig — Resend verschickt nur, empfängt nichts). Die DNS-Einträge
(DKIM/SPF/DMARC) liegen unter `mail.it-wolf.org`, getrennt von den
Zoho-MX-Einträgen der Hauptdomain.

### Lokal testen

```
npx wrangler pages dev . --d1 DB=todo
```

Zwei Fallen, die je eine halbe Stunde kosten:

- **Der Datenbankname muss `todo` sein.** Jeder andere Name legt kommentarlos
  eine leere Datenbank an; der Fehler erscheint erst tief im Worker als
  „no such table" und sieht aus wie ein fehlendes Schema.
- **Aus dem Projektverzeichnis starten.** Aus einem Unterordner heraus legt
  Wrangler dort ein zweites `.wrangler/` mit leerer Datenbank an und arbeitet
  damit weiter.

Ohne `RESEND_KEY` schlägt jeder Mailversand fehl. `request-code` bricht dann
ab, *bevor* gespeichert wird — es entsteht also gar kein Anmeldelink zum
Testen; der Datensatz muss von Hand in `login_codes`.

### Rückkehr nach der Anmeldung (`?weiter=`)

Diese App ist seit dem 12.08.2026 die **Anmeldestelle für alle drei Apps**.
Das Schul-Dashboard (`schule.it-wolf.org`) hat bewusst keine eigene
Anmeldemaske: wer dort nicht angemeldet ist, landet hier mit
`?weiter=<seine Adresse>` und soll danach von selbst zurückkommen.

Das steckt in `app.js` direkt über `init()` (`merkeWeiter` /
`evtlWeiterleiten`) und ist **reines Frontend** — die Anmeldekette selbst
(`request-code`, `verify-code`, `link.js`) weiß davon nichts.

Der Wert wandert sofort in den `sessionStorage` und aus der Adresszeile:

- Ein Neuladen soll die Weiterleitung nicht wiederholen.
- Der Anmeldelink aus der Mail landet auf `/` ganz **ohne** Parameter. Wird er
  im selben Tab geöffnet, steht der gemerkte Wert noch da; wird er in einem
  zweiten geöffnet, springt der wartende erste Tab, sobald seine
  Status-Abfrage die frische Sitzung sieht.

**Akzeptiert werden nur `https:`-Ziele auf `it-wolf.org`.** Ohne diese Prüfung
wäre das eine offene Weiterleitung — ein Link
`todo.it-wolf.org/?weiter=https://boese.example` sähe vertrauenswürdig aus und
landete nach der Anmeldung woanders. Geprüft wird zusätzlich auf `canSave &&
serverErreichbar`: `canSave` allein wird auch beim Wiederherstellen aus dem
Offline-Cache gesetzt und wäre kein Beleg für eine echte Anmeldung.

Der Merker wird beim ersten Blick darauf gelöscht, auch wenn nicht
weitergeleitet wird — sonst hinge der Wunsch an der Sitzung und schöbe einen
später aus dem Nichts von der ToDo-Liste weg.

### Mehrere Konten im selben Browser (seit 18.10.2026)

Zum Testen: Admin in Tab 1, Testkonto in Tab 2, und keiner meldet den
anderen ab. **Nur freigeschaltet, wenn im Browser ein Admin angemeldet ist** —
normale Nutzer sehen nichts davon und melden sich wie immer um (die neue
Sitzung ersetzt die alte).

Bedienung: Im Konto-Abschnitt der Einstellungen gibt es genau drei Wege —
**Konto wechseln** (nur mit Admin im Browser), **Abmelden**, **Konto
löschen**. Die Kontoliste steht bewusst NICHT in den Einstellungen (Hendrik
fand das irreführend), sondern in der Anmeldemaske: „Konto wechseln“ öffnet
sie mit der Kontoauswahl wie bei Google — alle Konten des Browsers (das des
Tabs als „aktuell“ markiert), darunter „+ Konto hinzufügen“, erst dessen
Klick zeigt das Adressfeld. Ein Klick auf ein Konto wechselt **diesen** Tab,
ein neuer Tab startet mit dem zuletzt gewählten. Dieselbe Auswahl (ohne
„Zurück“) kommt von selbst, wenn das Konto des Tabs woanders abgemeldet
wurde. Höchstens `MAX_KONTEN` = 5.

**Server** (`functions/_lib/session.js`):

- Das erste Konto bleibt in `todo_session` (domainweit — das Schul-Dashboard
  sieht nur dieses). Alle weiteren Token stehen mit Punkt getrennt in
  `todo_weitere` (HttpOnly, host-only).
- Welches Konto ein Tab meint, kommt als Header `X-Konto: <user_id>`, bei
  echten Seitenaufrufen als `?konto=` (`/api/google/start`; bis 18.10.2026
  auch der Gewohnheiten-Export). `angemeldeterNutzer` nimmt dann **nur** die Sitzung
  genau dieses Kontos — ist sie weg, gibt es 401 statt still das erste Konto.
  Ohne Header alles wie vorher.
- `anmeldungVorbereiten` (in `verify-code.js` und `link.js`, VOR dem
  Verbrauchen des Codes): Ist ein Admin unter den Sitzungen des Browsers,
  kommt ein anderes Konto dazu statt zu ersetzen. Der Link leitet dann auf
  `/?konto=<id>`, der Code antwortet mit `zusaetzlich: true`. Bei vollem
  Browser: `/?login=zuviele` bzw. 409, Code und Link bleiben gültig.
- Abmelden und Konto löschen treffen nur das Konto des Tabs;
  `cookiesNachAbmelden` stutzt die Cookies auf das, was in `sessions` noch
  gilt. Fällt das erste Konto weg, rückt das nächste in `todo_session` nach.
  Die Antwort sagt `uebrig` und `naechstes`, danach richtet sich der Tab.
- Neu: `GET /api/auth/konten` (Liste für die Oberfläche, `mehrkonten` = ein
  Admin ist dabei). `GET /api/auth/status?email=` fragt nach genau der
  Adresse, auf deren Mail die Maske wartet — sonst ginge sie mit einem schon
  angemeldeten Admin sofort wieder zu.
- Google verbinden: `start.js` merkt sich das Konto in `google_konto`
  (Pfad `/api/google`, 10 Minuten), weil Google bei der Rückleitung nur
  `state` durchreicht.

**Browser** (`konto.js`, lädt als ERSTES Skript in `index.html` und
`admin.html`):

- `sessionStorage.konto` = Konto dieses Tabs, `localStorage.kontoZuletzt` =
  Startwert für neue Tabs. Gesetzt nur, solange mehr als ein Konto angemeldet
  ist; sonst läuft alles ohne Header wie früher.
- Eine Hülle um `fetch` hängt den Header an jede `/api/`-Anfrage — keine
  Stelle kann es vergessen. Links auf `/api/` bekommen `?konto=` beim Klick.
- `kontoSchluessel(name)` trennt den Offline-Speicher je Konto (`todoCache`,
  aktive Liste, Kalender-Termine und -Quellen, `gew_stand`/`gew_heute`/
  `gew_warteschlange`). Ohne die Trennung lieferte ein Tab die offline
  gemerkten Haken des anderen Kontos nach. `todoPending` brauchte das nicht,
  das ist schon nach Adresse verschachtelt.
- Kontowechsel = Neuladen, weil Schlüssel und App-Zustand nur beim Laden
  bestimmt werden. Tab-Titel dann „Name · ToDo-Liste“ (Name vorn, schmale
  Tabs schneiden hinten ab); `fokus.js` setzt nach dem Timer auf
  `window.seitenTitel` zurück.

**Bewusst nicht:** Push gibt es weiter nur einmal pro Browser — das Abo hängt
am Endpunkt des Browsers (`push_subscriptions.endpoint` ist eindeutig) und
geht an das Konto, das den Schalter zuletzt eingeschaltet hat. Der Schalter
steht dann in allen Tabs auf „An“.

**Lokal testen:** Cookies von Hand setzen geht auch hier
(`todo_session=<token>`, `todo_weitere=<token>.<token>`, siehe
„Lokal testen“); die Server-Fälle lassen sich bequem mit `curl` und
`-H "Cookie: …" -H "X-Konto: <id>"` durchspielen, inklusive der
`Set-Cookie`-Zeilen.

## Listen und Teilen

Eine **Liste** (`boards`) ist die teilbare Einheit über den Bereichen. Wer sie
sehen und **mitbearbeiten** darf, steht in `board_members` mit einer Rolle:

- `owner` — der Ersteller. Nur er darf umbenennen, teilen, Zugriffe entziehen
  und die ganze Liste löschen. Er steht selbst als `board_members`-Zeile drin,
  damit „welche Listen sehe ich?" **eine** Abfrage bleibt.
- `member` — eingeladen. Darf den **Inhalt** (Bereiche, ToDos) genauso ändern
  wie der owner, aber nicht die Liste selbst verwalten.

Pro Person höchstens **zwei eigene** Listen (`MAX_EIGENE_LISTEN` in
[functions/\_lib/listen.js](functions/_lib/listen.js)); geteilte Listen zählen
nicht mit. Eine Zahl, kein Deployment, falls das mal steigt.

**Endpunkte.** Der Inhalt läuft weiter über `/api/todos`: `GET` liefert alle
Listen des Nutzers samt Bereichen, Themen und ToDos in einer Antwort, `PUT`
speichert **eine** Liste (`{ boardId, categories, themen, todos }`). Anders
als früher wird nur diese eine Liste ersetzt — so kann das Speichern nie eine
andere plätten. Die
Verwaltung liegt unter `/api/listen/`: `neu`, `umbenennen`, `loeschen`,
`teilen`, `beitreten`, `verlassen`, `mitglieder`. Jeder prüft die Rolle frisch
in der Datenbank.

**Teilen-Link.** `teilen` legt einen `share_token` an (32 Zufalls-Bytes) und
gibt ihn zurück; die App baut daraus `<origin>/?beitreten=<token>`. Der Token
liegt bewusst im **Klartext** in `boards.share_token` — der Ersteller muss den
Link jederzeit erneut kopieren können, ein Hash ließe sich nicht zurückrechnen.
Er gewährt nur den Beitritt zu einer ToDo-Liste, kein hohes Schutzgut. Öffnet
eine angemeldete Person den Link, hängt `beitreten` sie als `member` ein
(doppelter Beitritt und eigene Liste sind harmlos).

**Link und Zugriffe sind getrennt** — es sind zwei verschiedene
Entscheidungen, und keine zieht die andere nach sich:

| Aktion | Endpunkt | Wirkung |
| --- | --- | --- |
| Link zurücksetzen | `teilen` `{ reset: true }` | neuer Token, alter Link läuft ins Leere; Mitglieder bleiben |
| **Teilen-Link löschen** | `teilen` `{ loeschen: true }` | `share_token` auf NULL, niemand kommt mehr neu dazu; Mitglieder bleiben |
| Alle Personen entfernen | `mitglieder` `{ alle: true }` | alle `member`-Zeilen weg; **Link bleibt bestehen** |
| Eine Person entfernen | `mitglieder` `{ userId }` | nur diese Zeile weg |

Früher setzte `{ alle: true }` den Token gleich mit auf NULL. Das nahm einem
die Wahl: wer nur aufräumen wollte, musste den Link neu verschicken, und wer
nur den Link totlegen wollte, warf ungewollt alle raus.

In der Oberfläche führt der Weg dorthin über „Zugriff verwalten" in der
Listen-Zeile. Der Einstieg erscheint, **sobald ein Link besteht** — auch ohne
Beitritte, denn auch dann will man den Link wieder loswerden können. Vorher
stand dort in diesem Fall nur der Satz „Link erstellt – noch niemand
beigetreten", und der Link ließ sich gar nicht mehr entfernen.

**Bewusst nicht konfliktfrei.** `PUT /api/todos` ersetzt den kompletten Inhalt
der Liste. Bearbeiten zwei Leute dieselbe Liste im selben Moment, gewinnt der
spätere Speichervorgang — im schlimmsten Fall verschwindet frisch
Hinzugefügtes. Für wenige Leute, die selten zeitgleich tippen, ist das
vertretbar. Echtes gleichzeitiges Bearbeiten wäre ein ToDo-für-ToDo-Abgleich
statt „alles auf einmal" — ein späterer Schritt, falls nötig.

**Die Werkzeugzeile am Spaltenkopf endet mit „＋ ToDo"** (`baueAddKnopfzeile()`
in `app.js`): Farbpunkt, ＋ Thema, ＋ ToDo. Die Zeile sitzt rechtsbündig neben
dem Bereichsnamen, also bleibt beim Auf- und Zuklappen der Werkzeuge (Klick auf
den Titel) nur der LETZTE Knopf an Ort und Stelle. Bis zum 20.08.2026 stand
＋ ToDo in der Mitte und rückte dabei jedes Mal unter dem Finger weg — bei dem
Knopf, den man täglich braucht, ist das der teuerste Platz in der Zeile.

**Jedes ToDo hat neben dem 🗑️ einen Bleistift** (`.act.edit`, seit
20.08.2026), der dasselbe tut wie der Doppelklick auf die Zeile — der bleibt.
Der Bleistift steht LINKS vom Mülleimer: die harmlose Aktion zuerst, die
unwiderrufliche am Zeilenrand. Er bleibt auch, seit es den Doppeltipp gibt:
eine Geste, die man nicht kennt, findet man nicht.

**Der Doppeltipp am Handy ist selbst gebaut** (seit 21.08.2026, Abschnitt
„Doppeltipp" in `app.js`) — `dblclick` gibt es am Touchscreen nicht. Zwei
`touchend` auf derselben Karte, weniger als 350 ms auseinander und keine 24 px
verrutscht, öffnen das Bearbeiten. Drei Feinheiten:

- Der Handler sitzt **am Board**, nicht an jeder Zeile: die Karten werden bei
  jedem `render()` neu gebaut, ein Handler pro Karte müsste jedes Mal mit.
- Ein erkannter Doppeltipp **verbraucht** den gemerkten Tipp (`letzterTipp`
  wird geleert), sonst zählte ein dritter Tipp als vierter weiter.
- `preventDefault()` hält den nachgeschobenen Klick zurück — der landete sonst
  im gerade geöffneten Eingabefeld und setzte den Cursor irgendwohin.
- Ein laufender Fingerzug (`fingerZug.aktiv`) ist kein Tipp, und Haken,
  Knöpfe und Unterpunkte sind ausgenommen: dort hat der Tipp eine eigene
  Aufgabe.

**Dieselbe Lücke gab es an jedem Titel** (seit 21.08.2026): Bereichsname,
Über-Thema und Listentitel benennen sich per Doppelklick um — am Handy kamen
dort nur zwei Einfachklicks an, also zweimal „Werkzeuge auf, Werkzeuge zu".
`doppeltippAuf(element, schlüssel, aktion)` bei den Hilfsfunktionen hängt den
Doppeltipp an ein einzelnes Element, **immer zusätzlich** zum
`dblclick`-Handler (am Rechner bleibt der Doppelklick der Weg, ein
Touch-Rechner kann beides). Die gemeinsame Aktion steckt in einer Variablen,
die beide bekommen — sonst läuft eine der beiden Fassungen irgendwann
auseinander.

**Der Merker `letzterTipp` gehört bewusst NICHT ins Element**, sondern ist
global und wird über einen Schlüssel angesprochen (`"bereich:<id>"`,
`"thema:<id>"`, `"liste"`, für ToDos die id selbst). Grund: Die Einfach-Aktion
feuert nach 220 ms und zeichnet dabei neu — beim zweiten Tipp liegt unter dem
Finger dann oft schon ein anderes DOM-Element, und eine Variable im Handler
wäre mitsamt dem alten Element weg. Der Schlüssel überlebt das. Getestet:
Tipp, `render()`, Tipp — das Umbenennen geht auf.

`istDoppeltipp()` macht die Erkennung für beide Wege; wer eine dritte Stelle
anschließt, nimmt dieselbe Funktion und **keine eigenen Zeitgrenzen**.

**Falle: Am Touchscreen frisst `:hover` den ersten Tipp.** Mobile Browser
liefern einen Tipp, der einen `:hover`-Effekt sichtbar macht, ZUERST als Hover
aus und verschlucken den Klick dabei — man muss also ein zweites Mal tippen.
Genau das war Hendriks Meldung „beim Abhaken muss das ToDo erst markiert
werden": `.todo:hover .actions` blendete Bleistift und Mülleimer ein, und
`.check:hover` färbte den Rahmen des Kästchens. Seit 21.08.2026 stehen alle
Hover-Regeln der ToDo-Zeile in `@media (hover: hover)`; am Finger hängt nichts
mehr an `:hover`, was sich sichtbar ändern könnte. Dieselbe Behandlung haben
`.kal-eintrag:hover` und `.kal-todo-zeile:hover` in der Tagesliste bekommen.

Zwei Folgen davon in `@media (hover: none)`:

- **Ein Tipp auf die Zeile übernimmt die Rolle des Hinzeigens.** Er setzt
  `.werkzeuge-offen` (JS, Abschnitt „Werkzeuge am Finger" in `app.js`), und
  nur diese eine Zeile blendet Bleistift und Mülleimer ein — samt
  Verlaufsschleier, genau wie am Rechner. Ein Tipp auf eine andere Zeile nimmt
  sie mit, ein zweiter Tipp auf dieselbe legt sie weg, ein Tipp daneben
  ebenfalls. **Erster Versuch war, sie am Handy dauerhaft zu zeigen** (mit
  `padding-right: 76px` an `.todo-main` als Platz dafür) — Hendriks Urteil am
  21.08.2026: „gefällt mir nicht, den soll man nur sehen wenn man das ToDo
  einmal angeklickt hat". Nicht erneut vorschlagen.
- **Die Tippfläche des Hakens ist 40 statt 32 px** (`.check-tap`) — die übliche
  Empfehlung für den Finger. Der negative Rand wächst mit, das sichtbare
  Kästchen bleibt also auf den Pixel da, wo es am Rechner auch sitzt.

**Warum eine Klasse und nicht `:hover`:** genau deshalb, weil `:hover` den
ersten Tipp fressen würde — die Klasse kommt aus einem `touchend`, den der
Browser schon ausgeliefert hat. `zeigeWerkzeuge()` setzt sie direkt am DOM
statt über `render()`: ein kompletter Neubau des Boards für zwei eingeblendete
Knöpfe wäre zu viel und kassierte nebenbei jede offene Eingabe ein.
`renderTodo()` liest `werkzeugeFuer` beim nächsten echten Neubau selbst aus —
sonst wären die Knöpfe nach jedem Sync wieder weg.

**Ein leeres Über-Thema klappt nicht** (`leer` in `renderThemaGruppe()`, seit
20.08.2026): kein Pfeil, ein Klick auf den Namen tut nichts. Eingeklappt sähe
es genauso aus wie ausgeklappt, und wer einmal darauf tippte, versteckte sich
unbemerkt einen Pfeil, der nichts mehr aufmacht. Ein gemerktes „zu" aus vollen
Zeiten wird dabei nur ignoriert und nicht gelöscht — kommt ein ToDo hinein,
steht das Thema wieder so da, wie man es verlassen hat. Umbenennen per
Doppelklick und Verschieben per Drag bleiben.

**Thema in einen anderen Bereich ziehen.** Ein Über-Thema lässt sich per
Drag komplett (mit allen ToDos) in einen anderen Bereich verschieben, nicht
nur innerhalb der eigenen Spalte umsortieren. Dabei müssen ToDos und Thema
gemeinsam ihre `categoryId` ändern (`verschiebeThema()` in `app.js`) — sonst
erkennt `PUT /api/todos` sie beim nächsten Speichern als verwaist (die
`categoryId` passt nicht mehr zum `thema_id`-Ziel) und setzt `thema_id`
still auf NULL, siehe Kommentar dort. Die gespeicherte Reihenfolge
(`themen.position`) zählt nur relativ innerhalb derselben `categoryId` —
Themen anderer Bereiche dazwischen im Array stören nicht.

**Migration bestehender Daten.** Früher hingen die Bereiche direkt an `user_id`
(eine Liste pro Nutzer). [migration-boards.sql](migration-boards.sql) baut das
um: je Nutzer entsteht eine Liste „Meine Liste", in die seine Bereiche und
ToDos unverändert wandern. **Einmalig**, vorher ein Backup:

```
wrangler d1 export todo --output=todo-backup.sql
wrangler d1 execute todo --file=migration-boards.sql
```

Rollback: das Backup zurückspielen. Für eine **frische** Datenbank reicht
`schema.sql` (enthält das neue Schema bereits).

## Einstellungen

Ein Dialog (`#einstellungenPopup`) mit mehreren Ansichten, die sich denselben
Kasten teilen: Hauptansicht plus die Rückfragen (Abmelden, Konto löschen,
Zugriff verwalten). Umgeschaltet wird über `zeigeEinAnsicht()`, das die
Ansichten nach ihrer ID ein- und ausblendet.

**Aufbau der Hauptansicht (seit 18.10.2026):** oben die **globalen**
Einstellungen als Zeilen — Darstellung, Zoom (nur Touch), Benachrichtigungen,
Konto, Verwaltung (nur Admin). Darunter **drei Reiter**, `ToDo`,
`Gewohnheiten` und `Timer` (`.ein-reiter`, umgeschaltet von `zeigeEinReiter()`
in `app.js`; beim Öffnen immer `ToDo`) als **Karteikarten**: der gewählte
Reiter geht nahtlos in den gerahmten Inhalt darunter über (`.ein-reiterbox`):
- **ToDo**: Google Kalender, Meine Listen, Geteilt mit mir.
- **Gewohnheiten**: Anzeige (Schalter-Zeile), Flamme zählt (Schalter-Zeile),
  Gewohnheiten (aufklappbar: Liste mit Stift und Hoch/Runter, „Neue
  Gewohnheit", Archiv — hieß bis 18.10.2026 „Verwalten"), „Verlauf & Statistik ›".
- **Timer** (eigener Reiter seit 18.10.2026): Anzeige (Schalter-Zeile für den
  Knopf ⏱), „Statistik ›" — öffnet das Fenster „Statistik" der Zeiterfassung
  (siehe Kapitel „Zeiterfassung"). Bis zum Umbau am selben Abend standen hier die
  Standarddauer des Countdowns und „Fokuszeit ›". Hendriks Frage war, ob Gewohnheiten und Timer getrennt
  gehören; er will den Timer als Nächstes ausbauen. Gleich danach wollte er die
  Trennung vollständig („der Timer hat nichts mit Gewohnheiten zu tun"): eigenes
  Fenster für die Fokuszeit, das Gewohnheiten-Fenster nur noch mit Verlauf und
  Statistik. Bei 360 px passen die drei Reiter noch ohne Abschneiden
  („Gewohnheiten" ist der längste).

**Schalter als Zeile, Inhalt zum Aufklappen.** Ein einzelner Schalter steht
wie „Darstellung" direkt als Zeile (`.ein-abschnitt.ein-zeile`), ohne
Aufklappen und ohne Erklärtext (Hendrik, 18.10.2026); aufklappbar (`<details>`)
ist nur, was mehr Inhalt hat. Die Erklärung der Flammen-Zählweise steht seitdem
nur noch als Tooltip (`title`) an der Zeile. Der JSON-Export
(`/api/export`) ist am selben Tag ersatzlos weggefallen („braucht man nicht").

Hendriks Vorgabe (gefragt): „Einstellungen öffnen, dann sieht man alle
globalen Einstellungen … und dann ein Reiter zum Öffnen, damit es
übersichtlicher wird". Mein erster Entwurf (Reiter ganz oben, alles andere im
ToDo-Reiter) war nicht gemeint und wurde verworfen. Die Reiterzeile (`.ein-reiter`,
`.ein-reiter-seg`) ist dieselbe wie im Fenster „Gewohnheiten"; `app.js` greift sich
seine Reiter deshalb nur in `#einstellungenHaupt`, `gewohnheiten.js` seine nur im
Fenster. Dort setzt `gewZeigeReiter` `data-reiter` ans Fenster, damit das CSS die
Ecke unter dem vorderen Reiter eckig macht (bei den Einstellungen geht das über
die IDs der beiden Inhalte).

**Karteikarten statt loser Reiterzeile** (Hendrik nach dem ersten Stand am
18.10.2026: „nicht direkt ersichtlich, dass die Reiter zu den Einstellungen
darunter gehören"). Erster Versuch war eine Karte mit Akzent-Unterstreichung
am Reiter — „der blaue Balken" gefiel ihm nicht; sein Vorbild war ein Spiel-Menü
mit abgesetzten Reitern, deren gewählter in den Inhalt übergeht. Die Naht
entsteht über `margin-bottom: -1px` an den Reitern; unter dem gewählten Reiter
ist die obere Ecke des Inhalts eckig (`#einReiterTodo` links,
`#einReiterTimer` rechts; der mittlere Reiter hat beide Ecken rund).

**Ein Akkordeon über alles, beim Öffnen alles zu.** Konto (oben) und die
Abschnitte beider Reiter bilden *ein* Akkordeon: immer nur einer offen
(`resetAkkordeon()`; die Selektoren haben bewusst kein `>`, sonst fielen die
Abschnitte in den Reitern heraus). Beim Öffnen steht keiner offen — Hendriks
Wunsch am 18.10.2026. Zwischendurch waren die drei Gewohnheiten-Abschnitte
offen untereinander (seine erste Wahl); nach dem Ausprobieren wollte er sie
doch eingeklappt. Die Trennlinie zwischen Abschnitten setzt CSS nur *zwischen*
zwei sichtbare (`~`): „Google Kalender" ist ohne Zugangsdaten ausgeblendet, mit
`:first-child` stünde dann eine Linie direkt unter der Reiterzeile.

**Der Dialog sitzt oben fest, nicht mittig** (`#einstellungenPopup`,
`--ein-abstand-oben: 8vh`). Mittig zentriert wanderte seine Oberkante bei jedem
Aufklappen und Reiterwechsel nach oben; jetzt wächst er nur nach unten, bis
zum Rand (dann blättert `.ein-blaettern`). Am Handy gilt weiter Vollbild.
Dieselbe Regel gilt für das Fenster „Gewohnheiten" (`#gewFenster`): dort sprang
die Oberkante beim Wechsel zwischen den Reitern (Hendrik am 18.10.2026). Die
kleinen Dialoge (neue Gewohnheit, Tag nachtragen) bleiben mittig.

**„Verwalten" steht in den Einstellungen, nicht mehr im Fenster** (Hendrik am
18.10.2026, auf Rückfrage: eigener Abschnitt im Reiter „Gewohnheiten"; das
Fenster hat danach drei Reiter, Verlauf, Statistik, Fokuszeit). Vorher war es
der vierte Reiter im Fenster, erreichbar über einen Knopf in den Einstellungen.
Die Liste zeichnet weiter `gewZeichneVerwalten()` in
`gewohnheiten.js`; `gewZeichneAktuell()` zeichnet sie bei jeder Änderung mit,
auch wenn das Fenster zu ist. `gewEinstellungenZeigen()` (gewohnheiten-dialoge.js)
holt dafür bei jedem Öffnen der Einstellungen den Bestand neu (die Liste kann an
einem anderen Gerät geändert worden sein). Der Dialog zum Anlegen/Bearbeiten
legt sich über die Einstellungen; Escape schließt erst ihn, dann die
Einstellungen.

**„Verlauf & mehr" ist ein Eintrag im Reiter „Gewohnheiten", der das Fenster
öffnet** (`#gewVerlaufOeffnen`, ein `<button class="ein-abschnitt ein-zeile
ein-zeile-knopf">` als letzte Zeile hinter „Verwalten", mit Pfeil nach rechts
statt ▾, weil er nicht aufklappt). Das Fenster mit Verlauf, Statistik und
Fokuszeit bleibt, wie es war (Hendrik am 18.10.2026: „besser ist, wenn es wie
davor ist, aber in den Einstellungen verlinkt"). Dazwischen gab es einen
Versuch, alles als dritten Reiter „Verlauf & mehr" direkt in die Einstellungen
zu legen und das Fenster zu streichen (Commit `85c6653`); er wurde noch am
selben Tag zurückgenommen. Falls das Thema wiederkommt: dort steht, wie
`oeffneEinstellungenBei`, das lazy Zeichnen der Abschnitte und die
Escape-/Zurück-Behandlung gelöst waren.

**Der Stift im Verlauf** sitzt in der gewählten Pille (`.gw-pille-gewaehlt`, ein
feiner Strich trennt Name und Stift) und ist ein gezeichnetes Symbol statt des
Schriftzeichens ✎, das zwischen den Pillen klein und fremd wirkte (Hendrik am
18.10.2026). Dasselbe Symbol (`GEW_STIFT_SVG`) tragen die Zeilen der
Verwalten-Liste. Die Karten der Gewohnheiten (`fokus.js`) haben weiter das
Schriftzeichen.

**Das Zahnrad gibt es zweimal.** Einmal in der Kopfzeile der App
(`#einstellungenBtn`), einmal im Kalender (`.kal-ansicht-zeile`) — am Handy
verdeckt der Kalender die Kopfzeile, und ohne das zweite käme man aus der
Kalenderansicht gar nicht mehr in die Einstellungen. Beide tragen
`.ein-knopf`, werden gemeinsam verdrahtet und gemeinsam mit der Anmeldung
sichtbar gemacht (`zeigeEinstellungenKnopf()`). Reihenfolge in beiden Ecken
gleich: Zahnrad, dann Umschalter.

**„Zoom mit zwei Fingern" (seit 20.08.2026), Standard AUS.** Die Sperre steht
in der Viewport-Zeile in `index.html` (`maximum-scale=1, user-scalable=no`)
und nicht im JS — so gilt sie ab dem ersten Bild und nicht erst, wenn das
Skript gelaufen ist. `wendeZoomAn()` in `app.js` nimmt sie beim Einschalten
wieder heraus. Dazu zwei Riegel für Browser, die den Viewport-Eintrag nur halb
ernst nehmen: `html.ohne-zoom { touch-action: pan-x pan-y }` (nimmt das Zoomen,
lässt jedes Scrollen — Elemente mit eigenem `touch-action` wie das
Kalenderraster behalten ihres) und `preventDefault()` auf `gesturestart` /
`gesturechange` / `gestureend`, die es nur in Safari gibt: iOS ignoriert
`user-scalable=no` seit iOS 10.

Grund für „aus": beim Ziehen eines ToDos und beim Wischen im Kalender löst die
Geste ständig aus Versehen aus, und eine schief gezoomte App bekommt man nur
mit Mühe wieder gerade. **Die Zeile erscheint nur am Touchscreen**
(`pointer: coarse`) — am Rechner zoomt man mit Strg+Mausrad, und daran ändert
der Viewport-Eintrag nichts; ein Schalter, der dort nichts tut, wäre schlimmer
als keiner. Gilt pro Gerät (`localStorage`, Schlüssel `zoom`).

**Am Handy Vollbild** (`max-width: 560px`), am Rechner ein mittiger Kasten von
620 × max. 92vh — dort bleibt das Board drumherum sichtbar, und ein
Vollbild-Schirm wäre für den Inhalt viel leerer Raum. Geschlossen wird über
das **✕ oben rechts**; am Rechner zusätzlich weiterhin per Klick neben den
Kasten.

Die Größe soll das Blättern ersparen. Mehr **Breite** hilft dabei nicht —
nachgemessen ergeben 440 px und 700 px dieselbe Inhaltshöhe, weil die aus den
Zeilen kommt und nicht aus umbrechendem Text. Breiter ist der Dialog
trotzdem, damit die Knopfreihen nicht so gedrängt stehen. Was wirklich half,
waren die **kompakteren Listen-Zeilen** (siehe unten): „Meine Listen" fiel
damit von 697 auf 538 px, und bei 1366 × 768 blättert nichts mehr. Ab rund
780 px Fensterhöhe passt auch der längste Abschnitt („Konto", 595 px) mit
Reserve.

**Aufbau: feste Kopfzeile, darunter der einzige blätternde Teil.** Die
Kopfzeile (`<header class="ein-kopfzeile">`) trägt das ✕ und steht außerhalb
von `.ein-blaettern`, das als einziges `overflow-y: auto` hat. Früher scrollte
die ganze Box — das ✕ wäre nach ein paar Zeilen aus dem Bild gewesen, und am
Handy (Vollbild, kein Rand zum Danebentippen, keine Escape-Taste) gäbe es dann
keinen Weg mehr hinaus. Bewusst **nicht** per `position: sticky` gelöst: unter
einer Gerätekerbe (`safe-area`) klebte der Knopf sonst hinter der Statusleiste.

Zwei Fallstricke dabei: die Kopfzeile ist ein `<header>` und kein `<div>`,
weil die Regel `.einstellungen > div` den ANSICHTEN gilt und hier nicht
mitgreifen darf. Und `.ein-blaettern` braucht `min-height: 0` — ohne das
wächst ein Flex-Kind über seinen Anteil hinaus, statt zu blättern.

**Liste aktivieren.** Unter „Meine Listen" und „Geteilt mit mir" macht ein
Tipp auf die Zeile die Liste zur aktiven (`macheZeileWaehlbar()`). **Der
Dialog bleibt dabei offen** — das AKTIV-Abzeichen wandert nur um, und wer
danach noch etwas anderes einstellen will, muss ihn nicht neu suchen. Die
aktive Zeile ist nicht wählbar (sie trägt kein `.waehlbar`), ihr Name bleibt
ein `<span>` mit dem Abzeichen; `zeichneListen()` baut die Zeilen nach dem
Wechsel neu auf, damit Abzeichen und Wählbarkeit umspringen.

Klicks auf die Knöpfe IN der Zeile (Teilen, Umbenennen, 🗑️) sind
ausgenommen — sonst löste jedes „Umbenennen" auch einen Listenwechsel aus.
Weil der Dialog stehen bleibt, ist die **Snackbar auf `z-index: 130`** hoch
(über die 120 des Dialogs): bei 50 lag sie darunter, und Rückmeldungen wie
„Alle Zugriffe entzogen." wurden zwar gesetzt, sah aber niemand.

**Kompakte Listen-Zeilen.** Name links, Knöpfe rechts **daneben** statt
darunter — das spart je Zeile eine ganze Textzeile samt Abstand, rund 29 px
(Zeilenhöhe von ~105 auf 50 px). Der Umbruch bleibt eingebaut: `.listen-zeile`
ist `flex-wrap: wrap`, `.lz-kopf` wächst (`flex: 1 1 auto`), `.lz-knoepfe`
nicht (`flex: none`). Wird der Name zu lang, rutschen die Knöpfe von selbst
auf die zweite Zeile — genau das Bild von vorher, am Handy der Normalfall.
Bewusst `flex-basis: auto` statt `0` am Kopf: ein halber Listenname wäre
schlechter als eine zweite Zeile.

`.lz-loeschen` trug früher `margin-left: auto`, um die 🗑️ an den rechten
Zeilenrand zu schieben. Das ging, solange die Knopfgruppe die ganze Breite
einnahm; jetzt ist sie nur so breit wie ihr Inhalt und `auto` hätte nichts
mehr zu verteilen — daher ein fester Abstand, der dieselbe Trennung erzeugt.

**Falle, hier wieder aufgetreten:** `.admin-popup-box .btn` setzt
`display: inline-flex` und schlägt damit das eingebaute `[hidden]` des
Browsers — „Alle Personen entfernen" blieb ohne Mitglieder sichtbar. Behoben
mit einer zentralen Zeile `.admin-popup-box .btn[hidden] { display: none }`
für **jeden** Knopf im Dialog, statt wie früher je Knopf einzeln
(`#googleTrennen`, `.google-btn` tragen ihre eigene Zeile noch aus der Zeit
davor). Der Fehler fiel erst auf, als die Ansicht auch ohne Mitglieder
erreichbar wurde — vorher kam man mit 0 Personen gar nicht dorthin.
Die Zeile selbst bekommt bewusst **kein** `role="button"`: sie enthält weitere
Knöpfe, und ein Knopf im Knopf macht die inneren für Vorleseprogramme
unerreichbar. Stattdessen ist der **Name** bei wählbaren Zeilen ein echter
`<button>` — große Fläche für den Finger, sauberer Weg mit der Tastatur.

### Hilfe (seit 19.10.2026)

Zeile „❓ Hilfe ›“ unter „Konto“ (`#hilfeOeffnen`), öffnet das Fenster
`#hilfeFenster` (`hilfe.js`). Anlass war die Analyse vom 19.10.2026: viele
Funktionen stecken hinter Klick, Doppelklick, Ziehen oder Wischen, und die
Farben erklärte nirgends jemand. Hendriks Wahl: Zeile bei den globalen Zeilen,
eigenes Fenster wie „Verlauf & Statistik“ (schließt die Einstellungen, oben
fest, am Handy Vollbild), sieben aufklappbare Abschnitte als EIN Akkordeon.

- **Aufbau eines Abschnitts (zweite Runde, 19.10.2026):** Hendrik fand den
  Inhalt „noch nicht so übersichtlich, sollte extrem einfach zu erkennen sein“
  (die Struktur mit den sieben Abschnitten blieb). Gewählt aus drei Skizzen:
  „Kurz + Mehr dazu“. Jeder Abschnitt zeigt zuerst einen **Spickzettel**
  (`dl.hilfe-zeilen`, je Zeile `div.hilfe-zeile` mit `dt` = was man will,
  `dd` = wie es geht, höchstens ein Satzstück), danach `details.hilfe-mehr`
  „Mehr dazu“ mit Sonderfällen und Feinheiten. Erste Schritte ist nummeriert
  (`.hilfe-nummeriert`), ToDos hat Symbol-Pillen (`.hilfe-chips`), Farben
  nutzt die echten `.col-count`-Pillen (`.hilfe-schmal` = schmale linke
  Spalte). Gesten stehen als „2× antippen“ da und werden einmal oben erklärt
  (`.hilfe-vorab`: am Rechner ein Doppelklick) statt in jeder Zeile doppelt.
  **Falle:** `hilfe.js` zählt nur `details.ein-abschnitt` zum Akkordeon —
  `hilfe-mehr` darf diese Klasse nie bekommen, sonst klappt es die Abschnitte
  zu; es geht mit seinem Abschnitt zu (Öffnen und Zuklappen). Neue Bedienung
  gehört als Zeile in den Spickzettel, wenn sie eine Hauptsache ist, sonst
  unter „Mehr dazu“. sw.js v51.
- **Der Text steht fest in `index.html`.** Wer eine Bedienung ändert (Geste,
  Symbol, Farbe, Ort einer Einstellung), passt die Hilfe im selben Commit mit
  an — sonst erklärt sie bald etwas, das es nicht mehr gibt. Gesten stehen
  immer für beide Geräte da („Doppelklick (am Handy zweimal tippen)“).
- **Erster Start:** `hilfeBeimErstenStart()` am Ende von `init()` in `app.js`,
  nur wenn die Server-Antwort KEINE Liste enthält (neues Konto) und auf diesem
  Gerät noch nicht gezeigt (`localStorage.hilfeGezeigt`). Öffnet mit „Erste
  Schritte“ offen. Bestehende Konten sehen davon nie etwas — meine
  Entscheidung, Hendrik hat sie mit dem Entwurf abgenickt.
- **Escape** in der Einfangphase mit `stopImmediatePropagation` (wie die
  Fenster der Zeiterfassung), sonst schlösse derselbe Druck den Kalender
  dahinter. Die Zurück-Taste am Handy erreicht die Hilfe über
  `schliesseObersteEbene()` in `kalender.js`.
- Die Farbmuster im Abschnitt „Farben“ benutzen dieselben Variablen wie die
  Karten (`--red`, `--yellow`, `--accent`) und folgen damit beiden Themen.

### Escape schließt nur das Innerste (seit 19.10.2026)

Vorher schloss derselbe Tastendruck neben Einstellungen, Listenmenü, Farbauswahl,
Bereichs-Werkzeugen oder einem Eingabefeld auch den Kalender dahinter: `app.js`
und `kalender.js` hängen beide am `document`, `kalender.js` kommt danach. Jetzt
gilt: **Hat Escape etwas geschlossen, ist es verbraucht.** Der Handler in `app.js`
ruft dann `stopImmediatePropagation()` auf (Einfangphase unnötig, weil `app.js`
vor `kalender.js` lädt — bei geänderter Skript-Reihenfolge prüfen), die Eingabefelder
(ToDo bearbeiten: Titel und Notiz, Anlegefeld: Titel und Notiz, Bereich und
Thema umbenennen, Listentitel umbenennen) rufen `e.stopPropagation()`. Ein
neues Eingabefeld mit eigenem Escape braucht dieselbe Zeile.
**Offener Rest:** Escape bei Fokus auf einem Knopf, Datums- oder Auswahlfeld
*im* ToDo-Bearbeiten bricht das Bearbeiten nicht ab und schließt weiter den Kalender.

## Benachrichtigungen

Zwei Bausteine, unabhaengig voneinander nutzbar: eine echte Push-Meldung
("3 ToDos sind fällig") und eine Zahl auf dem App-Icon (Badge), sobald die
App auf dem Handy zum Home-Bildschirm hinzugefuegt wurde.

**Web Push von Hand, ohne Bibliothek** (`functions/_lib/webpush.js`): das
Projekt hat bewusst kein `package.json`/Build-Schritt (siehe oben), deshalb
die Verschluesselung (RFC 8291, "aes128gcm") und die VAPID-Signatur
(RFC 8292, ES256-JWT) direkt mit WebCrypto (`crypto.subtle`) implementiert.
Beide Standards gelten fuer iOS/Safari (ab 16.4, nur fuer eine vom
Home-Bildschirm gestartete App) genauso wie fuer Chrome - Apple nutzt fuer
Web Push denselben offenen Push-Dienst wie jeder andere Browser, kein
eigenes APNs-Zertifikat noetig. Verifiziert per isoliertem Rundlauf-Test
(verschluesseln mit dem Projekt-Code, entschluesseln mit einer gespiegelten
Referenz-Implementierung in Node) - ein echtes Geraet laesst sich von hier
aus nicht pruefen.

**Tabelle `push_subscriptions`**: ein Abo je Geraet/Browser (`endpoint` +
die beiden Schluessel `p256dh`/`auth` aus der PushSubscription des
Browsers). Ein Nutzer kann mehrere Zeilen haben (mehrere Geraete); meldet
sich dasselbe Geraet erneut an, ersetzt `ON CONFLICT(endpoint)` die
bestehende Zeile.

**Endpunkte** unter `/api/push/`:
- `abonnieren` (POST, angemeldet) - Abo speichern/erneuern
- `abbestellen` (POST, angemeldet) - eigenes Abo loeschen
- `pruefen` (GET/POST) - KEIN Nutzer-Endpunkt, siehe unten

**Zeitsteuerung ohne eigenen Cloudflare-Worker.** Cloudflare Pages kennt
selbst keine Cron Triggers (die gibt es nur fuer eigenstaendige Worker mit
`scheduled()`-Handler - ein zweites Cloudflare-Projekt nur dafuer war hier
nicht im Verhaeltnis). Stattdessen prueft `/api/push/pruefen` bei jedem
Aufruf frisch, welche Nutzer mit Push-Abo faellige/ueberfaellige, nicht
erledigte ToDos haben, und verschickt bei Bedarf. Ein kostenloser externer
Dienst ([cron-job.org](https://cron-job.org), kein Konto-Zwang) pingt diesen
Endpunkt mehrmals taeglich an - GET oder POST auf
`https://todo.it-wolf.org/api/push/pruefen`, Header `X-Cron-Secret: <Wert
von PUSH_CRON_SECRET>`. Ungueltige Abos (Geraet abgemeldet: 404/410 vom
Push-Dienst) werden dabei automatisch aus der Datenbank entfernt.

**"Heute" in Europe/Berlin, nicht UTC** (`heuteBerlin()` in `pruefen.js`) -
sonst faellt der Tageswechsel je nach Sommer-/Winterzeit bis zu zwei Stunden
falsch.

**Badge (Zahl auf dem App-Icon).** Zwei Wege zum selben Ziel, weil ein
Skript das Icon nur anfassen kann, waehrend ein Fenster offen ist:
- Im Vordergrund: `aktualisiereBadge()` in `app.js`, bei jedem `render()`
  neu berechnet ueber ALLE Listen (nicht nur die aktive).
- Im Hintergrund: der Push-Payload traegt die Zahl mit (`badge` im
  JSON), der Service Worker setzt sie im `push`-Event
  (`self.registration.setAppBadge()`, siehe `sw.js`).

**Die Zahl haengt am Benachrichtigungs-Schalter** (seit 20.08.2026). Steht er
auf Aus, verschwindet die Zahl sofort (`setzeBadgeErlaubt(false)` loescht sie
und sperrt `aktualisiereBadge()`), und beim naechsten Einschalten kommt sie
zurueck. Grund: fuer den Nutzer ist beides dasselbe „die App meldet sich" - ein
roter Punkt am Icon nach dem Abschalten der Benachrichtigungen sieht aus, als
haette der Schalter nicht gegriffen.

Beim Start entscheidet `pruefeBadgeErlaubnis()`. Sie prueft ERST
`Notification.permission` und danach das Abo - der Umweg ueber
`navigator.serviceWorker.ready` kommt bei einem Service Worker, der sich nicht
installieren laesst, naemlich nie zurueck, und die Zahl haenge dann fuer immer
in der Schwebe. Aus demselben Grund steht ein 4-Sekunden-Rennen um die
Abo-Abfrage: bleibt sie stumm, entscheidet die erteilte Erlaubnis allein.
Ohne `PushManager` (Safari-Tab am iPhone) gibt es gar keinen Schalter, den man
umlegen koennte - dort bleibt die Zahl wie bisher erlaubt.

**Bekannter Kompromiss:** ohne Push (0 faellige ToDos) wird die Zahl NICHT
im Hintergrund auf 0 gesetzt - eine "stille" Push-Nachricht ohne sichtbare
Meldung ist bei iOS/Chrome nicht zuverlaessig erlaubt (beide zeigen sonst
selbst eine generische Ersatzmeldung). Die Zahl stimmt spaetestens beim
naechsten Oeffnen der App wieder.

### WhatsApp-Morgenliste

Seit 13.10.2026 geht beim ersten Pruefen des Tages zusaetzlich eine WhatsApp
mit den **Namen** der faelligen und ueberfaelligen ToDos an Hendrik. Vom
14. bis 18.10.2026 standen dort auch die **roten Google-Termine** des Tages;
die sind wieder raus (siehe unten). Der Push bleibt unveraendert (3x taeglich,
nur die Zahl, nur ToDos).

- **Gleiche Regel wie der Push:** nicht erledigt, `due` gesetzt, `due <= heute`
  (Berlin), ueber alle Listen, in denen das Konto Mitglied ist, auch geteilte.
  ToDos ohne Termin und erledigte kommen nie vor. Ueberfaellige tragen das
  Datum ("seit 10.10."), hoechstens 8 Eintraege, danach "+ N weitere". Lange
  Texte werden auf 80 Zeichen gekuerzt, Zeilenumbrueche zu Leerzeichen.
- **Rote Google-Termine: entfernt am 18.10.2026.** Hendrik wollte, dass die
  Funktion nur fuer ihn gilt und nicht in der Datenschutzerklaerung auftaucht.
  Ein ehrlicher Text haette sonst sagen muessen, dass Titel von Google-Terminen
  an CallMeBot gehen, und das gefaehrdet die Google-Verifizierung. Seitdem
  holt der Server Termine NUR noch, wenn jemand den Kalender in der App
  benutzt, nie im Hintergrund. Weg sind `roteTermineAm()`, `terminLiegtAmTag()`
  und `FARBE_ROT` aus `google.js` und die Kalender-Zeilen in `whatsapp.js` und
  `pruefen.js`. Im Git-Verlauf (Commit vor dem 18.10.2026) liegen sie noch.
- **Ausloeser:** ein faelliges ToDo. Ohne geht nichts raus.
- **Aufbau der Nachricht:** `📋 N ToDos faellig (TT.MM.)` und eine Zeile je
  ToDo. Gibt es nur ein ToDo, steht `📋 1 ToDo faellig`.
- **Nur der Morgenlauf:** `istMorgenlauf()` prueft die Berliner Stunde (< 10).
  Der Aufruf um 7 Uhr zaehlt, 12 und 17 Uhr nicht. Winterzeit ist egal, weil
  cron-job.org in Europe/Berlin plant.
- **Nur ein Konto:** `WHATSAPP_NUTZER` (E-Mail, ohne Beachtung der Gross- und
  Kleinschreibung). CallMeBot schickt ohnehin nur an EINE Nummer. Andere
  Nutzer der App merken nichts. Fehlt die Variable: Antwort
  `"whatsapp":"nicht eingerichtet"`, sonst keine Wirkung.
- **Secrets im Pages-Projekt `todo-app`:** `WHATSAPP_NUTZER`, `TELEFON`
  (`+49...`, ohne Leerzeichen), `CALLMEBOT_KEY`. Hochladen aus einer Datei mit
  `npx.cmd wrangler pages secret bulk <datei> --project-name todo-app` (aus
  einem Terminal, in dem Wrangler angemeldet ist). **Danach einen leeren
  Commit pushen**, sonst sieht die laufende Bereitstellung die Werte nicht
  (siehe Falle bei den Benachrichtigungen oben).
- **Antwort des Endpunkts** enthaelt `whatsapp`: `gesendet (N ToDos)`,
  `nichts faellig`, `uebersprungen (nicht der Morgenlauf)`,
  `nicht eingerichtet` oder `fehlgeschlagen: <Grund>`. Ein Fehler beim Senden
  stoert den Push nie, der Aufruf bleibt HTTP 200 (cron-job.org meldet ihn
  deshalb nicht als Fehlschlag, die Antwort muss man ansehen).
- **Zum Ausloesen von Hand:** `...pruefen?whatsapp=jetzt` mit dem Geheimnis
  (Header `X-Cron-Secret`) sendet auch ausserhalb des Morgenlaufs. Nuetzlich zum
  Testen und wenn der Morgenlauf ausgefallen ist.
- **CallMeBot** (`functions/_lib/whatsapp.js`): kostenlos, nur fuer
  persoenlichen Gebrauch, sendet von SEINER Nummer an die eigene. Fehler
  kommen mit Status 201 und "ERROR" im Text, deshalb prueft der Code auch den
  Inhalt. Zwei Versuche, 3 s Pause. Bei Erfolg schickt der Dienst die Nummer
  im Antworttext zurueck, die Antwort wird deshalb nie weitergereicht. Der
  Dienst hatte im Januar 2026 eine laengere Pause (Forum: simon42); faellt er
  aus, kommt die Liste nicht. Der Push bleibt dann der Rueckfall.
- **Preis:** Die ToDo-Texte gehen im Klartext ueber CallMeBot, auch die in
  geteilten Listen von anderen angelegten. Wird der Morgenlauf doppelt
  ausgeloest (etwa durch einen Wiederholungsversuch von cron-job.org), kommt die
  Nachricht doppelt; eine Sperre dagegen gibt es nicht (braeuchte eine Tabelle).
- **Getestet** am 13.10.2026 lokal mit `wrangler pages dev`, Testnutzer in der
  lokalen Datenbank und einem Fake statt CallMeBot: Auswahl (Ueberfaellige
  zuerst, geteilte Liste dabei, erledigte/zukuenftige/termin-lose/fremde nicht),
  403 ohne Geheimnis, Uebersprungen am Abend, Erzwingen, ohne Einstellung,
  CallMeBot nicht erreichbar. Dazu 21 Einzeltests der Bibliothek (Text,
  Morgenlauf-Grenzen in Sommer- und Winterzeit, Senden, Fehler, Maskierung).
  Die Tests liegen nicht im Repo, weil Dateien im Wurzelverzeichnis oeffentlich
  ausgeliefert werden.
- **Getestet am 14.10.2026 (rote Termine):** 32 Einzeltests (Tagesfilter inkl.
  Mitternacht, UTC-Zeitpunkte, beide Sommerzeit-Umstellungen; Nachrichtentext;
  Endpunkt gegen eine echte SQLite mit nachgebautem Google und CallMeBot) und
  acht Laeufe in `wrangler pages dev` gegen lokale D1 mit lokalem Fake statt
  Google: ToDos + Termine, nur Termine, nur ToDos, nichts, Google-Fehler mit und
  ohne ToDos, ohne Konto, 7-Uhr-Sperre, 403. **Ungeprueft:** ein echter Lauf
  gegen Googles Server aus der Pages-Umgebung heraus (der Abruf selbst ist
  derselbe Code wie im Kalender-Panel, der Umtausch des Zugriffs-Tokens
  ebenso). Erste echte Nachricht mit roten Terminen: Donnerstag 15.10.2026,
  7 Uhr ("Regel KA" 11:45).

### Abendlauf: offene Gewohnheiten (seit Oktober 2026)

Im Lauf ab 15 Uhr Berliner Zeit (praktisch der 17-Uhr-Anpinger) nennt die
Push-Meldung zusaetzlich die heute noch offenen Gewohnheiten - "2 ToDos sind
fällig oder überfällig, 1 Gewohnheit ist heute noch offen." Wer nur offene
Gewohnheiten hat, bekommt die Meldung trotzdem. Rechnung in
`functions/_lib/erinnerung.js` (`istAbendlauf`, `offeneGewohnheitenJeNutzer`,
`erinnerungsText`), "offen" wie im Streifen ueber `nochOffen()` aus
`_lib/heute.js`: eine Obergrenze ohne Eintrag ruht und zaehlt nicht mit.

- **Die Badge-Zahl bleibt die der ToDos** (Hendriks Entscheidung, gefragt).
  Kommt die Meldung nur wegen Gewohnheiten, steht `badge: 0` im Payload - der
  Service Worker setzt das Icon damit auf null, was zu "keine ToDos faellig"
  passt.
- **Nicht morgens und mittags:** um 7 Uhr waeren alle Gewohnheiten offen, das
  waere Rauschen. Die verworfene Alternative war "in jedem Lauf und im Badge".
- Vorher hatte die eigene Fokus-App einen zweiten Push-Weg (Tabelle
  `fokus_push_subscriptions`, eigener cron-job auf fokus.it-wolf.org). Null
  Abos am 17.10.2026 - er faellt mit der Fokus-App weg, die Tabelle bleibt
  ungenutzt stehen.
- **Zum Testen:** `?abend=jetzt` erzwingt den Abendteil, `?trocken=1` rechnet
  nur und schickt nichts (weder Push noch WhatsApp); die Antwort enthaelt dann
  `vorschau` mit Text und Badge je Nutzer. Beides braucht das Geheimnis.
- **Getestet am 17.10.2026** lokal: Trockenlauf mit Test-Abo (ToDos +
  Gewohnheiten in einer Zeile, Badge = ToDos), 403 ohne Geheimnis, Grenze 7/12
  Uhr nein, 17 Uhr ja (auch Sommerzeit). **Ungeprueft:** die echte Zustellung -
  die zeigt erst der 17-Uhr-Lauf live.

## Offline

Die App funktioniert auch ohne Internet — vorausgesetzt, sie wurde auf dem
Gerät mindestens einmal online geöffnet. Zwei getrennte Mechanismen:

**App-Shell** (`sw.js`, Service Worker): cached `index.html`, `style.css`,
`app.js`, `manifest.json` und die beiden Icons — nicht `/api/*`. Strategie
network-first mit Cache-Fallback (nicht cache-first), damit ein Push auf
`main` sofort bei jedem Online-Aufruf ankommt und nur der Offline-Fall die
alte Version zeigt. **Wichtig:** Bei jeder Änderung an einer der gecachten
Dateien die Konstante `CACHE_NAME` in `sw.js` hochzählen — sonst räumt
`activate()` den alten Cache nicht auf und wiederkehrende Nutzer bleiben auf
dem alten Stand hängen, ohne dass das irgendwo auffällt.

**Daten** (`app.js`, kein Backend-Zugriff nötig): `localStorage` spiegelt
unter dem Schlüssel `todoCache` die letzte erfolgreiche Antwort von
`GET /api/todos` (siehe `speichereCacheLokal()`/`ladeCacheLokal()`). Schlägt
ein Request fehl (`loadState()`/`save()`), wird daraus statt aus einem
geleerten Board wiederhergestellt. Änderungen, die offline nicht gespeichert
werden konnten, landen zusätzlich unter `todoPending` — verschachtelt pro
Konto (`eigeneEmail`), damit auf einem gemeinsam genutzten Gerät ein
Kontowechsel nicht fremde, noch nicht hochgeladene Änderungen verwirft.
`save(boardId)` ist die einzige Stelle, die diese Pending-Liste pflegt (auch
beim automatischen Nachreichen über `versucheAusstehendeZuSynchronisieren()`
nach einem `online`-Event, `visibilitychange` oder App-Start) — bewusst
keine zweite, parallele Implementierung.

~~**Bekannter Kompromiss:** „letzter Speichervorgang gewinnt"~~ — seit
19.10.2026 behoben, siehe „Mehrere Geräte" direkt unten. Ein Pending-Eintrag
trägt seitdem auch Basis, Stand und Unterpunkte mit (vorher fehlten die
Unterpunkte, und das Nachreichen löschte alle Unterpunkte der Liste).

Eine neue Liste anlegen, umbenennen, löschen, teilen oder Mitglieder
verwalten bleibt bewusst online-only (eigene, sofortige Requests ohne
lokalen Fallback) — der Server vergibt dabei IDs und prüft Limits, das lässt
sich nicht sinnvoll offline vorwegnehmen.

## Mehrere Geräte (seit 19.10.2026)

**Der Fehler, der es auslöste:** Die ToDos kamen nur beim Start vom Server,
und `PUT /api/todos` ersetzt den kompletten Inhalt einer Liste. Ein PC-Tab,
der seit dem Morgen offen stand, kannte nichts, was das Handy seitdem
angelegt hatte — und löschte es beim nächsten Abhaken still vom Server. In
der Analyse vom 19.10.2026 mit zwei Tabs nachgestellt.

**Zwei Teile, der zweite ist das eigentliche Netz:**

1. **Nachladen beim Zurückkommen** (`ladeFrischNach()` in `app.js`): bei
   `visibilitychange` (Tab, Handy-App wieder vorne) und `focus` (PC, Tab war
   sichtbar, nur ein anderes Programm vorne) holt die App `GET /api/todos`
   neu. Hendriks Wahl: kein Takt im Hintergrund. Nie mitten im Tippen
   (`tipptGerade()` — `render()` würde das offene Feld neu bauen), dann
   neuer Versuch nach 4 s. Hat sich während der Abfrage hier etwas geändert
   (Zähler `aenderungen`, zählt jeden `save()`-Aufruf), wird die Antwort
   verworfen. Ohne Neuigkeiten kein Neuzeichnen.
2. **Stand-Abgleich beim Speichern:** `boards.stand` (Migration
   `migration-stand.sql`) zählt jedes `PUT` hoch. `GET` liefert ihn je Liste
   (`listen[].stand`), `save()` schickt ihn mit. Passt er nicht mehr, kommt
   **409 mit dem aktuellen Inhalt** zurück (gleiche Form wie `GET`, über
   dieselben `…Aus()`-Funktionen in `todos.js`). Die App mischt dreiseitig
   (`mischeDreiWege()`): Basis = letzter gemeinsamer Stand (`basis[listeId]`,
   gesetzt bei `GET` und nach jedem erfolgreichen `PUT`), dazu hier und dort.
   Feld für Feld: was nur eine Seite geändert hat, gilt; ändern beide
   dasselbe Feld, gewinnt dieses Gerät (Hendriks Wahl). Gelöscht bleibt
   gelöscht, außer die andere Seite hat den Eintrag geändert. Bis zu drei
   Versuche, danach wie offline (Pending). Hat das Mischen sichtbar etwas
   gebracht: Snackbar „Änderungen von einem anderen Gerät übernommen."

**Fallen beim Mischen:**

- `undefined` und `null` gelten als gleich (`gleicherWert()`). Lokal
  angelegte ToDos haben z. B. `order: undefined`, der Server liefert `null` —
  ohne die Gleichsetzung sähe jedes frische ToDo „geändert" aus und überstimmte
  die andere Seite.
- `ersetzeInhalt()` tauscht die Felder im bestehenden Objekt, statt
  `daten[id]` neu zuzuweisen — `state` zeigt bei der aktiven Liste auf genau
  dieses Objekt.
- Haben beide Geräte dasselbe wiederkehrende ToDo abgehakt, legte jedes einen
  Nachfolger an. Von den beim Mischen NEU entstandenen gleichen Nachfolgern
  (Bereich, Titel, Rhythmus, Termin) bleibt einer; schon vorher doppelt
  Gespeichertes fasst das Mischen nicht an.

**Grenzen, bewusst:** Ohne mitgeschickten Stand (alte App aus dem Cache,
Pending-Einträge von vor dem 19.10.2026, frisch angelegte Liste vor dem
ersten Speichern) prüft der Server nicht — altes Verhalten. Zwischen dem
Lesen des Stands und dem Schreiben im `PUT` liegt ein Fenster von
Millisekunden. Neuer Tag um Mitternacht kommt weiter erst beim nächsten
Zurückkommen.

**Nebenfund, gleich behoben:** `save()` merkte sich einen Speicherwunsch
während eines laufenden Speicherns nur als Ja/Nein und speicherte danach die
AKTIVE Liste. Wer in der Heute-Spalte ein ToDo einer anderen Liste abhakte,
während gespeichert wurde, verlor dessen Speichern. Jetzt eine Menge
(`nachzuholen`) mit der richtigen Liste.

## Warteliste und Verwaltung

Auf dem Anmeldebildschirm führt „Noch keinen Zugang? Eintragen" zu einem
Formular (Name + Adresse) → `/api/waitlist`. Der Eintrag landet in der Tabelle
`waitlist`; der Eintragende bekommt eine Bestätigung, die Verwaltung eine
Benachrichtigung.

Unter **[/admin](https://todo.it-wolf.org/admin)** stehen offene Anfragen und
die Nutzerliste. Freischalten legt das Konto an und verschickt eine
Willkommensmail; Ablehnen setzt nur den Status — bewusst ohne Mail.

**Eine Zugangsspalte: `users.todo_zugang`.** Sie gilt für die ganze App,
seit Oktober 2026 also auch für Gewohnheiten und Timer. Freischalten setzt sie
immer (`admin/waitlist.js`, `admin/genehmigen.js`).

Bis zur Fusion gab es daneben `users.fokus_zugang` für die eigene Fokus-App,
beide Apps schrieben in dieselbe `waitlist`, und `waitlist.quelle` entschied,
welche Spalte das Freischalten setzte; dazu kamen Selbstbedienungs-Knöpfe in
beiden Apps und ein Fokus-Schalter in der Nutzerliste. Das ist alles raus.
**Beide Spalten stehen weiter in der Datenbank** (nie DROP) — `fokus_zugang`
liest nur niemand mehr, `quelle` ist für neue Einträge immer `'todo'`.

**Selbstbedienung bleibt für den ToDo-Zugang:** Ein Konto ohne `todo_zugang`
(etwa ein reines Dashboard-Konto) holt ihn sich mit dem nächsten
Login-Versuch still zurück — `request-code.js` und `link.js` setzen die Spalte,
bevor sie den Code verschicken bzw. die Sitzung anlegen. In der Nutzerliste
lässt sich `todo_zugang` jederzeit umlegen; beim eigenen Konto ist der
Schalter gesperrt (kein hartes Aussperr-Risiko — `/admin` hängt an `role`, nicht
an `todo_zugang` —, aber eine unnötig verwirrende Zwischenlage).

**Kein „ToDo-Zugang aufgeben“ mehr für Nutzer** (seit 18.10.2026, Hendriks
Wunsch): In den Einstellungen gibt es nur noch Abmelden und Konto löschen.
Der Knopf samt `/api/auth/zugang-aufgeben` ist raus — er stammte aus der Zeit
mit getrennter Fokus-App, in der man eine der beiden Apps aufgeben konnte,
ohne das Konto zu löschen.

**Die Willkommensmail meldet direkt an.** Sie enthält einen Anmeldelink, der
sieben Tage gilt (`functions/_lib/willkommen.js`). Er liegt als normaler
Eintrag in `login_codes` und wird vom selben `/api/auth/link` eingelöst,
gebaut mit dem Origin dieser Anfrage. Sieben Tage statt zehn Minuten, weil so eine Mail auch mal
ein Wochenende liegen bleibt; wer Zugriff aufs Postfach hat, könnte sich
ohnehin jederzeit selbst einen Anmeldelink schicken lassen.

**Freischalten direkt aus der Mail:** Die Benachrichtigung enthält einen
Einmal-Link (7 Tage gültig) auf `/freischalten`. Das bloße Öffnen tut nichts —
erst der Klick auf den Knopf schaltet frei. Grund: Mailprogramme und
Sicherheitsscanner öffnen Links teilweise von sich aus.

`admin.html` ist eine statische Datei, die jeder laden kann. Die Sperre sitzt
in `/api/admin/*`: ohne Adminrechte antwortet der Endpunkt mit **404** (nicht
403 — wer keine Rechte hat, muss nicht erfahren, dass es hier etwas gibt).
Die Rolle wird bei jeder Anfrage frisch aus der Datenbank gelesen, nicht aus
dem Cookie — sonst behielte jemand entzogene Adminrechte, bis er sich von
selbst abmeldet, und das kann bei nie ablaufenden Sitzungen nie passieren.

**Adminrechte** vergibt man im Dashboard in der Nutzerliste („Zum Admin
machen"). Man kann sie sich nicht selbst entziehen — sonst sperrt sich der
einzige Admin aus. Der Zugang zum Dashboard sitzt in den Einstellungen (⚙️):
der Abschnitt „Verwaltung" mit dem Link auf `/admin` erscheint dort nur für
Admins (Rolle kommt frisch von `/api/todos` als `admin`-Flag, reine Optik —
`/api/admin/*` prüft selbst nochmal). Bei Nicht-Admins bleibt der Abschnitt
per `hidden` ausgeblendet.

Ein Nutzer lässt sich auch direkt anlegen, ohne Warteliste:

```sql
INSERT INTO users (email, name, role, todo_zugang)
VALUES ('adresse@example.com', 'Name', 'user', 1);
```

## Bot-Schutz

Das öffentliche Wartelisten-Formular ist durch **Cloudflare Turnstile**
geschützt (Widget „todo.it-wolf.org Warteliste", Sitekey steht offen in
`app.js`, der geheime Schlüssel als `TURNSTILE_SECRET`).

Es läuft **unsichtbar** (`appearance: "interaction-only"`): kein Kästchen, kein
reservierter Platz. Das Widget zeigt sich nur, wenn Turnstile jemanden
wirklich prüfen will. Bewusst nicht der Widget-Modus „Invisible" im Dashboard —
so kann im Zweifel immer noch nachgefragt werden, statt still zu scheitern.

Zwei Fallstricke:

- **Ein fehlendes iframe ist der Normalfall, kein Fehler.** Unauffällige
  Besucher werden stillschweigend durchgewinkt; nur das Token im versteckten
  Feld zählt. Auf ein iframe zu prüfen führt in die Irre.
- **Ohne gesetztes Secret wird nicht geprüft.** Das hält die lokale
  Entwicklung am Laufen, heißt in der Produktion aber: Variable vergessen =
  Formular ungeschützt, obwohl alles normal aussieht.

Der Sitekey erlaubt nur `todo.it-wolf.org`; lokal kommt deshalb nie ein Token
zustande. Zusätzlich zur Bot-Prüfung gilt höchstens ein Eintrag pro Minute
über alle Adressen.

Bis Oktober 2026 gab es eine zweite Warteliste in der Fokus-App, ohne
Turnstile. Mit der Fusion ist sie weg — eintragen geht nur noch hier.

## Konten löschen

Nutzer löschen ihr eigenes Konto in der App unter Einstellungen → Konto →
„Konto löschen" (roter Knopf rechts neben Abmelden); zur Bestätigung muss die
eigene Adresse abgetippt werden. **Admins sehen den Knopf nicht** (seit
18.10.2026): der einzige Admin darf sich ohnehin nicht löschen, und ein
weiterer Admin wird erst im Dashboard herabgestuft.
Admins löschen fremde Konten im Dashboard. Beide Wege verschicken eine
Benachrichtigung an die betroffene Adresse.

Gelöscht werden Nutzer, seine **eigenen Listen** (mit Bereichen, ToDos und den
fremden Zugriffen darauf), seine **Mitgliedschaften** in fremden Listen (die
Listen selbst bleiben), Sitzungen, offene Codes **und der Wartelisten-Eintrag**
— letzterer, damit die Person sich neu bewerben kann; sonst hinge sie zwischen
„kein Konto" und „steht schon auf der Liste" fest. Alles in einer Transaktion,
Kindtabellen ausdrücklich zuerst (nicht auf `ON DELETE CASCADE` verlassen, das
hängt an `PRAGMA foreign_keys`).

Eine einzelne **Liste** löscht der Ersteller getrennt davon in den
Einstellungen (`/api/listen/loeschen`) — das lässt das Konto unberührt.

**Der letzte Admin lässt sich nicht löschen** und sich auch selbst nicht
degradieren — sonst käme niemand mehr an die Verwaltung. Diese Sperre im
Server bleibt, auch wenn die App den Knopf für Admins gar nicht erst zeigt.

## Barrierefreiheit

**Kontrast (nur helles Design).** `--orange` und `--muted` in `style.css`
lagen unter der WCAG-AA-Grenze von 4,5:1 (2,89:1 bzw. 3,46:1 auf weißem
Karten-Hintergrund `--row`) — ausgerechnet die Farbe für „heute fällig".
Beide jetzt dunkler (`--orange: #a85d0a`, `--muted: #6b7386`), beide über
4,5:1. Dunkles Design war schon vorher in Ordnung (6,45:1 / 4,67:1) und
blieb unangetastet.

**Touch-Ziele.** Häkchen (`.check`) und Löschen-Symbol (`.act.del`) sind
optisch fast unverändert (das Löschen-Symbol wuchs von 28px auf 34px
sichtbar mit, die Checkbox nicht), bekommen aber ein größeres,
unsichtbares Tippfeld drumherum (WCAG 2.2 verlangt mindestens 24px,
Apple/Google empfehlen ~44px — die kompakte Zeile lässt nur ~32px zu, ohne
Nachbarzeilen zu überlappen). Die Checkbox steckt dafür in einem
`<label class="check-tap">` — bei einer echten Checkbox der einzige Weg,
die Klickfläche ganz ohne JavaScript unsichtbar zu vergrößern.

**Schalter-Beschriftung.** Der `.switch`-Baustein (Darstellung,
Benachrichtigungen in den Einstellungen, Admin/ToDo/Fokus in der
Verwaltung) zeigte die Beschriftung bisher NACH dem Schalter
(`[Schalter] Wort`), jetzt davor (`Wort [Schalter]`) — der Schalter
schließt die Zeile als Bedienelement ab, üblichere Lesereihenfolge.
Wichtig bei künftigen Änderungen an diesem Baustein: `.switch
input:checked ~ .switch-track` braucht den Geschwister-Kombinator `~`
statt `+`, weil die Beschriftung jetzt zwischen `input` und
`.switch-track` sitzt (kein unmittelbarer Nachbar mehr).

**Verwaltung: Rechte-Gruppe.** Die drei Rechte-Schalter (Admin/ToDo/Fokus)
je Nutzer stecken jetzt in einer eigenen, leicht abgesetzten Box
(`.admin-rechte`) statt lose zwischen Name und Löschen-Knopf zu stehen —
reine Wahrnehmungshilfe, keine Funktionsänderung. Der Löschen-Knopf
erscheint beim eigenen Konto jetzt ebenfalls, aber deaktiviert
(`.btn.gefahr:disabled`) statt ganz zu fehlen — gleiches Muster wie bei
den Schaltern selbst, die dort ebenfalls nur den Stand zeigen.

## Kartenlayout

Häkchen und Mülleimer-Symbol richten sich an Titel (+ Termin, falls
gesetzt) aus (`align-items: flex-start` an `.todo`, feste statt
prozentualer Versätze an `.check-tap`/`.actions`, je eigener Wert für
undatiert/datiert/erledigt über `.todo.dated`/`.todo.urgent`/`.todo.is-done`)
— vorher zentrierten sie sich an der GESAMTEN Karte inklusive Notiz und
Checkliste und rutschten bei langem Inhalt weit nach unten. Die genauen
Pixelwerte sind empirisch abgeglichen (`getBoundingClientRect()` in der
Browser-Konsole), nicht aus der Typografie hergeleitet — bei künftigen
Schriftgrößen-Änderungen an `.todo-text`/`.due` lohnt ein erneuter Abgleich.

## Ziehen und Ablegen

**Aus dem Bereich lösen** geht auf zwei Wegen: neben den Spalten loslassen,
oder auf die Ablage, die während eines Zuges über dem Board erscheint. Beides
landet in „Ohne Bereich" der aktiven Liste (`loeseAusBereich()`). Vorher führte
der Weg hinein per Drag, heraus aber nur über das Dropdown im
Bearbeiten-Dialog. Der Aufhänger für „neben den Spalten" ist die ganze
`.app`-Fläche, nicht nur das Board — unter der kürzesten Spalte bliebe sonst
kaum etwas zu treffen. Die Ablage erscheint nur, wenn das gezogene ToDo
überhaupt in einem Bereich liegt.

**Ziehen mit dem Finger** (`fingerZug` in `app.js`) ist komplett nachgebaut:
Das native Drag & Drop des Browsers gibt es auf Touch nicht, dort löste ein
Wisch über eine Karte nur eine Textmarkierung aus. Ablauf: langes Drücken
(`LANGES_DRUECKEN`, 400 ms) startet den Zug, ein geklonter „Geist" hängt am
Finger, das Ziel sucht `elementFromPoint()`.

Drei Dinge, ohne die es nicht funktioniert:

- **`WACKEL` (10 px):** Jede Bewegung VOR Ablauf des Timers gilt als Scrollen
  und bricht ab — sonst ließe sich die Liste nicht mehr scrollen, ohne
  versehentlich etwas zu verschieben.
- **`pointer-events: none` auf dem Geist:** Sonst fände `elementFromPoint`
  unter dem Finger immer nur den Geist selbst und nie das Ziel darunter.
- **`preventDefault()` im touchmove** (Listener muss `passive: false` sein) und
  `user-select: none` am Body: hält das Board still und verhindert die
  Textmarkierung.

Beim Loslassen bekommt auch `touchend` ein `preventDefault()` — sonst würde der
Browser daraus einen Klick auf die Karte machen und das ToDo abhaken.

**Kollision mit der Kalender-Geste:** Beides horcht auf `touchmove`. Hat der
Wisch vom rechten Rand schon übernommen (`geste` in `kalender.js`), bricht
`starteFingerZug()` ab. Umgekehrt bleibt die Kalender-Geste erlaubt, solange
der Langdruck noch wartet — `darfGeste()` prüft `draggedId`, und das steht erst,
wenn der Zug wirklich läuft.

Maus-Drop und Finger-Drop teilen sich `verschiebeToDo()`; vorher steckte diese
Logik nur im `dragover`/`drop`-Paar und war für Touch nicht erreichbar.

## Anlegen: der Knopf sagt nur laut, was Enter schon tut

Das Anlege-Feld der Spalte (`baueAddWidget()`) hat seit 13.08.2026 einen
sichtbaren **„Anlegen"**-Knopf (`.add-ok`). Gebraucht wird er nicht — Enter im
Textfeld und ein Klick aus dem Feld heraus (`commitAddFromDOM()`) legen weiter
an. Aber ohne ihn stand da ein Formular ohne erkennbaren Abschluss, und man
musste raten; besonders am Handy, wo die Tastatur die Zeile ohnehin verdeckt.
Die Anlegezeile im Kalender (`baueAnlegeZeile()`) hatte ihren Knopf schon.

Der Knopf liegt INNERHALB von `.col-add.open` — sonst zählte sein eigener Klick
als „Klick daneben" (`widget.contains(e.target)` in der Verdrahtung ganz unten
in `app.js`) und das Feld schlösse sich, bevor der Handler feuert.

## Tippflächen am Handy

Alle Schließen-Kreuze (`.kal-schliessen`, `.ein-schliessen`) bekommen unter
`@media (pointer: coarse)` eine **44-px-Tippfläche als `::after`**, nicht als
eigene Knopfgröße. Grund: sie sitzen in Zeilen mit anderen Knöpfen
(Kalenderkopf: ‹ › Heute ⤢ ✕), und ein 44 px hoher Knopf zöge die ganze Zeile
mit — im Kalender ginge das direkt vom Raster ab. So ändert sich am Layout und
am Aussehen nichts, nur der Finger trifft. Die Fläche ist **rechtsbündig**
ausgerichtet (`right: -6px`), weil rechts vom ✕ immer der Kastenrand liegt —
dorthin darf sie wachsen, ohne dem linken Nachbarn ins Gehege zu kommen.

Gegenprobe beim Testen: `document.elementFromPoint()` zehn Pixel über und unter
der Knopfmitte muss `.kal-schliessen` treffen, obwohl der Knopf nur 28×23 px
groß ist. (`#kalZu` ist am Handy ohnehin `display: none` — dort schaltet die
Pille. Die Regel greift für ihn nur am Rechner mit Touchscreen.)

## Notizfeld

Wächst mit dem Inhalt nach unten statt zu scrollen — im Anlege-Feld wie im
Bearbeiten-Dialog (`passeNotizHoeheAn()` in `app.js`). Drei Fallen stecken in
den paar Zeilen:

- **Erst `height:auto`, dann messen.** Ohne das kennt `scrollHeight` nur die
  bisherige, größere Höhe, und das Feld schrumpft beim Löschen nie wieder.
- **Rahmen dazurechnen.** `scrollHeight` zählt Inhalt + Innenabstand, aber
  nicht den Rahmen; bei `box-sizing: border-box` (gilt global) frisst der
  Rahmen sonst zwei Pixel vom Inhalt und die letzte Zeile bleibt angeschnitten.
- **Erst messen, wenn das Feld im Dokument hängt.** Die erste Messung läuft
  deshalb am ENDE von `render()` (`passeAlleNotizfelderAn()`), nicht beim
  Aufbau der Zeile — dort ist `scrollHeight` schlicht 0 und das Feld bliebe
  einzeilig.

Gedeckelt auf 45 % der Fensterhöhe, ab da scrollt es doch; sonst schöbe eine
sehr lange Notiz die Knopfzeile aus dem Bild. Der Deckel wird bei `resize` neu
gerechnet, sonst stimmt er nach dem Drehen des Handys nicht mehr. `resize` ist
im CSS auf `none`: ein von Hand gezogenes Feld würde beim nächsten Tastendruck
ohnehin überschrieben.

**Doppelklick öffnet die Bearbeitung ohne Fokus und ohne Markierung.** Früher
sprang der Cursor in den Titel und markierte ihn komplett — auf dem Handy ging
dabei die Tastatur auf und verdeckte die Notiz, die man eigentlich lesen
wollte, und ein Fehlgriff hätte den ganzen Titel überschrieben. Jetzt steht
alles nur da; wer tippen will, tippt das Feld an. `startEdit()` räumt zusätzlich
die Textauswahl weg, die der Doppelklick selbst erzeugt hat.

## Wiederkehrende ToDos

Ein ToDo mit `wiederholung` (`taeglich`/`woechentlich`/`monatlich`/`jaehrlich`,
sonst NULL) erzeugt beim Abhaken sofort seinen Nachfolger — keine eigene
„Serie" im Datenmodell, jede Ausgabe ist eine ganz normale, eigenständige
Zeile in `todos`. Löschen, Bearbeiten vor dem Abhaken, Drag & Drop: alles
funktioniert wie bei jedem anderen ToDo, weil es technisch keins ist.

**Nächster Termin.** Fester Rhythmus ab dem URSPRÜNGLICHEN Fälligkeitsdatum
(nicht ab dem Tag des Abhakens) — `folgeTermin()` in `app.js`. Zwei
Feinheiten: Bei Monat/Jahr wird auf den letzten Tag des Zielmonats geklemmt,
falls der ursprüngliche Tag dort nicht existiert (31. Januar → 28./29.
Februar, nicht in den März „übergelaufen"); liegt der berechnete Termin
trotz Klemmung noch in der Vergangenheit (spät abgehakt), rechnet die
Funktion so oft weiter, bis der neue Termin wirklich ansteht — sonst wäre
der frisch erzeugte Nachfolger sofort wieder überfällig.

**Nur über den Bearbeiten-Dialog setzbar**, nicht im Schnell-Anlegen-Feld —
gleiche Beschränkung wie bei Bereich/Thema-Zuordnung, die auch nur dort
geht. Braucht zwingend einen Termin (ohne Termin ergibt eine Wiederholung
keinen Sinn) — das Auswahlfeld bleibt unsichtbar, bis einer gesetzt ist.
Im Dialog steckt die Auswahl seit der Kompakt-Zeile hinter einem
🔁-Knopf statt einem immer sichtbaren `<select>` — Klick ruft
`openDatePicker()` auf dem (unsichtbar überlagerten) `<select>` auf,
genau wie beim 📅-Knopf für den Termin selbst; der Knopftext zeigt das
gewählte Muster kompakt an (`updateWiederholungButton()`).

**Bereich (📂) und Über-Thema (🏷️) folgen seit 13.08.2026 demselben Muster**
(`verdrahteWahlSymbol()` in `app.js`). Vorher standen beide als breite
`<select>` über der Knopfreihe und nahmen dort je eine ganze Zeile ein; jetzt
sind es zwei weitere Symbole in der Reihe. Ist etwas gewählt, steht der Name
neben dem Symbol — auf 18 Zeichen gekürzt, denn Namen sind frei wählbar und
schöben die Reihe sonst auseinander (der volle Name steht im `title`).

📂 gibt es nur bei ToDos ohne Bereich, 🏷️ nur, wenn der Bereich Themen hat —
`verdrahteWahlSymbol()` steigt still aus, wenn der Knopf fehlt.

**Dabei musste `.edit-thema` aus der CSS weichen.** Die Regel gab dem Feld ein
eigenes Aussehen (volle Breite, Rahmen) und stand SPÄTER in der Datei als
`.date-field select`, bei gleicher Spezifität — das `<select>` wäre also
sichtbar geblieben und hätte den neuen Knopf verdrängt. Dieselbe Familie von
Fallen wie an mehreren anderen Stellen in dieser Datei.

**Sichtbarkeit.** Die neu erzeugte Ausgabe erscheint nicht sofort nach dem
Abhaken, sondern erst ab ihrem eigenen Fälligkeitstag
(`nochNichtFaellig()` in `app.js`, gefiltert in `renderColumn()` und
`synchronisiereOhneBereich()`) — sonst stünde direkt danach eine optisch
fast identische Zeile mit nur einem anderen Datum da. Gilt NUR für
wiederkehrende ToDos: ein normales ToDo mit Zukunftstermin bleibt wie
gewohnt sofort sichtbar (samt „Morgen"-Anzeige und roter Dringlichkeit ab
morgen) — sonst wäre auch die Vorschau auf morgen fällige, nicht
wiederkehrende ToDos weg.

**Wieder aufgehakt (seit 19.10.2026).** Vorher blieb der Nachfolger beim
Wiederöffnen stehen, und das nächste Abhaken legte einen zweiten an — bis
zum Fälligkeitstag unsichtbar, dann doppelt. Jetzt (Hendriks Wahl): beim
Öffnen wird der Nachfolger zurückgenommen, wenn er unverändert ist
(`folgeUnveraendert()`: Termin = `folgeTermin()`, Notiz, Thema, Checkliste
gleich und nichts abgehakt). Hat man ihn schon bearbeitet, bleibt er, und
beim erneuten Abhaken entsteht kein zweiter (`naechsteAusgabe()`: offenes
ToDo derselben Serie — Bereich, Titel, Rhythmus — mit späterem Termin). Eine
Verknüpfung im Datenmodell gibt es weiter nicht, daher dieser Abgleich.

## Unterpunkte

Eine Checkliste INNERHALB eines ToDos, eigene Tabelle `unterpunkte`
(`todo_id` → `todos.id`, echter Fremdschlüssel mit CASCADE — anders als
`todos.thema_id`, das bewusst ohne Fremdschlüssel auskommt, weil ein ToDo
ein verschwundenes Thema überleben soll; ein Unterpunkt ohne sein ToDo
ergibt dagegen keinen Sinn). Verwalten (anlegen/löschen) nur im
Bearbeiten-Dialog, Abhaken zusätzlich direkt auf der Karte — blendet sich
dort aus, sobald das ToDo selbst erledigt ist, wie die Notiz auch. Kein
Umbenennen — Tippfehler heißt löschen und neu anlegen.

**Automatik.** Letzter offener Punkt abgehakt → das ToDo wird automatisch
erledigt; ein Punkt an einem erledigten ToDo wieder geöffnet → das ToDo wird
automatisch wieder offen (`toggleUnterpunkt()` in `app.js`, ruft dafür
`toggleDone()` auf — nicht `t.done` direkt setzen, sonst würde z. B. eine
Wiederholung beim Automatik-Abhaken nicht auslösen). Umgekehrt: das
Haupt-Häkchen manuell gesetzt zieht alle Unterpunkte mit, manuell entfernt
lässt sie unangetastet — sonst würde die Automatik ein gerade wieder
geöffnetes ToDo sofort erneut schließen, falls zufällig noch alle Punkte
angehakt sind.

**Wiederholung + Unterpunkte.** Ein wiederkehrendes ToDo mit Checkliste
kopiert seine Unterpunkte beim Abhaken auf die neue Ausgabe, aber frisch
unangehakt — sonst müsste man z. B. eine wiederkehrende Einkaufsliste jedes
Mal neu eintippen.

**Eingabefeld hinter dem ✓-Knopf.** Im Bearbeiten-Dialog steckt nur das
Eingabefeld für einen NEUEN Punkt hinter einem kompakten ✓-Knopf in der
Kompakt-Zeile (`unterpunktEingabeOffen` merkt sich, für welches ToDo es
gerade eingeblendet ist) — die bestehenden Punkte bleiben unverändert
direkt darunter sichtbar und abhakbar. Enter im Feld ruft nicht direkt
`addUnterpunkt()` auf, sondern `blur()`: der Re-Render aus `addUnterpunkt()`
nimmt sonst das alte (dann verwaiste) Feld aus dem DOM, was selbst ein
`blur` auslöst und den Punkt ein zweites Mal anlegen würde. Über genau
diesen `blur()`-Weg übernimmt auch ein Klick irgendwo anders hin den
offenen Eintrag, nicht nur Enter. Randfall: Klick auf „Abbrechen" bei noch
unbestätigtem Text committet den Punkt zuerst (der `blur` kommt vor dem
Klick) — das dabei neu gerenderte „Abbrechen" verpasst dadurch gelegentlich
den ersten Klick, ein zweiter schließt dann wie erwartet. Kein
Datenverlust, nur ein zusätzlicher Klick in diesem seltenen Zusammenspiel.

**Bekannter Fehler (nicht behoben, seit Unterpunkte-Einführung):** Jede
Aktion an einem Unterpunkt (`toggleUnterpunkt()`, `addUnterpunkt()`,
`deleteUnterpunkt()`) rendert den kompletten Bearbeiten-Dialog neu und
setzt dabei Titel- und Notizfeld auf den zuletzt GESPEICHERTEN Stand
zurück (`t.text`/`t.note`), nicht auf einen gerade ungespeichert
eingetippten. Wer mitten im Umbenennen zusätzlich einen bestehenden
Unterpunkt abhakt, verliert dadurch den ungespeicherten Titel-Text
kommentarlos — live nachgestellt am 10.08.2026. Betrifft nur das
Zusammenspiel Titel/Notiz-Bearbeitung mit Unterpunkt-Aktionen am selben
ToDo, nicht die übrigen Felder. Ein Fix bräuchte entweder ein Zwischenspeichern
der Feldwerte vor jedem Unterpunkt-bedingten Re-Render oder ein gezieltes
DOM-Update statt des vollen `render()` — beides über den Rahmen dieser
Änderungsrunde hinaus.

## Kalender

Rechte Hälfte des Bildschirms (`kalender.js`, Markup in `index.html`,
CSS-Block „Kalender" in `style.css`): Tagesliste oben, Monatsraster darunter.
**Seit 09.10.2026 gilt ein anderer Aufbau:** ab 1380 px eine eigene
Heute-Spalte neben dem Raster, darunter die Tagesansicht über den ToDos; das
Raster hat überall die volle Höhe. Den gestapelten Streifen (Tagesliste über
dem Raster), den Teilungs-Griff und das Kalender-Vollbild gibt es nicht mehr,
siehe „Board | Heute | Kalender“ weiter unten. Was in den älteren Absätzen
darüber steht, ist Geschichte.
Zeigt alle OFFENEN ToDos mit Termin aus ALLEN geladenen Listen — eigene wie
geteilte —, also bewusst mehr als das Board, das immer nur eine Liste zeigt.
Erledigte bleiben draußen, ToDos ohne Termin tauchen gar nicht auf.

**Zwei Modi, entschieden allein an der Fensterbreite** (`SPLIT_AB` = 1000 px
in `kalender.js`, dazu `--kal-breite` und `html.kal-split` in `style.css` —
die beiden Zahlen gehören zusammen):

* **Split** (breites Fenster): der Kalender steht fest neben der Liste. Das
  Panel bleibt technisch `position: fixed` — so gelten seine volle Höhe und
  alle inneren Flex-Regeln unverändert weiter; Platz macht ihm stattdessen der
  `body` per `padding-right`. Kein Abdunkeln, keine Scroll-Sperre, kein
  Wisch-Zuziehen: die Liste daneben bleibt vollständig bedienbar.
* **Umschalt-Modus** (Handy, schmales Fenster): der Kalender ist eine eigene
  Ansicht. Board und Kalender lösen einander ab, statt sich zu überlagern —
  `html.kal-ansicht` blendet dazu `.app` aus.

**Der Umschalt-Modus war bis zum 20.08.2026 ein Overlay** mit abgedunkeltem
`.kal-hintergrund` und `overflow: hidden` am `html`. Beides ist ersatzlos
entfallen, samt dem Element und seinen Verweisen in `kalender.js`: Wenn das
Board ausgeblendet ist, liegt dahinter nichts mehr, was mitscrollen oder
abgedunkelt werden müsste. Ausblenden statt Überlagern ist der ganze
Unterschied zwischen „Ansicht" und „Panel" — daran hängen alle drei Effekte.

**Die Scrollposition der Liste wird von Hand gemerkt** (`listeScroll`,
gesetzt und zurückgegeben in `setzePanel()`). `display: none` wirft sie weg,
und ohne das landete man nach jedem Blick in den Kalender wieder ganz oben.
Gemerkt wird nur beim WECHSEL — ein zweiter Aufruf von `setzePanel()` im
selben Zustand (etwa aus dem `resize`-Wächter) darf den Wert sonst mit einer
Position überschreiben, die gar nicht die der Liste ist.

**Animiert wird nur noch im Split** (`!sofort && split`). Das Hereinfahren im
Umschalt-Modus ruckelte, weil parallel der `body` sein `padding-right`
änderte — ein Layout-Umbruch, der nicht flüssig animieren kann. Als eigene
Ansicht steht der Kalender einfach da; es gibt nichts hereinzufahren.

**Der Zurück-Knopf führt zur Liste, nicht aus der App.** Beim Wechsel in die
Kalenderansicht legt `setzePanel()` einen Verlaufseintrag an
(`history.pushState`), beim Wechsel zurück nimmt es ihn wieder
(`history.back()`). Für eine PWA vom Startbildschirm ist das der Unterschied
zwischen „eine Ansicht zurück" und „weg". **Nur unterhalb der Split-Grenze** —
im Split steht ohnehin beides nebeneinander, ein Eintrag wäre dort sinnlos.

`ausPopstate` ist dabei kein Beiwerk: Kommt das Schließen AUS dem
Zurück-Knopf, hat der Browser den Eintrag schon abgeräumt. Ein zusätzliches
`history.back()` spränge dann einen Schritt zu weit und führte aus der App
heraus — genau das, was der Eintrag verhindern sollte.

Die 1000 px kommen aus dem Platz: 440 px Kalender lassen darunter noch zwei
Board-Spalten (min. 250 px) übrig. Bei weniger bliebe eine einzige Spalte, und
dann ist Umschalten ehrlicher als Nebeneinander.

**Die Breite lässt sich ziehen** (seit 20.08.2026): ein Griff an der linken
Kante des Streifens (`#kalGriffBreite`, nur im Split sichtbar), 360 bis 720 px,
gemerkt unter `kalBreite`. Doppelklick löscht den Wert und stellt den
ursprünglichen Zustand her. Gezogen wird `--kal-breite` am `:root` — und **nur**
das: Panelbreite, `padding-right` des `body` im Split und der Versatz der
Snackbar hängen alle an derselben Variablen. Eine zweite Stelle mit einer
Breite wäre der Punkt, an dem das auseinanderläuft.

**Damit wandert die Split-Grenze mit.** `istSplit()` rechnet bei gezogener
Breite `kalBreite + BOARD_MINDEST` (520 px = zwei Board-Spalten plus Ränder)
statt `SPLIT_AB`. Ohne gezogene Breite gilt weiter die feste Zahl — wer nie
zieht, merkt von der Änderung nichts. Ein schmal gezogener Streifen erlaubt den
Split früher, ein breiter erst später; ohne diese Kopplung könnte man den
Streifen auf 720 px ziehen und hätte bei 1000 px Fenster 280 px Board.

`gemerkteBreite()` steht deshalb ganz oben bei `SPLIT_AB` und nicht bei der
übrigen Griff-Technik am Dateiende: `pflegeBreit()` läuft schon beim Laden und
ruft `istSplit()`. Stünden die Konstanten weiter unten, liefe der Aufruf in die
zeitliche Tote Zone von `const` und die Datei bräche beim Laden ab.

**`pflegeSplit()` hängt nicht mehr nur am `resize`.** Mit einer eigenen Breite
verschiebt sich die Grenze selbst — das Fenster muss sich dafür gar nicht
ändern. Deshalb ruft auch der Griff sie nach jedem Zug auf.

**Die Griff-Mechanik ist geteilt** (`zieheGriff()` in `kalender.js`, dazu
`klemme()`): Breite und Aufteilung benutzen dieselbe Funktion, unterschieden
nur durch `achse`. Pointer-Ereignisse statt Maus UND Touch — ein Weg für beide
Eingaben. Beide Griffe hören zusätzlich auf die Pfeiltasten (16 px, mit Shift
64 px); die App ist sonst durchgehend mit der Tastatur bedienbar, und ein Griff,
der nur auf die Maus hört, wäre der erste Bruch darin.

**Welcher Zeiger zieht, steht in einer eigenen Variablen** (`aktiv`), nicht in
`hasPointerCapture()`. Das Einfangen kann fehlschlagen — bei nachgebauten
Ereignissen tut es das immer (`NotFoundError: No active pointer`) —, und dann
wäre ein Griff, der sich darauf verlässt, schlicht tot. `setPointerCapture`
steht deshalb in einem `try` und ist nur die Zugabe, die die Bewegung beim
Griff hält, wenn der Zeiger ihn verlässt.

**Umschalter 📋 | 📅.** Steckt ZWEIMAL im Dokument: in der Kopfzeile
der App (`#ansichtSchalter`) und noch einmal im Kalender selbst
(`.kal-ansicht-zeile`), weil der im Umschalt-Modus die Kopfzeile verdeckt.
Dasselbe gilt fürs Zahnrad, das in derselben Zeile links davon steht — siehe
„Einstellungen". Sichtbar ist immer nur eine der beiden Ecken: die Zeile im
Kalender blendet sich im Split aus, das ✕ im Kalenderkopf umgekehrt im
Umschalt-Modus. Beide Instanzen
hängen an derselben Verdrahtung, und ihre Abstände sind so gesetzt, dass die
Pille beim Umschalten **an Ort und Stelle stehen bleibt** (`.kal-ansicht-zeile`
holt die Differenz der Innenabstände von `.app` und `.kalender` nach) — sonst
springt genau das Bedienelement, an dem man sich festhält.

**Symbole statt Text**, und das ist keine reine Geschmacksfrage: mit
„Liste | Kalender" war die Pille 131 px breit, drängte am Handy das Zahnrad
aus der ersten Kopfzeile und wirkte neben der 24px-Überschrift klobig. Mit
📋/📅 sind es 89 px (am Handy 78), und alles passt wieder nebeneinander.
Die beiden Zeichen benutzt die App an anderer Stelle schon für dasselbe
(📋 „Meine Listen" in den Einstellungen, 📅 der frühere Kalender-Knopf); den
Namen tragen die Knöpfe in `aria-label` und `title`. **Der ausgeschaltete
Zustand hängt an der Deckkraft** (`opacity: .45`), nicht an der Textfarbe —
Emoji nehmen keine `color` an, sonst leuchteten beide Hälften gleich hell und
man sähe nur noch am Kästchen, welche gilt.

**Der Umschalter sitzt außen rechts, das Zahnrad links davon** — deshalb
trägt `#einstellungenBtn` das `margin-left: auto` und nicht der Umschalter.
Stünde das Zahnrad außen, wäre die Pille in der Kopfzeile um dessen Breite
nach innen versetzt und spränge beim Umschalten in den Kalender.

Am Handy (`max-width: 480px`) bekommt `.topbar h1` außerdem `flex: 1 1 0`
statt `auto`. Das ist der Unterschied zwischen zwei und drei Kopfzeilen:
umgebrochen wird nach der HYPOTHETISCHEN Breite, und die ist bei `basis: auto`
die volle Textbreite des Listennamens — ein langer Name schob damit das
Zahnrad aus der Zeile. Mit `0` nimmt der Titel nur, was übrig bleibt, und
kürzt sich notfalls selbst (`.titel-name` hat `text-overflow: ellipsis`).

Dass die Pille in beiden Ansichten auf derselben Mittellinie steht, macht
`.kal-ansicht-zeile` mit `min-height: 34px` (Höhe der Titelzeile) plus
`align-items: center` — das stimmt bei jeder Pillengröße von selbst, ein
fester Versatz stimmte nur für eine. **`box-sizing: content-box` ist dabei
Pflicht**: mit dem global gesetzten `border-box` steckte das `padding-top`
schon in den 34 px, die Zeile wäre sofort höher als ihr Mindestmaß und
richtete gar nichts mehr aus.

**Gemerkt wird die Ansicht** in `localStorage` unter `kalAnsicht`
(`"liste"` / `"kalender"`), EIN Schlüssel für beide Modi. Geschrieben wird in
`setzePanel()`, also an genau einer Stelle für alle vier Wege (Umschalter,
Escape, Wisch, Wiederherstellen). Ohne gemerkten Wert entscheidet der Platz:
am Rechner steht der Kalender gleich daneben, am Handy nähme er der Liste den
Bildschirm weg. Wiederhergestellt wird in `stelleAnsichtHer()`, aufgehängt am
ersten `kalenderNeuZeichnen()` und nicht am Laden der Datei — erst dann steht
fest, dass jemand angemeldet ist und Daten da sind; solange die Anmeldemaske
steht, wird der Versuch verschoben. Beim Wiederherstellen fährt das Panel
nicht herein (`sofort`-Flag), es steht einfach da.

**Eigene Datei, kein Build-Schritt.** `kalender.js` wird nach `app.js`
geladen und liest dessen Zustand direkt (`daten`, `listen`, `aktiveListe`) —
Reihenfolge der `<script>`-Tags ist deshalb Pflicht. Umgekehrt gibt es genau
eine Berührung: `render()` ruft `window.kalenderNeuZeichnen?.()` auf, damit
ein offenes Panel bei Änderungen am Board mitzieht. Grund für die Trennung
ist schlicht die Größe von `app.js` (>3300 Zeilen), nicht eine technische
Notwendigkeit.

**Fast rein lesend.** Ein Tipp auf einen Eintrag wechselt bei Bedarf die Liste
(`wechsleListe()`) und öffnet das ToDo im gewohnten Bearbeiten-Modus
(`startEdit()`), die Karte blinkt kurz auf (`.todo.kal-treffer`). Kein
Termin-Ziehen im Kalender — sonst läge dieselbe Logik (Wiederholung,
Unterpunkt-Automatik, Speichern) an zwei Stellen. Die einzige Ausnahme ist das
Abhaken in der Tagesliste, und auch das ruft nur `toggleDone()` in `app.js`
auf, statt etwas nachzubauen (siehe unten).
Im Umschalt-Modus schließt sich das Panel dabei, sonst läge die Bearbeitung
unsichtbar dahinter; **im Split bleibt es offen** — das Board steht ja schon
daneben, und Zuklappen wäre ein ungefragter Rückbau der eingestellten
Ansicht.

**Wiederkehrende ToDos erscheinen erst ab ihrem Fälligkeitstag**, im
Kalender genauso wie auf dem Board — `kalenderTermine()` filtert mit
demselben `nochNichtFaellig()` wie `renderColumn()`. Die erste Fassung
zeigte sie im Kalender schon vorher (Argument: es ist ein echter
Datensatz); das war falsch, weil der Kalender damit Termine anzeigte, die
man auf dem Board nicht wiederfindet. Wer das je wieder ändert, braucht
zusätzlich eine Ausnahme in `renderColumn()` und `synchronisiereOhneBereich()`,
sonst zeigt der Sprung aus dem Kalender ins Leere.

**Am HEUTIGEN Tag steht Überfälliges mit in der Tagesliste** (seit
13.08.2026), als eigener Abschnitt „Überfällig (n)" über den heutigen ToDos und
mit Datum je Zeile. Bis dahin lag es allein hinter einem **⚠-Chip** über dem
Raster — wer nur auf „heute" schaute, sah es also nie, obwohl es fällig ist,
nur eben schon länger.

**Den Chip gibt es seit demselben Tag nicht mehr**, und mit ihm ist der
Sonderwert `"ueberfaellig"` in `kalAuswahl` gefallen: derselbe Inhalt an zwei
Stellen, und seine 41 px fehlten dem Tagesbereich. `kalAuswahl` hält jetzt
immer ein ISO-Datum. An
anderen Tagen bleibt es weg: dort ist es weder fällig noch entstanden.

**Rot = da liegt was an.** `.kal-tag.faellig` färbt die Tageszahl, und zwar für
überfällige UND heute fällige Tage (`iso <= heute`, vorher nur `<`). Die blaue
Umrandung von `.heute` bleibt daneben stehen und trennt weiterhin heute von
gestern. Die Klasse hieß bis 13.08.2026 `ueberfaellig` — mit dem heutigen Tag
darin wäre der Name gelogen.

**Dieselbe Regel gilt in der Tagesliste**: `.kal-gruppe.faellig` färbt die
Überschrift, `.kal-todo-zeile.faellig` setzt einen 4-px-Balken links — genau
den, den eine ToDo-Karte auf dem Board trägt, nur rot. Betroffen sind der
Überfällig-Abschnitt und die ToDos des **heutigen** Tages; an anderen Tagen
drängt nichts. Beide Flags kommen als vierter Parameter in `baueGruppenKopf()`
bzw. dritter in `baueEintrag()` herein.

**Kein flächiger roter Hintergrund**, bewusst: bei fünf überfälligen Zeilen
untereinander wird daraus eine rote Wand, in der man nichts mehr einzeln liest.
Der Balken schiebt den Inhalt übrigens nicht, weil er ein Rand ist und
`box-sizing: border-box` global gilt.

**Die Tagesliste kann abhaken** (seit 13.08.2026, `.kal-haken` mit `.check`).
Sonst bleibt der Kalender rein lesend — aber Erledigen ist die eine Sache, die
man beim Blick auf „was ist heute fällig" tatsächlich tun will, und der Umweg
übers Board dafür war einer zu viel. Läuft über `toggleDone(id, boardId)` in
`app.js`, damit die Wiederholungs- und Unterpunkt-Logik an genau einer Stelle
bleibt. **Der `boardId`-Parameter ist Pflicht, nicht Kosmetik:** die Tagesliste
zeigt ToDos aus ALLEN Listen, und ohne ihn liefe `findTodo()` gegen `state`
(die aktive Liste) ins Leere. `findTodo()`, `unterpunkteVon()` und `nextOrder()`
nehmen dafür einen optionalen `inhalt`-Parameter; gespeichert wird mit
`save(boardId)`. Ein Klick auf den TEXT springt weiterhin aufs Board.

**Monat/Jahr ist ein Drehrad** (seit 13.08.2026): zwei Walzen nebeneinander,
Monat links, Jahr rechts. Davor lag hier ein Kachelraster mit Jahres-Pfeilen;
das zeigte alles auf einen Blick, brauchte für „März 2027" aber zwei Schritte
und kürzte die Monatsnamen auf drei Buchstaben.

**Gedreht wird zuerst nur in einem Entwurf** (`wahlJahr` / `wahlMonat`), erst
„Übernehmen" trägt ihn in den Kalender; ✕, Escape und ein Tipp daneben
verwerfen. Einen Tag lang galt das Einrasten **sofort** — dann sprang der
Kalender bei jedem Vorbeidrehen mit, und wer sich verdrehte, kam nur durch
erneutes Drehen zurück: Schließen war da keine Rücknahme mehr, sondern nur das
Ende einer schon vollzogenen Änderung.

**Was gerade gewählt ist, steht in Worten im Kopf** („März 2027",
`.kal-wahl-stand`, gesetzt von `zeigeWahlStand()`). Die Markierung im Rad
allein reichte nicht: sie zeigt zwei Walzen getrennt, und welche Kombination
daraus gilt, musste man sich zusammenreimen.

Drei Dinge, die beim Bauen Ärger gemacht haben und es wieder tun würden:

* **`RAD_ZEILE` in `kalender.js` und `--rad-zeile` in `style.css` gehören
  zusammen.** Aus `scrollTop` und dieser Höhe fällt die Entscheidung, welcher
  Wert in der Mitte steht — laufen die Zahlen auseinander, wählt das Rad den
  falschen Monat.
* **`zeichneWahl()` baut das Rad nur EINMAL** (Flag `radGebaut`), sonst baute
  es sich beim Zeichnen unter dem Finger neu auf, verlöre seine Scrollposition
  und löste damit das nächste Scroll-Ereignis aus. Deshalb zieht
  `zeigeWahlStand()` auch nur die eine Textzeile nach, nicht das Rad.
* **`.kal-rad-spalte` braucht `position: relative; z-index: 1`.** Das
  Markierungsfenster (`.kal-rad-fenster`) ist absolut positioniert und deckend;
  ohne das z-index liegt es ÜBER den Walzen und verdeckt ausgerechnet den Wert,
  den es markieren soll — die Mitte des Rades sah dann leer aus. Gegenprobe:
  `document.elementFromPoint()` mitten im Fenster muss einen `.kal-rad-wert`
  treffen, nicht das Fenster.

Ein **Tipp auf einen Wert** setzt den Entwurf und scrollt zusätzlich hin. Nur
zu scrollen und aufs Einrasten zu warten wäre die elegantere Theorie: tippt
jemand den Wert an, der schon in der Mitte steht, bewegt sich nichts — und ohne
Scroll-Ereignis passierte dann auch nichts.

**Der Ort eines Termins lässt sich bearbeiten** (seit 13.08.2026). Vorher stand
ein vorhandener Ort nur als Text im Formular. Google nimmt das Feld
(`location`) beim Schreiben genauso entgegen wie die Notiz; leer geschickt
löscht es einen bestehenden Ort, deshalb geht dort ein leerer String hin und
nicht `null`.

**Knöpfe im Termin-Formular:** seit dem 24.09.2026 unten zwei bzw. drei
Textknöpfe über die ganze Breite, mindestens 50 px hoch (siehe
„Samsung-Umbau“). Sie stehen AUSSERHALB des Scrollbereichs: die Zeilen liegen
in `.kal-form-inhalt`, das allein scrollt. Bis zum 26.09.2026 scrollte der
ganze Kasten und die Knopfreihe klebte nur per `position: sticky` — bei einer
langen Notiz stand sie dann mitten im Text. Die frühere Knopfreihe mit `.btn.klein` war 25 px hoch — unter
dem Maß, ab dem ein Finger regelmäßig danebenlangt.

**Wischgeste.** Start nur innerhalb von 24 px am RECHTEN Bildschirmrand
(links liegt auf iOS/Android die Zurück-Geste des Browsers). Die Achse
entscheidet sich nach 8 px: überwiegend senkrecht → die Geste wird
verworfen, das Board scrollt normal; überwiegend waagerecht → `preventDefault()`
und das Panel folgt dem Finger (Inline-`transform`, deshalb steht im CSS nur
der Ruhezustand). Beim Loslassen entscheidet die Strecke (65 % zum Öffnen,
35 % zum Schließen). Blockiert, solange ein Dialog offen ist oder etwas
gezogen wird (`darfGeste()`) — sonst kämpft die Geste mit dem Drag & Drop des
Boards. Der Umschalter in der Kopfzeile führt zum selben Ziel.
**Entfallen am 09.10.2026:** **Die senkrechte Vollbild-Geste gab es nur im Split** (seit 24.09.2026):
am Handy füllt das Raster die Ansicht ohnehin. Senkrecht über dem Raster
passiert dort nichts.
**Im Split ist die Geste aus**: Öffnen und Zuziehen macht dort der
Umschalter, denn eine Spalte wandert nicht mit dem Finger. Das Blättern
im Raster und in der Tagesliste bleibt auch dort erhalten — ein Tablet quer
hat Platz UND Finger.

**Jedes Öffnen startet bei heute** — Umschalter, Wisch und das
Wiederherstellen nach dem Laden gleichermaßen (`springeZuHeute()`);
sonst hinge das Panel noch in dem Monat, in dem man zuletzt geblättert hat.
Beim Blättern in einen anderen Monat wird automatisch der erste Tag MIT
Terminen gewählt, sonst steht unter einem gefüllten Raster eine leere Liste.

**Nur synthetisch getestet:** die Wischgeste wurde mit selbst erzeugten
Touch-Events geprüft (öffnen, schließen, senkrecht verwerfen, Mitte
verwerfen, bei offenem Dialog blockiert), nicht mit einem echten Finger auf
einem Gerät.

**Was beim Umbau vom 20.08.2026 ungeprüft geblieben ist** (eigene Ansicht am
Handy, zwei Ziehgriffe, Zwischenspeicher, Balkentitel):

* Der **echte Google-Rundlauf** — lokal fehlen die Zugangsdaten. Geprüft wurde
  gegen nachgebaute Antworten (Termine, Fehlerfall, `verbunden:false`); der
  `getrennt`-Zweig traf es dabei mit der **echten** lokalen Serverantwort, die
  ohne Zugangsdaten `verbunden:false` meldet — der Zwischenspeicher wurde
  daraufhin korrekt geleert.
* **Echte Finger** auf einem Gerät. Beide Griffe und die Gesten liefen gegen
  selbst erzeugte Pointer- und Touch-Ereignisse.
* Der **Fokus-Teil mit echten Daten** — dafür bräuchte es den zweiten
  Dev-Server (siehe „Fokus-Panel"). Geprüft ist die Anordnung: der Griff sitzt
  zwischen Tagesliste und Reiterzeile und zieht auch dort.
* Der **Abmeldevorgang im Ganzen** — geprüft ist, dass
  `kalenderSpeicherLeeren()` räumt, nicht der Durchlauf durch `logout()`.

**Bekannte Vereinfachung:** `rasterMindest()` rechnet immer mit dem
Monatsraster, auch wenn unten gerade Gewohnheiten oder der Timer stehen. Die
Aufteilung wird dort also etwas früher geklemmt, als nötig wäre. Unschädlich,
aber der Punkt, an dem man ansetzt, falls der Fokus-Teil einmal mehr Platz
braucht.

### Samsung-Umbau (24.09.2026)

Vorlage waren drei Screenshots aus dem Samsung Kalender (Termin bearbeiten,
Wiederholen, Monatsansicht mit Tages-Karte). Entwurf mit Hendriks
Entscheidungen: `docs/2026-09-24-kalender-samsung.md`.

**Am Handy gibt es keine Tagesliste mehr neben dem Raster.** Unterhalb der
Split-Grenze (kein `html.breit`) füllt das Raster die Ansicht und zeigt die
ToDos im Klartext — technisch dasselbe wie das Vollbild am Rechner.
`rasterVoll()` in `kalender.js` fasst beides zusammen und steht überall dort,
wo früher `kalVollbild` allein stand (Spurenzahl, Messung, Zelleninhalt,
Tagesliste ausblenden). Die Reiter Kalender | Gewohnheiten | Timer bleiben
stehen, anders als im Vollbild. Vollbild-Knopf und Teilungsgriff sind am Handy
ausgeblendet; `pflegeSplit()` räumt ein Vollbild beim Wechsel aufs Handy weg und
zeichnet beim Wechsel zwischen den Modi komplett neu.

`messeVollbild()` steigt aus, wenn die Zelle keine Höhe hat — sonst setzte der
Gewohnheiten-Reiter (Raster ausgeblendet) den gemessenen Platz auf 1, und
zurück beim Kalender stand in jeder Zelle nur noch „+n“.

**Ein Tipp öffnet den Tag als Tages-Karte**, auch einen leeren (seit
26.09.2026, Hendriks Wunsch). Vom 24. bis 26.09. markierte der erste Tipp nur,
erst der zweite öffnete, und ein leerer Tag sprang dabei gleich in „Neuer
Termin“ — in der Karte stehen für beides ein ＋. Nach dem Blättern in einen
anderen Monat ist am Handy nichts gewählt (außer heute liegt darin): ohne
Tagesliste wäre ein automatisch gewählter Tag nur eine Markierung ohne Grund.

**Welcher Tag angetippt wurde, entscheidet die LAGE, nicht das Element**
(`zelleUnter()`). Der Balken eines mehrtägigen Termins hängt an der Zelle
seines ersten Tages und ragt über die folgenden hinaus (siehe „Der Balken
trägt seinen Titel“) — wer ihn über dem 19. antippte, landete deshalb beim
18. (gemeldet 26.09.2026). Ohne Koordinaten (Enter per Tastatur) gilt weiter
die Zelle des Elements.

**Die Tages-Karte** (`#kalTagPopup`, liegt wie alle Dialoge außerhalb des
Panels) zeigt denselben Inhalt wie die Tagesliste: `zeichneTagesliste()` nimmt
dafür ein Ziel, ein `karte`-Flag, den Tag und ob sie bedienbar ist. In der
Karte entfallen Tagestitel und das ＋ an den Terminen; unten sitzt ein rundes
＋ für einen **Termin**. Ein **ToDo** legt das kleine ＋ an der Überschrift
„ToDos“ an, wie in der Tagesliste am Rechner. Bis zum 25.09.2026 stand dafür
unten ein großes Feld „Am 24. Sept. hinzufügen“ — Hendrik: „benutze ich so gut
wie nie“. Wisch nach links/rechts blättert den Tag (`gestenZone()` meldet über
dem ganzen Popup „tag“); der nachgeschobene Klick nach dem Wisch wird in der
Einfangphase am Streifen geschluckt, sonst schlösse er neben den Karten die
Karte.

**Die Zurück-Taste schließt am Handy die oberste Ebene** (Rückfrage, Formular
— von der Wiederholen-Seite erst zurück ins Formular —, Monatswahl, Filter,
Karte) und nicht gleich den ganzen Kalender. `schliesseObersteEbene()`
teilt sich die Reihenfolge mit Escape. Der Trick: Der `popstate`-Handler setzt
den gerade abgeräumten Verlaufseintrag sofort wieder (`pushState`), solange
der Kalender offen bleibt — so braucht keine Ebene einen eigenen Eintrag.

**Behobener Fehler:** Der `popstate`-Handler rief bis dahin nur
`setzePanel(false)`. `kalOffen` blieb `true`, und der 📅-Knopf öffnete den
Kalender nach der Zurück-Taste nicht mehr (er hielt ihn für offen und schaltete
nur den unteren Teil um). Jetzt läuft er über `schliesseKalender()`.

**Termin-Formular im Samsung-Layout:** Titel mit Farbpunkt (ein Tipp klappt
Googles Palette darunter auf), Ganztägig als Schiebeschalter, Von → Bis
nebeneinander (Datum oben, Uhrzeit darunter), Zeilen mit Linien-Symbol für
Ort, Wiederholung und Notizen, unten Abbrechen | Speichern. Keine Kopfzeile.
Gelöscht wird aus der Ansicht eines Termins (siehe „Zweite Runde“).
Kalenderkonto, Erinnerung, Videokonferenz, Anhang und Teilnehmer aus der
Vorlage sind bewusst weggelassen. Speichern ohne Titel färbt die Titellinie
rot und meldet sich per Snackbar — vorher blieb der Knopf stumm.

**Das Ende rückt sofort mit** (`setzeBeginn()`): Beginn ändern verschiebt das
Ende um denselben Betrag, die Dauer bleibt. Ein Ende, das danach nicht hinter
dem Beginn liegt, wird zu Beginn + 1 Stunde (`setzeEnde()`), auch über
Mitternacht in den nächsten Tag.

**Falle: Die Zeitfelder dürfen beim Ändern nicht neu gebaut werden.** Am
Rechner öffnet `showPicker()` die Uhrzeit als Klappliste mit Stunden- und
Minutenspalte, und `change` feuert schon nach der Stunde. Ein Neubau des
Dialogs schlösse die Liste, bevor man die Minute erreicht. Deshalb zieht
`aktualisiereZeitraum()` nur Text und Werte der vier Felder nach (`data-teil`).
Neu gebaut wird nur beim Umschalten von Ganztägig — dann kommen oder gehen die
Uhrzeitfelder. Die nativen Felder liegen wie bei `.date-field` am ToDo: am
Finger unsichtbar über dem Text, mit der Maus ohne Trefferfläche und per
`showPicker()` geöffnet.

**Wiederholung** ist eine eigene Seite im selben Dialog (`seite:
"wiederholung"`), mit „‹“ zurück: Nicht wiederholen · Jeden [n] Tag / Woche /
Monat / Jahr (ab 2: „Alle 2 Wochen“) und darunter die Laufzeit: für immer,
bestimmte Anzahl oder bis Datum. Woche heißt Wochentag des Beginns, Monat
derselbe Tag im Monat — eine Wochentags-Auswahl gibt es nicht (nicht in der
Vorlage). Samsungs „Nicht wieder anzeigen“ ist ein Übersetzungsfehler, bei uns
steht „Nicht wiederholen“. Die Seite baut sich nicht neu, solange sie offen
ist, sonst verlöre eine Zahl nach jeder Ziffer den Fokus.

Die App baut die RRULE selbst (`baueRegel()`); `UNTIL` ist bei ganztägigen ein
Datum, sonst der UTC-Zeitpunkt am Ende des gewählten Tages in Ortszeit.
Umgekehrt liest `regelAlsWiederholung()` die Regel einer Serie. Was sie nicht
abbilden kann (etwa „jeden 3. Mittwoch“, mehrere Wochentage), heißt „Eigene
Regel aus Google“ und **bleibt unangetastet**, solange man die Wiederholung
nicht anfasst. Google liefert die Regel bei aufgelösten Einzelterminen nicht
mit — das Formular holt sie beim Öffnen über `GET /api/google/termin?serie=`,
bis dahin ist die Zeile gesperrt („Wird geladen …“).

**Serientermin ändern oder löschen — drei Wege** (Hendriks Wahl, wie bei
Samsung und Google), abgefragt über `frage()` / `frageUmfang()`:

* **Nur diesen Termin** — PATCH auf die Ausgabe, Google führt sie als Ausnahme.
  Entfällt, wenn die Wiederholung geändert wurde.
* **Diesen und alle folgenden** — die App legt ab hier eine NEUE Serie an und
  kürzt danach die alte per `UNTIL` auf die Sekunde vor der Ausgabe.
  Reihenfolge absichtlich so: Scheitert der zweite Schritt, stehen Termine
  doppelt da, statt still zu verschwinden. Hatte die alte Serie eine feste
  Anzahl, bekommt die neue den Rest (gezählt über `instances` samt gelöschter
  Ausgaben, weil `COUNT` die mitzählt). Ab der ersten Ausgabe ist das dasselbe
  wie „alle“.
* **Alle Termine** — PATCH auf den Stammtermin. Wer die Ausgabe vom 16. auf den
  17. legt, verschiebt die ganze Serie um einen Tag, die Uhrzeit gilt für
  alle. Mit „Nicht wiederholen“ wird die Serie gelöscht und ein Einzeltermin
  am Tag aus dem Formular angelegt.

Die ganze Logik steht in `functions/_lib/serien.js`; `termin.js` prüft nur
Eingaben (`regel` gegen ein enges Muster, Kennungen, `umfang`). Der Termin
trägt dafür `serieId` (Googles `recurringEventId`).

**Bekannte Lücke:** Bei „diesen und alle folgenden“ wandern einzeln gelöschte
oder verschobene Ausgaben der alten Serie nicht in die neue mit — sie tauchen
dort wieder im normalen Rhythmus auf. Google selbst kopiert die Ausnahmen;
das nachzubauen hieße, sie einzeln auszulesen und als EXDATE zu übertragen.

**Filter als Menü:** `#kalFilter` steht jetzt IM Kalender-Kopf (der ist mit
`position: relative` der Bezugsrahmen) und hängt rechtsbündig darunter. Ein
Tipp daneben schließt es (Einfangphase am Dokument), der Tipp selbst geht
trotzdem durch.

**Falle beim lokalen Testen mit einem Schein-Google-Konto:** Eine von Hand in
`google_konten` eingetragene Zeile überlebt das Öffnen der App nicht. Der
Kalender fragt sofort bei Google an, Google lehnt das Schein-Token ab (401),
und der Endpunkt löscht die Zeile wie vorgesehen („getrennt“). Zum Prüfen der
Eingabeprüfung vorher `localStorage.kalAnsicht = "liste"` setzen und die
Anfragen von `/robots.txt` aus schicken — `preview_start` öffnet sonst selbst
die App.

#### Zweite Runde (25.09.2026)

**Ein Termin öffnet als Ansicht**, die Zwischenmaske (`#kalDetailPopup`) ist
entfallen. `formularFelder.modus` sagt, was geht:

* `ansicht` — bestehender Termin mit Schreibrecht: eine REINE Ansicht
  (`baueTerminAnsicht()`), unten „Löschen | Bearbeiten | Schließen“.
* `lesen` — ohne Schreibrecht: dieselbe Ansicht, unten nur „Schließen“.
* `bearbeiten` — nach „Bearbeiten“: das volle Formular, unten „Abbrechen |
  Speichern“. Abbrechen (auch Escape und die Zurück-Taste) schließt das
  Fenster, genau wie Speichern — Hendriks Wunsch vom 26.09.2026. Einen Tag lang
  führte es zurück in die Ansicht.
* `neu` — neuer Termin: das volle Formular, Abbrechen schließt.

**Die Ansicht sieht nach Ansehen aus, nicht nach Bearbeiten** (dritter Anlauf,
ebenfalls 25.09.2026). Am Vormittag ließ sich in ihr noch fast alles direkt
ändern, und eine Knopfreihe wechselte bei der ersten Änderung auf
„Abbrechen | Speichern“. Hendriks Rückmeldung danach: die beiden Fenster
sollen nicht gleich aussehen. Jetzt:

* Titel und Zeiten als Text, kein Feld und kein Picker; der Farbpunkt ist
  nur Anzeige.
* Kein Ganztägig-Schalter. Bei ganztägigen steht „Ganztägig“ unter dem
  Datum; bei eintägigen nur EIN Datum statt zweimal desselben.
* Ort, Wiederholung und Notiz nur, wenn es sie gibt — kein leeres Feld, kein
  „Nicht wiederholen“. Die Wiederholungs-Zeile einer Serie steht da, solange
  die Regel lädt („Wird geladen …“), und verschwindet, falls die Serie doch
  keine hat (`fuelleWdhZeile()`).
* Ort als Link zu Google Maps, Links in der Notiz klickbar (Hendriks Wunsch:
  „die Links sollen genauso bleiben“).

**Farbe wählen: ein Menü unter dem Farbpunkt** (`.kal-farbwahl`), nicht mehr
eine Reihe, die ins Formular klappt. Eine Farbe wählen schließt es, ein Tipp
daneben ebenfalls — in der Einfangphase am Dialog, damit ein Tipp auf den
Hintergrund nicht gleich das ganze Formular zumacht. Escape schließt erst das
Menü.

**Termin-Zeilen wie bei Samsung** (`baueTerminZeile()`): links die Startzeit,
dann ein 4-px-Balken in der Terminfarbe, rechts Titel und „12:15 – 13:15“.
Kein Kasten mehr. Beginnen zwei Termine zur selben Zeit, steht die Zeit nur
beim ersten. **Ganztägige** stehen oben im selben Abschnitt „Termine“ und
tragen statt der Zeit ein Kalender-Symbol (nur beim ersten) — vorher hatten
sie eine eigene Überschrift und eine leere Zeitspalte, Hendrik: „am Anfang
viel Platz“. Gilt in der Karte und in der Tagesliste am Rechner (dieselbe
Funktion). Seit 19.10.2026 haben Ganztägige keine zweite Zeile „Ganztägig“ mehr
(siehe „Ruhigeres Bild“).

**Karussell für Monat und Tag** (`blaettere()`, `gleite()`): Das Raster ist
ein Streifen aus drei Monaten (`#kalRasterBahn` → `.kal-raster-streifen` →
drei `.kal-raster`, `#kalRaster` ist der mittlere), die Tages-Karte ein
Streifen aus drei Karten mit hervorschauenden Nachbarn. Beim Wischen folgt der
Streifen dem Finger 1:1; beim Loslassen gleitet er zum Nachbarn (ab 22 % der
Breite oder einem schnellen Schnipser) oder zurück. Erst NACH dem Gleiten wird
neu gezeichnet, und der Streifen springt im selben Zug auf null — der Nachbar,
der eben hereinglitt, ist dann die Mitte, sichtbar springt nichts. Die Pfeile
‹ › gleiten genauso; ein Tipp auf eine Nachbarkarte blättert dorthin.
Vorher folgte der Inhalt dem Finger gedämpft (35 %) und sprang beim Loslassen
um — Hendrik: „nicht flüssig und etwas kantig“. Die Tagesliste am Rechner hat
keinen Nachbarn und blättert weiter auf die alte Art.

**Die Nachbarkarten sind deckend** (seit dem Abend des 25.09.2026 — vorher
halb durchsichtig, und das Raster schien durch). In Ruhe sind sie abgedunkelt
und zeigen nur ihre Kante, keinen Inhalt. Beim Wischen setzt `setzeStreifen()`
`--anteil` (0 bis 1, wie weit der Streifen gewandert ist): die
hereinkommende Karte hellt auf und blendet ihren Inhalt ein, die abgehende
dunkelt ab. Am Ende des Wischs stimmt damit schon alles, und beim
Neuzeichnen springt nichts. `--gleit-dauer` lässt das im Takt des Gleitens
laufen — beim Zurücksetzen steht sie auf 0, sonst blendete die neue Mitte
sichtbar nach.

Zwei Dinge daran, die man leicht falsch baut:

* **Auf `transitionend` ist kein Verlass** — es bleibt aus, wenn der Streifen
  schon am Ziel steht, bei reduzierter Bewegung oder in einem Tab, der gerade
  nicht zeichnet (etwa im Testbrowser). `gleite()` hat deshalb einen Zeitgeber
  als Netz, und `gleitEnde` schließt eine laufende Bewegung sofort ab, sobald
  ein neuer Finger aufsetzt oder ein zweiter Klick kommt.
* **Die Nachbarmonate brauchen ihre Termine schon beim Hereingleiten.** Der
  Google-Abruf deckt deshalb Vor-, angezeigten und Folgemonat ab
  (`zeitraumDesMonats()`), vorher war es der Monat plus eine Woche Rand. Die
  Untergrenze der Spuren (`spurenVorher`) gilt nur für den mittleren Monat.

Die Lücken zwischen den Nachbarn stehen zweimal: 16 px beim Raster, 12 px bei
den Karten — in `style.css` (`[data-schritt]`) und als `RASTER_LUECKE` /
`KARTEN_LUECKE` in `kalender.js`. Laufen sie auseinander, gleitet der Streifen
ein Stück zu weit oder zu kurz und springt dann.

**iPhone als Homescreen-App: Inhalt 24 px tiefer.** iOS legt dort einen
Unschärfe-Streifen unter die Statusleiste, der ein Stück in die Seite
hineinreicht (Hendriks Screenshot: Dialog-Überschrift verschwommen, Feld
darunter scharf). Abschalten lässt er sich nicht. Alles, was oben klebt,
richtet sich deshalb nach `--oben` statt direkt nach
`env(safe-area-inset-top)`; nur mit `display-mode: standalone` UND
`-webkit-touch-callout` (gibt es nur in iOS-WebKit) kommen 24 px dazu. **Neue
Elemente, die oben kleben, müssen `var(--oben)` nehmen**, sonst landen sie
wieder im Streifen.

**Cache-Version:** In der ersten Runde am 24.09.2026 ist das Hochzählen von
`CACHE_NAME` in `sw.js` vergessen worden (Regel siehe „Offline“). Weil der
Service Worker zuerst übers Netz lädt, kam die neue Fassung trotzdem an; in
der zweiten Runde ist es nachgeholt (v22).

**Was ungeprüft blieb:**

* **Echte Google-Serien.** Lokal gibt es keine Zugangsdaten. Geprüft sind die
  Serien-Wege in `serien.js` gegen ein nachgebautes Google (Node, 12 Fälle:
  anlegen, nur dieser, folgende mit Rest-Anzahl, alle mit Verschiebung, keine
  Wiederholung mehr, ganztägiges UNTIL, löschen in allen drei Varianten), die
  Eingabeprüfung im echten Worker und das Formular gegen nachgebaute
  Antworten. Dass Google einen Einzeltermin per PATCH mit `recurrence` zur
  Serie macht, ist nicht selbst gesehen.
* **Ein echtes Handy.** Die Picker für Datum und Uhrzeit, die Tastatur über dem
  Feld in der Karte und der Wisch liefen gegen nachgebaute Ereignisse im
  Testbrowser.
* **Wie flüssig das Gleiten aussieht** (zweite Runde). Der Testbrowser
  zeichnet keine CSS-Übergänge; geprüft sind Lage der Nachbarn, das 1:1-Folgen,
  Weiterblättern, Zurückfedern, der schnelle Doppelklick und das Aufräumen per
  Zeitgeber — nicht der Eindruck am Finger.
* **Die 24 px am iPhone.** Geprüft ist, dass die Regel eingelesen wird und mit
  dem iPhone-Wert Kopfzeile, Kalender und Dialoge mitrutschen; ob 24 px den
  Unschärfe-Streifen ganz räumen, zeigt erst das Gerät.

### Board | Heute | Kalender (09.10.2026)

Entwurf mit Hendriks Entscheidungen aus drei Runden an einem Tag:
`docs/2026-10-09-heute-spalte.md`. Ausgangspunkt: am Rechner störten ihn das
gequetschte Raster, die Unlesbarkeit bei schmalem Streifen und das Verhältnis
links/rechts (links leer, rechts zu dicht).

**Drei Aufbauten, entschieden allein an der Fensterbreite** (`kalender.js`):

| Breite | Funktion | Aufbau |
| --- | --- | --- |
| ab 1380 px | `istDrei()`: `BREITE_MIN` + `HEUTE_BREITE` + `BOARD_MINDEST` (560 + 300 + 520) | Board, eigene Heute-Spalte, Kalender in voller Höhe |
| ab 1000 px | `istSplit()`: `SPLIT_AB` | Board mit der Tagesansicht oben, Kalender in voller Höhe (iPad quer, kleine Laptops) |
| darunter | — | Handy: Board ODER Kalender; Tagesansicht oben in der ToDo-Übersicht |

**Den gestapelten Streifen gibt es nicht mehr**, mit ihm entfallen sind der
Teilungs-Griff (`#kalGriffTeilung`, `kalTeilung`), die Raster-Untergrenze je
Zeile (`--kal-zeilen`, `--kal-zeile-min`, `rasterMindest`, `teilungMax`), die
Punktreihe in den Zellen und das Kalender-Vollbild (⤢, senkrechter Wisch,
`kalVollbild`, `.kalender.vollbild`). Das Raster hat in jedem Aufbau die volle
Höhe und zeigt ToDos im Klartext; `rasterVoll()` gibt es deshalb auch nicht
mehr. Möglich wurde das durch Hendriks Wahl für 1000–1380 px („wie am iPad“):
sonst wäre der gestapelte Streifen dort die einzige Stelle mit Griff und
Punkten geblieben. Ein alter `kalTeilung`-Wert im Speicher bleibt ungelesen.

**Die Kalenderbreite** ist in beiden Split-Aufbauten `kalBreite()`: der
gemerkte Wert (`kalBreite`), sonst 32 % des Fensters, geklemmt zwischen
`BREITE_MIN` (560) und `breiteMax()` (höchstens 720, und es muss eine
Board-Spalte bleiben: `BOARD_EINSPALTIG` = 250 + 2 × 26 App-Rand + 18 px für
eine feste Scrollleiste). `wendeBreiteAn()` setzt `--kal-breite` im Split
immer, geklemmt und ohne den gemerkten Wert zu überschreiben. `istSplit()`
hängt seitdem nicht mehr an der gemerkten Breite.

**560 px sind gemessen:** Zelle = (Breite − 64) / 7, davon gehen 17 px an
Zellrand, Stapel-Innenabstand, Kante und Textabstand. Bei 560 bleiben 54 px
Text, das ist „HNT Train…“ (neun Zeichen). Der Balkentext hat dafür 3 statt
4 px Innenabstand.

**Heute-Spalte (ab 1380 px): es bleibt EIN Panel.** `#kalenderPanel` wird um
`--heute-breite` breiter und teilt sich per CSS-Grid: links `#kalTagesliste`
über alle Zeilen, rechts ✕-Zeile, Reiterzeile, Kalender- bzw. Fokus-Block.
Öffnen, Schließen und Umschalter bleiben unverändert; 📅/📋 schalten Heute und
Kalender gemeinsam (Hendriks Wahl). `row-gap` ist 0, die Abstände sitzen an den
Zeilen: eine ausgeblendete Reiterzeile ließe sonst eine doppelte Lücke. Der
Breiten-Griff zieht dort nur den Kalender-Teil (`start` zieht `HEUTE_BREITE`
ab). `#kalTagesliste` wird NUR in diesem Aufbau gezeichnet, sonst geleert,
damit eine offene Anlege-Zeile nicht zweimal im Dokument steht.

**Tagesansicht über den ToDos** (`#tagOben`, `zeichneTagOben()`): überall ohne
Heute-Spalte, solange das Board zu sehen ist. Bei offenem Kalender zeigt sie
den dort gewählten Tag, bei zugeklapptem heute. Dann stellt sie
`kalJahr`/`kalMonatNr` auf den heutigen Monat und holt dessen Google-Termine;
das nächste Öffnen springt ohnehin auf heute. Am Rechner ab 1380 px gibt es
sie nicht, auch nicht bei zugeklapptem Kalender (Hendriks Wahl: „Handy und
iPad“). Gezeichnet mit derselben `zeichneTagesliste()`, Abhaken, Überfälliges,
＋ToDo und ＋Termin kommen also mit. **Einklappbar am Kopf** (Klick, Enter,
Leertaste), gemerkt pro Gerät unter `tagObenZu`; zugeklappt bleibt „Datum ·
2 ToDos, 3 Termine“. Hendriks Wahl gegen einen Schalter in den Einstellungen.

Wer sie neu zeichnet: `zeichneKalender()` am Ende, `aktualisiereAuswahl()`,
`setzePanel()` (Auf/Zu auf jedem Weg), `kalenderNeuZeichnen` (bei zugeklapptem
Kalender nur sie) und `pflegeSplit()` bei einem Wechsel des Aufbaus.
**`zeichneAlles()`** (offen: alles, zu: nur sie) ersetzt `zeichneKalender()`
überall, wo die Tagesansicht der Auslöser sein kann: ＋ToDo, Abbrechen,
Termin-Formular auf/zu, Ende von `ladeGoogle()`, Google trennen.

**Ruhig, wenn nichts fällig ist** (10.10.2026): Heute-Spalte und Tagesansicht
oben zeigen dann keinen eigenen ToDo-Abschnitt („ToDos“ + „Nichts fällig.“),
sondern nur das ＋ rechts in der Datumszeile (`ruhig` in
`zeichneTagesliste()`). Einen Tag lang stand dort zusätzlich ein leises
„· nichts fällig“ — in der schmalen Heute-Spalte brach die Zeile damit
dreifach um (Hendrik: „sieht richtig schlecht aus“, Lösung „weglassen“).
**Nicht wieder einbauen.** Aus demselben Grund nennt die Zusammenfassung im
zugeklappten Zustand nur noch, was da ist („· 2 Termine“), ohne „nichts
fällig“ und „keine Termine“. Die Termine bleiben unverändert, mit
Dauer — Hendrik: „Termine sollen so bleiben, nur ToDos nicht“; einzeilige
Termine waren gefragt und sind verworfen. „Fällig“ heißt: ToDos an diesem Tag
oder, am heutigen, Überfälliges. Nicht ruhig ist es in der Tages-Karte am
Handy (dort ist das ＋ an „ToDos“ der Weg zum Anlegen) und solange die
Anlege-Zeile offen ist — ein Tipp aufs ＋ holt den Abschnitt samt Feld
zurück. Zugeklappt entfernt `zeichneTagOben()` das ＋ wieder: es öffnete eine
Zeile, die man nicht sieht. Knöpfe im
Kopf klappen nicht mit (Klick- und Tastatur-Handler steigen bei `button` aus).

**Bei zugeklapptem Kalender steht auch `kalAuswahl` auf heute**
(`zeichneTagOben`): ein Tipp auf einen Termin öffnet ihn mit `kalAuswahl` als
seinem Tag (`baueTerminZeile`), und die stand sonst noch auf dem zuletzt im
Kalender angetippten Tag — die Tagesansicht zeigte heute, der Termin bekam
einen anderen. Gefunden beim Lesen, Folgen (etwa bei „nur dieser Termin“
einer Serie) nicht nachgestellt.

**Falle, gleich mitgebaut:** das Sofort-Zeichnen aus dem Zwischenspeicher in
`ladeGoogle()` ruft über die Tagesansicht wieder `ladeGoogle()`. Deshalb steht
`googleLaedt = true` jetzt VOR diesem Zeichnen, sonst ging dieselbe Anfrage
zweimal hinaus.

**Offline-Schleife behoben:** scheiterte die Google-Anfrage (catch), blieb
`googleGeladen` ungesetzt, und das Neuzeichnen danach rief sofort wieder
`ladeGoogle()`. Nach Code-Lesart ein Kreis aus Anfrage und Zeichnen, solange
offline (vorher bei offenem Kalender, mit der Tagesansicht auch am Handy in der
Übersicht). Jetzt gilt der Monat nach einem Fehlschlag als geladen, ein
`online`-Ereignis setzt das zurück. Gemessen: offline genau eine Anfrage,
Hinweis „Google-Termine gerade nicht erreichbar“, nach `online` neu geladen.
Den alten Kreis selbst habe ich nicht nachgestellt.

**Monatswechsel wählt immer einen Tag** (`zeigeMonat`): im aktuellen Monat
heute, sonst den Ersten (Hendriks Wahl). Vorher wurde der erste Tag mit einem
ToDo gewählt. Google-Termine zählten dabei nicht, und in einem Monat ohne ToDos
blieb der Tagesbereich leer. Am Handy bleibt es bei „heute oder nichts“: neben
dem Raster steht dort keine Tagesliste.

**Schmales Board, umbrechende Kopfzeile:** liegt das Board neben dem Panel
unter `BOARD_SCHMAL` (600 px), setzt `pflegeBreit()` `html.board-schmal`, und
die Kopfzeile bricht um wie am Handy, nur bei offenem Kalender. Eine
Container-Abfrage auf `.app` wäre eleganter, machte `.app` aber je nach Browser
zum Bezugsrahmen für `position: fixed` darin.

**Getönte Balken.** `kalender.js` setzt nur `--balken-farbe`; Grund
(`color-mix` 22 % mit `--row`), Schrift (40 % mit `--text`) und die 3-px-Kante
links macht das CSS. Die Kante sitzt nur am Anfang eines Termins. Gemessen:
alle 22 Google-Farben (neue und alte Palette) erreichen mindestens 4,67 : 1.
**Darkmode mit eigener Mischung:** Grund 24 % auf `--bg`, Schrift 60 % mit Weiß,
die Farbe steckt also in der Schrift (Hendriks Wahl gegen „satt“ und
„kräftiger getönt“; die erste Mischung machte Gelb und Orange braun).
Mindestens 4,84 : 1; mit 72 % fielen dunkles Rot und Lila auf 3,9. **Falle:**
die Darkmode-Regel braucht `:not(.kal-balken-luecke)`, sonst malt sie graue
Kästchen in leere Tage. `kontrastFarbe()` ist entfallen; die Marke im
Quellen-Filter bleibt satt.

**Bereichs-Spalten: Höhe nach Inhalt.** Einen halben Tag lang reichten die
Spalten bis zum unteren Fensterrand. Hendrik fand das „etwas komisch“, es ist
zurückgebaut, **nicht wieder vorschlagen**.

**Bereiche rücken nach oben (18.10.2026).** Das Board ist kein `flex-wrap` mehr,
sondern eine Reihe senkrechter Streifen (`.board-spalte`); `ordneBereiche()` in
`app.js` legt jeden Bereich der Reihe nach in den gerade kürzesten Streifen.
Anlass: Hendrik störte der Leerraum unter kurzen Bereichen (jede Reihe war so
hoch wie ihr höchster, bei ihm stand „Test ToDo“ neben dem langen „Projekte“)
und drei Bereiche nebeneinander neben dem Kalender. Masonry, das er am 09.10.
verworfen hatte, hat er jetzt selbst gewählt (gefragt mit ASCII-Vorschau an
seinen echten Einträgen; die Alternativen „Ohne Bereich“ als Streifen oben und
„lange ToDos kürzen“ hat er nicht genommen).
- **Anzahl der Streifen** allein aus der Breite des Boards (`spaltenAnzahl()`):
  Mindestbreite 340 px (`BEREICH_MINBREITE`), aber mindestens zwei, solange
  zweimal 280 px passen (so war es vorher). Am Rechner mit offenem Kalender
  (1920 px, Board rund 950 px) sind das zwei Streifen statt drei. Mehr Streifen
  als Bereiche gibt es nie.
- **Messen:** erst alle Bereiche in den ersten Streifen (alle Streifen sind
  gleich breit, `flex: 1 1 0`), Höhen lesen, dann umhängen. Aufgerufen am Ende
  von `render()` und vom `ResizeObserver` am Board (120 ms Verzögerung), wenn
  sich die Streifenzahl ändert oder die Breite um 40 px. Kleinere Schwankungen
  (eine Bildlaufleiste kommt oder geht) legen nichts neu aus.
- **Die Lesereihenfolge steht in `bereichsReihenfolge`**, nicht im DOM: der ist
  nach dem Verteilen nach Streifen sortiert.
- **Preis:** Ein Bereich kann beim Neuzeichnen den Streifen wechseln, wenn sich
  Höhen ändern (ToDo abhaken, Bereich wächst oder schrumpft). Ein neuer Bereich
  landet im kürzesten Streifen, nicht „links in der nächsten Reihe“.
- **Bereich ziehen:** `einfuegeStelle()` bestimmt, vor welchem Bereich der
  gezogene landet (Streifen unter dem Zeiger, darin der erste Bereich, dessen
  Mitte unter dem Zeiger liegt; steht der Zeiger auf dem gezogenen selbst,
  passiert nichts). Das Board legt dabei live neu aus, die Vorschau ist also das
  Ergebnis. Gespeichert wird die Lesereihenfolge; in welchem Streifen der
  Bereich landet, entscheidet die Anordnung. „Ohne Bereich“ bleibt vorne.
- **Falle beim Testen:** im Claude-Browser feuert der `ResizeObserver`
  verzögert (nach rund 1,5 s); `pruefeAuslegung()` direkt aufrufen, wenn nichts
  passiert. Das Ziehen ist nur mit nachgebauten Drag-Ereignissen geprüft, nicht
  mit echter Maus.

**Bereichsfarben: zwölf zur Wahl (18.10.2026).** Zu Blau, Türkis, Grün, Lila,
Pink und Grau kamen Himmelblau, Limette, Braun, Magenta, Indigo und Anthrazit.
**Rot, Orange und Gelb fehlen mit Absicht:** sie bedeuten am ToDo „dringend“
und „hat Termin“, ein Bereich in genau dieser Farbe wäre doppeldeutig (Hendrik
hat gefragt und für „bleiben frei“ entschieden). Eine neue Farbe braucht sechs
Stellen: `FARBEN` in `app.js`, `FARBEN_ERLAUBT` in `functions/api/todos.js` (der
Server lehnt alles andere mit 400 ab), je einen hellen und dunklen Wert als
`--farbe-…` und die Regeln `.column[data-farbe]`, `.farbe-punkt`, `.farbe-swatch`
und `.kal-punkt` in `style.css`. Die Auswahl (`.farbe-popup`) ist 208 px breit:
sieben Punkte je Reihe, bei zwölf Farben plus „Keine“ zwei Reihen. Im
Dunkelmodus stand Indigo erst zu nah an Blau, er hat jetzt `#595dcc`.

**Monatswahl beim Kalender (18.10.2026).** Wo der Kalender als Spalte rechts
steht (`html.kal-split`), geht die Monatswahl (`#kalWahl`) über dieser Spalte
auf, direkt unter dem Monatsnamen, statt mittig auf dem Bildschirm: Hendrik
musste mit der Maus quer durchs Fenster. Technisch nur `padding` am Overlay
(`calc(100% - var(--kal-breite))` links, 84 px oben); der Hintergrund bleibt
ganzflächig abgedunkelt. Am Handy und unter 1000 px bleibt sie mittig. Tag-Karte
und Rückfrage sitzen weiter mittig, die hat Hendrik nicht genannt.

**Termin-Fenster sitzt oben fest (18.10.2026).** `#kalTerminPopup` (neu, ansehen,
bearbeiten und die Wiederholungs-Seite sind ein Kasten) hat am Rechner
`align-items: flex-start` und `padding-top: 8vh`, wie die Einstellungen. Mittig
sprang die Oberkante bei „Bearbeiten“, Ganztägig, Farbwahl und Wiederholung. Die
Regel steht in `@media (min-width: 561px)`: am Handy ist das Fenster Vollbild
(`.kal-popup-voll`), und die ID-Regel würde dessen `padding: 0` sonst schlagen.
Die Höhe braucht keine eigene Zeile, `max-height: 100%` von `.kal-popup-box` reicht
dann bis 20 px vor den unteren Rand.

**Ruhigeres Bild (19.10.2026).** Hendrik wollte Board, Heute-Spalte und Kalender
übersichtlicher, bei gleichem Inhalt. Er hat aus Vorschauen an seinen echten
Einträgen gewählt:

- **Serientermine im Raster leiser.** `kalender.js` setzt an Balken mit
  `termin.serieId` die Klasse `serie`. `.kal-balken.serie` hat keine Fläche und
  keine Kante (der 3-px-Rand bleibt durchsichtig, damit der Text bündig mit den
  Chips steht), Schrift 500 statt 600, Farbe unverändert. Einzeltermine bleiben
  Chips. Tagesliste, Tages-Karte und Termin-Fenster sind unverändert. Wer die Kante
  zurückhaben will: `border-left-color` aus der Serie-Regel nehmen. Verworfen:
  tägliche Serien ganz aus dem Raster nehmen.
- **Bereichsfarbe als Farbton statt Streifen.** `.column[data-farbe="…"]` setzt
  `--col-ton` (11 % Farbe in `--col-bg`, im Dunkelmodus 15 %, über `--ton-anteil`),
  `.column` nimmt `var(--col-ton, var(--col-bg))`. Das ist Absicht und kein
  `background` an der Farbregel: `.column.drop-target` behält so seine Fläche. Der
  Ampel-Streifen an den Karten ist seitdem der einzige Streifen am linken Rand.
- **Heute-Spalte.** Das „heute“ an „Gewohnheiten“ entfällt, wenn die Spalte darüber
  heute zeigt (`setzeGewohnheitenChip()` setzt `tag-ist-heute` an `#fokHeute`, aus
  `zeichneHeuteSpalte` und `aktualisiereAuswahl`). Bei einem anderen gewählten Tag
  bleibt es, weil die Gewohnheiten immer für heute gelten. Die Kachel am Tablet und
  Handy (`#fokOben`) blieb beim „heute“ unverändert.
- **Stift an den Gewohnheiten: weg (Nachrunde am selben Tag).** Erst nur beim
  Darüberfahren sichtbar, dann wollte Hendrik ihn ganz weg: Bearbeiten geht in den
  Einstellungen (`gewohnheiten.js`, `gewOeffneDialog`). Entfernt sind `fokStift()`
  in `fokus.js`, `window.gewOeffneBearbeiten` in `gewohnheiten-dialoge.js` und alle
  `.fok-stift`-Regeln, auch in der Kachel am Tablet und Handy, weil dort dieselbe
  Karte gezeichnet wird.
- **Karten im Farbbereich lassen den Farbton durchscheinen** (Hendrik: „bei Schule
  sieht man die Farbe kaum, eher viel weiß“). `.column[data-farbe] .todo` mischt
  `--row` zu `--karte-deckkraft` (55 %) mit `--col-ton` zu einer deckenden Farbe
  (`--karte-grund`), keine echte Transparenz: der Schleier der Hover-Knöpfe
  (`.actions`) braucht dieselbe deckende Farbe, sonst stünde dort ein hellerer
  Fleck. Erledigte Karten (`.is-done`) bleiben durchsichtig, ihr Schleier nimmt
  jetzt ebenfalls `--col-ton` (nach dem Farbton-Umbau stand dort noch das Grau).
  Bereiche ohne Farbe haben weiter weiße Karten. Regler: `--karte-deckkraft`
  (70 % wirkte kaum, 55 % deutlich, aber noch als Karte lesbar).
- **Ganztägige Termine einzeilig.** In `baueTerminZeile()` entfällt die zweite
  Zeile „Ganztägig“: das Kalender-Symbol in der Zeitspalte sagt es schon, und bei
  zwei Terminen standen vorher zwei Zeilen mit demselben Wort (37 statt 57 px je
  Zeile). Ein fremder Kalender steht weiter darunter, Termine mit Uhrzeit sind
  unverändert („12:15 – 13:15“ bleibt, das hatte Hendrik am 10.10. so entschieden).
  Für Screenreader trägt die Zeile ein `aria-label` („Titel, ganztägig“). Gilt
  überall, wo `baueTerminZeile()` läuft: Heute-Spalte, Tagesansicht oben, Tages-Karte.
- **Falle beim Testen:** `testdaten-lokal.js` braucht eine `serieId` an den Terminen
  für die Serien (steht jetzt drin). Nach jedem Neuladen den Stil
  `*{transition:none}` neu einhängen, sonst fotografiert man Zwischenfarben (ein
  grauer Schleier über allem). Scharfe Bilder gibt es nur bei schmalem Fenster
  (560 px); bei 1600 × 900 zeigt der Screenshot nur einen Ausschnitt. sw.js v48.

**Ungeprüft:** echtes iPad und echtes Handy (nachgestellt mit 1180 × 820 bzw.
375 × 812 im Testbrowser), echte Google-Termine (nachgebaute Antwort aus der
lokalen Testhilfe `testdaten-lokal.js`, nicht im Repo), der Zug am
Breiten-Griff mit der Maus.

## Google Kalender

Verknüpftes Google-Konto je Nutzer, **ausschließlich lesend**
(bis 18.10.2026 `calendar.readonly`, jetzt `calendar.calendarlist.readonly` und `calendar.events`, siehe unten). Die Termine erscheinen im Kalender-Panel neben
den ToDos; die App schreibt bei Google nichts und fragt auch keine
Schreibrechte an. Serverteil in `functions/api/google/` plus
`functions/_lib/google.js`, Anzeige in `kalender.js`.

**Ablauf.** OAuth 2.0 Authorization Code, komplett serverseitig: Der
Verbinden-Knopf verlässt die Seite Richtung Google (`/api/google/start`,
302 — ein `fetch` könnte den Zustimmungsdialog nicht anzeigen), Google leitet
auf `/api/google/callback` zurück, der tauscht den Code gegen Tokens. Der
geheime Client-Schlüssel bleibt im Worker, **der Browser sieht nie ein
Google-Token** — er fragt immer nur unsere eigenen Endpunkte. Ein
Zufallswert (`state`) geht gleichzeitig an Google und in ein kurzlebiges
Cookie; nur wer beides vorweist, kommt durch.

**Der Verbinden-Knopf steht an zwei Stellen** (Hendrik am 18.10.2026): in den
Einstellungen (`#googleVerbinden`, app.js) und direkt im Tag - unter „Kein
Google-Kalender verbunden." in der Heute-Spalte, in der Kachel „heute" und in der
Tages-Karte (`baueGoogleVerbinden()` in `kalender.js`, `.kal-google-verbinden`).
Beide tun dasselbe (`location.href = "/api/google/start"`). Der im Tag erscheint nur,
wenn `googleZustand.moeglich` stimmt (Zugangsdaten im Pages-Projekt hinterlegt,
sonst liefe er in einen Fehler) und nur im bedienbaren Tag, nicht in den
Nachbarkarten der Tages-Karte. Lokal führt er mit der Test-Client-ID zu Googles
Fehlerseite „invalid_client" - das ist erwartet, der Weg bis dahin ist der richtige.

**Warum nicht der Browser-Weg.** Google Identity Services im Frontend käme
ohne Client-Schlüssel und ohne Datenbank aus, gibt aber kein Refresh-Token
heraus: nach spätestens einer Stunde bzw. bei jedem neuen Besuch müsste man
erneut zustimmen. Für eine PWA, die man aus dem Homescreen startet, ist das
zu wenig.

**Falle: Status „Testing" killt die Verknüpfung wöchentlich.** Solange die
App in der Google Cloud Console nicht auf **„In Produktion"** steht,
verfallen Refresh-Tokens nach 7 Tagen — die Verbindung bricht dann ohne
erkennbaren Grund immer wieder ab. „In Produktion" heißt NICHT
verifiziert: ohne Google-Prüfung bleibt es bei der einmaligen Warnung
„Google hat diese App nicht verifiziert" und höchstens 100 verknüpften
Konten, aber die Tokens halten.

**Falle: ohne `prompt=consent` kommt beim ZWEITEN Mal kein Refresh-Token.**
Google gibt es nur bei der ersten Zustimmung eines Kontos heraus, wenn man
nicht ausdrücklich erneut fragt. `callback.js` bricht deshalb hart ab, wenn
kein `refresh_token` dabei ist, statt eine Verbindung anzubieten, die morgen
tot ist.

**Verifizierung bei Google (vorbereitet am 18.10.2026).** Hendrik hat sich im August
dagegen entschieden und am 18.10. umentschieden, weil die App inzwischen mehrere Konten
hat und die Warnung die Adresse des Betreibers zeigt. Vorbereitet und live: die
Datenschutzerklärung `datenschutz.html` (Adresse `/datenschutz`, deutsch mit englischer
Zusammenfassung und dem Limited-Use-Satz), der Link dorthin auf der Anmeldemaske
(`.lock-fuss`) und ganz unten in den Einstellungen (`.ein-rechtsfuss`; bis zum
18.10.2026 stand er stattdessen am Listenende, Hendriks Wunsch), und die
**schmalere Berechtigung**:
`calendar.calendarlist.readonly` statt `calendar.readonly` (Kalenderliste und Farbpalette),
dazu `calendar.events` für Termine. Gegen die Berechtigungslisten der Google-Methoden
geprüft, **nicht** gegen ein echtes Konto durchgespielt. Die Schritte für Hendrik, die
englischen Begründungen und das Video-Drehbuch stehen in `ToDo/Google-Verifizierung.md`
(außerhalb des Repos, weil `web/` komplett öffentlich ausgeliefert wird). Kein Impressum:
Hendrik will seine Anschrift nicht veröffentlichen.
**Teilweise erteilte Berechtigungen (18.10.2026):** Googles Dialog hat ein Häkchen je Berechtigung, bei nicht
verifizierten Apps stehen sie zunächst alle leer. `callback.js` prüft deshalb mit `kalenderRechteVollstaendig()`,
ob Kalenderliste UND Termine erteilt wurden; sonst wird nichts gespeichert, der Zugriff bei Google gleich
widerrufen und die App zeigt `?google=unvollstaendig`. Vorher hätte ein fehlendes Häkchen die Verbindung beim
ersten Abruf als „getrennt“ gelöscht, ohne Erklärung. Google verlangt diesen Umgang mit Teil-Zustimmung.

**Einrichtung (einmalig, in der Google Cloud Console).** Projekt anlegen →
Calendar API aktivieren → OAuth-Zustimmungsbildschirm (Extern, Bereiche
`openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events`) → Status „In Produktion" →
Anmeldedaten → OAuth-Client-ID (Webanwendung) mit den Weiterleitungs-URIs
`https://todo.it-wolf.org/api/google/callback` und
`http://localhost:8790/api/google/callback`. Client-ID und -Schlüssel dann als
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` ins Pages-Projekt — **danach ein
leerer Commit**, sonst greifen neue Umgebungsvariablen nicht (siehe
Abschnitt Benachrichtigungen). Fehlen die Variablen, meldet
`/api/google/status` `moeglich:false` und der ganze Abschnitt bleibt in den
Einstellungen unsichtbar, statt in einen Fehler zu laufen.

**Datenbank.** Eine Zeile je Nutzer in `google_konten` (`migration-google.sql`,
rein additiv). `zugriff_token`/`zugriff_bis` sind nur ein Zwischenspeicher für
das einstündige Zugriffs-Token — ohne ihn kostete jeder Termin-Abruf einen
zusätzlichen Umtausch bei Google. Tokens liegen im Klartext: ein Schlüssel auf
demselben Server würde nur Sicherheit vortäuschen. Das Konto hängt per
`ON DELETE CASCADE` am Nutzer, eine Kontolöschung räumt es also mit weg.

**Nur der Hauptkalender.** `termine.js` filtert die Kalenderliste auf
`primary`; abonnierte Kalender (Kalenderwochen, Feiertage, Geburtstage)
tauchen weder als Umschalter noch als Balken auf. Über den `primary`-Schalter
statt über Namensmuster: eine Erkennung an der Beschriftung bräche, sobald so
ein Kalender anders heißt. Ausschlaggebend war ein abonnierter
Kalenderwochen-Kalender, der quer durch jede Woche einen Balken zog.

**Name statt E-Mail-Adresse.** Google gibt für den Hauptkalender die
E-Mail-Adresse als Bezeichnung heraus, einen Anzeigenamen liefert die
Kalender-Schnittstelle nicht mit. `kalenderName()` setzt deshalb den Namen aus
dem ToDo-Konto (`eigenerName`) ein. Der echte Google-Anzeigename bräuchte die
zusätzliche `profile`-Berechtigung und ein erneutes Verknüpfen — bewusst nicht
gemacht. In den Einstellungen steht weiterhin die Adresse („verbunden als …"),
dort beantwortet sie die Frage, WELCHES Konto hängt dran.

**Termine.** `/api/google/termine?von=&bis=&kalender=` liefert immer die
Kalenderliste (für die Umschalter) und die Termine der angefragten Kalender;
ohne `kalender`-Parameter nur den Hauptkalender. Der Server fragt
ausschließlich Kalender-IDs ab, die er selbst gerade in der Kalenderliste
gesehen hat — eine ungeprüft durchgereichte ID wäre eine fremdgesteuerte
Anfrage mit unserem Token. `singleEvents=true` lässt GOOGLE die Serientermine
auflösen; RRULE, Ausnahmen und Zeitzonen rechnet die App nicht selbst nach.
Höchstens 8 Kalender gleichzeitig (`MAX_KALENDER`).

**Fehler antworten mit 200.** Ist Google nicht erreichbar, kommt
`{fehler:true}` statt eines Statuscodes zurück, und das Panel schreibt eine
Zeile „Google-Termine gerade nicht erreichbar" unter die ToDos — die bleiben
sichtbar. Nur bei `invalid_grant` (Zugriff bei Google widerrufen) löscht der
Endpunkt die Zeile und meldet `getrennt`, damit die App wieder „verbinden"
anbietet statt endlos in denselben Fehler zu laufen.

**Der letzte Terminstand liegt im Browser** (seit 20.08.2026,
`kalTermineSpeicher`). Beim Öffnen zeichnete der Kalender früher erst nur die
ToDos; trafen die Termine ein, bekamen die Wochen ihre Balkenspuren und der
ganze Streifen sprang. Jetzt wird der gemerkte Stand **sofort** gezeichnet und
die Anfrage an Google ersetzt ihn still. Der Preis, bewusst in Kauf genommen:
einen Sekundenbruchteil lang steht ein minimal veralteter Stand da.

**Der Schlüssel trägt die Kontoadresse**, den Monatsanfang und die abgefragten
Kalender-IDs. Die Adresse ist die zweite Absicherung neben dem Löschen:
meldet sich am selben Browser jemand anderes an, greift dessen Schlüssel gar
nicht erst auf fremde Termine zu. app.js verschachtelt seinen eigenen
Zwischenspeicher aus demselben Grund pro Konto.

**Sechs Einträge, nicht drei.** Der erste Abruf eines Monats geht OHNE
`kalender`-Parameter raus — die Kalenderliste kennt die App zu dem Zeitpunkt
noch nicht —, der zweite mit. Pro Monat entstehen also zwei Einträge, und ein
Deckel von drei hätte kaum anderthalb Monate behalten. Beide sind nützlich: aus
dem ersten holt der Speicherzweig die Kalenderliste, damit der nächste Abruf
gezielt fragt.

**Geleert wird an drei Stellen**, sonst zeigt der Kalender Termine, die dort
nicht mehr hingehören: beim Abmelden (`logout()` in `app.js` — der Neustart
wirft nur den Arbeitsspeicher weg, nicht den `localStorage`), beim Trennen
(`kalenderGoogleVergessen`) und wenn die Antwort `verbunden:false` meldet.

**`moeglich` und `schreiben` kommen NICHT aus dem Speicher.** Ob geschrieben
werden darf, entscheidet der Server; ein gemerktes `schreiben:true` böte ein
＋ an, das in einen 403 liefe.

**Bei `fehler:true` bleiben die vorhandenen Termine stehen** und es wird nichts
geschrieben. Beides gehört zusammen: Ohne das Stehenlassen holte der
Zwischenspeicher den Stand herauf und die Fehlerantwort räumte ihn im selben
Atemzug wieder weg — genau das Springen, gegen das er gebaut ist. Und eine
Fehlermeldung ist kein Terminstand, taugt also auch nicht zum Merken.

**Das Raster fällt beim Nachladen nicht mehr flach zusammen.** `spurenVorher`
hält die Spurenzahl je Woche vom letzten Zeichnen; solange für den Monat noch
keine frische Antwort da ist (`googleLaedt || !googleGeladen`), gilt sie als
Untergrenze. **Nicht nur während `googleLaedt`**: das erste Zeichnen passiert
VOR der Anfrage, und genau dort fällt das Raster sonst zusammen, um beim
Eintreffen der Termine wieder aufzugehen.

`spurenVorherMonat` hält fest, für welchen Monat die Zahlen gelten — ein
anderer Monat hat andere Wochen, dessen Spurenzahl wäre geraten. Geprüft wird
das in `zeichneRaster()` selbst und nicht an den drei Stellen, die den Monat
setzen: eine Stelle kann man nicht vergessen, drei schon.

`kalenderGoogleVergessen` leert `spurenVorher` mit. Sonst hielte die Untergrenze
das Raster auf der Höhe von Terminen, die es nach dem Trennen gar nicht mehr
gibt.

**Anzeige.** Seit 13.08.2026 stehen im Tagesbereich die **ToDos zuerst** und
die Termine darunter. Der Streifen beantwortet zuerst „was muss ich heute
tun" — und die Termin-Überschrift samt ihrer Leerzeile („Kein Google-Kalender
verbunden.") schob diese Antwort vorher bei jedem Öffnen nach unten aus dem
Blick.

**Ganztägige Termine stehen vor den zeitgebundenen**: sie rahmen den Tag,
statt in ihm zu liegen. Innerhalb der zeitgebundenen bleibt es chronologisch.
Vom 13.08. bis 25.09.2026 hatten sie einen eigenen Abschnitt „Ganztägig“;
seitdem stehen beide in EINEM Abschnitt „Termine“, die ganztägigen mit
Kalender-Symbol in der Zeitspalte (siehe „Samsung-Umbau“).

**Der Termin-Abschnitt steht immer da**, mit ＋, und ohne Termine mit der
erklärenden Leerzeile. Für die ToDos gilt dasselbe: ihr Abschnitt bleibt
auch leer stehen („Nichts fällig."), weil das die eigentliche Frage des
Streifens beantwortet.

**Die Zeilen sind bewusst knapp bemessen** (seit 13.08.2026): `.kal-eintrag`
hat 7 px Innenabstand statt 9, die Liste 5 px zwischen den Zeilen statt 6.
Zusammen rund 30 px bei acht Zeilen. **Weiter runter geht es nicht** — eine
einzeilige Zeile misst so noch 35 px, und darunter trifft man sie am Handy
nicht mehr zuverlässig.

**Die Abschnitte trennen sich sichtbar** (seit 21.08.2026, `.kal-gruppe`):
Linie darüber, Symbol davor (⚠️ / ☑️ / 📅) und die volle Textfarbe statt Grau.
Hendriks Beobachtung am Handy war, dass ToDos und Termine „nicht übersichtlich
getrennt" seien — und tatsächlich sahen beide Überschriften bis dahin gleich
aus: dieselbe kleine graue Kapitälchen-Zeile, die man lesen musste, um zu
wissen, wo man gerade ist. Das Symbol steht in einem eigenen `<span>`
(`.kal-gruppe-symbol`) mit eigener Größe und ohne Sperrsatz — es ist ein Bild,
kein Buchstabe — und trägt `aria-hidden`, weil die Beschriftung daneben schon
alles sagt.

Der Preis sind rund **7 px je Abschnitt** (Linie plus Abstand). Der erste
Abschnitt bekommt keine Linie: darüber steht schon der Tagestitel, und zwei
Trenner in drei Zeilen sind einer zu viel. Dafür gibt es ZWEI Regeln —
`.kal-gruppe:first-child` und `.kal-liste-kopf + .kal-gruppe`. Die zweite ist
die, die im Normalfall greift (vor dem ersten Kopf steht das `h3` mit dem
Datum); die erste fängt den Fall ohne Tagestitel ab.

**Zellen: Zahl oben, Rest darunter.** `justify-content: flex-start` statt
`center` — sonst wandert die Tageszahl je nach Anzahl der Balken auf und ab und
steht in einer Zeile nicht mehr auf gleicher Höhe. Radius 4 px (vorher 9): im
Vergleich mit Googles Monatsansicht wirkte das Raster zu stark abgerundet.

**Das Raster gibt nach, wenn der Tagesbereich Platz braucht** (seit
13.08.2026). Die Zellen tragen deshalb KEINE `min-height` mehr — die
Zeilenhöhe kommt aus dem Raster selbst:

* `flex: 1 1 auto` — das Raster füllt seinen Block (`.kal-oben`), statt eine
  eigene Wunschhöhe zu behaupten. Es hatte einmal `height: calc(--kal-zeilen *
  58px + …)`; damit war der Kalender-Teil 50 px höher als der Fokus-Teil, weil
  Kopf und Wochentage noch dazukamen. Die 58 px waren ohnehin als UNTERgrenze
  für die Optik gedacht (neben Googles Monatsansicht wirkte weniger gestaucht),
  nicht als Deckel — ein Monat mit vier Rasterzeilen bekommt jetzt höhere
  Zellen statt einer Lücke darunter.
* `--kal-zeilen` setzt `zeichneRaster()` beim Zeichnen (4 bis 6 Wochen) — nur
  noch für die Untergrenze.
* `min-height` mit 36 px je Zeile ist eben diese **Untergrenze**: darunter
  passen Tageszahl (20 px) und Punktreihe (bis 29 px) nicht mehr übereinander.
* `grid-auto-rows: minmax(0, 1fr)` verteilt die Blockhöhe auf die Zeilen. Ohne
  das blieben sie auf ihrer Inhaltshöhe stehen.

**Der Auslöser sitzt aber woanders** — an `.kal-liste`: ohne deren
`min-height` bekäme die Tagesliste nur den Rest, der nach dem Raster übrig
bleibt, und das Raster hätte keinen Grund nachzugeben. Erst die Mindesthöhe
macht den Platz knapp. Sie gilt ab 780 px Fensterhöhe (`min(360px, 44vh)`);
darunter reichen beide Mindestmaße zusammen nicht mehr, und ein scrollender
Tagesbereich ist besser als ein Raster, das aus dem Panel läuft.

**Entfallen am 09.10.2026, siehe „Board | Heute | Kalender“.** **Die Aufteilung ließ sich ziehen** (seit 20.08.2026): ein waagerechter Griff
zwischen Tagesliste und unterem Teil (`#kalGriffTeilung`), gemerkt unter
`kalTeilung` als Höhe der Tagesliste in Pixeln. Ohne gezogenen Wert bleibt
alles beim oben Beschriebenen samt der Grenze bei 780 px; mit gezogenem Wert
greift `html.kal-eigene-teilung`, und die Liste bekommt eine feste Höhe. Was
nicht hineinpasst, scrollt in seinem Bereich.

`flex: none` ist dabei Pflicht: mit dem sonst geltenden `flex: 1` dehnte sich
die Liste über die eingestellte Höhe hinaus, und der Griff hätte gar keine
Wirkung.

**Der Griff statt „Liste schrumpft auf ihren Inhalt".** Die naheliegende
Alternative wäre gewesen, die Tagesliste nur so hoch zu machen, wie sie
Inhalt hat — dann gäbe es den Leerraum gar nicht. Sie ist verworfen, weil das
Raster damit bei jedem Tageswechsel auf und ab würde: ein leerer Tag höbe es
an, ein voller drückte es herunter. Genau dieses Wandern war einer der
Gründe, den Streifen überhaupt anzufassen.

**`teilungMax()` rechnet ab der OBERKANTE der Liste**, nicht ab der Panelhöhe.
Über der Liste stehen noch Kopfzeile und Umschalter; wer die mitzählt, lässt
den Griff das Raster unter seine Mindesthöhe drücken (gemessen: 226 px statt
300 px für `#kalOben`). `rasterMindest()` ist dabei die Höhe des ganzen oberen
Blocks — 36 px je Rasterzeile plus 84 px für Monatskopf und Wochentage.

**Falle: der gemerkte Wert darf beim Klemmen nicht zurückgeschrieben werden.**
`wendeTeilungAn()` klemmt nur für die Anzeige und fasst `localStorage` nicht
an. Sonst wäre eine am großen Bildschirm eingestellte Aufteilung nach
einmaligem Öffnen auf einem niedrigen Fenster dauerhaft verloren. Aufgerufen
wird die Funktion an drei Stellen: beim Laden, in `pflegeSplit()` (die
Fensterhöhe ändert die Grenze) und am Ende von `zeichneKalender()` (ein
anderer Monat kann eine Rasterzeile mehr haben).

**Im Vollbild gibt es den Griff nicht** — `.kalender.vollbild` blendet die
Tagesliste ohnehin aus, und ein Griff ohne etwas zu greifen wäre eine tote
Fläche.

**`gestenZone()` gibt auf einem Griff `null` zurück.** Ohne das könnte ein
leicht schräger Zug am Handy als Wisch durchgehen und das Panel zumachen,
während man die Aufteilung einstellt. `touch-action: none` am Griff allein
reicht nicht: die Wischgeste hängt an `touchstart` am Dokument und sieht die
Berührung trotzdem.

Gemessen am Handy (375×812), voller Monat mit 6 Wochen: Tagesliste 197 → 357 px
(kein Scrollen mehr), Raster 358 → 275 px bei Zellen von 44 px. Am Rechner
(900 px): Tagesliste 306 → 409, Raster 332 bei 54 px Zellen. Ein Februar mit
nur 4 Rasterzeilen bekommt dort 82 px hohe Zellen — der Block bleibt gleich
hoch, die Zellen wachsen mit.

**Jeder Tag hat einen dezenten Rahmen**, der gewählte einen Ring
(`box-shadow: inset`, damit die Rasterlinie stehen bleibt und nichts um einen
Pixel verrutscht). Vorher war der gewählte Tag vollflächig blau — das schluckte
Balken, Punkte und Tageszahl gleich mit.

**Punkt = ToDo, Balken = Termin.** Die Unterscheidung läuft über die FORM, nicht
über den Farbton — Bereichsfarben und Google-Kalenderfarben können sich gleichen.
Ein erster Versuch mit farbigen RINGEN als Termin-Punkt fiel im Gebrauch durch:
bei 6 px Durchmesser war die Google-Farbe praktisch nicht zu erkennen, und die
Termine hoben sich zu wenig ab. In der Tagesliste trägt die Termin-Zeile deshalb
einen 5 px breiten Farbbalken am linken Rand und eine ruhigere Fläche als ein
ToDo.

**Durchgezogene Linie über mehrere Tage.** `termineNachTagen()` legt je Termin
UND Tag einen Eintrag an und vermerkt, ob der Termin links bzw. rechts
weitergeht; das Raster zieht den Balken dann mit negativen Rändern über die
Zellgrenze (3 px Innenabstand + 1 px Zellrand + 2 px Rasterlücke + 1 px + 3 px
= 10 px zwischen zwei Balken, also −5 px je Seite). Am Wochenrand endet die
Linie bewusst — Spalte 0 bekommt keinen linken, Spalte 6 keinen rechten
Anschluss, sonst zöge der Balken quer über den Zeilenumbruch. Vorher stand an
jedem Tag ein einzelner Punkt, was einen mehrtägigen Termin wie mehrere
einzelne aussehen ließ.

**Der Balken traegt seinen Titel.** Ein mehrtaegiger Termin bekommt EINEN
Balken am Anfang seines Abschnitts in der Zeile, der ueber alle seine Tage
reicht und den Titel einmal traegt; die folgenden Tage decken ihre Spur mit
einem unsichtbaren Platzhalter ab, damit die Reihenhoehe stimmt und nichts
doppelt gezeichnet wird. Umgesetzt ueber die BREITE, nicht ueber absolute
Positionierung: `--spanne` sagt, wie viele Tage der Abschnitt umfasst, und der
Balken waechst je weiterem Tag um eine Stapelbreite plus die 10 px zwischen
zwei Stapeln — er laeuft damit sichtbar aus seiner Zelle heraus. `flex: none`
verhindert, dass die Breite wieder zurueckgestaucht wird, `overflow: hidden`
schneidet den Titel am Ende des Termins ab statt ihn in fremde Tage laufen zu
lassen, und `position: relative` + `z-index: 1` heben ihn ueber den Hintergrund
der ueberdeckten Nachbarzellen (etwa den gewaehlten Tag).

**Jeder Balken trägt seinen Titel, auch der eintägige.** Vom 20. bis zum
21.08.2026 war das anders (`TITEL_AB_TAGEN = 2`): Bei rund 55 px Spaltenbreite
blieb von „Finn Hausaufgaben" nur „Finn H…" übrig, der Text kostete Zellhöhe
und sagte scheinbar nichts. Hendriks Entscheidung nach einem Tag damit war die
Gegenrichtung — ein abgeschnittener Name sagt mehr als ein namenloser
Farbbalken: im Raster stand sonst nur „da ist was", ohne zu verraten, was.
`title` und `aria-label` sitzen zusätzlich am Balken und tragen den
vollständigen Namen.

**Nicht erneut vorschlagen**, den Titel an eine Mindestbreite oder eine
Mindestspanne zu hängen — beides war gebaut und ist bewusst gefallen.

**Eine flachere Spur für titellose Wochen war gebaut und ist wieder raus.** Die
Idee war, in Wochen ohne mehrtägigen Termin Höhe zurückzugewinnen. Sie gewinnt
keine: Seit das Raster seine Höhe vom Container bekommt (`flex: 1 1 auto` plus
`grid-auto-rows: minmax(0, 1fr)`, siehe oben), ändert die Balkenhöhe daran
nichts — gemessen 378 px Rasterhöhe mit und ohne. Geblieben wären nur
unterschiedlich dicke Balken von Woche zu Woche. Wer die Idee wieder aufgreift,
müsste zuerst das Raster wieder inhaltsgetrieben machen — und das war eine
bewusste Entscheidung in die andere Richtung.

**Falle: `1fr` waechst mit dem Inhalt.** Mit `repeat(7, 1fr)` zog der
ueberbreite Balken die Rasterspalten mit auf — ein Sieben-Tage-Balken war
837 px statt 320 breit und schob das ganze Raster aus dem Panel.
`repeat(7, minmax(0, 1fr))` nimmt den Spalten das automatische Mindestmass.

**Schriftfarbe auf dem Balken** rechnet `kontrastFarbe()` aus der
Google-Farbe (relative Helligkeit nach WCAG): dunkel auf hellen Farben, weiss
auf dunklen. Fest weiss waere auf Googles Gelb (#f6bf26) nicht zu lesen.

Die Zellen haben deshalb keine feste Quadratform mehr, sondern wachsen mit dem
Inhalt (44 px leer, 46 px mit einer Spur, 62 px mit zweien) — und `MAX_SPUREN`
steht bei **2**: drei Reihen mit Text wuerden das Raster so weit aufblaehen,
dass fuer die Tagesliste darunter kaum Platz bliebe.

**Feste Spuren im Raster.** `baueSpurenplan()` gibt jedem Termin EINE Reihe,
die er über alle seine Tage behält; freie Reihen werden als unsichtbare
Platzhalter mitgezeichnet. Vorher wurden die Balken je Tag neu einsortiert —
kam an einem Tag ein Einzeltermin dazu, rutschte der mehrtägige in eine andere
Reihe oder fiel unter die damalige Zwei-Balken-Grenze, und die durchgezogene
Linie riss auf (live aufgefallen, 10.08.2026). Sortiert wird nach **Länge
zuerst**: lange Termine belegen ihre Spur als Erste, an einem vollen Tag weicht
also eher ein Einzeltermin unter das „+". Höchstens `MAX_SPUREN` Reihen (siehe oben);
wie viele eine Zelle zeichnet, entscheidet die WOCHE, nicht der Tag — sonst
lägen gleiche Spuren in einer Zeile auf verschiedenen Höhen.

Das „+" erscheint nur, wenn wirklich etwas weggelassen wurde (mehr als drei
ToDo-Punkte oder ein Termin ohne Spur) — nicht schon, sobald an einem Tag vier
Dinge stehen, die alle sichtbar sind.

**Kalenderwoche** in einer schmalen Spalte links vor Montag, klein und
zurückgenommen — Orientierung am Rand, keine Information, die mit den Tagen um
Aufmerksamkeit konkurriert. `kalenderwoche()` rechnet nach ISO 8601 (Woche 1
ist die mit dem ersten Donnerstag; der Umweg über den Donnerstag derselben
Woche erledigt den Jahreswechsel von selbst). **Bewusst selbst gerechnet**,
nicht aus einem abonnierten Google-Kalender gelesen: so steht die Zahl auch
offline und ohne Google-Verknüpfung da und hängt nicht an der Beschriftung
eines fremden Kalenders. Wer so einen Kalender abonniert hat, schaltet ihn über
seine Pille ab — sonst zeichnet er zusätzlich seine Balken.

**Farben.** Der Server liefert je Termin eine fertig aufgelöste Farbe: die
EIGENE Farbe des Termins (`colorId`, in Google pro Termin einstellbar) schlägt
die Farbe seines Kalenders. Die Palette dahinter (`/colors`) wird nur geholt,
wenn im Zeitraum überhaupt ein Termin eine eigene Farbe trägt — sonst wäre es
eine Google-Anfrage umsonst. Vor dem Einsetzen in einen `style`-Wert prüft
`farbWert()` gegen `#rrggbb`; alles andere wäre fremder Text in unserem CSS.

Google-Termine zählen **nicht** in den Überfällig-Abschnitt und nicht in die
App-Icon-Badge — das sind keine Aufgaben. Beschreibungen kommen teils als HTML
und werden entschärft (Tags raus) und als reiner Text gesetzt.

**Der Tagesbereich hat zwei feste Abschnitte** — „Termine" und „ToDos", jeder
mit einem ＋ in der Überschrift, auch wenn er leer ist. Ein leerer Abschnitt ist
die ehrlichere Antwort auf „was ist an dem Tag?" als gar keiner, und das ＋
sitzt da, wo man es sucht. Beim Tageswechsel und beim Schließen räumt
`schliesseEingaben()` ein halb ausgefülltes Formular weg — es gehört zu genau
einem Tag.

**Formularwerte liegen in `formularFelder`, nicht im DOM.** Das Panel baut sich
bei jeder Änderung neu auf; ein halb ausgefülltes Formular wäre sonst weg.
Gleiche Überlegung wie bei `anlegenText`.

**Anlegen aus dem Kalender.** Unter der Überschrift ein Feld mit zwei Knöpfen
(„Anlegen" und „Abbrechen"): Das ToDo landet in der gerade AKTIVEN Liste und
dort ohne Bereich — der Kalender kennt keinen Bereich, und „Ohne Bereich" ist
genau der Auffang dafür.

**Die Zeile schließt sich nach dem Anlegen** (`schliesseAnlegeZeile()`). Sie
blieb einmal offen, damit man mehrere hintereinander eintippen kann — nur gab
es dann gar keinen Weg mehr heraus: Escape leerte nur das Feld, und einen
Abbrechen-Knopf gab es nicht. Escape schließt jetzt und **stoppt dabei die
Weitergabe** (`stopPropagation`), sonst fängt der Panel-Handler denselben
Tastendruck ab und schließt gleich den ganzen Kalender. Das ＋ neben „Termine" erscheint nur, wenn die Verknüpfung
wirklich schreiben darf (`schreiben` aus `/api/google/status`) — ein Knopf, der
in einen 403 läuft, wäre schlechter als keiner.

**Seit dem 25.09.2026 gibt es die Zwischenmaske nicht mehr** — ein Tipp auf
einen Termin öffnet ihn im Formular als Ansicht (siehe „Samsung-Umbau“, zweite
Runde). Was hier folgt, ist die Vorgeschichte; die drei Punkte zu Maps-Link,
Links in der Notiz und Zeilenumbrüchen gelten in der Ansicht unverändert.

**Ein Tipp auf einen Termin öffnete die Zwischenmaske** (vom 21.08.2026 an,
`#kalDetailPopup` / `oeffneTerminDetail()`), nicht mehr das Formular. Vorher
galt: mit Schreibrecht führte der Tipp direkt ins Bearbeiten, ohne klappten Ort
und Notiz in der Liste auf. Beides war unbefriedigend — man musste „Abbrechen"
treffen, um nichts zu verändern, und eine lange Notiz schob im Aufklapp-Fall
alles darunter aus dem Bild. Die Maske ist derselbe Vollbild-Dialog wie das
Formular (eigenes Element, damit „Bearbeiten" sauber übergeben kann) und zeigt
Titel mit Farbbalken, Zeitraum in Worten, Herkunft bei Fremdkalendern, Ort und
Notiz. Unten „Bearbeiten" (nur mit Schreibrecht) und „Schließen"; Escape und
Klick daneben schließen ebenfalls.

„Bearbeiten" **löst die Maske ab, statt sich darüberzulegen** — offen ist immer
höchstens eins von beiden. Deshalb steht `formularOffen` im Escape-Handler
trotzdem zuerst.

Drei Dinge in der Maske, die man leicht falsch baut:

- **Der Ort ist ein Link zu Google Maps** (`maps/search/?api=1&query=…`,
  Adresse `encodeURIComponent`-kodiert). Bewusst der Web-Link und kein
  `geo:`- oder `maps://`-Schema: am Handy übernimmt ihn die installierte
  Karten-App von selbst, am Rechner öffnet er die Karte im Browser — ein
  App-Schema hätte dort ins Leere geführt.
- **Links in der Notiz werden erkannt** (`textMitLinks()`), aber nur `http://`
  und `https://`. Der Text kommt aus fremden Kalendern; `javascript:`
  zuzulassen wäre ein offenes Scheunentor. Alles andere bleibt `textContent`,
  nie Markup. Satzzeichen am Ende einer Adresse gehören zum Satz und fallen
  aus dem Link heraus.
- **Zeilenumbrüche der Google-Beschreibung bleiben** (`beschreibungAlsText()`
  wandelt `<br>` und schließende Block-Tags in `\n`, `<li>` in „• "), das Feld
  hat `white-space: pre-wrap` und **keine** Höhenbegrenzung. Eine Liste, die zu
  einem Absatz zusammenläuft, ist im Dialog schlechter lesbar als im Kalender
  selbst; gescrollt wird im Dialog, nicht im Feld.

**Schreiben in Google.** `functions/api/google/termin.js` legt an (POST),
ändert (PUT) und löscht (DELETE) — immer im Hauptkalender. Das Formular deckt
Titel, ganztägig/Uhrzeit, Start- und Enddatum (auch mehrtägig), Farbe aus
Googles Palette, Ort, Notiz und seit dem 24.09.2026 die Wiederholung ab
(Serientermine, siehe „Samsung-Umbau“). Richtung Google geht ein **PATCH**, kein PUT:
was das Formular nicht kennt (Ort, Gäste, Erinnerungen), bleibt damit stehen
statt still gelöscht zu werden. Zwei Eigenheiten stecken in `terminRumpf()`:
ganztägig braucht `{date}` mit dem Ende als erstem Tag DANACH, terminiert
`{dateTime}` samt Zeitzone (die schickt der Browser mit). Die Beschreibung
wird beim LESEN großzügig gekappt (8000 Zeichen), nicht knapp — sie geht beim
Bearbeiten wieder zurück an Google, und was hier fehlte, wäre dort weg.
Dafür trägt `SCOPES` zusätzlich `calendar.events`. **Wer vor dieser
Erweiterung verknüpft hat, hat den Scope nicht im Token**; `google_konten.scopes`
hält fest, was Google tatsächlich erteilt hat (der Nutzer kann im Dialog
einzelne Häkchen abwählen — angefragt ist nicht gleich erteilt), und
`darfSchreiben()` entscheidet daran. Der Weg zum Schreibrecht ist einmal
trennen und neu verbinden.

**Trennen fragt nach.** Der Knopf liegt direkt unter dem Verbunden-Text, und
der Weg zurück führt durch den ganzen Google-Zustimmungsdialog — deshalb eine
eigene Ansicht (`googleTrennenFrage`) wie bei Abmelden und Kontolöschung.

**Umschalter.** Eine Pille je ToDo-Liste und je Google-Kalender, dazu am Ende
eine Pille **KW** für die Kalenderwochen-Spalte — die ist zwar keine
Datenquelle, wird aber genauso an- und abgeschaltet und gemerkt (Schlüssel
`kw` im selben `kalQuellenAus`). Abgeschaltet fällt die erste Rasterspalte weg
(`.ohne-kw`), das Raster geht auf sieben gleich breite Spalten zurück. Ab zwei
Quellen gibt es den Trichter im Kalender-Kopf. Er öffnet seit dem 24.09.2026
ein Menü darunter (eine Zeile je Quelle, Haken rechts) statt einer
Pillenreihe, die sich zwischen Kopf und Raster schob. Zwei localStorage-Mengen: `kalQuellenAus` (abgewählt) und
`kalQuellenBekannt` (je gesehen). Ein NEU auftauchender Kalender startet
ausgeschaltet — außer dem Hauptkalender —, eine spätere eigene Entscheidung
wird davon nie wieder überschrieben.

**Wischgesten sind nach BEREICH aufgeteilt** (`gestenZone()`): über dem Raster
blättert der Wisch den Monat, über der Tagesliste den Tag, überall sonst
(Kopfzeile, Filterzeile, Monatswahl) schließt er weiter das Panel. Ohne diese
Aufteilung hätte das Blättern das Schließen per Wisch verdrängt — auf dem
Handy, wo das Panel die volle Breite hat, ist das der bequemste Weg heraus. In
Eingabefeldern greift gar keine Geste, dort zieht man Text.

Der Inhalt folgt dem Finger gedämpft (`MITGABE` = 0.35) und blättert erst ab
`BLAETTER_WEG` = 55 px wirklich um; darunter federt er zurück. Ohne diese
Rückmeldung fühlt sich der Wisch an, als hätte man danebengegriffen. Läuft der
Tageswechsel aus dem Monat heraus, blättert das Raster mit — sonst zeigte es
einen Monat, in dem der gewählte Tag gar nicht vorkommt.

**Genau diese Dämpfung wählte bis zum 20.08.2026 den falschen Tag.** Nach jedem
Wisch schiebt der Browser noch einen `click` nach, und der traf die Zelle, über
der der Finger ENDET. Weil das Raster nur 35 % des Weges mitgeht, wandert der
Finger relativ zu den Zellen: ein Wisch von 40 px landet gut einen halben Tag
weiter, und ein zu kurz geratener Blätterversuch sprang deshalb scheinbar
grundlos einen Tag weiter. `klickSchlucken` in `kalender.js` setzt einen Riegel,
sobald aus der Berührung ein Wisch geworden ist (also nach den 8 px, ab denen
die Achse feststeht), und löst ihn beim nächsten `touchstart` wieder. Ein echter
Tipp kommt an der Stelle nie vorbei. Gilt für BEIDE Achsen — auch der senkrechte
Vollbild-Wisch kann über eine Zellengrenze hinausführen.

**Hover am Kalender: zwei Fälle, zwei Ursachen, beide am 20.08.2026 behoben.**
- Am Touchscreen bleibt `:hover` nach einem Tipp am zuletzt berührten Tag
  kleben, bis man woandershin tippt — der graue Kasten stand dann neben der
  blauen Markierung wie eine zweite Auswahl. `.kal-tag:hover` steckt deshalb in
  `@media (hover: hover)`.
- Am Rechner baute `waehleTag()` über `zeichneKalender()` das ganze Raster neu.
  Die angeklickte Zelle verschwand mitsamt ihrem `:hover` aus dem Dokument, und
  der Ersatz darunter bekam ihn erst beim nächsten Mausruck. Ein Tageswechsel
  hängt jetzt nur noch die Klasse `gewaehlt` um und zeichnet die Tagesliste neu
  (`aktualisiereAuswahl()`) — am Raster ändert sich sonst ohnehin nichts.

**Monat und Jahr direkt wählen:** Ein Tipp auf den Monatsnamen klappt zwei
scrollbare Walzen auf (`zeichneWahl()`), Antippen setzt sofort. Die Jahre
reichen fünf Jahre um das heutige UND das gerade angezeigte Jahr, damit man
sich beim Blättern nicht aus der Liste herausarbeitet. Beide Walzen scrollen
ihren aktuellen Wert beim Öffnen in die Mitte — sonst startet die Jahreswalze
oben und man sucht erst, wo man steht.

**Ohne gewählten Tag bleibt der untere Bereich leer.** Dort stand vorher „In
diesem Monat steht nichts an" — das war schlicht falsch, im Monat konnte eine
Menge stehen, nur eben kein Tag ausgewählt sein.

**Panelbreite** ist am Rechner `min(480px, 100vw)`, auf Schirmen bis 620 px die
volle Breite (`100vw`, ohne linken Rand). Auf dem Handy bringt ein Streifen
daneben nichts außer weniger Kalender; geschlossen wird dort per Wisch nach
rechts, ✕ oder Escape.

**Nur teilweise getestet:** Der komplette echte Rundlauf mit Google
(Zustimmung, Code-Tausch, Termine holen) ist mangels Zugangsdaten lokal NICHT
durchgespielt worden. Geprüft sind: die erzeugte Zustimmungs-Adresse samt
allen Parametern, die `state`-Prüfung, der Abbruch durch den Nutzer, das
Verhalten ohne hinterlegte Zugangsdaten, ein echter (abgelehnter) Aufruf bei
Google mit ungültigem Token samt Fehlerzeile im Panel, sowie die gesamte
Anzeige gegen eine nachgebaute Google-Antwort (Uhrzeiten, mehrtägige
Ganztages-Termine, Details, Umschalter, Ring-Punkte, hell/dunkel). Der
`invalid_grant`-Zweig (Zugriff bei Google widerrufen) ist ungetestet.

## Gewohnheiten und Timer (Fokus-Panel)

**Seit Oktober 2026 Teil dieser App.** Die eigene Fokus-App
(`fokus.it-wolf.org`, Repo `fokus-app`) ist hier aufgegangen - Hendriks
Auftrag: "Fusion aus ToDo App und Fokus, damit die Fokus App weg kann". Alles,
was sie konnte, steht jetzt hier (seine Entscheidung: alles uebernehmen). Die
Daten lagen schon immer in derselben D1 - es gab keine Migration, nur der Code
ist umgezogen. Schema der Tabellen: `schema-fokus.sql` (gewohnheiten,
gewohnheit_logs, fokus_sitzungen, fokus_einstellungen).

**`fokus.it-wolf.org` leitet weiter** (seit 17.10.2026, Repo `fokus-app`,
eine einzige Function `functions/[[pfad]].js`): Seiten per 302 hierher, alte
Anmeldelinks samt `?t=` auf `/api/auth/link` hier (dieselbe Tabelle
`login_codes`), alte `/api/*`-Aufrufe bekommen 410 mit Hinweis, `/sw.js` baut
den Service Worker der alten App ab. Bewusst keine `_redirects`-Datei: die
greift nicht bei Functions und kennt keine Ausnahmen je Pfad. Der cron-job
der alten App (cron-job.org) bekommt seitdem 410 und kann weg.

**Wo was liegt:**

| Teil | Datei |
|---|---|
| Daten, Regel-Spiegel, Offline-Warteschlange, einziger Schreibweg fuer Tage (`gewSchreibeTag`) | `gewohnheiten-daten.js` |
| Gewohnheiten (Heute-Spalte am PC, sonst unter der Tagesansicht) | `fokus.js` |
| Fenster "Gewohnheiten" (Verlauf, Statistik) und die Gewohnheiten-Liste in den Einstellungen | `gewohnheiten.js` |
| Dialoge anlegen/bearbeiten und Tag nachtragen, Einstellungsabschnitte | `gewohnheiten-dialoge.js` |
| Endpunkte | `functions/api/gewohnheiten/*`, `functions/api/fokus/*` (nur noch die Zaehlweise der Flamme) |
| Regeln (Status, Flamme, heute dran/ruht/offen) | `functions/_lib/tag.js`, `heute.js`, `fokus.js` |
| Der Timer - seit 18.10.2026 eine Zeiterfassung | `zeiterfassung.js`, eigenes Kapitel "Zeiterfassung" unten |
| Abend-Erinnerung | `functions/_lib/erinnerung.js` (siehe "Benachrichtigungen") |

Die Skripte laden in dieser Reihenfolge: `app.js`, `kalender.js`,
`gewohnheiten-daten.js`, `fokus.js`, `gewohnheiten.js`,
`gewohnheiten-dialoge.js`, `zeiterfassung.js`. Alle neuen Namen auf oberster Ebene beginnen mit
`gew`, alle neuen CSS-Klassen mit `gw-` - die Fokus-App hatte eigene
`.kal-*`, `.hinweis`, `.popup-*`, die hier etwas anderes meinen. Wer sich
aendert, meldet es ueber `gewMeldeAenderung()`; Streifen und Fenster hoeren
zu (`gewBeiAenderung`) und zeichnen sich neu.

**Jedes Konto bekommt Gewohnheiten und Timer** (Hendriks Entscheidung,
gefragt). Die Endpunkte pruefen `todo_zugang` ueber `_lib/zugang.js` wie alles
hier, `users.fokus_zugang` liest keiner von ihnen mehr. Ein neues Konto sieht
im Abschnitt einen Leerzustand mit "＋ Gewohnheit anlegen" (`aktive: 0` in der
Antwort von `gewohnheiten/heute`).

**Fenster statt eigener Seite.** Verlauf (Monatskalender je Gewohnheit,
Nachtragen per Tipp, Wischen wechselt den Monat) und Statistik (7/30/90 Tage;
bis 18.10.2026 auch die Fokuszeit, Minuten pro Woche) stehen in `#gewFenster` (Verwalten - anlegen,
bearbeiten, Reihenfolge, Archiv, loeschen - seit 18.10.2026 in den
Einstellungen, siehe dort) - geoeffnet ueber den
Eintrag "Verlauf & mehr" in den Einstellungen (Reiter "Gewohnheiten"). Die Links
"Verlauf & mehr ›" bei den Gewohnheiten und "Fokuszeit pro Woche ›" beim Timer
gibt es seit 18.10.2026 nicht mehr (Hendrik: steht in den Einstellungen). Den
Stift an einer Karte, der den Bearbeiten-Dialog oeffnete, gibt es seit 19.10.2026
auch nicht mehr (Hendrik: Bearbeiten geht in den Einstellungen). Der Dialog war
damals Hendriks Entscheidung, gefragt; verworfen: eine eigene Seite (wirkte wie eine zweite App) und mehr
Reiter im Streifen (kein Platz). Die Ansicht-Pille bleibt bei zwei Segmenten.
Das Fenster steht ausserhalb des Kalender-Panels (transform-Falle), Escape und
die Zurueck-Taste schliessen es von innen nach aussen (`gewSchliesseOberste`,
eingehaengt in `schliesseObersteEbene` in kalender.js); solange es offen ist,
gibt es keine Rand-Wischgeste (`darfGeste`).

**Einstellungen** (seit 18.10.2026 verteilt auf die Reiter „Gewohnheiten" und
„Timer", eingeklappt; Aufbau siehe Kapitel „Einstellungen"):
- **Anzeige** - zwei Schalter, Gewohnheiten und Timer je fuer sich, jeder als
  Zeile „Anzeige" in seinem Reiter,
  pro Geraet in `localStorage.streifenGewohnheiten` / `streifenTimer`
  (Standard an; wer den alten gemeinsamen Schalter `fokusPanel` aus hatte,
  startet mit beiden aus). Der Schalter "Gewohnheiten" gilt fuer beide Orte der
  Liste (Heute-Spalte bzw. unter der Tagesansicht), "Timer" fuer den Knopf in
  der Kopfzeile. Gelesen ueber `window.fokusBereiche()` (fokus.js); ein
  umgelegter Schalter ruft `window.fokusEinstellungGeaendert()`. Bis 18.10.2026
  hiess der Abschnitt "Kalender-Streifen", weil beides Reiter im Streifen waren
  (bewusst nicht "Bereiche": so heissen hier die Spalten des Boards). Bis Oktober
  2026 war das EIN Schalter "Fokus im Kalender", davor ein 🔥 in der
  Kopfzeile.
- **Flamme zählt** - Zaehlweise der Flamme (insgesamt / in Reihe), Schalter-Zeile
  `#gewFlammenZeile`. Der JSON-Export daneben ist seit 18.10.2026 weg.
- **Gewohnheiten** (bis 18.10.2026 "Verwalten") - Liste mit Stift und
  Hoch/Runter, „Neue Gewohnheit", Archiv.
- **Verlauf & Statistik** - kein Abschnitt, sondern ein Eintrag, der das Fenster
  „Gewohnheiten" oeffnet (zwei Reiter: Verlauf, Statistik).
- **Statistik ›** (Reiter Timer) - oeffnet das Fenster `#zeitFenster` der
  Zeiterfassung. Bis 18.10.2026 standen hier die Standarddauer des Countdowns
  und "Fokuszeit ›" (eigenes Fenster `#fokuszeitFenster`, davor dritter Reiter des
  Fensters Gewohnheiten) - beides ist mit der Zeiterfassung weggefallen.

**Falle beim Exportieren nach `window`:** Eine Funktionsdeklaration auf oberster
Ebene eines klassischen Skripts IST schon `window.<name>`. Wer
`window.gewIstOffen = () => gewIstOffen() || …` schreibt, ueberschreibt damit die
Funktion selbst - sie ruft sich endlos auf (beim Bau des Fokuszeit-Fensters
passiert, im Test aufgefallen: Statistik blieb leer, Escape ging nicht). Deshalb
heisst der kombinierte Test fuer kalender.js `window.gewEinFensterOffen`.

**Oben fest** stehen die Einstellungen, beide Fenster und seit 18.10.2026 auch
der Dialog „Neue Gewohnheit" (`#gewDialog`): Ziel-Art und Rhythmus blenden
Felder ein, und mittig zentriert rutschte er dabei nach oben.

Die Zaehlweise gilt pro KONTO (`fokus_einstellungen`), anders als die
Streifen-Schalter. `GET /api/fokus` liefert sie in `einstellungen`, `PUT
/api/fokus/einstellungen` setzt sie. Die Spalte `arbeit_min` (Standarddauer des
alten Countdowns) steht noch in der Tabelle und wird nicht mehr gelesen.

### Bis Oktober 2026: der Durchreicher

Vor der Fusion holte der Streifen seine Daten ueber
`functions/api/fokus/[[pfad]].js` aus der Fokus-App (sechs freigeschaltete
Routen, Sitzungscookie von Worker zu Worker durchgereicht, `FOKUS_BASIS`).
Grund damals: die Regeln (Flamme, Rhythmus, Obergrenze) sollten an genau
einem Ort liegen. Das tun sie weiter - nur ist dieser Ort jetzt
`functions/_lib/` dieser App. Der Durchreicher ist geloescht, und damit auch
die Testfalle mit zwei Dev-Servern und zwei lokalen Datenbanken: **lokal
reicht ein Server**, nur muss `schema-fokus.sql` einmal per Python-sqlite3 in
die lokale D1 (`wrangler d1 execute --local` stuerzt unter Windows ab).

Die Heute-Liste kommt weiterhin **fertig gerechnet**
(`GET /api/gewohnheiten/heute`): der Streifen entscheidet nichts selbst.
Das Fenster braucht dagegen den ganzen Bestand (`GET /api/gewohnheiten`) und
rechnet Kalenderfarben mit den Spiegeln in `gewohnheiten-daten.js`
(`gewStatusVon`, `gewStillerTagZaehlt`, ...). Aendert sich eine Regel in
`_lib/tag.js` oder `heute.js`, muss sie dort mit.

### Gewohnheiten unter dem Tag, Timer als Knopf (seit 18.10.2026)

**Die Reiterzeile über dem Kalender gibt es nicht mehr.** Bis dahin stand im
Streifen eine Zeile **Kalender | Gewohnheiten | Timer** (`#fokKopf`), und unter ihr
trat ein Fokus-Teil (`#kalUnten`) an die Stelle des Rasters. Hendrik: „stört mich,
dass über dem Kalender der Reiter Timer ist, und am Handy noch Gewohnheiten". Der
Streifen zeigt seitdem immer das Raster (`#kalOben`). Zwei Rückfragen entschieden,
wohin die beiden Inhalte ziehen:

- **Timer:** ein Knopf ⏱ in der Kopfzeile (statt eines Abschnitts neben den
  Gewohnheiten), mit kleinem Fenster.
- **Gewohnheiten:** am PC ein Abschnitt ganz unten in der Heute-Spalte (Hendriks
  Wunsch am selben Tag davor: „lieber unter den heutigen Tag, ganz unten, als Extra
  Abschnitt - das passt auf dem PC gut, auf dem Handy und Tablet eher nicht"); am
  Tablet und Handy ein **einklappbarer** Abschnitt unten in der Kachel „heute"
  (Tagesansicht), standardmäßig zu (statt ganz unten auf der ToDo-Seite oder eines
  zweiten Knopfs). Zuerst war es ein eigener grauer Kasten unter der Kachel; Hendrik:
  „Gewohnheiten soll in die Kachel heute unten, und zusätzlich aufklappbar sein".

Mit der Reiterzeile sind entfallen: `kalUntenModus`, `setzeUnten()`,
`fokusMoeglich()`, `window.fokusZeigen/Verstecken/Reiterzeile/HatZugang/Reiter/
ImStreifen`, `window.kalenderZeigtFokus`, die Klassen `.fok-reiter*`, `.fok-kopf`,
`.kal-unten`, die Reiter-Klick-Handler und die dritte Grid-Zeile der
Dreispaltigkeit. `zeichneUnten()` heißt jetzt `zeichneHeuteSpalte()`. Ein gemerktes
`"fokus"` in `kalAnsicht` gilt beim Lesen als `"kalender"`; `setzePanel()` schreibt
nur noch `"kalender"` oder `"liste"`.

#### Die Gewohnheiten (`#fokInhalt`, gezeichnet von `zeichneFokus()` in `fokus.js`)

Ein Element, **zwei mögliche Orte**; `fokPlatziere()` hängt es um:

| Wo | Wann | Container | Gerufen von |
| --- | --- | --- | --- |
| Heute-Spalte | ab 1380 px (`istDrei()`), Streifen offen | `#fokHeute` in `#kalHeuteSpalte`, unter `#kalTagesliste`, `margin-top: auto` | `window.fokusHeute(an)`, aus `zeichneHeuteSpalte()` in `kalender.js` |
| in der Kachel „heute" | darunter, Tagesansicht zu sehen (Board sichtbar) | `#fokOben`, letztes Kind von `#tagOben`, Linie darüber, Kopf mit Bilanz | `window.fokusOben(an, host)`, aus `zeichneTagOben()` in `kalender.js` |

- **Zustände `fokHeuteAn` / `fokObenAn`** sagen, welcher Abschnitt gerade steht
  (angemeldet, Schalter „Gewohnheiten" an, passender Ort sichtbar). Beim Einschalten
  wird die Liste frisch geholt (`ladeFokus()`).
- **In der Kachel „heute"** steht der Abschnitt standardmäßig **zu**, mit der Bilanz
  („2 von 5") im Kopf; ein Tipp auf den Kopf klappt ihn auf, die Wahl bleibt pro Gerät
  gemerkt (`localStorage.fokObenOffen`). Er steht und fällt mit der Kachel: am Handy
  bei offenem Kalender ist beides weg, und ist die Kachel selbst zugeklappt
  (`.tag-oben.zu`), geht er mit. **Mechanik:** `zeichneTagOben()` leert die Kachel bei
  jedem Zeichnen (`zeichneTagesliste` räumt ihr Ziel) und wirft den Abschnitt dabei
  hinaus; deshalb ruft sie danach `window.fokusOben(true, tagObenEl)`, und
  `fokPlatziere()` hängt ihn ans Ende (`fokObenHost`). Ohne Kachel (`fokusOben(false)`)
  ist der Host weg.
- **In der Heute-Spalte** steht er immer offen, mit „heute" im Kopf, weil die Spalte
  einen anderen Tag zeigen kann (den im Kalender gewählten) - die Gewohnheiten sind
  immer die von heute. Die Spalte ist 286 px breit; die Karten umbrechen das Mengenfeld
  wie am Handy unter den Namen (`.fok-heute .fok-gew.mit-menge`). Ist der Tag kurz,
  schiebt `margin-top: auto` den Abschnitt an den Fuß der Spalte; ist er lang, folgt
  er ihm, und die Spalte blättert (`.kal-liste` hat `overflow-y: auto`).
- Die Heute-Spalte ist verschachtelt: `#kalHeuteSpalte` (grauer Kasten, Klasse
  `.kal-liste`, `[hidden]` unter 1380 px) enthält `#kalTagesliste` (Klasse
  `.kal-tagblock`; das Wischen zwischen den Tagen verschiebt nur ihn) und `#fokHeute`.
  **Falle, am 18.10.2026 zugeschnappt:** die erste Fassung hieß `#kalHeute` - die ID
  trägt aber der „Heute"-Knopf im Kalender-Kopf, und `getElementById("kalHeute")`
  fand die Spalte: jeder Klick darin sprang auf heute, der Knopf tat nichts. Bei neuen
  IDs im Panel erst nach der ID suchen.
- Die Links „Verlauf & mehr ›" am Ende der Liste und „Fokuszeit pro Woche ›" beim Timer
  sind weg (Hendrik: stehen in den Einstellungen).

#### Der Timer: Knopf und Fenster

- **Knopf** `.timer-knopf` ⏱ **zweimal im Dokument**, wie das Zahnrad: in der
  App-Kopfzeile (links vom Zahnrad) und in der Kopfzeile des Kalenders (am Handy
  verdeckt der Kalender die App-Kopfzeile; im breiten Fenster ist der zweite wie das
  Zahnrad dort ausgeblendet, `html.breit`). Sichtbar, wenn angemeldet und „Timer" unter
  „Anzeige" an ist. Was dahinter steckt, steht seit 18.10.2026 im Kapitel
  **„Zeiterfassung"** (`zeiterfassung.js`).
- Bis dahin war das Fenster ein Countdown mit Ring, Start/Pause/Stopp und Ton am
  Sitzungsende (Code damals in `fokus.js`). Der Ring hatte eine feste Grösse, weil
  `container-type: size` eine ausdrückliche braucht - falls er je zurückkommt.

#### Was vom Streifen übrig ist

- **Der Kalender-Block** `#kalOben` umfasst Kopf, Quellen-Filter, Wochentage und
  Raster, mit `flex: 1; min-height: 0`.
- **Das ✕ sitzt in der Ansicht-Zeile** ganz oben, nicht im Kalender-Kopf: sonst
  wanderte es mit dem Raster mitten ins Panel. Die Ansicht-Zeile ist im Split nicht
  `display: none`, stattdessen verstecken sich dort Zahnrad, Timer-Knopf und Pille (die
  stehen in der App-Kopfzeile daneben). Weil ohne Pille auch deren Höhe wegfällt,
  setzt `html.breit` dort `min-height` und `padding-top` auf 0.
- **Die Dreispaltigkeit** hat zwei Grid-Zeilen: ✕ über beiden Spalten, darunter Kalender
  rechts und Heute-Spalte links.
- **Der Quellen-Filter liegt hinter einem Trichter** im Kalender-Kopf
  (`#kalFilterKnopf`, Inline-SVG statt Emoji). `filterOffen` wird nicht gemerkt - jedes
  Öffnen startet zu (`frischOeffnen()`); damit man sieht, dass etwas abgewählt ist,
  färbt sich der Trichter (`.aktiv`).
- **Die `[hidden]`-Falle** gilt für alles hier mit `display: flex`: `.kal-oben`,
  `.kal-liste`, `.fok-inhalt`, `.fok-heute`, `.fok-oben`, `.timer-knopf` und die
  `zt-`-Teile der Zeiterfassung (`.zt-inhalt`, `.zt-gekappt`, `.zt-uhr`, `.zt-wahl`,
  `.zt-dialog-wahl`) brauchen je ihre eigene `[hidden] { display: none }`-Zeile.

### Der Umschalter: nur noch auf oder zu

📋 | 📅, und genau eines gilt:

* **📋** — Streifen zu
* **📅** — Streifen auf

**Die Pille sagt nur „Streifen auf oder zu".** Bis zum 13.08.2026 gab es hier ein drittes Segment (🔥) für
den Fokus; drei Knöpfe in der Kopfzeile waren einer zu viel, und die Frage
„Tag oder Fokus" an zwei Stellen zu stellen ist eine zu viel. Davor gab es
zwischenzeitlich sogar eine zweite Bedienform fürs breite Fenster (📋 weg, 📅
und 🔥 als unabhängige Ein/Aus-Knöpfe) — die war richtig, solange Kalender und
Fokus zwei getrennte Panels waren, und ist mit dem gemeinsamen Streifen
gefallen. **Beides nicht erneut vorschlagen.**

Gemerkt wird in **einem** Schlüssel, `kalAnsicht`: `"liste"` oder `"kalender"`.
Alte Werte (`"tag"` aus der Dreiteilung, `"fokus"` aus der Zeit mit der Reiterzeile)
zählen beim Lesen als `"kalender"`. `fokAnsicht` gibt es nicht mehr.

Gesetzt wird `aria-pressed` **nur** in `setzePanel()` (kalender.js).

### Ein Tipp auf den Tag wählt ihn — mehr nicht

`waehleTag()` setzt `kalAuswahl` und fertig; ein zweiter Tipp auf denselben Tag
tut nichts. Das war einmal komplizierter (drei Fälle: Fokus nach hinten,
Datumswechsel, zweiter Tipp schaltet zurück zu Fokus bzw. wählt ab) — und
musste es sein, solange Tagesliste und Fokus sich denselben Platz teilten.
**Seit die Tagesliste immer dasteht, gibt es nichts wegzuschalten:** ein leerer
Tagesbereich wäre kein Zustand, den jemand haben will.

Auch „Heute" holt nichts mehr nach vorn: der Streifen zeigt immer das Raster.

### Was der Fokus-Teil kann — und was nicht

Bei den Gewohnheiten: abhaken (einfach oder mit Menge über −/Zahl/+), Flammen
sehen. Einen Stift zum Bearbeiten gibt es an der Karte seit 19.10.2026 nicht mehr.
Alles andere steht seit
Oktober 2026 in den Einstellungen (anlegen, Reihenfolge, Archiv, Zaehlweise) und
im Fenster "Gewohnheiten" (Verlauf, Statistik). Bis dahin fuehrte ein ↗ in der
Kopfzeile des Bereichs zur Fokus-App. Der Timer: siehe Kapitel "Zeiterfassung".

**Wiederoeffnen hat ein Rueckgaengig** (Snackbar, wie in der Fokus-App): aus
"50 von 60" wird beim Tipp auf den Haken eine 0, ohne Rueckfrage.

Nach jedem Haken wird **zweimal** aktualisiert: sofort aus der Antwort von
`log` (Menge, Ziel, Zustand, Flamme stehen dort drin) und gleich danach die
ganze Liste frisch. Das zweite ist nötig, weil sich das Drumherum ändern kann —
die Tagesbilanz, und bei „X Mal die Woche" verschwindet die Gewohnheit mit dem
erreichten Ziel ganz aus der Liste.

**Offline geht Abhaken trotzdem** (seit Oktober 2026, aus der Fokus-App
uebernommen): der Haken landet in einer Warteschlange im localStorage
(`gew_warteschlange`, ein Eintrag je Gewohnheit und Tag), die Karte springt
sofort um und traegt "↻ nicht gespeichert". Nachgeliefert wird bei `online`,
beim Zurueckkehren in die App und nach dem Start. Die Heute-Liste des letzten
Ladens liegt unter `gew_heute` (gilt nur am selben Tag), der Bestand des
Fensters unter `gew_stand`; beides faellt beim Abmelden weg (`gewVergiss`).
Flamme und "x von 3 diese Woche" stimmen erst nach dem Nachliefern wieder.
Anlegen, Bearbeiten und die Zeiterfassung brauchen Netz - bei der Uhr mit
Absicht: sie rechnet aus dem Startzeitpunkt des Servers, nachgereicht waere der
Eintrag gelogen.

## Zeiterfassung (seit 18.10.2026)

Der Knopf ⏱ war bis dahin ein 25-Minuten-Countdown ohne Bezug („Fokusminuten
pro Woche"). Hendriks Auftrag: „Zeit auf ein ToDo buchen, das heißt, ich drücke
oben die Stoppuhr und kann ein ToDo auswählen, woran ich arbeite. Also nicht
einfach nur ein Timer." Code: `zeiterfassung.js` (Client, Präfix `zt`/`zt-`),
`functions/_lib/zeit.js` und `functions/api/zeit/*` (Server), Tabelle
`zeiteintraege` (`schema-fokus.sql`, eingespielt mit `migration-zeiterfassung.sql`).

**Hendriks Entscheidungen (gefragt, nicht angenommen):**

- **Zweck: alles** - Dauer einzelner Aufgaben, Summe pro Liste/Bereich, fokussiert
  bleiben, Nachweis. Dazu sein Satz: „Die Zeit ist eine Ergänzung, sollte nicht auf
  den ersten Blick zu sehen sein, sonst wird das überladen." Deshalb steht **an den
  ToDo-Karten keine Zeit**, und der Einstieg ist **nur der Knopf ⏱** (kein ▶ an der
  Karte).
- **Stoppuhr, zählt hoch.** Der Countdown samt Standarddauer, Ring, Ton und
  Sitzungsende ist weg.
- **ToDo optional** („Ohne ToDo starten").
- **Keine Pause-Taste:** Stopp beendet den Eintrag, Weitermachen ist ein neuer.
  Jeder Eintrag hat so echte Von-bis-Zeiten.
- **Alles im Fenster** hinter ⏱ (Variante 1 seiner ASCII-Vorschau): oben Uhr bzw.
  Auswahl, darunter „Heute gebucht" mit Stift, „+ Zeit nachtragen", „Statistik ›".
- **Bearbeiten, löschen, nachtragen** - alles erlaubt.
- **Deckel bei 4 h + Hinweis**, falls man das Stoppen vergisst.
- **Statistik gruppiert und aufklappbar**: Liste › Bereich › ToDo, darunter die
  Einträge; **CSV-Export**; **Serien-ToDos zusammen**.
- **Abhaken stoppt die Uhr**, wenn sie auf genau diesem ToDo läuft.

**Meine Entscheidungen, im Bericht genannt:** Einträge unter 10 Sekunden werden
beim Stoppen/Wechseln verworfen (`MIN_SEK`, Fehlgriff); alte Fokus-Sitzungen sind
als „Ohne ToDo" übernommen; die Zeit ist persönlich, auch bei geteilten Listen;
Woche ab Montag mit KW, Monat, Jahr; Reiter in den Einstellungen heißt weiter
„Timer".

**Zweite Runde am selben Abend** (Hendrik: „Guter Ansatz, noch ein paar
Verbesserungen", wieder mit ASCII-Skizzen gefragt):

- **Dropdown statt Suche** („muss ich selber das ToDo suchen, finde ein
  Dropdown-Menü besser, wo die ToDos nach Bereichen sortiert und farblich markiert
  sind"): alle Listen, gruppiert nach Liste › Bereich, Farbstreifen des Bereichs,
  oben ein Feld zum Eingrenzen. **Auswählen, dann „▶ Starten"** (nicht: Tipp
  startet sofort). Die Vorschläge „Heute fällig"/„Zuletzt" sind damit weg.
- **„Wechseln" ist weg** („ich wähle ein ToDo aus und arbeite daran, warum
  wechseln"). Bei laufender Uhr steht das ToDo als dasselbe Dropdown oben; eine
  Wahl dort ordnet die laufende Uhr **ab ihrem Start** zu („wenn ich ohne ToDo
  arbeite, soll ich während der Zeit ein ToDo hinzufügen [können], dann wird von
  Beginn an die Zeit darauf gebucht") - auch zum Korrigieren eines Fehlgriffs.
  Darunter nur ein runder Stopp-Knopf (die alten Knöpfe fand er „optisch nicht
  schön").
- **„Heute gebucht" einklappbar**, standardmäßig zu („ist zu viel").
- **Nachtragen** mit Kopf wie die Fenster, Dropdown, Tag Heute/Gestern/Kalender,
  Von–Bis und Dauer-Knöpfen (statt Beginn + Dauer).
- **Statistik: vierter Zeitraum „Gesamt"** („wie viel Zeit gesamt in einige ToDos
  bzw. Bereiche geflossen ist") statt einer zweiten Zahl in jeder Zeile.

Meine Calls dazu: Ohne Bereich steht in jeder Liste zuletzt; ToDos mit Termin
zuerst (früheste oben), dann die ohne in Board-Reihenfolge; der Filter trifft
auch Bereichsnamen (dann der ganze
Bereich); „Heute gebucht" merkt sich den offenen Zustand nicht, jedes Öffnen
startet zu; die Auswahl springt nach dem Stoppen auf „Ohne ToDo" zurück.

**Termin im Dropdown (18.10.2026):** jedes ToDo mit Termin trägt rechts einen
kleinen Chip mit dem Datum (`.zt-dd-termin`, Kurzform `03.11.`, das Jahr nur
bei einem anderen als dem laufenden). Rot (`.dringend`) nach derselben Regel
wie der Streifen am Board (`isUrgent`: überfällig, heute, morgen), sonst gelb.
Vorher stand nur bei überfällig/heute ein rotes Wort, Zukunftstermine gar
nicht. Hendrik wählte den Chip gegen „Farbpunkt vor dem Namen" und „Streifen
links wie am Board" (der Bereichsstreifen sitzt dort schon links) und „wie am
Board" gegen „nur heute rot". Der geschlossene Knopf zeigt den Termin nicht.

### Daten

`zeiteintraege`: `start`/`ende` in UTC (`ende` NULL = die Uhr läuft, höchstens
eine je Nutzer), `datum` = lokaler Tag des Starts (danach gehen Statistik und
„Heute"), `todo_id` plus **Schnappschuss** `todo_text`, `liste_name`,
`bereich_name`, dazu `gekappt` und `nachgetragen`. Die Dauer wird nicht
gespeichert, sondern per `strftime('%s')` aus `start`/`ende` gerechnet - so gibt
es nur eine Wahrheit, wenn jemand Von oder Bis korrigiert.

**`todo_id` ist absichtlich KEIN Fremdschlüssel.** `PUT /api/todos` schreibt eine
Liste bei jedem Speichern komplett neu (DELETE + INSERT mit denselben ids). Ein
`REFERENCES todos(id)` mit `SET NULL` hätte bei jedem Speichern alle Buchungen
vom ToDo gelöst, mit `CASCADE` gelöscht. Wer hier „aufräumt", verliert alle
Zeiten. Aus demselben Grund steht der Schnappschuss daneben: ist das ToDo weg
(gelöscht, Liste verlassen), zeigt die Statistik den Namen von damals. Solange es
das ToDo gibt, nimmt die App die **aktuellen** Namen aus `listen`/`daten`
(`ztFindeTodo`) - umbenannt oder verschoben zählt richtig.

Der Server prüft beim Buchen nur die Form der ToDo-Felder, nicht, ob es das ToDo
gibt: ein gerade angelegtes ToDo ist vielleicht noch nicht gespeichert, und die
Felder verraten niemandem etwas (der Eintrag gehört dem Nutzer, aufgelöst wird
in der App mit deren eigenen Listen).

### Endpunkte (`functions/api/zeit/`)

| Pfad | Was |
|---|---|
| `GET /api/zeit?heute=` | laufende Uhr, heute fertig Gebuchtes, gekappte Einträge (Hinweis). Bis zur zweiten Runde auch `zuletzt` (zuletzt bebuchte ToDo-ids) - mit der Vorschlagsliste weggefallen |
| `POST /api/zeit/start` | `{ heute, todoId?, todoText?, listeName?, bereichName? }` - beendet eine noch laufende Uhr (anderer Tab/anderes Gerät) und startet neu; Antwort `laeuft`, `beendet` |
| `PUT /api/zeit/laufend` | `{ todoId?, todoText?, listeName?, bereichName? }` - gibt der laufenden Uhr ein ToDo (oder keins), **ab ihrem Start**, ohne sie anzuhalten; 409, wenn keine läuft (auch wenn sie gerade gekappt wurde) |
| `POST /api/zeit/stop` | hält an; `beendet: null`, wenn nichts lief, gekappt oder unter 10 s verworfen |
| `GET /api/zeit/eintraege?von=&bis=` | fertige Einträge eines Zeitraums (höchstens 400 Tage), neueste zuerst; `?alle=1` statt von/bis = alles seit Beginn (Zeitraum „Gesamt") |
| `POST/PUT/DELETE /api/zeit/eintrag` | nachtragen / korrigieren (`id`, `start`, `ende` als ISO, `datum`, Buchung) bzw. `{ id, gekapptOk: true }` / löschen. Die laufende Uhr ist hier nicht zu haben (409 bzw. 404) |

Geprüft wird: Bis nach Von, höchstens 24 h, Ende nicht in der Zukunft (2 Minuten
Spielraum), Datum gültig. Über Mitternacht rechnet der Dialog selbst: liegt Bis
nicht nach Von, ist es der nächste Tag (23:30–0:30 = 1 h).

### Der Deckel

**Gekappt wird beim Lesen**, nicht per Zeitplan: `laufenderEintrag()` in
`_lib/zeit.js` setzt bei mehr als 4 h `ende = start + 4 h` und `gekappt = 1`, und
JEDER Weg, der nach der laufenden Uhr fragt (Fenster laden, Start, Stopp), geht
dort durch. Läuft die App, holt der Sekundentakt bei 4 h den Stand neu und meldet
es in der Snackbar. Danach: gelber Punkt am Knopf (`.timer-knopf.hinweis`) und
ein Hinweis oben im Fenster mit „Korrigieren" (Dialog; jede Korrektur setzt
`gekappt = 0`) und „Passt so" (`gekapptOk`).

### Das Fenster hinter ⏱ (`#timerPopup`)

- **Dropdown** (`ztDropdown`, dreimal: vor dem Start `ztDdStart`, bei laufender
  Uhr `ztDdLaufend`, im Dialog `ztDdDialog`): ein Knopf wie ein Auswahlfeld (Name,
  darunter Liste · Bereich, links der Farbstreifen) und darunter **im Fluss** eine
  aufklappende Liste - kein schwebendes Menü, so passt sie in jedes Fenster und
  blättert selbst (`max-height`). Bewusst kein `<select>`: das zeigt keine Farben,
  am iPhone schon gar nicht. Inhalt (`ztGruppen`): oben „Ohne ToDo", dann je Liste
  (Reihenfolge von `listen`) ihre Bereiche in Board-Reihenfolge, „Ohne Bereich"
  zuletzt, nur offene ToDos ohne die noch unsichtbare nächste Ausgabe einer Serie
  (`nochNichtFaellig`). Mit Termin zuerst. Das Feld oben grenzt ein (ToDo-Text oder
  Bereichsname), Enter nimmt den ersten Treffer, Fokus nur mit Maus (sonst klappte
  am Handy die Tastatur über die Liste). Ein Klick daneben klappt zu (Handler in der
  Einfangphase, weil der Klick auf einen Eintrag die Liste neu baut), Escape auch.
  Die Farbe kommt nur aus der Palette `FARBEN` (`ztFarbwert`), nie als freier Text in
  einen style-Wert.
- **Vor dem Start:** Dropdown (steht auf „Ohne ToDo"), darunter „▶ Starten".
- **Uhr:** oben das Dropdown mit dem laufenden ToDo („Ohne ToDo – jetzt
  zuordnen"), eine Wahl schickt `PUT /api/zeit/laufend`; darunter die Zeit h:mm:ss
  und der runde Knopf „Stoppen" (`.zt-stopp`, Kreis mit Quadrat aus CSS). Am Knopf in
  der Kopfzeile m:ss bzw. h:mm:ss (am Handy ohne Symbol, wie vorher).
- **Heute gebucht:** eine Zeile mit der Summe (`#ztHeuteKopf`), ein Tipp klappt die
  Einträge mit `datum` = heute auf (neueste zuerst, Stift öffnet `#ztDialog`). Jedes
  Öffnen des Fensters startet zu. Die laufende Uhr zählt nicht mit.
- **Dialog:** Kopf mit Titel links und ✕, Dropdown, Tag (Knöpfe Heute/Gestern,
  daneben das Datumsfeld), Von – Bis, Dauer-Knöpfe 15/30/60/120 min (setzen Bis =
  Von + Dauer; der passende ist hervorgehoben), darunter „= 1 h 30". Die leere
  Fehlerzeile ist ausgeblendet (`.lock-msg:empty`), sonst stand eine Lücke über den
  Knöpfen.
- **Neu gezeichnet** bei jedem `render()` der App (`window.zeitNeuZeichnen`), damit
  ein umbenanntes oder erledigtes ToDo sofort stimmt; geladen beim Öffnen, nach
  jeder Aktion und beim Zurückkehren in den Tab.
- **Abhaken:** `toggleDone` in `app.js` ruft `window.zeitBeiAbhaken(id)`.
- **Oben fest** wie die Einstellungen (`#timerPopup`, `#ztDialog`, `#zeitFenster`
  in der Gruppe mit `--ein-abstand-oben`): das Dropdown klappt auf und zu.
- **Schließen von innen nach außen** (offenes Dropdown, Dialog, Statistik, Fenster): Escape in der
  Einfangphase, Zurück-Taste über `window.zeitSchliesseOberste` in
  `schliesseObersteEbene` (kalender.js). Solange eines offen ist, keine
  Rand-Wischgeste (`window.zeitFensterOffen` in `darfGeste`).
- **Reihenfolge im DOM:** `#timerPopup`, `#zeitFenster`, `#ztDialog` - der Dialog
  muss hinter beiden stehen, er wird aus beiden geöffnet und legt sich bei
  gleichem z-index nur über das, was vor ihm steht.

### Statistik (`#zeitFenster`)

Woche (Mo–So, „KW 42 · 12.10.–18.10.2026"), Monat, Jahr und **Gesamt** (seit dem
ersten Eintrag, „seit 15.08.2026"); ‹ › blättert, › endet beim laufenden Zeitraum,
bei „Gesamt" sind die Pfeile unsichtbar (Platz bleibt, damit nichts springt). Gesamt
hat einen Balken je Monat, ab 13 Monaten nur noch mit Jahreszahl am Januar, über 24
Monate einen je Jahr. Balken pro Tag bzw. Monat (Monat ohne Zahlen, Wert im
Tooltip - 31 Zahlen haben keinen Platz). Darunter der Baum (`ztBaueBaum`):
**Liste › Bereich › ToDo**, ToDos ohne Bereich direkt an der Liste, Blätter mit
gleichem Namen im selben Bereich zusammengefasst (Serien), „Ohne ToDo" als letzte
Zeile; standardmäßig zu, aufgeklappt bleibt beim Blättern. Ganz unten die
Einträge (erst 30, dann „Alle anzeigen").

**CSV** entsteht im Browser aus den geladenen Einträgen: Semikolon und BOM (ein
deutsches Excel öffnet sie per Doppelklick richtig), Stunden mit Komma, älteste
zuerst. Felder, die mit `= + - @` beginnen, bekommen ein Hochkomma - sonst läse
Excel einen ToDo-Text wie „=1+1" als Formel. Dateiname
`zeiterfassung-2026-KW42.csv` / `-2026-10` / `-2026` / `-gesamt` (das Jahr einer KW
ist das ihres Donnerstags).

### Übernommen und abgebaut

- `migration-zeiterfassung.sql` kopiert die alten Fokus-Sitzungen (`echte_min > 0`)
  als „Ohne ToDo" (gleiche ids, `INSERT OR IGNORE`, mehrfach ausführbar).
  `fokus_sitzungen` bleibt stehen und wird nicht mehr gelesen.
- Gelöscht: `functions/api/fokus/start.js`, `stop.js`, `pause.js`, das Fenster
  „Fokuszeit" (`#fokuszeitFenster`, `gewZeichneFokuszeit`), die Standarddauer in den
  Einstellungen, der Countdown-Teil von `fokus.js` samt Ton und
  Browser-Benachrichtigung am Sitzungsende. `GET /api/fokus` liefert nur noch die
  Zaehlweise der Flamme. Ein alter, noch geladener Client bekommt für Start/Stopp
  405 und zeigt „Start fehlgeschlagen" - bis zum nächsten Laden.
- Konto löschen räumt `zeiteintraege` mit ab (`_lib/loeschen.js`).

**Lokal getestet** (18.10.2026, `wrangler pages dev`, Browser-Pane bei 1024/1500 px
und 375 px, hell und dunkel): Start, Wechseln, Stopp, Abhaken stoppt, Fehlgriff
unter 10 s, Nachtragen über den Dialog, über Mitternacht, Bearbeiten, Löschen,
alle Fehlerfälle der API, der Deckel (Start in der lokalen DB um 5 h
zurückgesetzt), Korrigieren aus dem Hinweis, Statistik Woche/Monat/Jahr und
Blättern, CSV-Inhalt, Einstellungen, Escape, doppelte IDs. **Ungeprüft:** das
echte Herunterladen der CSV am Handy (iOS öffnet Blob-Downloads je nach Version
als Vorschau), Excel selbst, und das Zusammenspiel zweier Geräte live.

**Zweite Runde lokal getestet** (gleicher Abend, 717/1024 px und 375 px, hell und
dunkel, mit Bereichsfarben in den Testdaten): Dropdown zu/auf, Farben, Eingrenzen +
Enter, echter Klick auf Knopf und Eintrag, Starten, Zuordnen bei laufender Uhr
(gleicher Eintrag, gleicher Start, auch zurück auf „ohne"), Stopp bucht die ganze
Zeit aufs zugeordnete ToDo, 409 ohne laufende Uhr, Heute-Zeile auf/zu, Dialog mit
Heute/Gestern und Dauer-Knöpfen (auch über Mitternacht), Bearbeiten, Gesamt (auch
über Monate mit Lücke; über ein und zwei Jahre nur rechnerisch), CSV-Dateiname,
Escape-Reihenfolge, Klick daneben, Abhaken stoppt, doppelte IDs. Einmal ging das
Fenster beim ersten echten Klick aufs Dropdown zu - danach nicht mehr
nachstellbar, auch nicht mit Protokoll aller Klick- und popstate-Ereignisse.
Vermutlich der vorher abgebrochene Klick des Test-Werkzeugs; falls es live
auftritt: hier weitersuchen.
