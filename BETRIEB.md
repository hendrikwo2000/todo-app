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
(doppelter Beitritt und eigene Liste sind harmlos). „Link zurücksetzen" (in
`teilen` mit `{ reset: true }`) vergibt einen neuen Token, der alte läuft ins
Leere. „Alle entfernen" (`mitglieder` mit `{ alle: true }`) wirft alle Mitglieder
raus **und** setzt `share_token` auf NULL.

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
