/* =========================================================
   HEISSE ECKE – WEB APP (Single-File JS, GitHub Pages)
   - Multi-Outlet
   - Admin-only Master Data: Inventory/Preps/Recipes/Bundles/Params/Users/Outlets
   - Outlet users: Dashboard (read), Sales, Stock
   - Preps (self-made sauces etc.) usable inside Recipes
   - Bundles (menus) usable in Sales mix
   - Stock Ledger + AUTO consumption from Sales (Recipe + Bundle + Prep expansion)
   - Local autosave + Supabase cloud sync (workspace)
   - Backup Export/Import (JSON)
========================================================= */

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

/* ----------------------- Storage Keys ----------------------- */
const LS = {
  workspace: "he_workspace",
  theme: "he_theme",
  session: "he_session",
  state: "he_state_v2",
  lastSaved: "he_last_saved",
  syncStatus: "he_sync_status",
  activeTab: "he_active_tab"
};

/* ----------------------- DOM Helpers ----------------------- */
function $(sel) {
  return document.querySelector(sel);
}
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const c of children)
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}
function nowISO() {
  return new Date().toISOString();
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function safeJsonParse(v, fallback) {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function readLS(key, fallback) {
  return safeJsonParse(localStorage.getItem(key), fallback);
}
function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
function toNumber(x) {
  if (x === null || x === undefined) return 0;
  const s = String(x).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n) {
  return `${(Number.isFinite(n) ? n : 0).toFixed(2)} €`;
}
function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

/* ----------------------- Theme ----------------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme() {
  const cur = localStorage.getItem(LS.theme) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ----------------------- Default State ----------------------- */
function defaultState() {
  return {
    version: 2,

    // OUTLETS
    outlets: [{ id: "outlet_main", name: "Main Outlet" }],

    // USERS (admin has access to all outlets via ["*"])
    users: [{ username: "admin", displayName: "Admin", outletIds: ["*"] }],

    // INVENTORY (master data)
    // unitType: 'g'|'ml'|'stk'
    // packSize: number (in g/ml or pieces)
    // packPrice: € (for whole pack)
    inventory: [],

    // PREPS (master data)
    // {id, topCat, subCat, name, yieldQty, yieldUnit('g'|'ml'|'stk'), lines:[{id, kind:'inventory'|'prep', refId, qty}]}
    preps: [],

    // RECIPES (master data)
    // {id, topCat, subCat, name, menuPrice, lines:[{id, kind:'inventory'|'prep', refId, qty}]}
    recipes: [],

    // BUNDLES (master data)
    // {id, topCat, subCat, name, menuPrice, items:[{id, recipeId, qty}]}
    bundles: [],

    // PARAMS (master data)
    params: {
      franchisePct: 0,
      vatPct: 7,

      // additional cost params (stored & shown; used for break-even panel)
      fixedDailyCosts: 0,        // €/day
      fixedMonthlyCosts: 0,      // €/month
      investmentMonthly: 0,      // €/month (capex amortized)
      paymentFeesPct: 0,         // % of revenue
      otherPct: 0,               // % of revenue (any extra)
      note: ""
    },

    // SALES (per outlet)
    // {id, date, outletId, kind:'recipe'|'bundle', refId, qty, priceOverride?}
    sales: [],

    // STOCK MOVEMENTS (per outlet)
    // {id,date,outletId,inventoryId,delta,kind:'IN'|'OUT'|'SET'|'AUTO',note}
    stockMovements: []
  };
}

/* ----------------------- Session / Workspace ----------------------- */
function getWorkspace() {
  return (localStorage.getItem(LS.workspace) || "").trim();
}
function setWorkspace(ws) {
  localStorage.setItem(LS.workspace, ws.trim());
}
function getSession() {
  return readLS(LS.session, null);
}
function setSession(s) {
  writeLS(LS.session, s);
}
function clearSession() {
  localStorage.removeItem(LS.session);
}

/* ----------------------- State Load/Save + Migration ----------------------- */
function migrateState(st) {
  if (!st || typeof st !== "object") return defaultState();

  // Ensure basic shape
  st.outlets = st.outlets || [{ id: "outlet_main", name: "Main Outlet" }];
  st.users = st.users || [{ username: "admin", displayName: "Admin", outletIds: ["*"] }];
  st.inventory = st.inventory || [];
  st.preps = st.preps || [];
  st.recipes = st.recipes || [];
  st.bundles = st.bundles || [];
  st.params = st.params || {};
  st.sales = st.sales || [];
  st.stockMovements = st.stockMovements || [];

  // Params defaults
  st.params.franchisePct = st.params.franchisePct ?? 0;
  st.params.vatPct = st.params.vatPct ?? 7;
  st.params.fixedDailyCosts = st.params.fixedDailyCosts ?? 0;
  st.params.fixedMonthlyCosts = st.params.fixedMonthlyCosts ?? 0;
  st.params.investmentMonthly = st.params.investmentMonthly ?? 0;
  st.params.paymentFeesPct = st.params.paymentFeesPct ?? 0;
  st.params.otherPct = st.params.otherPct ?? 0;
  st.params.note = st.params.note ?? "";

  // Users outletIds
  (st.users || []).forEach((u) => {
    if (!u.outletIds) {
      u.outletIds =
        String(u.username || "").toLowerCase() === "admin" ? ["*"] : [];
    }
  });

  // Ensure master-data line shapes
  (st.preps || []).forEach((p) => {
    p.lines = p.lines || [];
    p.yieldQty = p.yieldQty ?? "";
    p.yieldUnit = p.yieldUnit || "g";
  });
  (st.recipes || []).forEach((r) => {
    r.lines = r.lines || [];
  });
  (st.bundles || []).forEach((b) => {
    b.items = b.items || [];
  });

  st.version = 2;
  return st;
}

function loadState() {
  const raw = readLS(LS.state, null);
  const st = migrateState(raw);
  writeLS(LS.state, st);
  return st;
}

function saveState(st) {
  const migrated = migrateState(st);
  writeLS(LS.state, migrated);
  localStorage.setItem(LS.lastSaved, nowISO());
  scheduleCloudSave();
}

/* ----------------------- Permissions ----------------------- */
function isAdmin() {
  const s = getSession();
  return s && String(s.username || "").toLowerCase() === "admin";
}
function canEditMasterData() {
  return isAdmin();
}
function getOutletId() {
  const s = getSession();
  return s?.outletId || null;
}
function userAllowedOutlets(st, username) {
  const u = (st.users || []).find(
    (x) =>
      String(x.username || "").toLowerCase() ===
      String(username || "").toLowerCase()
  );
  if (!u) return [];
  if ((u.outletIds || []).includes("*")) return (st.outlets || []).map((o) => o.id);
  return u.outletIds || [];
}
function canUseOutlet(st, outletId) {
  if (isAdmin()) return true;
  const s = getSession();
  const allowed = userAllowedOutlets(st, s?.username);
  return allowed.includes(outletId);
}

/* ----------------------- Supabase Sync ----------------------- */
function setSyncStatus(text) {
  localStorage.setItem(LS.syncStatus, text);
  const n = $("#syncStatus");
  if (n) n.textContent = text;
}

async function supabaseUpsert(workspace, data) {
  const url = `${SUPABASE_URL}/rest/v1/app_state?on_conflict=workspace`;
  const body = [{ workspace, data, updated_at: nowISO() }];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Cloud Save failed: ${res.status} ${t}`);
  }
}

async function supabaseFetch(workspace) {
  const url = `${SUPABASE_URL}/rest/v1/app_state?workspace=eq.${encodeURIComponent(
    workspace
  )}&select=data,updated_at`;

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Cloud Load failed: ${res.status} ${t}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

let cloudTimer = null;
function scheduleCloudSave() {
  const ws = getWorkspace();
  if (!ws) return;
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async () => {
    try {
      setSyncStatus("Sync: speichere …");
      const st = loadState();
      await supabaseUpsert(ws, {
        ...st,
        savedAt: localStorage.getItem(LS.lastSaved) || nowISO()
      });
      setSyncStatus("Sync: aktuell ✅");
    } catch (e) {
      console.error(e);
      setSyncStatus("Sync: Fehler ❌");
    }
  }, 700);
}

async function cloudPullOnStart() {
  const ws = getWorkspace();
  if (!ws) return;
  try {
    setSyncStatus("Sync: lade …");
    const row = await supabaseFetch(ws);
    if (row?.data) {
      const migrated = migrateState(row.data);
      writeLS(LS.state, migrated);
      localStorage.setItem(LS.lastSaved, migrated.savedAt || nowISO());
      setSyncStatus("Sync: geladen ✅");
    } else {
      const st = loadState();
      await supabaseUpsert(ws, { ...st, savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
      setSyncStatus("Sync: initial ✅");
    }
  } catch (e) {
    console.error(e);
    setSyncStatus("Sync: Fehler ❌");
  }
}

/* ----------------------- Calculations ----------------------- */

// Inventory unit price (€/g or €/ml or €/stk)
function unitPrice(inv) {
  const packPrice = toNumber(inv.packPrice);
  const packSize = toNumber(inv.packSize);
  if (packPrice <= 0) return 0;

  if (inv.unitType === "stk") {
    const denom = packSize > 0 ? packSize : 1;
    return packPrice / denom;
  }
  if (packSize <= 0) return 0;
  return packPrice / packSize;
}

// Expand prep usage to inventory consumption (supports nested preps)
function expandPrepToInventory(st, prepId, qtyUsed, stack = new Set()) {
  if (stack.has(prepId)) return {};
  const prep = (st.preps || []).find((p) => p.id === prepId);
  if (!prep) return {};

  const yieldQty = Math.max(0, toNumber(prep.yieldQty));
  if (yieldQty <= 0) return {}; // can't expand without yield

  stack.add(prepId);

  const factor = qtyUsed / yieldQty;
  const out = {};
  (prep.lines || []).forEach((ln) => {
    const q = toNumber(ln.qty) * factor;
    if (q <= 0) return;

    if (ln.kind === "inventory") {
      out[ln.refId] = (out[ln.refId] || 0) + q;
    } else if (ln.kind === "prep") {
      const sub = expandPrepToInventory(st, ln.refId, q, stack);
      for (const [iid, val] of Object.entries(sub)) {
        out[iid] = (out[iid] || 0) + val;
      }
    }
  });

  stack.delete(prepId);
  return out;
}

function recipeCost(st, recipe, inventoryById) {
  let sum = 0;
  (recipe.lines || []).forEach((ln) => {
    const q = toNumber(ln.qty);
    if (q <= 0) return;

    if (ln.kind === "inventory") {
      const inv = inventoryById[ln.refId];
      if (!inv) return;
      sum += q * unitPrice(inv);
    } else if (ln.kind === "prep") {
      // expand to inventory using yield ratios
      const map = expandPrepToInventory(st, ln.refId, q);
      for (const [iid, qtyInv] of Object.entries(map)) {
        const inv = inventoryById[iid];
        if (!inv) continue;
        sum += toNumber(qtyInv) * unitPrice(inv);
      }
    }
  });
  return sum;
}

function recipeDB(st, recipe, overridePriceNullable) {
  const invById = Object.fromEntries((st.inventory || []).map((x) => [x.id, x]));
  const price =
    overridePriceNullable !== null && overridePriceNullable !== undefined
      ? toNumber(overridePriceNullable)
      : toNumber(recipe.menuPrice);

  const cost = recipeCost(st, recipe, invById);

  const frPct = toNumber(st.params?.franchisePct) / 100;
  const payPct = toNumber(st.params?.paymentFeesPct) / 100;
  const otherPct = toNumber(st.params?.otherPct) / 100;

  const fees = price * (frPct + payPct + otherPct);
  const db = price - cost - fees;
  const dbPct = price > 0 ? (db / price) * 100 : 0;

  return { price, cost, fees, db, dbPct };
}

function bundleCost(st, bundle) {
  const invById = Object.fromEntries((st.inventory || []).map((x) => [x.id, x]));
  let sum = 0;
  (bundle.items || []).forEach((it) => {
    const r = (st.recipes || []).find((x) => x.id === it.recipeId);
    if (!r) return;
    const mult = Math.max(0, toNumber(it.qty || 1));
    const c = recipeCost(st, r, invById);
    sum += c * mult;
  });
  return sum;
}

function bundleDB(st, bundle, overridePriceNullable) {
  const price =
    overridePriceNullable !== null && overridePriceNullable !== undefined
      ? toNumber(overridePriceNullable)
      : toNumber(bundle.menuPrice);

  const cost = bundleCost(st, bundle);

  const frPct = toNumber(st.params?.franchisePct) / 100;
  const payPct = toNumber(st.params?.paymentFeesPct) / 100;
  const otherPct = toNumber(st.params?.otherPct) / 100;

  const fees = price * (frPct + payPct + otherPct);
  const db = price - cost - fees;
  const dbPct = price > 0 ? (db / price) * 100 : 0;

  return { price, cost, fees, db, dbPct };
}

/* ----------------------- Stock Ledger ----------------------- */
function stockFor(st, outletId, inventoryId) {
  return (st.stockMovements || [])
    .filter((m) => m.outletId === outletId && m.inventoryId === inventoryId)
    .reduce((s, m) => s + toNumber(m.delta), 0);
}
function addStockMove(st, { date, outletId, inventoryId, delta, kind, note }) {
  st.stockMovements = st.stockMovements || [];
  st.stockMovements.push({
    id: uuid(),
    date: date || todayISO(),
    outletId,
    inventoryId,
    delta: String(delta),
    kind,
    note: note || ""
  });
}

function consumptionFromSales(st, date, outletId) {
  // returns map: inventoryId => qty in inv unit
  const out = {};
  const entries = (st.sales || []).filter((s) => s.date === date && s.outletId === outletId);

  entries.forEach((s) => {
    const sold = toNumber(s.qty);
    if (sold <= 0) return;

    if (s.kind === "recipe") {
      const r = (st.recipes || []).find((x) => x.id === s.refId);
      if (!r) return;

      (r.lines || []).forEach((ln) => {
        const baseQty = toNumber(ln.qty);
        if (baseQty <= 0) return;
        const used = baseQty * sold;

        if (ln.kind === "inventory") {
          out[ln.refId] = (out[ln.refId] || 0) + used;
        } else if (ln.kind === "prep") {
          const invMap = expandPrepToInventory(st, ln.refId, used);
          for (const [iid, val] of Object.entries(invMap)) {
            out[iid] = (out[iid] || 0) + toNumber(val);
          }
        }
      });
    }

    if (s.kind === "bundle") {
      const b = (st.bundles || []).find((x) => x.id === s.refId);
      if (!b) return;

      (b.items || []).forEach((it) => {
        const r = (st.recipes || []).find((x) => x.id === it.recipeId);
        if (!r) return;

        const mult = sold * Math.max(0, toNumber(it.qty || 1));

        (r.lines || []).forEach((ln) => {
          const baseQty = toNumber(ln.qty);
          if (baseQty <= 0) return;
          const used = baseQty * mult;

          if (ln.kind === "inventory") {
            out[ln.refId] = (out[ln.refId] || 0) + used;
          } else if (ln.kind === "prep") {
            const invMap = expandPrepToInventory(st, ln.refId, used);
            for (const [iid, val] of Object.entries(invMap)) {
              out[iid] = (out[iid] || 0) + toNumber(val);
            }
          }
        });
      });
    }
  });

  return out;
}

/* ----------------------- UI Base ----------------------- */
function ensureRoot() {
  let root = $("#app");
  if (!root) {
    root = document.createElement("div");
    root.id = "app";
    document.body.appendChild(root);
  }
  return root;
}

function injectBaseStyles() {
  if ($("#he_styles")) return;
  const style = el("style", {
    id: "he_styles",
    html: `
    :root {
      --bg:#0b0f14; --card:#121926; --text:#e8eef9; --muted:#a6b0c3;
      --border:#223049; --primary:#4ea1ff; --danger:#ff5a5f; --ok:#39d98a;
      --input:#0f1522; --tab:#0e1420;
      --shadow: 0 8px 30px rgba(0,0,0,.25);
    }
    :root[data-theme="light"]{
      --bg:#f5f7fb; --card:#ffffff; --text:#111827; --muted:#516072;
      --border:#d9e1ee; --primary:#2563eb; --danger:#dc2626; --ok:#16a34a;
      --input:#f3f6fb; --tab:#f0f4fa;
      --shadow: 0 10px 30px rgba(17,24,39,.08);
    }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
    .container{ max-width:1100px; margin:0 auto; padding:16px; }
    .topbar{ display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .title{ font-size:18px; font-weight:900; }
    .sub{ color:var(--muted); font-size:12px; line-height:1.35; }
    .card{ background:var(--card); border:1px solid var(--border); border-radius:16px; padding:14px; box-shadow: var(--shadow); }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn{ border:1px solid var(--border); background:transparent; color:var(--text); padding:9px 12px; border-radius:12px; cursor:pointer; font-weight:800; }
    .btn.primary{ background:var(--primary); border-color:transparent; color:#fff; }
    .btn.danger{ background:var(--danger); border-color:transparent; color:#fff; }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .input, select, textarea{
      width:100%; padding:10px 10px; border-radius:12px;
      border:1px solid var(--border); background:var(--input); color:var(--text);
      outline:none;
    }
    .label{ font-size:12px; color:var(--muted); margin-top:10px; margin-bottom:6px; }
    .grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:12px; }
    .col-12{ grid-column: span 12; } .col-6{ grid-column: span 6; } .col-4{ grid-column: span 4; } .col-8{ grid-column: span 8; } .col-3{ grid-column: span 3; } .col-9{ grid-column: span 9; }
    @media (max-width: 900px){ .col-6,.col-4,.col-8,.col-3,.col-9{ grid-column: span 12; } }
    .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
    .tab{
      background:var(--tab); border:1px solid var(--border);
      padding:9px 10px; border-radius:12px; cursor:pointer; font-weight:900; color:var(--text);
    }
    .tab.active{ outline:2px solid var(--primary); }
    .hr{ height:1px; background:var(--border); margin:12px 0; }
    table{ width:100%; border-collapse:collapse; }
    th, td{ border-bottom:1px solid var(--border); padding:10px 8px; font-size:13px; text-align:left; vertical-align:top; }
    th{ color:var(--muted); font-size:12px; }
    td.right, th.right{ text-align:right; }
    .ok{ color:var(--ok); font-weight:900; }
    .bad{ color:var(--danger); font-weight:900; }
    .pill{ display:inline-block; padding:2px 10px; border-radius:999px; border:1px solid var(--border); font-size:12px; color:var(--muted); }
    .small{ font-size:12px; color:var(--muted); }
    .two{ display:flex; gap:10px; flex-wrap:wrap; }
    .two > div{ flex: 1; min-width: 220px; }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .hint{ padding:8px 10px; border-radius:12px; border:1px dashed var(--border); background:rgba(255,255,255,.02); }
    .stickyTop{
      position: sticky; top: 0; z-index: 5;
      background: var(--bg); padding-top: 10px;
    }
  `
  });
  document.head.appendChild(style);
}

/* ----------------------- Tabs ----------------------- */
function getActiveTab() {
  return readLS(LS.activeTab, "dashboard");
}
function setActiveTab(id) {
  writeLS(LS.activeTab, id);
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-tab") === id);
  });
}
function tabBtn(id, label, show) {
  if (!show) return el("span");
  const btn = el("button", { class: `tab`, "data-tab": id }, [label]);
  btn.onclick = () => {
    setActiveTab(id);
    renderActiveTab(id);
  };
  return btn;
}

/* ----------------------- UI: Login ----------------------- */
function screenLogin() {
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const ws = getWorkspace();
  const wsInput = el("input", {
    class: "input",
    value: ws,
    placeholder: "z.B. heisse-ecke"
  });

  const userInput = el("input", {
    class: "input",
    placeholder: "admin oder angelegter User"
  });

  const outletSelect = el("select", { class: "input" }, []);
  const outletWrap = el("div", { style: "display:none" }, [
    el("div", { class: "label" }, ["Outlet"]),
    outletSelect
  ]);

  const msg = el("div", { class: "small", style: "margin-top:10px" }, [""]);

  const btnLogin = el("button", { class: "btn primary" }, ["Weiter"]);
  const btnTheme = el("button", { class: "btn" }, ["Hell/Dunkel"]);
  btnTheme.onclick = toggleTheme;

  btnLogin.onclick = async () => {
    msg.textContent = "";
    const w = (wsInput.value || "").trim();
    const u = (userInput.value || "").trim();

    if (!w) {
      msg.textContent = "Workspace ist Pflicht (darf nicht leer sein).";
      return;
    }
    if (!u) {
      msg.textContent = "Username fehlt.";
      return;
    }

    setWorkspace(w);
    await cloudPullOnStart();

    const st = loadState();
    const hit = (st.users || []).find(
      (x) => String(x.username || "").toLowerCase() === u.toLowerCase()
    );
    if (!hit) {
      msg.textContent = "Unbekannter User (Admin muss dich anlegen).";
      return;
    }

    // Outlet requirement for non-admin
    const allowed = userAllowedOutlets(st, hit.username);
    let outletId = null;

    if (String(hit.username).toLowerCase() !== "admin") {
      if (allowed.length === 0) {
        msg.textContent =
          "Kein Outlet zugewiesen. Admin muss dich freischalten.";
        return;
      }

      // If multiple, enforce selection
      if (allowed.length > 1) {
        outletWrap.style.display = "block";
        outletSelect.innerHTML = "";
        allowed.forEach((oid) => {
          const o = (st.outlets || []).find((x) => x.id === oid);
          outletSelect.appendChild(
            el("option", { value: oid }, [o ? o.name : oid])
          );
        });
        outletId = (outletSelect.value || "").trim() || null;
        if (!outletId) {
          msg.textContent = "Bitte Outlet auswählen.";
          return;
        }
      } else {
        outletId = allowed[0];
      }
    }

    setSession({
      username: hit.username,
      displayName: hit.displayName || hit.username,
      outletId
    });

    screenApp();
  };

  const card = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Login / Workspace"]),
    el("div", {
      class: "sub",
      html: `Workspace ist Pflicht (Sync). Beispiel: <b>heisse-ecke</b>`
    }),
    el("div", { class: "label" }, ["Workspace Code"]),
    wsInput,
    el("div", { class: "label" }, ["Username"]),
    userInput,
    outletWrap,
    el("div", { class: "row", style: "margin-top:12px" }, [
      btnLogin,
      btnTheme
    ]),
    msg
  ]);

  const info = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Was diese App kann (MVP+)"]),
    el("div", {
      class: "sub",
      html: `
      ✅ Multi-Outlet + Rollen<br/>
      ✅ Inventur (Master) + €/Einheit Berechnung<br/>
      ✅ Preps (Saucen etc.) + Yield<br/>
      ✅ Rezepte (Gerichte) mit Inventur + Preps<br/>
      ✅ Bundles (Menüs) aus Gerichten<br/>
      ✅ DB/Wareneinsatz/Fee-Abzüge<br/>
      ✅ Daily Sales (Recipe/Bundle) pro Outlet<br/>
      ✅ Bestände: Wareneingang/Verbrauch/Zählung + AUTO aus Sales<br/>
      ✅ Backup Export/Import + Sync via Supabase
    `
    })
  ]);

  root.appendChild(
    el("div", { class: "container" }, [
      el("div", { class: "topbar" }, [
        el("div", {}, [
          el("div", { class: "title" }, ["Heisse Ecke – Kalkulation (Web)"]),
          el("div", { class: "sub" }, [
            "GitHub Pages · Supabase Sync · Ohne Node"
          ])
        ]),
        el("div", { class: "row" }, [
          el("div", { class: "pill", id: "syncStatus" }, [
            localStorage.getItem(LS.syncStatus) || (ws ? "Sync: bereit" : "Sync: aus")
          ])
        ])
      ]),
      el("div", { class: "grid", style: "margin-top:12px" }, [card, info])
    ])
  );
}

/* ----------------------- UI: App Shell ----------------------- */
function screenApp() {
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const s = getSession();
  if (!s) {
    screenLogin();
    return;
  }

  const ws = getWorkspace();
  if (!ws) {
    clearSession();
    screenLogin();
    return;
  }

  const st = loadState();

  // Validate outlet for non-admin
  if (!isAdmin()) {
    const outletId = getOutletId();
    if (!outletId || !canUseOutlet(st, outletId)) {
      clearSession();
      screenLogin();
      return;
    }
  }

  const outletName = (() => {
    if (isAdmin()) return "Admin";
    const oid = getOutletId();
    const o = (st.outlets || []).find((x) => x.id === oid);
    return o ? o.name : (oid || "—");
  })();

  const header = el("div", { class: "topbar stickyTop" }, [
    el("div", {}, [
      el("div", { class: "title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", {
        class: "sub",
        html: `
        Workspace: <b>${escapeHtml(ws)}</b> · <span id="syncStatus">${escapeHtml(
          localStorage.getItem(LS.syncStatus) || "Sync: bereit"
        )}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(
          s.username
        )}) · Outlet: <b>${escapeHtml(outletName)}</b><br/>
        Letzte Speicherung: <b>${escapeHtml(
          localStorage.getItem(LS.lastSaved) || "—"
        )}</b>
      `
      })
    ]),
    el("div", { class: "row" }, [
      el("button", { class: "btn", onclick: toggleTheme }, ["Hell/Dunkel"]),
      el("button", {
        class: "btn",
        onclick: async () => {
          try {
            setSyncStatus("Sync: speichere …");
            const state = loadState();
            await supabaseUpsert(ws, {
              ...state,
              savedAt: localStorage.getItem(LS.lastSaved) || nowISO()
            });
            setSyncStatus("Sync: aktuell ✅");
            await cloudPullOnStart();
            renderActiveTab(getActiveTab());
          } catch (e) {
            console.error(e);
            setSyncStatus("Sync: Fehler ❌");
            alert("Sync Fehler. Schau Console (F12).");
          }
        }
      }, ["Sync jetzt"]),
      el("button", { class: "btn danger", onclick: () => { clearSession(); screenLogin(); } }, ["Logout"])
    ])
  ]);

  const tabs = el("div", { class: "card", style: "margin-top:12px" }, [
    el("div", { class: "tabs" }, [
      tabBtn("dashboard", "Dashboard", true),
      tabBtn("sales", "Daily Sales", true),
      tabBtn("stock", "Bestände", true),
      tabBtn("inventory", "Inventur (Admin)", canEditMasterData()),
      tabBtn("preps", "Preps (Admin)", canEditMasterData()),
      tabBtn("recipes", "Rezepte (Admin)", canEditMasterData()),
      tabBtn("bundles", "Bundles (Admin)", canEditMasterData()),
      tabBtn("params", "Parameter (Admin)", canEditMasterData()),
      tabBtn("backup", "Backup", true),
      tabBtn("users", "Admin: User/Outlets", isAdmin())
    ])
  ]);

  const content = el("div", { id: "content", style: "margin-top:12px" }, []);
  root.appendChild(el("div", { class: "container" }, [header, tabs, content]));

  const savedTab = getActiveTab();
  setActiveTab(savedTab);
  renderActiveTab(savedTab);
}

/* ----------------------- Render Dispatcher ----------------------- */
function renderActiveTab(tab) {
  setActiveTab(tab);
  const content = $("#content");
  if (!content) return;
  content.innerHTML = "";
  const st = loadState();

  if (tab === "dashboard") content.appendChild(renderDashboard(st));
  if (tab === "sales") content.appendChild(renderSales(st));
  if (tab === "stock") content.appendChild(renderStock(st));
  if (tab === "inventory") content.appendChild(renderInventory(st));
  if (tab === "preps") content.appendChild(renderPreps(st));
  if (tab === "recipes") content.appendChild(renderRecipes(st));
  if (tab === "bundles") content.appendChild(renderBundles(st));
  if (tab === "params") content.appendChild(renderParams(st));
  if (tab === "backup") content.appendChild(renderBackup(st));
  if (tab === "users") content.appendChild(renderUsers(st));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st) {
  const outletId = isAdmin() ? null : getOutletId();
  const invById = Object.fromEntries((st.inventory || []).map((x) => [x.id, x]));

  // Recipe table rows
  const recipeRows = (st.recipes || []).map((r) => {
    const calc = recipeDB(st, r, null);
    return {
      type: "recipe",
      id: r.id,
      name: r.name,
      cat: `${r.topCat || ""} / ${r.subCat || ""}`,
      price: calc.price,
      cost: calc.cost,
      fees: calc.fees,
      db: calc.db,
      dbPct: calc.dbPct
    };
  });

  // Bundle rows
  const bundleRows = (st.bundles || []).map((b) => {
    const calc = bundleDB(st, b, null);
    return {
      type: "bundle",
      id: b.id,
      name: b.name,
      cat: `${b.topCat || ""} / ${b.subCat || ""}`,
      price: calc.price,
      cost: calc.cost,
      fees: calc.fees,
      db: calc.db,
      dbPct: calc.dbPct
    };
  });

  const today = todayISO();
  const salesToday = (st.sales || []).filter((s) => {
    if (isAdmin()) return s.date === today;
    return s.date === today && s.outletId === outletId;
  });

  let dbToday = 0;
  let revenueToday = 0;
  salesToday.forEach((s) => {
    const qty = toNumber(s.qty);
    if (qty <= 0) return;

    if (s.kind === "recipe") {
      const r = (st.recipes || []).find((x) => x.id === s.refId);
      if (!r) return;
      const calc = recipeDB(st, r, s.priceOverride ?? null);
      dbToday += calc.db * qty;
      revenueToday += calc.price * qty;
    } else if (s.kind === "bundle") {
      const b = (st.bundles || []).find((x) => x.id === s.refId);
      if (!b) return;
      const calc = bundleDB(st, b, s.priceOverride ?? null);
      dbToday += calc.db * qty;
      revenueToday += calc.price * qty;
    }
  });

  // Break-even estimate (very simple)
  const fixedDaily = toNumber(st.params?.fixedDailyCosts);
  const fixedMonthly = toNumber(st.params?.fixedMonthlyCosts);
  const investMonthly = toNumber(st.params?.investmentMonthly);
  const fixedTotalDaily = fixedDaily + (fixedMonthly + investMonthly) / 30;

  const card1 = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Status"]),
    el("div", { class: "hr" }),
    el("div", {
      class: "sub",
      html: `
      Outlets: <b>${(st.outlets || []).length}</b><br/>
      Inventur-Artikel: <b>${(st.inventory || []).length}</b><br/>
      Preps: <b>${(st.preps || []).length}</b><br/>
      Rezepte: <b>${(st.recipes || []).length}</b><br/>
      Bundles: <b>${(st.bundles || []).length}</b><br/>
      Sales heute (${today}): <b>${salesToday.length}</b><br/>
      Umsatz heute: <b>${fmtEUR(revenueToday)}</b><br/>
      DB heute: <b class="${dbToday >= 0 ? "ok" : "bad"}">${fmtEUR(dbToday)}</b>
    `
    })
  ]);

  const card2 = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Break-even (grob)"]),
    el("div", { class: "hr" }),
    el("div", {
      class: "sub",
      html: `
      Fixkosten/Tag (inkl. Monatskosten/Invest): <b>${fmtEUR(fixedTotalDaily)}</b><br/>
      DB heute: <b class="${dbToday >= 0 ? "ok" : "bad"}">${fmtEUR(dbToday)}</b><br/>
      Lücke heute: <b class="${(dbToday - fixedTotalDaily) >= 0 ? "ok" : "bad"}">${fmtEUR(dbToday - fixedTotalDaily)}</b><br/>
      <span class="small">Hinweis: Das ist eine einfache Orientierung (MVP). Parameter sind im Admin-Tab editierbar.</span>
    `
    })
  ]);

  const rows = [...recipeRows, ...bundleRows];

  const table = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Produkte – Wareneinsatz & DB (Master)"]),
    el("div", { class: "sub" }, [
      isAdmin()
        ? "Du siehst alle Rezepte & Bundles."
        : "Du siehst die Master-Kalkulation (read-only)."
    ]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Typ"]),
            el("th", {}, ["Name"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class: "right" }, ["Wareneinsatz"]),
            el("th", { class: "right" }, ["Fees"]),
            el("th", { class: "right" }, ["Preis"]),
            el("th", { class: "right" }, ["DB €"]),
            el("th", { class: "right" }, ["DB %"])
          ])
        ]),
        el("tbody", {}, rows.map((r) => {
          return el("tr", {}, [
            el("td", { html: escapeHtml(r.type) }),
            el("td", { html: escapeHtml(r.name) }),
            el("td", { html: escapeHtml(r.cat) }),
            el("td", { class: "right" }, [fmtEUR(r.cost)]),
            el("td", { class: "right" }, [fmtEUR(r.fees)]),
            el("td", { class: "right" }, [fmtEUR(r.price)]),
            el("td", { class: `right ${r.db >= 0 ? "ok" : "bad"}` }, [fmtEUR(r.db)]),
            el("td", { class: `right ${r.dbPct >= 0 ? "ok" : "bad"}` }, [`${r.dbPct.toFixed(1)}%`])
          ]);
        }))
      ])
    ])
  ]);

  return el("div", { class: "grid" }, [card1, card2, table]);
}

/* ----------------------- Inventory (Admin) ----------------------- */
function renderInventory(st) {
  if (!canEditMasterData()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"]),
      el("div", { class: "sub" }, ["Nur Admin darf Inventur/Preise/Artikel verwalten."])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  const inv_group = el("input", { class: "input", placeholder: "z.B. Fleisch, Saucen, Verpackung" });
  const inv_name = el("input", { class: "input", placeholder: "z.B. Currywurst gelb" });
  const inv_supplier = el("input", { class: "input", placeholder: "z.B. Metro" });
  const inv_packSize = el("input", { class: "input", inputmode: "decimal", placeholder: "z.B. 1000" });
  const inv_unit = el("select", { class: "input" }, [
    el("option", { value: "g" }, ["g"]),
    el("option", { value: "ml" }, ["ml"]),
    el("option", { value: "stk" }, ["stk"])
  ]);
  const inv_packPrice = el("input", { class: "input", inputmode: "decimal", placeholder: "z.B. 12,50" });
  const inv_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);

  const btnAddInv = el("button", { class: "btn primary" }, ["Artikel speichern"]);
  const inv_tbody = el("tbody", {});
  const editor = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Artikel bearbeiten"]),
    el("div", { class: "small" }, ["Noch kein Artikel ausgewählt."])
  ]);

  const form = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Inventur – Artikel anlegen"]),
    el("div", { class: "sub" }, ["Packgröße + Packpreis → App rechnet €/Einheit (g/ml/stk)."]),
    el("div", { class: "label" }, ["Warengruppe"]), inv_group,
    el("div", { class: "label" }, ["Artikelname"]), inv_name,
    el("div", { class: "label" }, ["Lieferant"]), inv_supplier,
    el("div", { class: "two" }, [
      el("div", {}, [el("div", { class: "label" }, ["Packgröße"]), inv_packSize]),
      el("div", {}, [el("div", { class: "label" }, ["Einheit"]), inv_unit])
    ]),
    el("div", { class: "label" }, ["Packpreis (€)"]), inv_packPrice,
    el("div", { class: "row", style: "margin-top:12px" }, [btnAddInv]),
    inv_msg
  ]);

  const listCard = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Inventur – Liste (Klick zum Editieren)"]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Artikel"]),
            el("th", {}, ["Warengruppe"]),
            el("th", {}, ["Einheit"]),
            el("th", { class: "right" }, ["Pack"]),
            el("th", { class: "right" }, ["€ Pack"]),
            el("th", { class: "right" }, ["€ / Einheit"])
          ])
        ]),
        inv_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function drawList() {
    inv_tbody.innerHTML = "";
    (st.inventory || []).forEach((inv) => {
      const up = unitPrice(inv);
      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { html: escapeHtml(inv.name) }),
        el("td", { html: escapeHtml(inv.group || "") }),
        el("td", { html: escapeHtml(inv.unitType) }),
        el("td", { class: "right" }, [String(toNumber(inv.packSize) || "")]),
        el("td", { class: "right" }, [toNumber(inv.packPrice).toFixed(2)]),
        el("td", { class: "right" }, [up.toFixed(4)])
      ]);
      tr.onclick = () => openEditor(inv.id);
      inv_tbody.appendChild(tr);
    });
  }

  function openEditor(id) {
    const inv = (st.inventory || []).find((x) => x.id === id);
    if (!inv) {
      editor.innerHTML =
        `<div class="title">Artikel bearbeiten</div><div class="small">Noch kein Artikel ausgewählt.</div>`;
      return;
    }
    editor.innerHTML = "";
    editor.appendChild(el("div", { class: "title" }, ["Artikel bearbeiten"]));
    editor.appendChild(el("div", { class: "sub" }, ["Speichern schreibt den neuen Stand."]));

    const name = el("input", { class: "input", value: inv.name || "" });
    const group = el("input", { class: "input", value: inv.group || "" });
    const supplier = el("input", { class: "input", value: inv.supplier || "" });
    const packSize = el("input", { class: "input", inputmode: "decimal", value: String(inv.packSize ?? "") });
    const packPrice = el("input", { class: "input", inputmode: "decimal", value: String(inv.packPrice ?? "") });
    const unit = el("select", { class: "input" }, [
      el("option", { value: "g" }, ["g"]),
      el("option", { value: "ml" }, ["ml"]),
      el("option", { value: "stk" }, ["stk"])
    ]);
    unit.value = inv.unitType || "g";

    const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
    const upView = el("div", { class: "small", style: "margin-top:6px" }, [""]);

    function refreshUP() {
      const tmp = {
        ...inv,
        name: name.value,
        group: group.value,
        supplier: supplier.value,
        packSize: packSize.value,
        packPrice: packPrice.value,
        unitType: unit.value
      };
      upView.innerHTML =
        `Preis pro Einheit: <b>${unitPrice(tmp).toFixed(4)} €/ ${escapeHtml(tmp.unitType)}</b>`;
    }
    [packSize, packPrice, unit].forEach((x) => x.addEventListener("change", refreshUP));
    refreshUP();

    const btnSave = el("button", { class: "btn primary" }, ["Speichern"]);
    const btnDel = el("button", { class: "btn danger" }, ["Löschen"]);

    btnSave.onclick = () => {
      inv.name = name.value.trim();
      inv.group = group.value.trim();
      inv.supplier = supplier.value.trim();
      inv.packSize = packSize.value.trim();
      inv.packPrice = packPrice.value.trim();
      inv.unitType = unit.value;

      if (!inv.name) {
        msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`;
        return;
      }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
    };

    btnDel.onclick = () => {
      if (!confirm("Artikel wirklich löschen? (Rezepte/Preps verlieren die Zuordnung)")) return;

      const invId = inv.id;
      st.inventory = (st.inventory || []).filter((x) => x.id !== invId);

      // Remove from preps/recipes
      (st.preps || []).forEach((p) => {
        p.lines = (p.lines || []).filter((l) => !(l.kind === "inventory" && l.refId === invId));
      });
      (st.recipes || []).forEach((r) => {
        r.lines = (r.lines || []).filter((l) => !(l.kind === "inventory" && l.refId === invId));
      });

      // Remove stock movements
      st.stockMovements = (st.stockMovements || []).filter((m) => m.inventoryId !== invId);

      saveState(st);
      drawList();
      openEditor(null);
    };

    editor.appendChild(el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Artikelname"]), name]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Warengruppe"]), group]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Lieferant"]), supplier]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Einheit"]), unit]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Packgröße"]), packSize]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Packpreis (€)"]), packPrice]),
      el("div", { class: "col-12" }, [upView]),
      el("div", { class: "col-12" }, [el("div", { class: "row" }, [btnSave, btnDel])]),
      el("div", { class: "col-12" }, [msg])
    ]));
  }

  btnAddInv.onclick = () => {
    inv_msg.textContent = "";

    const item = {
      id: uuid(),
      group: (inv_group.value || "").trim(),
      name: (inv_name.value || "").trim(),
      supplier: (inv_supplier.value || "").trim(),
      unitType: inv_unit.value,
      packSize: (inv_packSize.value || "").trim(),
      packPrice: (inv_packPrice.value || "").trim()
    };

    if (!item.name) {
      inv_msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`;
      return;
    }

    st.inventory.push(item);
    saveState(st);

    inv_name.value = "";
    inv_packSize.value = "";
    inv_packPrice.value = "";
    inv_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- Preps (Admin) ----------------------- */
function renderPreps(st) {
  if (!canEditMasterData()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"]),
      el("div", { class: "sub" }, ["Nur Admin darf Preps anlegen/ändern."])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  const p_top = el("input", { class: "input", placeholder: "z.B. Speisen / Getränke / Prep" });
  const p_sub = el("input", { class: "input", placeholder: "z.B. Saucen / Toppings" });
  const p_name = el("input", { class: "input", placeholder: "z.B. Currysoße Haus" });
  const p_yieldQty = el("input", { class: "input", inputmode: "decimal", placeholder: "Yield Menge (z.B. 2000)" });
  const p_yieldUnit = el("select", { class: "input" }, [
    el("option", { value: "g" }, ["g"]),
    el("option", { value: "ml" }, ["ml"]),
    el("option", { value: "stk" }, ["stk"])
  ]);
  const p_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddPrep = el("button", { class: "btn primary" }, ["Prep speichern"]);

  const p_tbody = el("tbody", {});
  const editor = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Prep bearbeiten"]),
    el("div", { class: "small" }, ["Noch kein Prep ausgewählt."])
  ]);

  const form = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Prep – anlegen (Saucen etc.)"]),
    el("div", { class: "sub" }, ["Yield ist Pflicht, damit Preps in Rezeptkosten/Verbrauch sauber funktionieren."]),
    el("div", { class: "label" }, ["Top-Kategorie"]), p_top,
    el("div", { class: "label" }, ["Unterkategorie"]), p_sub,
    el("div", { class: "label" }, ["Name"]), p_name,
    el("div", { class: "two" }, [
      el("div", {}, [el("div", { class: "label" }, ["Yield Menge"]), p_yieldQty]),
      el("div", {}, [el("div", { class: "label" }, ["Yield Einheit"]), p_yieldUnit])
    ]),
    el("div", { class: "row", style: "margin-top:12px" }, [btnAddPrep]),
    p_msg
  ]);

  const listCard = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Preps – Liste (Klick zum Bearbeiten)"]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Prep"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class: "right" }, ["Yield"])
          ])
        ]),
        p_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function prepCost(st, prep) {
    // cost of whole yield (not per unit)
    const invById = Object.fromEntries((st.inventory || []).map((x) => [x.id, x]));
    let sum = 0;
    (prep.lines || []).forEach((ln) => {
      const q = toNumber(ln.qty);
      if (q <= 0) return;

      if (ln.kind === "inventory") {
        const inv = invById[ln.refId];
        if (!inv) return;
        sum += q * unitPrice(inv);
      } else if (ln.kind === "prep") {
        // nested prep usage -> expand by yield
        const map = expandPrepToInventory(st, ln.refId, q);
        for (const [iid, qtyInv] of Object.entries(map)) {
          const inv = invById[iid];
          if (!inv) continue;
          sum += toNumber(qtyInv) * unitPrice(inv);
        }
      }
    });
    return sum;
  }

  function drawList() {
    p_tbody.innerHTML = "";
    (st.preps || []).forEach((p) => {
      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { html: escapeHtml(p.name) }),
        el("td", { html: escapeHtml(`${p.topCat || ""} / ${p.subCat || ""}`) }),
        el("td", { class: "right" }, [`${toNumber(p.yieldQty)} ${escapeHtml(p.yieldUnit || "")}`])
      ]);
      tr.onclick = () => openEditor(p.id);
      p_tbody.appendChild(tr);
    });
  }

  function openEditor(id) {
    const p = (st.preps || []).find((x) => x.id === id);
    if (!p) {
      editor.innerHTML =
        `<div class="title">Prep bearbeiten</div><div class="small">Noch kein Prep ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div", { class: "title" }, [`Prep: ${escapeHtml(p.name)}`]));
    editor.appendChild(el("div", { class: "sub" }, ["Zutaten können Inventur-Artikel oder andere Preps sein."]));

    const name = el("input", { class: "input", value: p.name || "" });
    const topCat = el("input", { class: "input", value: p.topCat || "" });
    const subCat = el("input", { class: "input", value: p.subCat || "" });
    const yieldQty = el("input", { class: "input", inputmode: "decimal", value: String(p.yieldQty ?? "") });
    const yieldUnit = el("select", { class: "input" }, [
      el("option", { value: "g" }, ["g"]),
      el("option", { value: "ml" }, ["ml"]),
      el("option", { value: "stk" }, ["stk"])
    ]);
    yieldUnit.value = p.yieldUnit || "g";

    const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
    const summary = el("div", { class: "sub", style: "margin-top:6px" }, [""]);
    const linesWrap = el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" });

    // Add line UI
    const kindSel = el("select", { class: "input" }, [
      el("option", { value: "inventory" }, ["Inventur-Artikel"]),
      el("option", { value: "prep" }, ["Prep"])
    ]);
    const refSel = el("select", { class: "input" }, []);
    const qty = el("input", { class: "input", inputmode: "decimal", placeholder: "Menge (in Einheit des Ziel-Objekts)" });

    function refillRefSel() {
      refSel.innerHTML = "";
      if (kindSel.value === "inventory") {
        (st.inventory || []).forEach((i) => {
          refSel.appendChild(el("option", { value: i.id }, [`${i.name} (${i.unitType})`]));
        });
      } else {
        (st.preps || []).filter(x=>x.id!==p.id).forEach((pp) => {
          refSel.appendChild(el("option", { value: pp.id }, [`${pp.name} (yield ${toNumber(pp.yieldQty)} ${pp.yieldUnit})`]));
        });
      }
    }
    kindSel.addEventListener("change", refillRefSel);
    refillRefSel();

    function drawLines() {
      const cost = prepCost(st, p);
      const yq = Math.max(0, toNumber(p.yieldQty));
      const costPerUnit = yq > 0 ? cost / yq : 0;
      summary.innerHTML = `
        Yield: <b>${toNumber(p.yieldQty)} ${escapeHtml(p.yieldUnit || "")}</b> ·
        Kosten gesamt: <b>${fmtEUR(cost)}</b> ·
        Kosten pro Einheit: <b>${costPerUnit.toFixed(4)} €/${escapeHtml(p.yieldUnit || "")}</b>
      `;

      const tbody = el("tbody", {}, (p.lines || []).map((l) => {
        const qtyInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", value: String(l.qty ?? "") });
        const btnSaveQty = el("button", { class: "btn", style: "padding:7px 10px" }, ["Speichern"]);
        const btnDel = el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);

        btnSaveQty.onclick = () => {
          l.qty = (qtyInput.value || "").trim();
          saveState(st);
          drawLines();
        };
        btnDel.onclick = () => {
          p.lines = (p.lines || []).filter((x) => x.id !== l.id);
          saveState(st);
          drawLines();
        };

        let label = "—";
        if (l.kind === "inventory") {
          const inv = (st.inventory || []).find((x) => x.id === l.refId);
          label = inv ? `${inv.name} (${inv.unitType})` : "— (fehlender Artikel)";
        } else {
          const pp = (st.preps || []).find((x) => x.id === l.refId);
          label = pp ? `${pp.name} (prep)` : "— (fehlender Prep)";
        }

        return el("tr", {}, [
          el("td", { html: escapeHtml(l.kind) }),
          el("td", { html: escapeHtml(label) }),
          el("td", { class: "right" }, [qtyInput]),
          el("td", { class: "right" }, [
            el("div", { class: "row", style: "justify-content:flex-end" }, [btnSaveQty, btnDel])
          ])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Typ"]),
            el("th", {}, ["Zutat"]),
            el("th", { class: "right" }, ["Menge"]),
            el("th", { class: "right" }, ["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    const btnSavePrep = el("button", { class: "btn primary" }, ["Prep speichern"]);
    const btnDelPrep = el("button", { class: "btn danger" }, ["Prep löschen"]);
    const btnAddLine = el("button", { class: "btn primary" }, ["Zutat hinzufügen"]);

    btnSavePrep.onclick = () => {
      p.name = name.value.trim();
      p.topCat = topCat.value.trim();
      p.subCat = subCat.value.trim();
      p.yieldQty = yieldQty.value.trim();
      p.yieldUnit = yieldUnit.value;

      if (!p.name) { msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      if (toNumber(p.yieldQty) <= 0) { msg.innerHTML = `<span class="bad">Yield muss > 0 sein.</span>`; return; }

      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      drawLines();
    };

    btnDelPrep.onclick = () => {
      if (!confirm("Prep wirklich löschen? (Rezepte/Preps verlieren Zuordnung)")) return;

      const pid = p.id;
      st.preps = (st.preps || []).filter((x) => x.id !== pid);

      // remove from other preps/recipes
      (st.preps || []).forEach((pp) => {
        pp.lines = (pp.lines || []).filter((l) => !(l.kind === "prep" && l.refId === pid));
      });
      (st.recipes || []).forEach((r) => {
        r.lines = (r.lines || []).filter((l) => !(l.kind === "prep" && l.refId === pid));
      });

      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = () => {
      const kind = kindSel.value;
      const refId = refSel.value;
      const q = (qty.value || "").trim();

      if (!kind || !refId) { alert("Bitte Typ und Zutat wählen."); return; }
      if (!q) { alert("Bitte Menge eingeben."); return; }

      p.lines = p.lines || [];
      p.lines.push({ id: uuid(), kind, refId, qty: q });
      qty.value = "";
      saveState(st);
      drawLines();
    };

    editor.appendChild(el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Name"]), name]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Top-Kategorie"]), topCat]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Unterkategorie"]), subCat]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Yield Menge"]), yieldQty]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Yield Einheit"]), yieldUnit]),
      el("div", { class: "col-12" }, [summary]),
      el("div", { class: "col-12" }, [el("div", { class: "row" }, [btnSavePrep, btnDelPrep])]),
      el("div", { class: "col-12" }, [msg]),
      el("div", { class: "col-12" }, [el("div", { class: "hr" })]),
      el("div", { class: "col-12" }, [
        el("div", { class: "title", style: "font-size:15px" }, ["Zutaten"]),
        el("div", { class: "two", style: "margin-top:8px" }, [
          el("div", {}, [el("div", { class: "label" }, ["Typ"]), kindSel]),
          el("div", {}, [el("div", { class: "label" }, ["Zutat"]), refSel])
        ]),
        el("div", { class: "label" }, ["Menge"]),
        qty,
        el("div", { class: "row", style: "margin-top:10px" }, [btnAddLine]),
        el("div", { class: "hr" }),
        linesWrap
      ])
    ]));

    drawLines();
  }

  btnAddPrep.onclick = () => {
    p_msg.textContent = "";

    const p = {
      id: uuid(),
      topCat: (p_top.value || "").trim(),
      subCat: (p_sub.value || "").trim(),
      name: (p_name.value || "").trim(),
      yieldQty: (p_yieldQty.value || "").trim(),
      yieldUnit: p_yieldUnit.value,
      lines: []
    };

    if (!p.name) { p_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    if (toNumber(p.yieldQty) <= 0) { p_msg.innerHTML = `<span class="bad">Yield muss > 0 sein.</span>`; return; }

    st.preps.push(p);
    saveState(st);

    p_name.value = "";
    p_yieldQty.value = "";
    p_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- Recipes (Admin) ----------------------- */
function renderRecipes(st) {
  if (!canEditMasterData()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"]),
      el("div", { class: "sub" }, ["Nur Admin darf Rezepte anlegen/ändern."])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  const r_top = el("input", { class: "input", placeholder: "Speisen / Getränke" });
  const r_sub = el("input", { class: "input", placeholder: "z.B. Currywurst / Cocktails" });
  const r_name = el("input", { class: "input", placeholder: "z.B. Currywurst Dippers mit Pommes" });
  const r_price = el("input", { class: "input", inputmode: "decimal", placeholder: "z.B. 9,90" });
  const r_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddRecipe = el("button", { class: "btn primary" }, ["Gericht speichern"]);

  const r_tbody = el("tbody", {});
  const editor = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Rezept bearbeiten"]),
    el("div", { class: "small" }, ["Noch kein Rezept ausgewählt."])
  ]);

  const form = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Rezept – Gericht anlegen"]),
    el("div", { class: "label" }, ["Top-Kategorie"]), r_top,
    el("div", { class: "label" }, ["Unterkategorie"]), r_sub,
    el("div", { class: "label" }, ["Gerichtname"]), r_name,
    el("div", { class: "label" }, ["Menüpreis (€)"]), r_price,
    el("div", { class: "row", style: "margin-top:12px" }, [btnAddRecipe]),
    r_msg
  ]);

  const listCard = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Rezepte – Liste (Klick zum Bearbeiten)"]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Gericht"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class: "right" }, ["Preis"]),
            el("th", { class: "right" }, ["Wareneinsatz"]),
            el("th", { class: "right" }, ["DB"])
          ])
        ]),
        r_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function drawList() {
    r_tbody.innerHTML = "";
    (st.recipes || []).forEach((r) => {
      const calc = recipeDB(st, r, null);
      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { html: escapeHtml(r.name) }),
        el("td", { html: escapeHtml(`${r.topCat || ""} / ${r.subCat || ""}`) }),
        el("td", { class: "right" }, [fmtEUR(calc.price)]),
        el("td", { class: "right" }, [fmtEUR(calc.cost)]),
        el("td", { class: `right ${calc.db >= 0 ? "ok" : "bad"}` }, [fmtEUR(calc.db)])
      ]);
      tr.onclick = () => openEditor(r.id);
      r_tbody.appendChild(tr);
    });
  }

  function openEditor(id) {
    const r = (st.recipes || []).find((x) => x.id === id);
    if (!r) {
      editor.innerHTML =
        `<div class="title">Rezept bearbeiten</div><div class="small">Noch kein Rezept ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div", { class: "title" }, [`Rezept: ${escapeHtml(r.name)}`]));
    editor.appendChild(el("div", { class: "sub" }, ["Zutaten können Inventur oder Preps sein."]));

    const name = el("input", { class: "input", value: r.name || "" });
    const topCat = el("input", { class: "input", value: r.topCat || "" });
    const subCat = el("input", { class: "input", value: r.subCat || "" });
    const price = el("input", { class: "input", inputmode: "decimal", value: String(r.menuPrice ?? "") });
    const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);

    // add line UI
    const kindSel = el("select", { class: "input" }, [
      el("option", { value: "inventory" }, ["Inventur-Artikel"]),
      el("option", { value: "prep" }, ["Prep"])
    ]);
    const refSel = el("select", { class: "input" }, []);
    const qty = el("input", { class: "input", inputmode: "decimal", placeholder: "Menge (in g/ml/stk)" });

    function refillRefSel() {
      refSel.innerHTML = "";
      if (kindSel.value === "inventory") {
        (st.inventory || []).forEach((i) => {
          refSel.appendChild(el("option", { value: i.id }, [`${i.name} (${i.unitType})`]));
        });
      } else {
        (st.preps || []).forEach((p) => {
          refSel.appendChild(el("option", { value: p.id }, [`${p.name} (yield ${toNumber(p.yieldQty)} ${p.yieldUnit})`]));
        });
      }
    }
    kindSel.addEventListener("change", refillRefSel);
    refillRefSel();

    const summary = el("div", { class: "sub", style: "margin-top:6px" }, [""]);
    const linesWrap = el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" });

    function drawLines() {
      const calc = recipeDB(st, r, null);
      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        Fees: <b>${fmtEUR(calc.fees)}</b> ·
        DB: <b class="${calc.db >= 0 ? "ok" : "bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct >= 0 ? "ok" : "bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;

      const tbody = el("tbody", {}, (r.lines || []).map((l) => {
        const qtyInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", value: String(l.qty ?? "") });
        const btnSaveQty = el("button", { class: "btn", style: "padding:7px 10px" }, ["Speichern"]);
        const btnDel = el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);

        btnSaveQty.onclick = () => {
          l.qty = (qtyInput.value || "").trim();
          saveState(st);
          drawLines();
          drawList();
        };
        btnDel.onclick = () => {
          r.lines = (r.lines || []).filter((x) => x.id !== l.id);
          saveState(st);
          drawLines();
          drawList();
        };

        let label = "—";
        let unitInfo = "";
        if (l.kind === "inventory") {
          const inv = (st.inventory || []).find((x) => x.id === l.refId);
          label = inv ? inv.name : "— (fehlender Artikel)";
          unitInfo = inv ? inv.unitType : "";
        } else {
          const p = (st.preps || []).find((x) => x.id === l.refId);
          label = p ? p.name : "— (fehlender Prep)";
          unitInfo = p ? `yield ${toNumber(p.yieldQty)} ${p.yieldUnit}` : "";
        }

        return el("tr", {}, [
          el("td", { html: escapeHtml(l.kind) }),
          el("td", { html: escapeHtml(label) }),
          el("td", { html: escapeHtml(unitInfo) }),
          el("td", { class: "right" }, [qtyInput]),
          el("td", { class: "right" }, [
            el("div", { class: "row", style: "justify-content:flex-end" }, [btnSaveQty, btnDel])
          ])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Typ"]),
            el("th", {}, ["Zutat"]),
            el("th", {}, ["Info"]),
            el("th", { class: "right" }, ["Menge"]),
            el("th", { class: "right" }, ["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    const btnSaveRecipe = el("button", { class: "btn primary" }, ["Rezept speichern"]);
    const btnDelRecipe = el("button", { class: "btn danger" }, ["Rezept löschen"]);
    const btnAddLine = el("button", { class: "btn primary" }, ["Zutat hinzufügen"]);

    btnSaveRecipe.onclick = () => {
      r.name = name.value.trim();
      r.topCat = topCat.value.trim();
      r.subCat = subCat.value.trim();
      r.menuPrice = price.value.trim();

      if (!r.name) { msg.innerHTML = `<span class="bad">Gerichtname fehlt.</span>`; return; }

      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      drawLines();
    };

    btnDelRecipe.onclick = () => {
      if (!confirm("Rezept wirklich löschen?")) return;

      const rid = r.id;
      st.recipes = (st.recipes || []).filter((x) => x.id !== rid);
      // remove from bundles
      (st.bundles || []).forEach((b) => {
        b.items = (b.items || []).filter((it) => it.recipeId !== rid);
      });
      // remove sales referencing recipe
      st.sales = (st.sales || []).filter((s) => !(s.kind === "recipe" && s.refId === rid));

      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = () => {
      if (kindSel.value === "inventory" && !(st.inventory || []).length) {
        alert("Inventur ist leer. Erst Inventur-Artikel anlegen.");
        return;
      }
      if (kindSel.value === "prep" && !(st.preps || []).length) {
        alert("Keine Preps vorhanden. Erst Preps anlegen.");
        return;
      }

      const kind = kindSel.value;
      const refId = refSel.value;
      const q = (qty.value || "").trim();

      if (!kind || !refId) { alert("Bitte Typ und Zutat wählen."); return; }
      if (!q) { alert("Bitte Menge eingeben."); return; }

      r.lines = r.lines || [];
      r.lines.push({ id: uuid(), kind, refId, qty: q });
      qty.value = "";
      saveState(st);
      drawLines();
      drawList();
    };

    editor.appendChild(el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Gerichtname"]), name]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Top-Kategorie"]), topCat]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Unterkategorie"]), subCat]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Menüpreis (€)"]), price]),
      el("div", { class: "col-12" }, [summary]),
      el("div", { class: "col-12" }, [el("div", { class: "row" }, [btnSaveRecipe, btnDelRecipe])]),
      el("div", { class: "col-12" }, [msg]),
      el("div", { class: "col-12" }, [el("div", { class: "hr" })]),
      el("div", { class: "col-12" }, [
        el("div", { class: "title", style: "font-size:15px" }, ["Zutaten"]),
        el("div", { class: "two", style: "margin-top:8px" }, [
          el("div", {}, [el("div", { class: "label" }, ["Typ"]), kindSel]),
          el("div", {}, [el("div", { class: "label" }, ["Zutat"]), refSel])
        ]),
        el("div", { class: "label" }, ["Menge"]),
        qty,
        el("div", { class: "row", style: "margin-top:10px" }, [btnAddLine]),
        el("div", { class: "hr" }),
        linesWrap
      ])
    ]));

    drawLines();
  }

  btnAddRecipe.onclick = () => {
    r_msg.textContent = "";

    const r = {
      id: uuid(),
      topCat: (r_top.value || "").trim(),
      subCat: (r_sub.value || "").trim(),
      name: (r_name.value || "").trim(),
      menuPrice: (r_price.value || "").trim(),
      lines: []
    };

    if (!r.name) { r_msg.innerHTML = `<span class="bad">Gerichtname fehlt.</span>`; return; }

    st.recipes.push(r);
    saveState(st);

    r_name.value = "";
    r_price.value = "";
    r_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- Bundles (Admin) ----------------------- */
function renderBundles(st) {
  if (!canEditMasterData()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"]),
      el("div", { class: "sub" }, ["Nur Admin darf Bundles anlegen/ändern."])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  const b_top = el("input", { class: "input", placeholder: "z.B. Speisen" });
  const b_sub = el("input", { class: "input", placeholder: "z.B. Menüs" });
  const b_name = el("input", { class: "input", placeholder: "z.B. Currywurst Menü" });
  const b_price = el("input", { class: "input", inputmode: "decimal", placeholder: "z.B. 12,90" });
  const b_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddBundle = el("button", { class: "btn primary" }, ["Bundle speichern"]);

  const b_tbody = el("tbody", {});
  const editor = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Bundle bearbeiten"]),
    el("div", { class: "small" }, ["Noch kein Bundle ausgewählt."])
  ]);

  const form = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Bundle – anlegen (Menü)"]),
    el("div", { class: "sub" }, ["Bundle besteht aus Rezepten (Gerichten)."]),
    el("div", { class: "label" }, ["Top-Kategorie"]), b_top,
    el("div", { class: "label" }, ["Unterkategorie"]), b_sub,
    el("div", { class: "label" }, ["Bundle Name"]), b_name,
    el("div", { class: "label" }, ["Bundle Preis (€)"]), b_price,
    el("div", { class: "row", style: "margin-top:12px" }, [btnAddBundle]),
    b_msg
  ]);

  const listCard = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Bundles – Liste (Klick zum Bearbeiten)"]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Bundle"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class: "right" }, ["Preis"]),
            el("th", { class: "right" }, ["Wareneinsatz"]),
            el("th", { class: "right" }, ["DB"])
          ])
        ]),
        b_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function drawList() {
    b_tbody.innerHTML = "";
    (st.bundles || []).forEach((b) => {
      const calc = bundleDB(st, b, null);
      const tr = el("tr", { style: "cursor:pointer" }, [
        el("td", { html: escapeHtml(b.name) }),
        el("td", { html: escapeHtml(`${b.topCat || ""} / ${b.subCat || ""}`) }),
        el("td", { class: "right" }, [fmtEUR(calc.price)]),
        el("td", { class: "right" }, [fmtEUR(calc.cost)]),
        el("td", { class: `right ${calc.db >= 0 ? "ok" : "bad"}` }, [fmtEUR(calc.db)])
      ]);
      tr.onclick = () => openEditor(b.id);
      b_tbody.appendChild(tr);
    });
  }

  function openEditor(id) {
    const b = (st.bundles || []).find((x) => x.id === id);
    if (!b) {
      editor.innerHTML =
        `<div class="title">Bundle bearbeiten</div><div class="small">Noch kein Bundle ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div", { class: "title" }, [`Bundle: ${escapeHtml(b.name)}`]));
    editor.appendChild(el("div", { class: "sub" }, ["Items sind Rezepte + Menge (z.B. 1x Currywurst + 1x Pommes)."]));

    const name = el("input", { class: "input", value: b.name || "" });
    const topCat = el("input", { class: "input", value: b.topCat || "" });
    const subCat = el("input", { class: "input", value: b.subCat || "" });
    const price = el("input", { class: "input", inputmode: "decimal", value: String(b.menuPrice ?? "") });
    const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);

    const selRecipe = el("select", { class: "input" }, (st.recipes || []).map((r) => el("option", { value: r.id }, [r.name])));
    const qty = el("input", { class: "input", inputmode: "decimal", placeholder: "Anzahl (z.B. 1)" });

    const summary = el("div", { class: "sub", style: "margin-top:6px" }, [""]);
    const itemsWrap = el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" });

    function drawItems() {
      const calc = bundleDB(st, b, null);
      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        Fees: <b>${fmtEUR(calc.fees)}</b> ·
        DB: <b class="${calc.db >= 0 ? "ok" : "bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct >= 0 ? "ok" : "bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;

      const tbody = el("tbody", {}, (b.items || []).map((it) => {
        const r = (st.recipes || []).find((x) => x.id === it.recipeId);
        const qtyInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", value: String(it.qty ?? "") });

        const btnSaveQty = el("button", { class: "btn", style: "padding:7px 10px" }, ["Speichern"]);
        const btnDel = el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);

        btnSaveQty.onclick = () => {
          it.qty = (qtyInput.value || "").trim();
          saveState(st);
          drawItems();
          drawList();
        };
        btnDel.onclick = () => {
          b.items = (b.items || []).filter((x) => x.id !== it.id);
          saveState(st);
          drawItems();
          drawList();
        };

        return el("tr", {}, [
          el("td", { html: escapeHtml(r ? r.name : "— (fehlendes Rezept)") }),
          el("td", { class: "right" }, [qtyInput]),
          el("td", { class: "right" }, [
            el("div", { class: "row", style: "justify-content:flex-end" }, [btnSaveQty, btnDel])
          ])
        ]);
      }));

      itemsWrap.innerHTML = "";
      itemsWrap.appendChild(el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Rezept"]),
            el("th", { class: "right" }, ["Qty"]),
            el("th", { class: "right" }, ["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    const btnSaveBundle = el("button", { class: "btn primary" }, ["Bundle speichern"]);
    const btnDelBundle = el("button", { class: "btn danger" }, ["Bundle löschen"]);
    const btnAddItem = el("button", { class: "btn primary" }, ["Item hinzufügen"]);

    btnSaveBundle.onclick = () => {
      b.name = name.value.trim();
      b.topCat = topCat.value.trim();
      b.subCat = subCat.value.trim();
      b.menuPrice = price.value.trim();
      if (!b.name) { msg.innerHTML = `<span class="bad">Bundle Name fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      drawItems();
    };

    btnDelBundle.onclick = () => {
      if (!confirm("Bundle wirklich löschen?")) return;

      const bid = b.id;
      st.bundles = (st.bundles || []).filter((x) => x.id !== bid);
      st.sales = (st.sales || []).filter((s) => !(s.kind === "bundle" && s.refId === bid));
      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddItem.onclick = () => {
      if (!(st.recipes || []).length) {
        alert("Keine Rezepte vorhanden. Erst Rezepte anlegen.");
        return;
      }
      const rid = selRecipe.value;
      const q = (qty.value || "").trim();
      if (!rid) { alert("Bitte Rezept wählen."); return; }
      if (!q) { alert("Bitte Qty eingeben."); return; }

      b.items = b.items || [];
      b.items.push({ id: uuid(), recipeId: rid, qty: q });
      qty.value = "";
      saveState(st);
      drawItems();
      drawList();
    };

    editor.appendChild(el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Bundle Name"]), name]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Top-Kategorie"]), topCat]),
      el("div", { class: "col-3" }, [el("div", { class: "label" }, ["Unterkategorie"]), subCat]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Bundle Preis (€)"]), price]),
      el("div", { class: "col-12" }, [summary]),
      el("div", { class: "col-12" }, [el("div", { class: "row" }, [btnSaveBundle, btnDelBundle])]),
      el("div", { class: "col-12" }, [msg]),
      el("div", { class: "col-12" }, [el("div", { class: "hr" })]),
      el("div", { class: "col-12" }, [
        el("div", { class: "title", style: "font-size:15px" }, ["Items"]),
        el("div", { class: "two", style: "margin-top:8px" }, [
          el("div", {}, [el("div", { class: "label" }, ["Rezept"]), selRecipe]),
          el("div", {}, [el("div", { class: "label" }, ["Qty"]), qty])
        ]),
        el("div", { class: "row", style: "margin-top:10px" }, [btnAddItem]),
        el("div", { class: "hr" }),
        itemsWrap
      ])
    ]));

    drawItems();
  }

  btnAddBundle.onclick = () => {
    b_msg.textContent = "";

    const b = {
      id: uuid(),
      topCat: (b_top.value || "").trim(),
      subCat: (b_sub.value || "").trim(),
      name: (b_name.value || "").trim(),
      menuPrice: (b_price.value || "").trim(),
      items: []
    };

    if (!b.name) { b_msg.innerHTML = `<span class="bad">Bundle Name fehlt.</span>`; return; }

    st.bundles.push(b);
    saveState(st);

    b_name.value = "";
    b_price.value = "";
    b_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- Sales (Outlet) ----------------------- */
function renderSales(st) {
  const wrap = el("div", { class: "grid" });

  // outlet selection: admin can select outlet for entering sales; users fixed
  const outletIdDefault = getOutletId() || (st.outlets?.[0]?.id || null);

  const outletSel = el("select", { class: "input" }, (st.outlets || []).map((o) => el("option", { value: o.id }, [o.name])));
  outletSel.value = outletIdDefault || (st.outlets?.[0]?.id || "");
  outletSel.disabled = !isAdmin();

  const today = todayISO();
  const s_date = el("input", { class: "input", value: today });

  const kindSel = el("select", { class: "input" }, [
    el("option", { value: "recipe" }, ["Rezept (Gericht)"]),
    el("option", { value: "bundle" }, ["Bundle (Menü)"])
  ]);

  const itemSel = el("select", { class: "input" }, []);
  const s_qty = el("input", { class: "input", inputmode: "decimal", placeholder: "Anzahl verkauft (z.B. 20)" });
  const s_priceOverride = el("input", { class: "input", inputmode: "decimal", placeholder: "optional: VK Preis überschreiben" });

  const s_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddSale = el("button", { class: "btn primary" }, ["Speichern"]);
  const s_tbody = el("tbody", {});
  const s_summary = el("div", { class: "sub" }, [""]);

  function refillItemSel() {
    itemSel.innerHTML = "";
    if (kindSel.value === "recipe") {
      (st.recipes || []).forEach((r) => itemSel.appendChild(el("option", { value: r.id }, [r.name])));
    } else {
      (st.bundles || []).forEach((b) => itemSel.appendChild(el("option", { value: b.id }, [b.name])));
    }
  }
  kindSel.addEventListener("change", refillItemSel);
  refillItemSel();

  const card = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Daily Sales – Eingabe"]),
    el("div", { class: "sub" }, ["Sales sind pro Outlet. Admin kann Outlet wählen, User nicht."]),
    el("div", { class: "label" }, ["Outlet"]), outletSel,
    el("div", { class: "label" }, ["Datum"]), s_date,
    el("div", { class: "label" }, ["Typ"]), kindSel,
    el("div", { class: "label" }, ["Produkt"]), itemSel,
    el("div", { class: "label" }, ["Anzahl verkauft"]), s_qty,
    el("div", { class: "label" }, ["VK Preis Override (optional)"]), s_priceOverride,
    el("div", { class: "row", style: "margin-top:12px" }, [btnAddSale]),
    s_msg
  ]);

  const list = el("div", { class: "card col-12 col-6" }, [
    el("div", { class: "title" }, ["Einträge"]),
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Typ"]),
            el("th", {}, ["Produkt"]),
            el("th", { class: "right" }, ["Qty"]),
            el("th", { class: "right" }, ["DB gesamt"]),
            el("th", { class: "right" }, ["Aktion"])
          ])
        ]),
        s_tbody
      ])
    ])
  ]);

  const summaryCard = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Tagesauswertung"]),
    el("div", { class: "hr" }),
    s_summary
  ]);

  wrap.appendChild(card);
  wrap.appendChild(list);
  wrap.appendChild(summaryCard);

  function draw() {
    s_tbody.innerHTML = "";
    const date = (s_date.value || today).trim();
    const outletId = outletSel.value;

    if (!outletId) {
      s_summary.textContent = "Kein Outlet.";
      return;
    }
    if (!canUseOutlet(st, outletId)) {
      s_summary.textContent = "Kein Zugriff auf dieses Outlet.";
      return;
    }

    const entries = (st.sales || []).filter((x) => x.date === date && x.outletId === outletId);

    let dbSum = 0;
    entries.forEach((e) => {
      const qty = toNumber(e.qty);

      let name = "—";
      let lineDb = 0;

      if (e.kind === "recipe") {
        const r = (st.recipes || []).find((x) => x.id === e.refId);
        name = r ? r.name : "— (fehlendes Rezept)";
        const calc = r ? recipeDB(st, r, e.priceOverride ?? null) : { db: 0 };
        lineDb = (calc.db || 0) * qty;
      } else {
        const b = (st.bundles || []).find((x) => x.id === e.refId);
        name = b ? b.name : "— (fehlendes Bundle)";
        const calc = b ? bundleDB(st, b, e.priceOverride ?? null) : { db: 0 };
        lineDb = (calc.db || 0) * qty;
      }

      dbSum += lineDb;

      const btnDel = el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);
      btnDel.onclick = () => {
        st.sales = (st.sales || []).filter((x) => x.id !== e.id);
        saveState(st);
        draw();
      };

      s_tbody.appendChild(el("tr", {}, [
        el("td", { html: escapeHtml(e.kind) }),
        el("td", { html: escapeHtml(name) }),
        el("td", { class: "right" }, [String(qty)]),
        el("td", { class: `right ${lineDb >= 0 ? "ok" : "bad"}` }, [fmtEUR(lineDb)]),
        el("td", { class: "right" }, [btnDel])
      ]));
    });

    s_summary.innerHTML = `Tages-DB: <b class="${dbSum >= 0 ? "ok" : "bad"}">${fmtEUR(dbSum)}</b>`;
  }

  btnAddSale.onclick = () => {
    s_msg.textContent = "";

    const date = (s_date.value || today).trim();
    const outletId = outletSel.value;

    if (!outletId) { s_msg.innerHTML = `<span class="bad">Outlet fehlt.</span>`; return; }
    if (!canUseOutlet(st, outletId)) { s_msg.innerHTML = `<span class="bad">Kein Zugriff auf Outlet.</span>`; return; }

    const kind = kindSel.value;
    const refId = itemSel.value;
    const qty = (s_qty.value || "").trim();
    const priceOverride = (s_priceOverride.value || "").trim();

    if (!kind || !refId) { s_msg.innerHTML = `<span class="bad">Produkt fehlt.</span>`; return; }
    if (!qty) { s_msg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }

    st.sales.push({
      id: uuid(),
      date,
      outletId,
      kind,
      refId,
      qty,
      priceOverride: priceOverride === "" ? null : priceOverride
    });

    saveState(st);
    s_qty.value = "";
    s_priceOverride.value = "";
    s_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  s_date.addEventListener("change", draw);
  outletSel.addEventListener("change", draw);
  draw();

  return wrap;
}

/* ----------------------- Stock (Outlet) ----------------------- */
function renderStock(st) {
  const wrap = el("div", { class: "grid" });

  // outlet selection: admin can select outlet; users fixed
  const outletIdDefault = getOutletId() || (st.outlets?.[0]?.id || null);

  const outletSel = el("select", { class: "input" }, (st.outlets || []).map((o) => el("option", { value: o.id }, [o.name])));
  outletSel.value = outletIdDefault || (st.outlets?.[0]?.id || "");
  outletSel.disabled = !isAdmin();

  const date = el("input", { class: "input", value: todayISO() });
  const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);

  const btnAuto = el("button", { class: "btn primary" }, ["AUTO Verbrauch aus Sales buchen"]);
  const btnClearAutoDay = el("button", { class: "btn danger" }, ["AUTO für Tag löschen"]);

  const tableBody = el("tbody", {});

  btnAuto.onclick = () => {
    const outletId = outletSel.value;
    if (!outletId) { alert("Outlet fehlt."); return; }
    if (!canUseOutlet(st, outletId)) { alert("Kein Zugriff auf Outlet."); return; }

    const d = (date.value || todayISO()).trim();
    const cons = consumptionFromSales(st, d, outletId);

    let n = 0;
    for (const [invId, qty] of Object.entries(cons)) {
      if (qty <= 0) continue;
      addStockMove(st, {
        date: d,
        outletId,
        inventoryId: invId,
        delta: -qty,
        kind: "AUTO",
        note: "Auto aus Sales"
      });
      n++;
    }
    saveState(st);
    msg.innerHTML = `<span class="ok">AUTO-Verbrauch gebucht (${n} Artikel).</span>`;
    draw();
  };

  btnClearAutoDay.onclick = () => {
    const outletId = outletSel.value;
    if (!outletId) return;
    if (!canUseOutlet(st, outletId)) return;

    const d = (date.value || todayISO()).trim();
    const before = (st.stockMovements || []).length;
    st.stockMovements = (st.stockMovements || []).filter((m) => !(m.outletId === outletId && m.date === d && m.kind === "AUTO"));
    const after = st.stockMovements.length;

    saveState(st);
    msg.innerHTML = `<span class="ok">AUTO gelöscht (${before - after} Buchungen).</span>`;
    draw();
  };

  const card = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Bestände (pro Outlet)"]),
    el("div", { class: "sub" }, ["Du kannst Wareneingang (+), Verbrauch (-), Zählbestand (SET) buchen. AUTO zieht Verbrauch aus Sales."]),
    el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Outlet"]), outletSel]),
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Datum"]), date]),
      el("div", { class: "col-4" }, [
        el("div", { class: "label" }, ["Aktion"]),
        el("div", { class: "row" }, [btnAuto, btnClearAutoDay])
      ])
    ]),
    msg,
    el("div", { class: "hr" }),
    el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Artikel"]),
            el("th", {}, ["Einheit"]),
            el("th", { class: "right" }, ["Aktueller Bestand"]),
            el("th", { class: "right" }, ["Wareneingang (+)"]),
            el("th", { class: "right" }, ["Verbrauch (-)"]),
            el("th", { class: "right" }, ["Zählbestand (SET)"]),
            el("th", { class: "right" }, ["Buchen"])
          ])
        ]),
        tableBody
      ])
    ])
  ]);

  wrap.appendChild(card);

  function draw() {
    tableBody.innerHTML = "";
    const outletId = outletSel.value;
    if (!outletId) return;
    if (!canUseOutlet(st, outletId)) {
      tableBody.appendChild(el("tr", {}, [
        el("td", { html: `<span class="bad">Kein Zugriff auf Outlet</span>`, colspan: "7" })
      ]));
      return;
    }

    const d = (date.value || todayISO()).trim();

    (st.inventory || []).forEach((inv) => {
      const cur = stockFor(st, outletId, inv.id);

      const inInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", placeholder: "0" });
      const outInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", placeholder: "0" });
      const setInput = el("input", { class: "input", style: "max-width:140px", inputmode: "decimal", placeholder: "" });

      const btnApply = el("button", { class: "btn primary", style: "padding:7px 10px" }, ["Buchen"]);

      btnApply.onclick = () => {
        const addIn = toNumber(inInput.value);
        const addOut = toNumber(outInput.value);
        const setVal = setInput.value.trim() === "" ? null : toNumber(setInput.value);

        let booked = 0;

        if (addIn !== 0) {
          addStockMove(st, { date: d, outletId, inventoryId: inv.id, delta: +addIn, kind: "IN", note: "Wareneingang" });
          booked++;
        }
        if (addOut !== 0) {
          addStockMove(st, { date: d, outletId, inventoryId: inv.id, delta: -Math.abs(addOut), kind: "OUT", note: "Manueller Verbrauch" });
          booked++;
        }
        if (setVal !== null) {
          const newCur = stockFor(st, outletId, inv.id);
          const delta = setVal - newCur;
          addStockMove(st, { date: d, outletId, inventoryId: inv.id, delta: delta, kind: "SET", note: "Zählbestand" });
          booked++;
        }

        if (booked > 0) {
          saveState(st);
          draw();
        }
      };

      tableBody.appendChild(el("tr", {}, [
        el("td", { html: escapeHtml(inv.name) }),
        el("td", { html: escapeHtml(inv.unitType) }),
        el("td", { class: "right" }, [String(cur)]),
        el("td", { class: "right" }, [inInput]),
        el("td", { class: "right" }, [outInput]),
        el("td", { class: "right" }, [setInput]),
        el("td", { class: "right" }, [btnApply])
      ]));
    });
  }

  outletSel.addEventListener("change", draw);
  date.addEventListener("change", draw);
  draw();

  return wrap;
}

/* ----------------------- Params (Admin) ----------------------- */
function renderParams(st) {
  if (!canEditMasterData()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"]),
      el("div", { class: "sub" }, ["Nur Admin darf Parameter ändern."])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  const p_fr = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.franchisePct ?? 0) });
  const p_vat = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.vatPct ?? 7) });

  const p_fixedDaily = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.fixedDailyCosts ?? 0) });
  const p_fixedMonthly = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.fixedMonthlyCosts ?? 0) });
  const p_investMonthly = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.investmentMonthly ?? 0) });

  const p_paymentPct = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.paymentFeesPct ?? 0) });
  const p_otherPct = el("input", { class: "input", inputmode: "decimal", value: String(st.params?.otherPct ?? 0) });

  const p_note = el("textarea", { class: "input", rows: "3" }, []);
  p_note.value = String(st.params?.note ?? "");

  const p_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnSave = el("button", { class: "btn primary" }, ["Speichern"]);

  btnSave.onclick = () => {
    st.params = st.params || {};
    st.params.franchisePct = (p_fr.value || "0").trim();
    st.params.vatPct = (p_vat.value || "7").trim();

    st.params.fixedDailyCosts = (p_fixedDaily.value || "0").trim();
    st.params.fixedMonthlyCosts = (p_fixedMonthly.value || "0").trim();
    st.params.investmentMonthly = (p_investMonthly.value || "0").trim();

    st.params.paymentFeesPct = (p_paymentPct.value || "0").trim();
    st.params.otherPct = (p_otherPct.value || "0").trim();

    st.params.note = (p_note.value || "").trim();

    saveState(st);
    p_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
  };

  wrap.appendChild(el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Parameter (Admin)"]),
    el("div", { class: "sub" }, [
      "Franchise/Payment/Other% werden als Umsatz-Abzug in DB berechnet. Fixkosten dienen für Break-even Anzeige."
    ]),
    el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Franchise %"]), p_fr]),
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Payment Fees %"]), p_paymentPct]),
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Other % (frei)"]), p_otherPct]),

      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["MwSt % (gespeichert)"]), p_vat]),
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Fixkosten / Tag (€)"]), p_fixedDaily]),
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Fixkosten / Monat (€)"]), p_fixedMonthly]),

      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Invest / Monat (€)"]), p_investMonthly]),
      el("div", { class: "col-8" }, [el("div", { class: "label" }, ["Notiz"]), p_note]),

      el("div", { class: "col-12" }, [el("div", { class: "row" }, [btnSave]), p_msg])
    ])
  ]));

  return wrap;
}

/* ----------------------- Backup (Export/Import) ----------------------- */
function renderBackup(st) {
  const wrap = el("div", { class: "grid" });

  const info = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Backup"]),
    el("div", { class: "sub" }, [
      "Export/Import ist eine sichere Methode, falls Sync spinnt. Import ersetzt den kompletten State."
    ])
  ]);

  const ta = el("textarea", { class: "input mono", rows: "12" }, []);
  ta.value = "";

  const msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);

  const btnExport = el("button", { class: "btn primary" }, ["Export JSON"]);
  const btnImport = el("button", { class: "btn danger" }, ["Import JSON (ersetzen)"]);

  btnExport.onclick = () => {
    const current = loadState();
    ta.value = JSON.stringify(current, null, 2);
    msg.innerHTML = `<span class="ok">Export erstellt. Kopieren & sicher speichern.</span>`;
  };

  btnImport.onclick = async () => {
    const text = (ta.value || "").trim();
    if (!text) { msg.innerHTML = `<span class="bad">Kein JSON im Feld.</span>`; return; }
    if (!confirm("Import ersetzt ALLE Daten. Wirklich?")) return;

    try {
      const data = JSON.parse(text);
      const migrated = migrateState(data);
      writeLS(LS.state, migrated);
      localStorage.setItem(LS.lastSaved, nowISO());
      scheduleCloudSave();
      msg.innerHTML = `<span class="ok">Import ok. App lädt neu…</span>`;
      setTimeout(() => screenApp(), 300);
    } catch (e) {
      console.error(e);
      msg.innerHTML = `<span class="bad">JSON ungültig.</span>`;
    }
  };

  wrap.appendChild(info);
  wrap.appendChild(el("div", { class: "card col-12" }, [
    el("div", { class: "label" }, ["JSON"]),
    ta,
    el("div", { class: "row", style: "margin-top:12px" }, [btnExport, btnImport]),
    msg
  ]));

  return wrap;
}

/* ----------------------- Users/Outlets (Admin) ----------------------- */
function renderUsers(st) {
  if (!isAdmin()) {
    return el("div", { class: "card" }, [
      el("div", { class: "title" }, ["Kein Zugriff"])
    ]);
  }

  const wrap = el("div", { class: "grid" });

  // OUTLETS
  const o_id = el("input", { class: "input", placeholder: "outlet_berlin (keine Leerzeichen)" });
  const o_name = el("input", { class: "input", placeholder: "Berlin Outlet" });
  const o_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddOutlet = el("button", { class: "btn primary" }, ["Outlet speichern"]);
  const o_tbody = el("tbody", {});

  function drawOutlets() {
    o_tbody.innerHTML = "";
    (st.outlets || []).forEach((o) => {
      const btnDel = o.id === "outlet_main"
        ? el("span", { class: "small" }, ["Default"])
        : el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);

      if (o.id !== "outlet_main") {
        btnDel.onclick = () => {
          if (!confirm("Outlet löschen? (Sales/Stock bleiben aber OutletId wird orphaned)")) return;
          st.outlets = (st.outlets || []).filter((x) => x.id !== o.id);
          // remove outlet from user assignments
          (st.users || []).forEach((u) => {
            if (Array.isArray(u.outletIds) && !u.outletIds.includes("*")) {
              u.outletIds = u.outletIds.filter((id) => id !== o.id);
            }
          });
          saveState(st);
          drawOutlets();
          drawUsers();
        };
      }

      o_tbody.appendChild(el("tr", {}, [
        el("td", { html: escapeHtml(o.id) }),
        el("td", { html: escapeHtml(o.name) }),
        el("td", { class: "right" }, [btnDel])
      ]));
    });
  }

  btnAddOutlet.onclick = () => {
    o_msg.textContent = "";
    const id = (o_id.value || "").trim();
    const name = (o_name.value || "").trim();
    if (!id) { o_msg.innerHTML = `<span class="bad">Outlet ID fehlt.</span>`; return; }
    if (/\s/.test(id)) { o_msg.innerHTML = `<span class="bad">Keine Leerzeichen in Outlet ID.</span>`; return; }
    if (!name) { o_msg.innerHTML = `<span class="bad">Outlet Name fehlt.</span>`; return; }

    const exists = (st.outlets || []).some((x) => String(x.id) === id);
    if (exists) { o_msg.innerHTML = `<span class="bad">Outlet ID existiert schon.</span>`; return; }

    st.outlets.push({ id, name });
    saveState(st);

    o_id.value = "";
    o_name.value = "";
    o_msg.innerHTML = `<span class="ok">Outlet gespeichert.</span>`;
    drawOutlets();
    drawUsers();
  };

  // USERS
  const u_name = el("input", { class: "input", placeholder: "z.B. max" });
  const u_disp = el("input", { class: "input", placeholder: "z.B. Max Mustermann" });
  const u_msg = el("div", { class: "small", style: "margin-top:8px" }, [""]);
  const btnAddUser = el("button", { class: "btn primary" }, ["User speichern"]);
  const u_tbody = el("tbody", {});

  function drawUsers() {
    u_tbody.innerHTML = "";
    (st.users || []).forEach((u) => {
      const isA = String(u.username || "").toLowerCase() === "admin";

      // Outlet assignment UI
      const assignWrap = el("div", { class: "row", style: "justify-content:flex-end" }, []);

      if (isA) {
        assignWrap.appendChild(el("span", { class: "small" }, ["Admin: alle Outlets"]));
      } else {
        // multi-select via checkboxes
        const boxWrap = el("div", { style: "display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end" }, []);
        const current = new Set(u.outletIds || []);

        (st.outlets || []).forEach((o) => {
          const cb = el("input", { type: "checkbox" });
          cb.checked = current.has(o.id);

          cb.onchange = () => {
            const ids = new Set(u.outletIds || []);
            if (cb.checked) ids.add(o.id);
            else ids.delete(o.id);

            u.outletIds = Array.from(ids);
            saveState(st);
          };

          const lab = el("label", { class: "pill", style: "display:flex; align-items:center; gap:6px; cursor:pointer;" }, [
            cb, el("span", {}, [o.name])
          ]);
          boxWrap.appendChild(lab);
        });

        assignWrap.appendChild(boxWrap);
      }

      const btnDel = isA
        ? el("span", { class: "small" }, ["Admin"])
        : el("button", { class: "btn danger", style: "padding:7px 10px" }, ["Löschen"]);

      if (!isA) {
        btnDel.onclick = () => {
          if (!confirm("User löschen?")) return;
          st.users = (st.users || []).filter(
            (x) =>
              String(x.username || "").toLowerCase() !==
              String(u.username || "").toLowerCase()
          );
          saveState(st);
          drawUsers();
        };
      }

      u_tbody.appendChild(el("tr", {}, [
        el("td", { html: escapeHtml(u.username) }),
        el("td", { html: escapeHtml(u.displayName || u.username) }),
        el("td", { class: "right" }, [assignWrap]),
        el("td", { class: "right" }, [btnDel])
      ]));
    });
  }

  btnAddUser.onclick = () => {
    u_msg.textContent = "";
    const username = (u_name.value || "").trim();
    const displayName = (u_disp.value || "").trim();

    if (!username) { u_msg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if (/\s/.test(username)) { u_msg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }

    const exists = (st.users || []).some(
      (x) => String(x.username || "").toLowerCase() === username.toLowerCase()
    );
    if (exists) { u_msg.innerHTML = `<span class="bad">Username existiert schon.</span>`; return; }

    st.users.push({ username, displayName: displayName || username, outletIds: [] });
    saveState(st);

    u_name.value = "";
    u_disp.value = "";
    u_msg.innerHTML = `<span class="ok">Gespeichert. Jetzt Outlets zuweisen.</span>`;
    drawUsers();
  };

  const outletCard = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["Outlets (Admin)"]),
    el("div", { class: "sub" }, ["Outlet IDs sind technisch. Keine Leerzeichen."]),
    el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Outlet ID"]), o_id]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Outlet Name"]), o_name]),
      el("div", { class: "col-2" }, [
        el("div", { class: "label" }, ["Aktion"]),
        btnAddOutlet
      ]),
      el("div", { class: "col-12" }, [o_msg]),
      el("div", { class: "col-12" }, [
        el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", {}, ["Outlet ID"]),
                el("th", {}, ["Name"]),
                el("th", { class: "right" }, ["Aktion"])
              ])
            ]),
            o_tbody
          ])
        ])
      ])
    ])
  ]);

  const usersCard = el("div", { class: "card col-12" }, [
    el("div", { class: "title" }, ["User (Admin)"]),
    el("div", { class: "sub" }, ["User anlegen und Outlets freischalten."]),
    el("div", { class: "grid", style: "margin-top:10px" }, [
      el("div", { class: "col-4" }, [el("div", { class: "label" }, ["Username"]), u_name]),
      el("div", { class: "col-6" }, [el("div", { class: "label" }, ["Display Name"]), u_disp]),
      el("div", { class: "col-2" }, [
        el("div", { class: "label" }, ["Aktion"]),
        btnAddUser
      ]),
      el("div", { class: "col-12" }, [u_msg]),
      el("div", { class: "col-12" }, [
        el("div", { style: "overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", {}, ["Username"]),
                el("th", {}, ["Display"]),
                el("th", { class: "right" }, ["Outlets freischalten"]),
                el("th", { class: "right" }, ["Aktion"])
              ])
            ]),
            u_tbody
          ])
        ])
      ])
    ])
  ]);

  wrap.appendChild(outletCard);
  wrap.appendChild(usersCard);

  drawOutlets();
  drawUsers();

  return wrap;
}

/* ----------------------- Boot ----------------------- */
async function boot() {
  injectBaseStyles();
  applyTheme(localStorage.getItem(LS.theme) || "dark");

  if (getWorkspace()) await cloudPullOnStart();

  const s = getSession();
  if (!s) screenLogin();
  else screenApp();
}

document.addEventListener("DOMContentLoaded", boot);
