// --- START OF FILE script.js ---

// 全局状态
let isRegisterMode = false;
let currentUser = null;

// UI 元素
const authModal = document.getElementById('authModal');
const userLevelBadge = document.getElementById('userLevel');
const usernameDisplay = document.getElementById('username');
const coinCountDisplay = document.getElementById('coinCount');
const checkInBtn = document.getElementById('checkInBtn');

// 1. 初始化：检查是否已登录
async function checkLoginStatus() {
    try {
        const res = await fetch('/api/user');
        const data = await res.json();
        
        if (data.loggedIn) {
            // === 已登录状态 ===
            currentUser = data.username;
            usernameDisplay.textContent = currentUser;
            coinCountDisplay.textContent = data.coins;
            
            // 显示用户等级
            userLevelBadge.textContent = "LV.1 OPERATOR";
            userLevelBadge.style.color = "#0f0";
            userLevelBadge.style.borderColor = "#0f0";
            
            // 签到按钮恢复正常
            checkInBtn.textContent = "每日签到 (+10)";
            
            // 添加登出按钮逻辑 (在用户名旁边添加一个小的登出链接，或者直接修改界面)
            // 这里为了简单，我们让点击头像可以登出，或者我们在HTML里加个登出按钮
            // 简单做法：将 "LV.1 OPERATOR" 后面追加一个 (登出)
            userLevelBadge.innerHTML = `LV.1 OPERATOR <span id="logoutBtn" style="cursor:pointer; color:red; margin-left:5px;">[登出]</span>`;
            document.getElementById('logoutBtn').onclick = logout;

        } else {
            // === 未登录状态 ===
            currentUser = null;
            usernameDisplay.textContent = "访客 007";
            coinCountDisplay.textContent = "0";
            userLevelBadge.textContent = "LV.0 GUEST";
            userLevelBadge.style.color = "var(--text-dim)";
            userLevelBadge.style.borderColor = "#333";
            checkInBtn.textContent = "登录 / LOGIN";
        }
    } catch (e) {
        console.error("连接系统失败", e);
    }
}

// 执行登出
async function logout() {
    if(confirm("确定要断开连接吗？")) {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            alert("SYSTEM: 已断开连接");
            window.location.reload(); // 刷新页面
        } catch (e) {
            alert("登出失败");
        }
    }
}

// 页面加载时检查状态
checkLoginStatus();

// 2. 模态框控制
const closeModal = () => authModal.style.display = "none";
document.querySelector('.close-btn').onclick = closeModal;
window.onclick = (event) => { if (event.target == authModal) closeModal(); };

// 点击签到按钮逻辑
checkInBtn.addEventListener('click', async () => {
    // 如果没登录，弹出登录框
    if (!currentUser) {
        authModal.style.display = "block";
        return;
    }

    // 已登录，执行签到
    checkInBtn.disabled = true;
    checkInBtn.textContent = "SYNCING...";
    
    try {
        const res = await fetch('/api/checkin', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            alert(`SYSTEM: ${data.message}`);
        } else {
            alert(`SYSTEM: ${data.message}`);
        }
        
        if(data.coins !== undefined) coinCountDisplay.textContent = data.coins;
    } catch(e) {
        alert("ERROR: 通讯中断");
    } finally {
        checkInBtn.disabled = false;
        checkInBtn.textContent = "每日签到 (+10)";
    }
});

// 3. 登录/注册 表单提交
const authForm = document.getElementById('authForm');
const modalTitle = document.getElementById('modalTitle');
const switchModeBtn = document.getElementById('switchModeBtn');

// 切换模式
switchModeBtn.onclick = () => {
    isRegisterMode = !isRegisterMode;
    modalTitle.textContent = isRegisterMode ? "NEW USER REGISTRATION" : "SYSTEM LOGIN";
    document.getElementById('authSubmitBtn').textContent = isRegisterMode ? "REGISTER >" : "ACCESS >>";
    switchModeBtn.textContent = isRegisterMode ? "已有账号？返回登录" : "没有账号？点击注册";
};

authForm.onsubmit = async (e) => {
    e.preventDefault();
    const u = document.getElementById('authUsername').value;
    const p = document.getElementById('authPassword').value;
    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();

        if (data.success) {
            if (isRegisterMode) {
                alert("注册成功！请登录。");
                // 自动切换回登录模式
                switchModeBtn.click();
            } else {
                alert("身份验证通过。Welcome back, " + data.username);
                closeModal();
                checkLoginStatus(); // 刷新状态
            }
        } else {
            alert("ACCESS DENIED: " + (data.error || "未知错误"));
        }
    } catch (err) {
        console.error(err);
        alert("SYSTEM ERROR: 无法连接核心");
    }
};

// 4. VIP 升级功能 (修复 HTML 中的调用报错)
window.upgradeVip = function() {
    if (!currentUser) {
        alert("SYSTEM: 请先登录后操作。");
        authModal.style.display = "block";
        return;
    }
    
    let currentCoins = parseInt(coinCountDisplay.textContent);
    if (currentCoins >= 50) {
        alert("功能开发中... (这里可以接入后端扣费API)");
    } else {
        alert(`SYSTEM: 余额不足。需要 50 1eak币，当前仅有 ${currentCoins}。`);
    }
};

// 时钟
setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);