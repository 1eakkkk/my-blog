const API_BASE = '/api';

// 核心入口：页面加载后立即执行
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 立即检查登录状态
    await enforceSecurity();

    // 2. 如果通过了安全检查，初始化应用逻辑
    initApp();
});

// --- 安全守卫 ---
async function enforceSecurity() {
    try {
        const res = await fetch(`${API_BASE}/user`);
        const data = await res.json();
        
        if (!data.loggedIn) {
            // 未登录：直接踢到登录页
            window.location.replace('/login.html');
            // 抛出错误以停止后续脚本执行
            throw new Error("Redirecting to login..."); 
        }

        // 已登录：显示页面，填充用户信息
        document.body.style.display = 'block'; // <--- 关键：只有登录了才显示页面
        
        // 填充数据
        document.getElementById('username').textContent = data.username;
        document.getElementById('coinCount').textContent = data.coins;
        
        const userBadge = document.getElementById('userLevel');
        userBadge.innerHTML = `LV.1 OPERATOR <span id="logoutBtn" style="cursor:pointer;color:red;margin-left:5px">[EXIT]</span>`;
        
        // 绑定登出事件
        document.getElementById('logoutBtn').onclick = doLogout;

    } catch (e) {
        if (e.message !== "Redirecting to login...") {
            console.error("Auth check error:", e);
            window.location.replace('/login.html'); // 出错也踢回登录页
        }
    }
}

// --- 应用初始化 ---
function initApp() {
    // 绑定汉堡菜单 (三条杠)
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    if (mobileMenuBtn && sidebar) {
        mobileMenuBtn.onclick = function() {
            sidebar.classList.toggle('open');
            console.log("Menu toggled"); // 调试用
        };
    }

    // 绑定签到按钮
    const checkInBtn = document.getElementById('checkInBtn');
    if (checkInBtn) {
        checkInBtn.onclick = doCheckIn;
    }

    // 绑定发布文章表单
    const postForm = document.getElementById('postForm');
    if (postForm) {
        postForm.onsubmit = doPost;
    }

    // 启动路由监听
    window.addEventListener('hashchange', handleRoute);
    // 手动触发一次路由以加载当前视图
    handleRoute();

    // 启动时钟
    setInterval(() => document.getElementById('clock').textContent = new Date().toLocaleTimeString(), 1000);
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
    Object.values(views).forEach(el => el.style.display = 'none');
    navLinks.forEach(el => el.classList.remove('active'));

    // 移动端：切换路由后自动收起菜单
    if(sidebar) sidebar.classList.remove('open');

    // 路由判断
    if (hash === '#home') {
        views.home.style.display = 'block';
        document.querySelector('a[href="#home"]').classList.add('active');
        loadPosts();
    } 
    else if (hash === '#write') {
        views.write.style.display = 'block';
        const writeBtn = document.getElementById('navWrite');
        if(writeBtn) writeBtn.classList.add('active');
    } 
    else if (hash.startsWith('#post?id=')) {
        views.post.style.display = 'block';
        const id = hash.split('=')[1];
        loadSinglePost(id);
    }
}

// --- 业务功能 ---

// 1. 加载文章列表
async function loadPosts() {
    const container = document.getElementById('posts-list');
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
            // 绑定点击跳转
            div.onclick = () => window.location.hash = `#post?id=${post.id}`;
            container.appendChild(div);
        });
    } catch (e) {
        container.innerHTML = '<p style="color:red">无法获取数据流。</p>';
    }
}

// 2. 加载单篇文章 (含 Giscus)
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

        // 重新加载 Giscus
        // 注意：Giscus 脚本只需要加载一次，但如果切换文章需要重载 iframe。
        // 最简单的方法是每次都重新插入 script
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
    } catch(e) { 
        alert("通讯中断"); 
    } finally {
        btn.disabled = false;
        btn.textContent = "每日签到 (+10)";
    }
}

// 5. 登出
async function doLogout() {
    if(confirm("确认断开连接？")) {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        window.location.replace('/login.html');
    }
}

// 6. VIP 模拟
window.upgradeVip = function() {
    let coins = parseInt(document.getElementById('coinCount').textContent);
    if (isNaN(coins)) coins = 0;
    
    if (coins >= 50) {
        alert("扣除50 i币功能开发中... 管理员权限待下发");
    } else {
        alert(`SYSTEM: i币不足。需要 50，当前 ${coins}。`);
    }
};