// 測試用的假 Notion（照 Connie 實際資料表欄位型態做的），只在測試時使用
// 控制：GET /__ctl/state、POST /__ctl/set {offline, n429}、POST /__ctl/edit {ds, title, props}
const http = require('http');
const crypto = require('crypto');
const TOKEN = 'ntn_testtoken1234567890abcdefghij';
const uid = () => crypto.randomUUID();
const sel = (...n) => ({ type: 'select', select: { options: n.map((name) => ({ name })) } });
const sta = (...n) => ({ type: 'status', status: { options: n.map((name) => ({ name })) } });
const T = (t) => ({ type: t, [t]: {} });
const STATUS = sta('待處理', '進行中', '待確認', '完成', '封存');
const DEPT = sel('SEC', 'FIN', 'PRJ', 'RES', 'MTG', 'HR');
const SRC = sel('Connie丟的', 'Gmail', '排程自動', 'n8n', '員工');
const sys = { 編號: { type: 'unique_id', unique_id: { prefix: null } }, 建立時間: T('created_time'), 最後編輯: T('last_edited_time') };
const DS = {
  收件匣: { 事項: T('title'), 狀態: STATUS, 來源: SRC, 分派至: sel('帳務', '專案', '想法池', '行事曆', '工作任務總表', '學習庫', '其他'), 分派結果連結: T('url'), 來源紀錄: T('url'), 原始內容: T('rich_text'), 日期: T('date'), 處理部門: DEPT, 附件連結: T('url'), ...sys },
  帳務: { 項目: T('title'), 狀態: STATUS, 日期: T('date'), 收支: sel('收入', '支出'), 未稅金額: T('number'), 稅額: T('number'), 含稅金額: T('formula'), 科目: sel('I01 顧問服務收入', 'E01 軟體訂閱', 'E02 交通'), 公私: sel('公司', '私人'), 已確認: T('checkbox'), 可扣抵: T('checkbox'), 買方統編正確: T('checkbox'), 收付款狀態: sel('未收', '已收', '未付', '已付'), 應收到期日: T('date'), 對方名稱: T('rich_text'), 發票號碼: T('rich_text'), 來源: SRC, 來源紀錄: T('url'), 處理部門: DEPT, ...sys },
  待確認: { 需確認的事: T('title'), 狀態: STATUS, 決定: sel('同意', '不同意', '修改後同意'), 權限等級: sel('L2', 'L3'), 關聯紀錄: T('url'), 說明: T('rich_text'), 來源: SRC, 來源紀錄: T('url'), 處理部門: DEPT, 日期: T('date'), 等待天數: T('formula'), ...sys },
  處理紀錄: { 紀錄: T('title'), 日期: T('date'), 處理部門: DEPT, 執行者: sel('Claude', 'Connie'), 動作: sel('新增', '修改', '封存', '提醒', '報告'), 說明: T('rich_text'), 對象: T('url'), ...sys },
  工作任務總表: { 事情: T('title'), 狀態: sta('待核對', '待做', '進行中', '等人', '暫緩', '完成'), 今天三件: T('checkbox'), 安排日期: T('date'), 原訂日期: T('date'), 分類: sel('主業A', '主業B'), 歸屬: sel('雷翼', '個人', '客戶', 'BNI／吐司會'), 負責人: T('rich_text'), 下一步: T('rich_text'), 卡點: T('rich_text'), 資料來源: T('rich_text') },
  專案: { 專案名稱: T('title'), 狀態: STATUS, 負責人: T('people'), 下一步: T('rich_text'), 截止日: T('date'), 事業線: sel('主業A', '主業B'), 來源紀錄: T('url'), ...sys },
  BNI人脈: { 姓名: T('title'), 公司: T('rich_text'), 專業: T('rich_text'), 合作狀態: sel('待分析', '洽談中'), 聯絡方式: T('rich_text'), 追蹤日期: T('date'), 下一步: T('rich_text') },
  學習庫: { 名稱: T('title'), 網址: T('url') }
};
const db = {}; // dsId → { title, props, pages:[] , counter }
for (const [title, props] of Object.entries(DS)) {
  const id = uid();
  for (const [k, v] of Object.entries(props)) v.name = k;
  db[id] = { id, title, props, pages: [], counter: 0 };
}
const ctl = { offline: false, n429: 0, calls: [] };
const now = () => new Date().toISOString();
const pageObj = (ds, p) => ({ object: 'page', id: p.id, created_time: p.created, last_edited_time: p.edited, in_trash: !!p.trash, parent: { type: 'data_source_id', data_source_id: ds.id }, properties: p.properties, url: `https://www.notion.so/${p.id.replace(/-/g, '')}` });
function blankProps(ds, p) {
  const out = {};
  for (const [k, def] of Object.entries(ds.props)) {
    const base = { id: k, type: def.type };
    switch (def.type) {
      case 'title': case 'rich_text': base[def.type] = []; break;
      case 'select': base.select = null; break;
      case 'status': base.status = { name: def.status.options[0].name }; break;
      case 'date': base.date = null; break;
      case 'number': base.number = null; break;
      case 'checkbox': base.checkbox = false; break;
      case 'url': base.url = null; break;
      case 'people': base.people = [{ object: 'user', id: 'u1', name: 'Connie' }]; break;
      case 'relation': base.relation = []; break;
      case 'unique_id': base.unique_id = { prefix: null, number: p.no }; break;
      case 'formula': base.formula = { type: 'number', number: 0 }; break;
      case 'created_time': base.created_time = p.created; break;
      case 'last_edited_time': base.last_edited_time = p.edited; break;
      default: base[def.type] = null;
    }
    out[k] = base;
  }
  return out;
}
const err = (status, message) => ({ status, body: { object: 'error', status, message } });
function applyProps(ds, page, props) {
  for (const [k, v] of Object.entries(props || {})) {
    const def = ds.props[k];
    if (!def) return err(400, `${k} is not a property that exists.`);
    if (['formula', 'created_time', 'last_edited_time', 'unique_id', 'people'].includes(def.type)) return err(400, `${k} is read-only`);
    const val = v[def.type];
    if (val === undefined) return err(400, `${k} is expected to be ${def.type}.`);
    if (def.type === 'status') { if (!def.status.options.some((o) => o.name === val.name)) return err(400, `Invalid status option. Status option "${val.name}" does not exist".`); }
    if (def.type === 'select' && val) { if (/,/.test(val.name)) return err(400, 'Select option names cannot contain commas.'); if (!def.select.options.some((o) => o.name === val.name)) def.select.options.push({ name: val.name }); }
    if (def.type === 'title' || def.type === 'rich_text') { if (!Array.isArray(val)) return err(400, 'bad rich text'); for (const t of val) { if (t.text.content.length > 2000) return err(400, 'text too long'); t.plain_text = t.text.content; } }
    if (def.type === 'title' && val.map((t) => t.plain_text).join('').includes('BAD400')) return err(400, 'mock rejected this title');
    if (def.type === 'url' && val !== null && !/^https?:\/\//.test(val)) return err(400, 'bad url');
    page.properties[k] = { id: k, type: def.type, [def.type]: val };
  }
  page.edited = now();
  return null;
}
function findPage(id) { for (const ds of Object.values(db)) { const p = ds.pages.find((x) => x.id === id); if (p) return [ds, p]; } return []; }

function handle(method, path, body, auth) {
  if (auth !== `Bearer ${TOKEN}`) return err(401, 'API token is invalid.');
  let m;
  if (method === 'GET' && path === '/v1/users/me') return { status: 200, body: { object: 'user', type: 'bot', name: '雷翼APP', bot: { workspace_name: 'Connie 的工作區' } } };
  if (method === 'POST' && path === '/v1/search') {
    const all = Object.values(db).map((d) => ({ object: 'data_source', id: d.id, title: [{ plain_text: d.title }] }));
    const start = Number(body.start_cursor || 0); const size = 5;
    return { status: 200, body: { results: all.slice(start, start + size), has_more: start + size < all.length, next_cursor: start + size < all.length ? String(start + size) : null } };
  }
  if (method === 'GET' && (m = /^\/v1\/data_sources\/([0-9a-f-]+)$/.exec(path))) {
    const d = db[m[1]]; if (!d) return err(404, 'not found');
    return { status: 200, body: { object: 'data_source', id: d.id, title: [{ plain_text: d.title }], properties: d.props } };
  }
  if (method === 'POST' && (m = /^\/v1\/data_sources\/([0-9a-f-]+)\/query$/.exec(path))) {
    const d = db[m[1]]; if (!d) return err(404, 'not found');
    const start = Number(body.start_cursor || 0); const size = Math.min(3, body.page_size || 100); // 故意很小，測分頁
    const list = d.pages;
    return { status: 200, body: { results: list.slice(start, start + size).map((p) => pageObj(d, p)), has_more: start + size < list.length, next_cursor: start + size < list.length ? String(start + size) : null } };
  }
  if (method === 'POST' && path === '/v1/pages') {
    const d = db[body.parent && body.parent.data_source_id]; if (!d) return err(404, 'parent not found');
    const p = { id: uid(), created: now(), edited: now(), no: ++d.counter };
    p.properties = blankProps(d, p);
    const e = applyProps(d, p, body.properties); if (e) { d.counter--; return e; }
    d.pages.push(p);
    return { status: 200, body: pageObj(d, p) };
  }
  if (method === 'PATCH' && (m = /^\/v1\/pages\/([0-9a-f-]+)$/.exec(path))) {
    const [d, p] = findPage(m[1]); if (!p) return err(404, 'page not found');
    const copy = JSON.parse(JSON.stringify(p));
    const e = applyProps(d, copy, body.properties); if (e) return e;
    Object.assign(p, copy);
    return { status: 200, body: pageObj(d, p) };
  }
  return err(400, `mock: unsupported ${method} ${path}`);
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, obj, headers) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, headers || {})); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/cal/')) { // 假 Google 日曆（iCal）
      if (ctl.calDown) { res.writeHead(404); return res.end('gone'); }
      const p2 = (n) => String(n).padStart(2, '0'); const d = new Date(); const t = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
      const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:t1', `DTSTART;TZID=Asia/Taipei:${t}T090000`, `DTEND;TZID=Asia/Taipei:${t}T100000`, 'SUMMARY:今天的測試會議', 'LOCATION:雷翼辦公室', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:t2', `DTSTART;VALUE=DATE:${t}`, 'RRULE:FREQ=WEEKLY', 'SUMMARY:每週例行', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' }); return res.end(ics);
    }
    if (req.url.startsWith('/__ctl/')) {
      if (req.url === '/__ctl/state') return send(200, { db, ctl });
      if (req.url === '/__ctl/set') { Object.assign(ctl, body); return send(200, ctl); }
      if (req.url === '/__ctl/edit') { // 模擬有人在 Notion 上直接改／新增／刪除
        const d = Object.values(db).find((x) => x.title === body.ds);
        if (body.create) { const p = { id: uid(), created: now(), edited: now(), no: ++d.counter }; p.properties = blankProps(d, p); applyProps(d, p, body.props); d.pages.push(p); return send(200, { id: p.id }); }
        const p = d.pages.find((x) => x.properties[Object.keys(d.props).find((k) => d.props[k].type === 'title')].title.map((t) => t.plain_text).join('') === body.title);
        if (body.trash) p.trash = true; else applyProps(d, p, body.props);
        return send(200, { id: p.id });
      }
    }
    if (ctl.offline) { req.socket.destroy(); return; }
    ctl.calls.push(`${req.method} ${req.url}`);
    if (ctl.n429 > 0) { ctl.n429--; return send(429, { message: 'rate limited' }, { 'Retry-After': '0' }); }
    const r = handle(req.method, req.url, body, req.headers.authorization);
    send(r.status, r.body);
  });
});
// 查詢時把被刪的頁面濾掉（真的 Notion 查詢不會回傳垃圾桶裡的頁面）
server.listen(Number(process.env.PORT || 8790), () => console.log('mock notion on', server.address().port));
module.exports = { TOKEN };
