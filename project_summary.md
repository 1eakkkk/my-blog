好的，根据您最近对 **家园系统 (Data Cabin)**、**打工系统 (Work Station)**、**商城优化 (预览/批量购买)** 以及 **N.O.D.E 快速检索** 的一系列重大更新，我为您重新生成了最新的项目摘要。

这份文档反映了 v8.15 版本的完整状态。

---

# Project Summary: 1eak.cool (Cyberpunk Social Platform)

## 1) 项目总览
这是一个基于 Cloudflare 全家桶（Pages, D1, R2）构建的赛博朋克风格社交社区平台。项目采用原生 HTML/JS/CSS 开发（无前端框架），是一个单页应用（SPA）。
**核心特色**：在原有的社交（发帖/私信）与博弈（格斗/探索）基础上，新增了**养成与挂机生态**（家园种植、打工终端），构建了完整的“产出-消耗-博弈”经济闭环。

## 2) 技术栈
*   **前端 Core**: 原生 JavaScript (ES6+), HTML5, CSS3 (CSS Variables, Flexbox/Grid, Animations).
*   **前端资源**: SVG 图标 (Feather风格), 外部 R2 图片资源 (用于种子/道具图标).
*   **后端 (Serverless)**: Cloudflare Pages Functions (Node.js edge runtime).
*   **数据库**: Cloudflare D1 (SQLite).
*   **对象存储**: Cloudflare R2 (存储用户上传及游戏素材).
*   **鉴权方式**: 自研 Cookie Session 机制 + SHA-256 密码哈希.

## 3) 项目目录结构 (更新)
```text
/
├── login.html              # 登录/注册入口
├── index.html              # SPA容器 (新增 #view-home 视图, 侧边栏按钮组调整)
├── style.css               # 全局样式 (新增 .home-slot, .preview-stage, 移动端深度适配)
├── script.js               # 前端控制器 (新增 loadHomeSystem, multiExploreNode, previewItem)
└── functions/api/          # 后端 API 目录
    ├── _middleware.js      # 全局中间件
    ├── admin.js            # 管理员接口 (修复充值审核, 增加全服福利)
    ├── broadcast.js        # 全服播报逻辑
    ├── duel.js             # 数据格斗场
    ├── home.js             # [新增] 家园与打工核心逻辑 (种植, 收获, 掉落, 挂机)
    ├── inventory.js        # 背包系统
    ├── node.js             # [更新] N.O.D.E (移除任务, 新增5连抽 multi_explore)
    ├── shop.js             # [更新] 商城 (支持批量购买, 种子配置)
    ├── tip.js              # [修复] 打赏同时更新排行榜统计
    ├── user.js             # 用户状态
    └── ... (其他基础功能文件: posts, comments, likes, etc.)
```

## 4) 功能模块摘要 (更新)
*   **home.js (New)**: 
    *   **种植系统**: 处理 4 个地块 (`home_items`) 的种子种植、生长倒计时。
    *   **收获逻辑**: 校验成熟时间，发放 i币/XP，并判定**稀有掉落**（加速算法碎片，概率 15%）。
    *   **打工系统**: 处理 `start_work`, `claim_work`，支持多种工种（数据清理、黑盒调试等）的挂机收益。
*   **shop.js**: 
    *   支持 `quantity` 参数实现**批量购买**消耗品（如种子）。
    *   集成了 VIP、装饰品、时效道具、种子的统一购买接口。
*   **node.js**: 
    *   新增 `multi_explore` 动作，支持 **5连抽快速检索**（一次扣除 250 i币，批量生成结果）。
    *   移除了旧版无效的 `mission` 事件类型，优化了稀有度概率。
*   **script.js**: 
    *   新增 **商城预览 (Preview)** 功能，支持查看装饰品效果。
    *   新增 **侧边栏自定义排序**，支持拖拽或点击调整菜单顺序。
    *   集成了 R2 图片链接，替代原有的 Emoji 图标。

## 5) 数据库结构 (D1 Schema)
*   **users**: 基础用户信息，余额，经验，VIP 等。
*   **user_items**: 背包表，存储种子、碎片、卡片等。
*   **home_items** (New): `user_id`, `slot_index` (0-3), `item_id`, `type` ('plant'), `created_at`, `harvest_at`。
*   **user_works** (New): `user_id`, `work_type`, `start_time`, `end_time`, `status`。
*   **duels**: PVP 对局记录。
*   **broadcasts**: 全服播报记录。
*   **system_settings**: 全局开关配置。

## 6) 全局经济逻辑流
1.  **稳定产出 (家园/打工)**: 用户购买种子 -> 种植(4-24h) -> 收获 i币/XP (+稀有碎片)。用户挂机打工 -> 获得固定低保收益。
2.  **高风险博弈 (Node/Duel)**: 
    *   **Node**: 单抽(50i) 或 5连抽(250i) -> 随机获取高额 i币、VIP、道具或扣费故障。
    *   **Duel**: 玩家间 PVP 猜拳，胜者拿走奖池。
3.  **消费回收 (商城)**: 购买种子(循环消耗)、购买 VIP(特权)、购买高价装饰/特效(炫耀)。

## 7) 编码与 UI 规范
*   **视觉风格**: 
    *   **赛博青 (#00f3ff)**: 用于家园、数据、构建类元素。
    *   **霓虹紫 (#bd00ff)**: 用于 5连抽、抽奖、史诗级物品。
    *   **UI 组件**: 统一使用胶囊圆角按钮 (`border-radius: 30px`) 和 玻璃拟态卡片 (`glass-card`)。
*   **交互规范**:
    *   **预览**: 装饰品必须提供预览弹窗。
    *   **批量**: 消耗品购买必须弹窗询问数量。
    *   **反馈**: 所有异步操作必须有 `showToast` 反馈，长耗时操作（如 5连抽）需有终端打印特效。
*   **移动端适配**:
    *   家园地块采用 `2x2` 网格布局。
    *   商城 Tab 栏支持横向滑动。
    *   聊天框强制全屏 Flex 布局，防止键盘遮挡。

## 8) 修改规则 (注意事项)
1.  **图片资源**: 商城和背包的 `icon` 字段现在支持 HTML 字符串 (`<img src="...">`)，修改物品时需保持 `object-fit: contain` 样式。
2.  **数据库约束**: 插入 `home_items` 时必须显式指定 `type='plant'`，防止 `NOT NULL` 报错。
3.  **前后端同步**: 修改打工或种子配置时，必须**同时修改** `script.js` (展示用) 和 `home.js` (计算用) 中的常量配置。

## 9) 版本快照 (v8.15)
*   **当前状态**: 拥有“家园养成”与“PVP博弈”双核心的完整社区。
*   **最新特性**:
    *   **数据家园**: 4格田字格种植，可视化的 R2 图片素材，成熟发光特效。
    *   **任务终端**: 多档位挂机打工，倒计时进度条。
    *   **快速检索**: N.O.D.E 控制台支持一键 5 连抽，爽快感倍增。
    *   **侧边栏升级**: 签到/抽奖置顶，支持用户自定义菜单排序。
    *   **商城进化**: 支持物品效果预览，支持消耗品批量购买。

---
*End of Summary*
