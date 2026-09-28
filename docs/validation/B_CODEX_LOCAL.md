# B 阶段：本机 Codex 支持与验证

日期：2026-09-27（America/New_York；命令输出时间为 UTC）。本轮按用户决定只做本机 Codex 支持与验证；Claude Code、Cursor、HTTPS 和私有仓库分发继续延期。

## 本机交付

- MCP 暴露 `share_link`、`list_shares`、`get_share`、`list_members`、`withdraw_share`，均调用网页共用的业务服务。OAuth 可授予 `shares:read`、`shares:write`、`members:read`；服务端每次按用户、连接和工具 scope 授权。
- Consent 页逐项显示读分享、写分享和查成员权限；新授权的连接记录保存实际授予的业务 scope。旧连接记录可能仍只有历史默认值，因此账户页暂不展示该字段。撤销连接、刷新凭据与公司邮箱检查沿用既有逻辑。
- 用户在 Consent 页选择 Allow access 时，浏览器同步打开 Sharing 首页标签页，原标签页仍跳到 Codex 提供的 loopback 回调地址以交付授权码。Codex 回调页本身由客户端生成，Sharing 不覆盖它；若浏览器拦截新标签页，原授权回跳仍正常进行。
- `plugins/sharing/` 包含 Codex 本地插件、MCP 配置、一份综合 Skill 和五份按工具分开的 Skill；`.agents/plugins/marketplace.json` 是本仓库的本地 marketplace。插件仅指向 `http://localhost:3000/mcp`，不能作为远程发布包。
- `scripts/verify-codex.mjs` 支持 `SHARING_CODEX_PLUGIN=1`，从真实插件连接读取既有分享。指定 `SHARING_CODEX_SHARE_ID` 可验证另一条已有分享；脚本显式查询分享日期，避免默认七天窗口导致样本过期。

## 已执行的验证

| 验证 | 结果 |
| --- | --- |
| 插件与 Skill 结构校验 | 通过 |
| TypeScript、ESLint | 通过 |
| 单元测试 | 47 项通过 |
| 隔离测试库集成测试 | 15 项通过；覆盖 OAuth、五个工具的业务路径、写入 key 重放、撤回隐藏、只读 token 拒绝写入和撤权重连 |
| 本机 Codex 插件来源和安装 | `sharing-local` marketplace 已注册；`sharing@sharing-local` 已安装并启用 |
| 新版插件 Skill 发现 | 重装 `0.1.0+codex.20260928041720` 后，Codex app-server 的 `skills/list` 识别 `sharing:sharing` 及五个单项 Skill；`mcpServerStatus/list` 同时识别五个 MCP 工具，连接状态为 `oAuth` |
| 本机 Codex OAuth | 用户完成 Allow access；CLI 返回 `Successfully logged in to MCP server 'sharing'` |
| 撤销后重连的 scope 回归 | 曾复现自动重连只授予 `shares:read`：`list_shares` 可用，`list_members` 返回缺少权限。服务端挑战已改为请求 `shares:read shares:write members:read`，保留按工具逐项校验。运行中 `/mcp` 的未登录响应已确认完整挑战；隔离库 15 项集成测试通过。2026-09-28 再次通过 Codex OAuth 获取三项业务 scope，安装版 app-server 对 `get_share`、`list_shares`、`list_members` 的真实只读调用均通过 |
| 授权后浏览器体验 | 桌面 Chromium E2E 使用真实 DCR 和 Consent 页验证：Sharing 首页在新标签页可用，原标签页收到授权码并到达客户端回调 |
| 安装版 Codex app-server | 识别插件连接 `sharing` 和五个工具；`authStatus: oAuth`；真实调用 `get_share`、`list_shares`、`list_members` 读取已有数据，通过；证据见 `codex-result.json` |
| 临时 Codex CLI 自然语言试用 | 只读提问按姓名查分享时，Codex 加载 Sharing Skill、调用 `list_members`，发现两个同名候选后请求邮箱消歧；未替用户猜测身份。该会话未继续到分享查询 |
| Codex 桌面新聊天 | 用户反馈按 `tao.xu@authright.com` 和纽约时间 2026-09-27 查询，返回原始链接 `https://www.better-auth.com/docs/introduction`，与 app-server 读取的分享一致；未另存桌面工具调用轨迹 |

真实 Codex app-server 本轮只对现有业务数据执行只读查询。三个新工具由官方 MCP SDK 连接隔离测试服务调用通过；单项 Skill 已完成结构校验和安装版发现验证，尚未逐项进行自然语言调用。Codex 桌面的写工具调用及插件更新/回退尚未单独验收。因此本记录不宣称 B5 的全部客户端体验通过，也不将本地插件安装当作私有仓库分发验收。

OAuth 的客户端注册允许三项业务 scope，并不表示每次授权都实际请求三项。先前 `/mcp` 的挑战只列出 `shares:read`，导致一次撤销后的重连只产生只读授权；现有只读 token 不会因代码更新而自动扩权，需要重新授权。两个 Sharing Skill 入口复用同一个 MCP 连接，因此受到同一 token 权限限制。

后续检查发现，桌面会话仍可持有此前的只读连接，即使单独运行的 Codex app-server 已使用新凭据通过查询。因此 `list_members`、`share_link`、`withdraw_share` 现在在权限不足时返回带所需 scope 的标准 HTTP 403 OAuth 挑战；隔离库集成测试覆盖 `members:read` 和 `shares:write` 两条路径。用户随后在桌面插件界面重新授权并确认看到了查找团队成员权限；当前桌面会话再次调用 `list_members` 已成功返回两条同名成员记录，可区分为 `tao.xu@authright.com` 与 `tao@authright.com`。

## 本机复验

先运行 `pnpm dev`，确认 `http://localhost:3000/api/health` 可用。Codex 从本仓库 marketplace 安装插件后，在 Sharing 授权页确认所需权限。新 Codex 会话才能加载更新后的 Skill 和工具。

```sh
codex plugin marketplace add '/absolute/path/to/Sharing'
codex plugin add sharing@sharing-local
codex -c 'mcp_servers.sharing.url="http://localhost:3000/mcp"' mcp login sharing --scopes shares:read,shares:write,members:read,offline_access --oauth-client-registration dcr
SHARING_CODEX_PLUGIN=1 pnpm test:codex
```

这些命令只用于本机开发。安装后打开新的 Codex 聊天，可直接输入 `$sharing:list-shares 查询最近七天团队分享了什么`。其它单项入口为 `$sharing:get-share`、`$sharing:list-members`、`$sharing:share-link`、`$sharing:withdraw-share`；综合入口为 `$sharing:sharing`。Skill 负责指导 Codex 调用对应的 Sharing MCP 工具，实际读写和授权仍由 MCP 服务处理。Skill 名称使用连字符，插件安装后由 Codex 加上 `sharing:` 命名空间，因此不是 `$sharing_list_shares`。Token、Google 凭据和数据库配置均不进入插件文件。
