// functions/api/recharge_submit.js
export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请登录' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

    const body = await request.json();
    const { type, proofUrl } = body;

    // 简单的金额映射
    const amountMap = {
        'small': '0.1元 (650币)',
        'large': '0.6元 (4300币)'
    };
    
    if (!amountMap[type] || !proofUrl) {
        return new Response(JSON.stringify({ error: '参数错误' }), { status: 400 });
    }

    try {
        await db.prepare(`
            INSERT INTO recharge_requests (user_id, username, amount_str, proof_url, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `).bind(user.id, user.username, amountMap[type], proofUrl, Date.now()).run();

        // 可选：在这里发个通知给管理员 (如果你的 admin 界面没有轮询的话)
        // ...

        return new Response(JSON.stringify({ success: true }));
    } catch (e) {
        return new Response(JSON.stringify({ error: '数据库错误' }), { status: 500 });
    }
}
