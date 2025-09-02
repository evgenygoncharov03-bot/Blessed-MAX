const tg = window.Telegram.WebApp;
tg.expand(); tg.ready();

const API_BASE = "https://YOUR_PUBLIC_HOST:8080/api"; // замени на публичный адрес, где крутится bot.py (ngrok/сервер)
const user = tg.initDataUnsafe?.user || {};
const user_id = user.id;
const username = user.username || user.first_name || "user";

const $ = (s)=>document.querySelector(s);
const show = (id)=>document.querySelectorAll(".card").forEach(e=>e.classList.toggle("hidden", e.id!==id));

async function post(path, data){
  const r = await fetch(`${API_BASE}${path}`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({...data, initData: tg.initData})
  });
  return r.json();
}

// bootstrap
(async ()=>{
  await post("/bootstrap", {user_id, username});
})();

// menu nav
document.querySelectorAll("#menu button[data-screen]").forEach(b=>{
  b.onclick = ()=>{
    const sc = b.getAttribute("data-screen");
    if(sc==="stats"){ loadStats(); show("screen-stats"); return; }
    if(sc==="submit"){ show("screen-submit"); return; }
    if(sc==="logs"){ loadLogs(); show("screen-logs"); return; }
    // заглушки
    show("todo");
  };
});
document.querySelectorAll(".back").forEach(b=> b.onclick=()=>show("menu"));

async function loadStats(){
  const j = await post("/stats",{user_id});
  const s = j.stats || {};
  $("#statsBox").textContent =
`Пользователь: ${s.username || username}
ID: ${user_id}
Регистрация: ${s.first_seen || "—"}
Успешных номеров: ${s.success_count ?? 0}
Неуспешных номеров: ${s.fail_count ?? 0}
Всего заработано: ${s.earned ?? 0}
Баланс: ${s.balance ?? 0}`;
}

async function loadLogs(){
  const j = await post("/logs",{user_id});
  $("#logsBox").textContent = (j.logs||[]).map(x=>`${x.ts} • ${x.action} • ${x.payload||""}`).join("\n") || "Пусто";
}

// submit flow
let submission_id = null;
$("#sendPhone").onclick = async ()=>{
  const phone = $("#phone").value.trim();
  if(!phone){ alert("Введите номер"); return; }
  const j = await post("/submit_phone",{user_id, username, phone});
  if(j.ok){
    submission_id = j.submission_id;
    $("#codePanel").classList.remove("hidden");
    alert("Номер отправлен. Введите код из SMS.");
  } else alert("Ошибка");
};
$("#sendCode").onclick = async ()=>{
  const code = $("#code").value.trim();
  if(!code || !submission_id){ alert("Нет кода/заявки"); return; }
  const j = await post("/submit_code",{user_id, submission_id, code});
  if(j.ok){
    alert("Код отправлен. Ожидайте решения.");
    show("menu");
  } else alert("Ошибка");
};
