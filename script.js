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
const authModal = document.getElementById('authModal');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebar = document.getElementById('sidebar');

// --- 1. 路由与视图控制 ---

function showView(viewName) {
    // 隐藏所有视图
    Object.values(views).forEach(el => el.style.display = 'none');
    navLinks.forEach(el => el.classList.remove('active'));
    
    // 显示目标视图
    if (views[viewName]) {
        views[viewName].style.display = 'block';
    }
    
    // 更新导航高亮
    const activeLink = document.querySelector(`a[href="#${viewName}"]`);
    if (activeLink) activeLink.classList.add('active');

    // 移动端：切换视图后自动关闭侧边栏
    sidebar.classList.remove('open');
}

// 监听路由变化 (Hash Router)
window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);

async function handleRoute() {
    const hash = window.location.hash || '#home';
    
    if (hash === '#home') {
        showView('home');
        loadPosts();
    } else if (hash === '#write') {
        if (!currentUser) {
            alert("请先登录权限 // ACCESS DENIED");
            window.location.hash = '#home';
            openLoginModal();
        } else {
            showView('write');
        }
    } else if (hash.startsWith('#post?id=')) {
        const id = hash.split('=')[1];
        showView('post');
        loadSinglePost(id);
    }
}

// --- 2. 数据加载逻辑 ---

// 加载文章列表
async function loadPosts() {
    const container = document.getElementById('posts-list');
    container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/posts`);
        const posts = await res.json();
        
        container.innerHTML = '';
        if (posts.length === 0) {
            container.innerHTML = '<p>暂无数据。待写入。</p>';
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
        container.innerHTML = '<p style="color:red">连接中断。</p>';
    }
}

// 加载单篇文章 + 动态加载评论
async function loadSinglePost(id) {
    const container = document.getElementById('single-post-content');
    const giscusContainer = document.getElementById('giscus-container');
    
    container.innerHTML = '读取中...';
    // 清空旧评论，防止串台
    giscusContainer.innerHTML = ''; 

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        
        if (!post) {
            container.innerHTML = '<h1>404 NOT FOUND</h1>';
            return;
        }

        // 渲染文章
        const date = new Date(post.created_at).toLocaleString();
        container.innerHTML = `
            <div class="post-meta">ID: ${post.id} // ${date} // AUTHOR: ${post.author_name}</div>
            <h1>${post.title}</h1>
            <div class="article-body">${post.content}</div>
        `;

        // 动态加载评论 (Giscus)
        const script = document.createElement('script');
        script.src = "https://giscus.app/client.js";
        script.setAttribute("data-repo", "1eakkkk/my-blog"); 
        script.setAttribute("data-repo-id", "R_kgDOQcdfsQ"); 
        script.setAttribute("data-category", "General");
        script.setAttribute("data-category-id", "DIC_kwDOQcdfsc4Cy_4j"); 
        script.setAttribute("data-mapping", "specific");
        script.setAttribute("data-term", post.title); // 使用文章标题作为评论唯一标识
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
        container.innerHTML = 'Error loading data.';
    }
}

// --- 3. 认证与用户逻辑 ---

// 检查登录
async function checkLogin() {
    try {
        const res = await fetch(`${API_BASE}/user`);
        const data = await res.json();
        
        const btn = document.getElementById('checkInBtn');
        const userBadge = document.getElementById('userLevel');
        const writeLink = document.getElementById('navWrite');

        if (data.loggedIn) {
            currentUser = data;
            document.getElementById('username').textContent = data.username;
            document.getElementById('coinCount').textContent = data.coins;
            
            userBadge.textContent = "LV.1 OPERATOR";
            userBadge.style.color = "#0f0";
            
            // 登录后显示“发布文章”链接
            writeLink.style.display = 'block';
            
            btn.textContent = "每日签到 (+10)";
            btn.onclick = doCheckIn;
            
            // 添加登出
            userBadge.innerHTML += ` <span onclick="doLogout()" style="cursor:pointer;color:red;margin-left:5px">[EXIT]</span>`;
        } else {
            currentUser = null;
            document.getElementById('username').textContent = "GUEST";
            userBadge.textContent = "OFFLINE";
            writeLink.style.display = 'none';
            btn.textContent = "登录 / LOGIN";
            btn.onclick = openLoginModal;
        }
    } catch (e) { console.error(e); }
}

// 签到
async function doCheckIn() {
    const btn = document.getElementById('checkInBtn');
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/checkin`, { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        if(data.coins) document.getElementById('coinCount').textContent = data.coins;
    } catch(e) { alert("Error"); }
    btn.disabled = false;
}

// 登出
window.doLogout = async function() {
    if(confirm("断开连接?")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.reload();
    }
};

// --- 4. 模态框逻辑 (修复按钮点击问题) ---

let isRegister = false;
const modalTitle = document.getElementById('modalTitle');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const switchModeBtn = document.getElementById('switchModeBtn');

function openLoginModal() {
    authModal.style.display = "block";
    isRegister = false;
    updateModalUI();
}

document.querySelector('.close-btn').onclick = () => authModal.style.display = "none";

// 切换注册/登录
switchModeBtn.onclick = () => {
    isRegister = !isRegister;
    updateModalUI();
};

function updateModalUI() {
    modalTitle.textContent = isRegister ? "REGISTER NEW USER" : "SYSTEM LOGIN";
    authSubmitBtn.textContent = isRegister ? "注册 / REGISTER" : "进入 / ACCESS";
    switchModeBtn.textContent = isRegister ? "已有账号？去登录" : "注册新账号 // REGISTER";
}

// 处理表单提交
document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault(); // 阻止页面刷新
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    const url = isRegister ? `${API_BASE}/auth/register` : `${API_BASE}/auth/login`;

    try {
        authSubmitBtn.textContent = "PROCESSING...";
        const res = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username: u, password: p})
        });
        const data = await res.json();

        if (data.success) {
            if (isRegister) {
                alert("注册成功，请登录");
                isRegister = false; 
                updateModalUI();
            } else {
                authModal.style.display = "none";
                checkLogin(); // 刷新状态
                alert("Welcome back, Commander.");
            }
        } else {
            alert("Error: " + (data.error || "Failed"));
        }
    } catch (e) {
        alert("System Error");
    } finally {
        authSubmitBtn.textContent = isRegister ? "注册 / REGISTER" : "进入 / ACCESS";
    }
};

// --- 5. 发布文章逻辑 ---
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
            window.location.hash = '#home'; // 跳回首页
            document.getElementById('postTitle').value = '';
            document.getElementById('postContent').value = '';
        } else {
            alert("上传失败: " + data.error);
        }
    } catch(e) { alert("Error"); }
};

// --- 6. 移动端菜单 ---
mobileMenuBtn.onclick = () => {
    sidebar.classList.toggle('open');
};

// VIP
window.upgradeVip = function() {
    if(!currentUser) { openLoginModal(); return; }
    alert("VIP系统正在维护中... (需要消耗50金币)");
};

// 时钟
setInterval(() => document.getElementById('clock').textContent = new Date().toLocaleTimeString(), 1000);

// 初始化
checkLogin();