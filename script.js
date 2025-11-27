// --- START OF FILE script.js ---

const API_BASE = '/api';
let userRole = 'user';
let currentUser = null;
let currentPostId = null;
let returnToNotifications = false;
let isAppReady = false;

let currentPage = 1;
const POSTS_PER_PAGE = 10;
let isLoadingPosts = false;
let hasMorePosts = true;
let isEditingPost = false;
let editingPostId = null;
let isEditingComment = false;
let editingCommentId = null;

let currentCommentPage = 1;
const COMMENTS_PER_PAGE = 20;
let hasMoreComments = true;
let isLoadingComments = false;

// 当前帖子作者ID (用于评论区标识)
let currentPostAuthorId = null;

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

function getFloorName(index) {
    if (index === 1) return '<span style="color:#FFD700">🛋️ 沙发</span>';
    if (index === 2) return '<span style="color:#C0C0C0">🪑 板凳</span>';
    if (index === 3) return '<span style="color:#cd7f32">🪵 地板</span>';
    return `#${index}`;
}

async function checkSecurity() {
    const mask = document.getElementById('loading-mask');
    try {
        const res = await fetch(`${API_BASE}/user`);
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        
        if (!data.loggedIn) {
            window.location.replace('/login.html');
        } else {
            currentUser = data;
            userRole = data.role || 'user';
            isAppReady = true;

            // 填充设置页面的注册账号
            const settingUser = document.getElementById('settingUsername');
            if(settingUser) settingUser.value = data.username;

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

            if (userRole === 'admin') {
                document.getElementById('navAdmin').style.display = 'flex';
                const postCat = document.getElementById('postCategory');
                if(postCat && !postCat.querySelector('option[value="公告"]')) {
                    const opt = document.createElement('option');
                    opt.value = '公告'; opt.innerText = '📢 公告 / ANNOUNCE'; opt.style.color = '#ff3333';
                    postCat.prepend(opt);
                }
                checkAdminStatus();
                setInterval(checkAdminStatus, 60000);
            } else {
                document.getElementById('navAdmin').style.display = 'none';
            }

            if(data.is_vip) {
                const vipBox = document.getElementById('vipBox');
                if(vipBox) {
                    vipBox.innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                    vipBox.style.borderColor = 'gold';
                }
            }
            checkNotifications();
            setInterval(checkNotifications, 60000);
            loadTasks(); // 加载任务以更新侧边栏提示
            handleRoute();
            if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
        }
    } catch (e) { console.error(e); window.location.replace('/login.html'); }
}

// ... (submitFeedback, toggleInviteSystem, copyText 等保持不变，此处略去以省篇幅，请确保保留) ...
// 为了完整性，核心 Admin 逻辑重写如下：

async function checkAdminStatus() {
    try {
        const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_stats'}) });
        const data = await res.json();
        if(data.success) {
            const badge = document.getElementById('adminFeedbackBadge');
            if(badge) {
                if(data.unreadFeedback > 0) {
                    badge.style.display = 'inline-block';
                    badge.textContent = data.unreadFeedback;
                } else {
                    badge.style.display = 'none';
                }
            }
            // 如果当前在 admin 界面
            if(document.getElementById('view-admin').style.display === 'block') {
                document.getElementById('statTotalUsers').innerText = data.totalUsers;
                document.getElementById('statActiveUsers').innerText = data.activeUsers;
                document.getElementById('inviteToggle').checked = data.inviteRequired;
            }
        }
    } catch(e){}
}
async function loadAdminStats() { checkAdminStatus(); }

window.adminBanUser = async function(uid) {
    const days = prompt("封禁天数 (9999=永久):", "1");
    if(!days) return;
    const reason = prompt("封禁理由 (必填):", "违反社区规定");
    if(!reason) return;
    
    await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'ban_user', target_user_id:uid, days:days, reason:reason})});
    alert("Done");
    loadAdminBanList(); // 刷新列表
};

window.adminUnbanUser = async function(uid) {
    if(!confirm("解除封禁？")) return;
    await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'unban_user', target_user_id:uid})});
    alert("已解封");
    loadAdminBanList();
};

async function loadAdminBanList() {
    const tbody = document.querySelector('#adminBanTable tbody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
    try {
        const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_banned_users'}) });
        const data = await res.json();
        tbody.innerHTML = '';
        if(data.success && data.list.length > 0) {
            data.list.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${u.nickname || u.username}</td>
                    <td>${u.ban_reason || '-'}</td>
                    <td>${new Date(u.ban_expires_at).toLocaleDateString()}</td>
                    <td><button onclick="adminUnbanUser(${u.id})" class="mini-action-btn" style="color:#0f0">解封</button></td>
                `;
                tbody.appendChild(tr);
            });
        } else { tbody.innerHTML = '<tr><td colspan="4">无封禁用户</td></tr>'; }
    } catch(e){ tbody.innerHTML = '<tr><td colspan="4">Error</td></tr>'; }
}

// ... (loadAdminInvites, refillInvites, deleteInvite, loadAdminFeedbacks, adminMarkRead, etc. 保持不变) ...
// 请确保 loadAdminFeedbacks, adminMarkRead, adminDeleteFeedback, adminReplyFeedback 都在 script.js 中

async function loadTasks() { 
    const c=document.getElementById('taskContainer'); 
    try{ 
        const res=await fetch(`${API_BASE}/tasks`); 
        const t=await res.json(); 
        
        // === 任务侧边栏提示 ===
        const navTask = document.querySelector('a[href="#tasks"]');
        if(navTask) {
            // 如果任务完成了但未领取 (t.progress >= t.target && !t.is_claimed) -> 提示领取
            // 或者如果已领取，就不提示。
            // 需求：每日任务完成后提示。
            if (t.progress >= t.target && !t.is_claimed) {
                navTask.innerHTML = `每日任务 / Daily Tasks <span style="background:#0f0;width:8px;height:8px;border-radius:50%;display:inline-block;"></span>`;
            } else {
                navTask.innerHTML = `每日任务 / Daily Tasks`;
            }
        }

        if(!c) return; // 如果不在任务页，只更新侧边栏即可退出
        
        c.innerHTML='Loading...'; 
        const m={'checkin':'每日签到','post':'发布文章','comment':'发表评论'}; 
        const done=t.progress>=t.target; 
        const btn=t.is_claimed?`<button class="cyber-btn" disabled>已完成 / CLAIMED</button>`:(done?`<button onclick="claimTask()" class="cyber-btn" style="border-color:#0f0;color:#0f0">领取奖励</button>`:`<button class="cyber-btn" disabled>进行中</button>`); 
        const rr=(t.reroll_count===0&&!t.is_claimed)?`<button onclick="rerollTask()" class="cyber-btn" style="margin-top:10px;border-color:orange;color:orange">刷新 (10i)</button>`:''; 
        c.innerHTML=`<div class="task-card"><div class="task-header"><h3>${m[t.task_type]||t.task_type} (${t.progress}/${t.target})</h3><span>${t.reward_xp}XP, ${t.reward_coins}i</span></div><div class="task-progress-bg"><div class="task-progress-fill" style="width:${Math.min(100,(t.progress/t.target)*100)}%"></div></div>${btn}${rr}</div>`; 
    }catch(e){ if(c) c.innerHTML = 'Error loading tasks'; } 
}

// ... (claimTask, rerollTask, doCheckIn, doLuckyDraw 保持不变) ...

// === 帖子列表：新贴标记 ===
async function loadPosts(reset = false) {
    const container = document.getElementById('posts-list');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (reset) { currentPage = 1; hasMorePosts = true; container.innerHTML = ''; if (loadMoreBtn) loadMoreBtn.style.display = 'none'; }
    if (!hasMorePosts || isLoadingPosts) return;
    isLoadingPosts = true;
    if (reset) container.innerHTML = '<div class="loading">正在同步数据流...</div>'; else if (loadMoreBtn) loadMoreBtn.textContent = "LOADING...";
    try {
        const res = await fetch(`${API_BASE}/posts?page=${currentPage}&limit=${POSTS_PER_PAGE}`);
        const posts = await res.json();
        if (reset) container.innerHTML = ''; 
        if (posts.length < POSTS_PER_PAGE) hasMorePosts = false;
        if (posts.length === 0 && currentPage === 1) { container.innerHTML = '<p style="color:#666; text-align:center">暂无文章。</p>'; } else {
            const now = Date.now();
            posts.forEach(post => {
                const rawDate = post.updated_at || post.created_at; 
                const dateStr = new Date(rawDate).toLocaleDateString(); 
                const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
                
                // === 新贴标记 (24小时内) ===
                const isNew = (now - post.created_at) < (24 * 60 * 60 * 1000);
                const newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';

                const author = post.author_nickname || post.author_username || "Unknown";
                const cat = post.category || '灌水'; let catClass = ''; if(cat === '技术') catClass = 'cat-tech'; else if(cat === '生活') catClass = 'cat-life'; else if(cat === '提问') catClass = 'cat-question'; else if(cat === '公告') catClass = 'cat-announce';
                const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`; 
                const pinnedIcon = post.is_pinned ? '<span style="color:#0f0;margin-right:5px">📌[置顶]</span>' : '';
                const badgeHtml = getBadgesHtml({ role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp, badge_preference: post.author_badge_preference });
                const likeClass = post.is_liked ? 'liked' : ''; 
                const likeBtn = `<button class="like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count || 0}</span></button>`;
                
                const div = document.createElement('div'); 
                div.className = `post-card ${isAnnounceClass}`; 
                if(post.is_pinned) div.style.borderLeft = "3px solid #0f0";
                
                const commentCount = post.comment_count || 0;
                div.innerHTML = `
                    <div class="post-meta">${newBadge}${pinnedIcon}${catHtml} ${dateStr} ${editedTag} | ${badgeHtml} @${author}</div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start">
                        <h2 style="margin:0">${post.title}</h2>
                    </div>
                    <div class="post-snippet">${post.content.substring(0, 100)}...</div>
                    <div class="post-footer" style="margin-top:15px; padding-top:10px; border-top:1px dashed #222; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem; color:#666;">
                        <div>💬 <span class="count">${commentCount}</span> 评论</div>
                        <div>${likeBtn}</div>
                    </div>
                `;
                div.onclick = () => { returnToNotifications = false; window.location.hash = `#post?id=${post.id}`; }; 
                container.appendChild(div);
            });
            currentPage++;
        }
    } catch (e) { console.error(e); }
    finally { isLoadingPosts = false; if (loadMoreBtn) { loadMoreBtn.style.display = hasMorePosts ? 'block' : 'none'; if(isLoadingPosts) loadMoreBtn.textContent = "LOADING..."; else loadMoreBtn.textContent = '加载更多 / LOAD MORE'; } }
}

async function loadSinglePost(id) {
    currentPostId = id; const container = document.getElementById('single-post-content'); if(!container) return; container.innerHTML = '读取中...'; document.getElementById('commentsList').innerHTML = '';
    const backBtn = document.querySelector('#view-post .back-btn'); if (backBtn) { if (returnToNotifications) { backBtn.textContent = "< 返回通知 / BACK TO LOGS"; backBtn.onclick = () => window.location.hash = '#notifications'; } else { backBtn.textContent = "< 返回 / BACK"; backBtn.onclick = () => window.location.hash = '#home'; } }
    // ... (输入框重置逻辑保持不变) ...
    
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`); const post = await res.json(); if (!post) { container.innerHTML = '<h1>404 - 内容可能已被删除</h1>'; return; }
        
        // 记录当前帖子作者ID
        currentPostAuthorId = post.user_id;

        const rawDate = post.updated_at || post.created_at; const dateStr = new Date(rawDate).toLocaleString(); const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
        
        // ... (actionBtns 生成逻辑保持不变) ...
        // 为了节省篇幅，这里请保留你原有的 actionBtns 生成逻辑，确保 adminBanUser 被正确调用
        let actionBtns = '';
        if (userRole === 'admin') actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`;
        // ... 其他按钮 ...

        // 渲染详情
        const authorDisplay = post.author_nickname || post.author_username; const avatarSvg = generatePixelAvatar(post.author_username || "default", post.author_avatar_variant || 0); const badgeObj = { role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp || 0, badge_preference: post.author_badge_preference }; const badgesHtml = getBadgesHtml(badgeObj); const cat = post.category || '灌水'; const catHtml = `<span class="category-tag">${cat}</span>`; const likeClass = post.is_liked ? 'liked' : ''; const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;
        container.innerHTML = `<div class="post-header-row"><div class="post-author-info"><div class="post-avatar-box">${avatarSvg}</div><div class="post-meta-text"><span style="color:#fff; font-size:1rem; font-weight:bold; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">${authorDisplay} ${badgesHtml}</span><div style="display:flex; align-items:center; gap:10px; margin-top:5px;"><span>${catHtml} ID: ${post.id} // ${dateStr} ${editedTag}</span>${likeBtn}</div></div></div><div class="post-actions-mobile" style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px;">${actionBtns}</div></div><h1 style="margin-top:20px;">${post.title}</h1><div class="article-body">${post.content}</div>`;
        
        currentCommentPage = 1; hasMoreComments = true; loadNativeComments(id, true);
    } catch (e) { console.error(e); container.innerHTML = 'Error loading post.'; }
}

async function loadNativeComments(postId, reset = false) {
    const list = document.getElementById('commentsList'); const loadBtn = document.getElementById('loadCommentsBtn');
    if (reset) { currentCommentPage = 1; hasMoreComments = true; list.innerHTML = ''; if (loadBtn) loadBtn.style.display = 'none'; }
    if (!hasMoreComments || isLoadingComments) return;
    isLoadingComments = true; if(reset) list.innerHTML = 'Loading comments...'; else if(loadBtn) loadBtn.textContent = "LOADING...";
    try {
        const res = await fetch(`${API_BASE}/comments?post_id=${postId}&page=${currentCommentPage}&limit=${COMMENTS_PER_PAGE}`); const data = await res.json();
        if(reset) list.innerHTML = '';
        if (data.results.length < COMMENTS_PER_PAGE) hasMoreComments = false;
        if(data.results.length === 0 && currentCommentPage === 1) { list.innerHTML = '<p style="color:#666">暂无评论，抢占沙发。</p>'; } else {
            const rootComments = data.results.filter(c => !c.parent_id);
            const replies = data.results.filter(c => c.parent_id);
            rootComments.forEach((c, index) => {
                const globalIndex = (currentCommentPage - 1) * COMMENTS_PER_PAGE + index + 1;
                // 传 currentPostAuthorId 给 createCommentElement 用于显示"作者"标签
                const commentNode = createCommentElement(c, false, null, globalIndex, currentPostAuthorId);
                list.appendChild(commentNode);
                const myReplies = replies.filter(r => r.parent_id === c.id);
                
                // === 楼层折叠逻辑 ===
                if (myReplies.length > 0) {
                    const replyContainer = document.createElement('div');
                    replyContainer.className = 'replies-container';
                    
                    // 默认只显示前 3 条
                    const visibleReplies = myReplies.slice(0, 3);
                    const hiddenReplies = myReplies.slice(3);
                    
                    visibleReplies.forEach(r => { 
                        replyContainer.appendChild(createCommentElement(r, true, c.user_id, 0, currentPostAuthorId)); 
                    });
                    
                    if (hiddenReplies.length > 0) {
                        const foldBtn = document.createElement('div');
                        foldBtn.className = 'reply-fold-btn';
                        foldBtn.innerText = `查看剩余 ${hiddenReplies.length} 条回复...`;
                        foldBtn.onclick = () => {
                            hiddenReplies.forEach(r => {
                                // 插入到 foldBtn 之前
                                replyContainer.insertBefore(createCommentElement(r, true, c.user_id, 0, currentPostAuthorId), foldBtn);
                            });
                            foldBtn.remove();
                        };
                        replyContainer.appendChild(foldBtn);
                    }
                    list.appendChild(replyContainer);
                }
            });
            currentCommentPage++;
        }
    } catch(e) { console.error(e); } finally { isLoadingComments = false; /* 按钮处理略 */ }
}

function createCommentElement(c, isReply, rootOwnerId, floorNumber, postAuthorId) {
    const avatar = generatePixelAvatar(c.username, c.avatar_variant); const div = document.createElement('div'); div.className = isReply ? 'comment-item sub-comment' : 'comment-item'; if(c.is_pinned) { div.style.border = "1px solid #0f0"; div.style.background = "rgba(0,255,0,0.05)"; }
    
    // Action Links (Mobile Responsive Wrapper added in CSS)
    let actionLinks = ''; 
    if (userRole === 'admin' || currentUser.id === c.user_id) { 
        actionLinks += `<span onclick="deleteComment(${c.id})" class="action-link">[删除]</span>`; 
        actionLinks += `<span onclick="editCommentMode(${c.id}, '${encodeURIComponent(c.content)}')" class="action-link" style="color:#0070f3">[编辑]</span>`; 
    } 
    if (userRole === 'admin' && !isReply) { 
        const pinTxt = c.is_pinned ? "取消置顶" : "置顶"; 
        actionLinks += `<span onclick="pinComment(${c.id})" class="action-link" style="color:#0f0">[${pinTxt}]</span>`; 
    }
    
    const badgeHtml = getBadgesHtml(c); 
    const likeClass = c.is_liked ? 'liked' : ''; 
    const likeBtn = `<button class="like-btn mini ${likeClass}" onclick="event.stopPropagation(); toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count||0}</span></button>`; 
    const replyBtn = `<span class="reply-action-btn" onclick="prepareReply(${c.id}, '${c.nickname || c.username}')">↩ 回复</span>`; 
    const pinnedBadge = c.is_pinned ? '<span style="color:#0f0;font-weight:bold;font-size:0.7rem;margin-right:5px">📌置顶</span>' : '';
    
    let replyIndicator = ''; 
    if (c.reply_to_uid && rootOwnerId && c.reply_to_uid != rootOwnerId) { 
        const targetName = c.reply_to_nickname || c.reply_to_username || "Unknown"; replyIndicator = `<span class="reply-indicator">回复 @${targetName}</span> `; 
    }

    let floorTag = ''; if (!isReply && floorNumber) floorTag = `<span class="floor-tag">${getFloorName(floorNumber)}</span>`;
    
    // === 作者标签 ===
    let authorTag = '';
    if (postAuthorId && c.user_id === postAuthorId) {
        authorTag = `<span class="author-tag">📝 作者</span>`;
    }

    div.innerHTML = `
        <div class="comment-avatar">${avatar}</div>
        <div class="comment-content-box">
            <div class="comment-header">
                <span class="comment-author">
                    ${c.nickname || c.username} ${authorTag} ${badgeHtml}
                </span>
                ${floorTag}
            </div>
            <div class="comment-meta-row">
                ${pinnedBadge} ${new Date(c.created_at).toLocaleString()}
                <div class="comment-actions">
                    ${likeBtn} ${replyBtn} ${actionLinks}
                </div>
            </div>
            <div class="comment-text">${replyIndicator}${c.content}</div>
        </div>
    `;
    return div;
}

// ... (其它的辅助函数如 prepareReply, submitComment, edit... 保持不变) ...
// 注意：这里不再重复列出 submitComment, editPostMode 等未修改的函数，请保留原有的。
// 唯一需要确保的是 adminBanUser 已经更新为上述版本。

// --- 路由部分 ---
// 增加 Admin 的封禁列表加载
async function handleRoute() {
    // ... (前置逻辑保持不变) ...
    const hash = window.location.hash || '#home';
    // ...
    if (hash === '#admin') {
        if(userRole !== 'admin') { /*...*/ }
        if(views.admin) {
            // ...
            loadAdminStats();
            loadAdminInvites();
            loadAdminFeedbacks();
            loadAdminBanList(); // 新增
        }
    }
    // ...
}
