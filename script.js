// script.js — Telegram WebApp фронт для Blessed MAX
// Под твой сервер: POST JSON на /api/*, CORS включён на бэке
;(function(){
  'use strict';

  // === Конфиг ===
  const API_BASE = 'https://earning-attitude-hunt-wrote.trycloudflare.com'.replace(/\/$/,'');
  const tg = window.Telegram?.WebApp;
  if (tg) tg.expand();

  // initData из Telegram или параметры dev-режима
  const qp = new URLSearchParams(location.search);
  const initData = tg?.initData || qp.get('initData') || '';
  const userUnsafe = tg?.initDataUnsafe?.user || {};
  const USER_ID = userUnsafe.id || Number(qp.get('user_id')) || 1;
  const USERNAME = userUnsafe.username || userUnsafe.first_name || qp.get('username') || 'user';

  // === Утилиты DOM ===
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const byId = (id) => document.getElementById(id);

  // Нотифай
  const notifyRoot = byId('notify-root');
  function toast(type, title, msg, ms=3000){
    if(!notifyRoot) return;
    const el = document.createElement('div');
    el.className = `notif ${type||'info'}`;
    el.innerHTML = `<div><div class="title">${title||'Сообщение'}</div><div class="msg">${msg||''}</div></div><button class="x" aria-label="Закрыть">✕</button>`;
    notifyRoot.appendChild(el);
    const hide = ()=>{ el.remove(); };
    el.querySelector('.x').onclick = hide;
    setTimeout(hide, ms);
  }
  function modal(title, content){
    const dlg = byId('notify-modal'); if(!dlg) return;
    byId('notify-title').textContent = title||'';
    byId('notify-content').textContent = content||'';
    dlg.classList.remove('hidden');
    byId('notify-close').onclick = ()=> dlg.classList.add('hidden');
  }

  // Риппл подсветка на кнопках
  document.addEventListener('pointermove',(e)=>{
    const b = e.target?.closest('button'); if(!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--rx', (e.clientX-r.left)+'px');
    b.style.setProperty('--ry', (e.clientY-r.top)+'px');
  });

  // === HTTP ===
  async function post(path, data={}){
    const url = API_BASE + (path.startsWith('/')?path:'/'+path);
    const body = initData ? { ...data, initData } : { ...data, user_id: USER_ID, username: USERNAME };
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    let j=null;
    try{ j = await res.json(); }catch(e){}
    if(!res.ok || !j || j.ok === false){
      const err = (j && (j.error||j.message)) || `HTTP ${res.status}`;
      throw new Error(err);
    }
    return j;
  }

  // Быстрый чек доступности API
  async function checkApi(){
    try{
      const r = await post('/api/bootstrap', {}); // сервер заполнит stats и username
      console.info('[API] OK', r);
      return true;
    }catch(e){
      console.error('[API] FAIL', e);
      toast('error','API недоступно','Проверь API_BASE и туннель', 4000);
      return false;
    }
  }

  // === Навигация ===
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
    Object.values(SCREENS).forEach(el=> el && el.classList.add('hidden'));
    (SCREENS[id]||SCREENS.menu)?.classList.remove('hidden');
  }
  $$('#menu [data-screen]').forEach(b=> b.addEventListener('click', ()=>{
    const s = b.getAttribute('data-screen');
    show(s);
    if(s==='stats') loadStats();
    if(s==='report') loadReport();
    if(s==='priv')   loadPriv();
    if(s==='roulette') setupRouletteOnce();
    if(s==='contests') loadContests();
    if(s==='withdraw') refreshBalance();
  }));
  $$('.back').forEach(b=> b.addEventListener('click', ()=> show('menu')));

  // === Чат-лог ===
  const chatBox = byId('chat');
  function pushBubble(role, text, ts){
    if(!chatBox) return;
    const el = document.createElement('div');
    el.className = `bubble ${role==='admin'?'b-admin': role==='user'?'b-user':'b-system'}`;
    el.innerHTML = `${text}<div class="meta">${ts||''}</div>`;
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  async function loadLogs(){
    try{
      const r = await post('/api/logs', {});
      if(chatBox) chatBox.innerHTML = '';
      (r.events||[]).forEach(e=> pushBubble(e.role, e.text, e.ts));
    }catch(e){
      console.warn('logs', e);
    }
  }
  byId('refreshLogs')?.addEventListener('click', loadLogs);

  // === Статистика ===
  async function loadStats(){
    const pre = byId('statsBox');
    try{
      const r = await post('/api/stats', {});
      pre && (pre.textContent = JSON.stringify(r.stats||{}, null, 2));
    }catch(e){
      pre && (pre.textContent = 'Ошибка загрузки статистики');
    }
  }

  // === Сдача MAX (телефон + код) ===
  let currentSubmissionId = 0;
  const phoneInput = byId('phone');
  const codePanel  = byId('codePanel');
  const codeInput  = byId('code');

  byId('sendPhone')?.addEventListener('click', async ()=>{
    const phone = (phoneInput?.value||'').trim();
    if(!phone){ return toast('error','Номер','Введите номер телефона'); }
    try{
      const r = await post('/api/submit_phone', { phone });
      currentSubmissionId = r.submission_id||0;
      codePanel?.classList.remove('hidden');
      toast('success','Отправлено','Ждём код из SMS');
      loadLogs();
    }catch(e){
      toast('error','Ошибка', String(e.message||e));
    }
  });

  byId('sendCode')?.addEventListener('click', async ()=>{
    const code = (codeInput?.value||'').trim();
    if(!currentSubmissionId || !code){ return toast('error','Код','Введите код из SMS'); }
    try{
      await post('/api/submit_code', { submission_id: currentSubmissionId, code });
      toast('success','Код принят','Ожидайте подтверждения');
      loadLogs();
    }catch(e){
      toast('error','Ошибка', String(e.message||e));
    }
  });

  // === Мои номера (отчёт) ===
  async function loadReport(){
    const box = byId('reportList');
    if(!box) return;
    box.innerHTML = '';
    try{
      const r = await post('/api/my_numbers', {});
      (r.rows||[]).forEach(row=>{
        const div = document.createElement('div');
        div.className = 'contest-card';
        div.innerHTML = `
          <div class="contest-title">#${row.id} • ${row.phone||'—'}</div>
          <div class="contest-meta">
            <span>Статус: <b>${row.status}</b></span>
            <span>Минут: <b>${row.minutes}</b></span>
            <span>Начислено: <b>$${Number(row.earned||0).toFixed(2)}</b></span>
          </div>`;
        box.appendChild(div);
      });
    }catch(e){
      box.textContent = 'Ошибка загрузки отчёта';
    }
  }
  byId('reportRefresh')?.addEventListener('click', loadReport);

  // === Привилегии ===
  async function loadPriv(){
    const sum = byId('privSummary');
    try{
      const r = await post('/api/priv/info', {});
      const plan = r.plan?.plan||'standard';
      const until = r.plan?.plan_until||'—';
      const rate = r.rate!=null? `$${Number(r.rate).toFixed(2)}` : '—';
      sum && (sum.textContent = `Тариф: ${plan} • Ставка: ${rate} • Действует до: ${until}`);
      const prices = r.prices||{};
      byId('price-premium') && (byId('price-premium').textContent = `$${prices.premium||40}`);
      byId('price-speed')   && (byId('price-speed').textContent   = `$${prices.speed||30}`);
    }catch(e){
      sum && (sum.textContent = 'Ошибка загрузки тарифов');
    }
  }
  byId('buy-premium')?.addEventListener('click', async ()=>{
    try{
      const r = await post('/api/priv/buy', { plan:'premium' });
      toast('success','Тариф','Премиум активирован');
      loadPriv();
    }catch(e){ toast('error','Покупка', String(e.message||e)); }
  });
  byId('buy-speed')?.addEventListener('click', async ()=>{
    try{
      const r = await post('/api/priv/buy', { plan:'speed' });
      toast('success','Тариф','Speed активирован');
      loadPriv();
    }catch(e){ toast('error','Покупка', String(e.message||e)); }
  });
  byId('std-activate')?.addEventListener('click', async ()=>{
    try{
      const r = await post('/api/priv/activate_standard', {});
      toast('success','Стандарт','Возврат выполнен');
      loadPriv();
    }catch(e){ toast('error','Стандарт', String(e.message||e)); }
  });

  // === Рулетка ===
  const strip = byId('case-strip');
  let rouletteReady = false;
  function setupRouletteOnce(){
    if(rouletteReady || !strip) return;
    rouletteReady = true;
    const items = [
      {t:'$0.10',i:'💠'},{t:'$0.20',i:'🪙'},{t:'$0.50',i:'💎'},{t:'$0.00',i:'❌'},
      {t:'$0.30',i:'🔹'},{t:'$0.70',i:'🔷'},{t:'$1.20',i:'⭐'},{t:'$0.95',i:'✨'}
    ];
    for(let k=0;k<18;k++){
      const it = items[k%items.length];
      const tile = document.createElement('div');
      tile.className = 'case-tile';
      tile.innerHTML = `<div class="icon">${it.i}</div>${it.t}`;
      strip.appendChild(tile);
    }
  }
  async function spin(){
    try{
      const r = await post('/api/roulette_spin', {});
      const win = Number(r.win||0);
      byId('ru-result') && (byId('ru-result').textContent = `Выигрыш: $${win.toFixed(2)} • Баланс: $${Number(r.balance||0).toFixed(2)}`);
      // простая анимация: прокрутка на случайную позицию
      const w = strip.scrollWidth; strip.style.transform = 'translateX(0)';
      const shift = -Math.floor(Math.random()*(w-300));
      strip.animate([{transform:'translateX(0px)'},{transform:`translateX(${shift}px)`}], {duration:900, easing:'cubic-bezier(.2,.8,.2,1)', fill:'forwards'});
      loadLogs();
    }catch(e){
      toast('error','Рулетка', String(e.message||e));
    }
  }
  byId('ru-spin')?.addEventListener('click', spin);

  // === Вывод средств ===
  async function refreshBalance(){
    try{
      const r = await post('/api/stats', {});
      const bal = Number(r.stats?.balance||0);
      byId('wdBalance') && (byId('wdBalance').textContent = bal.toFixed(2));
    }catch(e){}
  }
  byId('wdSend')?.addEventListener('click', async ()=>{
    const amt = Number(byId('wdAmount')?.value||0);
    if(!(amt>=5 && amt<=100)) return toast('error','Сумма','Допустимо 5–100$');
    try{
      const r = await post('/api/withdraw_request', { amount: amt });
      toast('success','Заявка создана', `ID ${r.payout_id}`);
      refreshBalance(); loadLogs();
    }catch(e){ toast('error','Вывод', String(e.message||e)); }
  });
  byId('wdCancel')?.addEventListener('click', async ()=>{
    try{
      const r = await post('/api/withdraw_cancel', {});
      toast(r.ok?'success':'error', r.ok?'Отменено':'Ошибка', r.ok?'Заявка отменена':'Нет активной заявки');
      refreshBalance(); loadLogs();
    }catch(e){ toast('error','Отмена', String(e.message||e)); }
  });

  // === Конкурсы ===
  async function loadContests(){
    const list = byId('contestList'); if(!list) return;
    list.innerHTML = '';
    try{
      const r = await post('/api/contests', {});
      (r.items||[]).forEach(c=>{
        const card = document.createElement('div');
        card.className = 'contest-card';
        card.innerHTML = `
          <div class="contest-title">${c.title}</div>
          <div class="contest-meta">
            <span>Приз: <b>${c.prize}</b></span>
            <span>Победителей: <b>${c.winners}</b></span>
            <span>До: <b>${c.until||'—'}</b></span>
            <span>Участников: <b>${c.entries}</b></span>
          </div>
          <div class="contest-actions">
            <button class="secondary" data-join="${c.id}">Участвовать</button>
          </div>`;
        list.appendChild(card);
      });
    }catch(e){
      list.textContent = 'Ошибка загрузки конкурсов';
    }
  }
  byId('contestList')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('[data-join]'); if(!btn) return;
    const cid = Number(btn.getAttribute('data-join'));
    try{
      await post('/api/contest_join', { contest_id: cid });
      toast('success','Конкурс','Заявка отправлена');
      loadContests();
    }catch(err){ toast('error','Конкурс', String(err.message||err)); }
  });

  // === Старт ===
  (async function init(){
    show('menu');
    await checkApi();
    await loadStats();
    await loadLogs();
  })();
})();
