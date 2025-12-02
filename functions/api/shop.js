// --- functions/api/shop.js ---

// 丰富多彩的商品目录
const CATALOG = {
    // === 💎 VIP 会员 ===
    'vip_7':  { cost: 70,  name: 'VIP 周卡', type: 'vip', days: 7, icon: '🎫', rarity: 'common' },
    'vip_14': { cost: 120, name: 'VIP 进阶卡', type: 'vip', days: 14, icon: '⚡', rarity: 'rare' },
    'vip_30': { cost: 210, name: 'VIP 尊享月卡', type: 'vip', days: 30, icon: '👑', rarity: 'epic' },

    // === 🌱 家园种子 (Seeds) - 新增部分 ===
    'seed_moss':    { cost: 20,  name: '种子:低频苔藓', type: 'consumable', category: 'consumable', icon: '🌿', desc: '家园基础作物，4小时成熟', rarity: 'common' },
    'seed_quantum': { cost: 100, name: '种子:量子枝条', type: 'consumable', category: 'consumable', icon: '🎋', desc: '中级作物，12小时成熟', rarity: 'rare' },
    'seed_vine':    { cost: 300, name: '种子:修复算法藤', type: 'consumable', category: 'consumable', icon: '🧬', desc: '高级作物，24小时成熟', rarity: 'epic' },

    // === 💳 功能道具 ===
    'rename_card': { cost: 100, name: '改名卡', type: 'consumable', category: 'consumable', icon: '💳', desc: '修改一次昵称', rarity: 'common' },
    'top_card':    { cost: 500, name: '置顶卡(24h)', type: 'consumable', category: 'consumable', icon: '📌', desc: '将帖子置顶24小时', rarity: 'rare' },
    
    // === 📢 全服播报卡 (Broadcast) ===
    'broadcast_low': { 
        cost: 500, 
        name: '基础信标卡', 
        type: 'consumable', 
        category: 'consumable', 
        icon: '📡', 
        desc: '全服广播(系统预设)，持续24h。需审核。', 
        rarity: 'rare' 
    },
    'broadcast_high': { 
        cost: 2000, 
        name: '骇客宣言卡', 
        type: 'consumable', 
        category: 'consumable', 
        icon: '🛰️', 
        desc: '自定义全服广播(支持幻彩)，持续24h。需审核。', 
        rarity: 'legendary' 
    },

    // === 🌌 网页背景 (Backgrounds) ===
    'bg_matrix':   { cost: 500, name: '矩阵数据流', type: 'decoration', category: 'background', icon: '👾', rarity: 'rare' },
    'bg_space':    { cost: 900, name: '深空星系', type: 'decoration', category: 'background', icon: '🌌', rarity: 'epic' },
    'bg_cyber':    { cost: 800, name: '赛博都市', type: 'decoration', category: 'background', icon: '🏙️', rarity: 'epic' },
    'bg_sakura':   { cost: 600, name: '落樱缤纷', type: 'decoration', category: 'background', icon: '🌸', rarity: 'rare' },
    'bg_fire':     { cost: 1200,name: '地狱烈焰', type: 'decoration', category: 'background', icon: '🔥', rarity: 'legendary' },
    'bg_abyss':    { cost: 1000, name: '深渊幽蓝', type: 'decoration', category: 'background', icon: '🐋', rarity: 'epic' },

    // === 🖼️ 帖子边框 (Post Styles) ===
    'post_neon':   { cost: 200, name: '霓虹边框', type: 'decoration', category: 'post_style', css: 'style-neon', icon: '🟦', rarity: 'common' },
    'post_gold':   { cost: 500, name: '黄金传说', type: 'decoration', category: 'post_style', css: 'style-gold', icon: '🟨', rarity: 'epic' },
    'post_glitch': { cost: 300, name: '故障艺术', type: 'decoration', category: 'post_style', css: 'style-glitch', icon: '📺', rarity: 'rare' },
    'post_pixel':  { cost: 250, name: '复古像素', type: 'decoration', category: 'post_style', css: 'style-pixel', icon: '👾', rarity: 'common' },
    'post_fire':   { cost: 800, name: '燃烧之魂', type: 'decoration', category: 'post_style', css: 'style-fire', icon: '🔥', rarity: 'legendary' },

    // === 💬 聊天气泡 (Chat Bubbles) ===
    'bubble_pink': { cost: 150, name: '赛博粉', type: 'decoration', category: 'bubble', css: 'bubble-pink', icon: '💗', rarity: 'common' },
    'bubble_green':{ cost: 150, name: '黑客绿', type: 'decoration', category: 'bubble', css: 'bubble-hacker', icon: '📟', rarity: 'common' },
    'bubble_gold': { cost: 400, name: '土豪金', type: 'decoration', category: 'bubble', css: 'bubble-gold', icon: '💰', rarity: 'epic' },
    'bubble_blue': { cost: 200, name: '深海蓝', type: 'decoration', category: 'bubble', css: 'bubble-sea', icon: '🌊', rarity: 'rare' },

    // === 🌈 名字颜色 (Name Colors - 时效30天) ===
    'color_rainbow': { cost: 300, name: '彩虹昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-rainbow', icon: '🌈', rarity: 'epic' },
    'color_fire':    { cost: 200, name: '火焰昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-fire', icon: '🔥', rarity: 'rare' },
    'color_ice':     { cost: 200, name: '冰霜昵称', type: 'timed', category: 'name_color', days: 30, css: 'color-ice', icon: '❄️', rarity: 'rare' },
    'color_gold':    { cost: 500, name: '至尊金名', type: 'timed', category: 'name_color', days: 30, css: 'color-gold', icon: '👑', rarity: 'legendary' }
};

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ success: false, error: '未登录' });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return Response.json({ success: false, error: '会话无效' });

    let body = {};
    try { body = await request.json(); } catch(e) {}
    
    // === 获取数量 ===
    const { itemId, quantity } = body;
    const buyCount = Math.max(1, parseInt(quantity) || 1); // 默认为1，最少为1

    const item = CATALOG[itemId];
    if (!item) return Response.json({ success: false, error: '商品不存在' });

    // 计算总价
    const totalCost = item.cost * buyCount;
    if (user.coins < totalCost) return Response.json({ success: false, error: `余额不足，需要 ${totalCost} i币` });

    // VIP 和 时效道具通常不支持批量，强制为1
    if (item.type === 'vip' || item.type === 'timed' || item.type === 'decoration') {
        if(buyCount > 1) return Response.json({ success: false, error: '此类商品只能单次购买' });
    }

    // === 执行购买 ===
    if (item.type === 'vip') {
         const now = Date.now();
         let newExpire = (user.vip_expires_at > now ? user.vip_expires_at : now) + (item.days * 86400 * 1000);
         await db.prepare('UPDATE users SET coins = coins - ?, vip_expires_at = ?, is_vip = 1 WHERE id = ?').bind(totalCost, newExpire, user.id).run();
         return Response.json({ success: true, message: 'VIP 充值成功' });
    }

    // === 消耗品 (种子/卡片) - 支持批量 ===
    if (item.type === 'consumable') {
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, itemId).first();
        
        await db.batch([
            db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(totalCost, user.id),
            existing 
                ? db.prepare('UPDATE user_items SET quantity = quantity + ? WHERE id = ?').bind(buyCount, existing.id)
                : db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, itemId, item.category, buyCount, Date.now())
        ]);
        return Response.json({ success: true, message: `购买成功: ${item.name} x${buyCount}` });
    }
    
    // === 装饰/时效 ===
    if (item.type === 'decoration' || item.type === 'timed') {
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, itemId).first();
        if (existing && item.type === 'decoration') return Response.json({ success: false, error: '已拥有该物品' });
        
        let expireTime = item.type === 'timed' ? Date.now() + (item.days * 86400 * 1000) : 0;
        await db.batch([
             db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(totalCost, user.id),
             db.prepare('INSERT INTO user_items (user_id, item_id, category, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, itemId, item.category, expireTime, Date.now())
        ]);
        return Response.json({ success: true, message: `购买成功: ${item.name}` });
    }
    
    return Response.json({ success: false, error: 'Error' });
}
