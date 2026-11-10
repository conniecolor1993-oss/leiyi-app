/* Notion 同步（sync.js）
 * Notion 是正本：開啟時拉取最新資料；每次變更排進佇列上傳；沒網路時先存本機，連上後自動補傳。
 * 只透過桌面主程式（main.js）呼叫 Notion API，金鑰不會進到畫面。
 * 欄位對應規則：APP 欄位名稱＝Notion 欄位名稱（少數別名見 ALIAS）。Notion 沒有的欄位只存在本機。
 */
(function () {
  const L = window.LEIYI;
  const { Store } = window.LeiyiStore;
  const VERSION_NOTE = 'Notion API 2025-09-03';
  const ALIAS = { inbox: { 分派結果: '分派結果連結' } };
  const FROM_PROP = '來源紀錄';
  // 自動配對：APP 格子 → 可能的 Notion 資料表名稱
  const AUTO = {
    inbox: ['收件匣'], pending: ['待確認'], handoff: ['任務交接'], ledger: ['帳務'], projects: ['專案'],
    tasks: ['每日任務', '工作任務總表'], ideas: ['想法池'], evaluations: ['評估'], meetings: ['會議紀錄'],
    staff: ['員工名冊'], contacts: ['聯絡人', '人脈'], logs: ['處理紀錄']
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mod = (id) => L.MODULES.find((m) => m.id === id);
  const tableMods = () => L.MODULES.filter((m) => m.kind === 'table');
  const S = () => Store.data.sync;
  const native = () => window.leiyiNative && window.leiyiNative.notion;
  const available = () => !!native();

  const status = { state: 'idle', message: '' };
  let listeners = [];
  const emit = () => listeners.forEach((f) => { try { f(status); } catch (e) { console.error(e); } });
  const setStatus = (state, message) => { status.state = state; status.message = message || ''; emit(); };

  class NotionError extends Error {}

  async function api(method, path, body) {
    if (!available()) throw new UserError('只有桌面版可以連線 Notion');
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await native().request(method, path, body);
      if (r.status === 429) { await sleep(Math.min(30, Number(r.retryAfter) || 1) * 1000); continue; }
      if (r.status === 0 || r.status >= 500) {
        const e = new NotionError(r.status === 0 ? '連不上 Notion（可能沒有網路）' : `Notion 暫時有問題（${r.status}）`); e.offline = true; throw e;
      }
      if (r.status === 401) { const e = new NotionError('Notion 金鑰無效或已失效，請到設定重新貼上'); e.auth = true; throw e; }
      if (r.status >= 400) { const e = new NotionError((r.json && r.json.message) || `Notion 拒絕（${r.status}）`); e.status = r.status; throw e; }
      await sleep(Number(window.__LEIYI_THROTTLE_MS ?? 340)); // Notion 限制每秒約 3 次
      return r.json;
    }
    const e = new NotionError('Notion 太忙，稍後會自動重試'); e.offline = true; throw e;
  }

  // ---------- 小工具 ----------
  const plain = (arr) => (Array.isArray(arr) ? arr.map((t) => t.plain_text ?? (t.text && t.text.content) ?? '').join('') : '');
  const rich = (s) => {
    const str = String(s ?? '');
    if (!str) return [];
    const out = [];
    for (let i = 0; i < str.length && out.length < 100; i += 2000) out.push({ type: 'text', text: { content: str.slice(i, i + 2000) } });
    return out;
  };
  const pageUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, '')}`;
  const dash = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  function idFromUrl(u) {
    if (!u) return '';
    const m = /([0-9a-f]{32})(?=$|[?#/])/i.exec(String(u).replace(/-/g, ''));
    return m ? dash(m[1].toLowerCase()) : '';
  }
  const findMod = (id) => { for (const m of tableMods()) if (Store.list(m.id).some((r) => r._id === id)) return m.id; return ''; };
  const schemaOf = (modId) => (S().schemas || {})[modId] || null;
  // APP 欄位 → Notion 欄位名稱：同名優先；標題欄位一律接 Notion 的標題欄（名稱不同也可以）
  function propName(modId, key) {
    const a = ALIAS[modId] && ALIAS[modId][key]; if (a) return a;
    const m = mod(modId); const sc = schemaOf(modId);
    if (m && key === m.titleKey && sc && !(sc[key] && sc[key].type === 'title')) { const t = Object.keys(sc).find((k) => sc[k].type === 'title'); if (t) return t; }
    return key;
  }
  const optionNames = (p) => { const o = p && (p[p.type] || {}).options; return Array.isArray(o) ? o.map((x) => x.name) : null; };
  // 這個格子能不能「封存」：要有含「封存」的狀態欄，Notion 那邊也要收得下「封存」
  function canArchive(modId) {
    const m = mod(modId); const f = m && m.fields.find((x) => x.key === '狀態');
    if (!f || !Array.isArray(f.options) || !f.options.includes('封存')) return false;
    if (!Store.isNotion(modId)) return true;
    const p = (schemaOf(modId) || {})[propName(modId, '狀態')];
    if (!p) return true;
    if (p.type === 'status') return (optionNames(p) || []).includes('封存');
    return p.type === 'select';
  }
  // 對應報告：每個格子有幾個欄位接上 Notion
  function report(modId) {
    const m = mod(modId); const sc = schemaOf(modId) || {};
    const fs = m.fields.filter((f) => f.type !== 'formula' && f.type !== 'rollup');
    const hit = fs.filter((f) => sc[propName(modId, f.key)]);
    return { hit: hit.length, total: fs.length, missing: fs.filter((f) => !sc[propName(modId, f.key)]).map((f) => f.key) };
  }
  const titleOf = (ds) => plain(ds.title) || ds.name || '（未命名）';
  const uniqueNo = (p) => (p && p.unique_id && p.unique_id.number != null ? `${p.unique_id.prefix ? p.unique_id.prefix + '-' : ''}${p.unique_id.number}` : '');

  // Notion 是「人員」欄位的，APP 不能改（要到 Notion 改）
  function readonlyField(modId, key) {
    if (!Store.isNotion(modId)) return false;
    const sc = schemaOf(modId); const p = sc && sc[propName(modId, key)];
    return !!(p && ['people', 'files', 'created_by', 'last_edited_by'].includes(p.type));
  }
  // 這個欄位在 Notion 有沒有對應（沒有的只存本機）
  function synced(modId, key) {
    if (!Store.isNotion(modId)) return true;
    const sc = schemaOf(modId); return !!(sc && sc[propName(modId, key)]);
  }

  // ---------- APP → Notion ----------
  function toProps(modId, rec) {
    const m = mod(modId); const sc = schemaOf(modId) || {}; const props = {};
    for (const f of m.fields) {
      if (f.type === 'formula' || f.type === 'rollup') continue;
      const name = propName(modId, f.key); const p = sc[name]; if (!p) continue;
      const v = rec[f.key];
      switch (p.type) {
        case 'title': props[name] = { title: rich(v) }; break;
        case 'rich_text': props[name] = { rich_text: rich(f.type === 'link' ? linkToUrl(v) : v) }; break;
        case 'select': props[name] = { select: v ? { name: String(v).replace(/,/g, '，').slice(0, 100) } : null }; break;
        case 'status': { const ok = optionNames(p); if (v && (!ok || ok.includes(String(v)))) props[name] = { status: { name: String(v) } }; break; }
        case 'multi_select': props[name] = { multi_select: v ? String(v).split(/[、,]/).map((x) => x.trim()).filter(Boolean).map((x) => ({ name: x })) : [] }; break;
        case 'date': props[name] = { date: v ? { start: String(v).slice(0, 10) } : null }; break;
        case 'number': props[name] = { number: v === '' || v == null || !isFinite(Number(v)) ? null : Number(v) }; break;
        case 'checkbox': props[name] = { checkbox: !!v }; break;
        case 'url': {
          if (f.type === 'link') { const u = linkToUrl(v); if (u === null) break; props[name] = { url: u || null }; }
          else props[name] = { url: v ? String(v) : null };
          break;
        }
        case 'email': props[name] = { email: v ? String(v) : null }; break;
        case 'phone_number': props[name] = { phone_number: v ? String(v) : null }; break;
        case 'relation': { if (v && Store.isTemp(v)) break; props[name] = { relation: v ? [{ id: v }] : [] }; break; }
        default: break; // people、files、公式等不寫
      }
    }
    if (sc[FROM_PROP] && sc[FROM_PROP].type === 'url' && rec._from) {
      const u = linkToUrl(rec._from); if (u !== null) props[FROM_PROP] = { url: u || null };
    }
    return props;
  }
  // 'ledger:xxxx' → Notion 網址；目標還沒上傳時回傳 null（先不寫，上傳後再補）
  function linkToUrl(v) {
    if (!v) return '';
    const id = String(v).includes(':') ? String(v).slice(String(v).indexOf(':') + 1) : String(v);
    if (Store.isTemp(id)) return null;
    return /^[0-9a-f-]{36}$/i.test(id) ? pageUrl(id) : '';
  }

  // ---------- Notion → APP ----------
  function fromPage(modId, page, base) {
    const m = mod(modId); const rec = Object.assign({}, base || {});
    rec._id = page.id; rec._created = page.created_time; rec._updated = page.last_edited_time;
    for (const p of Object.values(page.properties || {})) if (p.type === 'unique_id') rec._no = uniqueNo(p);
    for (const f of m.fields) {
      if (f.type === 'formula' || f.type === 'rollup') continue;
      const p = page.properties[propName(modId, f.key)]; if (!p) continue;
      let v;
      switch (p.type) {
        case 'title': v = plain(p.title); break;
        case 'rich_text': v = plain(p.rich_text); if (f.type === 'link') v = { __url: v }; break;
        case 'select': v = p.select ? p.select.name : ''; break;
        case 'status': v = p.status ? p.status.name : ''; break;
        case 'multi_select': v = (p.multi_select || []).map((x) => x.name).join('、'); break;
        case 'date': v = p.date && p.date.start ? String(p.date.start).slice(0, 10) : ''; break;
        case 'number': v = p.number == null ? '' : p.number; break;
        case 'checkbox': v = !!p.checkbox; break;
        case 'url': v = f.type === 'link' ? { __url: p.url || '' } : (p.url || ''); break;
        case 'email': v = p.email || ''; break;
        case 'phone_number': v = p.phone_number || ''; break;
        case 'relation': v = p.relation && p.relation[0] ? p.relation[0].id : ''; break;
        case 'people': v = (p.people || []).map((x) => x.name || '').filter(Boolean).join('、'); break;
        default: continue;
      }
      if (f.type === 'checkbox') v = !!v;
      if (f.type === 'number' || f.type === 'money') v = v === '' || v == null ? '' : Number(v);
      rec[f.key] = v;
    }
    const fp = page.properties[FROM_PROP];
    if (fp && fp.type === 'url') rec._from = { __url: fp.url || '' };
    return rec;
  }
  function resolveLinks() {
    for (const m of tableMods()) for (const r of Store.list(m.id)) {
      for (const k of Object.keys(r)) {
        const v = r[k];
        if (v && typeof v === 'object' && '__url' in v) {
          const id = idFromUrl(v.__url); const mid = id ? findMod(id) : '';
          r[k] = mid ? `${mid}:${id}` : '';
        }
      }
    }
  }

  // ---------- 連線與設定 ----------
  async function testConnection() {
    const me = await api('GET', '/v1/users/me');
    const ws = (me && me.bot && me.bot.workspace_name) || me.name || '已連線';
    return ws;
  }
  async function discover() {
    const out = []; let cursor;
    do {
      const r = await api('POST', '/v1/search', Object.assign({ filter: { property: 'object', value: 'data_source' }, page_size: 100 }, cursor ? { start_cursor: cursor } : {}));
      for (const ds of r.results || []) if (ds.object === 'data_source') out.push({ id: ds.id, title: titleOf(ds) });
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    return out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
  }
  function autoMap(list) {
    const map = {};
    for (const m of tableMods()) {
      const names = AUTO[m.id] || [m.title];
      const hit = list.find((d) => names.includes(d.title)) || list.find((d) => names.some((n) => d.title.includes(n)));
      if (hit) map[m.id] = hit.id;
    }
    return map;
  }
  async function loadSchemas(mapping) {
    const schemas = {}; const titles = {};
    for (const [modId, ds] of Object.entries(mapping)) {
      const r = await api('GET', `/v1/data_sources/${ds}`);
      schemas[modId] = r.properties || {}; titles[modId] = titleOf(r);
    }
    S().titles = titles;
    return schemas;
  }
  // 對應前檢查：每張表的標題欄位必須存在，避免接錯表
  function validateMapping(mapping, schemas) {
    const used = {};
    for (const [modId, ds] of Object.entries(mapping)) {
      const m = mod(modId);
      if (used[ds]) throw new UserError(`「${m.title}」和「${mod(used[ds]).title}」不能接到同一張 Notion 資料表`);
      used[ds] = modId;
      const sc = schemas[modId] || {};
      if (!Object.values(sc).some((p) => p.type === 'title')) throw new UserError(`「${m.title}」接的 Notion 資料表讀不到欄位，請確認有分享給整合`);
      const same = m.fields.filter((f) => f.key !== m.titleKey && sc[(ALIAS[modId] && ALIAS[modId][f.key]) || f.key]).length;
      if (!same) throw new UserError(`「${m.title}」接的 Notion 資料表沒有任何同名欄位，可能選錯表了`);
    }
  }
  // 把 Notion 下拉選項補進 APP 的選項清單
  function importOptions(schemas) {
    const c = Store.data.settings;
    const add = (list, names) => { for (const n of names) if (n && !c[list].includes(n)) c[list].push(n); };
    const opts = (modId, key) => { const p = schemas[modId] && schemas[modId][key]; return p && p.select ? (p.select.options || []).map((o) => o.name) : []; };
    add('lines', [...opts('projects', '事業線'), ...opts('tasks', '分類'), ...opts('ideas', '事業線')]);
    add('owners', opts('tasks', '歸屬'));
    add('accounts', opts('ledger', '科目').filter((n) => /^[IE]\d{2}\s/.test(n)));
    c.accounts.sort();
  }

  // 本機原有資料改成暫時編號，準備上傳
  function prepareUpload(mapping) {
    const ren = {};
    for (const modId of Object.keys(mapping)) for (const r of Store.list(modId)) if (!Store.isTemp(r._id) && !/^[0-9a-f-]{36}$/i.test(r._id)) {
      const c = (Store.data.counters.__local || 0) + 1; Store.data.counters.__local = c;
      ren[r._id] = { mod: modId, to: `local-up-${c}` };
    }
    for (const m of tableMods()) for (const r of Store.list(m.id)) {
      if (ren[r._id] && ren[r._id].mod === m.id) r._id = ren[r._id].to;
      for (const f of m.fields || []) {
        if (f.type === 'relation' && r[f.key] && ren[r[f.key]] && ren[r[f.key]].mod === f.module) r[f.key] = ren[r[f.key]].to;
        if (f.type === 'link' && r[f.key]) { const [mm, id] = splitLink(r[f.key]); if (ren[id] && ren[id].mod === mm) r[f.key] = `${mm}:${ren[id].to}`; }
      }
      if (r._from) { const [mm, id] = splitLink(r._from); if (ren[id] && ren[id].mod === mm) r._from = `${mm}:${ren[id].to}`; }
    }
    const q = S().queue;
    for (const modId of Object.keys(mapping)) for (const r of Store.list(modId)) if (Store.isTemp(r._id) && !q.some((o) => o.id === r._id)) q.push({ mod: modId, id: r._id, at: new Date().toISOString() });
    return Object.keys(ren).length;
  }
  const splitLink = (l) => { const s = String(l); const i = s.indexOf(':'); return i < 0 ? ['', s] : [s.slice(0, i), s.slice(i + 1)]; };

  async function connect({ mapping, uploadLocal }) {
    if (Store.data.settings.mode === 'notion' && S().queue.length) throw new UserError(`還有 ${S().queue.length} 筆沒上傳到 Notion，請先按「立即同步」`);
    const clean = {}; for (const [k, v] of Object.entries(mapping)) if (v) clean[k] = v;
    if (!Object.keys(clean).length) throw new UserError('至少要選一張要同步的資料表');
    const schemas = await loadSchemas(clean);
    validateMapping(clean, schemas);
    if (window.leiyiNative && window.leiyiNative.autoBackup) await window.leiyiNative.autoBackup(Store.data);
    const s = S();
    s.mapping = clean; s.schemas = schemas; s.queue = []; s.errors = [];
    Store.data.settings.mode = 'notion';
    importOptions(schemas);
    let uploaded = 0;
    if (uploadLocal) uploaded = prepareUpload(clean);
    else for (const modId of Object.keys(clean)) Store.data.modules[modId] = [];
    await Store.save();
    await syncNow();
    return uploaded;
  }
  async function disconnect() {
    Store.data.settings.mode = 'local';
    const s = S(); s.mapping = {}; s.queue = []; s.schemas = {};
    // 換回本機編號，之後新增的資料用本機編號
    await Store.save();
  }

  // ---------- 上傳 ----------
  function remap(oldId, newId) {
    Store.alias[oldId] = newId;
    for (const m of tableMods()) for (const r of Store.list(m.id)) {
      let touched = false;
      if (r._id === oldId) r._id = newId;
      for (const f of m.fields || []) {
        if (f.type === 'relation' && r[f.key] === oldId) { r[f.key] = newId; touched = true; }
        if (f.type === 'link' && r[f.key]) { const [mm, id] = splitLink(r[f.key]); if (id === oldId) { r[f.key] = `${mm}:${newId}`; touched = true; } }
      }
      if (r._from) { const [mm, id] = splitLink(r._from); if (id === oldId) { r._from = `${mm}:${newId}`; touched = true; } }
      if (touched && r._id !== newId) Store.enqueue(m.id, r._id);
    }
    for (const o of S().queue) if (o.id === oldId) o.id = newId;
    if (Sync.onRemap) Sync.onRemap(oldId, newId);
  }
  async function push() {
    const s = S();
    if (!s.schemas || Object.keys(s.mapping).some((k) => !s.schemas[k])) s.schemas = await loadSchemas(s.mapping);
    while (s.queue.length) {
      const op = s.queue[0];
      const rec = Store.get(op.mod, op.id);
      if (!rec || !s.mapping[op.mod]) { s.queue.shift(); continue; }
      const props = toProps(op.mod, rec);
      try {
        let page;
        if (Store.isTemp(rec._id)) {
          page = await api('POST', '/v1/pages', { parent: { type: 'data_source_id', data_source_id: s.mapping[op.mod] }, properties: props });
          const old = rec._id;
          s.queue.shift();
          remap(old, page.id);
        } else {
          page = await api('PATCH', `/v1/pages/${rec._id}`, { properties: props });
          s.queue.shift();
        }
        for (const p of Object.values(page.properties || {})) if (p.type === 'unique_id') rec._no = uniqueNo(p);
        if (page.created_time) rec._created = page.created_time;
        if (page.last_edited_time) rec._updated = page.last_edited_time;
        await Store.save();
      } catch (e) {
        if (e.offline || e.auth) throw e;
        const m = mod(op.mod);
        s.errors.unshift({ at: new Date().toISOString(), mod: m.title, title: rec[m.titleKey] || '', message: e.message });
        s.errors = s.errors.slice(0, 30);
        s.queue.shift();
        await Store.save();
      }
    }
  }

  // ---------- 拉取 ----------
  async function pull() {
    const s = S();
    const pulled = {};
    for (const [modId, ds] of Object.entries(s.mapping)) {
      const pages = []; let cursor;
      do {
        const r = await api('POST', `/v1/data_sources/${ds}/query`, Object.assign({ page_size: 100 }, cursor ? { start_cursor: cursor } : {}));
        pages.push(...(r.results || []));
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor);
      pulled[modId] = pages;
    }
    for (const [modId, pages] of Object.entries(pulled)) {
      const local = Store.list(modId);
      const byId = new Map(local.map((r) => [r._id, r]));
      const dirty = new Set(s.queue.filter((o) => o.mod === modId).map((o) => o.id));
      const rows = [];
      const seen = new Set();
      for (const p of pages) {
        if (p.in_trash || p.archived) continue;
        seen.add(p.id);
        rows.push(dirty.has(p.id) && byId.get(p.id) ? byId.get(p.id) : fromPage(modId, p, byId.get(p.id)));
      }
      // 還沒上傳的本機資料要留著
      for (const r of local) if (!seen.has(r._id) && (Store.isTemp(r._id) || dirty.has(r._id))) rows.push(r);
      Store.data.modules[modId] = rows;
    }
    resolveLinks();
    s.lastSync = new Date().toISOString();
    await Store.save();
  }

  // ---------- 對外 ----------
  let running = null;
  async function syncNow() {
    if (Store.data.settings.mode !== 'notion') return;
    if (running) return running;
    running = (async () => {
      setStatus('syncing', '同步中…');
      try {
        await push();
        await pull();
        if (S().queue.length) await push();
        setStatus(S().errors.length ? 'warn' : 'ok', S().errors.length ? `有 ${S().errors.length} 筆同步問題` : '已同步');
      } catch (e) {
        if (e.offline) setStatus('offline', '離線中，資料先存在這台電腦，連上網路後會自動補傳');
        else if (e.auth) setStatus('error', e.message);
        else { console.error(e); setStatus('error', `同步失敗：${e.message}`); }
      } finally { running = null; }
    })();
    return running;
  }
  let pushTimer = null;
  function schedulePush() {
    if (Store.data.settings.mode !== 'notion') return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (running) { schedulePush(); return; }
      running = (async () => {
        setStatus('syncing', '上傳中…');
        try { await push(); setStatus(S().errors.length ? 'warn' : 'ok', S().errors.length ? `有 ${S().errors.length} 筆同步問題` : '已同步'); }
        catch (e) { setStatus(e.offline ? 'offline' : 'error', e.offline ? '離線中，連上網路後會自動補傳' : e.message); }
        finally { running = null; }
      })();
    }, Number(window.__LEIYI_PUSH_DELAY_MS ?? 1500));
  }
  let timer = null;
  function startAuto() {
    clearInterval(timer);
    if (Store.data.settings.mode !== 'notion') return;
    timer = setInterval(() => syncNow(), Number(window.__LEIYI_PULL_MS ?? 5 * 60 * 1000));
  }

  const Sync = {
    available, status, onStatus: (f) => listeners.push(f), onRemap: null,
    testConnection, discover, autoMap, connect, disconnect, syncNow, schedulePush, startAuto,
    readonlyField, synced, canArchive, report, toProps, fromPage, idFromUrl, AUTO, VERSION_NOTE,
    hasToken: () => (available() ? native().hasToken() : Promise.resolve(false)),
    setToken: (t) => native().setToken(t), clearToken: () => native().clearToken()
  };
  window.LeiyiSync = Sync;
})();
