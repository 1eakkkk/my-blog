// --- START OF FILE script.js ---
let userRole = 'user'; // 'admin' or 'user'
const API_BASE = '/api';
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
            userRole = data.role || 'user'; // 获取角色

            // 如果是管理员，显示后台入口
            if (userRole === 'admin') {
                document.getElementById('navAdmin').style.display = 'block';
            }

            // ... (原来的渲染逻辑保持不变) ...
            // ... 渲染头像、等级、经验条 ...
            
            // (这里省略原来的代码，请保留你原来的头像/等级渲染代码)
            const displayName = data.nickname || data.username;
            document.getElementById('username').textContent = displayName;
            document.getElementById('coinCount').textContent = data.coins;
            document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${generatePixelAvatar(data.username, data.avatar_variant)}</div>`;
            
            const levelInfo = calculateLevel(data.xp || 0);
            const badgesArea = document.getElementById('badgesArea');
            // VIP 标签
            let vipTag = data.is_vip ? `<span class="badge vip-tag">VIP</span>` : '';
            // 管理员标签
            let adminTag = userRole === 'admin' ? `<span class="badge" style="background:#ff3333;color:white;margin-right:5px">ADMIN</span>` : '';

            badgesArea.innerHTML = `
                ${adminTag}
                <span class="badge lv-${levelInfo.lv}">LV.${levelInfo.lv}</span> 
                ${vipTag}
                <div id="logoutBtn">EXIT</div>
            `;
            
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
            document.getElementById('logoutBtn').onclick = doLogout;

            if(data.is_vip) {
                document.getElementById('vipBox').innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                document.getElementById('vipBox').style.borderColor = 'gold';
            }
            // ... (结束) ...

            checkNotifications();
            setInterval(checkNotifications, 60000);

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

// === 复制密钥功能 ===
window.copyRecoveryKey = function() {
    const keyInput = document.getElementById('recoveryKeyDisplay');
    keyInput.select();
    document.execCommand('copy'); // 兼容旧浏览器
    // 或者 navigator.clipboard.writeText(keyInput.value);
    alert("密钥已复制到剪贴板");
};

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
            
            // 删除评论按钮：作者本人 或 管理员 可删
            let delCommentBtn = '';
            if (userRole === 'admin' || currentUser.id === c.user_id) {
                delCommentBtn = `<span onclick="deleteComment(${c.id})" style="color:#555;cursor:pointer;font-size:0.7rem;margin-left:10px">[删除]</span>`;
            }

            const vip = c.is_vip ? `<span style="color:gold;font-size:0.7em">[VIP]</span>` : '';
            div.innerHTML = `
                <div class="comment-avatar">${avatar}</div>
                <div class="comment-content-box">
                    <div class="comment-header">
                        <span class="comment-author">
                            ${vip} ${c.nickname || c.username} 
                            <span class="badge lv-${c.level||1}" style="transform:scale(0.8)">LV.${c.level||1}</span>
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
    notifications: document.getElementById('view-notifications')
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

async function loadPosts() {
    const container = document.getElementById('posts-list');
    if(!container) return;
    container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    try {
        const res = await fetch(`${API_BASE}/posts`);
        const posts = await res.json();
        container.innerHTML = '';
        if (posts.length === 0) { container.innerHTML = '<p style="color:#666; text-align:center">暂无文章。</p>'; return; }
        posts.forEach(post => {
            const date = new Date(post.created_at).toLocaleDateString();
            const author = post.author_nickname || "Unknown";
            const vipBadge = post.author_vip ? `<span style="color:gold;font-weight:bold">[VIP]</span>` : '';
            const div = document.createElement('div');
            div.className = 'post-card';
            div.innerHTML = `
                <div class="post-meta">${date} | ${vipBadge} @${author}</div>
                <h2>${post.title}</h2>
                <div class="post-snippet">${post.content.substring(0, 100)}...</div>
            `;
            div.onclick = () => window.location.hash = `#post?id=${post.id}`;
            container.appendChild(div);
        });
    } catch (e) { container.innerHTML = '<p style="color:red">无法获取数据流。</p>'; }
}

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
        
        // 删除按钮逻辑：作者本人 或 管理员 可删
        let actionBtns = '';
        if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) {
            actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`;
        }
        
        // 管理员封号按钮 (不能封自己)
        if (userRole === 'admin' && post.user_id !== currentUser.id) {
            actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`;
        }

        // 打赏按钮 (不能打赏自己)
        let tipBtn = '';
        if (currentUser.id !== post.user_id) {
            tipBtn = `<button onclick="tipUser(${post.user_id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`;
        }
        
        const authorDisplay = post.author_nickname || post.author_username;
        const vipDisplay = post.author_vip ? `<span style="color:gold;margin-right:5px">[VIP]</span>` : '';
        const avatarSvg = generatePixelAvatar(post.author_username || "default", post.author_avatar_variant || 0);

        container.innerHTML = `
            <div class="post-header-row">
                <div class="post-author-info">
                    <div class="post-avatar-box">${avatarSvg}</div>
                    <div class="post-meta-text">
                        <span style="color:#fff; font-size:1rem; font-weight:bold;">
                            ${vipDisplay}${authorDisplay} <span class="badge lv-${post.author_level||1}" style="transform:scale(0.8)">LV.${post.author_level||1}</span>
                        </span>
                        <span>ID: ${post.id} // ${date}</span>
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

window.deletePost = async function(id) {
    if (!confirm("⚠️ 警告：确定要永久删除这篇文章吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) { alert("已删除"); window.location.hash = '#home'; }
        else { alert(data.error); }
    } catch (e) { alert("Fail"); }
};

async function doPost(e) {
    e.preventDefault();
    const title = document.getElementById('postTitle').value;
    const content = document.getElementById('postContent').value;
    const btn = document.querySelector('#postForm button');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/posts`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title, content})
        });
        const data = await res.json();
        if (data.success) { alert("发布成功！经验已增加"); window.location.hash = '#home'; document.getElementById('postTitle').value=''; document.getElementById('postContent').value=''; }
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

// 打赏功能
window.tipUser = async function(targetId) {
    const amount = prompt("请输入打赏金额 (i币):");
    if (!amount) return;
    if (isNaN(amount) || amount <= 0) return alert("请输入有效数字");

    try {
        const res = await fetch(`${API_BASE}/tip`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_user_id: targetId, amount: amount })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            window.location.reload(); // 刷新更新余额
        } else {
            alert(data.error);
        }
    } catch (e) { alert("打赏失败"); }
};

// 删除评论
window.deleteComment = async function(commentId) {
    if(!confirm("确认删除此评论？")) return;
    try {
        const res = await fetch(`${API_BASE}/comments?id=${commentId}`, { method: 'DELETE' });
        const data = await res.json();
        if(data.success) {
            loadNativeComments(currentPostId); // 局部刷新评论
        } else {
            alert(data.error);
        }
    } catch(e) { alert("Error"); }
};

// 管理员封号
window.adminBanUser = async function(userId) {
    if(!confirm("【高危操作】确定要封禁该用户吗？该用户将无法登录。")) return;
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'ban_user', target_user_id: userId })
        });
        const data = await res.json();
        if(data.success) alert("用户已封禁");
        else alert(data.error);
    } catch(e) { alert("Error"); }
};

// 管理员生成密钥
window.adminGenKey = async function() {
    const username = document.getElementById('adminTargetUser').value;
    if(!username) return alert("请输入用户名");
    
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'gen_key', target_username: username })
        });
        const data = await res.json();
        if(data.success) {
            document.getElementById('adminKeyResult').innerHTML = `KEY: ${data.key} <br>(请手动发送给用户)`;
        } else {
            alert(data.error);
        }
    } catch(e) { alert("Error"); }
};

// 不要忘记把 'admin' 加入路由视图
async function handleRoute() {
    // ... (前面代码不变) ...
    } else if (hash === '#admin') { // 新增
        if(userRole !== 'admin') { window.location.hash='#home'; return; }
        if(views.admin) views.admin.style.display = 'block'; // 需在 views 对象中添加 admin
    } 
    // ...
}

// 记得在 views 对象里加 admin
views.admin = document.getElementById('view-admin');
