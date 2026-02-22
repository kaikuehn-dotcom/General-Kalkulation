/* =========================================================
   HEISSE ECKE – WEB APP (Single-File JS, GitHub Pages)
   Multi-Outlet + Roles + Inventory (Global+Outlet Override)
   Recipes (incl. Prep) + Menu Items + Bundles + Daily Sales
   Local Autosave + Supabase Workspace Sync
========================================================= */

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBiYXNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

/* ----------------------- Storage Keys ----------------------- */
const LS = {
  workspace: "he_workspace",
  theme: "he_theme",
  session: "he_session_v2",
  state: "he_state_v3",
  lastSaved: "he_last_saved",
  syncStatus: "he_sync_status",
  activeTab: "he_active_tab_v2",
};

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
function uuid(){
  if(crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

/* --- numbers: allow comma input, store as string, calc with toNumber --- */
function toNumber(x){
  if(x === null || x === undefined) return 0;
  const s = String(x).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n){ return `${(Number.isFinite(n)?n:0).toFixed(2)} €`; }
function fmtPct(n){ return `${(Number.isFinite(n)?n:0).toFixed(1)}%`; }

/* ----------------------- Theme ----------------------- */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS.theme) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ----------------------- State Model -----------------------
  outlets: [{id, name, code, paramsEnabled:true/false}]
  users: [{id, username, displayName, role:'admin'|'manager'|'staff', outletIds:[...]}]

  inventory (global master):
    [{id, group, name, supplier, unitType:'g'|'ml'|'stk', packSize, packPrice}]

  invOutletOverride:
    { [outletId]: { [inventoryId]: { packSize?, packPrice?, supplier?, group?, unitType? } } }
    (nur wenn abweichend)

  invStock:
    { [outletId]: { [inventoryId]: { onHandQty } } }
    onHandQty immer in Basis-Einheit (g/ml/stk)

  recipes (global):
    [{id, topCat, subCat, name, kind:'dish'|'prep', yieldQty, yieldUnit, lines:[
      {id, refType:'inv'|'recipe', refId, qty, unitType:'g'|'ml'|'stk'}
    ]}]

  menuItems (global template):
    [{id, recipeId|null, name, kind:'single'|'bundle', bundleItems:[{menuItemId, qty}], modifiers:[{id, name, defaultQty, invId, unitType}] }]

  menuOutlet:
    { [outletId]: { [menuItemId]: { price } } }  // VK pro Outlet

  paramsGlobal:
    {
      franchisePct, vatPct, platformPct, paymentPct,
      laborPct, fixedCostPerDay, fixedCostPerMonth,
      investmentTotal, depreciationMonths
    }

  sales:
    [{id, outletId, date, menuItemId, qty}]
---------------------------------------------------------- */
function defaultState(){
  const outlet1 = { id: uuid(), name:"Outlet 1", code:"outlet-1", paramsEnabled:true };
  return {
    outlets: [outlet1],
    users: [
      { id: uuid(), username:"admin", displayName:"Admin", role:"admin", outletIds:[outlet1.id] }
    ],
    inventory: [],
    invOutletOverride: {},
    invStock: {},
    recipes: [],
    menuItems: [],
    menuOutlet: {},
    paramsGlobal: {
      franchisePct: "0",
      vatPct: "7",
      platformPct: "0",
      paymentPct: "0",
      laborPct: "0",
      fixedCostPerDay: "0",
      fixedCostPerMonth: "0",
      investmentTotal: "0",
      depreciationMonths: "0"
    },
    sales: []
  };
}

function getWorkspace(){ return (localStorage.getItem(LS.workspace)||"").trim(); }
function setWorkspace(ws){ localStorage.setItem(LS.workspace, ws.trim()); }
function getSession(){ return readLS(LS.session, null); }
function setSession(s){ writeLS(LS.session, s); }
function clearSession(){ localStorage.removeItem(LS.session); }

function loadState(){
  const st = readLS(LS.state, null);
  if(st && typeof st === "object") return st;
  const d = defaultState();
  writeLS(LS.state, d);
  return d;
}
function saveState(st){
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
  }, 700);
}

async function cloudPullOnStart(){
  const ws = getWorkspace();
  if(!ws) return;
  try{
    setSyncStatus("Sync: lade …");
    const row = await supabaseFetch(ws);
    if(row?.data){
      writeLS(LS.state, row.data);
      localStorage.setItem(LS.lastSaved, row.data.savedAt || nowISO());
      setSyncStatus("Sync: geladen ✅");
    }else{
      await supabaseUpsert(ws, { ...loadState(), savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
      setSyncStatus("Sync: initial ✅");
    }
  }catch(e){
    console.error(e);
    setSyncStatus("Sync: Fehler ❌");
  }
}

/* ----------------------- Role / Outlet helpers ----------------------- */
function currentUser(st){
  const s = getSession();
  if(!s) return null;
  return (st.users||[]).find(u => String(u.username||"").toLowerCase() === String(s.username||"").toLowerCase()) || null;
}
function currentOutlet(st){
  const s = getSession();
  if(!s || !s.outletId) return null;
  return (st.outlets||[]).find(o => o.id === s.outletId) || null;
}
function canAdmin(st){
  const u = currentUser(st);
  return u && u.role === "admin";
}
function canManage(st){
  const u = currentUser(st);
  return u && (u.role === "admin" || u.role === "manager");
}
function canSeeOutlet(st, outletId){
  const u = currentUser(st);
  if(!u) return false;
  if(u.role === "admin") return true;
  return (u.outletIds||[]).includes(outletId);
}

/* ----------------------- Calculations ----------------------- */
/* effective inventory item for outlet = global + override */
function getInvEffective(st, outletId, invId){
  const base = (st.inventory||[]).find(x=>x.id===invId);
  if(!base) return null;
  const ovr = st.invOutletOverride?.[outletId]?.[invId] || null;
  return { ...base, ...(ovr||{}) };
}
function unitPriceEffective(inv){
  const packPrice = toNumber(inv.packPrice);
  const packSize = toNumber(inv.packSize);
  if(packPrice <= 0) return 0;
  if(inv.unitType === "stk"){
    const denom = packSize > 0 ? packSize : 1;
    return packPrice / denom; // €/stk
  }
  if(packSize <= 0) return 0;
  return packPrice / packSize; // €/g or €/ml
}

/* recipe cost per base unit of its yield, if kind=prep; otherwise per serving (as defined by qty in lines) */
function computeRecipeUnitCost(st, outletId, recipeId, memo = {}){
  if(memo[recipeId] !== undefined) return memo[recipeId];

  const r = (st.recipes||[]).find(x=>x.id===recipeId);
  if(!r){ memo[recipeId]=0; return 0; }

  let totalCost = 0;
  for(const line of (r.lines||[])){
    const qty = toNumber(line.qty);
    if(qty <= 0) continue;

    if(line.refType === "inv"){
      const inv = getInvEffective(st, outletId, line.refId);
      if(!inv) continue;
      totalCost += qty * unitPriceEffective(inv);
    } else if(line.refType === "recipe"){
      const sub = (st.recipes||[]).find(x=>x.id===line.refId);
      if(!sub) continue;
      // sub-recipe must have yield
      const subYieldQty = toNumber(sub.yieldQty);
      if(subYieldQty <= 0){ continue; }
      const subUnitCost = computeRecipeUnitCost(st, outletId, sub.id, memo); // €/yieldUnit
      // qty is in same unit as sub.yieldUnit
      totalCost += qty * subUnitCost;
    }
  }

  if(r.kind === "prep"){
    const y = toNumber(r.yieldQty);
    if(y > 0){
      const perUnit = totalCost / y;
      memo[recipeId]=perUnit;
      return perUnit;
    }
    memo[recipeId]=0;
    return 0;
  }

  // dish: cost is totalCost as defined by ingredient lines; treat as "per serving"
  memo[recipeId]=totalCost;
  return totalCost;
}

function computeDishCost(st, outletId, recipeId){
  const memo = {};
  const r = (st.recipes||[]).find(x=>x.id===recipeId);
  if(!r) return 0;
  if(r.kind !== "dish") return 0;

  let total = 0;
  for(const line of (r.lines||[])){
    const qty = toNumber(line.qty);
    if(qty<=0) continue;

    if(line.refType === "inv"){
      const inv = getInvEffective(st, outletId, line.refId);
      if(!inv) continue;
      total += qty * unitPriceEffective(inv);
    } else if(line.refType === "recipe"){
      const sub = (st.recipes||[]).find(x=>x.id===line.refId);
      if(!sub) continue;
      const subUnitCost = computeRecipeUnitCost(st, outletId, sub.id, memo); // €/yieldUnit
      total += qty * subUnitCost;
    }
  }
  return total;
}

/* menu item cost: if single -> dish cost; if bundle -> sum of child menu item costs * qty */
function computeMenuItemCost(st, outletId, menuItemId, stack = new Set()){
  if(stack.has(menuItemId)) return 0;
  stack.add(menuItemId);

  const mi = (st.menuItems||[]).find(x=>x.id===menuItemId);
  if(!mi){ stack.delete(menuItemId); return 0; }

  let cost = 0;
  if(mi.kind === "single"){
    if(mi.recipeId) cost = computeDishCost(st, outletId, mi.recipeId);
  } else if(mi.kind === "bundle"){
    for(const bi of (mi.bundleItems||[])){
      cost += computeMenuItemCost(st, outletId, bi.menuItemId, stack) * toNumber(bi.qty || 1);
    }
  }
  // modifiers default cost not automatically added (optional later)
  stack.delete(menuItemId);
  return cost;
}

function getMenuPrice(st, outletId, menuItemId){
  const ov = st.menuOutlet?.[outletId]?.[menuItemId];
  if(ov && ov.price !== undefined && ov.price !== null && String(ov.price).trim() !== "") return toNumber(ov.price);
  return 0;
}

function calcDBFromPrice(price, cost, params){
  const franchisePct = toNumber(params.franchisePct)/100;
  const platformPct = toNumber(params.platformPct)/100;
  const paymentPct  = toNumber(params.paymentPct)/100;
  const laborPct    = toNumber(params.laborPct)/100;

  const variableFees = price*(franchisePct + platformPct + paymentPct + laborPct);
  const db = price - cost - variableFees;
  const dbPct = price>0 ? (db/price)*100 : 0;
  return { db, dbPct, variableFees };
}

/* fixed cost / investment handling (global, optionally enabled per outlet) */
function calcFixedCostPerDay(params){
  const fixedDay = toNumber(params.fixedCostPerDay);
  const fixedMonth = toNumber(params.fixedCostPerMonth);
  const depMonths = toNumber(params.depreciationMonths);
  const invTotal = toNumber(params.investmentTotal);

  // simple: monthly -> daily (30)
  const monthlyToDaily = fixedMonth / 30;

  // investment depreciation monthly -> daily
  let depDaily = 0;
  if(invTotal>0 && depMonths>0){
    const depMonthly = invTotal / depMonths;
    depDaily = depMonthly / 30;
  }
  return fixedDay + monthlyToDaily + depDaily;
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
      --input:#0f1522; --tab:#0e1420;
    }
    :root[data-theme="light"]{
      --bg:#f5f7fb; --card:#ffffff; --text:#111827; --muted:#516072;
      --border:#d9e1ee; --primary:#2563eb; --danger:#dc2626; --ok:#16a34a;
      --input:#f3f6fb; --tab:#f0f4fa;
    }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
    .container{ max-width:1100px; margin:0 auto; padding:16px; }
    .topbar{ display:flex; gap:12px; align-items:flex-start; justify-content:space-between; }
    .title{ font-size:18px; font-weight:800; }
    .sub{ color:var(--muted); font-size:12px; line-height:1.35; }
    .card{ background:var(--card); border:1px solid var(--border); border-radius:14px; padding:14px; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn{ border:1px solid var(--border); background:transparent; color:var(--text); padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:700; }
    .btn.primary{ background:var(--primary); border-color:transparent; color:#fff; }
    .btn.danger{ background:var(--danger); border-color:transparent; color:#fff; }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .input, select, textarea{
      width:100%; padding:10px 10px; border-radius:10px;
      border:1px solid var(--border); background:var(--input);
      color:var(--text); outline:none; box-sizing:border-box;
    }
    .label{ font-size:12px; color:var(--muted); margin-top:10px; margin-bottom:6px; }
    .grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:12px; }
    .col-12{ grid-column: span 12; } .col-6{ grid-column: span 6; } .col-4{ grid-column: span 4; } .col-8{ grid-column: span 8; } .col-3{ grid-column: span 3; } .col-9{ grid-column: span 9; }
    @media (max-width: 900px){ .col-6,.col-4,.col-8,.col-3,.col-9{ grid-column: span 12; } }
    .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
    .tab{ background:var(--tab); border:1px solid var(--border); padding:9px 10px; border-radius:10px; cursor:pointer; font-weight:800; color:var(--text); }
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
    .muted{ color:var(--muted); }
    .note{ border:1px dashed var(--border); padding:10px; border-radius:12px; color:var(--muted); font-size:12px; }
    .lock{ opacity:.6; }
    .kpi{ display:flex; gap:10px; flex-wrap:wrap; }
    .kpi .card{ flex:1; min-width: 240px; }
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

/* ----------------------- Login Screen ----------------------- */
function screenLogin(){
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const ws = getWorkspace();
  const wsInput = el("input", { class:"input", value: ws, placeholder:"z.B. heisse-ecke" });

  const userInput = el("input", { class:"input", placeholder:"Username (vom Admin angelegt)" });

  const outletSelect = el("select", { class:"input" }, [
    el("option", { value:"" }, ["— Outlet wählen (Pflicht) —"])
  ]);

  const msg = el("div", { class:"small", style:"margin-top:10px" }, [""]);

  const btnLogin = el("button", { class:"btn primary" }, ["Weiter"]);
  const btnTheme = el("button", { class:"btn" }, ["Hell/Dunkel"]);
  btnTheme.onclick = toggleTheme;

  const outletHint = el("div", { class:"small", style:"margin-top:8px" }, [
    "Hinweis: Outlet-Auswahl ist Pflicht."
  ]);

  async function refreshOutlets(){
    msg.textContent = "";
    const w = (wsInput.value || "").trim();
    if(!w){
      outletSelect.innerHTML = "";
      outletSelect.appendChild(el("option", { value:"" }, ["— Outlet wählen (Pflicht) —"]));
      return;
    }
    setWorkspace(w);
    await cloudPullOnStart();
    const st = loadState();
    outletSelect.innerHTML = "";
    outletSelect.appendChild(el("option", { value:"" }, ["— Outlet wählen (Pflicht) —"]));
    (st.outlets||[]).forEach(o=>{
      outletSelect.appendChild(el("option", { value:o.id }, [o.name]));
    });
  }

  wsInput.addEventListener("blur", refreshOutlets);

  btnLogin.onclick = async ()=>{
    msg.textContent = "";
    const w = (wsInput.value || "").trim();
    const u = (userInput.value || "").trim();
    const outletId = outletSelect.value;

    if(!w){ msg.textContent = "Workspace ist Pflicht."; return; }
    if(!u){ msg.textContent = "Username fehlt."; return; }
    if(!outletId){ msg.textContent = "Outlet muss gewählt werden."; return; }

    setWorkspace(w);
    await cloudPullOnStart();

    const st = loadState();
    const user = (st.users || []).find(x => String(x.username||"").toLowerCase() === u.toLowerCase());
    if(!user){ msg.textContent = "Unbekannter User (Admin muss dich anlegen)."; return; }
    if(!canSeeOutlet(st, outletId)){
      msg.textContent = "Du hast keinen Zugriff auf dieses Outlet.";
      return;
    }

    setSession({ username: user.username, displayName: user.displayName || user.username, outletId });
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
    outletSelect,
    outletHint,
    el("div", { class:"row", style:"margin-top:12px" }, [btnLogin, btnTheme]),
    msg
  ]);

  const info = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Was diese Version kann (MVP)"]),
    el("div", { class:"sub", html: `
      ✅ Multi-Outlet + Rollen (Admin/Manager/Staff)<br/>
      ✅ Inventur: globaler Stamm + Outlet-Preis/Pack-Overrides<br/>
      ✅ Bestände je Outlet + Verbrauch aus Daily Sales<br/>
      ✅ Rezepte inkl. Prep-Rezepte (Sauce etc.) als Zutat nutzbar<br/>
      ✅ Menüartikel + Bundles + VK manuell je Outlet<br/>
      ✅ Deckungsbeitrag € / % + Tages-DB<br/>
      ✅ Autosave lokal + Supabase Sync (Workspace)<br/>
      ✅ Hell/Dunkel + Mobile/Tablet/PC Layout
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

  // auto load outlets if ws exists
  if(ws) refreshOutlets();
}

/* ----------------------- App Shell ----------------------- */
function screenApp(){
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const st = loadState();
  const s = getSession();
  if(!s){ screenLogin(); return; }

  const ws = getWorkspace();
  if(!ws){ clearSession(); screenLogin(); return; }

  const u = currentUser(st);
  const out = currentOutlet(st);
  if(!u || !out){
    clearSession();
    screenLogin();
    return;
  }

  const outletSelect = el("select", { class:"input", style:"max-width:260px" }, []);
  (st.outlets||[]).forEach(o=>{
    if(canSeeOutlet(st, o.id)){
      outletSelect.appendChild(el("option", { value:o.id }, [o.name]));
    }
  });
  outletSelect.value = s.outletId;

  outletSelect.onchange = ()=>{
    const outletId = outletSelect.value;
    setSession({ ...s, outletId });
    screenApp();
  };

  const header = el("div", { class:"topbar" }, [
    el("div", {}, [
      el("div", { class:"title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", { class:"sub", html: `
        Workspace: <b>${escapeHtml(ws)}</b> · <span id="syncStatus">${escapeHtml(localStorage.getItem(LS.syncStatus) || "Sync: bereit")}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(s.username)}) · Rolle: <b>${escapeHtml(u.role)}</b><br/>
        Letzte Speicherung: <b>${escapeHtml(localStorage.getItem(LS.lastSaved) || "—")}</b>
      `})
    ]),
    el("div", { class:"row" }, [
      el("div", { style:"min-width:260px" }, [
        el("div",{class:"small"},["Outlet wechseln"]),
        outletSelect
      ]),
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
      tabBtn("dashboard", "Dashboard", true),
      tabBtn("inventory", "Inventur", true),
      tabBtn("recipes", "Rezepte", true),
      tabBtn("menu", "Menüartikel", true),
      tabBtn("sales", "Daily Sales", true),
      tabBtn("stock", "Bestand/Verbrauch", true),
      tabBtn("params", "Parameter", true),
      tabBtn("admin", "Admin", canAdmin(st))
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
  const out = currentOutlet(st);
  if(!out){
    content.appendChild(el("div",{class:"card"},[
      el("div",{class:"title"},["Kein Outlet gewählt."]),
      el("div",{class:"sub"},["Bitte ausloggen und Outlet korrekt wählen."])
    ]));
    return;
  }

  if(tab === "dashboard") content.appendChild(renderDashboard(st, out.id));
  if(tab === "inventory") content.appendChild(renderInventory(st, out.id));
  if(tab === "recipes") content.appendChild(renderRecipes(st, out.id));
  if(tab === "menu") content.appendChild(renderMenu(st, out.id));
  if(tab === "sales") content.appendChild(renderSales(st, out.id));
  if(tab === "stock") content.appendChild(renderStock(st, out.id));
  if(tab === "params") content.appendChild(renderParams(st, out.id));
  if(tab === "admin") content.appendChild(renderAdmin(st, out.id));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st, outletId){
  const out = (st.outlets||[]).find(o=>o.id===outletId);
  const paramsEnabled = out?.paramsEnabled ?? true;
  const params = st.paramsGlobal || {};

  const today = todayISO();
  const salesToday = (st.sales||[]).filter(s=>s.outletId === outletId && s.date === today);

  // menu kpis
  const menuRows = (st.menuItems||[]).map(mi=>{
    const price = getMenuPrice(st, outletId, mi.id);
    const cost = computeMenuItemCost(st, outletId, mi.id);
    const { db, dbPct } = calcDBFromPrice(price, cost, paramsEnabled ? params : {...params, franchisePct:"0", platformPct:"0", paymentPct:"0", laborPct:"0"});
    return { id:mi.id, name:mi.name, kind:mi.kind, price, cost, db, dbPct };
  }).sort((a,b)=> a.name.localeCompare(b.name));

  // today DB
  let dbToday = 0;
  let revToday = 0;
  let costToday = 0;
  for(const s of salesToday){
    const mi = (st.menuItems||[]).find(x=>x.id===s.menuItemId);
    if(!mi) continue;
    const price = getMenuPrice(st, outletId, mi.id);
    const cost = computeMenuItemCost(st, outletId, mi.id);
    const { db } = calcDBFromPrice(price, cost, paramsEnabled ? params : {...params, franchisePct:"0", platformPct:"0", paymentPct:"0", laborPct:"0"});
    const q = toNumber(s.qty);
    revToday += price*q;
    costToday += cost*q;
    dbToday += db*q;
  }

  const fixedDaily = paramsEnabled ? calcFixedCostPerDay(params) : 0;
  const dbAfterFixed = dbToday - fixedDaily;

  const kpis = el("div",{class:"kpi col-12"},[
    el("div",{class:"card"},[
      el("div",{class:"title"},["Heute"]),
      el("div",{class:"sub", html: `
        Datum: <b>${today}</b><br/>
        Einträge: <b>${salesToday.length}</b><br/>
        Umsatz: <b>${fmtEUR(revToday)}</b><br/>
        Wareneinsatz: <b>${fmtEUR(costToday)}</b><br/>
        DB (variabel): <b class="${dbToday>=0?"ok":"bad"}">${fmtEUR(dbToday)}</b><br/>
        Fixkosten/Tag (gerechnet): <b>${fmtEUR(fixedDaily)}</b><br/>
        DB nach Fix: <b class="${dbAfterFixed>=0?"ok":"bad"}">${fmtEUR(dbAfterFixed)}</b>
      `})
    ]),
    el("div",{class:"card"},[
      el("div",{class:"title"},["Status"]),
      el("div",{class:"sub", html: `
        Inventur Artikel (global): <b>${(st.inventory||[]).length}</b><br/>
        Rezepte: <b>${(st.recipes||[]).length}</b><br/>
        Menüartikel: <b>${(st.menuItems||[]).length}</b><br/>
        Parameter aktiv (Outlet): <b>${paramsEnabled ? "JA" : "NEIN"}</b><br/>
      `})
    ]),
    el("div",{class:"card"},[
      el("div",{class:"title"},["Wichtig"]),
      el("div",{class:"sub", html: `
        - Preise (VK) sind <b>pro Outlet</b>.<br/>
        - Inventurpreise sind global, aber <b>pro Outlet überschreibbar</b>.<br/>
        - Prep-Rezepte (Sauce) brauchen <b>Yield</b> (z.B. 1000 g).<br/>
      `})
    ])
  ]);

  const table = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Menüartikel – DB Übersicht"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Artikel"]),
            el("th", {}, ["Typ"]),
            el("th", { class:"right" }, ["Preis (VK)"]),
            el("th", { class:"right" }, ["Wareneinsatz"]),
            el("th", { class:"right" }, ["DB €"]),
            el("th", { class:"right" }, ["DB %"])
          ])
        ]),
        el("tbody", {}, menuRows.map(r=>{
          return el("tr", {}, [
            el("td", { html: escapeHtml(r.name) }),
            el("td", { html: escapeHtml(r.kind) }),
            el("td", { class:"right" }, [fmtEUR(r.price)]),
            el("td", { class:"right" }, [fmtEUR(r.cost)]),
            el("td", { class:`right ${r.db>=0?"ok":"bad"}` }, [fmtEUR(r.db)]),
            el("td", { class:`right ${r.dbPct>=0?"ok":"bad"}` }, [fmtPct(r.dbPct)])
          ]);
        }))
      ])
    ])
  ]);

  return el("div",{class:"grid"},[kpis, table]);
}

/* ----------------------- Inventory (Global + Outlet Override) ----------------------- */
function renderInventory(st, outletId){
  const wrap = el("div",{class:"grid"});
  const admin = canAdmin(st);

  const note = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Inventur (Hybrid A+B)"]),
    el("div",{class:"sub", html: `
      <b>Globaler Artikelstamm</b> + <b>Outlet-Override</b> für Packpreis/Packgröße (wenn abweichend).<br/>
      Rolle: <b>${admin ? "Admin (darf alles)" : "Nicht-Admin (nur Bestände, keine Preise/Artikel)"}</b>
    `}),
    el("div",{class:"note", html: `
      Import: Bitte Excel → CSV exportieren (UTF-8). Spalten: group,name,supplier,unitType,packSize,packPrice
    `})
  ]);
  wrap.appendChild(note);

  // CSV Import (Admin only)
  const file = el("input", { class:"input", type:"file", accept:".csv,text/csv" });
  const importMsg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
  const btnImport = el("button", { class:"btn primary" }, ["CSV importieren (Inventur)"]);
  btnImport.disabled = !admin;

  btnImport.onclick = async ()=>{
    importMsg.textContent = "";
    if(!admin){ importMsg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    const f = file.files?.[0];
    if(!f){ importMsg.innerHTML = `<span class="bad">Bitte CSV Datei wählen.</span>`; return; }
    const text = await f.text();
    const rows = parseCSV(text);
    if(rows.length === 0){ importMsg.innerHTML = `<span class="bad">Keine Zeilen gefunden.</span>`; return; }

    // expects header
    const header = Object.keys(rows[0]||{});
    const need = ["group","name","supplier","unitType","packSize","packPrice"];
    const missing = need.filter(k=>!header.includes(k));
    if(missing.length){
      importMsg.innerHTML = `<span class="bad">CSV Header fehlt: ${missing.join(", ")}</span>`;
      return;
    }

    let added = 0;
    for(const r of rows){
      const name = String(r.name||"").trim();
      if(!name) continue;
      // if exists by name+unitType, skip
      const unitType = String(r.unitType||"").trim() || "g";
      const exists = (st.inventory||[]).some(x => String(x.name||"").toLowerCase()===name.toLowerCase() && String(x.unitType||"")===unitType);
      if(exists) continue;

      st.inventory.push({
        id: uuid(),
        group: String(r.group||"").trim(),
        name,
        supplier: String(r.supplier||"").trim(),
        unitType: unitType,
        packSize: String(r.packSize||"").trim(),
        packPrice: String(r.packPrice||"").trim()
      });
      added++;
    }
    saveState(st);
    importMsg.innerHTML = `<span class="ok">Import fertig. Neu: ${added}</span>`;
    renderActiveTab("inventory");
  };

  const importCard = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Inventur Import (CSV)"]),
    el("div",{class:"label"},["CSV Datei"]), file,
    el("div",{class:"row", style:"margin-top:12px"},[btnImport]),
    importMsg
  ]);
  wrap.appendChild(importCard);

  // Add item (Admin only)
  const inv_group = el("input",{class:"input", placeholder:"Warengruppe (wie in Inventur)"});
  const inv_name = el("input",{class:"input", placeholder:"Artikelname"});
  const inv_supplier = el("input",{class:"input", placeholder:"Lieferant"});
  const inv_unit = el("select",{class:"input"},[
    el("option",{value:"g"},["g"]),
    el("option",{value:"ml"},["ml"]),
    el("option",{value:"stk"},["stk"]),
  ]);
  const inv_packSize = el("input",{class:"input", inputmode:"decimal", placeholder:"Packgröße (z.B. 1000)"});
  const inv_packPrice = el("input",{class:"input", inputmode:"decimal", placeholder:"Packpreis € (z.B. 12,50)"});
  const inv_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Artikel anlegen"]);
  btnAdd.disabled = !admin;

  btnAdd.onclick = ()=>{
    inv_msg.textContent = "";
    if(!admin){ inv_msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    const name = (inv_name.value||"").trim();
    if(!name){ inv_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.inventory.push({
      id: uuid(),
      group: (inv_group.value||"").trim(),
      name,
      supplier: (inv_supplier.value||"").trim(),
      unitType: inv_unit.value,
      packSize: (inv_packSize.value||"").trim(),
      packPrice: (inv_packPrice.value||"").trim(),
    });
    saveState(st);
    inv_name.value=""; inv_packSize.value=""; inv_packPrice.value="";
    inv_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    renderActiveTab("inventory");
  };

  const addCard = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Artikel anlegen (Admin)"]),
    el("div",{class:"label"},["Warengruppe"]), inv_group,
    el("div",{class:"label"},["Artikelname"]), inv_name,
    el("div",{class:"label"},["Lieferant"]), inv_supplier,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Einheit"]), inv_unit]),
      el("div",{},[el("div",{class:"label"},["Packgröße"]), inv_packSize]),
    ]),
    el("div",{class:"label"},["Packpreis (€)"]), inv_packPrice,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    inv_msg
  ]);
  wrap.appendChild(addCard);

  // list + edit (global base, outlet override, stock)
  const tbody = el("tbody",{});
  const table = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Inventur Liste – Global + Outlet"]),
    el("div",{class:"sub"},["Klick auf Zeile zum Editieren. Nicht-Admin kann nur Bestand ändern."]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Warengruppe"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Pack (global)"]),
            el("th",{class:"right"},["€ Pack (global)"]),
            el("th",{class:"right"},["€ / Einheit (effektiv)"]),
            el("th",{class:"right"},["Bestand (Outlet)"])
          ])
        ]),
        tbody
      ])
    ])
  ]);
  wrap.appendChild(table);

  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Editor"]),
    el("div",{class:"small"},["Wähle einen Artikel aus der Liste."])
  ]);
  wrap.appendChild(editor);

  function getStock(invId){
    const qty = st.invStock?.[outletId]?.[invId]?.onHandQty;
    return (qty===undefined || qty===null) ? "" : String(qty);
  }
  function setStock(invId, qtyStr){
    st.invStock = st.invStock || {};
    st.invStock[outletId] = st.invStock[outletId] || {};
    st.invStock[outletId][invId] = st.invStock[outletId][invId] || {};
    st.invStock[outletId][invId].onHandQty = (qtyStr||"").trim();
  }
  function getOverride(invId){
    return st.invOutletOverride?.[outletId]?.[invId] || null;
  }
  function setOverride(invId, ovr){
    st.invOutletOverride = st.invOutletOverride || {};
    st.invOutletOverride[outletId] = st.invOutletOverride[outletId] || {};
    st.invOutletOverride[outletId][invId] = ovr;
  }

  function draw(){
    tbody.innerHTML="";
    for(const inv of (st.inventory||[])){
      const eff = getInvEffective(st, outletId, inv.id);
      const up = eff ? unitPriceEffective(eff) : 0;
      const stock = getStock(inv.id);

      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(inv.name)}),
        el("td",{html:escapeHtml(inv.group||"")}),
        el("td",{html:escapeHtml(inv.unitType)}),
        el("td",{class:"right"},[String(inv.packSize||"")]),
        el("td",{class:"right"},[String(inv.packPrice||"")]),
        el("td",{class:"right"},[up.toFixed(4)]),
        el("td",{class:"right"},[stock || ""])
      ]);
      tr.onclick = ()=> openEditor(inv.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(invId){
    const inv = (st.inventory||[]).find(x=>x.id===invId);
    if(!inv){
      editor.innerHTML = `<div class="title">Editor</div><div class="small">Wähle einen Artikel aus der Liste.</div>`;
      return;
    }
    const eff = getInvEffective(st, outletId, invId);
    const ovr = getOverride(invId);

    editor.innerHTML="";
    editor.appendChild(el("div",{class:"title"},[`Artikel: ${escapeHtml(inv.name)}`]));
    editor.appendChild(el("div",{class:"sub"},[
      `Global (Stamm) + Outlet Override. Rolle: ${canAdmin(st) ? "Admin" : "Nicht-Admin"}`
    ]));

    // Global fields (Admin only)
    const g_group = el("input",{class:"input", value:inv.group||""});
    const g_name = el("input",{class:"input", value:inv.name||""});
    const g_supplier = el("input",{class:"input", value:inv.supplier||""});
    const g_unit = el("select",{class:"input"},[
      el("option",{value:"g"},["g"]),
      el("option",{value:"ml"},["ml"]),
      el("option",{value:"stk"},["stk"]),
    ]);
    g_unit.value = inv.unitType || "g";
    const g_packSize = el("input",{class:"input", inputmode:"decimal", value:String(inv.packSize||"")});
    const g_packPrice = el("input",{class:"input", inputmode:"decimal", value:String(inv.packPrice||"")});

    [g_group,g_name,g_supplier,g_unit,g_packSize,g_packPrice].forEach(n=> n.disabled = !canAdmin(st));

    // Outlet override (Admin only, optional)
    const o_packSize = el("input",{class:"input", inputmode:"decimal", value: String(ovr?.packSize ?? "") , placeholder:"leer = global"});
    const o_packPrice = el("input",{class:"input", inputmode:"decimal", value: String(ovr?.packPrice ?? "") , placeholder:"leer = global"});
    [o_packSize,o_packPrice].forEach(n=> n.disabled = !canAdmin(st));

    // Stock (Manager/Staff can edit)
    const stock = el("input",{class:"input", inputmode:"decimal", value: getStock(invId), placeholder:`Bestand in ${inv.unitType}` });

    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
    const kpi = el("div",{class:"sub", style:"margin-top:8px"},[""]);

    function refreshKpi(){
      const tmpEff = {
        ...eff,
        packSize: (o_packSize.value||"").trim() ? o_packSize.value : (g_packSize.value||""),
        packPrice: (o_packPrice.value||"").trim() ? o_packPrice.value : (g_packPrice.value||""),
        unitType: g_unit.value
      };
      kpi.innerHTML = `Effektiver Preis/Einheit: <b>${unitPriceEffective(tmpEff).toFixed(4)} €/ ${escapeHtml(tmpEff.unitType)}</b>`;
    }
    [g_packSize,g_packPrice,g_unit,o_packSize,o_packPrice].forEach(n=> n.addEventListener("change", refreshKpi));
    refreshKpi();

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Löschen (Admin)"]);
    btnDel.disabled = !canAdmin(st);

    btnSave.onclick = ()=>{
      msg.textContent = "";

      // stock always allowed for manager/staff/admin
      setStock(invId, stock.value);

      if(canAdmin(st)){
        inv.group = (g_group.value||"").trim();
        inv.name = (g_name.value||"").trim();
        inv.supplier = (g_supplier.value||"").trim();
        inv.unitType = g_unit.value;
        inv.packSize = (g_packSize.value||"").trim();
        inv.packPrice = (g_packPrice.value||"").trim();

        const nextOverride = {};
        if((o_packSize.value||"").trim()) nextOverride.packSize = (o_packSize.value||"").trim();
        if((o_packPrice.value||"").trim()) nextOverride.packPrice = (o_packPrice.value||"").trim();

        // if empty -> remove override
        if(Object.keys(nextOverride).length){
          setOverride(invId, nextOverride);
        } else {
          if(st.invOutletOverride?.[outletId]) delete st.invOutletOverride[outletId][invId];
        }
      }

      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      draw();
      refreshKpi();
    };

    btnDel.onclick = ()=>{
      if(!canAdmin(st)) return;
      if(!confirm("Artikel wirklich löschen? (Rezepte/Menü können Zuordnung verlieren)")) return;

      // remove from inventory
      st.inventory = (st.inventory||[]).filter(x=>x.id!==invId);

      // remove overrides/stocks
      if(st.invOutletOverride?.[outletId]) delete st.invOutletOverride[outletId][invId];
      if(st.invStock?.[outletId]) delete st.invStock[outletId][invId];

      // remove from recipes
      (st.recipes||[]).forEach(r=>{
        r.lines = (r.lines||[]).filter(l => !(l.refType==="inv" && l.refId===invId));
      });

      saveState(st);
      renderActiveTab("inventory");
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Global (Stamm)"]),
        el("div",{class:"small"},[canAdmin(st) ? "Admin darf ändern" : "gesperrt"])
      ]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), g_name]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Warengruppe"]), g_group]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Lieferant"]), g_supplier]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Einheit"]), g_unit]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Packgröße (global)"]), g_packSize]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Packpreis € (global)"]), g_packPrice]),

      el("div",{class:"col-12"},[el("div",{class:"hr"})]),

      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Outlet Override (optional)"]),
        el("div",{class:"small"},["Nur wenn Outlet abweichende Einkaufspreise hat."])
      ]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Packgröße Override"]), o_packSize]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Packpreis € Override"]), o_packPrice]),
      el("div",{class:"col-12"},[kpi]),

      el("div",{class:"col-12"},[el("div",{class:"hr"})]),

      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Bestand (Outlet)"]),
        el("div",{class:"small"},["Manager/Staff dürfen Bestand pflegen. Einheit = Basis (g/ml/stk)."])
      ]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Bestand"]), stock]),

      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
    ]));
  }

  draw();
  return wrap;
}

/* ----------------------- Recipes (Global, incl Prep) ----------------------- */
function renderRecipes(st, outletId){
  const wrap = el("div",{class:"grid"});
  const admin = canAdmin(st);

  const note = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Rezepte (Global)"]),
    el("div",{class:"sub", html: `
      Admin legt Rezepte an/ändert sie. Prep-Rezepte (Sauce) haben Yield (z.B. 1000 g).<br/>
      Nicht-Admin: nur ansehen.
    `})
  ]);
  wrap.appendChild(note);

  const r_kind = el("select",{class:"input"},[
    el("option",{value:"dish"},["dish (Gericht)"]),
    el("option",{value:"prep"},["prep (Sauce/Prep)"]),
  ]);
  const r_top = el("input",{class:"input", placeholder:"Top-Kategorie (Speisen/ Getränke/ Prep)"});
  const r_sub = el("input",{class:"input", placeholder:"Unterkategorie (z.B. Currywurst / Saucen)"});
  const r_name = el("input",{class:"input", placeholder:"Name"});
  const r_yieldQty = el("input",{class:"input", inputmode:"decimal", placeholder:"Yield Menge (nur prep)", value:""});
  const r_yieldUnit = el("select",{class:"input"},[
    el("option",{value:"g"},["g"]),
    el("option",{value:"ml"},["ml"]),
    el("option",{value:"stk"},["stk"]),
  ]);
  const r_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Rezept speichern"]);
  btnAdd.disabled = !admin;

  btnAdd.onclick = ()=>{
    r_msg.textContent="";
    if(!admin){ r_msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    const name = (r_name.value||"").trim();
    if(!name){ r_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }

    const kind = r_kind.value;
    const recipe = {
      id: uuid(),
      kind,
      topCat: (r_top.value||"").trim(),
      subCat: (r_sub.value||"").trim(),
      name,
      yieldQty: kind==="prep" ? (r_yieldQty.value||"").trim() : "",
      yieldUnit: kind==="prep" ? r_yieldUnit.value : "",
      lines: []
    };
    if(kind==="prep"){
      if(toNumber(recipe.yieldQty)<=0){
        r_msg.innerHTML = `<span class="bad">Prep braucht Yield Menge (z.B. 1000).</span>`;
        return;
      }
    }

    st.recipes.push(recipe);
    saveState(st);
    r_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    renderActiveTab("recipes");
  };

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Rezept anlegen (Admin)"]),
    el("div",{class:"label"},["Typ"]), r_kind,
    el("div",{class:"label"},["Top-Kategorie"]), r_top,
    el("div",{class:"label"},["Unterkategorie"]), r_sub,
    el("div",{class:"label"},["Name"]), r_name,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Yield Menge (nur prep)"]), r_yieldQty]),
      el("div",{},[el("div",{class:"label"},["Yield Einheit"]), r_yieldUnit]),
    ]),
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    r_msg
  ]);
  wrap.appendChild(form);

  const tbody = el("tbody",{});
  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Rezept Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Name"]),
            el("th",{},["Typ"]),
            el("th",{},["Kategorie"]),
            el("th",{class:"right"},["Kosten"])
          ])
        ]),
        tbody
      ])
    ])
  ]);
  wrap.appendChild(list);

  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Editor"]),
    el("div",{class:"small"},["Wähle ein Rezept aus der Liste."])
  ]);
  wrap.appendChild(editor);

  function drawList(){
    tbody.innerHTML="";
    for(const r of (st.recipes||[])){
      const cost = r.kind==="dish" ? computeDishCost(st, outletId, r.id) : (computeRecipeUnitCost(st, outletId, r.id, {}) * toNumber(r.yieldQty||0));
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(r.name)}),
        el("td",{html:escapeHtml(r.kind)}),
        el("td",{html:escapeHtml(`${r.topCat||""} / ${r.subCat||""}`)}),
        el("td",{class:"right"},[fmtEUR(cost)])
      ]);
      tr.onclick = ()=> openEditor(r.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(recipeId){
    const r = (st.recipes||[]).find(x=>x.id===recipeId);
    if(!r){
      editor.innerHTML = `<div class="title">Editor</div><div class="small">Wähle ein Rezept aus der Liste.</div>`;
      return;
    }
    editor.innerHTML="";
    editor.appendChild(el("div",{class:"title"},[`Rezept: ${escapeHtml(r.name)}`]));
    editor.appendChild(el("div",{class:"sub"},[
      r.kind==="prep"
        ? `Prep: Yield ${escapeHtml(r.yieldQty)} ${escapeHtml(r.yieldUnit)}`
        : "Dish: Kosten pro Portion aus Zutaten/Prep"
    ]));

    const name = el("input",{class:"input", value:r.name||""});
    const topCat = el("input",{class:"input", value:r.topCat||""});
    const subCat = el("input",{class:"input", value:r.subCat||""});
    const yieldQty = el("input",{class:"input", inputmode:"decimal", value:String(r.yieldQty||"")});
    const yieldUnit = el("select",{class:"input"},[
      el("option",{value:"g"},["g"]),
      el("option",{value:"ml"},["ml"]),
      el("option",{value:"stk"},["stk"]),
    ]);
    yieldUnit.value = r.yieldUnit || "g";

    [name,topCat,subCat,yieldQty,yieldUnit].forEach(n=> n.disabled = !admin);

    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);

    function refreshSummary(){
      const dishCost = (r.kind==="dish") ? computeDishCost(st, outletId, r.id) : 0;
      const prepTotal = (r.kind==="prep") ? (computeRecipeUnitCost(st, outletId, r.id, {}) * toNumber(r.yieldQty||0)) : 0;
      summary.innerHTML = r.kind==="dish"
        ? `Kosten (pro Portion): <b>${fmtEUR(dishCost)}</b>`
        : `Kosten (gesamt Yield): <b>${fmtEUR(prepTotal)}</b> · Kosten/Einheit: <b>${computeRecipeUnitCost(st, outletId, r.id, {}).toFixed(4)} €/ ${escapeHtml(r.yieldUnit||"")}</b>`;
    }

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    btnSave.disabled = !admin;

    const btnDel = el("button",{class:"btn danger"},["Rezept löschen"]);
    btnDel.disabled = !admin;

    btnSave.onclick = ()=>{
      msg.textContent="";
      if(!admin){ msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }

      r.name = (name.value||"").trim();
      r.topCat = (topCat.value||"").trim();
      r.subCat = (subCat.value||"").trim();

      if(r.kind==="prep"){
        r.yieldQty = (yieldQty.value||"").trim();
        r.yieldUnit = yieldUnit.value;
        if(toNumber(r.yieldQty)<=0){
          msg.innerHTML = `<span class="bad">Prep braucht Yield Menge > 0.</span>`;
          return;
        }
      }

      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      refreshSummary();
    };

    btnDel.onclick = ()=>{
      if(!admin) return;
      if(!confirm("Rezept wirklich löschen? (Menüartikel/Rezepte können Zuordnung verlieren)")) return;

      // remove recipe references in other recipes
      (st.recipes||[]).forEach(x=>{
        x.lines = (x.lines||[]).filter(l=> !(l.refType==="recipe" && l.refId===r.id));
      });

      // remove menu items referencing this recipe
      st.menuItems = (st.menuItems||[]).filter(mi => mi.recipeId !== r.id);

      // remove sales referencing removed menu items
      // (we clean later in menu tab, but do quick cleanup)
      const remainingMenuIds = new Set((st.menuItems||[]).map(m=>m.id));
      st.sales = (st.sales||[]).filter(s => remainingMenuIds.has(s.menuItemId));

      st.recipes = (st.recipes||[]).filter(x=>x.id!==r.id);

      saveState(st);
      renderActiveTab("recipes");
    };

    // Add ingredient line (Admin only)
    const refType = el("select",{class:"input"},[
      el("option",{value:"inv"},["Inventur Artikel"]),
      el("option",{value:"recipe"},["Prep-Rezept"]),
    ]);
    const refSelect = el("select",{class:"input"},[]);
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge (in Einheit des Items) z.B. 120"});
    const btnAddLine = el("button",{class:"btn primary"},["Zutat hinzufügen"]);
    btnAddLine.disabled = !admin;

    function fillRefSelect(){
      refSelect.innerHTML="";
      if(refType.value==="inv"){
        for(const inv of (st.inventory||[])){
          refSelect.appendChild(el("option",{value:inv.id},[`${inv.name} (${inv.unitType})`]));
        }
      } else {
        for(const pr of (st.recipes||[]).filter(x=>x.kind==="prep")){
          refSelect.appendChild(el("option",{value:pr.id},[`${pr.name} (Yield ${pr.yieldQty} ${pr.yieldUnit})`]));
        }
      }
    }
    refType.onchange = fillRefSelect;
    fillRefSelect();

    btnAddLine.onclick = ()=>{
      msg.textContent="";
      if(!admin){ msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
      const rid = refSelect.value;
      const q = (qty.value||"").trim();
      if(!rid){ alert("Bitte Auswahl treffen."); return; }
      if(!q){ alert("Bitte Menge eingeben."); return; }

      if(refType.value==="inv"){
        const inv = (st.inventory||[]).find(x=>x.id===rid);
        if(!inv){ alert("Inventur Artikel fehlt."); return; }
        r.lines = r.lines || [];
        r.lines.push({ id: uuid(), refType:"inv", refId: inv.id, qty:q, unitType: inv.unitType });
      } else {
        const pr = (st.recipes||[]).find(x=>x.id===rid && x.kind==="prep");
        if(!pr){ alert("Prep Rezept fehlt."); return; }
        r.lines = r.lines || [];
        r.lines.push({ id: uuid(), refType:"recipe", refId: pr.id, qty:q, unitType: pr.yieldUnit });
      }

      qty.value="";
      saveState(st);
      openEditor(r.id);
      drawList();
    };

    // Lines table
    const linesWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});
    function drawLines(){
      const tbody = el("tbody",{}, (r.lines||[]).map(line=>{
        let label = "—";
        let unit = line.unitType || "";
        let cost = 0;

        if(line.refType==="inv"){
          const inv = getInvEffective(st, outletId, line.refId);
          label = inv ? inv.name : "— (fehlender Artikel)";
          unit = inv ? inv.unitType : unit;
          cost = inv ? toNumber(line.qty)*unitPriceEffective(inv) : 0;
        } else {
          const pr = (st.recipes||[]).find(x=>x.id===line.refId);
          label = pr ? pr.name : "— (fehlendes Prep)";
          unit = pr ? pr.yieldUnit : unit;
          const unitCost = pr ? computeRecipeUnitCost(st, outletId, pr.id, {}) : 0;
          cost = toNumber(line.qty)*unitCost;
        }

        const qtyInput = el("input",{class:"input", style:"max-width:140px", inputmode:"decimal", value:String(line.qty||"")});
        qtyInput.disabled = !admin;

        const btnSaveQty = el("button",{class:"btn", style:"padding:7px 10px"},["Speichern"]);
        btnSaveQty.disabled = !admin;

        const btnDelLine = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
        btnDelLine.disabled = !admin;

        btnSaveQty.onclick = ()=>{
          if(!admin) return;
          line.qty = (qtyInput.value||"").trim();
          saveState(st);
          openEditor(r.id);
          drawList();
        };
        btnDelLine.onclick = ()=>{
          if(!admin) return;
          r.lines = (r.lines||[]).filter(x=>x.id!==line.id);
          saveState(st);
          openEditor(r.id);
          drawList();
        };

        return el("tr",{},[
          el("td",{html:escapeHtml(label)}),
          el("td",{html:escapeHtml(line.refType)}),
          el("td",{html:escapeHtml(unit)}),
          el("td",{class:"right"},[qtyInput]),
          el("td",{class:"right"},[fmtEUR(cost)]),
          el("td",{class:"right"},[
            el("div",{class:"row", style:"justify-content:flex-end"},[btnSaveQty, btnDelLine])
          ])
        ]);
      }));

      linesWrap.innerHTML="";
      linesWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Zutat"]),
            el("th",{},["Typ"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Menge"]),
            el("th",{class:"right"},["Kosten"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    refreshSummary();
    drawLines();

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Top-Kat"]), topCat]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Unterkat"]), subCat]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Yield Menge (prep)"]), yieldQty]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Yield Einheit"]), yieldUnit]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Zutaten hinzufügen (Admin)"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Quelle"]), refType]),
          el("div",{},[el("div",{class:"label"},["Auswahl"]), refSelect]),
        ]),
        el("div",{class:"label"},["Menge"]),
        qty,
        el("div",{class:"row", style:"margin-top:10px"},[btnAddLine]),
        el("div",{class:"hr"}),
        linesWrap
      ])
    ]));
  }

  drawList();
  return wrap;
}

/* ----------------------- Menu Items (per recipe + bundles + VK per outlet) ----------------------- */
function renderMenu(st, outletId){
  const wrap = el("div",{class:"grid"});
  const out = (st.outlets||[]).find(o=>o.id===outletId);
  const paramsEnabled = out?.paramsEnabled ?? true;
  const params = st.paramsGlobal || {};

  const canEditPrices = canAdmin(st) || canManage(st); // price per outlet: manager allowed
  const canCreateMenu = canAdmin(st); // only admin creates menu templates + bundles

  const note = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Menüartikel (VK pro Outlet)"]),
    el("div",{class:"sub", html: `
      Admin erstellt Menüartikel (single aus Rezept oder bundle).<br/>
      VK pro Outlet: Admin/Manager darf VK setzen. Staff: nur ansehen.<br/>
      DB nutzt Parameter: <b>${paramsEnabled ? "JA" : "NEIN"}</b> (Outlet-Schalter im Admin Tab).
    `})
  ]);
  wrap.appendChild(note);

  // Create single from recipe (Admin)
  const recipeSelect = el("select",{class:"input"},[
    el("option",{value:""},["— Rezept wählen (dish) —"])
  ]);
  (st.recipes||[]).filter(r=>r.kind==="dish").forEach(r=>{
    recipeSelect.appendChild(el("option",{value:r.id},[r.name]));
  });

  const mi_name = el("input",{class:"input", placeholder:"Menüartikel Name (optional, sonst Rezeptname)"});
  const mi_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnCreateSingle = el("button",{class:"btn primary"},["Menüartikel aus Rezept anlegen"]);
  btnCreateSingle.disabled = !canCreateMenu;

  btnCreateSingle.onclick = ()=>{
    mi_msg.textContent="";
    if(!canCreateMenu){ mi_msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    const rid = recipeSelect.value;
    if(!rid){ mi_msg.innerHTML = `<span class="bad">Bitte Rezept wählen.</span>`; return; }
    const r = (st.recipes||[]).find(x=>x.id===rid);
    if(!r){ mi_msg.innerHTML = `<span class="bad">Rezept nicht gefunden.</span>`; return; }

    const name = (mi_name.value||"").trim() || r.name;
    const mi = { id: uuid(), kind:"single", recipeId: rid, name, bundleItems:[], modifiers:[] };
    st.menuItems.push(mi);
    st.menuOutlet = st.menuOutlet || {};
    st.menuOutlet[outletId] = st.menuOutlet[outletId] || {};
    st.menuOutlet[outletId][mi.id] = st.menuOutlet[outletId][mi.id] || { price:"" };

    saveState(st);
    mi_msg.innerHTML = `<span class="ok">Angelegt.</span>`;
    renderActiveTab("menu");
  };

  const createSingleCard = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Menüartikel anlegen (aus Rezept) – Admin"]),
    el("div",{class:"label"},["Rezept (dish)"]), recipeSelect,
    el("div",{class:"label"},["Menüname (optional)"]), mi_name,
    el("div",{class:"row", style:"margin-top:12px"},[btnCreateSingle]),
    mi_msg
  ]);
  wrap.appendChild(createSingleCard);

  // Create bundle (Admin)
  const b_name = el("input",{class:"input", placeholder:"Bundle Name (z.B. Menü 1)"});
  const b_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnCreateBundle = el("button",{class:"btn primary"},["Bundle anlegen"]);
  btnCreateBundle.disabled = !canCreateMenu;

  btnCreateBundle.onclick = ()=>{
    b_msg.textContent="";
    if(!canCreateMenu){ b_msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    const name = (b_name.value||"").trim();
    if(!name){ b_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    const mi = { id: uuid(), kind:"bundle", recipeId:null, name, bundleItems:[], modifiers:[] };
    st.menuItems.push(mi);
    st.menuOutlet = st.menuOutlet || {};
    st.menuOutlet[outletId] = st.menuOutlet[outletId] || {};
    st.menuOutlet[outletId][mi.id] = st.menuOutlet[outletId][mi.id] || { price:"" };
    saveState(st);
    b_msg.innerHTML = `<span class="ok">Bundle angelegt. Jetzt im Editor Items hinzufügen.</span>`;
    renderActiveTab("menu");
  };

  const createBundleCard = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundle anlegen (Admin)"]),
    b_name,
    el("div",{class:"row", style:"margin-top:12px"},[btnCreateBundle]),
    b_msg
  ]);
  wrap.appendChild(createBundleCard);

  // List
  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Editor"]),
    el("div",{class:"small"},["Wähle Menüartikel aus der Liste."])
  ]);
  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Menüartikel Liste (VK pro Outlet)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Typ"]),
            el("th",{class:"right"},["VK (Outlet)"]),
            el("th",{class:"right"},["Wareneinsatz"]),
            el("th",{class:"right"},["DB €"]),
            el("th",{class:"right"},["DB %"])
          ])
        ]),
        tbody
      ])
    ])
  ]));
  wrap.appendChild(editor);

  function drawList(){
    tbody.innerHTML="";
    for(const mi of (st.menuItems||[])){
      const price = getMenuPrice(st, outletId, mi.id);
      const cost = computeMenuItemCost(st, outletId, mi.id);
      const { db, dbPct } = calcDBFromPrice(price, cost, paramsEnabled ? params : {...params, franchisePct:"0", platformPct:"0", paymentPct:"0", laborPct:"0"});

      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(mi.name)}),
        el("td",{html:escapeHtml(mi.kind)}),
        el("td",{class:"right"},[fmtEUR(price)]),
        el("td",{class:"right"},[fmtEUR(cost)]),
        el("td",{class:`right ${db>=0?"ok":"bad"}`},[fmtEUR(db)]),
        el("td",{class:`right ${dbPct>=0?"ok":"bad"}`},[fmtPct(dbPct)])
      ]);
      tr.onclick = ()=> openEditor(mi.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(menuItemId){
    const mi = (st.menuItems||[]).find(x=>x.id===menuItemId);
    if(!mi){
      editor.innerHTML = `<div class="title">Editor</div><div class="small">Wähle Menüartikel aus der Liste.</div>`;
      return;
    }
    editor.innerHTML="";
    editor.appendChild(el("div",{class:"title"},[`Menüartikel: ${escapeHtml(mi.name)}`]));
    editor.appendChild(el("div",{class:"sub"},[
      mi.kind==="single" ? "Single (aus Rezept)" : "Bundle (aus Menüartikeln)"
    ]));

    // VK edit per outlet (Admin/Manager)
    const priceInput = el("input",{class:"input", inputmode:"decimal", value: String(st.menuOutlet?.[outletId]?.[mi.id]?.price ?? "") , placeholder:"VK Preis (Outlet)"});
    priceInput.disabled = !canEditPrices;

    const btnSavePrice = el("button",{class:"btn primary"},["VK speichern"]);
    btnSavePrice.disabled = !canEditPrices;

    const priceMsg = el("div",{class:"small", style:"margin-top:8px"},[""]);
    btnSavePrice.onclick = ()=>{
      if(!canEditPrices) return;
      st.menuOutlet = st.menuOutlet || {};
      st.menuOutlet[outletId] = st.menuOutlet[outletId] || {};
      st.menuOutlet[outletId][mi.id] = st.menuOutlet[outletId][mi.id] || {};
      st.menuOutlet[outletId][mi.id].price = (priceInput.value||"").trim();
      saveState(st);
      priceMsg.innerHTML = `<span class="ok">VK gespeichert.</span>`;
      drawList();
      openEditor(mi.id);
    };

    const cost = computeMenuItemCost(st, outletId, mi.id);
    const price = toNumber(priceInput.value || getMenuPrice(st, outletId, mi.id));
    const { db, dbPct } = calcDBFromPrice(price, cost, paramsEnabled ? params : {...params, franchisePct:"0", platformPct:"0", paymentPct:"0", laborPct:"0"});
    const summary = el("div",{class:"sub", style:"margin-top:10px"},[
      `Wareneinsatz: ${fmtEUR(cost)} · DB: ${fmtEUR(db)} · DB%: ${fmtPct(dbPct)}`
    ]);

    // Bundle editor (Admin)
    const bundleWrap = el("div",{});
    if(mi.kind==="bundle"){
      const sel = el("select",{class:"input"},[
        el("option",{value:""},["— Menüartikel wählen —"])
      ]);
      (st.menuItems||[]).filter(x=>x.id!==mi.id).forEach(x=>{
        sel.appendChild(el("option",{value:x.id},[x.name]));
      });
      const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Qty im Bundle (z.B. 1)"});
      const btnAdd = el("button",{class:"btn primary"},["Zum Bundle hinzufügen"]);
      btnAdd.disabled = !canCreateMenu;

      const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

      btnAdd.onclick = ()=>{
        if(!canCreateMenu) return;
        const id = sel.value;
        const q = (qty.value||"").trim() || "1";
        if(!id){ msg.innerHTML = `<span class="bad">Bitte Artikel wählen.</span>`; return; }
        mi.bundleItems = mi.bundleItems || [];
        mi.bundleItems.push({ menuItemId: id, qty: q });
        saveState(st);
        renderActiveTab("menu");
      };

      const list = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border); margin-top:10px"},[]);
      function drawBundle(){
        const tbody = el("tbody",{}, (mi.bundleItems||[]).map(bi=>{
          const child = (st.menuItems||[]).find(x=>x.id===bi.menuItemId);
          const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
          btnDel.disabled = !canCreateMenu;
          btnDel.onclick = ()=>{
            if(!canCreateMenu) return;
            mi.bundleItems = (mi.bundleItems||[]).filter(x=>x!==bi);
            saveState(st);
            openEditor(mi.id);
            drawList();
          };
          return el("tr",{},[
            el("td",{html:escapeHtml(child?child.name:"—")}),
            el("td",{class:"right"},[String(bi.qty||1)]),
            el("td",{class:"right"},[btnDel])
          ]);
        }));
        list.innerHTML="";
        list.appendChild(el("table",{},[
          el("thead",{},[el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{class:"right"},["Qty"]),
            el("th",{class:"right"},["Aktion"])
          ])]),
          tbody
        ]));
      }
      drawBundle();

      bundleWrap.appendChild(el("div",{class:"hr"}));
      bundleWrap.appendChild(el("div",{class:"title", style:"font-size:15px"},["Bundle Inhalt (Admin)"]));
      bundleWrap.appendChild(el("div",{class:"two", style:"margin-top:8px"},[
        el("div",{},[el("div",{class:"label"},["Artikel"]), sel]),
        el("div",{},[el("div",{class:"label"},["Qty"]), qty]),
      ]));
      bundleWrap.appendChild(el("div",{class:"row", style:"margin-top:10px"},[btnAdd]));
      bundleWrap.appendChild(msg);
      bundleWrap.appendChild(list);
    }

    const btnDelete = el("button",{class:"btn danger"},["Menüartikel löschen (Admin)"]);
    btnDelete.disabled = !canCreateMenu;
    btnDelete.onclick = ()=>{
      if(!canCreateMenu) return;
      if(!confirm("Menüartikel wirklich löschen?")) return;
      st.menuItems = (st.menuItems||[]).filter(x=>x.id!==mi.id);
      if(st.menuOutlet?.[outletId]) delete st.menuOutlet[outletId][mi.id];
      st.sales = (st.sales||[]).filter(s=>s.menuItemId !== mi.id);
      saveState(st);
      renderActiveTab("menu");
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[
        el("div",{class:"label"},["VK Preis (Outlet)"]),
        priceInput,
        el("div",{class:"row", style:"margin-top:10px"},[btnSavePrice]),
        priceMsg
      ]),
      el("div",{class:"col-6"},[
        el("div",{class:"label"},["Kosten & DB"]),
        summary
      ]),
      el("div",{class:"col-12"},[bundleWrap]),
      el("div",{class:"col-12"},[el("div",{class:"row", style:"margin-top:12px"},[btnDelete])])
    ]));
  }

  drawList();
  return wrap;
}

/* ----------------------- Sales (per outlet, menu items) ----------------------- */
function renderSales(st, outletId){
  const wrap = el("div",{class:"grid"});
  const out = (st.outlets||[]).find(o=>o.id===outletId);
  const paramsEnabled = out?.paramsEnabled ?? true;
  const params = st.paramsGlobal || {};

  const today = todayISO();

  const s_date = el("input",{class:"input", value:today});
  const s_menu = el("select",{class:"input"},[]);
  function fillMenu(){
    s_menu.innerHTML="";
    (st.menuItems||[]).forEach(mi=>{
      s_menu.appendChild(el("option",{value:mi.id},[mi.name]));
    });
  }
  fillMenu();

  const s_qty = el("input",{class:"input", inputmode:"decimal", placeholder:"z.B. 20"});
  const s_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Speichern"]);
  const tbody = el("tbody",{});
  const summary = el("div",{class:"sub"},[""]);

  btnAdd.onclick = ()=>{
    s_msg.textContent="";
    const date = (s_date.value||today).trim();
    const menuItemId = s_menu.value;
    const qty = (s_qty.value||"").trim();
    if(!menuItemId){ s_msg.innerHTML = `<span class="bad">Menüartikel fehlt.</span>`; return; }
    if(!qty){ s_msg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }
    st.sales.push({ id: uuid(), outletId, date, menuItemId, qty });
    saveState(st);
    s_qty.value="";
    s_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const card = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Daily Sales – Eingabe"]),
    el("div",{class:"label"},["Datum"]), s_date,
    el("div",{class:"label"},["Menüartikel"]), s_menu,
    el("div",{class:"label"},["Anzahl verkauft"]), s_qty,
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
    el("div",{class:"title"},["Tagesauswertung"]),
    el("div",{class:"hr"}),
    summary
  ]);

  wrap.appendChild(card);
  wrap.appendChild(list);
  wrap.appendChild(sumCard);

  function draw(){
    tbody.innerHTML="";
    const date = (s_date.value||today).trim();
    const entries = (st.sales||[]).filter(x=>x.outletId===outletId && x.date===date);

    let dbSum=0, revSum=0, costSum=0;
    for(const e of entries){
      const mi = (st.menuItems||[]).find(x=>x.id===e.menuItemId);
      const q = toNumber(e.qty);

      const price = mi ? getMenuPrice(st, outletId, mi.id) : 0;
      const cost = mi ? computeMenuItemCost(st, outletId, mi.id) : 0;
      const { db } = calcDBFromPrice(price, cost, paramsEnabled ? params : {...params, franchisePct:"0", platformPct:"0", paymentPct:"0", laborPct:"0"});

      revSum += price*q;
      costSum += cost*q;
      const lineDb = db*q;
      dbSum += lineDb;

      const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
      btnDel.onclick = ()=>{
        st.sales = (st.sales||[]).filter(x=>x.id!==e.id);
        saveState(st);
        draw();
      };

      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(mi ? mi.name : "— (fehlend)")}),
        el("td",{class:"right"},[String(q)]),
        el("td",{class:`right ${lineDb>=0?"ok":"bad"}`},[fmtEUR(lineDb)]),
        el("td",{class:"right"},[btnDel])
      ]));
    }

    const fixedDaily = paramsEnabled ? calcFixedCostPerDay(params) : 0;
    summary.innerHTML = `
      Umsatz: <b>${fmtEUR(revSum)}</b> · Wareneinsatz: <b>${fmtEUR(costSum)}</b><br/>
      DB (variabel): <b class="${dbSum>=0?"ok":"bad"}">${fmtEUR(dbSum)}</b><br/>
      Fixkosten/Tag: <b>${fmtEUR(fixedDaily)}</b> · DB nach Fix: <b class="${(dbSum-fixedDaily)>=0?"ok":"bad"}">${fmtEUR(dbSum-fixedDaily)}</b>
    `;
  }

  s_date.addEventListener("change", draw);
  draw();
  return wrap;
}

/* ----------------------- Stock & Consumption ----------------------- */
function renderStock(st, outletId){
  const wrap = el("div",{class:"grid"});
  const today = todayISO();

  const note = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Bestand / Verbrauch"]),
    el("div",{class:"sub", html: `
      Bestände sind pro Outlet. Verbrauch kann aus Daily Sales berechnet und abgezogen werden.<br/>
      Hinweis: Dafür müssen Rezepte & Menüartikel korrekt sein.
    `})
  ]);
  wrap.appendChild(note);

  const date = el("input",{class:"input", value:today});
  const btnConsume = el("button",{class:"btn primary"},["Verbrauch aus Sales abziehen"]);
  const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

  btnConsume.onclick = ()=>{
    msg.textContent="";
    const d = (date.value||today).trim();
    const entries = (st.sales||[]).filter(s=>s.outletId===outletId && s.date===d);

    // compute consumption per inventoryId
    const consume = {}; // invId -> qty
    for(const s of entries){
      const mi = (st.menuItems||[]).find(x=>x.id===s.menuItemId);
      if(!mi) continue;
      const qSales = toNumber(s.qty);
      accumulateMenuConsumption(st, outletId, mi.id, qSales, consume);
    }

    // apply to stock
    st.invStock = st.invStock || {};
    st.invStock[outletId] = st.invStock[outletId] || {};
    for(const [invId, qty] of Object.entries(consume)){
      st.invStock[outletId][invId] = st.invStock[outletId][invId] || { onHandQty:"" };
      const cur = toNumber(st.invStock[outletId][invId].onHandQty);
      st.invStock[outletId][invId].onHandQty = String(cur - qty);
    }

    saveState(st);
    msg.innerHTML = `<span class="ok">Verbrauch gebucht. (${Object.keys(consume).length} Artikel)</span>`;
    renderActiveTab("stock");
  };

  const controls = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Verbrauch buchen"]),
    el("div",{class:"label"},["Datum"]), date,
    el("div",{class:"row", style:"margin-top:12px"},[btnConsume]),
    msg
  ]);
  wrap.appendChild(controls);

  // stock table
  const tbody = el("tbody",{});
  const table = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bestand Liste (Outlet)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Einheit"]),
            el("th",{class:"right"},["Bestand"])
          ])
        ]),
        tbody
      ])
    ])
  ]);
  wrap.appendChild(table);

  function getStock(invId){
    const qty = st.invStock?.[outletId]?.[invId]?.onHandQty;
    return (qty===undefined || qty===null) ? "" : String(qty);
  }

  function draw(){
    tbody.innerHTML="";
    for(const inv of (st.inventory||[])){
      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(inv.name)}),
        el("td",{html:escapeHtml(inv.unitType)}),
        el("td",{class:"right"},[getStock(inv.id)])
      ]));
    }
  }
  draw();

  return wrap;
}

// accumulate consumption from menu item into inventory
function accumulateMenuConsumption(st, outletId, menuItemId, salesQty, consume){
  const mi = (st.menuItems||[]).find(x=>x.id===menuItemId);
  if(!mi) return;
  if(mi.kind === "single"){
    if(!mi.recipeId) return;
    const r = (st.recipes||[]).find(x=>x.id===mi.recipeId);
    if(!r) return;
    for(const line of (r.lines||[])){
      const qty = toNumber(line.qty) * salesQty;
      if(line.refType==="inv"){
        consume[line.refId] = (consume[line.refId]||0) + qty;
      } else if(line.refType==="recipe"){
        // prep recipe consumption is in yield unit; must expand to its ingredient inventory
        accumulatePrepConsumption(st, outletId, line.refId, qty, consume);
      }
    }
  } else if(mi.kind === "bundle"){
    for(const bi of (mi.bundleItems||[])){
      accumulateMenuConsumption(st, outletId, bi.menuItemId, salesQty * toNumber(bi.qty||1), consume);
    }
  }
}
function accumulatePrepConsumption(st, outletId, prepRecipeId, qtyInYieldUnits, consume){
  const pr = (st.recipes||[]).find(x=>x.id===prepRecipeId && x.kind==="prep");
  if(!pr) return;
  const y = toNumber(pr.yieldQty);
  if(y<=0) return;
  const factor = qtyInYieldUnits / y; // fraction of batch consumed

  for(const line of (pr.lines||[])){
    const qty = toNumber(line.qty) * factor;
    if(line.refType==="inv"){
      consume[line.refId] = (consume[line.refId]||0) + qty;
    } else if(line.refType==="recipe"){
      // prep inside prep
      accumulatePrepConsumption(st, outletId, line.refId, qty, consume);
    }
  }
}

/* ----------------------- Params (Global, outlet can disable) ----------------------- */
function renderParams(st, outletId){
  const wrap = el("div",{class:"grid"});
  const out = (st.outlets||[]).find(o=>o.id===outletId);
  const enabled = out?.paramsEnabled ?? true;

  const p = st.paramsGlobal || {};

  const fields = [
    ["franchisePct","Franchise % (vom Umsatz)"],
    ["vatPct","MwSt % (gespeichert)"],
    ["platformPct","Plattform % (vom Umsatz)"],
    ["paymentPct","Payment % (vom Umsatz)"],
    ["laborPct","Personal % (vom Umsatz)"],
    ["fixedCostPerDay","Fixkosten pro Tag (€)"],
    ["fixedCostPerMonth","Fixkosten pro Monat (€)"],
    ["investmentTotal","Investitionssumme gesamt (€)"],
    ["depreciationMonths","Abschreibung (Monate)"],
  ];

  const inputs = {};
  for(const [k,label] of fields){
    inputs[k] = el("input",{class:"input", inputmode:"decimal", value:String(p[k]??"0")});
  }

  const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnSave = el("button",{class:"btn primary"},["Speichern (Global)"]);
  btnSave.disabled = !canAdmin(st);

  btnSave.onclick = ()=>{
    msg.textContent="";
    if(!canAdmin(st)){ msg.innerHTML = `<span class="bad">Nur Admin.</span>`; return; }
    st.paramsGlobal = st.paramsGlobal || {};
    for(const [k] of fields){
      st.paramsGlobal[k] = (inputs[k].value||"0").trim();
    }
    saveState(st);
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
  };

  const fixedDaily = enabled ? calcFixedCostPerDay(st.paramsGlobal||{}) : 0;

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Parameter (Global)"]),
    el("div",{class:"sub", html: `
      Diese Parameter gelten global, können aber pro Outlet <b>aktiv/deaktiv</b> geschaltet werden (Admin Tab).<br/>
      Fixkosten/Tag (gerechnet): <b>${fmtEUR(fixedDaily)}</b>
    `})
  ]));

  const grid = el("div",{class:"grid"});
  for(const [k,label] of fields){
    grid.appendChild(el("div",{class:"col-6"},[
      el("div",{class:"label"},[label]),
      inputs[k]
    ]));
  }

  wrap.appendChild(el("div",{class:"card col-12"},[
    grid,
    el("div",{class:"row", style:"margin-top:12px"},[btnSave]),
    msg
  ]));

  return wrap;
}

/* ----------------------- Admin (Outlets + Users + outlet param toggle) ----------------------- */
function renderAdmin(st, outletId){
  if(!canAdmin(st)){
    return el("div",{class:"card"},[
      el("div",{class:"title"},["Kein Zugriff"])
    ]);
  }

  const wrap = el("div",{class:"grid"});

  // Outlets
  const o_name = el("input",{class:"input", placeholder:"Outlet Name"});
  const o_code = el("input",{class:"input", placeholder:"Outlet Code (optional)"});
  const o_params = el("select",{class:"input"},[
    el("option",{value:"true"},["Parameter aktiv"]),
    el("option",{value:"false"},["Parameter deaktiv"]),
  ]);
  const o_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAddOutlet = el("button",{class:"btn primary"},["Outlet anlegen"]);

  btnAddOutlet.onclick = ()=>{
    o_msg.textContent="";
    const name = (o_name.value||"").trim();
    if(!name){ o_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.outlets.push({ id: uuid(), name, code:(o_code.value||"").trim(), paramsEnabled: o_params.value==="true" });
    saveState(st);
    o_msg.innerHTML = `<span class="ok">Outlet angelegt.</span>`;
    renderActiveTab("admin");
  };

  const outletsTbody = el("tbody",{});
  function drawOutlets(){
    outletsTbody.innerHTML="";
    for(const o of (st.outlets||[])){
      const toggle = el("select",{class:"input", style:"max-width:200px"},[
        el("option",{value:"true"},["Parameter aktiv"]),
        el("option",{value:"false"},["Parameter deaktiv"]),
      ]);
      toggle.value = o.paramsEnabled ? "true" : "false";
      toggle.onchange = ()=>{
        o.paramsEnabled = toggle.value==="true";
        saveState(st);
      };

      const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
      btnDel.onclick = ()=>{
        if(!confirm("Outlet löschen? (Sales/Stocks verlieren Bezug)")) return;
        // remove outlet
        st.outlets = (st.outlets||[]).filter(x=>x.id!==o.id);
        // remove outlet data
        if(st.invOutletOverride?.[o.id]) delete st.invOutletOverride[o.id];
        if(st.invStock?.[o.id]) delete st.invStock[o.id];
        if(st.menuOutlet?.[o.id]) delete st.menuOutlet[o.id];
        st.sales = (st.sales||[]).filter(s=>s.outletId!==o.id);
        // remove from users
        (st.users||[]).forEach(u=>{
          u.outletIds = (u.outletIds||[]).filter(id=>id!==o.id);
        });
        saveState(st);
        renderActiveTab("admin");
      };

      outletsTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(o.name)}),
        el("td",{html:escapeHtml(o.code||"")}),
        el("td",{class:"right"},[toggle]),
        el("td",{class:"right"},[btnDel])
      ]));
    }
  }

  const outletsCard = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Outlets"]),
    el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-4"},[el("div",{class:"label"},["Name"]), o_name]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Code"]), o_code]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Parameter"]), o_params]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnAddOutlet])]),
      el("div",{class:"col-12"},[o_msg]),
    ]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Name"]),
            el("th",{},["Code"]),
            el("th",{class:"right"},["Parameter"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        outletsTbody
      ])
    ])
  ]);

  wrap.appendChild(outletsCard);
  drawOutlets();

  // Users
  const u_user = el("input",{class:"input", placeholder:"username (ohne Leerzeichen)"});
  const u_disp = el("input",{class:"input", placeholder:"Display Name"});
  const u_role = el("select",{class:"input"},[
    el("option",{value:"manager"},["manager"]),
    el("option",{value:"staff"},["staff"]),
    el("option",{value:"admin"},["admin"]),
  ]);
  const u_outlets = el("div",{});
  const u_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAddUser = el("button",{class:"btn primary"},["User anlegen"]);

  function outletCheckboxes(){
    u_outlets.innerHTML="";
    for(const o of (st.outlets||[])){
      const cb = el("input",{type:"checkbox"});
      cb.value = o.id;
      const row = el("div",{class:"row", style:"gap:8px; align-items:center; margin-bottom:6px"},[
        cb,
        el("span",{class:"small"},[o.name])
      ]);
      u_outlets.appendChild(row);
    }
  }
  outletCheckboxes();

  btnAddUser.onclick = ()=>{
    u_msg.textContent="";
    const username = (u_user.value||"").trim();
    if(!username){ u_msg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ u_msg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }
    if((st.users||[]).some(x=>String(x.username||"").toLowerCase()===username.toLowerCase())){
      u_msg.innerHTML = `<span class="bad">Username existiert schon.</span>`; return;
    }
    const outletIds = Array.from(u_outlets.querySelectorAll("input[type=checkbox]"))
      .filter(cb=>cb.checked).map(cb=>cb.value);
    if(outletIds.length===0){
      u_msg.innerHTML = `<span class="bad">Mindestens 1 Outlet zuweisen.</span>`;
      return;
    }
    st.users.push({
      id: uuid(),
      username,
      displayName: (u_disp.value||"").trim() || username,
      role: u_role.value,
      outletIds
    });
    saveState(st);
    u_user.value=""; u_disp.value="";
    outletCheckboxes();
    u_msg.innerHTML = `<span class="ok">User angelegt.</span>`;
    drawUsers();
  };

  const usersTbody = el("tbody",{});
  function drawUsers(){
    usersTbody.innerHTML="";
    for(const u of (st.users||[])){
      const isAdminUser = String(u.username||"").toLowerCase()==="admin";
      const outlets = (u.outletIds||[]).map(id=>{
        const o = (st.outlets||[]).find(x=>x.id===id);
        return o ? o.name : "—";
      }).join(", ");

      const btnDel = isAdminUser
        ? el("span",{class:"small"},["Admin"])
        : el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

      if(!isAdminUser){
        btnDel.onclick = ()=>{
          if(!confirm("User löschen?")) return;
          st.users = (st.users||[]).filter(x=>x.id!==u.id);
          saveState(st);
          drawUsers();
        };
      }

      usersTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(u.username)}),
        el("td",{html:escapeHtml(u.displayName||"")}),
        el("td",{html:escapeHtml(u.role)}),
        el("td",{html:escapeHtml(outlets)}),
        el("td",{class:"right"},[btnDel])
      ]));
    }
  }

  const usersCard = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["User Verwaltung"]),
    el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-4"},[el("div",{class:"label"},["Username"]), u_user]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Display Name"]), u_disp]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Rolle"]), u_role]),
      el("div",{class:"col-12"},[
        el("div",{class:"label"},["Outlet Zugriff"]),
        el("div",{class:"note"},[
          "Mindestens 1 Outlet pro User. Admin sieht alles."
        ]),
        u_outlets
      ]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnAddUser])]),
      el("div",{class:"col-12"},[u_msg]),
    ]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Username"]),
            el("th",{},["Display"]),
            el("th",{},["Role"]),
            el("th",{},["Outlets"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        usersTbody
      ])
    ])
  ]);

  wrap.appendChild(usersCard);
  drawUsers();

  return wrap;
}

/* ----------------------- CSV parser (simple) ----------------------- */
function parseCSV(text){
  // supports comma or semicolon separated; expects header row
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0);
  if(lines.length<2) return [];
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const header = splitCSVLine(lines[0], sep).map(h=>h.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i], sep);
    const obj = {};
    header.forEach((h, idx)=> obj[h]= (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}
function splitCSVLine(line, sep){
  const out = [];
  let cur = "", inQ=false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQ && line[i+1] === '"'){ cur+='"'; i++; }
      else inQ = !inQ;
    } else if(ch === sep && !inQ){
      out.push(cur);
      cur="";
    } else {
      cur+=ch;
    }
  }
  out.push(cur);
  return out;
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
