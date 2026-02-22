/* =========================================================
   HEISSE ECKE – KALKULATION (Web) – STABLE BASE
   Single-File JS for GitHub Pages
   - Local-first (funktioniert immer)
   - Supabase Sync optional (blockiert Login NIE)
   - Workspace + User + Outlet Pflicht
   - Rollenmodell:
       admin  -> alles
       manager-> outlet: Bestand/Sales/Preise (keine globalen Rezepte/Inventur)
       staff  -> outlet: Bestand/Sales (keine Preise)
========================================================= */

/* ----------------------- CONFIG ----------------------- */
const SUPABASE_URL_DEFAULT = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_DEFAULT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

/* ----------------------- Storage Keys ----------------------- */
const LS = {
  theme: "he_theme",
  workspace: "he_workspace",
  session: "he_session",
  state: "he_state_v2",
  activeTab: "he_active_tab_v2",
  lastSaved: "he_last_saved",
  syncStatus: "he_sync_status",
  supaUrl: "he_supa_url",
  supaAnon: "he_supa_anon"
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
  if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
}

/* ----------------------- Theme ----------------------- */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS.theme) || "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}

/* ----------------------- Supabase creds (editable in UI) ----------------------- */
function getSupaUrl(){ return (localStorage.getItem(LS.supaUrl) || SUPABASE_URL_DEFAULT).trim(); }
function getSupaAnon(){ return (localStorage.getItem(LS.supaAnon) || SUPABASE_ANON_DEFAULT).trim(); }
function setSupaCreds(url, anon){
  localStorage.setItem(LS.supaUrl, (url||"").trim());
  localStorage.setItem(LS.supaAnon, (anon||"").trim());
}

/* ----------------------- Workspace / Session ----------------------- */
function getWorkspace(){ return (localStorage.getItem(LS.workspace)||"").trim(); }
function setWorkspace(ws){ localStorage.setItem(LS.workspace, (ws||"").trim()); }
function getSession(){ return readLS(LS.session, null); }
function setSession(s){ writeLS(LS.session, s); }
function clearSession(){ localStorage.removeItem(LS.session); }
function getActiveTab(){ return readLS(LS.activeTab, "dashboard"); }
function setActiveTab(id){ writeLS(LS.activeTab, id); }

/* ----------------------- State Model ----------------------- */
function defaultState(){
  return {
    meta: { version: 2, createdAt: nowISO() },

    outlets: [
      { id: "outlet_1", name: "Outlet 1" }
    ],

    users: [
      { username: "admin", displayName: "Admin", role: "admin", outlets: ["*"] }
    ],

    // GLOBAL Inventur-Stamm (nur Admin ändert Preise/Artikel)
    inventory: [
      // {id, group, name, supplier, unitType('g'|'ml'|'stk'), packSize, packPrice}
    ],

    // GLOBAL Preps (Saucen etc.) -> werden wie Rezepte kalkuliert und können als Zutat genutzt werden
    preps: [
      // {id, topCat, subCat, name, yieldUnitType('g'|'ml'|'stk'), yieldQty, lines:[{id, type:'inventory', inventoryId, qty}]}
    ],

    // GLOBAL Rezepte -> Lines dürfen inventory oder prep referenzieren
    recipes: [
      // {id, topCat, subCat, name, lines:[{id, type:'inventory'|'prep', inventoryId?, prepId?, qty}]}
    ],

    // GLOBAL Menüartikel (Speisekarte-Produkt) -> referenziert 1 Rezept oder 1 Bundle
    menuItems: [
      // {id, name, kind:'recipe'|'bundle', recipeId?, bundleId?, modifiersEnabled:true/false}
    ],

    bundles: [
      // {id, name, items:[{id, menuItemId, qty}]}
    ],

    // Parameter GLOBAL (Admin)
    params: {
      vatPct: 7,
      franchisePct: 0,
      platformCommissionPct: 0,
      paymentFeePct: 0,
      packagingPct: 0,          // optionaler Zuschlag vom VK
      wastePct: 0,              // optionaler Zuschlag vom Wareneinsatz

      fixedCostsMonthly: {
        rent: 0,
        staff: 0,
        utilities: 0,
        marketing: 0,
        other: 0
      },
      investmentMonthly: {
        equipmentLeasing: 0,
        loan: 0,
        depreciation: 0
      }
    },

    // OUTLET-spezifisch (Preise, Bestände, Sales)
    outletData: {
      // [outletId]: { menuPrices: { [menuItemId]: price }, stock: { [inventoryId]: qty }, sales: [{...}] }
    }
  };
}

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
  scheduleCloudSave(); // optional, blockiert nie
}

/* ----------------------- Permissions ----------------------- */
function role(){ return (getSession()?.role || "staff"); }
function isAdmin(){ return role() === "admin"; }
function isManager(){ return role() === "manager"; }
function canEditGlobal(){ return isAdmin(); }
function canEditOutletPrices(){ return isAdmin() || isManager(); }
function canEditOutletOps(){ return isAdmin() || isManager() || role()==="staff"; }

function userHasOutletAccess(user, outletId){
  if(!user) return false;
  if(user.role === "admin") return true;
  if((user.outlets||[]).includes("*")) return true;
  return (user.outlets||[]).includes(outletId);
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

// Prep: cost per yield-unit (€/g, €/ml, €/stk)
function prepUnitCost(prep, invById, prepById){
  const yieldQty = toNumber(prep.yieldQty);
  if(yieldQty <= 0) return 0;
  const total = (prep.lines||[]).reduce((sum, l)=>{
    if(l.type === "inventory"){
      const inv = invById[l.inventoryId];
      if(!inv) return sum;
      return sum + toNumber(l.qty) * unitPrice(inv);
    }
    if(l.type === "prep"){
      const p2 = prepById[l.prepId];
      if(!p2) return sum;
      const u = prepUnitCost(p2, invById, prepById);
      return sum + toNumber(l.qty) * u;
    }
    return sum;
  }, 0);
  return total / yieldQty;
}

function recipeCost(recipe, invById, prepById){
  return (recipe.lines||[]).reduce((sum, l)=>{
    if(l.type === "inventory"){
      const inv = invById[l.inventoryId];
      if(!inv) return sum;
      return sum + toNumber(l.qty) * unitPrice(inv);
    }
    if(l.type === "prep"){
      const prep = prepById[l.prepId];
      if(!prep) return sum;
      return sum + toNumber(l.qty) * prepUnitCost(prep, invById, prepById);
    }
    return sum;
  }, 0);
}

function applyWaste(cost, params){
  const w = toNumber(params?.wastePct)/100;
  return cost + (cost*w);
}

function menuItemCost(menuItem, st){
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));
  const recipeById = Object.fromEntries((st.recipes||[]).map(x=>[x.id,x]));
  const bundleById = Object.fromEntries((st.bundles||[]).map(x=>[x.id,x]));

  if(menuItem.kind === "recipe"){
    const r = recipeById[menuItem.recipeId];
    if(!r) return 0;
    return applyWaste(recipeCost(r, invById, prepById), st.params||{});
  }
  if(menuItem.kind === "bundle"){
    const b = bundleById[menuItem.bundleId];
    if(!b) return 0;
    return applyWaste((b.items||[]).reduce((sum, it)=>{
      const mi = (st.menuItems||[]).find(x=>x.id===it.menuItemId);
      if(!mi) return sum;
      return sum + (menuItemCost(mi, st) * (toNumber(it.qty)||1));
    }, 0), st.params||{});
  }
  return 0;
}

function menuItemDB(menuItem, price, st){
  const params = st.params || {};
  const vk = toNumber(price);
  const cost = menuItemCost(menuItem, st);

  const fr = toNumber(params.franchisePct)/100;
  const plat = toNumber(params.platformCommissionPct)/100;
  const pay = toNumber(params.paymentFeePct)/100;
  const pack = toNumber(params.packagingPct)/100;

  const db = vk - cost - (vk*fr) - (vk*plat) - (vk*pay) - (vk*pack);
  const dbPct = vk > 0 ? (db/vk)*100 : 0;
  return { vk, cost, db, dbPct };
}

/* ----------------------- Supabase Sync (optional, never blocks) ----------------------- */
function setSyncStatus(text){
  localStorage.setItem(LS.syncStatus, text);
  const n = $("#syncStatus");
  if(n) n.textContent = text;
}

async function supabaseUpsert(workspace, data){
  const base = getSupaUrl();
  const key = getSupaAnon();
  const url = `${base}/rest/v1/app_state?on_conflict=workspace`;
  const body = [{ workspace, data, updated_at: nowISO() }];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
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
  const base = getSupaUrl();
  const key = getSupaAnon();
  const url = `${base}/rest/v1/app_state?workspace=eq.${encodeURIComponent(workspace)}&select=data,updated_at`;
  const res = await fetch(url, {
    headers: { "apikey": key, "Authorization": `Bearer ${key}` }
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
      console.warn(e);
      setSyncStatus("Sync: aus (lokal ok) ⚠️");
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
      // erste Initialisierung in Cloud
      const st = loadState();
      await supabaseUpsert(ws, { ...st, savedAt: localStorage.getItem(LS.lastSaved) || nowISO() });
      setSyncStatus("Sync: initial ✅");
    }
  }catch(e){
    console.warn(e);
    setSyncStatus("Sync: aus (lokal ok) ⚠️");
  }
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
    :root{
      --bg:#f5f7fb; --card:#ffffff; --text:#0f172a; --muted:#5b677a;
      --border:#d8e1ee; --primary:#2563eb; --danger:#dc2626; --ok:#16a34a;
      --input:#f2f6ff; --tab:#eef3ff;
    }
    :root[data-theme="dark"]{
      --bg:#0b0f14; --card:#121926; --text:#e8eef9; --muted:#a6b0c3;
      --border:#223049; --primary:#4ea1ff; --danger:#ff5a5f; --ok:#39d98a;
      --input:#0f1522; --tab:#0e1420;
    }
    body{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
    .container{ max-width:1180px; margin:0 auto; padding:16px; }
    .topbar{ display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; }
    .title{ font-size:18px; font-weight:900; }
    .sub{ color:var(--muted); font-size:12px; line-height:1.4; }
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
    @media (max-width: 950px){ .col-6,.col-4,.col-8,.col-3{ grid-column: span 12; } }
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
    .two > div{ flex:1; min-width:220px; }
    .mutedBox{ border:1px dashed var(--border); border-radius:12px; padding:10px; color:var(--muted); font-size:12px; }
  `});
  document.head.appendChild(style);
}

/* ----------------------- Screens ----------------------- */
function screenLogin(){
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";

  applyTheme(localStorage.getItem(LS.theme) || "light");

  const st = loadState();

  const wsInput = el("input", { class:"input", value: getWorkspace(), placeholder:"z.B. heisse-ecke" });
  const userInput = el("input", { class:"input", value: (getSession()?.username||"") || "admin", placeholder:"admin oder angelegter User" });

  const outletSel = el("select", { class:"input" }, (st.outlets||[]).map(o=>el("option",{value:o.id},[o.name])));
  outletSel.value = (getSession()?.outletId) || (st.outlets?.[0]?.id || "outlet_1");

  const msg = el("div", { class:"small", style:"margin-top:10px" }, [""]);

  const btnLogin = el("button", { class:"btn primary" }, ["Weiter"]);
  const btnTheme = el("button", { class:"btn" }, ["Hell/Dunkel"]);
  btnTheme.onclick = toggleTheme;

  const btnSyncTry = el("button", { class:"btn" }, ["Sync testen"]);
  btnSyncTry.onclick = async ()=>{
    msg.textContent = "";
    const w = (wsInput.value||"").trim();
    if(!w){ msg.textContent = "Workspace ist Pflicht."; return; }
    setWorkspace(w);
    await cloudPullOnStart(); // blockiert nicht
    msg.innerHTML = `<span class="ok">OK. (Wenn Sync aus ist: lokal geht trotzdem.)</span>`;
  };

  btnLogin.onclick = async ()=>{
    msg.textContent = "";

    const w = (wsInput.value || "").trim();
    const u = (userInput.value || "").trim();
    const outletId = (outletSel.value || "").trim();

    if(!w){ msg.textContent = "Workspace ist Pflicht."; return; }
    if(!u){ msg.textContent = "Username fehlt."; return; }
    if(!outletId){ msg.textContent = "Outlet ist Pflicht."; return; }

    setWorkspace(w);
    await cloudPullOnStart(); // NIE blockieren

    const st2 = loadState();

    const user = (st2.users||[]).find(x => String(x.username||"").toLowerCase() === u.toLowerCase());
    if(!user){
      msg.textContent = "Unbekannter User. (Admin muss dich anlegen)";
      return;
    }
    if(!userHasOutletAccess(user, outletId)){
      msg.textContent = "Du hast keinen Zugriff auf dieses Outlet.";
      return;
    }

    setSession({
      username: user.username,
      displayName: user.displayName || user.username,
      role: user.role || "staff",
      outletId
    });

    // ensure outletData exists
    st2.outletData = st2.outletData || {};
    st2.outletData[outletId] = st2.outletData[outletId] || { menuPrices:{}, stock:{}, sales:[] };
    saveState(st2);

    screenApp();
  };

  // Supabase Settings (damit du NICHT redeployen musst wenn Key/URL geändert)
  const supaUrl = el("input", { class:"input", value: getSupaUrl() });
  const supaAnon = el("textarea", { class:"input", style:"min-height:90px", html:"" }, []);
  supaAnon.value = getSupaAnon();

  const btnSaveSupa = el("button", { class:"btn" }, ["Supabase speichern"]);
  btnSaveSupa.onclick = ()=>{
    setSupaCreds(supaUrl.value, supaAnon.value);
    msg.innerHTML = `<span class="ok">Supabase gespeichert. Jetzt: "Sync testen".</span>`;
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
    el("div", { class:"small", style:"margin-top:8px" }, ["Hinweis: Outlet-Auswahl ist Pflicht."]),
    el("div", { class:"row", style:"margin-top:12px" }, [btnLogin, btnTheme, btnSyncTry]),
    msg
  ]);

  const info = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Was diese Version kann (Basis)"]),
    el("div", { class:"sub", html: `
      ✅ Login: Workspace + User + Outlet<br/>
      ✅ Rollen: Admin / Manager / Staff<br/>
      ✅ Inventur-Stamm (Admin)<br/>
      ✅ Preps (Saucen etc.) (Admin)<br/>
      ✅ Rezepte (Admin) mit Inventur + Preps als Zutaten<br/>
      ✅ Menüartikel + Bundle (Admin)<br/>
      ✅ Outlet: Preise (Admin/Manager), Bestand & Sales (alle)<br/>
      ✅ DB € / % live berechnet<br/>
      ✅ Local Save immer, Sync optional
    `})
  ]);

  const supa = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Supabase (optional – für Sync)"]),
    el("div", { class:"sub" }, ["Wenn Sync Probleme macht: App funktioniert trotzdem lokal."]),
    el("div", { class:"grid", style:"margin-top:8px" }, [
      el("div",{class:"col-6"},[el("div",{class:"label"},["Project URL"]), supaUrl]),
      el("div",{class:"col-6"},[el("div",{class:"label"},["Anon Public Key (1 Zeile, ohne Extra Spaces)"]), supaAnon]),
      el("div",{class:"col-12"},[el("div",{class:"row"},[btnSaveSupa]), el("div",{class:"pill", id:"syncStatus"},[localStorage.getItem(LS.syncStatus)||"Sync: bereit"])])
    ])
  ]);

  root.appendChild(el("div", { class:"container" }, [
    el("div", { class:"topbar" }, [
      el("div", {}, [
        el("div", { class:"title" }, ["Heisse Ecke – Kalkulation (Web)"]),
        el("div", { class:"sub" }, ["GitHub Pages · Supabase Sync · Single File"])
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"pill", id:"syncStatus" }, [localStorage.getItem(LS.syncStatus) || "Sync: bereit"])
      ])
    ]),
    el("div", { class:"grid", style:"margin-top:12px" }, [card, info, supa])
  ]));
}

function screenApp(){
  injectBaseStyles();
  const root = ensureRoot();
  root.innerHTML = "";
  applyTheme(localStorage.getItem(LS.theme) || "light");

  const s = getSession();
  if(!s){ screenLogin(); return; }

  const st = loadState();
  const outlet = (st.outlets||[]).find(o=>o.id===s.outletId);
  if(!outlet){ clearSession(); screenLogin(); return; }

  const header = el("div", { class:"topbar" }, [
    el("div", {}, [
      el("div", { class:"title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", { class:"sub", html: `
        Workspace: <b>${escapeHtml(getWorkspace())}</b> · <span id="syncStatus">${escapeHtml(localStorage.getItem(LS.syncStatus)||"Sync: bereit")}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(s.username)}) · Rolle: <b>${escapeHtml(s.role)}</b><br/>
        Outlet: <b>${escapeHtml(outlet.name)}</b> · Letzte Speicherung: <b>${escapeHtml(localStorage.getItem(LS.lastSaved)||"—")}</b>
      `})
    ]),
    el("div", { class:"row" }, [
      el("button", { class:"btn", onclick: toggleTheme }, ["Hell/Dunkel"]),
      el("button", { class:"btn", onclick: async ()=>{
        await cloudPullOnStart();   // lädt falls möglich
        renderActiveTab(getActiveTab());
      }}, ["Sync pull"]),
      el("button", { class:"btn", onclick: async ()=>{
        try{
          setSyncStatus("Sync: speichere …");
          await supabaseUpsert(getWorkspace(), { ...loadState(), savedAt: localStorage.getItem(LS.lastSaved)||nowISO() });
          setSyncStatus("Sync: aktuell ✅");
        }catch(e){
          console.warn(e);
          setSyncStatus("Sync: aus (lokal ok) ⚠️");
          alert("Sync ist aus (lokal funktioniert). Wenn du Sync willst: Supabase Key/URL prüfen.");
        }
      }}, ["Sync push"]),
      el("button", { class:"btn danger", onclick: ()=>{ clearSession(); screenLogin(); } }, ["Logout"])
    ])
  ]);

  const tabs = el("div", { class:"card", style:"margin-top:12px" }, [
    el("div", { class:"tabs" }, [
      tabBtn("dashboard", "Dashboard"),
      tabBtn("outlet_ops", "Outlet: Bestand & Sales"),
      tabBtn("outlet_prices", "Outlet: Preise", canEditOutletPrices()),
      tabBtn("inventory", "Inventur (Admin)", canEditGlobal()),
      tabBtn("preps", "Preps (Admin)", canEditGlobal()),
      tabBtn("recipes", "Rezepte (Admin)", canEditGlobal()),
      tabBtn("menu", "Menüartikel (Admin)", canEditGlobal()),
      tabBtn("bundles", "Bundles (Admin)", canEditGlobal()),
      tabBtn("params", "Parameter (Admin)", canEditGlobal()),
      tabBtn("users", "User/Outlets (Admin)", canEditGlobal()),
      tabBtn("settings", "Settings", true)
    ].filter(Boolean))
  ]);

  const content = el("div", { id:"content", style:"margin-top:12px" }, []);
  root.appendChild(el("div", { class:"container" }, [header, tabs, content]));

  renderActiveTab(getActiveTab());
}

function tabBtn(id, label, show=true){
  if(!show) return null;
  const btn = el("button", { class:`tab ${getActiveTab()===id?"active":""}` }, [label]);
  btn.onclick = ()=>{ setActiveTab(id); renderActiveTab(id); };
  return btn;
}

function renderActiveTab(tab){
  const content = $("#content");
  if(!content) return;
  content.innerHTML = "";
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  // mark active visually
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const match = tabs.find(t=>t.textContent === (tabs.find(x=>x.onclick)?.textContent));
  // simpler: just re-add by comparing stored tab
  const st = loadState();

  // toggle active style based on index mapping: easiest re-render header tabs not needed; we do minimal:
  // add active to the clicked tab by label is messy; so set via CSS on next render by reloading screenApp would be overkill.
  // We'll just set active class on the first matching by data attribute simulation:
  // (in this build, we keep it simple: no hard binding)
  // Not critical.

  if(tab === "dashboard") content.appendChild(renderDashboard(st));
  else if(tab === "outlet_ops") content.appendChild(renderOutletOps(st));
  else if(tab === "outlet_prices") content.appendChild(renderOutletPrices(st));
  else if(tab === "inventory") content.appendChild(renderInventory(st));
  else if(tab === "preps") content.appendChild(renderPreps(st));
  else if(tab === "recipes") content.appendChild(renderRecipes(st));
  else if(tab === "menu") content.appendChild(renderMenu(st));
  else if(tab === "bundles") content.appendChild(renderBundles(st));
  else if(tab === "params") content.appendChild(renderParams(st));
  else if(tab === "users") content.appendChild(renderUsers(st));
  else if(tab === "settings") content.appendChild(renderSettings(st));
  else content.appendChild(renderDashboard(st));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st){
  const s = getSession();
  const outletId = s.outletId;
  st.outletData = st.outletData || {};
  const od = st.outletData[outletId] || { menuPrices:{}, stock:{}, sales:[] };

  const today = todayISO();
  const salesToday = (od.sales||[]).filter(x=>x.date===today);

  let dbToday = 0;
  for(const e of salesToday){
    const mi = (st.menuItems||[]).find(x=>x.id===e.menuItemId);
    if(!mi) continue;
    const price = toNumber(od.menuPrices?.[mi.id] ?? 0);
    const calc = menuItemDB(mi, price, st);
    dbToday += calc.db * toNumber(e.qty);
  }

  const card1 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Status"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      Outlet Sales heute (${today}): <b>${salesToday.length}</b><br/>
      DB heute: <b class="${dbToday>=0?"ok":"bad"}">${fmtEUR(dbToday)}</b><br/>
      Inventur Artikel: <b>${(st.inventory||[]).length}</b><br/>
      Preps: <b>${(st.preps||[]).length}</b> · Rezepte: <b>${(st.recipes||[]).length}</b><br/>
      Menüartikel: <b>${(st.menuItems||[]).length}</b> · Bundles: <b>${(st.bundles||[]).length}</b>
    `})
  ]);

  const card2 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Wie du jetzt sofort weiterkommst"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      1) Admin: Inventur anlegen (Artikel + Preise)<br/>
      2) Admin: Preps/Rezepte bauen<br/>
      3) Admin: Menüartikel erstellen (Speisekarte) + Preise je Outlet setzen<br/>
      4) Outlet: Sales eintragen → DB live<br/>
      Sync ist Bonus. Lokal speichert immer.
    `})
  ]);

  return el("div", { class:"grid" }, [card1, card2]);
}

/* ----------------------- Outlet Ops: Bestand + Sales ----------------------- */
function renderOutletOps(st){
  const s = getSession();
  const outletId = s.outletId;
  st.outletData = st.outletData || {};
  const od = st.outletData[outletId] || (st.outletData[outletId]={ menuPrices:{}, stock:{}, sales:[] });

  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));

  // Stock input
  const stockSel = el("select",{class:"input"}, (st.inventory||[]).map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`])) );
  const stockQty = el("input",{class:"input", inputmode:"decimal", placeholder:"Bestand (z.B. 5000)"});
  const stockMsg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnStockSave = el("button",{class:"btn primary"},["Bestand speichern"]);

  btnStockSave.onclick = ()=>{
    const id = stockSel.value;
    const q = (stockQty.value||"").trim();
    if(!id){ stockMsg.innerHTML = `<span class="bad">Artikel fehlt.</span>`; return; }
    if(!q){ stockMsg.innerHTML = `<span class="bad">Menge fehlt.</span>`; return; }
    od.stock[id] = q;
    saveState(st);
    stockQty.value = "";
    stockMsg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawStock();
  };

  const stockTbody = el("tbody",{});
  function drawStock(){
    stockTbody.innerHTML = "";
    const entries = Object.entries(od.stock||{});
    for(const [id, qty] of entries){
      const inv = invById[id];
      stockTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(inv?inv.name:"—")}),
        el("td",{html:escapeHtml(inv?inv.unitType:"")}),
        el("td",{class:"right"},[String(qty)]),
        el("td",{class:"right"},[
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            if(!confirm("Bestandseintrag löschen?")) return;
            delete od.stock[id];
            saveState(st);
            drawStock();
          }},["Löschen"])
        ])
      ]));
    }
  }
  drawStock();

  // Sales input
  const salesDate = el("input",{class:"input", value: todayISO()});
  const salesSel = el("select",{class:"input"}, (st.menuItems||[]).map(m=>el("option",{value:m.id},[m.name])) );
  const salesQty = el("input",{class:"input", inputmode:"decimal", placeholder:"Qty verkauft (z.B. 20)"});
  const salesMsg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnSalesAdd = el("button",{class:"btn primary"},["Sale speichern"]);

  btnSalesAdd.onclick = ()=>{
    const d = (salesDate.value||"").trim();
    const mid = salesSel.value;
    const q = (salesQty.value||"").trim();
    if(!d){ salesMsg.innerHTML = `<span class="bad">Datum fehlt.</span>`; return; }
    if(!mid){ salesMsg.innerHTML = `<span class="bad">Menüartikel fehlt.</span>`; return; }
    if(!q){ salesMsg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }
    od.sales.push({ id: uuid(), date:d, menuItemId: mid, qty:q });
    saveState(st);
    salesQty.value = "";
    salesMsg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawSales();
  };

  const salesTbody = el("tbody",{});
  const salesSummary = el("div",{class:"sub"},[""]);
  function drawSales(){
    salesTbody.innerHTML = "";
    const d = (salesDate.value||todayISO()).trim();
    const entries = (od.sales||[]).filter(x=>x.date===d);

    let dbSum = 0;
    for(const e of entries){
      const mi = (st.menuItems||[]).find(x=>x.id===e.menuItemId);
      const price = toNumber(od.menuPrices?.[e.menuItemId] ?? 0);
      const calc = mi ? menuItemDB(mi, price, st) : { db:0 };

      const lineDb = calc.db * toNumber(e.qty);
      dbSum += lineDb;

      salesTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(mi?mi.name:"—")}),
        el("td",{class:"right"},[String(toNumber(e.qty))]),
        el("td",{class:"right"},[fmtEUR(price)]),
        el("td",{class:`right ${lineDb>=0?"ok":"bad"}`},[fmtEUR(lineDb)]),
        el("td",{class:"right"},[
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            od.sales = (od.sales||[]).filter(x=>x.id!==e.id);
            saveState(st);
            drawSales();
          }},["Löschen"])
        ])
      ]));
    }
    salesSummary.innerHTML = `Tages-DB: <b class="${dbSum>=0?"ok":"bad"}">${fmtEUR(dbSum)}</b>`;
  }
  salesDate.addEventListener("change", drawSales);
  drawSales();

  return el("div",{class:"grid"},[
    el("div",{class:"card col-12 col-6"},[
      el("div",{class:"title"},["Outlet: Bestand erfassen"]),
      el("div",{class:"sub"},["Einfacher Bestand pro Inventur-Artikel. (Verbrauch/Auto-Abzug kommt als nächster Schritt)"]),
      el("div",{class:"label"},["Artikel"]), stockSel,
      el("div",{class:"label"},["Bestand"]), stockQty,
      el("div",{class:"row",style:"margin-top:12px"},[btnStockSave]),
      stockMsg,
      el("div",{class:"hr"}),
      el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:320px"},[
        el("table",{},[
          el("thead",{},[el("tr",{},[
            el("th",{},["Artikel"]),
            el("th",{},["Unit"]),
            el("th",{class:"right"},["Bestand"]),
            el("th",{class:"right"},["Aktion"])
          ])]),
          stockTbody
        ])
      ])
    ]),
    el("div",{class:"card col-12 col-6"},[
      el("div",{class:"title"},["Outlet: Sales eingeben"]),
      el("div",{class:"label"},["Datum"]), salesDate,
      el("div",{class:"label"},["Menüartikel"]), salesSel,
      el("div",{class:"label"},["Qty"]), salesQty,
      el("div",{class:"row",style:"margin-top:12px"},[btnSalesAdd]),
      salesMsg,
      el("div",{class:"hr"}),
      salesSummary,
      el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:320px;margin-top:10px"},[
        el("table",{},[
          el("thead",{},[el("tr",{},[
            el("th",{},["Menüartikel"]),
            el("th",{class:"right"},["Qty"]),
            el("th",{class:"right"},["VK"]),
            el("th",{class:"right"},["DB"]),
            el("th",{class:"right"},["Aktion"])
          ])]),
          salesTbody
        ])
      ])
    ])
  ]);
}

/* ----------------------- Outlet Prices ----------------------- */
function renderOutletPrices(st){
  const s = getSession();
  const outletId = s.outletId;
  st.outletData = st.outletData || {};
  const od = st.outletData[outletId] || (st.outletData[outletId]={ menuPrices:{}, stock:{}, sales:[] });

  const tbody = el("tbody",{});
  function draw(){
    tbody.innerHTML = "";
    for(const mi of (st.menuItems||[])){
      const current = od.menuPrices?.[mi.id] ?? "";
      const priceInput = el("input",{class:"input", style:"max-width:140px", inputmode:"decimal", value:String(current)});

      const btnSave = el("button",{class:"btn primary", style:"padding:7px 10px"},["Speichern"]);
      btnSave.onclick = ()=>{
        if(!canEditOutletPrices()){ alert("Keine Berechtigung."); return; }
        od.menuPrices[mi.id] = (priceInput.value||"").trim();
        saveState(st);
        draw();
      };

      const calc = menuItemDB(mi, toNumber(current), st);

      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(mi.name)}),
        el("td",{class:"right"},[priceInput]),
        el("td",{class:"right"},[fmtEUR(calc.cost)]),
        el("td",{class:`right ${calc.db>=0?"ok":"bad"}`},[fmtEUR(calc.db)]),
        el("td",{class:`right ${calc.dbPct>=0?"ok":"bad"}`},[`${calc.dbPct.toFixed(1)}%`]),
        el("td",{class:"right"},[btnSave])
      ]));
    }
  }
  draw();

  return el("div",{class:"grid"},[
    el("div",{class:"card col-12"},[
      el("div",{class:"title"},["Outlet: Menüpreise & DB"]),
      el("div",{class:"sub"},["VK ist je Outlet. Wareneinsatz kommt aus globaler Kalkulation."]),
      el("div",{class:"hr"}),
      el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"},[
        el("table",{},[
          el("thead",{},[el("tr",{},[
            el("th",{},["Menüartikel"]),
            el("th",{class:"right"},["VK (€)"]),
            el("th",{class:"right"},["Wareneinsatz"]),
            el("th",{class:"right"},["DB €"]),
            el("th",{class:"right"},["DB %"]),
            el("th",{class:"right"},["Aktion"])
          ])]),
          tbody
        ])
      ])
    ])
  ]);
}

/* ----------------------- Admin: Inventory ----------------------- */
function renderInventory(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  const g = el("input",{class:"input", placeholder:"Warengruppe"});
  const n = el("input",{class:"input", placeholder:"Artikelname"});
  const s = el("input",{class:"input", placeholder:"Lieferant"});
  const packSize = el("input",{class:"input", inputmode:"decimal", placeholder:"Packgröße (z.B. 1000)"});
  const unit = el("select",{class:"input"},[
    el("option",{value:"g"},["g"]),
    el("option",{value:"ml"},["ml"]),
    el("option",{value:"stk"},["stk"])
  ]);
  const packPrice = el("input",{class:"input", inputmode:"decimal", placeholder:"Packpreis (€)"});
  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Speichern"]);

  btnAdd.onclick = ()=>{
    const item = {
      id: uuid(),
      group: (g.value||"").trim(),
      name: (n.value||"").trim(),
      supplier: (s.value||"").trim(),
      unitType: unit.value,
      packSize: (packSize.value||"").trim(),
      packPrice: (packPrice.value||"").trim()
    };
    if(!item.name){ msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`; return; }
    st.inventory.push(item);
    saveState(st);
    n.value=""; packSize.value=""; packPrice.value="";
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const tbody = el("tbody",{});
  function draw(){
    tbody.innerHTML = "";
    for(const inv of (st.inventory||[])){
      const up = unitPrice(inv);
      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(inv.name)}),
        el("td",{html:escapeHtml(inv.group||"")}),
        el("td",{html:escapeHtml(inv.unitType)}),
        el("td",{class:"right"},[String(toNumber(inv.packSize)||"")]),
        el("td",{class:"right"},[toNumber(inv.packPrice).toFixed(2)]),
        el("td",{class:"right"},[up.toFixed(4)]),
        el("td",{class:"right"},[
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            if(!confirm("Artikel löschen?")) return;
            st.inventory = st.inventory.filter(x=>x.id!==inv.id);
            // remove from preps/recipes lines
            for(const p of (st.preps||[])) p.lines = (p.lines||[]).filter(l=>l.inventoryId!==inv.id);
            for(const r of (st.recipes||[])) r.lines = (r.lines||[]).filter(l=>l.inventoryId!==inv.id);
            saveState(st);
            draw();
          }},["Löschen"])
        ])
      ]));
    }
  }
  draw();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Inventur (Admin)"]),
    el("div",{class:"sub"},["Packgröße + Packpreis → €/Einheit wird automatisch berechnet."]),
    el("div",{class:"label"},["Warengruppe"]), g,
    el("div",{class:"label"},["Artikelname"]), n,
    el("div",{class:"label"},["Lieferant"]), s,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Packgröße"]), packSize]),
      el("div",{},[el("div",{class:"label"},["Einheit"]), unit])
    ]),
    el("div",{class:"label"},["Packpreis (€)"]), packPrice,
    el("div",{class:"row",style:"margin-top:12px"},[btnAdd]),
    msg
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Artikel"]),
          el("th",{},["Gruppe"]),
          el("th",{},["Unit"]),
          el("th",{class:"right"},["Pack"]),
          el("th",{class:"right"},["€ Pack"]),
          el("th",{class:"right"},["€/Unit"]),
          el("th",{class:"right"},[""])
        ])]),
        tbody
      ])
    ])
  ]));

  return wrap;
}

/* ----------------------- Admin: Preps ----------------------- */
function renderPreps(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  const top = el("input",{class:"input", placeholder:"Top-Kategorie (z.B. Preps)"});
  const sub = el("input",{class:"input", placeholder:"Unterkategorie (z.B. Saucen)"});
  const name = el("input",{class:"input", placeholder:"Prep Name (z.B. Haus-Sauce)"});
  const yieldQty = el("input",{class:"input", inputmode:"decimal", placeholder:"Yield Menge (z.B. 1000)"});
  const yieldUnit = el("select",{class:"input"},[
    el("option",{value:"g"},["g"]),
    el("option",{value:"ml"},["ml"]),
    el("option",{value:"stk"},["stk"])
  ]);
  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Prep speichern"]);

  btnAdd.onclick = ()=>{
    const p = {
      id: uuid(),
      topCat: (top.value||"").trim(),
      subCat: (sub.value||"").trim(),
      name: (name.value||"").trim(),
      yieldQty: (yieldQty.value||"").trim(),
      yieldUnitType: yieldUnit.value,
      lines: []
    };
    if(!p.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.preps.push(p);
    saveState(st);
    name.value=""; yieldQty.value="";
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const listBody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Prep bearbeiten"]),
    el("div",{class:"small"},["Noch kein Prep ausgewählt."])
  ]);

  function draw(){
    listBody.innerHTML = "";
    const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));
    for(const p of (st.preps||[])){
      const unitC = prepUnitCost(p, invById, prepById);
      listBody.appendChild(el("tr",{style:"cursor:pointer", onclick:()=>openEditor(p.id)},[
        el("td",{html:escapeHtml(p.name)}),
        el("td",{html:escapeHtml(`${p.topCat||""} / ${p.subCat||""}`)}),
        el("td",{class:"right"},[`${unitC.toFixed(4)} €/ ${escapeHtml(p.yieldUnitType||"")}`])
      ]));
    }
  }

  function openEditor(id){
    const p = (st.preps||[]).find(x=>x.id===id);
    if(!p){
      editor.innerHTML = `<div class="title">Prep bearbeiten</div><div class="small">Noch kein Prep ausgewählt.</div>`;
      return;
    }
    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Prep: ${escapeHtml(p.name)}`]));

    const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));

    const selType = el("select",{class:"input"},[
      el("option",{value:"inventory"},["Inventur-Artikel"]),
      el("option",{value:"prep"},["Prep (verschachtelt)"])
    ]);
    const selInv = el("select",{class:"input"}, (st.inventory||[]).map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`])) );
    const selPrep = el("select",{class:"input"}, (st.preps||[]).filter(x=>x.id!==p.id).map(x=>el("option",{value:x.id},[x.name])) );
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 50)"});

    const btnAddLine = el("button",{class:"btn primary"},["Zutat hinzufügen"]);
    const sum = el("div",{class:"sub",style:"margin-top:8px"},[""]);
    const linesWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawLines(){
      const unitC = prepUnitCost(p, invById, prepById);
      sum.innerHTML = `Kosten pro ${escapeHtml(p.yieldUnitType)}: <b>${unitC.toFixed(4)} €</b> (Yield ${escapeHtml(p.yieldQty)} ${escapeHtml(p.yieldUnitType)})`;

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Zutat"]),
          el("th",{},["Typ"]),
          el("th",{class:"right"},["Menge"]),
          el("th",{class:"right"},["Aktion"])
        ])]),
        el("tbody",{}, (p.lines||[]).map(l=>{
          const label =
            l.type==="inventory" ? (invById[l.inventoryId]?.name || "—") :
            l.type==="prep" ? (prepById[l.prepId]?.name || "—") : "—";

          const qtyInput = el("input",{class:"input",style:"max-width:140px", inputmode:"decimal", value:String(l.qty??"")});
          const btnSave = el("button",{class:"btn",style:"padding:7px 10px"},["Speichern"]);
          const btnDel = el("button",{class:"btn danger",style:"padding:7px 10px"},["Löschen"]);

          btnSave.onclick = ()=>{ l.qty = (qtyInput.value||"").trim(); saveState(st); drawLines(); draw(); };
          btnDel.onclick = ()=>{ p.lines = p.lines.filter(x=>x.id!==l.id); saveState(st); drawLines(); draw(); };

          return el("tr",{},[
            el("td",{html:escapeHtml(label)}),
            el("td",{html:escapeHtml(l.type)}),
            el("td",{class:"right"},[qtyInput]),
            el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSave, btnDel])])
          ]);
        }))
      ]));
    }

    btnAddLine.onclick = ()=>{
      const t = selType.value;
      const q = (qty.value||"").trim();
      if(!q){ alert("Menge fehlt"); return; }
      if(t==="inventory"){
        if(!(st.inventory||[]).length){ alert("Inventur ist leer."); return; }
        p.lines.push({ id: uuid(), type:"inventory", inventoryId: selInv.value, qty:q });
      }else{
        if(!(st.preps||[]).filter(x=>x.id!==p.id).length){ alert("Keine anderen Preps vorhanden."); return; }
        p.lines.push({ id: uuid(), type:"prep", prepId: selPrep.value, qty:q });
      }
      qty.value="";
      saveState(st);
      drawLines();
      draw();
    };

    const btnDelete = el("button",{class:"btn danger"},["Prep löschen"]);
    btnDelete.onclick = ()=>{
      if(!confirm("Prep löschen? (Rezepte/Preps verlieren ggf. Referenz)")) return;
      st.preps = st.preps.filter(x=>x.id!==p.id);
      // remove references
      for(const r of (st.recipes||[])) r.lines = (r.lines||[]).filter(l=>l.prepId!==p.id);
      for(const p2 of (st.preps||[])) p2.lines = (p2.lines||[]).filter(l=>l.prepId!==p.id);
      saveState(st);
      editor.innerHTML = `<div class="title">Prep bearbeiten</div><div class="small">Noch kein Prep ausgewählt.</div>`;
      draw();
    };

    editor.appendChild(el("div",{class:"grid",style:"margin-top:10px"},[
      el("div",{class:"col-12"},[sum]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"two"},[
          el("div",{},[el("div",{class:"label"},["Typ"]), selType]),
          el("div",{},[el("div",{class:"label"},["Inventur-Artikel"]), selInv]),
          el("div",{},[el("div",{class:"label"},["Prep"]), selPrep]),
          el("div",{},[el("div",{class:"label"},["Menge"]), qty])
        ]),
        el("div",{class:"row",style:"margin-top:10px"},[btnAddLine, btnDelete]),
        el("div",{class:"hr"}),
        linesWrap
      ])
    ]));

    selType.addEventListener("change", ()=>{
      const invOn = selType.value==="inventory";
      selInv.style.display = invOn ? "" : "none";
      selPrep.style.display = invOn ? "none" : "";
    });
    selType.dispatchEvent(new Event("change"));
    drawLines();
  }

  draw();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Preps (Admin)"]),
    el("div",{class:"sub"},["Saucen etc. mit Yield (z.B. 1000g). Als Zutat in Rezepten nutzbar."]),
    el("div",{class:"label"},["Top-Kategorie"]), top,
    el("div",{class:"label"},["Unterkategorie"]), sub,
    el("div",{class:"label"},["Name"]), name,
    el("div",{class:"two"},[
      el("div",{},[el("div",{class:"label"},["Yield Menge"]), yieldQty]),
      el("div",{},[el("div",{class:"label"},["Yield Unit"]), yieldUnit])
    ]),
    el("div",{class:"row",style:"margin-top:12px"},[btnAdd]),
    msg
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Prep"]),
          el("th",{},["Kategorie"]),
          el("th",{class:"right"},["€/Unit"])
        ])]),
        listBody
      ])
    ])
  ]));

  wrap.appendChild(editor);
  return wrap;
}

/* ----------------------- Admin: Recipes ----------------------- */
function renderRecipes(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  const top = el("input",{class:"input", placeholder:"Top-Kategorie (Speisen/Getränke)"});
  const sub = el("input",{class:"input", placeholder:"Unterkategorie (Currywurst/Cocktails)"});
  const name = el("input",{class:"input", placeholder:"Rezeptname (Gericht)"});
  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Rezept speichern"]);

  btnAdd.onclick = ()=>{
    const r = { id: uuid(), topCat:(top.value||"").trim(), subCat:(sub.value||"").trim(), name:(name.value||"").trim(), lines:[] };
    if(!r.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.recipes.push(r);
    saveState(st);
    name.value="";
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Rezept bearbeiten"]),
    el("div",{class:"small"},["Noch kein Rezept ausgewählt."])
  ]);

  function draw(){
    tbody.innerHTML = "";
    const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));
    for(const r of (st.recipes||[])){
      const cost = applyWaste(recipeCost(r, invById, prepById), st.params||{});
      tbody.appendChild(el("tr",{style:"cursor:pointer", onclick:()=>openEditor(r.id)},[
        el("td",{html:escapeHtml(r.name)}),
        el("td",{html:escapeHtml(`${r.topCat||""} / ${r.subCat||""}`)}),
        el("td",{class:"right"},[fmtEUR(cost)])
      ]));
    }
  }

  function openEditor(id){
    const r = (st.recipes||[]).find(x=>x.id===id);
    if(!r){ editor.innerHTML = `<div class="title">Rezept bearbeiten</div><div class="small">Noch kein Rezept ausgewählt.</div>`; return; }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Rezept: ${escapeHtml(r.name)}`]));

    const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    const prepById = Object.fromEntries((st.preps||[]).map(x=>[x.id,x]));

    const selType = el("select",{class:"input"},[
      el("option",{value:"inventory"},["Inventur-Artikel"]),
      el("option",{value:"prep"},["Prep"])
    ]);
    const selInv = el("select",{class:"input"}, (st.inventory||[]).map(i=>el("option",{value:i.id},[`${i.name} (${i.unitType})`])) );
    const selPrep = el("select",{class:"input"}, (st.preps||[]).map(p=>el("option",{value:p.id},[p.name])) );
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 120)"});

    const btnAddLine = el("button",{class:"btn primary"},["Zutat hinzufügen"]);
    const sum = el("div",{class:"sub",style:"margin-top:8px"},[""]);
    const linesWrap = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawLines(){
      const cost = applyWaste(recipeCost(r, invById, prepById), st.params||{});
      sum.innerHTML = `Wareneinsatz (inkl. Waste%): <b>${fmtEUR(cost)}</b>`;

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Zutat"]),
          el("th",{},["Typ"]),
          el("th",{class:"right"},["Menge"]),
          el("th",{class:"right"},["Aktion"])
        ])]),
        el("tbody",{}, (r.lines||[]).map(l=>{
          const label =
            l.type==="inventory" ? (invById[l.inventoryId]?.name || "—") :
            l.type==="prep" ? (prepById[l.prepId]?.name || "—") : "—";

          const qtyInput = el("input",{class:"input",style:"max-width:140px", inputmode:"decimal", value:String(l.qty??"")});
          const btnSave = el("button",{class:"btn",style:"padding:7px 10px"},["Speichern"]);
          const btnDel = el("button",{class:"btn danger",style:"padding:7px 10px"},["Löschen"]);

          btnSave.onclick = ()=>{ l.qty = (qtyInput.value||"").trim(); saveState(st); drawLines(); draw(); };
          btnDel.onclick = ()=>{ r.lines = r.lines.filter(x=>x.id!==l.id); saveState(st); drawLines(); draw(); };

          return el("tr",{},[
            el("td",{html:escapeHtml(label)}),
            el("td",{html:escapeHtml(l.type)}),
            el("td",{class:"right"},[qtyInput]),
            el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSave, btnDel])])
          ]);
        }))
      ]));
    }

    btnAddLine.onclick = ()=>{
      const t = selType.value;
      const q = (qty.value||"").trim();
      if(!q){ alert("Menge fehlt"); return; }
      if(t==="inventory"){
        if(!(st.inventory||[]).length){ alert("Inventur ist leer."); return; }
        r.lines.push({ id: uuid(), type:"inventory", inventoryId: selInv.value, qty:q });
      }else{
        if(!(st.preps||[]).length){ alert("Keine Preps vorhanden."); return; }
        r.lines.push({ id: uuid(), type:"prep", prepId: selPrep.value, qty:q });
      }
      qty.value="";
      saveState(st);
      drawLines();
      draw();
    };

    const btnDelete = el("button",{class:"btn danger"},["Rezept löschen"]);
    btnDelete.onclick = ()=>{
      if(!confirm("Rezept löschen?")) return;
      st.recipes = st.recipes.filter(x=>x.id!==r.id);
      // Menüartikel die dieses Rezept nutzen NICHT automatisch löschen (bewusst), aber Referenz kann fehlen.
      saveState(st);
      editor.innerHTML = `<div class="title">Rezept bearbeiten</div><div class="small">Noch kein Rezept ausgewählt.</div>`;
      draw();
    };

    editor.appendChild(el("div",{class:"grid",style:"margin-top:10px"},[
      el("div",{class:"col-12"},[sum]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"two"},[
          el("div",{},[el("div",{class:"label"},["Typ"]), selType]),
          el("div",{},[el("div",{class:"label"},["Inventur-Artikel"]), selInv]),
          el("div",{},[el("div",{class:"label"},["Prep"]), selPrep]),
          el("div",{},[el("div",{class:"label"},["Menge"]), qty])
        ]),
        el("div",{class:"row",style:"margin-top:10px"},[btnAddLine, btnDelete]),
        el("div",{class:"hr"}),
        linesWrap
      ])
    ]));

    selType.addEventListener("change", ()=>{
      const invOn = selType.value==="inventory";
      selInv.style.display = invOn ? "" : "none";
      selPrep.style.display = invOn ? "none" : "";
    });
    selType.dispatchEvent(new Event("change"));
    drawLines();
  }

  draw();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Rezepte (Admin)"]),
    el("div",{class:"label"},["Top-Kategorie"]), top,
    el("div",{class:"label"},["Unterkategorie"]), sub,
    el("div",{class:"label"},["Rezeptname"]), name,
    el("div",{class:"row",style:"margin-top:12px"},[btnAdd]),
    msg
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Rezept"]),
          el("th",{},["Kategorie"]),
          el("th",{class:"right"},["Wareneinsatz"])
        ])]),
        tbody
      ])
    ])
  ]));

  wrap.appendChild(editor);
  return wrap;
}

/* ----------------------- Admin: Menüartikel ----------------------- */
function renderMenu(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  const name = el("input",{class:"input", placeholder:"Menüartikel Name (Speisekarte)"});
  const kind = el("select",{class:"input"},[
    el("option",{value:"recipe"},["Aus Rezept"]),
    el("option",{value:"bundle"},["Aus Bundle"])
  ]);
  const recipeSel = el("select",{class:"input"}, (st.recipes||[]).map(r=>el("option",{value:r.id},[r.name])) );
  const bundleSel = el("select",{class:"input"}, (st.bundles||[]).map(b=>el("option",{value:b.id},[b.name])) );
  const modifiers = el("select",{class:"input"},[
    el("option",{value:"true"},["Modifiers erlaubt"]),
    el("option",{value:"false"},["Keine Modifiers"])
  ]);

  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Menüartikel speichern"]);

  btnAdd.onclick = ()=>{
    const k = kind.value;
    const item = {
      id: uuid(),
      name: (name.value||"").trim(),
      kind: k,
      recipeId: k==="recipe" ? recipeSel.value : null,
      bundleId: k==="bundle" ? bundleSel.value : null,
      modifiersEnabled: modifiers.value==="true"
    };
    if(!item.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    if(item.kind==="recipe" && !item.recipeId){ msg.innerHTML = `<span class="bad">Rezept fehlt.</span>`; return; }
    if(item.kind==="bundle" && !item.bundleId){ msg.innerHTML = `<span class="bad">Bundle fehlt.</span>`; return; }

    st.menuItems.push(item);
    saveState(st);
    name.value="";
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  kind.addEventListener("change", ()=>{
    const k = kind.value;
    recipeSel.style.display = k==="recipe" ? "" : "none";
    bundleSel.style.display = k==="bundle" ? "" : "none";
  });
  kind.dispatchEvent(new Event("change"));

  const tbody = el("tbody",{});
  function draw(){
    tbody.innerHTML = "";
    for(const mi of (st.menuItems||[])){
      const cost = menuItemCost(mi, st);
      tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(mi.name)}),
        el("td",{html:escapeHtml(mi.kind)}),
        el("td",{class:"right"},[fmtEUR(cost)]),
        el("td",{class:"right"},[
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            if(!confirm("Menüartikel löschen?")) return;
            st.menuItems = st.menuItems.filter(x=>x.id!==mi.id);
            // remove from bundles
            for(const b of (st.bundles||[])) b.items = (b.items||[]).filter(it=>it.menuItemId!==mi.id);
            // remove outlet prices references
            st.outletData = st.outletData || {};
            for(const [oid,od] of Object.entries(st.outletData)){
              if(od.menuPrices) delete od.menuPrices[mi.id];
              if(od.sales) od.sales = od.sales.filter(s=>s.menuItemId!==mi.id);
            }
            saveState(st);
            draw();
          }},["Löschen"])
        ])
      ]));
    }
  }
  draw();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Menüartikel (Admin)"]),
    el("div",{class:"sub"},["Speisekarte-Produkt mit manuellem VK je Outlet."]),
    el("div",{class:"label"},["Name"]), name,
    el("div",{class:"label"},["Typ"]), kind,
    el("div",{class:"label"},["Rezept"]), recipeSel,
    el("div",{class:"label"},["Bundle"]), bundleSel,
    el("div",{class:"label"},["Modifiers"]), modifiers,
    el("div",{class:"row",style:"margin-top:12px"},[btnAdd]),
    msg
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Menüartikel"]),
          el("th",{},["Typ"]),
          el("th",{class:"right"},["Wareneinsatz"]),
          el("th",{class:"right"},[""])
        ])]),
        tbody
      ])
    ])
  ]));

  return wrap;
}

/* ----------------------- Admin: Bundles ----------------------- */
function renderBundles(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  const name = el("input",{class:"input", placeholder:"Bundle Name (z.B. Menü 1)"});
  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["Bundle speichern"]);

  btnAdd.onclick = ()=>{
    const b = { id: uuid(), name:(name.value||"").trim(), items:[] };
    if(!b.name){ msg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    st.bundles.push(b);
    saveState(st);
    name.value="";
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  const tbody = el("tbody",{});
  const editor = el("div",{class:"card col-12"},[
    el("div",{class:"title"},["Bundle bearbeiten"]),
    el("div",{class:"small"},["Noch kein Bundle ausgewählt."])
  ]);

  function draw(){
    tbody.innerHTML = "";
    for(const b of (st.bundles||[])){
      const cost = menuItemCost({kind:"bundle", bundleId:b.id}, st);
      tbody.appendChild(el("tr",{style:"cursor:pointer", onclick:()=>openEditor(b.id)},[
        el("td",{html:escapeHtml(b.name)}),
        el("td",{class:"right"},[fmtEUR(cost)])
      ]));
    }
  }

  function openEditor(id){
    const b = (st.bundles||[]).find(x=>x.id===id);
    if(!b){ editor.innerHTML = `<div class="title">Bundle bearbeiten</div><div class="small">Noch kein Bundle ausgewählt.</div>`; return; }

    editor.innerHTML = "";
    editor.appendChild(el("div",{class:"title"},[`Bundle: ${escapeHtml(b.name)}`]));

    const sel = el("select",{class:"input"}, (st.menuItems||[]).map(m=>el("option",{value:m.id},[m.name])) );
    const qty = el("input",{class:"input", inputmode:"decimal", placeholder:"Qty (z.B. 1)"});
    const btnAddItem = el("button",{class:"btn primary"},["Hinzufügen"]);
    const sum = el("div",{class:"sub",style:"margin-top:8px"},[""]);
    const list = el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border)"});

    function drawItems(){
      const cost = menuItemCost({kind:"bundle", bundleId:b.id}, st);
      sum.innerHTML = `Bundle Wareneinsatz: <b>${fmtEUR(cost)}</b>`;

      list.innerHTML = "";
      list.appendChild(el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Menüartikel"]),
          el("th",{class:"right"},["Qty"]),
          el("th",{class:"right"},["Aktion"])
        ])]),
        el("tbody",{}, (b.items||[]).map(it=>{
          const mi = (st.menuItems||[]).find(x=>x.id===it.menuItemId);
          const qtyInput = el("input",{class:"input",style:"max-width:120px", inputmode:"decimal", value:String(it.qty??"1")});
          const btnSave = el("button",{class:"btn",style:"padding:7px 10px"},["Speichern"]);
          const btnDel = el("button",{class:"btn danger",style:"padding:7px 10px"},["Löschen"]);

          btnSave.onclick = ()=>{ it.qty = (qtyInput.value||"1").trim(); saveState(st); drawItems(); draw(); };
          btnDel.onclick = ()=>{ b.items = b.items.filter(x=>x.id!==it.id); saveState(st); drawItems(); draw(); };

          return el("tr",{},[
            el("td",{html:escapeHtml(mi?mi.name:"—")}),
            el("td",{class:"right"},[qtyInput]),
            el("td",{class:"right"},[el("div",{class:"row",style:"justify-content:flex-end"},[btnSave, btnDel])])
          ]);
        }))
      ]));
    }

    btnAddItem.onclick = ()=>{
      const q = (qty.value||"").trim() || "1";
      const mid = sel.value;
      if(!mid){ alert("Menüartikel fehlt"); return; }
      b.items.push({ id: uuid(), menuItemId: mid, qty:q });
      qty.value="";
      saveState(st);
      drawItems();
      draw();
    };

    const btnDelete = el("button",{class:"btn danger"},["Bundle löschen"]);
    btnDelete.onclick = ()=>{
      if(!confirm("Bundle löschen?")) return;
      st.bundles = st.bundles.filter(x=>x.id!==b.id);
      // Menüartikel die dieses Bundle referenzieren bleiben, aber zeigen ggf. 0 cost -> ok
      saveState(st);
      editor.innerHTML = `<div class="title">Bundle bearbeiten</div><div class="small">Noch kein Bundle ausgewählt.</div>`;
      draw();
    };

    editor.appendChild(el("div",{class:"grid",style:"margin-top:10px"},[
      el("div",{class:"col-12"},[sum]),
      el("div",{class:"col-12"},[el("div",{class:"hr"})]),
      el("div",{class:"col-12"},[
        el("div",{class:"two"},[
          el("div",{},[el("div",{class:"label"},["Menüartikel"]), sel]),
          el("div",{},[el("div",{class:"label"},["Qty"]), qty])
        ]),
        el("div",{class:"row",style:"margin-top:10px"},[btnAddItem, btnDelete]),
        el("div",{class:"hr"}),
        list
      ])
    ]));

    drawItems();
  }

  draw();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Bundles (Admin)"]),
    el("div",{class:"sub"},["Mehrere Menüartikel zu einem Bundle (VK je Outlet über Menüartikel mit Typ=Bundle)."]),
    el("div",{class:"label"},["Name"]), name,
    el("div",{class:"row",style:"margin-top:12px"},[btnAdd]),
    msg
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Liste (Klick zum Bearbeiten)"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Bundle"]),
          el("th",{class:"right"},["Wareneinsatz"])
        ])]),
        tbody
      ])
    ])
  ]));

  wrap.appendChild(editor);
  return wrap;
}

/* ----------------------- Admin: Params ----------------------- */
function renderParams(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const p = st.params || defaultState().params;

  const fields = {
    vatPct: el("input",{class:"input", inputmode:"decimal", value:String(p.vatPct??7)}),
    franchisePct: el("input",{class:"input", inputmode:"decimal", value:String(p.franchisePct??0)}),
    platformCommissionPct: el("input",{class:"input", inputmode:"decimal", value:String(p.platformCommissionPct??0)}),
    paymentFeePct: el("input",{class:"input", inputmode:"decimal", value:String(p.paymentFeePct??0)}),
    packagingPct: el("input",{class:"input", inputmode:"decimal", value:String(p.packagingPct??0)}),
    wastePct: el("input",{class:"input", inputmode:"decimal", value:String(p.wastePct??0)}),

    rent: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly?.rent??0)}),
    staff: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly?.staff??0)}),
    utilities: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly?.utilities??0)}),
    marketing: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly?.marketing??0)}),
    other: el("input",{class:"input", inputmode:"decimal", value:String(p.fixedCostsMonthly?.other??0)}),

    equipmentLeasing: el("input",{class:"input", inputmode:"decimal", value:String(p.investmentMonthly?.equipmentLeasing??0)}),
    loan: el("input",{class:"input", inputmode:"decimal", value:String(p.investmentMonthly?.loan??0)}),
    depreciation: el("input",{class:"input", inputmode:"decimal", value:String(p.investmentMonthly?.depreciation??0)})
  };

  const msg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnSave = el("button",{class:"btn primary"},["Speichern"]);

  btnSave.onclick = ()=>{
    st.params = st.params || {};
    st.params.vatPct = (fields.vatPct.value||"0").trim();
    st.params.franchisePct = (fields.franchisePct.value||"0").trim();
    st.params.platformCommissionPct = (fields.platformCommissionPct.value||"0").trim();
    st.params.paymentFeePct = (fields.paymentFeePct.value||"0").trim();
    st.params.packagingPct = (fields.packagingPct.value||"0").trim();
    st.params.wastePct = (fields.wastePct.value||"0").trim();

    st.params.fixedCostsMonthly = {
      rent: (fields.rent.value||"0").trim(),
      staff: (fields.staff.value||"0").trim(),
      utilities: (fields.utilities.value||"0").trim(),
      marketing: (fields.marketing.value||"0").trim(),
      other: (fields.other.value||"0").trim()
    };
    st.params.investmentMonthly = {
      equipmentLeasing: (fields.equipmentLeasing.value||"0").trim(),
      loan: (fields.loan.value||"0").trim(),
      depreciation: (fields.depreciation.value||"0").trim()
    };

    saveState(st);
    msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
  };

  return el("div",{class:"grid"},[
    el("div",{class:"card col-12"},[
      el("div",{class:"title"},["Parameter (Admin)"]),
      el("div",{class:"sub"},["Diese Parameter werden im DB berücksichtigt (Franchise/Plattform/Payment/Packaging/Waste). Fixkosten & Invest werden gespeichert (für Break-even Auswertung als nächster Schritt)."]),
      el("div",{class:"grid",style:"margin-top:10px"},[
        el("div",{class:"col-3"},[el("div",{class:"label"},["MwSt %"]), fields.vatPct]),
        el("div",{class:"col-3"},[el("div",{class:"label"},["Franchise %"]), fields.franchisePct]),
        el("div",{class:"col-3"},[el("div",{class:"label"},["Plattform %"]), fields.platformCommissionPct]),
        el("div",{class:"col-3"},[el("div",{class:"label"},["Payment %"]), fields.paymentFeePct]),

        el("div",{class:"col-3"},[el("div",{class:"label"},["Packaging % (vom VK)"]), fields.packagingPct]),
        el("div",{class:"col-3"},[el("div",{class:"label"},["Waste % (vom Cost)"]), fields.wastePct]),
        el("div",{class:"col-6"},[el("div",{class:"mutedBox"},["Fixkosten & Invest (monatlich) sind gespeichert – als nächster Schritt machen wir Break-even / Tagesziel pro Outlet."])]),

        el("div",{class:"col-4"},[el("div",{class:"label"},["Miete / Monat"]), fields.rent]),
        el("div",{class:"col-4"},[el("div",{class:"label"},["Staff / Monat"]), fields.staff]),
        el("div",{class:"col-4"},[el("div",{class:"label"},["Utilities / Monat"]), fields.utilities]),

        el("div",{class:"col-4"},[el("div",{class:"label"},["Marketing / Monat"]), fields.marketing]),
        el("div",{class:"col-4"},[el("div",{class:"label"},["Other / Monat"]), fields.other]),
        el("div",{class:"col-4"},[el("div",{class:"label"},["Equipment Leasing / Monat"]), fields.equipmentLeasing]),

        el("div",{class:"col-4"},[el("div",{class:"label"},["Loan / Monat"]), fields.loan]),
        el("div",{class:"col-4"},[el("div",{class:"label"},["Depreciation / Monat"]), fields.depreciation]),
        el("div",{class:"col-4"},[el("div",{class:"label"},[""]), el("div",{})])
      ]),
      el("div",{class:"row",style:"margin-top:12px"},[btnSave]),
      msg
    ])
  ]);
}

/* ----------------------- Admin: Users + Outlets ----------------------- */
function renderUsers(st){
  if(!canEditGlobal()) return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  const wrap = el("div",{class:"grid"});

  // Outlets
  const outName = el("input",{class:"input", placeholder:"Outlet Name (z.B. Zürich HB)"});
  const outMsg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnOutAdd = el("button",{class:"btn primary"},["Outlet hinzufügen"]);

  btnOutAdd.onclick = ()=>{
    const n = (outName.value||"").trim();
    if(!n){ outMsg.innerHTML = `<span class="bad">Name fehlt.</span>`; return; }
    const id = "outlet_" + uuid().slice(0,8);
    st.outlets.push({ id, name:n });
    st.outletData = st.outletData || {};
    st.outletData[id] = st.outletData[id] || { menuPrices:{}, stock:{}, sales:[] };
    saveState(st);
    outName.value="";
    outMsg.innerHTML = `<span class="ok">Outlet angelegt.</span>`;
    drawOutlets(); drawUsers();
  };

  const outTbody = el("tbody",{});
  function drawOutlets(){
    outTbody.innerHTML = "";
    for(const o of (st.outlets||[])){
      outTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(o.name)}),
        el("td",{html:escapeHtml(o.id)}),
        el("td",{class:"right"},[
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            if(!confirm("Outlet löschen? (Outlet-Daten gehen verloren)")) return;
            st.outlets = st.outlets.filter(x=>x.id!==o.id);
            if(st.outletData) delete st.outletData[o.id];
            // remove from user outlet lists
            for(const u of (st.users||[])){
              if(u.outlets && u.outlets.includes(o.id)) u.outlets = u.outlets.filter(x=>x!==o.id);
            }
            saveState(st);
            drawOutlets(); drawUsers();
          }},["Löschen"])
        ])
      ]));
    }
  }

  // Users
  const uName = el("input",{class:"input", placeholder:"username (ohne Leerzeichen)"});
  const uDisp = el("input",{class:"input", placeholder:"Display Name"});
  const uRole = el("select",{class:"input"},[
    el("option",{value:"manager"},["manager"]),
    el("option",{value:"staff"},["staff"]),
    el("option",{value:"admin"},["admin"])
  ]);
  const uOutlets = el("select",{class:"input", multiple:"true", style:"min-height:120px"},[]);
  const uMsg = el("div",{class:"small",style:"margin-top:8px"},[""]);
  const btnUAdd = el("button",{class:"btn primary"},["User speichern"]);

  function refreshOutletOptions(){
    uOutlets.innerHTML = "";
    for(const o of (st.outlets||[])){
      uOutlets.appendChild(el("option",{value:o.id},[o.name]));
    }
  }
  refreshOutletOptions();

  btnUAdd.onclick = ()=>{
    const username = (uName.value||"").trim();
    const displayName = (uDisp.value||"").trim();
    const role = uRole.value;

    if(!username){ uMsg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ uMsg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }
    const exists = (st.users||[]).some(x=>String(x.username||"").toLowerCase()===username.toLowerCase());
    if(exists){ uMsg.innerHTML = `<span class="bad">User existiert bereits.</span>`; return; }

    const selected = Array.from(uOutlets.selectedOptions).map(o=>o.value);
    if(role!=="admin" && selected.length===0){
      uMsg.innerHTML = `<span class="bad">Mindestens 1 Outlet zuweisen.</span>`;
      return;
    }

    st.users.push({
      username,
      displayName: displayName || username,
      role,
      outlets: role==="admin" ? ["*"] : selected
    });
    saveState(st);

    uName.value=""; uDisp.value="";
    uMsg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    drawUsers();
  };

  const uTbody = el("tbody",{});
  function drawUsers(){
    uTbody.innerHTML = "";
    for(const u of (st.users||[])){
      const isA = String(u.username||"").toLowerCase()==="admin";
      const outletsLabel = (u.outlets||[]).includes("*")
        ? "ALL"
        : (u.outlets||[]).map(id => (st.outlets||[]).find(o=>o.id===id)?.name || id).join(", ");

      uTbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(u.username)}),
        el("td",{html:escapeHtml(u.displayName||u.username)}),
        el("td",{html:escapeHtml(u.role||"")}),
        el("td",{html:escapeHtml(outletsLabel)}),
        el("td",{class:"right"},[
          isA ? el("span",{class:"small"},["Admin"]) :
          el("button",{class:"btn danger",style:"padding:7px 10px", onclick:()=>{
            if(!confirm("User löschen?")) return;
            st.users = st.users.filter(x=>String(x.username||"").toLowerCase()!==String(u.username||"").toLowerCase());
            saveState(st);
            drawUsers();
          }},["Löschen"])
        ])
      ]));
    }
  }

  drawOutlets();
  drawUsers();

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Outlets (Admin)"]),
    el("div",{class:"label"},["Outlet Name"]), outName,
    el("div",{class:"row",style:"margin-top:12px"},[btnOutAdd]),
    outMsg,
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:360px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Name"]),
          el("th",{},["ID"]),
          el("th",{class:"right"},[""])
        ])]),
        outTbody
      ])
    ])
  ]));

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["User anlegen (Admin)"]),
    el("div",{class:"label"},["Username"]), uName,
    el("div",{class:"label"},["Display Name"]), uDisp,
    el("div",{class:"label"},["Rolle"]), uRole,
    el("div",{class:"label"},["Outlets (multi)"]), uOutlets,
    el("div",{class:"row",style:"margin-top:12px"},[btnUAdd]),
    uMsg
  ]));

  wrap.appendChild(el("div",{class:"card col-12"},[
    el("div",{class:"title"},["User Liste"]),
    el("div",{class:"hr"}),
    el("div",{style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:360px"},[
      el("table",{},[
        el("thead",{},[el("tr",{},[
          el("th",{},["Username"]),
          el("th",{},["Display"]),
          el("th",{},["Role"]),
          el("th",{},["Outlets"]),
          el("th",{class:"right"},[""])
        ])]),
        uTbody
      ])
    ])
  ]));

  return wrap;
}

/* ----------------------- Settings ----------------------- */
function renderSettings(st){
  const ws = getWorkspace();
  const s = getSession();

  const btnExport = el("button",{class:"btn"},["Export JSON"]);
  btnExport.onclick = ()=>{
    const data = JSON.stringify(loadState(), null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heisse-ecke_${ws||"workspace"}_export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btnResetLocal = el("button",{class:"btn danger"},["Local Reset (nur Browser)"]);
  btnResetLocal.onclick = ()=>{
    if(!confirm("Wirklich lokalen State löschen? (Cloud bleibt)")) return;
    localStorage.removeItem(LS.state);
    localStorage.removeItem(LS.lastSaved);
    alert("Local gelöscht. App lädt neu.");
    location.reload();
  };

  return el("div",{class:"grid"},[
    el("div",{class:"card col-12"},[
      el("div",{class:"title"},["Settings"]),
      el("div",{class:"sub",html:`
        Workspace: <b>${escapeHtml(ws||"—")}</b><br/>
        User: <b>${escapeHtml(s?.username||"—")}</b> · Outlet: <b>${escapeHtml(s?.outletId||"—")}</b><br/>
        Sync: <b>${escapeHtml(localStorage.getItem(LS.syncStatus)||"—")}</b>
      `}),
      el("div",{class:"hr"}),
      el("div",{class:"row"},[btnExport, btnResetLocal])
    ])
  ]);
}

/* ----------------------- Boot ----------------------- */
async function boot(){
  injectBaseStyles();
  applyTheme(localStorage.getItem(LS.theme) || "light");

  // Wenn Workspace gesetzt ist: einmal versuchen zu laden (blockiert nie)
  if(getWorkspace()) await cloudPullOnStart();

  // Wenn session existiert, aber outlet fehlt: zurück zum login
  const s = getSession();
  if(!s) screenLogin();
  else screenApp();
}

document.addEventListener("DOMContentLoaded", boot);
