// --- functions/api/node.js ---

// === 1. 稀有度配置 (颜色与动画时间) ===
const RARITY_CONFIG = {
    'white':  { color: '#a0a0a0', spin: 1100, name: '破损' }, // 1.1s
    'green':  { color: '#55ff55', spin: 1100, name: '普通' }, // 1.1s
    'blue':   { color: '#00ccff', spin: 1600, name: '稀有' }, // 1.6s
    'purple': { color: '#d000ff', spin: 2400, name: '史诗' }, // 2.4s
    'gold':   { color: '#ffd700', spin: 3600, name: '传说' }, // 3.6s
    'red':    { color: '#ff3333', spin: 5500, name: '机密' }  // 5.5s
};

// === 2. 场次配置 (决定能抽到哪些稀有度) ===
const TIERS = {
    'basic': { name: '初级场', cost: 10,  pool: ['white', 'green', 'blue', 'purple', 'gold', 'red'] }, 
    'mid':   { name: '中级场', cost: 50,  pool: ['green', 'blue', 'purple', 'gold', 'red'] }, 
    'adv':   { name: '高级场', cost: 150, pool: ['blue', 'purple', 'gold', 'red'] } 
};

// === 3. 物品库 (LOOT TABLE) - 核心修改 ===
// 格式: { name, rarity, w:宽, h:高, weight:权重, val:[min, max] }
// val: 单格价值范围。如果是固定值，写 [13141314, 13141314]
const LOOT_TABLE = [
    // --- 🔴 红色 (机密) ---1-10
    { name: "海洋之泪", rarity: 'red', w: 1, h: 1, weight: 1, val: [26282628, 26282628] },
    { name: "非洲之星", rarity: 'red', w: 1, h: 1, weight: 2, val: [13141314, 13141314] }, // 极低概率，固定天价
    { name: "机密文件", rarity: 'red', w: 2, h: 1, weight: 3, val: [2000000, 3000000] },
    { name: "'理想国'试剂盒", rarity: 'red', w: 2, h: 3, weight: 5, val: [150000, 300000] },
    { name: "奥莉薇娅香槟", rarity: 'red', w: 1, h: 2, weight: 8, val: [45000, 50000] },
    { name: "“钻石”鱼子酱", rarity: 'red', w: 1, h: 1, weight: 10, val: [17560, 22380] },
    { name: "强力吸尘器", rarity: 'red', w: 2, h: 3, weight: 5, val: [18800, 23330] },
    { name: "曼德尔超算单元", rarity: 'red', w: 3, h: 3, weight: 6, val: [2026, 29029] },
    { name: "飞行记录仪", rarity: 'red', w: 3, h: 2, weight: 5, val: [16660, 26740] },
    { name: "军用无人机", rarity: 'red', w: 2, h: 2, weight: 6, val: [13330, 57880] },
    { name: "笔记本电脑", rarity: 'red', w: 3, h: 2, weight: 6, val: [15000, 40000] },
    { name: "复苏呼吸机", rarity: 'red', w: 3, h: 3, weight: 5, val: [28980, 48980] },
    { name: "自动体外除颤仪", rarity: 'red', w: 2, h: 3, weight: 7, val: [14710, 24260] },
    { name: "强化碳纤维板", rarity: 'red', w: 3, h: 3, weight: 6, val: [4680, 12345] },
    { name: "军用炮弹", rarity: 'red', w: 3, h: 2, weight: 8, val: [12480, 24180] },
    { name: "主战坦克模型", rarity: 'red', w: 3, h: 3, weight: 6, val: [10000, 21420] },
    { name: "步战车模型", rarity: 'red', w: 3, h: 2, weight: 7, val: [18080, 46980] },
    { name: "克劳狄乌斯半身像", rarity: 'red', w: 2, h: 3, weight: 7, val: [17680, 54390] },

    // --- 🟡 金色 (传说) ---11-66
    { name: "纯金手机", rarity: 'gold', w: 1, h: 1, weight: 36, val: [185, 255] },
    { name: "金手镯", rarity: 'gold', w: 1, h: 1, weight: 35, val: [188, 211] },
    { name: "金魔方", rarity: 'gold', w: 1, h: 1, weight: 38, val: [121, 158] },
    { name: "大疆action4", rarity: 'gold', w: 2, h: 1, weight: 36, val: [88, 160] },
    { name: "卫星电话", rarity: 'gold', w: 1, h: 2, weight: 45, val: [95, 110] },
    { name: "金条", rarity: 'gold', w: 1, h: 2, weight: 55, val: [88, 188] },
    { name: "三角洲特勤箱", rarity: 'gold', w: 3, h: 3, weight: 55, val: [33, 44] }, // 占地大，单格略低，总价高
    { name: "E型滤毒罐", rarity: 'gold', w: 1, h: 1, weight: 56, val: [122, 306] },
    { name: "体内除颤器", rarity: 'gold', w: 1, h: 1, weight: 58, val: [155, 233] },
    { name: "血氧仪", rarity: 'gold', w: 1, h: 1, weight: 63, val: [136, 279] },
    { name: "静脉定位器", rarity: 'gold', w: 1, h: 1, weight: 66, val: [121, 355] },
    { name: "镜头", rarity: 'gold', w: 1, h: 1, weight: 17, val: [171, 301] },
    { name: "高速固态硬盘", rarity: 'gold', w: 1, h: 1, weight: 57, val: [150, 234] },
    { name: "CPU", rarity: 'gold', w: 1, h: 1, weight: 64, val: [128, 368] },
    { name: "E型滤毒罐", rarity: 'gold', w: 1, h: 1, weight: 56, val: [122, 306] },
    { name: "可编程处理器", rarity: 'gold', w: 1, h: 1, weight: 47, val: [104, 337] },
    { name: "数码相机", rarity: 'gold', w: 1, h: 1, weight: 47, val: [140, 280] },
    { name: "军用网格模块", rarity: 'gold', w: 1, h: 1, weight: 63, val: [126, 285] },
    { name: "脑机控制端子", rarity: 'gold', w: 1, h: 1, weight: 56, val: [130, 235] },
    { name: "纯金打火机", rarity: 'gold', w: 1, h: 1, weight: 62, val: [124, 310] },
    { name: "咖啡", rarity: 'gold', w: 1, h: 1, weight: 66, val: [134, 309] },

    // --- 🟣 紫色 (史诗) ---67-120
    { name: "单兵外骨骼", rarity: 'purple', w: 2, h: 4, weight: 76, val: [15, 25] },
    { name: "黑客遗物", rarity: 'purple', w: 2, h: 2, weight: 80, val: [20, 35] },
    { name: "AI 逻辑回路", rarity: 'purple', w: 1, h: 3, weight: 70, val: [25, 45] },
    { name: "固态硬盘", rarity: 'purple', w: 1, h: 1, weight: 79, val: [96, 113] },
    { name: "内存条", rarity: 'purple', w: 1, h: 1, weight: 81, val: [81, 130] },
    { name: "GS5手柄", rarity: 'purple', w: 1, h: 1, weight: 87, val: [79, 124] },
    { name: "ASOS电脑主板", rarity: 'purple', w: 2, h: 2, weight: 119, val: [48, 61] },
    { name: "军用热像仪", rarity: 'purple', w: 2, h: 3, weight: 76, val: [41, 71] },
    { name: "广角镜头", rarity: 'purple', w: 2, h: 1, weight: 97, val: [56, 78] },
    { name: "专业声卡", rarity: 'purple', w: 2, h: 1, weight: 78, val: [39, 108] },
    { name: "HIFI声卡", rarity: 'purple', w: 2, h: 1, weight: 120, val: [54, 60] },
    { name: "收音机", rarity: 'purple', w: 2, h: 1, weight: 102, val: [48, 102] },
    { name: "间谍笔", rarity: 'purple', w: 1, h: 1, weight: 113, val: [64, 107] },
    { name: "电子干扰器", rarity: 'purple', w: 1, h: 1, weight: 120, val: [53, 122] },
    { name: "离心机", rarity: 'purple', w: 2, h: 2, weight: 116, val: [16, 61] },
    { name: "血压仪", rarity: 'purple', w: 2, h: 2, weight: 114, val: [35, 39] },
    { name: "人工膝关节", rarity: 'purple', w: 1, h: 2, weight: 102, val: [48, 55] },
    { name: "无菌敷料包", rarity: 'purple', w: 1, h: 2, weight: 72, val: [72, 110] },
    { name: "高出力粉碎钳", rarity: 'purple', w: 1, h: 2, weight: 75, val: [24, 101] },
    { name: "植物样本", rarity: 'purple', w: 1, h: 1, weight: 106, val: [91, 109] },
    { name: "特种钢", rarity: 'purple', w: 2, h: 1, weight: 73, val: [69, 87] },
    { name: "聚乙烯纤维", rarity: 'purple', w: 1, h: 1, weight: 81, val: [81, 121] },
    { name: "生津柠檬茶", rarity: 'purple', w: 1, h: 1, weight: 81, val: [61, 159] },
    { name: "清新橘味能量凝胶", rarity: 'purple', w: 1, h: 1, weight: 81, val: [65, 136] },
    { name: "胶囊咖啡机套组", rarity: 'purple', w: 2, h: 2, weight: 74, val: [34, 43] },
    { name: "后妃耳环", rarity: 'purple', w: 1, h: 1, weight: 99, val: [73, 87] },
    { name: "图腾箭矢", rarity: 'purple', w: 1, h: 1, weight: 98, val: [57, 131] },
    { name: "典雅咖啡杯", rarity: 'purple', w: 1, h: 1, weight: 97, val: [56, 133] },
    { name: "海盗弯刀", rarity: 'purple', w: 1, h: 1, weight: 80, val: [87, 121] },
    { name: "阿萨拉特色酒壶", rarity: 'purple', w: 1, h: 2, weight: 101, val: [42, 78] },
    { name: "犄角墙饰", rarity: 'purple', w: 2, h: 1, weight: 95, val: [55, 67] },
    { name: "仪典匕首", rarity: 'purple', w: 3, h: 2, weight: 78, val: [26, 46] },
    { name: "马赛克灯台", rarity: 'purple', w: 2, h: 3, weight: 91, val: [24, 54] },
    { name: "资料：军事情报", rarity: 'purple', w: 1, h: 1, weight: 92, val: [61, 126] },
    { name: "袖珍录像带", rarity: 'purple', w: 1, h: 1, weight: 95, val: [91, 95] },
    { name: "阿萨拉卫队机密档案", rarity: 'purple', w: 1, h: 2, weight: 97, val: [38, 54] },
    { name: "加密路由器", rarity: 'purple', w: 2, h: 2, weight: 96, val: [23, 36] },
    { name: "信号棒", rarity: 'purple', w: 1, h: 1, weight: 99, val: [78, 121] },
    { name: "便携生存套组", rarity: 'purple', w: 2, h: 1, weight: 102, val: [48, 88] },
    { name: "燃气喷灯", rarity: 'purple', w: 1, h: 2, weight: 113, val: [45, 92] },
    { name: "电动车电池", rarity: 'purple', w: 3, h: 2, weight: 78, val: [22, 39] },

    // --- 🔵 蓝色 (稀有) ---121-200
    { name: "服务器主板", rarity: 'blue', w: 2, h: 3, weight: 150, val: [11, 33] },
    { name: "高倍镜头", rarity: 'blue', w: 1, h: 2, weight: 180, val: [25, 35] },
    { name: "民用电池", rarity: 'blue', w: 2, h: 2, weight: 200, val: [28, 35] },
    { name: "音频播放器", rarity: 'blue', w: 1, h: 1, weight: 172, val: [54, 69] },
    { name: "存储卡", rarity: 'blue', w: 1, h: 1, weight: 179, val: [61, 79] },
    { name: "继电器", rarity: 'blue', w: 1, h: 1, weight: 152, val: [21, 76] },
    { name: "摄像头", rarity: 'blue', w: 1, h: 1, weight: 185, val: [42, 64] },
    { name: "军用移动电源", rarity: 'blue', w: 1, h: 1, weight: 122, val: [56, 61] },
    { name: "U盘", rarity: 'blue', w: 1, h: 1, weight: 131, val: [52, 64] },
    { name: "电子温度计", rarity: 'blue', w: 2, h: 2, weight: 188, val: [18, 24] },
    { name: "液晶显示屏", rarity: 'blue', w: 2, h: 2, weight: 124, val: [23, 27] },
    { name: "太阳能板", rarity: 'blue', w: 4, h: 2, weight: 132, val: [16, 21] },
    { name: "额温枪", rarity: 'blue', w: 1, h: 1, weight: 197, val: [60, 76] },
    { name: "医用酒精", rarity: 'blue', w: 1, h: 1, weight: 148, val: [50, 72] },
    { name: "听诊器", rarity: 'blue', w: 1, h: 2, weight: 178, val: [32, 45] },
    { name: "电子显微镜", rarity: 'blue', w: 1, h: 3, weight: 143, val: [26, 36] },
    { name: "骨锯", rarity: 'blue', w: 3, h: 1, weight: 126, val: [21, 37] },
    { name: "医疗无人机", rarity: 'blue', w: 2, h: 2, weight: 135, val: [20, 35] },
    { name: "转换插座", rarity: 'blue', w: 1, h: 1, weight: 152, val: [55, 78] },
    { name: "高精数显卡尺", rarity: 'blue', w: 1, h: 1, weight: 163, val: [33, 81] },
    { name: "枪械零件", rarity: 'blue', w: 2, h: 1, weight: 183, val: [18, 91] },
    { name: "火药", rarity: 'blue', w: 1, h: 2, weight: 125, val: [63, 72] },
    { name: "芳纶纤维", rarity: 'blue', w: 2, h: 1, weight: 125, val: [52, 78] },
    { name: "机械破障锤", rarity: 'blue', w: 2, h: 2, weight: 122, val: [21, 50] },
    { name: "一桶油漆", rarity: 'blue', w: 2, h: 2, weight: 125, val: [25, 40] },
    { name: "无线便携电钻", rarity: 'blue', w: 2, h: 1, weight: 132, val: [35, 70] },
    { name: "一包水泥", rarity: 'blue', w: 2, h: 3, weight: 152, val: [13, 25] },
    { name: "糖三角", rarity: 'blue', w: 1, h: 1, weight: 130, val: [65, 80] },
    { name: "香喷喷炒面", rarity: 'blue', w: 1, h: 1, weight: 188, val: [41, 82] },
    { name: "可乐", rarity: 'blue', w: 1, h: 1, weight: 137, val: [48, 74] },
    { name: "大豆蛋白粉包", rarity: 'blue', w: 1, h: 1, weight: 132, val: [32, 73] },
    { name: "英式袋泡茶", rarity: 'blue', w: 1, h: 1, weight: 143, val: [43, 78] },
    { name: "维生素泡腾片", rarity: 'blue', w: 1, h: 1, weight: 157, val: [52, 78] },
    { name: "军用罐头", rarity: 'blue', w: 1, h: 1, weight: 175, val: [38, 87] },
    { name: "木雕烟斗", rarity: 'blue', w: 2, h: 1, weight: 171, val: [36, 48] },
    { name: "摩卡咖啡壶", rarity: 'blue', w: 1, h: 2, weight: 172, val: [43, 44] },
    { name: "阿萨拉时尚周刊", rarity: 'blue', w: 2, h: 2, weight: 132, val: [23, 32] },
    { name: "古怪的海盗银币", rarity: 'blue', w: 1, h: 1, weight: 155, val: [66, 77] },
    { name: "腕带", rarity: 'blue', w: 1, h: 1, weight: 139, val: [51, 75] },
    { name: "‘起舞的女郎’挂饰", rarity: 'blue', w: 1, h: 2, weight: 164, val: [41, 46] },
    { name: "鸟雕", rarity: 'blue', w: 1, h: 1, weight: 196, val: [55, 72] },
    { name: "古老的海盗望远镜", rarity: 'blue', w: 1, h: 2, weight: 151, val: [34, 45] },
    { name: "初级子弹生产零件", rarity: 'blue', w: 1, h: 2, weight: 123, val: [46, 51] },
    { name: "资料：商业文件", rarity: 'blue', w: 1, h: 1, weight: 175, val: [61, 75] },
    { name: "情报文件", rarity: 'blue', w: 1, h: 2, weight: 166, val: [42, 62] },
    { name: "军情录音", rarity: 'blue', w: 1, h: 3, weight: 186, val: [36, 42] },
    { name: "多用途电池", rarity: 'blue', w: 1, h: 1, weight: 189, val: [49, 69] },
    { name: "狩猎火柴", rarity: 'blue', w: 1, h: 1, weight: 196, val: [48, 55] },
    { name: "低级燃料", rarity: 'blue', w: 1, h: 1, weight: 154, val: [36, 77] },
    { name: "燃气罐", rarity: 'blue', w: 2, h: 2, weight: 133, val: [23, 31] },
    { name: "轻型户外炉具", rarity: 'blue', w: 2, h: 2, weight: 141, val: [28, 36] },

    // --- 🟢 绿色 (普通) ---201-300
    { name: "实用玻璃钢门", rarity: 'green', w: 2, h: 3, weight: 230, val: [7, 12] }, 
    { name: "RX580显卡", rarity: 'green', w: 2, h: 1, weight: 250, val: [12, 21] },
    { name: "机械轴体", rarity: 'green', w: 1, h: 1, weight: 240, val: [21, 41] },
    { name: "圣诞节的苹果", rarity: 'green', w: 1, h: 1, weight: 250, val: [12, 25] },
    { name: "《龙族》全套", rarity: 'green', w: 2, h: 3, weight: 224, val: [7, 14] },
    { name: "手机电池", rarity: 'green', w: 1, h: 1, weight: 227, val: [22, 27] },
    { name: "印刷电路板", rarity: 'green', w: 1, h: 1, weight: 259, val: [25, 29] },
    { name: "机械硬盘", rarity: 'green', w: 1, h: 1, weight: 281, val: [28, 36] },
    { name: "电容", rarity: 'green', w: 1, h: 1, weight: 263, val: [26, 39] },
    { name: "超高频读卡器", rarity: 'green', w: 1, h: 1, weight: 243, val: [24, 37] },
    { name: "风冷散热", rarity: 'green', w: 1, h: 1, weight: 284, val: [28, 46] },
    { name: "键盘", rarity: 'green', w: 2, h: 1, weight: 296, val: [15, 29] },
    { name: "DVD光驱", rarity: 'green', w: 1, h: 1, weight: 238, val: [28, 61] },
    { name: "电源", rarity: 'green', w: 2, h: 2, weight: 204, val: [15, 25] },
    { name: "盐溶液", rarity: 'green', w: 1, h: 1, weight: 236, val: [23, 63] },
    { name: "手术镊子", rarity: 'green', w: 1, h: 1, weight: 244, val: [24, 48] },
    { name: "注射器", rarity: 'green', w: 1, h: 1, weight: 247, val: [24, 47] },
    { name: "小药瓶", rarity: 'green', w: 1, h: 1, weight: 271, val: [27, 48] },
    { name: "输液工具", rarity: 'green', w: 1, h: 1, weight: 274, val: [27, 46] },
    { name: "便携液压扳手", rarity: 'green', w: 1, h: 1, weight: 225, val: [22, 58] },
    { name: "波纹软管", rarity: 'green', w: 1, h: 1, weight: 237, val: [23, 38] },
    { name: "电线", rarity: 'green', w: 1, h: 1, weight: 237, val: [23, 39] },
    { name: "插座", rarity: 'green', w: 1, h: 1, weight: 217, val: [21, 37] },
    { name: "尖嘴钳", rarity: 'green', w: 1, h: 1, weight: 248, val: [24, 47] },
    { name: "模拟温度计", rarity: 'green', w: 1, h: 1, weight: 240, val: [24, 40] },
    { name: "电笔", rarity: 'green', w: 1, h: 1, weight: 237, val: [23, 47] },
    { name: "螺丝刀", rarity: 'green', w: 1, h: 1, weight: 286, val: [21, 43] },
    { name: "LED灯管", rarity: 'green', w: 2, h: 1, weight: 297, val: [16, 18] },
    { name: "喷漆", rarity: 'green', w: 1, h: 2, weight: 273, val: [14, 20] },
    { name: "角磨机", rarity: 'green', w: 2, h:2, weight: 207, val: [20, 26] },
    { name: "电动爆破锤", rarity: 'green', w: 2, h: 1, weight: 219, val: [21, 49] },
    { name: "原木木板", rarity: 'green', w: 2, h: 1, weight: 242, val: [21, 24] },
    { name: "压力计", rarity: 'green', w: 1, h: 2, weight: 212, val: [21, 26] },
    { name: "水平仪", rarity: 'green', w: 1, h: 2, weight: 223, val: [21, 36] },
    { name: "手锯", rarity: 'green', w: 3, h: 1, weight: 212, val: [12, 16] },
    { name: "石工锤", rarity: 'green', w: 3, h: 1, weight: 212, val: [12, 15] },
    { name: "纯净水", rarity: 'green', w: 1, h: 1, weight: 210, val: [21, 51] },
    { name: "无糖缓释能量棒", rarity: 'green', w: 1, h: 1, weight: 202, val: [20, 54] },
    { name: "电火机", rarity: 'green', w: 1, h: 1, weight: 234, val: [23, 34] },
    { name: "迷你氢电池", rarity: 'green', w: 1, h: 1, weight: 256, val: [25, 62] },
    { name: "强力胶", rarity: 'green', w: 1, h: 1, weight: 293, val: [29, 38] },
    { name: "当地再制咖啡", rarity: 'green', w: 1, h: 1, weight: 285, val: [28, 53] },
    { name: "野外能量棒", rarity: 'green', w: 1, h: 1, weight: 201, val: [30, 36] },
    { name: "酒店宣传海报", rarity: 'green', w: 2, h: 2, weight: 239, val: [16, 21] },
    { name: "阿萨拉娱乐月刊", rarity: 'green', w: 2, h: 2, weight: 205, val: [20, 25] },
    { name: "袋装咖啡豆", rarity: 'green', w: 1, h: 2, weight: 298, val: [22, 26] },
    { name: "阿萨拉新闻周刊", rarity: 'green', w: 2, h:2, weight: 218, val: [12, 19] },
    { name: "调料套组", rarity: 'green', w: 2, h: 2, weight: 235, val: [13, 25] },
    { name: "锈迹斑斑的海盗铜币", rarity: 'green', w: 1, h: 1, weight: 256, val: [25, 66] },
    { name: "残弹挂坠", rarity: 'green', w: 1, h: 1, weight: 264, val: [26, 45] },
    { name: "非洲木雕", rarity: 'green', w: 1, h: 2, weight: 243, val: [21, 31] },
    { name: "古老的斯芬克斯像", rarity: 'green', w: 2, h: 2, weight: 227, val: [14, 24] },
    { name: "太阳碟", rarity: 'green', w: 2, h: 2, weight: 223, val: [14, 17] },
    { name: "阿萨拉特色陶瓷", rarity: 'green', w: 2, h: 2, weight: 261, val: [15, 29] },
    { name: "建筑图纸1号", rarity: 'green', w: 2, h: 1, weight: 221, val: [15, 35] },
    { name: "建筑图纸2号", rarity: 'green', w: 2, h: 1, weight: 222, val: [15, 35] },
    { name: "建筑图纸3号", rarity: 'green', w: 2, h: 1, weight: 223, val: [15, 35] },
    { name: "建筑图纸4号", rarity: 'green', w: 2, h: 1, weight: 224, val: [15, 35] },
    { name: "建筑图纸5号", rarity: 'green', w: 2, h: 1, weight: 225, val: [15, 35] },
    { name: "建筑图纸6号", rarity: 'green', w: 2, h: 1, weight: 226, val: [15, 35] },
    { name: "个人信笺", rarity: 'green', w: 2, h: 1, weight: 228, val: [15, 35] },
    { name: "签章联运单", rarity: 'green', w: 2, h: 1, weight: 246, val: [23, 25] },
    { name: "私密笔记簿", rarity: 'green', w: 1, h: 2, weight: 223, val: [23, 26] },
    { name: "9V电池", rarity: 'green', w: 1, h: 1, weight: 201, val: [30, 36] },
    { name: "充电电池组", rarity: 'green', w: 1, h: 1, weight: 208, val: [39, 41] },

    // --- ⚪ 白色 (垃圾) ---300-500
    { name: "半瓶肥宅水", rarity: 'white', w: 1, h: 2, weight: 310, val: [6, 8] },
    { name: "鼠标", rarity: 'white', w: 1, h: 1, weight: 467, val: [9, 11] },
    { name: "一个陶瓷碗", rarity: 'white', w: 2, h: 2, weight: 320, val: [3, 5] },
    { name: "一包卫生纸", rarity: 'white', w: 1, h: 1, weight: 430, val: [5, 9] },
    { name: "手术剪刀", rarity: 'white', w: 1, h: 1, weight: 312, val: [7, 10] },
    { name: "外科手套", rarity: 'white', w: 1, h: 1, weight: 410, val: [11, 20] },
    { name: "样本试管", rarity: 'white', w: 1, h: 2, weight: 319, val: [9, 19] },
    { name: "含氟牙膏", rarity: 'white', w: 1, h: 2, weight: 422, val: [6, 14] },
    { name: "音波测距卷尺", rarity: 'white', w: 1, h: 1, weight: 310, val: [4, 10] },
    { name: "网线", rarity: 'white', w: 1, h: 1, weight: 310, val: [7, 10] },
    { name: "防水胶布", rarity: 'white', w: 1, h: 1, weight: 377, val: [10, 17] },
    { name: "精密工具组", rarity: 'white', w: 1, h: 1, weight: 386, val: [8, 16] },
    { name: "布基胶带", rarity: 'white', w: 1, h: 1, weight: 312, val: [7, 12] },
    { name: "油漆刷", rarity: 'white', w: 1, h: 1, weight: 313, val: [8, 13] },
    { name: "工具刀", rarity: 'white', w: 2, h: 1, weight: 322, val: [9, 11] },
    { name: "直角尺", rarity: 'white', w: 1, h: 2, weight: 425, val: [9, 15] },
    { name: "一盒钉子", rarity: 'white', w: 1, h: 1, weight: 394, val: [7, 19] },
    { name: "羊角锤", rarity: 'white', w: 1, h: 1, weight: 308, val: [8, 18] },
    { name: "扑克牌-A", rarity: 'white', w: 1, h: 1, weight: 301, val: [5, 15] },
    { name: "扑克牌-2", rarity: 'white', w: 1, h: 1, weight: 302, val: [5, 15] },
    { name: "扑克牌-3", rarity: 'white', w: 1, h: 1, weight: 303, val: [5, 15] },
    { name: "扑克牌-4", rarity: 'white', w: 1, h: 1, weight: 304, val: [5, 15] },
    { name: "扑克牌-5", rarity: 'white', w: 1, h: 1, weight: 305, val: [5, 15] },
    { name: "扑克牌-6", rarity: 'white', w: 1, h: 1, weight: 306, val: [5, 15] },
    { name: "扑克牌-7", rarity: 'white', w: 1, h: 1, weight: 307, val: [5, 15] },
    { name: "扑克牌-8", rarity: 'white', w: 1, h: 1, weight: 308, val: [5, 15] },
    { name: "扑克牌-9", rarity: 'white', w: 1, h: 1, weight: 309, val: [5, 15] },
    { name: "扑克牌-10", rarity: 'white', w: 1, h: 1, weight: 310, val: [5, 15] },
    { name: "扑克牌-J", rarity: 'white', w: 1, h: 1, weight: 311, val: [5, 15] },
    { name: "扑克牌-Q", rarity: 'white', w: 1, h: 1, weight: 312, val: [5, 15] },
    { name: "扑克牌-K", rarity: 'white', w: 1, h: 1, weight: 313, val: [5, 15] },
    { name: "扑克牌-Joker-Black", rarity: 'white', w: 1, h: 1, weight: 300, val: [11, 33] },
    { name: "扑克牌-Joker-Red", rarity: 'white', w: 1, h: 1, weight: 300, val: [22, 44] },
    { name: "火柴", rarity: 'white', w: 1, h: 1, weight: 369, val: [10, 19] },
    { name: "胡椒瓶", rarity: 'white', w: 1, h: 1, weight: 377, val: [7, 17] },
    { name: "资料残页", rarity: 'white', w: 1, h: 1, weight: 390, val: [9, 14] },
    { name: "物流信息单", rarity: 'white', w: 1, h: 1, weight: 339, val: [10, 19] },
    { name: "当地小报", rarity: 'white', w: 2, h: 1, weight: 319, val: [5, 9] },
    { name: "人像照片（全家福）", rarity: 'white', w: 2, h: 1, weight: 303, val: [4, 12] },
    { name: "军情照片", rarity: 'white', w: 2, h: 1, weight: 321, val: [5, 13] },
    { name: "盒装蜡烛", rarity: 'white', w: 2, h: 2, weight: 360, val: [5, 8] },
    { name: "废纸板", rarity: 'white', w: 2, h: 2, weight: 430, val: [4, 8] },
    { name: "一包火鸡面", rarity: 'white', w: 1, h: 1, weight: 490, val: [2, 20] },
    { name: "一瓶酸奶", rarity: 'white', w: 1, h: 1, weight: 320, val: [5, 12] },
    { name: "损坏的硬盘", rarity: 'white', w: 1, h: 1, weight: 450, val: [5, 17] }
];

// 辅助：获取随机整数
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const body = await request.json();
    const tierKey = body.tier || 'basic';
    const config = TIERS[tierKey];

    if (!config) return Response.json({ error: '无效场次' });
    if (user.coins < config.cost) return Response.json({ error: `i币不足 (需 ${config.cost})` });

    // === 2. 核心算法：基于权重的抽取 ===
    
    // 2.1 筛选：根据场次允许的稀有度，从总表中筛选物品
    const validItems = LOOT_TABLE.filter(item => config.pool.includes(item.rarity));
    
    if (validItems.length === 0) {
        return Response.json({ error: '配置错误：该场次无掉落' });
    }

    // 2.2 计算总权重
    let totalWeight = 0;
    validItems.forEach(item => totalWeight += item.weight);

    // 2.3 随机抽取
    let randomVal = Math.random() * totalWeight;
    let selectedItem = validItems[0];

    for (const item of validItems) {
        randomVal -= item.weight;
        if (randomVal <= 0) {
            selectedItem = item;
            break;
        }
    }

    // === 3. 计算价值与形状 ===
    let width = selectedItem.w;
    let height = selectedItem.h;

    // 50% 概率旋转形状 (如果非正方形)
    if (width !== height && Math.random() < 0.5) {
        [width, height] = [height, width];
    }

    const totalGrids = width * height;
    // 单格价值
    const valPerGrid = getRandomInt(selectedItem.val[0], selectedItem.val[1]);
    // 总价值
    const totalValue = valPerGrid * totalGrids;

    // === 4. 核心修改：入库逻辑 ===
    const now = Date.now();
    const updates = [];

    // 1. 扣除门票费 (只扣钱，不加钱)
    updates.push(db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(config.cost, user.id));

    // 2. 物品存入背包 (新增逻辑)
    // 注意：摸金物品通常不可堆叠(因为价值不同)，所以每次都 INSERT 新记录
    // category='loot' 用于区分是摸金物品还是商城道具
    const icon = selectedItem.icon || '📦'; 
    updates.push(db.prepare(`
        INSERT INTO user_items (user_id, item_id, category, quantity, val, rarity, width, height, created_at) 
        VALUES (?, ?, 'loot', 1, ?, ?, ?, ?, ?)
    `).bind(user.id, selectedItem.name, totalValue, selectedItem.rarity, width, height, now));

    // 3. 红光全服广播 (保持不变)
    if (selectedItem.rarity === 'red') {
        const msg = `🔥 [传说出货] ${user.nickname||user.username} 在【${config.name}】摸出了 <span style="color:#ff3333;font-weight:bold;">[${selectedItem.name}]</span> (估值 ${totalValue.toLocaleString()} i)!`;
        updates.push(db.prepare("INSERT INTO broadcasts (user_id, nickname, tier, content, style_color, status, start_time, end_time, created_at) VALUES (?, ?, 'high', ?, 'rainbow', 'active', ?, ?, ?)")
            .bind(user.id, 'SYSTEM', msg, now, now + 21600000, now));
    }

    await db.batch(updates);

    return Response.json({
        success: true,
        result: {
            name: selectedItem.name,
            rarity: selectedItem.rarity,
            color: RARITY_CONFIG[selectedItem.rarity].color,
            width: width,
            height: height,
            total_value: totalValue,
            spin_time: RARITY_CONFIG[selectedItem.rarity].spin
        },
        // 注意：这里不再返回 new_balance，因为钱扣掉了，物品进包了
        message: "物品已存入背包"
    });
}
