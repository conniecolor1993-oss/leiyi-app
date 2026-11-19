/* 財務總覽的計算（finance.js）：每月收支、營利、貸款還款表。純計算，不碰畫面。 */
(function (root) {
  const num = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), 28));

  // 每月收入、支出（未稅），排除私人與封存；onlyConfirmed＝只算已確認
  function monthly(ledger, year, onlyConfirmed) {
    const rows = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, inc: 0, exp: 0, count: 0 }));
    for (const r of ledger || []) {
      if (r.狀態 === '封存' || r.公私 === '私人') continue;
      if (onlyConfirmed && !r.已確認) continue;
      const d = parseDate(r.日期); if (!d || d.getFullYear() !== Number(year)) continue;
      const amt = num(r.未稅金額) || 0; const row = rows[d.getMonth()]; row.count++;
      if (r.收支 === '收入') row.inc += amt; else if (r.收支 === '支出') row.exp += amt;
    }
    for (const r of rows) r.net = r.inc - r.exp;
    return rows;
  }

  // 貸款還款表。缺資料時回傳 missing（要補哪些欄位）
  function loanSchedule(loan) {
    const P = num(loan.本金); const rate = num(loan.年利率); const n = num(loan.期數);
    const grace = Math.max(0, Math.round(num(loan.寬限期) || 0)); const fixed = num(loan['每月還款（銀行通知）']);
    let first = parseDate(loan.首期還款日); if (!first) { const s = parseDate(loan.撥款日); if (s) first = addMonths(s, 1); }
    const missing = [];
    if (!P) missing.push('本金');
    if (!first) missing.push('首期還款日（或撥款日）');
    if (!n && !fixed) missing.push('期數（或銀行通知的每月還款）');
    if (rate == null && !fixed) missing.push('年利率');
    if (missing.length) return { missing, rows: [], monthlyPayment: fixed || null };
    const r = (rate || 0) / 100 / 12; const rows = []; let bal = P;
    const amortN = n ? Math.max(1, Math.round(n) - grace) : null;
    const equalPay = (amortN && r > 0) ? P * r / (1 - Math.pow(1 + r, -amortN)) : (amortN ? P / amortN : null);
    const byPrincipal = loan.還款方式 === '本金平均攤還';
    for (let i = 0; bal > 0.5 && i < 600; i++) {
      const interest = bal * r; let principal; let pay;
      if (i < grace) { principal = 0; pay = interest; }
      else if (fixed && !byPrincipal) { pay = fixed; principal = Math.min(bal, pay - interest); if (principal <= 0) { rows.push({ month: ym(addMonths(first, i)), pay, interest, principal: 0, balance: bal, warn: '每月還款少於利息，永遠還不完' }); break; } }
      else if (byPrincipal) { principal = Math.min(bal, P / (amortN || 1)); pay = principal + interest; }
      else { pay = equalPay; principal = Math.min(bal, pay - interest); }
      if (principal >= bal - 0.5) { pay = bal + interest; principal = bal; }
      bal -= principal;
      rows.push({ month: ym(addMonths(first, i)), pay: Math.round(pay), interest: Math.round(interest), principal: Math.round(principal), balance: Math.max(0, Math.round(bal)) });
      if (n && i + 1 >= n) break;
    }
    const regular = rows.find((x, i) => i >= grace) || rows[0];
    return { missing: [], rows, monthlyPayment: fixed || (regular ? regular.pay : 0), endMonth: rows.length ? rows[rows.length - 1].month : '' };
  }

  // 某個月份（YYYY-MM）以前已還完後的剩餘本金
  function balanceAt(loan, sched, monthStr) {
    const done = sched.rows.filter((x) => x.month <= monthStr);
    return done.length ? done[done.length - 1].balance : (num(loan.本金) || 0);
  }

  const api = { monthly, loanSchedule, balanceAt, ym, parseDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LeiyiFinance = api;
})(typeof window !== 'undefined' ? window : globalThis);
