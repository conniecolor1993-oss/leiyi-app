// 財務總覽計算測試
const F = require('../app/finance.js');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('✔ ' + n); } else { fail++; console.log('✘ ' + n, d === undefined ? '' : JSON.stringify(d)); } };
const L = { 本金: 1000000, 年利率: 2.5, 期數: 60, 首期還款日: '2026-07-15', 還款方式: '本息平均攤還' };
const s = F.loanSchedule(L);
ok('本息平均攤還每月約 17,747', Math.abs(s.monthlyPayment - 17747) <= 1, s.monthlyPayment);
ok('共 60 期、最後一期還清', s.rows.length === 60 && s.rows[59].balance === 0 && s.endMonth === '2031-06', [s.rows.length, s.rows[59], s.endMonth]);
ok('本金加總等於借款', Math.abs(s.rows.reduce((a, r) => a + r.principal, 0) - 1000000) <= 60);
ok('第一期利息約 2,083', Math.abs(s.rows[0].interest - 2083) <= 1, s.rows[0]);
ok('11 月時剩餘本金', F.balanceAt(L, s, '2026-11') === s.rows[4].balance && F.balanceAt(L, s, '2026-06') === 1000000);
const g = F.loanSchedule(Object.assign({}, L, { 寬限期: 12 }));
ok('寬限期只繳利息', g.rows[0].principal === 0 && g.rows[11].principal === 0 && g.rows[12].principal > 0 && g.rows.length === 60);
ok('寬限期後的月付比較高', g.monthlyPayment > s.monthlyPayment, g.monthlyPayment);
const fx = F.loanSchedule({ 本金: 1000000, 首期還款日: '2026-07-15', '每月還款（銀行通知）': 20000 });
ok('只填銀行通知的月付也能算', fx.missing.length === 0 && fx.monthlyPayment === 20000 && fx.rows.length === 50, [fx.missing, fx.rows.length]);
const p = F.loanSchedule(Object.assign({}, L, { 還款方式: '本金平均攤還' }));
ok('本金平均攤還：每期本金一樣、月付遞減', p.rows[0].principal === p.rows[10].principal && p.rows[0].pay > p.rows[10].pay);
const miss = F.loanSchedule({ 本金: 1000000 });
ok('資料不足時列出要補的欄位', miss.missing.includes('首期還款日（或撥款日）') && miss.missing.includes('年利率') && miss.rows.length === 0, miss.missing);
const ledger = [
  { 日期: '2026-09-14', 收支: '收入', 未稅金額: 19048, 已確認: false },
  { 日期: '2026-09-11', 收支: '支出', 未稅金額: 4000, 已確認: true },
  { 日期: '2026-09-20', 收支: '支出', 未稅金額: 999, 公私: '私人' },
  { 日期: '2026-10-31', 收支: '收入', 未稅金額: 114286, 狀態: '封存' },
  { 日期: '2025-10-31', 收支: '收入', 未稅金額: 5 }
];
const m = F.monthly(ledger, 2026, false);
ok('每月收支', m[8].inc === 19048 && m[8].exp === 4000 && m[8].net === 15048, m[8]);
ok('私人、封存、其他年份不算', m[9].inc === 0 && m[8].exp === 4000);
const mc = F.monthly(ledger, 2026, true);
ok('只算已確認', mc[8].inc === 0 && mc[8].exp === 4000);
console.log(`\n財務計算測試：通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
