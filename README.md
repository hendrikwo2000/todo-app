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
| `ADMIN_MAIL` | optional: Adresse für Wartelisten-Benachrichtigungen. Ohne sie gehen sie an alle Konten mit `role='admin'` |

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

Das öffentliche Formular hat **keinen Bot-Schutz**. Solange die Adresse
nirgends verlinkt ist, ist das Risiko gering; kommt Müll an, wäre Turnstile
der nächste Schritt (it-wolf.org nutzt es bereits). Als grobe Bremse gilt
höchstens ein Eintrag pro Minute über alle Adressen.

**Adminrechte** vergibt man im Dashboard in der Nutzerliste („Zum Admin
machen"). Man kann sie sich nicht selbst entziehen — sonst sperrt sich der
einzige Admin aus. Der Zugang zum Dashboard versteckt sich in der App hinter
einem **Doppelklick auf die Überschrift „ToDo-Liste"**; bei Nicht-Admins
passiert dabei nichts.

Ein Nutzer lässt sich auch direkt anlegen, ohne Warteliste:

```sql
INSERT INTO users (email, name, role) VALUES ('adresse@example.com', 'Name', 'user');
```
