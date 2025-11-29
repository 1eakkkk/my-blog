// --- functions/api/shop.js ---

// 商品目录 (硬编码在后端，或者存数据库)
const CATALOG = {
    // === VIP ===
    'vip_7': { cost: 70, name: 'VIP 周卡', type: 'vip', days: 7 },
    'vip_14': { cost: 120, name: 'VIP 双周卡', type: 'vip', days: 14 },
    'vip_30': { cost: 210, name: 'VIP 月卡', type: 'vip', days: 30 },
    
    // === 消耗品 ===
    'rename_card': { cost: 100, name: '改名卡', type: 'consumable', category: 'consumable' },
    
    // === 背景 ===
    'bg_matrix': { cost: 500, name: '矩阵数据流', type: 'decoration', category: 'background' },
    'bg_space': { cost: 900, name: '深空星系', type: 'decoration', category: 'background' },
    
    // === 帖子框 ===
    'post_neon': { cost: 200, name: '霓虹边框', type: 'decoration', category: 'post_style', css: 'style-neon' },
    'post_gold': { cost: 500, name: '黄金传说', type: 'decoration', category: 'post_style', css: 'style-gold' },
    'post_glitch': { cost: 300, name: '故障艺术', type: 'decoration', category: 'post_style', css: 'style-glitch' },
    
    // === 气泡 ===
    'bubble_pink': { cost: 150, name: '赛博粉气泡', type: 'decoration', category: 'bubble', css: 'bubble-pink' },
    'bubble_hacker': { cost: 150, name: '黑客绿气泡', type: 'decoration', category: 'bubble', css: 'bubble-hacker' },
    
    // === 名字颜色 (时效 30天) ===
    'color_rainbow': { cost: 300, name: '彩虹昵称 (30天)', type: 'timed', category: 'name_color', days: 30, css: 'color-rainbow' },
    'color_fire': { cost: 200, name: '火焰昵称 (30天)', type: 'timed', category: 'name_color', days: 30, css: 'color-fire' }
};

export async function onRequestPost(context) {
    // ... (鉴权代码保持不变) ...
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

    const { action, itemId } = await context.request.json();
    const item = CATALOG[itemId];

    if (!item) return new Response(JSON.stringify({ success: false, error: '商品不存在' }));
    if (user.coins < item.cost) return new Response(JSON.stringify({ success: false, error: '余额不足' }));

    // === 购买 VIP ===
    if (item.type === 'vip') {
        // ... (保留之前的 VIP 逻辑) ...
         const now = Date.now();
         let newExpire = now;
         if (user.vip_expires_at > now) newExpire = user.vip_expires_at + (item.days * 86400 * 1000);
         else newExpire = now + (item.days * 86400 * 1000);
         await db.prepare('UPDATE users SET coins = coins - ?, vip_expires_at = ?, is_vip = 1 WHERE id = ?').bind(item.cost, newExpire, user.id).run();
         return new Response(JSON.stringify({ success: true, message: 'VIP 充值成功' }));
    }

    // === 购买消耗品 (如改名卡) ===
    if (item.type === 'consumable') {
        // 检查背包是否已有，有则加数量，无则插入
        const existing = await db.prepare('SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, itemId).first();
        
        await db.batch([
            db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(item.cost, user.id),
            existing 
                ? db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').bind(existing.id)
                : db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, 1, ?)').bind(user.id, itemId, item.category, Date.now())
        ]);
        return new Response(JSON.stringify({ success: true, message: `购买成功: ${item.name}` }));
    }
    
    // === 购买装饰/时效道具 ===
    if (item.type === 'decoration' || item.type === 'timed') {
        // 装饰品通常不能重复购买 (除非是时效的续费)
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, itemId).first();
        
        // 如果是永久装饰且已有
        if (existing && item.type === 'decoration') {
            return new Response(JSON.stringify({ success: false, error: '你已经拥有该物品了' }));
        }
        
        let expireTime = 0;
        if (item.type === 'timed') {
            expireTime = Date.now() + (item.days * 86400 * 1000);
            // 如果已有，可以做续费逻辑，这里简单处理为插入新的或更新时间
        }

        await db.batch([
             db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(item.cost, user.id),
             db.prepare('INSERT INTO user_items (user_id, item_id, category, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, itemId, item.category, expireTime, Date.now())
        ]);
        return new Response(JSON.stringify({ success: true, message: `购买成功: ${item.name}` }));
    }
    
    return new Response(JSON.stringify({ success: false }));
}
