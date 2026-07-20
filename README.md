# ToDo-Liste

Ein ToDo-Board im Browser: Bereiche als Spalten, ToDos mit Termin und Notiz.
Läuft auch als App auf dem Handy (zum Startbildschirm hinzufügen).

**→ [todo.it-wolf.org](https://todo.it-wolf.org/)**

Beim ersten Öffnen einmal das Passwort eingeben – das Gerät merkt es sich.

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

Die Daten liegen verschlüsselt in einem JSONBin-Bin. Die App spricht JSONBin
**nicht** direkt an, sondern über `/api/todos` — die Zugangsdaten stehen sonst
im ausgelieferten `app.js` und damit für jeden lesbar da. Nötige Secrets unter
*Pages → Settings → Environment variables*:

| Variable | Zweck |
| --- | --- |
| `JSONBIN_ID` | Bin-ID |
| `JSONBIN_KEY` | Access-Key, nur auf dieses Bin berechtigt |
| `DASHBOARD_URL` | optional: Apps-Script-Endpunkt der Zweitsicherung |
| `DASHBOARD_SECRET` | optional: gemeinsames Geheimnis dafür |

Lokal testen:

```
npx wrangler pages dev . --binding JSONBIN_ID=... JSONBIN_KEY=...
```

### Offene Schwachstelle

`/api/todos` prüft nicht, **wer** schreibt. Mitlesen bringt nichts — die ToDos
sind auf dem Gerät mit AES-GCM verschlüsselt, der Server sieht nur Chiffretext.
Ein PUT von außen könnte den Stand aber überschreiben. Mit dem früher
öffentlichen Access-Key ging das genauso, schlechter ist es also nicht
geworden; behoben ist es trotzdem nicht. Sauber wäre ein aus dem Passwort
abgeleitetes Token, das die Function gegen ein Secret prüft.
