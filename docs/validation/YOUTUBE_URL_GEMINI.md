# YouTube URL 非流式 Gemini 验证

验证时间：2026-09-29 UTC。此记录对应用户要求：先实测非流式，再把 Worker 改为直接 YouTube URL、一次 Gemini 调用。模型为 `gemini-3.5-flash-lite`，沿用现有 Free tier 配置；未更换凭据。

## 升级前 Lightsail 容器的 API 探测

固定 IP 为 `174.129.205.232`。通过 SSH 把独立 CLI 脚本送入正在运行的容器执行；没有替换容器、修改服务器代码或正式分享。两次均使用非流式 `generateContent`。

| 视频 | 参数 | 结果 | 耗时 | 输入 / 输出 token | 缓存输入 |
| --- | --- | --- | --- | --- | --- |
| Claude.ai，`0vZ_UVLhSQQ` | timeout 600 秒、默认采样 | HTTP 200，完整英文概述和要点 | 约 2.48 秒 | 29,083 / 177 | 响应未提供 |
| Andrew Ng / LangGraph，`58n-n-3oRic`，约 110 分钟 | timeout 600 秒、fps 0.1 | HTTP 200，完整英文概述和要点 | 约 11.45 秒 | 209,179 / 196 | 197,026 |

这项升级前探测证明该服务器环境能够直接提交 YouTube URL，无需音轨下载出口；当时未部署新 Worker。长视频响应包含大量缓存输入，不能把快速结果当作冷缓存耗时。后续实际部署及真实队列验收见下方。

## 本地新版 Worker 的真实隔离测试

运行 `scripts/validate-youtube-worker.ts`：由 `TEST_DATABASE_URL` 创建一次性库，执行全部迁移、YouTube 元数据 API、真实 Gemini 非流式请求和最终落库。队列中生成真实 job，再直接调用 Worker 共用的 `processContentJob`；本测试不证明生产 pg-boss 常驻进程已领取该任务。

短视频 `0vZ_UVLhSQQ` 首次测试成功：`ready`，25,276 ms，HTTP 200；一次 `video_summary`，输入 29,162、输出 174 token，单单位预留。英文概述介绍 Claude 作为协作伙伴、提示词、上下文及模型定制。

最初两次 Worker 测试把报告写入 Playwright 的 `test-results`；浏览器测试启动清理该目录，短视频已输出成功摘要但报告丢失，长视频在保存阶段收到 ENOENT，无法据此确定其模型结果。诊断脚本现已改到独立且 Git 忽略的 `.local/validation/youtube-worker`。修正后长视频验收成功，证据见下表。

修正后 `58n-n-3oRic` 完整 Worker 结果：

| 字段 | 结果 |
| --- | --- |
| 状态 | ready，HTTP 200，26,756 ms |
| 模型调用 | 1 次 `video_summary`，succeeded |
| token | 输入 209,258、输出 152 |
| 额度 | 1 个 reservation，units=1，consumed |
| 摘要版本 | youtube-url-en-v1 |
| 内容 | LangGraph/Tavily 代理、循环图、状态持久化和人工介入；英文概述及要点 |
| 本地证据 | `.local/validation/youtube-worker/58n-n-3oRic-1790650871436/result.json`（不提交私有运行记录） |

## 自动验证与迁移

- 67 项单元测试通过；包括规范 URL、非流式端点、长/未知时长 0.1 fps、600 秒请求期限、输出和缓存用量校验、无隐式重试。更新价格版本后相关 14 项再次通过。
- 16 项 PostgreSQL 集成测试通过；验证单调用/单单位、缓存估算、不可访问但已知用量、未知结果不重放、额度恢复、租约保护、元数据维护、来源标注、空库及旧库迁移。历史音频摘要和两次调用/两单位记录在升级测试中原样保留。
- lint、类型检查、Web/Worker 完整构建、客户端凭据检查通过。
- 浏览器全套首次 10/12 通过；两个视频用例因复用此前的新摘要版本失败。夹具显式指定历史音频版本后，桌面和手机两项均通过，验证了新旧来源说明、作者 Description 和播放回退。
- `0004_slow_menace` 已应用到本地开发库，迁移不消费队列；编译后的 Worker 在不提供认证/API 凭据时以暂停模式启动并正常退出。

## Lightsail 新镜像的真实队列验收

2026-09-29 03:40:26 UTC，服务器已部署 `sharing:6581554` 并应用 `0004`。使用同一新镜像、既有供应商配置和独立的一次性数据库，迁移空库并创建两条真实 pg-boss 任务，随后启动实际 `/app/dist/worker/index.js`。任务由 Worker 的正常队列消费入口领取，不直接调用 `processContentJob`。

| 视频 | 时长 / 采样 | 最终状态 | 任务耗时 | 输入 / 输出 token |
| --- | --- | --- | --- | --- |
| Claude.ai，`0vZ_UVLhSQQ` | 319 秒 / 默认 | ready；job 和 task 均 completed | 61,149 ms | 29,162 / 163 |
| Andrew Ng / LangGraph，`58n-n-3oRic` | 6,618 秒 / 0.1 fps | ready；job 和 task 均 completed | 66,683 ms | 209,258 / 166 |

两个任务各 `attempts=1`、一次 `video_summary` 成功事件、一个 `units=1 / consumed` 预留，摘要版本为 `youtube-url-en-v1`。端点观测确认两次均为非流式 `generateContent`、HTTP 200。任务耗时从领取到完成，包含元数据和模型并发槽等待；摘要并发为 1，两条任务不能当作两个独立模型耗时比较，也不构成稳定延迟承诺。

记录含白名单模态 token 计数，本次响应未提供缓存计数；配置 Free tier 的费用估算为零，不代表核对过实际账单。整个验收 69,629 ms，Worker 收到 SIGTERM 后正常退出（0），测试数据库已删除，临时容器已清理。正式两条分享和内容未修改或批量重试。

报告位于服务器 `/home/ubuntu/sharing-validation/url-6581554-20260929/queue-result.json`，副本为本机 `.local/deployments/6581554-20260929/queue-result.json`，不提交私有运行记录。本次证明服务器新镜像的真实 Worker 能领取队列并完成上述两个公开视频；不替代正式用户的浏览器提交、Google 登录、远程 MCP 或私有客户端安装验收。

## 发布边界

新版源码、Docker/Compose、数据库迁移、CLI、测试和文档已在 [f9cd079](https://github.com/TAO44123/Authright_Sharing/commit/f9cd079eb22cc2cedd15c67fb33dafdf10a5c02c) 提交并成功推送 GitHub `main`。

| 环节 | 状态及证据边界 |
| --- | --- |
| 非流式 API | 升级前 Lightsail 容器短/长视频均 HTTP 200 |
| 新 Worker 本地处理 | 本地一次性数据库短视频 25,276 ms、长视频 26,756 ms 均落库成功；此项通过共享处理函数执行 |
| 服务器真实队列 | 新镜像的编译 Worker 正常领取并完成两条 pg-boss 任务；一次调用、单单位消费，临时库已清理 |
| 本地数据库 | 已应用 `0004_slow_menace`，迁移不消费队列 |
| GitHub | `main` 已接收实现提交 `f9cd079` |
| 生产 | Web/Worker 均为 `sharing:6581554`；正式库应用 `0004`，health、discovery 及心跳通过，历史业务表核对一致 |
| 备份 | 迁移前 dump 通过目录检查、离机复制及 SHA-256 核对；生产恢复演练及每日自动备份仍待完成 |

生产从 GitHub 拉取至文档提交 `6581554`（包含实现基线 `f9cd079`）后，按 [部署手册](../DEPLOY_LIGHTSAIL.md#7-后续更新和回滚) 构建、备份、迁移并替换镜像。后续纯文档提交不会自动替换运行镜像。

yt-dlp 清理范围也已核对：新 Worker schema、模板、Dockerfile 和 Compose 不再使用旧工具/代理；本机 `.env` 两个旧工具路径、`.local/audio-tools`、旧音频模块及测试仍保留。完整范围见 [视频 Worker](../YOUTUBE_AUDIO_WORKER.md#旧配置的移除范围)，本次文档同步未进一步删除这些历史文件。

原理和限制：[Gemini 视频/YouTube URL 输入](https://ai.google.dev/gemini-api/docs/video-understanding)、[价格](https://ai.google.dev/gemini-api/docs/pricing)。公开视频可访问性、上下文及项目配额仍适用；采样画面和摘要输出需要质量抽查。
