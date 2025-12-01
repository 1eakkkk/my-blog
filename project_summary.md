好的，根据您提供的最新修改内容（N.O.D.E 控制台、数据格斗场、全服播报、系统配置开关及相关 Bug 修复），我已经更新了项目摘要文档。

以下是更新后的完整 **Project Summary**：

---

# Project Summary: 1eak.cool (Cyberpunk Social Platform)

## 1) 项目总览
这是一个基于 Cloudflare 全家桶（Pages, D1, R2）构建的赛博朋克风格社交社区平台。项目采用原生 HTML/JS/CSS 开发（无前端框架），是一个单页应用（SPA），具备发帖、评论、实时私信、好友系统、积分商城、任务系统、VIP 会员、**随机探索（节点系统）**、**PVP博弈（数据格斗）**、**全服广播**及完整的后台管理功能。

## 2) 技术栈
*   **前端 Core**: 原生 JavaScript (ES6+), HTML5, CSS3 (CSS Variables, Flexbox/Grid, Animations).
*   **前端库**: `Marked.js` (Markdown渲染), `DOMPurify` (XSS防护), `Cloudflare Turnstile` (人机验证).
*   **后端 (Serverless)**: Cloudflare Pages Functions (运行在 Edge 上的 Node.js 环境).
*   **数据库**: Cloudflare D1 (SQLite).
*   **对象存储**: Cloudflare R2 (存储图片/视频).
*   **鉴权方式**: 自研 Cookie Session 机制 + SHA-256 密码哈希.

## 3) 项目目录结构
```text
/
├── login.html              # 登录/注册/重置密码入口页面 (含 Turnstile 动态开关)
├── index.html              # 主应用入口 (SPA容器, 包含侧边栏、HUD遮罩、所有视图模板)
├── style.css               # 全局样式, 含赛博朋克主题、流光动画、移动端适配媒体查询
├── script.js               # 核心前端逻辑 (路由、API封装、DOM操作、游戏逻辑、动画控制)
└── functions/api/          # 后端 API 目录 (Cloudflare Functions)
    ├── _middleware.js      # 全局中间件 (IP限流 Rate Limiting)
    ├── admin.js            # 管理员接口 (统计, 封禁, 公告, 邀请码, 播报审核, 开关配置)
    ├── block.js            # 黑名单管理
    ├── broadcast.js        # [新增] 全服播报系统 (申请、获取生效列表)
    ├── checkin.js          # 每日签到逻辑
    ├── comments.js         # 评论 CRUD (支持置顶、回复)
    ├── config.js           # [新增] 公开系统配置 (如 Turnstile 开关)
    ├── draw.js             # 幸运抽奖
    ├── duel.js             # [新增] 数据格斗场 (PVP创建、加入、结算、回放)
    ├── feedback.js         # 用户反馈系统
    ├── follow.js           # 关注/取关逻辑
    ├── force_fix.js        # 管理员紧急修复工具
    ├── friends.js          # 好友申请与管理
    ├── inventory.js        # 背包系统 (获取、装备、使用消耗品)
    ├── leaderboard.js      # 排行榜数据
    ├── like.js             # 点赞逻辑
    ├── messages.js         # 私信系统
    ├── node.js             # [新增] N.O.D.E 控制台 (随机事件探索、全服日志)
    ├── notifications.js    # 通知系统
    ├── posts.js            # 帖子 CRUD
    ├── profile.js          # 个人资料修改
    ├── profile_public.js   # 公开用户信息查询
    ├── random_avatar.js    # 随机像素头像生成
    ├── shop.js             # 商城购买逻辑 (VIP, 道具, 播报卡)
    ├── tasks.js            # 任务系统
    ├── tip.js              # 打赏转账逻辑
    ├── upload.js           # R2 文件上传接口
    ├── user.js             # 当前用户 Session 校验
    ├── vip.js              # VIP 购买接口
    └── auth/
        ├── login.js        # 登录验证
        ├── logout.js       # 登出
        ├── register.js     # 注册
        └── reset.js        # 密码重置
```

## 4) 功能模块摘要
*   **script.js**: 巨型控制器。新增了 `exploreNode` (节点探索)、`loadDuels/watchReplay` (格斗与回放动画)、`checkBroadcasts` (全服HUD广播) 等游戏化逻辑。
*   **node.js**: 处理“N.O.D.E 控制台”的随机事件（60+种事件，含稀有度分级）、概率计算及全服稀有掉落日志。
*   **duel.js**: 处理“数据格斗场”的下注、石头剪刀布胜负判定、每日限制及历史回放数据查询。
*   **broadcast.js**: 处理全服播报卡的购买消耗、内容提交及有效期管理。
*   **config.js**: 提供前端可见的系统开关配置（如是否开启人机验证）。
*   **style.css**: 新增了“虚空全息”风格界面、粒子对撞动画、全屏 HUD 广播特效及移动端深度适配。

## 5) 数据库结构 (推断)
基于 SQL 查询推断的主要表结构：
*   **users**: `id`, `username`, `password`, `nickname`, `coins`, `xp`, `role`, `is_vip`, `last_node_explore_date` (节点探索CD) 等。
*   **user_items**: 背包表，新增支持 `consumable` 类型道具的使用逻辑。
*   **duels**: [新增] `id`, `creator_id`, `bet_amount`, `creator_move`, `challenger_id`, `challenger_move`, `winner_id`, `status`, `created_at`。
*   **user_daily_limits**: [新增] `user_id`, `date_key`, `duel_count` (防止赌博上瘾)。
*   **broadcasts**: [新增] `id`, `user_id`, `tier` (high/low), `content`, `style_color`, `status` (pending/active), `end_time`。
*   **node_public_logs**: [新增] `username`, `event_type`, `message` (用于记录传说级事件跑马灯)。
*   **system_settings**: [新增] Key-Value 表，用于存储全局开关（如 `turnstile_enabled`）。

## 6) 全局逻辑流
1.  **节点探索**: 用户点击探索 -> 后端计算概率（含保底/故障/传说掉落） -> 返回结果与稀有度 -> 前端播放震屏/光效并实时更新余额。
2.  **PVP格斗**: 用户 A 发起悬赏（扣除 i 币） -> 用户 B 接受挑战（扣除 i 币） -> 后端计算胜负 -> 前端通过 `id="duel-overlay"` 播放全屏对撞动画 -> 资金划转。
3.  **全服广播**: 用户使用道具提交内容 -> 管理员后台审核通过 -> 所有在线用户通过轮询 (`checkBroadcasts`) 获取生效列表 -> 屏幕出现全息 HUD 弹窗。
4.  **安全配置**: 登录页加载时请求 `/api/config`，根据后端返回决定是否显示和校验 Cloudflare Turnstile。

## 7) 编码风格总结 (重要)
*   **命名规范**: JS 变量 `camelCase`，数据库字段 `snake_case`。
*   **前端交互**: 
    *   复杂动画（如格斗回放、HUD）使用全屏 `div` 遮罩 + CSS 动画类切换（`.add('scanning')`）。
    *   移动端适配优先使用 Flex 布局调整方向（`flex-direction: column`）而非简单的缩放。
    *   数据加载完成后，通过 DOM 操作直接更新 UI（如金币跳动），减少页面刷新。
*   **后端逻辑**: 
    *   关键交易逻辑（如 PVP 结算、道具消耗）必须使用 `db.batch()` 事务。
    *   必须校验 `creator_id` 与 `session.user_id` 确保操作权限。
    *   API 返回结构统一为 `{ success: true, data... }` 或 `{ success: false, error: "..." }`。

## 8) 修改规则 (开发规范)
1.  **HTML 结构**: 严禁在 `index.html` 中保留重复的 ID 元素（如 `duel-overlay`），这会导致 JS 选择器失效。
2.  **Z-Index 管理**: 全屏遮罩层（如回放、广播 HUD）的 `z-index` 必须设置为极大值（如 `2147483647`），并使用 `!important` 防止被背景特效覆盖。
3.  **移动端适配**: 新增复杂界面时，必须在 `style.css` 底部添加 `@media (max-width: 768px)` 块，调整布局（如将横排按钮改为竖排）。
4.  **防刷逻辑**: 涉及 i 币交易的功能，必须在后端校验余额、每日次数限制，并防止自己与自己交互。

## 9) 版本快照 (v8.8)
*   **当前状态**: 拥有丰富娱乐功能的赛博朋克社区。
*   **新增特性**:
    *   **N.O.D.E 控制台**: 60+ 随机事件，含 VIP 掉落和全服跑马灯。
    *   **数据格斗场**: 石头剪刀布博弈，全屏粒子对撞动画，支持历史回放。
    *   **全服播报**: 高级/低级广播卡，全息 HUD 视觉通知，含管理员审核流。
    *   **系统开关**: 支持动态关闭人机验证。
*   **UI/UX 改进**: “虚空全息”视觉风格，移动端操作体验优化。

## 10) 未来使用方法
**Prompt 示例**:
> "基于 Project Summary，请为‘数据格斗场’增加一个‘连胜榜’功能。需要在 `leaderboard.js` 中增加查询逻辑，统计 `duels` 表中连胜次数最多的用户，并在前端排行榜页面展示。"

**AI 行为准则**:
1.  读取本 Summary 理解数据库表结构（特别是 `duels` 表）。
2.  明确修改文件：`functions/api/leaderboard.js` 和 `script.js`。
3.  保持 SQL 写法一致，使用 `db.prepare`。
4.  遵循现有的 CSS 风格（霓虹色、玻璃拟态）。
