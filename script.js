/* Blessed MAX — script.js (R18+) */
/* Robust Telegram WebApp client for index.html.
   Works with aiohttp API from bot.py and schema in db.py. */

/* ====== Config ====== */
const tg = window.Telegram?.WebApp || null;
if (tg && typeof tg.expand === "function") tg.expand();

const qp = new URLSearchParams(location.search);
const API_BASE = "https://sunset-babe-carrier-largely.trycloudflare.com";

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
      setText($("#statsBox"), prettyStats(S.stats));
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
function prettyStats(st) {
  if (!st) return "Нет данных.";
  const lines = [
    `Пользователь: ${st.username || USER.username}`,
    `Баланс: $${fmtMoney(st.balance)}`,
    `Успехов: ${st.success_count ?? 0} • Провалов: ${st.fail_count ?? 0}`,
    `Заработано: $${fmtMoney(st.earned)}`,
    `Рулетка: потрачено $${fmtMoney(st.spent_roulette)} • выиграно $${fmtMoney(st.won_roulette)}`,
    `Тариф: ${st.plan || "standard"} • старт: ${st.plan_started || "—"} • до: ${st.plan_until || "—"}`,
    `С первых пор: ${st.first_seen || "—"}`,
  ];
  return lines.join("\n");
}

async function refreshStats() {
  try {
    const r = await post("/api/stats", {});
    if (r?.ok) {
      S.stats = r.stats || {};
      setText($("#statsBox"), prettyStats(S.stats));
    }
  } catch (e) {
    setText($("#statsBox"), "Ошибка загрузки статистики.");
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
  } catch (e) {
    setText($("#privSummary"), "Ошибка загрузки тарифов");
    if (F.debug) console.error(e);
  }
}

$("#buy-premium")?.addEventListener("click", async () => {
  const price = S.prices.premium;
  confirmBuy("premium", price);
});
$("#buy-speed")?.addEventListener("click", async () => {
  const price = S.prices.speed;
  confirmBuy("speed", price);
});
$("#std-activate")?.addEventListener("click", async () => {
  try {
    const r = await post("/api/priv/activate_standard", {});
    if (r?.ok) {
      toast("Активирован «Стандарт»", `Возврат $${fmtMoney(r.refund || 0)}`);
      await refreshPriv(); await refreshWithdrawBalance();
    }
  } catch (e) {
    toast("Ошибка активации тарифа");
    if (F.debug) console.error(e);
  }
});

async function confirmBuy(plan, price) {
  const ok = window.confirm(`Купить тариф ${plan} за $${fmtMoney(price)}?`);
  if (!ok) return;
  try {
    const r = await post("/api/priv/buy", { plan });
    if (r?.ok) {
      toast("Тариф активирован", plan);
      await refreshPriv(); await refreshWithdrawBalance();
    } else {
      toast("Покупка не удалась");
    }
  } catch (e) {
    if (e.message.includes("NO_FUNDS")) toast("Недостаточно средств");
    else toast("Ошибка покупки тарифа");
    if (F.debug) console.error(e);
  }
}

/* ====== Roulette ====== */
let rouletteReady = false;
function setupRouletteOnce() {
  if (rouletteReady) return;
  rouletteReady = true;
  $("#ru-spin")?.addEventListener("click", spin);
}

async function spin() {
  const strip = $("#case-strip");
  const pointer = $("#case-pointer");
  const resBox = $("#ru-result");
  if (!strip) return;

  // Build items visually
  const prizes = [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3];
  strip.innerHTML = prizes.map(v => `<div class="case-item">$${fmtMoney(v)}</div>`).join("");
  strip.style.transform = "translateX(0px)";

  // Ask server
  let win = null, balance = null, err = null;
  try {
    const r = await post("/api/roulette_spin", {});
    if (!r?.ok) throw new Error("bad");
    win = Number(r.win || 0);
    balance = Number(r.balance || 0);
  } catch (e) {
    err = e;
  }
  if (err) {
    toast("Спин недоступен", "Пополните баланс или повторите позже");
    if (F.debug) console.error(err);
    return;
  }

  // Animate strip to land near target index
  const idx = nearestPrizeIndex(prizes, win);
  const itemW = 96; // CSS width of .case-item
  const cycles = 8; // full cycles before stop
  const target = (cycles * prizes.length + idx) * itemW;

  const dur = 2800; // ms
  const t0 = performance.now();
  strip.style.willChange = "transform";

  function anim(t) {
    const p = Math.min(1, (t - t0) / dur);
    const eased = cubicOut(p);
    const x = -target * eased;
    strip.style.transform = `translateX(${x}px)`;
    if (p < 1) requestAnimationFrame(anim);
    else onStop();
  }
  requestAnimationFrame(anim);

  function onStop() {
    setText(resBox, `Выигрыш: $${fmtMoney(win)}`);
    toast("Результат", `$${fmtMoney(win)} • Баланс $${fmtMoney(balance)}`);
    refreshWithdrawBalance();
    refreshLogs();
  }
}

function nearestPrizeIndex(arr, val) {
  let best = 0, diff = Infinity;
  arr.forEach((v, i) => {
    const d = Math.abs(v - val);
    if (d < diff) { diff = d; best = i; }
  });
  return best;
}

function cubicOut(t) { const f = t - 1; return f*f*f + 1; }

/* ====== Withdraw ====== */
async function refreshWithdrawBalance() {
  try {
    const r = await post("/api/stats", {});
    if (r?.ok) {
      S.stats = r.stats || S.stats;
      setText($("#wdBalance"), fmtMoney(S.stats?.balance || 0));
      setText($("#statsBox"), prettyStats(S.stats));
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
      return `<div class="contest-card">
        <div class="title">${escapeHtml(c.title)}</div>
        <div class="prize">Приз: ${escapeHtml(c.prize)}</div>
        ${until}
        <div class="muted">Участников: ${Number(c.entries || 0)}</div>
        <button class="join" data-id="${c.id}">Участвовать</button>
      </div>`;
    }).join("");
    html(box, out);
  } catch (e) {
    html(box, `<div class="err">Ошибка загрузки конкурсов</div>`);
    if (F.debug) console.error(e);
  }
}

$("#screen-contests")?.addEventListener("click", async (e) => {
  const b = e.target.closest("button.join");
  if (!b) return;
  const cid = Number(b.dataset.id);
  try {
    const r = await post("/api/contest_join", { contest_id: cid });
    if (r?.ok) toast("Вы участвовали", "Удачи");
    else if (r?.error === "ALREADY") toast("Вы уже участвуете");
    else if (r?.error === "CLOSED") toast("Конкурс закрыт");
    else toast("Ошибка участия");
  } catch (e2) {
    toast("Ошибка участия");
  }
});

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