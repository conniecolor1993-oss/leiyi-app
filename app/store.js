/* 資料層（Store）
 * 介面固定：load()、save()、list(module)、get(module,id)、upsert(module,record)、archive(module,id)
 * 本機：桌面版存成使用者資料夾裡的 leiyi-data.json；瀏覽器預覽存在 localStorage。
 * Notion 模式：本機檔案當暫存（離線也能看），每次變更排進「上傳佇列」，由 sync.js 送到 Notion。
 */
(function () {
  const KEY = 'leiyi-data';
  const blankSync = () => ({ mapping: {}, queue: [], errors: [], lastSync: '', workspace: '', schemas: {}, titles: {} });
  const empty = () => ({ version: 1, modules: {}, counters: {}, settings: Object.assign(JSON.parse(JSON.stringify(window.LEIYI.DEFAULT_CONFIG)), { mode: 'local', currentUser: '' }), sync: blankSync() });
  // 舊版或匯入的資料補齊缺少的欄位
  const normalize = (d) => {
    const base = empty();
    d.modules = d.modules || {}; d.counters = d.counters || {};
    d.settings = Object.assign(base.settings, d.settings || {});
    for (const k of ['people', 'lines', 'accounts', 'owners']) if (!Array.isArray(d.settings[k]) || !d.settings[k].length) d.settings[k] = base.settings[k];
    d.sync = Object.assign(blankSync(), d.sync || {});
    for (const k of ['queue', 'errors']) if (!Array.isArray(d.sync[k])) d.sync[k] = [];
    if (!d.sync.mapping || typeof d.sync.mapping !== 'object') d.sync.mapping = {};
    // 編號計數器一律不小於現有最大編號，避免匯入的檔案缺計數器時產生重複編號
    for (const rows of Object.values(d.modules)) {
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const m = /^([A-Za-z]+)-(\d+)$/.exec((r && r._id) || '');
        if (m) d.counters[m[1]] = Math.max(Number(d.counters[m[1]]) || 0, Number(m[2]));
      }
    }
    return d;
  };

  const LocalAdapter = {
    name: '本機',
    async read() {
      if (window.leiyiNative) return await window.leiyiNative.load();
      try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return LocalAdapter._mem || null; }
    },
    async write(data) {
      if (window.leiyiNative) return await window.leiyiNative.save(data);
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { LocalAdapter._mem = data; }
    }
  };

  const isTemp = (id) => typeof id === 'string' && id.startsWith('local-');

  const Store = {
    data: empty(),
    adapter: LocalAdapter,
    alias: {}, // 暫時編號 → Notion 正式編號（上傳後）
    onChange: null,
    async load() {
      const d = await this.adapter.read();
      this.data = d && d.modules ? normalize(d) : empty();
      return this.data;
    },
    async save() { await this.adapter.write(this.data); },
    list(m) { return (this.data.modules[m] = this.data.modules[m] || []); },
    resolveId(id) { let x = id, n = 0; while (this.alias[x] && n++ < 5) x = this.alias[x]; return x; },
    get(m, id) { const x = this.resolveId(id); return this.list(m).find((r) => r._id === x); },
    isNotion(modId) { return this.data.settings.mode === 'notion' && !!this.data.sync.mapping[modId]; },
    isTemp,
    // 畫面上顯示的編號：Notion 模式用 Notion 的編號，還沒上傳的顯示「待同步」
    dispId(r) { return r ? (r._no || (isTemp(r._id) ? '待同步' : r._id)) : ''; },
    nextId(prefix, modId) {
      if (this.isNotion(modId)) { const c = (this.data.counters.__local || 0) + 1; this.data.counters.__local = c; return `local-${Date.now().toString(36)}-${c}`; }
      const c = (this.data.counters[prefix] || 0) + 1;
      this.data.counters[prefix] = c;
      return `${prefix}-${c}`;
    },
    enqueue(modId, id) {
      if (!this.isNotion(modId)) return;
      const q = this.data.sync.queue;
      if (!q.some((o) => o.mod === modId && o.id === id)) q.push({ mod: modId, id, at: new Date().toISOString() });
    },
    async upsert(mod, rec, actor) {
      const now = new Date().toISOString();
      const rows = this.list(mod.id);
      let action = '修改';
      if (rec._id) rec._id = this.resolveId(rec._id);
      if (!rec._id) { rec._id = this.nextId(mod.prefix, mod.id); rec._created = now; rows.push(rec); action = '新增'; }
      else { const i = rows.findIndex((r) => r._id === rec._id); if (i === -1) rows.push(rec); else rows[i] = rec; }
      rec._updated = now;
      this.enqueue(mod.id, rec._id);
      if (mod.id !== 'logs') this.log(mod, rec, action, actor);
      await this.save();
      if (this.onChange) this.onChange();
      return rec;
    },
    async archive(mod, id, actor) {
      const r = this.get(mod.id, id);
      if (!r) return;
      r.狀態 = '封存'; r._updated = new Date().toISOString();
      this.enqueue(mod.id, r._id);
      this.log(mod, r, '封存', actor);
      await this.save();
      if (this.onChange) this.onChange();
    },
    log(mod, rec, action, actor) {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const title = rec[mod.titleKey] || this.dispId(rec);
      const logMod = window.LEIYI.MODULES.find((m) => m.id === 'logs');
      const l = {
        _id: this.nextId(logMod.prefix, 'logs'), _created: now.toISOString(), _updated: now.toISOString(),
        紀錄: `${action}｜${mod.title}｜${title}`, 日期: localDate,
        處理部門: rec.處理部門 || '', 執行者: actor || this.data.settings.currentUser || '使用者', 動作: action, 說明: `${mod.title} ${this.dispId(rec)}`
      };
      this.list('logs').push(l);
      this.enqueue('logs', l._id);
    },
    exportJSON() { return JSON.stringify(this.data, null, 2); },
    async importJSON(text) {
      let d;
      try { d = JSON.parse(text); } catch (e) { throw new UserError('檔案格式不對，請選擇本 APP 匯出的備份檔'); }
      if (!d || typeof d !== 'object' || !d.modules || typeof d.modules !== 'object') throw new UserError('檔案格式不對，請選擇本 APP 匯出的備份檔');
      this.data = normalize(d); this.alias = {}; await this.save();
    }
  };

  window.LeiyiStore = { Store, LocalAdapter, normalize, blankSync };
})();
