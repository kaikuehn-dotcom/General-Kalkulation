/* =========================================================
   HEISSE ECKE – WEB APP (Single-File JS, GitHub Pages)
   + Dauerhafte Speicherung: LocalStorage + Supabase Sync
   + Inventur Import (CSV) mit MERGE
   + Menu Items (Speisekarten-Produkte) aus Rezepten
   + Modifiers (Add-ons + Auswahlgruppen)
   + Bundles (Menüs) + Sales-Mix auf Menu Items
   ---------------------------------------------------------
   NOTE:
   - Keine DOM-Queries bevor Nodes existieren (keine null.onclick)
   - GitHub Pages friendly (kein Build, kein Node)
========================================================= */

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

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
function normKey(s){ return String(s||"").trim().toLowerCase(); }

/* ----------------------- Theme ----------------------- */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS.theme) || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ----------------------- State ----------------------- */
function defaultState(){
  return {
    // Basic user model: admin + normal users
    users: [
      { username:"admin", displayName:"Admin", role:"admin" }
    ],

    // Inventory base articles
    inventory: [], // {id, group, name, supplier, unitType('g'|'ml'|'stk'), packSize, packPrice}

    // Recipes (production / dish recipes)
    recipes: [],   // {id, topCat, subCat, name, lines:[{id, inventoryId, qty}], notes}

    // Menu Items (Speisekarte): can be "recipe" or "bundle"
    menuItems: [], // {id, type:'recipe'|'bundle', name, topCat, subCat, price, recipeId?, bundleItems:[{menuItemId, qty}], modifierGroupIds:[]}

    // Modifier groups (for menu items)
    modifierGroups: [], // {id, name, mode:'add'|'choose', min, max, options:[{id,label, priceDelta, inventoryId?, qty?, affectsCost:boolean}]}

    // Params / overhead
    params: {
      franchisePct: 0,
      vatPct: 7,
      // INVEST + FIX + VAR costs (monthly default)
      fixedCostsMonthly: 0,
      rentMonthly: 0,
      laborMonthly: 0,
      utilitiesMonthly: 0,
      otherFixedMonthly: 0,
      capexMonthly: 0,
      platformFeePct: 0,
      paymentFeePct: 0
    },

    // Sales on menu items (not recipes)
    sales: [] // {id, date, menuItemId, qty}
  };
}

function getWorkspace(){ return (localStorage.getItem(LS.workspace)||"").trim(); }
function setWorkspace(ws){ localStorage.setItem(LS.workspace, ws.trim()); }
function getSession(){ return readLS(LS.session, null); }
function setSession(s){ writeLS(LS.session, s); }
function clearSession(){ localStorage.removeItem(LS.session); }

function loadState(){
  const st = readLS(LS.state, null);
  if(st && typeof st === "object") return migrateState(st);
  const d = defaultState();
  writeLS(LS.state, d);
  return d;
}

function migrateState(st){
  // Minimal forward-compat: ensure new keys exist
  if(!st.users) st.users = defaultState().users;
  if(!st.inventory) st.inventory = [];
  if(!st.recipes) st.recipes = [];
  if(!st.menuItems) st.menuItems = [];
  if(!st.modifierGroups) st.modifierGroups = [];
  if(!st.params) st.params = defaultState().params;
  if(!st.sales) st.sales = [];

  // Backfill roles
  for(const u of st.users){
    if(!u.role) u.role = (normKey(u.username)==="admin") ? "admin" : "user";
  }

  // Ensure recipes have lines array
  for(const r of st.recipes){
    if(!Array.isArray(r.lines)) r.lines = [];
  }

  // Auto-create menu items for recipes if missing
  ensureMenuFromRecipes(st);

  writeLS(LS.state, st);
  return st;
}

function saveState(st){
  ensureMenuFromRecipes(st);
  writeLS(LS.state, st);
  localStorage.setItem(LS.lastSaved, nowISO());
  scheduleCloudSave();
}

function role(){
  const s = getSession();
  if(!s) return "guest";
  return s.role || (normKey(s.username)==="admin" ? "admin" : "user");
}
function isAdmin(){ return role() === "admin"; }

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
      writeLS(LS.state, migrateState(row.data));
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

/* ----------------------- Calculations ----------------------- */
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

function recipeCost(recipe, inventoryById){
  const lines = recipe.lines || [];
  return lines.reduce((sum, l)=>{
    const inv = inventoryById[l.inventoryId];
    if(!inv) return sum;
    return sum + (toNumber(l.qty) * unitPrice(inv));
  }, 0);
}

function menuItemBaseCost(menuItem, st){
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  if(menuItem.type === "recipe"){
    const r = (st.recipes||[]).find(x=>x.id === menuItem.recipeId);
    if(!r) return 0;
    return recipeCost(r, invById);
  }
  if(menuItem.type === "bundle"){
    let sum = 0;
    for(const bi of (menuItem.bundleItems||[])){
      const child = (st.menuItems||[]).find(x=>x.id === bi.menuItemId);
      if(!child) continue;
      sum += menuItemBaseCost(child, st) * (toNumber(bi.qty) || 1);
    }
    return sum;
  }
  return 0;
}

function menuItemDB(menuItem, st){
  const price = toNumber(menuItem.price);
  const cost = menuItemBaseCost(menuItem, st);

  const p = st.params || {};
  const frPct = toNumber(p.franchisePct)/100;
  const platformPct = toNumber(p.platformFeePct)/100;
  const payPct = toNumber(p.paymentFeePct)/100;

  // Variable fees on revenue
  const varFees = price * (frPct + platformPct + payPct);

  const db = price - cost - varFees;
  const dbPct = price > 0 ? (db/price)*100 : 0;
  return { price, cost, db, dbPct };
}

/* ----------------------- Menu auto from recipes ----------------------- */
function ensureMenuFromRecipes(st){
  st.menuItems = st.menuItems || [];
  const menuByRecipe = new Map();
  for(const m of st.menuItems){
    if(m.type==="recipe" && m.recipeId) menuByRecipe.set(m.recipeId, m);
  }

  for(const r of (st.recipes||[])){
    if(menuByRecipe.has(r.id)) continue;
    st.menuItems.push({
      id: uuid(),
      type: "recipe",
      name: r.name,
      topCat: r.topCat || "Speisen",
      subCat: r.subCat || "",
      price: "", // manual
      recipeId: r.id,
      modifierGroupIds: []
    });
  }

  // Keep menu item names in sync (soft sync)
  for(const m of st.menuItems){
    if(m.type==="recipe"){
      const r = (st.recipes||[]).find(x=>x.id===m.recipeId);
      if(r && (!m.name || m.name === r.name)) m.name = r.name;
      if(r && (!m.topCat || m.topCat === r.topCat)) m.topCat = r.topCat || m.topCat;
      if(r && (!m.subCat || m.subCat === r.subCat)) m.subCat = r.subCat || m.subCat;
    }
    if(!Array.isArray(m.modifierGroupIds)) m.modifierGroupIds = [];
    if(!Array.isArray(m.bundleItems)) m.bundleItems = [];
  }
}

/* ----------------------- CSV Import ----------------------- */
function parseCSV(text){
  // Supports comma or semicolon (auto-detect by header line)
  const lines = text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length>0);
  if(!lines.length) return { headers:[], rows:[] };

  const sep = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
  const headers = splitCSVLine(lines[0], sep).map(h=>h.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i], sep);
    const obj = {};
    headers.forEach((h, idx)=> obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return { headers, rows };
}

function splitCSVLine(line, sep){
  const out = [];
  let cur = "";
  let inQ = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
    }else if(ch === sep && !inQ){
      out.push(cur);
      cur = "";
    }else{
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function mergeInventoryFromRows(st, rows){
  // Expect: group,name,supplier,unitType,packSize,packPrice
  const inv = st.inventory || [];
  const byKey = new Map(inv.map(x=>[normKey(x.name), x]));

  let created = 0, updated = 0, skipped = 0;

  for(const r of rows){
    const name = (r.name ?? r.Name ?? r.NAME ?? "").trim();
    if(!name){ skipped++; continue; }
    const key = normKey(name);

    const item = {
      group: (r.group ?? r.Group ?? "").trim(),
      name,
      supplier: (r.supplier ?? r.Supplier ?? "").trim(),
      unitType: (r.unitType ?? r.UnitType ?? "").trim() || "g",
      packSize: (r.packSize ?? r.PackSize ?? "").trim(),
      packPrice: (r.packPrice ?? r.PackPrice ?? "").trim()
    };

    if(!["g","ml","stk"].includes(item.unitType)) item.unitType = "g";

    const existing = byKey.get(key);
    if(existing){
      existing.group = item.group;
      existing.supplier = item.supplier;
      existing.unitType = item.unitType;
      existing.packSize = item.packSize;
      existing.packPrice = item.packPrice;
      updated++;
    }else{
      inv.push({ id: uuid(), ...item });
      created++;
    }
  }

  st.inventory = inv;
  return { created, updated, skipped };
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
    .container{ max-width:1200px; margin:0 auto; padding:16px; }
    .topbar{ display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .title{ font-size:18px; font-weight:900; }
    .sub{ color:var(--muted); font-size:12px; line-height:1.35; }
    .card{ background:var(--card); border:1px solid var(--border); border-radius:14px; padding:14px; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn{ border:1px solid var(--border); background:transparent; color:var(--text); padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:800; }
    .btn.primary{ background:var(--primary); border-color:transparent; color:#fff; }
    .btn.danger{ background:var(--danger); border-color:transparent; color:#fff; }
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
    .hint{ font-size:12px; color:var(--muted); padding:10px; border:1px dashed var(--border); border-radius:12px; }
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

/* ----------------------- Screens ----------------------- */
function screenLogin(){
  const root = ensureRoot();
  root.innerHTML = "";

  injectBaseStyles();
  applyTheme(localStorage.getItem(LS.theme) || "dark");

  const ws = getWorkspace();
  const wsInput = el("input", { class:"input", value: ws, placeholder:"z.B. heisse-ecke" });
  const userInput = el("input", { class:"input", placeholder:"admin oder angelegter User" });
  const msg = el("div", { class:"small", style:"margin-top:10px" }, [""]);

  const btnLogin = el("button", { class:"btn primary" }, ["Weiter"]);
  const btnTheme = el("button", { class:"btn" }, ["Hell/Dunkel"]);
  btnTheme.onclick = toggleTheme;

  btnLogin.onclick = async ()=>{
    msg.textContent = "";
    const w = (wsInput.value || "").trim();
    const u = (userInput.value || "").trim();

    if(!w){ msg.textContent = "Workspace ist Pflicht (für Sync)."; return; }
    if(!u){ msg.textContent = "Username fehlt."; return; }

    setWorkspace(w);
    await cloudPullOnStart();

    const st = loadState();
    const hit = (st.users || []).find(x => normKey(x.username) === normKey(u));
    if(!hit){ msg.textContent = "Unbekannter User (Admin muss dich anlegen)."; return; }

    setSession({ username: hit.username, displayName: hit.displayName || hit.username, role: hit.role || "user" });
    screenApp();
  };

  const card = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Login / Workspace"]),
    el("div", { class:"sub", html: `Workspace ist Pflicht (Sync). Beispiel: <b>heisse-ecke</b>` }),
    el("div", { class:"label" }, ["Workspace Code"]),
    wsInput,
    el("div", { class:"label" }, ["Username"]),
    userInput,
    el("div", { class:"row", style:"margin-top:12px" }, [btnLogin, btnTheme]),
    msg
  ]);

  const info = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Umfang (jetzt)"]),
    el("div", { class:"sub", html: `
      ✅ Inventur + CSV Import (Merge)<br/>
      ✅ Rezepte (Admin) – Zutaten/Mengen<br/>
      ✅ Menu Items (Speisekarte) – eigener VK<br/>
      ✅ Modifiers (Add-ons / Auswahlgruppen)<br/>
      ✅ Bundles (Menüs) aus Menu Items<br/>
      ✅ Daily Sales → Tages-DB auf Menu Items<br/>
      ✅ Parameter inkl. Fix/Invest/Fees<br/>
      ✅ Gerätewechsel via Workspace Sync
    `})
  ]);

  root.appendChild(el("div", { class:"container" }, [
    el("div", { class:"topbar" }, [
      el("div", {}, [
        el("div", { class:"title" }, ["Heisse Ecke – Kalkulation (Web)"]),
        el("div", { class:"sub" }, ["GitHub Pages · Supabase Sync · Ohne Node"])
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"pill", id:"syncStatus" }, [ localStorage.getItem(LS.syncStatus) || (ws ? "Sync: bereit" : "Sync: aus") ])
      ])
    ]),
    el("div", { class:"grid", style:"margin-top:12px" }, [card, info])
  ]));
}

function screenApp(){
  injectBaseStyles();
  applyTheme(localStorage.getItem(LS.theme) || "dark");

  const root = ensureRoot();
  root.innerHTML = "";

  const s = getSession();
  if(!s){ screenLogin(); return; }

  const ws = getWorkspace();
  if(!ws){ clearSession(); screenLogin(); return; }

  const header = el("div", { class:"topbar" }, [
    el("div", {}, [
      el("div", { class:"title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", { class:"sub", html: `
        Workspace: <b>${escapeHtml(ws)}</b> · <span id="syncStatus">${escapeHtml(localStorage.getItem(LS.syncStatus) || "Sync: bereit")}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(s.username)}) · Role: <b>${escapeHtml(s.role||"user")}</b><br/>
        Letzte Speicherung: <b>${escapeHtml(localStorage.getItem(LS.lastSaved) || "—")}</b>
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
      tabBtn("dashboard", "Dashboard", true),
      tabBtn("inventory", isAdmin() ? "Inventur (Admin)" : "Inventur (Read)", true),
      tabBtn("recipes", "Rezepte (Admin)", isAdmin()),
      tabBtn("menu", "Menu (Speisekarte)", true),
      tabBtn("mods", "Modifiers (Admin)", isAdmin()),
      tabBtn("bundles", "Bundles (Admin)", isAdmin()),
      tabBtn("sales", "Daily Sales", true),
      tabBtn("params", "Parameter", true),
      tabBtn("users", "User (Admin)", isAdmin())
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

  if(tab === "dashboard") content.appendChild(renderDashboard(st));
  if(tab === "inventory") content.appendChild(renderInventory(st));
  if(tab === "recipes") content.appendChild(renderRecipes(st));
  if(tab === "menu") content.appendChild(renderMenu(st));
  if(tab === "mods") content.appendChild(renderModifiers(st));
  if(tab === "bundles") content.appendChild(renderBundles(st));
  if(tab === "sales") content.appendChild(renderSales(st));
  if(tab === "params") content.appendChild(renderParams(st));
  if(tab === "users") content.appendChild(renderUsers(st));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st){
  ensureMenuFromRecipes(st);

  const today = todayISO();
  const salesToday = (st.sales||[]).filter(s=>s.date === today);

  const dbToday = salesToday.reduce((sum, s)=>{
    const m = (st.menuItems||[]).find(x=>x.id === s.menuItemId);
    if(!m) return sum;
    const calc = menuItemDB(m, st);
    return sum + calc.db * toNumber(s.qty);
  }, 0);

  const card1 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Status"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      Inventur-Artikel: <b>${(st.inventory||[]).length}</b><br/>
      Rezepte: <b>${(st.recipes||[]).length}</b><br/>
      Menu Items: <b>${(st.menuItems||[]).length}</b><br/>
      Sales heute (${today}): <b>${salesToday.length}</b><br/>
      DB heute: <b class="${dbToday>=0?"ok":"bad"}">${fmtEUR(dbToday)}</b>
    `})
  ]);

  const card2 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Checkliste"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      1) Inventur sauber (€/Einheit)<br/>
      2) Rezepte (Admin) → Zutaten/Mengen<br/>
      3) Menu Items → VK Preis setzen<br/>
      4) Sales erfassen → Tages-DB
    `})
  ]);

  const rows = (st.menuItems||[]).map(m=>{
    const calc = menuItemDB(m, st);
    return { id:m.id, name:m.name, cat:`${m.topCat||""} / ${m.subCat||""}`, type:m.type, ...calc };
  }).sort((a,b)=> (a.cat+a.name).localeCompare(b.cat+b.name));

  const table = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Menu Items – Wareneinsatz & DB (Basis)"]),
    el("div", { class:"sub" }, ["DB berücksichtigt: Franchise% + Platform% + Payment% (Parameter)."]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Produkt"]),
            el("th", {}, ["Typ"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class:"right" }, ["Wareneinsatz"]),
            el("th", { class:"right" }, ["Preis"]),
            el("th", { class:"right" }, ["DB €"]),
            el("th", { class:"right" }, ["DB %"])
          ])
        ]),
        el("tbody", {}, rows.map(r=>{
          return el("tr", {}, [
            el("td", { html: escapeHtml(r.name) }),
            el("td", {}, [r.type==="bundle" ? "Bundle" : "Gericht"]),
            el("td", { html: escapeHtml(r.cat) }),
            el("td", { class:"right" }, [fmtEUR(r.cost)]),
            el("td", { class:"right" }, [fmtEUR(r.price)]),
            el("td", { class:`right ${r.db>=0?"ok":"bad"}` }, [fmtEUR(r.db)]),
            el("td", { class:`right ${r.dbPct>=0?"ok":"bad"}` }, [`${r.dbPct.toFixed(1)}%`])
          ]);
        }))
      ])
    ])
  ]);

  return el("div", { class:"grid" }, [card1, card2, table]);
}

/* ----------------------- Inventur (inkl. Import) ----------------------- */
function renderInventory(st){
  const wrap = el("div", { class:"grid" });

  const inv_group = el("input", { class:"input", placeholder:"z.B. Fleisch, Saucen, Verpackung", disabled: !isAdmin() });
  const inv_name = el("input", { class:"input", placeholder:"z.B. Currywurst gelb", disabled: !isAdmin() });
  const inv_supplier = el("input", { class:"input", placeholder:"z.B. Metro", disabled: !isAdmin() });
  const inv_packSize = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 1000", disabled: !isAdmin() });
  const inv_unit = el("select", { class:"input", disabled: !isAdmin() }, [
    el("option", { value:"g" }, ["g"]),
    el("option", { value:"ml" }, ["ml"]),
    el("option", { value:"stk" }, ["stk"])
  ]);
  const inv_packPrice = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 12,50", disabled: !isAdmin() });
  const inv_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

  const btnAddInv = el("button", { class:"btn primary", disabled: !isAdmin() }, ["Artikel speichern"]);

  const inv_tbody = el("tbody", {});
  const editor = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Artikel bearbeiten"]),
    el("div", { class:"small" }, [isAdmin() ? "Noch kein Artikel ausgewählt." : "Read-only Ansicht (Admin ändert Preise/Artikel)."])
  ]);

  // CSV Import
  const fileInput = el("input", { type:"file", class:"input", accept:".csv,text/csv", disabled: !isAdmin() });
  const btnImport = el("button", { class:"btn primary", disabled: !isAdmin() }, ["CSV importieren (Merge)"]);
  const importMsg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
  btnImport.onclick = async ()=>{
    importMsg.textContent = "";
    const f = fileInput.files && fileInput.files[0];
    if(!f){ importMsg.innerHTML = `<span class="bad">Bitte CSV auswählen.</span>`; return; }
    try{
      const txt = await f.text();
      const parsed = parseCSV(txt);
      const need = ["group","name","supplier","unitType","packSize","packPrice"];
      for(const col of need){
        if(!parsed.headers.map(h=>normKey(h)).includes(normKey(col))){
          importMsg.innerHTML = `<span class="bad">CSV fehlt Spalte: ${escapeHtml(col)}</span>`;
          return;
        }
      }
      // Normalize keys to exact names
      const rows = parsed.rows.map(r=>{
        const o = {};
        for(const [k,v] of Object.entries(r)){
          o[normKey(k)] = v;
        }
        return o;
      });
      const res = mergeInventoryFromRows(st, rows);
      saveState(st);
      drawList();
      importMsg.innerHTML = `<span class="ok">Import OK.</span> Neu: ${res.created} · Update: ${res.updated} · Skip: ${res.skipped}`;
    }catch(e){
      console.error(e);
      importMsg.innerHTML = `<span class="bad">Import Fehler. Console (F12).</span>`;
    }
  };

  const form = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur – Artikel anlegen"]),
    el("div", { class:"sub" }, ["Packgröße + Packpreis → App rechnet €/g, €/ml oder €/stk."]),
    el("div", { class:"label" }, ["Warengruppe"]),
    inv_group,
    el("div", { class:"label" }, ["Artikelname (Merge-Key)"]),
    inv_name,
    el("div", { class:"label" }, ["Lieferant"]),
    inv_supplier,
    el("div", { class:"two" }, [
      el("div", {}, [el("div", { class:"label" }, ["Packgröße"]), inv_packSize]),
      el("div", {}, [el("div", { class:"label" }, ["Einheit"]), inv_unit])
    ]),
    el("div", { class:"label" }, ["Packpreis (€)"]),
    inv_packPrice,
    el("div", { class:"row", style:"margin-top:12px" }, [btnAddInv]),
    inv_msg,
    el("div", { class:"hr" }),
    el("div", { class:"title", style:"font-size:15px" }, ["CSV Import (Admin)"]),
    el("div", { class:"hint" }, [
      "CSV Spalten: group,name,supplier,unitType,packSize,packPrice — Merge über name."
    ]),
    el("div", { class:"label" }, ["CSV Datei auswählen"]),
    fileInput,
    el("div", { class:"row", style:"margin-top:10px" }, [btnImport]),
    importMsg
  ]);

  const listCard = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur – Liste (Klick zum Anzeigen/Editor)"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:560px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Artikel"]),
            el("th", {}, ["Warengruppe"]),
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
    (st.inventory||[])
      .slice()
      .sort((a,b)=> (a.group+a.name).localeCompare(b.group+b.name))
      .forEach(inv=>{
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
    editor.innerHTML = "";
    editor.appendChild(el("div", { class:"title" }, ["Artikel"]));

    if(!inv){
      editor.appendChild(el("div", { class:"small" }, ["Noch kein Artikel ausgewählt."]));
      return;
    }

    editor.appendChild(el("div", { class:"sub" }, [isAdmin() ? "Admin kann hier editieren." : "Read-only."]));

    const name = el("input", { class:"input", value: inv.name || "", disabled: !isAdmin() });
    const group = el("input", { class:"input", value: inv.group || "", disabled: !isAdmin() });
    const supplier = el("input", { class:"input", value: inv.supplier || "", disabled: !isAdmin() });
    const packSize = el("input", { class:"input", inputmode:"decimal", value: String(inv.packSize ?? ""), disabled: !isAdmin() });
    const packPrice = el("input", { class:"input", inputmode:"decimal", value: String(inv.packPrice ?? ""), disabled: !isAdmin() });
    const unit = el("select", { class:"input", disabled: !isAdmin() }, [
      el("option", { value:"g" }, ["g"]),
      el("option", { value:"ml" }, ["ml"]),
      el("option", { value:"stk" }, ["stk"])
    ]);
    unit.value = inv.unitType || "g";

    const msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
    const upView = el("div", { class:"small", style:"margin-top:6px" }, [""]);

    function refreshUP(){
      const tmp = { ...inv, packSize: packSize.value, packPrice: packPrice.value, unitType: unit.value };
      upView.innerHTML = `Preis pro Einheit: <b>${unitPrice(tmp).toFixed(4)} €/ ${escapeHtml(tmp.unitType)}</b>`;
    }
    [packSize, packPrice, unit].forEach(x=>x.addEventListener("change", refreshUP));
    refreshUP();

    const btnSave = el("button", { class:"btn primary", disabled: !isAdmin() }, ["Speichern"]);
    const btnDel = el("button", { class:"btn danger", disabled: !isAdmin() }, ["Löschen"]);

    btnSave.onclick = ()=>{
      inv.name = name.value.trim();
      inv.group = group.value.trim();
      inv.supplier = supplier.value.trim();
      inv.packSize = packSize.value.trim();
      inv.packPrice = packPrice.value.trim();
      inv.unitType = unit.value;

      if(!inv.name){
        msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`;
        return;
      }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Artikel wirklich löschen? (Rezepte/Modifiers verlieren Zuordnung)")) return;
      st.inventory = (st.inventory||[]).filter(x=>x.id!==inv.id);

      // Remove from recipes
      (st.recipes||[]).forEach(r=>{
        r.lines = (r.lines||[]).filter(l=>l.inventoryId !== inv.id);
      });

      // Remove from modifier options
      (st.modifierGroups||[]).forEach(g=>{
        g.options = (g.options||[]).filter(o=>o.inventoryId !== inv.id);
      });

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
      unitType: inv_unit.value
    };
    if(!item.name){ inv_msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`; return; }

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

/* ----------------------- Rezepte (Admin) ----------------------- */
function renderRecipes(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[
      el("div",{class:"title"},["Rezepte (Admin)"]),
      el("div",{class:"sub"},["Du hast keinen Admin-Zugriff."])
    ]);
  }

  const wrap = el("div", { class:"grid" });

  const r_top = el("input", { class:"input", placeholder:"Speisen / Getränke" });
  const r_sub = el("input", { class:"input", placeholder:"z.B. Currywurst / Cocktails" });
  const r_name = el("input", { class:"input", placeholder:"z.B. Currywurst Dippers mit Pommes" });
  const r_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
  const btnAddRecipe = el("button", { class:"btn primary" }, ["Rezept speichern"]);

  const r_tbody = el("tbody", {});
  const editor = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Rezept bearbeiten"]),
    el("div", { class:"small" }, ["Noch kein Rezept ausgewählt."])
  ]);

  const form = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Rezept – anlegen (Basis für Menu Item)"]),
    el("div", { class:"label" }, ["Top-Kategorie"]), r_top,
    el("div", { class:"label" }, ["Unterkategorie"]), r_sub,
    el("div", { class:"label" }, ["Rezeptname"]), r_name,
    el("div", { class:"row", style:"margin-top:12px" }, [btnAddRecipe]),
    r_msg
  ]);

  const listCard = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Rezepte – Liste (Klick zum Bearbeiten)"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:560px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Rezept"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class:"right" }, ["Wareneinsatz"])
          ])
        ]),
        r_tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(listCard);
  wrap.appendChild(editor);

  function drawList(){
    r_tbody.innerHTML = "";
    const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    (st.recipes||[])
      .slice()
      .sort((a,b)=> (a.topCat+a.subCat+a.name).localeCompare(b.topCat+b.subCat+b.name))
      .forEach(r=>{
        const cost = recipeCost(r, invById);
        const tr = el("tr", { style:"cursor:pointer" }, [
          el("td", { html: escapeHtml(r.name) }),
          el("td", { html: escapeHtml(`${r.topCat||""} / ${r.subCat||""}`) }),
          el("td", { class:"right" }, [fmtEUR(cost)])
        ]);
        tr.onclick = ()=> openEditor(r.id);
        r_tbody.appendChild(tr);
      });
  }

  function openEditor(id){
    const r = (st.recipes||[]).find(x=>x.id===id);
    if(!r){
      editor.innerHTML = `<div class="title">Rezept bearbeiten</div><div class="small">Noch kein Rezept ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div", { class:"title" }, [`Rezept: ${escapeHtml(r.name)}`]));
    editor.appendChild(el("div", { class:"sub" }, ["Dieses Rezept erzeugt/aktualisiert automatisch ein Menu Item. VK setzt du im Tab: Menu."]));

    const name = el("input", { class:"input", value: r.name || "" });
    const topCat = el("input", { class:"input", value: r.topCat || "" });
    const subCat = el("input", { class:"input", value: r.subCat || "" });
    const msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

    const invList = st.inventory || [];
    const selInv = el("select", { class:"input" }, invList.map(i=> el("option", { value:i.id }, [`${i.name} (${i.unitType})`]) ));
    const qty = el("input", { class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 120)" });

    const summary = el("div", { class:"sub", style:"margin-top:6px" }, [""]);
    const linesWrap = el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border)" });

    function drawLines(){
      const invById2 = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
      const cost = recipeCost(r, invById2);
      summary.innerHTML = `Wareneinsatz (Rezept): <b>${fmtEUR(cost)}</b>`;

      const tbody = el("tbody", {}, (r.lines||[]).map(l=>{
        const invItem = invById2[l.inventoryId];
        const up = invItem ? unitPrice(invItem) : 0;
        const costLine = invItem ? toNumber(l.qty)*up : 0;

        const qtyInput = el("input", { class:"input", style:"max-width:140px", inputmode:"decimal", value: String(l.qty ?? "") });
        const btnSaveQty = el("button", { class:"btn", style:"padding:7px 10px" }, ["Speichern"]);
        const btnDel = el("button", { class:"btn danger", style:"padding:7px 10px" }, ["Löschen"]);

        btnSaveQty.onclick = ()=>{
          l.qty = (qtyInput.value||"").trim();
          saveState(st);
          drawLines();
          drawList();
        };
        btnDel.onclick = ()=>{
          r.lines = (r.lines||[]).filter(x=>x.id!==l.id);
          saveState(st);
          drawLines();
          drawList();
        };

        return el("tr", {}, [
          el("td", { html: escapeHtml(invItem ? invItem.name : "— (fehlend)") }),
          el("td", { html: escapeHtml(invItem ? invItem.unitType : "") }),
          el("td", { class:"right" }, [qtyInput]),
          el("td", { class:"right" }, [up.toFixed(4)]),
          el("td", { class:"right" }, [fmtEUR(costLine)]),
          el("td", { class:"right" }, [el("div",{class:"row",style:"justify-content:flex-end"},[btnSaveQty, btnDel])])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Zutat (Inventur)"]),
            el("th", {}, ["Einheit"]),
            el("th", { class:"right" }, ["Menge"]),
            el("th", { class:"right" }, ["€/Einheit"]),
            el("th", { class:"right" }, ["Kosten"]),
            el("th", { class:"right" }, ["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    const btnSaveRecipe = el("button", { class:"btn primary" }, ["Rezept speichern"]);
    const btnDelRecipe = el("button", { class:"btn danger" }, ["Rezept löschen"]);
    const btnAddLine = el("button", { class:"btn primary" }, ["Zutat hinzufügen"]);

    btnSaveRecipe.onclick = ()=>{
      r.name = name.value.trim();
      r.topCat = topCat.value.trim();
      r.subCat = subCat.value.trim();
      if(!r.name){ msg.innerHTML = `<span class="bad">Rezeptname fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      drawLines();
    };

    btnDelRecipe.onclick = ()=>{
      if(!confirm("Rezept wirklich löschen? (Menu Item bleibt NICHT bestehen)")) return;

      // remove recipe
      st.recipes = (st.recipes||[]).filter(x=>x.id!==r.id);
      // remove menu item that depends on it
      st.menuItems = (st.menuItems||[]).filter(m => !(m.type==="recipe" && m.recipeId===r.id));
      // remove sales referencing removed menu items
      const menuIds = new Set((st.menuItems||[]).map(m=>m.id));
      st.sales = (st.sales||[]).filter(s => menuIds.has(s.menuItemId));

      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = ()=>{
      if(!(st.inventory||[]).length){
        alert("Inventur ist leer. Erst Inventur-Artikel anlegen/importieren.");
        return;
      }
      const invId = selInv.value;
      const q = (qty.value||"").trim();
      if(!invId){ alert("Bitte Inventur-Artikel wählen."); return; }
      if(!q){ alert("Bitte Menge eingeben."); return; }
      r.lines = r.lines || [];
      r.lines.push({ id: uuid(), inventoryId: invId, qty: q });
      qty.value = "";
      saveState(st);
      drawLines();
      drawList();
    };

    editor.appendChild(el("div", { class:"grid", style:"margin-top:10px" }, [
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Rezeptname"]), name]),
      el("div", { class:"col-3" }, [el("div",{class:"label"},["Top-Kategorie"]), topCat]),
      el("div", { class:"col-3" }, [el("div",{class:"label"},["Unterkategorie"]), subCat]),
      el("div", { class:"col-12" }, [summary]),
      el("div", { class:"col-12" }, [el("div", { class:"row" }, [btnSaveRecipe, btnDelRecipe])]),
      el("div", { class:"col-12" }, [msg]),
      el("div", { class:"col-12" }, [el("div", { class:"hr" })]),
      el("div", { class:"col-12" }, [
        el("div", { class:"title", style:"font-size:15px" }, ["Zutaten"]),
        el("div", { class:"two", style:"margin-top:8px" }, [
          el("div", {}, [el("div",{class:"label"},["Inventur-Artikel"]), selInv]),
          el("div", {}, [el("div",{class:"label"},["Menge"]), qty])
        ]),
        el("div", { class:"row", style:"margin-top:10px" }, [btnAddLine]),
        el("div", { class:"hr" }),
        linesWrap
      ])
    ]));

    drawLines();
  }

  btnAddRecipe.onclick = ()=>{
    r_msg.textContent = "";

    const r = {
      id: uuid(),
      topCat: (r_top.value||"").trim(),
      subCat: (r_sub.value||"").trim(),
      name: (r_name.value||"").trim(),
      lines: []
    };
    if(!r.name){ r_msg.innerHTML = `<span class="bad">Rezeptname fehlt.</span>`; return; }

    st.recipes.push(r);
    saveState(st);

    r_name.value = "";
    r_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawList();
  };

  drawList();
  return wrap;
}

/* ----------------------- Menu (Speisekarte) ----------------------- */
function renderMenu(st){
  ensureMenuFromRecipes(st);
  const wrap = el("div",{class:"grid"});

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Menu Item bearbeiten"]),
    el("div",{class:"small"},["Noch kein Item ausgewählt."])
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Menu Items (Speisekarte)"]),
    el("div",{class:"sub"},["VK hier setzen. DB wird live angezeigt."]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:560px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Produkt"]),
            el("th",{},["Typ"]),
            el("th",{class:"right"},["Preis"]),
            el("th",{class:"right"},["Wareneinsatz"]),
            el("th",{class:"right"},["DB"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  const help = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Hinweise"]),
    el("div",{class:"hint"},[
      "• Rezepte erzeugen automatisch Menu Items.\n",
      "• Bundles erzeugst du im Tab: Bundles.\n",
      "• Modifiers (Add-ons / Auswahl) hängen an Menu Items."
    ])
  ]);

  wrap.appendChild(list);
  wrap.appendChild(help);
  wrap.appendChild(editor);

  function draw(){
    tbody.innerHTML = "";
    const items = (st.menuItems||[]).slice().sort((a,b)=> (a.topCat+a.subCat+a.name).localeCompare(b.topCat+b.subCat+b.name));
    for(const m of items){
      const calc = menuItemDB(m, st);
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(m.name)}),
        el("td",{},[m.type==="bundle"?"Bundle":"Gericht"]),
        el("td",{class:"right"},[fmtEUR(calc.price)]),
        el("td",{class:"right"},[fmtEUR(calc.cost)]),
        el("td",{class:`right ${calc.db>=0?"ok":"bad"}`},[fmtEUR(calc.db)])
      ]);
      tr.onclick = ()=> openEditor(m.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(id){
    const m = (st.menuItems||[]).find(x=>x.id===id);
    if(!m){
      editor.innerHTML = `<div class="title">Menu Item bearbeiten</div><div class="small">Noch kein Item ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Menu Item: ${escapeHtml(m.name)}`]));

    const name = el("input",{class:"input", value:m.name||"", disabled: !isAdmin() && m.type==="bundle" }); // recipe names are soft synced; keep editable only for bundle
    const topCat = el("input",{class:"input", value:m.topCat||""});
    const subCat = el("input",{class:"input", value:m.subCat||""});
    const price = el("input",{class:"input", inputmode:"decimal", value:String(m.price??"" )});
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);

    function refreshSummary(){
      const calc = menuItemDB(m, st);
      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        DB: <b class="${calc.db>=0?"ok":"bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct>=0?"ok":"bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;
    }

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    btnSave.onclick = ()=>{
      // Recipe menu items: keep name synced with recipe; allow cat + price
      if(m.type==="bundle"){
        if(isAdmin()) m.name = name.value.trim();
      }
      m.topCat = topCat.value.trim();
      m.subCat = subCat.value.trim();
      m.price = price.value.trim();
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      draw();
      refreshSummary();
    };

    // Modifiers attach
    const allGroups = st.modifierGroups || [];
    const selGroup = el("select",{class:"input"},[
      el("option",{value:""},["— Gruppe wählen —"]),
      ...allGroups.map(g=>el("option",{value:g.id},[`${g.name} (${g.mode})`]))
    ]);
    const btnAddGroup = el("button",{class:"btn primary", disabled: !isAdmin()},["Gruppe hinzufügen"]);
    const btnRemoveGroup = el("button",{class:"btn danger", disabled: !isAdmin()},["Gruppe entfernen"]);
    const groupsBox = el("div",{class:"small", style:"margin-top:8px"},[""]);

    function drawGroups(){
      const ids = m.modifierGroupIds || [];
      const names = ids.map(id=>{
        const g = allGroups.find(x=>x.id===id);
        return g ? g.name : "(fehlend)";
      });
      groupsBox.innerHTML = names.length
        ? `Verknüpfte Gruppen: <b>${escapeHtml(names.join(", "))}</b>`
        : `Verknüpfte Gruppen: <b>—</b>`;
    }

    btnAddGroup.onclick = ()=>{
      const gid = selGroup.value;
      if(!gid) return;
      m.modifierGroupIds = m.modifierGroupIds || [];
      if(!m.modifierGroupIds.includes(gid)) m.modifierGroupIds.push(gid);
      saveState(st);
      drawGroups();
    };

    btnRemoveGroup.onclick = ()=>{
      const gid = selGroup.value;
      if(!gid) return;
      m.modifierGroupIds = (m.modifierGroupIds||[]).filter(x=>x!==gid);
      saveState(st);
      drawGroups();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Top-Kategorie"]), topCat]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Unterkategorie"]), subCat]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["VK Preis (€)"]), price]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Modifiers (Verknüpfung)"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Gruppe"]), selGroup]),
          el("div",{},[el("div",{class:"label"},["Aktion"]), el("div",{class:"row"},[btnAddGroup, btnRemoveGroup])])
        ]),
        groupsBox
      ])
    ]));

    refreshSummary();
    drawGroups();
  }

  draw();
  return wrap;
}

/* ----------------------- Modifiers (Admin) ----------------------- */
function renderModifiers(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[
      el("div",{class:"title"},["Modifiers (Admin)"]),
      el("div",{class:"sub"},["Du hast keinen Admin-Zugriff."])
    ]);
  }

  const wrap = el("div",{class:"grid"});

  const g_name = el("input",{class:"input", placeholder:"z.B. Extra Käse / Saucen Auswahl"});
  const g_mode = el("select",{class:"input"},[
    el("option",{value:"add"},["add (Add-ons)"]),
    el("option",{value:"choose"},["choose (Auswahl)"])
  ]);
  const g_min = el("input",{class:"input", inputmode:"decimal", placeholder:"min (z.B. 0)"});
  const g_max = el("input",{class:"input", inputmode:"decimal", placeholder:"max (z.B. 2)"});
  const g_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Gruppe speichern"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Gruppe bearbeiten"]),
    el("div",{class:"small"},["Noch keine Gruppe ausgewählt."])
  ]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Modifier-Gruppe anlegen"]),
    el("div",{class:"label"},["Name"]), g_name,
    el("div",{class:"label"},["Mode"]), g_mode,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Min"]), g_min]),
      el("div",{},[el("div",{class:"label"},["Max"]), g_max])
    ]),
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    g_msg,
    el("div",{class:"hr"}),
    el("div",{class:"hint"},[
      "Optionen können:\n",
      "• nur VK-Aufpreis sein (priceDelta)\n",
      "• optional auch Kosten beeinflussen (Inventory + qty)\n",
      "Damit siehst du später DB mit Extras sauber."
    ])
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Gruppenliste (Klick)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:560px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Name"]),
            el("th",{},["Mode"]),
            el("th",{class:"right"},["Min/Max"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function draw(){
    tbody.innerHTML = "";
    (st.modifierGroups||[])
      .slice()
      .sort((a,b)=> (a.name||"").localeCompare(b.name||""))
      .forEach(g=>{
        const tr = el("tr",{style:"cursor:pointer"},[
          el("td",{html:escapeHtml(g.name)}),
          el("td",{},[g.mode]),
          el("td",{class:"right"},[`${toNumber(g.min)} / ${toNumber(g.max)}`])
        ]);
        tr.onclick = ()=> openEditor(g.id);
        tbody.appendChild(tr);
      });
  }

  function openEditor(id){
    const g = (st.modifierGroups||[]).find(x=>x.id===id);
    if(!g){
      editor.innerHTML = `<div class="title">Gruppe bearbeiten</div><div class="small">Noch keine Gruppe ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Gruppe: ${escapeHtml(g.name)}`]));

    const name = el("input",{class:"input", value:g.name||""});
    const mode = el("select",{class:"input"},[
      el("option",{value:"add"},["add"]),
      el("option",{value:"choose"},["choose"])
    ]);
    mode.value = g.mode || "add";

    const min = el("input",{class:"input", inputmode:"decimal", value:String(g.min ?? 0)});
    const max = el("input",{class:"input", inputmode:"decimal", value:String(g.max ?? 1)});
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Löschen"]);

    // Option editor
    const inv = st.inventory || [];
    const selInv = el("select",{class:"input"},[
      el("option",{value:""},["(optional) Inventur-Artikel verknüpfen"]),
      ...inv.map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`]))
    ]);
    const o_label = el("input",{class:"input", placeholder:"Label (z.B. Extra Cheddar)"});
    const o_price = el("input",{class:"input", inputmode:"decimal", placeholder:"VK Aufpreis (z.B. 1,00)"});
    const o_qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge für Kosten (z.B. 1 oder 30g)"});
    const o_affects = el("select",{class:"input"},[
      el("option",{value:"yes"},["Kosten beeinflussen: ja"]),
      el("option",{value:"no"},["Kosten beeinflussen: nein"])
    ]);
    o_affects.value = "yes";

    const btnAddOpt = el("button",{class:"btn primary"},["Option hinzufügen"]);
    const optWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawOptions(){
      const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
      optWrap.innerHTML = "";
      const tbody = el("tbody",{}, (g.options||[]).map(o=>{
        const invItem = o.inventoryId ? invById[o.inventoryId] : null;
        const up = invItem ? unitPrice(invItem) : 0;
        const cost = (invItem && o.affectsCost) ? (toNumber(o.qty)*up) : 0;

        const btnX = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
        btnX.onclick = ()=>{
          g.options = (g.options||[]).filter(x=>x.id!==o.id);
          saveState(st);
          drawOptions();
        };

        return el("tr",{},[
          el("td",{html:escapeHtml(o.label)}),
          el("td",{class:"right"},[fmtEUR(toNumber(o.priceDelta))]),
          el("td",{html: invItem ? escapeHtml(invItem.name) : "—"}),
          el("td",{class:"right"},[o.affectsCost ? fmtEUR(cost) : "—"]),
          el("td",{class:"right"},[btnX])
        ]);
      }));

      optWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Option"]),
            el("th",{class:"right"},["VK Δ"]),
            el("th",{},["Inventur-Link"]),
            el("th",{class:"right"},["Kosten Δ (Basis)"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    btnSave.onclick = ()=>{
      g.name = name.value.trim();
      g.mode = mode.value;
      g.min = (min.value||"0").trim();
      g.max = (max.value||"1").trim();
      if(!g.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      draw();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Gruppe löschen? (Verknüpfungen in Menu Items werden entfernt)")) return;
      st.modifierGroups = (st.modifierGroups||[]).filter(x=>x.id!==g.id);
      (st.menuItems||[]).forEach(m=>{
        m.modifierGroupIds = (m.modifierGroupIds||[]).filter(id=>id!==g.id);
      });
      saveState(st);
      draw();
      openEditor(null);
    };

    btnAddOpt.onclick = ()=>{
      const label = (o_label.value||"").trim();
      if(!label) return alert("Label fehlt.");
      const priceDelta = (o_price.value||"").trim();
      const inventoryId = selInv.value || null;
      const qty = (o_qty.value||"").trim();
      const affectsCost = (o_affects.value==="yes") && !!inventoryId && !!qty;

      g.options = g.options || [];
      g.options.push({
        id: uuid(),
        label,
        priceDelta,
        inventoryId,
        qty: affectsCost ? qty : "",
        affectsCost
      });

      o_label.value = "";
      o_price.value = "";
      o_qty.value = "";
      selInv.value = "";
      o_affects.value = "yes";

      saveState(st);
      drawOptions();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Mode"]), mode]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Min/Max"]), el("div",{class:"two"},[
        el("div",{},[min]),
        el("div",{},[max])
      ])]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Optionen"]),
        el("div",{class:"grid", style:"margin-top:8px"},[
          el("div",{class:"col-4"},[el("div",{class:"label"},["Label"]), o_label]),
          el("div",{class:"col-3"},[el("div",{class:"label"},["VK Δ (€)"]), o_price]),
          el("div",{class:"col-5"},[el("div",{class:"label"},["Inventur Artikel (optional)"]), selInv]),
          el("div",{class:"col-3"},[el("div",{class:"label"},["Menge (für Kosten)"]), o_qty]),
          el("div",{class:"col-4"},[el("div",{class:"label"},["Kosten beeinflussen?"]), o_affects]),
          el("div",{class:"col-12"},[el("div",{class:"row"},[btnAddOpt])])
        ]),
        el("div",{class:"hr"}),
        optWrap
      ])
    ]));

    drawOptions();
  }

  btnAdd.onclick = ()=>{
    g_msg.textContent = "";
    const g = {
      id: uuid(),
      name: (g_name.value||"").trim(),
      mode: g_mode.value,
      min: (g_min.value||"0").trim(),
      max: (g_max.value||"1").trim(),
      options: []
    };
    if(!g.name){ g_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.modifierGroups.push(g);
    saveState(st);
    g_name.value = "";
    g_min.value = "";
    g_max.value = "";
    g_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  draw();
  return wrap;
}

/* ----------------------- Bundles (Admin) ----------------------- */
function renderBundles(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[
      el("div",{class:"title"},["Bundles (Admin)"]),
      el("div",{class:"sub"},["Du hast keinen Admin-Zugriff."])
    ]);
  }

  ensureMenuFromRecipes(st);

  const wrap = el("div",{class:"grid"});

  const b_name = el("input",{class:"input", placeholder:"z.B. Menu: Currywurst + Pommes + Getränk"});
  const b_top = el("input",{class:"input", placeholder:"Top-Kategorie (z.B. Speisen)"});
  const b_sub = el("input",{class:"input", placeholder:"Unterkategorie (z.B. Menüs)"});
  const b_price = el("input",{class:"input", inputmode:"decimal", placeholder:"VK Preis (z.B. 12,90)"});
  const b_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnCreate = el("button",{class:"btn primary"},["Bundle anlegen"]);

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Bundle bearbeiten"]),
    el("div",{class:"small"},["Noch kein Bundle ausgewählt."])
  ]);

  const form = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundle anlegen"]),
    el("div",{class:"label"},["Name"]), b_name,
    el("div",{class:"label"},["Top"]), b_top,
    el("div",{class:"label"},["Sub"]), b_sub,
    el("div",{class:"label"},["VK Preis"]), b_price,
    el("div",{class:"row", style:"margin-top:12px"},[btnCreate]),
    b_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundles Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:560px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Bundle"]),
            el("th",{class:"right"},["Preis"]),
            el("th",{class:"right"},["Wareneinsatz"]),
            el("th",{class:"right"},["DB"])
          ])
        ]),
        tbody
      ])
    ])
  ]);

  wrap.appendChild(form);
  wrap.appendChild(list);
  wrap.appendChild(editor);

  function draw(){
    tbody.innerHTML = "";
    const bundles = (st.menuItems||[]).filter(m=>m.type==="bundle").slice().sort((a,b)=> (a.name||"").localeCompare(b.name||""));
    for(const b of bundles){
      const calc = menuItemDB(b, st);
      const tr = el("tr",{style:"cursor:pointer"},[
        el("td",{html:escapeHtml(b.name)}),
        el("td",{class:"right"},[fmtEUR(calc.price)]),
        el("td",{class:"right"},[fmtEUR(calc.cost)]),
        el("td",{class:`right ${calc.db>=0?"ok":"bad"}`},[fmtEUR(calc.db)])
      ]);
      tr.onclick = ()=> openEditor(b.id);
      tbody.appendChild(tr);
    }
  }

  function openEditor(id){
    const b = (st.menuItems||[]).find(x=>x.id===id && x.type==="bundle");
    if(!b){
      editor.innerHTML = `<div class="title">Bundle bearbeiten</div><div class="small">Noch kein Bundle ausgewählt.</div>`;
      return;
    }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Bundle: ${escapeHtml(b.name)}`]));

    const name = el("input",{class:"input", value:b.name||""});
    const top = el("input",{class:"input", value:b.topCat||""});
    const sub = el("input",{class:"input", value:b.subCat||""});
    const price = el("input",{class:"input", inputmode:"decimal", value:String(b.price??"")});
    const msg = el("div",{class:"small", style:"margin-top:8px"},[""]);

    const summary = el("div",{class:"sub", style:"margin-top:8px"},[""]);
    function refresh(){
      const calc = menuItemDB(b, st);
      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        DB: <b class="${calc.db>=0?"ok":"bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct>=0?"ok":"bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;
    }

    const btnSave = el("button",{class:"btn primary"},["Speichern"]);
    const btnDel = el("button",{class:"btn danger"},["Löschen"]);

    btnSave.onclick = ()=>{
      b.name = name.value.trim();
      b.topCat = top.value.trim();
      b.subCat = sub.value.trim();
      b.price = price.value.trim();
      if(!b.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      draw();
      refresh();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Bundle löschen?")) return;
      st.menuItems = (st.menuItems||[]).filter(x=>x.id!==b.id);
      st.sales = (st.sales||[]).filter(s=>s.menuItemId !== b.id);
      saveState(st);
      draw();
      openEditor(null);
    };

    const allMenu = (st.menuItems||[]).filter(m=>m.id!==b.id);
    const sel = el("select",{class:"input"},[
      ...allMenu.map(m=>el("option",{value:m.id},[`${m.name} (${m.type})`]))
    ]);
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Qty (z.B. 1)"});
    const btnAdd = el("button",{class:"btn primary"},["Item hinzufügen"]);

    const itemsWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawItems(){
      itemsWrap.innerHTML = "";
      const tbody = el("tbody",{}, (b.bundleItems||[]).map(it=>{
        const child = (st.menuItems||[]).find(x=>x.id===it.menuItemId);
        const cName = child ? child.name : "(fehlend)";
        const btnX = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
        btnX.onclick = ()=>{
          b.bundleItems = (b.bundleItems||[]).filter(x=>x !== it);
          saveState(st);
          drawItems();
          refresh();
          draw();
        };
        return el("tr",{},[
          el("td",{html:escapeHtml(cName)}),
          el("td",{class:"right"},[String(toNumber(it.qty)||1)]),
          el("td",{class:"right"},[btnX])
        ]);
      }));

      itemsWrap.appendChild(el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Menu Item"]),
            el("th",{class:"right"},["Qty"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        tbody
      ]));
    }

    btnAdd.onclick = ()=>{
      const mid = sel.value;
      const q = (qty.value||"1").trim();
      if(!mid) return;
      b.bundleItems = b.bundleItems || [];
      b.bundleItems.push({ menuItemId: mid, qty: q });
      qty.value = "";
      saveState(st);
      drawItems();
      refresh();
      draw();
    };

    editor.appendChild(el("div",{class:"grid", style:"margin-top:10px"},[
      el("div",{class:"col-6"},[el("div",{class:"label"},["Name"]), name]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Top"]), top]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Sub"]), sub]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["VK Preis"]), price]),
      el("div",{class:"col-12"},[summary]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSave, btnDel])]),
      el("div",{class:"col-12"},[msg]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"title", style:"font-size:15px"},["Bundle Items"]),
        el("div",{class:"two", style:"margin-top:8px"},[
          el("div",{},[el("div",{class:"label"},["Menu Item"]), sel]),
          el("div",{},[el("div",{class:"label"},["Qty"]), qty])
        ]),
        el("div",{class:"row", style:"margin-top:10px"},[btnAdd]),
        el("div",{class:"hr"}),
        itemsWrap
      ])
    ]));

    drawItems();
    refresh();
  }

  btnCreate.onclick = ()=>{
    b_msg.textContent = "";
    const name = (b_name.value||"").trim();
    if(!name){ b_msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }

    st.menuItems.push({
      id: uuid(),
      type:"bundle",
      name,
      topCat: (b_top.value||"").trim() || "Speisen",
      subCat: (b_sub.value||"").trim() || "Menüs",
      price: (b_price.value||"").trim(),
      bundleItems: [],
      modifierGroupIds: []
    });
    saveState(st);
    b_name.value = "";
    b_price.value = "";
    b_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  draw();
  return wrap;
}

/* ----------------------- Sales (Menu Item Sales Mix) ----------------------- */
function renderSales(st){
  ensureMenuFromRecipes(st);

  const wrap = el("div", { class:"grid" });
  const today = todayISO();

  const s_date = el("input", { class:"input", value: today });
  const menu = (st.menuItems||[]).slice().sort((a,b)=> (a.topCat+a.subCat+a.name).localeCompare(b.topCat+b.subCat+b.name));
  const s_item = el("select", { class:"input" }, menu.map(m=>el("option",{value:m.id},[`${m.name} (${m.type})`])) );
  const s_qty = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 20" });
  const s_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

  const btnAddSale = el("button", { class:"btn primary" }, ["Speichern"]);
  const s_tbody = el("tbody", {});
  const s_summary = el("div", { class:"sub" }, [""]);

  const card = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Daily Sales – Eingabe"]),
    el("div", { class:"label" }, ["Datum"]), s_date,
    el("div", { class:"label" }, ["Menu Item"]), s_item,
    el("div", { class:"label" }, ["Anzahl verkauft"]), s_qty,
    el("div", { class:"row", style:"margin-top:12px" }, [btnAddSale]),
    s_msg
  ]);

  const list = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Einträge"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:420px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Produkt"]),
            el("th", { class:"right" }, ["Qty"]),
            el("th", { class:"right" }, ["DB gesamt"]),
            el("th", { class:"right" }, ["Aktion"])
          ])
        ]),
        s_tbody
      ])
    ])
  ]);

  const summaryCard = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Tagesauswertung"]),
    el("div", { class:"hr" }),
    s_summary
  ]);

  wrap.appendChild(card);
  wrap.appendChild(list);
  wrap.appendChild(summaryCard);

  function draw(){
    s_tbody.innerHTML = "";
    const date = (s_date.value||today).trim();
    const entries = (st.sales||[]).filter(x=>x.date === date);

    let dbSum = 0;
    entries.forEach(e=>{
      const m = (st.menuItems||[]).find(x=>x.id===e.menuItemId);
      const calc = m ? menuItemDB(m, st) : { db:0 };
      const lineDb = (calc.db || 0) * toNumber(e.qty);
      dbSum += lineDb;

      const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
      btnDel.onclick = ()=>{
        st.sales = (st.sales||[]).filter(x=>x.id!==e.id);
        saveState(st);
        draw();
      };

      s_tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(m ? m.name : "— (fehlend)")}),
        el("td",{class:"right"},[String(toNumber(e.qty))]),
        el("td",{class:`right ${lineDb>=0?"ok":"bad"}`},[fmtEUR(lineDb)]),
        el("td",{class:"right"},[btnDel])
      ]));
    });

    s_summary.innerHTML = `Tages-DB (Basis, ohne Modifiers Auswahl): <b class="${dbSum>=0?"ok":"bad"}">${fmtEUR(dbSum)}</b>`;
  }

  btnAddSale.onclick = ()=>{
    s_msg.textContent = "";

    const date = (s_date.value||today).trim();
    const menuItemId = s_item.value;
    const qty = (s_qty.value||"").trim();
    if(!menuItemId){ s_msg.innerHTML = `<span class="bad">Produkt fehlt.</span>`; return; }
    if(!qty){ s_msg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }

    st.sales.push({ id: uuid(), date, menuItemId, qty });
    saveState(st);
    s_qty.value = "";
    s_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  s_date.addEventListener("change", draw);
  draw();
  return wrap;
}

/* ----------------------- Params (vollständig) ----------------------- */
function renderParams(st){
  const wrap = el("div",{class:"grid"});
  st.params = st.params || defaultState().params;

  const p = st.params;

  const inputs = {
    franchisePct: el("input",{class:"input", inputmode:"decimal", value:String(p.franchisePct ?? 0)}),
    platformFeePct: el("input",{class:"input", inputmode:"decimal", value:String(p.platformFeePct ?? 0)}),
    paymentFeePct: el("input",{class:"input", inputmode:"decimal", value:String(p.paymentFeePct ?? 0)}),
    vatPct: el("input",{class:"input", inputmode:"decimal", value:String(p.vatPct ?? 7)}),

    fixedCostsMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly ?? 0)}),
    rentMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.rentMonthly ?? 0)}),
    laborMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.laborMonthly ?? 0)}),
    utilitiesMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.utilitiesMonthly ?? 0)}),
    otherFixedMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.otherFixedMonthly ?? 0)}),

    capexMonthly: el("input",{class:"input", inputmode:"decimal", value:String(p.capexMonthly ?? 0)})
  };

  const p_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnSave = el("button",{class:"btn primary"},["Speichern"]);

  btnSave.onclick = ()=>{
    st.params = st.params || {};
    for(const [k,input] of Object.entries(inputs)){
      st.params[k] = (input.value||"0").trim();
    }
    saveState(st);
    p_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
  };

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Parameter / Kosten"]),
    el("div",{class:"sub"},["DB berücksichtigt: Franchise% + Platform% + Payment% (auf Umsatz). Fix/Invest sind gespeichert für spätere Break-Even/Target-Preis Module."]),
    el("div",{class:"hr"}),
    el("div",{class:"grid"},[
      el("div",{class:"col-3"},[el("div",{class:"label"},["Franchise %"]), inputs.franchisePct]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Platform Fee %"]), inputs.platformFeePct]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["Payment Fee %"]), inputs.paymentFeePct]),
      el("div",{class:"col-3"},[el("div",{class:"label"},["MwSt % (speicher)"]), inputs.vatPct]),

      el("div",{class:"col-4"},[el("div",{class:"label"},["Fixkosten gesamt / Monat"]), inputs.fixedCostsMonthly]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Miete / Monat"]), inputs.rentMonthly]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Personal / Monat"]), inputs.laborMonthly]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Utilities / Monat"]), inputs.utilitiesMonthly]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Sonst. Fix / Monat"]), inputs.otherFixedMonthly]),
      el("div",{class:"col-4"},[el("div",{class:"label"},["Invest (CAPEX) / Monat"]), inputs.capexMonthly]),
    ]),
    el("div",{class:"row", style:"margin-top:12px"},[btnSave]),
    p_msg
  ]));

  return wrap;
}

/* ----------------------- Users (Admin) ----------------------- */
function renderUsers(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  }

  const wrap = el("div",{class:"grid"});
  const u_name = el("input",{class:"input", placeholder:"z.B. max"});
  const u_disp = el("input",{class:"input", placeholder:"z.B. Max Mustermann"});
  const u_role = el("select",{class:"input"},[
    el("option",{value:"user"},["user"]),
    el("option",{value:"admin"},["admin"])
  ]);
  const u_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["User speichern"]);
  const u_tbody = el("tbody",{});

  function draw(){
    u_tbody.innerHTML = "";
    (st.users||[]).forEach(u=>{
      const isA = normKey(u.username)==="admin";
      const btn = isA
        ? el("span",{class:"small"},["Admin"])
        : el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

      if(!isA){
        btn.onclick = ()=>{
          if(!confirm("User löschen?")) return;
          st.users = (st.users||[]).filter(x => normKey(x.username) !== normKey(u.username));
          saveState(st);
          draw();
        };
      }

      u_tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(u.username)}),
        el("td",{html:escapeHtml(u.displayName||u.username)}),
        el("td",{html:escapeHtml(u.role||"user")}),
        el("td",{class:"right"},[btn])
      ]));
    });
  }

  btnAdd.onclick = ()=>{
    u_msg.textContent = "";
    const username = (u_name.value||"").trim();
    const displayName = (u_disp.value||"").trim();
    const roleV = u_role.value;

    if(!username){ u_msg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ u_msg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }

    const exists = (st.users||[]).some(x => normKey(x.username) === normKey(username));
    if(exists){ u_msg.innerHTML = `<span class="bad">Username existiert schon.</span>`; return; }

    st.users.push({ username, displayName: displayName || username, role: roleV });
    saveState(st);

    u_name.value = "";
    u_disp.value = "";
    u_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const card = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["User anlegen"]),
    el("div",{class:"label"},["Username"]), u_name,
    el("div",{class:"label"},["Display Name"]), u_disp,
    el("div",{class:"label"},["Role"]), u_role,
    el("div",{class:"row", style:"margin-top:12px"},[btnAdd]),
    u_msg
  ]);

  const list = el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["User Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:420px"},[
      el("table",{},[
        el("thead",{},[
          el("tr",{},[
            el("th",{},["Username"]),
            el("th",{},["Display"]),
            el("th",{},["Role"]),
            el("th",{class:"right"},["Aktion"])
          ])
        ]),
        u_tbody
      ])
    ])
  ]);

  wrap.appendChild(card);
  wrap.appendChild(list);
  draw();
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
