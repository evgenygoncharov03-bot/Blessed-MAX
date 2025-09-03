from db import (
    init_db, upsert_user, log, stats, list_logs, create_submission,
    set_submission_code, get_submission, set_submission_status,
    apply_result, user_chat_log, get_balance, add_balance,
    get_roulette_totals, add_roulette_txn, set_submission_admin_msg_phone,
    set_submission_admin_msg_code, assign_submission, mark_hold_start,
    mark_hold_stop, accrue_submission, accrue_user_active, get_user_numbers
)

dp = Dispatcher()
bot = Bot(BOT_TOKEN)

MAIN_MENU = InlineKeyboardMarkup(inline_keyboard=[[
    InlineKeyboardButton(
        text="Открыть приложение",
        web_app={"url": "https://evgenygoncharov03-bot.github.io/Blessed-MAX/"}
    )
]])

@dp.message(CommandStart())
async def start(m: Message):
    upsert_user(m.from_user.id, m.from_user.username or m.from_user.full_name)
    log(m.from_user.id, "start", "")
    await m.answer("Открой мини-приложение:", reply_markup=MAIN_MENU)

@dp.message(Command("groupid"), F.chat.type.in_({"group","supergroup"}))
async def cmd_groupid(m: Message):
    await m.reply(f"ID группы: {m.chat.id}")

# --- админ-кнопки ---
def kb_admin_phase1(subm_id:int):
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🟩 Взять номер", callback_data=f"take:{subm_id}"),
        InlineKeyboardButton(text="🟥 Отказаться",  callback_data=f"decline_phone:{subm_id}")
    ]])

def kb_admin_phase2(subm_id:int):
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Подтвердить",  callback_data=f"appr_code:{subm_id}"),
        InlineKeyboardButton(text="❌ Отказаться",   callback_data=f"rej_code:{subm_id}"),
        InlineKeyboardButton(text="⚠️ Неверный код", callback_data=f"bad_code:{subm_id}")
    ]])

def kb_admin_hold(subm_id:int):
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="⏹️ Слёт", callback_data=f"drop:{subm_id}")
    ]])

@dp.callback_query(F.data.startswith(("take:","decline_phone:")))
async def on_phase1(cq: CallbackQuery):
    action, sid = cq.data.split(":"); sid = int(sid)
    subm = get_submission(sid)
    if not subm: return await cq.answer("Заявка не найдена", show_alert=True)
    user_id = subm["user_id"]
    if action == "take":
        assign_submission(sid, cq.from_user.id)
        set_submission_status(sid, "assigned")
        try:
            await cq.message.edit_text(f"📨 Заявка #{sid}\n👤 {user_id}\n📱 {subm['phone']}\n\nСтатус: Ждём код")
            await cq.message.edit_reply_markup(reply_markup=None)
        except: pass
        await bot.send_message(user_id, f"✳️ Заявка #{sid}: администратор принял номер. Ждём код.")
        log(user_id, "admin_take", f"{sid}")
        await cq.answer("OK")
    else:
        set_submission_status(sid, "declined_precode")
        try:
            await cq.message.edit_text(f"📨 Заявка #{sid}\n👤 {user_id}\n📱 {subm['phone']}\n\nСтатус: Отказался от номера")
            await cq.message.edit_reply_markup(reply_markup=None)
        except: pass
        await bot.send_message(user_id, f"🟥 Заявка #{sid}: администратор отказался от номера.")
        log(user_id, "admin_decline_precode", f"{sid}")
        await cq.answer("OK")

@dp.callback_query(F.data.startswith(("appr_code:","rej_code:","bad_code:","drop:")))
async def on_phase2_and_drop(cq: CallbackQuery):
    key, sid = cq.data.split(":"); sid = int(sid)
    subm = get_submission(sid)
    if not subm: return await cq.answer("Заявка не найдена", show_alert=True)
    user_id = subm["user_id"]

    if key == "appr_code":
        set_submission_status(sid, "approved")
        apply_result(user_id, "approved", amount=0.0)
        mark_hold_start(sid)
        log(user_id, "admin_action", f"{sid}:appr")
        try:
            await cq.message.edit_text(f"🔑 Код по заявке #{sid}\n👤 {user_id}\n🧩 {subm.get('code','—')}\n\nСтатус: Подтверждён")
            await cq.message.edit_reply_markup(reply_markup=kb_admin_hold(sid))
        except: pass
        await bot.send_message(user_id, f"✅ Заявка #{sid} подтверждена. Номер в холде.")
        await cq.answer("OK"); return

    if key == "rej_code":
        set_submission_status(sid, "rejected")
        apply_result(user_id, "rejected")
        log(user_id, "admin_action", f"{sid}:rej")
        try:
            await cq.message.edit_text(f"🔑 Код по заявке #{sid}\n👤 {user_id}\n🧩 {subm.get('code','—')}\n\nСтатус: Отказан")
            await cq.message.edit_reply_markup(reply_markup=None)
        except: pass
        await bot.send_message(user_id, f"❌ Заявка #{sid} отклонена. Можете отправить новый номер.")
        await cq.answer("OK"); return

    if key == "bad_code":
        set_submission_status(sid, "wrong_code")
        apply_result(user_id, "wrong_code")
        log(user_id, "admin_action", f"{sid}:bad")
        try:
            await cq.message.edit_text(f"🔑 Код по заявке #{sid}\n👤 {user_id}\n🧩 {subm.get('code','—')}\n\nСтатус: Неверный код")
            await cq.message.edit_reply_markup(reply_markup=None)
        except: pass
        await bot.send_message(user_id, f"⚠️ Заявка #{sid}: неверный код. Отправьте номер снова.")
        await cq.answer("OK"); return

    if key == "drop":
        # финальный расчёт и остановка холда
        delta = accrue_submission(sid)
        mark_hold_stop(sid)
        log(user_id, "hold_stop", f"{sid}:{delta}")
        try:
            await cq.message.edit_text(f"🔑 Код по заявке #{sid}\n👤 {user_id}\n🧩 {subm.get('code','—')}\n\nСтатус: Слёт • Начислено ${delta:.2f}")
            await cq.message.edit_reply_markup(reply_markup=None)
        except: pass
        await bot.send_message(user_id, f"⏹️ Заявка #{sid}: слёт. Начислено ${delta:.2f}. Можно отправить новый номер.")
        await cq.answer("OK"); return

# ---------- Web API ----------
SECRET = hashlib.sha256(BOT_TOKEN.encode()).digest()

def _check_init_data(init_data: str) -> dict:
    try:
        parts = dict([p.split("=", 1) for p in init_data.split("&")])
        hash_recv = parts.pop("hash", "")
        data_check = "\n".join([f"{k}={v}" for k,v in sorted(parts.items())])
        h = hmac.new(SECRET, msg=data_check.encode(), digestmod=hashlib.sha256).hexdigest()
        assert h == hash_recv
        user = json.loads(parts["user"])
        return {"id": user["id"], "username": user.get("username") or user.get("first_name","user")}
    except Exception:
        return {}

async def api_bootstrap(request: web.Request):
    body = await request.json()
    auth = _check_init_data(body.get("initData","")) if body.get("initData") else {}
    user_id = int(auth.get("id") or body["user_id"])
    username = auth.get("username") or body.get("username","user")
    upsert_user(user_id, username)
    accrue_user_active(user_id)
    st = stats(user_id) or {}
    log(user_id, "bootstrap", "")
    return web.json_response({"ok": True, "stats": st, "username": username})

async def api_submit_phone(request: web.Request):
    data = await request.json()
    user_id = int(data["user_id"]); phone = data["phone"].strip()
    upsert_user(user_id, data.get("username","user"))
    sid = create_submission(user_id, phone)
    log(user_id, "submit_phone", f"{sid}:{phone}")
    if ADMIN_CHAT_ID:
        msg = await bot.send_message(ADMIN_CHAT_ID, f"📨 Заявка #{sid}\n👤 {user_id}\n📱 {phone}", reply_markup=kb_admin_phase1(sid))
        set_submission_admin_msg_phone(sid, msg.message_id)
    return web.json_response({"ok": True, "submission_id": sid})

async def api_submit_code(request: web.Request):
    data = await request.json()
    user_id = int(data["user_id"]); sid = int(data["submission_id"]); code = data["code"].strip()
    set_submission_code(sid, code)
    log(user_id, "submit_code", f"{sid}:{code}")
    if ADMIN_CHAT_ID:
        msg = await bot.send_message(ADMIN_CHAT_ID, f"🔑 Код по заявке #{sid}\n👤 {user_id}\n🧩 {code}", reply_markup=kb_admin_phase2(sid))
        set_submission_admin_msg_code(sid, msg.message_id)
    return web.json_response({"ok": True})

async def api_stats(request: web.Request):
    q = await request.json()
    user_id=int(q["user_id"])
    accrue_user_active(user_id)
    st = stats(user_id) or {}
    return web.json_response({"ok": True, "stats": st})

async def api_logs(request: web.Request):
    q = await request.json()
    timeline = user_chat_log(int(q["user_id"]), limit=300)
    return web.json_response({"ok": True, "events": timeline})

async def api_my_numbers(request: web.Request):
    q = await request.json()
    user_id=int(q["user_id"])
    accrue_user_active(user_id)
    rows = get_user_numbers(user_id)
    return web.json_response({"ok": True, "rows": rows})

# — рулетка с минус-ожиданием
def _payout_for_user(user_id:int)->float:
    t = get_roulette_totals(user_id); loss = max(0.0, float(t["spent"] - t["won"])); r = random.random()
    if loss < 5:
        if   r < 0.85: lo,hi = 0.10,0.70
        elif r < 0.98: lo,hi = 0.70,0.99
        else:          lo,hi = 1.00,1.30
    elif loss < 20:
        if   r < 0.80: lo,hi = 0.10,0.70
        elif r < 0.98: lo,hi = 0.70,0.99
        else:          lo,hi = 1.00,1.40
    else:
        if   r < 0.74: lo,hi = 0.10,0.60
        elif r < 0.92: lo,hi = 0.60,0.95
        elif r < 0.995:lo,hi = 0.95,1.20
        else:          lo,hi = 1.20,2.00
    return round(random.uniform(lo,hi), 2)

async def api_roulette_spin(request: web.Request):
    data = await request.json()
    user_id = int(data["user_id"])
    bal = get_balance(user_id)
    if bal < 1.0:
        log(user_id, "roulette_denied", "balance<1")
        return web.json_response({"ok": False, "error": "NO_FUNDS", "balance": bal})
    add_balance(user_id, -1.0)
    win = _payout_for_user(user_id)
    add_balance(user_id, win)
    add_roulette_txn(user_id, spent=1.0, won=win)
    log(user_id, "roulette_buy", "1.0"); log(user_id, "roulette_result", f"{win}")
    return web.json_response({"ok": True, "win": win, "balance": get_balance(user_id)})

@web.middleware
async def cors_mw(request, handler):
    if request.method == "OPTIONS":
        return web.Response(headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        })
    resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "*"
    return resp

def build_app():
    app = web.Application(middlewares=[cors_mw])
    app.add_routes([
        web.post("/api/bootstrap", api_bootstrap),
        web.post("/api/submit_phone", api_submit_phone),
        web.post("/api/submit_code", api_submit_code),
        web.post("/api/stats", api_stats),
        web.post("/api/logs", api_logs),
        web.post("/api/roulette_spin", api_roulette_spin),
        web.post("/api/my_numbers", api_my_numbers),
        web.route("OPTIONS", "/api/{tail:.*}", lambda r: web.Response()),
    ])
    return app
	
// === Notify system ===
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
    el.innerHTML = `
      <div>
        ${title ? `<div class="title">${escapeHtml(title)}</div>` : ""}
        <div class="msg">${escapeHtml(msg)}</div>
      </div>
      <button class="x" aria-label="Закрыть">×</button>
    `;
    el.querySelector(".x").onclick = () => remove();
    root.appendChild(el);
    let t = setTimeout(remove, timeout);
    function remove(){ clearTimeout(t); if(el.parentNode) el.parentNode.removeChild(el); }
    return {close: remove};
  }
  function showModal({title="Сообщение", html="", onClose=null}={}){
    mTitle.textContent = title; mCont.innerHTML = html;
    modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
    mClose.onclick = ()=>{ hideModal(); onClose && onClose(); };
  }
  function hideModal(){
    modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true");
  }
  return {
    toast, info:(m,o)=>toast(m,{...o,type:"info"}),
    success:(m,o)=>toast(m,{...o,type:"success"}),
    error:(m,o)=>toast(m,{...o,type:"error"}),
    modal: showModal, close: hideModal
  };
})();

async def main():
    init_db()
    runner = web.AppRunner(build_app())
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", int(os.getenv("PORT", "8080")))
    await site.start()
    print("HTTP API on :8080")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())