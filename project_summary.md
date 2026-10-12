# Project Summary: 1eak.cool

**当前版本**：v2.8.0（2026-10-12）

原生 HTML/CSS/JavaScript SPA，Cloudflare Pages Functions + D1 + R2 + KV，站点供本人和好友登录后使用。GitHub main 自动触发 Pages 部署，当前开发目录名称保留 my-blog-v2.6.2。

## 文件与职责

- index.html / style.css / script.js：导航、路由、帖子、评论、编辑器、个人主页、设置、后台、灯箱与 TOC。
- blog-utils.js：UTC+8 时间、有序列表续号、安全 URL、转义高亮、首页筛选 URL。
- draft-store.js / draft-ui.js：按用户 ID 使用 IndexedDB 事务存储本机草稿，显式保存失败、刷新恢复、版本冲突检查、手动旧稿导入和 Markdown 导出。
- privacy-ui.js / privacy.css：管理员邀请码面板、精确旧媒体域映射。login.html 支持邀请码及暂停注册状态。
- recovery-ui.js / recovery.css：设置页回收站、权限提示、恢复及帖子 Markdown 导出。
- community-ui.js / community.css：回复我的、成功定位后已读、可暂停轮询、账号回访紧凑首页。
- assets/vendor：本地固定 Marked 11.1.1、DOMPurify 3.4.16、许可证与 SHA-256，保持字节不变。
- migrations：001_registration_invites、002_recycle、003_reply_inbox，新增结构可重复执行。
- tools：Node24 SQLite 功能/安全回归、发布检查、完整 D1/R2 备份和独立恢复校验。

## 后端约定

DB 绑定 D1；MY_BUCKET 绑定私有 R2；KV 为尽力而为的分组限流；TURNSTILE_SECRET 用于服务端 hostname 校验。Cookie session_id 通过 DB 校验七天过期与封禁，PBKDF2-SHA256 100000 次，保留旧 SHA-256 升级和旧长密码登录。内容 GET/HEAD 同样要求登录，写入校验 Origin/Fetch Metadata 和内容类型；JSON 流体积 256KiB，multipart 51MiB，上传文件50MiB。

用户输入使用绑定参数，动态表名仅来自代码固定白名单。D1 db.batch 是事务，任一语句失败回滚全部，顺序 await 本身不是事务。API 响应 no-store、nosniff、禁止嵌入，Markdown 标签/属性白名单净化。

- posts.js / _search.js：作者完整分页、日期统计/UTC+8范围、组合搜索/分类/排序，字面 LIKE 与附近正文/评论摘录，绑定参数每批不超100。
- comments.js：按主讨论分页，每个讨论首批20回复，独立加载更多；稳定时间/ID排序、置顶归属、locate_id 深定位。回复必须同帖且父级可见。
- _recycle.js / recycle.js：新增 content_recycle 删除记录，保留原 posts/comments/likes；active_posts / active_comments 视图统一可见性。恢复按原删除ID比较，防止撤销并发新删除；普通用户不能恢复管理员删除。
- invites.js / _privacy.js / auth/register.js：新版 registration_invites 仅持久化 SHA-256 摘要，单次消费和新用户 INSERT 用同一事务，防止并发使用及重复用户名损失邀请码。默认 invite，可管理员 closed，已有账号保留。
- upload.js / media/[key].js / profile.js：新上传严格 MIME+扩展名+实际签名，禁止 SVG/HTML。返回同源媒体地址；读取鉴权、流式视频 Range、HEAD/条件请求、PDF附件。历史 MOV/ICO/HEIF 和安全单文件旧名称只兼容读取。旧 img URL 渲染时映射，关闭 R2 custom domain/r2.dev 后完成私有边界。
- notifications.js：新 notification_reads 回执表，现存可见评论动态推导接收人，不复用旧 notifications。主评论提醒帖主，回复提醒 reply_to_uid，排除本人；启用前评论默认已读。
- admin.js / user-public.js / like.js：统计/内容查询及变更目标采用可见视图，回收内容不继续参与正常列表、搜索、计数、提醒或写入。

## 状态与界面

首页路由 #home?search=…&category=…&sort=…&date=… 可刷新/前进后退/详情返回。个人主页按作者分页覆盖全部旧帖，日历空日期禁用。日期统一 UTC+8，数据库服务器 Unix 毫秒不批量偏移。

评论路由 #post?id=…&commentId=… 直接加载目标讨论和回复页；评论成功显示且仍在当前路由后才写已读。旧请求以代次/当前帖子检查隔离。

草稿按用户 ID 在 blog-drafts-v3/accounts 的事务中保存；超十篇不自动丢弃，存储损坏/配额/其他标签页冲突均明确失败且保留当前内容。无归属旧数据不自动迁移，手动导入不删除原数据。草稿仅本机保存；云同步不在当前版本。

暖纸/暖石墨主题，原创星形字标、衬线标题、系统正文，主断点1180/900/600/360px；新增UI须检查320、390、平板、900临界、桌面、深浅主题、键盘、焦点、减少动态效果。只缩放灯箱图片，正常网页保留浏览器缩放。

## 发布与备份

先完整备份与独立恢复校验，再按001→002→003执行增量迁移，最后部署代码并核对版本/私有API/所有历史媒体。数据库含其它应用和早期遗留表，禁止重建、清空或复用它们。

备份通过 Wrangler 或 D1 REST 导出完整SQL和R2字节/原key/元数据，SHA-256清单及远端二次核对，失败保留INCOMPLETE。verify-backup 向新SQLite和媒体目录恢复，完整性/外键/哈希检查，清除恢复库旧session，不动线上数据。灾难恢复用新的D1与私有桶，核对后切换绑定。不要把凭据或私有备份提交仓库。

本地检查：所有根目录和functions JavaScript语法、node --test tools/*.test.mjs、node tools/check-release.mjs、Wrangler Pages Functions 编译、浏览器功能与视觉验证。README记录使用、迁移、维护、限制和版本历史。KV不是严格原子限流；静态CSP因现有内联事件保留unsafe-inline；文件签名校验不代替病毒扫描。
