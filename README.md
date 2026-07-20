# ToDo-Liste

Ein ToDo-Board im Browser: Bereiche als Spalten, ToDos mit Termin und Notiz.
Läuft auch als App auf dem Handy (zum Startbildschirm hinzufügen).

**→ [todo.it-wolf.org](https://todo.it-wolf.org/)**

Beim ersten Öffnen die E-Mail-Adresse eingeben, dann den Code aus der Mail.

## Bedienung

**Bereiche**

- **＋ Bereich** oben anlegen
- Doppelklick auf den Titel zum Umbenennen, 🗑️ zum Löschen
- Titel ziehen, um die Spalten umzusortieren

**ToDos**

- **＋ ToDo** anlegen: Text, optional eine Notiz und über 📅 ein Termin
- Häkchen setzen = erledigt, Häkchen raus = wieder offen
- Doppelklick zum Bearbeiten, 🗑️ zum Löschen
- Zwischen Spalten hin- und herziehen

Offene ToDos stehen nach Termin sortiert. Heute fällige sind gelb, überfällige
rot, welche ohne Termin blau. Mit ☾ / ☀ wechselt das Design.

## Betrieb

Läuft als Cloudflare-Pages-Projekt auf `todo.it-wolf.org`, deployt automatisch
aus diesem Repo (Branch `main`, kein Build-Schritt).

Die Daten liegen in einer Cloudflare-D1-Datenbank (Bindung `DB`, Schema in
[schema.sql](schema.sql)) — nicht mehr verschlüsselt: echte Spalten statt
Chiffretext erlauben Sortieren, Filtern und später geteilte Listen. Der Preis:
der Betreiber kann die Inhalte lesen.

### Login

Anmeldelink statt Passwort: wer sich anmelden darf, steht in der Tabelle
`users` — das ist zugleich die ganze Zugangsbeschränkung, es gibt keine
Registrierung. Ablauf: Adresse eintragen → `/api/auth/request-code` verschickt
über [Resend](https://resend.com) eine Mail mit **Link** (ein Klick, fertig)
und einem sechsstelligen **Code** als Ausweg für den Gerätewechsel. Der Link
geht an `/api/auth/link`, der Code an `/api/auth/verify-code`; beide zeigen auf
denselben Datenbankeintrag, was zuerst benutzt wird, verbraucht beide.

Danach ein `HttpOnly`-Sitzungscookie. Sitzungen laufen **nicht von selbst ab** —
nur Abmelden oder Kontolöschung beendet sie. Das Cookie selbst ist auf 400 Tage
gesetzt, weil Browser längere Werte stillschweigend kürzen. Codes und
Sitzungstoken liegen nur gehasht in der Datenbank.
Abmelden über `/api/auth/logout` löscht die Sitzung serverseitig, nicht nur
das Cookie — ein abgegriffenes Token wird damit ebenfalls ungültig.

Unbekannte Adressen bekommen eine klare Absage („Diese Adresse ist nicht
freigeschaltet"). Das verrät, welche Adressen registriert sind — bei einer
Handvoll bekannter Leute ohne offene Registrierung ist das vertretbar. Käme je
eine öffentliche Registrierung dazu, gehört hier die generische Antwort
zurück.

Nötige Secrets unter *Pages → Settings → Environment variables*:

| Variable | Zweck |
| --- | --- |
| `RESEND_KEY` | Resend-API-Key mit Sending-Zugriff auf `mail.it-wolf.org` |
| `ADMIN_MAIL` | optional: Adresse für Wartelisten-Benachrichtigungen. Ohne sie gehen sie an alle Konten mit `role='admin'` |
| `TURNSTILE_SECRET` | Geheimer Schlüssel des Turnstile-Widgets. Fehlt er, findet **keine** Bot-Prüfung statt |

Absenderadresse ist `login@mail.it-wolf.org` (fest im Code, keine Mailbox
nötig — Resend verschickt nur, empfängt nichts). Die Domain-DNS-Einträge
(DKIM/SPF/MX) liegen unter `mail.it-wolf.org`, getrennt von den
Zoho-MX-Einträgen der Hauptdomain.

Lokal testen (RESEND_KEY nur nötig, wenn der Mailversand selbst getestet
werden soll — ohne gültigen Key schlägt nur der Versand fehl, alles andere
funktioniert):

```
npx wrangler pages dev . --d1 DB=todo --binding RESEND_KEY=...
```

### Warteliste und Verwaltung

Auf dem Anmeldebildschirm führt „Noch keinen Zugang? Eintragen" zu einem
Formular (Name + Adresse) → `/api/waitlist`. Der Eintrag landet in der
Tabelle `waitlist`, und alle Konten mit `role='admin'` bekommen eine Mail.

Unter **[/admin](https://todo.it-wolf.org/admin)** stehen offene Anfragen,
Nutzer und der Verlauf. Freischalten legt das Konto an und verschickt eine
Willkommensmail; Ablehnen setzt nur den Status — bewusst ohne Mail.

`admin.html` ist eine statische Datei, die jeder laden kann. Die Sperre sitzt
in `/api/admin/*`: ohne Adminrechte antwortet der Endpunkt mit **404** (nicht
403 — wer keine Rechte hat, muss nicht erfahren, dass es hier etwas gibt).
Die Rolle wird bei jeder Anfrage frisch aus der Datenbank gelesen, nicht aus
dem Cookie — sonst behielte jemand entzogene Adminrechte bis zu 30 Tage.

Das öffentliche Formular ist durch **Cloudflare Turnstile** geschützt
(Widget „todo.it-wolf.org Warteliste", Sitekey steht offen in `app.js`, der
geheime Schlüssel als `TURNSTILE_SECRET`). Ohne gesetztes Secret wird **nicht**
geprüft — das hält die lokale Entwicklung ohne Schlüssel am Laufen, heißt in
der Produktion aber: Variable vergessen = Formular ungeschützt. Zusätzlich gilt
höchstens ein Eintrag pro Minute über alle Adressen.

Der Sitekey erlaubt nur `todo.it-wolf.org`. Lokal rendert das Widget deshalb
nicht; die Function lässt ohne Secret trotzdem durch.

**Freischalten direkt aus der Mail:** Die Benachrichtigung enthält einen
Einmal-Link (7 Tage gültig) auf `/freischalten`. Das bloße Öffnen tut nichts —
erst der Klick auf den Knopf schaltet frei. Grund: Mailprogramme und
Sicherheitsscanner öffnen Links teilweise von sich aus.

**Adminrechte** vergibt man im Dashboard in der Nutzerliste („Zum Admin
machen"). Man kann sie sich nicht selbst entziehen — sonst sperrt sich der
einzige Admin aus. Der Zugang zum Dashboard versteckt sich in der App hinter
einem **Doppelklick auf die Überschrift „ToDo-Liste"**; bei Nicht-Admins
passiert dabei nichts.

### Konten löschen

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

Ein Nutzer lässt sich auch direkt anlegen, ohne Warteliste:

```sql
INSERT INTO users (email, name, role) VALUES ('adresse@example.com', 'Name', 'user');
```
