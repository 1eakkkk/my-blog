// 浏览器与回归测试共用；数据库时间统一为 Unix 毫秒，站点日期按 UTC+8。
(function (root) {
  function timestamp(value) {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number' || /^\d+$/.test(value)) return Number(value);
    // 只接受带时区的 ISO 时间，避免浏览器按本地时区猜测。
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
  }
  function formatTime(value) {
    const ms = timestamp(value);
    if (!Number.isFinite(ms) || Math.abs(ms + 8 * 3600000) > 8640000000000000) return '时间未知';
    return new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + ' (UTC+8)';
  }
  function relativeTime(value, now) {
    const ms = timestamp(value);
    if (!Number.isFinite(ms)) return '时间未知';
    const diff = now - ms;
    if (diff < -60000) return formatTime(ms);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    return formatTime(ms).slice(0, 10);
  }
  function orderedListEdit(value, start, end) {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const stop = lineEnd < 0 ? value.length : lineEnd;
    const line = value.slice(lineStart, stop);
    const current = line.match(/^([ \t]*)(\d+)\.(?:[ \t]+|$)/);
    // 当前行已经是列表项：按钮追加下一项，不把现有项再套一层。
    if (current && !value.slice(start, end).includes('\n')) {
      const prefix = `\n${current[1]}${Number(current[2]) + 1}. `;
      return { start: stop, end: stop, text: prefix + '列表项', selectStart: prefix.length, selectEnd: prefix.length + 3 };
    }
    const previous = value.slice(0, lineStart).trimEnd().split('\n').pop().match(/^([ \t]*)(\d+)\.(?:[ \t]+|$)/);
    const indent = previous ? previous[1] : '';
    const number = previous ? Number(previous[2]) + 1 : 1;
    const selected = value.slice(start, end);
    const prefix = value.slice(lineStart, start).trim() ? '\n' : '';
    const text = prefix + (selected || '列表项').split('\n')
      .map((l, i) => `${indent}${number + i}. ${l.replace(/^\s*\d+\.\s+/, '')}`).join('\n');
    const suffix = selected && value.slice(end, stop).trim() ? '\n' : '';
    return { start, end, text: text + suffix, selectStart: selected ? prefix.length : prefix.length + indent.length + String(number).length + 2, selectEnd: text.length };
  }
  function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const ms = Date.parse(`${value}T00:00:00+08:00`);
    return Number.isFinite(ms) && new Date(ms + 8 * 3600000).toISOString().slice(0, 10) === value;
  }
  function archiveData(rows) {
    const days = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const count = Number(row.count);
      if (isCalendarDate(row.date) && Number.isSafeInteger(count) && count > 0) days.set(row.date, count);
    }
    const months = [...new Set([...days.keys()].map(d => d.slice(0, 7)))].sort();
    return { days, months };
  }
  function safeUrl(value, base, allowContact = false) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      const url = new URL(value, base);
      if (url.username || url.password) return '';
      return ['https:', 'http:', ...(allowContact ? ['mailto:', 'tel:'] : [])].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  const utils = { timestamp, formatTime, relativeTime, orderedListEdit, isCalendarDate, archiveData, safeUrl };
  root.BlogUtils = utils;
  if (typeof module !== 'undefined') module.exports = utils;
})(typeof window !== 'undefined' ? window : globalThis);
