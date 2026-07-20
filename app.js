"use strict";

/* ====================================================================
   ToDo-Liste – Board-Ansicht (Cloud-Version)
   - Eigenes, einklappbares Eingabefeld pro Spalte (Termin per Kalender-Icon)
   - Bereichsname und ToDo werden per Doppelklick bearbeitet
   - Erledigte ToDos unten in jeder Spalte (einklappbar, aufräumbar)
   - Verschieben zwischen Bereichen UND Umsortieren termin-loser ToDos
     per Drag & Drop
   - Heller / dunkler Modus
   Daten liegen in einer Cloudflare-D1-Datenbank und werden bei jeder
   Aenderung ueber /api/todos zurueckgeschrieben, damit alle Geraete
   denselben Stand sehen.
   ==================================================================== */

// ---------- Cloud-Speicher ----------
// Alles laeuft ueber /api/todos (siehe functions/api/todos.js). Die App kennt
// weder Datenbank noch Zugangsdaten - wer angemeldet ist, entscheidet das
// Sitzungs-Cookie, und der Server liefert nur die eigenen Daten aus.
const API_BASE = "/api/todos";

let state = { categories: [], todos: [] };
let editingId = null;      // id des ToDos, das gerade bearbeitet wird
let editingCat = null;     // id des Bereichs, dessen Name gerade bearbeitet wird
let draggedId = null;      // id des ToDos, das gerade gezogen wird
let draggedCat = null;     // id des Bereichs, der gerade umsortiert wird
let addingCat = null;      // Bereich, dessen Eingabefeld gerade aufgeklappt ist

// Eingeklappte Erledigt-Bereiche pro Kategorie (in localStorage gemerkt).
let doneCollapsed = {};
try { doneCollapsed = JSON.parse(localStorage.getItem("doneCollapsed") || "{}"); }
catch (e) { doneCollapsed = {}; }

// ---------- DOM-Referenzen ----------
const board        = document.getElementById("board");
const addCatBtn    = document.getElementById("addCatBtn");
const saveStatusEl = document.getElementById("saveStatus");
const themeBtn     = document.getElementById("themeBtn");
const logoutBtn    = document.getElementById("logoutBtn");
const snackbar     = document.getElementById("snackbar");
const titel        = document.getElementById("titel");
const adminPopup   = document.getElementById("adminPopup");
const kontoPopup   = document.getElementById("kontoPopup");

// Oeffentlicher Sitekey des Turnstile-Widgets fuer todo.it-wolf.org. Darf im
// Quelltext stehen - der geheime Schluessel liegt als TURNSTILE_SECRET im
// Pages-Projekt und verlaesst den Server nie.
const TURNSTILE_SITEKEY = "0x4AAAAAAD59Ii7T3CeedSfa";
let turnstileId = null;

// Werden beim Laden aus der Server-Antwort gesetzt. istAdmin ist nur fuer
// die Optik - /api/admin/* prueft die Rolle selbst nochmal.
let istAdmin = false;
let eigeneEmail = "";

// ---------- Hilfsfunktionen ----------
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

// Datum n Tage ab heute als "YYYY-MM-DD".
function addDaysStr(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return addDaysStr(0); }

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Kurzform fuer das Kalender-Icon, z. B. "15.07."
function formatDateShort(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

function dueInfo(iso) {
  if (!iso) return null;
  const today = todayStr();
  if (iso < today) return { cls: "overdue", badge: "Überfällig" };
  if (iso === today) return { cls: "today", badge: "Heute" };
  if (iso === addDaysStr(1)) return { cls: "", badge: "Morgen" };
  return { cls: "", badge: "" };
}

// Dringlich = ueberfaellig, heute oder morgen faellig. Steuert die Ampelfarben
// (Streifen am ToDo und Zaehler neben der Bereichs-Ueberschrift).
function isUrgent(iso) { return !!iso && iso <= addDaysStr(1); }

// Nativen Kalender-Dialog eines Datumsfelds oeffnen. Das Feld selbst bleibt
// unsichtbar (siehe .date-field im CSS), showPicker braucht es aber im Layout.
function openDatePicker(input) {
  if (typeof input.showPicker === "function") {
    try { input.showPicker(); return; } catch (e) { /* Fallback unten */ }
  }
  input.focus();
  input.click();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------- Heller / dunkler Modus ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeBtn.textContent = theme === "dark" ? "☀" : "☾";
  themeBtn.title = theme === "dark" ? "Helles Design" : "Dunkles Design";
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
}

// ---------- Zugang ----------
// Login per Anmeldelink (Code als Ausweg) statt Passwort - Endpunkte in
// functions/api/auth/. Die Sitzung lebt in einem HttpOnly-Cookie, das der
// Browser bei jeder gleichseitigen Anfrage von selbst mitschickt; anders als
// das fruehere Passwort in localStorage kommt kein Skript im Browser mehr
// an das Sitzungstoken heran.
//
// canSave bleibt false, bis der vorhandene Stand wirklich gelesen wurde -
// sonst wuerde die erste Aenderung nach einem Ladefehler das Board leer
// ueberschreiben.
let canSave = false;

// ---------- Anmeldemaske ----------
// Normalfall: Adresse eintragen, Mail oeffnen, Link klicken - fertig. Diese
// Maske bleibt dabei stehen; angemeldet wird man durch den Link im anderen
// Tab. Das Codefeld ist der Ausweg fuer den Geraetewechsel.
// Turnstile-Widget nur im Wartelisten-Schritt zeigen. Der Login braucht es
// nicht: dort kommen ohnehin nur bekannte Adressen durch.
//
// Das Skript laedt async - wenn der Nutzer schneller ist, wird spaeter
// nachgeholt. Ohne geladenes Skript bleibt turnstileId null; die Function
// laesst dann durch, solange sie kein Token erwartet.
function zeigeTurnstile(an) {
  const kasten = document.getElementById("lockTurnstile");
  kasten.hidden = !an;
  if (!an) return;
  if (!window.turnstile) {
    // Skript noch unterwegs - gleich nochmal versuchen.
    setTimeout(() => { if (!kasten.hidden) zeigeTurnstile(true); }, 400);
    return;
  }
  if (turnstileId === null) {
    turnstileId = window.turnstile.render(kasten, {
      sitekey: TURNSTILE_SITEKEY,
      theme: "auto",
    });
    // Werbeblocker und strenge Netzwerke schlucken das Widget manchmal:
    // render() meldet keinen Fehler, es erscheint nur nie ein iframe. Ohne
    // Hinweis stuende man dann vor einem Formular, das der Server wortlos
    // ablehnt.
    setTimeout(() => {
      if (kasten.hidden || kasten.querySelector("iframe")) return;
      const hinweis = document.createElement("p");
      hinweis.className = "lock-hint";
      hinweis.textContent = "Die Bot-Prüfung lädt nicht — vermutlich blockiert " +
        "sie ein Werbeblocker. Schreib mir sonst einfach eine Mail.";
      kasten.replaceChildren(hinweis);
    }, 6000);
  } else {
    // Nach einem Absenden ist das Token verbraucht.
    window.turnstile.reset(turnstileId);
  }
}

function turnstileToken() {
  if (turnstileId === null || !window.turnstile) return "";
  return window.turnstile.getResponse(turnstileId) || "";
}

function login() {
  return new Promise(resolve => {
    const overlay  = document.getElementById("lock");
    const form     = document.getElementById("lockForm");
    const email    = document.getElementById("lockEmail");
    const code     = document.getElementById("lockCode");
    const name     = document.getElementById("lockName");
    const msg      = document.getElementById("lockMsg");
    const umschalt = document.getElementById("lockSwitch");
    const button   = form.querySelector("button[type=submit]");
    let schritt = "email";
    let aktuelleEmail = "";

    const setzeMeldung = (text, gut) => {
      msg.textContent = text;
      msg.classList.toggle("ok", !!gut);
    };

    const zeigeEmailSchritt = () => {
      schritt = "email";
      document.getElementById("lockHint").textContent = "Mit deiner E-Mail-Adresse anmelden.";
      name.hidden = true;
      email.hidden = false;
      code.hidden = true;
      zeigeTurnstile(false);
      button.textContent = "Anmeldelink anfordern";
      umschalt.hidden = false;
      umschalt.textContent = "Noch keinen Zugang? Eintragen";
      setzeMeldung("");
      overlay.classList.remove("hidden");
      email.focus();
    };

    // Dritter Schritt: Warteliste. Kein eigener Bildschirm, sondern dieselbe
    // Maske mit einem zusaetzlichen Namensfeld - wer hier landet, kam gerade
    // von "Diese Adresse ist nicht freigeschaltet" und soll nicht erst
    // woandershin navigieren muessen.
    const zeigeWartelisteSchritt = () => {
      schritt = "warteliste";
      document.getElementById("lockHint").textContent =
        "Trag dich ein — du bekommst eine Mail, sobald du freigeschaltet bist.";
      name.hidden = false;
      email.hidden = false;
      code.hidden = true;
      button.textContent = "Eintragen";
      zeigeTurnstile(true);
      umschalt.hidden = false;
      umschalt.textContent = "Zurück zur Anmeldung";
      setzeMeldung("");
      name.focus();
    };

    const zeigeCodeSchritt = () => {
      schritt = "code";
      // Der Hinweis auf die Wartezeit ist wichtiger, als er aussieht: die
      // Zustellung haengt an Gmail und dauert bei einer frisch eingerichteten
      // Sendedomain gern mal eine halbe Minute. Ohne den Hinweis wirkt das wie
      // ein Fehler, und man fordert unnoetig einen zweiten Code an.
      document.getElementById("lockHint").textContent =
        `Mail an ${aktuelleEmail} geschickt. Klick dort auf „Jetzt anmelden“ — ` +
        `oder tipp hier den Code aus der Mail ein.`;
      name.hidden = true;
      email.hidden = true;
      code.hidden = false;
      code.value = "";
      zeigeTurnstile(false);
      button.textContent = "Anmelden";
      // Auf dem Code-Schritt waere der Umschalter nur verwirrend - hier geht
      // es nicht mehr um die Frage, ob man einen Zugang hat.
      umschalt.hidden = true;
      setzeMeldung("");
      code.focus();
    };

    // Meldung des Servers uebernehmen, wenn es eine gibt - der weiss genauer,
    // was schiefging als jeder pauschale Text hier.
    const serverMeldung = async (res, standard) => {
      try {
        const daten = await res.json();
        if (daten && daten.error) return daten.error;
      } catch (e) { /* keine JSON-Antwort */ }
      return standard;
    };

    umschalt.onclick = () => {
      if (schritt === "warteliste") zeigeEmailSchritt();
      else zeigeWartelisteSchritt();
    };

    form.onsubmit = async e => {
      e.preventDefault();
      setzeMeldung("");
      button.disabled = true;
      const beschriftung = button.textContent;
      button.textContent = schritt === "code" ? "Prüfe …" : "Moment …";
      try {
        if (schritt === "email") {
          aktuelleEmail = email.value.trim();
          if (!aktuelleEmail) return;
          const res = await fetch("/api/auth/request-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aktuelleEmail }),
          });
          if (!res.ok) {
            const text = await serverMeldung(res, "Code konnte nicht verschickt werden.");
            // Unbekannte Adresse: direkt in den Wartelisten-Modus wechseln,
            // statt es dem Nutzer als Sackgasse zu praesentieren. Die Adresse
            // bleibt stehen, es fehlt nur noch der Name.
            if (res.status === 404) {
              zeigeWartelisteSchritt();
              setzeMeldung(text + " Trag dich ein, dann schalte ich dich frei.");
            } else {
              setzeMeldung(text);
              email.focus();
            }
            return;
          }
          zeigeCodeSchritt();
        } else if (schritt === "warteliste") {
          const wunschName = name.value.trim();
          const wunschEmail = email.value.trim();
          if (!wunschName || !wunschEmail) {
            setzeMeldung("Bitte Name und Adresse ausfüllen.");
            return;
          }
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: wunschName, email: wunschEmail, turnstile: turnstileToken(),
            }),
          });
          if (!res.ok) {
            setzeMeldung(await serverMeldung(res, "Eintragen hat nicht geklappt."));
            return;
          }
          const daten = await res.json().catch(() => ({}));
          setzeMeldung(daten.message || "Eingetragen.", true);
          name.value = "";
          if (turnstileId !== null && window.turnstile) window.turnstile.reset(turnstileId);
        } else {
          const eingegeben = code.value.trim();
          if (!/^\d{6}$/.test(eingegeben)) { setzeMeldung("Sechsstelligen Code eingeben."); return; }
          const res = await fetch("/api/auth/verify-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aktuelleEmail, code: eingegeben }),
          });
          if (!res.ok) {
            setzeMeldung("Falscher oder abgelaufener Code.");
            code.value = "";
            code.focus();
            return;
          }
          overlay.classList.add("hidden");
          resolve();
        }
      } finally {
        button.disabled = false;
        // Nur zuruecksetzen, wenn der Schrittwechsel die Beschriftung nicht
        // ohnehin schon neu gesetzt hat.
        if (button.textContent === "Moment …" || button.textContent === "Prüfe …") {
          button.textContent = beschriftung;
        }
      }
    };

    zeigeEmailSchritt();

    // /api/auth/link leitet bei einem abgelaufenen oder schon benutzten Link
    // hierher zurueck. Ohne Hinweis stuende man wieder vor der Maske und
    // wuesste nicht, warum der Klick nichts gebracht hat.
    const grund = new URLSearchParams(location.search).get("login");
    if (grund) {
      setzeMeldung(grund === "abgelaufen"
        ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an."
        : "Die Anmeldung über den Link hat nicht geklappt.");
      // Aus der Adresszeile nehmen, damit ein Neuladen den Hinweis nicht
      // wiederholt.
      history.replaceState(null, "", location.pathname);
    }
  });
}

// Abmelden: Sitzung serverseitig loeschen, dann die Seite neu laden. Der
// Neustart ist Absicht - er wirft den Board-Zustand aus dem Speicher, statt
// die fremden ToDos bis zum naechsten Login sichtbar zu lassen.
async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    // Auch wenn der Aufruf scheitert, neu laden - dann greift spaetestens
    // die Sitzungspruefung beim naechsten Abruf.
  }
  location.reload();
}

// ---------- Konto-Menue ----------
// Drei Ansichten in einem Dialog: Auswahl, Abmelde-Rueckfrage,
// Loesch-Bestaetigung. Beide Wege verlangen eine zweite Bestaetigung -
// Loeschen zusaetzlich die abgetippte Adresse, weil es die ToDos mitnimmt.
const kontoAnsichten = {
  auswahl:  document.getElementById("kontoAuswahl"),
  abmelden: document.getElementById("kontoAbmeldenFrage"),
  loeschen: document.getElementById("kontoLoeschenFrage"),
};

function zeigeKonto(ansicht) {
  for (const [name, el] of Object.entries(kontoAnsichten)) el.hidden = name !== ansicht;
  document.getElementById("kontoMsg").textContent = "";
  kontoPopup.hidden = false;
  if (ansicht === "loeschen") {
    const feld = document.getElementById("kontoLoeschenEmail");
    feld.value = "";
    feld.focus();
  }
}

async function kontoLoeschen() {
  const feld = document.getElementById("kontoLoeschenEmail");
  const msg = document.getElementById("kontoMsg");
  const eingabe = feld.value.trim().toLowerCase();
  // Auch der Server prueft das nochmal - hier nur, um den Fehler sofort zu
  // zeigen statt nach einer Serverrunde.
  if (eingabe !== eigeneEmail.toLowerCase()) {
    msg.textContent = "Die Adresse stimmt nicht.";
    feld.focus();
    return;
  }
  const knopf = document.getElementById("kontoLoeschenJa");
  knopf.disabled = true;
  try {
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: eingabe }),
    });
    if (!res.ok) {
      const daten = await res.json().catch(() => ({}));
      msg.textContent = daten.error || "Löschen hat nicht geklappt.";
      knopf.disabled = false;
      return;
    }
    location.reload();
  } catch (e) {
    msg.textContent = "Server nicht erreichbar.";
    knopf.disabled = false;
  }
}

// ---------- Laden & Speichern ----------
async function loadState() {
  while (true) {
    let res;
    try {
      res = await fetch(API_BASE, { cache: "no-store" });
    } catch (e) {
      // canSave bleibt false: lieber nichts speichern als den Server-Stand
      // mit einem leeren Board ueberschreiben.
      setStatus("⚠ Server nicht erreichbar", "err");
      state = { categories: [], todos: [] };
      return;
    }
    if (res.status === 401) { await login(); continue; }
    if (!res.ok) {
      setStatus("⚠ Server nicht erreichbar", "err");
      state = { categories: [], todos: [] };
      return;
    }

    state = (await res.json()) || {};
    canSave = true;
    istAdmin = state.admin === true;
    eigeneEmail = state.email || "";
    // Name als Ueberschrift, Adresse darunter - "Konto" sagt niemandem, um
    // welches Konto es geht.
    document.getElementById("kontoName").textContent = state.name || "Konto";
    document.getElementById("kontoAdresse").textContent = eigeneEmail;
    // Der Titel bekommt nur fuer Admins einen Hinweis-Cursor - sonst wuerde
    // er einen Doppelklick andeuten, der bei allen anderen nichts tut.
    titel.classList.toggle("klickbar", istAdmin);
    // Erst jetzt anzeigen: vorher wuerde der Knopf auch auf dem
    // Sperrbildschirm stehen, wo es nichts abzumelden gibt.
    logoutBtn.hidden = false;
    if (!Array.isArray(state.categories)) state.categories = [];
    if (!Array.isArray(state.todos)) state.todos = [];
    return;
  }
}

let saving = false, pendingSave = false;
async function save() {
  if (!canSave) return;
  if (saving) { pendingSave = true; return; }
  saving = true;
  setStatus("Speichere …", "");
  try {
    let res = await fetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    // Sitzung inzwischen abgelaufen (z. B. ein sehr lange offener Tab) -
    // einmal neu anmelden und den Speicherversuch wiederholen.
    if (res.status === 401) {
      await login();
      res = await fetch(API_BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    setStatus("Gespeichert ✓", "ok");
  } catch (e) {
    setStatus("⚠ Nicht gespeichert", "err");
  } finally {
    saving = false;
    if (pendingSave) { pendingSave = false; save(); }
  }
}

let statusTimer = null;
function setStatus(text, cls) {
  saveStatusEl.textContent = text;
  saveStatusEl.className = "save-status" + (cls ? " " + cls : "");
  clearTimeout(statusTimer);
  if (cls === "ok") {
    statusTimer = setTimeout(() => { saveStatusEl.textContent = ""; }, 1800);
  }
}

// ---------- Aktionen: ToDos ----------
function findTodo(id) { return state.todos.find(t => t.id === id); }

// Naechste freie Sortiernummer fuer termin-lose, offene ToDos einer Spalte.
function nextOrder(catId) {
  const orders = state.todos
    .filter(t => t.categoryId === catId && !t.done && !t.due && typeof t.order === "number")
    .map(t => t.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function addTodoTo(categoryId, text, due, note) {
  text = (text || "").trim();
  if (!text) return false;
  const todo = {
    id: uid(),
    categoryId: categoryId,
    text: text,
    due: due || null,
    note: (note && note.trim()) ? note.trim() : null,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  if (!todo.due) todo.order = nextOrder(categoryId);
  state.todos.push(todo);
  addingCat = null;   // Eingabe nach dem Hinzufuegen wieder einklappen
  render();
  save();
  return true;
}

function toggleDone(id) {
  const t = findTodo(id);
  if (!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? new Date().toISOString() : null;
  // Wieder geoeffnete termin-lose ToDos ans Ende der offenen Liste setzen.
  if (!t.done && !t.due && typeof t.order !== "number") t.order = nextOrder(t.categoryId);
  render();
  save();
}

function deleteTodo(id) {
  const idx = state.todos.findIndex(x => x.id === id);
  if (idx < 0) return;
  const removed = state.todos[idx];
  state.todos.splice(idx, 1);
  if (editingId === id) editingId = null;
  render();
  save();
  showUndo(`„${removed.text}“ gelöscht`, () => {
    state.todos.splice(Math.min(idx, state.todos.length), 0, removed);
    render();
    save();
  });
}

// ---------- Rückgängig-Hinweis (Snackbar) ----------
let undoTimer = null;
function showUndo(message, undoFn) {
  clearTimeout(undoTimer);
  snackbar.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = message;
  const btn = document.createElement("button");
  btn.className = "snack-undo";
  btn.textContent = "Rückgängig";
  btn.addEventListener("click", () => { clearTimeout(undoTimer); hideSnackbar(); undoFn(); });
  snackbar.appendChild(span);
  snackbar.appendChild(btn);
  snackbar.classList.add("show");
  undoTimer = setTimeout(hideSnackbar, 5000);
}
function hideSnackbar() { snackbar.classList.remove("show"); }

function startEdit(id) {
  editingId = id;
  render();
  const input = document.querySelector(`[data-edit-text="${id}"]`);
  if (input) { input.focus(); input.select(); }
}

function saveEdit(id) {
  const t = findTodo(id);
  if (!t) return;
  const textInput = document.querySelector(`[data-edit-text="${id}"]`);
  const dateInput = document.querySelector(`[data-edit-date="${id}"]`);
  const noteInput = document.querySelector("[data-edit-note]");
  const text = textInput.value.trim();
  if (!text) { textInput.focus(); return; }
  t.text = text;
  t.due = dateInput.value || null;
  t.note = noteInput && noteInput.value.trim() ? noteInput.value.trim() : null;
  editingId = null;
  render();
  save();
}

function cancelEdit() {
  editingId = null;
  render();
}

// ---------- Aktionen: Bereiche ----------
function addCategory() {
  const name = (prompt("Name des neuen Bereichs:") || "").trim();
  if (!name) return;
  state.categories.push({ id: uid(), name: name });
  render();
  save();
}

// Bereichsname per Doppelklick direkt in der Ueberschrift bearbeiten.
function startRenameCategory(catId) {
  editingCat = catId;
  render();
  const input = document.querySelector(`[data-edit-cat="${catId}"]`);
  if (input) { input.focus(); input.select(); }
}

function saveCategoryName(catId) {
  const cat = state.categories.find(c => c.id === catId);
  const input = document.querySelector(`[data-edit-cat="${catId}"]`);
  if (!cat || !input) return;
  const name = input.value.trim();
  editingCat = null;
  if (!name || name === cat.name) { render(); return; }
  cat.name = name;
  render();
  save();
}

function cancelRenameCategory() {
  editingCat = null;
  render();
}

function deleteCategory(catId) {
  const cat = state.categories.find(c => c.id === catId);
  if (!cat) return;
  if (state.categories.length <= 1) {
    alert("Es muss mindestens ein Bereich übrig bleiben.");
    return;
  }
  const count = state.todos.filter(t => t.categoryId === cat.id).length;
  const msg = count
    ? `Bereich „${cat.name}“ und ${count} darin enthaltene ToDo(s) wirklich löschen?`
    : `Bereich „${cat.name}“ wirklich löschen?`;
  if (!confirm(msg)) return;
  state.todos = state.todos.filter(t => t.categoryId !== cat.id);
  state.categories = state.categories.filter(c => c.id !== cat.id);
  render();
  save();
}

function toggleDoneCollapse(catId) {
  doneCollapsed[catId] = !doneCollapsed[catId];
  localStorage.setItem("doneCollapsed", JSON.stringify(doneCollapsed));
  render();
}

function openAdd(catId) { addingCat = catId; render(); }
function closeAdd() { addingCat = null; render(); }

// Aktuell offene Eingabe uebernehmen (Enter ODER Klick aus dem Feld heraus).
function commitAddFromDOM() {
  if (!addingCat) return;
  const widget = document.querySelector(".col-add.open");
  if (!widget) return;
  const text = widget.querySelector(".add-text").value;
  const due = widget.querySelector(".add-date").value;
  const note = widget.querySelector(".add-note").value;
  if (text.trim()) addTodoTo(addingCat, text, due, note);
  else closeAdd();
}

// Laufende Bearbeitung uebernehmen (Klick aus der Bearbeiten-Zeile heraus).
function commitEditFromDOM() {
  if (!editingId) return;
  const textInput = document.querySelector(`[data-edit-text="${editingId}"]`);
  if (!textInput) return;
  if (textInput.value.trim()) saveEdit(editingId);
  else cancelEdit();
}

// ---------- Drag & Drop: Umsortieren ----------
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('.todo.undated:not(.dragging)')];
  let closest = { offset: -Infinity, element: null };
  for (const child of els) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

// Reihenfolge der termin-losen ToDos aus der aktuellen DOM-Anordnung uebernehmen.
function persistOrderFromDOM(openList) {
  const ids = [...openList.querySelectorAll(".todo.undated")].map(li => li.dataset.id);
  ids.forEach((id, i) => { const t = findTodo(id); if (t) t.order = i; });
}

// Spalte links/rechts der Maus finden (zum Einsortieren beim Spalten-Drag).
function getColumnAfter(container, x) {
  const cols = [...container.querySelectorAll(".column:not(.col-dragging)")];
  let closest = { offset: -Infinity, el: null };
  for (const col of cols) {
    const box = col.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, el: col };
  }
  return closest.el;
}

// Bereichs-Reihenfolge aus der aktuellen DOM-Anordnung uebernehmen.
function persistColumnOrderFromDOM() {
  const ids = [...board.querySelectorAll(".column")].map(c => c.dataset.cat);
  state.categories.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

// ---------- Sortierung ----------
function sortOpen(a, b) {
  // 1) ToDos mit Termin zuerst (nach Datum), 2) termin-lose nach manueller Reihenfolge.
  const ag = a.due ? 0 : 1, bg = b.due ? 0 : 1;
  if (ag !== bg) return ag - bg;
  if (ag === 0) {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
  }
  const ao = typeof a.order === "number" ? a.order : Infinity;
  const bo = typeof b.order === "number" ? b.order : Infinity;
  if (ao !== bo) return ao - bo;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}
function sortDone(a, b) {
  return (a.completedAt || "") < (b.completedAt || "") ? 1 : -1;
}

// ---------- Rendern ----------
function render() {
  if (addingCat && !state.categories.some(c => c.id === addingCat)) addingCat = null;
  if (editingCat && !state.categories.some(c => c.id === editingCat)) editingCat = null;
  board.innerHTML = "";

  if (!state.categories.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Noch keine Bereiche. Lege oben mit „＋ Bereich“ einen an.";
    board.appendChild(p);
    return;
  }

  state.categories.forEach(cat => board.appendChild(renderColumn(cat)));

  // Eingabefeld der gerade offenen Spalte fokussieren.
  if (addingCat) {
    const input = document.querySelector(`[data-add="${addingCat}"]`);
    if (input) input.focus();
  }
}

function renderColumn(cat) {
  const inCat = state.todos.filter(t => t.categoryId === cat.id);
  const open = inCat.filter(t => !t.done).sort(sortOpen);
  const done = inCat.filter(t => t.done).sort(sortDone);

  const col = document.createElement("section");
  col.className = "column";
  col.dataset.cat = cat.id;

  // --- Kopf ---
  const head = document.createElement("div");
  head.className = "col-head";
  col.appendChild(head);

  if (editingCat === cat.id) {
    // Loeschen gibt es nur hier: wer den Bereich anfasst, hat ihn per
    // Doppelklick bewusst geoeffnet.
    head.className = "col-head editing";
    head.innerHTML = `
      <input type="text" class="cat-edit" data-edit-cat="${cat.id}"
             value="${escapeHtml(cat.name)}" autocomplete="off">
      <div class="col-actions">
        <button type="button" class="act del" title="Bereich löschen" data-act="del">🗑️</button>
      </div>`;
    const input = head.querySelector(".cat-edit");
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") saveCategoryName(cat.id);
      else if (e.key === "Escape") cancelRenameCategory();
    });
    head.querySelector('[data-act="del"]').addEventListener("click", () => deleteCategory(cat.id));
  } else {
    // Ampel am Zaehler: 0 = grau, offene ToDos = blau, etwas Dringendes = rot.
    const countCls = !open.length ? "zero" : (open.some(t => isUrgent(t.due)) ? "urgent" : "normal");
    head.innerHTML = `
      <h2 class="col-title">
        <span class="name">${escapeHtml(cat.name)}</span>
        <span class="col-count ${countCls}">${open.length}</span>
      </h2>`;

    // Spalte am Titel anfassen und umsortieren, per Doppelklick umbenennen.
    const title = head.querySelector(".col-title");
    title.draggable = true;
    title.title = "Doppelklick zum Umbenennen · ziehen, um den Bereich zu verschieben";
    title.addEventListener("dblclick", () => startRenameCategory(cat.id));
    title.addEventListener("dragstart", e => {
      draggedCat = cat.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "cat:" + cat.id);
      col.classList.add("col-dragging");
    });
    title.addEventListener("dragend", () => {
      draggedCat = null;
      col.classList.remove("col-dragging");
      render();
    });
  }

  // --- Eingabe: eingeklappt eine schmale Zeile, die zum Tippen aufklappt ---
  col.appendChild(renderAddArea(cat));

  // --- Offene ToDos ---
  const openList = document.createElement("ul");
  openList.className = "todo-list";
  open.forEach(t => openList.appendChild(renderTodo(t)));
  col.appendChild(openList);

  if (!open.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Keine offenen ToDos.";
    col.appendChild(empty);
  }

  // --- Erledigte ToDos (einklappbar) ---
  if (done.length) {
    const section = document.createElement("div");
    section.className = "done-section";
    const collapsed = !!doneCollapsed[cat.id];

    const dhead = document.createElement("div");
    dhead.className = "done-head";

    const toggle = document.createElement("button");
    toggle.className = "done-toggle" + (collapsed ? " collapsed" : "");
    toggle.innerHTML = `<span class="arrow">▾</span> Erledigt (${done.length})`;
    toggle.addEventListener("click", () => toggleDoneCollapse(cat.id));
    dhead.appendChild(toggle);

    section.appendChild(dhead);

    if (!collapsed) {
      const doneList = document.createElement("ul");
      doneList.className = "todo-list done";
      done.forEach(t => doneList.appendChild(renderTodo(t)));
      section.appendChild(doneList);
    }
    col.appendChild(section);
  }

  // --- Drag & Drop: Spalte ist Ablage- und Sortierzone ---
  col.addEventListener("dragover", e => {
    if (!draggedId) return;
    const dragged = findTodo(draggedId);
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (dragged.categoryId === cat.id && !dragged.due && !dragged.done) {
      // Termin-lose ToDos live innerhalb der Spalte umsortieren.
      const draggingEl = openList.querySelector(".todo.dragging");
      if (draggingEl) {
        const after = getDragAfterElement(openList, e.clientY);
        if (after == null) openList.appendChild(draggingEl);
        else openList.insertBefore(draggingEl, after);
      }
      col.classList.remove("drop-target");
    } else {
      col.classList.add("drop-target");
    }
  });
  col.addEventListener("dragleave", e => {
    if (!col.contains(e.relatedTarget)) col.classList.remove("drop-target");
  });
  col.addEventListener("drop", e => {
    e.preventDefault();
    col.classList.remove("drop-target");
    const id = draggedId || e.dataTransfer.getData("text/plain");
    const t = id && findTodo(id);
    if (!t) return;
    if (t.categoryId !== cat.id) {
      // In eine andere Spalte verschieben.
      t.categoryId = cat.id;
      if (!t.due && !t.done) t.order = nextOrder(cat.id);
      render(); save();
    } else if (!t.due && !t.done) {
      // Innerhalb der Spalte neu sortieren.
      persistOrderFromDOM(openList);
      render(); save();
    }
  });

  return col;
}

function renderAddArea(cat) {
  const add = document.createElement("div");
  add.className = "col-add";

  if (addingCat !== cat.id) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "col-add-btn";
    btn.textContent = "＋ ToDo";
    btn.addEventListener("click", () => openAdd(cat.id));
    add.appendChild(btn);
    return add;
  }

  add.classList.add("open");
  add.innerHTML = `
    <div class="add-line">
      <input type="text" class="add-text" data-add="${cat.id}"
             placeholder="Neues ToDo …" autocomplete="off">
      <span class="date-field">
        <button type="button" class="add-icon add-cal">📅</button>
        <input type="date" class="add-date" tabindex="-1" aria-label="Termin">
      </span>
      <button type="button" class="add-icon date-clear" title="Termin entfernen" hidden>✕</button>
    </div>
    <textarea class="add-note" placeholder="Notiz (optional) …" rows="2"></textarea>`;

  const textInput = add.querySelector(".add-text");
  const dateInput = add.querySelector(".add-date");
  const noteInput = add.querySelector(".add-note");
  const calBtn    = add.querySelector(".add-cal");
  const clearBtn  = add.querySelector(".date-clear");

  const syncDateUi = () => updateDateButton(calBtn, clearBtn, dateInput.value);
  syncDateUi();

  textInput.addEventListener("keydown", e => {
    if (e.key === "Enter") addTodoTo(cat.id, textInput.value, dateInput.value, noteInput.value);
    else if (e.key === "Escape") closeAdd();
  });

  // Notizfeld: Strg/Cmd+Enter uebernimmt, Escape bricht ab (Enter = Zeilenumbruch).
  noteInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addTodoTo(cat.id, textInput.value, dateInput.value, noteInput.value);
    else if (e.key === "Escape") closeAdd();
  });

  calBtn.addEventListener("click", () => openDatePicker(dateInput));
  clearBtn.addEventListener("click", () => { dateInput.value = ""; syncDateUi(); textInput.focus(); });
  dateInput.addEventListener("change", syncDateUi);

  return add;
}

// Kalender-Icon zeigt den gewaehlten Termin an; das ✕ raeumt ihn wieder weg.
function updateDateButton(calBtn, clearBtn, value) {
  const has = !!value;
  calBtn.classList.toggle("active", has);
  calBtn.textContent = has ? `📅 ${formatDateShort(value)}` : "📅";
  calBtn.title = has ? `Termin ${formatDate(value)} – zum Ändern klicken` : "Termin wählen";
  clearBtn.hidden = !has;
}

function renderTodo(t) {
  const li = document.createElement("li");
  // Streifen-Ampel: blau ohne Termin, gelb mit Termin, rot wenn dringend.
  const stripe = t.done ? "" : (isUrgent(t.due) ? " urgent" : (t.due ? " dated" : ""));
  li.className = "todo" + (t.done ? " is-done" : stripe);
  li.dataset.id = t.id;

  // --- Bearbeiten-Modus ---
  if (editingId === t.id) {
    const wrap = document.createElement("div");
    wrap.className = "edit-row";
    wrap.innerHTML = `
      <input type="text" data-edit-text="${t.id}" value="${escapeHtml(t.text)}">
      <textarea data-edit-note placeholder="Notiz (optional)" rows="2"></textarea>
      <div class="edit-buttons">
        <span class="date-field">
          <button type="button" class="add-icon add-cal" data-act="cal">📅</button>
          <input type="date" data-edit-date="${t.id}" value="${t.due || ""}" tabindex="-1" aria-label="Termin">
        </span>
        <button type="button" class="add-icon date-clear" title="Termin entfernen" hidden>✕</button>
        <button class="btn primary" data-act="save">OK</button>
        <button class="btn" data-act="cancel">Abbrechen</button>
      </div>`;
    const textInput = wrap.querySelector(`[data-edit-text="${t.id}"]`);
    const noteInput = wrap.querySelector("[data-edit-note]");
    const dateInput = wrap.querySelector(`[data-edit-date="${t.id}"]`);
    const calBtn    = wrap.querySelector('[data-act="cal"]');
    const clearBtn  = wrap.querySelector(".date-clear");
    noteInput.value = t.note || "";

    const syncDateUi = () => updateDateButton(calBtn, clearBtn, dateInput.value);
    syncDateUi();
    calBtn.addEventListener("click", () => openDatePicker(dateInput));
    clearBtn.addEventListener("click", () => { dateInput.value = ""; syncDateUi(); textInput.focus(); });
    dateInput.addEventListener("change", syncDateUi);

    textInput.addEventListener("keydown", e => {
      if (e.key === "Enter") saveEdit(t.id);
      if (e.key === "Escape") cancelEdit();
    });
    noteInput.addEventListener("keydown", e => { if (e.key === "Escape") cancelEdit(); });
    wrap.querySelector('[data-act="save"]').addEventListener("click", () => saveEdit(t.id));
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", cancelEdit);
    li.appendChild(wrap);
    return li;
  }

  if (!t.done && !t.due) li.classList.add("undated");

  // --- Drag & Drop: ToDo ist ziehbar ---
  li.draggable = true;
  li.addEventListener("dragstart", e => {
    draggedId = t.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", t.id);
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => {
    draggedId = null;
    li.classList.remove("dragging");
    document.querySelectorAll(".column.drop-target").forEach(c => c.classList.remove("drop-target"));
    render();  // Live-Vorschau wieder mit den Daten abgleichen
  });

  // --- Checkbox ---
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "check";
  cb.checked = t.done;
  cb.title = t.done ? "Wieder als offen markieren" : "Als erledigt abhaken";
  cb.addEventListener("change", () => toggleDone(t.id));
  li.appendChild(cb);

  // --- Text + Termin (Doppelklick = bearbeiten) ---
  const main = document.createElement("div");
  main.className = "todo-main";
  main.title = "Doppelklick zum Bearbeiten";
  main.addEventListener("dblclick", () => startEdit(t.id));

  const txt = document.createElement("div");
  txt.className = "todo-text";
  txt.textContent = t.text;
  main.appendChild(txt);

  if (t.due) {
    const info = dueInfo(t.due);
    const due = document.createElement("span");
    due.className = "due" + (!t.done && info && info.cls ? " " + info.cls : "");
    due.textContent = `📅 ${formatDate(t.due)}`;
    if (!t.done && info && info.badge) due.title = info.badge;
    main.appendChild(due);
  }

  if (t.note && !t.done) {
    const note = document.createElement("div");
    note.className = "todo-note";
    note.textContent = t.note;
    main.appendChild(note);
  }
  li.appendChild(main);

  // --- Aktionen ---
  // Erledigte oeffnet man wieder, indem man den Haken rausnimmt.
  const actions = document.createElement("div");
  actions.className = "actions";

  const del = document.createElement("button");
  del.className = "act del";
  del.title = "Endgültig löschen";
  del.textContent = "🗑️";
  del.addEventListener("click", () => deleteTodo(t.id));
  actions.appendChild(del);

  li.appendChild(actions);
  return li;
}

// ---------- Ereignisse ----------
addCatBtn.addEventListener("click", addCategory);
themeBtn.addEventListener("click", toggleTheme);

// Der Knopf meldet nicht mehr direkt ab, sondern oeffnet das Konto-Menue.
logoutBtn.addEventListener("click", () => zeigeKonto("auswahl"));
document.getElementById("kontoAbmelden")
  .addEventListener("click", () => zeigeKonto("abmelden"));
document.getElementById("kontoAbmeldenJa").addEventListener("click", logout);
document.getElementById("kontoLoeschenStart")
  .addEventListener("click", () => zeigeKonto("loeschen"));
document.getElementById("kontoLoeschenJa").addEventListener("click", kontoLoeschen);
document.getElementById("kontoLoeschenEmail").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); kontoLoeschen(); }
});
document.getElementById("kontoPopupZu")
  .addEventListener("click", () => { kontoPopup.hidden = true; });
kontoPopup.addEventListener("click", e => {
  if (e.target === kontoPopup) kontoPopup.hidden = true;
});

// Verwaltung: absichtlich versteckt hinter einem Doppelklick auf den Titel.
// Ein sichtbarer Knopf waere fuer den taeglichen Gebrauch nur im Weg, und
// wer kein Admin ist, soll gar nicht erst darauf stossen.
titel.addEventListener("dblclick", () => {
  if (istAdmin) adminPopup.hidden = false;
});
document.getElementById("adminPopupZu").addEventListener("click", () => {
  adminPopup.hidden = true;
});
// Klick auf den abgedunkelten Hintergrund schliesst ebenfalls.
adminPopup.addEventListener("click", e => {
  if (e.target === adminPopup) adminPopup.hidden = true;
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!adminPopup.hidden) adminPopup.hidden = true;
  if (!kontoPopup.hidden) kontoPopup.hidden = true;
});

// Spalten umsortieren: Board ist die Ablagezone fuer Bereichs-Drags.
board.addEventListener("dragover", e => {
  if (!draggedCat) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const draggingCol = board.querySelector(".column.col-dragging");
  if (!draggingCol) return;
  const after = getColumnAfter(board, e.clientX);
  if (after == null) board.appendChild(draggingCol);
  else board.insertBefore(draggingCol, after);
});
board.addEventListener("drop", e => {
  if (!draggedCat) return;
  e.preventDefault();
  persistColumnOrderFromDOM();
  render();
  save();
});

// Klick ausserhalb des offenen Eingabe-/Bearbeiten-Felds = Aenderung uebernehmen.
document.addEventListener("mousedown", e => {
  if (addingCat) {
    const widget = document.querySelector(".col-add.open");
    if (widget && !widget.contains(e.target)) { commitAddFromDOM(); return; }
  }
  if (editingId) {
    const row = document.querySelector(".edit-row");
    if (row && !row.contains(e.target)) { commitEditFromDOM(); return; }
  }
  if (editingCat) {
    // Auf den ganzen Kopf pruefen, nicht nur auf das Eingabefeld: sonst wuerde
    // ein Klick auf den Loeschen-Knopf erst neu rendern und ginge dabei verloren.
    const head = document.querySelector(".col-head.editing");
    if (head && !head.contains(e.target)) saveCategoryName(editingCat);
  }
});

// ---------- Start ----------
applyTheme(
  localStorage.getItem("theme") ||
  (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
(async function init() {
  await loadState();
  render();
})();
