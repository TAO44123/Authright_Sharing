# Sharing — 第一版开发指南

> 2026-09-28 更新：YouTube 处理改为下载临时音轨 → Gemini 信息提取 → 视频摘要；接口新增 `ai_video_summary` / `video_summary`，视频预留两次调用额度。本地数据库迁移已应用，Worker 已启动，Claude.ai 样本音频摘要已成功落库；运行状态、完整行为与部署步骤见 [音轨 Worker](./YOUTUBE_AUDIO_WORKER.md)。

版本：v0.6

日期：2026-09-28

状态：音频摘要代码、测试及本地迁移已完成；本地 Worker 已完成 Claude.ai 和 Andrew Ng 长视频摘要落库；音频版本尚未部署

关联：[开发计划与私有分发](./DEVELOPMENT_PLAN.md) · [PRD](./PRD.md) · [技术设计](./TECHNICAL_DESIGN.md)

## 1. 使用方式与完成标准

本文件维护工程结构、本地配置、验证策略和运维约定。任务划分、依赖、实施顺序及 Plugin 私有分发以 [开发计划](./DEVELOPMENT_PLAN.md) 为准；架构和接口语义以技术设计为准，产品边界以 PRD 为准。

当前包含成员管理、分享查询/撤回/重试、文章摘要、YouTube 音频摘要、故障恢复、网页与 MCP。模板默认关闭消费；本地 `.env` 已启用处理。2026-09-28 23:23 UTC 检查时 Web 与 Worker 均在运行；主机音频工具已配置，Claude.ai 样本 generation=3 和 Andrew Ng 长视频 generation=5 均完成真实音频摘要并落库。此前 Gemini 503 为历史失败记录。音频版本尚未部署到 Lightsail。历史 A4 文章和视频元数据验收与本次音频验收分开记录，见 [音轨验证](./validation/YOUTUBE_AUDIO_GEMINI.md)。

每个阶段完成时：提交可运行代码及必要迁移，执行对应验证，记录结果和剩余限制，更新阶段复选框。真实第三方验证需记录日期、服务/客户端版本、实际结果；mock 测试只能证明应用内行为。

整体完成条件：PRD 第 11 节全部通过，三个 Agent 客户端完成真实授权、业务及私有来源安装/更新/回退验证，手机浏览器流程可用，数据库恢复和失败任务恢复经过演练。

实际 S0/S1 入口、运行命令和验收结果以 [README](../README.md)、[可执行契约](./validation/CONTRACTS.md)、[兼容性记录](./validation/COMPATIBILITY.md) 为准。下面目录树是完整产品的目标布局；当前服务先保持 src/server 下的平铺模块、src/contracts 共享契约和 drizzle/ 迁移目录，避免空层级。

## 2. 开发组织与目录约定

一个 pnpm 项目，先保持普通目录结构，不引入额外 monorepo 构建工具。

```text
Sharing/
  docs/
    PRD.md
    TECHNICAL_DESIGN.md
    DEVELOPMENT.md
    DEVELOPMENT_PLAN.md
    validation/                 # S0 起记录版本矩阵、样本和真实联调结果
  src/
    app/                        # 页面、REST、认证回调和 /mcp 路由
    components/                 # 页面组件
    server/
      auth/                     # Better Auth、Actor、成员与授权检查
      db/                       # Drizzle schema、连接、事务
      services/                 # 分享、查询、撤回、成员、额度
      contracts/                # REST/MCP 共用 Zod schema 与 DTO
      mcp/                      # 工具定义、结果与错误适配
      queue/                    # pg-boss、事务入队、状态对账
      content/                  # URL、安全抓取、正文提取、YouTube
      summary/                  # 单供应商适配器、prompt 和输出校验
      observability/            # 日志脱敏、request/attempt ID
    worker/
      index.ts                  # Worker 启动与优雅退出
      handlers/                 # 文章、视频、维护任务
  plugins/                      # 共享 Skill 与三客户端包装源，导出至私有分发仓库
  scripts/                      # bootstrap 管理员、维护、诊断与 Plugin 导出
  migrations/                   # 经过审查的业务与认证 schema 迁移
  tests/
    unit/
    integration/
    e2e/
    fixtures/                   # 合成或许可的短测试内容，不归档用户文章
  compose.yaml                  # 本地 PostgreSQL
  Dockerfile                    # Web / Worker 共用构建产物
  .env.example                  # 仅变量名与无秘密的示例
  package.json
  pnpm-lock.yaml
```

边界约定：页面和 MCP 工具不直接写数据库；共享 services 不依赖 React 或 MCP SDK；数据库、认证和外部服务模块仅能在服务器端导入。Worker 不通过调用自己的公网 REST 完成内部业务。

## 3. 开发阶段入口

开发顺序已统一到 [开发计划](./DEVELOPMENT_PLAN.md)，本指南不再维护另一套阶段清单：

| 阶段 | 内容 |
| --- | --- |
| S0 | 工程骨架、共享契约、身份边界和分发条件 |
| S1 | 真实网页登录并分享 → Agent 授权并查询；不依赖文章摘要 |
| A1–A5；A6 暂缓 | 数据工程、成员、分享业务、内容处理和网页已完成本地实现；已有后台计量，额外限速调度按试用需要实施 |
| B1–B5 | Agent 授权、MCP 工具、Skill、私有包装分发、三客户端验收 |
| R1–R3 | 完整联调、服务部署与私有发布、同事试用 |

A/B 是开发职责划分；服务端业务与 MCP 仍在同一应用仓库。Plugin 使用该仓库维护的源文件，发布时只导出允许的客户端产物到专用私有仓库。

## 4. 本地开发约定

### 4.1 已建立的本地脚本

| 脚本 | 预期行为 |
| --- | --- |
| `pnpm dev` | 启动 Next.js 开发服务 |
| `pnpm dev:worker` | 启动可重载 Worker |
| `pnpm build` | 类型正确的 Web/Worker 生产构建 |
| `pnpm start:web` / `pnpm start:worker` | 分别启动已构建服务 |
| `pnpm db:generate` | 从 schema 生成待审查迁移 |
| `pnpm db:migrate` | 应用迁移；不得使用隐式破坏性 schema 同步 |
| `pnpm admin:bootstrap <email>` | 幂等初始化首位管理员角色；公司成员无需 bootstrap 即可登录 |
| `pnpm lint` / `pnpm typecheck` | 静态检查 |
| `pnpm test:unit` | 公司身份、姓名回退、网页认证错误、URL、schema、安全抓取、提取、摘要并发与模块边界；当前 44 项 |
| `pnpm test:integration` | 独立 PostgreSQL 中的事务、队列和权限测试 |
| `pnpm check` | lint、客户端依赖边界、类型检查及单元测试 |
| `pnpm check:client-assets` | 构建后检查客户端产物不包含已配置服务端秘密 |
| `pnpm test:worker` | 用仅含数据库/日志配置的环境启动已构建 Worker，检查暂停状态与优雅退出 |
| `pnpm test:e2e` | 生产构建后，使用 sharing_test 和 3103 端口运行桌面/手机 Chromium 关键流程 |
| `pnpm test:codex` | 用当前 CLI 授权执行真实只读 MCP 查询；不会自动登录 |
| 浏览器人工/Codex 浏览器验证 | 真实 Google 登录与分享记录于 validation/COMPATIBILITY.md；自动化网页流程另由 Playwright 覆盖 |

A1 新增数据库迁移测试会创建并清理随机命名的 `sharing_test_migration_<uuid>` 数据库，测试角色需要 CREATEDB；生产角色不需要。`pnpm build` 固定使用 Webpack，并执行客户端秘密扫描。详见 [A1 验收记录](./validation/A1_FOUNDATION.md)。

当前启动顺序（详细命令见根目录 README）：安装锁定依赖及音频工具 → 首次复制环境变量模板并填入配置 → 启动本地 PostgreSQL → 执行迁移 → 首次 bootstrap 管理员 → 分别启动 Web 和 Worker。已有 `.env` 不覆盖；`pnpm dev` 不会启动 Worker。迁移不会消费队列。

本地已完成 `0003_lively_ikaris`：视频摘要约束和两单位预留生效；长视频修订后队列超时更新为 1020 秒，等待任务可由迁移脚本同步更新。主机音频工具路径已配置，`pnpm dev:worker` 已运行并完成 Claude.ai 短视频及 Andrew Ng 长视频样本；启动步骤及验收快照见 [音轨 Worker](./YOUTUBE_AUDIO_WORKER.md#本地运行状态与启动检查)。

开发用 OAuth 回调必须与 Google 应用配置一致。自动化测试使用隔离测试身份夹具；测试身份入口不得进入生产构建，不能靠一个公开请求头绕过认证。真实 Google/OAuth 客户端验证保留独立人工或受控联调记录。

### 4.2 环境变量与外部配置

| 配置 | 使用方 | 要求 |
| --- | --- | --- |
| `DATABASE_URL` | Web、Worker、迁移 | 各环境独立数据库凭据；按服务需要授权 |
| `APP_URL`、`BETTER_AUTH_URL` | Web | 正式 HTTPS origin；开发允许 localhost |
| `BETTER_AUTH_SECRET` | Web 认证服务 | 高强度随机秘密；按锁定库文档配置 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | Web | Google OAuth 应用；配置精确回调 |
| `GOOGLE_WORKSPACE_DOMAIN` | Web | 当前 authright.com；校验 Google 已验证邮箱的精确域名，不额外限制 hd |
| `MCP_RESOURCE_URL` | Web | 对外 `/mcp` URL，与 Token audience 匹配 |
| `CURSOR_SIGNING_SECRET` | Web | 分页游标签名，与认证 secret 分离 |
| `YOUTUBE_API_KEY` | Worker | YouTube Data API v3；仅开放所需 API 能力，限制使用范围 |
| `GEMINI_API_KEY` | Worker | Gemini Developer API；文章摘要及视频音频提取/摘要使用 Gemini 3.5 Flash-Lite |
| `GEMINI_BILLING_TIER` | Worker / A4 验收脚本 | `free` 或 `paid`；处理开启时必填，按 AI Studio 项目档位填写；本地当前为 `free` |
| `CONTENT_PROCESSING_ENABLED` | Worker | 默认 false；true 开启处理及对账，可能消费已有队列 |
| 摘要价格快照 | Worker / 数据库 | 模型、档位对应美元单价和版本写入每次用量事件；Free tier 已知用量为零，旧 Paid 等价估算不代表账单 |
| `WORKER_CONCURRENCY`、`SUMMARY_CONCURRENCY` | Worker | 初始 2 / 1 |
| `YT_DLP_PATH`、`FFMPEG_PATH` | Worker | 默认 yt-dlp / ffmpeg；本地主机需安装工具或设置可执行文件绝对路径，Docker 镜像已包含 |
| `LOG_LEVEL` | Web、Worker | 生产日志不输出原始请求体 |

可选的产品月额度开关与上限已有数据库设置，默认关闭，当前不提供管理页面；它不代表 Gemini 项目的 RPM/TPM/RPD。试用中如频繁触限，再从 AI Studio 核对实际限制并实现供应商窗口控制。管理员邮箱通过 bootstrap 参数提供，不作为长期开放的提权入口。

`.env.example` 不含真实凭据；真实 `.env` 不提交。联调报告不记录 Token、Cookie、Google 授权码、API Key 或完整敏感 URL。供应商 SDK 的自动重试应禁用或显式计入应用尝试次数，避免隐藏调用绕过用量和重试上限。

## 5. 验证策略

### 5.1 必须覆盖的集成场景

下表是完整产品的目标测试矩阵，不表示全部已有覆盖。基础人工证据见 [S0/S1 核对记录](./validation/S0_S1_AUDIT.md)，Worker 恢复、抓取、视频、额度与网页自动化覆盖见 [A2–A5 验收](./validation/A2_A5_PLATFORM.md)。

| 分类 | 场景与通过标准 |
| --- | --- |
| 身份与权限 | 公司用户自动加入；非公司/未验证邮箱拒绝；伪造分享者无效；普通成员不能调整角色；不能撤回他人分享 |
| 身份稳定性 | 姓名/邮箱更新后历史归属不变；并发登录不重复建档；旧禁用状态不再限制公司用户登录 |
| OAuth | 错误 issuer/audience/scope、过期 Token 被拒绝；授权码不可重放；单连接撤销下次请求生效 |
| 幂等 | 同用户同 key 同 payload 返回同记录；异 payload 冲突；不同用户相同 key 互不干扰；主动新 key 创建新分享 |
| 内容并发 | 两个用户同时提交同一 URL：两条分享、一个内容、一个活跃任务；同视频不同 URL 复用视频 ID |
| 事务 | 故障注入验证回滚无孤儿；提交后即断线重试不重复；事务入队失败时不显示已保存 |
| Worker 恢复 | 领取后进程退出、租约过期、重试耗尽都能进入正确状态；旧 attempt 不覆盖新 generation |
| 付费调用边界 | 模型结果已发回但保存前崩溃标记不确定；不盲目自动重复调用；成功摘要复用 |
| 抓取安全 | 公网跳转私网、IPv6 特殊地址、DNS 重绑定、压缩大响应、慢响应均被安全拒绝；解析不执行 JS |
| 内容可靠性 | 付费墙、只有描述、明显截断、无效模型 JSON 不产生 ready 摘要；短但完整正文不过度拒绝 |
| 视频 | 空描述可 ready；不存在视频保留链接；嵌入失败回退；整条处理链模型调用计数为零 |
| 视频缓存 | 模拟 29/30 天边界、刷新失败、清理延迟和备份恢复；API 过期派生字段不会被返回 |
| 查询 | 日期边界、夏令时、分页同时间记录、撤回、同名消歧、关键词特殊字符和返回范围准确 |
| 额度 | 产品月额度关闭时正常；供应商 RPM/TPM/RPD 达限仍保存链接、延后任务；窗口恢复只入队一次；并发不绕过限制 |
| 数据与日志 | DB/队列/日志中无正文或凭据；未知费用不是零；错误响应无堆栈；私有结果不进入共享缓存 |

数据库并发测试使用真实 PostgreSQL 和 pg-boss，不能只 mock Repository。UI E2E 重点覆盖一条成功链路、模型失败仍保存、失败重试、撤回及管理员越权；不为每个样式属性编写测试。

### 5.2 PRD 验收映射

所有验收在 R1 汇总，R2/R3 另验证生产部署与同事的私有安装体验。

| PRD 第 11 节 | 验收内容 | 主要任务 | 证据 |
| --- | --- | --- | --- |
| 1 | 已验证公司账号自动加入，网页/Agent 同一资格检查 | S1、A2、B1 | 真实登录记录 + 权限集成测试 |
| 2 | 手机只粘贴链接即可提交 | S1、A5 | 手机浏览器实测 + E2E |
| 3 | 模型失败仍保存链接 | A3、A4、A5 | 故障注入 + UI 记录 |
| 4 | 英文概述/3–5 要点，正文不足不编造 | A4 | 人工样本评审 + 输出校验测试 |
| 5 | 视频标题/封面/描述，允许描述为空 | A4、A5 | API 样本 + 页面检查 |
| 6 | 视频无 AI 分析，嵌入失败有外链 | A4、A5 | 调用计数断言 + 播放器回退 |
| 7 | 分人记录，共用成功摘要 | A3、A4 | 并发与复用集成测试 |
| 8 | 三客户端连接、提交、查询和详情 | S1、B2、B5 | 客户端矩阵全部通过 |
| 9 | 明确来源与没有全文 | B2、B3、B5 | DTO/schema + 真实工具输出 |
| 10 | 只撤回自己记录，不影响他人 | A3、A5、B2 | 权限与查询回归 |
| 11 | 后台计量，额度默认关；触限保留分享并可重试 | A4、A5 | 计量与额度集成测试 + 失败页面检查 |
| 12 | 无长期正文/音视频，临时数据清理 | A4、R2 | 存储与日志检查 |
| 13 | 英文 UI/文章摘要，描述保留来源语言 | A4、A5 | 页面和中英文样本检查 |

新增发布验收：每个客户端从私有源安装指定 Plugin 版本，完成个人授权、升级、回退和卸载/撤权流程。开发机上的配置直连不能替代该验收。

### 5.3 客户端兼容性记录方式

每个客户端分别记录实际应用版本、操作系统、服务端 commit/依赖版本、MCP 协议版本、OAuth 客户端注册方式及日期。CLI 通过不能自动代表所有桌面或 IDE 版本通过。

实际客户端结果维护在 [COMPATIBILITY](./validation/COMPATIBILITY.md)，避免模板中的“待测”覆盖已完成结果。每次记录登录、刷新/重连、实际工具、过滤/分页、个人连接撤权和私有安装/更新/回退，并标明证据来自用户人工反馈、真实客户端脚本还是隔离协议测试。S1 只提供两个只读 MCP 工具，不把其通过写成五个工具全部完成。

## 6. Agent 配置直连示例

本节用于 S1 技术验证与排障；正式同事安装按 [开发计划](./DEVELOPMENT_PLAN.md) 第 7 节的私有 Plugin 分发方案执行。

以下以占位域名 `sharing.example.com` 演示官方文档提供的配置形式，不代表当前服务已部署。正式接入说明必须替换域名，并根据 S1 实测补齐必要的客户端注册配置。

### Claude Code

```sh
claude mcp add --transport http sharing https://sharing.example.com/mcp
```

在客户端使用 `/mcp` 进入连接与认证流程。配置可按实际需要使用个人或项目范围。[Claude Code 官方文档](https://code.claude.com/docs/en/mcp)

### Codex

本机 B 阶段的 Codex 插件安装、授权及复验见 [B 阶段本机 Codex 验证](./validation/B_CODEX_LOCAL.md)。以下直连样例用于 S1 排障；插件连接名为 `sharing`，旧直连配置名为 `sharing-local`。执行登出或重置前须核对目标连接名，避免清理仍在工作的插件授权。

在配置中添加远程服务器，再通过 CLI 发起 OAuth：

```toml
[mcp_servers.sharing]
url = "https://sharing.example.com/mcp"
```

```sh
codex mcp login sharing
```

具体运行环境的凭据来源与注册机制以实际版本为准；不在共享配置中写入个人 Token。[Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)

### Cursor

```json
{
  "mcpServers": {
    "sharing": {
      "url": "https://sharing.example.com/mcp"
    }
  }
}
```

在 MCP 设置中完成授权。如果实测需要预注册 OAuth 客户端，再增加该版本支持的 `auth` 配置，准确登记回调地址；不能把 Google OAuth client secret 当作 MCP 客户端 secret 分发。[Cursor 官方文档](https://cursor.com/docs/mcp)

连接后至少测试：最近分享、某位同事本周分享、关键词查询、分享同一链接两次（分别验证主动重复和同 key 重试）、获取详情、撤回本人分享、尝试撤回他人分享。

## 7. 发布与故障处理

### 7.1 服务端发布顺序

完整发布还包括 Plugin 私有仓库版本与目录更新，顺序见 [开发计划](./DEVELOPMENT_PLAN.md) 第 7.5 节。以下是服务端部分：

1. CI 通过静态检查、必要单元/集成测试和关键 E2E，生成不可变构建产物。
2. 确认数据库备份可用；单独运行向后兼容的迁移。
3. 更新 Web 和 Worker，验证 readiness 与 Worker 心跳；关注旧任务 payload 兼容。
4. 用测试成员完成登录、提交、处理、网页查询及 MCP 查询。
5. 检查错误、队列积压、未知模型结果和用量；失败时回滚应用，保留新 schema 兼容性。

首版业务变化优先使用增量迁移。队列 payload 携带版本，部署不得让旧任务调用不存在的 handler。外部服务无法访问时页面仍可保存分享，并正确显示处理状态。

### 7.2 常见故障

| 现象 | 排查与处理 |
| --- | --- |
| 页面一直显示 Generating summary / Generating video summary | 当前界面对 queued 和 processing 使用相同提示；先查任务 state、attempts、started_at 和 Worker 进程。queued 且 attempts=0 表示尚未开始，不代表 Gemini 卡住 |
| Google 登录被拒绝 | 核对 callback/base URL、Google 返回的 email_verified 及精确公司邮箱域名；不再要求预先添加成员 |
| MCP 连不上或重复要求授权 | 核对 HTTPS、well-known、issuer/resource、注册方式、回调、客户端版本和 scope |
| Codex 显示 Reconnect / notLoggedIn | 优先点击重连提示或 MCP 设置中的认证入口，在 Sharing 确认 Allow access 后重试；已有 Sharing 会话无需退出。单独 app-server 脚本显示 notLoggedIn 仅说明该进程没有可用授权，不能据此推断桌面不会显示重连提示 |
| `pnpm test:codex` 未找到示例链接 | 先确认 CLI 已授权，再检查示例链接是否仍在默认最近七天窗口；脚本不会补建分享，也不会自动打开授权页 |
| 链接一直是 queued | 检查 Worker 是否已启动、`CONTENT_PROCESSING_ENABLED=true` 以及两个 API key；不必反复提交链接 |
| 撤销 Agent 连接后仍能访问 | 检查授权撤销查询或缓存；网页登录及其他未撤销连接可以继续使用 |
| 模型调用结果未知 | 查询供应商可用请求记录并关联 attempt；可恢复结果则保存，否则显示明确失败供人工重试 |
| YouTube API、音轨下载或 Gemini 故障 | 查看失败阶段和错误码，保留分享，不用标题或 Description 冒充音频摘要；Gemini 429/503 不自动重复调用 |
| AUDIO_TOOLS_UNAVAILABLE | 检查本地主机的 YT_DLP_PATH / FFMPEG_PATH；只构建了 Docker 镜像不会让主机自动拥有这些命令 |
| AUDIO_UNAVAILABLE / AUDIO_TOO_LARGE | 前者表示没有生成可下载音轨；后者表示源音轨、临时工作目录或 MP3 超过容量上限。Andrew Ng 样本旧版本因 yt-dlp 跳过超限文件而误报前者，长视频修订后已成功处理 |
| AUDIO_UPLOAD_FAILED | 检查 Gemini Files API 的上传、就绪状态和服务响应；文件上传失败不触发摘要生成，已取得文件 ID 时会尝试删除远端文件 |
| 数据库故障 | 写请求明确失败；恢复备份后执行迁移和授权/任务/过期缓存对账，再开放流量 |
| 额度耗尽 | 确认调用次数与预留；管理员调整上限或等待月切换；不删除任务绕过额度 |

### 首次连接测试与重置范围

正常撤权重连只需客户端重新发起 OAuth。仅在明确测试“没有旧凭据、没有 Sharing 网页会话”的首次连接时执行以下清理：

1. 确认目标是本地 `localhost:3000` / `127.0.0.1:55432/sharing`，记录当前测试用户和目标客户端；不要操作生产库或其他 MCP 连接。
2. 用 `codex mcp logout sharing-local` 删除该连接的客户端 OAuth 凭据，保留 MCP URL 配置。
3. 由维护者在数据库事务内清除目标用户/客户端的连接、consent、访问/刷新凭据及目标用户的 Sharing 会话；仅在没有其他授权引用时删除对应客户端注册。若有待完成的 OAuth 流程，应先取消该流程并检查临时状态。不要清空整个认证库、用户表或成员表。
4. 保留分享、内容、队列、用户资料、成员权限、Google 应用配置和签名密钥。Google 自身的登录状态保留；Sharing 重新登录时可能直接选择账号，不要求再次输入密码。
5. 重新加载 MCP 连接，避免客户端进程沿用内存状态。由用户完成登录与 Allow access，再验证两个只读工具；不在清理时主动登录，否则会污染首次连接起点。

2026-09-27 已按此范围清理：2 个 Sharing 会话、4 条连接记录、1 个 consent、1 个刷新凭据及 2 个 Codex 客户端注册；核对认证相关表为零，保留 1 个用户、1 个成员和 1 条分享。该记录描述当时的重置结果，不代表后续登录后的实时状态。用户随后反馈首次流程未见异常；独立 CLI 查询复验状态见兼容性记录。

## 8. 开始开发所需信息

本地 Workspace、管理员、Google 凭据、数据库和 A4 摘要/YouTube 凭据已配置并完成 6 条公开链接验收。下表保留完整产品的配置依赖；HTTPS、生产服务和私有分发条件仍待对应阶段补齐。

| 信息 | 使用时点 | 缺失时可继续的工作 |
| --- | --- | --- |
| Workspace 域名、测试成员、首位管理员 | S1 真实登录 | 脚手架、schema 和纯业务测试 |
| Google OAuth 测试应用凭据 | S1 真实登录与 Agent 授权 | 权限函数与页面结构 |
| 可供客户端访问的测试 HTTPS 地址 | S1 远程 MCP | 本地工具协议与错误测试 |
| 代表性文章和视频链接 | A4 提取评估 | 使用公开代表样本，但需标注未代表团队实际来源 |
| 模型供应商账号和 API Key | A4 模型选择与内容处理 | 适配器 contracts 和 mock 故障测试 |
| YouTube Data API Key | A4 | 视频 ID 和 API 响应夹具测试 |
| 托管平台、区域、预算与域名 | R2 | 本地开发、Docker 构建和部署说明 |
| 私有 Git 组织/仓库、读取权限与客户端策略 | S0 确认路径，B4 验证安装 | 本地 Plugin 产物与契约测试 |
| 正式产品名 | 上线前 | 暂用 Sharing，不影响数据/协议设计 |

选择库的具体版本、接口内部实现等常规工程事项由开发阶段解决并记录。涉及产品范围、身份边界或新增付费服务的变化，需要把实际取舍和配置需求明确写回文档。
