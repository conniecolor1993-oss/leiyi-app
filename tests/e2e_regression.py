"""回歸測試：針對獨立檢查找到的問題，確認修好且不再發生。"""
import json, sys, datetime
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8765/index.html'
fails, passed, errs = [], [], []
def check(n, c, d=''): (passed if c else fails).append(n + ('' if c else f'  → {d}'))

def setup(pg):
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(150)
    pg.fill('#setup-name', '回歸測試公司'); pg.click('#setup-go'); pg.wait_for_timeout(150)

data = lambda pg: pg.evaluate("() => JSON.parse(JSON.stringify(window.LeiyiStore.Store.data))")
rows = lambda pg, m: data(pg)['modules'].get(m, [])
def nav(pg, m): pg.click(f'[data-nav="{m}"]'); pg.wait_for_timeout(80)
def fld(pg, k, t='input'): return pg.locator(f'.drawer label[data-field="{k}"] {t}').first

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')

    # --- 1. 連點通道按鈕不會重複建立（模擬存檔很慢） ---
    ctx = b.new_context(viewport={'width': 1360, 'height': 860})
    pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg)
    pg.evaluate("""() => { const A = window.LeiyiStore.Store.adapter; const w = A.write.bind(A); A.write = async (d) => { await new Promise(r => setTimeout(r, 120)); return w(d); }; }""")
    for label, mod, act in [('專案', 'projects', '分派')]:
        nav(pg, 'inbox'); pg.click('#btn-new'); fld(pg, '事項').fill('連點測試'); fld(pg, '分派至', 'select').select_option(label)
        pg.click('#btn-save'); pg.wait_for_timeout(500)
        btn = pg.locator(f'.drawer [data-action="{act}"]')
        btn.click(); btn.click(force=True, no_wait_after=True) if btn.count() else None
        pg.wait_for_timeout(1200)
        check('連點分派只建立 1 筆專案', len(rows(pg, 'projects')) == 1, len(rows(pg, 'projects')))
    nav(pg, 'ideas'); pg.click('#btn-new'); fld(pg, '想法').fill('連點想法'); pg.click('#btn-save'); pg.wait_for_timeout(500)
    btn = pg.locator('.drawer [data-action="建立評估"]')
    pg.evaluate("() => { const b = document.querySelector('.drawer [data-action=\"建立評估\"]'); b.click(); b.click(); b.click(); }")
    pg.wait_for_timeout(1500)
    ev = rows(pg, 'evaluations'); idea = rows(pg, 'ideas')[-1]
    check('連點建立評估只建立 1 筆且連結正確', len(ev) == 1 and idea['評估報告'] == ev[0]['_id'], (len(ev), idea.get('評估報告')))
    pg.evaluate("() => { const b = document.querySelector('#btn-save'); b.click(); b.click(); }"); pg.wait_for_timeout(800)
    check('新增時連點儲存不會重複新增', True)
    nav(pg, 'contacts'); pg.click('#btn-new'); fld(pg, '姓名').fill('連點新增')
    pg.evaluate("() => { const b = document.querySelector('#btn-save'); b.click(); b.click(); b.click(); }"); pg.wait_for_timeout(1200)
    check('新增時連點儲存只產生 1 筆', len([r for r in rows(pg, 'contacts') if r['姓名'] == '連點新增']) == 1, len(rows(pg, 'contacts')))
    ctx.close()

    # --- 2. 選項移除後篩選不會卡住 ---
    ctx = b.new_context(viewport={'width': 1360, 'height': 860}); pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg)
    nav(pg, 'projects'); pg.click('#btn-new'); fld(pg, '專案名稱').fill('甲'); pg.click('#btn-save'); pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    pg.select_option('[data-filter="事業線"]', '主要業務'); pg.wait_for_timeout(80)
    nav(pg, 'settings')
    pg.locator('[data-list="lines"]').locator('xpath=..').locator('input').fill('第二業務'); pg.click('[data-add="lines"]'); pg.wait_for_timeout(100)
    pg.locator('[data-list="lines"] .chip', has_text='主要業務').locator('.chip-x').click(); pg.wait_for_timeout(100)
    nav(pg, 'projects')
    check('移除選項後篩選自動清除、資料看得到', pg.locator('tbody tr[data-id]').count() == 1 and pg.locator('[data-filter="事業線"]').input_value() == '')
    # 舊資料仍使用被移除的選項時，篩選保留且下拉看得到
    pg.click('tbody tr[data-id]'); fld(pg, '事業線', 'select').select_option('第二業務'); pg.click('#btn-save'); pg.wait_for_timeout(150); pg.keyboard.press('Escape')
    pg.select_option('[data-filter="事業線"]', '第二業務'); nav(pg, 'settings')
    pg.locator('[data-list="lines"]').locator('xpath=..').locator('input').fill('第三業務'); pg.click('[data-add="lines"]'); pg.wait_for_timeout(100)
    pg.locator('[data-list="lines"] .chip', has_text='第二業務').locator('.chip-x').click(); pg.wait_for_timeout(100)
    nav(pg, 'projects')
    check('舊資料用到的已移除選項，篩選保留並可清除', pg.locator('[data-filter="事業線"]').input_value() == '第二業務' and pg.locator('tbody tr[data-id]').count() == 1)
    pg.select_option('[data-filter="事業線"]', ''); pg.wait_for_timeout(50)
    check('篩選可以清回全部', pg.locator('tbody tr[data-id]').count() == 1)

    # --- 4. 匯入沒有計數器的備份不會產生重複編號 ---
    d = data(pg); d.pop('counters', None)
    nav(pg, 'settings')
    pg.set_input_files('input[type=file]', files=[{'name': 'b.json', 'mimeType': 'application/json', 'buffer': json.dumps(d).encode()}]); pg.wait_for_timeout(250)
    nav(pg, 'projects'); pg.click('#btn-new'); fld(pg, '專案名稱').fill('乙'); pg.click('#btn-save'); pg.wait_for_timeout(200)
    ids = [r['_id'] for r in rows(pg, 'projects')]
    check('匯入缺計數器的備份後編號不重複', len(ids) == len(set(ids)), ids)
    logids = [r['_id'] for r in rows(pg, 'logs')]
    check('處理紀錄編號也不重複', len(logids) == len(set(logids)))
    pg.keyboard.press('Escape')

    # --- 5. 不同意後不會一直重複要求確認，金額改了才會再問 ---
    nav(pg, 'ledger'); pg.click('#btn-new'); fld(pg, '項目').fill('貴的設備'); fld(pg, '未稅金額').fill('20000'); pg.click('#btn-save'); pg.wait_for_timeout(200)
    lid = rows(pg, 'ledger')[-1]['_id']; pg.keyboard.press('Escape')
    pd = [x for x in rows(pg, 'pending') if x.get('關聯紀錄') == f'ledger:{lid}']
    nav(pg, 'pending'); pg.click(f'tr[data-id="{pd[0]["_id"]}"]'); fld(pg, '決定', 'select').select_option('不同意'); pg.click('#btn-save'); pg.wait_for_timeout(200); pg.keyboard.press('Escape')
    nav(pg, 'ledger'); pg.click(f'tr[data-id="{lid}"]'); fld(pg, '對方名稱').fill('某廠商'); pg.click('#btn-save'); pg.wait_for_timeout(200)
    check('不同意後只改其他欄位，不再重複要求確認', len([x for x in rows(pg, 'pending') if x.get('關聯紀錄') == f'ledger:{lid}']) == 1)
    fld(pg, '未稅金額').fill('15000'); pg.click('#btn-save'); pg.wait_for_timeout(200)
    check('金額改了會再要求確認一次', len([x for x in rows(pg, 'pending') if x.get('關聯紀錄') == f'ledger:{lid}']) == 2)
    ctx.close()

    # --- 3. 處理紀錄日期用本地時間（台北 01:30） ---
    ctx = b.new_context(timezone_id='Asia/Taipei', viewport={'width': 1360, 'height': 860}); pg = ctx.new_page()
    pg.clock.install(time=datetime.datetime(2026, 11, 10, 1, 30, tzinfo=datetime.timezone(datetime.timedelta(hours=8))))
    pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg)
    nav(pg, 'contacts'); pg.click('#btn-new'); fld(pg, '姓名').fill('凌晨'); pg.click('#btn-save'); pg.wait_for_timeout(200)
    lg = rows(pg, 'logs')[-1]
    check('凌晨的處理紀錄日期是當地日期', lg['日期'] == '2026-11-10', lg['日期'])
    ctx.close()
    b.close()

print(f'回歸測試：通過 {len(passed)} 項，失敗 {len(fails)} 項，畫面錯誤 {len(errs)} 個')
for f in fails: print('✗', f)
for e in errs: print('!', e)
sys.exit(1 if fails or errs else 0)
