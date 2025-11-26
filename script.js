// --- START OF FILE script.js ---

const API_BASE = '/api';
let userRole = 'user';
let currentUser = null;
let currentPostId = null;

// === 等级配置表 ===
const LEVEL_TABLE = [
    { lv: 1,  xp: 0,    title: "废铁平民" },
    { lv: 2,  xp: 100,  title: "普通公民" },
    { lv: 3,  xp: 250,  title: "进阶行者" },
    { lv: 4,  xp: 500,  title: "精英干员" },
    { lv: 5,  xp: 900,  title: "战术大师" },
    { lv: 6,  xp: 1500, title: "传奇英雄" },
    { lv: 7,  xp: 2400, title: "深渊行者" },
    { lv: 8,  xp: 3700, title: "猩红收割" },
    { lv: 9,  xp: 5500, title: "黄金传说" },
    { lv: 10, xp: 8000, title: "赛博神明" }
];

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

function calculateLevel(xp) {
    let currentLv = 1;
    let nextXp = 100;
    let prevXp = 0;
    for (let i = 0; i < LEVEL_TABLE.length; i++) {
        if (xp >= LEVEL_TABLE[i].xp) {
            currentLv = LEVEL_TABLE[i].lv;
            prevXp = LEVEL_TABLE[i].xp;
            if (i < LEVEL_TABLE.length - 1) nextXp = LEVEL_TABLE[i+1].xp;
            else nextXp = 99999;
        }
    }
    let percent = 0;
    if(nextXp !== 99999) percent = ((xp - prevXp) / (nextXp - prevXp)) * 100;
    else percent = 100;
    return { lv: currentLv, percent: Math.min(100, Math.max(0, percent)), next: nextXp };
}

// --- 核心：统一生成所有徽章 HTML ---
function getBadgesHtml(userObj) {
    let html = '';
    // 1. Admin 徽章
    if (userObj.role === 'admin' || userObj.author_role === 'admin') {
        html += `<span class="badge admin-tag">ADMIN</span>`;
    }
    // 2. 自定义头衔徽章 (优先取 author_title, 没有则取 custom_title)
    const title = userObj.author_title || userObj.custom_title;
    const color = userObj.author_title_color || userObj.custom_title_color || '#fff';
    if (title) {
        html += `<span class="badge custom-tag" style="color:${color};border-color:${color}">${title}</span>`;
    }
    // 3. 等级徽章
    const xp = userObj.xp !== undefined ? userObj.xp : 0;
    const lvInfo = calculateLevel(xp);
    html += `<span class="badge lv-${lvInfo.lv}">LV.${lvInfo.lv}</span>`;
    
    // 4. VIP 徽章
    const isVip = userObj.is_vip || userObj.author_vip;
    if (isVip) {
        html += `<span class="badge vip-tag">VIP</span>`;
    }
    
    return html;
}

// --- 动态渲染等级表 ---
function renderLevelTable() {
    const tbody = document.getElementById('levelTableBody');
    if(!tbody) return;
    tbody.innerHTML = LEVEL_TABLE.map(item => `
        <tr>
            <td><span class="badge lv-${item.lv}">LV.${item.lv}</span></td>
            <td>${item.title}</td>
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
                // 新增：如果是管理员，允许发公告
                document.getElementById('optAdmin').style.display = 'block';
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

            // 使用统一函数渲染侧边栏徽章
            const badgesArea = document.getElementById('badgesArea');
            badgesArea.innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
            
            const levelInfo = calculateLevel(data.xp || 0);
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
            document.getElementById('logoutBtn').onclick = doLogout;

            if (userRole === 'admin') {
                document.getElementById('navAdmin').style.display = 'flex';
            }

            if(data.is_vip) {
                document.getElementById('vipBox').innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                document.getElementById('vipBox').style.borderColor = 'gold';
            }

            checkNotifications();
            setInterval(checkNotifications, 60000);
            
            // 渲染关于页面的等级表
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

// 修复 loadPosts 函数

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
            
            // --- 处理分类标签 ---
            const cat = post.category || '灌水';
            let catClass = '';
            if(cat === '技术') catClass = 'cat-tech';
            else if(cat === '生活') catClass = 'cat-life';
            else if(cat === '提问') catClass = 'cat-question';
            else if(cat === '公告') catClass = 'cat-announce';
            
            const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;
            const isAnnounceClass = cat === '公告' ? 'is-announce' : '';

            // 徽章生成
            const badgeHtml = getBadgesHtml({
                role: post.author_role,
                custom_title: post.author_title,
                custom_title_color: post.author_title_color,
                is_vip: post.author_vip,
                xp: post.author_xp
            });
            
            // 点赞按钮
            const likeClass = post.is_liked ? 'liked' : '';
            const likeBtn = `<button class="like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike(${post.id}, 'post', this)">
                ❤ <span class="count">${post.like_count || 0}</span>
            </button>`;
            
            // === 关键修复：先定义 div，再赋值 ===
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

// --- 修复 script.js 中的 loadSinglePost 函数 ---

async function loadSinglePost(id) {
    currentPostId = id;
    const container = document.getElementById('single-post-content');
    if(!container) return;
    container.innerHTML = '读取中...';
    document.getElementById('commentsList').innerHTML = '';

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        if (!post) { container.innerHTML = '<h1>404</h1>'; return; }

        const date = new Date(post.created_at).toLocaleString();
        
        // 1. 定义操作按钮 (删除/封号)
        let actionBtns = '';
        if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) {
            actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`;
        }
        if (userRole === 'admin' && post.user_id !== currentUser.id) {
            actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`;
        }

        // 2. 定义打赏按钮
        let tipBtn = '';
        if (currentUser.id !== post.user_id) {
            tipBtn = `<button onclick="tipUser(${post.user_id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`;
        }
        
        const authorDisplay = post.author_nickname || post.author_username;
        
        // 3. 定义头像 (关键修复：之前报过错)
        const avatarSvg = generatePixelAvatar(post.author_username || "default", post.author_avatar_variant || 0);

        // 4. 定义徽章
        const badgeObj = {
            role: post.author_role,
            custom_title: post.author_title,
            custom_title_color: post.author_title_color,
            is_vip: post.author_vip,
            xp: 0 
        };
        const badgesHtml = getBadgesHtml(badgeObj);

        // 5. 定义分类标签
        const cat = post.category || '灌水';
        let catClass = '';
        if(cat === '公告') catClass = 'cat-announce';
        else if(cat === '技术') catClass = 'cat-tech';
        else if(cat === '生活') catClass = 'cat-life';
        else if(cat === '提问') catClass = 'cat-question';
        const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`;

        // 6. === 核心修复：定义点赞按钮 (likeBtn) ===
        // 之前报错就是因为缺了这一段！
        const likeClass = post.is_liked ? 'liked' : '';
        const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;

        // 7. 渲染 HTML
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
async function loadNativeComments(postId) {
    const list = document.getElementById('commentsList');
    list.innerHTML = 'Loading comments...';
    try {
        const res = await fetch(`${API_BASE}/comments?post_id=${postId}`);
        const comments = await res.json();
        list.innerHTML = '';
        if(comments.length === 0) {
            list.innerHTML = '<p style="color:#666">暂无评论，抢占沙发。</p>';
            return;
        }
        comments.forEach(c => {
            const avatar = generatePixelAvatar(c.username, c.avatar_variant);
            const div = document.createElement('div');
            div.className = 'comment-item';
            
            let delCommentBtn = '';
            if (userRole === 'admin' || currentUser.id === c.user_id) {
                delCommentBtn = `<span onclick="deleteComment(${c.id})" style="color:#555;cursor:pointer;font-size:0.7rem;margin-left:10px">[删除]</span>`;
            }

            // 评论区徽章 (API返回了全套数据)
            const badgeHtml = getBadgesHtml(c);

            div.innerHTML = `
                <div class="comment-avatar">${avatar}</div>
                <div class="comment-content-box">
                    <div class="comment-header">
                        <span class="comment-author" style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                            ${c.nickname || c.username} ${badgeHtml}
                        </span>
                        <span>${new Date(c.created_at).toLocaleString()} ${delCommentBtn}</span>
                    </div>
                    <div class="comment-text">${c.content}</div>
                </div>
            `;
            list.appendChild(div);
        });
    } catch(e) { list.innerHTML = 'Failed to load comments.'; }
}

// ... (复制密钥、消息、打赏、删除等功能函数保持不变) ...
// ... 为节省篇幅，请确保下面的辅助函数都在 (copyRecoveryKey, checkNotifications, loadNotifications, markAllRead, submitComment, deletePost, doPost, doCheckIn, doLogout, tipUser, deleteComment, adminBanUser, adminGenKey) ...

// 新增：管理员发放头衔
window.adminGrantTitle = async function() {
    const username = document.getElementById('adminTitleUser').value;
    const title = document.getElementById('adminTitleText').value;
    const color = document.getElementById('adminTitleColor').value;
    
    if(!username) return alert("请输入用户名");
    
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                action: 'grant_title', 
                target_username: username,
                title: title,
                color: color
            })
        });
        const data = await res.json();
        if(data.success) { alert("头衔发放成功！"); }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
};

// 补全之前提到的函数
window.copyRecoveryKey = function() {
    const keyInput = document.getElementById('recoveryKeyDisplay');
    keyInput.select();
    document.execCommand('copy'); 
    alert("密钥已复制到剪贴板");
};

async function checkNotifications() {
    try {
        const res = await fetch(`${API_BASE}/notifications`);
        const data = await res.json();
        const badge = document.getElementById('notifyBadge');
        if (data.count > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = data.count;
        } else { badge.style.display = 'none'; }
    } catch(e) {}
}

async function loadNotifications() {
    const container = document.getElementById('notifyList');
    container.innerHTML = 'Loading logs...';
    try {
        const res = await fetch(`${API_BASE}/notifications`);
        const data = await res.json();
        container.innerHTML = '';
        if(data.list.length === 0) { container.innerHTML = '<p style="color:#666">暂无消息 / NO LOGS</p>'; return; }
        data.list.forEach(n => {
            const div = document.createElement('div');
            div.className = `notify-item ${n.is_read ? '' : 'unread'}`;
            div.innerHTML = `<div class="notify-msg">${n.message}</div><div class="notify-time">${new Date(n.created_at).toLocaleString()}</div>`;
            div.onclick = () => { window.location.hash = n.link; };
            container.appendChild(div);
        });
    } catch(e) { container.innerHTML = 'Error'; }
}

window.markAllRead = async function() {
    await fetch(`${API_BASE}/notifications`, { method: 'POST' });
    loadNotifications(); checkNotifications();
};

window.submitComment = async function() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if(!content) return alert("内容不能为空");
    const btn = document.querySelector('.comment-input-box button');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/comments`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ post_id: currentPostId, content: content })
        });
        const data = await res.json();
        if(data.success) { alert(data.message); input.value = ''; loadNativeComments(currentPostId); }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
    finally { btn.disabled = false; }
};

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

window.randomizeAvatar = async function() {
    if(!confirm("确定重置头像颜色吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/random_avatar`, { method: 'POST' });
        const data = await res.json();
        if(data.success) {
            alert("重置成功！");
            currentUser.avatar_variant = data.variant;
            const newSvg = generatePixelAvatar(currentUser.username, data.variant);
            document.querySelector('#avatarContainer .post-avatar-box').innerHTML = newSvg;
            document.getElementById('settingAvatarPreview').innerHTML = newSvg;
        } else { alert(data.error); }
    } catch(e) { alert("操作失败"); }
};

window.doLuckyDraw = async function() {
    const btn = document.querySelector('.lucky-draw-btn');
    if(btn) { btn.disabled = true; btn.textContent = "DRAWING..."; }
    try {
        const res = await fetch(`${API_BASE}/draw`, { method: 'POST' });
        const data = await res.json();
        if(data.success) { alert(`🎉 ${data.message}`); window.location.reload(); }
        else { alert(`🚫 ${data.error}`); }
    } catch(e) { alert("系统繁忙"); } 
    finally { if(btn) { btn.disabled = false; btn.textContent = "🎲 每日幸运抽奖"; } }
};

window.updateProfile = async function() {
    const nick = document.getElementById('newNickname').value;
    if(!nick) return alert("请输入昵称");
    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({nickname: nick})
        });
        const data = await res.json();
        if(data.success) { alert("修改成功"); window.location.reload(); }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
};

window.buyVip = async function() {
    if(!confirm("确认消耗50 i币开通VIP吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/vip`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || data.error);
        if(data.success) window.location.reload();
    } catch(e) { alert("Error"); }
};

window.deletePost = async function(id) {
    if (!confirm("⚠️ 警告：确定要永久删除这篇文章吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) { alert("已删除"); window.location.hash = '#home'; }
        else { alert(data.error); }
    } catch (e) { alert("Fail"); }
};

//修改 doPost (发送 category)
async function doPost(e) {
    e.preventDefault();
    const title = document.getElementById('postTitle').value;
    const content = document.getElementById('postContent').value;
    // 新增：获取分类
    const category = document.getElementById('postCategory').value;
    
    const btn = document.querySelector('#postForm button');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/posts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                title, 
                content, 
                category // 发送分类
            })
        });
        const data = await res.json();
        if (data.success) { 
            alert(data.message); 
            window.location.hash = '#home'; 
            document.getElementById('postTitle').value=''; 
            document.getElementById('postContent').value=''; 
        }
        else { alert(data.error); }
    } catch(err) { alert("Error"); } 
    finally { btn.disabled = false; }
}


async function doCheckIn() {
    const btn = document.getElementById('checkInBtn');
    if(btn.disabled) return;
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/checkin`, { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        if(data.coins) window.location.reload(); 
    } catch(e) { alert("Error"); } 
    finally { btn.disabled = false; }
}

async function doLogout() {
    if(confirm("Disconnect?")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.href = '/login.html';
    }
}

window.tipUser = async function(targetId) {
    const amount = prompt("请输入打赏金额 (i币):");
    if (!amount) return;
    if (isNaN(amount) || amount <= 0) return alert("请输入有效数字");
    try {
        const res = await fetch(`${API_BASE}/tip`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_user_id: targetId, amount: amount })
        });
        const data = await res.json();
        if (data.success) { alert(data.message); window.location.reload(); }
        else { alert(data.error); }
    } catch (e) { alert("打赏失败"); }
};

window.deleteComment = async function(commentId) {
    if(!confirm("确认删除此评论？")) return;
    try {
        const res = await fetch(`${API_BASE}/comments?id=${commentId}`, { method: 'DELETE' });
        const data = await res.json();
        if(data.success) { loadNativeComments(currentPostId); }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
};

// === 修改：管理员封号 (支持天数) ===
window.adminBanUser = async function(userId) {
    // 弹出选项
    const daysStr = prompt("【高危操作】请输入封禁天数：\n1, 3, 7, 14, 30, 365, 9999(永久)", "1");
    if (daysStr === null) return; // 取消
    
    const days = parseInt(daysStr);
    if (isNaN(days) || days <= 0) return alert("请输入有效天数");

    if(!confirm(`确定要封禁该用户 ${days} 天吗？`)) return;

    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                action: 'ban_user', 
                target_user_id: userId,
                days: days // 发送天数
            })
        });
        const data = await res.json();
        if(data.success) alert(data.message);
        else alert(data.error);
    } catch(e) { alert("Error"); }
};

window.adminGenKey = async function() {
    const username = document.getElementById('adminTargetUser').value;
    if(!username) return alert("请输入用户名");
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'gen_key', target_username: username })
        });
        const data = await res.json();
        if(data.success) { document.getElementById('adminKeyResult').innerHTML = `KEY: ${data.key} <br>(请手动发送给用户)`; }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
};

// === 新增：管理员发布公告 ===
window.adminPostAnnounce = async function() {
    const title = document.getElementById('adminAnnounceTitle').value;
    const content = document.getElementById('adminAnnounceContent').value;
    
    if(!title || !content) return alert("标题和内容不能为空");
    
    if(!confirm("确认发布全站公告？")) return;

    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                action: 'post_announce', 
                title: title,
                content: content
            })
        });
        const data = await res.json();
        if(data.success) { 
            alert("公告发布成功！");
            document.getElementById('adminAnnounceTitle').value = '';
            document.getElementById('adminAnnounceContent').value = '';
            window.location.hash = '#home'; // 跳回首页看效果
        }
        else { alert(data.error); }
    } catch(e) { alert("Error"); }
};

// === 新增：点赞功能 ===
window.toggleLike = async function(targetId, type, btn) {
    // 简单的防抖
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
            // 如果是没登录，可能会报401
            if(res.status === 401) alert("请先登录");
            else alert(data.error);
        }
    } catch(e) { console.error(e); }
    finally { btn.disabled = false; }
};

// === 新增：管理员生成邀请码 ===
window.adminGenInvite = async function() {
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'gen_invite' })
        });
        const data = await res.json();
        if(data.success) {
            document.getElementById('adminInviteResult').innerText = data.code;
        } else { alert(data.error); }
    } catch(e) { alert("Error"); }
};



