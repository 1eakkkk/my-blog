// === 全局状态 ===
const API_BASE = '/api';
let currentUser = null;
let userRole = 'user';
let isAppReady = false;
let currentPage = 1;
const POSTS_PER_PAGE = 10;
let isLoadingPosts = false;
let hasMorePosts = true;
let isEditingPost = false;
let editingPostId = null;
let currentPostId = null;
let currentPostAuthorId = null;
let currentLayout = 'list';

// 随机标语
const TAGLINES = [
  '1eak.cool · 简单的论坛',
  '记录生活，分享想法',
  '小而美的交流空间',
  'Keep it simple, stupid',
  '每一次发帖都是一次思考',
  '好记性不如烂笔头',
  '安静的角落',
  'Think different',
  'Less is more',
  '欢迎回来 👋'
];
document.title = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

// === 主题管理 ===
function getSavedTheme() {
  return localStorage.getItem('theme') || 'dark';
}

function applyTheme(theme) {
  document.documentElement.removeAttribute('data-theme');
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  // 'auto' — no attribute, CSS media query handles it

  localStorage.setItem('theme', theme);

  document.getElementById('themeLight').classList.toggle('active', theme === 'light');
  document.getElementById('themeDark').classList.toggle('active', theme === 'dark');
  document.getElementById('themeAuto').classList.toggle('active', theme === 'auto');
}

window.setTheme = function (theme) {
  applyTheme(theme);
};

// 初始化主题
applyTheme(getSavedTheme());

// === 工具函数 ===
window.showToast = function (msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
};

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '代码')
    .replace(/^>\s+/gm, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\|/g, ' ')
    .replace(/~{2}(.*?)~{2}/g, '$1');
}

function parseMarkdown(text) {
  if (!text) return '';
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const html = marked.parse(text, { gfm: true, breaks: true });
      return DOMPurify.sanitize(html);
    }
  } catch (e) { console.error('Markdown parse error:', e); }
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return;
    pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.onclick = async (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制 ✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
      } catch {
        btn.textContent = '失败';
        setTimeout(() => { btn.textContent = '复制'; }, 2000);
      }
    };
    pre.appendChild(btn);
  });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return new Date(ts).toLocaleDateString('zh-CN');
}

function renderUserAvatar(userObj) {
  if (userObj.avatar_url) {
    return `<img src="${userObj.avatar_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextSibling.style.display='flex';" alt=""><div style="display:none;width:100%;height:100%;">${generatePixelAvatar(userObj.username, userObj.avatar_variant || 0)}</div>`;
  }
  return generatePixelAvatar(userObj.username, userObj.avatar_variant || 0);
}

function generatePixelAvatar(username, variant = 0) {
  let hash = 0;
  const str = username + variant;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  const r = (hash & 0xFF0000) >> 16;
  const g = (hash & 0x00FF00) >> 8;
  const b = hash & 0x0000FF;
  return `<svg width="100%" height="100%" viewBox="0 0 8 8"><rect width="8" height="8" fill="rgb(${r},${g},${b})"/><rect x="1" y="1" width="2" height="2" fill="rgba(255,255,255,0.3)"/><rect x="5" y="5" width="2" height="2" fill="rgba(0,0,0,0.3)"/></svg>`;
}

// === 布局切换 ===
window.setLayout = function (type) {
  currentLayout = type;
  document.getElementById('layoutList').classList.toggle('active', type === 'list');
  document.getElementById('layoutGrid').classList.toggle('active', type === 'grid');
  document.getElementById('posts-list').className = type === 'grid' ? 'posts-grid' : 'posts-list';
};

// === 移动端导航 ===
window.toggleMobileNav = function () {
  document.getElementById('navLinks').classList.toggle('open');
};

// 点击导航链接后关闭移动菜单
document.addEventListener('click', function (e) {
  const nav = document.getElementById('navLinks');
  if (nav && nav.classList.contains('open') && e.target.closest('.nav-link')) {
    nav.classList.remove('open');
  }
});

// === 认证 ===
async function checkSecurity() {
  const mask = document.getElementById('loading-mask');
  try {
    const res = await fetch(`${API_BASE}/user`);
    if (!res.ok) throw new Error("API Error");
    const data = await res.json();

    if (!data.loggedIn) {
      window.location.replace('/login.html');
      return;
    }

    if (data.status === 'banned') {
      if (mask) {
        mask.innerHTML = `<div style="border:2px solid #ef4444;padding:30px;background:var(--surface);max-width:90%;text-align:center;border-radius:12px;"><h1 style="color:#ef4444;margin:0 0 12px;">账号已封禁</h1><p style="color:var(--text-secondary);margin:6px 0;">解封: ${new Date(data.ban_expires_at).toLocaleString()}</p><p style="color:var(--text-secondary);margin:6px 0;">理由: ${data.ban_reason || '违反规定'}</p><button onclick="doLogout()" class="btn" style="margin-top:16px;">退出登录</button></div>`;
        mask.style.opacity = '1';
        return;
      }
    }

    currentUser = data;
    userRole = data.role || 'user';
    isAppReady = true;

    // 顶部导航用户信息
    const displayName = data.nickname || data.username;
    document.getElementById('navUsername').textContent = displayName;
    document.getElementById('navAvatar').innerHTML = renderUserAvatar(data);

    // 管理员：显示公告分类和后台入口
    if (userRole === 'admin') {
      document.getElementById('navAdmin').style.display = 'flex';
      const cat = document.getElementById('postCategory');
      if (cat && !cat.querySelector('option[value="公告"]')) {
        const opt = document.createElement('option');
        opt.value = '公告'; opt.innerText = '📢 公告';
        cat.prepend(opt);
      }
    }

    handleRoute();
    if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
  } catch (e) {
    console.error(e);
    if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
  }
}

async function doLogout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  window.location.href = '/login.html';
}

// === 路由 ===
const views = {
  home: document.getElementById('view-home'),
  post: document.getElementById('view-post'),
  write: document.getElementById('view-write'),
  profile: document.getElementById('view-profile'),
  settings: document.getElementById('view-settings'),
  about: document.getElementById('view-about'),
  admin: document.getElementById('view-admin')
};

async function handleRoute() {
  const hash = window.location.hash || '#home';
  const navLinks = document.querySelectorAll('.nav-link');

  destroyTOC();
  Object.values(views).forEach(el => { if (el) el.style.display = 'none'; });
  navLinks.forEach(el => el.classList.remove('active'));

  if (hash !== '#write' && window._draftTimer) {
    clearInterval(window._draftTimer);
    window._draftTimer = null;
  }

  if (!isAppReady && hash === '#admin') return;

  if (hash !== '#write' && isEditingPost) {
    isEditingPost = false; editingPostId = null;
    const btn = document.querySelector('#postForm button[type="submit"]');
    if (btn) btn.textContent = '发布';
    document.getElementById('postTitle').value = '';
    document.getElementById('postContent').value = '';
  }

  if (hash === '#home') {
    views.home.style.display = 'block';
    document.getElementById('navHome').classList.add('active');
    const list = document.getElementById('posts-list');
    const savedScroll = sessionStorage.getItem('homeScrollY');
    if (!list || list.children.length === 0) {
      loadPosts(true);
    } else if (savedScroll) {
      requestAnimationFrame(() => { window.scrollTo({ top: parseInt(savedScroll), behavior: 'auto' }); });
    }
  } else if (hash.startsWith('#post?id=')) {
    // 保存首页滚动位置
    if (views.home && views.home.style.display === 'block') {
      sessionStorage.setItem('homeScrollY', window.scrollY);
    }
    views.post.style.display = 'block';
    currentPostId = hash.split('id=')[1].split('&')[0];
    const commentId = hash.includes('commentId=') ? hash.split('commentId=')[1] : null;
    loadSinglePost(currentPostId, commentId);
  } else if (hash === '#write') {
    views.write.style.display = 'block';
    document.getElementById('navWrite').classList.add('active');
    restoreDraft();
    // 自动保存定时器
    if (!window._draftTimer) {
      window._draftTimer = setInterval(saveDraft, 3000);
    }
  } else if (hash.startsWith('#profile?u=')) {
    views.profile.style.display = 'block';
    loadUserProfile(decodeURIComponent(hash.split('=')[1]).trim());
  } else if (hash === '#profile') {
    if (currentUser) {
      views.profile.style.display = 'block';
      loadUserProfile(currentUser.username);
    }
  } else if (hash === '#settings') {
    views.settings.style.display = 'block';
    document.getElementById('navSettings').classList.add('active');
    if (currentUser) {
      document.getElementById('settingsNickname').value = currentUser.nickname || '';
      document.getElementById('settingsBio').value = currentUser.bio || '';
    }
    loadRecoveryPhrase();
  } else if (hash === '#about') {
    views.about.style.display = 'block';
    document.getElementById('navAbout').classList.add('active');
  } else if (hash === '#admin') {
    if (userRole !== 'admin') { window.location.hash = '#home'; return; }
    views.admin.style.display = 'block';
    document.getElementById('navAdmin').classList.add('active');
    loadAdminPanel();
  }
}

function estimateReadTime(content) {
  if (!content) return '';
  const text = content.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const minutes = Math.ceil(text.length / 300);
  return minutes < 1 ? '不足1分钟' : `约 ${minutes} 分钟`;
}

// === 帖子加载 ===
async function loadPosts(reset = false) {
  const container = document.getElementById('posts-list');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const searchVal = document.getElementById('searchInput')?.value || '';
  const catFilter = document.getElementById('categoryFilter')?.value || '';
  const sortVal = document.getElementById('sortSelect')?.value || 'latest';

  if (reset) { currentPage = 1; hasMorePosts = true; container.innerHTML = ''; if (loadMoreBtn) loadMoreBtn.style.display = 'none'; }
  if (!hasMorePosts || isLoadingPosts) return;
  isLoadingPosts = true;
  if (reset) container.innerHTML = '<div class="loading-spinner"></div>';
  else if (loadMoreBtn) loadMoreBtn.textContent = '加载中...';

  try {
    const res = await fetch(`${API_BASE}/posts?page=${currentPage}&limit=${POSTS_PER_PAGE}&search=${encodeURIComponent(searchVal)}&category=${encodeURIComponent(catFilter)}&sort=${sortVal}`);
    const posts = await res.json();
    if (reset) container.innerHTML = '';
    if (posts.length < POSTS_PER_PAGE) hasMorePosts = false;

    if (posts.length === 0 && currentPage === 1) {
      const isSearching = searchVal || catFilter;
      container.innerHTML = isSearching
        ? '<div class="empty-state"><div class="empty-icon">🔍</div><p>没有找到相关内容</p></div>'
        : '<div class="empty-state"><div class="empty-icon">📝</div><p>暂无帖子，来写第一篇吧</p></div>';
    } else {
      posts.forEach(post => {
        const author = post.author_nickname || post.author_username || 'Unknown';
        const timeStr = timeAgo(post.created_at);
        const cat = post.category || '灌水';
        const commentCount = post.comment_count || 0;

        let snippet = post.content ? stripMarkdown(post.content.replace(/<[^>]*>/g, '')).replace(/\[图片\](\s*\[图片\])+/g, '[图片]').substring(0, 120) : '';

        const card = document.createElement('div');
        card.className = 'post-card';
        card.innerHTML = `
          <div class="card-header">
            <span class="category-badge${cat === '公告' ? ' announcement' : ''}">${cat}</span>
            ${post.is_pinned ? '<span style="font-size:0.75rem;color:var(--text-muted);">📌 置顶</span>' : ''}
          </div>
          <div class="card-title">${post.title}${post.mood ? `<span class="mood-tag">${post.mood}</span>` : ''}</div>
          ${snippet ? `<div class="card-snippet">${snippet}</div>` : ''}
          <div class="card-meta">
            <span>👤 ${author}</span>
            <span>${timeStr}</span>
            <span>💬 ${commentCount}</span>
            <span>❤ ${post.like_count || 0}</span>
            <span>⏱ ${estimateReadTime(post.content)}</span>
          </div>
        `;
        card.onclick = () => { sessionStorage.setItem('homeScrollY', window.scrollY); window.location.hash = `#post?id=${post.id}`; };
        container.appendChild(card);
      });
      currentPage++;
    }
  } catch (e) { console.error(e); }
  finally {
    isLoadingPosts = false;
    if (loadMoreBtn) {
      loadMoreBtn.style.display = hasMorePosts ? 'block' : 'none';
      loadMoreBtn.textContent = '加载更多';
    }
  }
}

window.searchPosts = function () { loadPosts(true); };

// === 单帖加载 ===
async function loadSinglePost(id, targetCommentId = null) {
  const container = document.getElementById('single-post-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"></div>';
  document.getElementById('commentsList').innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/posts?id=${id}`);
    const post = await res.json();
    if (!post || post.error) { container.innerHTML = '<p>帖子不存在</p>'; return; }
    currentPostAuthorId = post.user_id;

    const author = post.author_nickname || post.author_username || 'Unknown';
    const createdStr = new Date(post.created_at).toLocaleString();
    const updatedStr = post.updated_at ? new Date(post.updated_at).toLocaleString() : '';
    const timeHtml = post.updated_at
      ? `发布于 ${createdStr} · <span style="color:var(--text-muted);">编辑于 ${updatedStr}</span>`
      : createdStr;
    const cat = post.category || '灌水';
    const parsedContent = parseMarkdown(post.content || '');

    let actionsHtml = '';
    if (currentUser && (currentUser.id === post.user_id || userRole === 'admin')) {
      actionsHtml = `<button class="btn btn-sm" onclick="editPostMode(${post.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deletePost(${post.id})">删除</button>`;
    }
    if (userRole === 'admin') {
      actionsHtml += `<button class="btn btn-sm" onclick="pinPost(${post.id})">${post.is_pinned ? '取消置顶' : '置顶'}</button>`;
    }

    container.innerHTML = `
      <div class="article-header">
        <span class="category-badge${cat === '公告' ? ' announcement' : ''}" style="margin-bottom:10px;display:inline-block;">${cat}</span>
        <h1 class="article-title">${post.title}${post.mood ? `<span class="mood-tag">${post.mood}</span>` : ''}</h1>
        <div class="article-meta">
          <span>👤 ${author}</span>
          <span>${timeHtml}</span>
          <span>💬 ${post.comment_count || 0} 评论</span>
        </div>
      </div>
      <div class="article-content">${parsedContent}</div>
      <div class="article-actions">
        <button class="btn btn-sm like-btn ${post.is_liked ? 'liked' : ''}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count || 0}</span></button>
        ${actionsHtml}
      </div>
    `;

    bindImageClicks(container);
    addCopyButtons(container);
    loadComments(id, true, targetCommentId);
    generateTOC(container.querySelector('.article-content'));
  } catch (e) { container.innerHTML = '<p>加载失败</p>'; }
}

// === 评论 ===
let currentCommentPage = 1;
let hasMoreComments = true;

async function loadComments(postId, reset = false, highlightId = null) {
  const container = document.getElementById('commentsList');
  if (reset) {
    currentCommentPage = 1;
    hasMoreComments = true;
    container.innerHTML = '';
    const btn = document.getElementById('loadMoreComments');
    if (btn) btn.style.display = 'none';
  }
  if (!hasMoreComments) return;

  try {
    const res = await fetch(`${API_BASE}/comments?post_id=${postId}&page=${currentCommentPage}`);
    const data = await res.json();
    const comments = data.results || [];
    if (comments.length < 20) hasMoreComments = false;

    if (comments.length === 0 && currentCommentPage === 1) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:24px;">还没有评论</p>';
      return;
    }

    let floorOffset = (currentCommentPage - 1) * 20;
    let rootCount = 0;

    // 分组：根评论列表 + 子评论 Map
    const roots = comments.filter(c => !c.parent_id);
    const childrenMap = {};
    comments.filter(c => !!c.parent_id).forEach(c => {
      if (!childrenMap[c.parent_id]) childrenMap[c.parent_id] = [];
      childrenMap[c.parent_id].push(c);
    });

    // 按根评论顺序渲染，子评论紧跟其父
    roots.forEach(root => {
      const floorNum = floorOffset + rootCount++;
      const rootEl = createCommentElement(root, false, currentPostAuthorId, floorNum);
      container.appendChild(rootEl);
      bindImageClicks(rootEl);
      addCopyButtons(rootEl);

      const children = childrenMap[root.id] || [];
      children.forEach(child => {
        const childEl = createCommentElement(child, false, currentPostAuthorId, -1);
        container.appendChild(childEl);
        bindImageClicks(childEl);
        addCopyButtons(childEl);
      });
    });
    currentCommentPage++;

    const loadMoreBtn = document.getElementById('loadMoreComments');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = hasMoreComments ? 'block' : 'none';
      loadMoreBtn.querySelector('button').textContent = '加载更多评论';
    }

    if (highlightId) {
      setTimeout(() => {
        const target = document.getElementById(`comment-${highlightId}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  } catch (e) {
    console.error(e);
    const loadMoreBtn = document.getElementById('loadMoreComments');
    if (loadMoreBtn && loadMoreBtn.style.display !== 'none') {
      loadMoreBtn.querySelector('button').textContent = '加载失败，点击重试';
    }
  }
}

function createCommentElement(c, isReply, postAuthorId, floorNumber) {
  const div = document.createElement('div');
  const isChild = !!c.parent_id;
  div.className = `comment-card${c.is_pinned ? ' pinned' : ''}${isChild ? ' is-reply' : ''}`;
  div.id = `comment-${c.id}`;

  const author = c.nickname || c.username || 'Unknown';
  const timeStr = timeAgo(c.created_at);
  const parsedContent = parseMarkdown(c.content || '');
  const pinnedBadge = c.is_pinned ? ' 📌' : '';
  const authorTag = postAuthorId && c.user_id === postAuthorId ? ' <span style="font-size:0.7rem;color:var(--accent);">作者</span>' : '';
  const floorBadge = !isChild ? `<span class="comment-floor">#${floorNumber + 1}</span>` : '';
  const replyTag = c.reply_to_nickname
    ? `<span class="reply-tag">↩ @${c.reply_to_nickname || c.reply_to_username}</span>`
    : '';

  let adminActions = '';
  if (currentUser && (currentUser.id === c.user_id || userRole === 'admin')) {
    adminActions += `<span onclick="deleteComment(${c.id})" style="cursor:pointer;color:var(--danger);">删除</span>`;
  }
  if (postAuthorId && currentUser && currentUser.id === postAuthorId) {
    adminActions += `<span onclick="pinComment(${c.id})" style="cursor:pointer;color:var(--text-muted);margin-left:8px;">${c.is_pinned ? '取消置顶' : '置顶'}</span>`;
  }

  div.innerHTML = `
    <div class="comment-header">
      ${floorBadge}
      <span class="comment-author">${author}${authorTag}</span>
      <span class="comment-time">${timeStr}${pinnedBadge}</span>
      ${replyTag}
    </div>
    <div class="comment-body">${parsedContent}</div>
    <div class="comment-footer">
      <button class="btn btn-sm like-btn ${c.is_liked ? 'liked' : ''}" onclick="toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count || 0}</span></button>
      <button class="btn btn-sm btn-ghost" onclick="prepareReply(${c.id}, '${author}')">回复</button>
      ${adminActions}
    </div>
  `;
  return div;
}

window.prepareReply = function (commentId, authorName) {
  const input = document.getElementById('commentInput');
  input.dataset.parentId = commentId;
  input.placeholder = '写评论... (Markdown 和图片)';
  input.focus();
  const bar = document.getElementById('replyingToBar');
  const text = document.getElementById('replyingToText');
  if (bar && text) {
    text.textContent = `↩ 正在回复 @${authorName}`;
    bar.style.display = 'flex';
  }
  const cancelBtn = document.getElementById('cancelReplyBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
};

window.cancelReply = function () {
  const input = document.getElementById('commentInput');
  input.dataset.parentId = '';
  input.placeholder = '写评论... (Markdown 和图片)';
  const bar = document.getElementById('replyingToBar');
  if (bar) bar.style.display = 'none';
  const cancelBtn = document.getElementById('cancelReplyBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
};

const commentInput = document.getElementById('commentInput');
const charCount = document.getElementById('commentCharCount');
if (commentInput && charCount) {
  commentInput.addEventListener('input', () => {
    const len = commentInput.value.length;
    charCount.textContent = `${len} / 500`;
    charCount.style.color = len > 450 ? (len >= 500 ? 'var(--danger)' : 'var(--accent)') : 'var(--text-muted)';
  });
}

window.submitComment = async function () {
  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content) return showToast('内容不能为空', 'error');
  if (content.length > 500) return showToast('评论最多500字', 'error');
  const parentId = input.dataset.parentId || null;

  try {
    const res = await fetch(`${API_BASE}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: parseInt(currentPostId), content, parent_id: parentId ? parseInt(parentId) : null })
    });
    const data = await res.json();
    if (data.success) {
      showToast('评论成功', 'success');
      input.value = '';
      cancelReply();
      loadComments(currentPostId, true);
    } else {
      showToast(data.error || '评论失败', 'error');
    }
  } catch (e) { showToast('网络错误', 'error'); }
};

window.deleteComment = async function (id) {
  if (!confirm('确认删除?')) return;
  await fetch(`${API_BASE}/comments?id=${id}`, { method: 'DELETE' });
  loadComments(currentPostId, true);
};

window.pinComment = async function (id) {
  await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pin', id }) });
  loadComments(currentPostId, true);
};

// === 点赞 ===
window.toggleLike = async function (id, type, btn) {
  try {
    const res = await fetch(`${API_BASE}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: id, target_type: type })
    });
    const data = await res.json();
    if (data.success) {
      const countEl = btn.querySelector('.count');
      if (countEl) countEl.textContent = data.like_count;
      btn.classList.toggle('liked', data.action === 'liked');
    }
  } catch (e) { }
};

// === 帖子操作 ===
window.editPostMode = async function (id) {
  try {
    const res = await fetch(`${API_BASE}/posts?id=${id}`);
    const post = await res.json();
    isEditingPost = true; editingPostId = id;
    document.getElementById('postTitle').value = post.title || '';
    document.getElementById('postContent').value = post.content || '';
    document.getElementById('postCategory').value = post.category || '灌水';
    document.querySelector('#postForm button[type="submit"]').textContent = '保存修改';
    document.getElementById('cancelEditPostBtn').textContent = '取消编辑';
    window.location.hash = '#write';
  } catch (e) { showToast('加载失败', 'error'); }
};

window.cancelEditPost = function () {
  isEditingPost = false; editingPostId = null;
  document.getElementById('postTitle').value = '';
  document.getElementById('postContent').value = '';
  document.getElementById('postCategory').value = '灌水';
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.mood-btn[data-mood=""]')?.classList.add('active');
  document.querySelector('#postForm button[type="submit"]').textContent = '发布';
  clearDraft();
  window.location.hash = '#home';
};

const DRAFT_KEY = 'postDraft';

function saveDraft() {
  if (isEditingPost) return;
  const title = document.getElementById('postTitle').value;
  const content = document.getElementById('postContent').value;
  const category = document.getElementById('postCategory').value;
  if (!title && !content) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, category }));
  const status = document.getElementById('draftStatus');
  if (status) status.textContent = '草稿已保存';
  setTimeout(() => { if (status) status.textContent = ''; }, 2000);
}

function restoreDraft() {
  if (isEditingPost) return;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft.title && !draft.content) return;
    document.getElementById('postTitle').value = draft.title || '';
    document.getElementById('postContent').value = draft.content || '';
    if (draft.category) document.getElementById('postCategory').value = draft.category;
    const status = document.getElementById('draftStatus');
    if (status) status.textContent = '已恢复草稿';
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  } catch (e) {}
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const status = document.getElementById('draftStatus');
  if (status) status.textContent = '';
}

window.submitPost = async function (e) {
  e.preventDefault();
  const title = document.getElementById('postTitle').value.trim();
  const content = document.getElementById('postContent').value.trim();
  const category = document.getElementById('postCategory').value;
  const mood = document.querySelector('.mood-btn.active')?.dataset.mood || '';
  if (!title && !content) return showToast('标题和内容不能同时为空', 'error');

  try {
    let res;
    if (isEditingPost && editingPostId) {
      res = await fetch(`${API_BASE}/posts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingPostId, action: 'edit', title, content, category, mood })
      });
    } else {
      res = await fetch(`${API_BASE}/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category, mood })
      });
    }
    const data = await res.json();
    if (data.success) {
      showToast(data.message || '成功', 'success');
      clearDraft();
      cancelEditPost();
      loadPosts(true);
    } else { showToast(data.error || '失败', 'error'); }
  } catch (e) { showToast('网络错误', 'error'); }
};

window.deletePost = async function (id) {
  if (!confirm('确定删除? 不可恢复。')) return;
  try {
    const res = await fetch(`${API_BASE}/posts?id=${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('已删除', 'success'); window.location.hash = '#home'; loadPosts(true); }
    else showToast('删除失败', 'error');
  } catch (e) { showToast('网络错误', 'error'); }
};

window.pinPost = async function (id) {
  const res = await fetch(`${API_BASE}/posts`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'pin' })
  });
  const data = await res.json();
  if (data.success) { showToast(data.message, 'success'); loadSinglePost(currentPostId); }
  else showToast(data.error, 'error');
};

// === 图片上传 ===
window.uploadImage = async function () {
  const file = document.getElementById('imageUploadInput').files[0];
  if (!file) return;
  const status = document.getElementById('uploadStatus');
  status.textContent = '上传中...';
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById('postContent').value += '\n' + data.mdInsert + '\n';
      status.textContent = '✓';
    } else {
      status.textContent = '失败';
      showToast(data.error || '上传失败', 'error');
    }
  } catch (e) { status.textContent = '失败'; }
};

window.uploadCommentImage = async function () {
  const file = document.getElementById('commentImgUpload').files[0];
  if (!file) return;
  const status = document.getElementById('commentUploadStatus');
  status.textContent = '上传中...';
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById('commentInput').value += '\n' + data.mdInsert + '\n';
      status.textContent = '✓';
    } else { status.textContent = '失败'; }
  } catch (e) { status.textContent = '失败'; }
};

// === 个人主页 ===
async function loadUserProfile(param) {
  document.getElementById('profileName').textContent = '加载中...';
  try {
    const isId = /^\d+$/.test(param);
    const res = await fetch(`${API_BASE}/user-public?${isId ? 'id' : 'username'}=${encodeURIComponent(param)}`);
    const data = await res.json();
    if (data.error) { document.getElementById('profileName').textContent = data.error; return; }

    document.getElementById('profileName').textContent = data.nickname || data.username;
    document.getElementById('profileBio').textContent = data.bio || '暂无签名';
    document.getElementById('statPosts').textContent = data.post_count || 0;

    const avatarEl = document.getElementById('profileAvatar');
    avatarEl.innerHTML = renderUserAvatar(data);

    const postsRes = await fetch(`${API_BASE}/posts?sort=latest&limit=50`);
    const allPosts = await postsRes.json();
    const userPosts = Array.isArray(allPosts) ? allPosts.filter(p => p.user_id === data.id) : [];
    const profilePosts = document.getElementById('profilePosts');
    if (userPosts.length === 0) {
      profilePosts.innerHTML = '<div class="empty-state"><p>暂无帖子</p></div>';
    } else {
      profilePosts.innerHTML = `<h3 style="margin-bottom:14px;font-weight:650;">TA 的帖子</h3>` +
        userPosts.map(p => `
          <div class="post-card" onclick="window.location.hash='#post?id=${p.id}'" style="margin-bottom:8px;">
            <div class="card-header"><span class="category-badge">${p.category || '灌水'}</span></div>
            <div class="card-title">${p.title}</div>
            <div class="card-meta" style="margin-top:6px;">${timeAgo(p.created_at)} · 💬 ${p.comment_count || 0} · ❤ ${p.like_count || 0}</div>
          </div>
        `).join('');
    }
  } catch (e) { console.error(e); }
}

// === 恢复短语 ===
async function loadRecoveryPhrase() {
  try {
    const res = await fetch(`${API_BASE}/profile`);
    const data = await res.json();
    const el = document.getElementById('settingsRecoveryPhrase');
    if (el && data.recoveryPhrase) el.textContent = data.recoveryPhrase;
  } catch (e) { }
}

window.copyRecoveryPhrase = function () {
  const el = document.getElementById('settingsRecoveryPhrase');
  if (el && el.textContent) {
    navigator.clipboard.writeText(el.textContent).then(() => showToast('已复制', 'success'));
  }
};

window.regenerateRecoveryPhrase = async function () {
  if (!confirm('重新生成后旧恢复短语将失效，确定继续？')) return;
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate_recovery: true })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('settingsRecoveryPhrase').textContent = data.recoveryPhrase;
      showToast('恢复短语已更新，请保存！', 'success');
    } else {
      showToast(data.error, 'error');
    }
  } catch (e) { showToast('网络错误', 'error'); }
};

// === 设置 ===
window.updateNickname = async function () {
  const nickname = document.getElementById('settingsNickname').value.trim();
  if (!nickname) return showToast('昵称不能为空', 'error');
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    });
    const data = await res.json();
    if (data.success) {
      showToast('昵称已更新', 'success');
      currentUser.nickname = nickname;
      document.getElementById('navUsername').textContent = nickname;
    } else showToast(data.error, 'error');
  } catch (e) { showToast('网络错误', 'error'); }
};

window.updateBio = async function () {
  const bio = document.getElementById('settingsBio').value.trim();
  try {
    const res = await fetch(`${API_BASE}/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio })
    });
    const data = await res.json();
    if (data.success) showToast('签名已更新', 'success');
    else showToast(data.error, 'error');
  } catch (e) { showToast('网络错误', 'error'); }
};

// === 头像上传 ===
window.uploadUserAvatar = async function () {
  const file = document.getElementById('avatarUploadInput').files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return showToast('头像不能超过 5MB', 'error');
  showToast('上传中...', 'success');
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      await fetch(`${API_BASE}/profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: data.url })
      });
      showToast('头像已更新', 'success');
      currentUser.avatar_url = data.url;
      // 刷新各处头像显示
      document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${data.url}" style="width:100%;height:100%;object-fit:cover;">`;
      document.getElementById('navAvatar').innerHTML = renderUserAvatar(currentUser);
    } else {
      showToast(data.error || '上传失败', 'error');
    }
  } catch (e) { showToast('网络错误', 'error'); }
};

// === MD 预览切换 ===
function switchMdTab(tab) {
  const textarea = document.getElementById('postContent');
  const preview = document.getElementById('mdPreview');
  const btnEdit = document.getElementById('mdTabEdit');
  const btnPreview = document.getElementById('mdTabPreview');
  if (!textarea || !preview) return;

  if (tab === 'preview') {
    try {
      const html = parseMarkdown(textarea.value || '');
      preview.innerHTML = html || '<p style="color:var(--text-muted);">（空内容）</p>';
    } catch (e) {
      preview.innerHTML = '<p style="color:var(--danger);">预览失败，请检查 Markdown 语法</p>';
    }
    textarea.style.display = 'none';
    preview.style.display = 'block';
    if (btnEdit) { btnEdit.style.background = 'transparent'; btnEdit.style.color = 'var(--text-muted)'; }
    if (btnPreview) { btnPreview.style.background = 'var(--accent)'; btnPreview.style.color = '#fff'; }
  } else {
    textarea.style.display = 'block';
    preview.style.display = 'none';
    if (btnEdit) { btnEdit.style.background = 'var(--accent)'; btnEdit.style.color = '#fff'; }
    if (btnPreview) { btnPreview.style.background = 'transparent'; btnPreview.style.color = 'var(--text-muted)'; }
  }
}

// === 图片灯箱（缩放+拖拽） ===
let lightboxScale = 1;
let lightboxX = 0, lightboxY = 0;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let startX = 0, startY = 0;

window.openLightbox = function (src) {
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = src;
  lightboxScale = 1; lightboxX = 0; lightboxY = 0;
  img.style.transform = 'scale(1) translate(0, 0)';
  img.style.cursor = 'grab';
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const closeBtn = document.getElementById('lightboxCloseBtn');
  if (!closeBtn) {
    const btn = document.createElement('button');
    btn.id = 'lightboxCloseBtn';
    btn.className = 'lightbox-close';
    btn.textContent = '✕';
    btn.onclick = closeLightbox;
    document.body.appendChild(btn);
  }
};

window.closeLightbox = function () {
  document.getElementById('lightbox').style.display = 'none';
  document.body.style.overflow = '';
  const btn = document.getElementById('lightboxCloseBtn');
  if (btn) btn.remove();
};

document.addEventListener('DOMContentLoaded', () => {
  const lbImg = document.getElementById('lightboxImg');
  if (!lbImg) return;

  lbImg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    lightboxScale = Math.max(0.5, Math.min(3, lightboxScale + delta));
    updateLightboxTransform();
  });

  let touchDist0 = 0;
  lbImg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      touchDist0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1 && lightboxScale > 1) {
      isDragging = true;
      dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
      startX = lightboxX; startY = lightboxY;
    }
  });

  lbImg.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (touchDist0 > 0) {
        lightboxScale = Math.max(0.5, Math.min(3, lightboxScale * (dist / touchDist0)));
        touchDist0 = dist;
        updateLightboxTransform();
      }
    } else if (isDragging && e.touches.length === 1) {
      lightboxX = startX + (e.touches[0].clientX - dragStartX);
      lightboxY = startY + (e.touches[0].clientY - dragStartY);
      updateLightboxTransform();
    }
  });

  lbImg.addEventListener('touchend', () => { isDragging = false; });

  lbImg.addEventListener('mousedown', (e) => {
    if (lightboxScale > 1) {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      startX = lightboxX; startY = lightboxY;
      lbImg.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      lightboxX = startX + (e.clientX - dragStartX);
      lightboxY = startY + (e.clientY - dragStartY);
      updateLightboxTransform();
    }
  });

  window.addEventListener('mouseup', () => { isDragging = false; lbImg.style.cursor = lightboxScale > 1 ? 'grab' : 'default'; });
});

function updateLightboxTransform() {
  const img = document.getElementById('lightboxImg');
  img.style.transform = `scale(${lightboxScale}) translate(${lightboxX / lightboxScale}px, ${lightboxY / lightboxScale}px)`;
}

// 给帖子/评论中的图片绑定点击
function bindImageClicks(container) {
  container.querySelectorAll('img').forEach(img => {
    if (!img.dataset.lightboxBound) {
      img.dataset.lightboxBound = '1';
      img.loading = 'lazy';
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', e => { e.stopPropagation(); openLightbox(img.src); });
    }
  });
}

// === 管理员 ===
async function loadAdminPanel() {
  try {
    const res = await fetch(`${API_BASE}/admin?action=stats`);
    const data = await res.json();
    if (!data.stats) return showToast('加载失败', 'error');

    document.getElementById('adminOnline').textContent = data.stats.online5min;
    document.getElementById('adminToday').textContent = data.stats.todayActive;
    document.getElementById('adminUsers').textContent = data.stats.totalUsers;
    document.getElementById('adminPosts').textContent = data.stats.totalPosts;
    document.getElementById('adminComments').textContent = data.stats.totalComments;

    const statusEl = document.getElementById('adminTurnstileStatus');
    if (data.stats.turnstileEnabled) {
      statusEl.textContent = '已开启'; statusEl.style.color = 'var(--green)';
    } else {
      statusEl.textContent = '已关闭'; statusEl.style.color = 'var(--danger)';
    }
  } catch (e) { console.error(e); }
}

window.showAdminDetail = async function (type) {
  const modal = document.getElementById('adminDetailModal');
  const title = document.getElementById('adminDetailTitle');
  const content = document.getElementById('adminDetailContent');

  const labels = { online: '在线用户', users: '最近注册用户', posts: '最近帖子' };
  title.textContent = labels[type] || '详情';
  content.innerHTML = '<div class="loading-spinner"></div>';
  modal.style.display = 'flex';

  try {
    const actions = { online: 'online_list', users: 'user_list', posts: 'post_list' };
    const res = await fetch(`${API_BASE}/admin?action=${actions[type]}`);
    const data = await res.json();

    if (type === 'online') {
      const list = data.users || [];
      content.innerHTML = list.length === 0 ? '<p style="color:var(--text-muted);">暂无在线用户</p>' :
        list.map(u => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);"><span style="cursor:pointer;color:var(--accent);" onclick="window.location.hash='#profile?u=${u.id}'">${u.nickname || u.username}</span><span style="color:var(--text-muted);font-size:0.8rem;">${new Date(u.last_seen).toLocaleTimeString()}</span></div>`).join('');
    } else if (type === 'users') {
      content.innerHTML = (data.users || []).map(u => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);"><span style="cursor:pointer;color:var(--accent);" onclick="window.location.hash='#profile?u=${u.id}'">${u.nickname || u.username}</span><span style="color:var(--text-muted);font-size:0.78rem;">${new Date(u.created_at).toLocaleDateString()}</span></div>`).join('');
    } else if (type === 'posts') {
      content.innerHTML = (data.posts || []).map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--border);"><a href="#post?id=${p.id}" onclick="document.getElementById('adminDetailModal').style.display='none'" style="font-weight:500;">${p.title}</a><div style="font-size:0.78rem;color:var(--text-muted);">${p.author_name} · ${new Date(p.created_at).toLocaleDateString()} · ${p.category}</div></div>`).join('');
    }
  } catch (e) { content.innerHTML = '<p style="color:var(--danger);">加载失败</p>'; }
};

window.toggleTurnstile = async function () {
  if (!confirm('确定要切换人机验证开关吗？')) return;
  const res = await fetch(`${API_BASE}/admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'toggle_turnstile' })
  });
  const data = await res.json();
  if (data.success) {
    showToast(`人机验证已${data.turnstileEnabled ? '开启' : '关闭'}`, 'success');
    loadAdminPanel();
  }
};

window.postAnnounce = async function () {
  const title = document.getElementById('adminAnnounceTitle').value.trim();
  const content = document.getElementById('adminAnnounceContent').value.trim();
  if (!title) return showToast('请输入标题', 'error');
  const res = await fetch(`${API_BASE}/admin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'post_announce', title, content })
  });
  const data = await res.json();
  if (data.success) {
    showToast('公告已发布', 'success');
    document.getElementById('adminAnnounceTitle').value = '';
    document.getElementById('adminAnnounceContent').value = '';
  } else showToast(data.error, 'error');
};

// === 初始化 ===
function initApp() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // 确保 marked GFM 扩展启用
  if (typeof marked !== 'undefined' && marked.setOptions) {
    marked.setOptions({ gfm: true, breaks: true });
  }

  document.addEventListener('click', function (e) {
    const nav = document.getElementById('navLinks');
    const btn = document.getElementById('mobileMenuBtn');
    if (nav && nav.classList.contains('open') && !nav.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      nav.classList.remove('open');
    }
  });

  // MD 预览按钮事件绑定（确保可靠触发）
  const mdEditBtn = document.getElementById('mdTabEdit');
  const mdPreviewBtn = document.getElementById('mdTabPreview');
  if (mdEditBtn) mdEditBtn.addEventListener('click', function (e) { e.preventDefault(); switchMdTab('edit'); });
  if (mdPreviewBtn) mdPreviewBtn.addEventListener('click', function (e) { e.preventDefault(); switchMdTab('preview'); });

  // 布局切换按钮事件绑定
  const layoutListBtn = document.getElementById('layoutList');
  const layoutGridBtn = document.getElementById('layoutGrid');
  if (layoutListBtn) layoutListBtn.addEventListener('click', function () { setLayout('list'); });
  if (layoutGridBtn) layoutGridBtn.addEventListener('click', function () { setLayout('grid'); });

  document.getElementById('moodSelector')?.addEventListener('click', e => {
    const btn = e.target.closest('.mood-btn');
    if (!btn) return;
    document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  window.addEventListener('hashchange', handleRoute);

  // 心跳上报，每 2 分钟更新在线状态
  setInterval(() => { fetch(`${API_BASE}/heartbeat`, { method: 'POST' }).catch(() => {}); }, 120000);

  checkSecurity();
}

// === TOC 目录 ===

let tocObserver = null;

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w一-龥\s-]/g, '')
    .replace(/\s+/g, '-');
}

function generateTOC(contentEl) {
  if (!contentEl) return;
  const headings = contentEl.querySelectorAll('h2, h3, h4');
  const filtered = [];
  for (const h of headings) {
    if (h.closest('pre, code')) continue;
    const text = h.textContent.trim();
    if (!text) continue;
    filtered.push(h);
  }
  const h2Count = filtered.filter(h => h.tagName === 'H2').length;
  if (h2Count < 1 || filtered.length < 2) return;

  const used = {};
  const items = [];
  for (const h of filtered) {
    let id = slugify(h.textContent.trim());
    if (used[id]) {
      let n = 2;
      while (used[id + '-' + n]) n++;
      id = id + '-' + n;
    }
    used[id] = true;
    h.id = id;
    items.push({ id, text: h.textContent.trim(), level: parseInt(h.tagName[1]) });
  }

  ensureTOCLayout(contentEl);
  renderTOCSidebar(items);
  renderTOCMobile(items, contentEl);

  const headingEls = items.map(item => document.getElementById(item.id));
  initTOCObserver(headingEls);
}

function ensureTOCLayout(contentEl) {
  if (contentEl.parentNode && contentEl.parentNode.classList.contains('post-layout')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'post-layout';
  contentEl.parentNode.insertBefore(wrapper, contentEl);
  wrapper.appendChild(contentEl);
  const sidebar = document.createElement('aside');
  sidebar.id = 'toc-sidebar';
  wrapper.appendChild(sidebar);
}

function renderTOCSidebar(items) {
  const sidebar = document.getElementById('toc-sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '<h3>目录</h3><ul>' + items.map(item =>
    `<li><a href="#${item.id}" class="toc-link toc-h${item.level}">${item.text}</a></li>`
  ).join('') + '</ul>';

  sidebar.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const id = this.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      const offset = (document.querySelector('.topnav')?.offsetHeight ?? 90) + 12;
      try {
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
      } catch (_) {
        location.hash = '#' + id;
      }
    });
  });
}

function renderTOCMobile(items, contentEl) {
  const existing = document.getElementById('toc-mobile');
  if (existing) existing.remove();

  const tocMobile = document.createElement('div');
  tocMobile.id = 'toc-mobile';
  if (localStorage.getItem('tocExpanded') === 'true') {
    tocMobile.classList.add('expanded');
  }
  tocMobile.innerHTML =
    `<button id="toc-mobile-toggle">目录 <i class="toc-arrow">▼</i></button>
    <div id="toc-mobile-body">
      <ul>${items.map(item =>
        `<li><a href="#${item.id}" class="toc-link toc-h${item.level}">${item.text}</a></li>`
      ).join('')}</ul>
    </div>`;

  const wrapper = contentEl.parentNode; // .post-layout
  wrapper.parentNode.insertBefore(tocMobile, wrapper);

  tocMobile.querySelector('#toc-mobile-toggle').addEventListener('click', function() {
    tocMobile.classList.toggle('expanded');
    localStorage.setItem('tocExpanded', tocMobile.classList.contains('expanded'));
  });

  tocMobile.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const id = this.getAttribute('href').slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      const offset = (document.querySelector('.topnav')?.offsetHeight ?? 90) + 12;
      try {
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
      } catch (_) {
        location.hash = '#' + id;
      }
    });
  });
}

function initTOCObserver(headings) {
  if (tocObserver) tocObserver.disconnect();

  const visibleSet = new Set();

  tocObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        visibleSet.add(entry.target.id);
      } else {
        visibleSet.delete(entry.target.id);
      }
    }
    const activeId = headings.find(h => visibleSet.has(h.id))?.id;
    document.querySelectorAll('.toc-link').forEach(link => link.classList.remove('active'));
    if (activeId) {
      const activeLink = document.querySelector(`.toc-link[href="#${activeId}"]`);
      if (activeLink) {
        activeLink.classList.add('active');
        activeLink.scrollIntoView({ block: 'nearest' });
      }
    }
  }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });

  headings.forEach(h => tocObserver.observe(h));
}

function destroyTOC() {
  if (tocObserver) {
    tocObserver.disconnect();
    tocObserver = null;
  }
  document.getElementById('toc-sidebar')?.remove();
  document.getElementById('toc-mobile')?.remove();
  const postLayout = document.querySelector('.post-layout');
  if (postLayout) {
    // 把正文移回原位再删 wrapper，防止时序问题
    const contentEl = postLayout.querySelector('.article-content');
    if (contentEl) postLayout.parentNode.insertBefore(contentEl, postLayout);
    postLayout.remove();
  }
}

document.addEventListener('DOMContentLoaded', initApp);
