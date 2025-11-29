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
    { lv: 9,  xp: 50000, title: '半神' },
    { lv: 10, xp: 60000, title: '赛博神' }
];

// 1. 加载好友列表
window.loadFriendList = async function() {
    const c = document.getElementById('chatList');
    c.innerHTML = 'Loading...';
    try {
        const res = await fetch(`${API_BASE}/friends`);
        const data = await res.json();
        
        let html = '';
        // 申请列表
        if (data.requests && data.requests.length > 0) {
            html += `<div style="font-size:0.8rem; color:#ff00de; margin-bottom:5px;">新请求</div>`;
            data.requests.forEach(r => {
                const avatar = renderUserAvatar(r);
                html += `
                <div class="chat-item">
                    <div style="width:30px;height:30px;">${avatar}</div>
                    <div style="flex:1; font-size:0.8rem;">${r.nickname||r.username}</div>
                    <button onclick="handleFriend('${r.id}', 'accept')" class="mini-action-btn" style="color:#0f0">同意</button>
                </div>`;
            });
        }
        
        // 好友列表
        html += `<div style="font-size:0.8rem; color:var(--accent-blue); margin:10px 0 5px;">我的好友</div>`;
        if (data.friends.length === 0) html += '<div style="color:#666;font-size:0.8rem">暂无好友</div>';
        
        data.friends.forEach(f => {
            const avatar = renderUserAvatar(f);
            html += `
            <div class="chat-item" onclick="openChat(${f.id}, '${f.nickname||f.username}')">
                <div style="width:30px;height:30px; border-radius:50%; overflow:hidden;">${avatar}</div>
                <div>${f.nickname||f.username}</div>
            </div>`;
        });
        c.innerHTML = html;
    } catch(e) { c.innerHTML = 'Error'; }
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
    document.getElementById('chatBox').style.display = 'none';
    if(chatPollInterval) clearInterval(chatPollInterval);
    currentChatTargetId = null;
    if(window.innerWidth < 768) document.querySelector('.chat-sidebar').style.display = 'flex';
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
        
        // 构造用户对象用于渲染头像
        // 如果是对方发的，用 m 里的 user 信息；如果是自己发的，用全局 currentUser
        const userObj = isMe ? currentUser : {
            username: m.username,
            avatar_variant: m.avatar_variant,
            avatar_url: m.avatar_url
        };
        
        const avatarHtml = renderUserAvatar(userObj);
        
        // 构造 HTML 结构：Row -> Avatar + Bubble
        const div = document.createElement('div');
        div.className = `msg-row ${isMe ? 'right' : 'left'}`;
        
        // 解析内容支持图片等
        // 注意：私信暂时不建议支持太多 markdown，防止样式崩坏，或者只支持简单的
        // 这里简单处理换行
        const contentHtml = m.content.replace(/\n/g, '<br>');

        div.innerHTML = `
            <div class="msg-avatar">${avatarHtml}</div>
            <div class="msg-bubble">${contentHtml}</div>
        `;
        
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
        <div class="msg-avatar">${avatarHtml}</div>
        <div class="msg-bubble">${content}</div>
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

window.blockUser = async function(uid) {
    if(!confirm("确定要拉黑该用户吗？你们将解除好友关系且无法互发消息。")) return;
    const res = await fetch(`${API_BASE}/block`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'block', target_id: uid })
    });
    const d = await res.json();
    if(d.success) showToast("已拉黑", "success");
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


// Markdown 渲染辅助函数
// 修改 parseMarkdown 函数
function parseMarkdown(text) {
    if (!text) return '';
    
    // 1. 先解析 @username (在 MD 解析前处理，避免破坏 HTML)
    // 假设用户名只包含字母数字下划线
    let processedText = text.replace(/@(\w+)/g, '<a href="#profile?u=$1" class="mention-link">@$1</a>');

    // 2. 解析 MD
    const rawHtml = marked.parse(processedText);
    
    // 3. 净化 (允许 class 属性)
    return DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: ['video', 'source'],     
        ADD_ATTR: ['controls', 'src', 'width', 'style', 'class', 'href', 'target'] 
    });
}

function calculateLevel(xp) {
    if (xp >= 60000) return { lv: 10, percent: 100, next: 'MAX', title: '赛博神' };
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
                div.className = `post-card ${isAnnounceClass}`; 
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
                                <span class="post-author-name-large mention-link" ${authorAction}>${author}</span>
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
                            <p><strong>封禁理由 / REASON:</strong><br><span style="color: #ff3333">${reason}</span></p>
                            <p><strong>解封时间 / EXPIRES:</strong><br><span style="color: #0f0">${expireDate}</span></p>
                        </div>
                        <p style="color: #666; font-size: 0.8rem;">在此期间您无法进行任何操作。</p>
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

        const settingUser = document.getElementById('settingUsername');
        if(settingUser) settingUser.value = data.username;

        document.getElementById('username').textContent = data.nickname || data.username;
        document.getElementById('coinCount').textContent = data.coins;
        
        document.getElementById('avatarContainer').innerHTML = `<div class="post-avatar-box" style="width:50px;height:50px;border-color:#333">${renderUserAvatar(data)}</div>`;
        const settingPreview = document.getElementById('settingCustomAvatarPreview'); // 注意ID变了，对应新卡片
        if(settingPreview) settingPreview.innerHTML = renderUserAvatar(data);
        
        const keyDisplay = document.getElementById('recoveryKeyDisplay');
        if(keyDisplay) keyDisplay.value = data.recovery_key || "未生成";
        
        const badgePrefSelect = document.getElementById('badgePreferenceSelect');
        if(badgePrefSelect) badgePrefSelect.value = data.badge_preference || 'number';
        
        document.getElementById('badgesArea').innerHTML = getBadgesHtml(data) + `<div id="logoutBtn">EXIT</div>`;
        
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

        if(data.is_vip) {
            const vipBox = document.getElementById('vipBox');
            // 计算剩余天数
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
            // 如果不是VIP，显示广告
            const vipBox = document.getElementById('vipBox');
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
        
        handleRoute();

        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }

    } catch (e) { 
        console.error("CheckSecurity Error:", e); 
        if (mask) { mask.style.opacity = '0'; setTimeout(() => mask.remove(), 500); }
    }
}

function initApp() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) { 
        mobileMenuBtn.onclick = (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); }; 
    }
    
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('mobileMenuBtn');
        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== btn) { sidebar.classList.remove('open'); }
    });
    
    const checkInBtn = document.getElementById('checkInBtn'); 
    if (checkInBtn) checkInBtn.onclick = window.doCheckIn;
    
    const postForm = document.getElementById('postForm'); 
    if (postForm) postForm.onsubmit = doPost;

    const commentsList = document.getElementById('commentsList');
    if (commentsList) {
        commentsList.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG' && e.target.closest('.comment-text')) {
                openLightbox(e.target.src);
            }
        });
    }

    const homeNavLink = document.querySelector('a[href="#home"]');
    if (homeNavLink) {
        homeNavLink.addEventListener('click', () => {
            sessionStorage.removeItem('homeScrollY'); 
            window.scrollTo(0, 0);
        });
    }
    
    window.addEventListener('hashchange', handleRoute);
    
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
    
    if(isAppReady) handleRoute();
}

const views = {
    home: document.getElementById('view-home'),
    write: document.getElementById('view-write'),
    tasks: document.getElementById('view-tasks'),
    leaderboard: document.getElementById('view-leaderboard'),
    post: document.getElementById('view-post'),
    shop: document.getElementById('view-shop'),
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
        if (views.home.style.display === 'block') {
             homeScrollY = window.scrollY;
        }

        if(views.post) views.post.style.display = 'block';
        const params = new URLSearchParams(hash.split('?')[1]);
        loadSinglePost(params.get('id'), params.get('commentId')); 
    }
    else if (hash === '#write') {
        if(views.write) views.write.style.display = 'block';
        const link = document.getElementById('navWrite'); if(link) link.classList.add('active');
        tryRestoreDraft();
    } else if (hash === '#tasks') {
        if(views.tasks) views.tasks.style.display = 'block';
        loadTasks();
    } else if (hash === '#leaderboard') {
        if(views.leaderboard) views.leaderboard.style.display = 'block';
        const link = document.querySelector('a[href="#leaderboard"]'); if(link) link.classList.add('active');
        loadLeaderboard();
    } else if (hash === '#shop') {
        if(views.shop) views.shop.style.display = 'block';
        const link = document.querySelector('a[href="#shop"]'); if(link) link.classList.add('active');
    } else if (hash === '#settings') {
        if(views.settings) views.settings.style.display = 'block';
        const link = document.querySelector('a[href="#settings"]'); if(link) link.classList.add('active');
    } else if (hash === '#about') {
        if(views.about) views.about.style.display = 'block';
        const link = document.querySelector('a[href="#about"]'); if(link) link.classList.add('active');
        renderLevelTable();
    } else if (hash === '#notifications') {
        if(views.notifications) views.notifications.style.display = 'block';
        const link = document.getElementById('navNotify'); if(link) link.classList.add('active');
        loadNotifications();
        // ... 在 handleRoute 内部 ...
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

async function loadSinglePost(id, targetCommentId = null) {
    currentPostId = id; const container = document.getElementById('single-post-content'); if(!container) return; container.innerHTML = '读取中...'; document.getElementById('commentsList').innerHTML = '';
    const backBtn = document.querySelector('#view-post .back-btn'); if (backBtn) { if (returnToNotifications) { backBtn.textContent = "< 返回通知 / BACK TO LOGS"; backBtn.onclick = () => window.location.hash = '#notifications'; } else { backBtn.textContent = "< 返回 / BACK"; backBtn.onclick = () => window.location.hash = '#home'; } }
    const commentInput = document.getElementById('commentInput'); if(commentInput) { commentInput.value = ''; commentInput.placeholder = "输入你的看法... (支持纯文本)"; commentInput.dataset.parentId = ""; isEditingComment = false; editingCommentId = null; const submitBtn = document.querySelector('.comment-input-box button:first-of-type'); if(submitBtn) { /*submitBtn.textContent = "发送评论 / SEND (+5 XP)";*/ } } const cancelBtn = document.getElementById('cancelReplyBtn'); if (cancelBtn) cancelBtn.style.display = 'none';
    try {
        const res = await fetch(`${API_BASE}/posts?id=${id}`); const post = await res.json(); if (!post) { container.innerHTML = '<h1>404 - 内容可能已被删除</h1>'; return; }
        
        currentPostAuthorId = post.user_id;

        const rawDate = post.updated_at || post.created_at; const dateStr = new Date(rawDate).toLocaleString(); const editedTag = post.updated_at ? '<span class="edited-tag">已编辑</span>' : '';
        
        let actionBtns = ''; if (userRole === 'admin') { const pinText = post.is_pinned ? "取消置顶 / UNPIN" : "置顶 / PIN"; const pinColor = post.is_pinned ? "#0f0" : "#666"; actionBtns += `<button onclick="pinPost(${post.id})" class="delete-btn" style="border-color:${pinColor};color:${pinColor};margin-right:10px">${pinText}</button>`; } if (userRole === 'admin' || (currentUser && (currentUser.username === post.author_username || currentUser.id === post.user_id))) { actionBtns += `<button onclick="editPostMode('${post.id}')" class="delete-btn" style="border-color:#0070f3;color:#0070f3;margin-right:10px">编辑 / EDIT</button>`; actionBtns += `<button onclick="deletePost(${post.id})" class="delete-btn">删除 / DELETE</button>`; } if (userRole === 'admin' && post.user_id !== currentUser.id) { actionBtns += `<button onclick="adminBanUser(${post.user_id})" class="delete-btn" style="border-color:yellow;color:yellow;margin-left:10px">封号 / BAN</button>`; } let tipBtn = ''; if (currentUser.id !== post.user_id) { tipBtn = `<button onclick="tipUser(${post.user_id})" class="cyber-btn" style="width:auto;font-size:0.8rem;padding:5px 10px;margin-left:10px;">打赏 / TIP</button>`; }
        
        const authorDisplay = post.author_nickname || post.author_username; const uObj = { username: post.author_username, avatar_variant: post.author_avatar_variant, avatar_url: post.author_avatar_url };const avatarSvg = renderUserAvatar(uObj); const badgeObj = { role: post.author_role, custom_title: post.author_title, custom_title_color: post.author_title_color, is_vip: post.author_vip, xp: post.author_xp || 0, badge_preference: post.author_badge_preference }; const badgesHtml = getBadgesHtml(badgeObj); const cat = post.category || '灌水'; const catHtml = `<span class="category-tag">${cat}</span>`; const likeClass = post.is_liked ? 'liked' : ''; const likeBtn = `<button class="like-btn ${likeClass}" onclick="toggleLike(${post.id}, 'post', this)">❤ <span class="count">${post.like_count||0}</span></button>`;
        const userLinkAction = `onclick="window.location.hash='#profile?u=${post.author_username}'" style="cursor:pointer"`;
        container.innerHTML = `<div class="post-header-row"><div class="post-author-info"><div class="post-avatar-box" ${userLinkAction}>${avatarSvg}</div><div class="post-meta-text"><span ${userLinkAction} style="color:#fff; font-size:1rem; font-weight:bold; ...">${authorDisplay} ${badgesHtml}</span><div style="display:flex; align-items:center; gap:10px; margin-top:5px;"><span>${catHtml} ID: ${post.id} // ${dateStr} ${editedTag}</span>${likeBtn}</div></div></div><div class="post-actions-mobile" style="display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px;">${actionBtns}${tipBtn}</div></div><h1 style="margin-top:20px;">${post.title}</h1><div class="article-body">${parseMarkdown(post.content)}</div>`;
        const imgs = container.querySelectorAll('.article-body img');
        imgs.forEach(img => {
            img.onclick = function() {
                openLightbox(this.src);
            };
        });
        currentCommentPage = 1; hasMoreComments = true; loadNativeComments(id, true, targetCommentId);
    } catch (e) { console.error(e); container.innerHTML = 'Error loading post.'; }
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
    const avatar = renderUserAvatar(c); // c 是评论对象，后端需包含 avatar_url
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
                <span class="comment-author" ${clickAttr}>${c.nickname || c.username} ${authorTag} ${badgeHtml}</span>
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
    if (!t && !c) {
        return showToast("标题和内容不能同时为空", "error");
    }
    
    btn.disabled = true; 
    try { 
        let url = `${API_BASE}/posts`; 
        let method = 'POST'; 
        // 这里的 body 会把空字符串传给后端
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
window.pinPost = async function(id) { if(!confirm("确认更改置顶状态？")) return; await fetch(`${API_BASE}/posts`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadSinglePost(id); };
window.pinComment = async function(id) { if(!confirm("确认更改此评论置顶状态？")) return; await fetch(`${API_BASE}/comments`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ action: 'pin', id: id }) }); loadNativeComments(currentPostId, true); };
window.deleteNotify = async function(id) { if(!confirm("Delete this log?")) return; await fetch(`${API_BASE}/notifications?id=${id}`, {method: 'DELETE'}); loadNotifications(); };
window.clearAllNotifications = async function() { if(!confirm("Clear ALL logs?")) return; await fetch(`${API_BASE}/notifications?all=true`, {method: 'DELETE'}); loadNotifications(); };
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
window.tipUser = async function(uid) {
    const amount = prompt("请输入打赏金额 (i币)：");
    if (!amount) return;
    if (!/^\d+$/.test(amount) || parseInt(amount) <= 0) {
        return showToast("请输入有效的整数金额", "error");
    }
    try {
        const res = await fetch(`${API_BASE}/tip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_user_id: uid, amount: amount })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, "success");
            setTimeout(() => {
                checkSecurity(); 
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
async function checkAdminStatus() { try { const res = await fetch(`${API_BASE}/admin`, { method: 'POST', body: JSON.stringify({action: 'get_stats'}) }); const data = await res.json(); if(data.success) { const badge = document.getElementById('adminFeedbackBadge'); if(badge) { if(data.unreadFeedback > 0) { badge.style.display = 'inline-block'; badge.textContent = data.unreadFeedback; } else { badge.style.display = 'none'; } } const statTotal = document.getElementById('statTotalUsers'); if(statTotal && statTotal.offsetParent !== null) { statTotal.innerText = data.totalUsers; document.getElementById('statActiveUsers').innerText = data.activeUsers; document.getElementById('inviteToggle').checked = data.inviteRequired; } } } catch(e){} }
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
        document.getElementById('profileName').textContent = u.nickname || u.username;
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
    if(!confirm("确定购买此商品吗？")) return;
    
    try {
        const res = await fetch(`${API_BASE}/shop`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'buy_vip', itemId: itemId })
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            checkSecurity(); // 刷新状态
        } else {
            showToast(data.error, 'error');
        }
    } catch(e) {
        showToast("购买失败", 'error');
    }
};

















