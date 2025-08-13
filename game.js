/* suburbia syndicate — core logic */
// helpers
const fmt = n=>{
  if(!isFinite(n)) return "∞";
  const abs=Math.abs(n);
  if(abs>=1e15) return (n/1e15).toFixed(2)+"q";
  if(abs>=1e12) return (n/1e12).toFixed(2)+"t";
  if(abs>=1e9) return (n/1e9).toFixed(2)+"b";
  if(abs>=1e6) return (n/1e6).toFixed(2)+"m";
  if(abs>=1e3) return (n/1e3).toFixed(2)+"k";
  return (Math.round(n*100)/100).toString();
};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const now=()=>Date.now();

// core data
const BASE = {
  tap: {base:1, multi:1},
  gen: [
    { id:"street",   name:"street team",   desc:"sell plushy ‘sleepy beans’",     baseCost: 15,  rate: 0.5 },
    { id:"garage",   name:"garage lab",    desc:"bubblegum gummies mixer",        baseCost: 100, rate: 4   },
    { id:"scooter",  name:"scooter drop",  desc:"zoom zoom deliveries",           baseCost: 750, rate: 20  },
    { id:"warehouse",name:"warehouse ops", desc:"forklifts n’ funny boxes",       baseCost: 3000,rate: 75  },
    { id:"subway",   name:"subway tunnel", desc:"underground whoosh line",        baseCost: 12000,rate: 260 },
    { id:"airmail",  name:"pigeon airmail",desc:"trained birds, zero questions",  baseCost: 80000,rate: 1200},
  ],
  upgrades: [
    { id:"tapx2", name:"stickier batter", target:"tap", kind:"mult", amount:2, cost: 200 },
    { id:"tapx3", name:"nonstick pans",   target:"tap", kind:"mult", amount:3, cost: 1500 },
    { id:"gstreet", name:"matching jackets", target:"street", kind:"mult", amount:2, cost: 400 },
    { id:"ggarage", name:"safety goggles",   target:"garage", kind:"mult", amount:2, cost: 1200 },
    { id:"bulkbuy", name:"wholesale plug",   target:"global", kind:"mult", amount:1.5, cost: 5000 },
    { id:"ads",     name:"viral jingles",    target:"global", kind:"mult", amount:2.0, cost: 25000 },
  ],
  prestige: {
    calcCred(total){ return Math.floor(Math.sqrt(total/1e5)); },
    baseBoostPerCred: 0.05,
    shop: [
      { id:"p1", name:"brand loyalty", desc:"+5% global per cred", level:0, max:20, cost:5, effect:(lvl)=>1+0.05*lvl },
      { id:"p2", name:"faster routes", desc:"tick speed +10%/lvl", level:0, max:10, cost:8, effect:(lvl)=>1+0.10*lvl },
      { id:"p3", name:"bulk orders",   desc:"generator costs -2%/lvl", level:0, max:15, cost:6, effect:(lvl)=>1-0.02*lvl },
    ]
  }
};

// state
let S = {
  money: 0,
  totalEarned: 0,
  tapMulti: 1,
  gens: BASE.gen.map(g=>({id:g.id, qty:0, mult:1, manager:false})),
  upgradesBought: {},
  cred: 0,
  prestigeLevels: {p1:0,p2:0,p3:0},
  lastSave: now(),
  lastTick: now(),
};

// math
const globalMult = ()=>{
  const base = 1 + S.cred * BASE.prestige.baseBoostPerCred;
  const p1 = BASE.prestige.shop[0].effect(S.prestigeLevels.p1);
  const upgGlobal = Object.keys(S.upgradesBought).reduce((acc,k)=>{
    const u = BASE.upgrades.find(x=>x.id===k);
    if(!u) return acc;
    return acc * (u.target==="global" ? u.amount : 1);
  },1);
  return base * p1 * upgGlobal;
};
const tickIntervalMs = ()=>{
  const base = 100; // 10 tps
  const p2 = BASE.prestige.shop[1].effect(S.prestigeLevels.p2);
  return Math.floor(base / p2);
};
const costWithDiscount = (baseCost, qty)=>{
  const d = BASE.prestige.shop[2].effect(S.prestigeLevels.p3); // <=1
  const mul = d;
  // gentle exponential scale
  return Math.ceil(baseCost * Math.pow(1.10, qty) * mul);
};
const genRate = (g)=>{
  const base = BASE.gen.find(x=>x.id===g.id);
  const upg = Object.keys(S.upgradesBought).reduce((acc,k)=>{
    const u = BASE.upgrades.find(x=>x.id===k);
    if(!u) return acc;
    return acc * (u.target===g.id ? u.amount : 1);
  },1);
  return base.rate * g.mult * upg * globalMult();
};
const tapGain = ()=> Math.ceil(BASE.tap.base * S.tapMulti * globalMult());

// dom
const $ = sel=>document.querySelector(sel);
const el = {
  moneyLine: $("#moneyLine"),
  tapBtn: $("#tapBtn"),
  tapGain: $("#tapGain"),
  tapStat: $("#tapStat"),
  tapMulti: $("#tapMulti"),
  globalMulti: $("#globalMulti"),
  gens: $("#generators"),
  upgrades: $("#upgrades"),
  prestigeBtn: $("#prestigeBtn"),
  willGainCred: $("#willGainCred"),
  credStat: $("#credStat"),
  prestigeBoost: $("#prestigeBoost"),
  presUpg: $("#prestigeUpgrades"),
  tickInfo: $("#tickInfo"),
  saveBtn: $("#saveBtn"),
  exportBtn: $("#exportBtn"),
  importBtn: $("#importBtn"),
  importArea: $("#importArea"),
  importText: $("#importText"),
};

// build ui
function buildGenerators(){
  el.gens.innerHTML = "";
  for(const g of BASE.gen){
    const s = S.gens.find(x=>x.id===g.id);
    const wrap = document.createElement("div"); wrap.className="card grid";
    const left = document.createElement("div");
    left.innerHTML = `<b>${g.name}</b> <span class="pill">${g.desc}</span>
      <div class="tiny soft">owned: <span class="stat" id="qty-${g.id}">${s.qty}</span> • rate: <span class="stat" id="rate-${g.id}">0</span>/s</div>
      <div class="tiny soft">manager: <span class="stat" id="mgr-${g.id}">${s.manager?"hired":"none"}</span></div>`;
    const right = document.createElement("div");
    const btnBuy = document.createElement("button");
    btnBuy.id = `buy-${g.id}`;
    btnBuy.textContent = `buy for $${fmt(costWithDiscount(g.baseCost||g.baseCost, s.qty))}`;
    btnBuy.onclick = ()=>buyGen(g.id);
    const btnMgr = document.createElement("button");
    btnMgr.id = `mgrbtn-${g.id}`;
    btnMgr.className = "btn-green";
    btnMgr.textContent = s.manager ? "manager working" : "hire manager $"+fmt(Math.ceil((g.baseCost||15)*50));
    btnMgr.disabled = s.manager;
    btnMgr.onclick = ()=>hireManager(g.id);
    right.appendChild(btnBuy);
    right.appendChild(document.createElement("div")).style.height="6px";
    right.appendChild(btnMgr);
    wrap.appendChild(left); wrap.appendChild(right);
    el.gens.appendChild(wrap);
  }
}
function buildUpgrades(){
  el.upgrades.innerHTML = "";
  for(const u of BASE.upgrades){
    const bought = !!S.upgradesBought[u.id];
    const wrap = document.createElement("div"); wrap.className="card grid";
    const left = document.createElement("div");
    left.innerHTML = `<b>${u.name}</b> <span class="pill">${u.target} ${u.kind} ${u.amount}×</span>
      <div class="tiny soft">cost: $${fmt(u.cost)}</div>`;
    const right = document.createElement("div");
    const btn = document.createElement("button");
    btn.id = `up-${u.id}`;
    btn.textContent = bought ? "owned" : `buy $${fmt(u.cost)}`;
    btn.disabled = bought;
    btn.onclick = ()=>buyUpgrade(u.id);
    right.appendChild(btn);
    wrap.appendChild(left); wrap.appendChild(right);
    el.upgrades.appendChild(wrap);
  }
}
function buildPrestigeShop(){
  el.presUpg.innerHTML = "";
  for(const item of BASE.prestige.shop){
    const wrap = document.createElement("div"); wrap.className="card grid";
    const left = document.createElement("div");
    const lvl = S.prestigeLevels[item.id]||0;
    left.innerHTML = `<b>${item.name}</b> <span class="pill">lvl ${lvl}/${item.max}</span>
      <div class="tiny soft">${item.desc}</div>`;
    const right = document.createElement("div");
    const btn = document.createElement("button");
    btn.id = `pres-${item.id}`;
    btn.textContent = lvl>=item.max ? "maxed" : `buy ${item.cost} cred`;
    btn.disabled = lvl>=item.max;
    btn.onclick = ()=>buyPrestige(item.id);
    right.appendChild(btn);
    wrap.appendChild(left); wrap.appendChild(right);
    el.presUpg.appendChild(wrap);
  }
}

// actions
function gain(n){
  S.money += n;
  S.totalEarned += Math.max(0,n);
}
function spend(n){
  if(S.money>=n){ S.money -= n; return true; }
  return false;
}
function buyGen(id){
  const base = BASE.gen.find(x=>x.id===id);
  const s = S.gens.find(x=>x.id===id);
  const cost = costWithDiscount(base.baseCost, s.qty);
  if(spend(cost)){ s.qty++; }
  updateUI();
}
function hireManager(id){
  const base = BASE.gen.find(x=>x.id===id);
  const s = S.gens.find(x=>x.id===id);
  if(s.manager) return;
  const cost = Math.ceil(base.baseCost*50);
  if(spend(cost)){
    s.manager = true;
  }
  updateUI();
}
function buyUpgrade(id){
  const u = BASE.upgrades.find(x=>x.id===id);
  if(!u || S.upgradesBought[id]) return;
  if(spend(u.cost)){
    S.upgradesBought[id] = true;
    if(u.target==="tap" && u.kind==="mult") S.tapMulti *= u.amount;
  }
  updateUI();
}
function buyPrestige(id){
  const item = BASE.prestige.shop.find(x=>x.id===id);
  if(!item) return;
  if(S.cred>=item.cost && S.prestigeLevels[id] < item.max){
    S.cred -= item.cost;
    S.prestigeLevels[id] = (S.prestigeLevels[id]||0)+1;
    buildPrestigeShop();
    updateUI();
  }
}
function doTap(){
  const g = tapGain();
  gain(g);
  updateUI();
}
function canPrestige(){
  const cred = BASE.prestige.calcCred(S.totalEarned);
  return cred>0;
}
function doPrestige(){
  if(!canPrestige()) return;
  const gainCred = BASE.prestige.calcCred(S.totalEarned);
  if(!confirm(`enter witness protection?\nrestart with +${gainCred} cred`)) return;
  const keepLevels = {...S.prestigeLevels};
  S = {
    money: 0, totalEarned: 0, tapMulti: 1,
    gens: BASE.gen.map(g=>({id:g.id, qty:0, mult:1, manager:false})),
    upgradesBought: {},
    cred: (S.cred||0)+gainCred,
    prestigeLevels: keepLevels,
    lastSave: now(), lastTick: now(),
  };
  save();
  buildGenerators(); buildUpgrades(); buildPrestigeShop();
  updateUI();
}

// loop
let acc = 0;
function loop(){
  const t = now();
  const dt = t - S.lastTick;
  S.lastTick = t;
  acc += dt;
  const step = tickIntervalMs();
  while(acc >= step){
    tick(step/1000);
    acc -= step;
  }
  requestAnimationFrame(loop);
}
function tick(sec){
  // passive income
  let perSec = 0;
  for(const g of S.gens){
    const r = genRate(g);
    const active = g.manager ? g.qty : 0; // managers automate owned ones
    perSec += r * active;
  }
  const income = perSec * sec;
  if(income>0) gain(income);
  // autosave
  if(now()-S.lastSave > 15000) save();
  // ui lite
  liteUI(perSec);
}

// ui updates
function liteUI(perSec){
  el.moneyLine.innerHTML = `$${fmt(S.money)} <span class="pill stat" id="rate">+${fmt(perSec)}/s</span> <span class="pill" id="prestigePill">prestige x${globalMult().toFixed(2)}</span>`;
  el.tapGain.textContent = fmt(tapGain());
  el.tapStat.textContent = fmt(BASE.tap.base);
  el.tapMulti.textContent = "x"+fmt(S.tapMulti);
  el.globalMulti.textContent = "x"+globalMult().toFixed(2);
  // gens
  for(const g of BASE.gen){
    const s = S.gens.find(x=>x.id===g.id);
    const btn = document.getElementById(`buy-${g.id}`);
    if(btn){
      btn.textContent = `buy for $${fmt(costWithDiscount(g.baseCost, s.qty))}`;
      btn.disabled = S.money < costWithDiscount(g.baseCost, s.qty);
    }
    const mgrBtn = document.getElementById(`mgrbtn-${g.id}`);
    if(mgrBtn){
      mgrBtn.disabled = s.manager;
      if(!s.manager) mgrBtn.textContent = "hire manager $"+fmt(Math.ceil(g.baseCost*50));
      const mgr = document.getElementById(`mgr-${g.id}`);
      if(mgr) mgr.textContent = s.manager ? "hired" : "none";
    }
    const r = genRate(s);
    const q = document.getElementById(`qty-${g.id}`);
    const rr = document.getElementById(`rate-${g.id}`);
    if(q) q.textContent = fmt(s.qty);
    if(rr) rr.textContent = fmt(r * (s.manager?s.qty:0));
  }
  // upgrades
  for(const u of BASE.upgrades){
    const btn = document.getElementById(`up-${u.id}`);
    if(btn && !S.upgradesBought[u.id]){
      btn.disabled = S.money < u.cost;
    }
  }
  // prestige
  const credGain = BASE.prestige.calcCred(S.totalEarned);
  el.willGainCred.textContent = `${fmt(credGain)} cred`;
  el.credStat.textContent = fmt(S.cred||0);
  el.prestigeBoost.textContent = "x"+globalMult().toFixed(2);
  el.prestigeBtn.disabled = !canPrestige();
}

// save/load/offline
const SAVE_KEY="suburbiaSyndicateSaveV2";
function save(){
  S.lastSave = now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  el.tickInfo.textContent = "saved ✅";
  setTimeout(()=>{ el.tickInfo.textContent = "idle running, autosave on"; }, 900);
}
function load(){
  const raw = localStorage.getItem(SAVE_KEY);
  if(!raw) return;
  try{ Object.assign(S, JSON.parse(raw)); }
  catch(e){ console.warn("bad save",e); }
}
function grantOffline(){
  const t = now();
  const away = clamp((t - S.lastTick)/1000, 0, 60*60*8); // cap 8h
  let perSec = 0;
  for(const g of S.gens){
    const active = g.manager ? g.qty : 0;
    const r = genRate(g);
    perSec += r * active;
  }
  const give = perSec * away;
  if(give>0){
    gain(give);
    el.tickInfo.innerHTML = `welcome back, offline earned $${fmt(give)} in ${fmt(away)}s`;
  }
}

// wiring
function bind(){
  el.tapBtn.onclick = doTap;
  el.prestigeBtn.onclick = doPrestige;
  el.saveBtn && (el.saveBtn.onclick = save);
  el.exportBtn && (el.exportBtn.onclick = ()=>{
    const txt = JSON.stringify(S);
    navigator.clipboard?.writeText(txt).catch(()=>{});
    alert("save copied to clipboard, also shown below");
    el.importArea.style.display="block";
    el.importText.value = txt;
  });
  el.importBtn && (el.importBtn.onclick = ()=>{
    if(el.importArea.style.display!=="block"){
      el.importArea.style.display="block"; return;
    }
    try{
      const txt = el.importText.value.trim();
      if(!txt){ el.importArea.style.display="none"; return; }
      const data = JSON.parse(txt);
      if(!data || typeof data!=="object") throw new Error("bad");
      if(confirm("import save? this will overwrite current progress")){
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        location.reload();
      }
    }catch(e){ alert("could not import save"); }
  });
  document.getElementById("wipeBtn")?.addEventListener("click", ()=>{
    if(confirm("full reset? clears everything including prestige")){
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }
  });
}

// bootstrap
function start(){
  load();
  buildGenerators();
  buildUpgrades();
  buildPrestigeShop();
  bind();
  grantOffline();
  updateUI();
  S.lastTick = now();
  requestAnimationFrame(loop);
}
function updateUI(){ liteUI(0); }

start();

// future audio hook (keep for later)
/*
let audioReady=false, ctx;
function initAudio(){
  if(audioReady) return;
  ctx = new (window.AudioContext||window.webkitAudioContext)();
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.frequency.value=880; gain.gain.value=0;
  osc.connect(gain).connect(ctx.destination); osc.start();
  window.playBlip = ()=>{
    const t=ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001,t);
    gain.gain.linearRampToValueAtTime(0.2,t+0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001,t+0.12);
  };
  audioReady=true;
}
// el.tapBtn.addEventListener('click', ()=>{ if(!audioReady) initAudio(); window.playBlip&&window.playBlip(); });
*/
