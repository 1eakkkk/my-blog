// --- START OF FILE script.js ---

const API_BASE = '/api';
let currentUser = null;

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

// --- 像素头像生成器 ---
function generatePixelAvatar(seedStr) {
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
            if(val) {
                rects += `<rect x="${j*10}" y="${i*10}" width="10" height="10" fill="${color}" />`;
            }
        }
    }
    return `<svg width="100%" height="100%" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" class="pixel-avatar" style="background:#111;">${rects}</svg>`;
}

// --- 计算等级 ---
function calculateLevel(xp) {
    let currentLv = 1;
    let nextXp = 100;
    let prevXp = 0;

    for (let i = 0; i < LEVEL_TABLE.length; i++) {
        if (xp >= LEVEL_TABLE[i].xp) {
            currentLv = LEVEL_TABLE[i].lv;
            prevXp = LEVEL_TABLE[i].xp;
            if (i < LEVEL_TABLE.length - 1) {
                nextXp = LEVEL_TABLE[i+1].xp;
            } else {
                nextXp = 99999;
            }
        }
    }
    
    let percent = 0;
    if(nextXp !== 99999) {
        percent = ((xp - prevXp) / (nextXp - prevXp)) * 100;
    } else {
        percent = 100;
    }
    
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
            
            const displayName = data.nickname || data.username;
            document.getElementById('username').textContent = displayName;
            document.getElementById('coinCount').textContent = data.coins;
            
            document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${generatePixelAvatar(data.username)}</div>`;

            const levelInfo = calculateLevel(data.xp || 0);
            const badgesArea = document.getElementById('badgesArea');
            let vipTag = data.is_vip ? `<span class="badge vip-tag">VIP</span>` : '';
            badgesArea.innerHTML = `<span class="badge lv-${levelInfo.lv}">LV.${levelInfo.lv}</span> ${vipTag}`;
            
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;

            if(data.is_vip) {
                document.getElementById('vipBox').innerHTML = `<h4>VIP MEMBER</h4><p style="color:gold">尊贵身份已激活</p><p style="font-size:0.7rem;color:#666">经验获取 +100%</p>`;
                document.getElementById('vipBox').style.borderColor = 'gold';
            }

            if (mask) {
                mask.style.transition = 'opacity 0.5s';
                mask.style.opacity = '0';
                setTimeout(() => mask.remove(), 500);
            }
        }
    } catch (e) {
        console.error(e);
        window.location.replace('/login.html');
    }
}

function initApp() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.onclick = (e) => {
            e.stopPropagation();
            document.getElementById('sidebar').classList.toggle('open');
        };
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
    about: document.getElementById('view-about')
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
    } else if (hash.startsWith('#post?id=')) {
        if(views.post) views.post.style.display = 'block';
        loadSinglePost(hash.split('=')[1]);
    }
}

// === 业务功能 ===

// 1. 每日幸运抽奖 (紫色按钮对应功能)
window.doLuckyDraw = async function() {
    const btn = document.querySelector('.lucky-draw-btn');
    if(btn) {
        btn.disabled = true;
        btn.textContent = "DRAWING...";
    }
    
    try {
        const res = await fetch(`${API_BASE}/draw`, { method: 'POST' });
        const data = await res.json();
        
        if(data.success) {
            // 成功弹窗
            alert(`🎉 ${data.message}`);
            window.location.reload(); // 刷新页面以更新经验条
        } else {
            // 失败弹窗 (比如今天已经抽过了)
            alert(`🚫 ${data.error}`);
        }
    } catch(e) {
        alert("⚠️ 系统繁忙，请稍后再试");
    } finally {
        if(btn) {
            btn.disabled = false;
            btn.textContent = "🎲 每日幸运抽奖";
        }
    }
};

// 2. 更新昵称
window.updateProfile = async function() {
    const nick = document.getElementById('newNickname').value;
    if(!nick) return alert("请输入昵称");
    
    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({nickname: nick})
        });
        const data = await res.json();
        if(data.success) {
            alert("修改成功");
            window.location.reload();
        } else {
            alert(data.error);
        }
    } catch(e) { alert("Error"); }
};

// 3. 购买VIP
window.buyVip = async function() {
    if(!confirm("确认消耗50 i币开通VIP吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/vip`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || data.error);
        if(data.success) window.location.reload();
    } catch(e) { alert("Error"); }
};

// 4. 加载文章列表
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
    } catch (e) {
        container.innerHTML = '<p style="color:red">无法获取数据流。</p>';
    }
}

// 5. 加载单篇 (核心修复：Flex布局解决头像重叠)
async function loadSinglePost(id) {
    const container = document.getElementById('single-post-content');
    const giscusContainer = document.getElementById('giscus-container');
    if(!container) return;
    container.innerHTML = '读取中...';
    if(giscusContainer) giscusContainer.innerHTML = ''; 

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        if (!post) { container.innerHTML = '<h1>404</h1>'; return; }

        const date = new Date(post.created_at).toLocaleString();
        let deleteBtnHtml = '';
        // 兼容 username 和 nickname 判断
        if (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id)) {
            deleteBtnHtml = `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`;
        }
        
        const authorDisplay = post.author_nickname || post.author_username || post.author_name;
        const vipDisplay = post.author_vip ? `<span style="color:gold;margin-right:5px">[VIP]</span>` : '';
        const avatarSvg = generatePixelAvatar(post.author_username || "default");

        // === 新结构：使用 Flexbox 隔离头像和文字 ===
        container.innerHTML = `
            <div class="post-header-row">
                <div class="post-author-info">
                    <!-- 头像固定容器 -->
                    <div class="post-avatar-box">
                        ${avatarSvg}
                    </div>
                    <!-- 文字信息竖排 -->
                    <div class="post-meta-text">
                        <span style="color:#fff; font-size:1rem; font-weight:bold;">
                            ${vipDisplay}${authorDisplay} <span class="badge lv-${post.author_level||1}" style="transform:scale(0.8)">LV.${post.author_level||1}</span>
                        </span>
                        <span>ID: ${post.id} // ${date}</span>
                    </div>
                </div>
                ${deleteBtnHtml}
            </div>
            <h1 style="margin-top:20px;">${post.title}</h1>
            <div class="article-body">${post.content}</div>
        `;

        if(giscusContainer) {
            const script = document.createElement('script');
            script.src = "https://giscus.app/client.js";
            script.setAttribute("data-repo", "1eakkkk/my-blog");
            script.setAttribute("data-repo-id", "R_kgDOQcdfsQ");
            script.setAttribute("data-category", "General");
            script.setAttribute("data-category-id", "DIC_kwDOQcdfsc4Cy_4k");
            script.setAttribute("data-mapping", "specific");
            script.setAttribute("data-term", `1eak-post-${post.id}`);
            script.setAttribute("data-strict", "0");
            script.setAttribute("data-reactions-enabled", "1");
            script.setAttribute("data-emit-metadata", "0");
            script.setAttribute("data-input-position", "top");
            script.setAttribute("data-theme", "dark_dimmed");
            script.setAttribute("data-lang", "zh-CN");
            script.setAttribute("crossorigin", "anonymous");
            script.async = true;
            giscusContainer.appendChild(script);
        }
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
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
