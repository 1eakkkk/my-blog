/* 回复我的与首页回访体验。内容均用文本节点渲染，账号切换丢弃旧请求结果。 */
(function () {
  const state = { user: null, epoch: 0, listGeneration: 0, countGeneration: 0, countRevision: 0, loading: false, page: 1, unreadOnly: false,
    hasMore: false, cursor: null, loadedIds: new Set(), readThrough: 0, unread: 0, pendingRead: null, controller: null, timer: null, homeVisited: false, introExpanded: false };
  const nodes = {};
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const onInbox = () => location.hash.split('?')[0] === '#replies';
  const onHome = () => !location.hash || location.hash.split('?')[0] === '#home';
  const api = (url, options) => fetchApi(url, options);

  function mount() {
    if (nodes.view) return;
    const nav = el('a', 'nav-link', '回复我的');
    nav.id = 'navReplies'; nav.href = '#replies';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none', stroke: 'currentColor', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2v-9.5A8.5 8.5 0 0 1 11.5 4h1A8.5 8.5 0 0 1 21 11.5Z');
    icon.appendChild(outline); nav.prepend(icon);
    const badge = el('span', 'reply-count'); badge.id = 'navReplyCount'; badge.hidden = true;
    nav.appendChild(badge);
    document.getElementById('navMyProfile')?.after(nav);
    nodes.nav = nav; nodes.badge = badge;

    const view = el('section', 'view-section reply-inbox'); view.id = 'view-replies'; view.style.display = 'none';
    const heading = el('div', 'reply-inbox-heading');
    const copy = el('div'); copy.append(el('p', 'eyebrow', 'A CONVERSATION CONTINUES / 接着聊'), el('h1', 'section-title', '回复我的'));
    const mark = el('button', 'btn btn-sm btn-ghost', '全部标为已读'); mark.type = 'button'; mark.disabled = true;
    mark.addEventListener('click', markAllRead); heading.append(copy, mark); view.appendChild(heading);
    const tabs = el('div', 'reply-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '回复筛选');
    const all = el('button', 'btn btn-sm', '全部'); const unread = el('button', 'btn btn-sm', '未读');
    for (const [button, unreadOnly] of [[all, false], [unread, true]]) {
      button.type = 'button'; button.addEventListener('click', () => { state.unreadOnly = unreadOnly; syncTabs(); loadInbox(true); }); tabs.appendChild(button);
    }
    const status = el('p', 'reply-inbox-status'); status.setAttribute('role', 'status'); view.append(tabs, status);
    const list = el('div', 'reply-inbox-list'); list.id = 'replyInboxList'; view.appendChild(list);
    const more = el('button', 'load-more', '加载更多回复'); more.type = 'button'; more.hidden = true;
    more.addEventListener('click', () => loadInbox(false)); view.appendChild(more);
    document.getElementById('main-content')?.appendChild(view);
    Object.assign(nodes, { view, list, mark, all, unread, more, status });

    const masthead = document.querySelector('.home-masthead');
    if (masthead) {
      const toggle = el('button', 'btn btn-sm btn-ghost masthead-toggle', '展开开场'); toggle.type = 'button'; toggle.hidden = true;
      toggle.addEventListener('click', () => {
        const top = window.scrollY; const epoch = state.epoch;
        state.introExpanded = !state.introExpanded; renderMasthead();
        requestAnimationFrame(() => { if (epoch === state.epoch && onHome()) window.scrollTo({ top, behavior: 'instant' }); });
      });
      masthead.appendChild(toggle); Object.assign(nodes, { masthead, introToggle: toggle });
    }
    window.addEventListener('hashchange', syncRoute);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCount(); });
    window.addEventListener('focus', refreshCount);
  }

  function setBadge(count) {
    state.countRevision++;
    state.unread = Number.isSafeInteger(Number(count)) && Number(count) >= 0 ? Number(count) : 0;
    nodes.badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
    nodes.badge.hidden = state.unread === 0;
    nodes.nav.setAttribute('aria-label', state.unread ? `回复我的，${state.unread} 条未读` : '回复我的');
    nodes.mark.disabled = !state.unread || !state.readThrough;
  }

  async function refreshCount() {
    if (!state.user || document.hidden) return;
    const epoch = state.epoch; const generation = ++state.countGeneration; const revision = state.countRevision;
    try {
      const response = await api('/api/notifications?summary=1');
      const data = await response.json();
      if (epoch !== state.epoch || generation !== state.countGeneration || revision !== state.countRevision || !response.ok) return;
      setBadge(data.unread_count);
    } catch (_) { /* 下次访问或前台刷新时重试；不打断阅读。 */ }
  }

  function syncTabs() {
    nodes.all.setAttribute('aria-pressed', String(!state.unreadOnly));
    nodes.unread.setAttribute('aria-pressed', String(state.unreadOnly));
  }

  function renderRow(row) {
    if (!Number.isSafeInteger(row.comment_id) || row.comment_id < 1 || !Number.isSafeInteger(row.post_id) || row.post_id < 1) return;
    if (state.loadedIds.has(row.comment_id)) return;
    state.loadedIds.add(row.comment_id);
    const link = el('a', `reply-inbox-card${row.is_unread ? ' is-unread' : ''}`);
    link.href = `#post?id=${row.post_id}&commentId=${row.comment_id}`;
    const top = el('div', 'reply-inbox-card-head');
    top.appendChild(el('strong', '', row.nickname || row.username || '未知用户'));
    top.appendChild(el('span', 'reply-inbox-action', row.kind === 'reply' ? '回复了你的评论' : '评论了你的帖子'));
    if (row.is_unread) top.appendChild(el('span', 'reply-unread-label', '未读'));
    const excerpt = el('p', 'reply-inbox-excerpt', row.excerpt || '[图片或附件]');
    const meta = el('div', 'reply-inbox-meta'); meta.append(el('span', '', row.post_title || '无题 / Untitled'), el('time', '', BlogUtils.relativeTime(row.created_at, Date.now() + (typeof serverClockOffset === 'number' ? serverClockOffset : 0))));
    meta.lastElementChild.title = BlogUtils.formatTime(row.created_at);
    link.append(top, excerpt, meta);
    link.addEventListener('click', () => { if (row.is_unread) state.pendingRead = { postId: row.post_id, commentId: row.comment_id }; });
    nodes.list.appendChild(link);
  }

  async function loadInbox(reset) {
    if (!state.user) return;
    if (reset) {
      state.listGeneration++; state.controller?.abort(); state.loading = false; state.page = 1; state.hasMore = true;
      state.cursor = null; state.loadedIds.clear();
      nodes.list.replaceChildren(el('div', 'loading-spinner')); nodes.more.hidden = true; nodes.status.textContent = '';
    }
    if (state.loading || !state.hasMore) return;
    const epoch = state.epoch; const generation = state.listGeneration; const page = state.page;
    const current = () => epoch === state.epoch && generation === state.listGeneration;
    state.loading = true; nodes.more.disabled = true; const controller = state.controller = new AbortController();
    try {
      const query = new URLSearchParams({ limit: 20, unread: state.unreadOnly ? '1' : '0' });
      if (state.cursor) query.set('cursor', state.cursor);
      else query.set('page', String(page));
      const response = await api(`/api/notifications?${query}`, { signal: controller.signal });
      const data = await response.json();
      if (!current()) return;
      if (!response.ok || !Array.isArray(data.results)) throw new Error(data.error || '回复加载失败');
      if (reset) nodes.list.replaceChildren();
      state.readThrough = Number(data.read_through) || 0; setBadge(data.unread_count); state.hasMore = Boolean(data.has_more);
      state.cursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
      data.results.forEach(renderRow); state.page++;
      nodes.status.textContent = `${Number(data.filtered_total) || 0} 条${state.unreadOnly ? '未读' : ''}回复`;
      if (page === 1 && !data.results.length) {
        const empty = el('div', 'empty-state'); empty.append(el('p', '', state.unreadOnly ? '未读回复都看完了。' : '还没有收到回复，下一段交流会出现在这里。')); nodes.list.appendChild(empty);
      }
    } catch (error) {
      if (!current() || error.name === 'AbortError') return;
      if (reset) nodes.list.replaceChildren();
      nodes.status.textContent = '回复暂时无法加载，请重试。';
      if (reset) {
        const retry = el('button', 'btn btn-sm', '重新加载'); retry.type = 'button'; retry.addEventListener('click', () => loadInbox(true)); nodes.list.appendChild(retry);
      }
    } finally {
      if (current()) { state.loading = false; nodes.more.disabled = false; nodes.more.hidden = !state.hasMore || page === 1 && state.page === 1; }
    }
  }

  async function markAllRead() {
    if (!state.user || !state.readThrough || nodes.mark.disabled) return;
    const epoch = state.epoch; const through = state.readThrough; nodes.mark.disabled = true;
    try {
      const response = await api('/api/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_all', through_id: through }) });
      const data = await response.json();
      if (epoch !== state.epoch) return;
      if (!response.ok) throw new Error(data.error || '保存失败');
      setBadge(data.unread_count); await loadInbox(true);
    } catch (_) {
      if (epoch === state.epoch) { nodes.status.textContent = '已读状态未保存，请再次点击重试。'; nodes.mark.disabled = !state.unread; }
    }
  }

  async function onCommentShown(postId, commentId) {
    const target = state.pendingRead;
    if (!target || String(target.postId) !== String(postId) || String(target.commentId) !== String(commentId) || target.loading) return;
    const route = location.hash.split('?');
    const params = new URLSearchParams(route[1] || '');
    const comment = document.getElementById(`comment-${commentId}`);
    // 离开目标帖子时，迟到的响应不能把尚未阅读的回复标成已读。
    if (route[0] !== '#post' || params.get('id') !== String(postId) || !comment || !comment.getClientRects().length) return;
    const epoch = state.epoch; target.loading = true;
    try {
      const response = await api('/api/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', comment_id: target.commentId }) });
      const data = await response.json();
      if (epoch !== state.epoch) return;
      if (!response.ok) throw new Error('保存失败');
      if (state.pendingRead === target) state.pendingRead = null;
      setBadge(data.unread_count);
    } catch (_) {
      if (epoch === state.epoch) { target.loading = false; showToast('回复已打开，已读状态暂未保存；可以稍后从回复列表重试。', 'error'); }
    }
  }

  function renderMasthead() {
    if (!nodes.masthead) return;
    nodes.masthead.classList.toggle('community-returning', state.homeVisited && !state.introExpanded);
    nodes.introToggle.hidden = !state.homeVisited;
    nodes.introToggle.textContent = state.introExpanded ? '收起开场' : '展开开场';
    nodes.introToggle.setAttribute('aria-expanded', String(state.introExpanded));
  }

  function syncRoute() {
    if (!state.user || !nodes.view) return;
    if (onInbox()) {
      document.querySelectorAll('.view-section').forEach(view => { view.style.display = view === nodes.view ? 'block' : 'none'; });
      document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link === nodes.nav));
      syncTabs(); loadInbox(true);
    } else {
      nodes.view.style.display = 'none'; nodes.nav.classList.remove('active');
      state.listGeneration++; state.controller?.abort(); state.loading = false;
    }
    if (onHome()) {
      renderMasthead();
      state.homeVisited = true;
      try { localStorage.setItem(`homeVisited:${state.user.id}`, '1'); } catch (_) {}
    }
  }

  function initialize(user) {
    if (!user || !Number.isSafeInteger(Number(user.id))) return;
    destroy(); state.user = { id: Number(user.id) }; mount(); state.homeVisited = false; state.introExpanded = false;
    try { state.homeVisited = localStorage.getItem(`homeVisited:${state.user.id}`) === '1'; } catch (_) {}
    setBadge(0); syncRoute(); refreshCount();
    state.timer = setInterval(() => { if (!document.hidden && document.hasFocus()) refreshCount(); }, 60000);
  }

  function destroy() {
    state.epoch++; state.listGeneration++; state.controller?.abort(); clearInterval(state.timer);
    state.user = null; state.pendingRead = null; state.loading = false; state.readThrough = 0;
    if (nodes.view) nodes.view.style.display = 'none';
  }

  window.CommunityUI = { initialize, destroy, onCommentShown, refreshCount };
  window.initializeCommunityUI = initialize;
})();
