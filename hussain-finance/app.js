/* ============================
  Hussain's Finance Dashboard
  Final: Finance + Notes/Docs + Water + Quran + Focus + Plans
  Sync: /api/state (server) with localStorage fallback
============================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const STORAGE_KEY = "hussain_finance_dashboard_state_v1";

let USE_REMOTE = false;
let saveTimer = null;

/* ========= Helpers ========= */
const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
const toNum = (v) => {
  const n = Number(String(v ?? "").replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n) => Number(n || 0).toLocaleString();

/* ========= Default State ========= */
const state = {
  overall: { current: 0, savings: 0, monthly: 0 },
  current: { balance: 0, savings: 0 },
  daily: {
    base: 10500,
    updated: 10500,
    workingDaysRemaining: null,
    weekPlan: { 1: "", 2: "", 3: "", 4: "" }
  },
  expenses: [], // {id, kind:'Expense'|'Service', name, notes, amount, occurred, createdAt}
  notes: [], // {id,title,body,updatedAt}
  docs: [],  // {id,name,type,dataUrl,createdAt}

  water: { targetMl: 3000, glasses: 0, mlPerGlass: 250, lastDate: null },
  quotes: { items: [], reflection: "" },
  focus: { running: false, endAt: null, overlay: false },
  plans: { items: [], pin: null } // pin:{lat,lng,label}
};

/* ========= Remote Sync ========= */
async function detectRemote() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    USE_REMOTE = r.ok;
  } catch {
    USE_REMOTE = false;
  }
}

async function loadState() {
  if (USE_REMOTE) {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        deepMerge(state, data);
        return;
      }
    } catch {}
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) deepMerge(state, JSON.parse(raw));
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

async function saveState() {
  // local fallback always
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (!USE_REMOTE) return;
  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
  } catch {}
}

function deepMerge(target, src) {
  if (!src || typeof src !== "object") return;
  for (const k of Object.keys(src)) {
    const sv = src[k];
    if (Array.isArray(sv)) target[k] = sv;
    else if (sv && typeof sv === "object") {
      if (!target[k] || typeof target[k] !== "object") target[k] = {};
      deepMerge(target[k], sv);
    } else target[k] = sv;
  }
}

/* ========= Tabs ========= */
function setTab(tab) {
  $$("#tabs .tabBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach(v => v.classList.add("hidden"));
  $("#view-" + tab)?.classList.remove("hidden");

  // lazy renders
  if (tab === "overall") renderOverall();
  if (tab === "current") renderCurrent();
  if (tab === "notes") renderNotesDocs();
  if (tab === "water") renderWater();
  if (tab === "quotes") renderQuotes();
  if (tab === "focus") renderFocus();
  if (tab === "plans") {
    setTimeout(initMap, 50);
    renderPlans();
  }
}

/* ========= Finance Calculations ========= */
function sumExpensesAll() {
  return state.expenses.reduce((s, e) => s + toNum(e.amount), 0);
}
function sumExpensesOccurred() {
  return state.expenses.filter(e => !!e.occurred).reduce((s, e) => s + toNum(e.amount), 0);
}
function calcRemain() {
  // remain = balance - savings (savings always green but still subtract)
  return Math.max(0, toNum(state.current.balance) - toNum(state.current.savings));
}
function calcPersonal() {
  // Personal = Remain - (ALL expenses, pending+occurred)
  return Math.max(0, calcRemain() - sumExpensesAll());
}
function calcMainAfterOccurred() {
  // main top subtract occurred expenses too
  return Math.max(0, calcRemain() - sumExpensesOccurred());
}

/* ========= Overall Render ========= */
let chartOverall, chartMonthly, chartOccur, chartSvc;

function renderOverall() {
  $("#overallCurrentValue").textContent = fmt(state.overall.current);
  $("#overallSavingsValue").textContent = fmt(state.overall.savings);
  $("#overallMonthlyValue").textContent = fmt(state.overall.monthly);
  renderCharts();
}

function renderCharts() {
  if (!window.Chart) return;

  const ov = [toNum(state.overall.current), toNum(state.overall.savings)];
  const m = [toNum(state.overall.monthly), toNum(state.overall.current), toNum(state.overall.savings)];

  // Overall
  const c1 = $("#chartOverall");
  if (c1) {
    chartOverall?.destroy();
    chartOverall = new Chart(c1, {
      type: "doughnut",
      data: {
        labels: ["Current", "Savings"],
        datasets: [{ data: ov }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }

  // Monthly
  const c2 = $("#chartMonthly");
  if (c2) {
    chartMonthly?.destroy();
    chartMonthly = new Chart(c2, {
      type: "bar",
      data: {
        labels: ["Monthly", "Current", "Savings"],
        datasets: [{ label: "Overall", data: m }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }

  // Current tab charts
  const c3 = $("#chartOccur");
  if (c3) {
    const occurred = sumExpensesOccurred();
    const pending = Math.max(0, sumExpensesAll() - occurred);
    chartOccur?.destroy();
    chartOccur = new Chart(c3, {
      type: "bar",
      data: {
        labels: ["Occurred", "Pending"],
        datasets: [{ label: "Amount", data: [occurred, pending] }]
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }

  const c4 = $("#chartSvc");
  if (c4) {
    const svc = state.expenses.filter(e => e.kind === "Service").reduce((s, e) => s + toNum(e.amount), 0);
    const exp = state.expenses.filter(e => e.kind === "Expense").reduce((s, e) => s + toNum(e.amount), 0);
    chartSvc?.destroy();
    chartSvc = new Chart(c4, {
      type: "bar",
      data: {
        labels: ["Services", "Expenses"],
        datasets: [{ label: "Amount", data: [svc, exp] }]
      },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }
}

/* ========= Current Render ========= */
function renderCurrent() {
  // inputs
  $("#curBalance").value = state.current.balance || "";
  $("#curSavings").value = state.current.savings || "";

  // remain + savings
  $("#remainBalance").textContent = fmt(calcRemain());
  $("#savingsAlwaysGreen").textContent = fmt(state.current.savings);

  // Personal
  $("#personalBalance").textContent = fmt(calcPersonal());

  // Daily
  $("#dailyBase").value = state.daily.base || "";
  $("#dailyUpdated").textContent = fmt(state.daily.updated);

  const wdr = getWorkingDaysRemaining();
  $("#workDaysRemain").textContent = String(wdr);
  const perDay = wdr > 0 ? Math.floor(toNum(state.daily.updated) / wdr) : 0;
  $("#perDay").textContent = fmt(perDay);

  // Weekly
  const weeklyBalance = Math.max(0, calcPersonal() - toNum(state.daily.updated));
  $("#weeklyBalance").textContent = fmt(weeklyBalance);
  const perWeek = Math.floor(weeklyBalance / 4);
  $("#perWeek").textContent = fmt(perWeek);

  // week plan inputs
  $$(".weekInput").forEach(inp => {
    const w = inp.dataset.week;
    inp.value = state.daily.weekPlan?.[w] ?? "";
  });

  // expenses list
  renderExpenses();
  renderCharts();
}

/* Working days remaining (Mon-Fri) from today to month end */
function getWorkingDaysRemaining() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const start = new Date(year, month, now.getDate()); // today
  const end = new Date(year, month + 1, 0); // last day of month

  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/* ========= Expenses ========= */
function addExpense(kind, name, notes, amount) {
  const amt = Math.max(0, toNum(amount));
  if (!name || !amt) return;

  state.expenses.unshift({
    id: uid(),
    kind,
    name,
    notes: notes || "",
    amount: amt,
    occurred: false,
    createdAt: new Date().toISOString()
  });

  scheduleSave();
  renderCurrent();
}

function renderExpenses() {
  const tb = $("#expensesTbody");
  if (!tb) return;

  tb.innerHTML = "";

  for (const e of state.expenses) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input type="checkbox" ${e.occurred ? "checked" : ""} data-action="toggleOccur" data-id="${e.id}" /></td>
      <td><span class="chip">${e.kind}</span></td>
      <td><input value="${escapeHtml(e.name)}" data-action="editExp" data-field="name" data-id="${e.id}" /></td>
      <td><input value="${escapeHtml(e.notes || "")}" data-action="editExp" data-field="notes" data-id="${e.id}" /></td>
      <td><input inputmode="numeric" value="${escapeHtml(String(e.amount))}" data-action="editExp" data-field="amount" data-id="${e.id}" /></td>
      <td class="right">
        <div class="tableActions">
          <button class="btn ghost smallBtn" data-action="updateExp" data-id="${e.id}">Update</button>
          <button class="smallBtn danger" data-action="delExp" data-id="${e.id}">Delete</button>
        </div>
      </td>
    `;

    tb.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ========= Notes ========= */
let editingNoteId = null;

function renderNotesDocs() {
  renderNotesList();
  renderDocsList();
}

function renderNotesList() {
  const list = $("#notesList");
  if (!list) return;

  const q = ($("#noteSearch").value || "").toLowerCase().trim();
  const items = state.notes
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .filter(n => !q || (n.title + " " + n.body).toLowerCase().includes(q));

  list.innerHTML = "";
  for (const n of items) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <div style="font-weight:900">${escapeHtml(n.title || "Untitled")}</div>
        <div class="meta">${new Date(n.updatedAt).toLocaleString()}</div>
      </div>
      <div class="actions">
        <button class="btn ghost smallBtn" data-action="editNote" data-id="${n.id}">Edit</button>
        <button class="smallBtn danger" data-action="delNote" data-id="${n.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

/* ========= Docs (image/pdf via dataUrl) ========= */
let selectedDocId = null;

async function addDocsFromInput(files) {
  const arr = Array.from(files || []);
  for (const f of arr) {
    if (!f) continue;
    const dataUrl = await fileToDataUrl(f);
    state.docs.unshift({
      id: uid(),
      name: f.name,
      type: f.type,
      dataUrl,
      createdAt: new Date().toISOString()
    });
  }
  scheduleSave();
  renderDocsList();
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function renderDocsList() {
  const list = $("#docsList");
  if (!list) return;

  list.innerHTML = "";
  for (const d of state.docs) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <div style="font-weight:900">${escapeHtml(d.name)}</div>
        <div class="meta">${new Date(d.createdAt).toLocaleString()}</div>
      </div>
      <div class="actions">
        <button class="btn ghost smallBtn" data-action="previewDoc" data-id="${d.id}">Preview</button>
        <a class="btn ghost smallBtn" href="${d.dataUrl}" download="${escapeHtml(d.name)}">Download</a>
        <button class="smallBtn danger" data-action="delDoc" data-id="${d.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }

  // keep preview
  if (selectedDocId) previewDoc(selectedDocId);
}

function previewDoc(id) {
  selectedDocId = id;
  const box = $("#docPreview");
  const d = state.docs.find(x => x.id === id);
  if (!box || !d) return;

  if (d.type === "application/pdf") {
    box.innerHTML = `<iframe src="${d.dataUrl}" title="PDF preview"></iframe>`;
  } else if (d.type.startsWith("image/")) {
    box.innerHTML = `<img src="${d.dataUrl}" alt="Preview" />`;
  } else {
    box.textContent = "Preview not supported for this file type.";
  }
}

/* ========= Water ========= */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function ensureWaterReset() {
  if (state.water.lastDate !== todayKey()) {
    state.water.lastDate = todayKey();
    state.water.glasses = 0;
  }
}
function renderWater() {
  ensureWaterReset();

  const consumed = state.water.glasses * state.water.mlPerGlass;
  const pct = state.water.targetMl > 0 ? Math.min(100, Math.round((consumed / state.water.targetMl) * 100)) : 0;

  $("#waterTargetL").value = (state.water.targetMl / 1000).toString();
  $("#waterConsumedText").textContent = `${consumed} ml`;
  $("#waterProgressText").textContent = `${pct}%`;
  $("#waterFill").style.width = pct + "%";
  $("#waterTrophy").hidden = consumed < state.water.targetMl;

  const grid = $("#glassGrid");
  grid.innerHTML = "";
  const totalGlasses = Math.ceil(state.water.targetMl / state.water.mlPerGlass);

  for (let i = 1; i <= totalGlasses; i++) {
    const btn = document.createElement("button");
    btn.className = "glassBtn" + (i <= state.water.glasses ? " active" : "");
    btn.textContent = "🥛";
    btn.onclick = () => {
      state.water.glasses = i;
      scheduleSave();
      renderWater();
    };
    grid.appendChild(btn);
  }
}

/* ========= Quotes (Quran) ========= */
async function fetchQuotes() {
  try {
    const r = await fetch("/api/quotes", { cache: "no-store" });
    const data = await r.json();
    state.quotes.items = data.items || [];
    scheduleSave();
  } catch {
    // fallback simple
    state.quotes.items = [
      { text: "Indeed, with hardship comes ease.", meta: "Quran 94:6" },
      { text: "So remember Me; I will remember you.", meta: "Quran 2:152" },
      { text: "Allah does not burden a soul beyond that it can bear.", meta: "Quran 2:286" },
      { text: "And He is with you wherever you are.", meta: "Quran 57:4" }
    ];
  }
  renderQuotes();
}

function renderQuotes() {
  const list = $("#quoteList");
  if (!list) return;

  list.innerHTML = "";
  for (const q of state.quotes.items) {
    const div = document.createElement("div");
    div.className = "quoteCard";
    div.innerHTML = `
      <div style="font-weight:850">${escapeHtml(q.text)}</div>
      <div class="small muted" style="margin-top:8px">${escapeHtml(q.meta || "")}</div>
    `;
    list.appendChild(div);
  }

  $("#quoteReflection").value = state.quotes.reflection || "";
}

/* ========= Focus ========= */
let focusTimer = null;

function renderFocus() {
  const left = state.focus.endAt ? Math.max(0, state.focus.endAt - Date.now()) : 0;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const txt = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  $("#focusCountdown").textContent = txt;
  $("#focusCountdownOverlay").textContent = txt;

  const ov = $("#focusOverlay");
  if (ov) {
    ov.classList.toggle("hidden", !state.focus.overlay);
    ov.hidden = !state.focus.overlay;
  }

  // stop timer at 0
  if (state.focus.running && left <= 0) {
    stopFocus(true);
    alert("Focus complete ✅");
  }
}

function startFocus(minutes) {
  const m = Math.max(1, toNum(minutes));
  state.focus.running = true;
  state.focus.endAt = Date.now() + m * 60000;
  state.focus.overlay = true;
  scheduleSave();

  if (!focusTimer) {
    focusTimer = setInterval(() => {
      renderFocus();
      scheduleSave();
    }, 500);
  }
  renderFocus();
}

function stopFocus(silent) {
  state.focus.running = false;
  state.focus.endAt = null;
  state.focus.overlay = false;
  scheduleSave();

  if (focusTimer) {
    clearInterval(focusTimer);
    focusTimer = null;
  }
  renderFocus();
  if (!silent) alert("Stopped.");
}

/* ========= Plans + Map ========= */
let map, marker;

function initMap() {
  if (map || !window.L) return;

  map = L.map("plansMap").setView([24.8607, 67.0011], 11); // Karachi default
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  map.on("click", (e) => {
    state.plans.pin = { lat: e.latlng.lat, lng: e.latlng.lng, label: "Pinned" };
    placeMarker();
    scheduleSave();
  });

  placeMarker();
}

function placeMarker() {
  if (!map) return;
  if (!state.plans.pin) {
    if (marker) { map.removeLayer(marker); marker = null; }
    return;
  }
  const { lat, lng } = state.plans.pin;
  if (!marker) marker = L.marker([lat, lng]).addTo(map);
  marker.setLatLng([lat, lng]);
  map.setView([lat, lng], Math.max(map.getZoom(), 13));
}

async function searchMapPlace(q) {
  const query = (q || "").trim();
  if (!query) return;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return;

    const best = data[0];
    state.plans.pin = { lat: Number(best.lat), lng: Number(best.lon), label: best.display_name };
    placeMarker();
    scheduleSave();
  } catch {}
}

function renderPlans() {
  const list = $("#plansList");
  if (!list) return;

  list.innerHTML = "";
  const items = state.plans.items.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  for (const p of items) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <div style="font-weight:900">${escapeHtml(p.name)} <span class="chip" style="margin-left:8px">${escapeHtml(p.category)}</span></div>
        <div class="meta">${escapeHtml(p.date || "")} ${escapeHtml(p.time || "")} • ${escapeHtml(p.desc || "")}</div>
        ${p.pin ? `<div class="meta">📍 ${p.pin.lat.toFixed(4)}, ${p.pin.lng.toFixed(4)}</div>` : ""}
      </div>
      <div class="actions">
        <button class="btn ghost smallBtn" data-action="pinPlan" data-id="${p.id}">View Pin</button>
        <button class="smallBtn danger" data-action="delPlan" data-id="${p.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

/* ========= Events ========= */
function bindEvents() {
  // tabs
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tabBtn");
    if (!btn) return;
    setTab(btn.dataset.tab);
  });

  // global click actions
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    // overall edit
    if (action === "editOverall") {
      const field = el.dataset.field;
      const cur = toNum(state.overall[field]);
      const v = prompt(`Set Overall ${field}:`, String(cur));
      if (v === null) return;
      state.overall[field] = Math.max(0, toNum(v));
      scheduleSave();
      renderOverall();
      return;
    }

    if (action === "forceSync") {
      saveState();
      alert(USE_REMOTE ? "Synced ✅" : "Saved locally ✅ (host to sync across devices)");
      return;
    }

    // current
    if (action === "setDailyBase") {
      state.daily.base = Math.max(0, toNum($("#dailyBase").value));
      state.daily.updated = state.daily.base;
      scheduleSave();
      renderCurrent();
      return;
    }
    if (action === "applySpentToday") {
      const spent = Math.max(0, toNum($("#spentToday").value));
      state.daily.updated = Math.max(0, toNum(state.daily.updated) - spent);
      $("#spentToday").value = "";
      scheduleSave();
      renderCurrent();
      return;
    }
    if (action === "quickResetDay") {
      state.daily.updated = state.daily.base;
      scheduleSave();
      renderCurrent();
      return;
    }

    // expenses
    if (action === "addExpense") {
      addExpense("Expense", $("#expName").value.trim(), $("#expNotes").value.trim(), $("#expAmount").value);
      $("#expName").value = ""; $("#expNotes").value = ""; $("#expAmount").value = "";
      return;
    }
    if (action === "addService") {
      addExpense("Service", $("#svcName").value, $("#svcNotes").value.trim(), $("#svcAmount").value);
      $("#svcNotes").value = ""; $("#svcAmount").value = "";
      return;
    }
    if (action === "clearExpenses") {
      if (!confirm("Clear all expenses?")) return;
      state.expenses = [];
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "toggleOccur") {
      const id = el.dataset.id;
      const ex = state.expenses.find(x => x.id === id);
      if (!ex) return;
      ex.occurred = !!el.checked;
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "updateExp") {
      // already live via inputs; just re-render for totals
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "delExp") {
      const id = el.dataset.id;
      state.expenses = state.expenses.filter(x => x.id !== id);
      scheduleSave();
      renderCurrent();
      return;
    }

    // notes
    if (action === "saveNote") {
      const title = $("#noteTitle").value.trim() || "Untitled";
      const body = $("#noteBody").value.trim();

      const now = new Date().toISOString();
      if (editingNoteId) {
        const n = state.notes.find(x => x.id === editingNoteId);
        if (n) { n.title = title; n.body = body; n.updatedAt = now; }
      } else {
        state.notes.unshift({ id: uid(), title, body, updatedAt: now });
      }

      editingNoteId = null;
      $("#noteTitle").value = "";
      $("#noteBody").value = "";
      scheduleSave();
      renderNotesDocs();
      return;
    }

    if (action === "clearNoteEditor") {
      editingNoteId = null;
      $("#noteTitle").value = "";
      $("#noteBody").value = "";
      return;
    }

    if (action === "editNote") {
      const id = el.dataset.id;
      const n = state.notes.find(x => x.id === id);
      if (!n) return;
      editingNoteId = id;
      $("#noteTitle").value = n.title || "";
      $("#noteBody").value = n.body || "";
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (action === "delNote") {
      const id = el.dataset.id;
      state.notes = state.notes.filter(x => x.id !== id);
      if (editingNoteId === id) editingNoteId = null;
      scheduleSave();
      renderNotesDocs();
      return;
    }

    // docs
    if (action === "previewDoc") {
      previewDoc(el.dataset.id);
      return;
    }
    if (action === "delDoc") {
      const id = el.dataset.id;
      state.docs = state.docs.filter(x => x.id !== id);
      if (selectedDocId === id) selectedDocId = null;
      scheduleSave();
      renderDocsList();
      $("#docPreview").textContent = "Select a file to preview.";
      return;
    }

    // water
    if (action === "setWaterTarget") {
      const litres = Math.max(0, Number($("#waterTargetL").value || 0));
      state.water.targetMl = Math.max(250, Math.round(litres * 1000));
      scheduleSave();
      renderWater();
      return;
    }
    if (action === "resetWaterToday") {
      state.water.lastDate = todayKey();
      state.water.glasses = 0;
      scheduleSave();
      renderWater();
      return;
    }

    // quotes
    if (action === "refreshQuotes") {
      fetchQuotes();
      return;
    }

    // focus
    if (action === "startFocus") {
      startFocus($("#focusMinutes").value);
      return;
    }
    if (action === "stopFocus") {
      stopFocus(false);
      return;
    }
    if (action === "toggleOverlay") {
      state.focus.overlay = !state.focus.overlay;
      scheduleSave();
      renderFocus();
      return;
    }
    if (action === "hideOverlay") {
      state.focus.overlay = false;
      scheduleSave();
      renderFocus();
      return;
    }
    if (action === "goFullscreen") {
      enterFullscreen();
      return;
    }

    // plans
    if (action === "searchMap") {
      searchMapPlace($("#mapSearch").value);
      return;
    }
    if (action === "clearPin") {
      state.plans.pin = null;
      placeMarker();
      scheduleSave();
      return;
    }
    if (action === "savePlan") {
      const category = $("#planCategory").value;
      const name = $("#planName").value.trim();
      const desc = $("#planDesc").value.trim();
      const date = $("#planDate").value;
      const time = $("#planTime").value;

      if (!name) return alert("Please enter plan name");

      state.plans.items.unshift({
        id: uid(),
        category,
        name,
        desc,
        date,
        time,
        pin: state.plans.pin ? { ...state.plans.pin } : null,
        createdAt: new Date().toISOString()
      });

      $("#planName").value = "";
      $("#planDesc").value = "";
      scheduleSave();
      renderPlans();
      return;
    }
    if (action === "delPlan") {
      const id = el.dataset.id;
      state.plans.items = state.plans.items.filter(x => x.id !== id);
      scheduleSave();
      renderPlans();
      return;
    }
    if (action === "pinPlan") {
      const id = el.dataset.id;
      const p = state.plans.items.find(x => x.id === id);
      if (!p || !p.pin) return;
      state.plans.pin = { ...p.pin };
      placeMarker();
      setTab("plans");
      return;
    }
  });

  // inputs: current balance/savings live
  $("#curBalance").addEventListener("input", () => {
    state.current.balance = Math.max(0, toNum($("#curBalance").value));
    scheduleSave();
    renderCurrent();
  });
  $("#curSavings").addEventListener("input", () => {
    state.current.savings = Math.max(0, toNum($("#curSavings").value));
    scheduleSave();
    renderCurrent();
  });

  // week plan inputs
  $$(".weekInput").forEach(inp => {
    inp.addEventListener("input", () => {
      const w = inp.dataset.week;
      state.daily.weekPlan[w] = inp.value;
      scheduleSave();
    });
  });

  // note search re-render
  $("#noteSearch").addEventListener("input", () => renderNotesList());

  // reflection
  $("#quoteReflection").addEventListener("input", () => {
    state.quotes.reflection = $("#quoteReflection").value;
    scheduleSave();
  });

  // docs input
  $("#docInput").addEventListener("change", async (e) => {
    await addDocsFromInput(e.target.files);
    e.target.value = "";
  });
}

/* live edit expense inputs */
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset || el.dataset.action !== "editExp") return;

  const id = el.dataset.id;
  const field = el.dataset.field;
  const ex = state.expenses.find(x => x.id === id);
  if (!ex) return;

  if (field === "amount") ex.amount = Math.max(0, toNum(el.value));
  else ex[field] = el.value;

  scheduleSave();
  // don't rerender every keypress for speed; totals update on update button
});

/* ========= Fullscreen ========= */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) return;
  el.requestFullscreen?.();
}

/* ========= Boot ========= */
async function boot() {
  bindEvents();

  await detectRemote();
  await loadState();

  // ensure defaults exist
  state.water = state.water || { targetMl: 3000, glasses: 0, mlPerGlass: 250, lastDate: null };
  state.quotes = state.quotes || { items: [], reflection: "" };
  state.focus = state.focus || { running: false, endAt: null, overlay: false };
  state.plans = state.plans || { items: [], pin: null };
  state.docs = state.docs || [];
  state.notes = state.notes || [];
  state.expenses = state.expenses || [];

  // sync daily updated if missing
  if (typeof state.daily.updated !== "number") state.daily.updated = state.daily.base;

  // initial render
  renderOverall();
  renderCurrent();
  renderNotesDocs();
  renderWater();
  renderPlans();

  // load quotes live once (if empty)
  if (!state.quotes.items || state.quotes.items.length === 0) await fetchQuotes();
  else renderQuotes();

  // focus render
  renderFocus();

  // register SW
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  // open overall
  setTab("overall");
}

boot();