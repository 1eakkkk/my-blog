--- START OF FILE script.js ---

// 全局状态
let currentUser = null;
const API_BASE = '/api';

// DOM 元素
const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    post: document.getElementById('view-post')
};
const navLinks = document.querySelectorAll('.nav-link');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebar = document.getElementById('sidebar');

// --- 1. 核心认证逻辑 (Gatekeeper) ---

async function checkLogin() {
    try {
        const res = await fetch(`${API_BASE}/user`);
        const data = await res.json();
        
        if (!data.loggedIn) {
            // 如果未登录，强制跳转到登录页
            window.location.href = '/login.html';
            return;
        }

        // 登录成功，更新 UI
        currentUser = data;
        document.getElementById('username').textContent = data.username;
        document.getElementById('coinCount').textContent = data.coins;
        
        const userBadge = document.getElementById('userLevel');
        userBadge.textContent = "LV.1 OPERATOR";
        userBadge.style.color = "#0f0";
        userBadge.style.borderColor = "#0f0";
        
        // 添加登出按钮
        userBadge.innerHTML += ` <span onclick="doLogout()" style="cursor:pointer;color:red;margin-left:5px">[EXIT]</span>`;

        // 绑定签到按钮逻辑 (此时用户必已登录，所以直接绑签到)
        const checkInBtn = document.getElementById('checkInBtn');
        checkInBtn.textContent = "每日签到 (+10)";
        checkInBtn.onclick = doCheckIn;

    } catch (e) {
        console.error("Auth check failed", e);
        // 如果 API 挂了，为了安全也踢回登录页或显示错误
        document.body.innerHTML = "<h1 style='color:white;text-align:center;margin-top:20%'>SYSTEM ERROR: 连接核心失败</h1>";
    }
}

// --- 2. 路由与视图控制 ---

function showView(viewName) {
    Object.values(views).forEach(el => el.style.display = 'none');
    navLinks.forEach(el => el.classList.remove('active'));
    
    if (views[viewName]) views[viewName].style.display = 'block';
    
    // 更新侧边栏高亮
    // 特殊处理：write 对应 navWrite
    if (viewName === 'write') {
        document.getElementById('navWrite').classList.add('active');
    } else if (viewName === 'home') {
        document.querySelector('a[href="#home"]').classList.add('active');
    }

    sidebar.classList.remove('open');
}

// 监听路由
window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);

async function handleRoute() {
    const hash = window.location.hash || '#home';
    
    if (hash === '#home') {
        showView('home');
        loadPosts();
    } else if (hash === '#write') {
        showView('write');
    } else if (hash.startsWith('#post?id=')) {
        const id = hash.split('=')[1];
        showView('post');
        loadSinglePost(id);
    }
}

// --- 3. 业务逻辑 ---

// 加载文章列表
async function loadPosts() {
    const container = document.getElementById('posts-list');
    container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/posts`);
        const posts = await res.json();
        
        container.innerHTML = '';
        if (posts.length === 0) {
            container.innerHTML = '<p style="color:#666">暂无文章。点击左侧“项目(发布)”创建第一条记录。</p>';
            return;
        }

        posts.forEach(post => {
            const date = new Date(post.created_at).toLocaleDateString();
            const div = document.createElement('div');
            div.className = 'post-card';
            div.innerHTML = `
                <div class="post-meta">${date} | @${post.author_name}</div>
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

// 加载单篇文章
async function loadSinglePost(id) {
    const container = document.getElementById('single-post-content');
    const giscusContainer = document.getElementById('giscus-container');
    
    container.innerHTML = '读取中...';
    giscusContainer.innerHTML = ''; // 清理旧评论

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        
        if (!post) {
            container.innerHTML = '<h1>404 NOT FOUND</h1>';
            return;
        }

        const date = new Date(post.created_at).toLocaleString();
        container.innerHTML = `
            <div class="post-meta">ID: ${post.id} // ${date} // AUTHOR: ${post.author_name}</div>
            <h1>${post.title}</h1>
            <div class="article-body">${post.content}</div>
        `;

        // 加载 Giscus
        const script = document.createElement('script');
        script.src = "https://giscus.app/client.js";
        script.setAttribute("data-repo", "1eakkkk/my-blog");
        script.setAttribute("data-repo-id", "R_kgDOQcdfsQ");
        script.setAttribute("data-category", "General");
        script.setAttribute("data-category-id", "DIC_kwDOQcdfsc4Cy_4j");
        script.setAttribute("data-mapping", "specific");
        script.setAttribute("data-term", post.title);
        script.setAttribute("data-strict", "0");
        script.setAttribute("data-reactions-enabled", "1");
        script.setAttribute("data-emit-metadata", "0");
        script.setAttribute("data-input-position", "top");
        script.setAttribute("data-theme", "dark_dimmed");
        script.setAttribute("data-lang", "zh-CN");
        script.setAttribute("crossorigin", "anonymous");
        script.async = true;
        
        giscusContainer.appendChild(script);

    } catch (e) {
        container.innerHTML = 'Error loading post.';
    }
}

// 签到逻辑
async function doCheckIn() {
    const btn = document.getElementById('checkInBtn');
    if(btn.disabled) return;
    
    btn.disabled = true;
    btn.textContent = "SYNCING...";
    
    try {
        const res = await fetch(`${API_BASE}/checkin`, { method: 'POST' });
        const data = await res.json();
        alert(`SYSTEM: ${data.message}`);
        if(data.coins !== undefined) document.getElementById('coinCount').textContent = data.coins;
    } catch(e) { 
        alert("通讯中断"); 
    } finally {
        btn.disabled = false;
        btn.textContent = "每日签到 (+10)";
    }
}

// 登出逻辑
window.doLogout = async function() {
    if(confirm("确认断开连接？")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.href = '/login.html';
    }
};

// 发布文章逻辑
document.getElementById('postForm').onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('postTitle').value;
    const content = document.getElementById('postContent').value;
    
    try {
        const res = await fetch(`${API_BASE}/posts`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({title, content})
        });
        const data = await res.json();
        if (data.success) {
            alert("上传成功 / UPLOAD COMPLETE");
            window.location.hash = '#home'; 
            document.getElementById('postTitle').value = '';
            document.getElementById('postContent').value = '';
        } else {
            alert("上传失败: " + data.error);
        }
    } catch(e) { alert("Error"); }
};

// VIP 功能
window.upgradeVip = function() {
    let coins = parseInt(document.getElementById('coinCount').textContent);
    if (isNaN(coins)) coins = 0;
    
    if (coins >= 50) {
        alert("扣除50i币功能开发中... 管理员权限待下发");
    } else {
        alert(`SYSTEM: i币不足。需要 50，当前 ${coins}。`);
    }
};

// 移动端菜单
mobileMenuBtn.onclick = () => sidebar.classList.toggle('open');

// 时钟
setInterval(() => document.getElementById('clock').textContent = new Date().toLocaleTimeString(), 1000);

// 启动认证检查
checkLogin();