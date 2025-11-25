const API_BASE = '/api';

// 核心入口
document.addEventListener('DOMContentLoaded', async () => {
    // 立即初始化界面逻辑（保证按钮能点）
    initApp();
    
    // 然后检查安全
    await checkSecurity();
});

// --- 安全检查 ---
async function checkSecurity() {
    try {
        const res = await fetch(`${API_BASE}/user`);
        
        // 如果API不通(比如后端挂了)，直接停止，防止报错刷屏
        if (!res.ok) {
            console.warn("API连接异常", res.status);
            return; 
        }

        const data = await res.json();
        
        if (!data.loggedIn) {
            console.log("未登录，跳转中...");
            window.location.href = '/login.html'; // 使用 href 跳转更稳妥
        } else {
            // 已登录，填充数据
            document.getElementById('username').textContent = data.username;
            document.getElementById('coinCount').textContent = data.coins;
            
            const userBadge = document.getElementById('userLevel');
            userBadge.innerHTML = `LV.1 OPERATOR <span id="logoutBtn" style="cursor:pointer;color:red;margin-left:5px">[EXIT]</span>`;
            document.getElementById('logoutBtn').onclick = doLogout;
        }

    } catch (e) {
        console.error("Auth check failed:", e);
        // 如果出错，为了安全，可以解开下面这行的注释强制跳转
        // window.location.href = '/login.html';
    }
}

// --- 初始化应用 (绑定事件) ---
function initApp() {
    // 绑定移动端菜单
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.onclick = () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('open');
        };
    }

    // 绑定签到
    const checkInBtn = document.getElementById('checkInBtn');
    if (checkInBtn) checkInBtn.onclick = doCheckIn;

    // 绑定发布表单
    const postForm = document.getElementById('postForm');
    if (postForm) postForm.onsubmit = doPost;

    // 路由监听
    window.addEventListener('hashchange', handleRoute);
    handleRoute(); // 手动触发一次

    // 时钟
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.textContent = new Date().toLocaleTimeString();
    }, 1000);
}

// --- 路由逻辑 ---
const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    post: document.getElementById('view-post')
};

async function handleRoute() {
    const hash = window.location.hash || '#home';
    const sidebar = document.getElementById('sidebar');
    const navLinks = document.querySelectorAll('.nav-link');

    // 隐藏所有视图
    Object.values(views).forEach(el => { if(el) el.style.display = 'none'; });
    navLinks.forEach(el => el.classList.remove('active'));

    // 移动端自动收起菜单
    if(sidebar) sidebar.classList.remove('open');

    // 路由切换
    if (hash === '#home') {
        if(views.home) views.home.style.display = 'block';
        const link = document.querySelector('a[href="#home"]');
        if(link) link.classList.add('active');
        loadPosts();
    } 
    else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        const link = document.getElementById('navWrite');
        if(link) link.classList.add('active');
    } 
    else if (hash.startsWith('#post?id=')) {
        if(views.post) views.post.style.display = 'block';
        const id = hash.split('=')[1];
        loadSinglePost(id);
    }
}

// --- 业务功能 ---

// 1. 加载文章列表
async function loadPosts() {
    const container = document.getElementById('posts-list');
    if(!container) return;
    
    container.innerHTML = '<div class="loading">正在同步数据流...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/posts`);
        const posts = await res.json();
        
        container.innerHTML = '';
        if (posts.length === 0) {
            container.innerHTML = '<p style="color:#666; text-align:center">暂无文章。点击左侧“项目(发布)”创建第一条记录。</p>';
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

// 2. 加载单篇文章
async function loadSinglePost(id) {
    const container = document.getElementById('single-post-content');
    const giscusContainer = document.getElementById('giscus-container');
    if(!container) return;

    container.innerHTML = '读取中...';
    if(giscusContainer) giscusContainer.innerHTML = ''; 

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
        if(giscusContainer) {
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
        }

    } catch (e) {
        container.innerHTML = 'Error loading post.';
    }
}

// 3. 发布文章
async function doPost(e) {
    e.preventDefault();
    const title = document.getElementById('postTitle').value;
    const content = document.getElementById('postContent').value;
    const btn = document.querySelector('#postForm button');
    
    btn.disabled = true;
    btn.textContent = "SENDING...";

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
    } catch(err) { 
        alert("网络错误"); 
    } finally {
        btn.disabled = false;
        btn.textContent = "发布 / PUBLISH";
    }
}

// 4. 签到
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
    } catch(e) { alert("通讯中断"); } 
    finally {
        btn.disabled = false;
        btn.textContent = "每日签到 (+10)";
    }
}

// 5. 登出
async function doLogout() {
    if(confirm("确认断开连接？")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.href = '/login.html';
    }
}

// 6. VIP
window.upgradeVip = function() {
    let coins = parseInt(document.getElementById('coinCount').textContent);
    if (isNaN(coins)) coins = 0;
    if (coins >= 50) {
        alert("扣除50 i币功能开发中... 管理员权限待下发");
    } else {
        alert(`SYSTEM: i币不足。需要 50，当前 ${coins}。`);
    }
};
