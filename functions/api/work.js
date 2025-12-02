// functions/api/work.js
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth required' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth failed' }, { status: 401 });

    const method = request.method;

    // 获取当前工作状态
    if (method === 'GET') {
        const work = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
        return Response.json({ success: true, work });
    }

    // 开始工作 / 结算工作
    if (method === 'POST') {
        const body = await request.json();
        const { action, workType } = body;
        const now = Date.now();

        // 定义工作配置
        const WORKS = {
            'cleaning': { name: '数据清理', duration: 2 * 60 * 1000, reward: 15 }, // 2分钟
            'sorting':  { name: '缓存整理', duration: 10 * 60 * 1000, reward: 80 }, // 10分钟
            'debug':    { name: '黑盒调试', duration: 60 * 60 * 1000, reward: 500 } // 1小时
        };

        if (action === 'start') {
            const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
            if (current) return Response.json({ success: false, error: '已有任务在运行中' });

            const w = WORKS[workType];
            if (!w) return Response.json({ success: false, error: '未知任务类型' });

            await db.prepare("INSERT INTO user_works (user_id, work_type, start_time, end_time, status) VALUES (?, ?, ?, ?, 'working')")
                .bind(user.id, workType, now, now + w.duration).run();

            return Response.json({ success: true, message: `任务 [${w.name}] 已启动` });
        }

        if (action === 'claim') {
            const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
            if (!current) return Response.json({ success: false, error: '当前无任务' });
            
            if (now < current.end_time) {
                const left = Math.ceil((current.end_time - now) / 1000);
                return Response.json({ success: false, error: `任务运行中，剩余 ${left} 秒` });
            }

            const w = WORKS[current.work_type];
            // 结算：发钱 + 删记录
            await db.batch([
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(w.reward, user.id),
                db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id)
            ]);

            return Response.json({ success: true, message: `任务完成！获得 ${w.reward} i币` });
        }
        
        // 放弃任务
        if (action === 'cancel') {
             await db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id).run();
             return Response.json({ success: true, message: '任务进程已终止' });
        }
    }
}
