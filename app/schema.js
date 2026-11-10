/* 公司後勤 APP｜資料架構（櫃子）
 * 這個檔案定義左側目錄、每個模組的欄位與下拉選項。任何公司都能用：
 * 公司名稱、統編、人員、事業線、科目都在「設定」裡改，不寫死在程式。
 * 原則：能選就不打字。type: text（短文字）、longtext（長文字）、select、date、number、money、checkbox、relation、url、formula
 */
// 使用者操作造成的提醒（例如必填沒填），只顯示提示，不算程式錯誤
class UserError extends Error {}
window.UserError = UserError;

(function () {
  const STATUS = ['待處理', '進行中', '待確認', '完成', '封存'];
  const SOURCE = ['老闆交辦', 'Email', '系統自動', '排程自動', 'n8n', '員工'];
  const DEPT = ['SEC', 'FIN', 'PRJ', 'RES', 'MTG', 'HR'];
  // 選項顯示用的中文說明（存的值不變，Notion 與自動化照舊用英文代碼）
  const OPTION_LABELS = { SEC: '總管秘書', FIN: '財務', PRJ: '專案行程', RES: '研究評估', MTG: '會議顧問', HR: '人資' };
  // 只在下拉選單裡出現的白話說明
  const OPTION_TIPS = {
    L1: '自己處理，不用問', L2: '先做，做完告訴你', L3: '要你先同意才做',
    封存: '收起來不顯示，不會刪除', 待核對: '內容還要確認', 暫緩: '先放著', 觀望: '先不決定，再看看',
    修改後同意: '你改過內容後照做', 待分析: '還沒整理', n8n: '自動化流程', 排程自動: '定時自動跑的', 系統自動: 'APP 自動產生',
    電子發票: '雲端發票，可上網查', 紙本三聯式: '有寫統編，可以抵稅', 紙本二聯式: '沒寫統編，不能抵稅', 無憑證: '沒有任何單據',
    老闆區: '只有老闆看得到', 團隊區: '大家都看得到'
  };
  // 欄位的白話說明（欄位本身沒寫說明時使用）
  const FIELD_PLAIN = {
    來源: '這筆資料從哪裡來', 事業線: '屬於公司哪一條業務', 分類: '屬於公司哪一條業務', 歸屬: '公司的、個人的，還是客戶的',
    未稅金額: '還沒加 5% 營業稅的金額', 稅額: '營業稅，通常是未稅金額的 5%', 含稅金額: '實際收／付的總金額＝未稅＋稅額（自動算）',
    科目: '這筆錢屬於哪一類，例如交通、租金', 公私: '公司的帳還是私人花費（私人的不算進公司報稅）', 憑證類型: '拿到的是哪種單據',
    對方統編: '對方公司的 8 碼統一編號', 收付款狀態: '錢收到／付出去了沒', 月份鍵: '這筆帳屬於哪個月（自動算）',
    營業稅期別: '屬於哪一期營業稅，兩個月一期（自動算）', 憑證連結: '發票或收據照片的網址',
    收入合計: '這個專案底下所有收入加總（自動算）', 支出合計: '這個專案底下所有支出加總（自動算）', 毛利: '收入減支出，這個專案賺多少（自動算）',
    停滯: '太多天沒更新會打勾提醒（自動算）', 可見範圍: '誰看得到這筆', 優先度: '先做哪個',
    等待天數: '這件事已經等你幾天（自動算）', 關聯紀錄: '要確認的是哪一筆，點了可以跳過去', 分派結果: '分派後建立的那筆，點了可以跳過去',
    交出部門: '把事情交出去的部門', 接手部門: '接下這件事的部門', 原訂日期: '一開始排定的日期（被延後時可以對照）',
    卡點: '卡住做不下去的原因', 資料來源: '這件事是從哪裡來的', 評估報告: '這個想法的評估，點了可以跳過去',
    轉成專案: '評估後轉成的專案', 衍生任務: '會議後建立的專案', 風險等級: '可能虧錢或出狀況的程度', 信心度: '這個判斷有幾成把握',
    結論: '做、不做，還是再看看', 來源連結: '參考資料的網址', 執行者: '誰做的（人或系統）', 動作: '做了什麼事',
    合作狀態: '跟這個人目前合作到哪一步', 追蹤日期: '下次要聯絡的日期', 已確認: '你確認過這筆帳沒問題才勾'
  };
  // 公司專屬的選項一律由「設定 → 選項管理」決定，這裡只放通用預設
  const LINES = { cfg: 'lines' };
  const PEOPLE = { cfg: 'people' };
  const OWNERS = { cfg: 'owners' };
  const TASK_STATUS = ['待核對', '待做', '進行中', '等人', '暫緩', '完成'];
  const LEVEL3 = ['高', '中', '低'];
  const ACCOUNTS = { cfg: 'accounts' };

  // 新公司第一次打開時的預設設定（通用、不含任何公司資料）
  const DEFAULT_CONFIG = {
    companyName: '',
    taxId: '',
    people: ['負責人'],
    lines: ['主要業務'],
    owners: ['公司', '個人', '客戶'],
    accounts: [
      'I01 服務收入', 'I02 商品銷售收入', 'I03 課程與培訓收入', 'I04 專案收入', 'I99 其他收入',
      'E01 軟體訂閱', 'E02 交通', 'E03 餐費與交際', 'E04 設備', 'E05 廣告行銷', 'E06 進修',
      'E07 勞務外包', 'E08 租金', 'E09 薪資與勞健保', 'E10 稅捐與規費', 'E11 進貨成本', 'E98 雜支', 'E99 其他支出'
    ],
    largeAmount: 5000,
    receivableDays: 30,
    staleDays: 7,
    maxBigProjects: 5
  };
  // 可在設定裡編輯的選項清單
  const CONFIG_LISTS = [
    { key: 'people', label: '人員（負責人、執行者）' },
    { key: 'lines', label: '事業線（也是每日任務的分類）' },
    { key: 'owners', label: '每日任務的歸屬' },
    { key: 'accounts', label: '會計科目（I 開頭＝收入，E 開頭＝支出）' }
  ];

  // 每個資料模組都有的共通欄位
  const common = (deptDefault) => [
    { key: '狀態', type: 'select', options: STATUS, default: '待處理', list: true, filter: true },
    { key: '日期', type: 'date', default: 'today', list: true },
    { key: '來源', type: 'select', options: SOURCE, default: '老闆交辦' },
    { key: '處理部門', type: 'select', options: DEPT, default: deptDefault, hint: '哪個部門負責這件事' }
  ];

  // ===== 計算欄位（與 Notion 公式一致）=====
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);
  const F = {
    含稅金額: (r) => n(r.未稅金額) + n(r.稅額),
    月份鍵: (r) => (r.日期 ? String(r.日期).slice(0, 7) : ''),
    營業稅期別: (r) => (r.日期 ? `${String(r.日期).slice(0, 4)}-P${Math.ceil(Number(String(r.日期).slice(5, 7)) / 2)}` : ''),
    收入額: (r) => (r.收支 === '收入' && r.公私 === '公司' ? n(r.未稅金額) + n(r.稅額) : 0),
    支出額: (r) => (r.收支 === '支出' && r.公私 === '公司' ? n(r.未稅金額) + n(r.稅額) : 0),
    daysSince: (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0)
  };

  const MODULES = [
    // ---------- 總覽 ----------
    { id: 'home', group: '總覽', title: '首頁總覽', icon: '🧭', kind: 'dashboard' },

    // ---------- 總管秘書 SEC ----------
    {
      id: 'inbox', group: '總管秘書', title: '收件匣', icon: '📥', kind: 'table', prefix: 'SEC', titleKey: '事項',
      desc: '所有丟進來的事項先放這裡，再分派到對的地方。',
      fields: [
        { key: '事項', type: 'text', required: true, list: true },
        ...common('SEC'),
        { key: '分派至', type: 'select', options: ['帳務', '每日任務', '專案', '想法池', '評估', '會議紀錄', '聯絡人', '待確認', '不分派（只記錄）'], list: true, filter: true, hint: '選好後按「分派」，會在目標格子建立一筆並互相連結' },
        { key: '分派結果', type: 'link', list: true },
        { key: '原始內容', type: 'longtext' },
        { key: '附件連結', type: 'url' }
      ]
    },
    {
      id: 'pending', group: '總管秘書', title: '待確認', icon: '✋', kind: 'table', prefix: 'CHK', titleKey: '需確認的事',
      desc: '錢的事、改行程、對外發訊息，一律先放這裡等負責人決定。選「同意」後會自動處理關聯的資料。',
      fields: [
        { key: '需確認的事', type: 'text', required: true, list: true },
        ...common('SEC'),
        { key: '權限等級', type: 'select', options: ['L2', 'L3'], default: 'L3', list: true, filter: true, hint: 'L2＝已經先做了，請你看過；L3＝還沒做，等你點頭' },
        { key: '決定', type: 'select', options: ['同意', '不同意', '修改後同意'], list: true, hint: '同意＝照做（帳務會自動勾已確認）；不同意＝不做；修改後同意＝你改過內容後照做。選好按儲存，這筆就會完成' },
        { key: '關聯紀錄', type: 'link', list: true },
        { key: '等待天數', type: 'formula', fn: (r) => F.daysSince(r._created), list: true },
        { key: '說明', type: 'longtext' }
      ]
    },
    {
      id: 'handoff', group: '總管秘書', title: '任務交接', icon: '🔁', kind: 'table', prefix: 'HO', titleKey: '交接事項',
      desc: '部門之間的交接單：A 做完寫入，B 讀取後接手。',
      fields: [
        { key: '交接事項', type: 'text', required: true, list: true },
        ...common('SEC'),
        { key: '交出部門', type: 'select', options: DEPT, list: true, filter: true },
        { key: '接手部門', type: 'select', options: DEPT, list: true, filter: true },
        { key: '內容', type: 'longtext' }
      ]
    },

    // ---------- 財務 FIN ----------
    {
      id: 'ledger', group: '財務', title: '帳務', icon: '💰', kind: 'table', prefix: 'FIN', titleKey: '項目',
      desc: '所有收支。金額為新台幣整數，支出也存正數。月報只計算「已確認」的資料。',
      fields: [
        { key: '項目', type: 'text', required: true, list: true },
        ...common('FIN'),
        { key: '收支', type: 'select', options: ['收入', '支出'], default: '支出', list: true, filter: true, required: true },
        { key: '科目', type: 'select', options: ACCOUNTS, list: true, filter: true, optionsBy: { field: '收支', map: { 收入: (o) => o.startsWith('I'), 支出: (o) => o.startsWith('E') } } },
        { key: '公私', type: 'select', options: ['公司', '私人'], default: '公司', filter: true },
        { key: '未稅金額', type: 'money' },
        { key: '稅額', type: 'money', helper: 'tax5' },
        { key: '含稅金額', type: 'formula', fn: F.含稅金額, format: 'money', list: true },
        { key: '憑證類型', type: 'select', options: ['電子發票', '紙本三聯式', '紙本二聯式', '收據', '無憑證'] },
        { key: '發票號碼', type: 'text' },
        { key: '對方名稱', type: 'text' },
        { key: '對方統編', type: 'text' },
        { key: '買方統編正確', type: 'checkbox', hint: '支出發票的買方統編是否為本公司統編（設定裡填）' },
        { key: '可扣抵', type: 'checkbox', hint: '有寫本公司統編的進貨或費用發票才勾，報稅時可以少繳稅' },
        { key: '付款方式', type: 'select', options: ['現金', '轉帳', '信用卡', '其他'] },
        { key: '收付款狀態', type: 'select', options: ['未收', '已收', '未付', '已付'], list: true, filter: true },
        { key: '應收到期日', type: 'date', hint: '開票日加 30 天' },
        { key: '專案', type: 'relation', module: 'projects' },
        { key: '憑證連結', type: 'url' },
        { key: '已確認', type: 'checkbox', list: true, filter: true, hint: '負責人確認後才勾' },
        { key: '月份鍵', type: 'formula', fn: F.月份鍵 },
        { key: '營業稅期別', type: 'formula', fn: F.營業稅期別, list: true }
      ]
    },
    { id: 'tax', group: '財務', title: '營業稅整理', icon: '🧾', kind: 'tax', desc: '依期別自動加總進項、銷項，申報前核對用（試算，以申報系統為準）。' },

    // ---------- 專案行程 PRJ ----------
    {
      id: 'projects', group: '專案行程', title: '專案', icon: '📁', kind: 'table', prefix: 'PRJ', titleKey: '專案名稱',
      desc: '整個案子的進度與收支。可以關聯帳務，自動算出收入、支出與毛利。',
      fields: [
        { key: '專案名稱', type: 'text', required: true, list: true },
        ...common('PRJ'),
        { key: '事業線', type: 'select', options: LINES, list: true, filter: true },
        { key: '負責人', type: 'select', options: PEOPLE, filter: true },
        { key: '截止日', type: 'date', list: true },
        { key: '下一步', type: 'text', hint: '只寫一件事', list: true },
        { key: '優先度', type: 'select', options: LEVEL3, filter: true },
        { key: '規模', type: 'select', options: ['大', '小'], filter: true, hint: '大專案超過 5 個要建議暫停' },
        { key: '可見範圍', type: 'select', options: ['老闆區', '團隊區'], default: '老闆區' },
        { key: '收入合計', type: 'rollup', from: 'ledger', via: '專案', sum: F.收入額, format: 'money' },
        { key: '支出合計', type: 'rollup', from: 'ledger', via: '專案', sum: F.支出額, format: 'money' },
        { key: '毛利', type: 'formula', fn: (r, ctx) => ctx.rollup(r, 'ledger', '專案', F.收入額) - ctx.rollup(r, 'ledger', '專案', F.支出額), format: 'money', list: true },
        { key: '停滯', type: 'formula', fn: (r, ctx) => (F.daysSince(r._updated) > ctx.cfg.staleDays && !['完成', '封存'].includes(r.狀態) ? '⚠ 停滯' : ''), list: true }
      ]
    },
    {
      id: 'tasks', group: '專案行程', title: '每日任務', icon: '✅', kind: 'table', prefix: 'TASK', titleKey: '事情',
      desc: '每天要做的事。勾「今天三件」的最多 3 件，首頁會顯示。',
      fields: [
        { key: '事情', type: 'text', required: true, list: true },
        { key: '專案', type: 'relation', module: 'projects', list: true, filter: false, hint: '這件事屬於哪個專案（可不選）' },
        { key: '狀態', type: 'select', options: TASK_STATUS, default: '待做', list: true, filter: true },
        { key: '今天三件', type: 'checkbox', list: true, filter: true, hint: '最多 3 件' },
        { key: '安排日期', type: 'date', default: 'today', list: true },
        { key: '原訂日期', type: 'date' },
        { key: '分類', type: 'select', options: LINES, list: true, filter: true },
        { key: '歸屬', type: 'select', options: OWNERS, filter: true },
        { key: '負責人', type: 'text' },
        { key: '下一步', type: 'text', list: true },
        { key: '卡點', type: 'text' },
        { key: '資料來源', type: 'text' }
      ]
    },
    { id: 'calendar', group: '專案行程', title: '行程', icon: '📅', kind: 'calendar', desc: '直接讀 Google 日曆（只讀）。要新增或修改行程，按「在 Google 日曆新增」。' },

    // ---------- 研究評估 RES ----------
    {
      id: 'ideas', group: '研究評估', title: '想法池', icon: '💡', kind: 'table', prefix: 'IDEA', titleKey: '想法',
      desc: '新想法先進這裡，評估後才轉成專案。',
      fields: [
        { key: '想法', type: 'text', required: true, list: true },
        ...common('RES'),
        { key: '事業線', type: 'select', options: LINES, list: true, filter: true },
        { key: '已評估', type: 'checkbox', list: true, filter: true },
        { key: '評估報告', type: 'relation', module: 'evaluations' },
        { key: '說明', type: 'longtext' }
      ]
    },
    {
      id: 'evaluations', group: '研究評估', title: '評估', icon: '🔍', kind: 'table', prefix: 'RES', titleKey: '評估主題',
      desc: '固定 6 段：是什麼／投入／收益／風險／與現有事業關聯／結論。',
      fields: [
        { key: '評估主題', type: 'text', required: true, list: true },
        ...common('RES'),
        { key: '事業線', type: 'select', options: LINES, filter: true },
        { key: '投入金額', type: 'money' },
        { key: '投入時間（小時）', type: 'number' },
        { key: '預估收益', type: 'money' },
        { key: '風險等級', type: 'select', options: LEVEL3, list: true, filter: true },
        { key: '結論', type: 'select', options: ['做', '不做', '觀望'], list: true, filter: true },
        { key: '信心度', type: 'select', options: LEVEL3, list: true },
        { key: '轉成專案', type: 'relation', module: 'projects' },
        { key: '來源連結', type: 'url' },
        { key: '評估內容', type: 'longtext', hint: '6 段格式全文' }
      ]
    },

    // ---------- 會議顧問 MTG ----------
    {
      id: 'meetings', group: '會議顧問', title: '會議紀錄', icon: '🗓️', kind: 'table', prefix: 'MTG', titleKey: '會議',
      desc: '週會、月會、外部會議。決議要轉成專案任務。',
      fields: [
        { key: '會議', type: 'text', required: true, list: true },
        ...common('MTG'),
        { key: '會議類型', type: 'select', options: ['週會', '月會', '外部會議'], list: true, filter: true },
        { key: '期間', type: 'text', hint: '例：2026-W46、2026-11' },
        { key: '衍生任務', type: 'relation', module: 'projects' },
        { key: '重點摘要', type: 'longtext' },
        { key: '建議事項', type: 'longtext' },
        { key: '決議', type: 'longtext' }
      ]
    },

    // ---------- 人資 HR（第三階段） ----------
    {
      id: 'staff', group: '人資', title: '員工名冊', icon: '👥', kind: 'table', prefix: 'HR', titleKey: '姓名', phase: 3,
      desc: '第三階段啟用。薪資、勞健保請用政府平台或人資系統，這裡只記基本資料與提醒。',
      fields: [
        { key: '姓名', type: 'text', required: true, list: true },
        ...common('HR'),
        { key: '職稱', type: 'text', list: true },
        { key: '到職日', type: 'date', list: true },
        { key: '勞保已加保', type: 'checkbox', list: true },
        { key: '健保已加保', type: 'checkbox', list: true },
        { key: '可見範圍', type: 'select', options: ['老闆區', '團隊區'], default: '老闆區' }
      ]
    },

    // ---------- 系統 ----------
    {
      id: 'contacts', group: '系統', title: '聯絡人', icon: '📇', kind: 'table', prefix: 'CT', titleKey: '姓名',
      desc: '客戶、廠商、合作夥伴。',
      fields: [
        { key: '姓名', type: 'text', required: true, list: true },
        { key: '公司', type: 'text', list: true },
        { key: '專業', type: 'text' },
        { key: '合作狀態', type: 'select', options: ['待分析', '已承諾引薦', '等待引薦', '洽談中', '已合作'], list: true, filter: true },
        { key: '聯絡方式', type: 'text' },
        { key: '追蹤日期', type: 'date', list: true },
        { key: '下一步', type: 'text' }
      ]
    },
    {
      id: 'logs', group: '系統', title: '處理紀錄', icon: '📜', kind: 'table', prefix: 'LOG', titleKey: '紀錄', readonly: true,
      desc: '所有新增、修改、封存都自動記在這裡，只增不改。',
      fields: [
        { key: '紀錄', type: 'text', list: true },
        { key: '日期', type: 'date', list: true },
        { key: '處理部門', type: 'select', options: DEPT, list: true, filter: true },
        { key: '執行者', type: 'text', list: true },
        { key: '動作', type: 'select', options: ['新增', '修改', '封存', '提醒', '報告'], list: true, filter: true },
        { key: '說明', type: 'longtext' }
      ]
    },
    { id: 'rules', group: '系統', title: '規則手冊', icon: '📘', kind: 'rules' },
    { id: 'tools', group: '系統', title: '工具清單', icon: '🧰', kind: 'tools' },
    { id: 'settings', group: '系統', title: '設定', icon: '⚙️', kind: 'settings' }
  ];

  const RULES = (cfg) => [
    ['三級權限', ['L1 自動做：分類、整理、提醒、報告', 'L2 做完通知：新增行程、更新專案進度', 'L3 確認才做：跟錢有關、改或刪行程、對外發訊息']],
    ['共通規則', ['每筆必填：狀態、日期、來源、處理部門', '狀態：待處理 → 進行中 → 待確認 → 完成 → 封存', '不確定就放「待確認」，不猜', '不刪除，只封存', '每個動作自動寫入處理紀錄']],
    ['財務', [`支出發票檢查買方統編是否為 ${cfg.taxId || '（尚未設定統編）'}`, `單筆超過 NT$${Number(cfg.largeAmount).toLocaleString()}、辨識不清、所有收入 → 待確認`, `開票 ${cfg.receivableDays} 天未收款 → 提醒`, '單月 8 日營業稅提醒；每月 5 日月報（只算已確認）', '不自動申報、不付款']],
    ['專案', ['必填：負責人、截止日、下一步（一件事）', `${cfg.staleDays} 天未更新算停滯`, '新想法先進想法池，評估後才轉專案', '行程只記 Google 行事曆']],
    ['研究評估', ['固定 6 段：是什麼／投入／收益／風險／關聯／結論', '附來源、區分事實與推測、敢說不']],
    ['會議顧問', ['週一週報、每月 5 日月會', '建議具體並附理由', `大專案超過 ${cfg.maxBigProjects} 個必須建議暫停一個`, '只讀不寫專案與帳務']]
  ];

  const TOOLS = [
    ['核心', 'Notion', '所有資料的家', '免費'], ['核心', 'Claude', '收事項、分類、評估、排程報告', '現有方案'],
    ['財務', '財政部電子發票整合服務平台', '下載進銷項（工商憑證）', '免費'], ['財務', 'Google 試算表', '試算', '免費'],
    ['行程', 'Google 行事曆', '行程唯一來源', '免費'], ['研究', '經濟部商工登記公示資料查詢', '查合作對象', '免費'],
    ['研究', 'NotebookLM', '讀大量 PDF', '免費'], ['人資', '勞保局 e 化、健保署多憑證承保', '加退保', '免費'],
    ['文件', 'Google Drive', '檔案實體存放', '免費'], ['文件', 'Bitwarden', '密碼管理', '免費'],
    ['IT（第二階段）', 'Docker＋n8n＋Uptime Kuma＋Tailscale', '家裡電腦定時任務', '免費']
  ];

  // 收件匣「分派至」選項 → 目標模組
  const DISPATCH = { 帳務: 'ledger', 每日任務: 'tasks', 專案: 'projects', 想法池: 'ideas', 評估: 'evaluations', 會議紀錄: 'meetings', 聯絡人: 'contacts', 待確認: 'pending' };

  window.LEIYI = { MODULES, RULES, TOOLS, F, STATUS, DEPT, DEFAULT_CONFIG, CONFIG_LISTS, DISPATCH, OPTION_LABELS, OPTION_TIPS, FIELD_PLAIN };
})();
