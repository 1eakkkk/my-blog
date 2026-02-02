// --- functions/api/roulette.js ---

const MULTIPLIERS = [
    { val: 0,   weight: 45, label: '0x (归零)' },
    { val: 0.5, weight: 20, label: '0.5x (回血)' },
    { val: 1.5, weight: 20, label: '1.5x (小赚)' },
    { val: 2.0, weight: 10, label: '2.0x (翻倍)' },
    { val: 5.0, weight: 4,  label: '5.0x (超级)' },
    { val: 10.0,weight: 1,  label: '10x (大奖)' }
];

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const { amount } = await request.json();
    const bet = parseInt(amount);
    
    if (isNaN(bet) || bet < 10) return Response.json({ error: '最小下注 10 i币' });
    if (user.coins < bet) return Response.json({ error: '余额不足' });

    // 抽奖逻辑
    let totalW = MULTIPLIERS.reduce((a,b)=>a+b.weight,0);
    let r = Math.random() * totalW;
    let result = MULTIPLIERS[0];
    
    for(let m of MULTIPLIERS) {
        r -= m.weight;
        if(r <= 0) { result = m; break; }
    }

    const winAmount = Math.floor(bet * result.val);
    const netChange = winAmount - bet;

    await db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(netChange, user.id).run();

    return Response.json({
        success: true,
        multiplier: result.val,
        win_amount: winAmount,
        net_change: netChange,
        new_balance: user.coins + netChange
    });
}
