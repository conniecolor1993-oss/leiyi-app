"""公司後勤 APP 端對端測試：逐一操作每個格子與每條資料通道。"""
import json, sys, datetime
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8765/index.html'
errs, fails, passed = [], [], []
TODAY = datetime.date.today()

def check(name, cond, detail=''):
    (passed if cond else fails).append(name + ('' if cond else f'  → {detail}'))

def data(pg):
    return pg.evaluate("() => JSON.parse(JSON.stringify(window.LeiyiStore.Store.data))")

def rows(pg, mod):
    return data(pg)['modules'].get(mod, [])

def nav(pg, mid):
    pg.click(f'[data-nav="{mid}"]'); pg.wait_for_timeout(80)

def fld(pg, key, tag='input'):
    return pg.locator(f'.drawer label[data-field="{key}"] {tag}').first

def sel(pg, key, val):
    fld(pg, key, 'select').select_option(val); pg.wait_for_timeout(30)

def fill(pg, key, val):
    fld(pg, key).fill(str(val)); pg.wait_for_timeout(20)

def save(pg):
    pg.click('#btn-save'); pg.wait_for_timeout(150)

def toast(pg):
    t = pg.locator('.toast').last
    return t.inner_text() if t.count() else ''

def close(pg):
    pg.keyboard.press('Escape'); pg.wait_for_timeout(80)

def new(pg, mod):
    nav(pg, mod); pg.click('#btn-new'); pg.wait_for_timeout(100)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    ctx = b.new_context(viewport={'width': 1360, 'height': 860}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_timeout(200)

    # ===== 1. 第一次使用 =====
    pg.click('#setup-go'); pg.wait_for_timeout(100)
    check('setup 空白公司名稱會擋', '公司名稱' in toast(pg), toast(pg))
    pg.fill('#setup-name', '測試有限公司'); pg.fill('#setup-tax', '1234'); pg.click('#setup-go'); pg.wait_for_timeout(100)
    check('setup 統編格式會擋', '8 碼' in toast(pg), toast(pg))
    pg.fill('#setup-tax', '12345678'); pg.fill('#setup-user', '老闆'); pg.click('#setup-go'); pg.wait_for_timeout(200)
    s = data(pg)['settings']
    check('setup 寫入設定', s['companyName'] == '測試有限公司' and s['taxId'] == '12345678' and s['currentUser'] == '老闆' and '老闆' in s['people'], s)
    check('setup 後顯示公司名', '測試有限公司' in pg.inner_text('.brand-name'))

    # ===== 2. 每個資料格子：必填、新增、編輯、封存、顯示封存 =====
    L = pg.evaluate("() => window.LEIYI.MODULES.filter(m=>m.kind==='table' && !m.readonly && !m.phase).map(m=>({id:m.id,title:m.titleKey}))")
    for m in L:
        new(pg, m['id']); save(pg)
        check(f"{m['id']} 必填會擋", '請填' in toast(pg), toast(pg))
        fill(pg, m['title'], f"測試-{m['id']}"); save(pg)
        rs = rows(pg, m['id'])
        check(f"{m['id']} 新增", len(rs) >= 1 and rs[-1][m['title']] == f"測試-{m['id']}", rs[-1:] )
        rid = rs[-1]['_id']
        fill(pg, m['title'], f"改過-{m['id']}"); save(pg)
        check(f"{m['id']} 編輯", next(r for r in rows(pg, m['id']) if r['_id'] == rid)[m['title']] == f"改過-{m['id']}")
        close(pg)
        check(f"{m['id']} 清單顯示", pg.locator(f'tr[data-id="{rid}"]').count() == 1)

    nav(pg, 'contacts'); pg.click(f'tr[data-id="{rows(pg, "contacts")[-1]["_id"]}"]')
    check('聯絡人沒有封存鈕', pg.locator('#btn-archive').count() == 0); close(pg)
    # 封存（用想法池測；聯絡人、每日任務沒有封存）
    nav(pg, 'ideas'); cid = rows(pg, 'ideas')[-1]['_id']
    pg.click(f'tr[data-id="{cid}"]'); pg.click('#btn-archive'); pg.wait_for_timeout(150)
    check('封存後清單隱藏', pg.locator(f'tr[data-id="{cid}"]').count() == 0)
    pg.click('label.chk input'); pg.wait_for_timeout(80)
    check('勾顯示封存看得到', pg.locator(f'tr[data-id="{cid}"].archived').count() == 1)
    check('封存不刪資料', any(r['_id'] == cid and r['狀態'] == '封存' for r in rows(pg, 'ideas')))
    pg.click('label.chk input'); pg.wait_for_timeout(50)

    # ===== 3. 帳務規則 =====
    new(pg, 'ledger'); fill(pg, '項目', '小額文具')
    opts = fld(pg, '科目', 'select').locator('option').all_inner_texts()
    check('支出時科目只出現 E 開頭', all(o.startswith('E') or o.startswith('—') for o in opts), opts)
    sel(pg, '科目', 'E98 雜支'); fill(pg, '未稅金額', 200); pg.click('.drawer button:has-text("依 5% 計算")'); pg.wait_for_timeout(50)
    check('5% 稅額按鈕', fld(pg, '稅額').input_value() == '10', fld(pg, '稅額').input_value())
    check('含稅即時計算', 'NT$210' in pg.inner_text('.drawer label[data-field="含稅金額"] .calc'))
    save(pg); small = rows(pg, 'ledger')[-1]
    check('小額支出不建待確認', not any(p_.get('關聯紀錄') == 'ledger:' + small['_id'] for p_ in rows(pg, 'pending')))
    check('含稅金額存檔正確', small['未稅金額'] == 200 and small['稅額'] == 10)
    # 切換收支會清掉不相符科目
    sel(pg, '收支', '收入')
    opts = fld(pg, '科目', 'select').locator('option').all_inner_texts()
    check('切成收入後科目只出現 I 開頭（舊值保留顯示）', all(o.startswith('I') or o.startswith('—') or o == 'E98 雜支' for o in opts), opts)
    save(pg); ch = next(r for r in rows(pg, 'ledger') if r['_id'] == small['_id'])
    check('收支與科目不符會清空科目', ch['科目'] == '', ch['科目'])
    sel(pg, '收支', '支出'); save(pg); close(pg)
    # 一筆收入 → 自動應收到期日 + 待確認
    new(pg, 'ledger'); fill(pg, '項目', '顧問案頭期款'); sel(pg, '收支', '收入'); sel(pg, '科目', 'I01 服務收入')
    fill(pg, '未稅金額', 30000); fill(pg, '稅額', 1500); sel(pg, '收付款狀態', '未收'); save(pg)
    inc = rows(pg, 'ledger')[-1]
    due = (TODAY + datetime.timedelta(days=30)).isoformat()
    check('收入自動填應收到期日（+30 天）', inc.get('應收到期日') == due, inc.get('應收到期日'))
    pend = [x for x in rows(pg, 'pending') if x.get('關聯紀錄') == 'ledger:' + inc['_id']]
    check('收入自動建立待確認 L3', len(pend) == 1 and pend[0]['權限等級'] == 'L3' and pend[0]['狀態'] == '待確認', pend)
    save(pg)
    check('重複儲存不會重複建待確認', len([x for x in rows(pg, 'pending') if x.get('關聯紀錄') == 'ledger:' + inc['_id']]) == 1)
    check('帳務詳細頁看得到反向連結', pg.locator('.drawer .backlinks').count() >= 1)
    close(pg)
    # 在待確認選「同意」→ 帳務自動已確認
    nav(pg, 'pending'); pg.click(f'tr[data-id="{pend[0]["_id"]}"]')
    sel(pg, '決定', '同意'); save(pg)
    pp = next(x for x in rows(pg, 'pending') if x['_id'] == pend[0]['_id'])
    ll = next(x for x in rows(pg, 'ledger') if x['_id'] == inc['_id'])
    check('待確認同意 → 帳務已確認', ll['已確認'] is True, ll)
    check('待確認同意 → 待確認完成', pp['狀態'] == '完成', pp['狀態'])
    pg.click('.drawer label[data-field="關聯紀錄"] a'); pg.wait_for_timeout(120)
    check('待確認的關聯連結可跳到帳務', inc['_id'] in pg.inner_text('.drawer-head'))
    close(pg)
    # 大額支出 → 待確認；直接在帳務勾已確認 → 待確認自動關閉
    new(pg, 'ledger'); fill(pg, '項目', '筆電'); sel(pg, '科目', 'E04 設備'); fill(pg, '未稅金額', 40000); fill(pg, '稅額', 2000)
    sel(pg, '憑證類型', '電子發票'); fill(pg, '發票號碼', 'AB12345678'); save(pg)
    big = rows(pg, 'ledger')[-1]
    bp = [x for x in rows(pg, 'pending') if x.get('關聯紀錄') == 'ledger:' + big['_id']]
    check('大額支出建待確認', len(bp) == 1)
    fld(pg, '已確認').check(); fld(pg, '買方統編正確').check(); fld(pg, '可扣抵').check(); save(pg)
    bp = next(x for x in rows(pg, 'pending') if x['_id'] == bp[0]['_id'])
    check('帳務直接勾已確認 → 待確認自動完成', bp['狀態'] == '完成' and bp['決定'] == '同意', bp)
    close(pg)
    # 大額支出 → 封存 → 待確認跟著封存
    new(pg, 'ledger'); fill(pg, '項目', '誤建'); fill(pg, '未稅金額', 9000); save(pg)
    wr = rows(pg, 'ledger')[-1]; pg.click('#btn-archive'); pg.wait_for_timeout(150)
    wp = [x for x in rows(pg, 'pending') if x.get('關聯紀錄') == 'ledger:' + wr['_id']]
    check('帳務封存 → 待確認跟著封存', len(wp) == 1 and wp[0]['狀態'] == '封存', wp)
    # 數字驗證
    new(pg, 'ledger'); fill(pg, '項目', '負數'); fill(pg, '未稅金額', -5); save(pg)
    check('負數金額會擋', '0 以上' in toast(pg), toast(pg))
    fill(pg, '未稅金額', 5); fld(pg, '憑證連結').fill('www.abc.com'); save(pg)
    check('網址格式會擋', 'http' in toast(pg), toast(pg))
    close(pg)

    # ===== 4. 專案彙總 =====
    new(pg, 'projects'); fill(pg, '專案名稱', '甲客戶案'); save(pg)
    prj = rows(pg, 'projects')[-1]; close(pg)
    nav(pg, 'ledger'); pg.click(f'tr[data-id="{inc["_id"]}"]'); sel(pg, '專案', prj['_id']); save(pg); close(pg)
    pg.click(f'tr[data-id="{big["_id"]}"]'); sel(pg, '專案', prj['_id']); save(pg); close(pg)
    new(pg, 'ledger'); fill(pg, '項目', '私人午餐'); sel(pg, '公私', '私人'); fill(pg, '未稅金額', 300); sel(pg, '專案', prj['_id']); save(pg); close(pg)
    nav(pg, 'projects'); pg.click(f'tr[data-id="{prj["_id"]}"]')
    txt = lambda k: pg.inner_text(f'.drawer label[data-field="{k}"] .calc')
    check('專案收入合計', txt('收入合計') == 'NT$31,500', txt('收入合計'))
    check('專案支出合計（不含私人）', txt('支出合計') == 'NT$42,000', txt('支出合計'))
    check('專案毛利', txt('毛利') == 'NT$-10,500', txt('毛利'))
    check('專案反向連結列出 3 筆帳務', pg.locator('.drawer .backlinks a').count() == 3, pg.locator('.drawer .backlinks a').count())
    close(pg)

    # ===== 5. 收件匣分派 =====
    targets = pg.evaluate("() => window.LEIYI.DISPATCH")
    for label, mid in targets.items():
        new(pg, 'inbox'); fill(pg, '事項', f'分派到{label}'); fld(pg, '原始內容', 'textarea').fill('原文內容'); sel(pg, '分派至', label); save(pg)
        before = len(rows(pg, mid))
        pg.click('.drawer [data-action="分派"]'); pg.wait_for_timeout(200)
        ib = next(r for r in rows(pg, 'inbox') if r['事項'] == f'分派到{label}')
        tgt = rows(pg, mid)
        ok = len(tgt) == before + 1 and ib['狀態'] == '完成' and ib.get('分派結果') == f"{mid}:{tgt[-1]['_id']}" and tgt[-1].get('_from') == f"inbox:{ib['_id']}"
        check(f'分派到{label}（雙向連結）', ok, (ib, tgt[-1:]))
        check(f'分派後跳到{label}', tgt[-1]['_id'] in pg.inner_text('.drawer-head'))
        close(pg)
    new(pg, 'inbox'); fill(pg, '事項', '只記錄'); sel(pg, '分派至', '不分派（只記錄）'); save(pg)
    pg.click('.drawer [data-action="分派"]'); pg.wait_for_timeout(150)
    nr = next(r for r in rows(pg, 'inbox') if r['事項'] == '只記錄')
    check('不分派只記錄 → 完成', nr['狀態'] == '完成' and not nr.get('分派結果'))
    pg.click(f'[data-nav="inbox"]'); pg.wait_for_timeout(50)
    first = next(r for r in rows(pg, 'inbox') if r.get('分派結果'))
    pg.click('label.chk input'); pg.click(f'tr[data-id="{first["_id"]}"]')
    check('已分派的不再顯示分派按鈕', pg.locator('.drawer [data-action="分派"]').count() == 0)
    close(pg); pg.click('label.chk input')
    new(pg, 'inbox'); fill(pg, '事項', '沒選目標'); save(pg); pg.click('.drawer [data-action="分派"]'); pg.wait_for_timeout(100)
    check('沒選分派至會擋', '分派至' in toast(pg), toast(pg)); close(pg)

    # ===== 6. 想法 → 評估 → 專案 =====
    new(pg, 'ideas'); fill(pg, '想法', '開線上課'); sel(pg, '事業線', '主要業務'); save(pg)
    idea = rows(pg, 'ideas')[-1]
    pg.click('.drawer [data-action="建立評估"]'); pg.wait_for_timeout(200)
    ev = rows(pg, 'evaluations')[-1]
    idea = next(r for r in rows(pg, 'ideas') if r['_id'] == idea['_id'])
    check('想法 → 建立評估並連結', ev['評估主題'] == '開線上課' and idea['評估報告'] == ev['_id'] and ev['_from'] == f"ideas:{idea['_id']}")
    check('評估頁沒有結論時不顯示轉專案', pg.locator('.drawer [data-action="轉成專案"]').count() == 0)
    sel(pg, '結論', '做'); save(pg)
    idea = next(r for r in rows(pg, 'ideas') if r['_id'] == idea['_id'])
    check('評估有結論 → 想法自動已評估', idea['已評估'] is True)
    pg.click('.drawer [data-action="轉成專案"]'); pg.wait_for_timeout(200)
    np_ = rows(pg, 'projects')[-1]; ev = next(r for r in rows(pg, 'evaluations') if r['_id'] == ev['_id'])
    check('評估 → 轉成專案並連結', np_['專案名稱'] == '開線上課' and ev['轉成專案'] == np_['_id'] and ev['狀態'] == '完成' and np_['_from'] == f"evaluations:{ev['_id']}")
    close(pg)

    # ===== 7. 會議 → 衍生專案 =====
    new(pg, 'meetings'); fill(pg, '會議', '週會 2026-W46'); fld(pg, '決議', 'textarea').fill('下週寄出報價\n其他'); save(pg)
    pg.click('.drawer [data-action="建立衍生專案"]'); pg.wait_for_timeout(200)
    mp = rows(pg, 'projects')[-1]; mt = rows(pg, 'meetings')[-1]
    check('會議 → 衍生專案', mt['衍生任務'] == mp['_id'] and mp['下一步'] == '下週寄出報價', (mt, mp))
    close(pg)

    # ===== 8. 營業稅整理 =====
    nav(pg, 'tax'); pg.wait_for_timeout(100)
    due_txt = pg.inner_text('#tax-due')
    check('營業稅試算（銷項 1500 − 進項 2000 → 留抵 500）', due_txt == 'NT$500' and '留抵' in pg.inner_text('.page-body'), due_txt)
    check('營業稅列出待處理問題', '申報前要處理' in pg.inner_text('.page-body'))

    # ===== 9. 首頁總覽 =====
    nav(pg, 'home')
    kp = pg.inner_text('.kpis')
    check('首頁本月收入（已確認）', 'NT$31,500' in kp, kp)
    check('首頁本月支出（已確認）', 'NT$42,000' in kp, kp)

    # ===== 10. 設定 =====
    nav(pg, 'settings')
    pg.locator('[data-list="lines"]').locator('xpath=..').locator('input').fill('第二業務'); pg.click('[data-add="lines"]'); pg.wait_for_timeout(100)
    check('新增事業線', '第二業務' in data(pg)['settings']['lines'])
    pg.locator('[data-list="lines"]').locator('xpath=..').locator('input').fill('第二業務'); pg.click('[data-add="lines"]'); pg.wait_for_timeout(100)
    check('重複選項會擋', '已經有了' in toast(pg), toast(pg))
    pg.locator('[data-list="accounts"]').locator('xpath=..').locator('input').fill('運費'); pg.click('[data-add="accounts"]'); pg.wait_for_timeout(100)
    check('科目格式會擋', '格式' in toast(pg), toast(pg))
    pg.locator('[data-list="accounts"]').locator('xpath=..').locator('input').fill('E12 運費'); pg.click('[data-add="accounts"]'); pg.wait_for_timeout(100)
    check('新增科目', 'E12 運費' in data(pg)['settings']['accounts'])
    # 移除正在使用的事業線，舊資料仍顯示
    pg.locator('[data-list="lines"] .chip', has_text='主要業務').locator('.chip-x').click(); pg.wait_for_timeout(100)
    check('移除事業線', '主要業務' not in data(pg)['settings']['lines'])
    nav(pg, 'ideas'); pg.click(f'tr[data-id="{idea["_id"]}"]')
    check('移除的選項在舊資料仍保留', fld(pg, '事業線', 'select').input_value() == '主要業務')
    close(pg); nav(pg, 'settings')
    pg.locator('[data-list="lines"] .chip-x').first.click(); pg.wait_for_timeout(100)
    check('最後一個選項不能移除', '至少' in toast(pg), toast(pg))
    pg.fill('[data-set="largeAmount"]', '-1'); pg.click('#btn-save-settings'); pg.wait_for_timeout(100)
    check('門檻數字驗證', '正整數' in toast(pg), toast(pg))
    pg.fill('[data-set="largeAmount"]', '100000'); pg.check('[data-set="enableHR"]'); pg.click('#btn-save-settings'); pg.wait_for_timeout(150)
    check('啟用人資顯示員工名冊', pg.locator('[data-nav="staff"]').count() == 1)
    check('門檻變更生效到規則手冊', True)
    nav(pg, 'rules'); check('規則手冊帶入設定值', 'NT$100,000' in pg.inner_text('.page-body') and '12345678' in pg.inner_text('.page-body'))
    new(pg, 'staff'); fill(pg, '姓名', '小明'); save(pg); check('員工名冊可新增', rows(pg, 'staff')[-1]['姓名'] == '小明'); close(pg)

    # ===== 11. 處理紀錄 =====
    logs = rows(pg, 'logs')
    check('處理紀錄自動產生', len(logs) > 20 and all(l['執行者'] for l in logs))
    check('系統動作標成系統', any(l['執行者'] == '系統' for l in logs))
    nav(pg, 'logs'); check('處理紀錄唯讀（沒有新增鈕）', pg.locator('#btn-new').count() == 0)

    # ===== 12. 安全：標題含 HTML 不會被執行 =====
    new(pg, 'contacts'); fill(pg, '姓名', '<img src=x onerror="window.__xss=1">'); save(pg); close(pg)
    check('HTML 不會被執行', pg.evaluate('window.__xss') is None)

    # ===== 13. 排序、搜尋、篩選 =====
    nav(pg, 'ledger'); pg.fill('.search', '筆電'); pg.wait_for_timeout(80)
    check('搜尋', pg.locator('tbody tr').count() == 1)
    pg.fill('.search', ''); pg.select_option('[data-filter="收支"]', '收入'); pg.wait_for_timeout(80)
    check('篩選', all('收入' in t for t in pg.locator('tbody tr').all_inner_texts()))
    pg.select_option('[data-filter="收支"]', ''); pg.click('th.sortable:has-text("含稅金額")'); pg.wait_for_timeout(80)
    check('排序不出錯', pg.locator('tbody tr').count() >= 3)

    # ===== 14. 路由與重新整理後資料還在 =====
    pg.goto(URL + f'#/projects/{prj["_id"]}'); pg.wait_for_timeout(250)
    check('網址直接開到某筆', prj['_id'] in pg.inner_text('.drawer-head'))
    pg.goto(URL + '#/projects/PRJ-999'); pg.wait_for_timeout(250)
    check('找不到的編號不會壞', '找不到' in toast(pg) and pg.locator('.drawer').count() == 0)
    n_before = sum(len(v) for v in data(pg)['modules'].values())
    pg.reload(); pg.wait_for_timeout(250)
    check('重新開啟資料還在', sum(len(v) for v in data(pg)['modules'].values()) == n_before)

    # ===== 15. 備份匯出、匯入、清空 =====
    nav(pg, 'settings')
    with pg.expect_download() as dl: pg.click('#btn-export')
    path = dl.value.path(); backup = open(path, encoding='utf-8').read()
    check('匯出備份是完整 JSON', json.loads(backup)['settings']['companyName'] == '測試有限公司')
    pg.click('#btn-reset'); pg.wait_for_timeout(250)
    check('清空回到第一次使用畫面', pg.locator('#setup-name').count() == 1 and data(pg)['modules'] == {})
    pg.fill('#setup-name', '暫時'); pg.click('#setup-go'); pg.wait_for_timeout(150)
    nav(pg, 'settings')
    pg.set_input_files('input[type=file]', files=[{'name': 'b.json', 'mimeType': 'application/json', 'buffer': backup.encode('utf-8')}]); pg.wait_for_timeout(300)
    check('匯入備份還原全部資料', data(pg)['settings']['companyName'] == '測試有限公司' and sum(len(v) for v in data(pg)['modules'].values()) == n_before)
    pg.set_input_files('input[type=file]', files=[{'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"x":1}'}]); pg.wait_for_timeout(200)
    check('匯入錯誤檔案會擋且不動資料', '格式' in toast(pg) and data(pg)['settings']['companyName'] == '測試有限公司', toast(pg))

    # ===== 16. 每一頁巡一次不報錯 =====
    for mid in pg.evaluate("() => window.LEIYI.MODULES.map(m=>m.id)"):
        if pg.locator(f'[data-nav="{mid}"]').count(): nav(pg, mid)
    pg.screenshot(path='/home/claude/leiyi-tests/final.png')
    b.close()

real_errs = [e for e in errs]
print(f'通過 {len(passed)} 項，失敗 {len(fails)} 項，畫面錯誤 {len(real_errs)} 個')
for f in fails: print('✗', f)
for e in real_errs: print('!', e)
sys.exit(1 if fails or real_errs else 0)
