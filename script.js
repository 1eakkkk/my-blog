// --- START OF FILE script.js ---

const API_BASE = '/api';
let userRole = 'user';
let currentUser = null;
let currentPostId = null;

// === 核心升级：重新定义等级表与称号 ===
// 注意：等级称号头衔的颜色由 CSS .lv-X 类控制，与数字头衔保持一致
const LEVEL_TABLE = [
    { lv: 1,  xp: 0,     title: '潜行者' }, // Stalker
    { lv: 2,  xp: 300,   title: '漫游者' }, // Roamer
    { lv: 3,  xp: 1200,  title: '观察者' }, // Observer
    { lv: 4,  xp: 2000,  title: '骇客' },   // Hacker
    { lv: 5,  xp: 5000,  title: '执政官' }, // Archon
    { lv: 6,  xp: 10000, title: '领主' },   // Overlord
    { lv: 7,  xp: 20000, title: '宗师' },   // Grandmaster
    { lv: 8,  xp: 35000, title: '传奇' },   // Legend
    { lv: 9,  xp: 50000, title: '半神' },   // Demigod
    { lv: 10, xp: 60000, title: '赛博神' }  // CyberGod
];

function calculateLevel(xp) {
    if (xp >= 60000) return { lv: 10, percent: 100, next: 'MAX', title: '赛博神' };

    let currentLv = 1;
    let currentTitle = '潜行者';
    let nextXp = 300;
    let prevXp = 0;

    for (let i = 0; i < LEVEL_TABLE.length; i++) {
        if (xp >= LEVEL_TABLE[i].xp) {
            currentLv = LEVEL_TABLE[i].lv;
            currentTitle = LEVEL_TABLE[i].title;
            prevXp = LEVEL_TABLE[i].xp;
            if (i < LEVEL_TABLE.length - 1) {
                nextXp = LEVEL_TABLE[i+1].xp;
            }
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
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase().padStart(6, "0");
    const color = `#${c}`;
    let rects = '';
    for(let i=0; i<5; i++) {
        for(let j=0; j<5; j++) {
            const val = (hash >> (i * 5 + j)) & 1; 
            if(val) rects += `<rect x="${j*10}" y="${i*10}" width="10" height="10" fill="${color}" />`;
        }
    }
    return `<svg width="100%" height="100%" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" class="pixel-avatar" style="background:#111;">${rects}</svg>`;
}

// --- 核心：统一生成所有徽章 HTML (支持偏好选择) ---
function getBadgesHtml(userObj) {
    let html = '';
    
    // 1. Admin 徽章
    if (userObj.role === 'admin' || userObj.author_role === 'admin') {
        html += `<span class="badge admin-tag">ADMIN</span>`;
    }

    // 2. 自定义头衔 (管理员发放的，最高优先级，单独显示)
    // 兼容 posts 表的字段 (author_title) 和 comments/users 表的字段 (custom_title)
    const title = userObj.author_title || userObj.custom_title;
    const color = userObj.author_title_color || userObj.custom_title_color || '#fff';
    if (title) {
        html += `<span class="badge custom-tag" style="color:${color};border-color:${color}">${title}</span>`;
    }

    // 3. 等级/称号徽章 (互斥显示)
    // 检查偏好：users表字段是 badge_preference
    // 在 loadPosts 中，我们没有 join badge_preference，所以文章列表暂时默认显示数字，
    // 但在评论区和个人中心，我们有完整数据。
    const xp = userObj.xp !== undefined ? userObj.xp : (userObj.author_xp || 0);
    const lvInfo = calculateLevel(xp);
    const pref = userObj.badge_preference || 'number'; // 默认为 number

    if (pref === 'title') {
        // 显示称号，颜色保持等级颜色 (lv-X class)
        html += `<span class="badge lv-${lvInfo.lv}">${lvInfo.title}</span>`;
    } else {
        // 显示数字
        html += `<span class="badge lv-${lvInfo.lv}">LV.${lvInfo.lv}</span>`;
    }
    
    // 4. VIP 徽章
    const isVip = userObj.is_vip || userObj.author_vip;
    if (isVip) {
        html += `<span class="badge vip-tag">VIP</span>`;
    }
    
    return html;
}

function renderLevelTable() {
    const tbody = document.getElementById('levelTableBody');
    if(!tbody) return;
    tbody.innerHTML = LEVEL_TABLE.map(item => `
        <tr>
            <td><span class="badge lv-${item.lv}">LV.${item.lv}</span></td>
            <td><span class="badge lv-${item.lv}">${item.title}</span></td>
            <td>${item.xp}</td>
        </tr>
    `).join('');
}

async function checkSecurity() {
    const mask = document.getElementById('loading-mask');
    try {
        const res = await fetch(`${API_BASE}/user`);
        if (!res.ok) throw new Error("API Error");
        const data = await res.json();

        if (userRole === 'admin') {
            document.getElementById('navAdmin').style.display = 'flex';
        }
        
        if (!data.loggedIn) {
            window.location.replace('/login.html');
        } else {
            currentUser = data;
            userRole = data.role || 'user';

            const displayName = data.nickname || data.username;
            document.getElementById('username').textContent = displayName;
            document.getElementById('coinCount').textContent = data.coins;
            document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${generatePixelAvatar(data.username, data.avatar_variant)}</div>`;
            
            const settingPreview = document.getElementById('settingAvatarPreview');
            if(settingPreview) settingPreview.innerHTML = generatePixelAvatar(data.username, data.avatar_variant);

            const keyDisplay = document.getElementById('recoveryKeyDisplay');
            if(keyDisplay) keyDisplay.value = data.recovery_key || "未生成";

            // 设置页面的佩戴偏好回显
            const badgePrefSelect = document.getElementById('badgePreferenceSelect');
            if(badgePrefSelect) {
                badgePrefSelect.value = data.badge_preference || 'number';
            }

            const badgesArea = document.getElementById('badgesArea');
            badgesArea.innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
            
            const levelInfo = calculateLevel(data.xp || 0);
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
            document.getElementById('logoutBtn').onclick = doLogout;

            if (userRole === 'admin') {
                document.getElementById('navAdmin').style.display = 'flex';
                document.getElementById('view-admin').style.display = 'block'; // 预加载避免闪烁
            } else {
                 document.getElementById('navAdmin').style.display = 'none';
            }

            if(data.is_vip) {
                document.getElementById('vipBox').innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                document.getElementById('vipBox').style.borderColor = 'gold';
            }

            checkNotifications();
            setInterval(checkNotifications, 60000);
            renderLevelTable();

            if (mask) {
                mask.style.opacity = '0';
                setTimeout(() => mask.remove(), 500);
            }
        }
    } catch (e) {
        console.error(e);
        window.location.replace('/login.html');
    }
}

async function loadPosts() {
    const container = document.getElementById('posts-list');
    if(!container) return;
    container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/posts`);
        const posts = await res.json();
        container.innerHTML = '';
        if (posts.length === 0) { 
            container.innerHTML = '<p style="color:#666; text-align:center">暂无文章。</p>'; 
            return; 
        }

        posts.forEach(post => {
            const date = new Date(post.created_at).toLocaleDateString();
            const author = post.author_nickname || post.author_username || "Unknown";
            
            const cat = post.category || '灌水';
            let catClass = '';
            if(cat === '技术') catClass = 'cat-tech';
            else if(cat === '生活') catClass = 'cat-life';
            else if(cat === '提问') catClass = 'cat-question';
            else if(cat === '公告') catClass = 'cat-announce';
            
            const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;
            const isAnnounceClass = cat === '公告' ? 'is-announce' : '';

            // 文章列表暂时无法获取偏好，默认显示数字或需要在posts接口做join，这里暂时按默认处理
            // 为保证一致性，我们在 posts.js 建议返回 badge_preference，如果没返回则默认为 number
            const badgeHtml = getBadgesHtml({
                role: post.author_role,
                custom_title: post.author_title,
                custom_title_color: post.author_title_color,
                is_vip: post.author_vip,
                xp: post.author_xp,
                badge_preference: 'number' // 列表页暂定默认，节省查询开销
            });
            
            const likeClass = post.is_liked ? 'liked' : '';
            const likeBtn = `<button class="like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike(${post.id}, 'post', this)">
                ❤ <span class="count">${post.like_count || 0}</span>
            </button>`;
            
            const div = document.createElement('div');
            div.className = `post-card ${isAnnounceClass}`;
            div.innerHTML = `
                <div class="post-meta">
                    ${catHtml} ${date} | ${badgeHtml} @${author}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start">
                    <h2 style="margin:0">${post.title}</h2>
                    ${likeBtn}
                </div>
                <div class="post-snippet">${post.content.substring(0, 100)}...</div>
            `;
            div.onclick = () => window.location.hash = `#post?id=${post.id}`;
            container.appendChild(div);
        });
    } catch (e) { 
        console.error(e);
        container.innerHTML = '<p style="color:red">无法获取数据流。</p>'; 
    }
}

async function loadSinglePost(id) {
    currentPostId = id;
    const container = document.getElementById('single-post-content');
    if(!container) return;
    container.innerHTML = '读取中...';
    document.getElementById('commentsList').innerHTML = '';
    // 重置评论输入框状态
    const commentInput = document.getElementById('commentInput');
    commentInput.value = '';
    commentInput.placeholder = "输入你的看法... (支持纯文本)";
    commentInput.dataset.parentId = ""; // 清除回复对象
    document.getElementById('cancelReplyBtn').style.display = 'none';

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        if (!post) { container.innerHTML = '<h1>404</h1>'; return; }

        const date = new Date(post.created_at).toLocaleString();
        
        let actionBtns = '';
        if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) {
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

        // 详情页如果有 badge_preference 最好，没有则默认
        const badgeObj = {
            role: post.author_role,
            custom_title: post.author_title,
            custom_title_color: post.author_title_color,
            is_vip: post.author_vip,
            xp: post.author_xp || 0,
            badge_preference: 'number' 
        };
        const badgesHtml = getBadgesHtml(badgeObj);

        const cat = post.category || '灌水';
        let catClass = '';
        if(cat === '公告') catClass = 'cat-announce';
        else if(cat === '技术') catClass = 'cat-tech';
        else if(cat === '生活') catClass = 'cat-life';
        else if(cat === '提问') catClass = 'cat-question';
        const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;

        const likeClass = post.is_liked ? 'liked' : '';
        const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;

        container.innerHTML = `
            <div class="post-header-row">
                <div class="post-author-info">
                    <div class="post-avatar-box">${avatarSvg}</div>
                    <div class="post-meta-text">
                        <span style="color:#fff; font-size:1rem; font-weight:bold; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            ${authorDisplay} ${badgesHtml}
                        </span>
                        <div style="display:flex; align-items:center; gap:10px; margin-top:5px;">
                            <span>${catHtml} ID: ${post.id} // ${date}</span>
                            ${likeBtn}
                        </div>
                    </div>
                    ${tipBtn}
                </div>
                <div>${actionBtns}</div>
            </div>
            <h1 style="margin-top:20px;">${post.title}</h1>
            <div class="article-body">${post.content}</div>
        `;
        
        loadNativeComments(id);
    } catch (e) {
        console.error(e);
        container.innerHTML = 'Error loading post.';
    }
}

// === 核心升级：评论加载逻辑（支持嵌套） ===
async function loadNativeComments(postId) {
    const list = document.getElementById('commentsList');
    list.innerHTML = 'Loading comments...';
    try {
        const res = await fetch(`${API_BASE}/comments?post_id=${postId}`);
        const allComments = await res.json();
        list.innerHTML = '';
        if(allComments.length === 0) {
            list.innerHTML = '<p style="color:#666">暂无评论，抢占沙发。</p>';
            return;
        }

        // 分离根评论和子评论
        const rootComments = allComments.filter(c => !c.parent_id);
        const replies = allComments.filter(c => c.parent_id);

        rootComments.forEach(c => {
            const commentNode = createCommentElement(c, false);
            list.appendChild(commentNode);

            // 查找属于该根评论的子回复
            // 注意：因为后端逻辑将所有孙子评论都挂到了根下面 (parent_id 指向根)，所以直接匹配 parent_id === c.id 即可
            const myReplies = replies.filter(r => r.parent_id === c.id);
            if (myReplies.length > 0) {
                const replyContainer = document.createElement('div');
                replyContainer.className = 'replies-container';
                myReplies.forEach(r => {
                    replyContainer.appendChild(createCommentElement(r, true));
                });
                list.appendChild(replyContainer);
            }
        });

    } catch(e) { 
        console.error(e);
        list.innerHTML = 'Failed to load comments.'; 
    }
}

function createCommentElement(c, isReply) {
    const avatar = generatePixelAvatar(c.username, c.avatar_variant);
    const div = document.createElement('div');
    div.className = isReply ? 'comment-item sub-comment' : 'comment-item';
    
    let delCommentBtn = '';
    if (userRole === 'admin' || currentUser.id === c.user_id) {
        delCommentBtn = `<span onclick="deleteComment(${c.id})" style="color:#555;cursor:pointer;font-size:0.7rem;margin-left:10px">[删除]</span>`;
    }

    // 徽章
    const badgeHtml = getBadgesHtml(c);
    
    // 点赞
    const likeClass = c.is_liked ? 'liked' : '';
    const likeBtn = `<button class="like-btn mini ${likeClass}" onclick="event.stopPropagation(); toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count||0}</span></button>`;
    
    // 回复按钮 (限制缩进：子评论不显示回复按钮，或者点击回复子评论时，实际上是对根的回复)
    // 方案：点击任意回复按钮，都设置 parent_id。如果是子评论，后端已处理归属。
    const replyBtn = `<span class="reply-action-btn" onclick="prepareReply(${c.id}, '${c.nickname || c.username}')">↩ 回复</span>`;

    div.innerHTML = `
        <div class="comment-avatar">${avatar}</div>
        <div class="comment-content-box">
            <div class="comment-header">
                <span class="comment-author" style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                    ${c.nickname || c.username} ${badgeHtml}
                </span>
                <span style="display:flex; align-items:center; gap:10px;">
                    ${new Date(c.created_at).toLocaleString()}
                    ${likeBtn}
                    ${replyBtn}
                    ${delCommentBtn}
                </span>
            </div>
            <div class="comment-text">${c.content}</div>
        </div>
    `;
    return div;
}

// 准备回复
window.prepareReply = function(commentId, username) {
    const input = document.getElementById('commentInput');
    input.dataset.parentId = commentId;
    input.placeholder = `回复 @${username} ...`;
    input.focus();
    
    // 显示取消按钮
    let cancelBtn = document.getElementById('cancelReplyBtn');
    if (!cancelBtn) {
        // 如果 HTML 没写，动态加一个
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelReplyBtn';
        cancelBtn.className = 'cyber-btn';
        cancelBtn.style.width = 'auto';
        cancelBtn.style.marginLeft = '10px';
        cancelBtn.style.fontSize = '0.8rem';
        cancelBtn.style.padding = '5px 10px';
        cancelBtn.innerText = '取消回复';
        cancelBtn.onclick = cancelReply;
        document.querySelector('.comment-input-box').appendChild(cancelBtn);
    }
    cancelBtn.style.display = 'inline-block';
};

window.cancelReply = function() {
    const input = document.getElementById('commentInput');
    input.dataset.parentId = "";
    input.placeholder = "输入你的看法... (支持纯文本)";
    document.getElementById('cancelReplyBtn').style.display = 'none';
};

// 提交评论 (支持回复)
window.submitComment = async function() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    const parentId = input.dataset.parentId || null;

    if(!content) return alert("内容不能为空");
    
    const btn = document.querySelector('.comment-input-box button:first-child'); // 发送按钮
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/comments`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                post_id: currentPostId, 
                content: content,
                parent_id: parentId // 发送父ID
            })
        });
        const data = await res.json();
        if(data.success) { 
            alert(data.message); 
            input.value = ''; 
            cancelReply(); // 重置状态
            loadNativeComments(currentPostId); 
        }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
    finally { btn.disabled = false; }
};

// ... (其他原有函数保持不变，如 notifications, admin, etc.) ...
// 为了确保完整性，以下是需要保留的关键函数

window.toggleLike = async function(targetId, type, btn) {
    if(btn.disabled) return;
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/like`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_id: targetId, target_type: type })
        });
        const data = await res.json();
        
        if(data.success) {
            const countSpan = btn.querySelector('.count');
            countSpan.textContent = data.count;
            if(data.isLiked) btn.classList.add('liked');
            else btn.classList.remove('liked');
        } else {
            if(res.status === 401) alert("请先登录");
            else alert(data.error);
        }
    } catch(e) { console.error(e); }
    finally { btn.disabled = false; }
};

// 新增：保存头衔显示偏好
window.saveBadgePreference = async function() {
    const select = document.getElementById('badgePreferenceSelect');
    const pref = select.value;
    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ badge_preference: pref })
        });
        const data = await res.json();
        if(data.success) {
            alert(data.message);
            window.location.reload();
        } else {
            alert(data.error);
        }
    } catch(e) { alert("Error"); }
};

// ... 原有的 admin, tasks, checkin, deletePost, etc. ...
// 这里为了篇幅不重复粘贴所有未修改的函数，但你需要保证它们在 script.js 中。
// 建议：直接保留你原来的辅助函数，只替换 loadPosts, loadSinglePost, loadNativeComments, submitComment, checkSecurity, 和新增 saveBadgePreference, prepareReply, cancelReply。

// === 补全基础函数以防丢失 ===
window.adminGrantTitle = async function() {
    const username = document.getElementById('adminTitleUser').value;
    const title = document.getElementById('adminTitleText').value;
    const color = document.getElementById('adminTitleColor').value;
    if(!username) return alert("请输入用户名");
    try {
        const res = await fetch(`${API_BASE}/admin`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'grant_title', target_username: username, title: title, color: color }) });
        const data = await res.json();
        if(data.success) alert("头衔发放成功！"); else alert(data.error);
    } catch(e) { alert("Error"); }
};
window.copyRecoveryKey = function() { const k = document.getElementById('recoveryKeyDisplay'); k.select(); document.execCommand('copy'); alert("Copied"); };
async function checkNotifications() { try { const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); const b = document.getElementById('notifyBadge'); if(d.count>0){ b.style.display='inline-block'; b.textContent=d.count;} else b.style.display='none'; } catch(e){} }
async function loadNotifications() { const c = document.getElementById('notifyList'); c.innerHTML='Loading...'; try{ const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); c.innerHTML=''; if(d.list.length===0){c.innerHTML='No logs';return;} d.list.forEach(n=>{ const div=document.createElement('div'); div.className=`notify-item ${n.is_read?'':'unread'}`; div.innerHTML=`<div class="notify-msg">${n.message}</div><div class="notify-time">${new Date(n.created_at).toLocaleString()}</div>`; div.onclick=()=>{window.location.hash=n.link;}; c.appendChild(div); }); }catch(e){c.innerHTML='Error';} }
window.markAllRead = async function() { await fetch(`${API_BASE}/notifications`, {method:'POST'}); loadNotifications(); checkNotifications(); };
window.deletePost = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/posts?id=${id}`, {method:'DELETE'}); window.location.hash='#home'; };
window.deleteComment = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/comments?id=${id}`, {method:'DELETE'}); loadNativeComments(currentPostId); };
window.adminBanUser = async function(uid) { const d=prompt("Days?"); if(!d)return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'ban_user', target_user_id:uid, days:d})}); alert("Done"); };
window.adminGenKey = async function() { const u=document.getElementById('adminTargetUser').value; const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_key', target_username:u})}); const d=await r.json(); document.getElementById('adminKeyResult').innerText=d.key; };
window.adminPostAnnounce = async function() { const t=document.getElementById('adminAnnounceTitle').value; const c=document.getElementById('adminAnnounceContent').value; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'post_announce', title:t, content:c})}); alert("Posted"); };
window.adminGenInvite = async function() { const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_invite'})}); const d=await r.json(); document.getElementById('adminInviteResult').innerText=d.codes?d.codes.join('\n'):d.code; };
window.randomizeAvatar = async function() { if(!confirm("Randomize?"))return; const r=await fetch(`${API_BASE}/random_avatar`, {method:'POST'}); const d=await r.json(); if(d.success) window.location.reload(); };
window.doLuckyDraw = async function() { await fetch(`${API_BASE}/draw`, {method:'POST'}); window.location.reload(); };
window.updateProfile = async function() { const n=document.getElementById('newNickname').value; await fetch(`${API_BASE}/profile`, {method:'POST', body:JSON.stringify({nickname:n})}); window.location.reload(); };
window.buyVip = async function() { if(!confirm("Buy VIP?"))return; const r=await fetch(`${API_BASE}/vip`, {method:'POST'}); const d=await r.json(); alert(d.message); if(d.success) window.location.reload(); };
async function doPost(e) { e.preventDefault(); const t=document.getElementById('postTitle').value; const c=document.getElementById('postContent').value; const cat=document.getElementById('postCategory').value; await fetch(`${API_BASE}/posts`, {method:'POST', body:JSON.stringify({title:t, content:c, category:cat})}); window.location.hash='#home'; }
async function doCheckIn() { await fetch(`${API_BASE}/checkin`, {method:'POST'}); window.location.reload(); }
async function doLogout() { await fetch(`${API_BASE}/auth/logout`, {method:'POST'}); window.location.href='/login.html'; }
window.tipUser = async function(uid) { const a=prompt("Amount?"); if(!a)return; await fetch(`${API_BASE}/tip`, {method:'POST', body:JSON.stringify({target_user_id:uid, amount:a})}); window.location.reload(); };
async function loadTasks() { const c=document.getElementById('taskContainer'); try{ const r=await fetch(`${API_BASE}/tasks`); const t=await r.json(); c.innerHTML=`<h3>${t.task_type} ${t.progress}/${t.target}</h3>`; if(t.progress>=t.target && !t.is_claimed) c.innerHTML+='<button onclick="claimTask()">CLAIM</button>'; }catch(e){} }
window.claimTask = async function() { await fetch(`${API_BASE}/tasks`, {method:'POST', body:JSON.stringify({action:'claim'})}); loadTasks(); };
window.rerollTask = async function() { await fetch(`${API_BASE}/tasks`, {method:'POST', body:JSON.stringify({action:'reroll'})}); loadTasks(); };

// 初始化
function initApp() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.onclick = (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); };
    }
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn) {
            sidebar.classList.remove('open');
        }
    });
    const checkInBtn = document.getElementById('checkInBtn');
    if (checkInBtn) checkInBtn.onclick = doCheckIn;
    const postForm = document.getElementById('postForm');
    if (postForm) postForm.onsubmit = doPost;
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.textContent = new Date().toLocaleTimeString();
    }, 1000);
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

    if (hash === '#home') {
        if(views.home) views.home.style.display = 'block';
        document.querySelector('a[href="#home"]').classList.add('active');
        loadPosts();
    } else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        document.getElementById('navWrite').classList.add('active');
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
