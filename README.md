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

E-Mail-Code statt Passwort: wer sich anmelden darf, steht in der Tabelle
`users` — das ist zugleich die ganze Zugangsbeschränkung, es gibt keine
Registrierung. Ablauf: Adresse eintragen → `/api/auth/request-code` verschickt
einen sechsstelligen Code über [Resend](https://resend.com) →
`/api/auth/verify-code` prüft ihn und setzt ein `HttpOnly`-Sitzungscookie
(30 Tage). Codes und Sitzungstoken liegen nur gehasht in der Datenbank.
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

### Nutzer hinzufügen

Es gibt keine Warteliste und keine Selbstregistrierung. Ein weiterer Nutzer
ist ein `INSERT` in die `users`-Tabelle (per D1-Konsole im Dashboard):

```sql
INSERT INTO users (email, name, role) VALUES ('adresse@example.com', 'Name', 'user');
```
