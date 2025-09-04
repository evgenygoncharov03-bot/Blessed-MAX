// script.js — Blessed MAX WebApp front-end
;(function(){
  'use strict';

  // Telegram WebApp / Auth
  const tg = window.Telegram?.WebApp; if (tg) tg.expand();
  const qp = new URLSearchParams(location.search);
  const initData = tg?.initData || qp.get('initData') || '';
  const authUser = tg?.initDataUnsafe?.user || {};
  const USER_ID = authUser.id || Number(qp.get('user_id')) || 0;
  const USERNAME = authUser.username || authUser.first_name || qp.get('username') || 'user';

  // ===== API_BASE: из ?api=..., иначе из localStorage. Управление через window.setApiBase() =====
  const paramBase = qp.get('api');
  const storedBase = localStorage.getItem('api_base') || '';
  let API_BASE = 'https://ware-macintosh-occasion-sewing.trycloudflare.com';

  if (paramBase) {
    API_BASE = paramBase.replace(/\/$/, '');
    localStorage.setItem('api_base', API_BASE);
    console.info('[API] from ?api=', API_BASE);
  } else if (storedBase) {
    API_BASE = storedBase.replace(/\/$/, '');
    console.info('[API] from localStorage =', API_BASE);
  } else {
    console.warn('[API] base not set. Use setApiBase("https://<тunnel>") or add ?api=');
  }

  // Позволяет задать/сменить базу без правки кода
  window.setApiBase = function(u){
    if (!/^https?:\/\//i.test(u)) { console.error('[API] bad URL:', u); return; }
    API_BASE = String(u).replace(/\/$/, '');
    localStorage.setItem('api_base', API_BASE);
    console.info('[API] set to', API_BASE);
    checkApiConnectivity();
  };

  // ===== Базовый POST =====
  async function post(path, data = {}) {
    if (!API_BASE) throw new Error('API_BASE_EMPTY');
    const url = API_BASE + (path.startsWith('/') ? path : '/' + path);
    const body = initData ? { ...data, initData } : { ...data, user_id: USER_ID, username: USERNAME };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ===== Connectivity check (лог в консоль) =====
  async function checkApiConnectivity() {
    const base = (API_BASE || '').replace(/\/$/, '');
    if (!base) { console.warn('[API CHECK] API_BASE пуст'); return { ok:false, reason:'EMPTY_BASE' }; }
    const url = base + '/api/bootstrap';

    async function fetchTO(input, init = {}, ms = 5000) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort('timeout'), ms);
      try { return await fetch(input, { ...init, signal: ctrl.signal }); }
      finally { clearTimeout(t); }
    }

    const t0 = performance.now();
    try {
      const pre = await fetchTO(url, { method:'OPTIONS' }, 4000);
      if (!pre.ok) { console.error(`[API CHECK] OPTIONS ${url} → HTTP ${pre.status}`); return { ok:false, step:'OPTIONS', status:pre.status }; }
    } catch (e) {
      console.error(`[API CHECK] OPTIONS ${url} → ${e}`); return { ok:false, step:'OPTIONS', err:String(e) };
    }

    try {
      const body = initData ? { initData } : { user_id: USER_ID || 1, username: USERNAME || 'user' };
      const r = await fetchTO(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }, 6000);
      const dt = Math.round(performance.now() - t0);
      let js = null; try { js = await r.clone().json(); } catch {}
      if (r.ok && js && js.ok) { console.info(`[API OK] ${base} • ${dt}ms`); return { ok:true, ms:dt, status:r.status }; }
      console.warn(`[API FAIL] ${base} • HTTP ${r.status} • body=${JSON.stringify(js)}`); return { ok:false, step:'POST', status:r.status, body:js };
    } catch (e) {
      console.error(`[API DOWN] ${base} • ${e}`); return { ok:false, step:'POST', err:String(e) };
    }
  }
  window.checkApiConnectivity = checkApiConnectivity;

  // ===== DOM =====
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const byId = id => document.getElementById(id);

  const screens = {
    menu: byId('menu'),
    stats: byId('screen-stats'),
    submit: byId('screen-submit'),
    report: byId('screen-report'),
    priv: byId('screen-priv'),
    roulette: byId('screen-roulette'),
    contests: byId('screen-contests'),
    withdraw: byId('screen-withdraw'),
  };
  function showScreen(name){ Object.values(screens).forEach(el=>el.classList.add('hidden')); (screens[name]||screens.menu).classList.remove('hidden'); }

  // Notify
  const Notify = (() => {
    const root = byId('notify-root'), modal = byId('notify-modal');
    const mTitle = byId('notify-title'), mContent = byId('notify-content');
    byId('notify-close')?.addEventListener('click', () => modal.classList.add('hidden'));
    function closeBtn(div){ const x=document.createElement('button'); x.className='x'; x.textContent='×'; x.onclick=()=>div.remove(); return x; }
    function push(title,msg,type='info',ttl=4500){ const n=document.createElement('div'); n.className=`notif ${type}`; n.innerHTML=`<div><div class="title">${title||''}</div><div class="msg">${msg||''}</div></div>`; n.appendChild(closeBtn(n)); root.appendChild(n); setTimeout(()=>n.remove(),ttl); return n; }
    return { info:(m,o={})=>push(o.title||'Инфо',m,'info',o.ttl||4500), success:(m,o={})=>push(o.title||'Готово',m,'success',o.ttl||4500), error:(m,o={})=>push(o.title||'Ошибка',m,'error',o.ttl||6000), modal:(t,h)=>{mTitle.textContent=t||'Сообщение'; mContent.innerHTML=h||''; modal.classList.remove('hidden');} };
  })();

  // Hover glow
  document.addEventListener('pointermove',(e)=>{ if(e.target?.tagName==='BUTTON'){ const r=e.target.getBoundingClientRect(); e.target.style.setProperty('--rx', (e.clientX-r.left)+'px'); e.target.style.setProperty('--ry',(e.clientY-r.top)+'px'); }});

  // Bootstrap + автопроверка
  checkApiConnectivity();
  async function bootstrap(){
    try{
      const r = await post('/api/bootstrap');
      updateStats(r.stats||{}); loadLogs(); if (tg) document.documentElement.classList.add('tg-compact');
    }catch(e){ console.error(e); Notify.error('API недоступно. Проверь API_BASE и туннель.'); }
  }

  function updateStats(st){
    const box = byId('statsBox');
    const rate = st?.plan==='premium'?0.25:st?.plan==='speed'?0.20:0.18;
    const balance = Number(st?.balance||0), earned = Number(st?.earned||0);
    if(box) box.textContent = [
      `Пользователь: ${st?.username||USERNAME}`,
      `Баланс: $${balance.toFixed(2)}`,
      `Успешно: ${st?.success_count??0} • Ошибок: ${st?.fail_count??0}`,
      `Всего заработано: $${earned.toFixed(2)}`,
      `Тариф: ${st?.plan||'standard'} • Ставка сейчас: $${rate.toFixed(2)}/мин`,
      `Тариф с: ${st?.plan_started||'—'} по ${st?.plan_until||'—'}`
    ].join('\n');
    const wdBal = byId('wdBalance'); if (wdBal) wdBal.textContent = balance.toFixed(2);
  }

  async function loadLogs(){
    try{
      const r = await post('/api/logs');
      const chat = byId('chat'); if(!chat) return; chat.innerHTML='';
      (r.events||[]).forEach(ev=>{
        const b=document.createElement('div'); b.className='bubble ' + (ev.role==='user'?'b-user':ev.role==='admin'?'b-admin':'b-system');
        b.innerHTML = `<div>${escapeHtml(ev.text||'')}</div><div class="meta">${ev.ts||''}</div>`;
        chat.appendChild(b);
      });
      chat.scrollTop = chat.scrollHeight;
    }catch{ Notify.error('Не удалось загрузить лог'); }
  }

  byId('sendPhone')?.addEventListener('click', async ()=>{
    const phone = String(byId('phone').value||'').trim();
    if(!phone) return Notify.error('Введите номер');
    try{
      const r = await post('/api/submit_phone',{ phone });
      if(!r.ok) throw new Error(r.error||'ERR');
      byId('codePanel').classList.remove('hidden');
      Notify.success(`Заявка #${r.submission_id}. Введите код.`); loadLogs();
    }catch{ Notify.error('Ошибка отправки номера'); }
  });

  byId('sendCode')?.addEventListener('click', async ()=>{
    const code = String(byId('code').value||'').trim();
    if(!code) return Notify.error('Введите код');
    try{
      const lg = await post('/api/logs');
      const last = (lg.events||[]).reverse().find(e=>/Заявка #\d+/.test(e.text||'')); const sid = last? Number((last.text.match(/#(\d+)/)||[])[1]) : 0;
      if(!sid) return Notify.error('Не найден ID заявки');
      const r = await post('/api/submit_code',{ submission_id:sid, code });
      if(!r.ok) throw new Error(r.error||'ERR');
      Notify.success('Код отправлен'); loadLogs();
    }catch{ Notify.error('Ошибка отправки кода'); }
  });

  async function loadReport(){
    try{
      const r = await post('/api/my_numbers');
      const root = byId('reportList'); if(!root) return; root.innerHTML='';
      (r.rows||[]).forEach(row=>{
        const div=document.createElement('div'); div.className='contest-card';
        div.innerHTML = `<div class="contest-title">#${row.id} • ${escapeHtml(row.phone)}</div>
          <div class="contest-meta"><span>Статус: ${escapeHtml(row.status)}</span>
          <span>Минут: ${row.minutes}</span>
          <span>Начислено: $${Number(row.earned||0).toFixed(2)}</span></div>`;
        root.appendChild(div);
      });
    }catch{ Notify.error('Ошибка загрузки отчёта'); }
  }

  async function loadPriv(){
    try{
      const r = await post('/api/priv/info');
      const p=r.plan||{}, rate=r.rate||0, prices=r.prices||{};
      byId('privSummary').textContent = `Тариф: ${p.plan||'standard'} • Ставка: $${Number(rate).toFixed(2)} • Действует до: ${p.plan_until||'—'}`;
      if (prices.premium!=null) byId('price-premium').textContent = `$${prices.premium}`;
      if (prices.speed!=null)   byId('price-speed').textContent   = `$${prices.speed}`;
    }catch{}
  }
  byId('buy-premium')?.addEventListener('click', async ()=>{
    try{ const r = await post('/api/priv/buy',{ plan:'premium' }); if(!r.ok) throw 0; Notify.success('Премиум активирован'); loadPriv(); }
    catch{ Notify.error('Недостаточно средств/ошибка'); }
  });
  byId('buy-speed')?.addEventListener('click', async ()=>{
    try{ const r = await post('/api/priv/buy',{ plan:'speed' }); if(!r.ok) throw 0; Notify.success('Speed активирован'); loadPriv(); }
    catch{ Notify.error('Недостаточно средств/ошибка'); }
  });
  byId('std-activate')?.addEventListener('click', async ()=>{
    try{ const r = await post('/api/priv/activate_standard'); if(!r.ok) throw 0; Notify.success(`Возврат на Стандарт. Рефанд: $${Number(r.refund||0).toFixed(2)}`); loadPriv(); }
    catch{ Notify.error('Ошибка активации стандарта'); }
  });

  // Roulette
  const strip = document.getElementById('case-strip');
  function buildTiles(){ if(!strip) return; strip.innerHTML=''; const items=[0.10,0.25,0.5,0.7,0.9,1.0,1.1,1.2,1.3,1.4,1.6,2.0]; for(let i=0;i<30;i++){ const val=items[Math.random()*items.length|0]; const d=document.createElement('div'); d.className='case-tile'; d.innerHTML=`<div class="icon">💎</div><div>x${val.toFixed(2)}</div>`; strip.appendChild(d);} }
  async function spin(){
    try{
      const r = await post('/api/roulette_spin'); if(!r.ok) throw 0;
      buildTiles(); const tileW=130; const targetIdx=15 + (Math.random()*10|0);
      const offset = -(targetIdx*tileW - (strip.parentElement.clientWidth/2 - tileW/2));
      strip.style.transition='transform 2.2s cubic-bezier(.15,.9,.05,1)'; strip.style.transform=`translate3d(${offset}px,0,0)`;
      document.getElementById('ru-result').textContent = `Выигрыш: $${Number(r.win||0).toFixed(2)} • Баланс: $${Number(r.balance||0).toFixed(2)}`;
      Notify.success(`Спин: $${Number(r.win||0).toFixed(2)}`);
    }catch{ Notify.error('Ошибка спина'); }
  }
  document.getElementById('ru-spin')?.addEventListener('click', spin);

  // Withdraw
  document.getElementById('wdSend')?.addEventListener('click', async ()=>{
    const v = Number(document.getElementById('wdAmount').value);
    if(!(v>=5 && v<=100)) return Notify.error('Сумма 5–100$');
    try{ const r=await post('/api/withdraw_request',{ amount:v }); if(!r.ok) throw 0; Notify.success('Заявка отправлена'); }
    catch(e){ Notify.error('Ошибка заявки'); }
  });
  document.getElementById('wdCancel')?.addEventListener('click', async ()=>{
    try{ const r=await post('/api/withdraw_cancel'); if(!r.ok) throw 0; Notify.success('Заявка отменена'); }
    catch{ Notify.error('Отменить не удалось'); }
  });

  // Contests
  async function loadContests(){
    try{
      const r = await post('/api/contests'); const root=document.getElementById('contestList'); if(!root) return; root.innerHTML='';
      (r.items||[]).forEach(c=>{
        const card=document.createElement('div'); card.className='contest-card';
        card.innerHTML = `<div class="contest-title">${escapeHtml(c.title)} • Приз: ${escapeHtml(c.prize)}</div>
          <div class="contest-meta"><span>Участников: ${c.entries||0}</span><span>Победителей: ${c.winners||1}</span><span>До: ${c.until||'—'}</span></div>
          <div class="contest-actions"><button class="join secondary" data-id="${c.id}">Участвовать</button></div>`;
        root.appendChild(card);
      });
    }catch{ Notify.error('Ошибка загрузки конкурсов'); }
  }
  document.getElementById('contestList')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button.join'); if(!btn) return; const id=Number(btn.dataset.id);
    try{ const r=await post('/api/contest_join',{ contest_id:id }); if(!r.ok) throw 0; btn.disabled=true; btn.textContent='Участвуешь'; Notify.success('Участие подтверждено'); }
    catch(err){ Notify.error('Ошибка участия'); }
  });

  // Navigation
  Array.from(document.querySelectorAll('#menu [data-screen]')).forEach(b=>{
    b.addEventListener('click', ()=>{
      const name=b.getAttribute('data-screen'); showScreen(name);
      if(name==='stats') (async()=>{ try{ const r=await post('/api/stats'); updateStats(r.stats||{});}catch{}})();
      if(name==='report') loadReport();
      if(name==='priv')   loadPriv();
      if(name==='roulette') buildTiles();
      if(name==='contests') loadContests();
      if(name==='withdraw') (async()=>{ try{ const r=await post('/api/stats'); updateStats(r.stats||{});}catch{}})();
    });
  });
  Array.from(document.querySelectorAll('.back')).forEach(b=>b.addEventListener('click',()=>showScreen('menu')));

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

  // Start
  bootstrap();
  showScreen('menu');
})();
