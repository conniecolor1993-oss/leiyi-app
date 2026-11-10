/* Google 日曆讀取（ical.js）
 * 讀 Google 日曆「iCal 私人網址」的內容，展開重複行程，給「行程」頁和首頁用。只讀，不會改到 Google 日曆。
 */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const unescapeText = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

  // 把 iCal 的日期時間轉成 Date；回傳 { date, allDay }
  function parseDT(value, params) {
    const v = String(value || '').trim();
    if (/^\d{8}$/.test(v) || (params && /VALUE=DATE(?!-)/.test(params))) {
      return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
    }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
    // 有 TZID 或沒寫時區：當成這台電腦的當地時間（台灣使用者即台北時間）
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  }

  function parse(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const events = []; let cur = null; let depth = 0;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; depth = 0; continue; }
      if (!cur) continue;
      if (line.startsWith('BEGIN:')) { depth++; continue; } // 例如 VALARM
      if (line.startsWith('END:') && depth > 0) { depth--; continue; }
      if (line === 'END:VEVENT') { if (cur.start) events.push(cur); cur = null; continue; }
      if (depth > 0) continue;
      const i = line.indexOf(':'); if (i < 0) continue;
      const head = line.slice(0, i); const value = line.slice(i + 1);
      const [name, ...ps] = head.split(';'); const params = ps.join(';');
      switch (name.toUpperCase()) {
        case 'UID': cur.uid = value; break;
        case 'SUMMARY': cur.title = unescapeText(value); break;
        case 'LOCATION': cur.location = unescapeText(value); break;
        case 'DESCRIPTION': cur.description = unescapeText(value); break;
        case 'STATUS': cur.status = value.toUpperCase(); break;
        case 'DTSTART': { const p = parseDT(value, params); if (p) { cur.start = p.date; cur.allDay = p.allDay; } break; }
        case 'DTEND': { const p = parseDT(value, params); if (p) cur.end = p.date; break; }
        case 'RRULE': cur.rrule = value; break;
        case 'RECURRENCE-ID': { const p = parseDT(value, params); if (p) cur.recurrenceId = p.date; break; }
        case 'EXDATE': for (const x of value.split(',')) { const p = parseDT(x, params); if (p) cur.exdates.push(p.date.getTime()); } break;
        default: break;
      }
    }
    return events.filter((e) => e.status !== 'CANCELLED' || e.recurrenceId);
  }

  const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function rule(s) { const o = {}; for (const kv of String(s).split(';')) { const [k, v] = kv.split('='); if (k) o[k.toUpperCase()] = v; } return o; }
  function addMonths(d, n) { const x = new Date(d); const day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); if (day > last) return null; x.setDate(day); return x; }

  // 展開重複行程：只回傳和 [from, to) 有交集的場次
  function occurrences(ev, from, to) {
    const dur = ev.end ? ev.end - ev.start : (ev.allDay ? 86400000 : 3600000);
    const hit = (s) => s < to && new Date(s.getTime() + dur) > from && !ev.exdates.includes(s.getTime());
    if (!ev.rrule) return hit(ev.start) ? [ev.start] : [];
    const r = rule(ev.rrule); const freq = r.FREQ; const interval = Math.max(1, +r.INTERVAL || 1);
    const until = r.UNTIL ? (parseDT(r.UNTIL) || {}).date : null; const count = r.COUNT ? +r.COUNT : Infinity;
    const out = []; let n = 0; const MAX = 5000;
    const push = (s) => { if (n >= count) return false; if (until && s > until) return false; n++; if (hit(s)) out.push(s); return true; };
    if (freq === 'WEEKLY') {
      const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => DAYS[x.slice(-2)]).filter((x) => x !== undefined) : [ev.start.getDay()];
      const weekStart = new Date(ev.start); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      for (let w = 0; w < MAX; w++) {
        let stop = false;
        for (const dow of byday.slice().sort()) {
          const s = new Date(weekStart); s.setDate(s.getDate() + w * 7 * interval + dow);
          s.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
          if (s < ev.start) continue;
          if (s >= to && !until && count === Infinity) { stop = true; break; }
          if (!push(s)) { stop = true; break; }
        }
        if (stop) break;
      }
      return out;
    }
    for (let i = 0; i < MAX; i++) {
      let s;
      if (freq === 'DAILY') { s = new Date(ev.start); s.setDate(s.getDate() + i * interval); }
      else if (freq === 'MONTHLY') { s = addMonths(ev.start, i * interval); if (!s) continue; }
      else if (freq === 'YEARLY') { s = addMonths(ev.start, i * 12 * interval); if (!s) continue; }
      else return hit(ev.start) ? [ev.start] : [];
      if (s >= to && !until && count === Infinity) break;
      if (!push(s)) break;
    }
    return out;
  }

  // 多個日曆合併，回傳某段期間的行程（已排序、已處理單場改期）
  function between(calendars, from, to) {
    const list = [];
    for (const cal of calendars) {
      const evs = parse(cal.text);
      const moved = new Map(); // uid → 被單獨改過的場次時間
      for (const e of evs) if (e.recurrenceId) { const k = e.uid; if (!moved.has(k)) moved.set(k, new Set()); moved.get(k).add(e.recurrenceId.getTime()); }
      for (const e of evs) {
        if (e.recurrenceId && e.status === 'CANCELLED') continue;
        for (const s of occurrences(e, from, to)) {
          if (!e.recurrenceId && moved.has(e.uid) && moved.get(e.uid).has(s.getTime())) continue;
          const end = new Date(s.getTime() + ((e.end ? e.end - e.start : 0) || (e.allDay ? 86400000 : 3600000)));
          list.push({ calendar: cal.name, title: e.title || '（無標題）', location: e.location || '', description: e.description || '', allDay: !!e.allDay, start: s, end });
        }
      }
    }
    return list.sort((a, b) => a.start - b.start || (b.allDay - a.allDay));
  }

  // 開啟 Google 日曆的新增行程畫面（帶入標題、日期）
  function addUrl(title, dateStr) {
    const d = (dateStr || '').replace(/-/g, '');
    const q = new URLSearchParams({ action: 'TEMPLATE', text: title || '' });
    if (/^\d{8}$/.test(d)) { const n = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + 1); q.set('dates', `${d}/${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}`); }
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
  }

  const api = { parse, occurrences, between, addUrl, ymd, hm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LeiyiICal = api;
})(typeof window !== 'undefined' ? window : globalThis);
