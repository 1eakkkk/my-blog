// functions/api/recharge_submit.js
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请登录' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

    const body = await request.json();
    const { type, proofUrl } = body;

    // 金额映射
    const amountMap = {
        'small': '0.1元 (650币)',
        'large': '0.6元 (4300币)'
    };
    
    if (!amountMap[type] || !proofUrl) {
        return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
    }

    try {
        const now = Date.now();
        const amountStr = amountMap[type];

        // 1. 插入申请记录
        await db.prepare(`
            INSERT INTO recharge_requests (user_id, username, amount_str, proof_url, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `).bind(user.id, user.username, amountStr, proofUrl, now).run();

        // 2. === 新增：通知管理员 ===
        // 查找所有 role 为 'admin' 的用户 ID
        const admins = await db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
        
        if (admins.results.length > 0) {
            const notifyBatch = [];
            const msg = `🔔 新的充值申请：用户 [${user.nickname || user.username}] 提交了 [${amountStr}] 的充值请求，请前往后台审核。`;
            
            for (const admin of admins.results) {
                notifyBatch.push(
                    db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)")
                    .bind(admin.id, msg, now)
                );
            }
            // 批量发送通知
            await db.batch(notifyBatch);
        }

        return new Response(JSON.stringify({ success: true }));
    } catch (e) {
        return new Response(JSON.stringify({ error: '数据库错误: ' + e.message }), { status: 500 });
    }
}
