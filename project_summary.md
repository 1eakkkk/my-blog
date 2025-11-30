
Project Summary: 1eak.cool (Cyberpunk Social Platform)
1) 项目总览

这是一个基于 Cloudflare 全家桶（Pages, D1, R2）构建的赛博朋克风格社交社区平台。项目采用原生 HTML/JS/CSS 开发（无前端框架），是一个单页应用（SPA），具备发帖、评论、实时私信、好友系统、积分商城、任务系统、VIP 会员及完整的后台管理功能。

2) 技术栈

前端 Core: 原生 JavaScript (ES6+), HTML5, CSS3 (CSS Variables, Flexbox/Grid).

前端库: Marked.js (Markdown渲染), DOMPurify (XSS防护), Cloudflare Turnstile (人机验证).

后端 (Serverless): Cloudflare Pages Functions (运行在 Edge 上的 Node.js 环境).

数据库: Cloudflare D1 (SQLite).

对象存储: Cloudflare R2 (存储图片/视频).

鉴权方式: 自研 Cookie Session 机制 + SHA-256 密码哈希.

3) 项目目录结构
code
Text
download
content_copy
expand_less
/
├── login.html              # 登录/注册/重置密码入口页面
├── index.html              # 主应用入口 (SPA容器, 包含侧边栏和所有视图模板)
├── style.css               # 全局样式, 包含赛博朋克主题、动画、响应式布局
├── script.js               # 核心前端逻辑 (路由、API请求、DOM操作、全局状态管理)
└── functions/api/          # 后端 API 目录 (Cloudflare Functions)
    ├── _middleware.js      # 全局中间件 (IP限流 Rate Limiting)
    ├── admin.js            # 管理员综合接口 (统计, 封禁, 公告, 邀请码等)
    ├── block.js            # 黑名单管理
    ├── checkin.js          # 每日签到逻辑
    ├── comments.js         # 评论 CRUD (支持置顶、回复)
    ├── draw.js             # 幸运抽奖
    ├── feedback.js         # 用户反馈系统
    ├── follow.js           # 关注/取关逻辑
    ├── force_fix.js        # 管理员紧急修复工具
    ├── friends.js          # 好友申请与管理
    ├── inventory.js        # 背包系统 (获取、装备道具)
    ├── leaderboard.js      # 排行榜数据 (XP, 财富, 获赞)
    ├── like.js             # 点赞逻辑 (帖子/评论)
    ├── messages.js         # 私信系统
    ├── notifications.js    # 通知系统
    ├── posts.js            # 帖子 CRUD (置顶、搜索、排序)
    ├── profile.js          # 个人资料修改 (改名、签名、偏好)
    ├── profile_public.js   # 公开用户信息查询
    ├── random_avatar.js    # 随机像素头像生成
    ├── shop.js             # 商城购买逻辑 (VIP, 道具)
    ├── tasks.js            # 任务系统 (生成、领取奖励)
    ├── tip.js              # 打赏转账逻辑
    ├── upload.js           # R2 文件上传接口
    ├── user.js             # 当前用户 Session 校验
    ├── vip.js              # VIP 购买接口
    └── auth/
        ├── login.js        # 登录验证
        ├── logout.js       # 登出
        ├── register.js     # 注册 (含邀请码校验)
        └── reset.js        # 密码重置
4) 功能模块摘要

login.html: 处理用户认证流程，包含 Turnstile 验证码，注册成功后展示恢复密钥。

script.js: 巨型控制器。负责路由监听 (hashchange)、UI 渲染、API 调用封装、WebSocket 模拟（轮询）、状态管理。

style.css: 定义了核心视觉风格（黑/蓝/紫配色），包含复杂的 CSS 动画（背景流动、光效），适配移动端。

admin.js: 超级权限接口，允许管理员管理用户资金、封禁、发布全局公告、生成邀请码。

posts.js/comments.js: 核心社区互动逻辑，支持 Markdown，支持消耗道具（如置顶卡）。

shop.js/inventory.js: 经济系统闭环，用户消费 i币购买道具（背景、气泡、特效），并进行装备。

tasks.js/checkin.js: 用户留存系统，通过每日任务和签到发放 XP 和 i币。

5) 数据库结构 (推断)

基于 SQL 查询推断的主要表结构：

users: id, username, password (hash), nickname, coins, xp, role (user/admin), is_vip, avatar_url, recovery_key, name_color, equipped_bg 等。

sessions: session_id, user_id, created_at。

posts: id, user_id, title, content, category, is_pinned (置顶), like_count。

comments: id, post_id, user_id, content, parent_id (嵌套回复), is_pinned。

user_items: id, user_id, item_id (道具ID), quantity, is_equipped, expires_at (时效性)。

user_tasks: id, user_id, task_code, progress, status (0:进行中, 2:已领), period_key (日期标识)。

messages: id, sender_id, receiver_id, content, is_read。

notifications: id, user_id, type (reply/like/system), message, is_read。

follows / friends / blocks: 社交关系表。

invites: 邀请码管理。

6) 全局逻辑流

初始化: index.html 加载 -> script.js 执行 checkSecurity() -> 调用 /api/user 验证 Session。若未登录跳转 login.html。

路由: 采用 Hash 路由（如 #home, #post?id=1）。handleRoute() 函数监听 hash 变化，隐藏所有 .view-section，只显示目标视图。

数据流: 前端 fetch -> Cloudflare Worker (functions/api/*) -> D1 Database -> JSON 响应 -> 前端 DOM 更新。

交互: 多数操作（点赞、发帖、购买）为异步请求，前端使用 showToast() 反馈结果，并局部刷新数据（如 loadPosts(true)）。

实时性: 聊天和通知通过前端 setInterval 轮询 (chatPollInterval) 实现准实时更新。

7) 编码风格总结 (重要)

命名规范:

JS 变量/函数: camelCase (e.g., loadPosts, currentUser, isEditingPost).

API 字段/数据库: snake_case (e.g., user_id, is_pinned, created_at).

CSS 类名: kebab-case (e.g., post-card, cyber-btn, msg-bubble).

代码结构习惯:

JS (Frontend): 全局函数模式。核心逻辑直接挂载在 window 对象上（为了 HTML 中的 onclick 调用）。大量使用 document.createElement 和 Template Strings (`...`) 拼接 HTML。

JS (Backend): 导出 onRequest, onRequestPost 等标准 Handler。先鉴权（Cookie 解析），再执行 SQL，最后返回 new Response。

注释风格:

关键逻辑块上方有简短中文注释 (e.g., // === 1. 验证 Turnstile ===).

文件头部通常标记文件名。

前端写法模式:

无构建工具: 直接引用 CDN 库，不使用 Webpack/Vite。

DOM 操作: 偏向于直接操作 ID (getElementById) 和 innerHTML 重绘。

状态管理: 使用全局变量 (currentUser, currentPostId) 和 localStorage (草稿、已读记录)。

后端写法模式:

SQL 优先: 逻辑重度依赖 SQL 语句（JOINs, Subqueries）。

事务处理: 涉及资金/物品变动时使用 db.batch() 保证原子性。

错误处理: 返回 JSON { success: false, error: "..." }，前端通过 showToast 展示。

UI/CSS 风格:

Cyberpunk: 大量使用霓虹色 (#0070f3, #ff00de, #0f0), 黑色背景, 发光效果 (box-shadow), 玻璃拟态 (backdrop-filter).

响应式: 使用 @media (max-width: 768px) 适配移动端，侧边栏在移动端变为抽屉式。

8) 修改规则 (开发规范)

保持单文件结构: 前端逻辑尽量保持在 script.js 中，除非特别庞大，不要轻易拆分模块（因为没有构建步骤）。

样式一致性: 新增 UI 必须复用 glass-card, cyber-btn, tech-table 等现有 CSS 类，保持赛博朋克风格。

数据库安全: 后端所有涉及 ID 操作的 SQL 必须校验 user_id，防止越权操作（Admin 除外）。

接口兼容: API 返回必须包含 { success: boolean }，错误信息字段为 error，成功提示为 message。

不引入复杂框架: 继续保持 Vanilla JS + HTML 写法，禁止引入 React/Vue 等需要编译的框架。

SQL 参数化: 必须使用 db.prepare('...').bind(...)，严禁字符串拼接 SQL 以防注入。

9) 版本快照 (v8.1)

当前状态: 功能完备的社区。

已实现: 登录注册(含邀请码)、发帖(Markdown/图片/视频)、评论(嵌套/置顶)、点赞、私信(支持气泡样式)、商城(VIP/特效)、背包、签到、任务系统、黑名单、后台管理(封禁/发钱/全局通知)。

已知特性:

首页下拉加载更多。

图片上传至 R2 并自动压缩。

移动端适配了底部快捷发帖按钮和侧边栏手势。

包含一个由 CSS 驱动的动态背景系统（矩阵、星空、火焰等）。

10) 未来使用方法

Prompt 示例:

"基于 Project Summary，请在 inventory.js 和 shop.js 中添加一种新的道具类型 'badge_border'（头像框）。需要在数据库添加字段，并在前端 script.js 的 renderUserAvatar 函数中应用该样式。请保持现有的代码风格。"

AI 行为准则:

读取本 Summary 理解项目架构。

输出代码时，明确指出是修改哪个文件（e.g., --- functions/api/shop.js ---）。

保持 SQL 写法和前端 DOM 拼接风格一致。

优先考虑不破坏现有功能的增量修改。

