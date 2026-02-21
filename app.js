// Heisse Ecke MVP – GitHub Pages ready (pure HTML/JS)
// + Cloud Sync (zwischen Geräten wechseln) via Supabase
// Konzept:
// - Lokal wird sofort gespeichert (flüssig).
// - Zusätzlich wird der komplette App-Stand in "app_state" pro "workspace" gespeichert.
// - Du brauchst nur einen Workspace-Code (z.B. "heisse-ecke") und teilst den mit Kollegen.

const SUPABASE_URL = "https://opiohltflibtusspvkih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9waW9obHRmbGlidHVzc3B2a2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDQ5NDEsImV4cCI6MjA4NzE4MDk0MX0.UfWr0G-w8j9PN-zb8-KL-OpmZeReypmkmpfPV_5Cwfg";

const LS = {
  theme: "he_theme",
  session: "he_session",
  ui: "he_ui",
  users: "he_users",
  inventory: "he_inventory",
  recipes: "he_recipes",
  params: "he_params",
  sales: "he_sales",
  lastSaved: "he_last_saved",
  workspace: "he_workspace",
  syncStatus: "he_sync_status",
};

function $(sel){ return document.querySelector(sel); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function nowISO(){ return new Date().toISOString(); }
function fmtTime(ts){
  try{ return new Date(ts).toLocaleString(); }catch{ return ""; }
}

function readJSON(key, fallback){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch{ return fallback; }
}
function writeJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
  localStorage.setItem(LS.lastSaved, nowISO());
  scheduleCloudSave(); // << Cloud Sync
}

function setTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(LS.theme, theme);
}
function toggleTheme(){
  const cur = localStorage.getItem(LS.theme) || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
}

function getSession(){ return readJSON(LS.session, null); }
function setSession(session){ writeJSON(LS.session, session); }
function clearSession(){ localStorage.removeItem(LS.session); }

function getWorkspace(){ return (localStorage.getItem(LS.workspace) || "").trim(); }
function setWorkspace(ws){ localStorage.setItem(LS.workspace, ws); }

function setSyncStatus(text){
  localStorage.setItem(LS.syncStatus, text);
  const el = $("#syncStatus");
  if(el) el.textContent = text;
}

function seedDataIfEmpty(){
  if(!Array.isArray(readJSON(LS.inventory, null))) localStorage.setItem(LS.inventory, "[]");
  if(!Array.isArray(readJSON(LS.recipes, null))) localStorage.setItem(LS.recipes, "[]");
  if(!readJSON(LS.params, null)) localStorage.setItem(LS.params, JSON.stringify({ franchisePct: 0, vatPct: 7, fixedCostsMonthly: 0, variableCostsPct: 0 }));
  if(!Array.isArray(readJSON(LS.sales, null))) localStorage.setItem(LS.sales, "[]");
  if(!readJSON(LS.ui, null)) localStorage.setItem(LS.ui, JSON.stringify({ tab: "dashboard" }));
  if(!Array.isArray(readJSON(LS.users, null))) localStorage.setItem(LS.users, JSON.stringify([{ username:"admin", displayName:"Admin" }]));
}

// -------- Admin check
function isAdmin(session){
  return session && String(session.username||"").toLowerCase() === "admin";
}

// ---------- Core calc ----------
function toNumber(x){
  if(x === null || x === undefined) return 0;
  const s = String(x).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function calcUnitPrice(item){
  const packPrice = toNumber(item.packPrice);
  const packSize = toNumber(item.packSize);
  if(packPrice <= 0) return 0;

  if(item.unitType === "stk"){
    const denom = packSize > 0 ? packSize : 1;
    return packPrice / denom;
  }
  if(packSize <= 0) return 0;
  return packPrice / packSize;
}
function recipeLineCost(line, inventoryById){
  const inv = inventoryById[line.inventoryId];
  if(!inv) return 0;
  const qty = toNumber(line.qty);
  const unitPrice = calcUnitPrice(inv);
  return qty * unitPrice;
}

// ---------- Cloud Sync (Supabase REST) ----------
// Wir speichern den KOMPLETTEN Stand als JSON in einer Zeile pro workspace.
function buildFullState(){
  return {
    users: readJSON(LS.users, []),
    inventory: readJSON(LS.inventory, []),
    recipes: readJSON(LS.recipes, []),
    params: readJSON(LS.params, { franchisePct:0, vatPct:7, fixedCostsMonthly:0, variableCostsPct:0 }),
    sales: readJSON(LS.sales, []),
    savedAt: localStorage.getItem(LS.lastSaved) || null,
  };
}
function applyFullState(state){
  if(!state || typeof state !== "object") return;
  if(Array.isArray(state.users)) localStorage.setItem(LS.users, JSON.stringify(state.users));
  if(Array.isArray(state.inventory)) localStorage.setItem(LS.inventory, JSON.stringify(state.inventory));
  if(Array.isArray(state.recipes)) localStorage.setItem(LS.recipes, JSON.stringify(state.recipes));
  if(state.params) localStorage.setItem(LS.params, JSON.stringify(state.params));
  if(Array.isArray(state.sales)) localStorage.setItem(LS.sales, JSON.stringify(state.sales));
  localStorage.setItem(LS.lastSaved, state.savedAt || nowISO());
}

async function supabaseUpsertState(workspace, data){
  const url = `${SUPABASE_URL}/rest/v1/app_state?on_conflict=workspace`;
  const body = [{ workspace, data, updated_at: nowISO() }];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Cloud Save fehlgeschlagen: ${res.status} ${t}`);
  }
}

async function supabaseFetchState(workspace){
  const url = `${SUPABASE_URL}/rest/v1/app_state?workspace=eq.${encodeURIComponent(workspace)}&select=workspace,data,updated_at`;
  const res = await fetch(url, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Cloud Load fehlgeschlagen: ${res.status} ${t}`);
  }
  const rows = await res.json();
  if(!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0]; // {workspace,data,updated_at}
}

let cloudSaveTimer = null;
function scheduleCloudSave(){
  const ws = getWorkspace();
  if(!ws) return; // kein Workspace = kein Sync

  if(cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async ()=>{
    try{
      setSyncStatus("Sync: speichere …");
      await supabaseUpsertState(ws, buildFullState());
      setSyncStatus("Sync: aktuell ✅");
    }catch(e){
      setSyncStatus("Sync: Fehler ❌");
      console.error(e);
    }
  }, 600); // debounce
}

async function initialCloudPull(){
  const ws = getWorkspace();
  if(!ws) return;

  try{
    setSyncStatus("Sync: lade …");
    const row = await supabaseFetchState(ws);
    if(row && row.data){
      // Konfliktregel MVP: Cloud gewinnt beim Start
      applyFullState(row.data);
      setSyncStatus("Sync: geladen ✅");
    }else{
      // Noch nichts in Cloud: ersten Stand hochschieben
      await supabaseUpsertState(ws, buildFullState());
      setSyncStatus("Sync: initial gespeichert ✅");
    }
  }catch(e){
    setSyncStatus("Sync: Fehler ❌");
    console.error(e);
  }
}

// ---------- Views ----------
function loginView(){
  const ws = getWorkspace();
  return `
  <div class="container">
    <div class="header">
      <h1 class="h1">Heisse Ecke – Kalkulation</h1>
      <button class="btn" id="btnTheme">Hell/Dunkel</button>
    </div>

    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Workspace (gemeinsam über Geräte)</div>
        <div class="small">
          Das ist dein “gemeinsamer Schlüssel” für alle Geräte.
          <br/>Beispiel: <b>heisse-ecke</b>
        </div>
        <div class="label">Workspace Code</div>
        <input class="input" id="workspace" placeholder="z.B. heisse-ecke" value="${escapeHtml(ws)}" />
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnSaveWs">Workspace speichern</button>
        </div>
        <div class="small" id="wsMsg" style="margin-top:10px"></div>

        <div class="hr"></div>

        <div class="h1">Login</div>
        <div class="small">Gib deinen <b>Benutzernamen</b> ein. Admin kann User verwalten.</div>
        <div class="label">Benutzername</div>
        <input class="input" id="username" placeholder="z.B. kai" autocomplete="username" />
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnLogin">Weiter</button>
        </div>
        <div class="small" id="loginMsg" style="margin-top:10px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Was jetzt möglich ist</div>
        <div class="small">
          ✅ Laptop eingeben → iPhone sieht dieselben Daten (Sync).<br/>
          ✅ Dark/Light Mode.<br/>
          ✅ Rezepte/Inventur/DB Berechnung.
          <br/><br/>
          Hinweis: Für MVP ist der Workspace-Code wie ein “Team-Passwort”. Wer ihn hat, sieht die Daten.
        </div>
      </div>
    </div>
  </div>`;
}

function appShell(session, activeTab){
  const tabBtn = (id, label, show=true) =>
    show ? `<button class="tab ${activeTab===id?"active":""}" data-tab="${id}">${label}</button>` : "";

  const lastSaved = localStorage.getItem(LS.lastSaved);
  const ws = getWorkspace();
  const sync = localStorage.getItem(LS.syncStatus) || (ws ? "Sync: bereit" : "Sync: aus (kein Workspace)");

  return `
  <div class="container">
    <div class="header">
      <div>
        <h1 class="h1">Heisse Ecke – Kalkulation</h1>
        <div class="badge">
          Workspace: <b>${escapeHtml(ws || "—")}</b> · <span id="syncStatus">${escapeHtml(sync)}</span>
          <br/>
          Angemeldet als: <b>${escapeHtml(session.displayName)}</b> (@${escapeHtml(session.username)})
          ${isAdmin(session) ? ` · <span class="ok">Admin</span>` : ""}
          <br/>Letzte Speicherung (lokal): <b>${escapeHtml(lastSaved ? fmtTime(lastSaved) : "—")}</b>
        </div>
      </div>
      <div class="row">
        <button class="btn" id="btnTheme">Hell/Dunkel</button>
        <button class="btn" id="btnSyncNow">Sync jetzt</button>
        <button class="btn danger" id="btnLogout">Logout</button>
      </div>
    </div>

    <div class="card">
      <div class="nav">
        ${tabBtn("dashboard","Dashboard")}
        ${tabBtn("inventory","Inventur")}
        ${tabBtn("recipes","Rezepte")}
        ${tabBtn("params","Parameter")}
        ${tabBtn("sales","Daily Sales")}
        ${tabBtn("users","User (Admin)", isAdmin(session))}
      </div>
    </div>

    <div id="content" style="margin-top:12px"></div>
  </div>`;
}

function render(){
  const root = $("#app");
  const theme = localStorage.getItem(LS.theme) || "dark";
  setTheme(theme);

  const session = getSession();
  if(!session){
    root.innerHTML = loginView();
    bindLogin();
    return;
  }

  seedDataIfEmpty();

  const ui = readJSON(LS.ui, { tab: "dashboard" });
  root.innerHTML = appShell(session, ui.tab);
  bindShell(session);

  if(ui.tab === "dashboard") renderDashboard();
  if(ui.tab === "inventory") renderInventory();
  if(ui.tab === "recipes") renderRecipes();
  if(ui.tab === "params") renderParams();
  if(ui.tab === "sales") renderSales();
  if(ui.tab === "users") renderUsers(session);
}

// ---------- Bindings ----------
function bindLogin(){
  $("#btnTheme").onclick = toggleTheme;

  $("#btnSaveWs").onclick = async ()=>{
    const ws = ($("#workspace").value||"").trim();
    if(!ws){
      $("#wsMsg").innerHTML = `<span class="danger">Workspace Code fehlt.</span>`;
      return;
    }
    setWorkspace(ws);
    $("#wsMsg").innerHTML = `<span class="ok">Workspace gespeichert.</span>`;

    seedDataIfEmpty();
    await initialCloudPull();
  };

  $("#btnLogin").onclick = async () => {
    const u = ($("#username").value || "").trim();
    const msg = $("#loginMsg");
    msg.textContent = "";

    if(!u){ msg.innerHTML = `<span class="danger">Bitte Username eingeben.</span>`; return; }

    seedDataIfEmpty();
    await initialCloudPull();

    const users = readJSON(LS.users, []);
    const hit = users.find(x => (x.username || "").toLowerCase() === u.toLowerCase());
    if(!hit){
      msg.innerHTML = `<span class="danger">Unbekannter Username.</span> Bitte Admin fragen.`;
      return;
    }

    setSession({ username: hit.username, displayName: hit.displayName || hit.username, loginAt: nowISO() });
    render();
  };
}

function bindShell(session){
  $("#btnTheme").onclick = toggleTheme;
  $("#btnLogout").onclick = () => { clearSession(); render(); };

  $("#btnSyncNow").onclick = async ()=>{
    const ws = getWorkspace();
    if(!ws){ alert("Kein Workspace gesetzt (Login-Seite)."); return; }
    try{
      setSyncStatus("Sync: speichere …");
      await supabaseUpsertState(ws, buildFullState());
      setSyncStatus("Sync: aktuell ✅");
      await initialCloudPull();
      render();
    }catch(e){
      setSyncStatus("Sync: Fehler ❌");
      alert("Sync Fehler. Schau Console (F12).");
      console.error(e);
    }
  };

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick = () => {
      const tab = btn.getAttribute("data-tab");
      if(tab === "users" && !isAdmin(session)) return;
      writeJSON(LS.ui, { tab });
      render();
    };
  });
}

// ---------- Dashboard ----------
function renderDashboard(){
  const content = $("#content");
  const inv = readJSON(LS.inventory, []);
  const recipes = readJSON(LS.recipes, []);
  const sales = readJSON(LS.sales, []);
  const params = readJSON(LS.params, { franchisePct:0, vatPct:7, fixedCostsMonthly:0, variableCostsPct:0 });

  const inventoryById = Object.fromEntries(inv.map(x=>[x.id,x]));
  const recipeRows = recipes.map(r=>{
    const cost = (r.lines||[]).reduce((sum,l)=>sum+recipeLineCost(l, inventoryById), 0);
    const price = toNumber(r.price);
    const franchise = toNumber(params.franchisePct)/100;
    const db = price - cost - (price*franchise);
    const dbPct = price>0 ? (db/price)*100 : 0;
    return { id:r.id, name:r.name, category:r.categoryTop||"", sub:r.categorySub||"", cost, price, db, dbPct };
  });

  const today = new Date().toISOString().slice(0,10);
  const todays = sales.filter(s => s.date === today);
  const todaysDB = todays.reduce((sum,s)=>{
    const rr = recipeRows.find(x=>x.name===s.recipeName);
    if(!rr) return sum;
    return sum + (rr.db * toNumber(s.qty));
  },0);

  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Status</div>
        <div class="hr"></div>
        <div class="small">
          Inventur-Artikel: <b>${inv.length}</b><br/>
          Rezepte: <b>${recipes.length}</b><br/>
          Sales heute (${today}): <b>${todays.length}</b><br/>
          DB heute: <b class="${todaysDB>=0?"ok":"danger"}">${todaysDB.toFixed(2)} €</b>
        </div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Wichtig</div>
        <div class="hr"></div>
        <div class="small">
          Wenn du am zweiten Gerät denselben <b>Workspace Code</b> eingibst → siehst du denselben Stand.<br/>
          Bei “Sync Fehler” stimmt meist Supabase Table/Policy nicht.
        </div>
      </div>

      <div class="card col-12">
        <div class="h1">Gerichte Übersicht</div>
        <div class="hr"></div>
        <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
          <table class="table">
            <thead>
              <tr>
                <th>Gericht</th><th>Kategorie</th>
                <th class="right">Wareneinsatz</th><th class="right">Preis</th>
                <th class="right">DB €</th><th class="right">DB %</th>
              </tr>
            </thead>
            <tbody>
              ${recipeRows.map(r=>`
                <tr>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${escapeHtml(r.category)} / ${escapeHtml(r.sub)}</td>
                  <td class="right">${r.cost.toFixed(2)} €</td>
                  <td class="right">${r.price.toFixed(2)} €</td>
                  <td class="right ${r.db>=0?"ok":"danger"}">${r.db.toFixed(2)} €</td>
                  <td class="right ${r.dbPct>=0?"ok":"danger"}">${r.dbPct.toFixed(1)}%</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ---------- Inventory ----------
function renderInventory(){
  const content = $("#content");
  const inv = readJSON(LS.inventory, []);

  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Inventur – Artikel anlegen</div>
        <div class="small">Einheit: <b>g</b>, <b>ml</b> oder <b>stk</b>. Packgröße: z.B. 1000 (g).</div>

        <div class="label">Warengruppe/Kategorie</div>
        <input class="input" id="invCat" placeholder="z.B. Fleisch, Saucen, Verpackung" />

        <div class="label">Artikelname</div>
        <input class="input" id="invName" placeholder="z.B. Currywurst gelb" />

        <div class="label">Lieferant</div>
        <input class="input" id="invSupplier" placeholder="z.B. Metro" />

        <div class="row">
          <div style="flex:1;min-width:180px">
            <div class="label">Packgröße</div>
            <input class="input" id="invPackSize" placeholder="z.B. 1000" inputmode="decimal" />
          </div>
          <div style="flex:1;min-width:180px">
            <div class="label">Einheit</div>
            <select id="invUnit" class="input">
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="stk">stk</option>
            </select>
          </div>
        </div>

        <div class="label">Packpreis (€)</div>
        <input class="input" id="invPackPrice" placeholder="z.B. 12,50" inputmode="decimal" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnAddInv">Artikel speichern</button>
        </div>
        <div class="small" id="invMsg" style="margin-top:8px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Inventur – Liste</div>
        <div class="hr"></div>
        <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
          <table class="table">
            <thead>
              <tr>
                <th>Artikel</th><th>Kat.</th><th>Einheit</th>
                <th class="right">Pack</th><th class="right">€</th><th class="right">€/Einheit</th>
              </tr>
            </thead>
            <tbody>
              ${inv.map(i=>{
                const unitPrice = calcUnitPrice(i);
                return `
                  <tr>
                    <td>${escapeHtml(i.name)}</td>
                    <td>${escapeHtml(i.category||"")}</td>
                    <td>${escapeHtml(i.unitType)}</td>
                    <td class="right">${toNumber(i.packSize).toString()}</td>
                    <td class="right">${toNumber(i.packPrice).toFixed(2)}</td>
                    <td class="right">${unitPrice.toFixed(4)}</td>
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  $("#btnAddInv").onclick = () => {
    const msg = $("#invMsg");
    msg.textContent = "";

    const item = {
      id: crypto.randomUUID(),
      category: ($("#invCat").value||"").trim(),
      name: ($("#invName").value||"").trim(),
      supplier: ($("#invSupplier").value||"").trim(),
      packSize: ($("#invPackSize").value||"").trim(),
      unitType: $("#invUnit").value,
      packPrice: ($("#invPackPrice").value||"").trim(),
      createdAt: nowISO(),
    };

    if(!item.name){ msg.innerHTML = `<span class="danger">Artikelname fehlt.</span>`; return; }

    const inv2 = readJSON(LS.inventory, []);
    inv2.push(item);
    writeJSON(LS.inventory, inv2);
    renderInventory();
  };
}

// ---------- Recipes ----------
function renderRecipes(){
  const content = $("#content");
  const inv = readJSON(LS.inventory, []);
  const recipes = readJSON(LS.recipes, []);
  const inventoryById = Object.fromEntries(inv.map(x=>[x.id,x]));

  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Rezepte – Gericht anlegen</div>

        <div class="label">Top-Kategorie</div>
        <input class="input" id="rTop" placeholder="Speisen / Getränke" />

        <div class="label">Unterkategorie</div>
        <input class="input" id="rSub" placeholder="z.B. Currywurst / Cocktails" />

        <div class="label">Gerichtname</div>
        <input class="input" id="rName" placeholder="z.B. Currywurst Dippers mit Pommes" />

        <div class="label">Verkaufspreis (€)</div>
        <input class="input" id="rPrice" placeholder="z.B. 9,90" inputmode="decimal" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnAddRecipe">Gericht speichern</button>
        </div>

        <div class="small" id="rMsg" style="margin-top:8px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Rezepte – Liste</div>
        <div class="hr"></div>
        <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
          <table class="table">
            <thead>
              <tr><th>Gericht</th><th>Kategorie</th><th class="right">Preis</th><th class="right">Zutaten</th></tr>
            </thead>
            <tbody>
              ${recipes.map(r=>`
                <tr>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${escapeHtml(r.categoryTop||"")} / ${escapeHtml(r.categorySub||"")}</td>
                  <td class="right">${toNumber(r.price).toFixed(2)} €</td>
                  <td class="right">${(r.lines||[]).length}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card col-12">
        <div class="h1">Zutat zu Rezept hinzufügen</div>
        <div class="row">
          <div style="flex:1;min-width:240px">
            <div class="label">Rezept</div>
            <select class="input" id="selRecipe">
              ${recipes.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("")}
            </select>
          </div>
          <div style="flex:1;min-width:240px">
            <div class="label">Inventur-Artikel</div>
            <select class="input" id="selInv">
              ${inv.map(i=>`<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.unitType)})</option>`).join("")}
            </select>
          </div>
          <div style="flex:1;min-width:180px">
            <div class="label">Menge</div>
            <input class="input" id="lineQty" placeholder="z.B. 120" inputmode="decimal" />
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnAddLine">Zutat hinzufügen</button>
        </div>

        <div class="hr"></div>
        <div id="recipeLines"></div>
      </div>
    </div>
  `;

  $("#btnAddRecipe").onclick = () => {
    const msg = $("#rMsg");
    msg.textContent = "";

    const r = {
      id: crypto.randomUUID(),
      categoryTop: ($("#rTop").value||"").trim(),
      categorySub: ($("#rSub").value||"").trim(),
      name: ($("#rName").value||"").trim(),
      price: ($("#rPrice").value||"").trim(),
      lines: [],
      createdAt: nowISO(),
    };

    if(!r.name){ msg.innerHTML = `<span class="danger">Gerichtname fehlt.</span>`; return; }

    const rs = readJSON(LS.recipes, []);
    rs.push(r);
    writeJSON(LS.recipes, rs);
    renderRecipes();
  };

  $("#btnAddLine").onclick = () => {
    const recipeId = $("#selRecipe").value;
    const inventoryId = $("#selInv").value;
    const qty = ($("#lineQty").value||"").trim();

    const rs = readJSON(LS.recipes, []);
    const r = rs.find(x=>x.id===recipeId);
    if(!r) return;

    const invItem = inventoryById[inventoryId];
    if(!invItem) return;

    r.lines.push({ id: crypto.randomUUID(), inventoryId, qty, unitType: invItem.unitType });
    writeJSON(LS.recipes, rs);
    renderRecipes();
  };

  function drawLines(){
    const recipeId = $("#selRecipe").value;
    const rs = readJSON(LS.recipes, []);
    const r = rs.find(x=>x.id===recipeId);
    if(!r){ $("#recipeLines").innerHTML = ""; return; }

    const inv2 = readJSON(LS.inventory, []);
    const byId = Object.fromEntries(inv2.map(x=>[x.id,x]));
    const cost = (r.lines||[]).reduce((sum,l)=>sum+recipeLineCost(l, byId), 0);

    $("#recipeLines").innerHTML = `
      <div class="h1" style="font-size:16px">${escapeHtml(r.name)}</div>
      <div class="small">Wareneinsatz: <b>${cost.toFixed(2)} €</b></div>
      <div class="hr"></div>
      <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
        <table class="table">
          <thead>
            <tr><th>Zutat</th><th>Einheit</th><th class="right">Menge</th><th class="right">€/Einheit</th><th class="right">Kosten</th></tr>
          </thead>
          <tbody>
            ${(r.lines||[]).map(l=>{
              const it = byId[l.inventoryId];
              const up = it ? calcUnitPrice(it) : 0;
              const lc = recipeLineCost(l, byId);
              return `
                <tr>
                  <td>${escapeHtml(it ? it.name : "—")}</td>
                  <td>${escapeHtml(l.unitType || "")}</td>
                  <td class="right">${toNumber(l.qty).toString()}</td>
                  <td class="right">${up.toFixed(4)}</td>
                  <td class="right">${lc.toFixed(2)} €</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }
  $("#selRecipe").onchange = drawLines;
  drawLines();
}

// ---------- Params ----------
function renderParams(){
  const content = $("#content");
  const params = readJSON(LS.params, { franchisePct:0, vatPct:7, fixedCostsMonthly:0, variableCostsPct:0 });

  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Parameter</div>

        <div class="label">Franchise %</div>
        <input class="input" id="pFr" value="${escapeHtml(params.franchisePct)}" inputmode="decimal" />

        <div class="label">MwSt %</div>
        <input class="input" id="pVat" value="${escapeHtml(params.vatPct)}" inputmode="decimal" />

        <div class="label">Fixkosten pro Monat (€)</div>
        <input class="input" id="pFixed" value="${escapeHtml(params.fixedCostsMonthly)}" inputmode="decimal" />

        <div class="label">Variable Kosten %</div>
        <input class="input" id="pVar" value="${escapeHtml(params.variableCostsPct)}" inputmode="decimal" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnSaveParams">Speichern</button>
        </div>
        <div class="small" id="pMsg" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  $("#btnSaveParams").onclick = ()=>{
    const p = {
      franchisePct: ($("#pFr").value||"").trim(),
      vatPct: ($("#pVat").value||"").trim(),
      fixedCostsMonthly: ($("#pFixed").value||"").trim(),
      variableCostsPct: ($("#pVar").value||"").trim(),
    };
    writeJSON(LS.params, p);
    $("#pMsg").innerHTML = `<span class="ok">Gespeichert.</span>`;
  };
}

// ---------- Sales ----------
function renderSales(){
  const content = $("#content");
  const sales = readJSON(LS.sales, []);
  const recipes = readJSON(LS.recipes, []);
  const today = new Date().toISOString().slice(0,10);

  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Daily Sales</div>

        <div class="label">Datum</div>
        <input class="input" id="sDate" value="${today}" />

        <div class="label">Gericht</div>
        <select class="input" id="sRecipe">
          ${recipes.map(r=>`<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join("")}
        </select>

        <div class="label">Anzahl verkauft</div>
        <input class="input" id="sQty" placeholder="z.B. 20" inputmode="decimal" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnAddSale">Speichern</button>
        </div>

        <div class="small" id="sMsg" style="margin-top:8px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Einträge (heute)</div>
        <div class="hr"></div>
        <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
          <table class="table">
            <thead><tr><th>Datum</th><th>Gericht</th><th class="right">Qty</th></tr></thead>
            <tbody>
              ${sales.filter(s=>s.date===today).map(s=>`
                <tr><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.recipeName)}</td><td class="right">${toNumber(s.qty).toString()}</td></tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  $("#btnAddSale").onclick = ()=>{
    const entry = {
      id: crypto.randomUUID(),
      date: ($("#sDate").value||today).trim(),
      recipeName: $("#sRecipe").value,
      qty: ($("#sQty").value||"").trim(),
      createdAt: nowISO(),
    };
    if(!entry.qty){ $("#sMsg").innerHTML = `<span class="danger">Qty fehlt.</span>`; return; }

    const s2 = readJSON(LS.sales, []);
    s2.push(entry);
    writeJSON(LS.sales, s2);
    $("#sMsg").innerHTML = `<span class="ok">Gespeichert.</span>`;
    renderSales();
  };
}

// ---------- Users (Admin) ----------
function renderUsers(session){
  const content = $("#content");
  if(!isAdmin(session)){
    content.innerHTML = `<div class="card"><div class="h1">Kein Zugriff</div></div>`;
    return;
  }

  const users = readJSON(LS.users, []);
  content.innerHTML = `
    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">User anlegen</div>
        <div class="small">User gelten für den Workspace und werden synchronisiert.</div>

        <div class="label">Username (ohne Leerzeichen)</div>
        <input class="input" id="uName" placeholder="z.B. max" />

        <div class="label">Display Name</div>
        <input class="input" id="uDisp" placeholder="z.B. Max Mustermann" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnAddUser">User speichern</button>
        </div>
        <div class="small" id="uMsg" style="margin-top:8px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">User-Liste</div>
        <div class="hr"></div>
        <div style="overflow:auto;border-radius:12px;border:1px solid var(--border)">
          <table class="table">
            <thead><tr><th>Username</th><th>Display</th><th class="right">Aktion</th></tr></thead>
            <tbody>
              ${users.map(u=>`
                <tr>
                  <td>${escapeHtml(u.username)}</td>
                  <td>${escapeHtml(u.displayName||u.username)}</td>
                  <td class="right">
                    ${String(u.username).toLowerCase()==="admin"
                      ? `<span class="small">Admin fix</span>`
                      : `<button class="btn danger" data-del="${escapeHtml(u.username)}">Löschen</button>`
                    }
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  $("#btnAddUser").onclick = ()=>{
    const msg = $("#uMsg");
    msg.textContent = "";

    const username = ($("#uName").value||"").trim();
    const displayName = ($("#uDisp").value||"").trim();

    if(!username){ msg.innerHTML = `<span class="danger">Username fehlt.</span>`; return; }
    if(/\s/.test(username)){ msg.innerHTML = `<span class="danger">Username ohne Leerzeichen.</span>`; return; }

    const users2 = readJSON(LS.users, []);
    const exists = users2.some(u => String(u.username).toLowerCase() === username.toLowerCase());
    if(exists){ msg.innerHTML = `<span class="danger">Username existiert schon.</span>`; return; }

    users2.push({ username, displayName: displayName || username });
    writeJSON(LS.users, users2);
    renderUsers(session);
  };

  document.querySelectorAll("[data-del]").forEach(btn=>{
    btn.onclick = ()=>{
      const uname = btn.getAttribute("data-del");
      const users2 = readJSON(LS.users, []);
      const next = users2.filter(u => String(u.username).toLowerCase() !== String(uname).toLowerCase());
      writeJSON(LS.users, next);
      renderUsers(session);
    };
  });
}

// boot
seedDataIfEmpty();
render();
