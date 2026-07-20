"use strict";

/* ====================================================================
   ToDo-Liste – Board-Ansicht (Cloud-Version)
   - Eigenes, einklappbares Eingabefeld pro Spalte (Termin per Kalender-Icon)
   - Bereichsname und ToDo werden per Doppelklick bearbeitet
   - Erledigte ToDos unten in jeder Spalte (einklappbar, aufräumbar)
   - Verschieben zwischen Bereichen UND Umsortieren termin-loser ToDos
     per Drag & Drop
   - Heller / dunkler Modus
   Daten liegen in einem JSONBin.io-Bin (siehe Konstanten unten) und
   werden bei jeder Aenderung dorthin zurueckgeschrieben, damit alle
   Geraete denselben Stand sehen. Sie sind mit einem Passwort
   verschluesselt (siehe Abschnitt "Verschluesselung").
   ==================================================================== */

// ---------- Cloud-Speicher ----------
// Gespeichert wird weiterhin in einem JSONBin-Bin, aber nicht mehr direkt von
// hier aus: Bin-ID und Access-Key standen frueher als Konstanten in dieser
// Datei und waren damit fuer jeden Besucher lesbar. Beides liegt jetzt als
// Secret im Cloudflare-Pages-Projekt; /api/todos reicht die Anfragen durch
// (siehe functions/api/todos.js). Die Zweitsicherung nach Google Drive stoesst
// dieselbe Function nach jedem Schreiben selbst an — auch ihr Geheimnis ist
// damit aus dem oeffentlichen Quelltext verschwunden.
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
const snackbar     = document.getElementById("snackbar");

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

// ---------- Verschluesselung ----------
// Gleiches Format wie beim Schul-Dashboard: AES-GCM, Schluessel per PBKDF2 aus
// dem Passwort. Im Bin liegt dadurch nur Chiffretext — der oeffentlich
// sichtbare Access-Key oben gibt niemandem Zugriff auf die Inhalte. Das
// Passwort steht nirgends im Code, es bleibt auf dem Geraet.
const LOCK_KEY = "todoPass";
const ITERATIONS = 250000;

let password = null;
// Erst speichern, wenn der vorhandene Stand wirklich gelesen wurde. Sonst
// wuerde die erste Aenderung nach einem Ladefehler das Board leer ueberschreiben.
let canSave = false;
let migrated = false;

function toB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function deriveKey(pass, salt, iterations, usages) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, usages);
}

async function encryptPayload(data, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(pass, salt, ITERATIONS, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key,
    new TextEncoder().encode(JSON.stringify(data)));
  return { encrypted: true, v: 1, iterations: ITERATIONS,
           salt: toB64(salt), iv: toB64(iv), data: toB64(cipher) };
}

async function decryptPayload(payload, pass) {
  const key = await deriveKey(pass, fromB64(payload.salt), payload.iterations, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) }, key, fromB64(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- Sperrbildschirm ----------
// Fragt das Passwort ab und liefert die entschluesselten Daten. Ein gemerktes
// Passwort wird still probiert; nur wenn es nicht passt, erscheint die Abfrage.
function unlock(payload) {
  return new Promise(resolve => {
    const overlay = document.getElementById("lock");
    const form    = document.getElementById("lockForm");
    const input   = document.getElementById("lockPass");
    const msg     = document.getElementById("lockMsg");

    const attempt = async (pass, silent) => {
      try {
        const data = await decryptPayload(payload, pass);
        localStorage.setItem(LOCK_KEY, pass);
        password = pass;
        overlay.classList.add("hidden");
        resolve(data);
        return true;
      } catch (e) {
        localStorage.removeItem(LOCK_KEY);
        if (!silent) { msg.textContent = "Falsches Passwort"; input.value = ""; input.focus(); }
        return false;
      }
    };

    const showPrompt = () => {
      // Overlay teilt sich die Maske mit askNewPassword() — Beschriftung und
      // Wiederhol-Feld gehoeren daher zurueckgesetzt.
      document.getElementById("lockTitle").textContent = "ToDo-Liste entsperren";
      document.getElementById("lockHint").textContent = "Einmal pro Gerät eingeben — wird gespeichert.";
      document.getElementById("lockPass2").hidden = true;
      overlay.classList.remove("hidden");
      input.focus();
      form.onsubmit = e => { e.preventDefault(); if (input.value) attempt(input.value, false); };
    };

    const saved = localStorage.getItem(LOCK_KEY);
    if (saved) attempt(saved, true).then(ok => { if (!ok) showPrompt(); });
    else showPrompt();
  });
}

// Einmalige Einrichtung, solange im Bin noch Klartext liegt. Das Passwort wird
// zweimal abgefragt: ein Tippfehler wuerde die Daten sonst unlesbar machen.
function askNewPassword() {
  return new Promise(resolve => {
    const overlay = document.getElementById("lock");
    const form    = document.getElementById("lockForm");
    const input   = document.getElementById("lockPass");
    const repeat  = document.getElementById("lockPass2");
    const msg     = document.getElementById("lockMsg");

    document.getElementById("lockTitle").textContent = "Passwort festlegen";
    document.getElementById("lockHint").textContent =
      "Nimm dasselbe Passwort wie im Schul-Dashboard, dann kann es die ToDos weiter anzeigen.";
    repeat.hidden = false;
    overlay.classList.remove("hidden");
    input.focus();

    form.onsubmit = e => {
      e.preventDefault();
      if (!input.value) return;
      if (input.value !== repeat.value) {
        msg.textContent = "Die Passwörter stimmen nicht überein";
        repeat.value = ""; repeat.focus();
        return;
      }
      localStorage.setItem(LOCK_KEY, input.value);
      password = input.value;
      repeat.hidden = true;
      overlay.classList.add("hidden");
      resolve();
    };
  });
}

// ---------- Laden & Speichern ----------
async function loadState() {
  let payload;
  try {
    const res = await fetch(API_BASE, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    payload = await res.json();
  } catch (e) {
    // canSave bleibt false: lieber nichts speichern als den Cloud-Stand
    // mit einem leeren Board ueberschreiben.
    setStatus("⚠ Cloud-Speicher nicht erreichbar", "err");
    state = { categories: [], todos: [] };
    return;
  }

  if (payload && payload.encrypted) {
    state = await unlock(payload);
  } else {
    // Altbestand im Klartext: Passwort festlegen, init() schreibt gleich
    // verschluesselt zurueck.
    await askNewPassword();
    state = payload || {};
    migrated = true;
  }
  canSave = true;

  if (!Array.isArray(state.categories)) state.categories = [];
  if (!Array.isArray(state.todos)) state.todos = [];
}

let saving = false, pendingSave = false;
async function save() {
  if (!canSave || !password) return;
  if (saving) { pendingSave = true; return; }
  saving = true;
  setStatus("Speichere …", "");
  try {
    const payload = await encryptPayload(state, password);
    const res = await fetch(API_BASE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
  if (migrated) save();   // Klartext-Altbestand sofort verschluesselt ersetzen
})();
