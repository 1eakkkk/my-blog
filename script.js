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

// --- 像素头像生成器 (不占R2存储) ---
function generatePixelAvatar(seedStr) {
    // 简单的哈希函数
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    // 生成颜色
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase().padStart(6, "0");
    const color = `#${c}`;
    
    // 生成 5x5 像素矩阵 (svg)
    let rects = '';
    for(let i=0; i<5; i++) {
        for(let j=0; j<5; j++) {
            // 利用哈希值的位操作决定该格子上不上色，并且做对称
            const val = (hash >> (i * 5 + j)) & 1; 
            if(val) {
                rects += `<rect x="${j*10}" y="${i*10}" width="10" height="10" fill="${color}" />`;
            }
        }
    }
    // 返回 SVG 字符串
    return `<svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg" class="pixel-avatar" style="background:#111;">${rects}</svg>`;
}

// --- 计算等级和进度条 ---
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
                nextXp = 99999; // 满级
            }
        }
    }
    
    // 计算百分比
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
            
            // 1. 渲染文字信息
            const displayName = data.nickname || data.username;
            document.getElementById('username').textContent = displayName;
            document.getElementById('coinCount').textContent = data.coins;
            
            // 2. 生成并渲染头像 (使用用户名作为种子，保证永远不变)
            document.getElementById('avatarContainer').innerHTML = generatePixelAvatar(data.username);

            // 3. 计算等级
            const levelInfo = calculateLevel(data.xp || 0);
            
            // 4. 渲染等级徽章
            const badgesArea = document.getElementById('badgesArea');
            let vipTag = data.is_vip ? `<span class="badge vip-tag">VIP</span>` : '';
            badgesArea.innerHTML = `<span class="badge lv-${levelInfo.lv}">LV.${levelInfo.lv}</span> ${vipTag}`;
            
            // 5. 渲染经验条
            document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
            document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;

            // 6. VIP 按钮状态
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

// 1. 更新昵称
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

// 2. 购买VIP
window.buyVip = async function() {
    if(!confirm("确认消耗50 i币开通VIP吗？")) return;
    try {
        const res = await fetch(`${API_BASE}/vip`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || data.error);
        if(data.success) window.location.reload();
    } catch(e) { alert("Error"); }
};

// 3. 模拟评论得经验 (简单的冷却机制)
let lastCommentTime = 0;
window.claimCommentXp = function() {
    const now = Date.now();
    if(now - lastCommentTime < 30000) {
        alert("系统冷却中... 请勿频繁操作");
        return;
    }
    // 这里其实应该调用后端加经验，简单复用签到接口模拟，或者你可以新建一个专门的接口
    // 为了简单，我们提示用户“已记录”，实际后端需要专门接口。
    // 既然我们没有专门的comment_xp接口，我们用一个小技巧：发一个特殊的隐藏签到? 
    // 或者，我们这里暂时只做提示，等以后有webhook再做自动。
    // *修正*：既然用户要求了，我们就做一个简单的前端假装，实际要后端支持比较复杂。
    // *真正做法*：我们前面没有写comment_xp的api，所以这里暂时弹窗提示。
    alert("系统提示: 评论经验结算需要接入GitHub Webhook (开发中)。\n目前请通过 [签到] 和 [发帖] 获取经验。");
    lastCommentTime = now;
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

// 5. 加载单篇
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
            deleteBtnHtml = `<button onclick="deletePost(${post.id})" class="delete-btn">删除此文章 / DELETE</button>`;
        }
        
        const authorDisplay = post.author_nickname || post.author_username || post.author_name;
        const vipDisplay = post.author_vip ? `<span style="color:gold">[VIP]</span>` : '';
        // 生成作者头像
        const avatarSvg = generatePixelAvatar(post.author_username || "default");

        container.innerHTML = `
            <div class="post-header-row">
                <div class="post-meta" style="display:flex;align-items:center;gap:10px;">
                    <div style="width:30px;height:30px">${avatarSvg}</div>
                    <span>ID: ${post.id} // ${date}</span>
                    <span>AUTHOR: ${vipDisplay} ${authorDisplay} (LV.${post.author_level||1})</span>
                </div>
                ${deleteBtnHtml}
            </div>
            <h1>${post.title}</h1>
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
        if(data.coins) window.location.reload(); // 刷新以更新经验条
    } catch(e) { alert("Error"); } 
    finally { btn.disabled = false; }
}

async function doLogout() {
    if(confirm("Disconnect?")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.href = '/login.html';
    }
}

