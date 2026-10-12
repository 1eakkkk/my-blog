(function (root) {
  const mediaKey = /^[^\u0000-\u001f\u007f/\\?#]+\.(?:jpe?g|png|gif|webp|mp4|webm|pdf|mov|ico|heif|heic)$/i;
  function mediaUrl(value, base) {
    try {
      const url = new URL(value, base);
      const key = decodeURIComponent(url.pathname.slice(1));
      if (url.origin === 'https://img.1eak.cool' && !url.username && !url.password && key.length <= 1024 && mediaKey.test(key)) {
        return new URL(`/api/media/${encodeURIComponent(key)}`, base).href;
      }
    } catch (_) { /* URL 的完整安全校验由 BlogUtils.safeUrl 完成。 */ }
    return value;
  }

  function initializePrivacyUI(user) {
    if (user?.role !== 'admin' || document.getElementById('privacyPanel')) return;
    const grid = document.querySelector('#view-admin .admin-console-grid');
    if (!grid) return;
    const panel = document.createElement('section');
    panel.className = 'admin-console-panel privacy-panel';
    panel.id = 'privacyPanel';
    panel.innerHTML = `<div class="admin-panel-header"><div><p class="privacy-eyebrow">PRIVATE BY INVITATION</p><h3>邀请朋友，进入小站</h3><p>邀请码供一位朋友注册一次。已有账号始终可以登录。</p></div><span class="admin-status-pill" id="privacyModeLabel">读取中</span></div>
      <div class="privacy-controls"><label for="privacyMode">新账号注册<select class="form-control" id="privacyMode" disabled><option value="invite">需要邀请码</option><option value="closed">暂停新注册</option></select></label><label for="inviteExpiryDays">邀请码有效期<select class="form-control" id="inviteExpiryDays"><option value="7">7 天</option><option value="1">1 天</option><option value="30">30 天</option></select></label><button class="btn btn-primary" id="inviteCreate" type="button">创建邀请码</button></div>
      <div class="invite-created" id="inviteCreated" hidden><label for="inviteFreshCode">邀请码已创建，完整内容只显示这一次。</label><div class="invite-code-row"><input class="form-control" id="inviteFreshCode" readonly autocomplete="off" spellcheck="false"><button class="btn btn-sm" id="inviteCopy" type="button">复制</button><button class="btn btn-sm btn-ghost" id="inviteDismiss" type="button" aria-label="隐藏完整邀请码">隐藏</button></div><p>请保存后再分享给朋友。站点只保存摘要，之后无法再次查看完整邀请码。</p></div>
      <p class="privacy-status" id="privacyStatus" role="status" aria-live="polite"></p><div class="invite-list" id="inviteList"></div><div class="privacy-list-actions"><button class="btn btn-sm btn-ghost" id="inviteMore" type="button" hidden>查看更早的邀请码</button><button class="btn btn-sm btn-ghost" id="inviteRefresh" type="button">刷新记录</button></div>`;
    grid.appendChild(panel);
    const find = id => document.getElementById(id);
    const mode = find('privacyMode');
    const status = find('privacyStatus');
    const list = find('inviteList');
    let before = null;
    let generation = 0;
    let loading = false;
    let loaded = false;
    let savedMode = 'invite';

    function message(value, error = false) { status.textContent = value; status.classList.toggle('is-error', error); }
    function showMode(value) {
      savedMode = value === 'closed' ? 'closed' : 'invite';
      mode.value = savedMode;
      find('privacyModeLabel').textContent = savedMode === 'invite' ? '邀请码注册' : '注册已暂停';
    }
    async function api(options, query = '') {
      const res = await fetch('/api/invites' + query, options);
      const data = await res.json();
      if (!res.ok || data.success === false || data.error) throw new Error(data.error || '读取失败，请重试');
      return data;
    }
    const write = body => api({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const date = value => root.BlogUtils?.formatTime(value) || new Date(value).toLocaleString();

    function addInvite(invite) {
      const row = document.createElement('div');
      row.className = 'invite-item';
      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `•••••• ${invite.code_hint}`;
      const state = invite.used_at ? '已使用' : invite.revoked_at ? '已撤销' : invite.expires_at <= Date.now() ? '已过期' : '待使用';
      const pill = document.createElement('span'); pill.className = 'invite-state'; pill.textContent = state;
      title.append(' ', pill);
      const meta = document.createElement('p');
      meta.textContent = invite.used_at ? `使用于 ${date(invite.used_at)}` : `创建于 ${date(invite.created_at)} · 有效至 ${date(invite.expires_at)}`;
      content.append(title, meta); row.append(content);
      if (state === '待使用') {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'btn btn-sm btn-ghost'; revoke.textContent = '撤销';
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try { await write({ action: 'revoke', id: invite.id }); message('邀请码已撤销。'); await reload(); }
          catch (error) { message(error.message || '撤销失败，请重试', true); revoke.disabled = false; }
        }); row.append(revoke);
      }
      list.appendChild(row);
    }
    async function load(reset = false) {
      if (loading && !reset) return;
      if (reset) { generation++; before = null; }
      const requestGeneration = generation;
      loading = true; find('inviteMore').disabled = true; find('inviteRefresh').disabled = true;
      try {
        const data = await api(undefined, before ? '?before_id=' + before : '');
        if (requestGeneration !== generation) return;
        if (reset) list.replaceChildren();
        showMode(data.registrationMode); mode.disabled = false;
        data.invites.forEach(addInvite);
        if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'admin-empty'; empty.textContent = '还没有邀请码。邀请从一位朋友开始。'; list.appendChild(empty); }
        before = data.next_before_id; find('inviteMore').hidden = !data.has_more; loaded = true;
      } catch (error) { if (requestGeneration === generation) message(error.message || '读取失败，请重试', true); }
      finally {
        if (requestGeneration === generation) { loading = false; find('inviteMore').disabled = false; find('inviteRefresh').disabled = false; }
      }
    }
    const reload = () => load(true);
    mode.addEventListener('change', async () => {
      const selected = mode.value; mode.disabled = true;
      try { const data = await write({ action: 'set_mode', mode: selected }); showMode(data.registrationMode); message(selected === 'closed' ? '新账号注册已暂停，已有账号可以继续登录。' : '新账号需要有效邀请码才能注册。'); }
      catch (error) { mode.value = savedMode; message(error.message || '设置失败，请重试', true); }
      finally { mode.disabled = false; }
    });
    find('inviteCreate').addEventListener('click', async () => {
      const button = find('inviteCreate'); button.disabled = true;
      try {
        const data = await write({ action: 'create', expires_days: Number(find('inviteExpiryDays').value) });
        find('inviteFreshCode').value = data.code; find('inviteCreated').hidden = false;
        message('邀请码已创建。请复制并保存。'); await reload();
      } catch (error) { message(error.message || '创建失败，请重试', true); }
      finally { button.disabled = false; }
    });
    find('inviteCopy').addEventListener('click', async () => {
      const input = find('inviteFreshCode');
      try { await navigator.clipboard.writeText(input.value); message('邀请码已复制。'); }
      catch (_) { input.focus(); input.select(); message('请手动复制已选中的邀请码。'); }
    });
    find('inviteDismiss').addEventListener('click', () => { find('inviteFreshCode').value = ''; find('inviteCreated').hidden = true; });
    find('inviteMore').addEventListener('click', () => load());
    find('inviteRefresh').addEventListener('click', reload);
    const onRoute = () => { if (location.hash.split('?')[0] === '#admin' && !loaded && !loading) reload(); };
    root.addEventListener('hashchange', onRoute); onRoute();
  }
  root.BlogPrivacy = { mediaUrl };
  root.initializePrivacyUI = initializePrivacyUI;
  if (typeof module !== 'undefined') module.exports = { mediaUrl };
})(typeof window !== 'undefined' ? window : globalThis);
