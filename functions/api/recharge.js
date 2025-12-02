// functions/api/recharge.js

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) {
        return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
    }
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

    if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        
        // === 卡密兑换逻辑 ===
        if (body.action === 'redeem') {
            const { cdk } = body;
            if (!cdk) return new Response(JSON.stringify({ error: '请输入卡密' }), { status: 400 });

            // 查找卡密 (状态为 unused)
            // 假设表名为 recharge_codes: code, value, status ('unused', 'used')
            const codeRecord = await db.prepare("SELECT * FROM recharge_codes WHERE code = ? AND status = 'unused'").bind(cdk).first();

            if (!codeRecord) {
                return new Response(JSON.stringify({ error: '卡密无效或已被使用' }), { status: 400 });
            }

            const amount = codeRecord.value; // 卡密面值 (i币数量)
            const now = Date.now();

            try {
                await db.batch([
                    // 1. 给用户加币 (充值不加经验，或者你可以自己定)
                    db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(amount, user.id),
                    // 2. 标记卡密已用
                    db.prepare("UPDATE recharge_codes SET status = 'used', used_by = ?, used_at = ? WHERE id = ?").bind(user.id, now, codeRecord.id),
                    // 3. 记录日志 (可选，借用 tips 表或者新建 recharge_logs)
                    db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)")
                    .bind(user.id, `充值成功！获得 ${amount} i币`, now)
                ]);

                return new Response(JSON.stringify({ success: true, message: `兑换成功！获得 ${amount} i币` }));
            } catch (e) {
                return new Response(JSON.stringify({ error: '数据库错误' }), { status: 500 });
            }
        }
    }

    return new Response(JSON.stringify({ error: 'Method error' }), { status: 405 });
}
