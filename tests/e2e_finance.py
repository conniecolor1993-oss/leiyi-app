"""財務總覽頁：每月收支、營利、貸款還款。"""
import sys, datetime
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8765/index.html'
fails, passed, errs = [], [], []
def check(n, c, d=''): (passed if c else fails).append(n + ('' if c else f'  → {d}'))
def nav(pg, m): pg.click(f'[data-nav="{m}"]'); pg.wait_for_timeout(100)
def fld(pg, k, t='input'): return pg.locator(f'.drawer label[data-field="{k}"] {t}').first
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = b.new_context(viewport={'width': 1360, 'height': 900}, timezone_id='Asia/Taipei'); pg = ctx.new_page()
    pg.clock.install(time=datetime.datetime(2026, 11, 19, 21, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=8))))
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text)); pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(150)
    pg.fill('#setup-name', '財務測試'); pg.click('#setup-go'); pg.wait_for_timeout(150)
    for d, kind, amt, ok in [('2026-09-14', '收入', 19048, False), ('2026-09-11', '支出', 4000, True), ('2026-10-31', '收入', 114286, False), ('2026-10-31', '支出', 9639, True)]:
        nav(pg, 'ledger'); pg.click('#btn-new'); fld(pg, '項目').fill(f'{kind}{amt}'); fld(pg, '日期').fill(d); fld(pg, '收支', 'select').select_option(kind)
        fld(pg, '未稅金額').fill(str(amt))
        if ok: fld(pg, '已確認').check()
        pg.click('#btn-save'); pg.wait_for_timeout(150); pg.keyboard.press('Escape')
    nav(pg, 'finance'); t = pg.locator('#fin-kpis').inner_text()
    check('收入合計', 'NT$133,334' in t, t); check('支出合計', 'NT$13,639' in t, t); check('營利', 'NT$119,695' in t, t)
    check('有未確認提醒', pg.locator('.alert').count() == 1)
    check('圖表有 24 根長條', pg.locator('.fin-chart rect').count() == 24)
    pg.check('#fin-confirmed'); pg.wait_for_timeout(100); t2 = pg.locator('#fin-kpis').inner_text()
    check('只算已確認', 'NT$0' in t2 and 'NT$13,639' in t2, t2)
    pg.uncheck('#fin-confirmed'); pg.wait_for_timeout(100)
    check('沒貸款時提示新增', '還沒有貸款資料' in pg.locator('#fin-loans').inner_text())
    nav(pg, 'loans'); pg.click('#btn-new'); fld(pg, '貸款名稱').fill('公司貸款'); fld(pg, '本金').fill('1000000'); pg.click('#btn-save'); pg.wait_for_timeout(150); pg.keyboard.press('Escape')
    nav(pg, 'finance')
    check('貸款資料不足會列出要補的欄位', '還缺' in pg.locator('#fin-loans').inner_text() and '年利率' in pg.locator('#fin-loans').inner_text(), pg.locator('#fin-loans').inner_text())
    nav(pg, 'loans'); pg.click('tbody tr[data-id]'); pg.wait_for_timeout(100)
    fld(pg, '年利率').fill('2.5'); fld(pg, '期數').fill('60'); fld(pg, '首期還款日').fill('2026-07-15'); pg.click('#btn-save'); pg.wait_for_timeout(150); pg.keyboard.press('Escape')
    nav(pg, 'finance'); t3 = pg.locator('#fin-kpis').inner_text(); lo = pg.locator('#fin-loans').inner_text()
    check('每月還款 17,747', 'NT$17,747' in t3, t3)
    check('7–11 月共還 5 期，扣還款後營利', 'NT$30,960' in t3, t3)
    check('貸款列出剩餘本金與還清月份', '已還 5/60 期' in lo and '2031-06' in lo, lo)
    tb = pg.locator('#fin-table').inner_text()
    check('明細表 12 個月＋未來月份標示', tb.count('月') >= 12 and '12 月（未來）' in tb, tb[:200])
    check('圖表多一條扣還款後的線', pg.locator('.fin-chart .l-cash').count() == 1)
    pg.screenshot(path='/tmp/fin.png', full_page=True)
    nav(pg, 'home'); check('首頁顯示今年營利', '今年營利' in pg.locator('main').inner_text())
    for r in ['finance', 'loans', 'home']:
        nav(pg, r); tx = pg.locator('main').inner_text(); check(f'{r} 沒有 null/NaN', 'null' not in tx and 'NaN' not in tx and 'undefined' not in tx)
    b.close()
print('\n'.join('✔ ' + x for x in passed)); [print('✘ ' + x) for x in fails]; [print('錯誤：' + e) for e in errs]
print(f'\n財務頁測試：通過 {len(passed)} 項，失敗 {len(fails)} 項，畫面錯誤 {len(errs)} 個'); sys.exit(1 if fails or errs else 0)
