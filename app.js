/* =========================================================
   HEISSE ECKE – KALKULATION (Web App) – Single File app.js
   - Multi-Outlet + Rollen + pro Outlet Tabs zuschaltbar
   - Inventur Import (XLSX/CSV) + Merge
   - Rezepte + Preps + Menüartikel + Bundles + Modifiers
   - Sales Mix (Menu Items/Bundles) pro Outlet
   - Parameter vollständig (Fixkosten/Invest/Packaging/Fee/etc.)
   - Stabil: State-Version + Migrationen (kein Datenverlust)
   - Sync: LocalStorage + Supabase (app_state)
========================================================= */

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

/* ----------------------- Storage Keys ----------------------- */
const LS = {
  workspace: "he_workspace",
  theme: "he_theme",
  session: "he_session_v2",
  state: "he_state_v3",
  lastSaved: "he_last_saved",
  syncStatus: "he_sync_status",
  activeTab: "he_active_tab_v2"
};

const CURRENT_VERSION = 3;

/* ----------------------- Helpers ----------------------- */
function $(sel){ return document.querySelector(sel); }
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k === "class") n.className = v;
    else if(k === "style") n.setAttribute("style", v);
    else if(k === "html") n.innerHTML = v;
    else if(k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for(const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}
function nowISO(){ return new Date().toISOString(); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function safeJsonParse(v, fallback){ try{ return v ? JSON.parse(v) : fallback; }catch{ return fallback; } }
function readLS(key, fallback){ return safeJsonParse(localStorage.getItem(key), fallback); }
function writeLS(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function toNumber(x){
  if(x === null || x === undefined) return 0;
  const s = String(x).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n){ return `${(Number.isFinite(n)?n:0).toFixed(2)} €`; }
function uuid(){
  if(crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}
function downloadBlob(filename, mime, content){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

/* ----------------------- Theme ----------------------- */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS.theme) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ----------------------- State (default) ----------------------- */
function defaultState(){
  return {
    meta: { version: CURRENT_VERSION, createdAt: nowISO(), updatedAt: nowISO() },

    // Outlets
    outlets: [{ id: "outlet_1", name: "Outlet 1" }],

    // Users with roles + outlet permissions (tabs toggles)
    users: [{
      id: uuid(),
      username: "admin",
      displayName: "Admin",
      roleGlobal: "admin",
      outlets: {
        "outlet_1": { enabled: true, tabs: { dashboard:true, sales:true, stock:true, inventory:true, preps:true, recipes:true, menu:true, bundles:true, params:true, users:true } }
      }
    }],

    // Inventory global catalog (admin)
    inventory: [], // {id, group, name, supplier, unitType('g'|'ml'|'stk'), packSize, packPrice, note}

    // Prep recipes (admin) – produce a "prep item" used in recipes
    preps: [], // {id, name, yieldQty, yieldUnit('g'|'ml'|'stk'), lines:[{id, inventoryId, qty}]}

    // Dish recipes (admin)
    recipes: [], // {id, topCat, subCat, name, lines:[{id, kind:'inv'|'prep', refId, qty}]}

    // Menu items (admin) – what is sold; references recipe or bundle
    menuItems: [], // {id, name, kind:'recipe'|'bundle', recipeId?, bundleId?, baseModifiersEnabled:boolean, note}

    // Bundles (admin) – composed of menuItems (usually recipes)
    bundles: [], // {id, name, parts:[{id, menuItemId, qty}]}

    // Modifiers (admin) – add-ons/choices
    modifiers: {
      // menuItemId: [ {id, type:'addon'|'choice', name, required:boolean, min,max, options:[{id,name, priceAdd, affectsCost:boolean, inventoryId?, qty?}] } ]
    },

    // Outlet layer (manager/staff usage)
    outletData: {
      // outletId: { inventoryOverrides:{inventoryId:{packSize?,packPrice?}}, stock:{inventoryId:{onHand}}, menuPrices:{menuItemId:{price}}, params:{...}, enabledTabsOverride? }
    },

    // Sales (per outlet) – menuItems/bundles sales mix
    sales: [], // {id, date, outletId, menuItemId, qty, priceOverride?}

    // Global default params (can be overridden per outlet)
    paramsGlobal: {
      // Fees
      platformCommissionPct: 0,
      paymentFeePct: 0,
      franchisePct: 0,
      packagingPerOrder: 0,
      packagingPctOfRevenue: 0,
      wastePct: 0,

      // Taxes
      vatPct: 7,

      // Fixed costs / month
      fixedRent: 0,
      fixedStaff: 0,
      fixedUtilities: 0,
      fixedOther: 0,

      // Investments / month (or equivalent)
      investLeaseMonthly: 0,
      investLoanMonthly: 0,
      investOtherMonthly: 0,

      // Simulation
      targetDBPct: 30
    }
  };
}

/* ----------------------- Workspace + Session ----------------------- */
function getWorkspace(){ return (localStorage.getItem(LS.workspace)||"").trim(); }
function setWorkspace(ws){ localStorage.setItem(LS.workspace, ws.trim()); }
function getSession(){ return readLS(LS.session, null); }
function setSession(s){ writeLS(LS.session, s); }
function clearSession(){ localStorage.removeItem(LS.session); }

/* ----------------------- Migration (no data loss) ----------------------- */
function migrateState(st){
  if(!st || typeof st !== "object") return defaultState();

  // legacy: if no meta, create
  st.meta = st.meta || { version: 1, createdAt: nowISO(), updatedAt: nowISO() };
  st.meta.version = toNumber(st.meta.version) || 1;

  // v1 -> v2: introduce outlets + outletData + roles
  if(st.meta.version < 2){
    st.outlets = st.outlets && Array.isArray(st.outlets) && st.outlets.length ? st.outlets : [{ id:"outlet_1", name:"Outlet 1" }];
    st.outletData = st.outletData || {};
    for(const o of st.outlets){
      if(!st.outletData[o.id]){
        st.outletData[o.id] = { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
      }
    }
    st.users = (st.users && Array.isArray(st.users) && st.users.length) ? st.users : [{ id:uuid(), username:"admin", displayName:"Admin" }];
    st.users = st.users.map(u=>{
      const username = u.username || "user";
      const roleGlobal = (username.toLowerCase()==="admin") ? "admin" : (u.roleGlobal || "manager");
      const outlets = u.outlets || {};
      for(const o of st.outlets){
        if(outlets[o.id] === undefined){
          outlets[o.id] = { enabled: username.toLowerCase()==="admin", tabs: { dashboard:true, sales:true, stock:true } };
        }
      }
      return { id: u.id || uuid(), username, displayName: u.displayName || username, roleGlobal, outlets };
    });
    st.preps = st.preps || [];
    st.menuItems = st.menuItems || [];
    st.bundles = st.bundles || [];
    st.modifiers = st.modifiers || {};
    st.paramsGlobal = st.paramsGlobal || defaultState().paramsGlobal;
    st.meta.version = 2;
  }

  // v2 -> v3: add targetDBPct & more params + ensure structures
  if(st.meta.version < 3){
    st.paramsGlobal = { ...defaultState().paramsGlobal, ...(st.paramsGlobal||{}) };
    st.outletData = st.outletData || {};
    st.outlets = st.outlets || [{id:"outlet_1", name:"Outlet 1"}];
    for(const o of st.outlets){
      st.outletData[o.id] = st.outletData[o.id] || { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
      st.outletData[o.id].inventoryOverrides = st.outletData[o.id].inventoryOverrides || {};
      st.outletData[o.id].stock = st.outletData[o.id].stock || {};
      st.outletData[o.id].menuPrices = st.outletData[o.id].menuPrices || {};
      st.outletData[o.id].params = st.outletData[o.id].params || {};
    }
    st.modifiers = st.modifiers || {};
    st.menuItems = st.menuItems || [];
    st.bundles = st.bundles || [];
    st.preps = st.preps || [];
    st.meta.version = 3;
  }

  st.meta.updatedAt = nowISO();
  return st;
}

function loadState(){
  const raw = readLS(LS.state, null);
  const migrated = migrateState(raw);
  writeLS(LS.state, migrated);
  return migrated;
}

function saveState(st){
  st.meta = st.meta || {};
  st.meta.updatedAt = nowISO();
  writeLS(LS.state, st);
  localStorage.setItem(LS.lastSaved, nowISO());
  scheduleCloudSave();
}

/* ----------------------- Supabase Sync ----------------------- */
function setSyncStatus(text){
  localStorage.setItem(LS.syncStatus, text);
  const n = $("#syncStatus");
  if(n) n.textContent = text;
}

async function supabaseUpsert(workspace, data){
  const url = `${SUPABASE_URL}/rest/v1/app_state?on_conflict=workspace`;
  const body = [{ workspace, data, updated_at: nowISO() }];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Cloud Save failed: ${res.status} ${t}`);
  }
}

async function supabaseFetch(workspace){
  const url = `${SUPABASE_URL}/rest/v1/app_state?workspace=eq.${encodeURIComponent(workspace)}&select=data,updated_at`;
  const res = await fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Cloud Load failed: ${res.status} ${t}`);
  }
  const rows = await res.json();
  if(!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

let cloudTimer = null;
function scheduleCloudSave(){
  const ws = getWorkspace();
  if(!ws) return;
  if(cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async ()=>{
    try{
      setSyncStatus("Sync: speichere …");
      const st = loadState();
      await supabaseUpsert(ws, { ...st, savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
      setSyncStatus("Sync: aktuell ✅");
    }catch(e){
      console.error(e);
      setSyncStatus("Sync: Fehler ❌");
    }
  }, 650);
}

async function cloudPullOnStart(){
  const ws = getWorkspace();
  if(!ws) return;
  try{
    setSyncStatus("Sync: lade …");
    const row = await supabaseFetch(ws);
    if(row?.data){
      const merged = migrateState(row.data);
      writeLS(LS.state, merged);
      localStorage.setItem(LS.lastSaved, merged.savedAt || nowISO());
      setSyncStatus("Sync: geladen ✅");
    }else{
      const st = loadState();
      await supabaseUpsert(ws, { ...st, savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
      setSyncStatus("Sync: initial ✅");
    }
  }catch(e){
    console.error(e);
    setSyncStatus("Sync: Fehler ❌");
  }
}

/* ----------------------- Security / Roles ----------------------- */
function isAdmin(){
  const s = getSession();
  return s && String(s.roleGlobal||"").toLowerCase() === "admin";
}
function getActiveOutletId(){
  const s = getSession();
  return s?.outletId || null;
}
function getUserRecord(st, username){
  return (st.users||[]).find(u=>String(u.username||"").toLowerCase()===String(username||"").toLowerCase());
}
function userHasOutletAccess(user, outletId){
  if(!user || !outletId) return false;
  if(String(user.roleGlobal||"").toLowerCase()==="admin") return true;
  return !!(user.outlets && user.outlets[outletId] && user.outlets[outletId].enabled);
}
function tabEnabledForUser(user, outletId, tabId){
  if(!user) return false;
  if(String(user.roleGlobal||"").toLowerCase()==="admin") return true;
  const o = user.outlets?.[outletId];
  return !!(o && o.enabled && o.tabs && o.tabs[tabId]);
}

/* ----------------------- Calculations ----------------------- */
function effectiveInventoryItem(st, outletId, inv){
  const od = st.outletData?.[outletId] || {};
  const ov = od.inventoryOverrides?.[inv.id] || {};
  return {
    ...inv,
    packSize: (ov.packSize !== undefined && ov.packSize !== null && ov.packSize !== "") ? ov.packSize : inv.packSize,
    packPrice: (ov.packPrice !== undefined && ov.packPrice !== null && ov.packPrice !== "") ? ov.packPrice : inv.packPrice
  };
}

function unitPrice(inv){
  const packPrice = toNumber(inv.packPrice);
  const packSize = toNumber(inv.packSize);
  if(packPrice <= 0) return 0;

  if(inv.unitType === "stk"){
    const denom = packSize > 0 ? packSize : 1;
    return packPrice / denom;
  }
  if(packSize <= 0) return 0;
  return packPrice / packSize; // €/g or €/ml
}

function prepUnitCost(st, outletId, prep){
  // cost(prep recipe) / yieldQty
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  let total = 0;
  for(const l of (prep.lines||[])){
    const inv = invById[l.inventoryId];
    if(!inv) continue;
    const eff = effectiveInventoryItem(st, outletId, inv);
    total += toNumber(l.qty) * unitPrice(eff);
  }
  const yieldQty = toNumber(prep.yieldQty);
  if(yieldQty <= 0) return 0;
  return total / yieldQty;
}

function recipeCost(st, outletId, recipe){
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));
  let sum = 0;

  for(const l of (recipe.lines||[])){
    const qty = toNumber(l.qty);
    if(qty <= 0) continue;

    if(l.kind === "inv"){
      const inv = invById[l.refId];
      if(!inv) continue;
      const eff = effectiveInventoryItem(st, outletId, inv);
      sum += qty * unitPrice(eff);
    }else if(l.kind === "prep"){
      const p = prepById[l.refId];
      if(!p) continue;
      const up = prepUnitCost(st, outletId, p);
      sum += qty * up;
    }
  }
  return sum;
}

function getOutletParams(st, outletId){
  const base = st.paramsGlobal || {};
  const od = st.outletData?.[outletId] || {};
  const o = od.params || {};
  return { ...base, ...o };
}

function menuItemPrice(st, outletId, menuItem){
  const od = st.outletData?.[outletId] || {};
  const mp = od.menuPrices?.[menuItem.id]?.price;
  return toNumber(mp);
}

function menuItemCost(st, outletId, menuItem){
  if(menuItem.kind === "recipe"){
    const r = (st.recipes||[]).find(x=>x.id===menuItem.recipeId);
    if(!r) return 0;
    return recipeCost(st, outletId, r);
  }
  if(menuItem.kind === "bundle"){
    const b = (st.bundles||[]).find(x=>x.id===menuItem.bundleId);
    if(!b) return 0;
    let sum = 0;
    for(const p of (b.parts||[])){
      const mi = (st.menuItems||[]).find(x=>x.id===p.menuItemId);
      if(!mi) continue;
      sum += menuItemCost(st, outletId, mi) * toNumber(p.qty);
    }
    return sum;
  }
  return 0;
}

function dbCalc(st, outletId, menuItem, priceOverrideNullable){
  const params = getOutletParams(st, outletId);
  const price = (priceOverrideNullable !== null && priceOverrideNullable !== undefined)
    ? toNumber(priceOverrideNullable)
    : menuItemPrice(st, outletId, menuItem);

  const cost = menuItemCost(st, outletId, menuItem);

  const commission = price * (toNumber(params.platformCommissionPct)/100);
  const payFee = price * (toNumber(params.paymentFeePct)/100);
  const franchise = price * (toNumber(params.franchisePct)/100);
  const packaging = toNumber(params.packagingPerOrder) + price * (toNumber(params.packagingPctOfRevenue)/100);
  const waste = cost * (toNumber(params.wastePct)/100);

  const db = price - cost - waste - commission - payFee - franchise - packaging;
  const dbPct = price>0 ? (db/price)*100 : 0;

  return { price, cost, waste, commission, payFee, franchise, packaging, db, dbPct };
}

function fixedMonthlyTotal(params){
  return toNumber(params.fixedRent)+toNumber(params.fixedStaff)+toNumber(params.fixedUtilities)+toNumber(params.fixedOther)
       + toNumber(params.investLeaseMonthly)+toNumber(params.investLoanMonthly)+toNumber(params.investOtherMonthly);
}

/* ----------------------- UI Base ----------------------- */
function ensureRoot(){
  let root = $("#app");
  if(!root){
    root = document.createElement("div");
    root.id = "app";
    document.body.appendChild(root);
  }
  return root;
}

function injectBaseStyles(){
  if($("#he_styles")) return;
  const style = el("style", { id:"he_styles", html: `
    :root {
      --bg:#0b0f14; --card:#121926; --text:#e8eef9; --muted:#a6b0c3;
      --border:#223049; --primary:#4ea1ff; --danger:#ff5a5f; --ok:#39d98a;
      --input:#0f1522; --tab:#0e1420; --warn:#ffd166;
    }
    :root[data-theme="light"]{
      --bg:#f5f7fb; --card:#ffffff; --text:#111827; --muted:#516072;
      --border:#d9e1ee; --primary:#2563eb; --danger:#dc2626; --ok:#16a34a;
      --input:#f3f6fb; --tab:#f0f4fa; --warn:#b45309;
    }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
    .container{ max-width:1200px; margin:0 auto; padding:16px; }
    .topbar{ display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .title{ font-size:18px; font-weight:900; }
    .sub{ color:var(--muted); font-size:12px; line-height:1.35; }
    .card{ background:var(--card); border:1px solid var(--border); border-radius:14px; padding:14px; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn{ border:1px solid var(--border); background:transparent; color:var(--text); padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:800; }
    .btn.primary{ background:var(--primary); border-color:transparent; color:#fff; }
    .btn.danger{ background:var(--danger); border-color:transparent; color:#fff; }
    .btn.warn{ background:var(--warn); border-color:transparent; color:#000; }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .input, select, textarea{ width:100%; padding:10px 10px; border-radius:10px; border:1px solid var(--border); background:var(--input); color:var(--text); outline:none; box-sizing:border-box; }
    .label{ font-size:12px; color:var(--muted); margin-top:10px; margin-bottom:6px; }
    .grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:12px; }
    .col-12{ grid-column: span 12; } .col-6{ grid-column: span 6; } .col-4{ grid-column: span 4; } .col-8{ grid-column: span 8; } .col-3{ grid-column: span 3; }
    @media (max-width: 900px){ .col-6,.col-4,.col-8,.col-3{ grid-column: span 12; } }
    .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
    .tab{ background:var(--tab); border:1px solid var(--border); padding:9px 10px; border-radius:10px; cursor:pointer; font-weight:900; color:var(--text); }
    .tab.active{ outline:2px solid var(--primary); }
    .hr{ height:1px; background:var(--border); margin:12px 0; }
    table{ width:100%; border-collapse:collapse; }
    th, td{ border-bottom:1px solid var(--border); padding:10px 8px; font-size:13px; text-align:left; vertical-align:top; }
    th{ color:var(--muted); font-size:12px; }
    td.right, th.right{ text-align:right; }
    .ok{ color:var(--ok); font-weight:900; }
    .bad{ color:var(--danger); font-weight:900; }
    .pill{ display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid var(--border); font-size:12px; color:var(--muted); }
    .small{ font-size:12px; color:var(--muted); }
    .two{ display:flex; gap:10px; flex-wrap:wrap; }
    .two > div{ flex: 1; min-width: 220px; }
    .kpi{ font-size:28px; font-weight:1000; }
    .muted{ color:var(--muted); }
    .badge{ display:inline-block; padding:4px 10px; border:1px solid var(--border); border-radius:999px; font-size:12px; }
    .badge.ok{ border-color: rgba(57,217,138,.4); }
    .badge.bad{ border-color: rgba(255,90,95,.4); }
    .note{ font-size:12px; color:var(--muted); }
  `});
  document.head.appendChild(style);
}

/* ----------------------- Tabs ----------------------- */
function getActiveTab(){ return readLS(LS.activeTab, "dashboard"); }
function setActiveTab(id){
  writeLS(LS.activeTab, id);
  document.querySelectorAll(".tab").forEach(t=>{
    t.classList.toggle("active", t.getAttribute("data-tab") === id);
  });
}
function tabBtn(id, label, show){
  if(!show) return el("span");
  const btn = el("button", { class:`tab`, "data-tab":id }, [label]);
  btn.onclick = ()=>{
    setActiveTab(id);
    renderActiveTab(id);
  };
  return btn;
}

/* ----------------------- XLSX Loader (SheetJS) ----------------------- */
let XLSX_READY = false;
async function ensureXLSX(){
  if(XLSX_READY) return true;
  if(window.XLSX){ XLSX_READY = true; return true; }
  return new Promise((resolve)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = ()=>{ XLSX_READY = !!window.XLSX; resolve(XLSX_READY); };
    s.onerror = ()=>resolve(false);
    document.head.appendChild(s);
  });
}

/* ----------------------- Login Screen ----------------------- */
function screenLogin(){
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const st = loadState();
  const ws = getWorkspace();

  const wsInput = el("input", { class:"input", value: ws, placeholder:"z.B. heisse-ecke" });
  const userInput = el("input", { class:"input", placeholder:"admin oder angelegter User" });

  const outletSel = el("select", { class:"input" }, (st.outlets||[]).map(o=>el("option",{value:o.id},[o.name])));
  outletSel.value = (st.outlets?.[0]?.id) || "outlet_1";

  const msg = el("div", { class:"small", style:"margin-top:10px" }, [""]);

  const btnLogin = el("button", { class:"btn primary" }, ["Weiter"]);
  const btnTheme = el("button", { class:"btn" }, ["Hell/Dunkel"]);

  btnTheme.onclick = toggleTheme;

  btnLogin.onclick = async ()=>{
    msg.textContent = "";
    const w = (wsInput.value || "").trim();
    const u = (userInput.value || "").trim();
    const outletId = outletSel.value;

    if(!w){ msg.textContent = "Workspace ist Pflicht."; return; }
    if(!u){ msg.textContent = "Username fehlt."; return; }
    if(!outletId){ msg.textContent = "Outlet ist Pflicht."; return; }

    setWorkspace(w);
    await cloudPullOnStart();

    const st2 = loadState();
    const user = getUserRecord(st2, u);
    if(!user){ msg.textContent = "Unbekannter User (Admin muss dich anlegen)."; return; }

    if(!userHasOutletAccess(user, outletId)){
      msg.textContent = "Du hast keinen Zugriff auf dieses Outlet.";
      return;
    }

    setSession({
      username: user.username,
      displayName: user.displayName || user.username,
      roleGlobal: user.roleGlobal || "manager",
      outletId
    });

    screenApp();
  };

  const card = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Login"]),
    el("div", { class:"sub", html: `Workspace ist Pflicht (Sync). Beispiel: <b>heisse-ecke</b>` }),
    el("div", { class:"label" }, ["Workspace Code"]),
    wsInput,
    el("div", { class:"label" }, ["Username"]),
    userInput,
    el("div", { class:"label" }, ["Outlet (Pflicht)"]),
    outletSel,
    el("div", { class:"note", style:"margin-top:6px" }, ["Hinweis: Outlet-Auswahl ist Pflicht."]),
    el("div", { class:"row", style:"margin-top:12px" }, [btnLogin, btnTheme]),
    msg
  ]);

  const info = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Was diese Version kann (MVP+)"]),
    el("div", { class:"sub", html: `
      ✅ Multi-Outlet + Rollen (Admin/Manager/Staff)<br/>
      ✅ Inventur: globaler Stamm + Outlet Overrides + Bestand<br/>
      ✅ Rezepte inkl. Prep-Rezepte (Sauce etc.) als Zutat nutzbar<br/>
      ✅ Menüartikel + Bundles + VK manuell je Outlet<br/>
      ✅ Modifiers (Add-ons/Choices) vorbereitbar<br/>
      ✅ Deckungsbeitrag € / % + Tages-DB + Break-even Ansatz<br/>
      ✅ Autosave lokal + Supabase Sync (Workspace)<br/>
      ✅ Hell/Dunkel + Mobile/Tablet/PC Layout<br/>
      ✅ Inventur Import (XLSX/CSV) + Menü Export (CSV)
    `})
  ]);

  root.appendChild(el("div", { class:"container" }, [
    el("div", { class:"topbar" }, [
      el("div", {}, [
        el("div", { class:"title" }, ["Heisse Ecke – Kalkulation (Web)"]),
        el("div", { class:"sub" }, ["GitHub Pages · Supabase Sync · Single File"])
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"pill", id:"syncStatus" }, [ localStorage.getItem(LS.syncStatus) || (ws ? "Sync: bereit" : "Sync: aus") ])
      ])
    ]),
    el("div", { class:"grid", style:"margin-top:12px" }, [card, info])
  ]));
}

/* ----------------------- App Shell ----------------------- */
function screenApp(){
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const s = getSession();
  if(!s){ screenLogin(); return; }

  const ws = getWorkspace();
  if(!ws){ clearSession(); screenLogin(); return; }

  const st = loadState();
  const user = getUserRecord(st, s.username);
  if(!user){ clearSession(); screenLogin(); return; }

  const outletId = s.outletId;
  const outlet = (st.outlets||[]).find(o=>o.id===outletId);
  if(!outlet){ clearSession(); screenLogin(); return; }

  const header = el("div", { class:"topbar" }, [
    el("div", {}, [
      el("div", { class:"title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", { class:"sub", html: `
        Workspace: <b>${escapeHtml(ws)}</b> · <span id="syncStatus">${escapeHtml(localStorage.getItem(LS.syncStatus) || "Sync: bereit")}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(s.username)}) · Rolle: <b>${escapeHtml(s.roleGlobal)}</b><br/>
        Outlet: <b>${escapeHtml(outlet.name)}</b> · Letzte Speicherung: <b>${escapeHtml(localStorage.getItem(LS.lastSaved) || "—")}</b>
      `})
    ]),
    el("div", { class:"row" }, [
      el("button", { class:"btn", onclick: toggleTheme }, ["Hell/Dunkel"]),
      el("button", { class:"btn", onclick: async ()=>{
        try{
          setSyncStatus("Sync: speichere …");
          const state = loadState();
          await supabaseUpsert(ws, { ...state, savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
          setSyncStatus("Sync: aktuell ✅");
          await cloudPullOnStart();
          renderActiveTab(getActiveTab());
        }catch(e){
          console.error(e);
          setSyncStatus("Sync: Fehler ❌");
          alert("Sync Fehler. Schau Console (F12).");
        }
      }}, ["Sync jetzt"]),
      el("button", { class:"btn danger", onclick: ()=>{ clearSession(); screenLogin(); } }, ["Logout"])
    ])
  ]);

  const tabs = el("div", { class:"card", style:"margin-top:12px" }, [
    el("div", { class:"tabs" }, [
      tabBtn("dashboard", "Dashboard", tabEnabledForUser(user, outletId, "dashboard") || true),
      tabBtn("sales", "Sales", tabEnabledForUser(user, outletId, "sales") || true),
      tabBtn("stock", "Bestand", tabEnabledForUser(user, outletId, "stock") || true),

      // Admin/Manager tabs – controlled
      tabBtn("inventory", "Inventur (Admin)", tabEnabledForUser(user, outletId, "inventory") && (isAdmin() || s.roleGlobal!=="staff")),
      tabBtn("preps", "Preps (Admin)", tabEnabledForUser(user, outletId, "preps") && (isAdmin() || s.roleGlobal!=="staff")),
      tabBtn("recipes", "Rezepte (Admin)", tabEnabledForUser(user, outletId, "recipes") && (isAdmin() || s.roleGlobal!=="staff")),
      tabBtn("menu", "Menü (Admin)", tabEnabledForUser(user, outletId, "menu") && (isAdmin() || s.roleGlobal!=="staff")),
      tabBtn("bundles", "Bundles (Admin)", tabEnabledForUser(user, outletId, "bundles") && (isAdmin() || s.roleGlobal!=="staff")),
      tabBtn("params", "Parameter", tabEnabledForUser(user, outletId, "params") || true),
      tabBtn("users", "User/Outlets (Admin)", isAdmin())
    ])
  ]);

  const content = el("div", { id:"content", style:"margin-top:12px" }, []);
  root.appendChild(el("div", { class:"container" }, [header, tabs, content]));

  const savedTab = getActiveTab();
  setActiveTab(savedTab);
  renderActiveTab(savedTab);
}

/* ----------------------- Render dispatcher ----------------------- */
function renderActiveTab(tab){
  setActiveTab(tab);
  const content = $("#content");
  if(!content) return;
  content.innerHTML = "";
  const st = loadState();
  const s = getSession();
  const outletId = s?.outletId;

  if(tab === "dashboard") content.appendChild(renderDashboard(st, outletId));
  if(tab === "inventory") content.appendChild(renderInventoryAdmin(st));
  if(tab === "preps") content.appendChild(renderPrepsAdmin(st, outletId));
  if(tab === "recipes") content.appendChild(renderRecipesAdmin(st, outletId));
  if(tab === "menu") content.appendChild(renderMenuAdmin(st, outletId));
  if(tab === "bundles") content.appendChild(renderBundlesAdmin(st, outletId));
  if(tab === "stock") content.appendChild(renderStockOutlet(st, outletId));
  if(tab === "sales") content.appendChild(renderSales(st, outletId));
  if(tab === "params") content.appendChild(renderParams(st, outletId));
  if(tab === "users") content.appendChild(renderUsersAdmin(st));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st, outletId){
  const params = getOutletParams(st, outletId);
  const today = todayISO();
  const salesToday = (st.sales||[]).filter(x=>x.outletId===outletId && x.date===today);

  let revenue = 0, cost = 0, db = 0;
  for(const s of salesToday){
    const mi = (st.menuItems||[]).find(x=>x.id===s.menuItemId);
    if(!mi) continue;
    const calc = dbCalc(st, outletId, mi, s.priceOverride ?? null);
    const qty = toNumber(s.qty);
    revenue += calc.price * qty;
    cost += calc.cost * qty;
    db += calc.db * qty;
  }

  const fixedM = fixedMonthlyTotal(params);
  const fixedD = fixedM / 30;
  const dbAfterFixed = db - fixedD;

  // break-even: how many units/day of selected "primary" item to cover fixedD
  const topItem = (st.menuItems||[])[0] || null;
  let beUnits = 0;
  if(topItem){
    const c = dbCalc(st, outletId, topItem, null);
    const unitDb = c.db;
    beUnits = unitDb > 0 ? (fixedD / unitDb) : 0;
  }

  const kpiCard = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Heute – Kontrolle"]),
    el("div",{class:"hr"}),
    el("div",{class:"grid"},[
      el("div",{class:"col-4"},[
        el("div",{class:"muted small"},["Umsatz (heute)"]),
        el("div",{class:"kpi"},[fmtEUR(revenue)])
      ]),
      el("div",{class:"col-4"},[
        el("div",{class:"muted small"},["Wareneinsatz (heute)"]),
        el("div",{class:"kpi"},[fmtEUR(cost)])
      ]),
      el("div",{class:"col-4"},[
        el("div",{class:"muted small"},["DB (heute)"]),
        el("div",{class:`kpi ${db>=0?"ok":"bad"}`},[fmtEUR(db)])
      ]),
      el("div",{class:"col-6"},[
        el("div",{class:"muted small"},["Fixkosten / Tag (aus Parametern)"]),
        el("div",{class:"kpi"},[fmtEUR(fixedD)])
      ]),
      el("div",{class:"col-6"},[
        el("div",{class:"muted small"},["DB nach Fixkosten (heute)"]),
        el("div",{class:`kpi ${dbAfterFixed>=0?"ok":"bad"}`},[fmtEUR(dbAfterFixed)])
      ])
    ])
  ]);

  // Table: menu items snapshot
  const rows = (st.menuItems||[]).map(mi=>{
    const calc = dbCalc(st, outletId, mi, null);
    return { id:mi.id, name:mi.name, kind:mi.kind, ...calc };
  }).sort((a,b)=> (b.dbPct-a.dbPct));

  const table = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Menü – DB Übersicht (Outlet)"]),
    el("div",{class:"sub", html: `
      Ziel-DB% (Parameter): <b>${toNumber(params.targetDBPct).toFixed(0)}%</b> ·
      Break-even (Daumenregel): <b>${topItem?escapeHtml(topItem.name):"—"}</b> → <b>${beUnits>0?beUnits.toFixed(1):"—"}</b> Einheiten/Tag für Fixkosten
    `}),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Menüartikel"]),
            el("th",{},["Typ"]),
            el("th",{class:"right"},["VK"]),
            el("th",{class:"right"},["Wareneinsatz"]),
            el("th",{class:"right"},["DB €"]),
            el("th",{class:"right"},["DB %"])
          ])
        ]),
        el("tbody",{}, rows.map(r=> el("tr",{},[
          el("td",{html:escapeHtml(r.name)}),
          el("td",{html:escapeHtml(r.kind)}),
          el("td",{class:"right"},[fmtEUR(r.price)]),
          el("td",{class:"right"},[fmtEUR(r.cost)]),
          el("td",{class:`right ${r.db>=0?"ok":"bad"}`},[fmtEUR(r.db)]),
          el("td",{class:`right ${r.dbPct>=0?"ok":"bad"}`},[`${r.dbPct.toFixed(1)}%`])
        ])))
      ])
    ])
  ]);

  return el("div",{class:"grid"},[kpiCard, table]);
}

/* ----------------------- INVENTORY ADMIN (global catalog + import/export) ----------------------- */
function renderInventoryAdmin(st){
  const wrap = el("div",{class:"grid"});

  const inv_group = el("input", { class:"input", placeholder:"z.B. Fleisch, Saucen, Verpackung" });
  const inv_name = el("input", { class:"input", placeholder:"z.B. Currywurst gelb" });
  const inv_supplier = el("input", { class:"input", placeholder:"z.B. Metro" });
  const inv_packSize = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 1000" });
  const inv_unit = el("select", { class:"input" }, [
    el("option", { value:"g" }, ["g"]),
    el("option", { value:"ml" }, ["ml"]),
    el("option", { value:"stk" }, ["stk"])
  ]);
  const inv_packPrice = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 12,50" });
  const inv_note = el("input", { class:"input", placeholder:"Notiz (optional)" });
  const inv_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

  const btnAddInv = el("button", { class:"btn primary" }, ["Artikel speichern"]);

  // Import
  const fileInput = el("input", { type:"file", class:"input", accept:".xlsx,.xls,.csv" });
  const btnImport = el("button", { class:"btn warn" }, ["Inventur importieren (Merge)"]);
  const btnExport = el("button", { class:"btn" }, ["Inventur exportieren (CSV)"]);
  const importMsg = el("div",{class:"small", style:"margin-top:8px"},[""]);

  const inv_tbody = el("tbody", {});
  const editor = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Artikel bearbeiten"]),
    el("div", { class:"small" }, ["Noch kein Artikel ausgewählt."])
  ]);

  const form = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur (Admin) – Artikel anlegen"]),
    el("div", { class:"sub" }, ["Packgröße + Packpreis → App rechnet €/g, €/ml oder €/stk."]),
    el("div", { class:"label" }, ["Warengruppe"]), inv_group,
    el("div", { class:"label" }, ["Artikelname"]), inv_name,
    el("div", { class:"label" }, ["Lieferant"]), inv_supplier,
    el("div", { class:"two" }, [
      el("div", {}, [el("div", { class:"label" }, ["Packgröße"]), inv_packSize]),
      el("div", {}, [el("div", { class:"label" }, ["Einheit"]), inv_unit])
    ]),
    el("div", { class:"label" }, ["Packpreis (€)"]), inv_packPrice,
    el("div", { class:"label" }, ["Notiz"]), inv_note,
    el("div", { class:"row", style:"margin-top:12px" }, [btnAddInv]),
    inv_msg,
    el("div",{class:"hr"}),
    el("div",{class:"title", style:"font-size:15px"},["Import/Export"]),
    el("div",{class:"sub"},["Import erwartet Spalten: group,name,supplier,unitType,packSize,packPrice (optional inventory_id)."]),
    fileInput,
    el("div",{class:"row", style:"margin-top:10px"},[btnImport, btnExport]),
    importMsg
  ]);

  const listCard = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur – Liste (Klick zum Editieren)"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:600px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Artikel"]),
            el("th", {}, ["Gruppe"]),
            el("th", {}, ["Einheit"]),
            el("th", { class:"right" }, ["Pack"]),
            el("th", { class:"right" }, ["€ Pack"]),
            el("th", { class:"right" }, ["€ / Einheit"])
          ])
        ]),
        inv_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function drawList(){
    inv_tbody.innerHTML = "";
    (st.inventory||[]).forEach(inv=>{
      const up = unitPrice(inv);
      const tr = el("tr", { style:"cursor:pointer" }, [
        el("td", { html: escapeHtml(inv.name) }),
        el("td", { html: escapeHtml(inv.group||"") }),
        el("td", { html: escapeHtml(inv.unitType) }),
        el("td", { class:"right" }, [String(toNumber(inv.packSize) || "")]),
        el("td", { class:"right" }, [toNumber(inv.packPrice).toFixed(2)]),
        el("td", { class:"right" }, [up.toFixed(4)])
      ]);
      tr.onclick = ()=> openEditor(inv.id);
      inv_tbody.appendChild(tr);
    });
  }

  function openEditor(id){
    const inv = (st.inventory||[]).find(x=>x.id===id);
    if(!inv){
      editor.innerHTML = `<div class="title">Artikel bearbeiten</div><div class="small">Noch kein Artikel ausgewählt.</div>`;
      return;
    }
    editor.innerHTML = "";
    editor.appendChild(el("div", { class:"title" }, ["Artikel bearbeiten"]));
    editor.appendChild(el("div", { class:"sub" }, ["Speichern schreibt den neuen Stand."]));

    const name = el("input", { class:"input", value: inv.name || "" });
    const group = el("input", { class:"input", value: inv.group || "" });
    const supplier = el("input", { class:"input", value: inv.supplier || "" });
    const packSize = el("input", { class:"input", inputmode:"decimal", value: String(inv.packSize ?? "") });
    const packPrice = el("input", { class:"input", inputmode:"decimal", value: String(inv.packPrice ?? "") });
    const note = el("input", { class:"input", value: inv.note || "" });
    const unit = el("select", { class:"input" }, [
      el("option", { value:"g" }, ["g"]),
      el("option", { value:"ml" }, ["ml"]),
      el("option", { value:"stk" }, ["stk"])
    ]);
    unit.value = inv.unitType || "g";

    const msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
    const upView = el("div", { class:"small", style:"margin-top:6px" }, [""]);

    function refreshUP(){
      const tmp = { ...inv, name:name.value, group:group.value, supplier:supplier.value, packSize:packSize.value, packPrice:packPrice.value, unitType:unit.value };
      upView.innerHTML = `Preis pro Einheit: <b>${unitPrice(tmp).toFixed(4)} €/ ${escapeHtml(tmp.unitType)}</b>`;
    }
    [packSize, packPrice, unit].forEach(x=>x.addEventListener("change", refreshUP));
    refreshUP();

    const btnSave = el("button", { class:"btn primary" }, ["Speichern"]);
    const btnDel = el("button", { class:"btn danger" }, ["Löschen"]);

    btnSave.onclick = ()=>{
      inv.name = name.value.trim();
      inv.group = group.value.trim();
      inv.supplier = supplier.value.trim();
      inv.packSize = packSize.value.trim();
      inv.packPrice = packPrice.value.trim();
      inv.unitType = unit.value;
      inv.note = note.value.trim();

      if(!inv.name){
        msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`;
        return;
      }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Artikel wirklich löschen? (Rezepte/Preps verlieren die Zuordnung)")) return;
      st.inventory = (st.inventory||[]).filter(x=>x.id!==inv.id);

      // remove references in preps/recipes
      (st.preps||[]).forEach(p=> p.lines = (p.lines||[]).filter(l=>l.inventoryId!==inv.id));
      (st.recipes||[]).forEach(r=> r.lines = (r.lines||[]).filter(l=> !(l.kind==="inv" && l.refId===inv.id)));

      // remove stock/overrides
      for(const oid of Object.keys(st.outletData||{})){
        delete st.outletData[oid]?.inventoryOverrides?.[inv.id];
        delete st.outletData[oid]?.stock?.[inv.id];
      }

      saveState(st);
      drawList();
      openEditor(null);
    };

    editor.appendChild(el("div", { class:"grid", style:"margin-top:10px" }, [
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Artikelname"]), name]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Warengruppe"]), group]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Lieferant"]), supplier]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Einheit"]), unit]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Packgröße"]), packSize]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Packpreis (€)"]), packPrice]),
      el("div", { class:"col-12" }, [el("div",{class:"label"},["Notiz"]), note]),
      el("div", { class:"col-12" }, [upView]),
      el("div", { class:"col-12" }, [el("div", { class:"row" }, [btnSave, btnDel])]),
      el("div", { class:"col-12" }, [msg])
    ]));
  }

  btnAddInv.onclick = ()=>{
    inv_msg.textContent = "";

    const item = {
      id: uuid(),
      group: (inv_group.value||"").trim(),
      name: (inv_name.value||"").trim(),
      supplier: (inv_supplier.value||"").trim(),
      packSize: (inv_packSize.value||"").trim(),
      packPrice: (inv_packPrice.value||"").trim(),
      unitType: inv_unit.value,
      note: (inv_note.value||"").trim()
    };
    if(!item.name){ inv_msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`; return; }

    st.inventory.push(item);
    saveState(st);

    inv_name.value = "";
    inv_packSize.value = "";
    inv_packPrice.value = "";
    inv_note.value = "";
    inv_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  btnExport.onclick = ()=>{
    const cols = ["inventory_id","group","name","supplier","unitType","packSize","packPrice","note"];
    const lines = [cols.join(",")];
    for(const inv of (st.inventory||[])){
      const row = [
        inv.id,
        (inv.group||""),
        (inv.name||""),
        (inv.supplier||""),
        (inv.unitType||""),
        String(inv.packSize??""),
        String(inv.packPrice??""),
        (inv.note||"")
      ].map(v => `"${String(v).replace(/"/g,'""')}"`);
      lines.push(row.join(","));
    }
    downloadBlob("inventur_export.csv","text/csv;charset=utf-8", lines.join("\n"));
  };

  // IMPORT (XLSX/CSV)
  async function parseFileToRows(file){
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    if(name.endsWith(".csv")){
      const text = new TextDecoder("utf-8").decode(buf);
      return csvToObjects(text);
    }
    const ok = await ensureXLSX();
    if(!ok) throw new Error("XLSX lib konnte nicht geladen werden (CDN).");
    const wb = window.XLSX.read(buf, { type:"array" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json = window.XLSX.utils.sheet_to_json(ws, { defval:"" });
    return json;
  }

  function csvToObjects(csv){
    const lines = csv.split(/\r?\n/).filter(l=>l.trim().length);
    if(!lines.length) return [];
    const headers = splitCSVLine(lines[0]).map(h=>h.trim());
    const out = [];
    for(let i=1;i<lines.length;i++){
      const parts = splitCSVLine(lines[i]);
      const obj = {};
      headers.forEach((h,idx)=> obj[h]= (parts[idx]??""));
      out.push(obj);
    }
    return out;
  }
  function splitCSVLine(line){
    const res = [];
    let cur = "", inQ = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"' ){
        if(inQ && line[i+1]==='"'){ cur+='"'; i++; }
        else inQ = !inQ;
      }else if(ch === ',' && !inQ){
        res.push(cur); cur="";
      }else{
        cur += ch;
      }
    }
    res.push(cur);
    return res;
  }

  function normalizeImportRow(r){
    // accept different header variants
    const get = (...keys)=>{
      for(const k of keys){
        const foundKey = Object.keys(r).find(x=>x.toLowerCase()===k.toLowerCase());
        if(foundKey !== undefined) return r[foundKey];
      }
      return "";
    };
    return {
      inventory_id: (get("inventory_id","id","inventoryId")||"").toString().trim(),
      group: (get("group","warengruppe")||"").toString().trim(),
      name: (get("name","artikel","artikelname")||"").toString().trim(),
      supplier: (get("supplier","lieferant")||"").toString().trim(),
      unitType: (get("unitType","einheit","unit")||"").toString().trim(),
      packSize: (get("packSize","gebindegroesse","gebindegröße","size")||"").toString().trim(),
      packPrice: (get("packPrice","gebindepreis","price")||"").toString().trim(),
      note: (get("note","notiz")||"").toString().trim()
    };
  }

  function makeFallbackKey(n){
    return `${(n.name||"").toLowerCase()}__${(n.unitType||"").toLowerCase()}__${String(toNumber(n.packSize)||"")}`;
  }

  btnImport.onclick = async ()=>{
    importMsg.textContent = "";
    const f = fileInput.files?.[0];
    if(!f){ importMsg.innerHTML = `<span class="bad">Bitte Datei wählen (.xlsx oder .csv).</span>`; return; }

    try{
      importMsg.textContent = "Lese Datei…";
      const rows = await parseFileToRows(f);
      const norm = rows.map(normalizeImportRow).filter(x=>x.name);

      if(!norm.length){
        importMsg.innerHTML = `<span class="bad">Keine gültigen Zeilen gefunden (name fehlt).</span>`;
        return;
      }

      // build maps
      const byId = new Map((st.inventory||[]).map(inv=>[inv.id, inv]));
      const byKey = new Map((st.inventory||[]).map(inv=>[makeFallbackKey(inv), inv]));

      const preview = { add:0, update:0, conflict:0, errors:0 };
      const ops = [];

      for(const r of norm){
        const unitType = (r.unitType||"").toLowerCase();
        if(!["g","ml","stk"].includes(unitType)){
          preview.errors++;
          continue;
        }

        let target = null;
        if(r.inventory_id && byId.has(r.inventory_id)) target = byId.get(r.inventory_id);
        if(!target){
          const fk = makeFallbackKey(r);
          if(byKey.has(fk)) target = byKey.get(fk);
        }

        if(!target){
          preview.add++;
          ops.push({ type:"add", row:r });
        }else{
          preview.update++;
          ops.push({ type:"update", targetId: target.id, row:r });
        }
      }

      const ok = confirm(
        `Import Preview:\n`+
        `Neu: ${preview.add}\n`+
        `Update: ${preview.update}\n`+
        `Fehler (übersprungen): ${preview.errors}\n\n`+
        `Fortfahren?`
      );
      if(!ok){ importMsg.textContent = "Abgebrochen."; return; }

      // apply ops
      for(const op of ops){
        if(op.type==="add"){
          const r = op.row;
          st.inventory.push({
            id: r.inventory_id || uuid(),
            group: r.group,
            name: r.name,
            supplier: r.supplier,
            unitType: r.unitType.toLowerCase(),
            packSize: r.packSize,
            packPrice: r.packPrice,
            note: r.note
          });
        }else if(op.type==="update"){
          const inv = (st.inventory||[]).find(x=>x.id===op.targetId);
          if(!inv) continue;
          const r = op.row;
          inv.group = r.group || inv.group;
          inv.name = r.name || inv.name;
          inv.supplier = r.supplier || inv.supplier;
          inv.unitType = (r.unitType||inv.unitType).toLowerCase();
          inv.packSize = (r.packSize!=="" ? r.packSize : inv.packSize);
          inv.packPrice = (r.packPrice!=="" ? r.packPrice : inv.packPrice);
          inv.note = (r.note!=="" ? r.note : inv.note);
        }
      }

      saveState(st);
      drawList();
      importMsg.innerHTML = `<span class="ok">Import fertig ✅ (Neu ${preview.add}, Update ${preview.update}, Fehler ${preview.errors})</span>`;
    }catch(e){
      console.error(e);
      importMsg.innerHTML = `<span class="bad">Import Fehler: ${escapeHtml(e.message||String(e))}</span>`;
    }
  };

  drawList();
  return wrap;
}

/* ----------------------- PREPS ADMIN ----------------------- */
function renderPrepsAdmin(st, outletId){
  const wrap = el("div",{class:"grid"});

  const p_name = el("input",{class:"input", placeholder:"z.B. Currysauce Batch"});
  const p_yieldQty = el("input",{class:"input", inputmode:"decimal", placeholder:"Yield Menge (z.B. 1000)"});
  const p_yieldUnit = el("select",{class:"input"},[
    el("option",{value:"g"},["g"]),
    el("option",{value:"ml"},["ml"]),
    el("option",{value:"stk"},["stk"])
  ]);
  const p_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Prep speichern"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Prep bearbeiten"]),
    el("div",{class:"small"},["Noch kein Prep ausgewählt."])
  ]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Preps (Admin)"]),
    el("div",{class:"sub"},["Preps sind selbst hergestellte Komponenten (Sauce etc.), die später im Rezept als Zutat nutzbar sind."]),
    el("div",{class:"label"},["Name"]), p_name,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Yield Menge"]), p_yieldQty]),
      el("div",{},[el("div",{class:"label"},["Yield Einheit"]), p_yieldUnit])
    ]),
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    p_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Prep Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Name"]),
            el("th",{class:"right"},["Yield"]),
            el("th",{class:"right"},["Kosten / Einheit"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function drawList(){
    tbody.innerHTML = "";
    (st.preps||[]).forEach(p=>{
      const up = prepUnitCost(st, outletId, p);
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(p.name)}),
        el("td",{class:"right"},[`${toNumber(p.yieldQty)} ${escapeHtml(p.yieldUnit||"")}`]),
        el("td",{class:"right"},[`${up.toFixed(4)} €/${escapeHtml(p.yieldUnit||"")}`])
      ]);
      tr.onclick = ()=>openEditor(p.id);
      tbody.appendChild(tr);
    });
  }

  function openEditor(id){
    const p = (st.preps||[]).find(x=>x.id===id);
    if(!p){
      editor.innerHTML = `<div class="title">Prep bearbeiten</div><div class="small">Noch kein Prep ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Prep: ${escapeHtml(p.name)}`]));

    const name = el("input",{class:"input", value:p.name||""});
    const yieldQty = el("input",{class:"input", inputmode:"decimal", value:String(p.yieldQty??"")});
    const yieldUnit = el("select",{class:"input"},[
      el("option",{value:"g"},["g"]),
      el("option",{value:"ml"},["ml"]),
      el("option",{value:"stk"},["stk"])
    ]);
    yieldUnit.value = p.yieldUnit || "g";

    const invList = st.inventory || [];
    const selInv = el("select",{class:"input"}, invList.map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`])));
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 120)"});

    const summary = el("div",{class:"sub", style:"margin-top:6px"},[""]);
    const linesWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawLines(){
      const up = prepUnitCost(st, outletId, p);
      const totalCost = up * toNumber(p.yieldQty);
      summary.innerHTML = `Gesamtkosten Batch: <b>${fmtEUR(totalCost)}</b> · Kosten/Einheit: <b>${up.toFixed(4)} €/${escapeHtml(p.yieldUnit||"")}</b>`;

      const tbody2 = el("tbody",{}, (p.lines||[]).map(l=>{
        const inv = (st.inventory||[]).find(x=>x.id===l.inventoryId);
        const eff = inv ? effectiveInventoryItem(st, outletId, inv) : null;
        const upInv = eff ? unitPrice(eff) : 0;
        const cost = upInv * toNumber(l.qty);

        const qtyInput = el("input",{class:"input", style:"max-width:140px", inputmode:"decimal", value:String(l.qty??"")});
        const btnSaveQty = el("button",{class:"btn", style:"padding:7px 10px"},["Speichern"]);
        const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

        btnSaveQty.onclick = ()=>{ l.qty = (qtyInput.value||"").trim(); saveState(st); drawLines(); drawList(); };
        btnDel.onclick = ()=>{ p.lines = (p.lines||[]).filter(x=>x.id!==l.id); saveState(st); drawLines(); drawList(); };

        return el("tr",{},[
          el("td",{html:escapeHtml(inv?inv.name:"— (fehlend)")}),
          el("td",{html:escapeHtml(inv?inv.unitType:"")}),
          el("td",{class:"right"},[qtyInput]),
          el("td",{class:"right"},[upInv.toFixed(4)]),
          el("td",{class:"right"},[fmtEUR(cost)]),
          el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSaveQty, btnDel])])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Zutat (Inventur)"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Menge"]),
            el("th",{class:"right"},["€/Einheit"]),
            el("th",{class:"right"},["Kosten"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody2
      ]));
    }

    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
    const btnSave = el("button",{class:"btn primary"},["Prep speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Prep löschen"]);
    const btnAddLine = el("button",{class:"btn primary"},["Zutat hinzufügen"]);

    btnSave.onclick = ()=>{
      p.name = name.value.trim();
      p.yieldQty = (yieldQty.value||"").trim();
      p.yieldUnit = yieldUnit.value;
      if(!p.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      if(toNumber(p.yieldQty)<=0){ msg.innerHTML = `<span class="bad">Yield muss > 0 sein.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList(); drawLines();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Prep wirklich löschen? (Rezepte verlieren die Zuordnung)")) return;
      st.preps = (st.preps||[]).filter(x=>x.id!==p.id);
      (st.recipes||[]).forEach(r=> r.lines = (r.lines||[]).filter(l=> !(l.kind==="prep" && l.refId===p.id)));
      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = ()=>{
      if(!(st.inventory||[]).length){ alert("Inventur ist leer."); return; }
      const invId = selInv.value;
      const q = (qty.value||"").trim();
      if(!invId || !q){ alert("Bitte Artikel + Menge."); return; }
      p.lines = p.lines || [];
      p.lines.push({ id:uuid(), inventoryId:invId, qty:q });
      qty.value = "";
      saveState(st);
      drawLines(); drawList();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Yield Menge"]), yieldQty]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Yield Einheit"]), yieldUnit]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Zutaten (für Prep)"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Inventur-Artikel"]), selInv]),
          el("div",{},[el("div",{class:"label"},["Menge"]), qty])
        ]),
        el("div",{class:"row", style:"margin-top:10px"},[btnAddLine]),
        el("div",{class:"hr"}),
        linesWrap
      ])
    ]));

    drawLines();
  }

  btnAdd.onclick = ()=>{
    p_msg.textContent = "";
    const item = {
      id: uuid(),
      name: (p_name.value||"").trim(),
      yieldQty: (p_yieldQty.value||"").trim(),
      yieldUnit: p_yieldUnit.value,
      lines: []
    };
    if(!item.name){ p_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    if(toNumber(item.yieldQty)<=0){ p_msg.innerHTML = `<span class="bad">Yield muss > 0 sein.</span>`; return; }

    st.preps.push(item);
    saveState(st);
    p_name.value=""; p_yieldQty.value="";
    p_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- RECIPES ADMIN ----------------------- */
function renderRecipesAdmin(st, outletId){
  const wrap = el("div",{class:"grid"});

  const r_top = el("input",{class:"input", placeholder:"Speisen / Getränke"});
  const r_sub = el("input",{class:"input", placeholder:"z.B. Currywurst / Cocktails"});
  const r_name = el("input",{class:"input", placeholder:"z.B. Currywurst Dippers mit Pommes"});
  const r_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Rezept speichern"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Rezept bearbeiten"]),
    el("div",{class:"small"},["Noch kein Rezept ausgewählt."])
  ]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Rezepte (Admin) – anlegen"]),
    el("div",{class:"label"},["Top-Kategorie"]), r_top,
    el("div",{class:"label"},["Unterkategorie"]), r_sub,
    el("div",{class:"label"},["Rezeptname"]), r_name,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    r_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Rezept Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Rezept"]),
            el("th",{},["Kategorie"]),
            el("th",{class:"right"},["Kosten (Outlet)"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function drawList(){
    tbody.innerHTML = "";
    (st.recipes||[]).forEach(r=>{
      const cost = recipeCost(st, outletId, r);
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(r.name)}),
        el("td",{html:escapeHtml(`${r.topCat||""} / ${r.subCat||""}`)}),
        el("td",{class:"right"},[fmtEUR(cost)])
      ]);
      tr.onclick = ()=>openEditor(r.id);
      tbody.appendChild(tr);
    });
  }

  function openEditor(id){
    const r = (st.recipes||[]).find(x=>x.id===id);
    if(!r){
      editor.innerHTML = `<div class="title">Rezept bearbeiten</div><div class="small">Noch kein Rezept ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Rezept: ${escapeHtml(r.name)}`]));

    const name = el("input",{class:"input", value:r.name||""});
    const topCat = el("input",{class:"input", value:r.topCat||""});
    const subCat = el("input",{class:"input", value:r.subCat||""});
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    // add lines: choose inv or prep
    const kindSel = el("select",{class:"input"},[
      el("option",{value:"inv"},["Inventur-Artikel"]),
      el("option",{value:"prep"},["Prep (Sauce etc.)"])
    ]);

    const invSel = el("select",{class:"input"}, (st.inventory||[]).map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`])) );
    const prepSel = el("select",{class:"input"}, (st.preps||[]).map(p=>el("option",{value:p.id},[`${p.name} (${p.yieldUnit})`])) );
    prepSel.style.display = "none";

    kindSel.onchange = ()=>{
      const k = kindSel.value;
      invSel.style.display = (k==="inv") ? "" : "none";
      prepSel.style.display = (k==="prep") ? "" : "none";
    };

    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 120)"});

    const summary = el("div",{class:"sub", style:"margin-top:6px"},[""]);
    const linesWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawLines(){
      const cost = recipeCost(st, outletId, r);
      summary.innerHTML = `Rezeptkosten (Outlet): <b>${fmtEUR(cost)}</b>`;

      const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
      const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));

      const tbody2 = el("tbody",{}, (r.lines||[]).map(l=>{
        const qtyVal = toNumber(l.qty);
        let label = "—", unit = "", up = 0, costLine=0;

        if(l.kind==="inv"){
          const inv = invById[l.refId];
          if(inv){
            const eff = effectiveInventoryItem(st, outletId, inv);
            label = inv.name; unit = inv.unitType;
            up = unitPrice(eff);
            costLine = qtyVal * up;
          }
        }else if(l.kind==="prep"){
          const p = prepById[l.refId];
          if(p){
            label = p.name; unit = p.yieldUnit;
            up = prepUnitCost(st, outletId, p);
            costLine = qtyVal * up;
          }
        }

        const qtyInput = el("input",{class:"input", style:"max-width:140px", inputmode:"decimal", value:String(l.qty??"")});
        const btnSaveQty = el("button",{class:"btn", style:"padding:7px 10px"},["Speichern"]);
        const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

        btnSaveQty.onclick = ()=>{ l.qty = (qtyInput.value||"").trim(); saveState(st); drawLines(); drawList(); };
        btnDel.onclick = ()=>{ r.lines = (r.lines||[]).filter(x=>x.id!==l.id); saveState(st); drawLines(); drawList(); };

        return el("tr",{},[
          el("td",{html:escapeHtml(label)}),
          el("td",{html:escapeHtml(l.kind)}),
          el("td",{html:escapeHtml(unit)}),
          el("td",{class:"right"},[qtyInput]),
          el("td",{class:"right"},[up.toFixed(4)]),
          el("td",{class:"right"},[fmtEUR(costLine)]),
          el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSaveQty, btnDel])])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Zutat"]),
            el("th",{},["Typ"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Menge"]),
            el("th",{class:"right"},["€/Einheit"]),
            el("th",{class:"right"},["Kosten"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody2
      ]));
    }

    const btnSave = el("button",{class:"btn primary"},["Rezept speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Rezept löschen"]);
    const btnAddLine = el("button",{class:"btn primary"},["Zutat hinzufügen"]);

    btnSave.onclick = ()=>{
      r.name = name.value.trim();
      r.topCat = topCat.value.trim();
      r.subCat = subCat.value.trim();
      if(!r.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList(); drawLines();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Rezept wirklich löschen?")) return;
      // also remove menu items referencing it
      st.menuItems = (st.menuItems||[]).filter(mi=> !(mi.kind==="recipe" && mi.recipeId===r.id));
      st.recipes = (st.recipes||[]).filter(x=>x.id!==r.id);
      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = ()=>{
      const k = kindSel.value;
      const q = (qty.value||"").trim();
      if(!q){ alert("Menge fehlt."); return; }

      let refId = null;
      if(k==="inv"){
        if(!(st.inventory||[]).length){ alert("Inventur leer."); return; }
        refId = invSel.value;
      }else{
        if(!(st.preps||[]).length){ alert("Keine Preps vorhanden."); return; }
        refId = prepSel.value;
      }
      if(!refId){ alert("Bitte Auswahl treffen."); return; }

      r.lines = r.lines || [];
      r.lines.push({ id:uuid(), kind:k, refId, qty:q });
      qty.value = "";
      saveState(st);
      drawLines(); drawList();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Top-Kategorie"]), topCat]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Unterkategorie"]), subCat]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Zutaten"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Typ"]), kindSel]),
          el("div",{},[el("div",{class:"label"},["Inventur/Prep"]), invSel, prepSel])
        ]),
        el("div",{class:"label"},["Menge"]), qty,
        el("div",{class:"row", style:"margin-top:10px"},[btnAddLine]),
        el("div",{class:"hr"}),
        linesWrap
      ])
    ]));

    drawLines();
  }

  btnAdd.onclick = ()=>{
    r_msg.textContent = "";
    const item = {
      id: uuid(),
      topCat: (r_top.value||"").trim(),
      subCat: (r_sub.value||"").trim(),
      name: (r_name.value||"").trim(),
      lines: []
    };
    if(!item.name){ r_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.recipes.push(item);
    saveState(st);
    r_name.value="";
    r_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- MENU ADMIN ----------------------- */
function renderMenuAdmin(st, outletId){
  const wrap = el("div",{class:"grid"});

  const mi_name = el("input",{class:"input", placeholder:"Menüartikel Name (z.B. Currywurst Dippers)"});
  const mi_kind = el("select",{class:"input"},[
    el("option",{value:"recipe"},["aus Rezept"]),
    el("option",{value:"bundle"},["aus Bundle"])
  ]);
  const recipeSel = el("select",{class:"input"}, (st.recipes||[]).map(r=>el("option",{value:r.id},[r.name])) );
  const bundleSel = el("select",{class:"input"}, (st.bundles||[]).map(b=>el("option",{value:b.id},[b.name])) );
  bundleSel.style.display = "none";
  mi_kind.onchange = ()=>{
    recipeSel.style.display = (mi_kind.value==="recipe") ? "" : "none";
    bundleSel.style.display = (mi_kind.value==="bundle") ? "" : "none";
  };

  const mi_note = el("input",{class:"input", placeholder:"Notiz (optional)"});
  const mi_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Menüartikel speichern"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Menüartikel bearbeiten"]),
    el("div",{class:"small"},["Noch kein Menüartikel ausgewählt."])
  ]);

  const exportBtn = el("button",{class:"btn"},["Menü Export (CSV)"]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Menü (Admin)"]),
    el("div",{class:"sub"},["Menüartikel = Verkaufsprodukt. VK wird pro Outlet gesetzt (Bestandteil der DB-Berechnung)."]),
    el("div",{class:"label"},["Name"]), mi_name,
    el("div",{class:"label"},["Typ"]), mi_kind,
    el("div",{class:"label"},["Rezept"]), recipeSel,
    el("div",{class:"label", style:"display:none"},["Bundle"]), bundleSel,
    el("div",{class:"label"},["Notiz"]), mi_note,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd, exportBtn]),
    mi_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Menü Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Typ"]),
            el("th",{class:"right"},["VK (Outlet)"]),
            el("th",{class:"right"},["DB % (Outlet)"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function drawList(){
    tbody.innerHTML = "";
    (st.menuItems||[]).forEach(mi=>{
      const price = menuItemPrice(st, outletId, mi);
      const calc = dbCalc(st, outletId, mi, null);
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(mi.name)}),
        el("td",{html:escapeHtml(mi.kind)}),
        el("td",{class:"right"},[fmtEUR(price)]),
        el("td",{class:`right ${calc.dbPct>=0?"ok":"bad"}`},[`${calc.dbPct.toFixed(1)}%`])
      ]);
      tr.onclick = ()=>openEditor(mi.id);
      tbody.appendChild(tr);
    });
  }

  function openEditor(id){
    const mi = (st.menuItems||[]).find(x=>x.id===id);
    if(!mi){
      editor.innerHTML = `<div class="title">Menüartikel bearbeiten</div><div class="small">Noch kein Menüartikel ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Menüartikel: ${escapeHtml(mi.name)}`]));

    const name = el("input",{class:"input", value:mi.name||""});
    const note = el("input",{class:"input", value:mi.note||""});
    const modEnabled = el("select",{class:"input"},[
      el("option",{value:"true"},["Modifiers aktiv"]),
      el("option",{value:"false"},["Modifiers aus"])
    ]);
    modEnabled.value = mi.baseModifiersEnabled ? "true" : "false";

    // outlet price
    const od = st.outletData?.[outletId] || {};
    od.menuPrices = od.menuPrices || {};
    const curPrice = od.menuPrices?.[mi.id]?.price ?? "";
    const priceInput = el("input",{class:"input", inputmode:"decimal", value:String(curPrice), placeholder:"VK Preis für dieses Outlet"});

    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    function refreshSummary(){
      const price = toNumber(priceInput.value);
      const calc = dbCalc(st, outletId, mi, price);
      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        DB: <b class="${calc.db>=0?"ok":"bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct>=0?"ok":"bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;
    }
    priceInput.addEventListener("input", refreshSummary);

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Löschen"]);

    btnSave.onclick = ()=>{
      mi.name = name.value.trim();
      mi.note = note.value.trim();
      mi.baseModifiersEnabled = (modEnabled.value==="true");

      st.outletData[outletId] = st.outletData[outletId] || { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
      st.outletData[outletId].menuPrices = st.outletData[outletId].menuPrices || {};
      st.outletData[outletId].menuPrices[mi.id] = { price: (priceInput.value||"").trim() };

      if(!mi.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      if(toNumber(priceInput.value)<=0){ msg.innerHTML = `<span class="bad">VK muss > 0 sein (Outlet).</span>`; return; }

      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      refreshSummary();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Menüartikel wirklich löschen?")) return;
      st.menuItems = (st.menuItems||[]).filter(x=>x.id!==mi.id);
      // remove prices & modifiers
      for(const oid of Object.keys(st.outletData||{})){
        delete st.outletData[oid]?.menuPrices?.[mi.id];
      }
      delete st.modifiers?.[mi.id];
      // remove from bundles parts
      (st.bundles||[]).forEach(b=> b.parts = (b.parts||[]).filter(p=>p.menuItemId!==mi.id));
      // remove sales
      st.sales = (st.sales||[]).filter(s=>s.menuItemId!==mi.id);
      saveState(st);
      drawList();
      openEditor(null);
    };

    // Modifiers editor (basic)
    const mods = st.modifiers[mi.id] || [];
    const modsWrap = el("div",{class:"card", style:"margin-top:12px"},[
      el("div",{class:"title", style:"font-size:15px"},["Modifiers (Add-ons / Choices)"]),
      el("div",{class:"sub"},["MVP: Du kannst Add-ons + Choices definieren. Berechnung der Modifier-Kosten ist vorbereitet (optional später)."]),
    ]);

    const modsList = el("div",{});
    const btnAddMod = el("button",{class:"btn"},["Modifier hinzufügen"]);

    function drawMods(){
      modsList.innerHTML = "";
      const arr = st.modifiers[mi.id] || [];
      if(!arr.length){
        modsList.appendChild(el("div",{class:"small"},["Noch keine Modifiers."]));
        return;
      }
      arr.forEach(m=>{
        const card = el("div",{class:"card", style:"margin-top:10px"},[
          el("div",{class:"row", style:"justify-content:space-between"},[
            el("div",{html:`<b>${escapeHtml(m.name)}</b> <span class="pill">${escapeHtml(m.type)}</span>`}),
            el("button",{class:"btn danger", onclick:()=>{
              st.modifiers[mi.id] = (st.modifiers[mi.id]||[]).filter(x=>x.id!==m.id);
              saveState(st); drawMods();
            }},["Löschen"])
          ]),
          el("div",{class:"small", html:`required: <b>${m.required?"ja":"nein"}</b> · min/max: <b>${m.min||0}/${m.max||1}</b>`}),
        ]);
        modsList.appendChild(card);
      });
    }

    btnAddMod.onclick = ()=>{
      const name = prompt("Name Modifier (z.B. Extra Sauce, Käse Auswahl):");
      if(!name) return;
      const type = prompt("Typ: addon oder choice", "addon");
      const t = (type||"addon").toLowerCase()==="choice" ? "choice" : "addon";
      const required = confirm("Required?");
      const min = required ? 1 : 0;
      const max = (t==="choice") ? 1 : 3;

      st.modifiers[mi.id] = st.modifiers[mi.id] || [];
      st.modifiers[mi.id].push({ id:uuid(), type:t, name, required, min, max, options:[] });
      saveState(st);
      drawMods();
    };

    modsWrap.appendChild(el("div",{class:"row", style:"margin-top:10px"},[btnAddMod]));
    modsWrap.appendChild(modsList);

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["VK (Outlet)"]), priceInput]),
      el("div",{class:"col-12"},[el("div",{class:"label"},["Notiz"]), note]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Modifiers"]), modEnabled]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[modsWrap])
    ]));

    refreshSummary();
    drawMods();
  }

  btnAdd.onclick = ()=>{
    mi_msg.textContent = "";
    const item = {
      id: uuid(),
      name: (mi_name.value||"").trim(),
      kind: mi_kind.value,
      recipeId: mi_kind.value==="recipe" ? recipeSel.value : null,
      bundleId: mi_kind.value==="bundle" ? bundleSel.value : null,
      baseModifiersEnabled: true,
      note: (mi_note.value||"").trim()
    };
    if(!item.name){ mi_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    if(item.kind==="recipe" && !item.recipeId){ mi_msg.innerHTML = `<span class="bad">Rezept fehlt.</span>`; return; }
    if(item.kind==="bundle" && !item.bundleId){ mi_msg.innerHTML = `<span class="bad">Bundle fehlt.</span>`; return; }

    st.menuItems.push(item);

    // ensure outlet price slot exists
    st.outletData[outletId] = st.outletData[outletId] || { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
    st.outletData[outletId].menuPrices = st.outletData[outletId].menuPrices || {};
    if(!st.outletData[outletId].menuPrices[item.id]){
      st.outletData[outletId].menuPrices[item.id] = { price: "" };
    }

    saveState(st);
    mi_name.value="";
    mi_note.value="";
    mi_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  exportBtn.onclick = ()=>{
    const lines = [];
    lines.push(["menuItemId","name","kind","outletId","outletName","price","cost","db","dbPct"].join(","));
    for(const o of (st.outlets||[])){
      for(const mi of (st.menuItems||[])){
        const price = menuItemPrice(st, o.id, mi);
        const calc = dbCalc(st, o.id, mi, null);
        const row = [
          mi.id, mi.name, mi.kind, o.id, o.name,
          price.toFixed(2),
          calc.cost.toFixed(4),
          calc.db.toFixed(4),
          calc.dbPct.toFixed(2)
        ].map(v=>`"${String(v).replace(/"/g,'""')}"`);
        lines.push(row.join(","));
      }
    }
    downloadBlob("menu_export.csv","text/csv;charset=utf-8", lines.join("\n"));
  };

  drawList();
  return wrap;
}

/* ----------------------- BUNDLES ADMIN ----------------------- */
function renderBundlesAdmin(st, outletId){
  const wrap = el("div",{class:"grid"});

  const b_name = el("input",{class:"input", placeholder:"Bundle Name (z.B. Menü Currywurst + Pommes + Drink)"});
  const b_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Bundle speichern"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Bundle bearbeiten"]),
    el("div",{class:"small"},["Noch kein Bundle ausgewählt."])
  ]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundles (Admin)"]),
    el("div",{class:"sub"},["Bundle = Kombination aus Menüartikeln (Parts). Bundle selbst kann als Menüartikel verkauft werden."]),
    el("div",{class:"label"},["Name"]), b_name,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    b_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundle Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Bundle"]),
            el("th",{class:"right"},["Parts"]),
            el("th",{class:"right"},["Kosten (Outlet)"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function bundleCost(b){
    let sum = 0;
    for(const p of (b.parts||[])){
      const mi = (st.menuItems||[]).find(x=>x.id===p.menuItemId);
      if(!mi) continue;
      sum += menuItemCost(st, outletId, mi) * toNumber(p.qty);
    }
    return sum;
  }

  function drawList(){
    tbody.innerHTML = "";
    (st.bundles||[]).forEach(b=>{
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(b.name)}),
        el("td",{class:"right"},[String((b.parts||[]).length)]),
        el("td",{class:"right"},[fmtEUR(bundleCost(b))])
      ]);
      tr.onclick = ()=>openEditor(b.id);
      tbody.appendChild(tr);
    });
  }

  function openEditor(id){
    const b = (st.bundles||[]).find(x=>x.id===id);
    if(!b){
      editor.innerHTML = `<div class="title">Bundle bearbeiten</div><div class="small">Noch kein Bundle ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Bundle: ${escapeHtml(b.name)}`]));

    const name = el("input",{class:"input", value:b.name||""});
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    const miSel = el("select",{class:"input"}, (st.menuItems||[]).map(mi=>el("option",{value:mi.id},[mi.name])) );
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Qty (z.B. 1)"});

    const partsWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});
    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);

    function drawParts(){
      const cost = bundleCost(b);
      summary.innerHTML = `Bundle Kosten (Outlet): <b>${fmtEUR(cost)}</b>`;

      const tbody2 = el("tbody",{}, (b.parts||[]).map(p=>{
        const mi = (st.menuItems||[]).find(x=>x.id===p.menuItemId);
        const c = mi ? menuItemCost(st, outletId, mi) : 0;

        const qtyInput = el("input",{class:"input", style:"max-width:120px", inputmode:"decimal", value:String(p.qty??"1")});
        const btnSave = el("button",{class:"btn", style:"padding:7px 10px"},["Speichern"]);
        const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

        btnSave.onclick = ()=>{ p.qty = (qtyInput.value||"").trim(); saveState(st); drawParts(); drawList(); };
        btnDel.onclick = ()=>{ b.parts = (b.parts||[]).filter(x=>x.id!==p.id); saveState(st); drawParts(); drawList(); };

        return el("tr",{},[
          el("td",{html:escapeHtml(mi?mi.name:"— (fehlend)")}),
          el("td",{class:"right"},[qtyInput]),
          el("td",{class:"right"},[fmtEUR(c)]),
          el("td",{class:"right"},[fmtEUR(c*toNumber(p.qty))]),
          el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSave, btnDel])])
        ]);
      }));

      partsWrap.innerHTML = "";
      partsWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Menüartikel"]),
            el("th",{class:"right"},["Qty"]),
            el("th",{class:"right"},["Kosten/Einheit"]),
            el("th",{class:"right"},["Kosten total"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody2
      ]));
    }

    const btnSaveB = el("button",{class:"btn primary"},["Speichern"]);
    const btnDelB = el("button",{class:"btn danger"},["Bundle löschen"]);
    const btnAddPart = el("button",{class:"btn primary"},["Part hinzufügen"]);

    btnSaveB.onclick = ()=>{
      b.name = name.value.trim();
      if(!b.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList(); drawParts();
    };

    btnDelB.onclick = ()=>{
      if(!confirm("Bundle wirklich löschen?")) return;
      // remove menu items referencing it
      st.menuItems = (st.menuItems||[]).filter(mi=> !(mi.kind==="bundle" && mi.bundleId===b.id));
      st.bundles = (st.bundles||[]).filter(x=>x.id!==b.id);
      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddPart.onclick = ()=>{
      if(!(st.menuItems||[]).length){ alert("Keine Menüartikel vorhanden."); return; }
      const idMI = miSel.value;
      const q = (qty.value||"").trim();
      if(!idMI || !q){ alert("Bitte Menüartikel + Qty."); return; }
      b.parts = b.parts || [];
      b.parts.push({ id:uuid(), menuItemId:idMI, qty:q });
      qty.value = "";
      saveState(st);
      drawParts(); drawList();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSaveB, btnDelB])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Parts"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Menüartikel"]), miSel]),
          el("div",{},[el("div",{class:"label"},["Qty"]), qty])
        ]),
        el("div",{class:"row", style:"margin-top:10px"},[btnAddPart]),
        el("div",{class:"hr"}),
        partsWrap
      ])
    ]));

    drawParts();
  }

  btnAdd.onclick = ()=>{
    b_msg.textContent = "";
    const item = { id:uuid(), name:(b_name.value||"").trim(), parts:[] };
    if(!item.name){ b_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.bundles.push(item);
    saveState(st);
    b_name.value="";
    b_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- STOCK (Outlet) + Inventory Overrides ----------------------- */
function renderStockOutlet(st, outletId){
  const wrap = el("div",{class:"grid"});
  st.outletData[outletId] = st.outletData[outletId] || { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
  const od = st.outletData[outletId];

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Bestand / Overrides"]),
    el("div",{class:"small"},["Klick auf Artikel zum Bearbeiten."])
  ]);

  const list = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Inventur Artikel – Bestand + Outlet Overrides"]),
    el("div",{class:"sub"},["Bestand ist outlet-spezifisch. Overrides optional (Packpreis/Packgröße)."]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Preis/Einheit (Outlet)"]),
            el("th",{class:"right"},["Bestand (on hand)"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(list);
  wrap.appendChild(editor);

  function draw(){
    tbody.innerHTML = "";
    for(const inv of (st.inventory||[])){
      const eff = effectiveInventoryItem(st, outletId, inv);
      const up = unitPrice(eff);
      const onHand = toNumber(od.stock?.[inv.id]?.onHand ?? 0);

      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(inv.name)}),
        el("td",{html:escapeHtml(inv.unitType)}),
        el("td",{class:"right"},[up.toFixed(4)]),
        el("td",{class:"right"},[String(onHand)])
      ]);
      tr.onclick = ()=>openEditor(inv.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(invId){
    const inv = (st.inventory||[]).find(x=>x.id===invId);
    if(!inv){ return; }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Artikel: ${escapeHtml(inv.name)}`]));

    const stock = od.stock?.[inv.id]?.onHand ?? "";
    const stockInput = el("input",{class:"input", inputmode:"decimal", value:String(stock), placeholder:"Bestand in Einheit (g/ml/stk)"});

    const ov = od.inventoryOverrides?.[inv.id] || {};
    const packSizeOv = el("input",{class:"input", inputmode:"decimal", value:String(ov.packSize??""), placeholder:"Override Packgröße (optional)"});
    const packPriceOv = el("input",{class:"input", inputmode:"decimal", value:String(ov.packPrice??""), placeholder:"Override Packpreis (optional)"});

    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);
    function refresh(){
      const eff = effectiveInventoryItem({
        ...st,
        outletData: {
          ...st.outletData,
          [outletId]: {
            ...od,
            inventoryOverrides: {
              ...od.inventoryOverrides,
              [inv.id]: { packSize: packSizeOv.value, packPrice: packPriceOv.value }
            }
          }
        }
      }, outletId, inv);
      summary.innerHTML = `Preis/Einheit (Outlet): <b>${unitPrice(eff).toFixed(4)} €/${escapeHtml(inv.unitType)}</b>`;
    }
    packSizeOv.addEventListener("input", refresh);
    packPriceOv.addEventListener("input", refresh);

    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
    const btnSave = el("button",{class:"btn primary"},["Speichern"]);

    btnSave.onclick = ()=>{
      od.stock = od.stock || {};
      od.stock[inv.id] = { onHand: (stockInput.value||"").trim() };

      od.inventoryOverrides = od.inventoryOverrides || {};
      const ps = (packSizeOv.value||"").trim();
      const pp = (packPriceOv.value||"").trim();
      if(ps || pp){
        od.inventoryOverrides[inv.id] = { packSize: ps, packPrice: pp };
      }else{
        delete od.inventoryOverrides[inv.id];
      }

      st.outletData[outletId] = od;
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      draw();
      refresh();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Bestand (on hand)"]), stockInput]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Einheit"]), el("div",{class:"badge"},[inv.unitType])]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Override Packgröße"]), packSizeOv]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Override Packpreis"]), packPriceOv]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave])]),
      el("div",{class:"col-12"},[msg])
    ]));

    refresh();
  }

  draw();
  return wrap;
}

/* ----------------------- SALES (Outlet) ----------------------- */
function renderSales(st, outletId){
  const wrap = el("div",{class:"grid"});
  const today = todayISO();

  const s_date = el("input",{class:"input", value:today});
  const s_item = el("select",{class:"input"}, (st.menuItems||[]).map(mi=>el("option",{value:mi.id},[mi.name])) );
  const s_qty = el("input",{class:"input", inputmode:"decimal", placeholder:"z.B. 20"});
  const s_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

  const btnAdd = el("button",{class:"btn primary"},["Speichern"]);
  const tbody = el("tbody",{});
  const summary = el("div",{class:"sub"},[""]);

  const card = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Sales Mix (Outlet)"]),
    el("div",{class:"label"},["Datum"]), s_date,
    el("div",{class:"label"},["Menüartikel"]), s_item,
    el("div",{class:"label"},["Anzahl"]), s_qty,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    s_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Einträge"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:420px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{class:"right"},["Qty"]),
            el("th",{class:"right"},["DB gesamt"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  const sumCard = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Tagesauswertung (Outlet)"]),
    el("div",{class:"hr"}),
    summary
  ]);

  wrap.appendChild(card);
  wrap.appendChild(list);
  wrap.appendChild(sumCard);

  function draw(){
    tbody.innerHTML = "";
    const date = (s_date.value||today).trim();
    const entries = (st.sales||[]).filter(x=>x.outletId===outletId && x.date===date);

    let dbSum=0, revSum=0;
    entries.forEach(e=>{
      const mi = (st.menuItems||[]).find(x=>x.id===e.menuItemId);
      const qty = toNumber(e.qty);
      if(!mi) return;

      const calc = dbCalc(st, outletId, mi, null);
      const lineDb = calc.db * qty;
      const lineRev = calc.price * qty;
      dbSum += lineDb;
      revSum += lineRev;

      const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
      btnDel.onclick = ()=>{
        st.sales = (st.sales||[]).filter(x=>x.id!==e.id);
        saveState(st);
        draw();
      };

      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(mi.name)}),
        el("td",{class:"right"},[String(qty)]),
        el("td",{class:`right ${lineDb>=0?"ok":"bad"}`},[fmtEUR(lineDb)]),
        el("td",{class:"right"},[btnDel])
      ]));
    });

    summary.innerHTML = `
      Umsatz: <b>${fmtEUR(revSum)}</b> ·
      DB: <b class="${dbSum>=0?"ok":"bad"}">${fmtEUR(dbSum)}</b>
    `;
  }

  btnAdd.onclick = ()=>{
    s_msg.textContent="";
    const date = (s_date.value||today).trim();
    const menuItemId = s_item.value;
    const qty = (s_qty.value||"").trim();
    if(!menuItemId){ s_msg.innerHTML = `<span class="bad">Artikel fehlt.</span>`; return; }
    if(!qty){ s_msg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }

    st.sales.push({ id:uuid(), date, outletId, menuItemId, qty });
    saveState(st);
    s_qty.value="";
    s_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  s_date.addEventListener("change", draw);
  draw();
  return wrap;
}

/* ----------------------- PARAMS (Global + Outlet override) ----------------------- */
function renderParams(st, outletId){
  const wrap = el("div",{class:"grid"});
  st.outletData[outletId] = st.outletData[outletId] || { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };
  const od = st.outletData[outletId];

  const p = getOutletParams(st, outletId);

  function inputField(label, key, hint){
    const inp = el("input",{class:"input", inputmode:"decimal", value:String(p[key]??0)});
    const row = el("div",{class:"col-6"},[
      el("div",{class:"label"},[label]),
      inp,
      hint ? el("div",{class:"small"},[hint]) : el("span")
    ]);
    return { row, inp, key };
  }

  const fields = [
    // Fees
    inputField("Plattform Commission %","platformCommissionPct","z.B. 23"),
    inputField("Payment Fee %","paymentFeePct","z.B. 2.9"),
    inputField("Franchise/Brand Fee %","franchisePct","z.B. 10"),
    inputField("Packaging pro Order (€)","packagingPerOrder","z.B. 0.45"),
    inputField("Packaging % vom Umsatz","packagingPctOfRevenue","z.B. 1.5"),
    inputField("Waste / Shrink % auf Wareneinsatz","wastePct","z.B. 3"),

    // Taxes
    inputField("MwSt % (Info/Später Netto/Brutto)","vatPct","z.B. 7"),

    // Fixed costs / month
    inputField("Fixkosten: Miete / Monat","fixedRent","€ pro Monat"),
    inputField("Fixkosten: Staff / Monat","fixedStaff","€ pro Monat"),
    inputField("Fixkosten: Utilities / Monat","fixedUtilities","€ pro Monat"),
    inputField("Fixkosten: Sonstiges / Monat","fixedOther","€ pro Monat"),

    // Invest / month
    inputField("Invest/Lease / Monat","investLeaseMonthly","€ pro Monat"),
    inputField("Loan / Monat","investLoanMonthly","€ pro Monat"),
    inputField("Invest Sonstiges / Monat","investOtherMonthly","€ pro Monat"),

    // Target
    inputField("Ziel DB % (für Hinweise)","targetDBPct","z.B. 30")
  ];

  const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnSaveOutlet = el("button",{class:"btn primary"},["Speichern (Outlet)"]);
  const btnSaveGlobal = el("button",{class:"btn"},["Speichern (Global, Admin)"]);

  btnSaveOutlet.onclick = ()=>{
    od.params = od.params || {};
    for(const f of fields){
      od.params[f.key] = (f.inp.value||"0").trim();
    }
    st.outletData[outletId] = od;
    saveState(st);
    msg.innerHTML = `<span class="ok">Outlet Parameter gespeichert.</span>`;
  };

  btnSaveGlobal.onclick = ()=>{
    if(!isAdmin()){
      msg.innerHTML = `<span class="bad">Nur Admin kann Global speichern.</span>`;
      return;
    }
    st.paramsGlobal = st.paramsGlobal || {};
    for(const f of fields){
      st.paramsGlobal[f.key] = (f.inp.value||"0").trim();
    }
    saveState(st);
    msg.innerHTML = `<span class="ok">Global Parameter gespeichert.</span>`;
  };

  const fixedM = fixedMonthlyTotal(p);
  const fixedD = fixedM / 30;

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Parameter – logisch & vollständig"]),
    el("div",{class:"sub", html: `
      Outlet-Parameter überschreiben Global. <br/>
      Fixkosten gesamt/Monat: <b>${fmtEUR(fixedM)}</b> · pro Tag: <b>${fmtEUR(fixedD)}</b>
    `})
  ]));

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"grid"}, fields.map(f=>f.row)),
    el("div",{class:"row", style:"margin-top:12px"},[
      btnSaveOutlet,
      btnSaveGlobal
    ]),
    msg
  ]));

  return wrap;
}

/* ----------------------- USERS + OUTLETS ADMIN ----------------------- */
function renderUsersAdmin(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  }

  const wrap = el("div",{class:"grid"});

  // OUTLETS
  const o_name = el("input",{class:"input", placeholder:"Outlet Name (z.B. Zürich HB)"});
  const o_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAddOutlet = el("button",{class:"btn primary"},["Outlet hinzufügen"]);

  btnAddOutlet.onclick = ()=>{
    o_msg.textContent="";
    const name = (o_name.value||"").trim();
    if(!name){ o_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    const id = "outlet_" + uuid().slice(0,8);
    st.outlets.push({ id, name });
    st.outletData[id] = { inventoryOverrides:{}, stock:{}, menuPrices:{}, params:{} };

    // give admin access by default
    const admin = (st.users||[]).find(u=>String(u.username||"").toLowerCase()==="admin");
    if(admin){
      admin.outlets = admin.outlets || {};
      admin.outlets[id] = { enabled:true, tabs:{ dashboard:true, sales:true, stock:true, inventory:true, preps:true, recipes:true, menu:true, bundles:true, params:true, users:true } };
    }

    saveState(st);
    o_name.value="";
    o_msg.innerHTML = `<span class="ok">Outlet angelegt.</span>`;
    drawOutlets();
  };

  const outletsWrap = el("div",{});
  function drawOutlets(){
    outletsWrap.innerHTML = "";
    (st.outlets||[]).forEach(o=>{
      outletsWrap.appendChild(el("div",{class:"card", style:"margin-top:10px"},[
        el("div",{class:"row", style:"justify-content:space-between"},[
          el("div",{html:`<b>${escapeHtml(o.name)}</b> <span class="pill">${escapeHtml(o.id)}</span>`}),
          el("button",{class:"btn danger", onclick:()=>{
            if(!confirm("Outlet löschen? (Daten bleiben im State, aber Outlet ist weg)")) return;
            st.outlets = (st.outlets||[]).filter(x=>x.id!==o.id);
            delete st.outletData[o.id];
            (st.users||[]).forEach(u=>{ if(u.outlets) delete u.outlets[o.id]; });
            saveState(st);
            drawOutlets();
          }},["Löschen"])
        ])
      ]));
    });
  }

  // USERS
  const u_name = el("input",{class:"input", placeholder:"username (ohne Leerzeichen)"});
  const u_disp = el("input",{class:"input", placeholder:"Display Name"});
  const u_role = el("select",{class:"input"},[
    el("option",{value:"manager"},["manager"]),
    el("option",{value:"staff"},["staff"]),
    el("option",{value:"admin"},["admin"])
  ]);
  const u_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAddUser = el("button",{class:"btn primary"},["User anlegen"]);

  const usersWrap = el("div",{});
  function drawUsers(){
    usersWrap.innerHTML = "";
    (st.users||[]).forEach(u=>{
      const isA = String(u.username||"").toLowerCase()==="admin";
      const card = el("div",{class:"card", style:"margin-top:10px"},[
        el("div",{class:"row", style:"justify-content:space-between"},[
          el("div",{html:`<b>${escapeHtml(u.displayName||u.username)}</b> · @${escapeHtml(u.username)} · <span class="pill">${escapeHtml(u.roleGlobal||"")}</span>`}),
          isA ? el("span",{class:"small"},["Admin"]) : el("button",{class:"btn danger", onclick:()=>{
            if(!confirm("User löschen?")) return;
            st.users = (st.users||[]).filter(x=>String(x.username||"").toLowerCase()!==String(u.username||"").toLowerCase());
            saveState(st);
            drawUsers();
          }},["Löschen"])
        ]),
      ]);

      // Outlet permissions
      const perm = el("div",{class:"grid", style:"margin-top:10px"});
      (st.outlets||[]).forEach(o=>{
        u.outlets = u.outlets || {};
        u.outlets[o.id] = u.outlets[o.id] || { enabled:false, tabs:{ dashboard:true, sales:true, stock:true } };

        const enabled = el("select",{class:"input"},[
          el("option",{value:"true"},["Zugriff an"]),
          el("option",{value:"false"},["Zugriff aus"])
        ]);
        enabled.value = u.outlets[o.id].enabled ? "true" : "false";

        const tabs = u.outlets[o.id].tabs || {};
        const tabKeys = ["dashboard","sales","stock","inventory","preps","recipes","menu","bundles","params"];
        const tabsSel = el("select",{class:"input", multiple:"multiple", style:"height:140px"}, tabKeys.map(k=>el("option",{value:k},[k])));

        // set selected
        setTimeout(()=>{
          for(const opt of tabsSel.options){
            opt.selected = !!tabs[opt.value];
          }
        },0);

        const box = el("div",{class:"card col-6"},[
          el("div",{html:`<b>${escapeHtml(o.name)}</b>`}),
          el("div",{class:"label"},["Zugriff"]), enabled,
          el("div",{class:"label"},["Tabs (multi-select)"]), tabsSel,
          el("div",{class:"row", style:"margin-top:10px"},[
            el("button",{class:"btn", onclick:()=>{
              const en = enabled.value==="true";
              const selected = {};
              for(const opt of tabsSel.options){ selected[opt.value] = opt.selected; }
              u.outlets[o.id] = { enabled: en, tabs: selected };
              saveState(st);
              alert("Gespeichert.");
            }},["Speichern"])
          ])
        ]);
        perm.appendChild(box);
      });

      card.appendChild(perm);
      usersWrap.appendChild(card);
    });
  }

  btnAddUser.onclick = ()=>{
    u_msg.textContent="";
    const username = (u_name.value||"").trim();
    const displayName = (u_disp.value||"").trim();
    const roleGlobal = u_role.value;

    if(!username){ u_msg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ u_msg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }

    const exists = (st.users||[]).some(x=>String(x.username||"").toLowerCase()===username.toLowerCase());
    if(exists){ u_msg.innerHTML = `<span class="bad">Username existiert schon.</span>`; return; }

    const outlets = {};
    for(const o of (st.outlets||[])){
      outlets[o.id] = {
        enabled: false,
        tabs: { dashboard:true, sales:true, stock:true }
      };
    }

    st.users.push({ id:uuid(), username, displayName: displayName||username, roleGlobal, outlets });
    saveState(st);
    u_name.value=""; u_disp.value="";
    u_msg.innerHTML = `<span class="ok">User angelegt.</span>`;
    drawUsers();
  };

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Outlets"]),
    el("div",{class:"two", style:"margin-top:8px"},[
      el("div",{},[el("div",{class:"label"},["Outlet Name"]), o_name]),
      el("div",{},[el("div",{class:"label"},["Aktion"]), el("div",{class:"row"},[btnAddOutlet])])
    ]),
    o_msg,
    outletsWrap
  ]));

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Users"]),
    el("div",{class:"grid", style:"margin-top:8px"},[
      el("div",{class:"col-4"},[el("div",{class:"label"},["Username"]), u_name]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Display Name"]), u_disp]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Role"]), u_role]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnAddUser]), u_msg])
    ]),
    usersWrap
  ]));

  drawOutlets();
  drawUsers();
  return wrap;
}

/* ----------------------- Boot ----------------------- */
async function boot(){
  injectBaseStyles();
  applyTheme(localStorage.getItem(LS.theme) || "dark");

  if(getWorkspace()) await cloudPullOnStart();

  const s = getSession();
  if(!s) screenLogin();
  else screenApp();
}

document.addEventListener("DOMContentLoaded", boot);
