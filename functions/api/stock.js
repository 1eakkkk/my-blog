// functions/api/stock.js

// === 股市配置 ===
const STOCKS = {
    'BLUE': { name: '蓝盾安全指数', base: 100, vol: 0.02, color: '#00f3ff' }, // 2% 波动
    'GOLD': { name: '神经元科技',   base: 500, vol: 0.08, color: '#ffd700' }, // 8% 波动
    'RED':  { name: '荒坂军工期货', base: 2000, vol: 0.25, color: '#ff3333' }  // 25% 波动
};

// === 核心算法：基于时间的确定性价格生成 ===
// 只要输入相同的时间戳(分钟级)，输出的价格永远一样
function getPriceAtTime(symbol, timestamp) {
    const config = STOCKS[symbol];
    if(!config) return 0;

    // 将时间戳规整到分钟 (每分钟一个价格点)
    const timeStep = Math.floor(timestamp / 60000); 
    
    // 简单的伪随机数生成器 (这是为了不用数据库存历史价格)
    let seed = timeStep + symbol.length; 
    const random = () => {
        var x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };

    // 叠加几个正弦波模拟趋势
    // 大周期趋势 (小时级)
    const trend = Math.sin(timeStep / 60); 
    // 小周期波动 (分钟级)
    const noise = (random() - 0.5) * 2; 

    // 计算价格系数
    let factor = 1 + (trend * config.vol * 2) + (noise * config.vol);
    
    // 涨跌停限制 (熔断机制)
    if (factor > 1.5) factor = 1.5; // +50%
    if (factor < 0.5) factor = 0.5; // -50%

    let price = Math.floor(config.base * factor);
    return Math.max(1, price); // 最低 1 块钱
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    // 获取公司信息
    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    if (!company) return Response.json({ error: '无公司' }, { status: 400 });

    const method = request.method;
    const now = Date.now();

    // === GET: 获取行情 + 我的持仓 ===
    if (method === 'GET') {
        // 1. 生成 K 线数据 (过去 30 分钟)
        const history = {};
        for (let key in STOCKS) {
            history[key] = [];
            for (let i = 29; i >= 0; i--) {
                const t = now - (i * 60000);
                history[key].push({ t: t, p: getPriceAtTime(key, t) });
            }
        }

        // 2. 获取我的持仓
        const positions = await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all();

        return Response.json({
            success: true,
            market: history,
            positions: positions.results,
            capital: company.capital, // 公司当前资金
            companyType: company.type // 用于前端判断权限
        });
    }

    // === POST: 交易 (买入/卖出/做空/平仓) ===
    if (method === 'POST') {
        const { action, symbol, amount } = await request.json(); // amount 是股数
        const qty = parseInt(amount);
        const currentPrice = getPriceAtTime(symbol, now);
        
        if (qty <= 0) return Response.json({ error: '数量无效' });
        if (!STOCKS[symbol]) return Response.json({ error: '非法股票' });

        // === 权限校验 ===
        // shell: 只许买 BLUE
        if (company.type === 'shell' && symbol !== 'BLUE') return Response.json({ error: '公司等级不足，仅可交易蓝盾指数' });
        // startup: 只许买 BLUE, GOLD
        if (company.type === 'startup' && symbol === 'RED') return Response.json({ error: '公司等级不足，不可交易高危期货' });
        
        // 查持仓
        const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
        const currentHold = pos ? pos.amount : 0; // 正数=多单，负数=空单

        const batch = [];

        // 交易逻辑
        if (action === 'buy') { 
            // 买入 (做多)
            const cost = currentPrice * qty;
            if (company.capital < cost) return Response.json({ error: '公司资金不足' });

            // 更新资金
            batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(cost, company.id));
            
            // 更新持仓
            if (pos) {
                // 加仓: 更新均价
                // 新均价 = (旧持仓*旧均价 + 新持仓*当前价) / 总持仓
                // 注意：如果之前是空单(负数)，买入就是平空仓，逻辑稍微复杂，这里为了简化：
                // 如果持有空单，买入视为“平仓”，不计算均价，只减少负数绝对值
                if (currentHold < 0) {
                    // 平空逻辑
                    // 实际上这里应该算利润，但为了代码极简，我们采用“净持仓”逻辑
                    // 简单化：不管多空，只更新数量，利润在平仓那一下算？
                    // 不行，得算均价。
                    
                    // === 简化版交易逻辑 ===
                    // 只有当方向一致时才更新均价。方向相反视为平仓。
                    if (qty > Math.abs(currentHold)) { return Response.json({ error: '反向交易请先平仓' }); } // 暂不支持直接反手
                    
                    // 平空单：利润 = (开仓价 - 当前价) * 平仓数量
                    const profit = (pos.avg_price - currentPrice) * qty;
                    // 返还保证金(开仓时的钱) + 利润
                    const returnCapital = (pos.avg_price * qty) + profit; 
                    
                    // 这里的 update capital 逻辑要改，上面扣了 cost，其实平仓是回钱
                    // 修正：平仓是回钱
                    return Response.json({ error: '请使用[卖出/平仓]按钮来减少持仓' }); // 引导用户去点卖出
                } else {
                    // 正常加多仓
                    const totalCost = (currentHold * pos.avg_price) + cost;
                    const newQty = currentHold + qty;
                    const newAvg = totalCost / newQty;
                    batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ? WHERE id = ?").bind(newQty, newAvg, pos.id));
                }
            } else {
                // 新开仓
                batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price) VALUES (?, ?, ?, ?)").bind(company.id, symbol, qty, currentPrice));
            }
        } 
        
        else if (action === 'sell') {
            // 卖出 (平多仓 或 开空仓)
            if (company.type !== 'blackops' && currentHold <= 0) {
                return Response.json({ error: '未持有该股票 (仅黑域工作室可做空)' });
            }

            // 如果是做空 (currentHold <= 0)
            if (currentHold <= 0) {
                // 开空仓
                // 需要保证金 = currentPrice * qty
                const margin = currentPrice * qty;
                if (company.capital < margin) return Response.json({ error: '保证金不足，无法做空' });

                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                
                if (pos) {
                    // 加空仓
                    const oldAbs = Math.abs(currentHold);
                    const totalVal = (oldAbs * pos.avg_price) + margin;
                    const newAbs = oldAbs + qty;
                    const newAvg = totalVal / newAbs;
                    batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ? WHERE id = ?").bind(-newAbs, newAvg, pos.id)); // amount 存负数
                } else {
                    // 新空仓
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price) VALUES (?, ?, ?, ?)").bind(company.id, symbol, -qty, currentPrice));
                }
            } 
            else {
                // 平多仓 (卖出持有的股票)
                if (qty > currentHold) return Response.json({ error: '持仓不足' });
                
                const income = currentPrice * qty; // 卖得的钱
                const costBasis = pos.avg_price * qty; // 成本
                const profit = income - costBasis; // 利润 (仅作记录，钱已经进了 capital)

                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(income, company.id));
                
                if (qty === currentHold) {
                    batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                } else {
                    batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
                }
            }
        }
        
        // 专门处理平空仓逻辑 (买入平空)
        else if (action === 'cover') {
             if (currentHold >= 0) return Response.json({ error: '当前无空单' });
             if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });

             // 平空逻辑：
             // 利润 = (卖出均价 - 当前买入价) * 数量
             const profit = (pos.avg_price - currentPrice) * qty;
             // 回本 = 保证金(原价) + 利润
             const returnAmount = (pos.avg_price * qty) + profit;

             batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));

             if (qty === Math.abs(currentHold)) {
                 batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
             } else {
                 batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id)); // 负数 + 正数 = 绝对值变小
             }
        }

        await db.batch(batch);
        return Response.json({ success: true, message: '交易成功' });
    }
}
