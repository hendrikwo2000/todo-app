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
const erledigtEl = document.getElementById("erledigt");
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

async function bearbeite(id, aktion, knopfEl, extra = {}) {
  if (aktion === "ablehnen" && !confirm("Diese Anfrage wirklich ablehnen?")) return;
  if (aktion === "rolle" && extra.rolle === "admin"
      && !confirm("Diesem Nutzer Adminrechte geben? Er kann dann alle Anfragen und Nutzer verwalten.")) return;
  // Zwei Rueckfragen beim Loeschen: der Vorgang nimmt fremde ToDos mit und
  // laesst sich nicht rueckgaengig machen.
  if (aktion === "nutzerLoeschen") {
    const wer = `${extra.name || extra.email} (${extra.email})`;
    if (!confirm(`${wer} löschen?\n\nAlle Bereiche und ToDos dieser Person werden unwiderruflich entfernt.`)) return;
    if (!confirm("Wirklich sicher? Das lässt sich nicht rückgängig machen.")) return;
  }
  knopfEl.disabled = true;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, aktion, ...extra }),
    });
    const daten = await res.json().catch(() => ({}));
    if (!res.ok) {
      melde(daten.error || "Hat nicht geklappt.");
      knopfEl.disabled = false;
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
    knopfEl.disabled = false;
  }
}

function zeichne(daten) {
  const offen = daten.warteliste.filter(w => w.status === "offen");
  const erledigt = daten.warteliste.filter(w => w.status !== "offen");

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
    offenEl.append(zeile(w, [frei, ab]));
  }

  nutzerEl.replaceChildren();
  for (const n of daten.nutzer) {
    const aktionen = [];
    if (n.role === "admin") aktionen.push(marke("Admin", "admin"));
    // Beim eigenen Konto kein Knopf: sich selbst die Rechte zu entziehen
    // sperrt einen aus, sobald man der einzige Admin ist. Der Server
    // verweigert es ohnehin - hier gar nicht erst anbieten.
    if (n.id !== daten.ichSelbst) {
      const zielRolle = n.role === "admin" ? "user" : "admin";
      const b = knopf(
        n.role === "admin" ? "Adminrechte entziehen" : "Zum Admin machen",
        "still",
        () => bearbeite(n.id, "rolle", b, { rolle: zielRolle })
      );
      const del = knopf("Löschen", "gefahr",
        () => bearbeite(n.id, "nutzerLoeschen", del, { name: n.name, email: n.email }));
      aktionen.push(b, del);
    }
    nutzerEl.append(zeile(n, aktionen));
  }

  erledigtEl.replaceChildren();
  if (!erledigt.length) {
    const leer = document.createElement("p");
    leer.className = "admin-leer";
    leer.textContent = "Noch nichts bearbeitet.";
    erledigtEl.append(leer);
  }
  for (const w of erledigt) {
    erledigtEl.append(zeile(w, [
      w.status === "freigeschaltet"
        ? marke("Freigeschaltet", "gut")
        : marke("Abgelehnt", "schlecht"),
    ]));
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
