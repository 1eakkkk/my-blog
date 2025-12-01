// --- functions/api/duel.js (完整修复版) ---

// 配置
const TAX_RATE = 0.01; // 1% 系统税收
const MIN_BET = 10;
const MAX_BET = 1000;
const DAILY_LIMIT = 20; // 每天最多玩20把

// 胜负逻辑: cube > blade, blade > membrane, membrane > cube
function resolveDuel(m1, m2) {
    if (m1 === m2) return 'draw';
    if (
        (m1 === 'cube' && m2 === 'blade') ||
        (m1 === 'blade' && m2 === 'membrane') ||
        (m1 === 'membrane' && m2 === 'cube')
    ) return 'creator';
    return 'challenger';
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });

    const now = Date.now();
    const today = new Date(now + 8*3600*1000).toISOString().split('T')[0];

    // === 处理 POST 请求 (操作) ===
    if (request.method === 'POST') {
        let body = {};
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ success: false, error: '无效的 JSON 数据' }), { status: 400 });
        }
        
        const { action } = body;

        // 每日限制检查 (仅针对创建和加入)
        if (action === 'create' || action === 'join') {
            const limit = await db.prepare('SELECT duel_count FROM user_daily_limits WHERE user_id = ? AND date_key = ?').bind(user.id, today).first();
            if (limit && limit.duel_count >= DAILY_LIMIT) {
                return new Response(JSON.stringify({ success: false, error: '今日神经连接次数已达上限 (20次)，请休息。' }));
            }
        }

        // --- 1. 创建对局 ---
        if (action === 'create') {
            const { bet, move } = body;
            const amount = parseInt(bet);
            
            if (isNaN(amount) || amount < MIN_BET || amount > MAX_BET) return new Response(JSON.stringify({ success: false, error: `下注范围: ${MIN_BET} - ${MAX_BET}` }));
            if (user.coins < amount) return new Response(JSON.stringify({ success: false, error: '余额不足' }));
            if (!['cube', 'membrane', 'blade'].includes(move)) return new Response(JSON.stringify({ success: false, error: '无效数据体' }));

            await db.batch([
                db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(amount, user.id),
                db.prepare(`
                    INSERT INTO duels (creator_id, creator_name, bet_amount, creator_move, status, created_at)
                    VALUES (?, ?, ?, ?, 'open', ?)
                `).bind(user.id, user.nickname||user.username, amount, move, now),
                db.prepare(`INSERT INTO user_daily_limits (user_id, date_key, duel_count) VALUES (?, ?, 1) ON CONFLICT(user_id, date_key) DO UPDATE SET duel_count = duel_count + 1`).bind(user.id, today)
            ]);

            return new Response(JSON.stringify({ success: true, message: '数据节点已建立，等待链接...' }));
        }

        // --- 2. 加入对局 (结算) ---
        if (action === 'join') {
            const { id, move } = body;
            
            const duel = await db.prepare('SELECT * FROM duels WHERE id = ? AND status = "open"').bind(id).first();
            if (!duel) return new Response(JSON.stringify({ success: false, error: '对局不存在或已结束' }));
            if (duel.creator_id === user.id) return new Response(JSON.stringify({ success: false, error: '无法与自己对战' }));
            if (user.coins < duel.bet_amount) return new Response(JSON.stringify({ success: false, error: '余额不足' }));

            const result = resolveDuel(duel.creator_move, move);
            let winnerId = 0;
            let winAmount = 0;
            const updates = [];
            
            // 扣除挑战者本金 + 增加次数
            updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(duel.bet_amount, user.id));
            updates.push(db.prepare(`INSERT INTO user_daily_limits (user_id, date_key, duel_count) VALUES (?, ?, 1) ON CONFLICT(user_id, date_key) DO UPDATE SET duel_count = duel_count + 1`).bind(user.id, today));

            if (result === 'draw') {
                // 平局退款
                updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(duel.bet_amount, duel.creator_id));
                updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(duel.bet_amount, user.id));
                updates.push(db.prepare("UPDATE duels SET status = 'closed', challenger_id = ?, challenger_name = ?, challenger_move = ?, winner_id = 0, resolved_at = ? WHERE id = ?").bind(user.id, user.nickname||user.username, move, now, id));
            } else {
                // 有胜负
                const totalPool = duel.bet_amount * 2;
                const tax = Math.ceil(totalPool * TAX_RATE);
                winAmount = totalPool - tax;
                winnerId = (result === 'creator') ? duel.creator_id : user.id;
                
                updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(winAmount, winnerId));
                updates.push(db.prepare("UPDATE duels SET status = 'closed', challenger_id = ?, challenger_name = ?, challenger_move = ?, winner_id = ?, resolved_at = ? WHERE id = ?").bind(user.id, user.nickname||user.username, move, winnerId, now, id));
            }

            await db.batch(updates);

            return new Response(JSON.stringify({ 
                success: true, 
                result: result, 
                creator_move: duel.creator_move,
                win_amount: winAmount,
                message: '数据流对撞完成' 
            }));
        }

        // --- 3. 撤销对局 ---
        if (action === 'cancel') {
            const { id } = body;
            const duel = await db.prepare('SELECT * FROM duels WHERE id = ? AND creator_id = ? AND status = "open"').bind(id, user.id).first();
            if (!duel) return new Response(JSON.stringify({ success: false, error: '无法撤销' }));

            await db.batch([
                db.prepare("UPDATE duels SET status = 'cancelled' WHERE id = ?").bind(id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(duel.bet_amount, user.id)
            ]);
            return new Response(JSON.stringify({ success: true, message: '已撤回数据流' }));
        }

        // --- 4. 获取历史战绩 (新增) ---
        if (action === 'history') {
            const list = await db.prepare(`
                SELECT id, creator_name, challenger_name, bet_amount, winner_id, created_at 
                FROM duels 
                WHERE (creator_id = ? OR challenger_id = ?) AND status != 'open' AND status != 'cancelled'
                ORDER BY created_at DESC LIMIT 20
            `).bind(user.id, user.id).all();
            return new Response(JSON.stringify({ success: true, list: list.results, my_id: user.id }));
        }

        // --- 5. 获取回放详情 (新增) ---
        if (action === 'get_replay') {
            const { id } = body;
            const duel = await db.prepare('SELECT * FROM duels WHERE id = ?').bind(id).first();
            
            if (!duel) return new Response(JSON.stringify({ success: false, error: '记录不存在' }));
            
            // 回放结果计算
            let result = 'draw';
            if (duel.winner_id === user.id) result = 'win';
            else if (duel.winner_id !== 0) result = 'lose';
            
            let myMove, oppMove;
            if (duel.creator_id === user.id) {
                myMove = duel.creator_move;
                oppMove = duel.challenger_move;
            } else {
                myMove = duel.challenger_move;
                oppMove = duel.creator_move;
            }

            const total = duel.bet_amount * 2;
            const tax = Math.ceil(total * TAX_RATE);
            const winAmount = total - tax;

            return new Response(JSON.stringify({ 
                success: true, 
                myMove, 
                oppMove, 
                result, 
                winAmount 
            }));
        }
    }

    // === 处理 GET 请求 (获取大厅列表) ===
    if (request.method === 'GET') {
        // 如果这里报错 500，说明 duels 表可能不存在
        try {
            const list = await db.prepare("SELECT id, creator_name, bet_amount, created_at FROM duels WHERE status = 'open' ORDER BY created_at DESC LIMIT 50").all();
            return new Response(JSON.stringify({ success: true, list: list.results }));
        } catch (e) {
            return new Response(JSON.stringify({ success: false, error: '数据库错误: ' + e.message }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), { status: 405 });
}
