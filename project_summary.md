# Project Summary: 1eak.cool

## 1) 项目总览

基于 Cloudflare 全家桶（Pages + D1 + R2 + KV）构建的轻量级私人论坛。原生 HTML/JS/CSS 开发，无前端框架，SPA 架构。私人小站，供自己和好友使用。

**当前版本**：v2.6.0（2026-06-02）

## 2) 技术栈

- **前端**：原生 JavaScript (ES6+)、HTML5、CSS3
- **前端库**：Marked.js（Markdown）、DOMPurify（XSS 防护）、Cloudflare Turnstile（人机验证）
- **后端**：Cloudflare Pages Functions（Edge 运行时）
- **数据库**：Cloudflare D1（SQLite）
- **对象存储**：Cloudflare R2（图片/视频，域名 img.1eak.cool）
- **KV**：限流计数（绑定变量名 `KV`，namespace `RATE_LIMIT`）
- **鉴权**：Cookie Session + PBKDF2（salt:hash 格式，100000次迭代）

## 3) 目录结构

```text
/
├── login.html
├── index.html
├── style.css
├── script.js
└── functions/api/
    ├── _middleware.js
    ├── admin.js
    ├── comments.js
    ├── config.js
    ├── heartbeat.js
    ├── like.js
    ├── posts.js
    ├── profile.js
    ├── random_avatar.js
    ├── upload.js
    ├── user.js
    ├── user-public.js
    └── auth/
        ├── login.js
        ├── logout.js
        └── register.js
```

## 4) 功能模块

**帖子（posts.js）**
- CRUD，分类（灌水/技术/生活/提问/公告）
- 心情标签：mood 字段（TEXT，DEFAULT NULL），7种可选，存储格式如 "😊 开心"
- 阅读时间：前端 estimateReadTime(content) 计算，300字/分钟，显示在 card-meta 和 article-meta
- 排序：latest / hot / comments
- 搜索：标题 + 内容 + 分类 + 评论内容全文搜索
- 管理员置顶，定时置顶到期自动解除

**评论（comments.js）**
- 楼中楼（parent_id 二级，不支持三级嵌套）
- 前端分组渲染：子评论紧跟父评论，不按时间混排
- 根评论显示楼层号 #N，子评论显示缩进 + 回复标签
- 字数限制：500字（前后端双重校验）
- 删除：普通用户删自己的评论时级联删除子评论
- 管理员可置顶评论（每帖只能有一条置顶）

**用户（auth/、user.js、profile.js）**
- 注册：用户名 2-20 字符，白名单 `[\u4e00-\u9fa5a-zA-Z0-9_-]`
- 密码：PBKDF2-SHA256，旧 SHA-256 格式登录时自动升级
- 登录失败锁定：5次失败后锁定 15 分钟
- Session：7天有效期，user.js 请求时异步清理过期记录
- 个人资料：昵称（限12字）、签名（限50字）、头像（R2）

**上传（upload.js）**
- 最大 50MB
- MIME 白名单：jpeg/png/gif/webp/svg/mp4/webm/pdf
- 扩展名白名单：双重校验防伪造
- 返回 Markdown 格式插入文本（图片/视频/文件自动区分）

**限流（_middleware.js）**
- 仅限制 POST/PUT/DELETE
- KV 实现：key = `rate:{ip}`，60s TTL 自动过期，上限 180次/分钟
- KV 异常时放行，不影响正常请求

**管理（admin.js）**
- 统计：在线用户（5分钟内）、今日活跃（24小时）、总用户/帖子/评论数、有效会话
- 反爬：Turnstile 状态、登录失败计数、锁定账号列表
- 列表：用户列表、帖子列表、最近评论、在线列表
- 操作：发布公告、动态开关 Turnstile、清理 7 天前过期 session
- 权限校验：所有接口均验证 `role === 'admin'`

## 5) 数据库结构（D1）

**users**
```sql
id, username, password(salt:hash), nickname, bio, avatar_url, avatar_variant,
role, status, ban_expires_at, ban_reason,
login_fails, login_locked_until,
xp, level, is_vip, badge_preference, equipped_post_style,
name_color, custom_title, custom_title_color,
created_at, last_seen
```

**sessions**
```sql
session_id, user_id, created_at
```

**posts**
```sql
id, user_id, author_name, title, content, category, mood,
like_count, is_pinned, pinned_until, updated_at, created_at
```

**comments**
```sql
id, post_id, user_id, content, parent_id, reply_to_uid,
like_count, is_pinned, created_at
```

**likes**
```sql
id, user_id, target_id, target_type(post|comment), created_at
```

**system_settings**
```sql
key, value
-- 当前已知 key: turnstile_enabled
```

## 6) 前端架构（script.js）

**路由**：基于 `window.location.hash` 的客户端路由，`handleRoute()` 统一处理视图切换。

**视图列表**：
- `#home` — 帖子列表（含搜索、分类、排序、滚动位置恢复）
- `#post?id=N` — 帖子详情 + 评论区
- `#write` — 发帖（Markdown 实时预览、草稿状态）
- `#profile?u=username` — 个人主页
- `#settings` — 个人设置
- `#about` — 关于 + Markdown 指南 + 更新日志
- `#admin` — 站点控制台（仅 admin 角色可见）

**关键函数**：
- `loadPosts(reset)` — 帖子列表加载，支持翻页、搜索、筛选
- `loadSinglePost(id)` — 帖子详情加载
- `loadComments(postId, reset)` — 评论加载，前端分组渲染
- `createCommentElement(c, isReply, postAuthorId, floorNumber)` — 评论渲染
- `prepareReply(commentId, authorName)` — 激活回复模式（显示提示条）
- `cancelReply()` — 退出回复模式
- `submitComment()` — 提交评论（含前端字数校验）
- `estimateReadTime(content)` — 阅读时间估算
- `addCopyButtons(container)` — 为容器内所有 pre 块添加复制按钮

**滚动位置恢复**：`sessionStorage.homeScrollY`，进入帖子详情时保存，返回首页时恢复。

## 7) 编码规范

- SQL 全部参数化，禁止模板字符串拼接
- 多步写操作用 `db.batch()` 或顺序 await（D1 的 batch 不是原子事务）
- 后台任务用 `context.waitUntil()` 异步执行
- API 统一返回 `{ success: true/false, error?: "..." }`
- Cookie：`Secure; HttpOnly; SameSite=None; Max-Age=604800`，设置和清除属性必须对称
- 前端所有异步操作必须有 `showToast` 反馈

## 8) 环境变量 / 绑定

| 类型 | 绑定名 | 说明 |
|---|---|---|
| D1 | `DB` | 主数据库 |
| R2 | `MY_BUCKET` | 文件存储 |
| KV | `KV` | 限流计数（RATE_LIMIT namespace） |
| Secret | `TURNSTILE_SECRET` | Cloudflare Turnstile 验证密钥 |
