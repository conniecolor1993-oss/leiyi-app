// Google 日曆（iCal）解析測試
const I = require('../app/ical.js');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('✔ ' + n); } else { fail++; console.log('✘ ' + n, d === undefined ? '' : JSON.stringify(d)); } };
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261110T040000Z', 'DTEND:20261110T053000Z', 'SUMMARY:公司開會 百媚', 'LOCATION:台南\\, 中西區', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261111', 'DTEND;VALUE=DATE:20261112', 'SUMMARY:BNI 早餐會', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'DTSTART;TZID=Asia/Taipei:20261102T200000', 'DTEND;TZID=Asia/Taipei:20261102T213000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'EXDATE;TZID=Asia/Taipei:20261112T200000', 'SUMMARY:吐司會', 'BEGIN:VALARM', 'SUMMARY:提醒', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'RECURRENCE-ID;TZID=Asia/Taipei:20261116T200000', 'DTSTART;TZID=Asia/Taipei:20261117T190000', 'DTEND;TZID=Asia/Taipei:20261117T200000', 'SUMMARY:吐司會（改期）', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d', 'DTSTART:20261105T010000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:三天課', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:e', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY', 'SUMMARY:月底結帳', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:f', 'DTSTART:20261110T010000Z', 'SUMMARY:很長的說明', 'DESCRIPTION:第一行\\n第二', ' 行接續', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
const from = new Date(2026, 10, 1), to = new Date(2026, 11, 1);
const ev = I.between([{ name: '我的日曆', text: ics }], from, to);
const titles = ev.map((e) => `${I.ymd(e.start)} ${e.allDay ? '整天' : I.hm(e.start)} ${e.title}`);
const u = new Date(Date.UTC(2026, 10, 10, 4, 0));
ok('UTC 時間轉成這台電腦的時間', titles.includes(`${I.ymd(u)} ${I.hm(u)} 公司開會 百媚`), titles);
ok('全天行程', titles.includes('2026-11-11 整天 BNI 早餐會'));
ok('跳脫字元還原', ev.find((e) => e.title === '公司開會 百媚').location === '台南, 中西區');
ok('長行折行接回', ev.find((e) => e.title === '很長的說明').description === '第一行\n第二行接續');
const toast = titles.filter((t) => t.includes('吐司會'));
ok('每週一、四重複', toast.includes('2026-11-02 20:00 吐司會') && toast.includes('2026-11-05 20:00 吐司會') && toast.includes('2026-11-30 20:00 吐司會'), toast);
ok('排除的那天不出現', !toast.includes('2026-11-12 20:00 吐司會'), toast);
ok('單場改期用新時間', toast.includes('2026-11-17 19:00 吐司會（改期）') && !toast.includes('2026-11-16 20:00 吐司會'), toast);
ok('提醒不會變成行程', !titles.some((t) => t.includes('提醒')));
ok('COUNT=3 只有三天', titles.filter((t) => t.includes('三天課')).length === 3);
const monthEnd = I.between([{ name: 'x', text: ics }], new Date(2026, 0, 1), new Date(2027, 0, 1)).filter((e) => e.title === '月底結帳').map((e) => I.ymd(e.start));
ok('每月 31 號沒有 31 號的月份跳過', monthEnd.length === 7 && monthEnd.includes('2026-12-31') && !monthEnd.some((d) => d.endsWith('-30')), monthEnd);
ok('依時間排序', ev.every((e, i) => i === 0 || ev[i - 1].start <= e.start));
ok('空內容不報錯', I.between([{ name: 'x', text: '' }], from, to).length === 0);
ok('新增行程網址', I.addUrl('開會', '2026-11-10') === 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=%E9%96%8B%E6%9C%83&dates=20261110%2F20261111');
console.log(`\n日曆測試：通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
