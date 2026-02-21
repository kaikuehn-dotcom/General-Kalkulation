// Heisse Ecke MVP – GitHub Pages ready (pure HTML/JS)
// Features:
// - Responsive (Desktop/Tablet/iPhone Browser)
// - Dark/Light toggle (saved)
// - Login via username (Admin can manage users in-app)
// - Local autosave for inventory/recipes/params/sales/users
// - Core calculations: unit price, recipe line cost, dish DB and daily DB

const LS = {
  theme: "he_theme",
  session: "he_session",
  ui: "he_ui",
  users: "he_users",               // local users managed by admin
  inventory: "he_inventory",
  recipes: "he_recipes",
  params: "he_params",
  sales: "he_sales",
  lastSaved: "he_last_saved",
};

function $(sel){ return document.querySelector(sel); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function nowISO(){ return new Date().toISOString(); }
function fmtTime(ts){
  try{
    const d = new Date(ts);
    return d.toLocaleString();
  }catch{ return ""; }
}

function readJSON(key, fallback){
  try{
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  }catch{
    return fallback;
  }
}
function writeJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
  localStorage.setItem(LS.lastSaved, nowISO());
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

async function loadUsersFromJson(){
  const res = await fetch("./data/users.json", { cache: "no-store" });
  if(!res.ok) return [];
  const data = await res.json();
  return data.users || [];
}
async function getUsers(){
  // local overrides json (admin-managed users live in localStorage)
  const local = readJSON(LS.users, null);
  if(Array.isArray(local) && local.length) return local;
  const fromJson = await loadUsersFromJson();
  return fromJson;
}
async function ensureLocalUsersSeeded(){
  const local = readJSON(LS.users, null);
  if(Array.isArray(local) && local.length) return;
  const fromJson = await loadUsersFromJson();
  if(fromJson.length){
    writeJSON(LS.users, fromJson);
  }else{
    writeJSON(LS.users, [{ username:"admin", displayName:"Admin" }]);
  }
}

function seedDataIfEmpty(){
  if(!Array.isArray(readJSON(LS.inventory, null))) writeJSON(LS.inventory, []);
  if(!Array.isArray(readJSON(LS.recipes, null))) writeJSON(LS.recipes, []);
  if(!readJSON(LS.params, null)){
    writeJSON(LS.params, { franchisePct: 0, vatPct: 7, fixedCostsMonthly: 0, variableCostsPct: 0 });
  }
  if(!Array.isArray(readJSON(LS.sales, null))) writeJSON(LS.sales, []);
  if(!readJSON(LS.ui, null)) writeJSON(LS.ui, { tab: "dashboard" });
}

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
  return packPrice / packSize; // €/g or €/ml
}

function recipeLineCost(line, inventoryById){
  const inv = inventoryById[line.inventoryId];
  if(!inv) return 0;
  const qty = toNumber(line.qty);
  const unitPrice = calcUnitPrice(inv);
  return qty * unitPrice;
}

// ---------- Views ----------
function loginView(){
  return `
  <div class="container">
    <div class="header">
      <h1 class="h1">Heisse Ecke – Kalkulation</h1>
      <button class="btn" id="btnTheme">Hell/Dunkel</button>
    </div>

    <div class="grid">
      <div class="card col-12 col-6">
        <div class="h1">Login</div>
        <div class="small">
          Gib deinen <b>Benutzernamen</b> ein. Der Admin kann User in der App verwalten.
          <br/>Hinweis: Wenn du das erste Mal startest, seedet die App die User aus <code>data/users.json</code>.
        </div>

        <div class="label">Benutzername</div>
        <input class="input" id="username" placeholder="z.B. kai" autocomplete="username" />

        <div class="row" style="margin-top:12px">
          <button class="btn primary" id="btnLogin">Weiter</button>
        </div>

        <div class="small" id="loginMsg" style="margin-top:10px"></div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">MVP kann</div>
        <div class="small">
          <ul>
            <li>Inventur-Artikel anlegen (Packgröße + Packpreis + Einheit) → €/g/ml/stk</li>
            <li>Rezepte anlegen (Zutaten aus Inventur wählen)</li>
            <li>Wareneinsatz + DB je Gericht</li>
            <li>Parameter (Franchise %, MwSt, Fixkosten …)</li>
            <li>Daily Sales → Tages-DB</li>
          </ul>
        </div>
        <div class="small">Alles wird automatisch gespeichert (Browser). Letzter Save wird oben angezeigt.</div>
      </div>
    </div>
  </div>`;
}

function appShell(session, activeTab){
  const tabBtn = (id, label, show=true) =>
    show ? `<button class="tab ${activeTab===id?"active":""}" data-tab="${id}">${label}</button>` : "";

  const lastSaved = localStorage.getItem(LS.lastSaved);

  return `
  <div class="container">
    <div class="header">
      <div>
        <h1 class="h1">Heisse Ecke – Kalkulation</h1>
        <div class="badge">
          Angemeldet als: <b>${escapeHtml(session.displayName)}</b> (@${escapeHtml(session.username)})
          ${isAdmin(session) ? ` · <span class="ok">Admin</span>` : ""}
          <br/>Letzte Speicherung: <b>${escapeHtml(lastSaved ? fmtTime(lastSaved) : "—")}</b>
        </div>
      </div>
      <div class="row">
        <button class="btn" id="btnTheme">Hell/Dunkel</button>
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

  $("#btnLogin").onclick = async () => {
    const u = ($("#username").value || "").trim();
    const msg = $("#loginMsg");
    msg.textContent = "";

    if(!u){ msg.innerHTML = `<span class="danger">Bitte Username eingeben.</span>`; return; }

    await ensureLocalUsersSeeded();
    const users = await getUsers();
    const hit = users.find(x => (x.username || "").toLowerCase() === u.toLowerCase());
    if(!hit){
      msg.innerHTML = `<span class="danger">Unbekannter Username.</span> Bitte Admin fragen (User-Tab).`;
      return;
    }
    setSession({ username: hit.username, displayName: hit.displayName || hit.username, loginAt: nowISO() });
    render();
  };
}

function bindShell(session){
  $("#btnTheme").onclick = toggleTheme;
  $("#btnLogout").onclick = () => { clearSession(); render(); };

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick = () => {
      const tab = btn.getAttribute("data-tab");
      // prevent non-admin from opening admin tab via UI
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
          DB heute (berechnet): <b class="${todaysDB>=0?"ok":"danger"}">${todaysDB.toFixed(2)} €</b>
        </div>
      </div>

      <div class="card col-12 col-6">
        <div class="h1">Quick-Checks</div>
        <div class="hr"></div>
        <div class="small">
          ✅ Komma ist erlaubt (12,50).<br/>
          ✅ Alles speichert automatisch im Browser.<br/>
          ✅ Tablet/iPhone: funktioniert im Browser, Buttons sind touch-friendly.<br/>
          ⚠️ Wenn du in einem neuen Browser/Inkognito öffnest, sind LocalStorage-Daten nicht da.
        </div>
      </div>

      <div class="card col-12">
        <div class="h1">Gerichte Übersicht</div>
        <div class="hr"></div>
        <div class="table-wrap">
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
        <div class="small">
          Einheit bitte als Basis: <b>g</b>, <b>ml</b> oder <b>stk</b>.
          Packgröße ist z.B. 1000 (g) oder 250 (stk).
        </div>

        <div class="label">Warengruppe/Kategorie</div>
        <input class="input" id="invCat" placeholder="z.B. Fleisch, Saucen, Verpackung" />

        <div class="label">Artikelname</div>
        <input class="input" id="invName" placeholder="z.B. Currywurst gelb" />

        <div class="label">Lieferant</div>
        <input class="input" id="invSupplier" placeholder="z.B. Metro" />

        <div class="row">
          <div style="flex:1;min-width:180px">
            <div class="label">Packgröße (Number)</div>
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
        <div class="table-wrap">
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
        <div class="small" style="margin-top:10px">Bearbeiten kommt als nächstes (MVP-Plus). Aktuell: hinzufügen + rechnen.</div>
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
        <div class="small">Du kannst nur Inventur-Artikel verwenden, die existieren.</div>

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
        <div class="table-wrap">
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
        <div class="small">Wähle Rezept + Inventur-Artikel, gib Menge ein (in g/ml/stk).</div>

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
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Zutat</th><th>Einheit</th>
              <th class="right">Menge</th><th class="right">€/Einheit</th><th class="right">Kosten</th>
            </tr>
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
        <div class="small">Franchise % wird im Dashboard vom Umsatz abgezogen.</div>

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

      <div class="card col-12 col-6">
        <div class="h1">Hinweis</div>
        <div class="small">
          Nächster Schritt (wenn du willst): Break-even Preis + Fixkosten-Deckung pro Tag/Monat.
        </div>
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
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Datum</th><th>Gericht</th><th class="right">Qty</th></tr></thead>
            <tbody>
              ${sales.filter(s=>s.date===today).map(s=>`
                <tr>
                  <td>${escapeHtml(s.date)}</td>
                  <td>${escapeHtml(s.recipeName)}</td>
                  <td class="right">${toNumber(s.qty).toString()}</td>
                </tr>
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
        <div class="small">User werden lokal gespeichert (Browser). Admin ist Username <b>admin</b>.</div>

        <div class="label">Username (einfach, ohne Leerzeichen)</div>
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
        <div class="table-wrap">
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

        <div class="hr"></div>
        <div class="small">
          Tipp: Wenn du die App in einem anderen Browser/Device öffnest, sind Local-Users nicht da.
          Dann entweder neu anlegen oder später Backend anbinden.
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
render();
