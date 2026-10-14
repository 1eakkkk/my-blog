# AI 日记 P0 · 独立链路实验

**状态：已首次部署独立实验服务；P0 总验收仍为 UNVERIFIED。** 本实验只验证 ChatGPT 定时任务调用远程 MCP、OAuth 持续授权和安全写入的可行性。ChatGPT 连接正在配置，尚未确认完成；真实定时验收尚未完成。当前网站版本仍为 v2.8.1；本目录不接入现有网站的生产发布、数据库或账号。

## 范围与隔离

- 只使用明确标记为 `synthetic` 的虚构素材与测试日记，不采集、上传或发布真实 ChatGPT / Codex 聊天、聊天导出或本机历史文件。
- 使用独立 Cloudflare Worker、独立 D1、独立 KV，资源名称、ID 与远程地址须逐项核对。不得绑定生产 Pages、现有 D1 / KV / R2，也不得复用生产登录凭据。
- 所有写入由服务端固定到实验测试作者；测试作者标识及 ID 由实验配置、迁移确定，不接受调用方指定生产作者。
- P0 不开发真实聊天采集、历史补齐、生产日记页面或 P1–P4 功能。未来 P1–P4 的内容范围锁定为**摘要**，不发布原文聊天、工具日志或推理记录。

## MCP 与授权约定

ChatGPT 中已创建的插件名为 **AI 日记 P0（隔离测试）**，实际连接尚未完成。原定时任务保持未修改，原提示词与设置已有仓库外备份。实验 MCP 只暴露两个工具：

| 工具 | 用途 |
| --- | --- |
| `get_diary_source_packet` | 读取指定日期的 synthetic 素材包及来源状态；来源失败必须明确返回失败，不能伪装成空内容。 |
| `publish_diary` | 写入 synthetic 日记摘要；校验日期、素材状态、固定测试作者和重复写入保护。 |

首次连接使用**有效期 10 分钟、只能消费一次**的授权票据。票据用于实验 MCP 授权，不是 OpenAI 登录凭据；不得写入仓库、截图、任务提示词或报告。OAuth access token 有效期为 **5 分钟**；refresh token **闲置 30 天过期**，成功刷新时轮换。旧 refresh token 重放、授权撤销及撤销后的刷新或工具调用均须有独立验证证据。

持续刷新须明确授权 `offline_access`；用户未授权该权限时不提供持续刷新。授权失败诊断仅保留固定阶段、允许的错误码及 HTTP 状态，排除凭据和原始请求细节；诊断可用不代表连接成功。

未授权、过期、篡改或已撤销请求应拒绝；异常推送的目标、方式与脱敏内容须在验收记录中明确。报告只记录请求关联标识、结果和时间，不记录原始票据、token 或真实聊天。

## 既有 ChatGPT 定时任务

沿用既有任务 **`6acdfb952ee08191b12eaf699e9323f0`**，标题“每日对话旁观者日记”，目标时间为每天 **00:00，`Asia/Singapore`**，处理刚结束的前一自然日。日期范围采用当地当天零点至次日零点的半开区间，不能用任务创建时间或文件修改时间代替消息所属日期。原界面显示“每天 0:00”；时区没有独立可见字段，仍需核实。

原提示词与设置已保存在负责人根工作区、仓库外受保护的 `outputs/ai-diary-p0/task-original.json`，原任务截图为同目录的 `task-original.jpg`；不在仓库复制私人提示词。修改时仍须保护其他可见配置，并保存后核对同一 ID；不得用新建任务替代原任务。首次授权和任务配置是否完成，以[验收清单](docs/验收清单.md)中的实际证据为准。可复用正文见[真实任务 P0 测试提示词](docs/真实任务P0测试提示词.md)，取证与恢复见[验证证据与恢复说明](docs/真实任务验证证据与恢复.md)。

本地测试、普通 HTTP 请求、手动 MCP 调用、点击“立即运行”，都不能证明 ChatGPT 的真实午夜定时执行已通过。电脑离线时能否执行远程 MCP，也必须由真实定时运行记录证明，不能仅依据 Worker 可访问而推断。

## 日期占用与后续补发

P0 验证同一日期的防重与**物理删除后永久占用**：重复调用返回既有回执，不重复发布；人工修改展示正文后，重试仍使用来源包的 `previousContent` 与同一 manifest。物理删除不会释放 registry 日期登记。P0 不实现软回收站；未来 P1–P4 的软回收与恢复也应沿用原记录，不通过重新发布绕过占用。

`SKIPPED_EMPTY` 只用于来源成功且确认没有素材的日期。该状态可在 **7 天内**因迟到素材进行补发，并需明确记录补发时间与原日期；它不是已发布日记删除后的重发通道。`SOURCE_FAILED` 表示来源失败，必须保留失败、重试和异常通知，**不能空跳过**。真实空来源状态和晚到素材补发留到 P1–P4；本 P0 使用固定、非空的虚构样本，并验证来源失败不会被当作成功。

## 命令与部署记录

使用 Node.js 24，从本实验目录操作，不使用网站根目录的生产部署流程。`operations.mjs` 固定读取本目录 `wrangler.jsonc`，并通过本地 Wrangler 执行；管理命令默认 `--local`，远程需明确加 `--remote`，占位资源 ID 会拒绝远程操作。先核对独立实验资源，再迁移和部署。

```sh
npm install
npm test
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local
node node_modules/wrangler/bin/wrangler.js dev --local --var PUBLIC_ORIGIN:http://127.0.0.1:8787
```

本地 Worker 保持运行后，在另一个终端执行：

```sh
node tools/operations.mjs issue-ticket
node tools/operations.mjs report --out <新的报告目录>
node tools/local-smoke.mjs
```

`wrangler.jsonc` 当前默认 `PUBLIC_ORIGIN` 是独立远程 Worker 地址；本地开发必须添加上面的 `--var PUBLIC_ORIGIN:http://127.0.0.1:8787`，不能把远程 origin 用于本地 OAuth。远程迁移与部署由实验负责人执行。当前 `npm run migrate` 使用 `--remote`，不要把它当成本地迁移；`npm run deploy` 也是远程部署。管理操作如下：

```sh
node tools/operations.mjs issue-ticket --remote
node tools/operations.mjs report --remote --out <新的报告目录>
node tools/operations.mjs revoke-all --remote
node tools/operations.mjs revoke --remote --grant-id <实验grantId>
node tools/operations.mjs edit-test --post-id <测试日记ID> --content-file <synthetic文本文件>
node tools/operations.mjs delete-test --post-id <测试日记ID>
node tools/operations.mjs help
```

票据文件保存在被 Git 忽略的 `.secrets/ticket.txt`，创建权限为 `0600`；再次签发会替换本地文件，旧票据仍按原期限过期。命令只输出文件路径与过期时间，管理员在授权表单中使用，不要贴入聊天或日志。Windows 需另外限制 `.secrets` 目录 ACL。撤销命令在内存中签发单次操作票据，向配置中的 `/operator/revoke` 提交，不跟随重定向；服务端通过官方 OAuth provider 撤销，不直接删 KV。管理路由尚未部署时命令会失败，不能视为已撤销。

`local-smoke.mjs` 只连接 `http://127.0.0.1:8787`，需先迁移并启动本地 Worker；启动时还须仅在本地提供 `OAUTH_ALLOW_LOCAL_DCR=true` 与 `OAUTH_REDIRECT_URIS=["http://127.0.0.1:8978/callback"]`。这些本地测试设置在远程环境会被拒绝。测试会创建、编辑并物理删除虚构文章，同时保留日期登记；再次运行使用过去七日中尚未占用的日期，不清空登记。它验证本地真实 Worker/MCP/OAuth 链路，并不证明 ChatGPT 定时可用。

`edit-test` 只更新 `probe_diaries.content`，`delete-test` 只物理删除匹配的固定作者测试记录；两者核对 `ai_diary_registry` 保持不变，不输出正文。报告只查询日期登记、来源清单和事件的允许元数据，排除日记正文、源素材与 token；本地 / 远程观察分别标为 `LOCAL` / `REMOTE`，真实任务验收保持 `UNVERIFIED`。`oauth_refresh_token` 的 `validated_exchange` 只证明已校验交换，需与相同 request ID 的 `token_response_success` 配对才能观察到服务端成功返回，仍不能代替真实定时运行证据。

2026-10-14（`Asia/Singapore`）部署记录如下。首次版本用于留痕，**不是当前版本**；当前版本为 `fba419d6-ed08-4d4f-a024-2a88832c0979`，已替代 `ace1f99c-90e7-4533-be82-04a711477905`，包含 `offline_access` 未授权时的刷新保护与不含凭据的授权失败诊断。代码提交仍待补录；远程 ChatGPT 连接与真实定时验收尚未完成。

| 部署字段 | 值 |
| --- | --- |
| Worker 名称 / URL / MCP 地址 | `my-blog-diary-p0`；[Worker](https://my-blog-diary-p0.zhou17749984708.workers.dev)；[MCP](https://my-blog-diary-p0.zhou17749984708.workers.dev/mcp) |
| 独立 D1 名称 / ID | `my-blog-diary-p0` / `da72d1a2-9a81-4c8c-98c5-1b82ad30a9ac` |
| 独立 KV 名称 / ID | `my-blog-diary-p0-OAUTH_KV` / `2e3231a294d944cba76bddb738018ce8` |
| 固定测试作者 / 逻辑标识 | `AI 日记（隔离测试）` / `ai-diary-p0`；频道 `diary-p0` |
| 首次 Worker 部署版本 | `520bb1ed-f8c2-475c-ba86-7425fed09f9d`；2026-10-14（Asia/Singapore）；非最终候选 |
| 当前 Worker 部署版本 | `fba419d6-ed08-4d4f-a024-2a88832c0979`；2026-10-14（Asia/Singapore） |
| 代码提交 | 待补录 |
| ChatGPT 实际连接 / 原任务 | 插件已创建，连接未完成；原任务未修改；UNVERIFIED |
| 异常推送目标 / 方式 | 任务 UI 仅见推送 / 邮件；真实送达与仅异常策略仍 UNVERIFIED，可能受平台限制 |
| 原任务设置备份位置 | 负责人根工作区、仓库外受保护的 `outputs/ai-diary-p0/task-original.json` 与 `task-original.jpg` |
| 验收报告 | [2026-10-14 阶段报告](docs/P0验证报告-2026-10-14.md)；真实运行证据仍待取得 |

| 已完成的局部验证 | 结果 | 范围 |
| --- | --- | --- |
| 本地测试 | PASS，63/63 | LOCAL；auth 26、service 20、metadata 6、operations 11；包含 OAuth 工具 metadata 实际 wire 验证及最新授权保护 |
| 已记录的本地 Worker / MCP / OAuth smoke | PASS，9/9 | LOCAL；此前运行记录，不代替当前远程连接或真实计划触发 |

以上结果由实验负责人在 2026-10-14 提供，详细脱敏运行证据待补链。不能把本地 PASS 或首次远程部署改写为“ChatGPT 定时已通过”。任务通知界面目前只见推送 / 邮件，未见“仅异常”选项；静默提示词不能证明成功通知已被抑制，也不修改全局通知。

### 当前连接观察（尚未完成）

| 观察范围 | 实际结果 | 判断边界 |
| --- | --- | --- |
| 远程 CIMD 授权 GET | 返回 400；D1 诊断为 `stage=parse_request`、`code=metadata_resolution_failed`、`metadataHttpStatus=403` | Worker 解析客户端元数据失败，尚未完成授权 |
| 同一公开 CIMD 文档的访问 | 本机公开访问返回 200，Workers fetch 到 ChatGPT 返回 403 | 两个网络执行环境结果不同，不能据本机 200 声称 Worker 可访问 |
| 浏览器打开 Workers origin | `ERR_BLOCKED_BY_CLIENT` | 是独立的客户端现象；已有 AdGuard / 图片权限日志，但尚未证明具体阻止来源，更不能用它解释服务端的 403 |
| 官方连接 UI 的 DCR 选项 | 正在尝试，结果待核实 | 权限范围保持不变，不放宽后端授权策略；不计为连接通过 |

远程服务已部署、本地检查已通过与真实连接未完成是三个不同状态。报告和连接证据仍不完整，真实两午夜、电脑离线、过期自动刷新、异常推送继续为 `UNVERIFIED`。

## P0 完成条件

先通过本地、隔离环境与安全检查，再观察既有 ChatGPT 任务的**连续两个真实午夜**运行；其中至少一次午夜让电脑离线，并记录离线区间、运行结果及后续恢复情况。必须同时核对 token 过期后的轮换刷新、授权撤销、失败通知、重复与删除后的日期保护。缺任一真实证据时，P0 总状态仍为 `UNVERIFIED`，不得写成“ChatGPT 定时已通过”。

逐项状态与证据见[独立验收清单](docs/验收清单.md)。
