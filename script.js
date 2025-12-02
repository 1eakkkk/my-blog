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
let homeScrollY = 0; // 记录首页滚动位置
let selectedBroadcastColor = '#ffffff';// === 📡 全服播报系统逻辑 ===

let currentChatTargetId = null; // === 社交与私信模块 ===
let chatPollInterval = null;

const LEVEL_TABLE = [
    { lv: 1,  xp: 0,     title: '潜行者' },
    { lv: 2,  xp: 300,   title: '漫游者' },
    { lv: 3,  xp: 1200,  title: '观察者' },
    { lv: 4,  xp: 2000,  title: '骇客' },
    { lv: 5,  xp: 5000,  title: '执政官' },
    { lv: 6,  xp: 10000, title: '领主' },
    { lv: 7,  xp: 20000, title: '宗师' },
    { lv: 8,  xp: 35000, title: '传奇' },
    { lv: 9,  xp: 60000, title: '半神' },
    { lv: 10, xp: 90000, title: '赛博神' }
];

// 种子配置 (对应后端)
const SEED_CATALOG = [
    { id: 'seed_moss', name: '低频缓存苔藓', timeStr: '4小时', img: 'https://img.1eak.cool/dipintaixian.png', cost: '20 i' },
    { id: 'seed_quantum', name: '量子枝条', timeStr: '12小时', img: 'https://img.1eak.cool/liangzizhitiao.png', cost: '100 i' },
    { id: 'seed_vine', name: '修复算法藤', timeStr: '24小时', img: 'https://img.1eak.cool/suanfateng.png', cost: '300 i' },
];

// 打工配置
const WORK_CATALOG = {
    'cleaning': { name: '数据清理', time: '10分钟', reward: 20 },
    'sorting':  { name: '缓存整理', time: '30分钟', reward: 60 },
    'debug':    { name: '黑盒调试', time: '60分钟', reward: 120 },
    'deepcleaning':    { name: '深度清理', time: '3小时', reward: 360 },
    'fixbug':    { name: '修复漏洞', time: '6小时', reward: 720 },
    'sleeptest':    { name: '睡眠测试', time: '10小时', reward: 1200 }
};

let workTicker = null; // 定时器

// 1. 检查并播放
async function checkBroadcasts() {
    try {
        const res = await fetch(`${API_BASE}/broadcast`);
        const data = await res.json();
        
        if (data.success && data.list && data.list.length > 0) {
            // 彩蛋：如果同一时间生效的播报超过 3 个，触发“系统超载”红色特效
            const isOverload = data.list.length >= 3;
            
            // 依次播放队列
            playBroadcastQueue(data.list, isOverload);
        }
    } catch(e) {}
}

async function playBroadcastQueue(queue, isOverload) {
    if (queue.length === 0) return;
    
    const item = queue.shift(); // 取出第一个
    showHud(item, isOverload);
    
    // 根据档次决定持续时间
    const duration = item.tier === 'high' ? 3300 : 2400;
    
    // 等待播放完毕后，递归播放下一个
    setTimeout(() => {
        hideHud();
        setTimeout(() => {
            playBroadcastQueue(queue, isOverload);
        }, 500); // 间隔0.5秒
    }, duration);
}

function showHud(item, isOverload) {
    const hud = document.getElementById('broadcast-hud');
    const box = document.getElementById('hudBox');
    const userEl = document.getElementById('hudUser');
    const contentEl = document.getElementById('hudContent');
    
    // 设置内容
    userEl.innerText = item.nickname || "SYSTEM";
    contentEl.innerText = item.content;
    
    // 设置颜色
    if (item.style_color === 'rainbow') {
        contentEl.className = 'hud-content color-rainbow'; // 复用之前的彩虹类
        contentEl.style.color = 'transparent'; // 必须设为透明才能透出背景渐变
    } else {
        contentEl.className = 'hud-content';
        contentEl.style.color = item.style_color || '#fff';
    }
    
    // 彩蛋模式
    if (isOverload) {
        box.parentElement.classList.add('hud-overload');
        userEl.innerText += " [OVERLOAD]";
    } else {
        box.parentElement.classList.remove('hud-overload');
    }
    
    hud.style.display = 'flex';
    // 移除之前的退出动画类（如果有）
    box.classList.remove('hud-exit');
}

function hideHud() {
    const box = document.getElementById('hudBox');
    const hud = document.getElementById('broadcast-hud');
    
    // 播放离场动画
    box.classList.add('hud-exit');
    
    // 动画结束后隐藏 DOM
    setTimeout(() => {
        hud.style.display = 'none';
        box.classList.remove('hud-exit');
    }, 500);
}

// 2. 背包中使用道具 (修改 toggleEquip 或新增 useConsumable)
// 我们需要在 inventory.js (前端逻辑) 增加判断
// 原来的 toggleEquip 主要是给装备用的，我们这里拦截一下 consumable

// 修改原有的 toggleEquip，如果 category 是 consumable 且是 broadcast，走特殊流程
const originalToggleEquip = window.toggleEquip;
window.toggleEquip = async function(id, cat, action) {
    // 拦截全服播报卡
    if (cat === 'consumable' && (id.includes('broadcast'))) {
        openBroadcastModal(id);
        return;
    }
    // 其他道具走原逻辑
    originalToggleEquip(id, cat, action);
};

// 打开输入弹窗
let currentBroadcastItemType = ''; // 'high' or 'low'

window.openBroadcastModal = function(itemIdRaw) {
    // itemIdRaw 可能是数据库 id，也可能是 string id，这里根据你的 inventory 逻辑调整
    // 假设 inventoryList 渲染时 id 是数据库唯一ID，我们需要知道 item_id 是 broadcast_high 还是 low
    // 简单起见，我们直接看 itemId 字符串或者让 toggleEquip 传更多参数
    // 这里假设传进来的是 user_items.id，我们需要去列表里找一下类型，或者...
    // 简化：我们在生成 HTML 时，给按钮传具体的类型
    
    // 修正：建议在 loadInventory 生成 HTML 时，把 item_id 也传给 toggleEquip
    // 例如：onclick="toggleEquip('${item.id}', '${item.category}', 'equip', '${item.item_id}')"
    // 假设你修改了 loadInventory 的生成逻辑，如果没改，我们可以通过 textContent 判断（不推荐）
    
    // 临时方案：通过全局查找 DOM 或重新请求太麻烦。
    // 建议修改 loadInventory 函数中生成按钮的部分：
    // actionBtn = `<button onclick="handleUseItem('${item.item_id}')" ...` 
    // 这样更清晰。
    
    // 但为了不破坏现有结构，假设我们有一个 handleUseItem 函数
    // 下面是 UI 逻辑
    const modal = document.getElementById('item-use-modal');
    const input = document.getElementById('broadcastInput');
    const picker = document.querySelector('.color-picker-row');
    
    // 判断高低档 (通过全局变量或传参，这里假设我们知道)
    // 临时 Hack：判断 itemId 字符串包含 high 还是 low
    // 如果是真实环境，请在 toggleEquip 里传入 item.item_id
    
    // 假设传入的是 'broadcast_high'
    if (itemIdRaw.includes('high')) {
        currentBroadcastItemType = 'high';
        picker.style.display = 'flex'; // 显示选色
        input.value = '';
        input.placeholder = "输入宣言 (限20字)...";
        input.disabled = false;
    } else {
        currentBroadcastItemType = 'low';
        picker.style.display = 'none'; // 隐藏选色
        input.value = "系统通告：我正在注视着这片荒原。";
        input.disabled = true; // 低档不可编辑
    }
    
    modal.style.display = 'flex';
};

window.closeItemModal = function() {
    document.getElementById('item-use-modal').style.display = 'none';
};

window.selectBroadcastColor = function(color, el) {
    selectedBroadcastColor = color;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');
};

window.submitBroadcast = async function() {
    const input = document.getElementById('broadcastInput');
    const content = input.value.trim();
    
    if (currentBroadcastItemType === 'high' && !content) return showToast('请输入内容', 'error');
    
    try {
        const res = await fetch(`${API_BASE}/broadcast`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                tier: currentBroadcastItemType,
                content: content,
                color: selectedBroadcastColor
            })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            closeItemModal();
            loadInventory(); // 刷新背包，减数量
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络错误", 'error');
    }
};

// 1. 加载好友列表
window.loadFriendList = async function() {
    const c = document.getElementById('chatList');
    c.innerHTML = 'Loading...';
    try {
        const res = await fetch(`${API_BASE}/friends`);
        const data = await res.json();
        
        let html = '';
        
        // === 第一部分：渲染好友申请 (如果有的话) ===
        if (data.requests && data.requests.length > 0) {
            html += `<div style="font-size:0.8rem; color:#ff00de; margin-bottom:5px;">新请求</div>`;
            data.requests.forEach(r => {
                const avatar = renderUserAvatar(r);
                // 点击头像跳转主页
                const profileAction = `onclick="event.stopPropagation(); window.location.hash='#profile?u=${r.username}'"`;
                
                html += `
                <div class="chat-item" style="cursor:default">
                    <div style="width:30px;height:30px; border-radius:50%; overflow:hidden; cursor:pointer;" ${profileAction}>${avatar}</div>
                    <div style="flex:1; font-size:0.8rem; margin-left:10px;">${r.nickname||r.username}</div>
                    <button onclick="handleFriend('${r.id}', 'accept')" class="cyber-btn" style="width:auto;font-size:0.7rem;padding:2px 8px;border-color:#0f0;color:#0f0;">同意</button>
                </div>`;
            });
        }
        
        // === 第二部分：渲染好友列表 (必须独立于 requests 判断之外) ===
        html += `<div style="font-size:0.8rem; color:var(--accent-blue); margin:10px 0 5px;">我的好友</div>`;
        
        if (data.friends.length === 0) {
            html += '<div style="color:#666;font-size:0.8rem;text-align:center;padding:10px;">暂无好友</div>';
        } else {
            data.friends.forEach(f => {
                const avatar = renderUserAvatar(f);
                // 点击头像跳转主页
                const profileAction = `onclick="event.stopPropagation(); window.location.hash='#profile?u=${f.username}'"`;
                
                html += `
                <div class="chat-item" onclick="openChat(${f.id}, '${f.nickname||f.username}')">
                    <!-- 头像 -->
                    <div style="width:30px;height:30px; border-radius:50%; overflow:hidden; cursor:pointer;" ${profileAction}>
                        ${avatar}
                    </div>
                    
                    <!-- 名字 -->
                    <div style="flex:1; margin-left:10px;">
                        <span class="mention-link" style="color:inherit;background:none;padding:0;" ${profileAction}>
                            ${f.nickname||f.username}
                        </span>
                    </div>
                </div>`;
            });
        }
        
        c.innerHTML = html;
        
    } catch(e) { 
        console.error(e);
        c.innerHTML = '<div style="color:red;text-align:center">加载失败</div>'; 
    }
};

// === 2. 处理好友请求 (添加/同意/删除) ===
window.handleFriend = async function(uid, action) {
    try {
        const res = await fetch(`${API_BASE}/friends`, {
            method: 'POST', 
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: action, target_id: uid })
        });
        const data = await res.json();
        
        if (data.success) {
            // 成功提示
            showToast(data.message, 'success');
            
            // 如果是在聊天界面操作(同意/删除)，刷新列表
            if (document.getElementById('view-chat').style.display === 'block') {
                loadFriendList(); 
            }
            // 如果是在个人主页点"加好友"，按钮变成已申请 (可选优化)
            
        } else {
            // 失败提示 (如：已被屏蔽、已是好友)
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络请求失败", 'error');
    }
};

// 3. 加载会话列表
window.loadConversations = async function() {
    const c = document.getElementById('chatList');
    c.innerHTML = 'Loading...';
    
    // 切换按钮样式 (可选优化)
    const btns = document.querySelectorAll('.chat-sidebar button');
    btns[0].classList.remove('active'); // 好友按钮
    btns[1].classList.add('active');    // 消息按钮

    try {
        const res = await fetch(`${API_BASE}/messages`);
        const data = await res.json();
        c.innerHTML = '';
        
        if (data.list.length === 0) {
            c.innerHTML = '<div style="padding:20px;text-align:center;color:#666">暂无消息</div>';
            return;
        }

        data.list.forEach(u => {
            const avatar = renderUserAvatar(u);
            // 如果有未读数 (unread_count > 0)，显示红点
            const redDotHtml = (u.unread_count && u.unread_count > 0) 
                ? `<div class="chat-unread-dot"></div>` 
                : '';
            
            // 高亮当前正在聊的人
            const isActive = (currentChatTargetId == u.uid) ? 'background:rgba(255,255,255,0.05);' : '';

            const div = document.createElement('div');
            div.className = 'chat-item';
            div.style.cssText = isActive;
            
            div.innerHTML = `
                <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;">${avatar}</div>
                <div style="flex:1; margin-left:10px;">
                    <div style="font-weight:bold; font-size:0.9rem;">${u.nickname||u.username}</div>
                    <div style="font-size:0.7rem;color:#666;">点击查看消息</div>
                </div>
                ${redDotHtml}
            `;
            div.onclick = () => openChat(u.uid, u.nickname||u.username);
            c.appendChild(div);
        });
    } catch(e) { c.innerHTML = 'Error'; }
};

// 4. 打开聊天窗口
// === 修复版：打开聊天窗口 (自动切换视图) ===
window.openChat = async function(uid, name) {
    // 1. 强制切换到聊天视图容器
    // 这一步最关键：把其他页面隐藏，显示聊天页面
    Object.values(views).forEach(el => { if(el) el.style.display = 'none'; });
    if(views.chat) views.chat.style.display = 'block';
    
    // 2. 更新侧边栏导航选中状态
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const chatLink = document.getElementById('navChat');
    if(chatLink) chatLink.classList.add('active');

    // 3. 初始化聊天状态
    currentChatTargetId = uid;
    const chatBox = document.getElementById('chatBox');
    const targetNameEl = document.getElementById('chatTargetName');
    
    if(chatBox) chatBox.style.display = 'flex';
    // 防止名字包含特殊字符导致显示错误，使用 textContent
    if(targetNameEl) targetNameEl.textContent = name; 
    
    // 4. 启动消息轮询
    if(chatPollInterval) clearInterval(chatPollInterval);
    loadChatHistory(); // 立即加载一次
    chatPollInterval = setInterval(loadChatHistory, 3000);
    
    // 5. 移动端适配：如果是手机，隐藏左侧列表，全屏显示对话框
    if(window.innerWidth < 768) {
        const sidebar = document.querySelector('.chat-sidebar');
        if(sidebar) sidebar.style.display = 'none';
    }
};

window.closeChatBox = function() {
    // 1. 隐藏聊天框
    const chatBox = document.getElementById('chatBox');
    if (chatBox) {
        chatBox.style.display = 'none';
        // 强制移除可能残留的样式干扰
        chatBox.classList.remove('active'); 
    }

    // 2. 停止消息轮询
    if(chatPollInterval) clearInterval(chatPollInterval);
    currentChatTargetId = null;

    // 3. 移动端特有逻辑：关闭聊天框后，必须把好友列表(sidebar)显示回来
    if(window.innerWidth < 768) {
        const sidebar = document.querySelector('.chat-sidebar');
        if(sidebar) {
            sidebar.style.display = 'flex'; // 恢复显示
            sidebar.style.flexDirection = 'column'; // 确保布局正确
        }
    }
};

// 覆盖原有的 loadChatHistory 函数
async function loadChatHistory() {
    if(!currentChatTargetId) return;
    const container = document.getElementById('chatMessages');
    
    // 获取消息记录 (后端现在会返回 avatar_url 等信息)
    const res = await fetch(`${API_BASE}/messages?target_id=${currentChatTargetId}`);
    const data = await res.json();
    
    container.innerHTML = '';
    
    data.list.forEach(m => {
        const isMe = m.sender_id == currentUser.id;
        
        // 构造用户对象
        const userObj = isMe ? currentUser : {
            username: m.username,
            avatar_variant: m.avatar_variant,
            avatar_url: m.avatar_url
        };
        
        const avatarHtml = renderUserAvatar(userObj);
        const contentHtml = m.content.replace(/\n/g, '<br>');

        const div = document.createElement('div');
        div.className = `msg-row ${isMe ? 'right' : 'left'}`;
        
        // === 修复：气泡样式渲染 ===
        // 1. 获取用户装备的气泡 ID (后端 messages.js 已返回 equipped_bubble_style)
        const bubbleId = m.equipped_bubble_style;
        // 2. 查表获取 CSS 类名
        const bubbleItem = SHOP_CATALOG.find(i => i.id === bubbleId);
        const bubbleClass = bubbleItem ? bubbleItem.css : '';

        if (isMe) {
            div.innerHTML = `
                <div class="msg-bubble ${bubbleClass}">${contentHtml}</div>
                <div class="msg-avatar">${avatarHtml}</div>
            `;
        } else {
            div.innerHTML = `
                <div class="msg-avatar">${avatarHtml}</div>
                <div class="msg-bubble ${bubbleClass}">${contentHtml}</div>
            `;
        }
        
        container.appendChild(div);
    });
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
    
    // 读取完消息后，顺便刷新一下侧边栏红点（因为变已读了）
    checkNotifications();
}

window.sendPrivateMessage = async function() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if(!content || !currentChatTargetId) return;
    
    const container = document.getElementById('chatMessages');
    
    // === 乐观更新 UI (带头像) ===
    const div = document.createElement('div');
    div.className = 'msg-row right'; // 自己发的在右边
    div.style.opacity = '0.5';
    
    const avatarHtml = renderUserAvatar(currentUser);
    
    div.innerHTML = `
        <div class="msg-bubble">${content}</div>
        <div class="msg-avatar">${avatarHtml}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    input.value = '';
    // ==========================

    const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ target_id: currentChatTargetId, content: content })
    });
    const d = await res.json();
    if(d.success) {
        div.style.opacity = '1';
        // 刷新一下以确保数据同步
        loadChatHistory();
    } else {
        div.style.border = '1px solid red';
        showToast(d.error, 'error');
    }
};

window.blockUser = async function(uid, actionType) {
    // 默认为 'block' 以兼容旧代码
    const act = actionType || 'block';
    
    const confirmMsg = act === 'block' 
        ? "确定要拉黑该用户吗？你们将解除好友关系且无法互发消息。" 
        : "确定要将该用户移出黑名单吗？";

    if(!confirm(confirmMsg)) return;
    
    try {
        const res = await fetch(`${API_BASE}/block`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: act, target_id: uid })
        });
        const d = await res.json();
        
        if(d.success) {
            showToast(d.message, "success");
            // 刷新当前页面以更新按钮状态
            const u = window.location.hash.split('=')[1];
            if(u) loadUserProfile(u);
        } else {
            showToast(d.error, "error");
        }
    } catch(e) {
        showToast("操作失败", "error");
    }
};

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

async function fetchWithRetry(url, options, retries = 2) {
    try {
        const response = await fetch(url, options);
        // 如果是 5xx 错误 (服务器内部错误/超时)，也进行重试
        if (!response.ok && response.status >= 500) {
            throw new Error(`Server Error: ${response.status}`);
        }
        return response;
    } catch (err) {
        if (retries > 0) {
            console.log(`上传失败，正在重试... 剩余次数: ${retries}`);
            // 等待 1 秒后重试，给 Worker 一点缓冲时间
            await new Promise(r => setTimeout(r, 1000));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw err;
    }
}

// === 辅助函数：图片压缩引擎 ===
async function compressImage(file, quality = 0.7, maxWidth = 1920) {
    // 如果不是图片，或者小于 1MB，直接原样返回
    if (!file.type.startsWith('image/') || file.size < 1024 * 1024) {
        return file;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                // 计算缩放比例
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }

                // 绘图
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 导出压缩后的 Blob
                canvas.toBlob((blob) => {
                    // 如果压缩后反而变大了（极少情况），就用原图
                    if (blob.size > file.size) {
                        resolve(file);
                    } else {
                        // 重构 File 对象
                        const newFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        console.log(`压缩完成: ${(file.size/1024).toFixed(2)}KB -> ${(newFile.size/1024).toFixed(2)}KB`);
                        resolve(newFile);
                    }
                }, 'image/jpeg', quality); // 0.7 是压缩质量，平衡点
            };
        };
    });
}


// Markdown 解析辅助函数 (修复版)
function parseMarkdown(text) {
    if (!text) return '';
    
    // 1. 先解析 @username (在 MD 解析前处理)
    let processedText = text.replace(/@(\w+)/g, '<a href="#profile?u=$1" class="mention-link">@$1</a>');

    try {
        // 2. 解析 MD (确保 marked 库已加载)
        if (typeof marked === 'undefined') return processedText; // 降级处理
        const rawHtml = marked.parse(processedText);
        
        // 3. 净化 (确保 DOMPurify 库已加载)
        if (typeof DOMPurify === 'undefined') return rawHtml; // 降级处理
        return DOMPurify.sanitize(rawHtml, {
            ADD_TAGS: ['video', 'source', 'iframe'],     
            ADD_ATTR: ['controls', 'src', 'width', 'height', 'style', 'class', 'href', 'target', 'allowfullscreen'] 
        });
    } catch (e) {
        console.error("Markdown parse error:", e);
        return text; // 出错时返回纯文本
    }
}

function calculateLevel(xp) {
    if (xp >= 90000) return { lv: 10, percent: 100, next: 'MAX', title: '赛博神' };
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

// === 全能头像渲染函数 ===
// 如果用户有 avatar_url，显示图片；否则显示像素画
function renderUserAvatar(userObj) {
    if (userObj.avatar_url) {
        return `<img src="${userObj.avatar_url}" style="width:100%; height:100%; object-fit:cover; display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">` + 
               `<div style="display:none;width:100%;height:100%">${generatePixelAvatar(userObj.username, userObj.avatar_variant)}</div>`; 
               //以此作为一个容错：如果图片加载失败(onerror)，自动回退到像素画
    }
    // 没有自定义头像，使用像素画
    return generatePixelAvatar(userObj.username, userObj.avatar_variant);
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

function renderLevelTable() {
    const tbody = document.getElementById('levelTableBody');
    if (!tbody || tbody.children.length > 0) return; 
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

// === 任务中心加载逻辑 (新版) ===
async function loadTasks() { 
    // 1. 获取容器，如果页面没渲染完就跳过
    const dailyContainer = document.getElementById('dailyTaskList');
    const weeklyContainer = document.getElementById('weeklyTaskList');
    
    // 侧边栏小红点逻辑
    const navTask = document.querySelector('a[href="#tasks"]');
    
    try{ 
        const res = await fetch(`${API_BASE}/tasks`); 
        const data = await res.json(); 
        
        // 计算是否有可领取的奖励 (status === 0 是进行中，status === 2 是已领，我们需要找 进度>=目标 且 status !== 2 的)
        // 实际上后端 status 0 代表未领。我们通过 progress >= target 来判断可领
        // 简单逻辑：遍历所有任务，看有没有 (progress >= target && status === 0)
        
        let hasClaimable = false;
        const checkClaim = (t) => { if(t.progress >= t.target && t.status === 0) hasClaimable = true; };
        
        if (data.daily) data.daily.forEach(checkClaim);
        if (data.weekly) data.weekly.forEach(checkClaim);

        if(navTask) {
            if (hasClaimable) {
                navTask.innerHTML = `任务中心 <span style="background:#0f0;width:8px;height:8px;border-radius:50%;display:inline-block;box-shadow:0 0 5px #0f0;"></span>`;
            } else {
                navTask.innerHTML = `任务中心`;
            }
        }

        // 只有当前在任务页面才渲染 DOM
        if(!dailyContainer) return; 
        
        dailyContainer.innerHTML = '';
        weeklyContainer.innerHTML = '';

        const renderTask = (t, container) => {
            const isDone = t.progress >= t.target;
            const isClaimed = t.status === 2;
            
            // 在 loadTasks 函数内部，替换 btnHtml 的赋值逻辑：

            let btnHtml = '';
            if (isClaimed) {
                // 已领取
                btnHtml = `<div class="task-status-badge claimed">✓ 已完成</div>`;
            } else if (isDone) {
                // 可领取：文字改成简短的 "领取"
                btnHtml = `<button onclick="claimTaskNew(${t.id})" class="cyber-btn task-claim-btn">领取</button>`;
            } else {
                // 进行中
                btnHtml = `<div class="task-status-text">${t.progress} / ${t.target}</div>`;
            }

            const percent = Math.min(100, (t.progress / t.target) * 100);
            
            const div = document.createElement('div');
            div.className = 'glass-card';
            div.style.marginBottom = '10px';
            div.style.padding = '10px';
            if(isClaimed) div.style.opacity = '0.6';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <div style="font-weight:bold; font-size:0.9rem;">${t.description}</div>
                    ${btnHtml}
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:#888; margin-bottom:5px;">
                    <span>奖励: ${t.reward_xp} XP, ${t.reward_coins} i</span>
                </div>
                <div class="xp-bar-bg" style="height:4px;"><div class="xp-bar-fill" style="width:${percent}%; background:${isDone ? '#0f0' : 'var(--accent-blue)'}"></div></div>
            `;
            container.appendChild(div);
        };

        if(data.daily.length === 0) dailyContainer.innerHTML = '暂无任务';
        else data.daily.forEach(t => renderTask(t, dailyContainer));

        if(data.weekly.length === 0) weeklyContainer.innerHTML = '暂无任务';
        else data.weekly.forEach(t => renderTask(t, weeklyContainer));

    } catch(e){ console.error(e); } 
}

// === 新的领取函数 (Claim Task) ===
window.claimTaskNew = async function(taskId) {
    try {
        const res = await fetch(`${API_BASE}/tasks`, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'claim', taskId: taskId }) // 注意这里传 taskId
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            checkSecurity(); // 刷新钱
            loadTasks();     // 刷新列表状态
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast("领取失败", "error");
    }
};

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
            showToast(data.message, 'success');
            checkSecurity(); 
            loadTasks();     
        } else {
            showToast(data.error, 'error');
            if(btn) btn.disabled = false;
        }
    } catch (e) {
        showToast("领取失败: 网络错误");
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
            showToast("任务已刷新！");
            checkSecurity(); 
            loadTasks();     
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast("刷新失败");
    }
};

async function loadPosts(reset = false) {
    const container = document.getElementById('posts-list');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    const searchVal = document.getElementById('searchInput') ? document.getElementById('searchInput').value : '';
    const sortVal = document.getElementById('sortSelect') ? document.getElementById('sortSelect').value : 'latest';

    if (reset) { 
        currentPage = 1; 
        hasMorePosts = true; 
        container.innerHTML = ''; 
        if (loadMoreBtn) loadMoreBtn.style.display = 'none'; 
    }
    
    if (!hasMorePosts || isLoadingPosts) return;
    isLoadingPosts = true;
    if (reset) container.innerHTML = '<div class="loading">正在同步数据流...</div>'; 
    else if (loadMoreBtn) loadMoreBtn.textContent = "LOADING...";
    
    try {
        const res = await fetch(`${API_BASE}/posts?page=${currentPage}&limit=${POSTS_PER_PAGE}&search=${encodeURIComponent(searchVal)}&sort=${sortVal}`);
        const posts = await res.json();
        
        if (reset) container.innerHTML = ''; 
        if (posts.length < POSTS_PER_PAGE) hasMorePosts = false;
        
        if (posts.length === 0 && currentPage === 1) { 
            container.innerHTML = '<p style="color:#666; text-align:center">未找到相关数据。</p>'; 
        } else {
            const now = Date.now();
            posts.forEach(post => {
                const rawDate = post.updated_at || post.created_at; 
                const dateStr = new Date(rawDate).toLocaleString(); // 使用更详细的时间格式
                const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
                
                // 已读逻辑
                const readPosts = JSON.parse(localStorage.getItem('read_posts') || '[]');
                const isTimeNew = (now - post.created_at) < (24 * 60 * 60 * 1000);
                const isNew = isTimeNew && !readPosts.includes(post.id) && !readPosts.includes(String(post.id));
                const newBadge = isNew ? '<span class="new-badge">NEW</span>' : '';

                const author = post.author_nickname || post.author_username || "Unknown";
                
                // === 修复名字颜色 ===
                // 1. 获取 ID (例如 'color_fire')
                const nameColorId = post.author_name_color;
                // 2. 查表获取 CSS 类 (例如 'color-fire')
                const nameColorItem = SHOP_CATALOG.find(i => i.id === nameColorId);
                const nameColorClass = nameColorItem ? nameColorItem.css : '';
                
                // 分类样式
                const cat = post.category || '灌水'; 
                let catClass = ''; 
                if(cat === '技术') catClass = 'cat-tech'; else if(cat === '生活') catClass = 'cat-life'; else if(cat === '提问') catClass = 'cat-question'; else if(cat === '公告') catClass = 'cat-announce';
                
                const catHtml = `<span class="category-tag ${catClass}">${cat}</span>`; 
                const isAnnounceClass = cat === '公告' ? 'is-announce' : '';
                const pinnedIcon = post.is_pinned ? '<span style="color:#0f0;margin-right:5px">📌[置顶]</span>' : '';
                
                // 徽章
                const badgeHtml = getBadgesHtml({ role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp, badge_preference: post.author_badge_preference });
                
                // 点赞按钮
                const likeClass = post.is_liked ? 'liked' : ''; 
                const likeBtn = `<button class="like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count || 0}</span></button>`;
                
                const div = document.createElement('div'); 
                
                // === 修复：从 ID 查找对应的 CSS 类名 ===
                const styleId = post.author_equipped_post_style;
                // 在商品目录中查找对应的 css 字段，如果没找到则为空
                const styleItem = SHOP_CATALOG.find(i => i.id === styleId);
                const postStyleClass = styleItem ? styleItem.css : ''; 
                
                div.className = `post-card ${isAnnounceClass} ${postStyleClass}`;
                if(post.is_pinned) div.style.borderLeft = "3px solid #0f0";

                // 缩略图逻辑
                const imgMatch = post.content.match(/!\[.*?\]\((.*?)\)/) || post.content.match(/<img.*?src=["'](.*?)["']/);
                let thumbnailHtml = '';
                if (imgMatch) {
                    thumbnailHtml = `
                        <div class="post-thumbnail-container" style="display:block">
                            <img src="${imgMatch[1]}" class="post-thumbnail" loading="lazy">
                        </div>
                    `;
                }
                
                const commentCount = post.comment_count || 0;
                // 帖子累计打赏金额 (如果数据库没这字段暂时显示0)
                const tipAmount = post.total_coins || 0; 

                const cleanText = DOMPurify.sanitize(marked.parse(post.content), {ALLOWED_TAGS: []});
                
                // 作者点击跳转
                const authorAction = `onclick="event.stopPropagation(); window.location.hash='#profile?u=${post.author_username}'"`;
                // 头像
                const uObj = { username: post.author_username, avatar_variant: post.author_avatar_variant, avatar_url: post.author_avatar_url }; // 注意后端 posts.js 需返回 avatar_url (稍后补后端)
                const avatarHtml = `<div style="width:35px;height:35px;border-radius:4px;overflow:hidden;cursor:pointer;border:1px solid #333;" ${authorAction}>${renderUserAvatar(uObj)}</div>`;
                // === 核心修改：HTML 结构重组 ===
                div.innerHTML = `
                    <!-- 1. 顶部：头像 + 作者名 + 徽章 -->
                    <div class="post-header-top">
                        ${avatarHtml}
                        <div style="display:flex; flex-direction:column; justify-content:center;">
                            <div style="display:flex; align-items:center;">
                                <span class="post-author-name-large mention-link ${nameColorClass}" ${authorAction}>${author}</span>
                                ${badgeHtml}
                            </div>
                        </div>
                    </div>

                    <!-- 2. 标题 -->
                    <h2 style="margin:0">${post.title}</h2>

                    <!-- 3. 日期 (标题下方) -->
                    <div class="post-date-sub">
                        <span>${dateStr}</span>
                        ${editedTag}
                    </div>

                    <!-- 4. 标签/分类 (正文上方) -->
                    <div class="post-tags-mid">
                        ${newBadge}
                        ${pinnedIcon}
                        ${catHtml}
                    </div>
                    
                    <!-- 5. 内容摘要 & 缩略图 -->
                    ${thumbnailHtml}
                    <div class="post-snippet">${cleanText.substring(0, 100)}...</div>
                    
                    <!-- 6. 底部数据栏 -->
                    <div class="post-footer" style="margin-top:15px; padding-top:10px; border-top:1px dashed #222; display:flex; gap:20px; align-items:center; font-size:0.9rem; color:#666;">
                        <div class="post-stat-item">
                            <span>💬</span> <span>${commentCount}</span>
                        </div>
                        <div class="post-stat-item" style="color:#FFD700;">
                            <span>💰</span> <span>${tipAmount}</span>
                        </div>
                        <div style="margin-left:auto;">
                            ${likeBtn}
                        </div>
                    </div>
                `;

                // 点击卡片跳转
                div.onclick = () => { 
                    const currentRead = JSON.parse(localStorage.getItem('read_posts') || '[]');
                    if (!currentRead.includes(post.id) && !currentRead.includes(String(post.id))) {
                        currentRead.push(post.id);
                        localStorage.setItem('read_posts', JSON.stringify(currentRead));
                    }
                    const badge = div.querySelector('.new-badge');
                    if (badge) badge.style.display = 'none';

                    returnToNotifications = false; 
                    sessionStorage.setItem('homeScrollY', window.scrollY);
                    window.location.hash = `#post?id=${post.id}`; 
                }; 

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

window.searchPosts = function() {
    loadPosts(true); 
}

// === 修复版：安全检查与用户信息填充 ===
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
                            <p><strong>封禁理由:</strong> <span style="color: #ff3333">${reason}</span></p>
                            <p><strong>解封时间:</strong> <span style="color: #0f0">${expireDate}</span></p>
                        </div>
                        <button onclick="doLogout()" class="cyber-btn" style="border-color: #666; color: #666; margin-top: 20px;">退出登录 / LOGOUT</button>
                    </div>
                `;
                mask.style.opacity = '1';
                return; 
            }
        }

        currentUser = data;
        userRole = data.role || 'user';
        isAppReady = true;

        // 设置页面的账号回显
        const settingUser = document.getElementById('settingUsername');
        if(settingUser) settingUser.value = data.username;

        // === 1. 侧边栏名字：特效 + 点击跳转 ===
        const nameEl = document.getElementById('username');
        nameEl.textContent = data.nickname || data.username;
        
        // 清除旧类名，防止叠加
        nameEl.className = ''; 
        // 如果有购买特效，应用 CSS
        if (data.name_color) {
            // 确保 SHOP_CATALOG 已加载
            const ncItem = (typeof SHOP_CATALOG !== 'undefined') ? SHOP_CATALOG.find(i => i.id === data.name_color) : null;
            if (ncItem) nameEl.classList.add(ncItem.css);
        }
        
        // 添加点击样式和事件
        nameEl.style.cursor = 'pointer';
        nameEl.onclick = () => {
            // 手机端点击后自动收起侧边栏
            document.getElementById('sidebar').classList.remove('open');
            window.location.hash = `#profile?u=${data.username}`;
        };

        // === 2. 侧边栏头像：点击跳转 ===
        const avatarHtml = renderUserAvatar(data);
        const avatarContainer = document.getElementById('avatarContainer');
        // 包裹一层带 onclick 的 div
        avatarContainer.innerHTML = `
            <div class="post-avatar-box" 
                 style="width:50px; height:50px; border-color:#333; cursor:pointer;" 
                 onclick="document.getElementById('sidebar').classList.remove('open'); window.location.hash='#profile?u=${data.username}'">
                ${avatarHtml}
            </div>
        `;

        // === 3. 其他信息填充 ===
        document.getElementById('coinCount').textContent = data.coins;
        
        const settingPreview = document.getElementById('settingCustomAvatarPreview');
        if(settingPreview) settingPreview.innerHTML = renderUserAvatar(data);
        
        const keyDisplay = document.getElementById('recoveryKeyDisplay');
        if(keyDisplay) keyDisplay.value = data.recovery_key || "未生成";
        
        const badgePrefSelect = document.getElementById('badgePreferenceSelect');
        if(badgePrefSelect) badgePrefSelect.value = data.badge_preference || 'number';
        
        document.getElementById('badgesArea').innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
        
        // 渲染背景
        document.body.classList.remove('bg-default', 'bg-matrix', 'bg-space', 'bg-cyber', 'bg-sakura', 'bg-fire', 'bg-abyss');
        if (data.equipped_bg) {
            const bgClass = data.equipped_bg.replace('_', '-'); 
            document.body.classList.add(bgClass);
        } else {
            document.body.classList.add('bg-default');
        }
        
        const bioEl = document.getElementById('userBioDisplay');
        if(bioEl) bioEl.textContent = data.bio || "暂无签名";

        const settingBio = document.getElementById('settingBio');
        if(settingBio) settingBio.value = data.bio || "";
        
        const levelInfo = calculateLevel(data.xp || 0);
        document.getElementById('xpText').textContent = `${data.xp || 0} / ${levelInfo.next}`;
        document.getElementById('xpBar').style.width = `${levelInfo.percent}%`;
        
        document.getElementById('logoutBtn').onclick = doLogout;

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

        // VIP 显示逻辑
        const vipBox = document.getElementById('vipBox');
        if(data.is_vip) {
            const daysLeft = Math.ceil((data.vip_expires_at - Date.now()) / (1000 * 60 * 60 * 24));
            if(vipBox) {
                vipBox.innerHTML = `
                    <h4 style="color:#FFD700">VIP MEMBER</h4>
                    <p style="color:#fff; font-size:0.8rem;">剩余有效期: ${daysLeft} 天</p>
                    <p style="font-size:0.7rem;color:#666">经验加成 +45%</p>
                    <button onclick="window.location.hash='#shop'" class="vip-mini-btn">续费 / RENEW</button>
                `;
                vipBox.style.borderColor = 'gold';
            }
        } else {
            if(vipBox) {
                vipBox.innerHTML = `<h4>商城 / SHOP</h4><p>购买 VIP 解锁特权</p><button onclick="window.location.hash='#shop'" class="vip-mini-btn">GO >></button>`;
                vipBox.style.borderColor = '#333';
            }
        }

        checkNotifications();
        setInterval(() => {
            checkNotifications();
            loadTasks(); 
        }, 60000);
        loadTasks(); 
        checkForDrafts();
        
        // === 修复：延迟调用路由，解决刷新空白问题 ===
        setTimeout(() => {
            handleRoute();
        }, 10);

        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }

    } catch (e) { 
        console.error("CheckSecurity Error:", e); 
        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
    }
}

// === 修复版 initApp (解决 addEventListener 报错) ===
function initApp() {
    // 1. 禁用浏览器自动滚动恢复
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    // 2. 侧边栏开关 (点击按钮)
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) { 
        mobileMenuBtn.onclick = (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); }; 
    }
    
    // 3. 点击外部关闭侧边栏
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn) { sidebar.classList.remove('open'); }
    });
    
    // 4. 按钮绑定
    const checkInBtn = document.getElementById('checkInBtn'); 
    if (checkInBtn) checkInBtn.onclick = window.doCheckIn;
    
    const postForm = document.getElementById('postForm'); 
    if (postForm) postForm.onsubmit = doPost;

    // 5. 评论区图片点击放大
    const commentsList = document.getElementById('commentsList');
    if (commentsList) {
        commentsList.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG' && e.target.closest('.comment-text')) {
                openLightbox(e.target.src);
            }
        });
    }

    // 6. 首页链接重置滚动
    const homeNavLink = document.querySelector('a[href="#home"]');
    if (homeNavLink) {
        homeNavLink.addEventListener('click', () => {
            sessionStorage.removeItem('homeScrollY'); 
            window.scrollTo(0, 0);
        });
    }
    
    // 7. PC端私信回车发送
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); 
                sendPrivateMessage(); 
            }
        });
    }

   // === 修复版：移动端侧边栏滑动逻辑 (高灵敏度版) ===
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwipingScrollable = false;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        
        // 检测是否按在了横向滚动区域上 (如分类栏、表格)
        if (e.target.closest('.shop-tabs-container') || e.target.closest('.table-responsive')) {
            isSwipingScrollable = true;
        } else {
            isSwipingScrollable = false;
        }
    }, {passive: true});

    document.addEventListener('touchend', (e) => {
        if (isSwipingScrollable) return;

        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        
        const sidebar = document.getElementById('sidebar');
        
        // 计算滑动的水平和垂直距离
        const diffX = touchEndX - touchStartX;
        const diffY = Math.abs(touchEndY - touchStartY);

        // 逻辑：向右滑 (打开)
        // 优化点：
        // 1. 起点范围扩大到 80px (更容易触发)
        // 2. 滑动距离降低到 50px (更省力)
        // 3. 垂直容差增加到 100px (允许斜着滑)
        if (touchStartX < 80 && diffX > 50 && diffY < 100) {
            if (sidebar && !sidebar.classList.contains('open')) {
                sidebar.classList.add('open');
            }
        }
        
        // 逻辑：向左滑 (关闭)
        // 优化点：任意位置只要向左滑超过 50px 且不是垂直滚动，就关闭
        if (sidebar && sidebar.classList.contains('open') && (-diffX > 50) && (diffY < 100)) {
            sidebar.classList.remove('open');
        }
    }, {passive: true});

    // 9. 启动核心 (确保 handleRoute 存在才绑定)
    if (typeof handleRoute === 'function') {
        window.addEventListener('hashchange', handleRoute);
    }
    
    // 时钟
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
    
    // 启动路由
    if(isAppReady) handleRoute();
    setTimeout(checkBroadcasts, 1000); // 延迟1秒显示，让用户先看清页面
}

const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    tasks: document.getElementById('view-tasks'),
    node: document.getElementById('view-node'),
    duel: document.getElementById('view-duel'),
    cabin: document.getElementById('view-cabin'), 
    business: document.getElementById('view-business'),
    leaderboard: document.getElementById('view-leaderboard'),
    post: document.getElementById('view-post'),
    shop: document.getElementById('view-shop'),
    inventory: document.getElementById('view-inventory') ,
    chat: document.getElementById('view-chat'),
    settings: document.getElementById('view-settings'),
    about: document.getElementById('view-about'),
    notifications: document.getElementById('view-notifications'),
    feedback: document.getElementById('view-feedback'),
    admin: document.getElementById('view-admin'),
    profile: document.getElementById('view-profile')
};

async function handleRoute() {
    const hash = window.location.hash || '#home';
    const sidebar = document.getElementById('sidebar');
    const navLinks = document.querySelectorAll('.nav-link');
    
    // === 修复：强制关闭格斗场全屏遮罩 ===
    const duelOverlay = document.getElementById('duel-overlay');
    if (duelOverlay) duelOverlay.style.display = 'none';
    
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
        
        const savedScroll = sessionStorage.getItem('homeScrollY');
        
        const list = document.getElementById('posts-list');
        const isEmpty = !list || list.children.length === 0;

        if (isEmpty) {
            loadPosts(true); 
        } else if (savedScroll && parseInt(savedScroll) > 0) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.scrollTo({
                        top: parseInt(savedScroll),
                        behavior: 'auto' 
                    });
                });
            });
        }
        
    } else if (hash.startsWith('#post?id=')) {
        if (views.home && views.home.style.display === 'block') {
             homeScrollY = window.scrollY;
        }

        if(views.post) views.post.style.display = 'block';
        const params = new URLSearchParams(hash.split('?')[1]);
        
        // === 修复：加上函数调用 ===
        loadSinglePost(params.get('id'), params.get('commentId')); 
    } else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        const link = document.getElementById('navWrite'); if(link) link.classList.add('active');
        tryRestoreDraft();
    } else if (hash === '#tasks') {
        if(views.tasks) views.tasks.style.display = 'block';
        loadTasks();
    } else if (hash === '#node') {
        if(views.node) views.node.style.display = 'block';
        // 高亮导航（如果有的话，手动添加active类）
        loadNodeConsole();
    } else if (hash === '#duel') {
        if (views.duel) views.duel.style.display = 'block';
        loadDuels();
    } else if (hash === '#leaderboard') {
        if(views.leaderboard) views.leaderboard.style.display = 'block';
        const link = document.querySelector('a[href="#leaderboard"]'); if(link) link.classList.add('active');
        loadLeaderboard();
    } else if (hash === '#shop') {
        if(views.shop) views.shop.style.display = 'block';
        const link = document.querySelector('a[href="#shop"]'); if(link) link.classList.add('active');
        // === 修复 1：每次进入商城，强制重置为“全部”分类 ===
        // 1. 重置按钮高亮
        document.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.remove('active'));
        const allBtn = document.querySelector('.shop-tab-btn[onclick="switchShopTab(\'all\')"]');
        if(allBtn) allBtn.classList.add('active');
        // 2. 加载全部商品
        renderShop('all');
    } else if (hash === '#inventory') {
        if(views.inventory) views.inventory.style.display = 'block';
        const link = document.getElementById('navInventory'); if(link) link.classList.add('active');
        // === 修复 3：每次进入背包，强制重置为“全部”分类 ===
        document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
        const allInvBtn = document.querySelector('.inv-tab-btn[onclick="switchInventoryTab(\'all\')"]');
        if(allInvBtn) allInvBtn.classList.add('active');
        loadInventory('all');
    } else if (hash === '#cabin') {
        if (views.cabin) {
            views.cabin.style.display = 'block'; // 显示家园视图
            // 高亮侧边栏
            document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
            const cabinLink = document.querySelector('a[href="#cabin"]'); // 查找新的链接
            if (cabinLink) cabinLink.classList.add('active');
            // 加载数据
            loadHomeSystem(); 
        }
    } else if (hash === '#settings') {
        if(views.settings) views.settings.style.display = 'block';
        const link = document.querySelector('a[href="#settings"]'); if(link) link.classList.add('active');
        loadBlockedUsers();
        loadNavSettings();
    } else if (hash === '#about') {
        if(views.about) views.about.style.display = 'block';
        const link = document.querySelector('a[href="#about"]'); if(link) link.classList.add('active');
        renderLevelTable();
    } else if (hash === '#notifications') {
        if(views.notifications) views.notifications.style.display = 'block';
        const link = document.getElementById('navNotify'); if(link) link.classList.add('active');
        loadNotifications();
    } else if (hash === '#business') {
        const bizView = document.getElementById('view-business');if (bizView) bizView.style.display = 'block';
        const link = document.querySelector('a[href="#business"]');if (link) link.classList.add('active');
        if (typeof loadBusiness === 'function') {
            loadBusiness();
        }
    } else if (hash.startsWith('#profile?u=')) {
        if(views.profile) document.getElementById('view-profile').style.display = 'block'; // 注意这里 HTML ID 是 view-profile
        const u = hash.split('=')[1];
        loadUserProfile(u);
    } else if (hash === '#feedback') {
        if(views.feedback) views.feedback.style.display = 'block';
        const link = document.querySelector('a[href="#feedback"]'); if(link) link.classList.add('active');
    } else if (hash === '#chat') {
        if(views.chat) views.chat.style.display = 'block';
        const link = document.getElementById('navChat'); if(link) link.classList.add('active');
        loadFriendList();
    } else if (hash === '#admin') {
        if(userRole !== 'admin') { showToast("ACCESS DENIED"); window.location.hash='#home'; return; }
        if(views.admin) {
            views.admin.style.display = 'block';
            const link = document.getElementById('navAdmin'); if(link) link.classList.add('active');
            loadAdminStats();
            loadAdminInvites();
            loadAdminFeedbacks();
            loadAdminBanList();
            if(typeof loadAdminBroadcasts === 'function') loadAdminBroadcasts(); 
            if(typeof loadRechargeRequests === 'function') loadRechargeRequests();
        }
    } 
}

window.doCheckIn = async function() {
    const btn = document.getElementById('checkInBtn');
    if(btn) btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/checkin`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, 'success');
        if (data.success) {
            checkSecurity();
            loadTasks();
        }
    } catch (e) {
        showToast("签到失败: 网络错误");
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
            showToast(data.message, 'success');
            checkSecurity();
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast("抽奖失败: 网络错误");
    } finally {
        if(btn) btn.disabled = false;
    }
};

// === 修复版：帖子详情页加载 (解决黑屏/无内容问题) ===
async function loadSinglePost(id, targetCommentId = null) {
    currentPostId = id; 
    const container = document.getElementById('single-post-content'); 
    if(!container) return; 
    
    container.innerHTML = '<div class="loading">正在解码数据流...</div>'; 
    const commentsList = document.getElementById('commentsList');
    if(commentsList) commentsList.innerHTML = '';

    // 返回按钮
    const backBtn = document.querySelector('#view-post .back-btn'); 
    if (backBtn) { 
        if (returnToNotifications) { 
            backBtn.textContent = "< 返回通知 / BACK TO LOGS"; 
            backBtn.onclick = () => window.location.hash = '#notifications'; 
        } else { 
            backBtn.textContent = "< 返回 / BACK"; 
            backBtn.onclick = () => window.location.hash = '#home'; 
        } 
    }
    
    // 重置评论框
    const commentInput = document.getElementById('commentInput'); 
    if(commentInput) { 
        commentInput.value = ''; 
        commentInput.placeholder = "输入你的看法... (支持 Markdown & 图片)"; 
        commentInput.dataset.parentId = ""; 
        isEditingComment = false; 
        editingCommentId = null; 
    } 
    const cancelBtn = document.getElementById('cancelReplyBtn'); 
    if (cancelBtn) cancelBtn.style.display = 'none';

    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`); 
        if (!res.ok) throw new Error("API Connection Failed");
        const post = await res.json(); 
        
        if (!post || !post.id) { 
            container.innerHTML = '<h1 style="color:#f33">404 - 数据丢失</h1>'; 
            return; 
        }
        
        currentPostAuthorId = post.user_id;

        const rawDate = post.updated_at || post.created_at; 
        const dateStr = new Date(rawDate).toLocaleString(); 
        const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
        
        // === 安全获取特效 (防止 CATALOG 未定义报错) ===
        const getCatalogItem = (itemId) => {
            if (typeof SHOP_CATALOG === 'undefined') return null;
            return SHOP_CATALOG.find(i => i.id === itemId);
        };

        const styleItem = getCatalogItem(post.author_equipped_post_style);
        const postStyleClass = styleItem ? styleItem.css : ''; 
        
        const ncItem = getCatalogItem(post.author_name_color);
        const nameColorClass = ncItem ? ncItem.css : '';

        // 操作按钮
        let actionBtns = ''; 
        if (userRole === 'admin' || (currentUser && currentUser.id === post.user_id)) {
            let pinText = post.is_pinned ? "取消置顶" : (userRole === 'admin' ? "管理员置顶" : "使用置顶卡");
            let pinColor = post.is_pinned ? "#666" : (userRole === 'admin' ? "#0f0" : "gold");
            actionBtns += `<button onclick="pinPost(${post.id})" class="delete-btn" style="border-color:${pinColor};color:${pinColor};margin-right:10px">${pinText}</button>`;
            
            actionBtns += `<button onclick="editPostMode('${post.id}')" class="delete-btn" style="border-color:#0070f3;color:#0070f3;margin-right:10px">编辑</button>`; 
            actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除</button>`; 
        } 
        if (userRole === 'admin' && post.user_id !== (currentUser ? currentUser.id : 0)) { 
            actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号</button>`; 
        }
        
        let tipBtn = ''; 
        if (currentUser && currentUser.id !== post.user_id) { 
            tipBtn = `<button onclick="tipUser(${post.user_id}, ${post.id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`; 
        }
        
        // 元数据
        const authorDisplay = post.author_nickname || post.author_username || "Unknown"; 
        const uObj = { username: post.author_username, avatar_variant: post.author_avatar_variant, avatar_url: post.author_avatar_url };
        const avatarSvg = renderUserAvatar(uObj); 
        const badgeObj = { role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp || 0, badge_preference: post.author_badge_preference }; 
        const badgesHtml = getBadgesHtml(badgeObj); 
        const cat = post.category || '灌水'; 
        const catHtml = `<span class="category-tag">${cat}</span>`; 
        const likeClass = post.is_liked ? 'liked' : ''; 
        const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;
        const userLinkAction = `onclick="window.location.hash='#profile?u=${post.author_username}'" style="cursor:pointer"`;

        // 内容解析
        const safeContent = post.content || '';
        const parsedContent = parseMarkdown(safeContent);

        // === 3. 组装 HTML (移除内联样式，使用 cleaner 结构) ===
        // 这里移除了 style="background:transparent" 这种可能导致问题的代码
        // 并强制给 container 添加一个默认颜色，防止被主题覆盖成黑色文字
        container.innerHTML = `
            <div class="post-card full-view ${postStyleClass}" style="min-height: 200px; padding: 30px; position:relative; overflow:hidden; width: 100%;">
                
                <div class="post-header-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:15px;">
                    <div class="post-author-info" style="display:flex; align-items:center; gap:15px;">
                        <div class="post-avatar-box" ${userLinkAction}>${avatarSvg}</div>
                        <div class="post-meta-text">
                            <span class="${nameColorClass}" ${userLinkAction} style="font-size:1.1rem; font-weight:bold; color:#fff;">${authorDisplay}</span> 
                            <div style="margin-top:2px;">${badgesHtml}</div>
                            <div style="font-size:0.8rem; color:#888; margin-top:5px;">
                                ${catHtml} ${dateStr} ${editedTag}
                            </div>
                        </div>
                    </div>
                    
                    <div class="post-actions-mobile" style="display:flex; flex-direction:column; align-items:flex-end; gap:5px;">
                        <div style="display:flex; gap:5px;">${actionBtns}</div>
                        ${tipBtn}
                    </div>
                </div>

                <h1 style="margin:20px 0; font-size:1.8rem; line-height:1.4; color:#fff;">${post.title}</h1>
                
                <div class="article-body" style="font-size:1rem; line-height:1.8; color:#ddd;">
                    ${parsedContent}
                </div>

                <div class="post-footer" style="margin-top:30px; padding-top:20px; border-top:1px dashed #333; display:flex; justify-content:flex-end;">
                    ${likeBtn}
                </div>
            </div>
        `;
        
        // Lightbox 绑定
        const imgs = container.querySelectorAll('.article-body img');
        imgs.forEach(img => {
            img.style.cursor = 'zoom-in';
            img.onclick = function() { openLightbox(this.src); };
        });

        // 加载评论
        currentCommentPage = 1; 
        hasMoreComments = true; 
        loadNativeComments(id, true, targetCommentId);

    } catch (e) { 
        console.error("LoadPost Error:", e); 
        container.innerHTML = `<div style="color:red; text-align:center; padding:20px; border:1px solid #f00;">
            <h3>显示错误</h3>
            <p>无法渲染帖子内容，请检查网络或联系管理员。</p>
            <p style="font-size:0.8rem; color:#666;">Debug: ${e.message}</p>
        </div>`; 
    }
}

async function loadNativeComments(postId, reset = false, highlightId = null) {
    const list = document.getElementById('commentsList'); const loadBtn = document.getElementById('loadCommentsBtn');
    if (reset) { currentCommentPage = 1; hasMoreComments = true; list.innerHTML = ''; if (loadBtn) loadBtn.style.display = 'none'; }
    if (!hasMoreComments || isLoadingComments) return;
    isLoadingComments = true; if(reset) list.innerHTML = 'Loading comments...'; else if(loadBtn) loadBtn.textContent = "LOADING...";
    try {
        const res = await fetch(`${API_BASE}/comments?post_id=${postId}&page=${currentCommentPage}&limit=${COMMENTS_PER_PAGE}`); const data = await res.json();
        if (reset) list.innerHTML = '';
        if (highlightId) {
            setTimeout(() => {
                const target = document.getElementById(`comment-${highlightId}`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('highlight-comment');
                } else {
                    showToast('评论可能在其他页', 'info');
                }
            }, 500); 
        }
        if(data.results.length < COMMENTS_PER_PAGE) hasMoreComments = false;
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
    const avatar = renderUserAvatar(c); 
    // === 修复名字颜色 ===
    const ncId = c.name_color;
    const ncItem = SHOP_CATALOG.find(i => i.id === ncId);
    const ncClass = ncItem ? ncItem.css : ''; // c 是评论对象，后端需包含 avatar_url
    const div = document.createElement('div'); 
    div.id = `comment-${c.id}`; 
    div.className = isReply ? 'comment-item sub-comment' : 'comment-item'; 
    
    if(c.is_pinned) { 
        div.style.border = "1px solid #0f0"; 
        div.style.background = "rgba(0,255,0,0.05)"; 
    }
    
    // 权限判断 (删除/编辑/置顶)
    let actionLinks = ''; 
    if (userRole === 'admin' || currentUser.id === c.user_id) { 
        actionLinks += `<span onclick="deleteComment(${c.id})" class="action-link">[删除]</span>`; 
        actionLinks += `<span onclick="editCommentMode(${c.id}, '${encodeURIComponent(c.content)}')" class="action-link" style="color:#0070f3">[编辑]</span>`; 
    } 
    if (userRole === 'admin' && !isReply) { 
        const pinTxt = c.is_pinned ? "取消置顶" : "置顶"; 
        actionLinks += `<span onclick="pinComment(${c.id})" class="action-link" style="color:#0f0">[${pinTxt}]</span>`; 
    }
    
    const badgeHtml = getBadgesHtml(c); 
    const likeClass = c.is_liked ? 'liked' : ''; 
    const likeBtn = `<button class="like-btn mini ${likeClass}" onclick="event.stopPropagation(); toggleLike(${c.id}, 'comment', this)">❤ <span class="count">${c.like_count||0}</span></button>`; 
    const replyBtn = `<span class="reply-action-btn" onclick="prepareReply(${c.id}, '${c.nickname || c.username}')">↩ 回复</span>`; 
    const pinnedBadge = c.is_pinned ? '<span style="color:#0f0;font-weight:bold;font-size:0.7rem;margin-right:5px">📌置顶</span>' : '';
    
    let replyIndicator = ''; 
    if (c.reply_to_uid && rootOwnerId && c.reply_to_uid != rootOwnerId) { 
        const targetName = c.reply_to_nickname || c.reply_to_username || "Unknown"; 
        replyIndicator = `<span class="reply-indicator">回复 @${targetName}</span> `; 
    }
    
    let floorTag = ''; 
    if (!isReply && floorNumber) floorTag = `<span class="floor-tag">${getFloorName(floorNumber)}</span>`;
    
    let authorTag = ''; 
    if (postAuthorId && c.user_id === postAuthorId) { authorTag = `<span class="author-tag">📝 作者</span>`; }

    // === 关键修复：直接拼接 onclick 字符串，不要用变量套娃 ===
    const clickAttr = `onclick="event.stopPropagation(); window.location.hash='#profile?u=${c.username}'" style="cursor:pointer"`;

    div.innerHTML = `
        <div class="comment-avatar" ${clickAttr}>${avatar}</div>
        <div class="comment-content-box">
            <div class="comment-header">
                <span class="comment-author ${ncClass}" ${clickAttr}>${c.nickname || c.username} ${authorTag} ${badgeHtml}</span>
                ${floorTag}
            </div>
            <div class="comment-meta-row">
                ${pinnedBadge} ${new Date(c.created_at).toLocaleString()}
                <div class="comment-actions">${likeBtn} ${replyBtn} ${actionLinks}</div>
            </div>
            <div class="comment-text">${replyIndicator}${parseMarkdown(c.content)}</div>
        </div>`;
        
    return div;
}

window.submitFeedback = async function() {
    const content = document.getElementById('feedbackContent').value;
    if(!content || content.length < 5) return showToast("反馈内容太短");
    try {
        const res = await fetch(`${API_BASE}/feedback`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content})
        });
        const data = await res.json();
        if(data.success) { showToast(data.message, 'success'); document.getElementById('feedbackContent').value = ''; window.location.hash='#home'; }
        else showToast(data.error, 'error');
    } catch(e) { showToast("网络连接错误", 'error'); }
};

window.uploadImage = async function() {
    const input = document.getElementById('imageUploadInput');
    const status = document.getElementById('uploadStatus');
    const textarea = document.getElementById('postContent');

    // 1. 检查文件数量
    if (input.files.length === 0) return;
    if (input.files.length > 9) {
        showToast("一次最多上传 9 张图片", "error");
        input.value = ''; // 清空
        return;
    }

    status.innerText = `UPLOADING (${input.files.length})...`;
    status.style.color = "yellow";

    let successCount = 0;
    let failCount = 0;

    // 2. 循环上传 (并行处理)
    const uploadPromises = Array.from(input.files).map(async (file) => {
        const processedFile = await compressImage(file);
        const formData = new FormData();
        formData.append('file', processedFile);

        try {
            const res = await fetchWithRetry(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            }, 2);// 重试 2 次
            const data = await res.json();

            if (data.success) {
                successCount++;
                let insertText = '';
                // 视频和图片区分
                if (file.type.startsWith('video/')) {
                    insertText = `\n<video src="${data.url}" controls width="100%" style="max-height:400px; border-radius:4px; margin-top:10px;"></video>\n`;
                } else {
                    insertText = `\n![image](${data.url})\n`;
                }
                return insertText; // 返回 Markdown 文本
            } else {
                failCount++;
                return '';
            }
        } catch (e) {
            failCount++;
            return '';
        }
    });

    // 3. 等待所有上传完成
    const results = await Promise.all(uploadPromises);
    
    // 4. 将结果插入文本框
    const finalText = results.join('');
    textarea.value += finalText;

    // 5. 提示结果
    if (failCount === 0) {
        status.innerText = "DONE";
        status.style.color = "#0f0";
        showToast(`成功上传 ${successCount} 个文件`, 'success');
    } else {
        status.innerText = "PARTIAL";
        status.style.color = "orange";
        showToast(`上传完成：${successCount} 成功，${failCount} 失败`, 'info');
    }
    
    input.value = ''; 
};

window.uploadUserAvatar = async function() {
    const input = document.getElementById('avatarUploadInput');
    if (input.files.length === 0) return;
    
    const file = input.files[0];
    // 限制大小 10MB
    if (file.size > 10 * 1024 * 1024) return showToast("图片太大", "error");
    showToast("处理中...", "info");
    const processedFile = await compressImage(file, 0.6, 500);

    const formData = new FormData();
    formData.append('file', processedFile);

    try {
        // 1. 先上传到 R2
        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            // 2. 再把 URL 保存到用户资料
            const updateRes = await fetch(`${API_BASE}/profile`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ avatar_url: data.url })
            });
            const updateData = await updateRes.json();
            
            if(updateData.success) {
                showToast("头像修改成功！", "success");
                checkSecurity(); // 刷新侧边栏
            } else {
                showToast(updateData.error, "error");
            }
        } else {
            showToast(data.error, "error");
        }
    } catch (e) {
        showToast("网络错误", "error");
    } finally {
        input.value = '';
    }
};

window.uploadCommentImage = async function() {
    const input = document.getElementById('commentImgUpload');
    const status = document.getElementById('commentUploadStatus');
    const textarea = document.getElementById('commentInput');

    if (input.files.length === 0) return;

    const file = input.files[0];
    status.innerText = "UP...";
    status.style.color = "yellow";
    const processedFile = await compressImage(file);

    const formData = new FormData();
    formData.append('file', processedFile);

    try {
        const res = await fetchWithRetry(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        }, 2);
        const data = await res.json();

        if (data.success) {
            status.innerText = "OK";
            status.style.color = "#0f0";
            
            let insertText = '';
            if (file.type.startsWith('video/')) {
                insertText = `\n<video src="${data.url}" controls width="100%" style="max-height:300px; border-radius:4px; margin-top:5px;"></video>\n`;
            } else {
                insertText = `\n<img src="${data.url}" style="max-height:300px; width:auto; border-radius:4px; margin-top:5px;">\n`;
            }
            
            textarea.value += insertText; 
            showToast('媒体文件已插入', 'success');
        } else {
            status.innerText = "ERR";
            status.style.color = "red";
            showToast(data.error, 'error');
        }
    } catch (e) {
        status.innerText = "FAIL";
        showToast('上传失败', 'error');
    } finally {
        input.value = ''; 
    }
};

window.editPostMode = async function(id) { 
    isEditingPost = true; 
    editingPostId = id; 
    showToast("正在加载编辑器...", "info");
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`);
        const post = await res.json();
        window.location.hash = '#write'; 
        document.getElementById('postTitle').value = post.title; 
        document.getElementById('postContent').value = post.content; 
        document.getElementById('postCategory').value = post.category; 
        const btn = document.querySelector('#postForm button'); 
        btn.textContent = "保存修改 / UPDATE POST"; 
        let cancelBtn = document.getElementById('cancelEditPostBtn'); 
        if (!cancelBtn) { 
            cancelBtn = document.createElement('button'); 
            cancelBtn.id = 'cancelEditPostBtn'; 
            cancelBtn.type = 'button'; 
            cancelBtn.className = 'cyber-btn'; 
            cancelBtn.style.marginTop = '10px'; 
            cancelBtn.style.borderColor = '#ff3333'; 
            cancelBtn.style.color = '#ff3333'; 
            cancelBtn.textContent = '取消编辑 / CANCEL'; 
            cancelBtn.onclick = cancelEditPost; 
            btn.parentNode.insertBefore(cancelBtn, btn.nextSibling); 
        } 
        cancelBtn.style.display = 'block';
    } catch(e) {
        showToast("加载失败", "error");
        isEditingPost = false;
    }
};

window.cancelEditPost = function() { isEditingPost = false; editingPostId = null; document.querySelector('#postForm button').textContent = "发布 / PUBLISH"; document.getElementById('postTitle').value = ''; document.getElementById('postContent').value = ''; const cancelBtn = document.getElementById('cancelEditPostBtn'); if(cancelBtn) cancelBtn.style.display = 'none'; window.location.hash = '#home'; };
window.editCommentMode = function(id, c) { isEditingComment = true; editingCommentId = id; const input = document.getElementById('commentInput'); input.value = decodeURIComponent(c); input.focus(); input.scrollIntoView(); const btn = document.querySelector('.comment-input-box button:first-of-type'); /*btn.textContent = "更新评论 / UPDATE";*/ prepareReply(null, null); const cancelBtn = document.getElementById('cancelReplyBtn'); cancelBtn.textContent = "取消编辑"; cancelBtn.onclick = () => { isEditingComment = false; editingCommentId = null; input.value = ''; /*btn.textContent = "发送评论 / SEND (+5 XP)";*/ cancelReply(); }; };
async function doPost(e) { 
    e.preventDefault(); 
    let t = document.getElementById('postTitle').value.trim(); 
    let c = document.getElementById('postContent').value.trim(); 
    const cat = document.getElementById('postCategory').value; 
    const btn = document.querySelector('#postForm button'); 
    
    // 1. 基础校验：两个都空肯定不行
    if (!t && !c) {
        return showToast("标题和内容不能同时为空", "error");
    }

    // === 核心优化：互补逻辑 ===
    // 如果标题空，截取正文前30个字
    if (!t) {
        t = c.substring(0, 30);
        if (c.length > 30) t += "...";
    }
    // 如果正文空，直接复制标题
    if (!c) {
        c = t;
    }
    
    btn.disabled = true; 
    try { 
        let url = `${API_BASE}/posts`; 
        let method = 'POST'; 
        // 使用处理后的 t 和 c 发送给后端
        let body = { title: t, content: c, category: cat }; 
        
        if (isEditingPost) { 
            method = 'PUT'; 
            body = { action: 'edit', id: editingPostId, title: t, content: c, category: cat }; 
        } 
        
        const res = await fetch(url, { method: method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }); 
        const data = await res.json(); 
        
        if (data.success) { 
            showToast(data.message, 'success'); 
            if(!isEditingPost) { 
                localStorage.removeItem('draft_title'); 
                localStorage.removeItem('draft_content'); 
                localStorage.removeItem('draft_cat'); 
                // 清空输入框
                document.getElementById('postTitle').value = '';
                document.getElementById('postContent').value = '';
            } 
            cancelEditPost(); 
            
            checkSecurity(); 
            loadTasks();
            sessionStorage.removeItem('homeScrollY');
            loadPosts(true);
            
        } else { 
            showToast(data.error, 'error'); 
        } 
    } catch(err) { 
        showToast("网络连接错误", 'error'); 
    } finally { 
        btn.disabled = false; 
    } 
}
window.submitComment = async function() { const input = document.getElementById('commentInput'); const content = input.value.trim(); const parentId = input.dataset.parentId || null; if(!content) return showToast("内容不能为空"); const btn = document.querySelector('.comment-input-box button:first-of-type'); if(btn) btn.disabled = true; try { if (isEditingComment) { const res = await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'edit', id: editingCommentId, content: content }) }); const data = await res.json(); if(data.success) { showToast(data.message, 'success'); window.location.reload(); } else showToast(data.error, 'error'); } else { const res = await fetch(`${API_BASE}/comments`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ post_id: currentPostId, content: content, parent_id: parentId }) }); const data = await res.json(); if(data.success) { showToast(data.message, 'success'); input.value = ''; cancelReply(); loadNativeComments(currentPostId, true); loadTasks(); } else { showToast(data.error, 'error'); } } } catch(e) { showToast("网络连接错误", 'error'); } finally { if(btn) btn.disabled = false; } };
window.prepareReply = function(commentId, username) { const input = document.getElementById('commentInput'); input.dataset.parentId = commentId || ""; input.placeholder = username ? `回复 @${username} ...` : "输入你的看法..."; input.focus(); let cancelBtn = document.getElementById('cancelReplyBtn'); if (!cancelBtn) { cancelBtn = document.createElement('button'); cancelBtn.id = 'cancelReplyBtn'; cancelBtn.className = 'cyber-btn'; cancelBtn.style.width = 'auto'; cancelBtn.style.marginLeft = '10px'; cancelBtn.style.fontSize = '0.8rem'; cancelBtn.style.padding = '5px 10px'; cancelBtn.innerText = '取消回复'; cancelBtn.onclick = cancelReply; document.querySelector('.comment-input-box').appendChild(cancelBtn); } cancelBtn.style.display = 'inline-block'; };
window.cancelReply = function() { const input = document.getElementById('commentInput'); input.dataset.parentId = ""; input.placeholder = "输入你的看法... (支持纯文本)"; const cancelBtn = document.getElementById('cancelReplyBtn'); if(cancelBtn) cancelBtn.style.display = 'none'; };
function checkForDrafts() { 
    const pTitle = document.getElementById('postTitle'); 
    const pContent = document.getElementById('postContent'); 
    const pCat = document.getElementById('postCategory'); 
    const status = document.getElementById('draftStatus'); 

    if(pTitle && pContent) { 
        const save = () => { 
            if(!isEditingPost) { 
                localStorage.setItem('draft_title', pTitle.value); 
                localStorage.setItem('draft_content', pContent.value); 
                localStorage.setItem('draft_cat', pCat.value);
                
                const now = new Date();
                const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');
                if(status) status.innerText = `草稿已保存 ${time}`;
            } 
        }; 
        pTitle.addEventListener('input', save); 
        pContent.addEventListener('input', save); 
        pCat.addEventListener('change', save); 
    } 
}
function tryRestoreDraft() { if(isEditingPost) return; const t = localStorage.getItem('draft_title'); const c = localStorage.getItem('draft_content'); const cat = localStorage.getItem('draft_cat'); if ((t || c) && document.getElementById('postTitle').value === '') { if(confirm("发现未发布的草稿，是否恢复？\n取消则清空草稿。")) { document.getElementById('postTitle').value = t || ''; document.getElementById('postContent').value = c || ''; if(cat) document.getElementById('postCategory').value = cat; } else { localStorage.removeItem('draft_title'); localStorage.removeItem('draft_content'); localStorage.removeItem('draft_cat'); } } }
window.pinPost = async function(id) { 
    if (userRole === 'admin') {
        if(!confirm("管理员操作：确认更改置顶状态？")) return;
    } else {
        // 普通用户提示消耗
        // 这里无法预知当前是否置顶，只能笼统提示，或者通过 UI 文本判断
        // 简单起见，直接问
        if(!confirm("确认操作？\n\n• 如果是【置顶】：将消耗一张置顶卡，持续24小时。\n• 如果是【取消】：直接取消，不退卡。")) return; 
    }

    try {
        const res = await fetch(`${API_BASE}/posts`, { 
            method: 'PUT', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ action: 'pin', id: id }) 
        }); 
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            loadSinglePost(id); // 刷新状态
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络错误", 'error');
    }
};
window.pinComment = async function(id) { if(!confirm("确认更改此评论置顶状态？")) return; await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadNativeComments(currentPostId, true); };
window.deleteNotify = async function(id) { if(!confirm("Delete this log?")) return; await fetch(`${API_BASE}/notifications?id=${id}`, {method: 'DELETE'}); loadNotifications(); };
// === 汉化版：清空所有通知 ===
window.clearAllNotifications = async function() { 
    if(!confirm("⚠️ 高能预警\n\n确定要 [清空] 所有消息通知吗？\n此操作不可恢复！")) return; 
    
    try {
        await fetch(`${API_BASE}/notifications?all=true`, {method: 'DELETE'}); 
        showToast("消息列表已清空", "success");
        loadNotifications(); 
        checkNotifications(); // 刷新红点
    } catch(e) {
        showToast("清空失败", "error");
    }
};

async function loadNotifications() { 
    const c = document.getElementById('notifyList'); 
    c.innerHTML='Loading...'; 
    try{ 
        const r = await fetch(`${API_BASE}/notifications`); 
        const d = await r.json(); 
        allNotifications = d.list || []; 
        renderNotifications(allNotifications);
    } catch(e){
        c.innerHTML='Error loading logs';
    } 
}

//  checkNotifications 函数
async function checkNotifications() { 
    try { 
        const r = await fetch(`${API_BASE}/notifications`); 
        const d = await r.json(); 
        
        // 1. 系统通知红点
        const b = document.getElementById('notifyBadge'); 
        if(d.count > 0){ 
            b.style.display='inline-block'; 
            b.textContent = d.count > 99 ? '99+' : d.count;
        } else {
            b.style.display='none';
        }

        // 2. === 新增：私信红点 ===
        const c = document.getElementById('chatBadge');
        if (c) {
            if (d.chatCount > 0) {
                c.style.display = 'inline-block';
                c.textContent = d.chatCount > 99 ? '99+' : d.chatCount;
                
                // 如果侧边栏是折叠的，可以在这里做一些额外提示(可选)
            } else {
                c.style.display = 'none';
            }
        }

    } catch(e){} 
}

window.readOneNotify = async function(id, link, divElement) { if(divElement) divElement.classList.remove('unread'); returnToNotifications = true; fetch(`${API_BASE}/notifications`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id: id }) }).then(() => checkNotifications()); window.location.hash = link; };
window.markAllRead = async function() { await fetch(`${API_BASE}/notifications`, {method:'POST'}); loadNotifications(); checkNotifications(); };
window.toggleLike = async function(targetId, type, btn) { if(btn.disabled) return; btn.disabled = true; try { const res = await fetch(`${API_BASE}/like`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ target_id: targetId, target_type: type }) }); const data = await res.json(); if(data.success) { const countSpan = btn.querySelector('.count'); countSpan.textContent = data.count; if(data.isLiked) btn.classList.add('liked'); else btn.classList.remove('liked'); } else { if(res.status === 401) showToast("请先登录"); else showToast(data.error); } } catch(e) { console.error(e); } finally { btn.disabled = false; } };
window.saveBadgePreference = async function() { const select = document.getElementById('badgePreferenceSelect'); try { const res = await fetch(`${API_BASE}/profile`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ badge_preference: select.value }) }); const data = await res.json(); if(data.success) { showToast(data.message, 'success'); window.location.reload(); } else showToast(data.error, 'error'); } catch(e) { showToast("网络连接错误", 'error'); } };
window.copyText = function(txt) { navigator.clipboard.writeText(txt).then(() => showToast("已复制")); };
window.copyRecoveryKey = function() { const k = document.getElementById('recoveryKeyDisplay'); k.select(); document.execCommand('copy'); showToast("Copied"); };
window.deletePost = async function(id) { 
    if(!confirm("确定要删除这篇文章吗？操作不可恢复。")) return; 
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`, {method:'DELETE'}); 
        const data = await res.json(); 
        if (res.ok) {
            showToast("删除成功", "success");
            window.location.hash = '#home'; 
            loadPosts(true); 
        } else {
            showToast("删除失败", "error");
        }
    } catch(e) {
        showToast("网络错误", "error");
    }
};
window.deleteComment = async function(id) { if(!confirm("Delete?")) return; await fetch(`${API_BASE}/comments?id=${id}`, {method:'DELETE'}); loadNativeComments(currentPostId); };
window.adminBanUser = async function(uid) { const d=prompt("Days?"); if(!d)return; const r=prompt("Reason?"); if(!r)return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'ban_user', target_user_id:uid, days:d, reason:r})}); showToast("Done"); if(document.getElementById('view-admin').style.display === 'block') loadAdminBanList(); };
window.adminGenKey = async function() { const u=document.getElementById('adminTargetUser').value; const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_key', target_username:u})}); const d=await r.json(); document.getElementById('adminKeyResult').innerText=d.key; };
window.adminManageBalance = async function() {
    const u = document.getElementById('adminBalanceUser').value;
    const a = document.getElementById('adminBalanceAmount').value;
    const r = document.getElementById('adminBalanceReason').value;

    if (!u || !a || !r) return showToast("请填写完整信息", "error");
    if (!confirm(`⚠️ 确认给用户 [${u}] 进行资金变动: ${a} i币？`)) return;

    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'manage_balance',
                target_username: u,
                amount: a,
                reason: r
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, "success");
            document.getElementById('adminBalanceAmount').value = '';
            document.getElementById('adminBalanceReason').value = '';
            checkSecurity(); 
        } else {
            showToast(data.error, "error");
        }
    } catch (e) {
        showToast("网络错误", "error");
    }
};

window.adminGlobalWelfare = async function() {
    const xp = document.getElementById('welfareXp').value || 0;
    const coins = document.getElementById('welfareCoins').value || 0;
    const reason = document.getElementById('welfareReason').value;

    if (xp == 0 && coins == 0) return showToast("经验和i币至少填一项", "error");
    if (!reason) return showToast("请输入发放理由", "error");

    const confirmMsg = `⚠️⚠️ 高能预警 ⚠️⚠️\n\n即将向 [全服所有用户] 发放：\nXP: +${xp}\ni币: +${coins}\n\n确定要执行吗？`;
    if (!confirm(confirmMsg)) return;
    if (!confirm("再次确认：所有用户（包括被封禁的）都会收到奖励。是否继续？")) return;

    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                action: 'global_welfare',
                xp: xp,
                coins: coins,
                reason: reason
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, "success");
            document.getElementById('welfareXp').value = '';
            document.getElementById('welfareCoins').value = '';
            document.getElementById('welfareReason').value = '';
            checkSecurity();
        } else {
            showToast(data.error, "error");
        }
    } catch (e) {
        showToast("网络错误", "error");
    }
};

window.adminPostAnnounce = async function() { const t=document.getElementById('adminAnnounceTitle').value; const c=document.getElementById('adminAnnounceContent').value; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'post_announce', title:t, content:c})}); showToast("Posted"); };
window.adminGenInvite = async function() { const r=await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'gen_invite'})}); const d=await r.json(); document.getElementById('adminInviteResult').innerText=d.codes?d.codes.join('\n'):d.code; };
window.randomizeAvatar = async function() { if(!confirm("Randomize?"))return; const r=await fetch(`${API_BASE}/random_avatar`, {method:'POST'}); const d=await r.json(); if(d.success) window.location.reload(); };
window.updateProfile = async function() { const n=document.getElementById('newNickname').value; await fetch(`${API_BASE}/profile`, {method:'POST', body:JSON.stringify({nickname:n})}); window.location.reload(); };
window.buyVip = async function() { if(!confirm("Buy VIP?"))return; const r=await fetch(`${API_BASE}/vip`, {method:'POST'}); const d=await r.json(); showToast(d.message, 'success'); if(d.success) window.location.reload(); };
async function doLogout() { await fetch(`${API_BASE}/auth/logout`, {method:'POST'}); window.location.href='/login.html'; }
// === 修改后的打赏函数 (支持传入 postId) ===
window.tipUser = async function(uid, postId = null) {
    const amount = prompt("请输入打赏金额 (i币)：");
    if (!amount) return;
    
    if (!/^\d+$/.test(amount) || parseInt(amount) <= 0) {
        return showToast("请输入有效的整数金额", "error");
    }

    try {
        const res = await fetch(`${API_BASE}/tip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // === 关键：把 post_id 传给后端 ===
            body: JSON.stringify({ target_user_id: uid, amount: amount, post_id: postId })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, "success");
            setTimeout(() => {
                checkSecurity(); // 刷新余额
                // 如果是在看帖子，刷新帖子列表以更新打赏数显示
                if (postId) {
                    // 如果在详情页，重新加载详情
                    if (window.location.hash.startsWith('#post')) {
                        loadSinglePost(postId);
                    } else {
                        // 如果在首页，刷新列表 (虽然会导致滚动重置，但能看到数据变化)
                        // 或者你可以做一个局部更新 DOM 的逻辑，简单起见先全局刷新
                        loadPosts(true);
                    }
                }
            }, 1500);
        } else {
            showToast(data.error, "error");
        }
    } catch (e) {
        showToast("网络请求失败", "error");
    }
};

window.adminGrantTitle = async function() { const u = document.getElementById('adminTitleUser').value; const t = document.getElementById('adminTitleText').value; const c = document.getElementById('adminTitleColor').value; if(!u) return showToast("请输入用户名"); try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'grant_title', target_username: u, title: t, color: c }) }); const data = await res.json(); if(data.success) showToast("头衔发放成功！"); else showToast(data.error, 'error'); } catch(e) { showToast("网络连接错误", 'error');} };
window.adminUnbanUser = async function(uid) { if(!confirm("Unban?")) return; await fetch(`${API_BASE}/admin`, {method:'POST', body:JSON.stringify({action:'unban_user', target_user_id:uid})}); showToast("Done"); loadAdminBanList(); };
async function checkAdminStatus() {
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_stats' })
        });
        const data = await res.json();
        
        if (data.success) {
            const badge = document.getElementById('adminFeedbackBadge');
            
            // 这是你新增的逻辑，也要确保元素存在再赋值，防止报错
            const toggle = document.getElementById('turnstileToggle');
            if (toggle) {
                toggle.checked = data.turnstileEnabled;
            }

            if (badge) {
                if (data.unreadFeedback > 0) {
                    badge.style.display = 'inline-block';
                    badge.textContent = data.unreadFeedback;
                } else {
                    badge.style.display = 'none';
                }
            }
            
            const statTotal = document.getElementById('statTotalUsers');
            if (statTotal && statTotal.offsetParent !== null) {
                statTotal.innerText = data.totalUsers;
                document.getElementById('statActiveUsers').innerText = data.activeUsers;
                document.getElementById('inviteToggle').checked = data.inviteRequired;
            }
        }
    } catch (e) { }
}

async function loadAdminStats() { checkAdminStatus(); }
window.toggleInviteSystem = async function() { const enabled = document.getElementById('inviteToggle').checked; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'toggle_invite_system', enabled: enabled}) }); const data = await res.json(); showToast(data.message, 'success'); } catch(e){ showToast("设置失败"); } };
async function loadAdminInvites() { const tbody = document.querySelector('#adminInviteTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_invites'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(inv => { const isExpired = inv.expires_at < Date.now(); let status = '<span style="color:#0f0">可用</span>'; if(inv.is_used) status = '<span style="color:#666">已用</span>'; else if(isExpired) status = '<span style="color:#f00">过期</span>'; const tr = document.createElement('tr'); tr.innerHTML = `<td>${inv.code}</td><td>${status}</td><td>${new Date(inv.expires_at).toLocaleDateString()}</td><td><button onclick="copyText('${inv.code}')" class="mini-action-btn">COPY</button><button onclick="deleteInvite('${inv.code}')" class="mini-action-btn" style="color:#f33">DEL</button></td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="4">暂无数据</td></tr>'; } } catch(e) { tbody.innerHTML = '<tr><td colspan="4">Error</td></tr>'; } }
window.refillInvites = async function() { try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'refill_invites'}) }); const data = await res.json(); if(data.success) { showToast(data.message, 'success'); loadAdminInvites(); } else showToast(data.error, 'error'); } catch(e){ showToast("网络连接错误", 'error'); } };
window.deleteInvite = async function(code) { if(!confirm("Delete?")) return; try { await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'delete_invite', code: code}) }); loadAdminInvites(); } catch(e){ showToast("网络连接错误", 'error'); } };
async function loadAdminFeedbacks() { const tbody = document.querySelector('#adminFeedbackTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_feedbacks'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(fb => { const tr = document.createElement('tr'); if (!fb.is_read) tr.style.backgroundColor = 'rgba(255, 255, 0, 0.1)'; let replyHTML = ''; if (fb.reply_content) { replyHTML = `<div style="margin-top:5px;padding:5px;border-left:2px solid #0f0;font-size:0.8rem;color:#888;"><span style="color:#0f0">ADMIN:</span> ${fb.reply_content}</div>`; } tr.innerHTML = `<td>${fb.nickname || fb.username}</td><td style="white-space:pre-wrap;max-width:300px;">${fb.content}${replyHTML}<div style="margin-top:8px;">${!fb.is_read ? `<button onclick="adminMarkRead(${fb.id})" class="mini-action-btn" style="color:gold">已读</button>` : ''}<button onclick="adminReplyFeedback(${fb.id}, ${fb.user_id})" class="mini-action-btn" style="color:#0070f3">回复</button><button onclick="adminDeleteFeedback(${fb.id})" class="mini-action-btn" style="color:#f33">删除</button></div></td><td>${new Date(fb.created_at).toLocaleString()}</td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="3">暂无反馈</td></tr>'; } } catch(e) { tbody.innerHTML = '<tr><td colspan="3">Error</td></tr>'; } }
window.adminMarkRead = async function(id) { await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'mark_feedback_read', id}) }); loadAdminFeedbacks(); checkAdminStatus(); };
window.adminDeleteFeedback = async function(id) { if(!confirm("Delete feedback?")) return; await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'delete_feedback', id}) }); loadAdminFeedbacks(); checkAdminStatus(); };
window.adminReplyFeedback = async function(id, userId) { const reply = prompt("请输入回复内容："); if(!reply) return; const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'reply_feedback', id, user_id: userId, content: reply}) }); const d = await res.json(); if(d.success) { showToast(d.message, 'success'); loadAdminFeedbacks(); checkAdminStatus(); } else showToast(d.error); };
async function loadAdminBanList() { const tbody = document.querySelector('#adminBanTable tbody'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="4">Loading...</td></tr>'; try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_banned_users'}) }); const data = await res.json(); tbody.innerHTML = ''; if(data.success && data.list.length > 0) { data.list.forEach(u => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${u.nickname || u.username}</td><td>${u.ban_reason || '-'}</td><td>${new Date(u.ban_expires_at).toLocaleDateString()}</td><td><button onclick="adminUnbanUser(${u.id})" class="mini-action-btn" style="color:#0f0">解封</button></td>`; tbody.appendChild(tr); }); } else { tbody.innerHTML = '<tr><td colspan="4">无封禁用户</td></tr>'; } } catch(e){ tbody.innerHTML = '<tr><td colspan="4">Error</td></tr>'; } }

let lbScale = 1;   
let lbRotate = 0;  

function updateLightboxTransform() {
    const img = document.getElementById('lightboxImg');
    if(img) {
        img.style.transform = `scale(${lbScale}) rotate(${lbRotate}deg)`;
    }
}

window.openLightbox = function(src) {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    lbScale = 1;
    lbRotate = 0;
    img.src = src;
    updateLightboxTransform();
    lightbox.style.display = "block";
    
    img.onwheel = function(e) {
        e.preventDefault(); 
        if (e.deltaY < 0) {
            lbScale += 0.1;
        } else {
            lbScale -= 0.1;
        }
        if (lbScale < 0.1) lbScale = 0.1;
        if (lbScale > 5.0) lbScale = 5.0;
        updateLightboxTransform();
    };

    lightbox.onclick = function(e) {
        if (e.target === lightbox) {
            closeLightbox();
        }
    };
}

window.closeLightbox = function() {
    const lightbox = document.getElementById('lightbox');
    lightbox.style.display = "none";
    const img = document.getElementById('lightboxImg');
    if(img) img.onwheel = null;
}

window.rotateImage = function(e) {
    if(e) e.stopPropagation();
    lbRotate += 90;
    updateLightboxTransform();
}

window.saveBio = async function() {
    const bio = document.getElementById('settingBio').value;
    try {
        const res = await fetch(`${API_BASE}/profile`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ bio: bio })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, 'success');
            checkSecurity(); 
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络错误", 'error');
    }
};

let allNotifications = []; 

async function loadNotifications() { 
    const c = document.getElementById('notifyList'); 
    c.innerHTML='Loading...'; 
    try{ 
        const r = await fetch(`${API_BASE}/notifications`); 
        const d = await r.json(); 
        
        allNotifications = d.list || []; 
        renderNotifications(allNotifications);
        
    } catch(e){
        c.innerHTML='Error loading logs';
    } 
}

function renderNotifications(list) {
    const c = document.getElementById('notifyList');
    c.innerHTML = '';
    
    if(list.length === 0){
        c.innerHTML = '<p style="color:#666;text-align:center;">No logs under this category.</p>';
        return;
    }
    
    list.forEach(n => { 
        const div=document.createElement('div'); 
        div.className=`notify-item ${n.is_read?'':'unread'}`; 
        const delSpan = `<span onclick="event.stopPropagation(); deleteNotify('${n.id}')" style="float:right;color:#666;cursor:pointer;margin-left:10px">[x]</span>`; 
        div.innerHTML=`<div class="notify-msg">${n.message} ${delSpan}</div><div class="notify-time">${new Date(n.created_at).toLocaleString()}</div>`; 
        div.onclick = () => readOneNotify(n.id, n.link, div); 
        c.appendChild(div); 
    });
}

window.filterNotifications = function(type, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    if (type === 'all') {
        renderNotifications(allNotifications);
    } else {
        const filtered = allNotifications.filter(n => n.type === type);
        renderNotifications(filtered);
    }
};

function bootSystem() {
    console.log("SYSTEM BOOTING...");
    initApp();
    checkSecurity();
}

if (document.readyState === 'interactive' || document.readyState === 'complete') {
    bootSystem();
} else {
    document.addEventListener('DOMContentLoaded', bootSystem);
}

// === 加载个人主页 ===
async function loadUserProfile(username) {
    const container = document.getElementById('view-profile');
    if(!container) return;
    
    // UI重置
    document.getElementById('profileName').textContent = "LOADING...";
    document.getElementById('profileAvatar').innerHTML = "";
    document.getElementById('profileRecentPosts').innerHTML = "";
    document.getElementById('profileActions').innerHTML = "";

    try {
        const res = await fetch(`${API_BASE}/profile_public?u=${username}`);
        const data = await res.json();

        if (!data.success) {
            showToast("用户不存在", "error");
            return;
        }

        const u = data.user;
        const s = data.stats;

        // 填充信息
        const pName = document.getElementById('profileName');
        pName.textContent = u.nickname || u.username;
        
        // === 修复个人主页名字颜色 ===
        pName.className = ''; // 重置
        if (u.name_color) {
             const ncItem = SHOP_CATALOG.find(i => i.id === u.name_color);
             if (ncItem) pName.classList.add(ncItem.css);
        }
        document.getElementById('profileAvatar').innerHTML = renderUserAvatar(u); 
        document.getElementById('profileBio').textContent = u.bio || "这个人很懒，什么也没写。";
        document.getElementById('profileBadges').innerHTML = getBadgesHtml(u); // 复用之前的徽章函数

        // 填充数据
        document.getElementById('statPosts').innerText = s.posts;
        document.getElementById('statLikes').innerText = s.likes;
        document.getElementById('statFollowing').innerText = s.following;
        document.getElementById('statFollowers').innerText = s.followers;

        // 关注按钮逻辑
        const actionBox = document.getElementById('profileActions');
        
        if (currentUser && currentUser.username !== u.username) {
            // 判断关注状态
            const followText = s.isFollowing ? "已关注" : "关注";
            // 已关注用实心样式(filled)，未关注用默认样式
            const followClass = s.isFollowing ? "cyber-btn filled" : "cyber-btn";
            let blockBtnHtml = '';
            if (s.hasBlocked) {
                // 如果已拉黑，显示灰色“解除”按钮，点击触发 unblock
                blockBtnHtml = `<button onclick="blockUser('${u.id}', 'unblock')" class="cyber-btn" style="flex:1; margin:0; border-color:#666; color:#888;">解除</button>`;
            } else {
                // 如果未拉黑，显示红色“拉黑”按钮，点击触发 block
                blockBtnHtml = `<button onclick="blockUser('${u.id}', 'block')" class="cyber-btn danger" style="flex:1; margin:0;">拉黑</button>`;
            }
            
            actionBox.innerHTML = `
                <div style="display:flex; gap:10px; justify-content:center; width:100%; max-width:500px; margin:0 auto;">
                    <button onclick="toggleFollow(${u.id}, this)" class="${followClass}" style="flex:1; margin:0;">${followText}</button>
                    <button onclick="handleFriend('${u.id}', 'add')" class="cyber-btn" style="flex:1; margin:0;">加好友</button>
                    <button onclick="openChat('${u.id}', '${u.nickname||u.username}')" class="cyber-btn" style="flex:1; margin:0;">私信</button>
                    <button onclick="blockUser('${u.id}')" class="cyber-btn danger" style="flex:1; margin:0;">拉黑</button>
                </div>
            `;
        } else if (currentUser && currentUser.username === u.username) {
            actionBox.innerHTML = `<button onclick="window.location.hash='#settings'" class="cyber-btn" style="width:auto; padding:5px 30px;">编辑资料</button>`;
        }

        // 最近动态
        const list = document.getElementById('profileRecentPosts');
        if (data.recentPosts.length === 0) {
            list.innerHTML = '<p style="color:#666;text-align:center">暂无动态</p>';
        } else {
            data.recentPosts.forEach(p => {
                const div = document.createElement('div');
                div.className = 'post-card';
                div.innerHTML = `<div style="font-size:0.8rem;color:#666">${new Date(p.created_at).toLocaleDateString()}</div><h3>${p.title}</h3>`;
                div.onclick = () => window.location.hash = `#post?id=${p.id}`;
                list.appendChild(div);
            });
        }
        loadTasks();

    } catch(e) {
        showToast("加载失败", "error");
    }
}

// === 关注/取关 ===
window.toggleFollow = async function(targetId, btn) {
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/follow`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ target_id: targetId })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            if (data.status === 'followed') {
                // 变成已关注状态 (实心蓝)
                btn.textContent = "已关注";
                btn.classList.add('filled');
                // 粉丝数+1
                const el = document.getElementById('statFollowers');
                el.innerText = parseInt(el.innerText) + 1;
            } else {
                // 变成未关注状态 (空心)
                btn.textContent = "关注";
                btn.classList.remove('filled');
                // 粉丝数-1
                const el = document.getElementById('statFollowers');
                el.innerText = Math.max(0, parseInt(el.innerText) - 1);
            }
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络错误", "error");
    } finally {
        btn.disabled = false;
    }
};

// === 加载排行榜 ===
async function loadLeaderboard() {
    const container = document.querySelector('.leaderboard-grid');
    if(!container) return;
    
    container.innerHTML = '<div class="loading">Loading data...</div>';

    try {
        const res = await fetch(`${API_BASE}/leaderboard`);
        const data = await res.json();
        
        if (!data.success) throw new Error("API Error");

        container.innerHTML = ''; // 清空

        // 定义四个榜单的配置
        const boards = [
            { title: "⚡ 等级天梯", data: data.xp, valueKey: 'xp', format: v => `${v} XP` },
            { title: "🏦 财富榜",   data: data.coins, valueKey: 'coins', format: v => `<span style="color:#FFD700">${v} i</span>` },
            { title: "💸 慈善家", data: data.sent, valueKey: 'tips_sent', format: v => `${v} i` },
            { title: "💰 创作者", data: data.received, valueKey: 'tips_received', format: v => `${v} i` },
            { title: "❤️ 人气王", data: data.likes, valueKey: 'likes_received', format: v => `${v} ❤` }
        ];

        boards.forEach(board => {
            const card = document.createElement('div');
            card.className = 'rank-card';
            
            let listHtml = '';
            if (board.data.length === 0) {
                listHtml = '<li style="padding:10px;text-align:center;color:#666">虚位以待 / EMPTY</li>';
            } else {
                board.data.forEach((u, index) => {
                    const avatar = renderUserAvatar(u);
                    // 复用徽章逻辑
                    const badges = getBadgesHtml({ 
                        role: 'user', // 排行榜暂时不显示管理标，防乱
                        is_vip: u.is_vip, 
                        xp: u.xp, // 用XP计算等级
                        custom_title: u.custom_title,
                        custom_title_color: u.custom_title_color
                    });
                    
                    listHtml += `
                        <li class="rank-item">
                            <div class="rank-num">${index + 1}</div>
                            <div class="rank-user" onclick="window.location.hash='#profile?u=${u.username}'">
                                <div style="width:30px;height:30px;border-radius:4px;overflow:hidden">${avatar}</div>
                                <div>
                                    <div style="font-size:0.9rem;font-weight:bold">${u.nickname || u.username}</div>
                                    <div style="font-size:0.7rem">${badges}</div>
                                </div>
                            </div>
                            <div class="rank-value">${board.format(u[board.valueKey])}</div>
                        </li>
                    `;
                });
            }

            card.innerHTML = `<h3>${board.title}</h3><ul class="rank-list">${listHtml}</ul>`;
            container.appendChild(card);
        });
        loadTasks(); 

    } catch (e) {
        container.innerHTML = 'Error loading leaderboard.';
        showToast("排行榜加载失败", "error");
    }
}

window.buyItem = async function(itemId) {
    // 查找商品信息
    const item = SHOP_CATALOG.find(i => i.id === itemId);
    if (!item) return showToast("商品数据错误", "error");

    let quantity = 1;

    // 如果是消耗品 (种子/卡片)，询问数量
    if (item.type === 'consumable') {
        const input = prompt(`请输入购买 [${item.name}] 的数量 (单价: ${item.cost})`, "1");
        if (input === null) return; // 取消
        quantity = parseInt(input);
        if (isNaN(quantity) || quantity < 1) return showToast("数量无效", "error");
        
        if (!confirm(`确认购买 ${quantity} 个 [${item.name}]？\n总价: ${quantity * item.cost} i币`)) return;
    } else {
        // 非消耗品 (VIP/装饰) 直接确认
        if(!confirm(`确定购买 [${item.name}] 吗？\n价格: ${item.cost} i币`)) return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/shop`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'buy', itemId: itemId, quantity: quantity })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            checkSecurity(); // 刷新余额
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("购买失败: 网络错误", 'error');
    }
};

// === 加载黑名单列表 ===
window.loadBlockedUsers = async function() {
    const container = document.getElementById('blockedListContainer');
    if(!container) return;
    
    container.innerHTML = '<div style="text-align:center;color:#666">Loading...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/block`);
        const data = await res.json();
        
        if (data.list.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#666;padding:10px;">暂无拉黑用户</div>';
            return;
        }
        
        let html = '';
        data.list.forEach(u => {
            const avatar = renderUserAvatar(u); // 复用头像渲染
            html += `
                <div style="display:flex; align-items:center; padding:10px; border-bottom:1px dashed #333;">
                    <div style="width:30px; height:30px; border-radius:50%; overflow:hidden; margin-right:10px;">${avatar}</div>
                    <div style="flex:1; font-size:0.9rem;">${u.nickname || u.username}</div>
                    <button onclick="blockUser('${u.id}', 'unblock')" class="cyber-btn" style="width:auto; font-size:0.7rem; padding:2px 8px; margin:0;">解除</button>
                </div>
            `;
        });
        container.innerHTML = html;
        
    } catch(e) {
        container.innerHTML = '<div style="color:red">加载失败</div>';
    }
};

// === 切换背包标签 ===
window.switchInventoryTab = function(type) {
    // 1. UI 高亮切换
    document.querySelectorAll('.inv-tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    // 2. 重新加载并筛选
    loadInventory(type);
};

// === 加载背包 (优化版：支持分类) ===
async function loadInventory(filterCategory = 'all') {
    const c = document.getElementById('inventoryList');
    c.innerHTML = '<div class="loading">Loading Inventory...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/inventory`);
        const data = await res.json();
        
        if (!data.success || data.list.length === 0) {
            c.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#666;padding:20px;">背包空空如也<br>去商城看看吧</div>';
            return;
        }
        
        // === 核心逻辑：前端分类过滤 ===
        // 后端的 category 字段值通常为: 'background', 'post_style', 'bubble', 'name_color', 'consumable'
        let filteredList = data.list;

        if (filterCategory !== 'all') {
            filteredList = data.list.filter(item => item.category === filterCategory);
        }
        
        if (filteredList.length === 0) {
            c.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#666;padding:20px;">该分类下暂无物品</div>';
            return;
        }
        
        c.innerHTML = '';
        filteredList.forEach(item => {
            // 从目录找详情
            const catalogItem = SHOP_CATALOG.find(i => i.id === item.item_id);
            // 如果目录里找不到（比如改名了），就用默认值，防止报错
            const itemName = catalogItem ? catalogItem.name : item.item_id;
            const itemIcon = catalogItem ? catalogItem.icon : '📦';
            const itemRarity = catalogItem ? catalogItem.rarity : 'common';
            const itemDesc = catalogItem ? catalogItem.desc : '';

            let actionBtn = '';
            
            // 1. 消耗品逻辑 (Consumable)
            if (item.category === 'consumable') {
                // 基础显示：数量
                actionBtn = `<div style="color:#aaa;font-size:0.8rem;margin-top:5px; border:1px solid #333; padding:5px; border-radius:4px;">拥有数量: <span style="color:#fff; font-weight:bold;">${item.quantity}</span></div>`;
                
                // === 修复：如果是播报卡，额外显示“使用”按钮 ===
                if (item.item_id.includes('broadcast')) {
                    actionBtn += `<button onclick="openBroadcastModal('${item.item_id}')" class="cyber-btn" style="width:100%; margin-top:10px; border-color:#00f3ff; color:#00f3ff;">启动 / ACTIVATE</button>`;
                }
            } 
            // 2. 可装备道具逻辑 (Decoration / Timed)
            else {
                if (item.is_equipped) {
                    actionBtn = `<button onclick="toggleEquip('${item.id}', '${item.category}', 'unequip')" class="cyber-btn" style="border-color:#0f0;color:#0f0;width:100%;margin-top:10px;">已装备 / UNSET</button>`;
                } else {
                    actionBtn = `<button onclick="toggleEquip('${item.id}', '${item.category}', 'equip')" class="cyber-btn" style="width:100%;margin-top:10px;">使用 / EQUIP</button>`;
                }
                
                // 显示剩余时间
                if (item.expires_at > 0) {
                    const daysLeft = Math.ceil((item.expires_at - Date.now()) / (86400000));
                    const expireText = daysLeft > 0 ? `剩余 ${daysLeft} 天` : `已过期`;
                    const color = daysLeft > 0 ? '#aaa' : '#f33';
                    actionBtn += `<div style="font-size:0.7rem; color:${color}; margin-top:5px;">${expireText}</div>`;
                }
            }
            
            // ... (后半部分 div.innerHTML 保持不变)
            const div = document.createElement('div');
            div.className = `glass-card shop-item ${itemRarity} ${item.is_equipped?'equipped':''}`;
            div.innerHTML = `
                <div class="item-icon">${itemIcon}</div>
                <h3 style="margin:5px 0; font-size:1rem;">${itemName}</h3>
                <p style="font-size:0.7rem; color:#666; margin-bottom:5px;">${itemDesc}</p>
                ${actionBtn}
            `;
            c.appendChild(div);
        });

    } catch(e) { 
        console.error(e);
        c.innerHTML = '<div style="color:red">加载背包失败</div>'; 
    }
}

// === 装备/卸下 ===
window.toggleEquip = async function(id, cat, action) {
    const res = await fetch(`${API_BASE}/inventory`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action, itemId: id, category: cat })
    });
    const d = await res.json();
    if(d.success) {
        showToast(d.message, 'success');
        loadInventory(); // 刷新背包状态
        checkSecurity(); // 刷新自身状态(背景等)
    }
};

// === 前端商品数据 (完整映射版) ===
const SHOP_CATALOG = [
    // === 💎 VIP 会员 ===
    { id: 'vip_7', cost: 70, name: 'VIP 周卡', type: 'vip', icon: '🎫', rarity: 'common', desc: '经验+45% / 7天' },
    { id: 'vip_14', cost: 120, name: 'VIP 进阶卡', type: 'vip', icon: '⚡', rarity: 'rare', desc: '经验+45% / 14天' },
    { id: 'vip_30', cost: 210, name: 'VIP 尊享月卡', type: 'vip', icon: '👑', rarity: 'epic', desc: '经验+45% / 30天' },

    // === 💳 道具 ===
    { id: 'rename_card', cost: 100, name: '改名卡', type: 'consumable', category: 'consumable', icon: '💳', rarity: 'common', desc: '修改一次昵称' },
    { id: 'top_card', cost: 500, name: '置顶卡 (24h)', type: 'consumable', category: 'consumable', icon: '📌', rarity: 'rare', desc: '将你的帖子置顶一天' },
    // === 📢 全服播报卡 (Broadcast) ===
    { id: 'broadcast_low', cost: 500, name: '基础信标卡', type: 'consumable', category: 'consumable', icon: '📡', rarity: 'rare', desc: '全服广播(系统预设)，持续24h' },
    { id: 'broadcast_high', cost: 2000, name: '骇客宣言卡', type: 'consumable', category: 'consumable', icon: '🛰️', rarity: 'legendary', desc: '自定义全服广播(支持幻彩)，持续24h' },
    // 在 script.js 的 SHOP_CATALOG 数组里添加：
    { id: 'seed_moss', cost: 20, name: '种子：低频苔藓', type: 'consumable', category: 'consumable', icon: '<img src="https://img.1eak.cool/dipintaixian.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 5px rgba(0,255,0,0.3));">', rarity: 'common', desc: '家园种植用，4小时成熟。' },
    { id: 'seed_quantum', cost: 100, name: '种子：量子枝条', type: 'consumable', category: 'consumable', icon: '<img src="https://img.1eak.cool/liangzizhitiao.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 5px rgba(0,243,255,0.3));">', rarity: 'rare', desc: '家园种植用，12小时成熟。' },
    { id: 'seed_vine', cost: 300, name: '种子：修复算法藤', type: 'consumable', category: 'consumable', icon: '<img src="https://img.1eak.cool/suanfateng.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 5px rgba(189,0,255,0.3));">', rarity: 'epic', desc: '家园种植用，24小时成熟。' },
    { id: 'item_algo_frag', cost: 9999, name: '加速算法碎片', type: 'material', category: 'consumable', icon: '<img src="https://img.1eak.cool/jiasuhexin.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 8px gold);">', rarity: 'legendary', desc: '非常稀有的数据碎片，可用于系统升级(功能开发中)。' },
    // === 🌌 网页背景 (Backgrounds) ===
    { id: 'bg_matrix', cost: 500, name: '矩阵数据流', type: 'decoration', category: 'background', icon: '👾', rarity: 'rare', desc: '黑客潜行风格（网页背景）' },
    { id: 'bg_space', cost: 900, name: '深空星系', type: 'decoration', category: 'background', icon: '🌌', rarity: 'epic', desc: '深邃星空视差（网页背景）' },
    { id: 'bg_cyber', cost: 800, name: '视界线', type: 'decoration', category: 'background', icon: '🏙️', rarity: 'epic', desc: 'Synthwave 视界线（网页背景）' },
    { id: 'bg_sakura', cost: 600, name: '幽夜樱花', type: 'decoration', category: 'background', icon: '🌸', rarity: 'rare', desc: '暗黑护眼夜樱（网页背景）' },
    { id: 'bg_fire', cost: 1200, name: '地狱烈焰', type: 'decoration', category: 'background', icon: '🔥', rarity: 'legendary', desc: '动态岩浆粒子（网页背景）' },
    { id: 'bg_abyss', cost: 1000, name: '深渊幽蓝', type: 'decoration', category: 'background', icon: '🐋', rarity: 'epic', desc: '深海荧光与气泡（网页背景）' },
    
    // === 🖼️ 帖子边框 (Post Styles) - 关键：必须有 css 字段 ===
    { id: 'post_neon', cost: 200, name: '霓虹边框', type: 'decoration', category: 'post_style', css: 'style-neon', icon: '🟦', rarity: 'common', desc: '蓝色发光边框（帖子边框）' },
    { id: 'post_glitch', cost: 300, name: '故障艺术', type: 'decoration', category: 'post_style', css: 'style-glitch', icon: '📺', rarity: 'rare', desc: '赛博故障风（帖子边框）' },
    { id: 'post_pixel', cost: 250, name: '复古像素', type: 'decoration', category: 'post_style', css: 'style-pixel', icon: '👾', rarity: 'common', desc: '黑白像素风格（帖子边框）' },
    { id: 'post_gold', cost: 500, name: '黄金传说', type: 'decoration', category: 'post_style', css: 'style-gold', icon: '🟨', rarity: 'epic', desc: '土豪专属流光金框（帖子边框）' },
    { id: 'post_fire', cost: 800, name: '燃烧之魂', type: 'decoration', category: 'post_style', css: 'style-fire', icon: '🔥', rarity: 'legendary', desc: '火焰动态边框（帖子边框）' },
    
    // === 💬 聊天气泡 (Chat Bubbles) - 关键：必须有 css 字段 ===
    { id: 'bubble_pink', cost: 150, name: '赛博粉', type: 'decoration', category: 'bubble', css: 'bubble-pink', icon: '💗', rarity: 'common', desc: '粉色发光气泡（聊天气泡）' },
    { id: 'bubble_green', cost: 150, name: '黑客绿', type: 'decoration', category: 'bubble', css: 'bubble-hacker', icon: '📟', rarity: 'common', desc: '终端风格气泡（聊天气泡）' },
    { id: 'bubble_blue', cost: 200, name: '深海蓝', type: 'decoration', category: 'bubble', css: 'bubble-sea', icon: '🌊', rarity: 'rare', desc: '深蓝渐变气泡（聊天气泡）' },
    { id: 'bubble_gold', cost: 400, name: '土豪金', type: 'decoration', category: 'bubble', css: 'bubble-gold', icon: '💰', rarity: 'epic', desc: '金色渐变气泡（聊天气泡）' },
    
    // === 🌈 名字颜色 (Name Colors) ===
    { id: 'color_fire', cost: 200, name: '火焰昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-fire', icon: '🔥', rarity: 'rare', desc: '30天火焰特效（名字颜色）' },
    { id: 'color_ice', cost: 200, name: '冰霜昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-ice', icon: '❄️', rarity: 'rare', desc: '30天冰蓝特效（名字颜色）' },
    { id: 'color_rainbow', cost: 300, name: '彩虹昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-rainbow', icon: '🌈', rarity: 'epic', desc: '30天七彩流光（名字颜色）' },
    { id: 'color_gold', cost: 500, name: '至尊金名', type: 'timed', category: 'name_color', days: 30, css: 'color-gold', icon: '👑', rarity: 'legendary', desc: '30天土豪金名（名字颜色）' },
];

window.renderShop = async function(filterType = 'all') {
    const container = document.getElementById('shop-list');
    const rechargeArea = document.getElementById('recharge-area');
    
    if(!container) return;
    
    // 1. 处理充值 Tab (显示静态区域，不渲染商品)
    if (filterType === 'recharge') {
        if(rechargeArea) rechargeArea.style.display = 'block';
        container.style.display = 'none';
        return;
    } 
    
    // 其他 Tab：隐藏充值区，显示商品网格
    if(rechargeArea) rechargeArea.style.display = 'none';
    container.style.display = 'grid';
    container.innerHTML = '<div class="loading">Loading Shop Data...</div>';
    
    // 2. 获取背包数据 (用于判断“已拥有”)
    let ownedItemIds = [];
    try {
        const res = await fetch(`${API_BASE}/inventory`);
        const data = await res.json();
        if(data.success && data.list) {
            ownedItemIds = data.list.map(item => item.item_id);
        }
    } catch(e) {}

    // 3. 筛选商品 (核心逻辑：分类筛选 + 排除 material 类型)
    const filtered = (filterType === 'all' ? SHOP_CATALOG : SHOP_CATALOG.filter(i => {
        if (filterType === 'vip') return i.type === 'vip';
        if (filterType === 'consumable') return i.type === 'consumable';
        if (filterType === 'decoration') return i.type === 'decoration' || i.type === 'timed';
        return i.type === filterType;
    }))
    .filter(i => i.type !== 'material'); // 👈 关键：排除掉碎片等非卖品

    container.innerHTML = '';
    
    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#666; width:100%;">暂无此类商品</div>';
        return;
    }

    // 4. 渲染卡片
    filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = `glass-card shop-item ${item.rarity || ''}`;
        
        const isOwned = ownedItemIds.includes(item.id);
        let actionButtons = '';

        // === 核心修改：根据类型生成不同的按钮 ===
        
        // A. 支持预览的类型 (装饰、特效、背景等)
        if (item.type === 'decoration' || item.type === 'timed' || item.category === 'post_style' || item.category === 'bubble' || item.category === 'name_color' || item.category === 'background') {
            
            // 生成 "预览" + "购买" 双按钮
            actionButtons = `
                <div style="display:flex; gap:5px; width:100%; margin-top:10px;">
                    <button onclick="previewItem('${item.id}')" class="cyber-btn" style="flex:1; margin:0; font-size:0.8rem; border-color:#aaa; color:#aaa;">👁️ 预览</button>
                    <button onclick="buyItem('${item.id}')" class="cyber-btn" style="flex:1; margin:0; font-size:0.8rem;">购买</button>
                </div>
            `;
            
            // 如果是永久装饰且已拥有，显示“已拥有” (时效性物品仍允许续费购买)
            if (isOwned && item.type !== 'timed') {
                actionButtons = `<button class="cyber-btn" disabled style="width:100%; margin-top:10px; border-color:#333; color:#666;">✓ 已拥有</button>`;
            }
            // 补充：如果是时效性物品且已拥有，按钮文字可以变更为“续费”
            else if (isOwned && item.type === 'timed') {
                 actionButtons = `
                    <div style="display:flex; gap:5px; width:100%; margin-top:10px;">
                        <button onclick="previewItem('${item.id}')" class="cyber-btn" style="flex:1; margin:0; font-size:0.8rem; border-color:#aaa; color:#aaa;">👁️ 预览</button>
                        <button onclick="buyItem('${item.id}')" class="cyber-btn" style="flex:1; margin:0; font-size:0.8rem; border-color:gold; color:gold;">续费</button>
                    </div>
                `;
            }

        } 
        // B. 不支持预览的类型 (消耗品、VIP、种子)
        else {
            let btnText = '购买';
            if (item.type === 'vip') btnText = '购买 / 续费';
            
            actionButtons = `<button onclick="buyItem('${item.id}')" class="cyber-btn" style="width:100%; margin-top:10px;">${btnText}</button>`;
        }

        div.innerHTML = `
            <div class="item-icon">${item.icon}</div>
            <h3 style="margin:5px 0; font-size:1rem;">${item.name}</h3>
            <p style="color:#888; font-size:0.8rem; height:40px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${item.desc}</p>
            <div class="price" style="color:${item.rarity==='legendary'?'#FFD700':'#fff'}">${item.cost} i</div>
            ${actionButtons}
        `;
        container.appendChild(div);
    });
};
// === 切换标签 ===
window.switchShopTab = function(type) {
    // 切换按钮高亮
    document.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    // 重新渲染
    renderShop(type);
};

// === 管理后台：搜索用户 ===
window.adminSearchUsers = async function() {
    const input = document.getElementById('adminSearchInput');
    const tbody = document.querySelector('#adminUserTable tbody');
    const query = input.value.trim();
    
    if(!query) return showToast("请输入关键词", "error");
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Searching...</td></tr>';
    
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'search_users', query: query })
        });
        const data = await res.json();
        
        if (data.success) {
            if (data.list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">未找到匹配用户</td></tr>';
                return;
            }
            
            let html = '';
            data.list.forEach(u => {
                // 快捷操作按钮：复制账号、封号
                const copyBtn = `<button onclick="copyText('${u.username}')" class="mini-action-btn">复制账号</button>`;
                const banBtn = `<button onclick="adminBanUser('${u.id}')" class="mini-action-btn" style="color:red; border-color:red;">封禁</button>`;
                // 还可以加一个快捷查密钥
                // 传递 ID 和 用户名
                const keyBtn = `<button onclick="adminGenKey('${u.id}', '${u.username}')" class="mini-action-btn" style="color:gold; border-color:gold;">查密钥</button>`;

                html += `
                    <tr>
                        <td>${u.id}</td>
                        <td style="color:#00ccff; font-weight:bold;">${u.username}</td>
                        <td>${u.nickname || '-'}</td>
                        <td>${u.coins}</td>
                        <td>${copyBtn} ${keyBtn}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        } else {
            showToast(data.error, "error");
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Error</td></tr>';
        }
    } catch(e) {
        showToast("网络错误", "error");
    }
};

// === N.O.D.E Console Logic ===

async function loadNodeConsole() {
    const userEl = document.getElementById('nodeUser');
    const costEl = document.getElementById('nodeCostDisplay');
    const btn = document.getElementById('exploreBtn');
    
    if(currentUser) {
        userEl.innerText = (currentUser.nickname || currentUser.username).toUpperCase();
    }

    // 判断今日是否已免费探索
    // 我们需要简单判断本地状态，或者后端返回。
    // 为了准确，这里我们假设 currentUser 数据中已经包含了 last_node_explore_date 
    // (注意：checkSecurity 需要确保返回了这个新字段，或者我们在这里单独调一次 user 接口，或者直接依靠后端返回的错误来判断)
    
    // 简单起见，我们直接显示通用文本，由点击后的反馈决定
    costEl.innerHTML = "正在同步卫星数据...";
    
    // 获取最新状态 (复用 /api/user 稍微有点重，但最准确)
    try {
        const res = await fetch(`${API_BASE}/user`);
        const data = await res.json();
        if(data.loggedIn) {
            currentUser = data; // 更新全局状态
            const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
            const isFree = (data.last_node_explore_date !== today);
            
            if(isFree) {
                costEl.innerHTML = `本次扫描消耗: <span style="color:#0f0">0 i币 (每日免费)</span>`;
                
                // === 修改这里：汉化按钮 ===
                btn.innerText = "启动扫描程序 (免费)";
            } else {
                costEl.innerHTML = `本次扫描消耗: <span style="color:#ff00de">50 i币</span> (余额: ${data.coins})`;
                
                // === 修改这里：汉化按钮 ===
                btn.innerText = "启动扫描程序 (-50)";
            }
        }
    } catch(e) {
        costEl.innerText = "连接中断";
    }
}

function addNodeLog(msg, type='') {
    const logBox = document.getElementById('nodeLog');
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    
    // 打字机效果
    div.innerText = "> ";
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;

    let i = 0;
    const interval = setInterval(() => {
        div.innerText += msg.charAt(i);
        i++;
        logBox.scrollTop = logBox.scrollHeight;
        if (i >= msg.length) clearInterval(interval);
    }, 20); // 打字速度
}

window.exploreNode = async function() {
    const btn = document.getElementById('exploreBtn');
    const centerBtn = document.getElementById('centralNode');
    
    if(btn.disabled) return;
    
    btn.disabled = true;
    centerBtn.classList.add('scanning'); // 触发CSS旋转/发光动画
    addNodeLog("CONNECTING TO NODE...", "info");

    try {
        // 模拟扫描延迟
        await new Promise(r => setTimeout(r, 800));

        const res = await fetch(`${API_BASE}/node`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        });
        const data = await res.json();
        
        centerBtn.classList.remove('scanning');

        if (data.success) {
            const rarityClass = `rarity-${data.rarity}`; // 自动对应 .rarity-epic 等
            let logType = "";
            if (data.type === 'glitch') logType = "error";
            else if (data.type === 'item' || data.type === 'mission') logType = "warn";
            else if (data.type === 'reward_coin' || data.type === 'reward_xp') logType = "info";
            
            addNodeLog(data.message, rarityClass);

            if (data.rarity === 'legendary') {
                document.body.style.animation = "shake 0.5s";
                setTimeout(()=>document.body.style.animation="", 500);
            }
            // === 核心修改：立即更新全局状态和UI ===
            
            // 1. 更新全局变量
            if (currentUser) {
                if (data.new_coins !== undefined) currentUser.coins = data.new_coins;
                if (data.new_xp !== undefined) currentUser.xp = data.new_xp;
            }

            // 2. 更新侧边栏：金币
            const coinEl = document.getElementById('coinCount');
            if (coinEl && data.new_coins !== undefined) {
                // 做一个简单的数字跳动效果（可选）
                coinEl.innerText = data.new_coins;
                coinEl.style.color = '#00ff00';
                setTimeout(() => coinEl.style.color = '', 500); // 闪一下绿色
            }

            // 3. 更新侧边栏：经验条和等级
            if (data.new_xp !== undefined) {
                const xpText = document.getElementById('xpText');
                const xpBar = document.getElementById('xpBar');
                const badgesArea = document.getElementById('badgesArea');
                
                // 重新计算等级
                const levelInfo = calculateLevel(data.new_xp);
                
                if (xpText) xpText.textContent = `${data.new_xp} / ${levelInfo.next}`;
                if (xpBar) xpBar.style.width = `${levelInfo.percent}%`;

                // 如果升级了，刷新徽章区域
                if (badgesArea && currentUser) {
                     badgesArea.innerHTML = getBadgesHtml(currentUser) + `<div id="logoutBtn">EXIT</div>`;
                     // 因为 innerHTML 覆盖了 DOM，需要重新绑定退出按钮事件
                     const logoutBtn = document.getElementById('logoutBtn');
                     if(logoutBtn) logoutBtn.onclick = doLogout;
                }
                if (data.rarity === 'epic' || data.rarity === 'legendary') {
                    setTimeout(loadNodeBroadcast, 1000); 
                }
            }

            // 4. 刷新控制台自身的按钮状态
            loadNodeConsole(); 
            
            // 5. 如果触发了任务，刷新任务列表
            if (data.type === 'mission') loadTasks();

        } else {
            addNodeLog("ERROR: " + data.error, "error");
            showToast(data.error, 'error');
        }
    } catch (e) {
        centerBtn.classList.remove('scanning');
        addNodeLog("CRITICAL FAILURE: NETWORK LOST", "error");
        console.error(e);
    } finally {
        btn.disabled = false;
    }
};

window.multiExploreNode = async function() {
    const btn = document.getElementById('multiExploreBtn');
    const centerBtn = document.getElementById('centralNode');
    
    if(btn.disabled) return;
    
    // === 修改点 1: 删除了 confirm 弹窗确认 ===
    // if(!confirm("确定消耗 250 i币 进行 5 次快速检索吗？")) return; 

    btn.disabled = true;
    centerBtn.classList.add('scanning'); 
    
    // === 修改点 2: 立即打印连接日志，仿照单抽风格 ===
    // 使用 addNodeLog 会自动添加 "> " 前缀
    addNodeLog("ESTABLISHING HIGH-SPEED CONNECTION...", "info"); 

    try {
        await new Promise(r => setTimeout(r, 800)); // 稍微增加一点延迟感，更有“连接中”的感觉

        const res = await fetch(`${API_BASE}/node`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'multi_explore' })
        });
        const data = await res.json();
        
        centerBtn.classList.remove('scanning');

        if (data.success) {
            // 1. 播放最高稀有度的特效
            if (data.rarity === 'legendary') {
                document.body.style.animation = "shake 0.5s";
                setTimeout(()=>document.body.style.animation="", 500);
            }

            // 2. 打印 5 条日志
            data.summary.forEach((msg, idx) => {
                setTimeout(() => {
                    let type = '';
                    if (msg.includes('[EPIC]')) type = 'rarity-epic';
                    else if (msg.includes('[LEGENDARY]')) type = 'rarity-legendary';
                    else if (msg.includes('[RARE]')) type = 'rarity-rare';
                    else if (msg.includes('[GLITCH]')) type = 'rarity-glitch';
                    
                    addNodeLog(msg, type);
                }, idx * 200); 
            });

            // 3. 更新 UI
            if (currentUser) {
                currentUser.coins = data.new_coins;
                currentUser.xp = data.new_xp;
            }
            // 刷新侧边栏
            const coinEl = document.getElementById('coinCount');
            if (coinEl) coinEl.innerText = data.new_coins;
            
            // 刷新经验条
            const xpText = document.getElementById('xpText');
            const xpBar = document.getElementById('xpBar');
            if (xpText && xpBar) {
                const levelInfo = calculateLevel(data.new_xp);
                xpText.textContent = `${data.new_xp} / ${levelInfo.next}`;
                xpBar.style.width = `${levelInfo.percent}%`;
            }

            // 刷新按钮状态
            loadNodeConsole();

        } else {
            addNodeLog("ERROR: " + data.error, "error");
            showToast(data.error, 'error');
        }
    } catch (e) {
        centerBtn.classList.remove('scanning');
        addNodeLog("CRITICAL FAILURE: NETWORK LOST", "error");
        console.error(e);
    } finally {
        btn.disabled = false;
    }
};

// 拉取全服广播
async function loadNodeBroadcast() {
    const ticker = document.getElementById('nodeTicker');
    if(!ticker) return;
    
    try {
        const res = await fetch(`${API_BASE}/node`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'get_logs' })
        });
        const data = await res.json();
        
        if (data.logs && data.logs.length > 0) {
            // 拼接最新的 5 条记录
            const text = data.logs.map(log => {
                const icon = log.event_type === 'legendary' ? '🏆' : '🟣';
                return `${icon} [${log.username}] ${log.message}`;
            }).join('   ///   ');
            
            ticker.innerText = text + "   ///   " + text; // 重复一次以便滚动连接
        }
    } catch(e) {}
}

// 在 loadNodeConsole 里调用一次广播
// 也可以在 handleRoute 里调用
// 或者直接 setInterval
setInterval(loadNodeBroadcast, 30000); // 每30秒刷新一次广播

async function loadAdminBroadcasts() {
    const container = document.getElementById('adminBroadcastList');
    if(!container) return;
    
    const res = await fetch(`${API_BASE}/admin`, {
        method: 'POST',
        body: JSON.stringify({ action: 'get_pending_broadcasts' })
    });
    const data = await res.json();
    
    if (data.list.length === 0) {
        container.innerHTML = '<div style="color:#666">暂无待审</div>';
        return;
    }
    
    let html = '';
    data.list.forEach(b => {
        html += `
            <div style="border-bottom:1px dashed #333; padding:10px;">
                <div style="font-size:0.8rem; color:#aaa;">[${b.tier.toUpperCase()}] ${b.nickname}:</div>
                <div style="color:${b.style_color === 'rainbow' ? 'orange' : b.style_color}; font-weight:bold;">${b.content}</div>
                <div style="margin-top:5px;">
                    <button onclick="reviewBroadcast(${b.id}, 'approve')" class="mini-action-btn" style="color:#0f0;border-color:#0f0;">通过</button>
                    <button onclick="reviewBroadcast(${b.id}, 'reject')" class="mini-action-btn" style="color:#f33;border-color:#f33;">驳回</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

window.reviewBroadcast = async function(id, decision) {
    if(!confirm(decision === 'approve' ? "确认通过？" : "确认驳回？")) return;
    await fetch(`${API_BASE}/admin`, {
        method: 'POST',
        body: JSON.stringify({ action: 'review_broadcast', id, decision })
    });
    loadAdminBroadcasts();
};

// 记得在 loadAdminStats 里调用 loadAdminBroadcasts();

// === ⚔️ 数据格斗场逻辑 ===
// 1. 加载列表 (整合版：大厅 + 历史)
async function loadDuels() {
    const list = document.getElementById('duelList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;color:#666">SCANNING FREQUENCIES...</div>';

    // 确保 currentUser 已加载，用于比对 ID
    if (!currentUser) {
        // 如果尚未获取用户信息，尝试等待或使用空对象防止报错
        console.warn("User data not ready yet.");
    }
    const myId = currentUser ? currentUser.id : -1;

    try {
        const res = await fetch(`${API_BASE}/duel?mode=${currentDuelTab}`);
        const data = await res.json();
        
        list.innerHTML = '';
        if (!data.list || data.list.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:#444">NO DATA FOUND</div>';
            return;
        }

        data.list.forEach(d => {
            const div = document.createElement('div');
            div.className = 'duel-item';
            
            if (currentDuelTab === 'lobby') {
                // === 修复逻辑：强制转为 String 比对，防止 '1' !== 1 的问题 ===
                const isMe = String(d.creator_id) === String(myId);
                
                const actionBtn = isMe 
                    ? `<button onclick="cancelDuel(${d.id})" class="mini-action-btn" style="color:#888; border-color:#888;">撤销</button>`
                    : `<button onclick="openJoinModal(${d.id})" class="cyber-btn" style="width:auto;margin:0;padding:2px 10px;font-size:0.8rem;border-color:#ff3333;color:#ff3333">挑战</button>`;
                
                div.innerHTML = `
                    <div style="flex:1;">
                        <span style="color:#fff;font-weight:bold">${d.creator_name}</span>
                        <div style="font-size:0.7rem;color:#666">${new Date(d.created_at).toLocaleTimeString()}</div>
                    </div>
                    <div class="duel-stake" style="flex:1;text-align:center;">${d.bet_amount} i</div>
                    <div style="flex:1;text-align:right;">${actionBtn}</div>
                `;
            } else {
                // === 历史记录逻辑 ===
                const amICreator = String(d.creator_id) === String(myId);
                // 对手名字：如果我是创建者，对手就是 challenger；否则对手是 creator
                const opponentName = amICreator 
                    ? (d.challenger_name || "等待中...") 
                    : d.creator_name;
                
                let resultText = "处理中";
                let resultColor = "#888";
                
                if (d.status === 'closed') {
                    if (d.winner_id === 0) { 
                        resultText = "平局"; resultColor = "#fff"; 
                    } else if (String(d.winner_id) === String(myId)) { 
                        resultText = "胜利"; resultColor = "#0f0"; 
                    } else { 
                        resultText = "失败"; resultColor = "#f33"; 
                    }
                } else if (d.status === 'cancelled') {
                    resultText = "已撤销";
                }

                // 只有已结束(closed)的才能回放
                const replayBtn = d.status === 'closed' 
                    ? `<button onclick="watchReplay(${d.id})" class="cyber-btn" style="width:auto;margin:0;padding:2px 10px;font-size:0.8rem;color:#00f3ff;border-color:#00f3ff">▶ 回放</button>` 
                    : `-`;

                div.innerHTML = `
                    <div style="flex:1;">
                        <span style="color:#aaa;">VS</span> <span style="color:#fff;font-weight:bold">${opponentName}</span>
                        <div style="font-size:0.7rem;color:#666">${d.bet_amount} i</div>
                    </div>
                    <div style="flex:1;text-align:center;color:${resultColor};font-weight:bold;">${resultText}</div>
                    <div style="flex:1;text-align:right;">${replayBtn}</div>
                `;
            }
            list.appendChild(div);
        });
    } catch(e) {
        console.error(e);
        list.innerHTML = 'Error loading data';
    }
}

// === 新增：加入对局弹窗逻辑 ===

// 1. 打开弹窗
window.openJoinModal = function(id) {
    const modal = document.getElementById('join-duel-modal');
    const idInput = document.getElementById('joinDuelIdVal');
    const moveInput = document.getElementById('joinMoveVal');
    
    // 重置状态
    idInput.value = id;
    moveInput.value = ''; // 清空上次选择
    
    // 清除所有选中样式
    document.querySelectorAll('.join-option').forEach(el => el.classList.remove('selected'));
    
    modal.style.display = 'flex';
};

// 2. 关闭弹窗
window.closeJoinModal = function() {
    document.getElementById('join-duel-modal').style.display = 'none';
};

// 3. 选择出招 (点击图标)
window.selectJoinMove = function(move, el) {
    document.getElementById('joinMoveVal').value = move;
    
    // UI 高亮
    document.querySelectorAll('.join-option').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
};

window.confirmJoinDuel = async function() {
    const id = document.getElementById('joinDuelIdVal').value;
    const move = document.getElementById('joinMoveVal').value;
    
    if (!move) return showToast("请先选择一种武器 (点击图标)", "error");
    
    // 1. 关闭选择弹窗
    closeJoinModal();
    
    // 显示提示
    showToast("正在建立数据连接...", "info");

    try {
        const res = await fetch(`${API_BASE}/duel`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: 'join', id: id, move: move })
        });
        const data = await res.json();
        
        if(!data.success) return showToast(data.error, 'error');

        // 2. 启动动画序列
        // playDuelAnimation 负责显示全屏遮罩和动画
        playDuelAnimation(move, data.creator_move, data.result, data.win_amount);
        
        // 3. 【关键优化】延迟刷新后台数据
        // 动画的总时长大约是 2秒左右出结果，我们延迟 2.5秒 再刷新底层数据
        // 这样用户在看动画时，底层列表不会突然跳动
        setTimeout(() => {
            checkSecurity(); // 刷新余额
            loadDuels();     // 刷新列表状态(变为已结束)
        }, 2500);
        
    } catch(e) {
        console.error(e);
        showToast("网络连接失败", "error");
    }
};

// 2. 创建对局
window.createDuel = async function() {
    const bet = document.getElementById('duelBetAmount').value;
    const move = document.getElementById('duelMyMove').value;
    
    if(!bet || bet < 10) return showToast("金额太小", "error");
    
    const btn = document.querySelector('.duel-controls button');
    btn.disabled = true;
    
    try {
        const res = await fetch(`${API_BASE}/duel`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: 'create', bet, move })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, 'success');
            checkSecurity(); // 刷新余额
            loadDuels();
            document.getElementById('duelBetAmount').value = '';
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) { showToast("网络错误"); } 
    finally { btn.disabled = false; }
};

// 3. 撤销
window.cancelDuel = async function(id) {
    if(!confirm("撤回资金？")) return;
    await fetch(`${API_BASE}/duel`, { method: 'POST', body: JSON.stringify({action:'cancel', id}) });
    checkSecurity();
    loadDuels();
};

// === 修复版：动画播放主逻辑 ===
function playDuelAnimation(myMove, oppMove, result, winAmount) {
    const overlay = document.getElementById('duel-overlay');
    const orbP1 = document.getElementById('orbP1');
    const orbP2 = document.getElementById('orbP2');
    const flash = document.getElementById('collisionFlash');
    const resPanel = document.getElementById('duelResultPanel');
    const resTitle = document.getElementById('duelResultTitle');
    const resDetail = document.getElementById('duelResultDetail');
    const p1Name = document.getElementById('arenaP1Name');
    const p2Name = document.getElementById('arenaP2Name');

    if (!overlay) {
        alert("动画容器缺失，请刷新页面");
        return;
    }

    // 1. 强制重置所有状态 (防止上一次动画残留)
    overlay.style.display = 'flex'; // 显示遮罩
    resPanel.style.display = 'none'; // 隐藏结算板
    flash.classList.remove('flash-active');
    
    // 清理之前的动画类
    orbP1.classList.remove('winner-anim', 'loser-anim');
    orbP2.classList.remove('winner-anim', 'loser-anim');
    
    // 重置球体位置和样式
    orbP1.style.transform = 'translateX(0)';
    orbP2.style.transform = 'translateX(0)';
    
    // 设置初始球体
    orbP1.className = `data-orb orb-${myMove}`; // 左侧直接显示你的招式
    orbP2.className = `data-orb orb-unknown`;   // 右侧先显示问号

    // 设置名字 (可选)
    if(p1Name) p1Name.innerText = "YOU";
    if(p2Name) p2Name.innerText = "OPPONENT";

    // 2. 开始动画序列
    // 蓄力 (0ms - 500ms)
    
    setTimeout(() => {
        // 冲刺撞击
        orbP1.style.transform = 'translateX(100px)'; 
        orbP2.style.transform = 'translateX(-100px)'; 
        
        // 3. 撞击瞬间 (800ms)
        setTimeout(() => {
            // 揭晓敌方招式
            orbP2.className = `data-orb orb-${oppMove}`;
            
            // 闪光特效
            flash.classList.add('flash-active');
            
            // 屏幕震动
            document.body.style.animation = "shake 0.2s";
            setTimeout(()=>document.body.style.animation="", 200);

            // 4. 展示结果 (1100ms)
            setTimeout(() => {
                if (result === 'challenger') { // 我赢
                    orbP1.classList.add('winner-anim');
                    orbP2.classList.add('loser-anim');
                    resTitle.innerText = "VICTORY";
                    resTitle.className = "win-text";
                    resDetail.innerText = `收益: +${winAmount} i`;
                } else if (result === 'creator') { // 我输
                    orbP1.classList.add('loser-anim');
                    orbP2.classList.add('winner-anim');
                    resTitle.innerText = "DEFEAT";
                    resTitle.className = "lose-text";
                    resDetail.innerText = "数据丢失";
                } else { // 平局
                    resTitle.innerText = "DRAW";
                    resTitle.className = "draw-text";
                    resDetail.innerText = "本金退回";
                }
                resPanel.style.display = 'block';
            }, 300);
        }, 300);
    }, 500);
}

window.closeDuelOverlay = function() {
    document.getElementById('duel-overlay').style.display = 'none';
    // 清理动画类
    document.getElementById('orbP1').classList.remove('winner-anim', 'loser-anim');
    document.getElementById('orbP2').classList.remove('winner-anim', 'loser-anim');
};

// === ⚔️ 数据格斗场增强版逻辑 ===

currentDuelTab = 'lobby'; // 'lobby' or 'history'

window.switchDuelTab = function(tab) {
    currentDuelTab = tab;
    
    // 1. 获取 DOM 元素
    const btnLobby = document.getElementById('duelTabLobby');
    const btnHistory = document.getElementById('duelTabHistory');

    // 2. 切换样式 (移除旧的 active，添加新的 active)
    if (tab === 'lobby') {
        if(btnLobby) btnLobby.classList.add('active');
        if(btnHistory) btnHistory.classList.remove('active');
        loadDuels(); // 加载大厅数据
    } else {
        if(btnLobby) btnLobby.classList.remove('active');
        if(btnHistory) btnHistory.classList.add('active');
        loadDuelHistory(); // 加载历史数据
    }
};
// 核心：回放功能
window.replayDuel = function(duelData, myUid) {
    const amICreator = duelData.creator_id === myUid;
    
    // 确定双方出招
    // 如果我是发起者：我的招=creator_move, 对手=challenger_move
    // 如果我是挑战者：我的招=challenger_move, 对手=creator_move
    const myMove = amICreator ? duelData.creator_move : duelData.challenger_move;
    const oppMove = amICreator ? duelData.challenger_move : duelData.creator_move;
    
    // 确定结果
    let result = 'draw';
    let winAmount = 0;
    
    if (duelData.winner_id !== 0) {
        result = duelData.winner_id === myUid ? 'challenger' : 'creator'; 
        // 注意：playDuelAnimation 里的 'challenger' 代表“我赢了”，'creator' 代表“对方赢了”
        // 这个命名有点绕，但在 animation 函数里：
        // result === 'challenger' -> orbP1(左边/我) 赢
        // result === 'creator' -> orbP2(右边/对手) 赢
    }
    
    // 计算显示的金额 (赢了显示总额，输了显示0或扣除)
    // 简单起见，回放显示本局的总奖池的一半（即获胜金额）
    const totalPool = duelData.bet_amount * 2;
    const tax = Math.ceil(totalPool * 0.01);
    winAmount = totalPool - tax;

    // 播放动画
    playDuelAnimation(myMove, oppMove, result, winAmount);
};

// ... createDuel, joinDuel, cancelDuel 保持不变 ...
// ... playDuelAnimation 保持不变 ...

// 修复：强制关闭遮罩函数
window.closeDuelOverlay = function() {
    const overlay = document.getElementById('duel-overlay');
    if(overlay) overlay.style.display = 'none';
    
    // 清理可能残留的动画类
    const p1 = document.getElementById('orbP1');
    const p2 = document.getElementById('orbP2');
    if(p1) p1.className = 'data-orb'; // 重置类
    if(p2) p2.className = 'data-orb';
};

// === 三角形选择器逻辑 ===
window.selectRps = function(val) {
    // 1. 更新视觉
    document.querySelectorAll('.rps-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.rps-btn[data-val="${val}"]`).classList.add('active');
    
    // 2. 更新隐藏值
    document.getElementById('duelMyMove').value = val;
};

// === Admin Turnstile 开关 ===
window.toggleTurnstile = async function() {
    const enabled = document.getElementById('turnstileToggle').checked;
    try {
        const res = await fetch(`${API_BASE}/admin`, { 
            method: 'POST', 
            body: JSON.stringify({action: 'toggle_turnstile', enabled: enabled}) 
        });
        const data = await res.json();
        showToast(data.message, 'success');
    } catch(e){ showToast("设置失败"); }
};

// 2. 加载历史战绩
async function loadDuelHistory() {
    const list = document.getElementById('duelList');
    list.innerHTML = '<div style="text-align:center;color:#666">LOADING ARCHIVES...</div>';
    
    const res = await fetch(`${API_BASE}/duel`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'history' })
    });
    const data = await res.json();
    
    list.innerHTML = '';
    if (!data.list || data.list.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#444">暂无战斗记录</div>';
        return;
    }

    data.list.forEach(d => {
        const isWin = d.winner_id === data.my_id;
        const isDraw = d.winner_id === 0;
        
        let resultHtml = `<span style="color:#ff3333">失败</span>`;
        if (isWin) resultHtml = `<span style="color:#00ff00">胜利 (+${Math.floor(d.bet_amount*0.99)})</span>`;
        if (isDraw) resultHtml = `<span style="color:#ccc">平局</span>`;

        const div = document.createElement('div');
        div.className = 'duel-item';
        div.innerHTML = `
            <div style="font-size:0.8rem">
                <span style="color:#aaa">VS</span> 
                <span style="color:#fff;font-weight:bold">${d.creator_name === currentUser.nickname ? d.challenger_name : d.creator_name}</span>
            </div>
            <div style="font-size:0.8rem">${resultHtml}</div>
            <button onclick="watchReplay(${d.id})" class="mini-action-btn" style="border-color:#00f3ff;color:#00f3ff">▶ 回放</button>
        `;
        list.appendChild(div);
    });
}
// === 修复版：观看回放 ===
window.watchReplay = async function(id) {
    showToast("正在读取战斗数据...", "info");

    try {
        const res = await fetch(`${API_BASE}/duel`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: 'get_replay', id })
        });
        const data = await res.json();

        if (data.success) {
            // 检查 DOM 是否存在
            const overlay = document.getElementById('duel-overlay');
            if (!overlay) {
                alert("错误：缺少动画容器，请刷新页面");
                return;
            }

            // === 关键：映射后端结果到前端动画逻辑 ===
            // 动画函数 playDuelAnimation 的逻辑是：
            // 'challenger' = 左侧(我)赢
            // 'creator'    = 右侧(对手)赢
            // (这是基于 playDuelAnimation 内部 orbP1=winner 的逻辑)
            
            let animResult = 'draw';
            if (data.result === 'win') {
                animResult = 'challenger'; // 我赢了，动画参数传 challenger (代表P1胜)
            } else if (data.result === 'lose') {
                animResult = 'creator';    // 我输了，动画参数传 creator (代表P2胜)
            }
            
            // 启动动画
            playDuelAnimation(data.myMove, data.oppMove, animResult, data.winAmount);
            
        } else {
            showToast("无法加载回放: " + (data.error || "未知错误"), 'error');
        }
    } catch(e) {
        console.error(e);
        showToast("回放系统连接超时", 'error');
    }
};

// === 充值相关逻辑 ===

// 点击“获取卡密”按钮
window.buyRechargePack = function(name, price) {
    // 这里你需要填入你的发卡网地址或者收款码说明
    const shopUrl = "https://你的发卡网地址.com"; // 替换成你的链接
    
    if(confirm(`即将跳转购买【${name}】\n价格：${price} 元\n\n请在购买后复制卡密，回到这里进行兑换。`)) {
        // window.open(shopUrl, '_blank'); // 如果有链接，取消注释这行
        showToast("请联系管理员获取卡密 (暂未配置自动发卡)", "info");
    }
};

// 兑换卡密
window.redeemCdk = async function() {
    const input = document.getElementById('cdkInput');
    const cdk = input.value.trim();
    
    if (!cdk) return showToast("请输入卡密", "error");
    
    const btn = document.querySelector('#recharge-area button');
    btn.disabled = true;
    btn.innerText = "Verifying...";
    
    try {
        const res = await fetch(`${API_BASE}/recharge`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'redeem', cdk: cdk })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            input.value = '';
            checkSecurity(); // 刷新余额
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("网络连接错误", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "兑换";
    }
};

// === 充值逻辑 (人工审核版) ===

// === 充值逻辑 (修复切换版) ===

// 定义你的收款码图片地址
const QR_CODES = {
    'small': 'https://img.1eak.cool/wechat_pay_0.1.JPG', // 0.1元收款码
    'large': 'https://img.1eak.cool/wechat_pay_0.6.JPG'  // 0.6元收款码
};

window.selectRechargeOption = function(type) {
    // 1. 更新隐藏域
    document.getElementById('selectedRechargeType').value = type;
    
    // 2. 更新按钮样式
    document.querySelectorAll('.recharge-option').forEach(el => el.classList.remove('active'));
    document.getElementById(`option-${type}`).classList.add('active');
    
    // 3. 切换二维码图片
    const qrImg = document.getElementById('qrImage');
    if (QR_CODES[type]) {
        qrImg.src = QR_CODES[type];
    }
    
    // 4. 更新文字提示
    const amountSpan = document.getElementById('payAmountDisplay');
    if (type === 'small') amountSpan.innerText = "0.10";
    if (type === 'large') amountSpan.innerText = "0.60";
};

// 1. 上传支付截图
window.uploadProof = async function() {
    const input = document.getElementById('proofUpload');
    if(input.files.length === 0) return;
    
    const file = input.files[0];
    showToast("正在上传凭证...", "info");
    
    // 复用之前的压缩与上传逻辑
    const processedFile = await compressImage(file);
    const formData = new FormData();
    formData.append('file', processedFile);

    try {
        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if(data.success) {
            document.getElementById('uploadedProofUrl').value = data.url;
            document.getElementById('proofPreview').innerHTML = `✅ 已上传: ${file.name}`;
            showToast("凭证上传成功", "success");
        } else {
            showToast("上传失败", "error");
        }
    } catch(e) {
        showToast("网络错误", "error");
    }
};

// 2. 提交申请
window.submitRechargeRequest = async function() {
    const type = document.getElementById('selectedRechargeType').value;
    const proofUrl = document.getElementById('uploadedProofUrl').value;
    
    if(!proofUrl) return showToast("请先上传支付截图", "error");
    
    const btn = document.querySelector('#recharge-area button:last-child');
    btn.disabled = true;
    
    try {
        const res = await fetch(`${API_BASE}/recharge_submit`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ type, proofUrl })
        });
        const data = await res.json();
        
        if(data.success) {
            showToast("申请已提交！管理员审核后自动到账。", "success");
            // 清空状态
            document.getElementById('uploadedProofUrl').value = '';
            document.getElementById('proofPreview').innerHTML = '';
        } else {
            showToast(data.error, "error");
        }
    } catch(e) {
        showToast("提交失败", "error");
    } finally {
        btn.disabled = false;
    }
};

// === 管理员：加载充值申请 ===
window.loadRechargeRequests = async function() {
    const c = document.getElementById('adminRechargeList');
    c.innerHTML = 'Loading...';
    
    try {
        const res = await fetch(`${API_BASE}/admin`, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_recharge_requests' })
        });
        const data = await res.json();
        
        if (data.list.length === 0) {
            c.innerHTML = '<div style="color:#666">暂无待审核申请</div>';
            return;
        }
        
        let html = '';
        data.list.forEach(r => {
            html += `
                <div style="border-bottom:1px dashed #333; padding:10px; display:flex; gap:10px; align-items:center;">
                    <a href="${r.proof_url}" target="_blank">
                        <img src="${r.proof_url}" style="width:50px; height:80px; object-fit:cover; border:1px solid #666;">
                    </a>
                    <div style="flex:1;">
                        <div style="color:#fff; font-weight:bold;">${r.username}</div>
                        <div style="color:#00ff00;">${r.amount_str}</div>
                        <div style="font-size:0.7rem; color:#888;">${new Date(r.created_at).toLocaleString()}</div>
                    </div>
                    <div>
                        <button onclick="reviewRecharge(${r.id}, 'approve')" class="cyber-btn" style="width:auto; padding:5px 10px; border-color:#00ff00; color:#00ff00; margin-bottom:5px;">✅ 通过</button>
                        <button onclick="reviewRecharge(${r.id}, 'reject')" class="cyber-btn" style="width:auto; padding:5px 10px; border-color:#ff3333; color:#ff3333;">❌ 驳回</button>
                    </div>
                </div>
            `;
        });
        c.innerHTML = html;
    } catch(e) {
        c.innerHTML = 'Error';
    }
};

// === 管理员：执行审核 ===
window.reviewRecharge = async function(id, decision) {
    if(!confirm(decision === 'approve' ? "确认款项已到账，并发放i币？" : "确认驳回？")) return;
    
    const res = await fetch(`${API_BASE}/admin`, {
        method: 'POST',
        body: JSON.stringify({ action: 'review_recharge', id, decision })
    });
    const d = await res.json();
    if(d.success) {
        showToast("处理完成", "success");
        loadRechargeRequests();
    } else {
        showToast(d.error, "error");
    }
};

// --- 3. 在 script.js 底部添加以下核心逻辑函数 ---

async function loadHomeSystem() {
    const grid = document.getElementById('home-grid');
    const workBox = document.getElementById('work-status-box');
    
    // 初始 loading 态
    grid.innerHTML = '<div style="color:#666; text-align:center; grid-column:1/-1;">SCANNING PLOTS...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/home`);
        const data = await res.json();
        
        if (data.success) {
            renderHomeGrid(data.home);
            renderWorkStatus(data.work);
        }
    } catch(e) {
        console.error(e);
        grid.innerHTML = 'LOAD ERROR';
    }
}

// === 渲染九宫格 ===
function renderHomeGrid(items) {
    const grid = document.getElementById('home-grid');
    grid.innerHTML = '';
    
    // 生成 9 个槽位
    for (let i = 0; i < 4; i++) {
        const item = items.find(it => it.slot_index === i);
        const div = document.createElement('div');
        
        if (item) {
            // 有植物
            const config = SEED_CATALOG.find(s => s.id === item.item_id) || { name: '未知', img: '' };
            const now = Date.now();
            const isReady = now >= item.harvest_at;
            
            // 计算进度
            const total = item.harvest_at - item.created_at;
            const passed = now - item.created_at;
            let percent = Math.floor((passed / total) * 100);
            if (percent > 100) percent = 100;
            
            let statusHtml = '';
            if (isReady) {
                div.className = 'home-slot ready-glow';
                div.onclick = () => harvestSeed(i); // 点击收获
                statusHtml = `<div style="color:#0f0; font-weight:bold; font-size:0.7rem; margin-top:5px;">[可收获]</div>`;
            } else {
                div.className = 'home-slot';
                // 计算剩余分钟
                const leftMin = Math.ceil((item.harvest_at - now) / 60000);
                statusHtml = `
                    <div class="xp-bar-bg" style="width:80%; height:3px; margin-top:5px; background:#333;">
                        <div class="xp-bar-fill" style="width:${percent}%; background:orange;"></div>
                    </div>
                    <div class="slot-timer">${leftMin} min</div>
                `;
            }
            
            div.innerHTML = `
                <div class="slot-icon" style="background-image: url('${config.img}');"></div>
                <div class="slot-name">${config.name}</div>
                ${statusHtml}
            `;
        } else {
            // 空槽位
            div.className = 'home-slot empty';
            div.onclick = () => openSeedSelector(i); // 点击种植
            div.innerHTML = `
                <div style="font-size:1.5rem; opacity:0.3;">+</div>
                <div style="font-size:0.7rem; color:#444;">空闲</div>
            `;
        }
        
        grid.appendChild(div);
    }
}

// === 渲染打工状态 ===
function renderWorkStatus(work) {
    const box = document.getElementById('work-status-box');
    
    if (workTicker) clearInterval(workTicker); // 清除旧定时器
    
    if (work) {
        // 正在打工或已完成
        const config = WORK_CATALOG[work.work_type];
        const now = Date.now();
        
        if (now >= work.end_time) {
            // 完成状态
            box.innerHTML = `
                <div class="glass-card" style="border-color:#0f0; text-align:center;">
                    <h3 style="color:#0f0; margin:0 0 10px 0;">✅ 任务完成: ${config.name}</h3>
                    <button onclick="claimWorkResult()" class="cyber-btn" style="border-color:#0f0; color:#0f0;">领取报酬 (${config.reward} i)</button>
                </div>
            `;
        } else {
            // 进行中
            const total = work.end_time - work.start_time;
            
            // 启动倒计时刷新
            const updateTimer = () => {
                const currentNow = Date.now();
                if (currentNow >= work.end_time) {
                    renderWorkStatus(work); // 刷新为完成态
                    return;
                }
                const leftSec = Math.ceil((work.end_time - currentNow) / 1000);
                const percent = Math.min(100, ((currentNow - work.start_time) / total) * 100);
                
                document.getElementById('work-timer-text').innerText = `${leftSec} s`;
                document.getElementById('work-progress-bar').style.width = `${percent}%`;
            };
            
            box.innerHTML = `
                <div class="glass-card" style="text-align:center;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <span style="color:#00f3ff;">⚡ 正在运行: ${config.name}</span>
                        <span id="work-timer-text" style="font-family:monospace;">...</span>
                    </div>
                    <div class="xp-bar-bg" style="height:4px; margin-bottom:15px;">
                        <div id="work-progress-bar" class="xp-bar-fill rainbow-bar" style="width:0%"></div>
                    </div>
                    <button onclick="cancelWork()" class="mini-action-btn" style="color:#ff3333; border-color:#ff3333;">终止进程 (无收益)</button>
                </div>
            `;
            workTicker = setInterval(updateTimer, 1000);
            updateTimer(); // 立即执行一次
        }
    } else {
        // 空闲状态：显示任务列表
        let html = '';
        for (const [key, val] of Object.entries(WORK_CATALOG)) {
            html += `
                <div class="work-card">
                    <div>
                        <div style="font-weight:bold; color:#eee;">${val.name}</div>
                        <div style="font-size:0.8rem; color:#888;">耗时: ${val.time} <span style="color:#666">|</span> 报酬: <span style="color:#FFD700">${val.reward} i</span></div>
                    </div>
                    <button onclick="startWork('${key}')" class="cyber-btn" style="width:auto; margin:0; padding:5px 15px; font-size:0.8rem;">挂载</button>
                </div>
            `;
        }
        box.innerHTML = html;
    }
}

// === 交互函数 ===

// 1. 打开种子选择
window.openSeedSelector = function(slotIndex) {
    const list = document.getElementById('seed-list');
    list.innerHTML = '';
    
    SEED_CATALOG.forEach(s => {
        const div = document.createElement('div');
        div.className = 'glass-card';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.padding = '10px';
        div.innerHTML = `
            <!-- 修改这里：用 img 标签显示预览 -->
            <div class="item-icon-small" style="background-image: url('${s.img}');"></div>
            <div style="flex:1;">
                <div style="font-weight:bold;">${s.name}</div>
                <div style="font-size:0.7rem; color:#888;">周期: ${s.timeStr}</div>
            </div>
            <button onclick="plantSeed(${slotIndex}, '${s.id}')" class="cyber-btn" style="width:auto; margin:0; font-size:0.8rem;">种植</button>
        `;
        list.appendChild(div);
    });
    
    document.getElementById('seed-modal').style.display = 'flex';
};

// 2. 种植
window.plantSeed = async function(slotIndex, seedId) {
    const res = await fetch(`${API_BASE}/home`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'plant', slotIndex, seedId })
    });
    const data = await res.json();
    
    if (data.success) {
        showToast(data.message, 'success');
        document.getElementById('seed-modal').style.display = 'none';
        loadHomeSystem(); // 刷新网格
    } else {
        showToast(data.error, 'error');
    }
};

// 3. 收获
window.harvestSeed = async function(slotIndex) {
    const res = await fetch(`${API_BASE}/home`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'harvest', slotIndex })
    });
    const data = await res.json();
    
    if (data.success) {
        showToast(data.message, 'success');
        checkSecurity(); // 刷新余额
        loadHomeSystem();
    } else {
        showToast(data.error, 'error');
    }
};

// 4. 开始打工
window.startWork = async function(type) {
    const res = await fetch(`${API_BASE}/home`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'start_work', workType: type })
    });
    const data = await res.json();
    if(data.success) {
        showToast(data.message, 'success');
        loadHomeSystem();
    } else {
        showToast(data.error, 'error');
    }
};

// 5. 领取打工奖励
window.claimWorkResult = async function() {
    const res = await fetch(`${API_BASE}/home`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'claim_work' })
    });
    const data = await res.json();
    if(data.success) {
        showToast(data.message, 'success');
        checkSecurity();
        loadHomeSystem();
    } else {
        showToast(data.error, 'error');
    }
};

// 6. 放弃打工
window.cancelWork = async function() {
    if(!confirm("确定终止当前任务吗？进度将丢失。")) return;
    await fetch(`${API_BASE}/home`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'cancel_work' })
    });
    loadHomeSystem();
};

// --- script.js 新增：预览功能 ---

window.previewItem = function(itemId) {
    const item = SHOP_CATALOG.find(i => i.id === itemId);
    if(!item) return;

    const modal = document.getElementById('preview-modal');
    const container = document.getElementById('previewContainer');
    const buyBtn = document.getElementById('previewBuyBtn');
    
    // 绑定购买按钮
    buyBtn.onclick = () => { closePreviewModal(); buyItem(itemId); };
    
    container.innerHTML = '';
    container.style.background = '#000'; // 重置背景
    
    // 根据类型展示不同的预览
    if (item.category === 'post_style') {
        // 帖子边框预览
        container.innerHTML = `
            <div class="post-card ${item.css}" style="width:100%; padding:15px; margin:0;">
                <h3 style="margin-top:0; font-size:1rem;">演示标题</h3>
                <p style="font-size:0.8rem; color:#ccc;">这就是装备了 [${item.name}] 后的帖子效果。</p>
            </div>
        `;
    } 
    else if (item.category === 'bubble') {
        // 气泡预览
        container.innerHTML = `
            <div class="msg-row right" style="width:100%; justify-content:center;">
                <div class="msg-bubble ${item.css}">
                    你好！这是 [${item.name}] 气泡的效果。
                </div>
                <div class="msg-avatar" style="background:#333;"></div>
            </div>
        `;
    }
    else if (item.category === 'name_color') {
        // 名字颜色预览
        container.innerHTML = `
            <div style="text-align:center;">
                <div style="color:#666; font-size:0.8rem; margin-bottom:5px;">当前昵称预览</div>
                <span class="${item.css}" style="font-size:1.5rem;">${currentUser ? currentUser.nickname : 'Player'}</span>
            </div>
        `;
    }
    else if (item.category === 'background') {

        container.innerHTML = `<div style="color:#fff; z-index:2; text-shadow:0 0 5px #000;">背景效果预览</div>`;

        container.className = `preview-stage ${item.id.replace('_', '-')}`;

    }
    else {
        // 其他物品 (如种子、卡片) 显示图标
        container.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:3rem; margin-bottom:10px;">${item.icon}</div>
                <div>${item.name}</div>
            </div>
        `;
    }

    modal.style.display = 'flex';
};

window.closePreviewModal = function() {
    document.getElementById('preview-modal').style.display = 'none';
    // 重置 class，防止背景残留
    document.getElementById('previewContainer').className = 'preview-stage';
};


const DEFAULT_NAV_ORDER = [
    '#home', '#node', '#home', '#duel', '#chat', '#write', '#shop', 
    '#inventory', '#feedback', '#profile?u=', '#settings', '#about'
];

function initSidebarOrder() {
    const nav = document.querySelector('aside nav');
    if(!nav) return;

    const savedOrder = JSON.parse(localStorage.getItem('nav_order') || '[]');
    if (savedOrder.length === 0) return; // 无自定义，使用默认 HTML 顺序

    // 将现有链接存入 Map
    const links = Array.from(nav.querySelectorAll('a'));
    const linkMap = {};
    links.forEach(a => {
        // 获取 href 的 hash 部分，如果是 #profile?u=xxx 这种，只取前缀或完整匹配
        const key = a.getAttribute('href'); 
        linkMap[key] = a;
    });

    const adminLink = document.getElementById('navAdmin');
    
    // 重新追加
    savedOrder.forEach(key => {
        if (linkMap[key]) {
            nav.appendChild(linkMap[key]);
            delete linkMap[key]; // 标记已处理
        }
    });

    for (let key in linkMap) {
        if(linkMap[key] !== adminLink) nav.appendChild(linkMap[key]);
    }

    // 始终把 Admin 放在最后
    if(adminLink) nav.appendChild(adminLink);
}

window.loadNavSettings = function() {
    const container = document.getElementById('navSortList');
    if(!container) return;
    
    const nav = document.querySelector('aside nav');
    const links = Array.from(nav.querySelectorAll('a:not(#navAdmin)')); // 排除管理员
    
    let html = '';
    links.forEach((a, index) => {
        const name = a.innerText.trim();
        const href = a.getAttribute('href');
        
        html += `
            <div class="sort-item">
                <span>${name}</span>
                <div class="sort-controls">
                    <button onclick="moveNav('${href}', -1)">↑</button>
                    <button onclick="moveNav('${href}', 1)">↓</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
};

window.moveNav = function(href, direction) {
    const nav = document.querySelector('aside nav');
    const link = nav.querySelector(`a[href="${href}"]`);
    if(!link) return;

    if (direction === -1) { // 上移
        const prev = link.previousElementSibling;
        if(prev) nav.insertBefore(link, prev);
    } else { // 下移
        const next = link.nextElementSibling;
        if(next && next.id !== 'navAdmin') { // 不允许移到 Admin 下面
            nav.insertBefore(next, link);
        }
    }
    
    saveNavOrder();
    loadNavSettings(); // 刷新列表
};

window.saveNavOrder = function() {
    const nav = document.querySelector('aside nav');
    const links = Array.from(nav.querySelectorAll('a'));
    const order = links.map(a => a.getAttribute('href'));
    localStorage.setItem('nav_order', JSON.stringify(order));
    showToast("菜单顺序已保存");
};

window.resetNavOrder = function() {
    localStorage.removeItem('nav_order');
    location.reload();
};

// === 创业系统逻辑 ===

async function loadBusiness() {
    const createPanel = document.getElementById('biz-create-panel');
    const dashboard = document.getElementById('biz-dashboard');
    const marketTicker = document.getElementById('marketTicker');
    
    // Loading
    marketTicker.innerText = "CONNECTING TO STOCK MARKET...";
    
    try {
        const res = await fetch(`${API_BASE}/business`);
        const data = await res.json();
        
        // 1. 显示市场行情
        const trendIcon = data.market.val > 0 ? '📈' : '📉';
        marketTicker.innerText = `${trendIcon} ${data.market.name}`;
        marketTicker.style.color = data.market.val > 0 ? '#0f0' : (data.market.val < 0 ? '#f33' : '#fff');

        if (data.bankrupt) {
            alert(`💔 噩耗：\n${data.report.msg}\n\n公司已破产清算，剩余资金归零。请重新创业。`);
            createPanel.style.display = 'block';
            dashboard.style.display = 'none';
            return;
        }

        if (data.hasCompany) {
            // 显示仪表盘
            createPanel.style.display = 'none';
            dashboard.style.display = 'block';
            
            const c = data.company;
            document.getElementById('bizCapital').innerText = c.capital.toLocaleString();
            
            // 翻译类型
            const typeNames = {'shell':'数据作坊', 'startup':'科技独角兽', 'blackops':'黑域工作室'};
            document.getElementById('bizTypeDisplay').innerText = typeNames[c.type];

            // 每日财报弹窗/显示
            if (data.todayReport) {
                const r = data.todayReport;
                const color = r.profit >= 0 ? '#0f0' : '#f33';
                const sign = r.profit >= 0 ? '+' : '';
                document.getElementById('bizLastSettle').innerHTML = 
                    `<span style="color:${color}">${r.msg} (${sign}${r.rate}%) 盈亏: ${sign}${r.profit}</span>`;
                
                // 如果有新财报，弹个 Toast
                showToast(`今日财报: ${sign}${r.profit} i币`, r.profit>=0 ? 'success':'error');
                checkSecurity(); // 刷新余额
                loadStockMarket();
            }

            // 更新策略按钮状态
            document.querySelectorAll('.strategy-selector button').forEach(b => b.classList.remove('active'));
            const map = {'safe':'btn-strat-safe', 'normal':'btn-strat-normal', 'risky':'btn-strat-risky'};

            let currentStrat = c.strategy; 
            if(currentStrat === 'conservative') currentStrat = 'safe'; // 兼容
            if(currentStrat === 'aggressive') currentStrat = 'risky'; // 兼容
            
            const btnId = `btn-strat-${currentStrat}`;
            if(document.getElementById(btnId)) document.getElementById(btnId).classList.add('active');

        } else {
            // 显示创建页
            createPanel.style.display = 'block';
            dashboard.style.display = 'none';
        }

    } catch(e) {
        console.error(e);
        showToast("无法连接交易所", "error");
    }
}

// 选择创业方案
window.selectBizPlan = function(type) {
    document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
    // 找到对应的卡片高亮 (这里简单粗暴点，实际建议给卡片加 id)
    event.currentTarget.classList.add('selected');
    document.getElementById('selectedBizType').value = type;
};

// 创建公司
window.createCompany = async function() {
    const type = document.getElementById('selectedBizType').value;
    const name = document.getElementById('newCompanyName').value.trim();
    
    if(!type) return showToast("请选择一种创业方案", "error");
    if(!name) return showToast("请输入公司名称", "error");
    
    if(!confirm(`确定花费 i币 创建 [${name}] 吗？`)) return;

    try {
        const res = await fetch(`${API_BASE}/business`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: 'create', type, name })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, "success");
            checkSecurity();
            loadBusiness();
        } else {
            showToast(data.error, "error");
        }
    } catch(e) { showToast("网络错误"); }
};

// 调整策略
window.setStrategy = async function(strat) {
    try {
        const res = await fetch(`${API_BASE}/business`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action: 'set_strategy', strategy: strat })
        });
        const data = await res.json();
        if(data.success) {
            showToast(data.message, "success");
            loadBusiness(); // 刷新高亮
        } else {
            showToast(data.error, "error");
        }
    } catch(e) { showToast("操作失败"); }
};

// 注资
window.bizInvest = async function() {
    const amount = prompt("请输入追加投资金额 (至少 100):");
    if(!amount) return;
    
    const res = await fetch(`${API_BASE}/business`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'invest', amount })
    });
    const data = await res.json();
    if(data.success) {
        showToast(data.message, "success");
        checkSecurity();
        loadBusiness();
    } else {
        showToast(data.error, "error");
    }
};

// 提现
window.bizWithdraw = async function() {
    const amount = prompt("请输入提现金额 (收取10%手续费):");
    if(!amount) return;
    
    const res = await fetch(`${API_BASE}/business`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'withdraw', amount })
    });
    const data = await res.json();
    if(data.success) {
        showToast(data.message, "success");
        checkSecurity();
        loadBusiness();
    } else {
        showToast(data.error, "error");
    }
};

// --- script.js 股市核心逻辑 (交互版) ---

let currentStockSymbol = 'BLUE';
let marketData = {};
let myPositions = [];
let marketOpens = {}; // 存开盘价
let companyInfo = {};
let globalLogs = [];


// --- script.js 重写 loadStockMarket ---

window.loadStockMarket = async function() {
    const canvas = document.getElementById('stockCanvas');
    if(!canvas) return; 

    // 只有第一次加载显示 Loading，后续静默刷新
    const curEl = document.getElementById('stockCurrent');
    if(curEl && curEl.innerText === '--') curEl.innerText = "Loading...";

    try {
        const res = await fetch(`${API_BASE}/stock`);
        const data = await res.json();
        
        if (data.success) {
            marketData = data.market;
            myPositions = data.positions;
            marketOpens = data.opens || {}; 
            companyInfo = { capital: data.capital, type: data.companyType };
            
            // 1. 处理日志 (合并后端新闻到全局数组)
            mergeLogs(data.news, 'news');
            
            // 2. 处理休市
            const mask = document.getElementById('marketClosedMask');
            if (data.status && !data.status.isOpen) {
                if(mask) mask.style.display = 'flex';
                disableTrading(true);
            } else {
                if(mask) mask.style.display = 'none';
                disableTrading(false);
            }

            // 3. 更新资金
            if(document.getElementById('bizCapital')) {
                document.getElementById('bizCapital').innerText = data.capital.toLocaleString();
            }

            // 4. 绑定交互事件 (防重复绑定)
            if (!canvas.dataset.listening) {
                canvas.addEventListener('mousemove', handleChartHover);
                canvas.addEventListener('mouseleave', handleChartLeave);
                canvas.addEventListener('touchstart', handleTouch, {passive: false});
                canvas.addEventListener('touchmove', handleTouch, {passive: false});
                canvas.addEventListener('touchend', handleChartLeave);
                canvas.dataset.listening = "true";
                
                // 窗口变化重绘
                window.removeEventListener('resize', resizeStockChart);
                window.addEventListener('resize', resizeStockChart);
            }

            // 5. 渲染界面
            switchStock(currentStockSymbol);
        }
    } catch(e) { console.error("Stock Load Error:", e); }
    
    // 自动刷新定时器
    if (!window.stockAutoRefreshTimer) {
        window.stockAutoRefreshTimer = setInterval(() => {
            const stockView = document.getElementById('view-business');
            if (stockView && stockView.style.display !== 'none' && document.getElementById('stockCanvas')) {
                loadStockMarket();
            }
        }, 10000); 
    }
};

// 辅助：窗口大小改变时重绘
function resizeStockChart() {
    if(document.getElementById('stockCanvas')) {
        drawInteractiveChart(currentStockSymbol, null);
    }
}

// 辅助：处理触摸坐标转换
function handleTouch(e) {
    e.preventDefault(); // 阻止页面滚动
    const rect = e.target.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    drawInteractiveChart(currentStockSymbol, {x, y});
}

function disableTrading(disabled) {
    const els = document.querySelectorAll('#stockTradeAmount, button[onclick^="tradeStock"]');
    els.forEach(e => e.disabled = disabled);
}

// 2. 切换股票
window.switchStock = function(symbol) {
    currentStockSymbol = symbol;
    
    // Tab 高亮
    document.querySelectorAll('.stock-tab').forEach(b => b.classList.remove('active'));
    // 简单的根据文本匹配来高亮，或者你可以给HTML加ID
    const btns = document.querySelectorAll('.stock-tab');
    if(symbol==='BLUE' && btns[0]) btns[0].classList.add('active');
    if(symbol==='GOLD' && btns[1]) btns[1].classList.add('active');
    if(symbol==='RED' && btns[2]) btns[2].classList.add('active');

    // 绘制图表 (无鼠标位置，显示默认状态)
    drawInteractiveChart(symbol, null);
    
    // 更新持仓面板
    updatePositionUI(symbol);
};

// 3. 鼠标移动处理
function handleChartHover(e) {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawInteractiveChart(currentStockSymbol, {x, y});
}

// 4. 鼠标离开处理
function handleChartLeave() {
    drawInteractiveChart(currentStockSymbol, null);
}

// script.js - 核心绘图函数 (响应式 + 高清版)

function drawInteractiveChart(symbol, mousePos) {
    const canvas = document.getElementById('stockCanvas');
    const container = document.querySelector('.stock-chart-container');
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    const rect = container.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

    ctx.scale(dpr, dpr);

    const width = cssWidth;
    const height = cssHeight;

    const isMobile = width < 400;
    const padding = { 
        top: 20, 
        right: isMobile ? 10 : 20, 
        bottom: 20, 
        left: isMobile ? 40 : 50 
    };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    ctx.clearRect(0, 0, width, height);
    
    if (!marketData || !marketData[symbol] || marketData[symbol].length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("WAITING FOR DATA STREAM...", width/2, height/2);
        return; 
    }
    const data = marketData[symbol]; 
    // 注意：这里不需要 clearRect，因为重设 canvas.width 自动清空了画布
    
    if(!data || data.length === 0) return;

    // === 3. 数据计算 ===
    let minP = Infinity, maxP = -Infinity;
    data.forEach(d => {
        if(d.p < minP) minP = d.p;
        if(d.p > maxP) maxP = d.p;
    });
    
    const rangeBuffer = (maxP - minP) === 0 ? maxP * 0.1 : (maxP - minP);
    const yMin = Math.floor(minP - rangeBuffer * 0.2); 
    const yMax = Math.ceil(maxP + rangeBuffer * 0.2);
    const yRange = yMax - yMin;
    if (!mousePos) {
        const openPrice = marketOpens[symbol] || data[0].p;
        const currentPrice = data[data.length - 1].p;
        
        // 安全更新 DOM
        const elOpen = document.getElementById('stockOpen');
        const elHigh = document.getElementById('stockHigh');
        const elLow = document.getElementById('stockLow');
        const elCurr = document.getElementById('stockCurrent');

        if(elOpen) elOpen.innerText = openPrice;
        if(elHigh) elHigh.innerText = maxP;
        if(elLow) elLow.innerText = minP;
        if(elCurr) {
            elCurr.innerText = currentPrice;
            elCurr.style.color = currentPrice >= openPrice ? '#0f0' : '#f33';
        }
    }
    const isMobile = width < 400;
    const padding = { top: 20, right: 10, bottom: 20, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const colorMap = {'BLUE':'#00f3ff', 'GOLD':'#ffd700', 'RED':'#ff3333'};
    const themeColor = colorMap[symbol];

    const currentPrice = data[data.length - 1].p;
    const openPrice = marketOpens[symbol] || data[0].p;

    // 更新看板 (无交互时)
    if (!mousePos) {
        document.getElementById('stockOpen').innerText = openPrice;
        document.getElementById('stockHigh').innerText = maxP;
        document.getElementById('stockLow').innerText = minP;
        const curEl = document.getElementById('stockCurrent');
        curEl.innerText = currentPrice;
        curEl.style.color = currentPrice >= openPrice ? '#0f0' : '#f33';
    }

    const colorMap = {'BLUE':'#00f3ff', 'GOLD':'#ffd700', 'RED':'#ff3333'};
    const themeColor = colorMap[symbol];

    // === 4. 绘制网格 ===
    ctx.lineWidth = 1;
    ctx.font = '10px JetBrains Mono';
    
    // 横线 (价格)
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const val = yMin + (yRange / ySteps) * i;
        const y = padding.top + chartH - ((val - yMin) / yRange * chartH);
        
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#888';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.floor(val), padding.left - 5, y);
    }

    // 竖线 (时间) - 手机上少画几条，防止拥挤
    const xStep = chartW / (data.length - 1);
    const xStepsCount = isMobile ? 4 : 6; 
    const timeInterval = Math.floor((data.length - 1) / (xStepsCount - 1));

    for (let i = 0; i < data.length; i += timeInterval) {
        const x = padding.left + (i * xStep);
        
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();

        const date = new Date(data[i].t);
        const timeStr = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(timeStr, x, height - padding.bottom + 5);
    }

    // === 5. 绘制坐标轴标题 ===
    if (!isMobile) { // 手机空间小，就不画这两个标题了
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 12px JetBrains Mono';
        
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("PRICE", 0, 0);
        ctx.restore();

        ctx.textAlign = 'right';
        ctx.fillText("TIME", width - 10, height - 5);
    }

    // === 6. 绘制折线 ===
    ctx.beginPath();
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = themeColor;

    data.forEach((d, i) => {
        const x = padding.left + (i * xStep);
        const y = padding.top + chartH - ((d.p - yMin) / yRange * chartH);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // === 7. 交互 / 最后一个点 ===
    if (!mousePos) {
        const lastIdx = data.length - 1;
        const lastX = padding.left + (lastIdx * xStep);
        const lastY = padding.top + chartH - ((data[lastIdx].p - yMin) / yRange * chartH);
        
        ctx.beginPath();
        ctx.fillStyle = themeColor;
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
    }
        // 十字线
        ctx.beginPath();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(pointX, padding.top);
        ctx.lineTo(pointX, height - padding.bottom);
        ctx.moveTo(padding.left, pointY);
        ctx.lineTo(width - padding.right, pointY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 圆点
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(pointX, pointY, 4, 0, Math.PI * 2);
        ctx.fill();

        // 浮窗
        const date = new Date(target.t);
        const timeStr = `${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
        const infoText = `${timeStr} | ¥${target.p}`;
        
        ctx.font = '12px sans-serif';
        const textWidth = ctx.measureText(infoText).width + 20;
        let boxX = pointX + 10;
        let boxY = pointY - 30;
        
        if (boxX + textWidth > width) boxX = pointX - textWidth - 10;
        if (boxY < 0) boxY = pointY + 20;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(boxX, boxY, textWidth, 24);
        ctx.strokeStyle = themeColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, textWidth, 24);

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(infoText, boxX + 10, boxY + 12);

    } else {
        // 呼吸灯点
        const lastIdx = data.length - 1;
        const lastX = padding.left + (lastIdx * xStep);
        const lastY = padding.top + chartH - ((data[lastIdx].p - yMin) / yRange * chartH);
        
        ctx.beginPath();
        ctx.fillStyle = themeColor;
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.moveTo(padding.left, lastY);
        ctx.lineTo(width - padding.right, lastY);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function updatePositionUI(symbol) {
    const pos = myPositions.find(p => p.stock_symbol === symbol);
    const amountEl = document.getElementById('myStockAmount');
    const profitEl = document.getElementById('myStockProfit');
    const btnCover = document.getElementById('btnShortCover');
    
    // === 修复点：增加安全检查 ===
    // 如果 marketData 为空，或者没有当前股票的数据，直接停止执行，防止报错
    if (!marketData || !marketData[symbol] || marketData[symbol].length === 0) {
        if(amountEl) amountEl.innerText = "Loading...";
        return; 
    }

    // 获取当前价
    const history = marketData[symbol];
    const currentPrice = history[history.length - 1].p;

    if (pos) {
        amountEl.innerText = `${pos.amount} 股`;
        
        // 盈亏计算
        let profit = 0;
        if (pos.amount > 0) {
            // 做多盈亏
            profit = (currentPrice - pos.avg_price) * pos.amount;
            if(btnCover) btnCover.style.display = 'none'; 
        } else {
            // 做空盈亏
            profit = (pos.avg_price - currentPrice) * Math.abs(pos.amount);
            if(btnCover) btnCover.style.display = 'inline-block'; 
        }
        
        const sign = profit >= 0 ? '+' : '';
        const color = profit >= 0 ? '#0f0' : '#f33';
        profitEl.innerHTML = `浮动盈亏: <span style="color:${color}">${sign}${Math.floor(profit)}</span>`;
    } else {
        amountEl.innerText = "0 股";
        profitEl.innerText = "浮动盈亏: --";
        if(btnCover) btnCover.style.display = 'none';
    }
}

window.tradeStock = async function(action) {
    const amountVal = document.getElementById('stockTradeAmount').value;
    const amount = parseInt(amountVal);
    
    if (!amount || amount <= 0) return showToast("请输入有效数量", "error");
    
    // 简单的前端校验
    if (action === 'sell' && companyInfo.type !== 'blackops') {
        // 非黑域公司，卖出时检查是否有持仓
        const pos = myPositions.find(p => p.stock_symbol === currentStockSymbol);
        if (!pos || pos.amount < amount) return showToast("持仓不足，无法卖出", "error");
    }

    try {
        const res = await fetch(`${API_BASE}/stock`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action, symbol: currentStockSymbol, amount })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast("交易成功", "success");
            document.getElementById('stockTradeAmount').value = '';
            addUserLog(data.log, (action === 'buy' || action === 'cover') ? 'buy' : 'sell');
            setTimeout(loadStockMarket, 500); 
        } else {
            showToast(data.error, "error");
        }
    } catch(e) { showToast("交易失败", "error"); }
};

// === 股市日志渲染 ===

function renderStockLogs(newsList) {
    const list = document.getElementById('stockLogList');
    list.innerHTML = ''; 
    
    if (newsList && newsList.length > 0) {
        newsList.forEach(n => {
            const date = new Date(n.time);
            const timeStr = `${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
            const className = n.type === 'good' ? 'news-good' : 'news-bad';
            const icon = n.type === 'good' ? '🚀' : '📉';
            
            const div = document.createElement('div');
            div.className = `log-item ${className}`;
            div.innerHTML = `<span class="log-time">[${timeStr}]</span> ${icon} ${n.msg}`;
            list.appendChild(div);
        });
    } else {
        list.innerHTML = `<div class="log-item system">市场平稳，暂无重大新闻。</div>`;
    }
}

function addStockLog(msg, type) {
    const list = document.getElementById('stockLogList');
    const now = new Date();
    const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
    
    const div = document.createElement('div');
    div.className = `log-item ${type}`; // type: 'buy' or 'sell'
    div.innerHTML = `<span class="log-time">[${timeStr}]</span> 👤 ${msg}`;
    
    // 插入到最前面
    list.insertBefore(div, list.firstChild);
}

// --- script.js 新增/替换日志逻辑 ---

// 合并日志到全局数组
function mergeLogs(newItems, source) {
    if (!newItems || newItems.length === 0) return;

    let hasChange = false;
    newItems.forEach(item => {
        // 防止重复添加相同的新闻 (根据时间和内容去重)
        // 假设 item 结构: { time: 12345678, msg: "...", type: "good" }
        // 或者是用户操作: { time: 12345678, msg: "...", source: "user" }
        
        // 构造唯一标识
        const uniqueKey = item.time + item.msg;
        
        // 检查是否已存在
        const exists = globalLogs.some(log => (log.time + log.msg) === uniqueKey);
        
        if (!exists) {
            // 标记来源，方便渲染不同样式
            item.source = source || 'news'; 
            globalLogs.push(item);
            hasChange = true;
        }
    });

    if (hasChange || source === 'user') {
        // 按时间倒序排列 (新的在简报)
        globalLogs.sort((a, b) => b.time - a.time);
        // 只保留最近 50 条
        if (globalLogs.length > 50) globalLogs = globalLogs.slice(0, 50);
        renderAllLogs();
    }
}

// 渲染所有日志
function renderAllLogs() {
    const list = document.getElementById('stockLogList');
    if (!list) return;
    
    list.innerHTML = '';
    
    globalLogs.forEach(n => {
        const date = new Date(n.time);
        const timeStr = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        
        let className = 'log-item';
        let icon = '';
        
        if (n.source === 'user') {
            // 用户操作：买入/卖出
            className += n.actionType === 'buy' ? ' buy' : ' sell';
            icon = '👤';
        } else {
            // 系统新闻
            className += n.type === 'good' ? ' news-good' : ' news-bad';
            icon = n.type === 'good' ? '🚀' : '📉';
        }
        
        const div = document.createElement('div');
        div.className = className;
        div.innerHTML = `<span class="log-time">[${timeStr}]</span> ${icon} ${n.msg}`;
        list.appendChild(div);
    });
}

// 添加用户操作日志 (不刷新网页，直接插入数组)
function addUserLog(msg, actionType) {
    const now = Date.now();
    const logItem = {
        time: now,
        msg: msg,
        source: 'user',
        actionType: actionType // 'buy' or 'sell'
    };
    mergeLogs([logItem], 'user');
}








































