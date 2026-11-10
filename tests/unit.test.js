// 計算規則單元測試：node tests/unit.test.js
const assert = require('assert');
global.window = {};
require('../app/schema.js');
const { F, MODULES, DEFAULT_CONFIG, DISPATCH } = window.LEIYI;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✔', name); };

t('含稅金額', () => assert.strictEqual(F.含稅金額({ 未稅金額: 1000, 稅額: 50 }), 1050));
t('含稅金額：空值當 0', () => assert.strictEqual(F.含稅金額({}), 0));
t('月份鍵', () => assert.strictEqual(F.月份鍵({ 日期: '2026-11-10' }), '2026-11'));
for (const [d, p] of [['2026-01-31', '2026-P1'], ['2026-02-01', '2026-P1'], ['2026-03-01', '2026-P2'], ['2026-10-31', '2026-P5'], ['2026-11-01', '2026-P6'], ['2026-12-31', '2026-P6']])
  t(`營業稅期別 ${d} → ${p}`, () => assert.strictEqual(F.營業稅期別({ 日期: d }), p));
t('收入額只算公司', () => { assert.strictEqual(F.收入額({ 收支: '收入', 公私: '公司', 未稅金額: 100, 稅額: 5 }), 105); assert.strictEqual(F.收入額({ 收支: '收入', 公私: '私人', 未稅金額: 100 }), 0); });
t('支出額只算公司', () => { assert.strictEqual(F.支出額({ 收支: '支出', 公私: '公司', 未稅金額: 200 }), 200); assert.strictEqual(F.支出額({ 收支: '收入', 公私: '公司', 未稅金額: 200 }), 0); });
t('每個資料模組都有編號前綴與標題欄', () => { for (const m of MODULES.filter((m) => m.kind === 'table')) { assert.ok(m.prefix, m.id); assert.ok(m.fields.some((f) => f.key === m.titleKey), m.id); } });
t('編號前綴不重複', () => { const p = MODULES.filter((m) => m.prefix).map((m) => m.prefix); assert.strictEqual(new Set(p).size, p.length); });
t('關聯欄位都指向存在的模組', () => { for (const m of MODULES) for (const f of m.fields || []) if (f.type === 'relation') assert.ok(MODULES.find((x) => x.id === f.module), `${m.id}.${f.key}`); });
t('分派目標都存在', () => { for (const id of Object.values(DISPATCH)) assert.ok(MODULES.find((m) => m.id === id), id); });
t('下拉預設值都在選項內', () => { for (const m of MODULES) for (const f of m.fields || []) if (f.type === 'select' && Array.isArray(f.options) && f.default) assert.ok(f.options.includes(f.default), `${m.id}.${f.key}`); });
t('預設科目都是 I／E 開頭格式', () => { for (const a of DEFAULT_CONFIG.accounts) assert.ok(/^[IE]\d{2}\s/.test(a), a); });
t('程式裡沒有寫死任何公司資料', () => { const s = require('fs').readFileSync(__dirname + '/../app/schema.js', 'utf8'); for (const w of ['雷翼', '62157462', 'Connie']) assert.ok(!s.includes(w), w); });
console.log(`\n全部通過：${n} 項`);
