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
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

function toNum(v) {
  const n = Number(String(v ?? "").replaceAll(",", ""));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  const x = Math.round(toNum(n));
  return x.toLocaleString();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function clamp0(n) {
  return Math.max(0, toNum(n));
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function workingDaysRemaining() {
  // remaining working days incl today (Mon-Fri)
  const now = new Date();
  const end = endOfMonth(now);
  let count = 0;
  for (let d = new Date(now); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/* ========= State ========= */
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
  plans: { items: [], pin: null }, // pin:{lat,lng,label}

  // Sup' Sain module (lightweight, no keys)
  supsain: {
    news: [],
    doy: [],
    islam: [],
    quiz: [],
    innov: [],
    weekend: [],
    biz: [],
    jokes: []
  }
};

/* ========= Remote Sync ========= */
async function detectRemote() {
  try {
    const r = await fetch("/api/state", { method: "GET" });
    USE_REMOTE = r.ok;
  } catch {
    USE_REMOTE = false;
  }
}

async function loadState() {
  // try remote
  if (USE_REMOTE) {
    try {
      const r = await fetch("/api/state", { method: "GET" });
      if (r.ok) {
        const j = await r.json();
        if (j?.state) mergeState(j.state);
        return;
      }
    } catch {}
  }

  // local fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) mergeState(JSON.parse(raw));
  } catch {}
}

function mergeState(s) {
  if (!s || typeof s !== "object") return;

  // shallow merge carefully
  if (s.overall) Object.assign(state.overall, s.overall);
  if (s.current) Object.assign(state.current, s.current);
  if (s.daily) {
    Object.assign(state.daily, s.daily);
    if (!state.daily.weekPlan) state.daily.weekPlan = { 1: "", 2: "", 3: "", 4: "" };
  }

  if (Array.isArray(s.expenses)) state.expenses = s.expenses;
  if (Array.isArray(s.notes)) state.notes = s.notes;
  if (Array.isArray(s.docs)) state.docs = s.docs;

  if (s.water) Object.assign(state.water, s.water);
  if (s.quotes) Object.assign(state.quotes, s.quotes);
  if (s.focus) Object.assign(state.focus, s.focus);
  if (s.plans) Object.assign(state.plans, s.plans);

  if (s.supsain) Object.assign(state.supsain, s.supsain);

  // safety defaults
  if (!state.water.mlPerGlass) state.water.mlPerGlass = 250;
  if (!state.water.targetMl) state.water.targetMl = 3000;
}

async function saveState() {
  const payload = JSON.stringify(state);

  // local always
  try { localStorage.setItem(STORAGE_KEY, payload); } catch {}

  if (!USE_REMOTE) return;

  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
  } catch {}
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
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
  if (tab === "supsain") renderSupSain();
}

/* ========= Overall ========= */
let chartOverall = null;
let chartMonthly = null;

function renderOverall() {
  $("#overallCurrentValue").textContent = fmt(state.overall.current);
  $("#overallSavingsValue").textContent = fmt(state.overall.savings);
  $("#overallMonthlyValue").textContent = fmt(state.overall.monthly);

  // charts
  if (window.Chart) {
    const ctx1 = $("#chartOverall");
    const ctx2 = $("#chartMonthly");

    const data1 = {
      labels: ["Current", "Savings"],
      datasets: [{ label: "Amount", data: [state.overall.current, state.overall.savings] }]
    };

    const data2 = {
      labels: ["Monthly", "Current", "Savings"],
      datasets: [{ label: "Amount", data: [state.overall.monthly, state.overall.current, state.overall.savings] }]
    };

    if (chartOverall) chartOverall.destroy();
    if (chartMonthly) chartMonthly.destroy();

    chartOverall = new Chart(ctx1, {
      type: "bar",
      data: data1,
      options: { responsive: true, maintainAspectRatio: false }
    });

    chartMonthly = new Chart(ctx2, {
      type: "bar",
      data: data2,
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

/* ========= Current Finance ========= */
let chartOccur = null;
let chartSvc = null;

function calcPersonalBalance() {
  // Personal = remain balance - all expenses (pending+occurred)
  const remain = clamp0(state.current.balance);
  const totalAll = state.expenses.reduce((a, e) => a + clamp0(e.amount), 0);
  return clamp0(remain - totalAll);
}

function calcRemainBalanceMain() {
  // remain = balance - occurred expenses only
  const bal = clamp0(state.current.balance);
  const occurredTotal = state.expenses.filter(e => !!e.occurred).reduce((a, e) => a + clamp0(e.amount), 0);
  return clamp0(bal - occurredTotal);
}

function renderCurrent() {
  // inputs
  $("#curBalance").value = state.current.balance || "";
  $("#curSavings").value = state.current.savings || "";

  // remain & savings always green
  const remain = calcRemainBalanceMain();
  $("#remainBalance").textContent = fmt(remain);
  $("#savingsAlwaysGreen").textContent = fmt(state.current.savings);

  // personal
  const personal = calcPersonalBalance();
  $("#personalBalance").textContent = fmt(personal);

  // daily base / spent today
  $("#dailyBase").value = state.daily.base ?? 10500;
  $("#spentToday").value = "";

  // recompute working days remaining
  state.daily.workingDaysRemaining = workingDaysRemaining();
  $("#workDaysRemain").textContent = String(state.daily.workingDaysRemaining ?? "—");

  // ensure daily updated at least base
  if (!Number.isFinite(toNum(state.daily.updated)) || state.daily.updated <= 0) {
    state.daily.updated = clamp0(state.daily.base);
  }
  $("#dailyUpdated").textContent = fmt(state.daily.updated);

  const perDay = state.daily.workingDaysRemaining ? Math.floor(personal / state.daily.workingDaysRemaining) : 0;
  $("#perDay").textContent = fmt(perDay);

  const weekly = clamp0(personal - state.daily.updated);
  $("#weeklyBalance").textContent = fmt(weekly);
  const perWeek = Math.floor(weekly / 4);
  $("#perWeek").textContent = fmt(perWeek);

  // week plan
  $$(".weekInput").forEach(inp => {
    const w = inp.dataset.week;
    inp.value = state.daily.weekPlan?.[w] ?? "";
  });

  // expenses list + charts
  renderExpensesTable();
  renderExpenseCharts();
}

function renderExpensesTable() {
  const tb = $("#expensesTbody");
  tb.innerHTML = "";

  for (const e of state.expenses) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <label class="switch">
          <input type="checkbox" data-action="toggleOccurred" data-id="${e.id}" ${e.occurred ? "checked" : ""}/>
          <span class="slider"></span>
        </label>
      </td>
      <td>${escapeHtml(e.kind)}</td>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.notes || "")}</td>
      <td>${fmt(e.amount)}</td>
      <td class="right">
        <button class="btn ghost smallBtn" data-action="editExpense" data-id="${e.id}">Edit</button>
        <button class="btn danger smallBtn" data-action="delExpense" data-id="${e.id}">Delete</button>
      </td>
    `;
    tb.appendChild(tr);
  }
}

function renderExpenseCharts() {
  if (!window.Chart) return;

  const occurredTotal = state.expenses.filter(e => !!e.occurred).reduce((a, e) => a + clamp0(e.amount), 0);
  const pendingTotal = state.expenses.filter(e => !e.occurred).reduce((a, e) => a + clamp0(e.amount), 0);

  const serviceTotal = state.expenses.filter(e => e.kind === "Service").reduce((a, e) => a + clamp0(e.amount), 0);
  const expenseTotal = state.expenses.filter(e => e.kind === "Expense").reduce((a, e) => a + clamp0(e.amount), 0);

  if (chartOccur) chartOccur.destroy();
  if (chartSvc) chartSvc.destroy();

  chartOccur = new Chart($("#chartOccur"), {
    type: "doughnut",
    data: {
      labels: ["Occurred", "Pending"],
      datasets: [{ data: [occurredTotal, pendingTotal] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  chartSvc = new Chart($("#chartSvc"), {
    type: "doughnut",
    data: {
      labels: ["Services", "Expenses"],
      datasets: [{ data: [serviceTotal, expenseTotal] }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

/* ========= Notes & Docs ========= */
let editingNoteId = null;

function renderNotesDocs() {
  // notes list
  renderNotesList();
  // docs list
  renderDocsList();
}

function renderNotesList() {
  const q = ($("#noteSearch").value || "").toLowerCase().trim();
  const list = $("#notesList");
  list.innerHTML = "";

  const notes = [...state.notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const filtered = q
    ? notes.filter(n => (n.title || "").toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q))
    : notes;

  for (const n of filtered) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div style="flex:1; min-width:0">
        <div style="font-weight:900">${escapeHtml(n.title || "(Untitled)")}</div>
        <div class="meta">${escapeHtml((n.body || "").slice(0, 90))}${(n.body || "").length > 90 ? "…" : ""}</div>
      </div>
      <div class="actions">
        <button class="btn ghost smallBtn" data-action="editNote" data-id="${n.id}">Edit</button>
        <button class="btn danger smallBtn" data-action="delNote" data-id="${n.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

function renderDocsList() {
  const list = $("#docsList");
  list.innerHTML = "";

  const docs = [...state.docs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const d of docs) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div style="flex:1; min-width:0">
        <div style="font-weight:900">${escapeHtml(d.name || "file")}</div>
        <div class="meta">${escapeHtml(d.type || "")}</div>
      </div>
      <div class="actions">
        <button class="btn ghost smallBtn" data-action="previewDoc" data-id="${d.id}">Preview</button>
        <a class="btn ghost smallBtn" href="${escapeHtml(d.dataUrl || "")}" download="${escapeHtml(d.name || "file")}">Download</a>
        <button class="btn danger smallBtn" data-action="delDoc" data-id="${d.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

/* ========= Water ========= */
function ensureWaterDate() {
  const t = todayKey();
  if (state.water.lastDate !== t) {
    state.water.lastDate = t;
    state.water.glasses = 0;
    scheduleSave();
  }
}

function renderWater() {
  ensureWaterDate();

  $("#waterTargetL").value = (state.water.targetMl / 1000).toString();
  const consumed = state.water.glasses * state.water.mlPerGlass;
  const target = state.water.targetMl;

  $("#waterConsumedText").textContent = `${consumed} ml`;
  const pct = target ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  $("#waterProgressText").textContent = `${pct}%`;
  $("#waterFill").style.width = `${pct}%`;

  $("#waterTrophy").hidden = !(consumed >= target && target > 0);

  // glass grid 0..16
  const grid = $("#glassGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= 16; i++) {
    const g = document.createElement("button");
    g.className = "glassBtn" + (i <= state.water.glasses ? " on" : "");
    g.textContent = "💧";
    g.title = `${i} glasses`;
    g.addEventListener("click", () => {
      state.water.glasses = i;
      scheduleSave();
      renderWater();
    });
    grid.appendChild(g);
  }
}

/* ========= Quran Quotes ========= */
async function refreshQuotes() {
  try {
    const r = await fetch("/api/quotes", { method: "GET", cache: "no-store" });
    const j = await r.json();
    state.quotes.items = Array.isArray(j.items) ? j.items : [];
    scheduleSave();
    renderQuotes();
  } catch {
    alert("Could not fetch quotes. Check internet.");
  }
}

function renderQuotes() {
  const list = $("#quoteList");
  list.innerHTML = "";

  if (!state.quotes.items || state.quotes.items.length === 0) {
    const div = document.createElement("div");
    div.className = "quoteItem";
    div.textContent = "No quotes yet. Tap refresh.";
    list.appendChild(div);
  } else {
    for (const q of state.quotes.items) {
      const div = document.createElement("div");
      div.className = "quoteItem";
      div.innerHTML = `
        <div class="quoteAr">${escapeHtml(q.ar || "")}</div>
        <div class="quoteEn">${escapeHtml(q.en || "")}</div>
        <div class="meta">${escapeHtml(q.ref || "")}</div>
      `;
      list.appendChild(div);
    }
  }

  $("#quoteReflection").value = state.quotes.reflection || "";
}

/* ========= Focus ========= */
let focusTimer = null;

function renderFocus() {
  updateFocusCountdown();
  $("#focusMinutes").value = "";
  $("#focusOverlay").hidden = !state.focus.overlay;
  $("#focusOverlay").classList.toggle("hidden", !state.focus.overlay);
}

function updateFocusCountdown() {
  const el1 = $("#focusCountdown");
  const el2 = $("#focusCountdownOverlay");
  if (!state.focus.running || !state.focus.endAt) {
    el1.textContent = "00:00";
    el2.textContent = "00:00";
    return;
  }
  const leftMs = Math.max(0, state.focus.endAt - Date.now());
  const totalSec = Math.ceil(leftMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  el1.textContent = `${mm}:${ss}`;
  el2.textContent = `${mm}:${ss}`;

  if (leftMs <= 0) {
    stopFocus(true);
  }
}

function startFocus(mins) {
  const m = Math.max(1, Math.floor(toNum(mins)));
  state.focus.running = true;
  state.focus.endAt = Date.now() + m * 60 * 1000;
  state.focus.overlay = true;
  scheduleSave();
  renderFocus();

  clearInterval(focusTimer);
  focusTimer = setInterval(updateFocusCountdown, 500);
}

function stopFocus(done = false) {
  state.focus.running = false;
  state.focus.endAt = null;
  scheduleSave();
  renderFocus();

  clearInterval(focusTimer);
  focusTimer = null;

  if (done) alert("Focus completed ✅");
}

/* ========= Plans (with map) ========= */
let map = null;
let mapMarker = null;

function initMap() {
  if (!window.L) return;
  const box = $("#plansMap");
  if (!box) return;

  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }

  map = L.map("plansMap").setView([31.5204, 74.3587], 12); // default Lahore
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    state.plans.pin = { lat, lng, label: "Pinned location" };
    scheduleSave();
    renderPlans();
    setMarker(lat, lng);
  });

  if (state.plans.pin?.lat && state.plans.pin?.lng) {
    setMarker(state.plans.pin.lat, state.plans.pin.lng);
    map.setView([state.plans.pin.lat, state.plans.pin.lng], 13);
  }
}

function setMarker(lat, lng) {
  if (!map) return;
  if (mapMarker) mapMarker.remove();
  mapMarker = L.marker([lat, lng]).addTo(map);
}

async function searchPlace(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) {
      alert("Not found");
      return;
    }
    const p = j[0];
    const lat = toNum(p.lat);
    const lng = toNum(p.lon);
    state.plans.pin = { lat, lng, label: p.display_name || q };
    scheduleSave();
    renderPlans();
    initMap();
    map.setView([lat, lng], 14);
    setMarker(lat, lng);
  } catch {
    alert("Search failed");
  }
}

function renderPlans() {
  const list = $("#plansList");
  list.innerHTML = "";

  const items = [...state.plans.items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  for (const p of items) {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div style="flex:1; min-width:0">
        <div style="font-weight:900">${escapeHtml(p.name || "(Plan)")}</div>
        <div class="meta">${escapeHtml(p.category || "")} • ${escapeHtml(p.date || "")} ${escapeHtml(p.time || "")}</div>
        <div class="meta">${escapeHtml(p.desc || "")}</div>
        ${p.pinLabel ? `<div class="meta">📍 ${escapeHtml(p.pinLabel)}</div>` : ""}
      </div>
      <div class="actions">
        <button class="btn danger smallBtn" data-action="delPlan" data-id="${p.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

/* ========= Sup' Sain ========= */
let ssLoading = false;

function ssSetLoading(on) {
  ssLoading = !!on;
  $$('[data-action="ssRefresh"]').forEach(b => {
    b.disabled = ssLoading;
    b.textContent = ssLoading ? "Refreshing..." : "Refresh";
  });
}

function ssRenderList(containerId, items, kind) {
  const el = $("#" + containerId);
  if (!el) return;

  el.innerHTML = "";

  if (!items || items.length === 0) {
    const d = document.createElement("div");
    d.className = "listItem";
    d.innerHTML = `<div class="meta">No data yet — tap Refresh.</div>`;
    el.appendChild(d);
    return;
  }

  if (kind === "news") {
    items.forEach((n, i) => {
      const div = document.createElement("div");
      div.className = "listItem";
      div.innerHTML = `
        <div>
          <div style="font-weight:900">${i + 1}. ${escapeHtml(n.title || "")}</div>
          <div class="meta">${escapeHtml(n.source || "")}</div>
        </div>
        <div class="actions">
          ${n.url ? `<a class="btn ghost smallBtn" href="${escapeHtml(n.url)}" target="_blank" rel="noopener">Open</a>` : ""}
        </div>
      `;
      el.appendChild(div);
    });
    return;
  }

  if (kind === "quiz") {
    items.forEach((q, i) => {
      const div = document.createElement("div");
      div.className = "listItem";
      const ans = q.answer ? `<div class="meta" data-ss-ans="${i}" hidden><b>Answer:</b> ${escapeHtml(q.answer)}</div>` : "";
      div.innerHTML = `
        <div style="flex:1; min-width:0">
          <div style="font-weight:900">${i + 1}. ${escapeHtml(q.question || "")}</div>
          ${q.hint ? `<div class="meta">${escapeHtml(q.hint)}</div>` : ""}
          ${ans}
        </div>
        <div class="actions">
          <button class="btn ghost smallBtn" data-action="ssToggleAnswer" data-idx="${i}">Show</button>
        </div>
      `;
      el.appendChild(div);
    });
    return;
  }

  items.forEach((x, i) => {
    const div = document.createElement("div");
    div.className = "listItem";
    div.innerHTML = `
      <div>
        <div style="font-weight:900">${i + 1}. ${escapeHtml(x.text || "")}</div>
        ${x.meta ? `<div class="meta">${escapeHtml(x.meta)}</div>` : ""}
      </div>
    `;
    el.appendChild(div);
  });
}

function renderSupSain() {
  ssRenderList("ssNews", state.supsain.news, "news");
  ssRenderList("ssDoy", state.supsain.doy);
  ssRenderList("ssIslam", state.supsain.islam);
  ssRenderList("ssQuiz", state.supsain.quiz, "quiz");
  ssRenderList("ssInnov", state.supsain.innov, "news");
  ssRenderList("ssWeekend", state.supsain.weekend);
  ssRenderList("ssBiz", state.supsain.biz);
  ssRenderList("ssJokes", state.supsain.jokes);

  const emptyAll = ["news", "doy", "islam", "quiz", "innov", "weekend", "biz", "jokes"]
    .every(k => (state.supsain[k] || []).length === 0);

  if (emptyAll) ssRefresh("all");
}

async function ssRefresh(section) {
  if (ssLoading) return;
  ssSetLoading(true);

  try {
    const url =
      section && section !== "all"
        ? `/api/supsain?section=${encodeURIComponent(section)}`
        : "/api/supsain";

    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json();

    if (section && section !== "all") {
      state.supsain[section] = Array.isArray(data.items) ? data.items : [];
    } else {
      state.supsain.news = data.news || [];
      state.supsain.doy = data.doy || [];
      state.supsain.islam = data.islam || [];
      state.supsain.quiz = data.quiz || [];
      state.supsain.innov = data.innov || [];
      state.supsain.weekend = data.weekend || [];
      state.supsain.biz = data.biz || [];
      state.supsain.jokes = data.jokes || [];
    }

    scheduleSave();
    renderSupSain();
  } catch (e) {
    alert("Could not refresh right now. Check internet and try again.");
  } finally {
    ssSetLoading(false);
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

    // Sup' Sain
    if (action === "ssRefresh") {
      ssRefresh(el.dataset.section || "all");
      return;
    }
    if (action === "ssToggleAnswer") {
      const idx = Number(el.dataset.idx || 0);
      const ans = document.querySelector(`[data-ss-ans="${idx}"]`);
      if (ans) {
        const nowHidden = !ans.hidden;
        ans.hidden = nowHidden;
        el.textContent = nowHidden ? "Show" : "Hide";
      }
      return;
    }

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
      state.daily.updated = clamp0(state.daily.updated - spent);
      scheduleSave();
      renderCurrent();
      return;
    }
    if (action === "quickResetDay") {
      if (!confirm("Reset daily updated balance to base?")) return;
      state.daily.updated = clamp0(state.daily.base);
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "addExpense") {
      const name = ($("#expName").value || "").trim();
      const notes = ($("#expNotes").value || "").trim();
      const amount = clamp0($("#expAmount").value);
      if (!name || amount <= 0) return alert("Enter name and amount");

      state.expenses.unshift({
        id: uid(),
        kind: "Expense",
        name,
        notes,
        amount,
        occurred: false,
        createdAt: Date.now()
      });

      $("#expName").value = "";
      $("#expNotes").value = "";
      $("#expAmount").value = "";
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "addService") {
      const name = ($("#svcName").value || "").trim();
      const notes = ($("#svcNotes").value || "").trim();
      const amount = clamp0($("#svcAmount").value);
      if (!name || amount <= 0) return alert("Enter amount");

      state.expenses.unshift({
        id: uid(),
        kind: "Service",
        name,
        notes,
        amount,
        occurred: false,
        createdAt: Date.now()
      });

      $("#svcNotes").value = "";
      $("#svcAmount").value = "";
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "toggleOccurred") {
      const id = el.dataset.id || el.closest("input")?.dataset.id;
      const item = state.expenses.find(x => x.id === id);
      if (!item) return;
      item.occurred = !item.occurred;
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "editExpense") {
      const id = el.dataset.id;
      const item = state.expenses.find(x => x.id === id);
      if (!item) return;
      const newName = prompt("Name:", item.name);
      if (newName === null) return;
      const newNotes = prompt("Notes:", item.notes || "");
      if (newNotes === null) return;
      const newAmt = prompt("Amount:", String(item.amount));
      if (newAmt === null) return;
      item.name = (newName || "").trim();
      item.notes = (newNotes || "").trim();
      item.amount = clamp0(newAmt);
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "delExpense") {
      const id = el.dataset.id;
      if (!confirm("Delete this item?")) return;
      state.expenses = state.expenses.filter(x => x.id !== id);
      scheduleSave();
      renderCurrent();
      return;
    }

    if (action === "clearExpenses") {
      if (!confirm("Clear all expenses?")) return;
      state.expenses = [];
      scheduleSave();
      renderCurrent();
      return;
    }

    // notes
    if (action === "saveNote") {
      const title = ($("#noteTitle").value || "").trim();
      const body = ($("#noteBody").value || "").trim();

      if (!title && !body) return alert("Write something first");

      if (editingNoteId) {
        const n = state.notes.find(x => x.id === editingNoteId);
        if (n) {
          n.title = title;
          n.body = body;
          n.updatedAt = Date.now();
        }
      } else {
        state.notes.unshift({ id: uid(), title, body, updatedAt: Date.now() });
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
      return;
    }

    if (action === "delNote") {
      const id = el.dataset.id;
      if (!confirm("Delete this note?")) return;
      state.notes = state.notes.filter(x => x.id !== id);
      scheduleSave();
      renderNotesDocs();
      return;
    }

    if (action === "previewDoc") {
      const id = el.dataset.id;
      const d = state.docs.find(x => x.id === id);
      if (!d) return;
      const box = $("#docPreview");
      if ((d.type || "").includes("pdf")) {
        box.innerHTML = `<iframe src="${escapeHtml(d.dataUrl)}" style="width:100%; height:420px; border:0; border-radius:14px;"></iframe>`;
      } else if ((d.type || "").startsWith("image/")) {
        box.innerHTML = `<img src="${escapeHtml(d.dataUrl)}" alt="preview" style="width:100%; height:auto; border-radius:14px;" />`;
      } else {
        box.textContent = "Preview not available.";
      }
      return;
    }

    if (action === "delDoc") {
      const id = el.dataset.id;
      if (!confirm("Delete this file?")) return;
      state.docs = state.docs.filter(x => x.id !== id);
      scheduleSave();
      renderNotesDocs();
      $("#docPreview").textContent = "Select a file to preview.";
      return;
    }

    // water
    if (action === "setWaterTarget") {
      const litres = Math.max(0, toNum($("#waterTargetL").value));
      state.water.targetMl = Math.round(litres * 1000);
      scheduleSave();
      renderWater();
      return;
    }

    if (action === "resetWaterToday") {
      if (!confirm("Reset today water?")) return;
      state.water.glasses = 0;
      state.water.lastDate = todayKey();
      scheduleSave();
      renderWater();
      return;
    }

    // quotes
    if (action === "refreshQuotes") {
      refreshQuotes();
      return;
    }

    if (action === "saveReflection") {
      state.quotes.reflection = $("#quoteReflection").value || "";
      scheduleSave();
      alert("Saved ✅");
      return;
    }

    // focus
    if (action === "startFocus") {
      const mins = toNum($("#focusMinutes").value);
      if (mins <= 0) return alert("Enter minutes");
      startFocus(mins);
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

    // plans
    if (action === "searchPlace") {
      const q = ($("#mapSearch").value || "").trim();
      if (!q) return;
      searchPlace(q);
      return;
    }

    if (action === "savePlan") {
      const name = ($("#planName").value || "").trim();
      const category = $("#planCat").value || "";
      const date = $("#planDate").value || "";
      const time = $("#planTime").value || "";
      const desc = ($("#planDesc").value || "").trim();

      if (!name) return alert("Name required");

      const pinLabel = state.plans.pin?.label || (state.plans.pin ? "Pinned" : "");

      state.plans.items.unshift({
        id: uid(),
        name,
        category,
        date,
        time,
        desc,
        pin: state.plans.pin || null,
        pinLabel,
        createdAt: Date.now()
      });

      $("#planName").value = "";
      $("#planDesc").value = "";
      scheduleSave();
      renderPlans();
      return;
    }

    if (action === "clearPlans") {
      if (!confirm("Clear all plans?")) return;
      state.plans.items = [];
      scheduleSave();
      renderPlans();
      return;
    }

    if (action === "delPlan") {
      const id = el.dataset.id;
      if (!confirm("Delete this plan?")) return;
      state.plans.items = state.plans.items.filter(x => x.id !== id);
      scheduleSave();
      renderPlans();
      return;
    }
  });

  // inputs
  $("#curBalance").addEventListener("input", () => {
    state.current.balance = clamp0($("#curBalance").value);
    scheduleSave();
    renderCurrent();
  });

  $("#curSavings").addEventListener("input", () => {
    state.current.savings = clamp0($("#curSavings").value);
    scheduleSave();
    renderCurrent();
  });

  $$(".weekInput").forEach(inp => {
    inp.addEventListener("input", () => {
      const w = inp.dataset.week;
      state.daily.weekPlan[w] = inp.value;
      scheduleSave();
    });
  });

  $("#noteSearch").addEventListener("input", () => renderNotesList());

  $("#docInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const f of files) {
      await addDocFile(f);
    }

    e.target.value = "";
    scheduleSave();
    renderDocsList();
  });
}

async function addDocFile(file) {
  // convert to dataUrl for preview/offline
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  state.docs.unshift({
    id: uid(),
    name: file.name,
    type: file.type || "application/octet-stream",
    dataUrl,
    createdAt: Date.now()
  });
}

/* ========= Init ========= */
async function init() {
  await detectRemote();
  await loadState();

  // initial renders
  renderOverall();
  renderCurrent();
  renderNotesDocs();
  renderWater();
  renderQuotes();
  renderFocus();
  renderPlans();

  bindEvents();

  // default tab
  setTab("overall");

  // if focus running, resume timer
  if (state.focus.running && state.focus.endAt) {
    clearInterval(focusTimer);
    focusTimer = setInterval(updateFocusCountdown, 500);
  }

  // auto refresh water date
  ensureWaterDate();
}

init();
