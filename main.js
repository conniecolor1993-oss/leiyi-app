// 雷翼公司APP｜桌面主程式（Electron）
// 負責：開視窗、把資料安全地存成本機檔案、匯出備份。畫面在 app/ 資料夾。
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'leiyi-data.json');

function readData() {
  const f = dataFile();
  for (const p of [f, f + '.bak']) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* 主檔壞掉就讀備份 */ }
  }
  return null;
}

// 先寫暫存檔再改名，避免寫到一半斷電把資料弄壞；同時保留上一版 .bak
function writeData(data) {
  const f = dataFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
  return true;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    title: '雷翼公司APP',
    backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // 外部連結用系統瀏覽器開，不在 APP 裡開
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  setupUpdater(win);
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => {
  if (!data || typeof data !== 'object' || !data.modules) throw new Error('資料格式錯誤，未寫入');
  return writeData(data);
});
ipcMain.handle('data:path', () => dataFile());
ipcMain.handle('data:export', async (e, name, text) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const safe = String(name || 'backup.json').replace(/[\\/:*?"<>|]/g, '_');
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, String(text), 'utf8');
  return true;
});

// ---------- Notion 連線（金鑰加密存在這台電腦，畫面拿不到金鑰） ----------
const tokenFile = () => path.join(app.getPath('userData'), 'notion-token.bin');
const NOTION_BASE = process.env.LEIYI_NOTION_BASE || 'https://api.notion.com';
function readToken() {
  try {
    const buf = fs.readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch (e) { return ''; }
}
ipcMain.handle('notion:setToken', (_e, t) => {
  const tok = String(t || '').trim();
  if (!/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(tok)) throw new Error('金鑰格式不對，應該是 ntn_ 開頭的一長串');
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(tok) : Buffer.from(tok, 'utf8'));
  return true;
});
ipcMain.handle('notion:hasToken', () => !!readToken());
ipcMain.handle('notion:clearToken', () => { try { fs.unlinkSync(tokenFile()); } catch (e) { /* 沒有就算了 */ } return true; });
const ALLOWED = /^\/v1\/(users\/me|search|pages(\/[0-9a-f-]{32,36})?|data_sources\/[0-9a-f-]{32,36}(\/query)?)$/i;
ipcMain.handle('notion:request', async (_e, method, p, body) => {
  const m = String(method || '').toUpperCase();
  if (!['GET', 'POST', 'PATCH'].includes(m) || !ALLOWED.test(String(p))) return { status: 400, json: { message: '不允許的 Notion 路徑' } };
  const token = readToken();
  if (!token) return { status: 401, json: { message: '尚未設定 Notion 金鑰' } };
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
    const r = await net.fetch(NOTION_BASE + p, {
      method: m, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
      body: m === 'GET' ? undefined : JSON.stringify(body || {})
    });
    clearTimeout(to);
    let json = null; try { json = await r.json(); } catch (e) { json = null; }
    return { status: r.status, retryAfter: r.headers.get('retry-after'), json };
  } catch (e) { return { status: 0, json: { message: String(e.message || e) } }; }
});
// ---------- Google 日曆（iCal 私人網址，加密存在這台電腦，畫面拿不到網址） ----------
const calFile = () => path.join(app.getPath('userData'), 'calendars.bin');
const CAL_OK = (u) => /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s]+\.ics$/i.test(u) || (process.env.LEIYI_ICAL_ALLOW && String(u).startsWith(process.env.LEIYI_ICAL_ALLOW));
function readCals() {
  try {
    const buf = fs.readFileSync(calFile());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    const arr = JSON.parse(txt); return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function writeCals(arr) {
  const txt = JSON.stringify(arr);
  fs.mkdirSync(path.dirname(calFile()), { recursive: true });
  fs.writeFileSync(calFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8'));
}
ipcMain.handle('cal:list', () => readCals().map((c, i) => ({ index: i, name: c.name })));
ipcMain.handle('cal:add', (_e, name, url) => {
  const u = String(url || '').trim(); const n = String(name || '').trim().slice(0, 30) || '我的日曆';
  if (!CAL_OK(u)) throw new Error('網址不對：要用 Google 日曆設定裡「iCal 格式的私人網址」，開頭是 https://calendar.google.com/calendar/ical/ ，結尾是 .ics');
  const arr = readCals(); if (arr.some((c) => c.url === u)) throw new Error('這個日曆已經加過了');
  if (arr.some((c) => c.name === n)) throw new Error(`已經有叫「${n}」的分類了，換個名稱`);
  arr.push({ name: n, url: u }); writeCals(arr); return true;
});
ipcMain.handle('cal:remove', (_e, i) => { const arr = readCals(); arr.splice(Number(i), 1); writeCals(arr); return true; });
ipcMain.handle('cal:fetch', async () => {
  const out = [];
  for (const c of readCals()) {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
      const r = await net.fetch(c.url, { signal: ctrl.signal }); clearTimeout(to);
      out.push(r.ok ? { name: c.name, text: await r.text() } : { name: c.name, error: r.status === 404 ? '網址失效（可能在 Google 重設過私人網址）' : `讀取失敗（${r.status}）` });
    } catch (e) { out.push({ name: c.name, error: '連不上 Google 日曆（可能沒有網路）', offline: true }); }
  }
  return out;
});

// 切換同步模式前自動備份一份
ipcMain.handle('data:autoBackup', (_e, data) => {
  const dir = path.join(app.getPath('userData'), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
  return f;
});

// ---------- 自動更新（從 GitHub 下載新版，下載完提醒重新啟動） ----------
// 狀態：idle 沒動作／checking 檢查中／none 已是最新／downloading 下載中（percent）／ready 可安裝／error 失敗
const update = { state: 'idle', version: '', percent: 0, message: '' };
let checkNow = async () => { update.state = 'none'; return update; };
function setupUpdater(win) {
  if (!app.isPackaged || process.env.LEIYI_NO_UPDATE) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = () => { if (!win.isDestroyed()) win.webContents.send('update:status', update); };
  const set = (o) => { Object.assign(update, o); send(); };
  autoUpdater.on('checking-for-update', () => { if (update.state !== 'downloading' && update.state !== 'ready') set({ state: 'checking' }); });
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version, percent: 100 }));
  autoUpdater.on('error', () => set({ state: 'error', message: '連不上更新伺服器，稍後再試' }));
  checkNow = async () => {
    if (update.state === 'downloading' || update.state === 'ready') return update;
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ state: 'error', message: '連不上更新伺服器，稍後再試' }); }
    return update;
  };
  setTimeout(checkNow, 5000);
  setInterval(checkNow, 30 * 60 * 1000); // 每 30 分鐘自動檢查一次
  ipcMain.handle('update:install', () => { if (update.state === 'ready') autoUpdater.quitAndInstall(true, true); return true; });
}
ipcMain.handle('update:check', () => checkNow());
ipcMain.handle('update:status', () => update);
ipcMain.handle('app:version', () => app.getVersion());

if (process.env.LEIYI_USER_DATA) app.setPath('userData', process.env.LEIYI_USER_DATA);

// 只允許開一個視窗，重複開啟時把原視窗叫到前面
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
