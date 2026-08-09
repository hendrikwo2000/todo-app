"use strict";

/* ====================================================================
   Verwaltung: Warteliste freischalten oder ablehnen, Nutzer ansehen.

   Diese Datei versteckt die Oberflaeche nur. Die Rechtepruefung sitzt in
   functions/api/admin/waitlist.js - admin.html ist eine statische Datei,
   die jeder laden kann.
   ==================================================================== */

const API = "/api/admin/waitlist";

const inhalt     = document.getElementById("inhalt");
const keinZugang = document.getElementById("kseinZugang");
const offenEl    = document.getElementById("offen");
const nutzerEl   = document.getElementById("nutzer");
const offenZahl  = document.getElementById("offenZahl");
const nutzerZahl = document.getElementById("nutzerZahl");
const snackbar   = document.getElementById("snackbar");

let snackTimer = null;
function melde(text) {
  snackbar.textContent = text;
  snackbar.classList.add("show");
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => snackbar.classList.remove("show"), 3200);
}

// Datum aus SQLite ("2026-07-20 15:04:11", UTC) lesbar machen.
function datum(text) {
  const d = new Date(String(text).replace(" ", "T") + "Z");
  return isNaN(d) ? text : d.toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Zeile bauen. Alles per textContent - Name und Adresse stammen aus einem
// oeffentlichen Formular und duerfen nie als HTML interpretiert werden.
function zeile(eintrag, knoepfe) {
  const div = document.createElement("div");
  div.className = "admin-zeile";

  const links = document.createElement("div");
  const name = document.createElement("div");
  name.className = "admin-name";
  name.textContent = eintrag.name || "(ohne Namen)";
  const unten = document.createElement("div");
  unten.className = "admin-meta";
  unten.textContent = `${eintrag.email} · ${datum(eintrag.created_at)}`;
  links.append(name, unten);

  const rechts = document.createElement("div");
  rechts.className = "admin-aktionen";
  for (const k of knoepfe) rechts.append(k);

  div.append(links, rechts);
  return div;
}

function knopf(text, klasse, beiKlick) {
  const b = document.createElement("button");
  b.className = "btn " + klasse;
  b.textContent = text;
  b.addEventListener("click", beiKlick);
  return b;
}

function marke(text, klasse) {
  const s = document.createElement("span");
  s.className = "admin-marke " + klasse;
  s.textContent = text;
  return s;
}

// Toggle-Switch fuer ein Recht: Status (an/aus) und Umschalt-Aktion in einem
// Element, statt getrenntem Badge + Button. "aktiv=false" zeigt den Stand nur
// noch (z.B. beim eigenen Konto, wo der Server die Aenderung ohnehin verweigert).
function schalter(text, an, aktiv, beiAenderung) {
  const label = document.createElement("label");
  label.className = "switch" + (aktiv ? "" : " ist-gesperrt");
  if (!aktiv) label.title = "Beim eigenen Konto nicht änderbar.";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = an;
  input.disabled = !aktiv;
  if (aktiv) input.addEventListener("change", () => beiAenderung(input));

  const track = document.createElement("span");
  track.className = "switch-track";
  const thumb = document.createElement("span");
  thumb.className = "switch-thumb";
  track.append(thumb);

  const beschriftung = document.createElement("span");
  beschriftung.className = "switch-label";
  beschriftung.textContent = text;

  label.append(input, beschriftung, track);
  return label;
}

async function bearbeite(id, aktion, steuerEl, extra = {}) {
  // Bei Schaltern (Checkbox) hat der Klick den Haken schon umgestellt, bevor
  // dieser Code laeuft - bei Abbruch/Fehler muss das wieder zurueckgedreht werden.
  const istSchalter = steuerEl instanceof HTMLInputElement;
  const zurueckdrehen = () => { if (istSchalter) steuerEl.checked = !steuerEl.checked; };

  if (aktion === "ablehnen" && !confirm("Diese Anfrage wirklich ablehnen?")) return;
  if (aktion === "rolle" && extra.rolle === "admin"
      && !confirm("Diesem Nutzer Adminrechte geben? Er kann dann alle Anfragen und Nutzer verwalten.")) { zurueckdrehen(); return; }
  // Zwei Rueckfragen beim Loeschen: der Vorgang nimmt fremde ToDos mit und
  // laesst sich nicht rueckgaengig machen.
  if (aktion === "nutzerLoeschen") {
    const wer = `${extra.name || extra.email} (${extra.email})`;
    if (!confirm(`${wer} löschen?\n\nAlle Bereiche und ToDos dieser Person werden unwiderruflich entfernt.`)) return;
    if (!confirm("Wirklich sicher? Das lässt sich nicht rückgängig machen.")) return;
  }
  steuerEl.disabled = true;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, aktion, ...extra }),
    });
    const daten = await res.json().catch(() => ({}));
    if (!res.ok) {
      melde(daten.error || "Hat nicht geklappt.");
      zurueckdrehen();
      steuerEl.disabled = false;
      return;
    }
    // mailVerschickt kommt nur beim Freischalten - der Unterschied ist
    // wichtig: das Konto steht, aber die Person weiss es evtl. nicht.
    if (aktion === "freischalten") {
      melde(daten.mailVerschickt === false
        ? "Freigeschaltet — aber die Willkommensmail ging nicht raus."
        : "Freigeschaltet, Willkommensmail verschickt.");
    } else if (aktion === "rolle") {
      melde(extra.rolle === "admin" ? "Adminrechte vergeben." : "Adminrechte entzogen.");
    } else if (aktion === "fokus") {
      melde(extra.fokusZugang ? "Fokus-Zugang gegeben." : "Fokus-Zugang entzogen.");
    } else if (aktion === "todo") {
      melde(extra.todoZugang ? "ToDo-Zugang gegeben." : "ToDo-Zugang entzogen.");
    } else if (aktion === "nutzerLoeschen") {
      melde(daten.mailVerschickt === false
        ? "Gelöscht — aber die Benachrichtigung ging nicht raus."
        : "Gelöscht, Benachrichtigung verschickt.");
    } else {
      melde("Abgelehnt.");
    }
    laden();
  } catch (e) {
    melde("Server nicht erreichbar.");
    zurueckdrehen();
    steuerEl.disabled = false;
  }
}

function zeichne(daten) {
  const offen = daten.warteliste.filter(w => w.status === "offen");

  offenZahl.textContent = offen.length;
  nutzerZahl.textContent = daten.nutzer.length;

  offenEl.replaceChildren();
  if (!offen.length) {
    const leer = document.createElement("p");
    leer.className = "admin-leer";
    leer.textContent = "Keine offenen Anfragen.";
    offenEl.append(leer);
  }
  for (const w of offen) {
    const frei = knopf("Freischalten", "primaer", () => bearbeite(w.id, "freischalten", frei));
    const ab = knopf("Ablehnen", "still", () => bearbeite(w.id, "ablehnen", ab));
    // Herkunft nur zeigen, wenn sie vom Normalfall abweicht - die Mehrheit
    // kommt ueber ToDo, ein Badge dafuer waere nur Rauschen.
    const knoepfe = w.quelle === "fokus" ? [marke("via Fokus", "fokus"), frei, ab] : [frei, ab];
    offenEl.append(zeile(w, knoepfe));
  }

  nutzerEl.replaceChildren();
  for (const n of daten.nutzer) {
    const istIch = n.id === daten.ichSelbst;
    const aktionen = [];
    // Das eigene Konto klar kennzeichnen - vorher war es nur daran zu
    // erkennen, dass die Knoepfe fehlen, und das ist kein Hinweis.
    if (istIch) aktionen.push(marke("Du", "du"));

    // Adminrechte und ToDo-Zugang sperren sich selbst zu entziehen serverseitig
    // (Aussperr-Risiko) - der Schalter zeigt beim eigenen Konto nur noch den
    // Stand, laesst sich aber nicht anfassen. Fokus-Zugang hat kein
    // Aussperr-Risiko und bleibt auch beim eigenen Konto bedienbar.
    aktionen.push(schalter("Admin", n.role === "admin", !istIch,
      input => bearbeite(n.id, "rolle", input, { rolle: input.checked ? "admin" : "user" })));
    aktionen.push(schalter("ToDo", !!n.todo_zugang, !istIch,
      input => bearbeite(n.id, "todo", input, { todoZugang: input.checked })));
    aktionen.push(schalter("Fokus", !!n.fokus_zugang, true,
      input => bearbeite(n.id, "fokus", input, { fokusZugang: input.checked })));

    if (!istIch) {
      const del = knopf("Löschen", "gefahr",
        () => bearbeite(n.id, "nutzerLoeschen", del, { name: n.name, email: n.email }));
      aktionen.push(del);
    }
    nutzerEl.append(zeile(n, aktionen));
  }

}

async function laden() {
  let res;
  try {
    res = await fetch(API, { cache: "no-store" });
  } catch (e) {
    melde("Server nicht erreichbar.");
    return;
  }
  if (!res.ok) {
    // 404 heisst hier "keine Adminrechte" - siehe Function.
    inhalt.hidden = true;
    keinZugang.hidden = false;
    return;
  }
  keinZugang.hidden = true;
  inhalt.hidden = false;
  zeichne(await res.json());
}

// Design-Einstellung von der Hauptseite uebernehmen.
const gespeichert = localStorage.getItem("theme");
if (gespeichert) document.documentElement.dataset.theme = gespeichert;

laden();
