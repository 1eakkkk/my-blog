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
    const current = line.match(/^(\s*)(\d+)\.\s+/);
    // 当前行已经是列表项：按钮追加下一项，不把现有项再套一层。
    if (current && !value.slice(start, end).includes('\n')) {
      const prefix = `\n${current[1]}${Number(current[2]) + 1}. `;
      return { start: stop, end: stop, text: prefix + '列表项', selectStart: prefix.length, selectEnd: prefix.length + 3 };
    }
    const previous = value.slice(0, lineStart).trimEnd().split('\n').pop().match(/^(\s*)(\d+)\.\s+/);
    const indent = previous ? previous[1] : '';
    const number = previous ? Number(previous[2]) + 1 : 1;
    const selected = value.slice(start, end);
    const prefix = value.slice(lineStart, start).trim() ? '\n' : '';
    const text = prefix + (selected || '列表项').split('\n')
      .map((l, i) => `${indent}${number + i}. ${l.replace(/^\s*\d+\.\s+/, '')}`).join('\n');
    const suffix = selected && value.slice(end, stop).trim() ? '\n' : '';
    return { start, end, text: text + suffix, selectStart: selected ? prefix.length : prefix.length + indent.length + String(number).length + 2, selectEnd: text.length };
  }
  const utils = { timestamp, formatTime, relativeTime, orderedListEdit };
  root.BlogUtils = utils;
  if (typeof module !== 'undefined') module.exports = utils;
})(typeof window !== 'undefined' ? window : globalThis);
