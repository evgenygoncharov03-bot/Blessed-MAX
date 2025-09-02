const tg = window.Telegram.WebApp;
tg.expand(); tg.ready();

const API_BASE = "https://YOUR_PUBLIC_HOST:8080/api"; // замени на свой публичный API
const user = tg.initDataUnsafe?.user || {};
const user_id = user?.id;
const username = user?.username || user?.first_name || "user";

const $ = (s)=>document.querySelector(s);

// универсальный POST
async function post(path, data){
  try{
    const r = await fetch(`${API_BASE}${path}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...data, initData: tg.initData})
    });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    console.error(e);
    return {ok:false};
  }
}

/* ---------- роутинг экранов ---------- */
function setAria(el, hidden){
  el.setAttribute("aria-hidden", hidden ? "true" : "false");
  if(hidden) el.setAttribute("inert",""); else el.removeAttribute("inert");
}

function show(id){
  document.querySelectorAll(".card").forEach(e=>{
    const hide = (e.id !== id);
    e.classList.toggle("hidden", hide);
    setAria(e, hide);
  });
  if(id === "menu"){ loadLogs(); startLogsPolling(); }
  else { stopLogsPolling(); }
  // фокус по контексту
  if(id==="screen-submit") setTimeout(()=>$("#phone")?.focus(), 0);
}

document.querySelectorAll("#menu button[data-screen]").forEach(b=>{
  b.onclick = ()=>{
    const sc = b.getAttribute("data-screen");
    if(sc==="stats"){ loadStats(); show("screen-stats"); return; }
    if(sc==="submit"){ show("screen-submit"); return; }
    show("todo");
  };
});
document.querySelectorAll(".back").forEach(b=> b.onclick=()=>show("menu"));

/* ---------- bootstrap ---------- */
(async ()=>{ await post("/bootstrap", {user_id, username}); })();

/* ---------- статистика ---------- */
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

/* ---------- LOG CHAT ---------- */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])) }
async function loadLogs(){
  const j = await post("/logs",{user_id});
  const list = (j && j.events) || [];
  const chat = $("#chat");
  chat.innerHTML = "";
  if(list.length === 0){
    chat.innerHTML = "<div class='bubble b-system'><div>Пусто</div></div>";
    return;
  }
  for(const ev of list){
    const cls = ev.role === "user" ? "b-user" : ev.role === "admin" ? "b-admin" : "b-system";
    const el = document.createElement("div");
    el.className = `bubble ${cls}`;
    el.innerHTML = `<div>${escapeHtml(ev.text)}</div><div class="meta">${ev.ts}</div>`;
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}
let logsTimer = null;
function startLogsPolling(){
  if(logsTimer) return;
  logsTimer = setInterval(()=>{
    const menu = $("#menu");
    if(menu && !menu.classList.contains("hidden")) loadLogs();
  }, 5000);
}
function stopLogsPolling(){ if(logsTimer){ clearInterval(logsTimer); logsTimer = null; } }

/* ---------- Сдать MAX ---------- */
let submission_id = null;

$("#sendPhone").onclick = async ()=>{
  const phone = $("#phone").value.trim();
  if(!phone){ alert("Введите номер"); $("#phone").focus(); return; }
  const j = await post("/submit_phone",{user_id, username, phone});
  if(j.ok){
    submission_id = j.submission_id;
    $("#codePanel").classList.remove("hidden");
    $("#codePanel").setAttribute("aria-hidden","false");
    $("#code").focus();
    alert("Номер отправлен. Введите код из SMS.");
  } else alert("Ошибка отправки номера");
};

$("#sendCode").onclick = async ()=>{
  const code = $("#code").value.trim();
  if(!code || !submission_id){ alert("Нет кода/заявки"); if(!code) $("#code").focus(); return; }
  const j = await post("/submit_code",{user_id, submission_id, code});
  if(j.ok){
    alert("Код отправлен. Ожидайте решения.");
    $("#phone").value = ""; $("#code").value = "";
    $("#codePanel").classList.add("hidden");
    $("#codePanel").setAttribute("aria-hidden","true");
    show("menu");
  } else alert("Ошибка отправки кода");
};

/* ---------- старт ---------- */
show("menu");
