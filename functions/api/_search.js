export function literalSearch(value) {
  return '%' + value.replace(/[\\%_]/g, character => '\\' + character) + '%';
}

function textContent(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
}

export function searchExcerpt(value, search) {
  let text = textContent(value);
  let position = text.toLowerCase().indexOf(search.toLowerCase());
  // 链接地址或 Markdown 标记本身命中时保留附近原文，仍由前端作为纯文字渲染。
  if (position < 0) {
    text = String(value || '').replace(/\s+/g, ' ').trim();
    position = text.toLowerCase().indexOf(search.toLowerCase());
  }
  if (position < 0) return '';
  const start = Math.max(0, position - 36);
  const end = Math.min(text.length, Math.max(start + 140, position + search.length + 36));
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export async function addSearchMatches(db, posts, search) {
  if (!search || !posts.length) return;
  const byPost = new Map();
  const ids = posts.map(post => post.id);
  for (let start = 0; start < ids.length; start += 90) {
    const batch = ids.slice(start, start + 90);
    const matches = await db.prepare(`WITH ranked AS (
      SELECT id, post_id, user_id, content, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY created_at DESC, id DESC) AS match_order
      FROM active_comments WHERE post_id IN (${batch.map(() => '?').join(',')}) AND content LIKE ? ESCAPE '\\')
      SELECT ranked.*, users.username, users.nickname FROM ranked JOIN users ON users.id=ranked.user_id WHERE match_order=1`)
      .bind(...batch, literalSearch(search)).all();
    matches.results.forEach(comment => byPost.set(comment.post_id, comment));
  }
  for (const post of posts) {
    const matches = [];
    const body = searchExcerpt(post.content, search);
    if (body) matches.push({ source: 'body', excerpt: body });
    const comment = byPost.get(post.id);
    if (comment) matches.push({ source: 'comment', comment_id: comment.id,
      author: comment.nickname || comment.username || '', excerpt: searchExcerpt(comment.content, search) });
    post.search_matches = matches;
  }
}
