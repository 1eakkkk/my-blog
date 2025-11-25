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

// 更新界面上的数据
function updateUI() {
    // 更新金币
    document.getElementById('coinCount').textContent = db.get('coins');
    
    // 更新VIP状态
    if (db.get('isVip') === 'true') {
        const badge = document.getElementById('userLevel');
        badge.textContent = "LV.99 ADMIN";
        badge.style.color = "gold";
        badge.style.borderColor = "gold";
        document.querySelector('.avatar').style.background = "gold";
        document.querySelector('.avatar').style.boxShadow = "0 0 15px gold";
    }
}

// 签到功能
const checkInBtn = document.getElementById('checkInBtn');
checkInBtn.addEventListener('click', () => {
    const lastCheckIn = db.get('lastCheckIn');
    const today = new Date().toDateString();

    if (lastCheckIn === today) {
        alert("SYSTEM: 今日已签到，请勿重复操作。");
        return;
    }

    // 增加金币
    let currentCoins = parseInt(db.get('coins'));
    currentCoins += 10;
    db.set('coins', currentCoins);
    db.set('lastCheckIn', today);

    updateUI();
    alert("SYSTEM: 签到成功！获得 10 1eak币。");
});

// VIP 升级功能
window.upgradeVip = function() {
    let coins = parseInt(db.get('coins'));
    if (coins >= 50) {
        if(confirm("确认消耗 50 1eak币开通 VIP 吗？")) {
            db.set('coins', coins - 50);
            db.set('isVip', 'true');
            updateUI();
            alert("SYSTEM: 权限已提升。欢迎回来，指挥官。");
        }
    } else {
        alert(`SYSTEM: 余额不足。需要 50 1eak币，当前仅有 ${coins}。请明日继续签到。`);
    }
};

// 初始化
updateUI();