(function (root) {
  function postMarkdown(post) {
    const title = String(post.title || '无题').replace(/[\r\n]+/g, ' ');
    const created = root.BlogUtils?.formatTime(post.created_at) || new Date(post.created_at).toISOString();
    const updated = post.updated_at ? `\n最后编辑：${root.BlogUtils?.formatTime(post.updated_at) || new Date(post.updated_at).toISOString()}` : '';
    return `# ${title}\n\n作者：${String(post.author_nickname || post.author_name || post.author_username || '').replace(/[\r\n]+/g, ' ')}\n发布时间：${created}${updated}\n分类：${String(post.category || '').replace(/[\r\n]+/g, ' ')}\n\n---\n\n${post.content || ''}\n`;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { postMarkdown };
  if (!root.document) return;

  const request = (url, options) => typeof root.fetchApi === 'function' ? root.fetchApi(url, options) : fetch(url, { credentials: 'same-origin', ...options });
  function download(post) {
    const name = String(post.title || '无题').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70).trim() || '无题';
    const objectUrl = URL.createObjectURL(new Blob([postMarkdown(post)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = `${post.id}-${name}.md`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  const button = (label, action, className = 'btn btn-sm btn-ghost') => {
    const element = document.createElement('button');
    element.type = 'button'; element.className = className; element.textContent = label;
    element.addEventListener('click', action); return element;
  };
  let mountedUser = null;
  let loadGeneration = 0;

  root.initializeRecoveryUI = function (user) {
    mountedUser = user;
    if (!user || document.getElementById('recoverySettings')) return;
    const section = document.createElement('section');
    section.id = 'recoverySettings'; section.className = 'settings-section recovery-settings';
    section.innerHTML = '<h3>内容与备份</h3><p>删除的帖子和评论会保留在回收站，恢复后仍使用原来的发布时间和链接。</p>';
    section.append(button(user.role === 'admin' ? '查看全站回收站' : '打开我的回收站', () => openRecycle()));
    const settings = document.getElementById('view-settings');
    if (settings) settings.insertBefore(section, settings.lastElementChild);

    const dialog = document.createElement('dialog');
    dialog.id = 'recoveryDialog'; dialog.className = 'recovery-dialog';
    dialog.setAttribute('aria-labelledby', 'recoveryTitle');
    dialog.innerHTML = '<div class="recovery-header"><div><p class="eyebrow">RECOVER / 留住记录</p><h2 id="recoveryTitle">回收站</h2></div></div><p class="recovery-note">先恢复帖子，再恢复它的主评论和回复。被管理员删除的内容由管理员恢复。</p><div class="recovery-status" role="status" aria-live="polite"></div><div class="recovery-list"></div><div class="recovery-footer"></div>';
    dialog.querySelector('.recovery-header').append(button('关闭', () => dialog.close()));
    dialog.addEventListener('close', () => { loadGeneration++; document.body.classList.remove('recovery-modal-open'); });
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
    document.body.append(dialog);

    // The post body is replaced by the main router; add the export action after each render.
    const detail = document.getElementById('single-post-content');
    if (detail) {
      const observer = new MutationObserver(() => {
        const actions = detail.querySelector('.article-actions');
        if (!actions || actions.querySelector('.recovery-export')) return;
        const exportButton = button('导出 Markdown', async () => {
          const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
          if (!/^[1-9]\d*$/.test(id || '')) return;
          exportButton.disabled = true;
          try {
            const response = await request(`/api/posts?id=${id}`);
            const post = await response.json();
            if (!response.ok || !post?.id) throw new Error(post?.error || '帖子已移入回收站或不存在');
            download(post); root.showToast?.('Markdown 已导出；媒体链接保留原地址', 'success');
          } catch (error) { root.showToast?.(error.message || '导出失败，请稍后重试', 'error'); }
          finally { exportButton.disabled = false; }
        });
        exportButton.classList.add('recovery-export'); actions.append(exportButton);
      });
      observer.observe(detail, { childList: true, subtree: true });
    }
  };

  function openRecycle() {
    const dialog = document.getElementById('recoveryDialog');
    if (!dialog || !mountedUser) return;
    document.body.classList.add('recovery-modal-open'); dialog.showModal(); loadRecycle(1, true);
  }

  async function loadRecycle(page, reset) {
    const generation = ++loadGeneration;
    const dialog = document.getElementById('recoveryDialog');
    const status = dialog.querySelector('.recovery-status');
    const list = dialog.querySelector('.recovery-list');
    const footer = dialog.querySelector('.recovery-footer');
    status.textContent = '正在读取回收站…';
    footer.replaceChildren();
    try {
      const response = await request(`/api/recycle?page=${page}`);
      const data = await response.json();
      if (generation !== loadGeneration || !dialog.open) return;
      if (!response.ok || !data.success) throw new Error(data.error || '回收站读取失败');
      if (reset) list.replaceChildren();
      for (const item of data.items) list.append(renderItem(item));
      status.textContent = list.children.length ? '' : '回收站是空的。删除的内容会出现在这里。';
      if (data.has_more) footer.append(button('加载更早的记录', () => loadRecycle(page + 1, false)));
    } catch (error) {
      if (generation !== loadGeneration || !dialog.open) return;
      status.textContent = error.message || '回收站读取失败';
      footer.append(button('重试', () => loadRecycle(page, reset)));
    }
  }

  function renderItem(item) {
    const element = document.createElement('article'); element.className = 'recovery-item';
    const meta = document.createElement('p'); meta.className = 'recovery-meta';
    meta.textContent = `${item.kind === 'post' ? '帖子' : '评论'} · ${root.BlogUtils?.formatTime(item.deleted_at) || ''} 移入`;
    const title = document.createElement('h3'); title.textContent = item.title || '无题';
    const preview = document.createElement('p'); preview.className = 'recovery-preview'; preview.textContent = item.preview || '（无内容）';
    const actions = document.createElement('div'); actions.className = 'recovery-item-actions';
    const hint = document.createElement('span');
    hint.textContent = item.parent_deleted ? '请先恢复所属帖子或主评论' : !item.restore_allowed ? '由管理员恢复' : item.child_count ? `保留 ${item.child_count} 条评论或回复` : '原时间和点赞均保留';
    const restore = button('恢复', async () => {
      restore.disabled = true; restore.textContent = '恢复中…';
      try {
        const response = await request('/api/recycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', kind: item.kind, id: item.target_id }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '恢复失败');
        root.showToast?.(data.message || '已恢复', 'success');
        // Lists may have been cached while the restored content was hidden.
        if (typeof root.loadPosts === 'function') root.loadPosts(true);
        const route = location.hash.split('?')[0];
        const postId = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
        if ((route === '#profile' || (route === '#post' && String(data.post_id) === postId)) && typeof root.handleRoute === 'function') root.handleRoute();
        loadRecycle(1, true);
      } catch (error) { root.showToast?.(error.message || '恢复失败，请稍后重试', 'error'); restore.disabled = false; restore.textContent = '恢复'; }
    }, 'btn btn-sm');
    restore.disabled = !item.restore_allowed;
    actions.append(hint, restore); element.append(meta, title, preview, actions);
    return element;
  }
})(typeof window !== 'undefined' ? window : globalThis);
