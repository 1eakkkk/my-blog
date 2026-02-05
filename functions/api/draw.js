// --- functions/api/draw.js (带记忆功能版) ---

const HEXAGRAMS = {
    "111111": { name: "乾为天", title: "乾", desc: "元亨利贞。大吉之象，如龙飞天，刚健中正。宜进取，忌傲慢。" },
    "000000": { name: "坤为地", title: "坤", desc: "厚德载物。柔顺伸展，先迷后得。宜包容，利西南，不利东北。" },
    "100010": { name: "水雷屯", title: "屯", desc: "万物始生，充满艰难。宜建侯，不宜轻举妄动。" },
    "010001": { name: "山水蒙", title: "蒙", desc: "蒙昧初开，需待启蒙。宜求教，刑罚中正。" },
    "111010": { name: "水天需", title: "需", desc: "云在天上，需待时机。饮食宴乐，利涉大川。" },
    "010111": { name: "天水讼", title: "讼", desc: "身陷争执，事虽有利但难成。宜止争，不宜涉险。" },
    "010000": { name: "地水师", title: "师", desc: "行军用师，严正以律。吉，无咎。" },
    "000010": { name: "水地比", title: "比", desc: "亲密比辅，众星拱月。吉，原筮元永贞。" },
    "111011": { name: "风天小畜", title: "小畜", desc: "密云不雨。积蓄力量，时机未到，宜暂且忍耐。" },
    "110111": { name: "天泽履", title: "履", desc: "如履薄冰，行事小心。虽危无咎，终吉。" },
    "111000": { name: "地天泰", title: "泰", desc: "天地交泰，万物通畅。小往大来，吉亨。" },
    "000111": { name: "天地否", title: "否", desc: "天地不交，万物不通。大往小来，不利君子贞。" },
    "101111": { name: "天火同人", title: "同人", desc: "与人同心，利涉大川。利君子贞，合作共赢。" },
    "111101": { name: "火天大有", title: "大有", desc: "日丽中天，盛大丰有。元亨，遏恶扬善。" },
    "001000": { name: "地山谦", title: "谦", desc: "内高外低，谦谦君子。亨，君子有终。" },
    "000100": { name: "雷地豫", title: "豫", desc: "雷出地奋，安乐愉悦。利建侯行师，但也需防沉溺。" },
    "100110": { name: "泽雷随", title: "随", desc: "随顺时势，随机应变。元亨利贞，无咎。" },
    "011001": { name: "山风蛊", title: "蛊", desc: "器皿生虫，亟待整顿。利涉大川，先甲三日，后甲三日。" },
    "110000": { name: "地泽临", title: "临", desc: "居高临下，监临统御。元亨利贞，至于八月有凶。" },
    "000011": { name: "风地观", title: "观", desc: "风行地上，观摩省察。盥而不荐，有孚颙若。" },
    "100101": { name: "火雷噬嗑", title: "噬嗑", desc: "咬合咀嚼，刑罚公正。利用狱，铲除梗阻。" },
    "101001": { name: "山火贲", title: "贲", desc: "文饰光彩，外表修饰。小利有攸往，不仅重质，亦需重文。" },
    "000001": { name: "山地剥", title: "剥", desc: "剥落侵蚀，群阴剥阳。不利有攸往，宜顺势而止。" },
    "100000": { name: "地雷复", title: "复", desc: "一阳来复，万物更生。出入无疾，朋来无咎。" },
    "100111": { name: "天雷无妄", title: "无妄", desc: "真实无妄，顺其自然。元亨利贞，其匪正有眚。" },
    "111001": { name: "山天大畜", title: "大畜", desc: "积蓄巨大，德智充实。利涉大川，应天顺人。" },
    "100001": { name: "山雷颐", title: "颐", desc: "观颐，自求口实。慎言语，节饮食，养正。" },
    "011110": { name: "泽风大过", title: "大过", desc: "栋桡，本末俱弱。非常时期，当行非常之事。" },
    "010010": { name: "坎为水", title: "坎", desc: "重重险陷，进退两难。行险而有信，维心亨。" },
    "101101": { name: "离为火", title: "离", desc: "光明附丽，柔顺中正。利贞，亨。畜牝牛吉。" },
    "001110": { name: "泽山咸", title: "咸", desc: "感应相通，男女相悦。亨，利贞，取女吉。" },
    "011100": { name: "雷风恒", title: "恒", desc: "恒久不已，持之以恒。亨，无咎，利贞。" },
    "001111": { name: "天山遁", title: "遁", desc: "退避隐遁，远离小人。小利贞，明哲保身。" },
    "111100": { name: "雷天大壮", title: "大壮", desc: "雷在天上，刚壮有力。利贞，不可恃强妄为。" },
    "000101": { name: "火地晋", title: "晋", desc: "旭日东升，步步高升。康侯用锡马蕃庶，昼日三接。" },
    "101000": { name: "地火明夷", title: "明夷", desc: "光明受损，晦暗不明。利艰贞，韬光养晦。" },
    "101011": { name: "风火家人", title: "家人", desc: "入内理家，各正其位。利女贞。" },
    "110101": { name: "火泽睽", title: "睽", desc: "二女同居，其志不同。小事吉，大事难成。" },
    "001010": { name: "水山蹇", title: "蹇", desc: "前路险阻，寸步难行。利西南，不利东北，利见大人。" },
    "010100": { name: "雷水解", title: "解", desc: "险难化解，万物复苏。无所往，其来复吉。" },
    "110001": { name: "山泽损", title: "损", desc: "减损当前，以益未来。有孚，元吉，无咎。" },
    "100011": { name: "风雷益", title: "益", desc: "损上益下，大有裨益。利有攸往，利涉大川。" },
    "111110": { name: "泽天夬", title: "夬", desc: "决断清除，刚决柔也。扬于王庭，孚号有厉。" },
    "011111": { name: "天风姤", title: "姤", desc: "阴阳相遇，风云际会。女壮，勿用取女。" },
    "000110": { name: "泽地萃", title: "萃", desc: "群英荟萃，万物聚集。亨，王假有庙，利见大人。" },
    "011000": { name: "地风升", title: "升", desc: "积小成大，顺势上升。元亨，用见大人，勿恤。" },
    "010110": { name: "泽水困", title: "困", desc: "泽无水，困守愁城。亨，贞，大人吉，无咎。" },
    "011010": { name: "水风井", title: "井", desc: "养人而不穷，改邑不改井。往来井井，求贤若渴。" },
    "101110": { name: "泽火革", title: "革", desc: "顺天应人，变革更新。已日乃孚，元亨利贞，悔亡。" },
    "011101": { name: "火风鼎", title: "鼎", desc: "稳重图变，去旧取新。元吉，亨。" },
    "100100": { name: "震为雷", title: "震", desc: "震惊百里，临危不乱。亨，笑言哑哑，震惊百里，不丧匙鬯。" },
    "001001": { name: "艮为山", title: "艮", desc: "动静适时，该止则止。艮其背，不获其身，无咎。" },
    "001011": { name: "风山渐", title: "渐", desc: "循序渐进，积少成多。女归吉，利贞。" },
    "110100": { name: "雷泽归妹", title: "归妹", desc: "违背常理，动之不当。征凶，无攸利。" },
    "101100": { name: "雷火丰", title: "丰", desc: "丰大光明，如日中天。亨，王假之，勿忧，宜日中。" },
    "001101": { name: "火山旅", title: "旅", desc: "行旅在外，不安定之象。小亨，旅贞吉。" },
    "011011": { name: "巽为风", title: "巽", desc: "柔顺谦逊，无孔不入。小亨，利有攸往，利见大人。" },
    "110110": { name: "兑为泽", title: "兑", desc: "喜悦沟通，朋友讲习。亨，利贞。" },
    "010011": { name: "风水涣", title: "涣", desc: "冰雪消融，排难解纷。亨，王假有庙，利涉大川。" },
    "110010": { name: "水泽节", title: "节", desc: "节制有度，适可而止。亨，苦节不可贞。" },
    "110011": { name: "风泽中孚", title: "中孚", desc: "诚信立身，心诚则灵。豚鱼吉，利涉大川。" },
    "001100": { name: "雷山小过", title: "小过", desc: "小有过度，宜下不宜上。亨，利贞，可小事，不可大事。" },
    "101010": { name: "水火既济", title: "既济", desc: "万事已成，完美的结局。亨小，利贞，初吉终乱。" },
    "010101": { name: "火水未济", title: "未济", desc: "未完成，充满希望。亨，小狐汔济，濡其尾，无攸利。" }
};

// ... addXpWithCap, tossCoins 辅助函数保持不变 ...
async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;
  if (currentDailyXp >= 120) { await db.prepare('UPDATE users SET last_xp_date = ? WHERE id = ?').bind(today, userId).run(); return { added: 0, msg: '今日经验已满' }; }
  let actualAdd = amount;
  if (currentDailyXp + amount > 120) actualAdd = 120 - currentDailyXp;
  await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?').bind(actualAdd, currentDailyXp + actualAdd, today, userId).run();
  return { added: actualAdd, msg: `经验 +${actualAdd}` };
}

function tossCoins() {
    const sum = (Math.random()>0.5?3:2) + (Math.random()>0.5?3:2) + (Math.random()>0.5?3:2);
    return { val: sum, isYang: (sum % 2 !== 0) ? 1 : 0 };
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }));

  const now = Date.now();
  const utc8 = new Date(now + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  const requestBody = await context.request.json().catch(() => ({}));
  // 前端传入 action='check' 用于查询状态
  const isCheck = requestBody.action === 'check';

  // === 1. 检查今日是否已抽 (包含 Check 逻辑) ===
  if (user.last_draw === today) {
      // 核心修改：如果已抽，不报错，而是返回存储的卦象
      const savedCode = user.daily_hexagram_code;
      if (savedCode && HEXAGRAMS[savedCode]) {
          // 把 code 字符串 "101010" 转回数组 [1,0,1,0,1,0]
          const lines = savedCode.split('').map(Number);
          
          return new Response(JSON.stringify({ 
              success: true, 
              played: true, // 标记已玩过
              lines: lines,
              result: HEXAGRAMS[savedCode],
              message: "今日卦象已定，宜顺势而为。"
          }));
      }
  }

  // 如果只是 check 状态，且没抽过，则返回未抽
  if (isCheck) {
      return new Response(JSON.stringify({ success: true, played: false }));
  }

  // === 2. 执行新抽奖 ===
  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '封禁中' }));

  let binaryCode = "";
  let lines = [];
  for (let i = 0; i < 6; i++) {
      const toss = tossCoins();
      binaryCode += toss.isYang; 
      lines.push(toss.isYang);   
  }

  const hexagram = HEXAGRAMS[binaryCode] || { name: "数据溢出", title: "??", desc: "矩阵波动。" };
  const xpResult = await addXpWithCap(db, user.id, 50, today);
  const coinReward = Math.floor(Math.random() * 20) + 10;

  // 存入 daily_hexagram_code
  await db.batch([
      db.prepare('UPDATE users SET last_draw = ?, daily_hexagram_code = ?, coins = coins + ? WHERE id = ?')
        .bind(today, binaryCode, coinReward, user.id)
  ]);

  return new Response(JSON.stringify({ 
      success: true, 
      played: false, // 标记这是新抽的
      lines: lines,
      result: hexagram,
      message: `卦象已成。(${xpResult.msg}, i币 +${coinReward})`
  }));
}
