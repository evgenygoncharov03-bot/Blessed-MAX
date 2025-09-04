// script.js — Blessed MAX WebApp front-end
// Требуется: перед подключением в index.html задать window.API_BASE

;(function(){
  'use strict';

  // ===== Telegram WebApp / Auth =====
  const tg = window.Telegram?.WebApp; if (tg) tg.expand();
  const qp = new URLSearchParams(location.search);
  const initData = tg?.initData || qp.get('initData') || '';
  const authUser = tg?.initDataUnsafe?.user || {};
  const USER_ID = authUser.id || Number(qp.get('user_id')) || 0;
  const USERNAME = authUser.username || authUser.first_name || qp.get('username') || 'user';

  // ===== API =====
  const API_BASE = String((window.API_BASE || '').replace(/\/$/, '')) || '';
  async function post(path, data = {}) {
    const url = API_BASE + (path.startsWith('/') ? path : '/' + path);
    const body = { ...data };
    if (initData) body.initData = initData; else { body.user_id = USER_ID; body.username = USERNAME; }
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ===== DOM =====
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
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

  function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.add('hidden'));
    const el = screens[name] || screens.menu; el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
  }

  // ===== Notify =====
  const Notify = (() => {
    const root = byId('notify-root');
    const modal = byId('notify-modal');
    const mTitle = byId('notify-title');
    const mContent = byId('notify-content');
    byId('notify-close')?.addEventListener('click', () => modal.classList.add('hidden'));

    function closeBtn(div) {
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '×';
      x.addEventListener('click', () => div.remove()); return x;
    }
    function push(title, msg, type = 'info', ttl = 4500) {
      const n = document.createElement('div'); n.className = `notif ${type}`;
      n.innerHTML = `<div><div class="title">${title || ''}</div><div class="msg">${msg || ''}</div></div>`;
      n.appendChild(closeBtn(n)); root.appendChild(n); setTimeout(() => n.remove(), ttl); return n;
    }
    function alert(title, html) {
      mTitle.textContent = title || 'Сообщение'; mContent.innerHTML = html || '';
      modal.classList.remove('hidden');
    }
    return {
      info: (m, o = {}) => push(o.title || 'Инфо', m, 'info', o.ttl || 4500),
      success: (m, o = {}) => push(o.title || 'Готово', m, 'success', o.ttl || 4500),
      error: (m, o = {}) => push(o.title || 'Ошибка', m, 'error', o.ttl || 6000),
      modal: alert,
    };
  })();

  // Ховер-подсветка кнопок
  document.addEventListener('pointermove', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.tagName === 'BUTTON') {
      const r = e.target.getBoundingClientRect();
      e.target.style.setProperty('--rx', (e.clientX - r.left) + 'px');
      e.target.style.setProperty('--ry', (e.clientY - r.top) + 'px');
    }
  });

  // ===== Bootstrap =====
  async function bootstrap() {
    try {
      const r = await post('/api/bootstrap');
      updateStats(r.stats || {});
      loadLogs();
      if (tg) document.documentElement.classList.add('tg-compact');
    } catch (err) {
      console.error(err);
      Notify.error('API недоступно. Проверь API_BASE и туннель.');
    }
  }

  function updateStats(st) {
    const box = byId('statsBox');
    const rate = st?.plan ? (st.plan === 'premium' ? 0.25 : (st.plan === 'speed' ? 0.20 : 0.18)) : 0.18;
    const balance = Number(st?.balance || 0);
    const earned = Number(st?.earned || 0);
    if (box) box.textContent = [
      `Пользователь: ${st?.username || USERNAME}`,
      `Баланс: $${balance.toFixed(2)}`,
      `Успешно: ${st?.success_count ?? 0} • Ошибок: ${st?.fail_count ?? 0}`,
      `Всего заработано: $${earned.toFixed(2)}`,
      `Тариф: ${st?.plan || 'standard'} • Ставка сейчас: $${rate.toFixed(2)}/мин`,
      `Тариф с: ${st?.plan_started || '—'} по ${st?.plan_until || '—'}`,
    ].join('\n');
    const wdBal = byId('wdBalance'); if (wdBal) wdBal.textContent = balance.toFixed(2);
  }

  // ===== Logs =====
  async function loadLogs() {
    try {
      const r = await post('/api/logs');
      const chat = byId('chat'); if (!chat) return; chat.innerHTML = '';
      (r.events || []).forEach(ev => {
        const b = document.createElement('div');
        b.className = 'bubble ' + (ev.role === 'user' ? 'b-user' : ev.role === 'admin' ? 'b-admin' : 'b-system');
        b.innerHTML = `<div>${escapeHtml(ev.text || '')}</div><div class="meta">${ev.ts || ''}</div>`;
        chat.appendChild(b);
      });
      chat.scrollTop = chat.scrollHeight;
    } catch { Notify.error('Не удалось загрузить лог'); }
  }

  // ===== Submit phone / code =====
  byId('sendPhone')?.addEventListener('click', async () => {
    const phone = String(byId('phone').value || '').trim();
    if (!phone) return Notify.error('Введите номер');
    try {
      const r = await post('/api/submit_phone', { phone });
      if (!r.ok) throw new Error(r.error || 'ERR');
      byId('codePanel').classList.remove('hidden');
      byId('codePanel').setAttribute('aria-hidden', 'false');
      Notify.success(`Заявка #${r.submission_id}. Введите код.`);
      loadLogs();
    } catch { Notify.error('Ошибка отправки номера'); }
  });

  byId('sendCode')?.addEventListener('click', async () => {
    const code = String(byId('code').value || '').trim();
    if (!code) return Notify.error('Введите код');
    try {
      const lg = await post('/api/logs');
      const last = (lg.events || []).reverse().find(e => /Заявка #\d+/.test(e.text || ''));
      const sid = last ? Number((last.text.match(/#(\d+)/) || [])[1]) : 0;
      if (!sid) return Notify.error('Не найден ID заявки');
      const r = await post('/api/submit_code', { submission_id: sid, code });
      if (!r.ok) throw new Error(r.error || 'ERR');
      Notify.success('Код отправлен'); loadLogs();
    } catch { Notify.error('Ошибка отправки кода'); }
  });

  // ===== My numbers report =====
  async function loadReport() {
    try {
      const r = await post('/api/my_numbers');
      const root = byId('reportList'); if (!root) return; root.innerHTML = '';
      (r.rows || []).forEach(row => {
        const div = document.createElement('div');
        div.className = 'contest-card';
        div.innerHTML = `
          <div class="contest-title">#${row.id} • ${escapeHtml(row.phone)}</div>
          <div class="contest-meta">
            <span>Статус: ${escapeHtml(row.status)}</span>
            <span>Минут: ${row.minutes}</span>
            <span>Начислено: $${Number(row.earned || 0).toFixed(2)}</span>
          </div>`;
        root.appendChild(div);
      });
    } catch { Notify.error('Ошибка загрузки отчёта'); }
  }

  // ===== Privileges =====
  async function loadPriv() {
    try {
      const r = await post('/api/priv/info');
      const p = r.plan || {}; const rate = r.rate || 0; const prices = r.prices || {};
      byId('privSummary').textContent =
        `Тариф: ${p.plan || 'standard'} • Ставка: $${Number(rate || 0).toFixed(2)} • Действует до: ${p.plan_until || '—'}`;
      if (prices.premium != null) byId('price-premium').textContent = `$${prices.premium}`;
      if (prices.speed != null) byId('price-speed').textContent = `$${prices.speed}`;
    } catch {}
  }
  byId('buy-premium')?.addEventListener('click', async () => {
    try {
      const r = await post('/api/priv/buy', { plan: 'premium' });
      if (!r.ok) throw new Error(r.error || 'ERR');
      Notify.success('Премиум активирован'); loadPriv();
    } catch { Notify.error('Недостаточно средств/ошибка'); }
  });
  byId('buy-speed')?.addEventListener('click', async () => {
    try {
      const r = await post('/api/priv/buy', { plan: 'speed' });
      if (!r.ok) throw new Error(r.error || 'ERR');
      Notify.success('Speed активирован'); loadPriv();
    } catch { Notify.error('Недостаточно средств/ошибка'); }
  });
  byId('std-activate')?.addEventListener('click', async () => {
    try {
      const r = await post('/api/priv/activate_standard');
      if (!r.ok) throw new Error('ERR');
      Notify.success(`Возврат на Стандарт. Рефанд: $${Number(r.refund || 0).toFixed(2)}`); loadPriv();
    } catch { Notify.error('Ошибка активации стандарта'); }
  });

  // ===== Roulette =====
  const strip = byId('case-strip');
  function buildTiles() {
    strip.innerHTML = '';
    const items = [0.10, 0.25, 0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 2.0].map(x => Number(x.toFixed(2)));
    const tiles = [];
    for (let i = 0; i < 30; i++) tiles.push(items[Math.floor(Math.random() * items.length)]);
    tiles.forEach(val => {
      const d = document.createElement('div'); d.className = 'case-tile';
      d.innerHTML = `<div class="icon">💎</div><div>x${val.toFixed(2)}</div>`;
      strip.appendChild(d);
    });
    return tiles;
  }
  async function spin() {
    try {
      const r = await post('/api/roulette_spin');
      if (!r.ok) throw new Error(r.error || 'ERR');
      buildTiles();
      const tileW = 120 + 10;
      const targetIdx = 15 + Math.floor(Math.random() * 10);
      const offset = -(targetIdx * tileW - (strip.parentElement.clientWidth / 2 - tileW / 2));
      strip.style.transition = 'transform 2.2s cubic-bezier(.15,.9,.05,1)';
      strip.style.transform = `translate3d(${offset}px,0,0)`;
      byId('ru-result').textContent =
        `Выигрыш: $${Number(r.win || 0).toFixed(2)} • Баланс: $${Number(r.balance || 0).toFixed(2)}`;
      Notify.success(`Спин: $${Number(r.win || 0).toFixed(2)}`);
    } catch (err) {
      const msg = String(err.message || '').includes('NO_FUNDS') ? 'Недостаточно средств' : 'Ошибка спина';
      Notify.error(msg);
    }
  }
  byId('ru-spin')?.addEventListener('click', spin);

  // ===== Withdraw =====
  byId('wdSend')?.addEventListener('click', async () => {
    const v = Number(byId('wdAmount').value);
    if (!(v >= 5 && v <= 100)) return Notify.error('Сумма 5–100$');
    try {
      const r = await post('/api/withdraw_request', { amount: v });
      if (!r.ok) throw new Error(r.error || 'ERR');
      Notify.success('Заявка отправлена');
    } catch (e) {
      const err = e.message || '';
      if (/PENDING_EXISTS|NO_FUNDS|AMOUNT_RANGE/.test(err)) return Notify.error(err);
      Notify.error('Ошибка заявки');
    }
  });
  byId('wdCancel')?.addEventListener('click', async () => {
    try {
      const r = await post('/api/withdraw_cancel');
      if (!r.ok) throw new Error('ERR');
      Notify.success('Заявка отменена');
    } catch { Notify.error('Отменить не удалось'); }
  });

  // ===== Contests =====
  async function loadContests() {
    try {
      const r = await post('/api/contests');
      const root = byId('contestList'); if (!root) return; root.innerHTML = '';
      (r.items || []).forEach(c => {
        const card = document.createElement('div'); card.className = 'contest-card';
        card.innerHTML = `
          <div class="contest-title">${escapeHtml(c.title)} • Приз: ${escapeHtml(c.prize)}</div>
          <div class="contest-meta">
            <span>Участников: ${c.entries || 0}</span>
            <span>Победителей: ${c.winners || 1}</span>
            <span>До: ${c.until || '—'}</span>
          </div>
          <div class="contest-actions">
            <button class="join secondary" data-id="${c.id}">Участвовать</button>
          </div>`;
        root.appendChild(card);
      });
    } catch { Notify.error('Ошибка загрузки конкурсов'); }
  }
  byId('contestList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button.join'); if (!btn) return;
    const id = Number(btn.dataset.id);
    try {
      const r = await post('/api/contest_join', { contest_id: id });
      if (!r.ok) throw new Error(r.error || 'ERR');
      btn.disabled = true; btn.textContent = 'Участвуешь';
      Notify.success('Участие подтверждено');
    } catch (err) {
      Notify.error((err.message || '').includes('ALREADY') ? 'Уже участвуешь' : 'Ошибка участия');
    }
  });

  // ===== Navigation =====
  $$('#menu [data-screen]').forEach(b => {
    b.addEventListener('click', () => {
      const name = b.getAttribute('data-screen');
      showScreen(name);
      if (name === 'stats') refreshStats();
      if (name === 'report') loadReport();
      if (name === 'priv') loadPriv();
      if (name === 'roulette') buildTiles();
      if (name === 'contests') loadContests();
      if (name === 'withdraw') refreshStats();
    });
  });
  $$('.back').forEach(b => b.addEventListener('click', () => showScreen('menu')));
  byId('refreshLogs')?.addEventListener('click', loadLogs);
  byId('reportRefresh')?.addEventListener('click', loadReport);

  async function refreshStats() {
    try { const r = await post('/api/stats'); updateStats(r.stats || {}); }
    catch {}
  }

  // ===== Utils =====
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ===== Start =====
  bootstrap();
  showScreen('menu');
})();