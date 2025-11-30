// --- functions/api/broadcast.js ---
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // GET: 获取当前生效的播报 (前端页面加载时调用)
    if (request.method === 'GET') {
        const now = Date.now();
        // 查出所有状态为 active 且未过期的播报
        const activeList = await db.prepare(`
            SELECT id, nickname, tier, content, style_color 
            FROM broadcasts 
            WHERE status = 'active' AND end_time > ?
            ORDER BY start_time DESC
        `).bind(now).all();

        return new Response(JSON.stringify({ success: true, list: activeList.results }));
    }

    // POST: 用户使用道具，提交申请
    if (request.method === 'POST') {
        // 鉴权
        const cookie = request.headers.get('Cookie');
        if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
        const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
        const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });

        const { tier, content, color } = await request.json(); // tier: 'high' or 'low'

        // 1. 检查道具
        const itemId = tier === 'high' ? 'broadcast_high' : 'broadcast_low';
        const item = await db.prepare('SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0').bind(user.id, itemId).first();
        
        if (!item) return new Response(JSON.stringify({ success: false, error: '道具不足' }));

        // 2. 校验内容
        let finalContent = content;
        let finalColor = color || '#ffffff';

        if (tier === 'low') {
            finalContent = `系统通告：${user.nickname || user.username} 正在注视着这片数据荒原。`; // 系统预设
            finalColor = '#ffffff';
        } else {
            if (!finalContent || finalContent.trim().length === 0) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }));
            if (finalContent.length > 20) return new Response(JSON.stringify({ success: false, error: '内容不能超过20字' }));
        }

        // 3. 扣除道具 & 插入待审核记录
        try {
            await db.batch([
                db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE id = ?').bind(item.id),
                db.prepare(`
                    INSERT INTO broadcasts (user_id, nickname, tier, content, style_color, status, created_at)
                    VALUES (?, ?, ?, ?, ?, 'pending', ?)
                `).bind(user.id, user.nickname || user.username, tier, finalContent, finalColor, Date.now())
            ]);
            
            // 清理 0 数量道具
            // await db.prepare('DELETE FROM user_items WHERE quantity <= 0').run();

            return new Response(JSON.stringify({ success: true, message: '申请已提交，管理员审核通过后生效 (24h)' }));
        } catch (e) {
            return new Response(JSON.stringify({ success: false, error: '数据库错误' }));
        }
    }
}
