/* 公司後勤 APP｜畫面
 * 左側目錄、右側操作頁。所有資料變更都經過 LeiyiFlows（資料通道）與 LeiyiStore（資料層）。
 */
(function () {
  const L = window.LEIYI;
  const { Store } = window.LeiyiStore;
  const FL = window.LeiyiFlows;
  const SY = window.LeiyiSync;
  const did = (r) => Store.dispId(r);
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- 小工具 ----------
  // 畫面元件只要遇到「沒有東西」(null/undefined/false) 就略過，不會變成「null」字樣
  for (const k of ['append', 'replaceChildren', 'prepend']) {
    const orig = Element.prototype[k];
    Element.prototype[k] = function (...xs) { return orig.apply(this, xs.filter((x) => x !== null && x !== undefined && x !== false)); };
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const optLabel = (o) => (L.OPTION_LABELS && L.OPTION_LABELS[o] ? `${o} ${L.OPTION_LABELS[o]}` : o);
  // 下拉選單裡多加白話說明
  const optText = (o) => { const t = optLabel(o); const tip = L.OPTION_TIPS && L.OPTION_TIPS[o]; return tip ? `${t}（${tip}）` : t; };
  const plainOf = (f) => f.hint || (L.FIELD_PLAIN && L.FIELD_PLAIN[f.key]) || '';
  const money = (v) => `NT$${Math.round(Number(v) || 0).toLocaleString()}`;
  const cfg = () => Store.data.settings;
  const modById = (id) => L.MODULES.find((m) => m.id === id);
  const visible = (m) => !(m.phase === 3 && !cfg().enableHR);
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    document.body.append(t); setTimeout(() => t.remove(), 2600);
  }
  let busy = false;
  // 按鈕專用：執行中鎖住所有動作，避免連點重複送出
  async function lock(fn) {
    if (busy) return undefined;
    busy = true; document.body.classList.add('busy');
    try { return await guard(fn); } finally { busy = false; document.body.classList.remove('busy'); }
  }
  async function guard(fn) {
    try { return await fn(); } catch (e) {
      if (e instanceof window.UserError) toast(e.message, true);
      else { console.error(e); toast(`發生錯誤：${e && e.message ? e.message : e}`, true); }
      return undefined;
    }
  }

  // 下拉選項：支援 { cfg: 'lines' } 從設定讀取，並確保目前的值一定在清單中
  function optionsOf(f, rec) {
    let opts = Array.isArray(f.options) ? f.options.slice() : (f.options && f.options.cfg ? (cfg()[f.options.cfg] || []).slice() : []);
    if (f.optionsBy && rec) {
      const by = f.optionsBy.map[rec[f.optionsBy.field]];
      if (by) opts = opts.filter(by);
    }
    const cur = rec ? rec[f.key] : '';
    if (cur && !opts.includes(cur)) opts.push(cur);
    return opts;
  }

  const ctx = {
    get cfg() { return cfg(); },
    rollup(r, from, via, fn) {
      return Store.list(from).filter((x) => x[via] === r._id && x.狀態 !== '封存').reduce((s, x) => s + fn(x), 0);
    }
  };
  function valueOf(m, f, r) {
    if (f.type === 'formula') return f.fn(r, ctx);
    if (f.type === 'rollup') return ctx.rollup(r, f.from, f.via, f.sum);
    return r[f.key];
  }
  function display(m, f, r) {
    const v = valueOf(m, f, r);
    if (v === undefined || v === null || v === '') return '';
    if (f.type === 'checkbox') return v ? '✔' : '';
    if (f.type === 'select') return optLabel(String(v));
    if (f.type === 'money' || f.format === 'money') return money(v);
    if (f.type === 'relation') { const t = Store.get(f.module, v); const tm = modById(f.module); return t ? `${did(t)} ${t[tm.titleKey] || ''}` : ''; }
    if (f.type === 'link') { const t = FL.resolve(v); return t ? `${t.mod.title}｜${t.rec[t.mod.titleKey] || did(t.rec)}` : ''; }
    return String(v);
  }

  // ---------- 路由 ----------
  const state = { route: 'home', open: null, filters: {}, showArchived: false, search: '', sort: null };
  function go(route, open) {
    state.route = route; state.open = open || null; state.search = '';
    location.hash = `#/${route}${open ? '/' + open : ''}`;
    render();
  }
  window.addEventListener('hashchange', () => {
    const [, r, o] = location.hash.split('/');
    if (r && (r !== state.route || (o || null) !== state.open)) { state.route = modById(r) ? r : 'home'; state.open = o || null; render(); }
  });

  // ---------- 外框 ----------
  function sidebar() {
    const groups = [];
    for (const m of L.MODULES) {
      if (!visible(m)) continue;
      let g = groups.find((x) => x.name === m.group);
      if (!g) groups.push((g = { name: m.group, items: [] }));
      g.items.push(m);
    }
    const counts = { pending: openCount('pending'), inbox: openCount('inbox') };
    return h('nav', { class: 'side' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-name' }, cfg().companyName || '公司後勤 APP'), h('div', { class: 'brand-sub' }, '後勤中心')),
      groups.map((g) => h('div', { class: 'grp' },
        h('div', { class: 'grp-title' }, g.name),
        g.items.map((m) => h('button', { class: 'nav' + (state.route === m.id ? ' on' : ''), 'data-nav': m.id, onclick: () => go(m.id) },
          h('span', { class: 'ico' }, m.icon), h('span', { class: 'lbl' }, m.title),
          counts[m.id] ? h('span', { class: 'badge' }, counts[m.id]) : null)))),
      h('div', { class: 'side-foot' }, `使用者：${cfg().currentUser || '未設定'}`,
        updateBox(),
        cfg().mode === 'notion' ? h('button', { class: 'sync-st ' + SY.status.state, id: 'sync-status', title: SY.status.message, onclick: () => go('settings') }, syncLabel()) : null)
    );
  }
  function syncLabel() {
    const st = SY.status; const q = Store.data.sync.queue.length;
    const t = { syncing: '⟳ 同步中', ok: '● Notion 已同步', warn: '▲ 同步有問題', offline: '○ 離線（先存本機）', error: '✕ 同步失敗', idle: '○ Notion' }[st.state] || '○ Notion';
    return q && st.state !== 'syncing' ? `${t}・${q} 筆待上傳` : t;
  }
  const openCount = (id) => Store.list(id).filter((r) => !['完成', '封存'].includes(r.狀態)).length;

  function render() {
    document.querySelectorAll('.drawer-bg').forEach((d) => d.remove());
    const root = $('#app');
    root.replaceChildren();
    if (!cfg().companyName) { root.append(setupScreen()); return; }
    const m = modById(state.route) || modById('home');
    const page = h('main', { class: 'page' });
    root.append(sidebar(), page);
    const head = h('header', { class: 'page-head' }, h('h1', {}, `${m.icon} ${m.title}`), m.desc ? h('p', { class: 'desc' }, m.desc) : null);
    page.append(head);
    const body = h('section', { class: 'page-body' });
    page.append(body);
    const view = { dashboard: dashboard, table: tablePage, tax: taxPage, placeholder: placeholderPage, calendar: calendarPage, rules: rulesPage, tools: toolsPage, settings: settingsPage }[m.kind];
    body.append(view(m));
    if (m.kind === 'table' && state.open) openDrawer(m, state.open === 'new' ? null : state.open);
  }

  // ---------- 第一次使用 ----------
  function setupScreen() {
    const name = h('input', { type: 'text', id: 'setup-name', placeholder: '例如：○○有限公司', maxlength: 60 });
    const tax = h('input', { type: 'text', id: 'setup-tax', placeholder: '8 碼，可之後再填', maxlength: 8, inputmode: 'numeric' });
    const user = h('input', { type: 'text', id: 'setup-user', placeholder: '例如：老闆', maxlength: 20 });
    return h('div', { class: 'setup' }, h('div', { class: 'setup-card' },
      h('h1', {}, '歡迎使用公司後勤 APP'),
      h('p', {}, '先填公司名稱就能開始，其他都可以之後在「設定」裡改。'),
      h('label', {}, '公司名稱（必填）', name),
      h('label', {}, '統一編號', tax),
      h('label', {}, '你的稱呼（會記在處理紀錄）', user),
      h('button', { class: 'btn primary', id: 'setup-go', onclick: () => guard(async () => {
        const n = name.value.trim(); if (!n) throw new UserError('請填公司名稱');
        const t = tax.value.trim(); if (t && !/^\d{8}$/.test(t)) throw new UserError('統一編號要是 8 碼數字');
        const u = user.value.trim() || '負責人';
        cfg().companyName = n; cfg().taxId = t; cfg().currentUser = u;
        if (!cfg().people.includes(u)) cfg().people.unshift(u);
        await Store.save(); go('home');
      }) }, '開始使用')));
  }

  // ---------- 首頁總覽 ----------
  function dashboard() {
    const month = FL.today().slice(0, 7);
    const ledger = Store.list('ledger').filter((r) => r.狀態 !== '封存');
    const conf = ledger.filter((r) => r.已確認 && L.F.月份鍵(r) === month);
    const inc = conf.reduce((s, r) => s + L.F.收入額(r), 0);
    const exp = conf.reduce((s, r) => s + L.F.支出額(r), 0);
    const unconf = ledger.filter((r) => !r.已確認).length;
    const td = FL.today();
    const overdue = ledger.filter((r) => r.收付款狀態 === '未收' && r.應收到期日 && r.應收到期日 < td).length;
    const projects = Store.list('projects').filter((r) => !['完成', '封存'].includes(r.狀態));
    const pm = modById('projects');
    const stale = projects.filter((r) => valueOf(pm, pm.fields.find((f) => f.key === '停滯'), r));
    const soon = projects.filter((r) => r.截止日 && r.截止日 <= FL.addDays(td, 3)).sort((a, b) => a.截止日.localeCompare(b.截止日));
    const big = projects.filter((r) => r.規模 === '大').length;
    const pend = Store.list('pending').filter((r) => !['完成', '封存'].includes(r.狀態)).sort((a, b) => (a._created || '').localeCompare(b._created || ''));

    const tasks = Store.list('tasks').filter((r) => r.狀態 !== '完成' && r.狀態 !== '封存');
    const top3 = tasks.filter((r) => r.今天三件);
    const todayTasks = tasks.filter((r) => !r.今天三件 && r.安排日期 && r.安排日期 <= td).sort((a, b) => a.安排日期.localeCompare(b.安排日期));
    const tm = modById('tasks');
    const kpi = (label, val, route, warn) => h('button', { class: 'kpi' + (warn ? ' warn' : ''), onclick: () => go(route) }, h('div', { class: 'kpi-v' }, val), h('div', { class: 'kpi-l' }, label));
    const mini = (title, rows, m, extra) => h('div', { class: 'card' }, h('h3', {}, title),
      rows.length ? h('ul', { class: 'mini' }, rows.slice(0, 6).map((r) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(m.id, r._id); } }, `${did(r)} ${r[m.titleKey] || ''}`), extra ? h('span', { class: 'muted' }, extra(r)) : null))) : h('p', { class: 'muted' }, '無'));
    return h('div', {},
      h('div', { class: 'kpis' },
        kpi('待確認', pend.length, 'pending', pend.length > 0),
        kpi('收件匣待分派', openCount('inbox'), 'inbox'),
        kpi('進行中專案', projects.length, 'projects', big > cfg().maxBigProjects),
        kpi('停滯專案', stale.length, 'projects', stale.length > 0),
        kpi(`本月收入（已確認）`, money(inc), 'ledger'),
        kpi(`本月支出（已確認）`, money(exp), 'ledger'),
        kpi('帳務未確認', unconf, 'ledger', unconf > 0),
        kpi('應收逾期', overdue, 'ledger', overdue > 0)),
      big > cfg().maxBigProjects ? h('div', { class: 'alert' }, `大專案有 ${big} 個，超過上限 ${cfg().maxBigProjects} 個，建議暫停其中一個。`) : null,
      h('div', { class: 'cards' },
        calNative() ? (() => {
          const t0 = dayStart(new Date()); const t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
          const evs = eventsBetween(t0, t1, true);
          return h('div', { class: 'card', id: 'today-cal' }, h('h3', {}, '今天行程'),
            evs.length ? h('ul', { class: 'evs' }, evs.map(eventLine)) : h('p', { class: 'muted' }, Object.keys(calCache()).length ? '今天沒有行程' : '還沒接 Google 日曆（到設定加入）'),
            h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('calendar'); } }, '看兩週行程 →'));
        })() : null,
        mini('今天三件', top3, tm, (r) => r.狀態),
        mini('今天該做（含逾期）', todayTasks, tm, (r) => (r.安排日期 < td ? `逾期 ${r.安排日期}` : r.狀態)),
        mini('等你確認（最久的在前）', pend, modById('pending'), (r) => `等 ${L.F.daysSince(r._created)} 天`),
        mini('3 天內到期的專案', soon, pm, (r) => r.截止日),
        mini('停滯的專案', stale, pm, (r) => r.下一步 || '')));
  }

  // ---------- 通用清單頁 ----------
  function tablePage(m) {
    const listFields = m.fields.filter((f) => f.list);
    const filterFields = m.fields.filter((f) => f.filter);
    const f0 = (state.filters[m.id] = state.filters[m.id] || {});
    // 選項被移除時，清掉已失效的篩選，避免清單被看不見的條件卡住
    for (const f of filterFields) {
      const allowed = f.type === 'checkbox' ? ['是', '否'] : optionsOf(f);
      if (f0[f.key] && !allowed.includes(f0[f.key]) && !Store.list(m.id).some((r) => r[f.key] === f0[f.key])) delete f0[f.key];
    }
    const bar = h('div', { class: 'toolbar' },
      m.readonly ? null : h('button', { class: 'btn primary', id: 'btn-new', onclick: () => go(m.id, 'new') }, '＋ 新增'),
      filterFields.map((f) => {
        const opts = f.type === 'checkbox' ? ['是', '否'] : optionsOf(f, f0[f.key] ? { [f.key]: f0[f.key] } : null);
        const s = h('select', { 'data-filter': f.key, onchange: (e) => { f0[f.key] = e.target.value; render(); } },
          h('option', { value: '' }, `${f.key}：全部`), opts.map((o) => h('option', { value: o }, optText(o))));
        s.value = f0[f.key] || ''; return s;
      }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: state.showArchived, onchange: (e) => { state.showArchived = e.target.checked; render(); } }), '顯示封存'),
      h('input', { type: 'search', class: 'search', placeholder: '搜尋標題', value: state.search, oninput: (e) => { state.search = e.target.value; renderRows(); } }));

    const tbody = h('tbody');
    const sort = state.sort && state.sort.mod === m.id ? state.sort : { key: '_created', dir: -1 };
    function rows() {
      let rs = Store.list(m.id).slice();
      if (!state.showArchived) rs = rs.filter((r) => r.狀態 !== '封存');
      for (const [k, v] of Object.entries(f0)) {
        if (!v) continue;
        const f = m.fields.find((x) => x.key === k);
        rs = rs.filter((r) => (f.type === 'checkbox' ? !!r[k] === (v === '是') : r[k] === v));
      }
      if (state.search) rs = rs.filter((r) => String(r[m.titleKey] || '').toLowerCase().includes(state.search.toLowerCase()) || did(r).toLowerCase().includes(state.search.toLowerCase()));
      const sf = m.fields.find((x) => x.key === sort.key);
      const key = (r) => { const v = sf ? valueOf(m, sf, r) : r[sort.key]; return v === undefined || v === null ? '' : v; };
      rs.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'zh-Hant')) * sort.dir; });
      return rs;
    }
    function renderRows() {
      const rs = rows();
      tbody.replaceChildren(...(rs.length ? rs.map((r) => h('tr', { class: r.狀態 === '封存' ? 'archived' : '', 'data-id': r._id, onclick: () => go(m.id, r._id) },
        h('td', { class: 'id' }, did(r)), listFields.map((f) => h('td', { class: f.type === 'money' || f.format === 'money' ? 'num' : '' }, display(m, f, r)))))
        : [h('tr', {}, h('td', { colspan: listFields.length + 1, class: 'empty' }, m.readonly ? '還沒有紀錄' : '這個格子還是空的，按「＋ 新增」放第一筆資料'))]));
      count.textContent = `共 ${rs.length} 筆`;
    }
    const thead = h('thead', {}, h('tr', {}, h('th', {}, '編號'), listFields.map((f) => h('th', { class: 'sortable', title: plainOf(f) || undefined, onclick: () => { state.sort = { mod: m.id, key: f.key, dir: sort.key === f.key ? -sort.dir : 1 }; render(); } }, f.key, sort.key === f.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''))));
    const count = h('div', { class: 'count muted' });
    renderRows();
    return h('div', {}, bar, h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, thead, tbody)), count);
  }

  // ---------- 詳細／編輯抽屜 ----------
  function openDrawer(m, id) {
    const existing = id ? Store.get(m.id, id) : null;
    if (id && !existing) { toast('找不到這筆資料', true); go(m.id); return; }
    const rec = existing ? JSON.parse(JSON.stringify(existing)) : FL.blank(m);
    const ro = !!m.readonly;
    const form = h('div', { class: 'form' });

    function fieldEl(f0) {
      let f = f0;
      const req = f.required ? ' *' : '';
      const lab = (c) => h('label', { class: 'fld', 'data-field': f.key }, h('span', { class: 'fld-l' }, f.key + req), c, f.hint ? h('span', { class: 'hint' }, f.hint) : null);
      const dis = ro || SY.readonlyField(m.id, f.key);
      const local = !SY.synced(m.id, f.key) && f.type !== 'formula' && f.type !== 'rollup';
      const hint0 = plainOf(f); f = Object.assign({}, f, { hint: [hint0, dis && !ro ? '這欄請到 Notion 修改' : '', local ? '這欄只存在這台電腦（Notion 沒有這欄）' : ''].filter(Boolean).join('；') });
      if (f.type === 'formula' || f.type === 'rollup') return lab(h('div', { class: 'calc' }, display(m, f, rec) || '—'));
      if (f.type === 'link') {
        const t = FL.resolve(rec[f.key]);
        return lab(t ? h('a', { href: '#', class: 'linkbtn', onclick: (e) => { e.preventDefault(); go(t.mod.id, t.rec._id); } }, `${t.mod.icon} ${display(m, f, rec)}`) : h('div', { class: 'calc' }, '—'));
      }
      if (f.type === 'select') {
        const s = h('select', { disabled: dis, onchange: (e) => { rec[f.key] = e.target.value; if (m.fields.some((x) => x.optionsBy && x.optionsBy.field === f.key)) redraw(); else refreshCalc(); } },
          h('option', { value: '' }, '— 請選擇 —'), optionsOf(f, rec).map((o) => h('option', { value: o }, optText(o))));
        s.value = rec[f.key] || ''; return lab(s);
      }
      if (f.type === 'relation') {
        const tm = modById(f.module);
        const opts = Store.list(f.module).filter((r) => r.狀態 !== '封存' || r._id === rec[f.key]);
        const s = h('select', { disabled: dis, onchange: (e) => { rec[f.key] = e.target.value; } },
          h('option', { value: '' }, '— 不關聯 —'), opts.map((r) => h('option', { value: r._id }, `${did(r)} ${r[tm.titleKey] || ''}`)));
        s.value = rec[f.key] || ''; return lab(s);
      }
      if (f.type === 'checkbox') {
        return h('label', { class: 'fld chkfld', 'data-field': f.key }, h('input', { type: 'checkbox', disabled: dis, checked: !!rec[f.key], onchange: (e) => { rec[f.key] = e.target.checked; } }), h('span', {}, f.key), f.hint ? h('span', { class: 'hint' }, f.hint) : null);
      }
      if (f.type === 'date') {
        const i = h('input', { type: 'date', disabled: dis, value: rec[f.key] || '', onchange: (e) => { rec[f.key] = e.target.value; refreshCalc(); } });
        return lab(i);
      }
      if (f.type === 'money' || f.type === 'number') {
        const i = h('input', { type: 'number', min: 0, step: f.type === 'money' ? 1 : 'any', inputmode: 'numeric', disabled: dis, value: rec[f.key] ?? '', oninput: (e) => { rec[f.key] = e.target.value === '' ? '' : Number(e.target.value); refreshCalc(); } });
        const extra = f.helper === 'tax5' && !dis ? h('button', { class: 'btn small', type: 'button', onclick: () => { rec.稅額 = Math.round((Number(rec.未稅金額) || 0) * 0.05); i.value = rec.稅額; refreshCalc(); } }, '依 5% 計算') : null;
        return lab(h('div', { class: 'row' }, i, extra));
      }
      if (f.type === 'longtext') return lab(h('textarea', { rows: 4, disabled: dis, oninput: (e) => { rec[f.key] = e.target.value; } }, rec[f.key] || ''));
      if (f.type === 'url') {
        const i = h('input', { type: 'url', placeholder: 'https://', disabled: dis, value: rec[f.key] || '', oninput: (e) => { rec[f.key] = e.target.value.trim(); } });
        return lab(h('div', { class: 'row' }, i, rec[f.key] && /^https?:\/\//.test(rec[f.key]) ? h('a', { class: 'btn small', href: rec[f.key], target: '_blank', rel: 'noopener' }, '開啟') : null));
      }
      return lab(h('input', { type: 'text', disabled: dis, maxlength: 200, value: rec[f.key] || '', oninput: (e) => { rec[f.key] = e.target.value; } }));
    }
    function refreshCalc() {
      for (const f of m.fields) if (f.type === 'formula' || f.type === 'rollup') { const el = form.querySelector(`[data-field="${f.key}"] .calc`); if (el) el.textContent = display(m, f, rec) || '—'; }
    }
    function redraw() { form.replaceChildren(...m.fields.map(fieldEl)); }
    redraw();

    const back = existing ? FL.backlinks(m, existing) : [];
    const acts = (FL.ACTIONS[m.id] || []).filter((a) => existing && a.when(existing));
    const close = () => go(m.id);
    const drawer = h('div', { class: 'drawer-bg', onclick: (e) => { if (e.target.classList.contains('drawer-bg')) close(); } },
      h('aside', { class: 'drawer' },
        h('div', { class: 'drawer-head' }, h('h2', {}, existing ? `${m.title} ${did(existing)}` : `新增${m.title}`), h('button', { class: 'x', onclick: close, 'aria-label': '關閉' }, '✕')),
        existing ? h('div', { class: 'meta muted' }, `建立：${fmtTime(existing._created)}　更新：${fmtTime(existing._updated)}`) : null,
        form,
        back.length ? h('div', { class: 'backlinks' }, h('h3', {}, '關聯到這筆的資料'), back.map((b) => h('a', { href: '#', class: 'linkbtn', onclick: (e) => { e.preventDefault(); go(b.mod.id, b.rec._id); } }, `${b.mod.icon} ${b.mod.title}｜${did(b.rec)} ${b.rec[b.mod.titleKey] || ''}`))) : null,
        existing && existing._from ? h('div', { class: 'backlinks' }, h('h3', {}, '來源'), (() => { const t = FL.resolve(existing._from); return t ? h('a', { href: '#', class: 'linkbtn', onclick: (e) => { e.preventDefault(); go(t.mod.id, t.rec._id); } }, `${t.mod.icon} ${t.mod.title}｜${did(t.rec)} ${t.rec[t.mod.titleKey] || ''}`) : h('span', { class: 'muted' }, '（來源資料已不在）'); })()) : null,
        ro ? null : h('div', { class: 'drawer-foot' },
          h('button', { class: 'btn primary', id: 'btn-save', onclick: () => lock(async () => {
            validate(m, rec);
            const saved = await FL.save(m, rec);
            toast('已儲存'); go(m.id, saved._id);
          }) }, '儲存'),
          acts.map((a) => h('button', { class: 'btn', 'data-action': a.label, onclick: () => lock(async () => {
            validate(m, rec);
            Object.assign(existing, rec);
            await FL.save(m, existing);
            const res = await a.run(Store.get(m.id, existing._id));
            toast(res ? `已${a.label}：${res.mod.title} ${did(res.rec)}` : `已${a.label}`);
            if (res) go(res.mod.id, res.rec._id); else go(m.id, existing._id);
          }) }, a.label)),
          existing && existing.狀態 !== '封存' && SY.canArchive(m.id) ? h('button', { class: 'btn danger', id: 'btn-archive', onclick: () => lock(async () => {
            if (!window.confirm('確定要封存這筆嗎？（不會刪除，勾「顯示封存」還看得到）')) return;
            await FL.archive(m, existing); toast('已封存'); go(m.id);
          }) }, '封存') : null)));
    document.body.append(drawer);
  }
  function validate(m, rec) {
    for (const f of m.fields) {
      const v = rec[f.key];
      if (f.required && (v === undefined || v === null || String(v).trim() === '')) throw new UserError(`請填「${f.key}」`);
      if ((f.type === 'money' || f.type === 'number') && v !== '' && v != null && (!isFinite(Number(v)) || Number(v) < 0)) throw new UserError(`「${f.key}」要是 0 以上的數字`);
      if (f.type === 'url' && v && !/^https?:\/\//i.test(v)) throw new UserError(`「${f.key}」要以 http:// 或 https:// 開頭`);
    }
    if (m.titleKey && typeof rec[m.titleKey] === 'string') rec[m.titleKey] = rec[m.titleKey].trim();
  }
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—');

  // ---------- 營業稅整理 ----------
  function taxPage() {
    const ledger = Store.list('ledger').filter((r) => r.狀態 !== '封存' && r.日期);
    const now = FL.today();
    const cur = L.F.營業稅期別({ 日期: now });
    const periods = Array.from(new Set([cur, ...ledger.map((r) => L.F.營業稅期別(r))])).sort().reverse();
    const sel = h('select', { id: 'tax-period', onchange: () => draw() }, periods.map((p) => h('option', { value: p }, periodLabel(p))));
    const out = h('div');
    function draw() {
      const p = sel.value;
      const rs = ledger.filter((r) => L.F.營業稅期別(r) === p && r.公私 !== '私人');
      const sales = rs.filter((r) => r.收支 === '收入');
      const buys = rs.filter((r) => r.收支 === '支出' && r.可扣抵);
      const sum = (a, k) => a.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      const st = sum(sales, '稅額'), bt = sum(buys, '稅額');
      const issues = [
        ...rs.filter((r) => !r.已確認).map((r) => [r, '尚未確認']),
        ...rs.filter((r) => r.收支 === '支出' && ['電子發票', '紙本三聯式'].includes(r.憑證類型) && !r.買方統編正確).map((r) => [r, '買方統編未確認']),
        ...rs.filter((r) => r.發票號碼 && (r.稅額 === '' || r.稅額 == null)).map((r) => [r, '有發票號碼但沒填稅額'])
      ];
      const lm = modById('ledger');
      out.replaceChildren(
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, money(sum(sales, '未稅金額'))), h('div', { class: 'kpi-l' }, `銷項未稅（你開出去的發票，${sales.length} 筆）`)),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, money(st)), h('div', { class: 'kpi-l' }, '銷項稅額（向客戶收的稅）')),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, money(sum(buys, '未稅金額'))), h('div', { class: 'kpi-l' }, `可扣抵進項未稅（你收到、可抵稅的發票，${buys.length} 筆）`)),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, money(bt)), h('div', { class: 'kpi-l' }, '進項稅額（你付給廠商的稅）')),
          h('div', { class: 'kpi ' + (st - bt >= 0 ? 'warn' : '') }, h('div', { class: 'kpi-v', id: 'tax-due' }, money(Math.abs(st - bt))), h('div', { class: 'kpi-l' }, st - bt >= 0 ? '試算應納稅額（這期要繳的）' : '試算留抵稅額（多付的，留到下期抵）'))),
        h('p', { class: 'muted' }, `申報期限：${deadline(p)}。這是試算，請以財政部申報系統為準。`),
        h('div', { class: 'card' }, h('h3', {}, `申報前要處理（${issues.length}）`),
          issues.length ? h('ul', { class: 'mini' }, issues.map(([r, why]) => h('li', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('ledger', r._id); } }, `${did(r)} ${r[lm.titleKey]}`), h('span', { class: 'muted' }, why)))) : h('p', { class: 'muted' }, '無')));
    }
    draw();
    return h('div', {}, h('div', { class: 'toolbar' }, h('label', { class: 'inline' }, '期別 ', sel)), out);
  }
  function periodLabel(p) { const [y, n] = p.split('-P'); const a = Number(n) * 2 - 1; return `${y} 年 ${a}–${a + 1} 月（${p}）`; }
  function deadline(p) { const [y, n] = p.split('-P').map(Number); const m = Number(n) * 2 + 1; return m > 12 ? `${y + 1}-01-15` : `${y}-${String(m).padStart(2, '0')}-15`; }

  // ---------- 其他頁 ----------
  // ---------- Google 日曆（只讀） ----------
  const IC = window.LeiyiICal;
  const cal = { list: [], errors: [], loading: false, loadedAt: 0, from: null };
  const calNative = () => window.leiyiNative && window.leiyiNative.calendar;
  function calCache() { return (Store.data.calCache = Store.data.calCache || {}); }
  async function loadCalendars(force) {
    if (!calNative() || cal.loading) return;
    if (!force && Date.now() - cal.loadedAt < 5 * 60 * 1000) return;
    cal.loading = true;
    try {
      const res = await window.leiyiNative.calendar.fetch();
      const cache = calCache(); const list = []; const errors = [];
      for (const r of res) {
        if (r.text) { cache[r.name] = { text: r.text, at: new Date().toISOString() }; list.push({ name: r.name, text: r.text }); }
        else { errors.push(`${r.name}：${r.error}`); if (cache[r.name]) list.push({ name: r.name, text: cache[r.name].text }); }
      }
      for (const k of Object.keys(cache)) if (!res.some((r) => r.name === k)) delete cache[k];
      cal.list = list; cal.errors = errors; cal.loadedAt = Date.now();
      await Store.save();
    } finally { cal.loading = false; }
  }
  function calFromCache() { const c = calCache(); return Object.keys(c).map((k) => ({ name: k, text: c[k].text })); }
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const CAL_COLORS = ['#d93025', '#f2a600', '#1e8e3e', '#e67c73', '#7986cb', '#3f51b5', '#0b8043', '#8e24aa', '#039be5', '#616161'];
  const calNames = () => (cal.list.length ? cal.list : calFromCache()).map((c) => c.name);
  const calColor = (name) => { const i = calNames().indexOf(name); return CAL_COLORS[(i < 0 ? 0 : i) % CAL_COLORS.length]; };
  function eventLine(e) {
    const time = e.allDay ? '整天' : `${IC.hm(e.start)}–${IC.hm(e.end)}`;
    return h('li', { class: 'ev' }, h('span', { class: 'ev-dot', style: `background:${calColor(e.calendar)}`, title: e.calendar }), h('span', { class: 'ev-t' }, time), h('span', { class: 'ev-n' }, e.title),
      e.location ? h('span', { class: 'muted' }, `📍${e.location}`) : null);
  }
  // 選了哪個分類（空白＝全部），記在這台電腦
  const calPick = () => { const p = cfg().calPick || ''; return calNames().includes(p) ? p : ''; };
  function eventsBetween(from, to, all) {
    const l = cal.list.length ? cal.list : calFromCache(); const p = all ? '' : calPick();
    return IC.between(p ? l.filter((c) => c.name === p) : l, from, to);
  }
  // 新增分類（＝加一個 Google 日曆）的小表單，設定頁和行程頁共用
  function calAddForm(after) {
    const name = h('input', { type: 'text', class: 'cal-name', placeholder: '分類名稱，跟 Google 日曆同名，例如：打工', maxlength: 30 });
    const url = h('input', { type: 'password', class: 'cal-url', placeholder: '貼上這個日曆的「非公開網址 (iCal 格式)」', autocomplete: 'off' });
    return h('div', { class: 'row wrap cal-add' }, name, url, h('button', { class: 'btn primary btn-cal-add', onclick: () => lock(async () => {
      const n = name.value.trim(); const u = url.value.trim();
      if (!n) throw new UserError('請填分類名稱（跟 Google 日曆裡的名字一樣，例如：打工）');
      if (!u) throw new UserError('請貼上日曆網址');
      try { await window.leiyiNative.calendar.add(n, u); } catch (e) { throw new UserError(String(e.message || e).replace(/^.*Error: /, '')); }
      await loadCalendars(true);
      toast(cal.errors.length ? cal.errors[0] : `已加入「${n}」`, !!cal.errors.length);
      if (after) after();
    }) }, '加入'));
  }
  function calendarPage() {
    const wrap = h('div');
    if (!calNative()) { wrap.append(h('div', { class: 'card' }, h('p', {}, '只有桌面版 APP 可以讀 Google 日曆。'))); return wrap; }
    let addOpen = false;
    const draw = async () => {
      const names = await window.leiyiNative.calendar.list();
      if (!names.length) {
        wrap.replaceChildren(h('div', { class: 'card' }, h('h3', {}, '還沒接 Google 日曆'), h('p', {}, '到 Google 日曆「設定」→ 左邊點你的日曆 →「整合日曆」→ 複製「非公開網址 (iCal 格式)」，貼在下面。名稱填跟 Google 日曆一樣的名字。'),
          calAddForm(() => draw())));
        return;
      }
      const today = dayStart(new Date());
      const from = cal.from || today; const to = new Date(from); to.setDate(to.getDate() + 14);
      const evs = eventsBetween(from, to);
      const days = [];
      for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
        const ds = new Date(d); const de = new Date(d); de.setDate(de.getDate() + 1);
        const list = evs.filter((e) => e.start < de && e.end > ds);
        const isToday = ds.getTime() === today.getTime();
        days.push(h('div', { class: 'day' + (isToday ? ' today' : '') + (list.length ? '' : ' empty') },
          h('div', { class: 'day-h' }, `${ds.getMonth() + 1}/${ds.getDate()}（${WEEK[ds.getDay()]}）${isToday ? '　今天' : ''}`),
          list.length ? h('ul', { class: 'evs' }, list.map(eventLine)) : h('div', { class: 'muted small' }, '沒有行程')));
      }
      const shift = (n) => { const f = new Date(from); f.setDate(f.getDate() + n); cal.from = f; draw(); };
      wrap.replaceChildren(
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn', onclick: () => shift(-7) }, '‹ 上一週'),
          h('button', { class: 'btn', onclick: () => { cal.from = null; draw(); } }, '今天'),
          h('button', { class: 'btn', onclick: () => shift(7) }, '下一週 ›'),
          h('button', { class: 'btn', id: 'btn-cal-refresh', onclick: () => lock(async () => { await loadCalendars(true); draw(); toast(cal.errors.length ? cal.errors[0] : '已更新行程', !!cal.errors.length); }) }, '⟳ 重新整理'),
          h('a', { class: 'btn primary', href: IC.addUrl('', IC.ymd(today)), target: '_blank', rel: 'noopener' }, '＋ 在 Google 日曆新增')),
        h('div', { class: 'cal-chips' },
          h('button', { class: 'cchip' + (calPick() ? '' : ' on'), onclick: () => guard(async () => { cfg().calPick = ''; await Store.save(); draw(); }) }, '全部'),
          calNames().map((n) => h('button', { class: 'cchip' + (calPick() === n ? ' on' : ''), 'data-cal': n, onclick: () => guard(async () => { cfg().calPick = n; await Store.save(); draw(); }) },
            h('span', { class: 'ev-dot', style: `background:${calColor(n)}` }), n)),
          h('button', { class: 'cchip add', id: 'btn-cal-new', onclick: () => { addOpen = !addOpen; draw(); } }, addOpen ? '× 取消' : '＋ 新增分類')),
        addOpen ? h('div', { class: 'card' }, h('p', { class: 'muted' }, '到 Google 日曆「設定」→ 左邊點那個日曆 →「整合日曆」→ 複製「非公開網址 (iCal 格式)」。名稱填跟 Google 日曆一樣的名字。'), calAddForm(() => { addOpen = false; draw(); })) : null,
        cal.errors.length ? h('div', { class: 'alert' }, cal.errors.join('；'), '（先顯示上次讀到的行程）') : null,
        h('p', { class: 'muted' }, `${IC.ymd(from)} 起兩週，共 ${evs.length} 個行程${cal.loadedAt ? `｜更新於 ${new Date(cal.loadedAt).toLocaleTimeString('zh-TW', { hour12: false })}` : ''}`),
        h('div', { class: 'days' }, days));
    };
    wrap.append(h('p', { class: 'muted' }, '讀取行程中…'));
    guard(async () => { await draw(); await loadCalendars(false); await draw(); });
    return wrap;
  }
  function calendarCard() {
    const card = h('div', { class: 'card', id: 'cal-card' }, h('h3', {}, 'Google 日曆'));
    if (!calNative()) { card.append(h('p', { class: 'muted' }, '只有桌面版 APP 可以讀 Google 日曆。')); return card; }
    const body = h('div'); card.append(body);
    const draw = async () => {
      const names = await window.leiyiNative.calendar.list();
      body.replaceChildren(
        h('p', { class: 'muted' }, '每個 Google 日曆是一個分類，要分別加入。取得網址：電腦版 Google 日曆 → 右上齒輪「設定」→ 左邊點那個日曆 →「整合日曆」→ 複製「非公開網址 (iCal 格式)」。名稱填跟 Google 日曆一樣的名字（例如：打工）。網址只會加密存在這台電腦。'),
        names.length ? h('ul', { class: 'mini', id: 'cal-list' }, names.map((c) => h('li', {}, h('span', {}, h('span', { class: 'ev-dot', style: `background:${calColor(c.name)}` }), c.name), h('button', { class: 'btn small danger', onclick: () => lock(async () => {
          if (!window.confirm(`移除「${c.name}」？（不會影響 Google 日曆本身）`)) return;
          await window.leiyiNative.calendar.remove(c.index); cal.loadedAt = 0; delete calCache()[c.name]; await Store.save(); draw();
        }) }, '移除')))) : h('p', {}, '還沒有接任何日曆。'),
        calAddForm(() => draw()));
    };
    guard(draw);
    return card;
  }

  function placeholderPage(m) { return h('div', { class: 'card' }, h('p', {}, '這個格子已預留，之後串接。'), h('p', { class: 'muted' }, m.desc || '')); }
  function rulesPage() { return h('div', { class: 'cards' }, L.RULES(cfg()).map(([t, items]) => h('div', { class: 'card' }, h('h3', {}, t), h('ul', {}, items.map((x) => h('li', {}, x)))))); }
  function toolsPage() {
    return h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ['部門', '工具', '用途', '費用'].map((x) => h('th', {}, x)))),
      h('tbody', {}, L.TOOLS.map((r) => h('tr', { class: 'static' }, r.map((c) => h('td', {}, c)))))));
  }

  // ---------- Notion 連線卡 ----------
  const ui = { tables: null, picking: false };
  function notionCard() {
    const c = cfg(); const sy = Store.data.sync;
    const card = h('div', { class: 'card', id: 'notion-card' }, h('h3', {}, 'Notion 同步（正本放 Notion）'));
    if (!SY.available()) { card.append(h('p', { class: 'muted' }, '只有桌面版 APP 可以連線 Notion。')); return card; }
    const body = h('div', { class: 'notion-body' }, h('p', { class: 'muted' }, '讀取中…'));
    const put = (...xs) => body.append(...xs.filter((x) => x !== null && x !== undefined && x !== false));
    card.append(body);
    const tableMods = L.MODULES.filter((m) => m.kind === 'table' && visible(m));

    async function draw() {
      const has = await SY.hasToken();
      body.replaceChildren();
      if (!has) {
        const tok = h('input', { type: 'password', id: 'notion-token', placeholder: '貼上 ntn_ 開頭的金鑰', autocomplete: 'off' });
        put(
          h('p', {}, '第一步：貼上 Notion 整合金鑰（只會加密存在這台電腦）。'),
          h('div', { class: 'row' }, tok, h('button', { class: 'btn primary', id: 'btn-notion-token', onclick: () => lock(async () => {
            const v = tok.value.trim(); if (!v) throw new UserError('請貼上金鑰');
            try { await SY.setToken(v); } catch (e) { throw new UserError(String(e.message || e).replace(/^.*Error: /, '')); }
            try { sy.workspace = await SY.testConnection(); await Store.save(); toast(`已連上：${sy.workspace}`); }
            catch (e) { await SY.clearToken(); throw new UserError(e.message); }
            ui.picking = true; ui.tables = null; draw();
          }) }, '連線測試')));
        return;
      }
      put(h('p', {}, `已設定金鑰${sy.workspace ? `（${sy.workspace}）` : ''}。`));
      if (c.mode === 'notion' && !ui.picking) {
        const st = SY.status;
        put(
          h('p', { id: 'notion-state' }, `狀態：${syncLabel()}${st.message && st.state !== 'ok' ? `｜${st.message}` : ''}`),
          h('p', { class: 'muted' }, `上次同步：${sy.lastSync ? fmtTime(sy.lastSync) : '—'}　待上傳：${sy.queue.length} 筆`),
          h('ul', { class: 'mini', id: 'notion-map' }, Object.keys(sy.mapping).map((id) => { const m = modById(id); const rp = SY.report(id); return h('li', {}, `${m.icon} ${m.title}`, h('span', { class: 'muted' }, `接上 ${rp.hit}/${rp.total} 欄${rp.missing.length ? `（只存本機：${rp.missing.join('、')}）` : ''}`)); })),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn primary', id: 'btn-sync-now', onclick: () => lock(async () => { await SY.syncNow(); toast(SY.status.message || '已同步', SY.status.state !== 'ok'); render(); }) }, '立即同步'),
            h('button', { class: 'btn', id: 'btn-remap', onclick: () => { ui.picking = true; ui.tables = null; draw(); } }, '重新設定對應'),
            h('button', { class: 'btn danger', id: 'btn-notion-off', onclick: () => lock(async () => {
              if (sy.queue.length && !window.confirm(`還有 ${sy.queue.length} 筆沒上傳到 Notion，中斷後這些只會留在這台電腦。確定嗎？`)) return;
              if (!window.confirm('中斷 Notion 同步？之後改為只存在這台電腦（現有資料會保留）。')) return;
              await SY.disconnect(); await SY.clearToken(); sy.workspace = ''; await Store.save(); toast('已中斷 Notion 同步'); render();
            }) }, '中斷連線')),
          sy.errors.length ? h('div', { class: 'backlinks', id: 'notion-errors' }, h('h3', {}, `同步問題（${sy.errors.length}）`),
            h('ul', { class: 'mini' }, sy.errors.slice(0, 10).map((e) => h('li', {}, `${e.mod}｜${e.title || '（無標題）'}`, h('span', { class: 'muted' }, e.message)))),
            h('button', { class: 'btn small', onclick: () => guard(async () => { sy.errors = []; await Store.save(); SY.syncNow(); draw(); }) }, '清除')) : null);
        return;
      }
      // 選擇對應
      if (!ui.tables) {
        put(h('p', { class: 'muted' }, '正在讀取你分享給整合的 Notion 資料表…'));
        try { ui.tables = await SY.discover(); } catch (e) { body.replaceChildren(h('p', { class: 'bad' }, e.message), h('button', { class: 'btn', onclick: () => { ui.tables = null; draw(); } }, '重試')); return; }
        body.replaceChildren(h('p', {}, `已設定金鑰${sy.workspace ? `（${sy.workspace}）` : ''}。`));
      }
      if (!ui.tables.length) { put(h('p', { class: 'bad' }, '找不到任何資料表。請到 Notion 頁面右上角「⋯ → 連線」把這個整合加進去，再按重試。'), h('button', { class: 'btn', onclick: () => { ui.tables = null; draw(); } }, '重試')); return; }
      const auto = Object.keys(sy.mapping).length ? sy.mapping : SY.autoMap(ui.tables);
      const sels = {};
      const grid = h('div', { class: 'form', id: 'notion-pick' }, tableMods.map((m) => {
        const s = h('select', { 'data-map': m.id }, h('option', { value: '' }, '— 不同步，只存本機 —'), ui.tables.map((t) => h('option', { value: t.id }, t.title)));
        s.value = auto[m.id] || ''; sels[m.id] = s;
        return h('label', { class: 'fld' }, h('span', { class: 'fld-l' }, `${m.icon} ${m.title}`), s);
      }));
      const hasLocal = tableMods.some((m) => m.id !== 'logs' && Store.list(m.id).some((r) => !Store.isTemp(r._id) && !/^[0-9a-f-]{36}$/i.test(r._id)));
      const up = h('select', { id: 'notion-upload' }, h('option', { value: 'no' }, '不上傳，以 Notion 現有資料為準'), h('option', { value: 'yes' }, '把這台電腦現有的資料也上傳到 Notion'));
      put(h('p', {}, '第二步：確認每個格子要接到哪張 Notion 資料表（已幫你自動配對）。'), grid,
        hasLocal ? h('label', { class: 'fld' }, h('span', { class: 'fld-l' }, '這台電腦已經有的資料'), up) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', id: 'btn-notion-start', onclick: () => lock(async () => {
            const mapping = {}; for (const [id, s] of Object.entries(sels)) if (s.value) mapping[id] = s.value;
            const upload = hasLocal && up.value === 'yes';
            if (hasLocal && !upload && !window.confirm('選了「不上傳」：有接 Notion 的格子會改成顯示 Notion 的資料，這台電腦原本的這些資料會先自動備份再移除。確定嗎？')) return;
            const n = await SY.connect({ mapping, uploadLocal: upload });
            ui.picking = false; SY.startAuto();
            toast(n ? `已開始同步，上傳 ${n} 筆本機資料` : '已開始同步'); render();
          }) }, '開始同步'),
          c.mode === 'notion' ? h('button', { class: 'btn', onclick: () => { ui.picking = false; draw(); } }, '取消') : null,
          h('button', { class: 'btn', id: 'btn-token-clear', onclick: () => lock(async () => { if (c.mode === 'notion') throw new UserError('同步中不能移除金鑰，請先按「中斷連線」'); await SY.clearToken(); sy.workspace = ''; await Store.save(); ui.tables = null; draw(); }) }, '換一把金鑰')));
    }
    guard(draw);
    return card;
  }

  function settingsPage() {
    const c = cfg();
    const inp = (key, label, type, attrs) => {
      const i = h('input', Object.assign({ type, value: c[key] ?? '', 'data-set': key }, attrs || {}));
      return h('label', { class: 'fld' }, h('span', { class: 'fld-l' }, label), i);
    };
    const userSel = h('select', { 'data-set': 'currentUser' }, c.people.map((p) => h('option', { value: p }, p)));
    userSel.value = c.currentUser;
    const basic = h('div', { class: 'card' }, h('h3', {}, '公司基本資料'),
      inp('companyName', '公司名稱', 'text', { maxlength: 60 }),
      inp('taxId', '統一編號', 'text', { maxlength: 8, inputmode: 'numeric' }),
      h('label', { class: 'fld' }, h('span', { class: 'fld-l' }, '目前使用者'), userSel),
      inp('largeAmount', '超過多少錢要確認（NT$）', 'number', { min: 0, step: 1 }),
      inp('receivableDays', '應收帳款幾天未收要提醒', 'number', { min: 1, step: 1 }),
      inp('staleDays', '專案幾天沒更新算停滯', 'number', { min: 1, step: 1 }),
      inp('maxBigProjects', '大專案上限（個）', 'number', { min: 1, step: 1 }),
      h('label', { class: 'fld chkfld' }, h('input', { type: 'checkbox', 'data-set': 'enableHR', checked: !!c.enableHR }), h('span', {}, '啟用人資模組（員工名冊）')),
      h('button', { class: 'btn primary', id: 'btn-save-settings', onclick: () => guard(async () => {
        const v = (k) => basic.querySelector(`[data-set="${k}"]`);
        const name = v('companyName').value.trim(); if (!name) throw new UserError('公司名稱不能空白');
        const tax = v('taxId').value.trim(); if (tax && !/^\d{8}$/.test(tax)) throw new UserError('統一編號要是 8 碼數字');
        const nums = {};
        for (const k of ['largeAmount', 'receivableDays', 'staleDays', 'maxBigProjects']) {
          const n = Number(v(k).value); if (!isFinite(n) || n < (k === 'largeAmount' ? 0 : 1) || !Number.isInteger(n)) throw new UserError('數字設定要是正整數'); nums[k] = n;
        }
        Object.assign(c, { companyName: name, taxId: tax, currentUser: v('currentUser').value, enableHR: v('enableHR').checked }, nums);
        await Store.save(); toast('設定已儲存'); render();
      }) }, '儲存設定'));

    const lists = h('div', { class: 'card' }, h('h3', {}, '選項管理'), h('p', { class: 'muted' }, '這些清單會出現在各頁的下拉選單。移除選項不會影響已經選過的舊資料。'),
      L.CONFIG_LISTS.map((cl) => {
        const box = h('div', { class: 'optlist', 'data-list': cl.key });
        const drawChips = () => box.replaceChildren(...c[cl.key].map((o, i) => h('span', { class: 'chip' }, o,
          h('button', { class: 'chip-x', title: '移除', onclick: () => guard(async () => {
            if (c[cl.key].length <= 1) throw new UserError('至少要留一個選項');
            if (cl.key === 'people' && o === c.currentUser) throw new UserError('不能移除目前使用者');
            c[cl.key].splice(i, 1); await Store.save(); drawChips();
          }) }, '×'))));
        drawChips();
        const add = h('input', { type: 'text', placeholder: cl.key === 'accounts' ? '例如：E12 運費' : '新增選項', maxlength: 40 });
        return h('div', { class: 'optgroup' }, h('div', { class: 'fld-l' }, cl.label), box,
          h('div', { class: 'row' }, add, h('button', { class: 'btn small', 'data-add': cl.key, onclick: () => guard(async () => {
            const val = add.value.trim(); if (!val) throw new UserError('請輸入選項');
            if (c[cl.key].includes(val)) throw new UserError('這個選項已經有了');
            if (cl.key === 'accounts' && !/^[IE]\d{2}\s/.test(val)) throw new UserError('科目要用「I01 名稱」或「E01 名稱」格式');
            c[cl.key].push(val); if (cl.key === 'accounts') c[cl.key].sort(); await Store.save(); add.value = ''; drawChips();
            if (cl.key === 'people') render();
          }) }, '新增')));
      }));

    const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e) => guard(async () => {
      const file = e.target.files[0]; if (!file) return;
      const text = await file.text();
      if (!window.confirm('匯入會用備份檔取代目前全部資料，確定嗎？')) return;
      await Store.importJSON(text); toast('已匯入備份'); render();
    }) });
    const pathInfo = h('p', { class: 'muted', id: 'data-path' }, window.leiyiNative ? '資料位置讀取中…' : '目前是瀏覽器預覽版，資料存在這個瀏覽器裡。');
    if (window.leiyiNative) window.leiyiNative.dataPath().then((p) => { pathInfo.textContent = `資料位置：${p}`; });
    const data = h('div', { class: 'card' }, h('h3', {}, '資料與備份'),
      h('p', {}, `目前儲存方式：${c.mode === 'notion' ? 'Notion 正本＋這台電腦暫存' : '只存在這台電腦'}`), pathInfo,
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', id: 'btn-export', onclick: () => guard(async () => {
          const name = `${c.companyName || 'company'}-備份-${FL.today()}.json`;
          if (window.leiyiNative) { const ok = await window.leiyiNative.exportFile(name, Store.exportJSON()); if (ok) toast('已匯出備份'); return; }
          const a = h('a', { href: URL.createObjectURL(new Blob([Store.exportJSON()], { type: 'application/json' })), download: name });
          document.body.append(a); a.click(); a.remove(); toast('已匯出備份');
        }) }, '匯出備份'),
        h('button', { class: 'btn', onclick: () => fileIn.click() }, '匯入備份'), fileIn,
        h('button', { class: 'btn danger', id: 'btn-reset', onclick: () => guard(async () => {
          if (!window.confirm('清空會刪除這台電腦上的全部資料與設定，建議先匯出備份。確定要清空嗎？')) return;
          if (!window.confirm('最後確認：真的要清空嗎？')) return;
          Store.data = window.LeiyiStore.normalize({ modules: {} });
          await Store.save(); go('home');
        }) }, '清空全部資料')));
    return h('div', { class: 'cards one' }, notionCard(), calendarCard(), basic, lists, data);
  }

  // ---------- 啟動 ----------
  let upd = { state: 'idle' }; let appVer = '';
  // 左下角：版本＋「檢查更新」按鈕＋下載進度
  function updateBox() {
    if (!appVer) return null;
    const btn = (label, fn, cls) => h('button', { class: 'btn small upd ' + (cls || ''), id: 'btn-update', onclick: fn }, label);
    const refresh = () => { const old = document.querySelector('.upd-box'); const nu = updateBox(); if (old && nu) old.replaceWith(nu); };
    const check = () => guard(async () => { upd = Object.assign({}, upd, { state: 'checking' }); refresh(); upd = await window.leiyiNative.update.check(); refresh(); });
    let el;
    switch (upd.state) {
      case 'ready': el = btn(`⬆ 新版 ${upd.version} 已下載，按這裡更新`, () => { if (window.confirm(`現在更新到 ${upd.version}？APP 會自動重開，資料不受影響。`)) window.leiyiNative.update.install(); }, 'primary'); break;
      case 'downloading': el = h('div', { class: 'upd-bar' }, h('div', { class: 'muted small' }, `下載新版 ${upd.version || ''}… ${upd.percent || 0}%`), h('div', { class: 'bar' }, h('i', { style: `width:${upd.percent || 0}%` }))); break;
      case 'checking': el = h('div', { class: 'muted small' }, '檢查更新中…'); break;
      case 'none': el = btn('✓ 已是最新版（再檢查一次）', check); break;
      case 'error': el = btn(`⟳ 檢查更新（${upd.message || '上次失敗'}）`, check); break;
      default: el = btn('⟳ 檢查更新', check);
    }
    return h('div', { class: 'upd-box' }, el, h('div', { class: 'muted ver' }, `版本 ${appVer}`));
  }
  // 同步完成後更新畫面（正在編輯時不打斷，只更新左下角狀態）
  let lastSeen = '';
  function onSync(st) {
    const el = document.getElementById('sync-status');
    if (el) { el.className = 'sync-st ' + st.state; el.textContent = syncLabel(); el.title = st.message; }
    const editing = document.querySelector('.drawer-bg') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if ((st.state === 'ok' || st.state === 'warn') && Store.data.sync.lastSync !== lastSeen) {
      if (!editing) { lastSeen = Store.data.sync.lastSync; render(); }
    }
  }
  async function start() {
    await guard(() => Store.load());
    lastSeen = Store.data.sync.lastSync;
    const [, r, o] = location.hash.split('/');
    if (r && modById(r)) { state.route = r; state.open = o || null; }
    SY.onStatus(onSync);
    if (window.leiyiNative && window.leiyiNative.update) {
      appVer = await window.leiyiNative.version();
      upd = await window.leiyiNative.update.status();
      window.leiyiNative.update.onStatus((s) => { upd = s; const old = document.querySelector('.upd-box'); const nu = updateBox(); if (old && nu) old.replaceWith(nu); });
    }
    SY.onRemap = (oldId, newId) => { if (state.open === oldId) { state.open = newId; history.replaceState(null, '', `#/${state.route}/${newId}`); } };
    Store.onChange = () => SY.schedulePush();
    render();
    if (cfg().mode === 'notion') { SY.startAuto(); SY.syncNow(); }
    if (calNative()) {
      const refreshCal = () => loadCalendars(true).then(() => { if (['home', 'calendar'].includes(state.route) && !document.querySelector('.drawer-bg') && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render(); }).catch((e) => console.error(e));
      refreshCal(); setInterval(refreshCal, 15 * 60 * 1000);
    }
    window.addEventListener('online', () => SY.syncNow());
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.drawer-bg')) go(state.route); });
  window.LeiyiApp = { start, go, state };
  start();
})();
