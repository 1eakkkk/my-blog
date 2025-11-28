// --- START OF FILE script.js ---

const API_BASE = '/api';
let userRole = 'user';
let currentUser = null;
let currentPostId = null;
let returnToNotifications = false;
let isAppReady = false;

// 分页 & 状态
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

// --- 辅助函数 ---

window.showToast = function(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if(!container) return alert(msg); // 降级处理

    const div = document.createElement('div');
    div.className = `cyber-toast ${type}`;
    // 图标
    let icon = 'ℹ️';
    if(type === 'success') icon = '✅';
    if(type === 'error') icon = '❌';
    
    div.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(div);

    // 3秒后移除 DOM
    setTimeout(() => {
        div.remove();
    }, 3100);
};

// Markdown 渲染辅助函数
function parseMarkdown(text) {
    if (!text) return '';
    // 1. 解析 MD 为 HTML
    const rawHtml = marked.parse(text);
    // 2. 净化 HTML，防止恶意脚本
    return DOMPurify.sanitize(rawHtml);
}

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

// === 新增：渲染等级表函数 (请确保加入到 script.js 中) ===
function renderLevelTable() {
    const tbody = document.getElementById('levelTableBody');
    // 如果找不到表格或者表格里已经有内容，就停止，防止重复添加
    if (!tbody || tbody.children.length > 0) return; 

    // 这里的 LEVEL_TABLE 必须与 script.js 顶部定义的一致
    LEVEL_TABLE.forEach(l => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>LV.${l.lv}</td>
            <td><span class="badge lv-${l.lv}">${l.title}</span></td>
            <td>${l.xp} XP</td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadTasks() { 
    const c=document.getElementById('taskContainer'); 
    try{ 
        const res=await fetch(`${API_BASE}/tasks`); 
        const t=await res.json(); 
        
        const navTask = document.querySelector('a[href="#tasks"]');
        if(navTask) {
            if (t.progress >= t.target && !t.is_claimed) {
                navTask.innerHTML = `每日任务 / Daily Tasks <span style="background:#0f0;width:8px;height:8px;border-radius:50%;display:inline-block;"></span>`;
            } else {
                navTask.innerHTML = `每日任务 / Daily Tasks`;
            }
        }

        if(!c) return; 
        
        c.innerHTML='Loading...'; 
        const m={'checkin':'每日签到','post':'发布文章','comment':'发表评论'}; 
        const done=t.progress>=t.target; 
        const btn=t.is_claimed?`<button class="cyber-btn" disabled>已完成 / CLAIMED</button>`:(done?`<button onclick="claimTask()" class="cyber-btn" style="border-color:#0f0;color:#0f0">领取奖励</button>`:`<button class="cyber-btn" disabled>进行中</button>`); 
        const rr=(t.reroll_count===0&&!t.is_claimed)?`<button onclick="rerollTask()" class="cyber-btn" style="margin-top:10px;border-color:orange;color:orange">刷新 (10i)</button>`:''; 
        c.innerHTML=`<div class="task-card"><div class="task-header"><h3>${m[t.task_type]||t.task_type} (${t.progress}/${t.target})</h3><span>${t.reward_xp}XP, ${t.reward_coins}i</span></div><div class="task-progress-bg"><div class="task-progress-fill" style="width:${Math.min(100,(t.progress/t.target)*100)}%"></div></div>${btn}${rr}</div>`; 
    }catch(e){ if(c) c.innerHTML = 'Error loading tasks'; } 
}

// === 修复：补充任务领取和刷新函数 ===

window.claimTask = async function() {
    const btn = document.querySelector('#taskContainer button');
    if(btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/tasks`, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'claim' })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            // 领取成功后，立即刷新状态，更新余额和经验条
            checkSecurity(); // 重新拉取用户信息(余额/XP)
            loadTasks();     // 重新拉取任务状态(红点消失)
        } else {
            alert(data.error);
            if(btn) btn.disabled = false;
        }
    } catch (e) {
        alert("领取失败: 网络错误");
        if(btn) btn.disabled = false;
    }
};

window.rerollTask = async function() {
    if(!confirm("确定消耗 10 i币 刷新今日任务吗？")) return;
    
    try {
        const res = await fetch(`${API_BASE}/tasks`, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'reroll' })
        });
        const data = await res.json();
        if (data.success) {
            alert("任务已刷新！");
            checkSecurity(); // 更新余额
            loadTasks();     // 显示新任务
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert("刷新失败");
    }
};

// 帖子列表
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
                
                // === 修改开始：NEW 标签逻辑 ===
                const readPosts = JSON.parse(localStorage.getItem('read_posts') || '[]');
                const isTimeNew = (now - post.created_at) < (24 * 60 * 60 * 1000);
                // 只有时间新 且 没有读过，才显示 NEW
                const isNew = isTimeNew && !readPosts.includes(post.id);
                const newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';
                // === 修改结束 ===

                const author = post.author_nickname || post.author_username || "Unknown";
                const cat = post.category || '灌水'; 
                let catClass = ''; 
                if(cat === '技术') catClass = 'cat-tech'; else if(cat === '生活') catClass = 'cat-life'; else if(cat === '提问') catClass = 'cat-question'; else if(cat === '公告') catClass = 'cat-announce';
                
                const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`; 
                const isAnnounceClass = cat === '公告' ? 'is-announce' : '';
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
                    <div style="display:flex; justify-content:space-between; align-items:flex-start"><h2 style="margin:0">${post.title}</h2></div>
                    const cleanText = DOMPurify.sanitize(marked.parse(post.content), {ALLOWED_TAGS: []});
                    <div class="post-snippet">${cleanText.substring(0, 100)}...</div>
                    <div class="post-footer" style="margin-top:15px; padding-top:10px; border-top:1px dashed #222; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem; color:#666;">
                        <div>💬 <span class="count">${commentCount}</span> 评论</div>
                        <div>${likeBtn}</div>
                    </div>
                `;

                // === 修改开始：点击事件 ===
                div.onclick = () => { 
                    // 记录已读
                    const currentRead = JSON.parse(localStorage.getItem('read_posts') || '[]');
                    if (!currentRead.includes(post.id)) {
                        currentRead.push(post.id);
                        localStorage.setItem('read_posts', JSON.stringify(currentRead));
                    }

                    returnToNotifications = false; 
                    window.location.hash = `#post?id=${post.id}`; 
                }; 
                // === 修改结束 ===

                container.appendChild(div);
            });
            currentPage++;
        }
    } catch (e) { console.error(e); }
    finally { 
        isLoadingPosts = false; 
        if (loadMoreBtn) { 
            loadMoreBtn.style.display = hasMorePosts ? 'block' : 'none'; 
            if(isLoadingPosts) loadMoreBtn.textContent = "LOADING..."; else loadMoreBtn.textContent = '加载更多 / LOAD MORE'; 
        } 
    }
}

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

        // === 1. 封禁状态拦截 ===
        if (data.status === 'banned') {
            const expireDate = new Date(data.ban_expires_at).toLocaleString();
            const reason = data.ban_reason || "违反社区规定";
            
            if (mask) {
                mask.style.backgroundColor = '#110000';
                mask.innerHTML = `
                    <div style="border: 2px solid #ff3333; padding: 30px; background: #000; max-width: 90%; text-align: center;">
                        <h1 style="color: #ff3333; margin-top: 0;">🚫 ACCESS DENIED</h1>
                        <h2 style="color: #fff;">账号已被系统封禁</h2>
                        <div style="margin: 20px 0; text-align: left; color: #ccc; font-size: 0.9rem;">
                            <p><strong>封禁理由 / REASON:</strong><br><span style="color: #ff3333">${reason}</span></p>
                            <p><strong>解封时间 / EXPIRES:</strong><br><span style="color: #0f0">${expireDate}</span></p>
                        </div>
                        <p style="color: #666; font-size: 0.8rem;">在此期间您无法进行任何操作。</p>
                        <button onclick="doLogout()" class="cyber-btn" style="border-color: #666; color: #666; margin-top: 20px;">退出登录 / LOGOUT</button>
                    </div>
                `;
                mask.style.opacity = '1';
                return; // 停止向下执行
            }
        }

        // === 2. 正常登录逻辑 (你之前缺失的部分都在这里) ===
        currentUser = data;
        userRole = data.role || 'user';
        isAppReady = true;

        // 更新侧边栏用户信息
        const settingUser = document.getElementById('settingUsername');
        if(settingUser) settingUser.value = data.username;

        // 更新用户名和 i币
        document.getElementById('username').textContent = data.nickname || data.username;
        document.getElementById('coinCount').textContent = data.coins;
        
        // 更新头像
        document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${generatePixelAvatar(data.username, data.avatar_variant)}</div>`;
        const settingPreview = document.getElementById('settingAvatarPreview');
        if(settingPreview) settingPreview.innerHTML = generatePixelAvatar(data.username, data.avatar_variant);
        
        // 更新密钥显示
        const keyDisplay = document.getElementById('recoveryKeyDisplay');
        if(keyDisplay) keyDisplay.value = data.recovery_key || "未生成";
        
        // 更新徽章偏好设置
        const badgePrefSelect = document.getElementById('badgePreferenceSelect');
        if(badgePrefSelect) badgePrefSelect.value = data.badge_preference || 'number';
        
        // 更新徽章区域和退出按钮
        document.getElementById('badgesArea').innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
        
        // 更新经验条
        const levelInfo = calculateLevel(data.xp || 0);
        document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
        document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
        
        // 绑定退出按钮事件
        document.getElementById('logoutBtn').onclick = doLogout;

        // 管理员菜单处理
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
            const adminNav = document.getElementById('navAdmin');
            if(adminNav) adminNav.style.display = 'none';
        }

        // VIP 状态处理
        if(data.is_vip) {
            const vipBox = document.getElementById('vipBox');
            if(vipBox) {
                vipBox.innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                vipBox.style.borderColor = 'gold';
            }
        }

        // 初始化其他数据
        checkNotifications();
        setInterval(() => {
            checkNotifications();
            loadTasks(); 
        }, 60000);
        loadTasks(); 
        checkForDrafts();
        
        handleRoute();

        // 移除加载遮罩
        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }

    } catch (e) { 
        console.error("CheckSecurity Error:", e); 
        // 出错时也要移除遮罩，否则用户会卡死，但通常建议检查控制台看具体是什么错
        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
    }
}

function initApp() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) { 
        mobileMenuBtn.onclick = (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); }; 
    }
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn) { sidebar.classList.remove('open'); }
    });
    
    const checkInBtn = document.getElementById('checkInBtn'); 
    if (checkInBtn) checkInBtn.onclick = window.doCheckIn;
    
    const postForm = document.getElementById('postForm'); 
    if (postForm) postForm.onsubmit = doPost;
    
    window.addEventListener('hashchange', handleRoute);
    
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
    
    if(isAppReady) handleRoute();
}

// === 路由定义 ===
const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    tasks: document.getElementById('view-tasks'),
    post: document.getElementById('view-post'),
    settings: document.getElementById('view-settings'),
    about: document.getElementById('view-about'),
    notifications: document.getElementById('view-notifications'),
    feedback: document.getElementById('view-feedback'),
    admin: document.getElementById('view-admin')
};

async function handleRoute() {
    const hash = window.location.hash || '#home';
    const sidebar = document.getElementById('sidebar');
    const navLinks = document.querySelectorAll('.nav-link');
    
    Object.values(views).forEach(el => { if(el) el.style.display = 'none'; });
    navLinks.forEach(el => el.classList.remove('active'));
    if(sidebar) sidebar.classList.remove('open');

    if(!isAppReady && hash === '#admin') return;

    if(hash !== '#write' && isEditingPost) {
        isEditingPost = false; editingPostId = null;
        const btn = document.querySelector('#postForm button');
        if(btn) btn.textContent = "发布 / PUBLISH";
        const t = document.getElementById('postTitle'); if(t) t.value=''; 
        const c = document.getElementById('postContent'); if(c) c.value=''; 
        const cancelBtn = document.getElementById('cancelEditPostBtn');
        if(cancelBtn) cancelBtn.style.display = 'none';
    }

    if (hash === '#home') {
        if(views.home) views.home.style.display = 'block';
        const link = document.querySelector('a[href="#home"]'); if(link) link.classList.add('active');
        loadPosts(true); 
    } else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        const link = document.getElementById('navWrite'); if(link) link.classList.add('active');
        tryRestoreDraft();
     } else if (hash === '#tasks') {
        if(views.tasks) views.tasks.style.display = 'block';
        loadTasks();
    } else if (hash === '#settings') {
        if(views.settings) views.settings.style.display = 'block';
        const link = document.querySelector('a[href="#settings"]'); if(link) link.classList.add('active');
    } else if (hash === '#about') {
        if(views.about) views.about.style.display = 'block';
        const link = document.querySelector('a[href="#about"]'); if(link) link.classList.add('active');
        renderLevelTable();
    } else if (hash === '#notifications') {
        if(views.notifications) views.notifications.style.display = 'block';
        const link = document.getElementById('navNotify'); if(link) link.classList.add('active');
        loadNotifications();
    } else if (hash === '#feedback') {
        if(views.feedback) views.feedback.style.display = 'block';
        const link = document.querySelector('a[href="#feedback"]'); if(link) link.classList.add('active');
    } else if (hash === '#admin') {
        if(userRole !== 'admin') { alert("ACCESS DENIED"); window.location.hash='#home'; return; }
        if(views.admin) {
            views.admin.style.display = 'block';
            const link = document.getElementById('navAdmin'); if(link) link.classList.add('active');
            loadAdminStats();
            loadAdminInvites();
            loadAdminFeedbacks();
            loadAdminBanList();
        }
    } else if (hash.startsWith('#post?id=')) {
        if(views.post) views.post.style.display = 'block';
        loadSinglePost(hash.split('=')[1]);
    }
}

// === 修复：补充签到和抽奖函数 ===

window.doCheckIn = async function() {
    const btn = document.getElementById('checkInBtn');
    if(btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/checkin`, { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        if (data.success) {
            checkSecurity();
            loadTasks();
        }
    } catch (e) {
        alert("签到失败: 网络错误");
    } finally {
        if(btn) btn.disabled = false;
    }
};

window.doLuckyDraw = async function() {
    const btn = document.querySelector('.lucky-draw-btn');
    if(btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/draw`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(data.message);
            window.location.reload();
        } else {
            alert(data.error);
        }
    } catch (e) {
        alert("抽奖失败: 网络错误");
    } finally {
        if(btn) btn.disabled = false;
    }
};
// === 帖子详情 & 评论 ===

async function loadSinglePost(id) {
    currentPostId = id; const container = document.getElementById('single-post-content'); if(!container) return; container.innerHTML = '读取中...'; document.getElementById('commentsList').innerHTML = '';
    const backBtn = document.querySelector('#view-post .back-btn'); if (backBtn) { if (returnToNotifications) { backBtn.textContent = "< 返回通知 / BACK TO LOGS"; backBtn.onclick = () => window.location.hash = '#notifications'; } else { backBtn.textContent = "< 返回 / BACK"; backBtn.onclick = () => window.location.hash = '#home'; } }
    const commentInput = document.getElementById('commentInput'); if(commentInput) { commentInput.value = ''; commentInput.placeholder = "输入你的看法... (支持纯文本)"; commentInput.dataset.parentId = ""; isEditingComment = false; editingCommentId = null; const submitBtn = document.querySelector('.comment-input-box button:first-of-type'); if(submitBtn) submitBtn.textContent = "发送评论 / SEND (+5 XP)"; } const cancelBtn = document.getElementById('cancelReplyBtn'); if (cancelBtn) cancelBtn.style.display = 'none';
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`); const post = await res.json(); if (!post) { container.innerHTML = '<h1>404 - 内容可能已被删除</h1>'; return; }
        
        currentPostAuthorId = post.user_id;

        const rawDate = post.updated_at || post.created_at; const dateStr = new Date(rawDate).toLocaleString(); const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
        
        let actionBtns = ''; if (userRole === 'admin') { const pinText = post.is_pinned ? "取消置顶 / UNPIN" : "置顶 / PIN"; const pinColor = post.is_pinned ? "#0f0" : "#666"; actionBtns += `<button onclick="pinPost(${post.id})" class="delete-btn" style="border-color:${pinColor};color:${pinColor};margin-right:10px">${pinText}</button>`; } if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) { actionBtns += `<button onclick="editPostMode('${post.id}', '${encodeURIComponent(post.title)}', '${encodeURIComponent(post.content)}', '${post.category}')" class="delete-btn" style="border-color:#0070f3;color:#0070f3;margin-right:10px">编辑 / EDIT</button>`; actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`; } if (userRole === 'admin' && post.user_id !== currentUser.id) { actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`; } let tipBtn = ''; if (currentUser.id !== post.user_id) { tipBtn = `<button onclick="tipUser(${post.user_id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`; }
        
        const authorDisplay = post.author_nickname || post.author_username; const avatarSvg = generatePixelAvatar(post.author_username || "default", post.author_avatar_variant || 0); const badgeObj = { role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp || 0, badge_preference: post.author_badge_preference }; const badgesHtml = getBadgesHtml(badgeObj); const cat = post.category || '灌水'; const catHtml = `<span class="category-tag">${cat}</span>`; const likeClass = post.is_liked ? 'liked' : ''; const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;
        container.innerHTML = `<div class="post-header-row"><div class="post-author-info"><div class="post-avatar-box">${avatarSvg}</div><div class="post-meta-text"><span style="color:#fff; font-size:1rem; font-weight:bold; display:flex; align-items:center; gap:5px; flex-wrap:wrap;">${authorDisplay} ${badgesHtml}</span><div style="display:flex; align-items:center; gap:10px; margin-top:5px;"><span>${catHtml} ID: ${post.id} // ${dateStr} ${editedTag}</span>${likeBtn}</div></div></div><div class="post-actions-mobile" style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px;">${actionBtns}${tipBtn}</div></div><h1 style="margin-top:20px;">${post.title}</h1><div class="article-body">${parseMarkdown(post.content)}</div>`;
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
                const commentNode = createCommentElement(c, false, null, globalIndex, currentPostAuthorId);
                list.appendChild(commentNode);
                const myReplies = replies.filter(r => r.parent_id === c.id);
                if (myReplies.length > 0) {
                    const replyContainer = document.createElement('div'); replyContainer.className = 'replies-container';
                    const visibleReplies = myReplies.slice(0, 3); const hiddenReplies = myReplies.slice(3);
                    visibleReplies.forEach(r => { replyContainer.appendChild(createCommentElement(r, true, c.user_id, 0, currentPostAuthorId)); });
                    if (hiddenReplies.length > 0) {
                        const foldBtn = document.createElement('div'); foldBtn.className = 'reply-fold-btn'; foldBtn.innerText = `查看剩余 ${hiddenReplies.length} 条回复...`;
                        foldBtn.onclick = () => { hiddenReplies.forEach(r => { replyContainer.insertBefore(createCommentElement(r, true, c.user_id, 0, currentPostAuthorId), foldBtn); }); foldBtn.remove(); };
                        replyContainer.appendChild(foldBtn);
                    }
                    list.appendChild(replyContainer);
                }
            });
            currentCommentPage++;
        }
    } catch(e) { console.error(e); } finally { isLoadingComments = false; if (!document.getElementById('loadCommentsBtn')) { const btn = document.createElement('button'); btn.id = 'loadCommentsBtn'; btn.className = 'cyber-btn'; btn.style.marginTop = '20px'; btn.onclick = () => loadNativeComments(postId, false); list.parentNode.insertBefore(btn, list.nextSibling); } const btn = document.getElementById('loadCommentsBtn'); if (hasMoreComments) { btn.style.display = 'block'; btn.textContent = '加载更多评论 / LOAD COMMENTS'; } else { btn.style.display = 'none'; } }
}

function createCommentElement(c, isReply, rootOwnerId, floorNumber, postAuthorId) {
    const avatar = generatePixelAvatar(c.username, c.avatar_variant); const div = document.createElement('div'); div.className = isReply ? 'comment-item sub-comment' : 'comment-item'; if(c.is_pinned) { div.style.border = "1px solid #0f0"; div.style.background = "rgba(0,255,0,0.05)"; }
    let actionLinks = ''; if (userRole === 'admin' || currentUser.id === c.user_id) { actionLinks += `<span onclick="deleteComment(${c.id})" class="action-link">[删除]</span>`; actionLinks += `<span onclick="editCommentMode(${c.id}, '${encodeURIComponent(c.content)}')" class="action-link" style="color:#0070f3">[编辑]</span>`; } if (userRole === 'admin' && !isReply) { const pinTxt = c.is_pinned ? "取消置顶" : "置顶"; actionLinks += `<span onclick="pinComment(${c.id})" class="action-link" style="color:#0f0">[${pinTxt}]</span>`; }
    const badgeHtml = getBadgesHtml(c); const likeClass = c.is_liked ? 'liked' : ''; const likeBtn = `<button class="like-btn mini ${likeClass}" onclick="event.stopPropagation(); toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count||0}</span></button>`; const replyBtn = `<span class="reply-action-btn" onclick="prepareReply(${c.id}, '${c.nickname || c.username}')">↩ 回复</span>`; const pinnedBadge = c.is_pinned ? '<span style="color:#0f0;font-weight:bold;font-size:0.7rem;margin-right:5px">📌置顶</span>' : '';
    let replyIndicator = ''; if (c.reply_to_uid && rootOwnerId && c.reply_to_uid != rootOwnerId) { const targetName = c.reply_to_nickname || c.reply_to_username || "Unknown"; replyIndicator = `<span class="reply-indicator">回复 @${targetName}</span> `; }
    let floorTag = ''; if (!isReply && floorNumber) floorTag = `<span class="floor-tag">${getFloorName(floorNumber)}</span>`;
    let authorTag = ''; if (postAuthorId && c.user_id === postAuthorId) { authorTag = `<span class="author-tag">📝 作者</span>`; }
    div.innerHTML = `<div class="comment-avatar">${avatar}</div><div class="comment-content-box"><div class="comment-header"><span class="comment-author">${c.nickname || c.username} ${authorTag} ${badgeHtml}</span>${floorTag}</div><div class="comment-meta-row">${pinnedBadge} ${new Date(c.created_at).toLocaleString()}<div class="comment-actions">${likeBtn} ${replyBtn} ${actionLinks}</div></div><div class="comment-text">${replyIndicator}${c.content}</div></div>`; return div;
}

// === 交互函数 ===

window.submitFeedback = async function() {
    const content = document.getElementById('feedbackContent').value;
    if(!content || content.length < 5) return alert("反馈内容太短");
    try {
        const res = await fetch(`${API_BASE}/feedback`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content})
        });
        const data = await res.json();
        if(data.success) { alert(data.message); document.getElementById('feedbackContent').value = ''; window.location.hash='#home'; }
        else alert(data.error);
    } catch(e) { alert("Error"); }
};

window.uploadImage = async function() {
    const input = document.getElementById('imageUploadInput');
    const status = document.getElementById('uploadStatus');
    const textarea = document.getElementById('postContent');

    if (input.files.length === 0) return;

    const file = input.files[0];
    status.innerText = "UPLOADING...";
    status.style.color = "yellow";

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.success) {
            status.innerText = "DONE";
            status.style.color = "#0f0";
            
            // 自动插入 Markdown 图片语法到光标位置
            const markdown = `\n![image](${data.url})\n`;
            textarea.value += markdown; // 简单追加到末尾
            
            showToast('图片上传成功', 'success');
        } else {
            status.innerText = "ERROR";
            status.style.color = "red";
            showToast(data.error, 'error');
        }
    } catch (e) {
        status.innerText = "FAIL";
        showToast('上传失败', 'error');
    } finally {
        input.value = ''; // 清空，允许重复上传同一张
    }
};

window.editPostMode = function(id, titleEncoded, contentEncoded, category) { isEditingPost = true; editingPostId = id; window.location.hash = '#write'; document.getElementById('postTitle').value = decodeURIComponent(titleEncoded); document.getElementById('postContent').value = decodeURIComponent(contentEncoded); document.getElementById('postCategory').value = category; const btn = document.querySelector('#postForm button'); btn.textContent = "保存修改 / UPDATE POST"; let cancelBtn = document.getElementById('cancelEditPostBtn'); if (!cancelBtn) { cancelBtn = document.createElement('button'); cancelBtn.id = 'cancelEditPostBtn'; cancelBtn.type = 'button'; cancelBtn.className = 'cyber-btn'; cancelBtn.style.marginTop = '10px'; cancelBtn.style.borderColor = '#ff3333'; cancelBtn.style.color = '#ff3333'; cancelBtn.textContent = '取消编辑 / CANCEL'; cancelBtn.onclick = cancelEditPost; btn.parentNode.insertBefore(cancelBtn, btn.nextSibling); } cancelBtn.style.display = 'block'; };
window.cancelEditPost = function() { isEditingPost = false; editingPostId = null; document.querySelector('#postForm button').textContent = "发布 / PUBLISH"; document.getElementById('postTitle').value = ''; document.getElementById('postContent').value = ''; const cancelBtn = document.getElementById('cancelEditPostBtn'); if(cancelBtn) cancelBtn.style.display = 'none'; window.location.hash = '#home'; };
window.editCommentMode = function(id, c) { isEditingComment = true; editingCommentId = id; const input = document.getElementById('commentInput'); input.value = decodeURIComponent(c); input.focus(); input.scrollIntoView(); const btn = document.querySelector('.comment-input-box button:first-of-type'); btn.textContent = "更新评论 / UPDATE"; prepareReply(null, null); const cancelBtn = document.getElementById('cancelReplyBtn'); cancelBtn.textContent = "取消编辑"; cancelBtn.onclick = () => { isEditingComment = false; editingCommentId = null; input.value = ''; btn.textContent = "发送评论 / SEND (+5 XP)"; cancelReply(); }; };
async function doPost(e) { e.preventDefault(); const t = document.getElementById('postTitle').value; const c = document.getElementById('postContent').value; const cat = document.getElementById('postCategory').value; const btn = document.querySelector('#postForm button'); btn.disabled = true; try { let url = `${API_BASE}/posts`; let method = 'POST'; let body = { title: t, content: c, category: cat }; if (isEditingPost) { method = 'PUT'; body = { action: 'edit', id: editingPostId, title: t, content: c, category: cat }; } const res = await fetch(url, { method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }); const data = await res.json(); if (data.success) { alert(data.message); if(!isEditingPost) { localStorage.removeItem('draft_title'); localStorage.removeItem('draft_content'); localStorage.removeItem('draft_cat'); } cancelEditPost(); } else { alert(data.error); } } catch(err) { alert("Error"); } finally { btn.disabled = false; } }
window.submitComment = async function() { const input = document.getElementById('commentInput'); const content = input.value.trim(); const parentId = input.dataset.parentId || null; if(!content) return alert("内容不能为空"); const btn = document.querySelector('.comment-input-box button:first-of-type'); if(btn) btn.disabled = true; try { if (isEditingComment) { const res = await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'edit', id: editingCommentId, content: content }) }); const data = await res.json(); if(data.success) { alert(data.message); window.location.reload(); } else alert(data.error); } else { const res = await fetch(`${API_BASE}/comments`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ post_id: currentPostId, content: content, parent_id: parentId }) }); const data = await res.json(); if(data.success) { alert(data.message); input.value = ''; cancelReply(); loadNativeComments(currentPostId, true); loadTasks(); } else { alert(data.error); } } } catch(e) { alert("Error"); } finally { if(btn) btn.disabled = false; } };
window.prepareReply = function(commentId, username) { const input = document.getElementById('commentInput'); input.dataset.parentId = commentId || ""; input.placeholder = username ? `回复 @${username} ...` : "输入你的看法..."; input.focus(); let cancelBtn = document.getElementById('cancelReplyBtn'); if (!cancelBtn) { cancelBtn = document.createElement('button'); cancelBtn.id = 'cancelReplyBtn'; cancelBtn.className = 'cyber-btn'; cancelBtn.style.width = 'auto'; cancelBtn.style.marginLeft = '10px'; cancelBtn.style.fontSize = '0.8rem'; cancelBtn.style.padding = '5px 10px'; cancelBtn.innerText = '取消回复'; cancelBtn.onclick = cancelReply; document.querySelector('.comment-input-box').appendChild(cancelBtn); } cancelBtn.style.display = 'inline-block'; };
window.cancelReply = function() { const input = document.getElementById('commentInput'); input.dataset.parentId = ""; input.placeholder = "输入你的看法... (支持纯文本)"; const cancelBtn = document.getElementById('cancelReplyBtn'); if(cancelBtn) cancelBtn.style.display = 'none'; };
function checkForDrafts() { const pTitle = document.getElementById('postTitle'); const pContent = document.getElementById('postContent'); const pCat = document.getElementById('postCategory'); if(pTitle && pContent) { const save = () => { if(!isEditingPost) { localStorage.setItem('draft_title', pTitle.value); localStorage.setItem('draft_content', pContent.value); localStorage.setItem('draft_cat', pCat.value); } }; pTitle.addEventListener('input', save); pContent.addEventListener('input', save); pCat.addEventListener('change', save); } }
function tryRestoreDraft() { if(isEditingPost) return; const t = localStorage.getItem('draft_title'); const c = localStorage.getItem('draft_content'); const cat = localStorage.getItem('draft_cat'); if ((t || c) && document.getElementById('postTitle').value === '') { if(confirm("发现未发布的草稿，是否恢复？\n取消则清空草稿。")) { document.getElementById('postTitle').value = t || ''; document.getElementById('postContent').value = c || ''; if(cat) document.getElementById('postCategory').value = cat; } else { localStorage.removeItem('draft_title'); localStorage.removeItem('draft_content'); localStorage.removeItem('draft_cat'); } } }
window.pinPost = async function(id) { if(!confirm("确认更改置顶状态？")) return; await fetch(`${API_BASE}/posts`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadSinglePost(id); };
window.pinComment = async function(id) { if(!confirm("确认更改此评论置顶状态？")) return; await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadNativeComments(currentPostId, true); };
window.deleteNotify = async function(id) { if(!confirm("Delete this log?")) return; await fetch(`${API_BASE}/notifications?id=${id}`, {method: 'DELETE'}); loadNotifications(); };
window.clearAllNotifications = async function() { if(!confirm("Clear ALL logs?")) return; await fetch(`${API_BASE}/notifications?all=true`, {method: 'DELETE'}); loadNotifications(); };
async function loadNotifications() { const c = document.getElementById('notifyList'); c.innerHTML='Loading...'; let clearBtn = document.getElementById('clearAllNotifyBtn'); if(!clearBtn) { clearBtn = document.createElement('button'); clearBtn.id = 'clearAllNotifyBtn'; clearBtn.className = 'cyber-btn'; clearBtn.style.marginBottom = '10px'; clearBtn.style.borderColor = '#ff3333'; clearBtn.style.color = '#ff3333'; clearBtn.textContent = '清空所有消息 / CLEAR ALL'; clearBtn.onclick = clearAllNotifications; c.parentNode.insertBefore(clearBtn, c); } try{ const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); c.innerHTML=''; if(d.list.length===0){c.innerHTML='No logs';return;} d.list.forEach(n=>{ const div=document.createElement('div'); div.className=`notify-item ${n.is_read?'':'unread'}`; const delSpan = `<span onclick="event.stopPropagation(); deleteNotify('${n.id}')" style="float:right;color:#666;cursor:pointer;margin-left:10px">[x]</span>`; div.innerHTML=`<div class="notify-msg">${n.message} ${delSpan}</div><div class="notify-time">${new Date(n.created_at).toLocaleString()}</div>`; div.onclick = () => readOneNotify(n.id, n.link, div); c.appendChild(div); }); }catch(e){c.innerHTML='Error';} }
async function checkNotifications() { try { const r = await fetch(`${API_BASE}/notifications`); const d = await r.json(); const b = document.getElementById('notifyBadge'); if(d.count>0){ b.style.display='inline-block'; b.textContent=d.count;} else b.style.display='none'; } catch(e){} }
window.readOneNotify = async function(id, link, divElement) { if(divElement) divElement.classList.remove('unread'); returnToNotifications = true; fetch(`${API_BASE}/notifications`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id: id }) }).then(() => checkNotifications()); window.location.hash = link; };
window.markAllRead = async function() { await fetch(`${API_BASE}/notifications`, {method:'POST'}); loadNotifications(); checkNotifications(); };
window.toggleLike = async function(targetId, type, btn) { if(btn.disabled) return; btn.disabled = true; try { const res = await fetch(`${API_BASE}/like`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ target_id: targetId, target_type: type }) }); const data = await res.json(); if(data.success) { const countSpan = btn.querySelector('.count'); countSpan.textContent = data.count; if(data.isLiked) btn.classList.add('liked'); else btn.classList.remove('liked'); } else { if(res.status === 401) alert("请先登录"); else alert(data.error); } } catch(e) { console.error(e); } finally { btn.disabled = false; } };
window.saveBadgePreference = async function() { const select = document.getElementById('badgePreferenceSelect'); try { const res = await fetch(`${API_BASE}/profile`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ badge_preference: select.value }) }); const data = await res.json(); if(data.success) { alert(data.message); window.location.reload(); } else alert(data.error); } catch(e) { alert("Error"); } };
window.copyText = function(txt) { navigator.clipboard.writeText(txt).then(() => alert("已复制")); };
window.copyRecoveryKey = function() { const k = document.getElementById('recoveryKeyDisplay'); k.select(); document.execCommand('copy'); alert("Copied"); };
window.deletePost = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/posts?id=${id}`, {method:'DELETE'}); window.location.hash='#home'; };
window.deleteComment = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/comments?id=${id}`, {method:'DELETE'}); loadNativeComments(currentPostId); };
window.adminBanUser = async function(uid) { const d=prompt("Days?"); if(!d)return; const r=prompt("Reason?"); if(!r)return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'ban_user', target_user_id:uid, days:d, reason:r})}); alert("Done"); if(document.getElementById('view-admin').style.display === 'block') loadAdminBanList(); };
window.adminGenKey = async function() { const u=document.getElementById('adminTargetUser').value; const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_key', target_username:u})}); const d=await r.json(); document.getElementById('adminKeyResult').innerText=d.key; };
window.adminPostAnnounce = async function() { const t=document.getElementById('adminAnnounceTitle').value; const c=document.getElementById('adminAnnounceContent').value; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'post_announce', title:t, content:c})}); alert("Posted"); };
window.adminGenInvite = async function() { const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_invite'})}); const d=await r.json(); document.getElementById('adminInviteResult').innerText=d.codes?d.codes.join('\n'):d.code; };
window.randomizeAvatar = async function() { if(!confirm("Randomize?"))return; const r=await fetch(`${API_BASE}/random_avatar`, {method:'POST'}); const d=await r.json(); if(d.success) window.location.reload(); };
window.updateProfile = async function() { const n=document.getElementById('newNickname').value; await fetch(`${API_BASE}/profile`, {method:'POST', body:JSON.stringify({nickname:n})}); window.location.reload(); };
window.buyVip = async function() { if(!confirm("Buy VIP?"))return; const r=await fetch(`${API_BASE}/vip`, {method:'POST'}); const d=await r.json(); alert(d.message); if(d.success) window.location.reload(); };
async function doLogout() { await fetch(`${API_BASE}/auth/logout`, {method:'POST'}); window.location.href='/login.html'; }
window.tipUser = async function(uid) { const a=prompt("Amount?"); if(!a)return; await fetch(`${API_BASE}/tip`, {method:'POST', body:JSON.stringify({target_user_id:uid, amount:a})}); window.location.reload(); };
window.adminGrantTitle = async function() { const u = document.getElementById('adminTitleUser').value; const t = document.getElementById('adminTitleText').value; const c = document.getElementById('adminTitleColor').value; if(!u) return alert("请输入用户名"); try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'grant_title', target_username: u, title: t, color: c }) }); const data = await res.json(); if(data.success) alert("头衔发放成功！"); else alert(data.error); } catch(e) { alert("Error"); } };
window.adminUnbanUser = async function(uid) { if(!confirm("Unban?")) return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'unban_user', target_user_id:uid})}); alert("Done"); loadAdminBanList(); };
async function checkAdminStatus() { try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_stats'}) }); const data = await res.json(); if(data.success) { const badge = document.getElementById('adminFeedbackBadge'); if(badge) { if(data.unreadFeedback > 0) { badge.style.display = 'inline-block'; badge.textContent = data.unreadFeedback; } else { badge.style.display = 'none'; } } const statTotal = document.getElementById('statTotalUsers'); if(statTotal && statTotal.offsetParent !== null) { statTotal.innerText = data.totalUsers; document.getElementById('statActiveUsers').innerText = data.activeUsers; document.getElementById('inviteToggle').checked = data.inviteRequired; } } } catch(e){} }
async function loadAdminStats() { checkAdminStatus(); }
window.toggleInviteSystem = async function() { const enabled = document.getElementById('inviteToggle').checked; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'toggle_invite_system', enabled: enabled}) }); const data = await res.json(); alert(data.message); } catch(e){ alert("设置失败"); } };
async function loadAdminInvites() { const tbody = document.querySelector('#adminInviteTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_invites'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(inv => { const isExpired = inv.expires_at < Date.now(); let status = '<span style="color:#0f0">可用</span>'; if(inv.is_used) status = '<span style="color:#666">已用</span>'; else if(isExpired) status = '<span style="color:#f00">过期</span>'; const tr = document.createElement('tr'); tr.innerHTML = `<td>${inv.code}</td><td>${status}</td><td>${new Date(inv.expires_at).toLocaleDateString()}</td><td><button onclick="copyText('${inv.code}')" class="mini-action-btn">COPY</button><button onclick="deleteInvite('${inv.code}')" class="mini-action-btn" style="color:#f33">DEL</button></td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="4">暂无数据</td></tr>'; } } catch(e) { tbody.innerHTML = '<tr><td colspan="4">Error</td></tr>'; } }
window.refillInvites = async function() { try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'refill_invites'}) }); const data = await res.json(); if(data.success) { alert(data.message); loadAdminInvites(); } else alert(data.error); } catch(e){ alert("Error"); } };
window.deleteInvite = async function(code) { if(!confirm("Delete?")) return; try { await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'delete_invite', code: code}) }); loadAdminInvites(); } catch(e){ alert("Error"); } };
async function loadAdminFeedbacks() { const tbody = document.querySelector('#adminFeedbackTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_feedbacks'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(fb => { const tr = document.createElement('tr'); if (!fb.is_read) tr.style.backgroundColor = 'rgba(255, 255, 0, 0.1)'; let replyHTML = ''; if (fb.reply_content) { replyHTML = `<div style="margin-top:5px;padding:5px;border-left:2px solid #0f0;font-size:0.8rem;color:#888;"><span style="color:#0f0">ADMIN:</span> ${fb.reply_content}</div>`; } tr.innerHTML = `<td>${fb.nickname || fb.username}</td><td style="white-space:pre-wrap;max-width:300px;">${fb.content}${replyHTML}<div style="margin-top:8px;">${!fb.is_read ? `<button onclick="adminMarkRead(${fb.id})" class="mini-action-btn" style="color:gold">已读</button>` : ''}<button onclick="adminReplyFeedback(${fb.id}, ${fb.user_id})" class="mini-action-btn" style="color:#0070f3">回复</button><button onclick="adminDeleteFeedback(${fb.id})" class="mini-action-btn" style="color:#f33">删除</button></div></td><td>${new Date(fb.created_at).toLocaleString()}</td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="3">暂无反馈</td></tr>'; } } catch(e) { tbody.innerHTML = '<tr><td colspan="3">Error</td></tr>'; } }
window.adminMarkRead = async function(id) { await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'mark_feedback_read', id}) }); loadAdminFeedbacks(); checkAdminStatus(); };
window.adminDeleteFeedback = async function(id) { if(!confirm("Delete feedback?")) return; await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'delete_feedback', id}) }); loadAdminFeedbacks(); checkAdminStatus(); };
window.adminReplyFeedback = async function(id, userId) { const reply = prompt("请输入回复内容："); if(!reply) return; const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'reply_feedback', id, user_id: userId, content: reply}) }); const d = await res.json(); if(d.success) { alert(d.message); loadAdminFeedbacks(); checkAdminStatus(); } else alert(d.error); };
async function loadAdminBanList() { const tbody = document.querySelector('#adminBanTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_banned_users'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(u => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${u.nickname || u.username}</td><td>${u.ban_reason || '-'}</td><td>${new Date(u.ban_expires_at).toLocaleDateString()}</td><td><button onclick="adminUnbanUser(${u.id})" class="mini-action-btn" style="color:#0f0">解封</button></td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="4">无封禁用户</td></tr>'; } } catch(e){ tbody.innerHTML = '<tr><td colspan="4">Error</td></tr>'; } }

// === 更加稳健的系统启动入口 ===
function bootSystem() {
    console.log("SYSTEM BOOTING...");
    initApp();
    checkSecurity();
}

// 判断页面状态：如果已经加载完成(interactive或complete)，直接运行
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    bootSystem();
} else {
    // 否则等待加载完成事件
    document.addEventListener('DOMContentLoaded', bootSystem);
}











