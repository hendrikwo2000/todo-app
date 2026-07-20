# Betrieb

Technische Dokumentation. Für die Bedienung siehe [README.md](README.md).

Läuft als Cloudflare-Pages-Projekt auf `todo.it-wolf.org`, deployt automatisch
aus diesem Repo (Branch `main`, kein Build-Schritt).

Die Daten liegen in einer Cloudflare-D1-Datenbank (Bindung `DB`, Schema in
[schema.sql](schema.sql)) — nicht verschlüsselt: echte Spalten statt
Chiffretext erlauben Sortieren, Filtern und später geteilte Listen. Der Preis:
der Betreiber kann die Inhalte lesen.

## Login

Anmeldelink statt Passwort: wer sich anmelden darf, steht in der Tabelle
`users` — das ist zugleich die ganze Zugangsbeschränkung, es gibt keine offene
Registrierung.

Ablauf: Adresse eintragen → `/api/auth/request-code` verschickt über
[Resend](https://resend.com) eine Mail mit **Link** (ein Klick, fertig) und
einem sechsstelligen **Code** als Ausweg für den Gerätewechsel. Der Link geht
an `/api/auth/link`, der Code an `/api/auth/verify-code`; beide zeigen auf
denselben Datenbankeintrag, was zuerst benutzt wird, verbraucht beide. Gültig
sind sie zehn Minuten.

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

## Warteliste und Verwaltung

Auf dem Anmeldebildschirm führt „Noch keinen Zugang? Eintragen" zu einem
Formular (Name + Adresse) → `/api/waitlist`. Der Eintrag landet in der Tabelle
`waitlist`; der Eintragende bekommt eine Bestätigung, die Verwaltung eine
Benachrichtigung.

Unter **[/admin](https://todo.it-wolf.org/admin)** stehen offene Anfragen und
die Nutzerliste. Freischalten legt das Konto an und verschickt eine
Willkommensmail; Ablehnen setzt nur den Status — bewusst ohne Mail.

**Die Willkommensmail meldet direkt an.** Sie enthält einen Anmeldelink, der
sieben Tage gilt (`functions/_lib/willkommen.js`). Er liegt als normaler
Eintrag in `login_codes` und wird vom selben `/api/auth/link` eingelöst. Sieben
Tage statt zehn Minuten, weil so eine Mail auch mal ein Wochenende liegen
bleibt; wer Zugriff aufs Postfach hat, könnte sich ohnehin jederzeit selbst
einen Anmeldelink schicken lassen.

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
einzige Admin aus. Der Zugang zum Dashboard versteckt sich in der App hinter
einem **Doppelklick auf die Überschrift „ToDo-Liste"**; bei Nicht-Admins
passiert dabei nichts.

Ein Nutzer lässt sich auch direkt anlegen, ohne Warteliste:

```sql
INSERT INTO users (email, name, role) VALUES ('adresse@example.com', 'Name', 'user');
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

## Konten löschen

Nutzer löschen ihr eigenes Konto in der App über den Abmelden-Knopf →
„Konto löschen"; zur Bestätigung muss die eigene Adresse abgetippt werden.
Admins löschen fremde Konten im Dashboard. Beide Wege verschicken eine
Benachrichtigung an die betroffene Adresse.

Gelöscht werden Nutzer, Bereiche, ToDos, Sitzungen, offene Codes **und der
Wartelisten-Eintrag** — letzterer, damit die Person sich neu bewerben kann;
sonst hinge sie zwischen „kein Konto" und „steht schon auf der Liste" fest.
Alles in einer Transaktion, Kindtabellen ausdrücklich zuerst (nicht auf
`ON DELETE CASCADE` verlassen, das hängt an `PRAGMA foreign_keys`).

**Der letzte Admin lässt sich nicht löschen** und sich auch selbst nicht
degradieren — sonst käme niemand mehr an die Verwaltung.
