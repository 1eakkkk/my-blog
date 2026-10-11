# 本地固定的前端依赖

这些文件随站点发布，页面不再从公共 CDN 动态执行 Markdown 依赖。

| 文件 | 版本 | 来源 | SHA-256 |
|---|---|---|---|
| `purify.min.js` | DOMPurify 3.4.16 | https://raw.githubusercontent.com/cure53/DOMPurify/3.4.16/dist/purify.min.js | `2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2` |
| `marked.js` | Marked 11.1.1 | https://cdnjs.cloudflare.com/ajax/libs/marked/11.1.1/marked.min.js | `f33a2d78362bde001670e3a29b01fd0dc16a7f9194d042a775af89270ab38b74` |

许可证分别保存在 `DOMPurify-LICENSE` 和 `Marked-LICENSE.md`。DOMPurify 使用维护者发布的固定版本；Markdown 解析后还必须经过严格配置的净化，Marked 自身不提供 HTML 安全过滤。

升级时同时更新文件、版本、许可证及校验值，并运行 Markdown/XSS 与浏览器回归检查。检查维护者的 [安全公告](https://github.com/cure53/DOMPurify/security/advisories) 和 [发布记录](https://github.com/cure53/DOMPurify/releases)。
