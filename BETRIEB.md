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
`todo.it-wolf.org`. Nur dadurch sieht **fokus.it-wolf.org** dieselbe Anmeldung —
der geteilte Login hängt allein an diesem Attribut, nicht am Hosting-Ort. Beide
Pages-Projekte binden dieselbe D1-Datenbank `todo`, weil ein Cookie ohne
Nachschlagen in `sessions` nichts wert ist.

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
Kasten teilen: Hauptansicht (Akkordeon aus Darstellung, Benachrichtigungen,
Google, Listen, Konto …) plus die Rückfragen (Abmelden, Konto löschen, Zugriff
verwalten). Umgeschaltet wird über `zeigeEinAnsicht()`, das die Ansichten nach
ihrer ID ein- und ausblendet.

**Das Zahnrad gibt es zweimal.** Einmal in der Kopfzeile der App
(`#einstellungenBtn`), einmal im Kalender (`.kal-ansicht-zeile`) — am Handy
verdeckt der Kalender die Kopfzeile, und ohne das zweite käme man aus der
Kalenderansicht gar nicht mehr in die Einstellungen. Beide tragen
`.ein-knopf`, werden gemeinsam verdrahtet und gemeinsam mit der Anmeldung
sichtbar gemacht (`zeigeEinstellungenKnopf()`). Reihenfolge in beiden Ecken
gleich: Zahnrad, dann Umschalter.

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

**Bekannter Kompromiss:** ohne Push (0 faellige ToDos) wird die Zahl NICHT
im Hintergrund auf 0 gesetzt - eine "stille" Push-Nachricht ohne sichtbare
Meldung ist bei iOS/Chrome nicht zuverlaessig erlaubt (beide zeigen sonst
selbst eine generische Ersatzmeldung). Die Zahl stimmt spaetestens beim
naechsten Oeffnen der App wieder.

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

**Bekannter Kompromiss:** `PUT /api/todos` bleibt wie beschrieben „letzter
Speichervorgang gewinnt" (s. o.) — Offline-Nutzung verlängert dieses
Zeitfenster von Sekunden auf Stunden oder Tage. Bei geteilten Listen mit
mehreren aktiven Personen steigt dadurch das Risiko, eine fremde
Zwischenänderung zu überschreiben, ohne dass das Backend das erkennen
könnte (keine Versionsspalte). Nach jedem automatischen Sync zeigt eine
Snackbar, welche Liste synchronisiert wurde, damit es wenigstens auffällt.

Eine neue Liste anlegen, umbenennen, löschen, teilen oder Mitglieder
verwalten bleibt bewusst online-only (eigene, sofortige Requests ohne
lokalen Fallback) — der Server vergibt dabei IDs und prüft Limits, das lässt
sich nicht sinnvoll offline vorwegnehmen.

## Warteliste und Verwaltung

Auf dem Anmeldebildschirm führt „Noch keinen Zugang? Eintragen" zu einem
Formular (Name + Adresse) → `/api/waitlist`. Der Eintrag landet in der Tabelle
`waitlist`; der Eintragende bekommt eine Bestätigung, die Verwaltung eine
Benachrichtigung.

Unter **[/admin](https://todo.it-wolf.org/admin)** stehen offene Anfragen und
die Nutzerliste. Freischalten legt das Konto an und verschickt eine
Willkommensmail; Ablehnen setzt nur den Status — bewusst ohne Mail.

**Zwei unabhängige Zugangsspalten, EINE Warteliste.** `users.todo_zugang` und
`users.fokus_zugang` steuern je eine App (fokus.it-wolf.org: eigenes
Cloudflare-Pages-Projekt, gleiche D1-Datenbank), unabhängig von `role` und
voneinander — siehe Kommentar in `schema.sql`. Beide Apps schreiben in
dieselbe `waitlist`-Tabelle, `quelle` hält fest, über welche Maske sich jemand
eingetragen hat, und steuert beim Freischalten, welche der beiden Spalten
gesetzt wird. Ein frisch freigeschaltetes Konto hat also immer GENAU EINE der
beiden Berechtigungen, nie automatisch beide.

**Seit 08.08.2026 symmetrisch selbstbedienbar: nur die ERSTE Freischaltung
braucht einen Admin.** Danach holt sich der Nutzer die jeweils andere App
selbst, zwei gleichwertige Wege:
- Ein Knopf in den Einstellungen der App, die er schon hat („Zugang zum
  Fokus-Tracker holen", drüben spiegelbildlich „Zugang zur ToDo-Liste holen")
  — setzt die Spalte sofort, ohne Rückfrage (rein additiv, in der jeweils
  ANDEREN App jederzeit wieder aufgebbar).
- Einfach ein Login-Versuch auf der anderen App: `request-code.js` und
  `link.js` setzen die fehlende Spalte still mit, bevor sie den Code
  verschicken bzw. die Sitzung anlegen — keine eigene Meldung, sieht wie ein
  ganz normaler Login aus.

In der Nutzerliste lässt sich jede Spalte trotzdem jederzeit einzeln umlegen
(„ToDo-/Fokus-Zugang geben/entziehen"), unabhängig von Adminrechten. Der
Fokus-Schalter hat kein Selbstsperr-Risiko, deshalb keine Sperre gegen das
eigene Konto; der ToDo-Schalter blendet sich beim eigenen Konto trotzdem aus
(kein hartes Aussperr-Risiko — `/admin` hängt an `role`, nicht an
`todo_zugang` —, aber eine unnötig verwirrende Zwischenlage).

Jeder Nutzer kann seinen Zugang zu EINER App auch selbst wieder aufgeben (in
deren eigenen Einstellungen, „ToDo-/Fokus-Zugang aufgeben", je eigenes
`auth/zugang-aufgeben.js`) — die Daten bleiben, nur der Zugang ist weg, ein
erneuter Login-Versuch holt ihn sich selbst zurück. Für `role='admin'` ist das
beim ToDo-Zugang gesperrt, gleiche Vorsicht wie beim Rollen-Schalter im
Dashboard.

`functions/api/waitlist.js` auf der Fokus-Seite verlinkt Freischalten- und
Verwaltungslink fest auf `todo.it-wolf.org`, weil `/admin` und `/freischalten`
nur hier existieren.

**Die Willkommensmail meldet direkt an.** Sie enthält einen Anmeldelink, der
sieben Tage gilt (`functions/_lib/willkommen.js`). Er liegt als normaler
Eintrag in `login_codes` und wird vom selben `/api/auth/link` eingelöst —
gebaut mit dem Origin der App, für die freigeschaltet wurde (`quelle`), NICHT
zwingend `todo.it-wolf.org`: bei `quelle='fokus'` zeigt der Knopf fest auf
`fokus.it-wolf.org` (ToDo's eigener request.url-Origin passt dort nicht,
lokal ist dieser eine Link deshalb nicht testbar — Kommentar in
`willkommen.js`). Sieben Tage statt zehn Minuten, weil so eine Mail auch mal
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
INSERT INTO users (email, name, role, todo_zugang, fokus_zugang)
VALUES ('adresse@example.com', 'Name', 'user', 1, 0);
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

**Die Fokus-Warteliste (`fokus.it-wolf.org`) hat KEIN Turnstile** — der
Sitekey ließe sich dort ohnehin nicht verwenden (an `todo.it-wolf.org`
gebunden), und ein zweites Widget wäre für die zu erwartende Handvoll
Anfragen nicht im Verhältnis. Die Minuten-Bremse gilt app-übergreifend
(dieselbe `waitlist`-Tabelle), das war schon bei ToDo am Anfang der einzige
Schutz.

## Konten löschen

Nutzer löschen ihr eigenes Konto in der App über den Abmelden-Knopf →
„Konto löschen"; zur Bestätigung muss die eigene Adresse abgetippt werden.
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
degradieren — sonst käme niemand mehr an die Verwaltung.

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
CSS-Block „Kalender" in `style.css`): Monatsraster oben, Tagesliste darunter.
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
* **Umschalt-Modus** (Handy, schmales Fenster): der Kalender legt sich als
  Panel über die Liste, mit abgedunkeltem Hintergrund und `overflow: hidden`
  am `html` — also alles wie vor dem Umbau.

Die 1000 px kommen aus dem Platz: 440 px Kalender lassen darunter noch zwei
Board-Spalten (min. 250 px) übrig. Bei weniger bliebe eine einzige Spalte, und
dann ist Umschalten ehrlicher als Nebeneinander.

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

**Überfällig-Chip.** Eigener Einstieg über dem Raster, weil Überfälliges quer
über Vormonate liegt und im Raster des laufenden Monats gar nicht auftaucht.
Auswahl `kalAuswahl` hält deshalb entweder ein ISO-Datum oder den
Sonderwert `"ueberfaellig"`.

**Am HEUTIGEN Tag steht Überfälliges zusätzlich mit in der Tagesliste** (seit
13.08.2026), als eigener Abschnitt „Überfällig (n)" über den heutigen ToDos und
mit Datum je Zeile. Vorher lag es allein hinter dem Chip — wer nur auf „heute"
schaute, sah es also nie, obwohl es fällig ist, nur eben schon länger. An
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

**Die Knopfreihe im Termin-Formular ist 44 px hoch.** Mit `.btn.klein` waren es
25 px — unter dem Maß, ab dem ein Finger regelmäßig danebenlangt. Die Klasse
bleibt an den Knöpfen, `.kal-form-knoepfe .btn` holt Höhe und Schriftgröße
zurück.

**Wischgeste.** Start nur innerhalb von 24 px am RECHTEN Bildschirmrand
(links liegt auf iOS/Android die Zurück-Geste des Browsers). Die Achse
entscheidet sich nach 8 px: überwiegend senkrecht → die Geste wird
verworfen, das Board scrollt normal; überwiegend waagerecht → `preventDefault()`
und das Panel folgt dem Finger (Inline-`transform`, deshalb steht im CSS nur
der Ruhezustand). Beim Loslassen entscheidet die Strecke (65 % zum Öffnen,
35 % zum Schließen). Blockiert, solange ein Dialog offen ist oder etwas
gezogen wird (`darfGeste()`) — sonst kämpft die Geste mit dem Drag & Drop des
Boards. Der Umschalter in der Kopfzeile führt zum selben Ziel.
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

## Google Kalender

Verknüpftes Google-Konto je Nutzer, **ausschließlich lesend**
(Scope `calendar.readonly`). Die Termine erscheinen im Kalender-Panel neben
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

**Einrichtung (einmalig, in der Google Cloud Console).** Projekt anlegen →
Calendar API aktivieren → OAuth-Zustimmungsbildschirm (Extern, Bereiche
`openid`, `email`, `calendar.readonly`) → Status „In Produktion" →
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

**Anzeige.** Seit 13.08.2026 stehen im Tagesbereich die **ToDos zuerst** und
die Termine darunter. Der Streifen beantwortet zuerst „was muss ich heute
tun" — und die Termin-Überschrift samt ihrer Leerzeile („Kein Google-Kalender
verbunden.") schob diese Antwort vorher bei jedem Öffnen nach unten aus dem
Blick.

**Ganztägige Termine haben einen eigenen Abschnitt** und stehen vor den
zeitgebundenen: sie rahmen den Tag, statt in ihm zu liegen, und zwischen den
Uhrzeiten standen sie als zeitlose Zeilen ohne erkennbare Ordnung. Innerhalb
der zeitgebundenen bleibt es chronologisch.

**Leere Abschnitte fallen weg, und das ＋ hängt am ersten sichtbaren** — so
kommt es genau einmal vor und sitzt immer oben bei den Terminen. Die drei
Fälle: nur ganztägige → „Ganztägig" mit ＋ (kein leerer „Termine"-Block); nur
zeitgebundene → „Termine" mit ＋; gar keine → „Termine" mit ＋ und der
erklärenden Leerzeile. Für die ToDos gilt das **nicht**: deren Abschnitt bleibt
auch leer stehen („Nichts fällig."), weil das die eigentliche Frage des
Streifens beantwortet.

**Zellen: Zahl oben, Rest darunter.** `justify-content: flex-start` statt
`center` — sonst wandert die Tageszahl je nach Anzahl der Balken auf und ab und
steht in einer Zeile nicht mehr auf gleicher Höhe. Mindesthöhe 58 px (vorher
44), Radius 4 px (vorher 9): im Vergleich mit Googles Monatsansicht wirkte das
Raster gestaucht und zu stark abgerundet.

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

Google-Termine zählen **nicht** in den Überfällig-Chip und nicht in die
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

**Anlegen aus dem Kalender.** Unter der Überschrift ein Feld plus Knopf:
Das ToDo landet in der gerade AKTIVEN Liste und dort ohne Bereich — der
Kalender kennt keinen Bereich, und „Ohne Bereich" ist genau der Auffang dafür.
Das Panel bleibt offen und der Fokus im Feld, damit mehrere Tage hintereinander
zu befüllen sind. Das ＋ neben „Termine" erscheint nur, wenn die Verknüpfung
wirklich schreiben darf (`schreiben` aus `/api/google/status`) — ein Knopf, der
in einen 403 läuft, wäre schlechter als keiner. Aus demselben Grund öffnet ein
Tipp auf einen Termin nur dann das Formular; ohne Schreibrecht klappt er wie
früher Ort und Notiz auf.

**Schreiben in Google.** `functions/api/google/termin.js` legt an (POST),
ändert (PUT) und löscht (DELETE) — immer im Hauptkalender. Das Formular deckt
Titel, ganztägig/Uhrzeit, Start- und Enddatum (auch mehrtägig), Farbe aus
Googles Palette und Notiz ab. Richtung Google geht ein **PATCH**, kein PUT:
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
Quellen sichtbar. Zwei localStorage-Mengen: `kalQuellenAus` (abgewählt) und
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

## Fokus-Panel

Zweites Panel im rechten Streifen, unter dem Kalender: die Gewohnheiten von
heute zum Abhaken und der Fokus-Timer. Die Daten kommen aus dem
Fokus-Tracker (`fokus.it-wolf.org`), nicht aus der eigenen Datenbank.
Markup in `index.html`, Verhalten in `fokus.js`, CSS-Block „Fokus-Panel".

**Sichtbar nur mit Fokus-Zugang.** `fokusZugang` steht im Bootstrap von
`/api/todos` und wird über `window.hatFokusZugang()` gelesen — vorher weiß
niemand, ob dieses Konto den Tracker überhaupt benutzen darf. Ohne Zugang gibt
es die Fokus-Reiter nicht, und ein gemerktes `"fokus"` fällt in `zeichneUnten()`
still auf den Kalender zurück (etwa wenn jemand den Zugang wieder aufgibt). Holt man
ihn sich in den Einstellungen, sind sie sofort da (`window.fokusNeuZeichnen()`
am Ende des Klick-Handlers, sonst erst beim nächsten `render()`).

**Und mit dem Schalter „Fokus im Kalender"** (Einstellungen, `#fokusPanelSwitch`,
seit 13.08.2026). Er sitzt unter dem Fokus-Tracker-Link und erscheint nur mit
Zugang — ohne den gäbe es nichts zu schalten. Gemerkt wird er pro Gerät in
`localStorage.fokusPanel` (`"an"` / `"aus"`, Standard an) und **nicht** in der
Datenbank: wer am Rechner die Gewohnheiten mitlaufen lässt, will sie am Handy
nicht zwangsläufig auch. Ausgeschaltet verschwindet die ganze Reiterzeile und
der Streifen zeigt still nur den Kalender. Gelesen wird er über
`window.fokusImStreifen()` in `fokusMoeglich()` (kalender.js).

### Warum die Daten über einen Durchreicher kommen

`functions/api/fokus/[[pfad]].js` nimmt die Anfrage an, prüft Sitzung und
`fokus_zugang`, und stellt sie der Fokus-App. Beide Apps benutzen dieselbe
D1-Datenbank, dieser Worker könnte die Tabellen also direkt lesen — und genau
das wäre der Fehler: Flammen, Rhythmus und Obergrenzen-Regeln sind dort rund
1200 Zeilen, als zweite Kopie hier wären sie irgendwann eine zweite Wahrheit.

Die Fokus-App liefert die Tagesliste deshalb **fertig gerechnet**
(`GET /api/gewohnheiten/heute`, dort neu gebaut). Dieses Panel entscheidet
nichts selbst — welche Gewohnheit heute erscheint, ob sie ruht, wie lang die
Flamme ist, steht alles in der Antwort.

**Nicht direkt aus dem Browser**, obwohl beide Apps auf `it-wolf.org` liegen:
das Sitzungscookie ist `SameSite=Lax`. Ein `fetch` von `todo.it-wolf.org` nach
`fokus.it-wolf.org` bekäme es nicht mit, die Fokus-App sähe einen Fremden. Von
Worker zu Worker geht der Cookie-Kopf dagegen mit.

**Nur sechs Routen sind freigeschaltet** (Tabelle `ROUTEN` im Durchreicher),
je mit fester Methode. Ohne diese Liste hinge an `/api/fokus/` die ganze
Fokus-API, auch `DELETE /api/gewohnheiten` und der Export. Alles, was nicht
in der Tabelle steht, bekommt 404 — auch bei falscher Methode, denn was es
hier nicht gibt, muss auch nicht verraten, dass es das woanders gäbe.

**Preis:** Ist die Fokus-App nicht erreichbar (Deploy, Störung), antwortet der
Durchreicher mit 502 und das Panel zeigt „Der Fokus-Tracker ist gerade nicht
erreichbar." samt Knopf zum erneuten Versuchen. Der Timer bleibt dann ganz
weg — er zeigte sonst eine Dauer und einen Start-Knopf, der nur in die nächste
Fehlermeldung laufen kann. Die ToDo-Liste selbst merkt davon nichts.

Lokal zeigt `FOKUS_BASIS` (in `.dev.vars`) auf den Fokus-Dev-Server nebenan,
live gilt der Standardwert `https://fokus.it-wolf.org`. Zum Testen müssen
**beide** Dev-Server laufen und in **beiden** lokalen D1-Dateien dieselbe
Sitzungszeile stehen — die Datenbanken sind lokal getrennt, anders als live.

### Oben wechselt, unten bleibt

Der rechte Streifen ist **ein** Panel (der Kalender), und er hat zwei Etagen:

| Etage | Inhalt | wer zeichnet | wann |
| --- | --- | --- | --- |
| oben | Monatsraster (`#kalRaster` & Co.) | `kalender.js` | Reiter „Kalender" |
| oben | Gewohnheiten (`#fokInhalt`) | `fokus.js` | Reiter „Gewohnheiten" |
| oben | Timer (`#fokTimer`) | `fokus.js` | Reiter „Timer" |
| unten | Tagesliste (`#kalTagesliste`) | `kalender.js` | **immer** |

**Die Tagesliste gehört keiner Ansicht** — sie ist der Grund, warum es den
Streifen gibt („was ist heute fällig"). Bis zum 13.08.2026 stand sie mit den
Fokus-Inhalten im selben Bereich und wurde von ihnen verdrängt; ein Blick auf
die Gewohnheiten kostete damit genau die Antwort, für die man aufgemacht
hatte. Seitdem weicht stattdessen das **Raster**.

Davor war Fokus sogar ein **zweites Panel** unter dem Kalender, mit eigener
Höhenmessung (`--fok-hoehe`), eigenem Hintergrund und eigenem Öffnen/Schließen.
Der erste Umbau machte daraus einen Bereich mit drei Inhalten (~120 Zeilen CSS
und JS weniger), der zweite verschob die Grenze eine Etage nach oben.

**Die Höhen rechnet niemand aus:** oben und unten tragen beide `flex: 1;
min-height: 0`, teilen sich also, was unter dem Kopf übrig bleibt (gemessen bei
900 px Panelhöhe: 411 zu 425). Das Raster nimmt seine natürliche Höhe, weil es
kein `flex` trägt.

**Wer umschaltet:** `kalObenModus` in `kalender.js` (`"kalender"` / `"fokus"`),
gesetzt über `setzeOben()`. `zeichneUnten()` ist die **einzige** Stelle, an
der Sichtbarkeit entschieden wird — sonst stünde „genau eines" an zwei Orten.
`fokus.js` liefert nur den Inhalt und wird über `window.fokusZeigen()` /
`window.fokusVerstecken()` gerufen; `window.fokusHatZugang()` sagt umgekehrt,
ob es Fokus überhaupt gibt.

**Was mit dem Raster kommt und geht**, steht als Liste `RASTER_TEILE` in
`kalender.js`: Kalender-Kopf, Überfällig-Chip, Quellen-Filter, Wochentage,
Raster. Der Kopf muss mit — ein Monatsname mit Blätterpfeilen über den
Gewohnheiten navigiert durch nichts.

**Falle dabei: Chip und Filter blenden sich auch selbst aus** (leer bzw. nur
eine Quelle). Würde `zeichneUnten()` beim Zurückschalten stumpf alles wieder
einblenden, stünde ein „⚠ Überfällig (0)" da. Sie merken ihre eigene
Entscheidung deshalb in `data-leer`, und `zeichneUnten()` blendet nur ein, was
dort nicht auf `"1"` steht.

**Und wieder die `[hidden]`-Falle** — diesmal gleich vierfach: `.kal-kopf`
(flex), `.kal-wochentage`/`.kal-raster` (grid) und `.kal-unten` (flex) brauchen
alle ihre eigene `[hidden] { display: none }`-Zeile, sonst bleiben sie sichtbar,
obwohl das Attribut gesetzt ist. Dieselbe Familie wie bei `.offline-banner`.

**Die Reiterzeile (`#fokKopf`) gehört dem Streifen, nicht dem Fokus-Inhalt.**
Sie trägt drei Reiter — **Kalender | Gewohnheiten | Timer** — und steht auch
dann da, wenn gerade das Raster vorn ist: sie ist der Weg zwischen allen
dreien. Ihre Klick-Handler liegen deshalb geschlossen in `kalender.js` und
rufen von dort `window.fokusReiter()`; ihre Sichtbarkeit steuert
`zeichneUnten()` über `window.fokusReiterzeile()`.

**Reihenfolge im Klick-Handler ist keine Kosmetik:** erst `setzeOben("fokus")`,
dann `window.fokusReiter(welcher, true)`. `fokusZeigen()` setzt beim ersten
Öffnen auf „Gewohnheiten" zurück — käme die Wahl des Nutzers davor, würde ein
Tipp auf „Timer" still überschrieben.

**Ob es die Reiter gibt**, entscheidet `fokusMoeglich()` aus zwei Teilen:
Fokus-Zugang (`window.fokusHatZugang()`) UND dem Schalter „Fokus im Kalender"
in den Einstellungen (`window.fokusImStreifen()`, `localStorage.fokusPanel`,
Standard an). Fällt eines weg, fällt ein gemerktes `"fokus"` still auf den Tag
zurück — eine Reiterleiste mit genau einem Reiter wäre Zierrat.

**Falle, hier zweimal zugeschnappt:** `.kal-liste` und `.fok-inhalt` haben
`display: flex`, das schlägt das eingebaute `[hidden]` des Browsers. Ohne
`.kal-liste[hidden]` bzw. `.fok-inhalt[hidden] { display: none }` bleiben sie
sichtbar, obwohl das Attribut gesetzt ist — genau so standen die Gewohnheiten
eine Zeit lang neben dem Timer. Dieselbe Familie wie bei `.offline-banner`.

**Im Vollbild** (⤢) gibt es den unteren Teil nicht; `zeichneUnten()` prüft
`kalVollbild` mit. Der Modus bleibt gemerkt und steht beim Verlassen wieder da.

### Der Umschalter: nur noch auf oder zu

📋 | 📅, und genau eines gilt:

* **📋** — Streifen zu
* **📅** — Streifen auf

**WAS unten steht, sagt die Pille nicht mehr** — das entscheiden die Reiter im
Streifen selbst. Bis zum 13.08.2026 gab es hier ein drittes Segment (🔥) für
den Fokus; drei Knöpfe in der Kopfzeile waren einer zu viel, und die Frage
„Tag oder Fokus" an zwei Stellen zu stellen ist eine zu viel. Davor gab es
zwischenzeitlich sogar eine zweite Bedienform fürs breite Fenster (📋 weg, 📅
und 🔥 als unabhängige Ein/Aus-Knöpfe) — die war richtig, solange Kalender und
Fokus zwei getrennte Panels waren, und ist mit dem gemeinsamen Streifen
gefallen. **Beides nicht erneut vorschlagen.**

Gemerkt wird in **einem** Schlüssel, `kalAnsicht`: `"liste"`, `"tag"` oder
`"fokus"`. Der alte Wert `"kalender"` wird beim Lesen als `"tag"` verstanden,
sonst stünde nach dem Update der Streifen zu. `fokAnsicht` gibt es nicht mehr.

**Ein gemerktes `"fokus"` überlebt den Reload nicht** (unverändert seit dem
Streifen-Umbau, kein Fehler des Reiter-Umbaus): beim ersten Zeichnen steht
`fokZugang` noch nicht fest — der kommt erst mit dem Bootstrap aus
`/api/todos` —, `zeichneUnten()` fällt deshalb auf den Kalender zurück und
`setzePanel()` schreibt „kalender" gleich in den Speicher. Der Streifen startet
also immer mit dem Monatsraster. Zu beheben wäre es, indem
`stelleAnsichtHer()` erst nach dem Bootstrap läuft.

Gesetzt wird `aria-pressed` **nur** in `setzePanel()` (kalender.js).

### Ein Tipp auf den Tag wählt ihn — mehr nicht

`waehleTag()` setzt `kalAuswahl` und fertig; ein zweiter Tipp auf denselben Tag
tut nichts. Das war einmal komplizierter (drei Fälle: Fokus nach hinten,
Datumswechsel, zweiter Tipp schaltet zurück zu Fokus bzw. wählt ab) — und
musste es sein, solange Tagesliste und Fokus sich denselben Platz teilten.
**Seit die Tagesliste immer dasteht, gibt es nichts wegzuschalten:** ein leerer
Tagesbereich wäre kein Zustand, den jemand haben will.

Aus demselben Grund springt der **Überfällig-Chip** beim zweiten Tipp auf
`heute` zurück statt auf `null` — vorher blieb die Liste leer stehen. Auch
„Heute" und der Chip müssen den Tag nicht mehr nach vorn holen: beide sitzen im
Kalender-Kopf, den es im Fokus-Modus gar nicht gibt.

### Zwei Reiter: Gewohnheiten oder Timer

Beide teilen sich den Fokus-Bereich, statt übereinander zu stehen (seit
13.08.2026). Nebeneinander blieb für den Timer nur eine Zeile, und eine Zeile
liest sich nicht vom Schreibtisch aus. Jetzt füllt er den ganzen Bereich: ein
Fortschrittsring, die Restzeit in der Mitte, die Knöpfe daneben oder darunter.

**Beim Öffnen stehen die Gewohnheiten vorn — außer es läuft eine Sitzung**,
dann der Timer (`fokReiter` wird in `ladeFokus()` gesetzt). Sobald man selbst
auf einen Reiter tippt, gilt diese Wahl, bis der Fokus-Teil das nächste Mal neu
aufgerufen wird (`fokReiterGewaehlt`).

**Die SVG-Struktur des Rings steht fest in `index.html`**, `fokus.js` setzt im
Sekundentakt nur Text und `stroke-dashoffset`. Ein SVG pro Sekunde neu zu bauen
wäre Verschwendung. Die Knopfreihe wechselt dagegen ihren Inhalt (Start bzw.
Pause/Stopp) und wird bei jedem Zustandswechsel neu gefüllt — aber nur dann,
sonst flackerte sie im Takt.

`display: block` am SVG ist Pflicht: als Inline-Element steht es auf der
Textgrundlinie, und die Lücke darunter machte den Kreis fünf Pixel höher als
breit — aus dem Ring wurde ein Ei.

**Der Ring richtet sich nach dem Platz, nicht nach dem Fenster.** Er nimmt die
Höhe, die unter den Reitern übrig bleibt (`flex: 1 1 auto`), und leitet seine
Breite daraus ab (`aspect-ratio: 1`). An `vh` zu hängen ging schief: am Handy
bleiben unter dem Monatsraster gut 200 px, der Ring nahm sich 280 und schob die
Knöpfe 88 px aus dem Bild.

**Unter 280 px Bereichshöhe stellt sich der Timer quer** (`@container unten`):
Ring links über die volle Höhe, Knöpfe rechts untereinander. Übereinander
blieben für den Ring rund 90 px, und darin ist eine Uhrzeit nicht mehr zu
lesen. Am Handy misst er so 150 statt 88 px.

Die Zahl in der Mitte skaliert mit dem Ring statt mit dem Fenster
(`font-size: clamp(20px, 22cqmin, 44px)`, dafür ist `.fok-ring` selbst ein
`container-type: size`).

### Was der Fokus-Teil kann — und was nicht

Abhaken (einfach oder mit Menge über −/Zahl/+), Flammen sehen, Timer starten,
pausieren, beenden. Sonst nichts: Gewohnheiten anlegen, ändern, archivieren,
Verlauf, Statistik, Standarddauer und Export bleiben in der Fokus-App, dorthin
führt das ↗ in der Kopfzeile des Bereichs.

Nach jedem Haken wird **zweimal** aktualisiert: sofort aus der Antwort von
`log` (Menge, Ziel, Zustand, Flamme stehen dort drin) und gleich danach die
ganze Liste frisch. Das zweite ist nötig, weil sich das Drumherum ändern kann —
die Tagesbilanz, und bei „X Mal die Woche" verschwindet die Gewohnheit mit dem
erreichten Ziel ganz aus der Liste.

**Der Timer ist reine Anzeige**, gerechnet wird aus dem Startzeitpunkt vom
Server (siehe `BETRIEB.md` der Fokus-App). Die Dauer kommt aus der dortigen
Standardeinstellung und lässt sich hier nicht ändern. Beenden fragt ab einer
Minute nach — eine geloggte Sitzung ist nachträglich nicht mehr änderbar.

**Bei laufender Sitzung trägt der Timer-REITER die Restzeit** („Timer 44:52",
`.fok-reiter-seg.laeuft` in der Akzentfarbe), auch wenn gerade ein anderer
Reiter vorn ist. Gesetzt in `aktualisiereSegmente()`, im Sekundentakt.

Bis zum 13.08.2026 stand die Zeit am 🔥-Knopf der Kopfzeile — mitsamt einer
CSS-Konstruktion, die sie am Handy zu einem 6-px-Glutpunkt schrumpfte
(`font-size: 0`) und die Flamme allein dimmte, weil sich die Deckkraft eines
Elternteils auf einem Kind nicht zurücknehmen lässt. Mit der Flamme ist das
alles weg. **Der Preis, bewusst:** bei zugeklapptem Streifen sieht man die
Restzeit nirgends mehr. Das Sitzungsende meldet sich weiterhin über den
Tab-Titel und den Ton, nur der laufende Countdown ist dann unsichtbar.

Am Sitzungsende gibt es **Ton und Tab-Titel**, aber bewusst **keine
Browser-Benachrichtigung**: die schickt die Fokus-App schon, und bei zwei
offenen Tabs meldete sich dasselbe Sitzungsende sonst doppelt.

**Offline funktioniert das Panel nicht.** Die Warteschlange der ToDo-Liste
gilt nur für ToDos; hier erscheint die Fehlermeldung von oben.
