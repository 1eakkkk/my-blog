// --- START OF FILE script.js ---

const API_BASE = '/api';
let userRole = 'user';
let currentUser = null;
let currentPostId = null;

let returnToNotifications = false;

let currentPage = 1;
const POSTS_PER_PAGE = 10;
let isLoadingPosts = false;
let hasMorePosts = true;

let isEditingPost = false;
let editingPostId = null;
let isEditingComment = false;
let editingCommentId = null;

const LEVEL_TABLE = [
    { lv: 1,  xp: 0,     title: '潜行者' },
    { lv: 2,  xp: 300,   title: '漫游者' },
    { lv: 3,  xp: 1200,  title: '观察者' },
    { lv: 4,  xp: 2000,  title: '骇客' },
    { lv: 5,  xp: 5000,  title: '执政官' },
    { lv: 6,  xp: 10000, title: '领主' },
    { lv: 7,  xp: 20000, title: '宗师' },
    { lv: 8,  xp: 35000, title: '传奇' },
    { lv: 9,  xp: 50000, title: '半神' },
    { lv: 10, xp: 60000, title: '赛博神' }
];

function calculateLevel(xp) {
    if (xp >= 60000) return { lv: 10, percent: 100, next: 'MAX', title: '赛博神' };
    let currentLv = 1; let currentTitle = '潜行者'; let nextXp = 300; let prevXp = 0;
    for (let i = 0; i < LEVEL_TABLE.length; i++) {
        if (xp >= LEVEL_TABLE[i].xp) {
            currentLv = LEVEL_TABLE[i].lv; currentTitle = LEVEL_TABLE[i].title; prevXp = LEVEL_TABLE[i].xp;
            if (i < LEVEL_TABLE.length - 1) nextXp = LEVEL_TABLE[i+1].xp;
        }
    }
    let percent = ((xp - prevXp) / (nextXp - prevXp)) * 100;
    return { lv: currentLv, percent: Math.min(100, Math.max(0, percent)), next: nextXp, title: currentTitle };
}

document.addEventListener('DOMContentLoaded', async () => {
    initApp();
    await checkSecurity();
});

// --- 工具函数 ---
function generatePixelAvatar(username, variant = 0) {
    const seedStr = username + "v" + variant;
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) { hash = seedStr.charCodeAt(i) + ((hash << 5) - hash); }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase().padStart(6, "0");
    const color = `#${c}`;
    let rects = '';
    for(let i=0; i<5; i++) { for(let j=0; j<5; j++) {
            const val = (hash >> (i * 5 + j)) & 1; 
            if(val) rects += `<rect x="${j*10}" y="${i*10}" width="10" height="10" fill="${color}" />`;
    }}
    return `<svg width="100%" height="100%" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" class="pixel-avatar" style="background:#111;">${rects}</svg>`;
}

function getBadgesHtml(userObj) {
    let html = '';
    if (userObj.role === 'admin' || userObj.author_role === 'admin') html += `<span class="badge admin-tag">ADMIN</span>`;
    const title = userObj.author_title || userObj.custom_title;
    const color = userObj.author_title_color || userObj.custom_title_color || '#fff';
    if (title) html += `<span class="badge custom-tag" style="color:${color};border-color:${color}">${title}</span>`;
    const xp = userObj.xp !== undefined ? userObj.xp : (userObj.author_xp || 0);
    const lvInfo = calculateLevel(xp);
    const pref = userObj.badge_preference || 'number';
    if (pref === 'title') html += `<span class="badge lv-${lvInfo.lv}">${lvInfo.title}</span>`;
    else html += `<span class="badge lv-${lvInfo.lv}">LV.${lvInfo.lv}</span>`;
    if (userObj.is_vip || userObj.author_vip) html += `<span class="badge vip-tag">VIP</span>`;
    return html;
}

function renderLevelTable() {
    const tbody = document.getElementById('levelTableBody');
    if(!tbody) return;
    tbody.innerHTML = LEVEL_TABLE.map(item => `<tr><td><span class="badge lv-${item.lv}">LV.${item.lv}</span></td><td><span class="badge lv-${item.lv}">${item.title}</span></td><td>${item.xp}</td></tr>`).join('');
}

// --- 鉴权 ---
async function checkSecurity() {
    const mask = document.getElementById('loading-mask');
    try {
        const res = await fetch(`${API_BASE}/user`);
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        if (userRole === 'admin') document.getElementById('navAdmin').style.display = 'flex';
        
        if (!data.loggedIn) {
            window.location.replace('/login.html');
        } else {
            currentUser = data;
            userRole = data.role || 'user';
            
            document.getElementById('username').textContent = data.nickname || data.username;
            document.getElementById('coinCount').textContent = data.coins;
            document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${generatePixelAvatar(data.username, data.avatar_variant)}</div>`;
            const settingPreview = document.getElementById('settingAvatarPreview');
            if(settingPreview) settingPreview.innerHTML = generatePixelAvatar(data.username, data.avatar_variant);
            const keyDisplay = document.getElementById('recoveryKeyDisplay');
            if(keyDisplay) keyDisplay.value = data.recovery_key || "未生成";
            const badgePrefSelect = document.getElementById('badgePreferenceSelect');
            if(badgePrefSelect) badgePrefSelect.value = data.badge_preference || 'number';
            document.getElementById('badgesArea').innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
            const levelInfo = calculateLevel(data.xp || 0);
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
            document.getElementById('logoutBtn').onclick = doLogout;

            if (userRole === 'admin') document.getElementById('navAdmin').style.display = 'flex';
            else document.getElementById('navAdmin').style.display = 'none';

            if(data.is_vip) {
                const vipBox = document.getElementById('vipBox');
                if(vipBox) {
                    vipBox.innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                    vipBox.style.borderColor = 'gold';
                }
            }
            checkNotifications();
            setInterval(checkNotifications, 60000);
            renderLevelTable();
            checkForDrafts();
            if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
        }
    } catch (e) { console.error(e); window.location.replace('/login.html'); }
}

// --- 分页加载 ---
async function loadPosts(reset = false) {
    const container = document.getElementById('posts-list');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (reset) { currentPage = 1; hasMorePosts = true; container.innerHTML = ''; if (loadMoreBtn) loadMoreBtn.style.display = 'none'; }
    if (!hasMorePosts || isLoadingPosts) return;
    isLoadingPosts = true;
    if (reset) container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    else if (loadMoreBtn) loadMoreBtn.textContent = "LOADING...";

    try {
        const res = await fetch(`${API_BASE}/posts?page=${currentPage}&limit=${POSTS_PER_PAGE}`);
        const posts = await res.json();
        if (reset) container.innerHTML = ''; 
        if (posts.length < POSTS_PER_PAGE) hasMorePosts = false;

        if (posts.length === 0 && currentPage === 1) {
            container.innerHTML = '<p style="color:#666; text-align:center">暂无文章。</p>';
        } else {
            posts.forEach(post => {
                const date = new Date(post.created_at).toLocaleDateString();
                const author = post.author_nickname || post.author_username || "Unknown";
                const cat = post.category || '灌水';
                let catClass = '';
                if(cat === '技术') catClass = 'cat-tech'; else if(cat === '生活') catClass = 'cat-life'; else if(cat === '提问') catClass = 'cat-question'; else if(cat === '公告') catClass = 'cat-announce';
                const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;
                const isAnnounceClass = cat === '公告' ? 'is-announce' : '';
                const pinnedIcon = post.is_pinned ? '<span style="color:#0f0;margin-right:5px">📌[置顶]</span>' : '';
                const badgeHtml = getBadgesHtml({
                    role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color,
                    is_vip: post.author_vip, xp: post.author_xp, badge_preference: post.author_badge_preference
                });
                const likeClass = post.is_liked ? 'liked' : '';
                const likeBtn = `<button class="like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count || 0}</span></button>`;
                
                const div = document.createElement('div');
                div.className = `post-card ${isAnnounceClass}`;
                if(post.is_pinned) div.style.borderLeft = "3px solid #0f0";

                div.innerHTML = `
                    <div class="post-meta">${pinnedIcon}${catHtml} ${date} | ${badgeHtml} @${author}</div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start">
                        <h2 style="margin:0">${post.title}</h2>${likeBtn}
                    </div>
                    <div class="post-snippet">${post.content.substring(0, 100)}...</div>
                `;
                div.onclick = () => { returnToNotifications = false; window.location.hash = `#post?id=${post.id}`; };
                container.appendChild(div);
            });
            currentPage++;
        }
    } catch (e) { console.error(e); }
    finally {
        isLoadingPosts = false;
        if (!document.getElementById('loadMoreBtn')) {
            const btn = document.createElement('button');
            btn.id = 'loadMoreBtn'; btn.className = 'cyber-btn'; btn.style.marginTop = '20px';
            btn.onclick = () => loadPosts(false);
            container.parentNode.insertBefore(btn, container.nextSibling);
        }
        const btn = document.getElementById('loadMoreBtn');
        if (hasMorePosts) { btn.style.display = 'block'; btn.textContent = '加载更多 / LOAD MORE'; } else { btn.style.display = 'none'; }
    }
}

// --- 文章详情 ---
async function loadSinglePost(id) {
    currentPostId = id;
    const container = document.getElementById('single-post-content');
    if(!container) return;
    container.innerHTML = '读取中...';
    document.getElementById('commentsList').innerHTML = '';
    
    const backBtn = document.querySelector('#view-post .back-btn');
    if (backBtn) {
        if (returnToNotifications) { backBtn.textContent = "< 返回通知 / BACK TO LOGS"; backBtn.onclick = () => window.location.hash = '#notifications'; } 
        else { backBtn.textContent = "< 返回 / BACK"; backBtn.onclick = () => window.location.hash = '#home'; }
    }
    const commentInput = document.getElementById('commentInput');
    if(commentInput) {
        commentInput.value = ''; commentInput.placeholder = "输入你的看法... (支持纯文本)"; commentInput.dataset.parentId = "";
        isEditingComment = false; editingCommentId = null;
        const submitBtn = document.querySelector('.comment-input-box button:first-of-type');
        if(submitBtn) submitBtn.textContent = "发送评论 / SEND (+5 XP)";
    }
    const cancelBtn = document.getElementById('cancelReplyBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        if (!post) { container.innerHTML = '<h1>404 - 内容可能已被删除</h1>'; return; }
        const date = new Date(post.created_at).toLocaleString();
        
        let actionBtns = '';
        if (userRole === 'admin') {
            const pinText = post.is_pinned ? "取消置顶 / UNPIN" : "置顶 / PIN";
            const pinColor = post.is_pinned ? "#0f0" : "#666";
            actionBtns += `<button onclick="pinPost(${post.id})" class="delete-btn" style="border-color:${pinColor};color:${pinColor};margin-right:10px">${pinText}</button>`;
        }
        if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) {
             actionBtns += `<button onclick="editPostMode('${post.id}', '${encodeURIComponent(post.title)}', '${encodeURIComponent(post.content)}', '${post.category}')" class="delete-btn" style="border-color:#0070f3;color:#0070f3;margin-right:10px">编辑 / EDIT</button>`;
             actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`;
        }
        if (userRole === 'admin' && post.user_id !== currentUser.id) {
            actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`;
        }
        let tipBtn = '';
        if (currentUser.id !== post.user_id) {
            tipBtn = `<button onclick="tipUser(${post.user_id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`;
        }
        
        const authorDisplay = post.author_nickname || post.author_username;
        const avatarSvg = generatePixelAvatar(post.author_username || "default", post.author_avatar_variant || 0);
        const badgeObj = {
            role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color,
            is_vip: post.author_vip, xp: post.author_xp || 0, badge_preference: post.author_badge_preference 
        };
        const badgesHtml = getBadgesHtml(badgeObj);
        const cat = post.category || '灌水';
        let catClass = '';
        if(cat === '公告') catClass = 'cat-announce'; else if(cat === '技术') catClass = 'cat-tech'; else if(cat === '生活') catClass = 'cat-life'; else if(cat === '提问') catClass = 'cat-question';
        const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;
        const likeClass = post.is_liked ? 'liked' : '';
        const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;

        container.innerHTML = `
            <div class="post-header-row">
                <div class="post-author-info">
                    <div class="post-avatar-box">${avatarSvg}</div>
                    <div class="post-meta-text">
                        <span style="color:#fff; font-size:1rem; font-weight:bold; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">${authorDisplay} ${badgesHtml}</span>
                        <div style="display:flex; align-items:center; gap:10px; margin-top:5px;"><span>${catHtml} ID: ${post.id} // ${date}</span>${likeBtn}</div>
                    </div>${tipBtn}
                </div><div style="display:flex">${actionBtns}</div>
            </div>
            <h1 style="margin-top:20px;">${post.title}</h1><div class="article-body">${post.content}</div>
        `;
        loadNativeComments(id);
    } catch (e) { console.error(e); container.innerHTML = 'Error loading post.'; }
}

// --- 评论加载 (修复：回复层主不显示标签) ---
async function loadNativeComments(postId) {
    const list = document.getElementById('commentsList');
    list.innerHTML = 'Loading comments...';
    try {
        const res = await fetch(`${API_BASE}/comments?post_id=${postId}`);
        const allComments = await res.json();
        list.innerHTML = '';
        if(allComments.length === 0) { list.innerHTML = '<p style="color:#666">暂无评论，抢占沙发。</p>'; return; }

        const rootComments = allComments.filter(c => !c.parent_id);
        const replies = allComments.filter(c => c.parent_id);

        rootComments.forEach(c => {
            // 渲染根评论
            const commentNode = createCommentElement(c, false);
            list.appendChild(commentNode);

            // 查找子评论
            const myReplies = replies.filter(r => r.parent_id === c.id);
            if (myReplies.length > 0) {
                const replyContainer = document.createElement('div');
                replyContainer.className = 'replies-container';
                // 关键：将 c.user_id (层主ID) 传下去，用于判断是否隐式回复
                myReplies.forEach(r => { 
                    replyContainer.appendChild(createCommentElement(r, true, c.user_id)); 
                });
                list.appendChild(replyContainer);
            }
        });
    } catch(e) { console.error(e); list.innerHTML = 'Failed to load comments.'; }
}

function createCommentElement(c, isReply, rootOwnerId) {
    const avatar = generatePixelAvatar(c.username, c.avatar_variant);
    const div = document.createElement('div');
    div.className = isReply ? 'comment-item sub-comment' : 'comment-item';
    if(c.is_pinned) { div.style.border = "1px solid #0f0"; div.style.background = "rgba(0,255,0,0.05)"; }

    let actionLinks = '';
    if (userRole === 'admin' || currentUser.id === c.user_id) {
        actionLinks += `<span onclick="deleteComment(${c.id})" style="color:#555;cursor:pointer;font-size:0.7rem;margin-left:10px">[删除]</span>`;
        actionLinks += `<span onclick="editCommentMode(${c.id}, '${encodeURIComponent(c.content)}')" style="color:#0070f3;cursor:pointer;font-size:0.7rem;margin-left:10px">[编辑]</span>`;
    }
    if (userRole === 'admin') { 
        const pinTxt = c.is_pinned ? "取消置顶" : "置顶";
        actionLinks += `<span onclick="pinComment(${c.id})" style="color:#0f0;cursor:pointer;font-size:0.7rem;margin-left:10px">[${pinTxt}]</span>`;
    }

    const badgeHtml = getBadgesHtml(c);
    const likeClass = c.is_liked ? 'liked' : '';
    const likeBtn = `<button class="like-btn mini ${likeClass}" onclick="event.stopPropagation(); toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count||0}</span></button>`;
    const replyBtn = `<span class="reply-action-btn" onclick="prepareReply(${c.id}, '${c.nickname || c.username}')">↩ 回复</span>`;
    const pinnedBadge = c.is_pinned ? '<span style="color:#0f0;font-weight:bold;font-size:0.7rem;margin-right:5px">📌置顶</span>' : '';

    // === 关键修复：只有当回复的人存在，且不是层主时，才显示标签 ===
    let replyIndicator = '';
    if (c.reply_to_uid && rootOwnerId && c.reply_to_uid != rootOwnerId) {
        const targetName = c.reply_to_nickname || c.reply_to_username || "Unknown";
        replyIndicator = `<span class="reply-indicator">回复 @${targetName}</span> `;
    }

    div.innerHTML = `
        <div class="comment-avatar">${avatar}</div>
        <div class="comment-content-box">
            <div class="comment-header">
                <span class="comment-author" style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                    ${c.nickname || c.username} ${badgeHtml}
                </span>
                <span style="display:flex; align-items:center; gap:10px;">
                    ${pinnedBadge}
                    ${new Date(c.created_at).toLocaleString()}
                    ${likeBtn}
                    ${replyBtn}
                    ${actionLinks}
                </span>
            </div>
            <div class="comment-text">${replyIndicator}${c.content}</div>
        </div>
    `;
    return div;
}

// --- 通用 & 交互 ---
window.prepareReply = function(commentId, username) {
    const input = document.getElementById('commentInput');
    input.dataset.parentId = commentId || "";
    input.placeholder = username ? `回复 @${username} ...` : "输入你的看法...";
    input.focus();
    let cancelBtn = document.getElementById('cancelReplyBtn');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelReplyBtn'; cancelBtn.className = 'cyber-btn'; cancelBtn.style.width = 'auto'; cancelBtn.style.marginLeft = '10px'; cancelBtn.style.fontSize = '0.8rem'; cancelBtn.style.padding = '5px 10px';
        cancelBtn.innerText = '取消回复'; cancelBtn.onclick = cancelReply;
        document.querySelector('.comment-input-box').appendChild(cancelBtn);
    }
    cancelBtn.style.display = 'inline-block';
};
window.cancelReply = function() {
    const input = document.getElementById('commentInput');
    input.dataset.parentId = ""; input.placeholder = "输入你的看法... (支持纯文本)";
    const cancelBtn = document.getElementById('cancelReplyBtn');
    if(cancelBtn) cancelBtn.style.display = 'none';
};

window.submitComment = async function() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    const parentId = input.dataset.parentId || null;
    if(!content) return alert("内容不能为空");
    const btn = document.querySelector('.comment-input-box button:first-of-type'); 
    if(btn) btn.disabled = true;

    try {
        if (isEditingComment) {
            const res = await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'edit', id: editingCommentId, content: content }) });
            const data = await res.json();
            if(data.success) { alert(data.message); window.location.reload(); } else alert(data.error);
        } else {
            const res = await fetch(`${API_BASE}/comments`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ post_id: currentPostId, content: content, parent_id: parentId }) });
            const data = await res.json();
            if(data.success) { alert(data.message); input.value = ''; cancelReply(); loadNativeComments(currentPostId); } else { alert(data.error); }
        }
    } catch(e) { alert("Error"); }
    finally { if(btn) btn.disabled = false; }
};

// ... 保持其他功能不变 ...
function checkForDrafts() {
    const pTitle = document.getElementById('postTitle'); const pContent = document.getElementById('postContent'); const pCat = document.getElementById('postCategory');
    if(pTitle && pContent) {
        const save = () => { if(!isEditingPost) { localStorage.setItem('draft_title', pTitle.value); localStorage.setItem('draft_content', pContent.value); localStorage.setItem('draft_cat', pCat.value); } };
        pTitle.addEventListener('input', save); pContent.addEventListener('input', save); pCat.addEventListener('change', save);
    }
}
function tryRestoreDraft() {
    if(isEditingPost) return; 
    const t = localStorage.getItem('draft_title'); const c = localStorage.getItem('draft_content'); const cat = localStorage.getItem('draft_cat');
    if ((t || c) && document.getElementById('postTitle').value === '') {
        if(confirm("发现未发布的草稿，是否恢复？\n取消则清空草稿。")) {
            document.getElementById('postTitle').value = t || ''; document.getElementById('postContent').value = c || ''; if(cat) document.getElementById('postCategory').value = cat;
        } else { localStorage.removeItem('draft_title'); localStorage.removeItem('draft_content'); localStorage.removeItem('draft_cat'); }
    }
}
window.editPostMode = function(id, t, c, cat) {
    isEditingPost = true; editingPostId = id; window.location.hash = '#write';
    document.getElementById('postTitle').value = decodeURIComponent(t); document.getElementById('postContent').value = decodeURIComponent(c); document.getElementById('postCategory').value = cat;
    document.querySelector('#postForm button').textContent = "保存修改 / UPDATE POST";
};
window.editCommentMode = function(id, c) {
    isEditingComment = true; editingCommentId = id;
    const input = document.getElementById('commentInput'); input.value = decodeURIComponent(c); input.focus(); input.scrollIntoView();
    const btn = document.querySelector('.comment-input-box button:first-of-type'); btn.textContent = "更新评论 / UPDATE";
    prepareReply(null, null); 
    const cancelBtn = document.getElementById('cancelReplyBtn'); cancelBtn.textContent = "取消编辑";
    cancelBtn.onclick = () => { isEditingComment = false; editingCommentId = null; input.value = ''; btn.textContent = "发送评论 / SEND (+5 XP)"; cancelReply(); };
};
async function doPost(e) {
    e.preventDefault(); const t = document.getElementById('postTitle').value; const c = document.getElementById('postContent').value; const cat = document.getElementById('postCategory').value;
    const btn = document.querySelector('#postForm button'); btn.disabled = true;
    try {
        let url = `${API_BASE}/posts`; let method = 'POST'; let body = { title: t, content: c, category: cat };
        if (isEditingPost) { method = 'PUT'; body = { action: 'edit', id: editingPostId, title: t, content: c, category: cat }; }
        const res = await fetch(url, { method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) { 
            alert(data.message); 
            if(!isEditingPost) { localStorage.removeItem('draft_title'); localStorage.removeItem('draft_content'); localStorage.removeItem('draft_cat'); }
            isEditingPost = false; editingPostId = null; btn.textContent = "发布 / PUBLISH";
            document.getElementById('postTitle').value=''; document.getElementById('postContent').value=''; 
            window.location.hash = '#home'; 
        } else { alert(data.error); }
    } catch(err) { alert("Error"); } finally { btn.disabled = false; }
}
window.pinPost = async function(id) { if(!confirm("确认更改置顶状态？")) return; await fetch(`${API_BASE}/posts`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadSinglePost(id); };
window.pinComment = async function(id) { if(!confirm("确认更改此评论置顶状态？")) return; await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadNativeComments(currentPostId); };
window.deleteNotify = async function(id) { if(!confirm("Delete this log?")) return; await fetch(`${API_BASE}/notifications?id=${id}`, {method: 'DELETE'}); loadNotifications(); };
window.clearAllNotifications = async function() { if(!confirm("Clear ALL logs?")) return; await fetch(`${API_BASE}/notifications?all=true`, {method: 'DELETE'}); loadNotifications(); };
async function loadNotifications() { const c = document.getElementById('notifyList'); c.innerHTML='Loading...'; let clearBtn = document.getElementById('clearAllNotifyBtn'); if(!clearBtn) { clearBtn = document.createElement('button'); clearBtn.id = 'clearAllNotifyBtn'; clearBtn.className = 'cyber-btn'; clearBtn.style.marginBottom = '10px'; clearBtn.style.borderColor = '#ff3333'; clearBtn.style.color = '#ff3333'; clearBtn.textContent = '清空所有消息 / CLEAR ALL'; clearBtn.onclick = clearAllNotifications; c.parentNode.insertBefore(clearBtn, c); } try{ const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); c.innerHTML=''; if(d.list.length===0){c.innerHTML='No logs';return;} d.list.forEach(n=>{ const div=document.createElement('div'); div.className=`notify-item ${n.is_read?'':'unread'}`; const delSpan = `<span onclick="event.stopPropagation(); deleteNotify('${n.id}')" style="float:right;color:#666;cursor:pointer;margin-left:10px">[x]</span>`; div.innerHTML=`<div class="notify-msg">${n.message} ${delSpan}</div><div class="notify-time">${new Date(n.created_at).toLocaleString()}</div>`; div.onclick = () => readOneNotify(n.id, n.link, div); c.appendChild(div); }); }catch(e){c.innerHTML='Error';} }
async function checkNotifications() { try { const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); const b = document.getElementById('notifyBadge'); if(d.count>0){ b.style.display='inline-block'; b.textContent=d.count;} else b.style.display='none'; } catch(e){} }
window.readOneNotify = async function(id, link, divElement) { if(divElement) divElement.classList.remove('unread'); returnToNotifications = true; fetch(`${API_BASE}/notifications`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id: id }) }).then(() => checkNotifications()); window.location.hash = link; };
window.markAllRead = async function() { await fetch(`${API_BASE}/notifications`, {method:'POST'}); loadNotifications(); checkNotifications(); };
window.toggleLike = async function(targetId, type, btn) { if(btn.disabled) return; btn.disabled = true; try { const res = await fetch(`${API_BASE}/like`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ target_id: targetId, target_type: type }) }); const data = await res.json(); if(data.success) { const countSpan = btn.querySelector('.count'); countSpan.textContent = data.count; if(data.isLiked) btn.classList.add('liked'); else btn.classList.remove('liked'); } else { if(res.status === 401) alert("请先登录"); else alert(data.error); } } catch(e) { console.error(e); } finally { btn.disabled = false; } };
window.saveBadgePreference = async function() { const select = document.getElementById('badgePreferenceSelect'); try { const res = await fetch(`${API_BASE}/profile`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ badge_preference: select.value }) }); const data = await res.json(); if(data.success) { alert(data.message); window.location.reload(); } else alert(data.error); } catch(e) { alert("Error"); } };
window.claimTask = async function() { const res = await fetch(`${API_BASE}/tasks`, { method: 'POST', body: JSON.stringify({action:'claim'}) }); const data = await res.json(); if(data.success) { alert(data.message); loadTasks(); checkSecurity(); } else alert(data.error); };
window.rerollTask = async function() { if(!confirm("消耗10 i币刷新今日任务？")) return; await fetch(`${API_BASE}/tasks`, { method: 'POST', body: JSON.stringify({action:'reroll'}) }); loadTasks(); };
window.doCheckIn = async function() { const btn = document.getElementById('checkInBtn'); if(btn) btn.disabled = true; try { const res = await fetch(`${API_BASE}/checkin`, {method:'POST'}); const data = await res.json(); alert(data.message); if(data.coins) window.location.reload(); } catch(e) { alert("Error"); } finally { if(btn) btn.disabled = false; } };
window.doLuckyDraw = async function() { const btn = document.querySelector('.lucky-draw-btn'); if(btn) { btn.disabled = true; btn.textContent = "DRAWING..."; } try { const res = await fetch(`${API_BASE}/draw`, {method:'POST'}); const data = await res.json(); if(data.success) { alert(`🎉 ${data.message}`); window.location.reload(); } else { alert(`🚫 ${data.error}`); } } catch(e) { alert("系统繁忙"); } finally { if(btn) { btn.disabled = false; btn.textContent = "🎲 每日幸运抽奖"; } } };
window.adminGrantTitle = async function() { const u = document.getElementById('adminTitleUser').value; const t = document.getElementById('adminTitleText').value; const c = document.getElementById('adminTitleColor').value; if(!u) return alert("请输入用户名"); try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'grant_title', target_username: u, title: t, color: c }) }); const data = await res.json(); if(data.success) alert("头衔发放成功！"); else alert(data.error); } catch(e) { alert("Error"); } };
window.copyRecoveryKey = function() { const k = document.getElementById('recoveryKeyDisplay'); k.select(); document.execCommand('copy'); alert("Copied"); };
window.deletePost = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/posts?id=${id}`, {method:'DELETE'}); window.location.hash='#home'; };
window.deleteComment = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/comments?id=${id}`, {method:'DELETE'}); loadNativeComments(currentPostId); };
window.adminBanUser = async function(uid) { const d=prompt("Days?"); if(!d)return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'ban_user', target_user_id:uid, days:d})}); alert("Done"); };
window.adminGenKey = async function() { const u=document.getElementById('adminTargetUser').value; const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_key', target_username:u})}); const d=await r.json(); document.getElementById('adminKeyResult').innerText=d.key; };
window.adminPostAnnounce = async function() { const t=document.getElementById('adminAnnounceTitle').value; const c=document.getElementById('adminAnnounceContent').value; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'post_announce', title:t, content:c})}); alert("Posted"); };
window.adminGenInvite = async function() { const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_invite'})}); const d=await r.json(); document.getElementById('adminInviteResult').innerText=d.codes?d.codes.join('\n'):d.code; };
window.randomizeAvatar = async function() { if(!confirm("Randomize?"))return; const r=await fetch(`${API_BASE}/random_avatar`, {method:'POST'}); const d=await r.json(); if(d.success) window.location.reload(); };
window.updateProfile = async function() { const n=document.getElementById('newNickname').value; await fetch(`${API_BASE}/profile`, {method:'POST', body:JSON.stringify({nickname:n})}); window.location.reload(); };
window.buyVip = async function() { if(!confirm("Buy VIP?"))return; const r=await fetch(`${API_BASE}/vip`, {method:'POST'}); const d=await r.json(); alert(d.message); if(d.success) window.location.reload(); };
async function doLogout() { await fetch(`${API_BASE}/auth/logout`, {method:'POST'}); window.location.href='/login.html'; }
window.tipUser = async function(uid) { const a=prompt("Amount?"); if(!a)return; await fetch(`${API_BASE}/tip`, {method:'POST', body:JSON.stringify({target_user_id:uid, amount:a})}); window.location.reload(); };
async function loadTasks() { const c=document.getElementById('taskContainer'); if(!c)return; c.innerHTML='Loading...'; try{ const r=await fetch(`${API_BASE}/tasks`); const t=await r.json(); const m={'checkin':'每日签到','post':'发布文章','comment':'发表评论'}; const done=t.progress>=t.target; const btn=t.is_claimed?`<button class="cyber-btn" disabled>已完成 / CLAIMED</button>`:(done?`<button onclick="claimTask()" class="cyber-btn" style="border-color:#0f0;color:#0f0">领取奖励</button>`:`<button class="cyber-btn" disabled>进行中</button>`); const rr=(t.reroll_count===0&&!t.is_claimed)?`<button onclick="rerollTask()" class="cyber-btn" style="margin-top:10px;border-color:orange;color:orange">刷新 (10i)</button>`:''; c.innerHTML=`<div class="task-card"><div class="task-header"><h3>${m[t.task_type]||t.task_type} (${t.progress}/${t.target})</h3><span>${t.reward_xp}XP, ${t.reward_coins}i</span></div><div class="task-progress-bg"><div class="task-progress-fill" style="width:${Math.min(100,(t.progress/t.target)*100)}%"></div></div>${btn}${rr}</div>`; }catch(e){} }

// 初始化
function initApp() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) { mobileMenuBtn.onclick = (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); }; }
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn) { sidebar.classList.remove('open'); }
    });
    const checkInBtn = document.getElementById('checkInBtn'); if (checkInBtn) checkInBtn.onclick = window.doCheckIn;
    const postForm = document.getElementById('postForm'); if (postForm) postForm.onsubmit = doPost;
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
}

const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    tasks: document.getElementById('view-tasks'),
    post: document.getElementById('view-post'),
    settings: document.getElementById('view-settings'),
    about: document.getElementById('view-about'),
    notifications: document.getElementById('view-notifications'),
    admin: document.getElementById('view-admin')
};

async function handleRoute() {
    const hash = window.location.hash || '#home';
    const sidebar = document.getElementById('sidebar');
    const navLinks = document.querySelectorAll('.nav-link');
    Object.values(views).forEach(el => { if(el) el.style.display = 'none'; });
    navLinks.forEach(el => el.classList.remove('active'));
    if(sidebar) sidebar.classList.remove('open');

    if(hash !== '#write' && isEditingPost) {
        isEditingPost = false; editingPostId = null;
        document.querySelector('#postForm button').textContent = "发布 / PUBLISH";
        document.getElementById('postTitle').value=''; document.getElementById('postContent').value=''; 
    }

    if (hash === '#home') {
        if(views.home) views.home.style.display = 'block';
        document.querySelector('a[href="#home"]').classList.add('active');
        loadPosts(true); 
    } else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        document.getElementById('navWrite').classList.add('active');
        tryRestoreDraft();
     } else if (hash === '#tasks') {
        if(views.tasks) views.tasks.style.display = 'block';
        loadTasks();
    } else if (hash === '#settings') {
        if(views.settings) views.settings.style.display = 'block';
        document.querySelector('a[href="#settings"]').classList.add('active');
    } else if (hash === '#about') {
        if(views.about) views.about.style.display = 'block';
        document.querySelector('a[href="#about"]').classList.add('active');
    } else if (hash === '#notifications') {
        if(views.notifications) views.notifications.style.display = 'block';
        document.getElementById('navNotify').classList.add('active');
        loadNotifications();
    } else if (hash === '#admin') {
        if(userRole !== 'admin') { alert("ACCESS DENIED"); window.location.hash='#home'; return; }
        if(views.admin) views.admin.style.display = 'block';
        document.getElementById('navAdmin').classList.add('active');
    } else if (hash.startsWith('#post?id=')) {
        if(views.post) views.post.style.display = 'block';
        loadSinglePost(hash.split('=')[1]);
    }
}
