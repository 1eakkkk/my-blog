(function () {
  let session = null, dirty = false, failed = false, saving = false;
  let editorEpoch = 0, countGeneration = 0, initialized = false, initializedOwner = '';
  let saveQueue = Promise.resolve(), debounce, dialogFocus, unsubscribe;
  const owner = () => String(currentUser?.id || '');
  const token = () => `${owner()}:${editorEpoch}`;
  const current = captured => captured === token();
  const store = id => DraftStore.create(null, id || currentUser?.id);
  function snapshot() {
    return { title: document.getElementById('postTitle').value, content: document.getElementById('postContent').value,
      category: document.getElementById('postCategory').value, mood: document.querySelector('.mood-btn.active')?.dataset.mood || '',
      postId: isEditingPost ? editingPostId : null };
  }
  const fingerprint = () => JSON.stringify(snapshot());
  function unsaved() {
    const value = snapshot();
    return (!session && !value.title && !value.content) ? false : session?.signature !== JSON.stringify(value);
  }
  function status(text, error = false) {
    const node = document.getElementById('draftStatus');
    if (node) { node.textContent = text; node.classList.toggle('save-error', error); }
    failed = error;
    for (const id of ['draftRetry', 'draftSaveCopy']) { const button = document.getElementById(id); if (button) button.hidden = !error; }
  }
  function savedStatus(item) { status(`仅保存在本机 · 已保存 ${BlogUtils.formatTime(item.savedAt).slice(11, 19)} (UTC+8)`); }
  function enqueue(action) {
    const pending = saveQueue.then(action);
    saveQueue = pending.catch(() => {});
    return pending;
  }
  function schedule() { clearTimeout(debounce); debounce = setTimeout(() => { void saveDraft(); }, 500); }
  function reset() {
    editorEpoch++; session = null; dirty = false; failed = false; clearTimeout(debounce);
    document.getElementById('postContent').dataset.draftId = ''; status('');
  }
  function fill(item) {
    reset();
    document.getElementById('postTitle').value = item.title || '';
    document.getElementById('postContent').value = item.content || '';
    document.getElementById('postCategory').value = item.category || '灌水';
    document.querySelectorAll('.mood-btn').forEach(button => button.classList.toggle('active', button.dataset.mood === (item.mood || '')));
    session = { ...item, owner: owner(), signature: fingerprint() };
    document.getElementById('postContent').dataset.draftId = item.id;
    savedStatus(item);
    document.getElementById('postContent').dispatchEvent(new Event('input', { bubbles: true }));
    dirty = false; clearTimeout(debounce);
  }
  window.updateDraftCount = async function () {
    const account = owner(), generation = ++countGeneration;
    try {
      const data = await store(account).read();
      if (owner() === account && generation === countGeneration) document.getElementById('draftCount').textContent = data.items.length;
      return true;
    } catch (error) { if (owner() === account && generation === countGeneration) status(error.message + '；请导出当前内容', true); return false; }
  };
  async function commit(captured) {
    while (current(captured)) {
      const value = snapshot(), signature = JSON.stringify(value);
      if (!session && !value.title && !value.content) { dirty = false; return true; }
      if (session && session.owner !== owner()) { status('账号已变化；请导出当前内容', true); return false; }
      if (session?.signature === signature && !dirty && !failed) return true;
      const account = owner(), id = session?.id || crypto.randomUUID(), revision = session?.revision || 0;
      saving = true;
      try {
        const item = await store(account).save({ ...value, id }, revision);
        if (!current(captured)) return false;
        session = { ...item, owner: account, signature };
        document.getElementById('postContent').dataset.draftId = id;
        dirty = fingerprint() !== signature;
        if (dirty) status('新内容尚未保存 · 正在继续保存'); else savedStatus(item);
        void updateDraftCount();
        // SPA 导航等待当前编辑器的最新内容，而不是只等待先前捕获的快照。
        if (!dirty) return true;
      } catch (error) {
        if (current(captured)) { dirty = true; status(error.message + '；请导出当前内容', true); }
        return false;
      } finally { saving = false; }
    }
    return false;
  }
  window.saveDraft = function () {
    if (!currentUser) return Promise.resolve(false);
    clearTimeout(debounce);
    const captured = token();
    return enqueue(() => current(captured) ? commit(captured) : false);
  };
  window.restoreDraft = async function (isCurrent = () => true) {
    const captured = token(); void updateDraftCount();
    if (isEditingPost || session) return;
    try {
      const data = await store().read();
      if (!current(captured) || !isCurrent() || isEditingPost || session) return;
      const active = data.items.find(item => item.id === data.activeId && !item.postId);
      if (active && !snapshot().title && !snapshot().content) fill(active);
      else status('仅保存在本机 · 输入后自动保存');
    } catch (error) { if (current(captured) && isCurrent()) status(error.message + '；请导出当前内容', true); }
  };
  window.findEditingDraft = async function (post, isCurrent, requestedId = '') {
    try {
      const data = await store().read();
      if (!isCurrent()) return undefined;
      const existing = data.items.find(item => String(item.postId) === String(post.id) && (!requestedId || item.id === requestedId));
      if (requestedId && !existing) throw new Error('这篇草稿已变化，请重新打开草稿箱');
      return existing && (requestedId || confirm('发现此帖上次未完成的编辑，恢复本机备份？')) ? existing : null;
    } catch (error) { if (isCurrent()) { status(error.message + '；请导出当前内容', true); if (requestedId) throw error; } return null; }
  };
  window.beginEditingDraft = function (post, candidate) {
    reset();
    if (candidate) fill(candidate);
    else {
      // 未修改的远端正文不是脏草稿；第一次修改时才创建本机版本。
      session = { id: crypto.randomUUID(), revision: 0, owner: owner(), postId: post.id, signature: fingerprint() };
      status('修改后自动保存本机备份');
    }
  };
  window.clearDraft = function (publishedSignature = fingerprint()) {
    const captured = token();
    return enqueue(async () => {
      if (!current(captured) || fingerprint() !== publishedSignature) return false;
      try {
        if (session?.revision) await store().remove(session.id, session.revision);
        if (!current(captured)) return false;
        if (fingerprint() !== publishedSignature) { session = null; dirty = true; status('新输入尚未保存 · 正在等待自动保存'); schedule(); return false; }
        reset(); void updateDraftCount(); return token();
      } catch (error) { if (current(captured)) { dirty = true; status('已发布，但本机备份未清除：' + error.message, true); } return false; }
    });
  };
  window.resetDraftEditor = reset;
  function download(text, name, type = 'text/markdown;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filename = value => (value || '未命名草稿').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) + '.md';
  window.exportCurrentDraft = () => { const value = snapshot(); download(DraftStore.markdown(value), filename(value.title)); };
  window.saveDraftCopy = async function () {
    const captured = token(); await saveQueue;
    if (!current(captured)) return false;
    reset(); dirty = true; return saveDraft();
  };
  function button(label, action, danger = false) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'btn btn-sm' + (danger ? ' btn-danger' : ' btn-ghost');
    node.textContent = label; node.addEventListener('click', () => { Promise.resolve().then(action).catch(error => showToast(error.message || '草稿操作失败，请重试', 'error')); }); return node;
  }
  let boxGeneration = 0;
  window.openDraftBox = async function (saveCurrent = true) {
    const account = owner(), generation = ++boxGeneration, sourceHash = location.hash;
    const isCurrent = () => account === owner() && generation === boxGeneration && sourceHash === location.hash;
    if (saveCurrent) await saveDraft();
    if (!isCurrent()) return;
    const list = document.getElementById('draftBoxList'); list.replaceChildren();
    try {
      const data = await store(account).read();
      if (!isCurrent()) return;
      if (!data.items.length) { const empty = document.createElement('p'); empty.className = 'draft-empty'; empty.textContent = '暂无草稿'; list.append(empty); }
      for (const item of data.items) {
        const row = document.createElement('div'); row.className = 'draft-item';
        const info = document.createElement('div'); info.className = 'draft-item-info';
        const title = document.createElement('div'); title.className = 'draft-item-title'; title.textContent = item.title.trim() || item.content.trim().slice(0, 20) || '无标题';
        const meta = document.createElement('div'); meta.className = 'draft-item-meta'; meta.textContent = (item.postId ? '编辑备份 · ' : '') + item.category + ' · ' + BlogUtils.formatTime(item.savedAt);
        info.append(title, meta);
        const actions = document.createElement('div'); actions.className = 'draft-item-actions';
        actions.append(button('加载', async () => {
          const captured = token();
          if (!await saveDraft() && !confirm('当前内容尚未保存。加载会替换编辑器，确认已导出或不再需要？')) return;
          if (!current(captured)) return;
          if (item.postId) { if (!await editPostMode(item.postId, item.id)) return; }
          else {
            const fresh = (await store(account).read()).items.find(draft => draft.id === item.id);
            if (!current(captured)) return;
            if (!fresh) throw new Error('这篇草稿已删除，请刷新草稿箱');
            isEditingPost = false; editingPostId = null; document.querySelector('#postForm button[type="submit"]').textContent = '发布'; fill(fresh);
          }
          closeDraftBox(); showToast('草稿已加载', 'success');
        }), button('导出', () => download(DraftStore.markdown(item), filename(item.title))), button('删除', async () => {
          if (!confirm('删除这篇本机草稿？如果它正在编辑，编辑器也会清空。建议先导出需要保留的内容。')) return;
          const captured = token();
          await enqueue(async () => {
            if (account !== owner()) return;
            const active = current(captured) && session?.id === item.id;
            const deletingSignature = fingerprint();
            await store(account).remove(item.id, active ? session.revision : item.revision);
            if (active && current(captured)) {
              if (fingerprint() !== deletingSignature) { session = null; dirty = true; status('删除期间的新输入已保留，正在等待保存'); schedule(); }
              else {
                document.getElementById('postTitle').value = ''; document.getElementById('postContent').value = '';
                isEditingPost = false; editingPostId = null; document.querySelector('#postForm button[type="submit"]').textContent = '发布'; reset();
              }
            }
          });
          void updateDraftCount(); await openDraftBox(false);
        }, true));
        row.append(info, actions); list.append(row);
      }
      document.getElementById('draftBoxHint').textContent = `当前账号 ${currentUser.nickname || currentUser.username} · 仅在此浏览器保存`;
    } catch (error) { if (isCurrent()) list.textContent = error.message + '。可导出编辑器中的内容。'; }
    if (!isCurrent()) return;
    const overlay = document.getElementById('draftBoxOverlay');
    if (overlay.style.display !== 'flex') dialogFocus = document.activeElement;
    overlay.style.display = 'flex'; document.body.classList.add('draft-modal-open'); document.getElementById('draftBoxClose').focus();
  };
  window.closeDraftBox = function () { boxGeneration++; document.getElementById('draftBoxOverlay').style.display = 'none'; document.body.classList.remove('draft-modal-open'); dialogFocus?.focus(); };
  window.importLegacyDrafts = async function () {
    if (!confirm('旧版草稿没有账号归属标记。仅在确认它们属于当前账号时导入；共享设备请不要导入他人的内容。原数据会保留。')) return;
    const account = owner();
    try {
      const oldList = JSON.parse(localStorage.getItem('draftList') || '[]'), oldSingle = JSON.parse(localStorage.getItem('postDraft') || 'null'), oldEdit = JSON.parse(localStorage.getItem('editingBackup') || 'null');
      const items = [...(Array.isArray(oldList) ? oldList : []), ...(oldSingle ? [oldSingle] : []), ...(oldEdit ? [oldEdit] : [])];
      let count = 0;
      await enqueue(async () => {
        const saved = (await store(account).read()).items;
        for (const [index, item] of items.entries()) {
          if (account !== owner()) return;
          if (!item || typeof item.content !== 'string' || (item.title && typeof item.title !== 'string')) continue;
          const id = `legacy-${index}-${item.id || item.savedAt || 0}`;
          if (saved.some(draft => draft.id === id)) continue;
          await store(account).save({ ...item, id }); count++;
        }
      });
      if (account === owner()) { showToast(`已导入 ${count} 篇，旧数据仍保留`, 'success'); void updateDraftCount(); await openDraftBox(); }
    } catch (error) { if (account === owner()) showToast('导入未完成：' + error.message, 'error'); }
  };
  async function checkExternal() {
    const captured = token(); await saveQueue;
    if (!current(captured) || !session?.revision) return;
    const revision = session.revision, id = session.id;
    try {
      const latest = (await store().read()).items.find(item => item.id === id);
      if (!current(captured) || session?.id !== id || session.revision !== revision) return;
      if (!latest || latest.revision !== revision) { dirty = true; status('此草稿在另一页面已修改；请加载新版本或另存副本', true); }
      void updateDraftCount();
    } catch (error) { if (current(captured)) status(error.message, true); }
  }
  window.initializeDraftUI = async function () {
    const account = owner();
    if (initializedOwner && initializedOwner !== account) {
      reset(); document.getElementById('postTitle').value = ''; document.getElementById('postContent').value = ''; isEditingPost = false; editingPostId = null;
    }
    initializedOwner = account; unsubscribe?.(); unsubscribe = DraftStore.subscribe?.(account, () => { void checkExternal(); });
    if (!initialized) {
      initialized = true;
      function changed() {
        if (document.getElementById('view-write').style.display !== 'block') return;
        dirty = unsaved();
        if (!dirty) return;
        status('尚未保存 · 正在等待自动保存'); schedule();
      }
      document.getElementById('postForm').addEventListener('input', changed);
      document.getElementById('postCategory').addEventListener('change', changed);
      document.getElementById('moodSelector').addEventListener('click', () => queueMicrotask(changed));
      const flush = () => { if (currentUser && (dirty || saving || unsaved())) void saveDraft(); };
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else void checkExternal(); });
      window.addEventListener('focus', () => { void checkExternal(); });
      window.addEventListener('hashchange', () => { if (document.getElementById('draftBoxOverlay').style.display === 'flex') closeDraftBox(); });
      window.addEventListener('beforeunload', event => { const pending = dirty || saving || unsaved(); flush(); if (pending) { event.preventDefault(); event.returnValue = ''; } });
      document.getElementById('draftBoxOverlay').addEventListener('keydown', event => {
        if (event.key === 'Escape') closeDraftBox();
        if (event.key === 'Tab') {
          const controls = [...document.getElementById('draftBoxPanel').querySelectorAll('button')].filter(node => !node.hidden && !node.disabled);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      });
    }
    await updateDraftCount();
  };
  window.DraftUI = { token, isCurrent: current, fingerprint, snapshot, hasUnsaved: () => dirty || saving || unsaved() };
})();
