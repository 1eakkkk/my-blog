// functions/api/admin_generate_codes.js

// 生成随机卡密函数 (格式: RC-XXXX-XXXX)
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
    let result = 'RC';
    for (let i = 0; i < 8; i++) {
        if (i % 4 === 0) result += '-';
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 简单鉴权 (建议配合你的 admin.js 里的鉴权逻辑，这里简化处理)
    // 实际使用时，请确保只有你能访问，或者硬编码一个 secret 参数
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    if (secret !== '这里设置一个只有你知道的密码123456') { // <--- 请修改这个密码
        return new Response("Unauthorized", { status: 401 });
    }

    // 获取参数: amount (面值), count (数量)
    const amount = parseInt(url.searchParams.get('amount')); // 例如 650
    const count = parseInt(url.searchParams.get('count')) || 10; // 默认生成10个

    if (!amount) return new Response("Missing amount", { status: 400 });

    const codes = [];
    const stmt = db.prepare("INSERT INTO recharge_codes (code, value, created_at) VALUES (?, ?, ?)");
    const now = Date.now();
    const batch = [];

    for (let i = 0; i < count; i++) {
        const code = generateCode();
        codes.push(code);
        batch.push(stmt.bind(code, amount, now));
    }

    try {
        await db.batch(batch);
        // 返回纯文本格式，方便直接复制到发卡网
        return new Response(codes.join('\n'), { 
            headers: { 'Content-Type': 'text/plain' } 
        });
    } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
    }
}
