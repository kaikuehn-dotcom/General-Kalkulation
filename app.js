/* =========================================================
   HEISSE ECKE – WEB APP (Single-File JS, GitHub Pages)
   FIX: Keine DOM-Queries auf IDs bevor Node im DOM ist.
========================================================= */

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

/* ----------------------- Storage Keys ----------------------- */
const LS = {
  workspace: "he_workspace",
  theme: "he_theme",
  session: "he_session",
  state: "he_state_v1",
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
    users: [{ username: "admin", displayName: "Admin" }],
    inventory: [], // {id, group, name, supplier, unitType('g'|'ml'|'stk'), packSize, packPrice}
    recipes: [],   // {id, topCat, subCat, name, menuPrice, lines:[{id, inventoryId, qty}]}
    params: { franchisePct: 0, vatPct: 7 },
    sales: []      // {id, date, recipeId, qty}
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
function recipeDB(recipe, params, inventoryById, overridePriceNullable){
  const price = (overridePriceNullable !== null && overridePriceNullable !== undefined)
    ? toNumber(overridePriceNullable)
    : toNumber(recipe.menuPrice);

  const cost = recipeCost(recipe, inventoryById);
  const frPct = toNumber(params.franchisePct)/100;
  const db = price - cost - (price * frPct);
  const dbPct = price > 0 ? (db/price)*100 : 0;
  return { price, cost, db, dbPct };
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
    .sub{ color:var(--muted); font-size:12px; line-height:1.3; }
    .card{ background:var(--card); border:1px solid var(--border); border-radius:14px; padding:14px; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .btn{ border:1px solid var(--border); background:transparent; color:var(--text); padding:9px 12px; border-radius:10px; cursor:pointer; font-weight:700; }
    .btn.primary{ background:var(--primary); border-color:transparent; color:#fff; }
    .btn.danger{ background:var(--danger); border-color:transparent; color:#fff; }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .input, select, textarea{ width:100%; padding:10px 10px; border-radius:10px; border:1px solid var(--border); background:var(--input); color:var(--text); outline:none; box-sizing:border-box; }
    .label{ font-size:12px; color:var(--muted); margin-top:10px; margin-bottom:6px; }
    .grid{ display:grid; grid-template-columns: repeat(12, 1fr); gap:12px; }
    .col-12{ grid-column: span 12; } .col-6{ grid-column: span 6; } .col-4{ grid-column: span 4; } .col-8{ grid-column: span 8; }
    @media (max-width: 900px){ .col-6,.col-4,.col-8{ grid-column: span 12; } }
    .tabs{ display:flex; gap:8px; flex-wrap:wrap; }
    .tab{ background:var(--tab); border:1px solid var(--border); padding:9px 10px; border-radius:10px; cursor:pointer; font-weight:800; color:var(--text); }
    .tab.active{ outline:2px solid var(--primary); }
    .hr{ height:1px; background:var(--border); margin:12px 0; }
    table{ width:100%; border-collapse:collapse; }
    th, td{ border-bottom:1px solid var(--border); padding:10px 8px; font-size:13px; text-align:left; }
    th{ color:var(--muted); font-size:12px; }
    td.right, th.right{ text-align:right; }
    .ok{ color:var(--ok); font-weight:900; }
    .bad{ color:var(--danger); font-weight:900; }
    .pill{ display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid var(--border); font-size:12px; color:var(--muted); }
    .small{ font-size:12px; color:var(--muted); }
    .two{ display:flex; gap:10px; flex-wrap:wrap; }
    .two > div{ flex: 1; min-width: 220px; }
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
function isAdmin(){
  const s = getSession();
  return s && String(s.username||"").toLowerCase() === "admin";
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

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

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

    if(!w){ msg.textContent = "Workspace ist Pflicht."; return; }
    if(!u){ msg.textContent = "Username fehlt."; return; }

    setWorkspace(w);
    await cloudPullOnStart();

    const st = loadState();
    const hit = (st.users || []).find(x => String(x.username||"").toLowerCase() === u.toLowerCase());
    if(!hit){ msg.textContent = "Unbekannter User (Admin muss dich anlegen)."; return; }

    setSession({ username: hit.username, displayName: hit.displayName || hit.username });
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
    el("div", { class:"title" }, ["MVP Umfang"]),
    el("div", { class:"sub", html: `
      ✅ Inventur anlegen + editieren<br/>
      ✅ Rezepte anlegen + Zutaten/Mengen editieren<br/>
      ✅ Wareneinsatz + DB € / %<br/>
      ✅ Daily Sales → Tages-DB<br/>
      ✅ Franchise% Parameter<br/>
      ✅ Sync über Geräte via Workspace<br/>
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
  const root = ensureRoot();
  root.innerHTML = "";

  const theme = localStorage.getItem(LS.theme) || "dark";
  applyTheme(theme);

  const s = getSession();
  if(!s){ screenLogin(); return; }

  const ws = getWorkspace();
  if(!ws){ clearSession(); screenLogin(); return; }

  const header = el("div", { class:"topbar" }, [
    el("div", {}, [
      el("div", { class:"title" }, ["Heisse Ecke – Kalkulation"]),
      el("div", { class:"sub", html: `
        Workspace: <b>${escapeHtml(ws)}</b> · <span id="syncStatus">${escapeHtml(localStorage.getItem(LS.syncStatus) || "Sync: bereit")}</span><br/>
        User: <b>${escapeHtml(s.displayName)}</b> (@${escapeHtml(s.username)}) · Letzte Speicherung: <b>${escapeHtml(localStorage.getItem(LS.lastSaved) || "—")}</b>
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
      tabBtn("inventory", "Inventur", true),
      tabBtn("recipes", "Rezepte", true),
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
  if(tab === "sales") content.appendChild(renderSales(st));
  if(tab === "params") content.appendChild(renderParams(st));
  if(tab === "users") content.appendChild(renderUsers(st));
}

/* ----------------------- Dashboard ----------------------- */
function renderDashboard(st){
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  const rows = (st.recipes||[]).map(r=>{
    const calc = recipeDB(r, st.params||{}, invById, null);
    return { id:r.id, name:r.name, cat:`${r.topCat||""} / ${r.subCat||""}`, ...calc };
  });

  const today = todayISO();
  const salesToday = (st.sales||[]).filter(s=>s.date === today);
  const dbToday = salesToday.reduce((sum, s)=>{
    const r = (st.recipes||[]).find(x=>x.id === s.recipeId);
    if(!r) return sum;
    const calc = recipeDB(r, st.params||{}, invById, null);
    return sum + calc.db * toNumber(s.qty);
  }, 0);

  const card1 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Status"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      Inventur-Artikel: <b>${(st.inventory||[]).length}</b><br/>
      Rezepte: <b>${(st.recipes||[]).length}</b><br/>
      Sales heute (${today}): <b>${salesToday.length}</b><br/>
      DB heute: <b class="${dbToday>=0?"ok":"bad"}">${fmtEUR(dbToday)}</b>
    `})
  ]);

  const card2 = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Hinweis"]),
    el("div", { class:"hr" }),
    el("div", { class:"sub", html: `
      Erst Inventur sauber, dann Rezepte.<br/>
      Franchise% wird im DB berücksichtigt.<br/>
      Sync Fehler: Supabase Tabelle/Policy checken.
    `})
  ]);

  const table = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Gerichte – Wareneinsatz & DB"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border)" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Gericht"]),
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

/* ----------------------- Inventur ----------------------- */
function renderInventory(st){
  const wrap = el("div", { class:"grid" });

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
  const inv_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

  const btnAddInv = el("button", { class:"btn primary" }, ["Artikel speichern"]);

  const inv_tbody = el("tbody", {});
  const editor = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Artikel bearbeiten"]),
    el("div", { class:"small" }, ["Noch kein Artikel ausgewählt."])
  ]);

  const form = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur – Artikel anlegen"]),
    el("div", { class:"sub" }, ["Packgröße + Packpreis → App rechnet €/g, €/ml oder €/stk."]),
    el("div", { class:"label" }, ["Warengruppe"]),
    inv_group,
    el("div", { class:"label" }, ["Artikelname"]),
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
    inv_msg
  ]);

  const listCard = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Inventur – Liste (Klick zum Editieren)"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
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
    const unit = el("select", { class:"input" }, [
      el("option", { value:"g" }, ["g"]),
      el("option", { value:"ml" }, ["ml"]),
      el("option", { value:"stk" }, ["stk"])
    ]);
    unit.value = inv.unitType || "g";

    const msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
    const upView = el("div", { class:"small", style:"margin-top:6px" }, [""]);

    function refreshUP(){
      const tmp = {
        ...inv,
        name: name.value,
        group: group.value,
        supplier: supplier.value,
        packSize: packSize.value,
        packPrice: packPrice.value,
        unitType: unit.value
      };
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

      if(!inv.name){
        msg.innerHTML = `<span class="bad">Artikelname fehlt.</span>`;
        return;
      }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
    };

    btnDel.onclick = ()=>{
      if(!confirm("Artikel wirklich löschen? (Rezepte verlieren die Zuordnung)")) return;
      st.inventory = (st.inventory||[]).filter(x=>x.id!==inv.id);
      (st.recipes||[]).forEach(r=>{
        r.lines = (r.lines||[]).filter(l=>l.inventoryId !== inv.id);
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

/* ----------------------- Rezepte ----------------------- */
function renderRecipes(st){
  const wrap = el("div", { class:"grid" });
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));

  const r_top = el("input", { class:"input", placeholder:"Speisen / Getränke" });
  const r_sub = el("input", { class:"input", placeholder:"z.B. Currywurst / Cocktails" });
  const r_name = el("input", { class:"input", placeholder:"z.B. Currywurst Dippers mit Pommes" });
  const r_price = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 9,90" });
  const r_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);
  const btnAddRecipe = el("button", { class:"btn primary" }, ["Gericht speichern"]);

  const r_tbody = el("tbody", {});
  const editor = el("div", { class:"card col-12" }, [
    el("div", { class:"title" }, ["Rezept bearbeiten"]),
    el("div", { class:"small" }, ["Noch kein Rezept ausgewählt."])
  ]);

  const form = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Rezept – Gericht anlegen"]),
    el("div", { class:"label" }, ["Top-Kategorie"]), r_top,
    el("div", { class:"label" }, ["Unterkategorie"]), r_sub,
    el("div", { class:"label" }, ["Gerichtname"]), r_name,
    el("div", { class:"label" }, ["Menüpreis (€)"]), r_price,
    el("div", { class:"row", style:"margin-top:12px" }, [btnAddRecipe]),
    r_msg
  ]);

  const listCard = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Rezepte – Liste (Klick zum Bearbeiten)"]),
    el("div", { class:"hr" }),
    el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border);max-height:520px" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Gericht"]),
            el("th", {}, ["Kategorie"]),
            el("th", { class:"right" }, ["Preis"]),
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
    const invById2 = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
    (st.recipes||[]).forEach(r=>{
      const calc = recipeDB(r, st.params||{}, invById2, null);
      const tr = el("tr", { style:"cursor:pointer" }, [
        el("td", { html: escapeHtml(r.name) }),
        el("td", { html: escapeHtml(`${r.topCat||""} / ${r.subCat||""}`) }),
        el("td", { class:"right" }, [fmtEUR(calc.price)]),
        el("td", { class:"right" }, [fmtEUR(calc.cost)])
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

    const name = el("input", { class:"input", value: r.name || "" });
    const topCat = el("input", { class:"input", value: r.topCat || "" });
    const subCat = el("input", { class:"input", value: r.subCat || "" });
    const price = el("input", { class:"input", inputmode:"decimal", value: String(r.menuPrice ?? "") });
    const msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

    const invList = st.inventory || [];
    const selInv = el("select", { class:"input" }, invList.map(i=> el("option", { value:i.id }, [`${i.name} (${i.unitType})`]) ));
    const qty = el("input", { class:"input", inputmode:"decimal", placeholder:"Menge (z.B. 120)" });

    const summary = el("div", { class:"sub", style:"margin-top:6px" }, [""]);
    const linesWrap = el("div", { style:"overflow:auto;border-radius:12px;border:1px solid var(--border)" });

    function drawLines(){
      const invById3 = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
      const calc = recipeDB(r, st.params||{}, invById3, null);

      summary.innerHTML = `
        Wareneinsatz: <b>${fmtEUR(calc.cost)}</b> ·
        DB: <b class="${calc.db>=0?"ok":"bad"}">${fmtEUR(calc.db)}</b> ·
        DB%: <b class="${calc.dbPct>=0?"ok":"bad"}">${calc.dbPct.toFixed(1)}%</b>
      `;

      const tbody = el("tbody", {}, (r.lines||[]).map(l=>{
        const invItem = invById3[l.inventoryId];
        const up = invItem ? unitPrice(invItem) : 0;
        const cost = invItem ? toNumber(l.qty)*up : 0;

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
          el("td", { class:"right" }, [fmtEUR(cost)]),
          el("td", { class:"right" }, [el("div",{class:"row",style:"justify-content:flex-end"},[btnSaveQty, btnDel])])
        ]);
      }));

      linesWrap.innerHTML = "";
      linesWrap.appendChild(el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Zutat"]),
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
      r.menuPrice = price.value.trim();
      if(!r.name){ msg.innerHTML = `<span class="bad">Gerichtname fehlt.</span>`; return; }
      saveState(st);
      msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
      drawList();
      drawLines();
    };

    btnDelRecipe.onclick = ()=>{
      if(!confirm("Rezept wirklich löschen?")) return;
      st.recipes = (st.recipes||[]).filter(x=>x.id!==r.id);
      st.sales = (st.sales||[]).filter(s=>s.recipeId !== r.id);
      saveState(st);
      drawList();
      openEditor(null);
    };

    btnAddLine.onclick = ()=>{
      if(!(st.inventory||[]).length){
        alert("Inventur ist leer. Erst Inventur-Artikel anlegen.");
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
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Gerichtname"]), name]),
      el("div", { class:"col-3" }, [el("div",{class:"label"},["Top-Kategorie"]), topCat]),
      el("div", { class:"col-3" }, [el("div",{class:"label"},["Unterkategorie"]), subCat]),
      el("div", { class:"col-6" }, [el("div",{class:"label"},["Menüpreis (€)"]), price]),
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
      menuPrice: (r_price.value||"").trim(),
      lines: []
    };
    if(!r.name){ r_msg.innerHTML = `<span class="bad">Gerichtname fehlt.</span>`; return; }

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

/* ----------------------- Sales ----------------------- */
function renderSales(st){
  const wrap = el("div", { class:"grid" });
  const invById = Object.fromEntries((st.inventory||[]).map(x=>[x.id,x]));
  const today = todayISO();

  const s_date = el("input", { class:"input", value: today });
  const s_recipe = el("select", { class:"input" }, (st.recipes||[]).map(r=>el("option",{value:r.id},[r.name])) );
  const s_qty = el("input", { class:"input", inputmode:"decimal", placeholder:"z.B. 20" });
  const s_msg = el("div", { class:"small", style:"margin-top:8px" }, [""]);

  const btnAddSale = el("button", { class:"btn primary" }, ["Speichern"]);
  const s_tbody = el("tbody", {});
  const s_summary = el("div", { class:"sub" }, [""]);

  const card = el("div", { class:"card col-12 col-6" }, [
    el("div", { class:"title" }, ["Daily Sales – Eingabe"]),
    el("div", { class:"label" }, ["Datum"]), s_date,
    el("div", { class:"label" }, ["Gericht"]), s_recipe,
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
            el("th", {}, ["Gericht"]),
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
      const r = (st.recipes||[]).find(x=>x.id===e.recipeId);
      const calc = r ? recipeDB(r, st.params||{}, invById, null) : { db:0 };
      const lineDb = (calc.db || 0) * toNumber(e.qty);
      dbSum += lineDb;

      const btnDel = el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);
      btnDel.onclick = ()=>{
        st.sales = (st.sales||[]).filter(x=>x.id!==e.id);
        saveState(st);
        draw();
      };

      s_tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(r ? r.name : "— (fehlend)")}),
        el("td",{class:"right"},[String(toNumber(e.qty))]),
        el("td",{class:`right ${lineDb>=0?"ok":"bad"}`},[fmtEUR(lineDb)]),
        el("td",{class:"right"},[btnDel])
      ]));
    });

    s_summary.innerHTML = `Tages-DB: <b class="${dbSum>=0?"ok":"bad"}">${fmtEUR(dbSum)}</b>`;
  }

  btnAddSale.onclick = ()=>{
    s_msg.textContent = "";

    const date = (s_date.value||today).trim();
    const recipeId = s_recipe.value;
    const qty = (s_qty.value||"").trim();
    if(!recipeId){ s_msg.innerHTML = `<span class="bad">Gericht fehlt.</span>`; return; }
    if(!qty){ s_msg.innerHTML = `<span class="bad">Qty fehlt.</span>`; return; }

    st.sales.push({ id: uuid(), date, recipeId, qty });
    saveState(st);
    s_qty.value = "";
    s_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
    draw();
  };

  s_date.addEventListener("change", draw);
  draw();
  return wrap;
}

/* ----------------------- Params ----------------------- */
function renderParams(st){
  const wrap = el("div",{class:"grid"});
  const p_fr = el("input",{class:"input", inputmode:"decimal", value:String(st.params?.franchisePct ?? 0)});
  const p_vat = el("input",{class:"input", inputmode:"decimal", value:String(st.params?.vatPct ?? 7)});
  const p_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnSave = el("button",{class:"btn primary"},["Speichern"]);

  btnSave.onclick = ()=>{
    st.params = st.params || {};
    st.params.franchisePct = (p_fr.value||"0").trim();
    st.params.vatPct = (p_vat.value||"7").trim();
    saveState(st);
    p_msg.innerHTML = `<span class="ok">Gespeichert.</span>`;
  };

  wrap.appendChild(el("div",{class:"card col-12 col-6"},[
    el("div",{class:"title"},["Parameter"]),
    el("div",{class:"sub"},["Franchise% wird im Deckungsbeitrag abgezogen (Preis * %)."]),
    el("div",{class:"label"},["Franchise %"]), p_fr,
    el("div",{class:"label"},["MwSt % (nur gespeichert, MVP noch ohne Netto/Brutto)"]), p_vat,
    el("div",{class:"row", style:"margin-top:12px"},[btnSave]),
    p_msg
  ]));
  return wrap;
}

/* ----------------------- Users ----------------------- */
function renderUsers(st){
  if(!isAdmin()){
    return el("div",{class:"card"},[el("div",{class:"title"},["Kein Zugriff"])]);
  }

  const wrap = el("div",{class:"grid"});
  const u_name = el("input",{class:"input", placeholder:"z.B. max"});
  const u_disp = el("input",{class:"input", placeholder:"z.B. Max Mustermann"});
  const u_msg = el("div",{class:"small", style:"margin-top:8px"},[""]);
  const btnAdd = el("button",{class:"btn primary"},["User speichern"]);
  const u_tbody = el("tbody",{});

  function draw(){
    u_tbody.innerHTML = "";
    (st.users||[]).forEach(u=>{
      const isA = String(u.username||"").toLowerCase()==="admin";
      const btn = isA
        ? el("span",{class:"small"},["Admin"])
        : el("button",{class:"btn danger", style:"padding:7px 10px"},["Löschen"]);

      if(!isA){
        btn.onclick = ()=>{
          if(!confirm("User löschen?")) return;
          st.users = (st.users||[]).filter(x => String(x.username||"").toLowerCase() !== String(u.username||"").toLowerCase());
          saveState(st);
          draw();
        };
      }

      u_tbody.appendChild(el("tr",{},[
        el("td",{html:escapeHtml(u.username)}),
        el("td",{html:escapeHtml(u.displayName||u.username)}),
        el("td",{class:"right"},[btn])
      ]));
    });
  }

  btnAdd.onclick = ()=>{
    u_msg.textContent = "";
    const username = (u_name.value||"").trim();
    const displayName = (u_disp.value||"").trim();

    if(!username){ u_msg.innerHTML = `<span class="bad">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ u_msg.innerHTML = `<span class="bad">Keine Leerzeichen im Username.</span>`; return; }

    const exists = (st.users||[]).some(x => String(x.username||"").toLowerCase() === username.toLowerCase());
    if(exists){ u_msg.innerHTML = `<span class="bad">Username existiert schon.</span>`; return; }

    st.users.push({ username, displayName: displayName || username });
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
