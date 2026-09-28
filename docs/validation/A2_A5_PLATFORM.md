# A2–A5 本地实现与验收

> 后续需求修正：公司邮箱现为唯一准入条件，首次登录自动建档；本文的允许名单/成员禁用描述仅记录当时实现，已被 [公司账号自动加入](DOMAIN_SIGN_IN.md) 替代。
> A4 后续已接入 Gemini 和 YouTube 真实服务，并按用户修订的 6 条样本完成验收；本页保留原阶段记录，最新结果见 [A4 真实服务验收](A4_REAL_SERVICES.md)。
> A5 收尾更新：`/account` 的时区、连接列表与撤销已完成；安装入口归 B4，不是 A5 阻断项。后续 E2E 增加 Library、网页授权错误、Gemini 429 提示、可嵌入 iframe 与外链回退。以下早期表格和测试数量是当时的历史快照；最新范围见 [开发计划](../DEVELOPMENT_PLAN.md)。
> 浏览器复核：全套桌面/手机视口 Chromium 10 项通过，覆盖键盘 Enter 提交、手机触控、429 后手动重试。视频 iframe 原设 `no-referrer`；[YouTube 官方说明](https://support.google.com/youtube/answer/171780)称缺少 Referer 会报 153，现改为 `strict-origin-when-cross-origin`，E2E 验证 iframe 请求的 Referer 为应用 origin。测试快速刷新时曾偶发 React 流提前关闭日志；等待页面刷新完成后最近一轮全套未再现，仍留待 R1 真实环境观察。真实设备与视频解码播放尚未验证。

日期：2026-09-27（America/New_York）。本次按 A2 → A3 → A4 → A5 顺序实施。用户明确选择先完成接口和测试，稍后配置真实服务；不把测试夹具视为真实模型或视频验收。

## 实现范围

| 阶段 | 已交付 | 仍需完成 |
| --- | --- | --- |
| A2 | 管理员名单增改、角色/禁用、最后管理员并发保护、审计；禁用撤销会话与 Agent 授权，保留历史 | 额度管理页属于 A6 |
| A3 | 提交、查询、详情、成员检索、本人撤回、网页失败重试；兼容 DTO、摘要搜索、签名分页与幂等 | 三个新增 MCP 工具和 OAuth scope 属于 B2 |
| A4 | 安全抓取、Readability、摘要接口/输出校验、YouTube 适配、租约/对账、额度预留/计量、故障测试 | 真实摘要供应商适配器、15–20 个来源样本评估、模型选择/价格依据、真实 YouTube API/播放验收 |
| A5 | 英文分享页/筛选/详情、轮询、失败重试/撤回、成员管理、账户时区与连接撤销；桌面/手机视口测试 | B4 私有 Plugin 安装入口；真实手机设备验收 |

未部署远程服务、未创建 Git 仓库或提交，也未配置真实内容服务密钥。CI workflow 已更新，本地运行通过不代表远程 CI 已运行。

## 内容处理与成本边界

- `CONTENT_PROCESSING_ENABLED` 默认 false；此时 Worker 记录心跳，真实任务留在队列。开启会消费已有任务，应先确认服务配置。
- Worker 当前注入 `unconfiguredSummary`。`SummaryProvider` 包含模型标识、attempt ID、取消信号、结构化结果、可空 Token 数和可选供应商请求 ID。测试以显式 fake 实现注入；生产没有伪造摘要回退。新增 API key 本身不能完成适配器接入。
- 摘要 prompt 要求英文单句概述与 3–5 条要点，把文章视为不可信资料且不提供工具。Zod 验证结构和长度；是否忠实、英文质量如何，须真实样本评审。
- 抓取只接受 HTTP(S)/HTML；逐跳校验 DNS 全部地址并固定已验证 IP，最多 5 次重定向、20 秒总抓取时间、5 MiB 传输及解压上限。拒绝私网/保留地址、混合公网与私网 DNS。jsdom 不启用脚本或外部资源；Readability 提取失败、过短、付费墙提示、超长正文均明确失败。
- 原始 HTML/正文只存在于处理内存，不写入数据库、队列、日志或临时文件。JS 内存由运行时回收，不承诺安全擦除；长期保存只有摘要/来源元数据。
- 默认 Worker 并发 2、摘要并发 1；先取得摘要并发槽，再预留额度。额度默认关闭但仍记录调用。预留在数据库锁内执行，发送前写 consumed/started，未知结果保留调用消耗。
- 总处理期限 120 秒，租约 180 秒，最多 3 次预调用尝试。付费调用发出后不自动重试，异常保守记为 `OUTCOME_UNKNOWN`。真实适配器必须尊重取消、禁用 SDK 隐式重试并补充供应商错误/费用策略。
- generation、lease token 和到期时间限制旧 Worker 写回。维护任务处理过期租约、丢失队列作业和额度恢复，避免重复付费；已开始的调用恢复为未知结果而不自动重发。
- 没有有效分享的待执行任务取消；普通处理内容变为 `NO_ACTIVE_SHARES` 的失败状态。以后再次分享可手动重试，不会停留在没有任务的 queued 状态。
- YouTube 仅读取 API 元数据，不请求字幕/音视频或模型。允许空 Description，仍标为 `youtube_description`。29 天安排刷新、30 天到期；读取时立即屏蔽过期字段，维护任务负责清理。不可嵌入时保留外链，播放器区始终提示外链回退。
- 保存分享与内容处理解耦：处理失败不删除链接。列表与详情的读取不会触发抓取或模型调用。

## 验证结果

| 检查 | 结果与覆盖 |
| --- | --- |
| `pnpm check` | lint、客户端依赖边界、TypeScript；35 项单元测试 |
| `pnpm test:integration` | 14 项通过；真实 PG 事务/pg-boss、身份/授权、迁移、成员并发、幂等/权限、处理/配额/恢复与过期缓存 |
| `pnpm build` | Next.js 16.3.6 Webpack 与 Worker 生产构建；客户端产物秘密扫描通过 |
| `pnpm test:worker` | 不依赖 Web 认证配置启动，默认消费暂停，优雅退出通过 |
| `pnpm test:e2e` | 桌面 1280×900、手机 390×844 Chromium 各 3 项，共 6 项通过 |

浏览器用例覆盖粘贴提交、失败保留原链接、重试、轮询完成、摘要详情、关键词过滤、时区、管理员页面、撤回后不可见、普通成员页面/API 越权拒绝、空视频描述及不可嵌入外链。内容完成状态由测试数据库夹具写入；会话通过真实 auth adapter 在测试数据库建立，不提供生产绕过登录入口。

集成及浏览器测试只使用 `sharing_test` 和受保护的临时 `sharing_test_migration_<uuid>` 数据库。OAuth 集成测试使用 3101 端口，浏览器测试使用 3103；不修改本地应用库中的真实分享。迁移创建/升级及最后管理员并发等场景在各自临时数据库运行。Worker 启停检查连接本地配置的数据库，但保持消费暂停。

已目视检查手机列表/视频与桌面详情截图，长 URL 可换行、手机无横向溢出，摘要要点保留列表符号。自动截图保存在 `test-results/`（被忽略，每次运行重建）；选定记录随本文件保存在 validation 目录。

截图：[桌面文章详情](a5-desktop-detail.png) · [手机筛选列表](a5-mobile-library.png) · [手机空视频描述](a5-mobile-video.png)。

浏览器运行期间服务端偶发 `The destination stream closed early`，6 项用例仍通过。日志与页面跳转/刷新同时出现，但尚未证明根因；保留为真实联调时需复查的运行问题，不将其写成无错误日志的验收。未完成真实第三方、跨浏览器和真实设备验收。

## 主要改动文件索引

这是本轮交付的实现索引，不是 Git diff 统计（当前目录没有 Git 基线）。

| 范围 | 文件 |
| --- | --- |
| 成员服务 | `src/server/admin-members.ts`、`membership.ts`、`member-search.ts`、`scripts/disable-member.ts` |
| 共享契约/分享 | `src/contracts/index.ts`、`src/server/shares.ts`、`cursor.ts`、`url.ts`、`account.ts` |
| 内容与额度 | `src/server/content/{types,summary-contract,fetch,extract,youtube,processor,maintenance,concurrency}.ts`、`src/server/quota.ts` |
| Worker/配置 | `src/worker/index.ts`、`src/server/{env,queue}.ts`、`scripts/migrate.ts`、`.env.example` |
| REST | `src/app/api/admin/members/`、`api/members/`、`api/account/`、`api/shares/`、`api/health/route.ts` |
| 网页 | `src/app/page.tsx`、`share-form.tsx`、`globals.css`、`shares/[id]/page.tsx`、`admin/`、`account/`、`loading.tsx`、`error.tsx`、`not-found.tsx` |
| 交互组件 | `src/components/{processing-poll,processing-status,share-actions,share-filters}.tsx` |
| MCP 描述 | `src/server/mcp.ts`；仍仅注册两个只读工具 |
| 测试/工程 | `tests/integration/{members,core,processing,migrations}.test.ts`、`tests/helpers/database.ts`、`tests/unit/{content,fetch}.test.ts`、`tests/e2e/platform.spec.ts`、`playwright.config.ts`、`package.json`、`pnpm-lock.yaml`、`.github/workflows/ci.yml` |
| 文档 | `README.md`、`docs/DEVELOPMENT.md`、`docs/DEVELOPMENT_PLAN.md`、`docs/validation/CONTRACTS.md`、本记录 |

## 下一次接入真实服务

1. 选择摘要供应商/模型，实现 `SummaryProvider` 适配器并替换 Worker 中的 `unconfiguredSummary`；接入版本化 prompt、显式超时、请求记录与价格快照。
2. 在本地 `.env` 配置密钥，不提交或发送密钥。先用真实样本单独验证摘要与 YouTube，再开启内容消费。
3. 评估 15–20 个实际来源的提取覆盖、短正文/登录墙分类、英文摘要忠实度及实际费用；测试正常视频、空描述、禁用嵌入与不可用视频。
4. 复查真实页面播放、设备流程和服务端日志；完成后再勾选 A4 的相应外部验收项。A6 与 B 阶段另按计划推进。
