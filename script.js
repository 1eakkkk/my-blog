// 时间显示
function updateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour12: false });
    document.getElementById('clock').textContent = timeString;
}
setInterval(updateTime, 1000);
updateTime();

// 模拟数据库 (使用 LocalStorage)
const db = {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value)
};

// 初始化用户数据
if (!db.get('coins')) db.set('coins', 0);
if (!db.get('isVip')) db.set('isVip', 'false');

// 更新界面金币 (从服务器获取)
async function updateUI() {
    try {
        // 请求后端 API
        const response = await fetch('/api/checkin'); 
        const data = await response.json();
        
        document.getElementById('coinCount').textContent = data.coins;
    } catch (err) {
        console.error("无法连接到数字基地数据库", err);
    }
}

// 签到功能 (连接真实数据库)
const checkInBtn = document.getElementById('checkInBtn');
checkInBtn.addEventListener('click', async () => {
    checkInBtn.disabled = true;
    checkInBtn.textContent = "通讯中...";

    try {
        // 发送 POST 请求给后端
        const response = await fetch('/api/checkin', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            alert(`SYSTEM: ${data.message}`);
        } else {
            alert(`SYSTEM: ${data.message}`);
        }
        
        // 更新显示的数字
        document.getElementById('coinCount').textContent = data.coins;

    } catch (err) {
        alert("SYSTEM ERROR: 连接中断");
    } finally {
        checkInBtn.disabled = false;
        checkInBtn.textContent = "每日签到 (+10)";
    }
});

// 初始化
updateUI();
