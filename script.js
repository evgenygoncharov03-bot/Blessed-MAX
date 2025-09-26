/* Blessed MAX — script.js (R21, clean)
   Telegram WebApp client for index.html.
   Works with aiohttp API from bot.py.
   Sections: [КОММУНИКАЦИЯ], [НАВИГАЦИЯ], [СТАТИСТИКА], [ЛОГИ],
             [СДАТЬ MAX], [ОТЧЁТ], [ПРИВИЛЕГИИ+ROI], [АДМИН],
             [РУЛЕТКА], [ВЫВОД], [КОНКУРСЫ], [УТИЛИТЫ], [СТАРТ].
*/

/* ==================== КОММУНИКАЦИЯ (Config, State, HTTP) ==================== */
const tg = window.Telegram?.WebApp || null;
if (tg && typeof tg.expand === "function") tg.expand();

const qp = new URLSearchParams(location.search);

function normApiBase(raw){
  if (!raw) return "";
  const clean = String(raw).trim().split(/\s+/)[0]; // обрезать всё после первого пробела
  try { return new URL(clean).origin; } catch { return clean.replace(/\/+$/, ""); }
}

// Default API. Override with ?api= or window.API_BASE
const API_BASE = normApiBase(qp.get("api") || window.API_BASE || "https://flexibly-inspiring-petrel.cloudpub.ru/");
console.log("API_BASE =", API_BASE);

// Global state
const S = {
  lastSubmissionId: null,
  stats: null,
  prices: { premium: 40.0, speed: 30.0 },
  phoneLocked: false,
  phoneValue: "",
  priv: { rate: 0.18, plan: null },
  is_admin: false,
};

const initData = tg?.initData || qp.get("initData") || "";
const authUser = tg?.initDataUnsafe?.user || null;
const USER = {
  id: authUser?.id || Number(qp.get("user_id")) || 0,
  username: authUser?.username || authUser?.first_name || qp.get("username") || "user",
};

// Feature flags
const F = { debug: !!qp.get("debug") };

/* ---- DOM helpers ---- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const FOCUS_SEL = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
function firstFocusable(root){ return root?.querySelector(FOCUS_SEL) || null; }

function show(node){
  if(!node) return;
  node.classList.remove("hidden");
  node.setAttribute("aria-hidden","false");
  node.removeAttribute("inert");
  // безопасный перевод фокуса в видимую область
  const to = firstFocusable(node) || node;
  if (!to.hasAttribute("tabindex")) node.setAttribute("tabindex","-1");
  to.focus?.();
}

function hide(node){
  if(!node) return;
  const hadFocusInside = node.contains(document.activeElement);
  node.classList.add("hidden");
  node.setAttribute("aria-hidden","true");
  node.setAttribute("inert",""); // блокирует фокус и интеракции
  if (hadFocusInside) document.activeElement?.blur?.();
}
function setText(node, text){ if(node) node.textContent = String(text ?? ""); }
function html(node, markup){ if(node) node.innerHTML = markup; }

/* ---- Notifications / Modal ---- */
const notifRoot = $("#notify-root");
function toast(title, msg = "", opts = {}){
  const el = document.createElement("div");
  el.className = "notif";
  el.innerHTML = `
    <div class="title">${escapeHtml(title)}</div>
    <div class="msg">${escapeHtml(msg)}</div>
    <button class="x" aria-label="Закрыть">×</button>`;
  notifRoot.appendChild(el);
  const t = setTimeout(() => close(), opts.timeout ?? 3500);
  function close(){ clearTimeout(t); el.remove(); }
  el.querySelector(".x").onclick = close;
  return { close };
}

const modalWrap = $("#notify-modal");
$("#notify-close")?.addEventListener("click", () => hide(modalWrap));
$(".notify-backdrop")?.addEventListener("click", () => hide(modalWrap));
function alertModal(title, content){
  setText($("#notify-title"), title);
  setText($("#notify-content"), content);
  show(modalWrap);
}

/* ---- HTTP ---- */
function apiUrl(path){
  if (!API_BASE) return null;
  return API_BASE + (path.startsWith("/") ? path : "/" + path);
}
async function post(path, data = {}, opts = {}){
  if (!API_BASE) throw new Error("API_BASE is not set. Add ?api=https://your-host");
  const url = apiUrl(path);
  const payload = {
    ...data,
    initData,
    user_id: USER.id || undefined,
    username: USER.username || undefined,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    mode: "cors",
    redirect: "follow",
  }).catch((e) => ({ ok:false, status:0, _err:e }));
  if (!r || !("ok" in r) || !r.ok){
    const text = (await r?.text?.()) || String(r?._err || "Fetch failed");
    const err = new Error(`HTTP ${r?.status || 0}: ${text}`); err._http = r;
    throw err;
  }
  return r.json();
}

/* ==================== НАВИГАЦИЯ (Screens, Router) ==================== */
const screens = {
  menu: $("#menu"),
  stats: $("#screen-stats"),
  submit: $("#screen-submit"),
  report: $("#screen-report"),
  priv: $("#screen-priv"),
  roulette: $("#screen-roulette"),
  withdraw: $("#screen-withdraw"),
  contests: $("#screen-contests"),
  admin: $("#screen-admin"),
};
Object.values(screens).forEach(s => s?.classList?.add("scrollable"));
screens.menu?.classList?.remove("scrollable");

function goto(name){
  Object.values(screens).forEach(hide);
  const scr = screens[name];
  show(scr);
  if (name !== "menu") window.scrollTo({ top: 0 });
}

let MENU_TIMERS = { logs:null, payouts:null };

function bindMenu(){
  $("#menu .grid")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-screen]");
    if (!btn) return;
    const scr = btn.dataset.screen;
    if (scr === "stats")    { goto("stats");    refreshStats(); return; }
    if (scr === "submit")   { goto("submit");   return; }
    if (scr === "report")   { goto("report");   refreshReport(); return; }
    if (scr === "priv")     { goto("priv");     refreshPriv(); return; }
    if (scr === "roulette") { goto("roulette"); setupRouletteOnce(); return; }
    if (scr === "withdraw") { goto("withdraw"); refreshWithdrawBalance(); refreshWithdrawHistory(); return; }
    if (scr === "contests") { goto("contests"); refreshContests(); return; }
    if (scr === "admin")    { goto("admin");    refreshAdmin(); return; }
  });
  $$(".back").forEach(b => b.addEventListener("click", () => goto("menu")));
  $("#refreshLogs")?.addEventListener("click", refreshLogs);
}

function startMenuAuto(){
  stopMenuAuto();
  // сразу обновим
  refreshLogs();
  refreshPayoutTape();
  // затем периодически
  MENU_TIMERS.logs   = setInterval(()=>{ if (!document.hidden) refreshLogs(); }, 10000);
  MENU_TIMERS.payouts= setInterval(()=>{ if (!document.hidden) refreshPayoutTape(); }, 15000);
}

function stopMenuAuto(){
  if (MENU_TIMERS.logs)    { clearInterval(MENU_TIMERS.logs); MENU_TIMERS.logs=null; }
  if (MENU_TIMERS.payouts) { clearInterval(MENU_TIMERS.payouts); MENU_TIMERS.payouts=null; }
}

document.addEventListener("visibilitychange", ()=>{
  // при возврате на вкладку обновим сразу
  if (!document.hidden && screens.menu && !screens.menu.classList.contains("hidden")){
    refreshLogs(); refreshPayoutTape();
  }
});

const _goto_orig = goto;
goto = function(name){
  _goto_orig(name);
  if (name === "menu") startMenuAuto(); else stopMenuAuto();
};
/* ==================== СТАРТОВЫЙ БУТСТРАП ==================== */
async function bootstrap(){
  try {
    const r = await post("/api/bootstrap", {});
    if (r?.ok){
      S.stats = r.stats || {};
      html($("#statsBox"), prettyStats(S.stats));
      await refreshLogs();
      await refreshPriv();
      await refreshWithdrawBalance();
      await refreshPayoutTape();   // новая строка
      startMenuAuto();  
      // восстановление незавершённой заявки
      try {
        const os = await post("/api/open_submission", {});
        if (os?.ok && os.open){
          S.lastSubmissionId = os.open.id;
          lockPhone(os.open.phone || "");
          goto("submit");
        } else {
          unlockPhone();
        }
      } catch {}
    }
  } catch (e) {
    toast("API недоступно", "Проверь ?api= и туннель Cloudflare");
    if (F.debug) console.error(e);
  }
}

/* ==================== СТАТИСТИКА ==================== */
function prettyStats(st){
  if (!st) return `<div class="muted">Нет данных</div>`;
  const rows = [
    ["Пользователь", st.username || USER.username],
    ["Баланс", `$${fmtMoney(st.balance)}`],
    ["Успехи / Провалы", `${st.success_count ?? 0} / ${st.fail_count ?? 0}`],
    ["Заработано", `$${fmtMoney(st.earned)}`],
    ["Рулетка", `потрачено $${fmtMoney(st.spent_roulette)} • выиграно $${fmtMoney(st.won_roulette)}`],
    ["Тариф", `${st.plan || "standard"}`],
    ["Старт тарифа", `${st.plan_started || "—"}`],
    ["Действует до", `${st.plan_until || "—"}`],
    ["С первых пор", `${st.first_seen || "—"}`],
  ];
  return rows.map(([k,v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`).join("");
}
async function refreshStats(){
  try {
    const r = await post("/api/stats", {});
    if (r?.ok){ S.stats = r.stats || {}; html($("#statsBox"), prettyStats(S.stats)); }
  } catch (e) {
    html($("#statsBox"), `<div class="err">Ошибка загрузки статистики</div>`);
    if (F.debug) console.error(e);
  }
}

/* ==================== ЛОГИ ==================== */
async function refreshLogs(){
  try {
    const r = await post("/api/logs", {});
    if (!r?.ok){
      if (r?.error === "BLOCKED"){
        const until = r.until ? safeDate(r.until) : "";
        return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
      }
      throw new Error("bad");
    }
    const box = $("#chat");
    const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    box.innerHTML = "";
    (r.events || []).forEach(ev => {
      const item = document.createElement("div");
      item.className = `log ${ev.role || "system"}`;
      const ts = safeDate(ev.ts);
      item.innerHTML = `<span class="ts">${ts}</span><span class="who">${roleLabel(ev.role)}</span><span class="txt">${escapeHtml(ev.text)}</span>`;
      box.appendChild(item);
    });
    if (nearBottom) box.scrollTop = box.scrollHeight;
  } catch (e) {
    toast("Не удалось загрузить логи");
    if (F.debug) console.error(e);
  }
}

function roleLabel(r){
  if (r === "user") return "Вы";
  if (r === "admin") return "Админ";
  return "Система";
}

async function refreshPayoutTape(){
  try{
    const r = await post("/api/payouts_recent", { limit: 20 });
    const rows = r?.rows || [];
    const box = $("#payoutTape");
    const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    if (!rows.length){ html(box, "<div class='muted'>Пока пусто</div>"); return; }
    const out = rows.map(x=>{
      const u = maskUsername(x.username || ("id"+x.user_id));
      const nm = maskName(x.name || "");
      const amt = Number(x.amount||0).toFixed(2);
      const when = dt(x.paid_at || x.created_at);
      return `<div class="row"><div>${u} • ${nm}</div><div>$${amt} • ${escapeHtml(when)}</div></div>`;
    }).join("");
    html(box, out);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }catch{ toast("Лента выводов недоступна"); }
}
$("#payoutTapeRefresh")?.addEventListener("click", refreshPayoutTape);

/* ==================== СДАТЬ MAX ==================== */
function lockPhone(phone){
  const inp = $("#phone");
  const btn = $("#sendPhone");
  if (inp){ inp.value = phone || inp.value; inp.readOnly = true; inp.classList.add("locked"); }
  if (btn){ btn.disabled = true; btn.textContent = "Отправлено"; }
  S.phoneLocked = true; S.phoneValue = (phone || inp?.value || "");
  const codePanel = $("#codePanel"); if (codePanel) show(codePanel);
}
function unlockPhone(){
  const inp = $("#phone");
  const btn = $("#sendPhone");
  if (inp){ inp.readOnly = false; inp.classList.remove("locked"); }
  if (btn){ btn.disabled = false; btn.textContent = "Отправить"; }
  S.phoneLocked = false; S.phoneValue = "";
}
$("#phone")?.addEventListener("beforeinput", (e)=>{ if (S.phoneLocked) e.preventDefault(); });

function bindSubmit(){
  $("#sendPhone")?.addEventListener("click", async () => {
    if (S.phoneLocked) { toast("Номер уже отправлен"); return; }
    const phone = $("#phone").value.trim();
    if (!phone) return toast("Введите номер", "Поле не может быть пустым");
    try {
      const r = await post("/api/submit_phone", { phone });
      if (!r?.ok){
        if (r?.error === "BLOCKED"){
          const until = r.until ? safeDate(r.until) : "";
          return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
        }
        if (r?.error === "ALREADY"){
          S.lastSubmissionId = r.submission_id;
          lockPhone(r.phone || phone);
          return toast("Номер уже отправлен", "Ожидайте код");
        }
        throw new Error("bad");
      }
      S.lastSubmissionId = r.submission_id;
      toast("Номер принят", "Введите код из SMS.");
      lockPhone(phone);
    } catch (e) {
      toast("Ошибка отправки номера");
      if (F.debug) console.error(e);
    }
  });

  $("#sendCode")?.addEventListener("click", async () => {
    const btn  = $("#sendCode");
    const code = $("#code").value.trim();
    if (!S.lastSubmissionId) return toast("Сначала отправьте номер");
    if (!code) return toast("Введите код из SMS");

    btn.disabled = true;
    try {
      const r = await post("/api/submit_code", { submission_id: S.lastSubmissionId, code });
      if (!r?.ok){
        if (r?.error === "BLOCKED"){
          const until = r.until ? safeDate(r.until) : "";
          return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
        }
        if (r?.error === "NO_SUBMISSION"){
          S.lastSubmissionId = null;
          return alertModal("Ошибка", "Заявка не найдена. Отправьте номер заново.");
        }
        if (r?.error === "BAD_CODE"){
          return toast("Неверный код", "Проверьте SMS и отправьте снова");
        }
        throw new Error("bad");
      }
      toast("Код отправлен", "Администратор проверит код.");
      hide($("#codePanel"));
      unlockPhone();
      S.lastSubmissionId = null;
      $("#phone").value = "";
      $("#code").value  = "";
      await refreshLogs();
      goto("menu");
    } catch (e) {
      toast("Ошибка отправки кода");
      if (F.debug) console.error(e);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ==================== ОТЧЁТ ==================== */
async function refreshReport(){
  const box = $("#reportList");
  html(box, "Загрузка…");
  try {
    const r = await post("/api/my_numbers", {});
    if (!r?.ok){
      if (r?.error === "BLOCKED"){
        const until = r.until ? safeDate(r.until) : "";
        return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
      }
      throw new Error("bad");
    }
    const rows = r.rows || [];
    if (!rows.length) return html(box, `<div class="muted">Нет заявок</div>`);
    const out = rows.map(row => {
      const m = Number(row.minutes || 0);
      const earned = fmtMoney(row.earned || 0);
      return `
        <div class="report-row">
          <div class="r1">
            <div class="phone">${escapeHtml(row.phone)}</div>
            <div class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</div>
          </div>
          <div class="r2">
            <div class="mins">${m} мин</div>
            <div class="earned">$${earned}</div>
          </div>
        </div>`;
    }).join("");
    html(box, out);
  } catch (e) {
    html(box, `<div class="err">Ошибка загрузки отчёта</div>`);
    if (F.debug) console.error(e);
  }
}
$("#reportRefresh")?.addEventListener("click", refreshReport);
function statusClass(s){
  if (!s) return "";
  s = s.toLowerCase();
  if (s.includes("холд")) return "ok";
  if (s.includes("слёт")) return "warn";
  if (s.includes("approved")) return "ok";
  if (s.includes("rejected") || s.includes("wrong")) return "bad";
  return "";
}

/* ==================== ПРИВИЛЕГИИ + ROI ==================== */
function updateROI(){
  const mins = Number($("#roi-mins")?.value || 0);
  const succ = Number($("#roi-succ")?.value || 0);
  const rate = Number(S.priv.rate || 0.18);
  const plan = $("input[name='roi-plan']:checked")?.value || "premium";
  const price = Number(S.prices[plan] || 0);
  if (!(mins>0 && succ>0 && rate>0 && price>0)) { setText($("#roi-out"), "—"); return; }
  const earnPerDay = mins * rate * succ;
  const days = Math.ceil(price / Math.max(earnPerDay, 0.0001));
  setText($("#roi-out"), `${days} дн. • ~$${fmtMoney(earnPerDay)}/день`);
}
$("#roi-mins")?.addEventListener("input", updateROI);
$("#roi-succ")?.addEventListener("input", updateROI);
$$("input[name='roi-plan']").forEach(r => r.addEventListener("change", updateROI));

async function refreshPriv(){
  try {
    const r = await post("/api/priv/info", {});
    if (!r?.ok){
      if (r?.error === "BLOCKED"){
        const until = r.until ? safeDate(r.until) : "";
        return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
      }
      throw new Error("bad");
    }
    const p = r.plan || {};
    const rate = Number(r.rate || 0);
    const prices = r.prices || S.prices;

    S.prices = prices;
    S.priv = { rate, plan: p };
    S.is_admin = !!r.is_admin;

    const season = r.season ? ` (${r.season})` : "";
    setText($("#price-premium"), `$${fmtMoney(prices.premium)}${season}`);
    setText($("#price-speed"), `$${fmtMoney(prices.speed)}${season}`);
    const summary = `Тариф: ${p.plan || "—"} • Ставка: $${fmtMoney(rate)} • Действует до: ${p.plan_until || "—"}`;
    setText($("#privSummary"), summary);

    $("#menu-admin")?.classList.toggle("hidden", !S.is_admin);

    if ($("#roi-mins")) $("#roi-mins").value = 60;
    if ($("#roi-succ")) $("#roi-succ").value = 0.7;
    updateROI();

    const active = (p.plan || "").toLowerCase();
    setPlanBtn($("#buy-premium"), active === "premium");
    setPlanBtn($("#buy-speed"), active === "speed");
    const std = $("#std-activate");
    if (std) std.textContent = active === "standard" ? "Активный" : "Активировать";
  } catch (e) {
    setText($("#privSummary"), "Ошибка загрузки тарифов");
    if (F.debug) console.error(e);
  }
}
function setPlanBtn(btn, isActive){
  if (!btn) return;
  btn.textContent = isActive ? "Активирован" : "Купить";
  btn.disabled = !!isActive;
  btn.classList.toggle("active", !!isActive);
}
$("#buy-premium")?.addEventListener("click", () => confirmBuy("premium"));
$("#buy-speed")?.addEventListener("click", () => confirmBuy("speed"));
$("#std-activate")?.addEventListener("click", async () => {
  try {
    const r = await post("/api/priv/activate_standard", {});
    if (r?.ok){
      toast("Активирован «Стандарт»", `Возврат $${fmtMoney(r.refund || 0)}`);
      await refreshPriv();
      await refreshWithdrawBalance();
    }
  } catch (e) {
    toast("Ошибка активации тарифа");
    if (F.debug) console.error(e);
  }
});
async function confirmBuy(plan){
  const code = ($("#promo")?.value || "").trim();
  try {
    const r = await post("/api/priv/buy", { plan, promo: code || undefined });
    if (r?.ok){
      const msg = r.promo?.startsWith("OK") ? `со скидкой (${r.promo})` : "";
      toast("Покупка успешна", `Оплата $${fmtMoney(r.paid)} ${msg}`);
      await refreshPriv(); await refreshWithdrawBalance();
    } else {
      toast("Покупка не удалась");
    }
  } catch (e) {
    toast(e.message.includes("NO_FUNDS") ? "Недостаточно средств" : "Покупка не удалась");
  }
}

/* ==================== АДМИН ==================== */
function bindAdmin(){
  $("#menu-admin")?.addEventListener("click", ()=>{ goto("admin"); refreshAdmin(); refreshAdminPayouts(); refreshBlocked(); });
  $("#admin-refresh")?.addEventListener("click", ()=>{ refreshAdmin(); refreshAdminPayouts(); refreshBlocked(); });
  $("#admBlock")?.addEventListener("click", ()=> adminBlockUnblock(true));
  $("#admUnblock")?.addEventListener("click", ()=> adminBlockUnblock(false));
  $("#admPaySend")?.addEventListener("click", adminPayNow);
}

async function adminBlockUnblock(block){
  const uid = Number($("#admUid")?.value||0); if(!uid) return toast("user_id?");
  try{
    const r = await post(block?"/api/admin/block":"/api/admin/unblock", { target_id: uid });
    if (r?.ok) { toast(block?"Заблокирован":"Разблокирован"); refreshBlocked(); }
    else toast("Ошибка");
  }catch{ toast("Ошибка"); }
}
async function refreshBlocked(){
  try{
    const r = await post("/api/admin/blocked_list", {});
    const list = r?.rows||[];
    html($("#admBlockedList"), list.length? list.map(x=>`<div>id${x.user_id} • до ${escapeHtml(dt(x.until))}</div>`).join("") : "<div class='muted'>Нет блокировок</div>");
  }catch{ html($("#admBlockedList"), "<div class='muted'>н/д</div>"); }
}
async function adminPayNow(){
  const uid = Number($("#admPayUid")?.value||0);
  const amount = Number($("#admPayAmount")?.value||0);
  const url = ($("#admPayUrl")?.value||"").trim();
  if(!uid || !amount || !url) return toast("Данные?");
  try{
    const r = await post("/api/admin/payout/pay", { user_id: uid, amount, url });
    if (r?.ok){ toast("Выплачено"); refreshAdminPayouts(); }
    else toast("Ошибка выплаты");
  }catch{ toast("Ошибка выплаты"); }
}
async function refreshAdminPayouts(){
  try{
    const r = await post("/api/admin/payouts", { limit: 30 });
    const rows = r?.items || r?.rows || [];
    html($("#admPayouts"), rows.length? rows.map(x=>{
      const u = "id"+x.user_id;
      const amt = Number(x.amount||0).toFixed(2);
      const st = String(x.status||"");
      const when = dt(x.paid_at || x.created_at);
      return `<div class="row"><div>${u}</div><div>$${amt}</div><div class="muted">${escapeHtml(st)}</div><div>${escapeHtml(when)}</div></div>`;
    }).join("") : "<div class='muted'>Нет данных</div>");
  }catch{ html($("#admPayouts"), "<div class='muted'>Ошибка</div>"); }
}

async function refreshAdmin(){
  if (!S.is_admin) return alertModal("Нет прав","Доступ только для админов");
  try {
    const [q,h] = await Promise.all([post("/api/admin/queue",{}), post("/api/admin/holds",{})]);
    html($("#admin-queue"), (q.items||[]).map(it => `<div class="row"><b>#${it.id}</b> uid${it.user_id} ${escapeHtml(it.phone||"")} <span class="muted">${it.status}</span></div>`).join("") || "<div class=muted>Пусто</div>");
    html($("#admin-holds"), (h.items||[]).map(it => `<div class="row">HOLD #${it.id} uid${it.user_id} ${escapeHtml(it.phone||"")}</div>`).join("") || "<div class=muted>Нет активных</div>");
  } catch {
    toast("Ошибка админ-API");
  }
}

// === App cache purge ===
const APP_KEY_PREFIX   = "bm:";             // ваши ключи localStorage/sessionStorage
const CACHE_NAME_MATCH = /^blessed-max/i;   // имена CacheStorage по вашему префиксу

async function clearClientCache() {
  try {
    // LocalStorage / SessionStorage по префиксу
    for (const store of [localStorage, sessionStorage]) {
      try {
        const keys = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && k.startsWith(APP_KEY_PREFIX)) keys.push(k);
        }
        keys.forEach(k => store.removeItem(k));
      } catch {}
    }

    // Cache Storage (Service Worker)
    if (window.caches?.keys) {
      const names = await caches.keys();
      await Promise.all(
        names.filter(n => CACHE_NAME_MATCH.test(n)).map(n => caches.delete(n))
      );
    }

    // IndexedDB (если доступен список баз)
    if (indexedDB?.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all((dbs || []).map(db => new Promise(res => {
        try {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        } catch { res(); }
      })));
    }
  } catch {}
}

// Надёжные триггеры «закрытия»
window.addEventListener("pagehide", () => { clearClientCache(); }, { once: true });
window.addEventListener("beforeunload", () => { clearClientCache(); }, { once: true });

/* ==================== РУЛЕТКА ==================== */
let rouletteReady = false;
const PRIZES = [
  {v:0.50, icon:"🟦", cls:"r-cmn"}, {v:0.75, icon:"🟦", cls:"r-cmn"},
  {v:1.00, icon:"🟦", cls:"r-cmn"}, {v:1.25, icon:"🟦", cls:"r-cmn"},
  {v:1.50, icon:"🟦", cls:"r-cmn"}, {v:1.75, icon:"🟦", cls:"r-cmn"},
  {v:2.00, icon:"🟦", cls:"r-cmn"}, {v:2.50, icon:"🟪", cls:"r-uc"},
  {v:3.00, icon:"🟪", cls:"r-uc"},  {v:3.50, icon:"🟪", cls:"r-uc"},
  {v:4.00, icon:"🟨", cls:"r-rare"},{v:4.50, icon:"🟨", cls:"r-rare"},
  {v:5.00, icon:"🟨", cls:"r-rare"},{v:6.00, icon:"⚡",  cls:"r-rare"},
  {v:7.00, icon:"⚡",  cls:"r-rare"},{v:8.00, icon:"⚡",  cls:"r-rare"},
  {v:9.00, icon:"⚡",  cls:"r-rare"},{v:10.00,icon:"💠", cls:"r-uc"},
  {v:12.00,icon:"💠", cls:"r-uc"},  {v:15.00,icon:"💠", cls:"r-uc"},
  {v:20.00,icon:"💠", cls:"r-uc"},  {v:25.00,icon:"💎", cls:"r-legend"},
  {v:30.00,icon:"💎", cls:"r-legend"},{v:40.00,icon:"💎", cls:"r-legend"},
  {v:50.00,icon:"💎", cls:"r-legend"},{v:75.00,icon:"💎", cls:"r-legend"},
  {v:100.00,icon:"💎", cls:"r-legend"}
];
let RU_ORDER = [];
let ruRepeats = 0;

function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function setupRouletteOnce(){ if(rouletteReady) return; rouletteReady=true; buildRouletteStrip(16, true); $("#ru-spin")?.addEventListener("click", spin); }
function buildRouletteStrip(repeats=12, reshuffle=false){
  const strip=$("#case-strip"); if(!strip) return;
  if(reshuffle||RU_ORDER.length!==PRIZES.length) RU_ORDER = shuffle([...PRIZES]);
  const chunk = RU_ORDER.map(p=>`<div class="case-item ${p.cls}"><div class="ico">${p.icon}</div><div class="amt">$${fmtMoney(p.v)}</div></div>`).join("");
  strip.innerHTML = chunk.repeat(repeats); strip.style.transform="translateX(0px)"; ruRepeats=repeats;
}
function ensureRepeats(minRepeatsNeeded){
  const strip = $("#case-strip");
  if (!strip || minRepeatsNeeded <= ruRepeats) return;
  const chunk = RU_ORDER.map(p => `<div class="case-item ${p.cls}"><div class="ico">${p.icon}</div><div class="amt">$${fmtMoney(p.v)}</div></div>`).join("");
  strip.insertAdjacentHTML("beforeend", chunk.repeat(minRepeatsNeeded - ruRepeats));
  ruRepeats = minRepeatsNeeded;
}
function measure(){
  const wrap = $(".case-wrap");
  const strip = $("#case-strip");
  const first = strip?.querySelector(".case-item");
  if (!wrap || !strip || !first) return null;
  const cs = getComputedStyle(strip);
  const gap = parseFloat(cs.gap || cs.columnGap || "0") || 0;
  const padL = parseFloat(cs.paddingLeft || "0") || 0;
  const tileW = first.getBoundingClientRect().width;
  const stride = tileW + gap;
  const pointerX = Math.round(wrap.getBoundingClientRect().width / 2);
  const visibleCount = Math.ceil(wrap.getBoundingClientRect().width / stride) + 2;
  return { wrap, strip, tileW, stride, padL, pointerX, visibleCount };
}
function prizeIndexForWin(win, winIndex){
  const baseVal = Number.isInteger(winIndex) ? (PRIZES[winIndex]?.v) : Number(win);
  const exact = RU_ORDER.findIndex(p => Math.abs(p.v - Number(baseVal)) < 1e-9);
  if (exact >= 0) return exact;
  return nearestPrizeIndex(RU_ORDER.map(p => p.v), Number(baseVal));
}
async function spin(){
  // каждый спин — новый порядок плиток для непредсказуемости
  buildRouletteStrip(16, true);

  const m = measure(); if (!m) return;
  const { wrap, strip, tileW, stride, padL, pointerX, visibleCount } = m;
  const resBox = $("#ru-result");
  const btn = $("#ru-spin");

  btn.disabled = true;
  btn.dataset._label = btn.textContent;
  btn.textContent = "Крутится…";
  wrap.classList.add("spinning");
  setText(resBox, "Крутится…");

  // запрос результата
  let win = 0, balance = 0, baseIdx = 0;
  try {
    const r = await post("/api/roulette_spin", {});
    if (!r?.ok) throw new Error("bad");
    win = Number(r.win || 0);
    balance = Number(r.balance || 0);
    baseIdx = prizeIndexForWin(win, r.win_index);
  } catch {
    toast("Спин недоступен", "Повторите позже");
    return unlock();
  }

  const cycles = 7 + Math.floor(Math.random()*3); // 7..9
  const targetIndex = cycles * RU_ORDER.length + baseIdx;

  const itemsNeeded = targetIndex + Math.ceil(visibleCount/2) + 2;
  const repeatsNeeded = Math.ceil(itemsNeeded / RU_ORDER.length);
  ensureRepeats(repeatsNeeded);

  const targetCenter = padL + targetIndex * stride + tileW/2;
  const target = Math.round(targetCenter - pointerX);

  const dur = 3200;
  const start = performance.now();
  const startX = currentTranslateX(strip);
  const delta = -target - startX;

  strip.style.willChange = "transform";
  requestAnimationFrame(function step(t){
    const p = Math.min(1, (t - start) / dur);
    const eased = cubicOut(p);
    const x = startX + delta * eased;
    strip.style.transform = `translateX(${Math.round(x)}px)`;
    if (p < 1) requestAnimationFrame(step);
    else onStop();
  });

  function onStop(){
    strip.style.transform = `translateX(${-target}px)`;
    setText(resBox, `Выигрыш: $${fmtMoney(win)}`);
    toast("Результат", `$${fmtMoney(win)} • Баланс $${fmtMoney(balance)}`);
    refreshWithdrawBalance();
    refreshLogs();
    unlock();
  }
  function unlock(){
    wrap.classList.remove("spinning");
    btn.disabled = false;
    if (btn.dataset._label) btn.textContent = btn.dataset._label;
  }
}
function nearestPrizeIndex(arr, val){ let best=0, diff=Infinity; for(let i=0;i<arr.length;i++){ const d=Math.abs(arr[i]-val); if(d<diff){diff=d;best=i;} } return best; }
function cubicOut(t){ const f=t-1; return f*f*f+1; }
function currentTranslateX(el){
  const m = getComputedStyle(el).transform;
  if (!m || m === "none") return 0;
  const a = m.match(/matrix\\(([^)]+)\\)/);
  if (!a) return 0;
  const parts = a[1].split(",").map(Number);
  return Math.round(parts[4] || 0);
}

/* ==================== ВЫВОД ==================== */
async function refreshWithdrawBalance(){
  try {
    const r = await post("/api/stats", {});
    if (r?.ok){
      S.stats = r.stats || S.stats;
      setText($("#wdBalance"), fmtMoney(S.stats?.balance || 0));
      html($("#statsBox"), prettyStats(S.stats));
    }
  } catch {}
}
$("#wdSend")?.addEventListener("click", async () => {
  const amt = Number($("#wdAmount").value);
  if (!(amt >= 5 && amt <= 100)) return toast("Сумма 5–100$");
  try {
    const r = await post("/api/withdraw_request", { amount: amt });
    if (r?.ok){
      toast("Заявка отправлена", `#${r.payout_id}`);
      $("#wdAmount").value = "";
      await refreshWithdrawBalance();
    } else {
      toast("Ошибка заявки");
    }
  } catch (e) {
    const msg = e.message.includes("NO_FUNDS") ? "Недостаточно средств" :
                e.message.includes("PENDING_EXISTS") ? "Есть активная заявка" :
                "Ошибка запроса";
    toast(msg);
    if (F.debug) console.error(e);
  }
});
$("#wdCancel")?.addEventListener("click", async () => {
  try {
    const r = await post("/api/withdraw_cancel", {});
    if (r?.ok){
      toast("Заявка отменена");
      await refreshWithdrawBalance();
    } else toast("Отменить не удалось");
  } catch { toast("Ошибка отмены"); }
});

async function refreshWithdrawHistory(){
  try{
    const r = await post("/api/withdraw_history", { limit: 30 });
    const rows = r?.rows || [];
    const box = $("#wdHistory");
    if (!rows.length){ html(box, "<div class='muted'>Пока нет заявок</div>"); return; }
    const out = rows.map(x=>{
      const amt = Number(x.amount||0).toFixed(2);
      const st  = String(x.status||"").toLowerCase();
      const when= dt(x.paid_at || x.created_at);
      const cls = st==="paid" ? "ok" : st==="canceled" ? "bad" : "warn";
      return `<div class="row ${cls}"><b>$${amt}</b><span class="muted" style="margin-left:auto">${escapeHtml(st)}</span><span style="margin-left:12px">${escapeHtml(when)}</span></div>`;
    }).join("");
    html(box, out);
  }catch{ toast("История выводов недоступна"); }
}
$("#wdHistRefresh")?.addEventListener("click", refreshWithdrawHistory);

/* ==================== КОНКУРСЫ ==================== */
let LB_TIMER = null;
async function refreshContests(){
  const box = $("#contestList");
  html(box, "Загрузка…");
  try {
    const r = await post("/api/contests", {});
    if (!r?.ok){
      if (r?.error === "BLOCKED"){
        const until = r.until ? safeDate(r.until) : "";
        return alertModal("Блокировка", `Вы временно заблокированы. До: ${until}`);
      }
      throw new Error("bad");
    }
    const items = r.items || [];
    if (!items.length) return html(box, `<div class="muted">Конкурсов нет</div>`);
    const out = items.map(c => {
      const until = c.until ? `<div class="muted">До: ${escapeHtml(c.until)}</div>` : "";
      const joined = c.joined ? `<span class="ok">• Вы участвуете</span>` : "";
      return `<div class="contest-card" data-id="${c.id}">
        <div class="title">${escapeHtml(c.title)}</div>
        <div class="prize">Приз: ${escapeHtml(c.prize)} ${joined}</div>
        ${until}
        <div class="muted">Участников: ${Number(c.entries || 0)}</div>
        <div class="row">
          <button class="join" data-id="${c.id}" ${c.joined ? "disabled":""}>${c.joined?"Участвуете":"Участвовать"}</button>
          <button class="leaders" data-id="${c.id}">Таблица</button>
        </div>
      </div>`;
    }).join("");
    html(box, out);
  } catch (e) {
    html(box, `<div class="err">Ошибка загрузки конкурсов</div>`);
    if (F.debug) console.error(e);
  }
}
$("#screen-contests")?.addEventListener("click", async (e) => {
  const join = e.target.closest("button.join");
  const lead = e.target.closest("button.leaders");
  if (join){
    const cid = Number(join.dataset.id);
    try {
      const r = await post("/api/contest/join", { contest_id: cid });
      if (r?.ok){
        toast("Участие принято", "Минуты будут считаться с этого момента");
        await refreshContests();
      } else if (r?.error === "ALREADY") toast("Вы уже участвуете");
      else if (r?.error === "CLOSED") toast("Конкурс закрыт");
      else toast("Ошибка участия");
    } catch { toast("Ошибка участия"); }
  }
  if (lead){
    const cid = Number(lead.dataset.id);
    openLeaderboard(cid);
  }
});
async function openLeaderboard(cid){
  clearInterval(LB_TIMER);
  const dlg = $("#notify-modal");
  const titleEl = $("#notify-title");
  const contentEl = $("#notify-content");
  $("#notify-close").onclick = () => { hide(dlg); clearInterval(LB_TIMER); };
  titleEl.textContent = `Таблица конкурса #${cid}`;
  show(dlg);
  async function loadOnce(){
    try {
      const r = await post("/api/contest/leaderboard", { contest_id: cid });
      if (!r?.ok) throw 0;
      const rows = r.rows || [];
      if (!rows.length){
        contentEl.innerHTML = `<div class="muted">Пока нет участников</div>`;
        return;
      }
      const meRow = rows.find(x => x.me);
      const list = rows.map(row => `
        <div class="lb-row ${row.me?"me":""}">
          <div class="pos">#${row.rank}</div>
          <div class="name">${escapeHtml(row.username || ("id"+row.user_id))}</div>
          <div class="mins">${row.minutes} мин</div>
        </div>`).join("");
      contentEl.innerHTML = `${meRow ? `<div class="lb-me">Ваше место: #${meRow.rank} • ${meRow.minutes} мин</div>`:""}<div class="lb">${list}</div>`;
    } catch {
      contentEl.innerHTML = `<div class="err">Ошибка загрузки таблицы</div>`;
    }
  }
  await loadOnce();
  LB_TIMER = setInterval(() => {
    if (dlg.classList.contains("hidden")) { clearInterval(LB_TIMER); return; }
    loadOnce();
  }, 10000);
}

/* ==================== УТИЛИТЫ ==================== */
function maskUsername(u){
  if (!u) return "—";
  const s = (u.startsWith("@") ? u.slice(1) : u).toLowerCase();
  return "@"+s.slice(0,3)+"********";
}
function maskName(n){
  if (!n) return "—";
  const s = String(n).trim();
  return s.slice(0,1)+"******";
}
function dt(ts){
  // ts может быть ISO или epoch сек
  const d = typeof ts==="number" ? new Date(ts*1000) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function fmtMoney(n){
  const num = Number(n || 0);
  return num.toFixed(2).replace(/\.00$/, ".00").replace(/(\.\d)0$/, "$1");
}
function safeDate(s){
  if (!s) return "";
  try {
    const d = new Date(String(s).replace(" ", "T") + "Z");
    return d.toLocaleString();
  } catch { return s; }
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape"){
    if (!screens.menu.classList.contains("hidden")) return;
    goto("menu");
  }
});
function confirmModal(title, content, okText="Купить", cancelText="Отмена"){
  const dlg = $("#notify-modal");
  const titleEl = $("#notify-title");
  const contentEl = $("#notify-content");
  const closeBtn = $("#notify-close");
  const actionsId = "notify-actions";
  const actions = document.createElement("div");
  actions.id = actionsId;
  actions.className = "notify-actions";
  actions.innerHTML = `<button class="notify-btn secondary" id="notify-cancel">${escapeHtml(cancelText)}</button>
                       <button class="notify-btn" id="notify-ok">${escapeHtml(okText)}</button>`;
  titleEl.textContent = title;
  contentEl.textContent = content;
  contentEl.appendChild(actions);
  show(dlg);
  closeBtn.style.display = "none";
  return new Promise((resolve)=>{
    const onCancel = ()=>{ cleanup(); resolve(false); };
    const onOk = ()=>{ cleanup(); resolve(true); };
    $("#notify-cancel").addEventListener("click", onCancel, {once:true});
    $("#notify-ok").addEventListener("click", onOk, {once:true});
    $(".notify-backdrop").addEventListener("click", onCancel, {once:true});
    function cleanup(){
      hide(dlg);
      closeBtn.style.display = "";
      actions.remove();
    }
  });
}

/* ==================== СТАРТ ==================== */
document.addEventListener("DOMContentLoaded", () => {
  bindMenu();
  bindSubmit();
  bindAdmin();
  goto("menu");
  bootstrap();

});




