# S0/S1 本地兼容性与验收记录

> 后续进展：本机 Codex 插件已安装、重新授权并通过 `list_shares`、`get_share`、`list_members` 的真实调用；以下重置后 `notLoggedIn` 是当时的历史状态。新证据见 [B 阶段本机 Codex 验证](B_CODEX_LOCAL.md)。

> 后续需求修正：允许名单和成员禁用不再限制登录，当前公司用户自动加入。本文保留原真实客户端测试证据，不代表新策略已重做真实 Google/客户端验收；新自动化验证见 [公司账号自动加入](DOMAIN_SIGN_IN.md)。

日期：2026-09-27（America/New_York）。

**交付范围：本地实现，先确保 Codex 贯通。** Google 登录、网页分享、Codex OAuth 授权及实际工具查询均已通过，满足本次约定的本地交付范围。用户确认暂缓 Claude Code/Cursor 客户端验收，以及 HTTPS 部署、私有仓库配置。原计划“三个真实客户端查询同一条网页分享”的完整退出条件仍保留，不自动进入 A/B 全量开发。

## 运行基线

| 项目 | 实际版本/配置 |
| --- | --- |
| Node | 24.21.0 |
| pnpm | 11.25.0 |
| Next / React / TypeScript | 16.3.6 / 19.3.0 / 5.9.3 |
| Better Auth / MCP / OAuth Provider / CIMD | 1.7.6 |
| MCP TypeScript client/server SDK | 2.1.0 |
| Drizzle ORM / pg-boss | 0.45.3 / 12.35.0 |
| PostgreSQL | Docker `postgres:17.9`，loopback 55432 |
| Web / MCP | `http://localhost:3000` / `/mcp` |
| Google | Workspace `authright.com`，Internal Web application，基本身份权限 |
| 管理员 | `tao.xu@authright.com`，明确 bootstrap 后绑定身份 |

依赖精确版本以 package.json 与 pnpm-lock.yaml 为准。ESLint 暂锁 9.39.5，与当前 Next ESLint 插件的 peer 范围一致；后续工具链维护时再升级，不直接忽略 peer 冲突。

## 已验证

- 全新本地数据库迁移、隔离测试库迁移和 pg-boss queue 创建；管理员 bootstrap 幂等。
- 浏览器真实 Google 登录成功；Tao Xu 被绑定为 active admin，没有使用测试登录旁路。
- 浏览器提交 `https://www.better-auth.com/docs/introduction` 成功；记录显示 Tao Xu、真实分享时间、queued 状态。该测试链接保留在本地资料库。
- 官方 SDK 通过真实本地 HTTP 完成 legacy 初始化及 `2026-07-28` pinned 连接，列出 `list_shares` / `get_share` 并读取网页接口创建的记录。
- 自动化测试中的完整 OAuth 链路：发现、公开 DCR、native loopback redirect、S256 PKCE、签名 consent query、发 token、JWKS 验签、refresh、查询与撤权。
- 并发同 key 只创建一条分享；同 URL 的不同用户保留各自分享，但只有一个内容任务；故意在入队后制造任务表写入失败，实际 pg-boss job 与内容/分享一起回滚。
- 无 session、跨域写入、非成员、禁用成员、缺少 scope、错误 issuer/audience、过期/无效 token、篡改 consent query、篡改游标均被拒绝。
- 单连接撤销不影响其他 client；旧 JWT、刷新后的 JWT 立即失效，后续刷新被拒绝。配置严格 refresh rotation，`refreshTokenReuseInterval=0`。
- 13 个单元测试、8 个数据库/HTTP 集成测试；lint、TypeScript 通过。生产 Web/Worker 构建与 Worker 启动有前次验证记录，见下面的构建说明；Worker 报告 content consumption paused，不消费任务。

自动化 OAuth 测试使用仅在测试进程中直接写入隔离数据库的身份夹具；它验证协议和权限，不冒充真实 Google 或三个产品客户端的全流程结果。

## 真实客户端矩阵

### 2026-09-27：撤权后重连修正

- 已应用 `0001` 本地迁移；保留网页登录会话、历史分享及连接记录，仅清除已撤销授权的刷新链和 remembered consent。
- 数据库/HTTP 集成测试增至 8 项。覆盖同 client、同 browser session 的撤销 → 再次显示 consent → 拒绝授权 → 确认授权 → 新连接查询与刷新；旧 JWT、旧/轮换后的 refresh token 在重连后均无效，新连接不受旧凭据重放影响。
- 验证 legacy 授权兼容、并发创建同一授权只保留一条记录、其他客户端授权隔离、网页会话继续可用。
- 官方 MCP SDK 2.1.0 实际通过本机 HTTP 收到 401，尝试刷新并处理 `invalid_grant`，清除旧凭据后调用 `redirectToAuthorization`，生成带 resource 与 S256 PKCE 的 OAuth URL。测试中的浏览器身份与授权操作仍为隔离测试夹具。
- 本机 Codex app-server 在已撤销凭据下报告 `authStatus: notLoggedIn`、工具列表为空及 `OAuth authorization required`。该脚本没有调用 OAuth login，也没有桌面 UI，不能用它判断桌面是否会提示重连。
- 用户随后明确确认：Codex 会显示 reconnection 提示，点击后跳转 Sharing 网页。该客户端提示与打开网页的交互已通过人工验证；不再列为“桌面提示待验证”，也不要求用户先手动退出 Sharing 或清除凭据。
- 浏览器中的 `/account` 正常显示 revoked 历史和重连步骤，撤权没有退出 Google/Sharing 登录。重连后的新授权不会恢复旧 token；该隔离行为由数据库/HTTP 测试验证。
- 本次 lint、类型检查、13 项单元测试、8 项集成测试通过。默认 Turbopack 构建因本机进程端口权限报错；生产验证使用 Next.js 支持的 `next build --webpack`，Worker 使用 `tsc -p tsconfig.worker.json`，未修改默认构建脚本。

### 2026-09-27：首次连接重置与文档收尾复核

- 按用户要求，仅清理本地 Sharing 的 Codex 凭据、客户端注册、授权记录和 Sharing 会话，保留用户、成员和分享数据；范围与数量见 [开发指南](../DEVELOPMENT.md#首次连接测试与重置范围)。这是首次授权测试，不是 Plugin 卸载/安装验收。
- 用户随后反馈“目前看上去似乎没什么问题”，记录为首次流程人工反馈未见异常；没有据此新增逐步浏览器截图或声称两项工具均已重新执行。
- 本次重新运行 `pnpm check` 通过：lint、类型检查、13 项单元测试。`pnpm test:integration` 首次因沙箱禁止访问本机 PostgreSQL 而失败；获准访问本机数据库/测试端口后，8 项全部通过。
- `pnpm test:codex` 独立 CLI 复验返回 `authStatus: notLoggedIn`，在 initialize 时收到 `Auth required`，两项工具未执行。尚未确认它与用户桌面授权状态不一致的原因；本次没有再次登出、撤权或替用户授权。
- `codex-result.json` 的成功时间仍为 `2026-09-27T20:29:19.368Z`，属于重置前历史证据。待该 CLI 连接具有可用授权后再更新，不用旧文件冒充本次成功。
- 本次修改为文档；没有重跑或覆盖前次生产构建结论。逐项阶段判定与遗留见 [S0/S1 核对记录](S0_S1_AUDIT.md)。

| 客户端 | 本机版本 | 发现/注册 | OAuth | 实际客户端工具查询 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI / app-server | 0.158.0-alpha.2.1 | RFC 9728 / AS metadata / DCR 成功 | 历史授权成功；清理后本次独立 CLI 为 notLoggedIn | 重置前两项工具通过；本次未执行 | 历史本地链路通过，当前 CLI 复验待授权 |
| Codex 桌面交互 | 本机已安装版本，未单独记录桌面 build；不可拿 CLI 版本替代 | 本地 sharing-local 配置；本轮注册策略未抓取 | 用户确认重连提示及点击后打开网页；重置后首次流程反馈未见异常 | 本轮未另存自然语言查询结果 | 人工交互记录；不等同私有 Plugin 安装验收 |
| Claude Code | 2.1.274 | 项目 `.mcp.json` 已写入 | 客户端要求首次批准项目 MCP；尚未授权 | 未测试 | 按用户决定延后 |
| Cursor | 3.21.18 | 已准备配置样例 | 未测试 | 未测试 | 按用户决定延后 |

Codex 验证使用命令行配置覆盖，没有改写用户的全局 MCP 配置；`sharing-local` 的 OAuth 登录状态由 Codex 自己保存。配置样例：[Codex](codex-config.toml)、[Claude Code](claude-mcp.json)、[Cursor](cursor-mcp.json)。这些只是本地连接配置，不是 Plugin 发布包。

历史实际查询通过已安装 Codex 的 app-server `mcpServer/tool/call` 完成，使用临时执行上下文，没有发起模型 turn，也没有创建持久化侧栏任务。[脱敏查询证据](codex-result.json)记录了同一分享 ID、URL、分享者及真实 queued 状态；[复验脚本](../../scripts/verify-codex.mjs)可在本地服务运行且 Codex 已授权后执行 `pnpm test:codex`。若 `codex` 不在 PATH 中，用 `SHARING_CODEX_BINARY` 指定可执行文件。脚本依赖该测试链接仍在默认最近七天查询窗口内。桌面重连提示已有上述人工记录；本轮自然语言工具查询未另存证据，正式 Plugin 私有来源安装仍属于后续包装验收。

Codex 本地验证命令（若 shell 未配置 `codex` PATH，请使用 App 内置 CLI 的完整路径）：

```sh
codex -c 'mcp_servers.sharing-local.url="http://localhost:3000/mcp"' mcp login sharing-local --scopes shares:read,offline_access --oauth-client-registration dcr --no-browser
```

后续 Claude Code：在本目录启动 `claude`，审阅批准 `sharing-local`，再执行 `claude mcp login sharing-local --no-browser`。实际观察到独立 `mcp login` 不接受仅通过顶层 `--mcp-config` 临时传入的服务器，因此已按 CLI 支持的方式生成项目 `.mcp.json`；没有修改审批偏好以绕过首次确认。

后续 Cursor：将样例合并到该项目的 `.cursor/mcp.json`，在客户端完成授权并查询。不要把 localhost 配置当作同事可访问的部署地址。

## 待完成的退出条件

1. Claude Code、Cursor 实际授权，并从三个客户端分别查询网页中这条链接；记录实际协商协议、重连和刷新行为。
2. 补齐当前 CLI 授权后的 `list_shares` / `get_share` 复验；记录桌面 build、实际注册策略和协商协议。本地曾观察到 CIMD 客户端标识，但没有完整可关联的 CIMD 查询证据；不能把 DCR 通过或一条注册记录记为 CIMD 全链路通过。
3. 部署 HTTPS 测试服务，再验证远程回调、代理 origin、实际同事网络访问和生产配置。
4. 私有仓库、读权限与各客户端 Plugin 安装/更新/回滚仍留到 B4/R2；方案保持“部署服务 + 私有仓库分发”。

## 参考

- [Better Auth MCP](https://better-auth.com/docs/plugins/mcp)
- [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)
- [pg-boss transactional jobs](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)
- [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

安装版 1.7.6 未公开导出网页文档示例中的 `verifyOAuthQueryParams`。Consent 页改用该版本提供的 `getOAuthClientPublicPrelogin` 来验证签名查询，再检查当前 active member；未经验证的查询不会展示授权按钮。
