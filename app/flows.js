/* 資料通道（Flows）
 * 模組之間「互相應用」只走這裡，畫面（app.js）不直接改別的模組的資料。
 * 每條通道：輸入一筆紀錄 → 在目標模組建立／更新紀錄 → 雙向留下連結 → 自動寫處理紀錄。
 * 連結格式：'模組id:紀錄id'，例如 'ledger:FIN-3'。
 */
(function () {
  const { MODULES, DISPATCH, F } = window.LEIYI;
  const { Store } = window.LeiyiStore;
  const mod = (id) => MODULES.find((m) => m.id === id);
  const link = (m, r) => `${m}:${r._id}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const cfg = () => Store.data.settings;
  const deptOf = (m) => { const f = (m.fields || []).find((x) => x.key === '處理部門'); return f ? f.default : ''; };
  const firstLong = (m) => (m.fields || []).find((x) => x.type === 'longtext');

  // 依欄位預設值建立一筆新紀錄（不存檔）
  function blank(m) {
    const r = {};
    for (const f of m.fields || []) {
      if (f.default === 'today') r[f.key] = today();
      else if (f.default !== undefined) r[f.key] = f.default;
      else if (f.type === 'checkbox') r[f.key] = false;
    }
    return r;
  }

  function resolve(l) {
    if (!l || typeof l !== 'string' || !l.includes(':')) return null;
    const [mid, rid] = [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)];
    const m = mod(mid); if (!m) return null;
    const r = Store.get(mid, rid); return r ? { mod: m, rec: r } : null;
  }

  // 找出所有指向這筆的紀錄（關聯欄、連結欄、_from）
  function backlinks(m, rec) {
    const out = [];
    const target = link(m.id, rec);
    for (const om of MODULES) {
      if (!om.fields) continue;
      for (const r of Store.list(om.id)) {
        if (r === rec) continue;
        let hit = r._from === target;
        for (const f of om.fields) {
          if (f.type === 'relation' && f.module === m.id && r[f.key] === rec._id) hit = true;
          if (f.type === 'link' && r[f.key] === target) hit = true;
        }
        if (hit) out.push({ mod: om, rec: r });
      }
    }
    return out;
  }

  const actor = () => cfg().currentUser || '使用者';

  // ===== 通道 1：收件匣 → 分派到目標模組 =====
  async function dispatch(inbox) {
    const choice = inbox.分派至;
    if (!choice) throw new UserError('請先選「分派至」');
    if (inbox.分派結果) throw new UserError('這筆已經分派過了');
    const im = mod('inbox');
    if (choice === '不分派（只記錄）') { inbox.狀態 = '完成'; await Store.upsert(im, inbox, actor()); return null; }
    // 也接受目標格子的名稱，或它在 Notion 的資料表名稱（例如「工作任務總表」）
    const titles = (Store.data.sync && Store.data.sync.titles) || {};
    const target = DISPATCH[choice] || (MODULES.find((m) => m.kind === 'table' && m.title === choice) || {}).id || Object.keys(titles).find((k) => titles[k] === choice && Store.isNotion(k));
    if (!target) throw new UserError(`APP 裡沒有「${choice}」這個格子，請改選其他「分派至」`);
    const tm = mod(target);
    const r = blank(tm);
    r[tm.titleKey] = inbox.事項;
    if ('來源' in r) r.來源 = inbox.來源 || r.來源;
    if (inbox.日期 && '日期' in r) r.日期 = inbox.日期;
    const lf = firstLong(tm); if (lf && inbox.原始內容) r[lf.key] = inbox.原始內容;
    if (tm.id === 'pending') r.關聯紀錄 = link('inbox', inbox);
    if (tm.id === 'tasks') r.資料來源 = `收件匣${inbox.來源 ? '（' + inbox.來源 + '）' : ''}`;
    r._from = link('inbox', inbox);
    const created = await save(tm, r);
    inbox.分派結果 = link(tm.id, created);
    inbox.狀態 = '完成';
    await Store.upsert(im, inbox, actor());
    return { mod: tm, rec: created };
  }

  // ===== 通道 2：想法池 → 建立評估 =====
  async function ideaToEvaluation(idea) {
    if (idea.評估報告 && Store.get('evaluations', idea.評估報告)) throw new UserError('這個想法已經有評估了');
    const em = mod('evaluations');
    const r = blank(em);
    r.評估主題 = idea.想法; r.事業線 = idea.事業線 || ''; r._from = link('ideas', idea);
    if (idea.說明) r.評估內容 = idea.說明;
    const created = await save(em, r);
    idea.評估報告 = created._id; idea.狀態 = idea.狀態 === '待處理' ? '進行中' : idea.狀態;
    await Store.upsert(mod('ideas'), idea, actor());
    return { mod: em, rec: created };
  }

  // ===== 通道 3：評估（結論＝做）→ 轉成專案 =====
  async function evaluationToProject(ev) {
    if (ev.結論 !== '做') throw new UserError('結論要選「做」才能轉成專案');
    if (ev.轉成專案 && Store.get('projects', ev.轉成專案)) throw new UserError('已經轉成專案了');
    const pm = mod('projects');
    const r = blank(pm);
    r.專案名稱 = ev.評估主題; r.事業線 = ev.事業線 || ''; r._from = link('evaluations', ev);
    const created = await save(pm, r);
    ev.轉成專案 = created._id; ev.狀態 = '完成';
    await Store.upsert(mod('evaluations'), ev, actor());
    return { mod: pm, rec: created };
  }

  // ===== 通道 4：會議紀錄 → 建立衍生專案 =====
  async function meetingToProject(mt) {
    if (mt.衍生任務 && Store.get('projects', mt.衍生任務)) throw new UserError('這場會議已經有衍生專案了');
    const pm = mod('projects');
    const r = blank(pm);
    r.專案名稱 = `${mt.會議}｜衍生事項`; r.下一步 = mt.決議 ? String(mt.決議).split('\n')[0].slice(0, 60) : '';
    r._from = link('meetings', mt);
    const created = await save(pm, r);
    mt.衍生任務 = created._id;
    await Store.upsert(mod('meetings'), mt, actor());
    return { mod: pm, rec: created };
  }

  const openPendingFor = (l) => Store.list('pending').find((p) => p.關聯紀錄 === l && !['完成', '封存'].includes(p.狀態));

  // ===== 儲存前後的自動規則 =====
  function beforeSave(m, r) {
    if (m.id === 'tasks' && r.今天三件 && r.狀態 !== '完成') {
      const others = Store.list('tasks').filter((x) => x._id !== Store.resolveId(r._id) && x.今天三件 && x.狀態 !== '完成').length;
      if (others >= 3) throw new UserError('「今天三件」最多 3 件，請先取消其他一件或把它標成完成');
    }
    if (m.id === 'ledger') {
      for (const k of ['未稅金額', '稅額']) if (r[k] !== '' && r[k] != null) r[k] = Math.round(Number(r[k]) || 0);
      if (r.收支 === '收入' && r.日期 && !r.應收到期日 && r.收付款狀態 !== '已收') r.應收到期日 = addDays(r.日期, Number(cfg().receivableDays) || 30);
      // 科目要跟收支相符，不符就清掉
      if (r.科目 && ((r.收支 === '收入' && !r.科目.startsWith('I')) || (r.收支 === '支出' && !r.科目.startsWith('E')))) r.科目 = '';
    }
  }

  async function afterSave(m, r) {
    if (m.id === 'ledger') {
      const l = link('ledger', r);
      const open = openPendingFor(l);
      const big = F.含稅金額(r) > (Number(cfg().largeAmount) || 0);
      const needs = r.狀態 !== '封存' && !r.已確認 && (big || r.收支 === '收入');
      // 被「不同意」過、且金額與收支都沒變，就不再重複要求確認
      const rejectedSame = r._rejected && r._rejected === `${r.收支}|${F.含稅金額(r)}`;
      if (needs && !open && !rejectedSame) {
        const pm = mod('pending'); const p = blank(pm);
        p.需確認的事 = `確認帳務：${r.項目}（NT$${F.含稅金額(r).toLocaleString()}）`;
        p.權限等級 = 'L3'; p.處理部門 = 'FIN'; p.來源 = '系統自動'; p.關聯紀錄 = l; p.狀態 = '待確認';
        await Store.upsert(pm, p, '系統');
      }
      if (open && (r.已確認 || r.狀態 === '封存')) {
        open.狀態 = r.狀態 === '封存' ? '封存' : '完成';
        if (r.已確認 && !open.決定) open.決定 = '同意';
        await Store.upsert(mod('pending'), open, '系統');
      }
    }
    if (m.id === 'pending' && r.決定 && !['完成', '封存'].includes(r.狀態)) {
      const t = resolve(r.關聯紀錄);
      if (t && t.mod.id === 'ledger' && (r.決定 === '同意' || r.決定 === '修改後同意') && !t.rec.已確認) {
        t.rec.已確認 = true; delete t.rec._rejected; await Store.upsert(t.mod, t.rec, '系統');
      }
      if (t && t.mod.id === 'ledger' && r.決定 === '不同意') {
        t.rec._rejected = `${t.rec.收支}|${F.含稅金額(t.rec)}`; await Store.upsert(t.mod, t.rec, '系統');
      }
      r.狀態 = '完成'; await Store.upsert(m, r, '系統');
    }
    if (m.id === 'evaluations') {
      for (const idea of Store.list('ideas')) {
        if (idea.評估報告 === r._id) {
          const done = !!r.結論;
          if (idea.已評估 !== done) { idea.已評估 = done; await Store.upsert(mod('ideas'), idea, '系統'); }
        }
      }
    }
  }

  async function save(m, r) {
    beforeSave(m, r);
    const saved = await Store.upsert(m, r, actor());
    await afterSave(m, saved);
    return saved;
  }

  async function archive(m, r) {
    await Store.archive(m, r._id, actor());
    await afterSave(m, Store.get(m.id, r._id));
  }

  // 同一筆紀錄的通道同時只能跑一次（防止連點產生重複資料）
  const inflight = new Set();
  const once = (fn) => async (r) => {
    const key = r && r._id; if (!key) return fn(r);
    if (inflight.has(key)) throw new UserError('處理中，請稍候');
    inflight.add(key);
    try { return await fn(r); } finally { inflight.delete(key); }
  };

  // 每個模組在詳細頁可用的通道按鈕
  const ACTIONS = {
    inbox: [{ label: '分派', run: once(dispatch), when: (r) => r._id && !r.分派結果 && r.狀態 !== '封存' }],
    ideas: [{ label: '建立評估', run: once(ideaToEvaluation), when: (r) => r._id && !(r.評估報告 && Store.get('evaluations', r.評估報告)) && r.狀態 !== '封存' }],
    evaluations: [{ label: '轉成專案', run: once(evaluationToProject), when: (r) => r._id && r.結論 === '做' && !(r.轉成專案 && Store.get('projects', r.轉成專案)) && r.狀態 !== '封存' }],
    meetings: [{ label: '建立衍生專案', run: once(meetingToProject), when: (r) => r._id && !(r.衍生任務 && Store.get('projects', r.衍生任務)) && r.狀態 !== '封存' }]
  };

  window.LeiyiFlows = { blank, resolve, backlinks, save, archive, ACTIONS, today, addDays, mod };
})();
