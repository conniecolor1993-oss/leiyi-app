// Notion 同步端對端測試：用真的桌面版（Electron）對假 Notion 操作
// 執行：xvfb-run -a node tests/sync_e2e.js
const { _electron: electron } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'ntn_testtoken1234567890abcdefghij';
const ROOT = path.join(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'leiyi-sync-'));
const passed = []; const fails = []; const pageErrors = [];
const check = (name, cond, detail) => (cond ? passed : fails).push(name + (cond ? '' : `  → ${JSON.stringify(detail)}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctl = async (p, body) => (await fetch(BASE + '/__ctl/' + p, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json();
const dsPages = async (title) => { const s = await ctl('state'); const d = Object.values(s.db).find((x) => x.title === title); return d.pages.filter((p) => !p.trash); };
const titleOfPage = (p) => { const t = Object.values(p.properties).find((x) => x.type === 'title'); return t.title.map((x) => x.plain_text).join(''); };
const prop = (p, k) => { const x = p.properties[k]; if (!x) return undefined; const v = x[x.type]; if (x.type === 'select' || x.type === 'status') return v && v.name; if (x.type === 'rich_text' || x.type === 'title') return v.map((t) => t.plain_text).join(''); return v; };
const hex = (id) => id.replace(/-/g, '');

let app, pg;
async function launch() {
  app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { LEIYI_NOTION_BASE: BASE, LEIYI_USER_DATA: userData }) });
  pg = await app.firstWindow();
  pg.on('pageerror', (e) => pageErrors.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  pg.on('dialog', (d) => d.accept());
  await pg.waitForLoadState('domcontentloaded');
  await pg.evaluate(() => { window.__LEIYI_THROTTLE_MS = 0; window.__LEIYI_PUSH_DELAY_MS = 50; });
  await sleep(300);
}
const S = (fn, arg) => pg.evaluate(fn, arg);
const rows = (mod) => S((m) => JSON.parse(JSON.stringify(window.LeiyiStore.Store.list(m))), mod);
const sync = () => S(() => window.LeiyiSync.syncNow());
const idle = async () => { for (let i = 0; i < 100; i++) { const st = await S(() => ({ s: window.LeiyiSync.status.state, q: window.LeiyiStore.Store.data.sync.queue.length })); if (st.s !== 'syncing' && st.q === 0) return st; await sleep(100); } return null; };
const nav = async (id) => { await pg.click(`[data-nav="${id}"]`); await sleep(80); };
const fld = (key, tag = 'input') => pg.locator(`.drawer label[data-field="${key}"] ${tag}`).first();
const fill = (k, v) => fld(k).fill(String(v));
const pick = (k, v) => fld(k, 'select').selectOption(v);
const save = async () => { await pg.click('#btn-save'); await sleep(200); };
const close = async () => { await pg.keyboard.press('Escape'); await sleep(100); };
const lastToast = async () => { const t = pg.locator('.toast').last(); return (await t.count()) ? t.innerText() : ''; };
const newRec = async (mod) => { await nav(mod); await pg.click('#btn-new'); await sleep(100); };

(async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock_notion.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => mock.stdout.once('data', r));
  try {
    // Notion 上已經有的資料
    await ctl('edit', { ds: '工作任務總表', create: true, props: { 事情: { title: [{ text: { content: 'A任務' } }] }, 狀態: { status: { name: '進行中' } }, 歸屬: { select: { name: 'BNI／吐司會' } } } });
    await ctl('edit', { ds: '工作任務總表', create: true, props: { 事情: { title: [{ text: { content: 'B任務' } }] } } });
    for (let i = 0; i < 5; i++) await ctl('edit', { ds: 'BNI人脈', create: true, props: { 姓名: { title: [{ text: { content: `人脈${i}` } }] } } });
    await ctl('edit', { ds: '專案', create: true, props: { 專案名稱: { title: [{ text: { content: 'Notion專案' } }] } } });

    await launch();
    await pg.fill('#setup-name', '測試公司'); await pg.click('#setup-go'); await sleep(200);
    // 連線前先在本機建一筆帳
    await newRec('ledger'); await fill('項目', '本機舊帳'); await fill('未稅金額', 100); await save(); await close();
    const localId = (await rows('ledger'))[0]._id;
    check('本機模式編號', /^FIN-\d+$/.test(localId), localId);

    // ---- 連線設定 ----
    await nav('settings');
    await pg.fill('#notion-token', 'abc'); await pg.click('#btn-notion-token'); await sleep(200);
    check('錯誤金鑰格式被擋', /格式/.test(await lastToast()), await lastToast());
    await pg.fill('#notion-token', TOKEN); await pg.click('#btn-notion-token');
    await pg.waitForSelector('#notion-pick', { timeout: 10000 });
    const auto = await S(() => Object.fromEntries([...document.querySelectorAll('[data-map]')].map((s) => [s.dataset.map, s.selectedOptions[0].textContent])));
    check('自動配對 每日任務→工作任務總表', auto.tasks === '工作任務總表', auto);
    check('自動配對 聯絡人→BNI人脈', auto.contacts === 'BNI人脈', auto);
    check('自動配對 帳務／收件匣／待確認／處理紀錄', auto.ledger === '帳務' && auto.inbox === '收件匣' && auto.pending === '待確認' && auto.logs === '處理紀錄', auto);
    check('沒有的表不亂配', !String(auto.ideas).includes('學習庫') && auto.ideas.startsWith('—'), auto);
    check('搜尋分頁讀完全部表', (await pg.locator('[data-map="ledger"] option').count()) === 9);
    check('設定卡沒有多餘的 null 字', !/null|undefined/.test(await pg.locator('#notion-card').innerText()));
    await pg.selectOption('#notion-upload', 'yes');
    await pg.click('#btn-notion-start');
    await sleep(500); await idle();
    let ledgerPages = await dsPages('帳務');
    check('本機舊帳上傳到 Notion', ledgerPages.some((p) => titleOfPage(p) === '本機舊帳' && prop(p, '未稅金額') === 100), ledgerPages.map(titleOfPage));
    const l0 = (await rows('ledger')).find((r) => r.項目 === '本機舊帳');
    check('上傳後改用 Notion 編號', l0 && /^[0-9a-f-]{36}$/.test(l0._id) && l0._no === '1', l0);
    check('Notion 原有任務拉進來', (await rows('tasks')).map((r) => r.事情).sort().join() === 'A任務,B任務');
    check('任務狀態 status 型態讀對', (await rows('tasks')).find((r) => r.事情 === 'A任務').狀態 === '進行中');
    check('Notion 選項補進 APP 清單', await S(() => window.LeiyiStore.Store.data.settings.owners.includes('BNI／吐司會')));
    check('分頁拉取 5 筆人脈', (await rows('contacts')).length === 5, (await rows('contacts')).length);
    check('左下顯示已同步', /已同步/.test(await pg.locator('#sync-status').innerText()));
    check('切換前自動備份', fs.existsSync(path.join(userData, 'backups')) && fs.readdirSync(path.join(userData, 'backups')).length === 1);
    const pendBig = (await dsPages('待確認')).length;

    // ---- 收件匣分派 → 帳務（雙向連結要變成 Notion 網址） ----
    await newRec('inbox'); await fill('事項', '買文具'); await pick('分派至', '帳務'); await save();
    await pg.click('[data-action="分派"]'); await sleep(300); await idle();
    const inb = (await dsPages('收件匣')).find((p) => titleOfPage(p) === '買文具');
    const led = (await dsPages('帳務')).find((p) => titleOfPage(p) === '買文具');
    check('分派後兩邊都在 Notion', inb && led);
    check('收件匣 分派結果連結 指向帳務頁', inb && led && String(prop(inb, '分派結果連結')).includes(hex(led.id)), inb && prop(inb, '分派結果連結'));
    check('帳務 來源紀錄 指向收件匣頁', inb && led && String(prop(led, '來源紀錄')).includes(hex(inb.id)), led && prop(led, '來源紀錄'));
    check('收件匣 狀態=完成', inb && prop(inb, '狀態') === '完成');
    const ri = (await rows('inbox')).find((r) => r.事項 === '買文具');
    check('APP 內連結也換成正式編號', ri && ri.分派結果 === `ledger:${led.id}`, ri && ri.分派結果);
    await sync(); await idle();
    const ri2 = (await rows('inbox')).find((r) => r.事項 === '買文具');
    check('重新拉取後連結還在', ri2 && ri2.分派結果 === `ledger:${led.id}`, ri2 && ri2.分派結果);
    const rl2 = (await rows('ledger')).find((r) => r.項目 === '買文具');
    check('重新拉取後來源還在', rl2 && rl2._from === `inbox:${inb.id}`, rl2 && rl2._from);
    check('處理紀錄有寫進 Notion', (await dsPages('處理紀錄')).length >= 4);

    // ---- 分派到每日任務 ----
    await newRec('inbox'); await fill('事項', '打電話給會計'); await pick('分派至', '每日任務'); await save();
    await pg.click('[data-action="分派"]'); await sleep(300); await idle();
    const tk = (await dsPages('工作任務總表')).find((p) => titleOfPage(p) === '打電話給會計');
    check('分派到 工作任務總表', tk && prop(tk, '狀態') === '待做' && /收件匣/.test(prop(tk, '資料來源')), tk && tk.properties);

    // ---- 大額 → 自動待確認，關聯紀錄是帳務網址 ----
    await newRec('ledger'); await fill('項目', '買電腦'); await fill('未稅金額', 30000); await save(); await close(); await idle();
    const bigL = (await dsPages('帳務')).find((p) => titleOfPage(p) === '買電腦');
    const pends = await dsPages('待確認');
    const pb = pends.find((p) => /買電腦/.test(titleOfPage(p)));
    check('大額自動建待確認並上傳', pends.length === pendBig + 1 && pb && prop(pb, '權限等級') === 'L3');
    check('待確認 關聯紀錄 指向帳務頁', pb && bigL && String(prop(pb, '關聯紀錄')).includes(hex(bigL.id)), pb && prop(pb, '關聯紀錄'));
    // 在 APP 同意 → 帳務已確認
    await nav('pending'); const pRow = (await rows('pending')).find((r) => /買電腦/.test(r.需確認的事));
    await pg.click(`tr[data-id="${pRow._id}"]`); await sleep(100); await pick('決定', '同意'); await save(); await close(); await idle();
    const bigL2 = (await dsPages('帳務')).find((p) => titleOfPage(p) === '買電腦');
    check('同意後 Notion 帳務已確認', bigL2 && prop(bigL2, '已確認') === true);

    // ---- Notion 端修改／刪除 ----
    await ctl('edit', { ds: '工作任務總表', title: 'A任務', props: { 下一步: { rich_text: [{ text: { content: '從Notion改' } }] } } });
    await ctl('edit', { ds: '工作任務總表', title: 'B任務', trash: true });
    await nav('tasks'); await pg.click('#btn-sync-now').catch(() => {}); await sync(); await idle(); await sleep(200);
    const ts = await rows('tasks');
    check('Notion 改的內容拉回 APP', ts.find((r) => r.事情 === 'A任務').下一步 === '從Notion改');
    check('Notion 刪掉的 APP 也消失', !ts.some((r) => r.事情 === 'B任務'));
    check('清單畫面自動更新', (await pg.locator('table.grid tbody').innerText()).includes('從Notion改'));

    // ---- 人員欄位唯讀、封存規則 ----
    await nav('projects'); const pj = (await rows('projects')).find((r) => r.專案名稱 === 'Notion專案');
    await pg.click(`tr[data-id="${pj._id}"]`); await sleep(100);
    check('人員欄位讀得到', pj.負責人 === 'Connie', pj.負責人);
    check('人員欄位不能在 APP 改', await pg.locator('.drawer label[data-field="負責人"]').locator('input, select').first().isDisabled());
    check('專案可封存', (await pg.locator('#btn-archive').count()) === 1);
    await close();
    await nav('tasks'); await pg.click(`tr[data-id="${ts[0]._id}"]`); await sleep(100);
    check('每日任務沒有封存鈕（Notion 沒有封存狀態）', (await pg.locator('#btn-archive').count()) === 0);
    await close();
    await nav('ledger'); const lj = (await rows('ledger')).find((r) => r.項目 === '本機舊帳');
    await pg.click(`tr[data-id="${lj._id}"]`); await sleep(100); await pg.click('#btn-archive'); await sleep(300); await idle();
    check('封存寫到 Notion 狀態', prop((await dsPages('帳務')).find((p) => titleOfPage(p) === '本機舊帳'), '狀態') === '封存');

    // ---- 今天三件上限 ----
    for (const n of ['T1', 'T2', 'T3', 'T4']) { await newRec('tasks'); await fill('事情', n); await fld('今天三件').check(); await save(); await close(); }
    check('今天三件最多 3 件', (await rows('tasks')).filter((r) => r.今天三件).length === 3);
    await idle();
    await nav('home');
    check('首頁顯示今天三件', /T1/.test(await pg.locator('.cards').first().innerText()));

    // ---- 離線 ----
    await ctl('set', { offline: true });
    await newRec('tasks'); await fill('事情', '離線新增'); await save(); await close(); await sleep(800);
    const st = await S(() => ({ s: window.LeiyiSync.status.state, q: window.LeiyiStore.Store.data.sync.queue.length }));
    check('離線時先存本機、顯示離線', st.s === 'offline' && st.q >= 1, st);
    check('離線新增的顯示「待同步」', (await pg.locator('table.grid').innerText()).includes('待同步'));
    await ctl('set', { offline: false }); await sync(); await idle();
    check('連線後補傳', (await dsPages('工作任務總表')).some((p) => titleOfPage(p) === '離線新增'));

    // ---- 429 與 400 ----
    await ctl('set', { n429: 2 });
    await newRec('tasks'); await fill('事情', '限流測試'); await save(); await close(); await idle();
    check('被限流會自動重試', (await dsPages('工作任務總表')).some((p) => titleOfPage(p) === '限流測試'));
    await newRec('tasks'); await fill('事情', 'BAD400 壞資料'); await save(); await close(); await idle();
    const errs = await S(() => window.LeiyiStore.Store.data.sync.errors);
    check('Notion 拒絕的記到同步問題', errs.some((e) => e.mod === '每日任務' && /BAD400/.test(e.title)), errs);
    check('壞資料不卡住佇列', (await S(() => window.LeiyiStore.Store.data.sync.queue.length)) === 0);
    await newRec('tasks'); await fill('事情', '之後的正常資料'); await save(); await close(); await idle();
    check('之後的資料照常上傳', (await dsPages('工作任務總表')).some((p) => titleOfPage(p) === '之後的正常資料'));
    await nav('settings');
    check('設定頁列出同步問題', (await pg.locator('#notion-errors').innerText()).includes('BAD400'));

    // ---- 重開 APP 不重複 ----
    const before = { t: (await dsPages('工作任務總表')).length, l: (await dsPages('帳務')).length };
    await app.close(); await launch(); await sleep(500); await idle();
    const after = { t: (await dsPages('工作任務總表')).length, l: (await dsPages('帳務')).length };
    check('重開後不會重複上傳', before.t === after.t && before.l === after.l, { before, after });
    check('重開後重新讀 Notion 欄位', (await S(() => !!window.LeiyiStore.Store.data.sync.schemas.tasks.事情)));
    check('重開後資料還在', (await rows('tasks')).some((r) => r.事情 === '離線新增'));
    check('重開後還是 Notion 模式', (await S(() => window.LeiyiStore.Store.data.settings.mode)) === 'notion');
    check('金鑰不在畫面資料裡', !JSON.stringify(await S(() => window.LeiyiStore.Store.data)).includes(TOKEN));
    check('金鑰檔是加密或存在使用者資料夾', fs.existsSync(path.join(userData, 'notion-token.bin')));
    // 不允許的路徑
    const bad = await S(() => window.leiyiNative.notion.request('DELETE', '/v1/blocks/x'));
    check('主程式擋掉不允許的 Notion 路徑', bad.status === 400);

    // ---- 中斷連線 ----
    await nav('settings'); await pg.click('#btn-notion-off'); await sleep(300);
    check('中斷後回本機模式', (await S(() => window.LeiyiStore.Store.data.settings.mode)) === 'local');
    check('中斷後資料保留', (await rows('tasks')).length > 0);
    await newRec('tasks'); await fill('事情', '本機新任務'); await save(); await close();
    check('中斷後新增用本機編號', /^TASK-\d+$/.test((await rows('tasks')).find((r) => r.事情 === '本機新任務')._id));
    check('中斷後金鑰移除', !fs.existsSync(path.join(userData, 'notion-token.bin')));
  } catch (e) {
    fails.push('測試中斷：' + (e.stack || e));
  } finally {
    if (app) await app.close().catch(() => {});
    mock.kill();
    console.log(passed.map((x) => '✔ ' + x).join('\n'));
    if (fails.length) console.log(fails.map((x) => '✘ ' + x).join('\n'));
    if (pageErrors.length) console.log('畫面錯誤：\n' + pageErrors.join('\n'));
    console.log(`\nNotion 同步測試：通過 ${passed.length} 項，失敗 ${fails.length} 項，畫面錯誤 ${pageErrors.length} 個`);
    process.exit(fails.length || pageErrors.length ? 1 : 0);
  }
})();
