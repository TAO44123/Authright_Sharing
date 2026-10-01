# Sharing Plugin：连接生产服务

2026-10-01 文档更新：仓库内 Cursor / Claude Code / Codex Plugin 源版本为 `0.4.0`，默认 MCP 地址为 `https://sharing.authright.com/mcp`。用户电脑上的 Plugin 只包含使用说明与 MCP 连接配置；Web、Worker、数据库以及 Gemini / YouTube 调用均在已部署服务运行。使用 Plugin 不需要在电脑启动 `pnpm dev`、Worker 或 Docker。

## 当前包与分发范围

- `plugins/sharing/.mcp.json`：生产 MCP 连接，名称仍为 `sharing`。
- `plugins/sharing/.codex-plugin/plugin.json`：Codex Plugin 版本和展示信息。
- `plugins/sharing/.claude-plugin/plugin.json`：Claude Code Plugin 版本和展示信息。
- `.claude-plugin/marketplace.json`：Claude Code marketplace。
- `plugins/sharing/.cursor-plugin/plugin.json`：Cursor Plugin 声明。
- `.cursor-plugin/marketplace.json`：Cursor 团队 marketplace。
- `scripts/install-cursor-plugin.mjs`：本地安装、更新备份、恢复和卸载。
- `plugins/sharing/skills/`：综合 Skill 与五个工具的单项 Skill。
- `.agents/plugins/marketplace.json`：当前从此 checkout 安装的开发 marketplace。

应用仓库开发 marketplace 的技术名称保留 `sharing-local`，避免更换现有安装身份；这里的 local 指 Plugin 包来源是本地 checkout，服务连接已经是生产 HTTPS。独立仓库 [Authright_Sharing_Plugin](https://github.com/TAO44123/Authright_Sharing_Plugin) 的团队目录源名称为 `authright-sharing`。2026-09-30 首次发布 Codex `0.2.0`（`46c45fa`），随后发布 Claude `0.3.0`（`5ecbb14`）与三端 `0.4.0`（`f66331d`）。已有安装缓存不会因为修改仓库文件或 Git push 自动更新。

OpenAI 官方文档仍支持现有 `.codex-plugin/plugin.json` 兼容格式。本次沿用已安装客户端验证过的布局；后续面向更多客户端的 portable manifest 与私有分发单独推进。

## 更新或安装开发包

从包含最新源文件的仓库目录安装。首次登记 marketplace 时，将路径换成实际 checkout 根目录：

```sh
codex plugin marketplace add '/absolute/path/to/Sharing'
codex plugin add sharing@sharing-local
```

已登记相同来源的用户直接安装更新的包，并在客户端插件界面核对版本是否为 `0.4.0`。如果安装操作仍显示旧缓存版本，在插件界面更新或重新安装 Sharing；重新安装会影响该插件当前连接，完成后需要再次授权。不要手工编辑 Codex 的缓存文件。

Git marketplace 的刷新命令为 `codex plugin marketplace upgrade <marketplace-name>`；当前本地 checkout 来源直接使用更新后的文件，不通过该命令拉取 Git 快照。上述步骤用于应用仓库开发安装；独立 Git 来源安装方法见下一节，干净环境安装及权限验收尚未完成。

安装后打开新的 Codex 聊天，确保加载最新工具和 Skill。确认实际连接地址为 `https://sharing.authright.com/mcp`，避免把旧 localhost 缓存当作生产连接。

## 从独立 Plugin 仓库安装

```sh
codex plugin marketplace add TAO44123/Authright_Sharing_Plugin --ref main
codex plugin add sharing@authright-sharing
```

安装者需要相应仓库读取权限；若使用私有来源，先配置 GitHub HTTPS / SSH 认证。迁移已有开发安装时，关闭旧 `sharing-local` 来源的 Sharing，再启用 `authright-sharing` 来源的 Sharing，避免重复同名连接。上传没有自动修改本机已安装 Plugin。安装、更新和卸载说明见 [分发仓库 README](https://github.com/TAO44123/Authright_Sharing_Plugin#readme)。

## Claude Code 安装

在终端执行：

```sh
claude plugin marketplace add TAO44123/Authright_Sharing_Plugin
claude plugin install sharing@authright-sharing
claude plugin details sharing
```

启动新的 Claude Code 会话，在 `/mcp` 选择插件提供的 Sharing 连接完成 OAuth。然后执行 `/sharing:list-members 展示所有成员列表` 和 `/sharing:list-shares 查询最近七天团队分享了什么`。插件连接生产 HTTPS，不启动本地 Sharing 服务。

更新：先运行 `claude plugin marketplace update authright-sharing`，再运行 `claude plugin update sharing@authright-sharing`，重启会话并检查版本。卸载使用 `claude plugin uninstall sharing@authright-sharing`，服务端撤权在 Sharing 账户页单独完成。

Claude Code `2.1.274` 的严格格式校验、本地目录安装和六个 Skill / 一个生产 MCP 的组件检查已通过。Git 来源干净安装也已通过（`0.3.0` / `5ecbb14`）；实际 OAuth/工具调用分开记录于 [Claude 验收](validation/B_CLAUDE_PLUGIN.md)。桌面/IDE 不自动继承 CLI 验收结论。

三个客户端共用 Skill 和 `.mcp.json`，只有 manifest/marketplace 格式不同。发布模板位于 `plugins/distribution/`：

```sh
pnpm plugin:export /absolute/path/to/Authright_Sharing_Plugin
pnpm plugin:export --check /absolute/path/to/Authright_Sharing_Plugin
```

脚本核对版本与生产 URL，只导出 17 个指定文件，拒绝带有额外文件或符号链接的目标目录。源文件修正了 `get_share` 的视频覆盖说明和 `list_members` 的全员列表说明；这两处服务端工具描述随应用源码提交，尚未包含在生产 `5b97020` 镜像中，需要下次 Web 部署后才在线上生效；本轮文档与源码推送不自动部署服务。

## Cursor 桌面安装

从分发仓库执行 `node scripts/install-cursor-plugin.mjs`，或在应用仓库执行 `pnpm plugin:cursor:install`。脚本安装到 `~/.cursor/plugins/local/sharing/`，更新前将旧目录移到 `~/.cursor/plugins/backups/sharing/`；`--uninstall` 可恢复卸载，`--source <backup-directory>` 可恢复旧版发布文件。自定义文件保留在备份中。

在 Cursor 执行 **Developer: Reload Window**，通过 Customize 检查 Sharing 并发起 MCP OAuth，然后询问“使用 Sharing 展示所有成员列表”。生产 MCP 地址不变。组织需允许本地插件导入，同名 marketplace 安装会优先于本地副本。

Teams / Enterprise 可从 Dashboard → Plugins & MCPs 导入分发仓库；本次添加 `.cursor-plugin/marketplace.json`，未自动创建团队目录或更改组织策略。详细安装说明见分发仓库 README；结果见 [Cursor 验收](validation/B_CURSOR_PLUGIN.md)。

## 生产账号授权

从客户端 Sharing 插件连接设置发起授权。在浏览器中进入生产 Sharing，使用目标 `@authright.com` Google 账号登录，核对账号和权限后选择 **Allow access**。

所需业务权限为 `shares:read`、`shares:write`、`members:read`；客户端需要刷新令牌时还会申请 `offline_access`。对于 Codex CLI 排障，可以显式选择生产地址和当前已验证过的 DCR 注册流程：

```sh
codex -c 'mcp_servers.sharing.url="https://sharing.authright.com/mcp"' \
  mcp login sharing \
  --scopes shares:read,shares:write,members:read,offline_access \
  --oauth-client-registration dcr
```

该命令只覆盖本次 CLI 连接配置；它不更新已安装 Plugin 的 MCP 地址。必须先确认已安装包的版本与地址。CLI 登录成功也不能单独代替桌面新聊天的实际调用验收。

本地服务的 OAuth 令牌不能直接当作生产令牌使用。已登录的 localhost 网页会话也不等于生产网页登录。OAuth 回跳仍可能出现 `http://127.0.0.1:<临时端口>/callback/...`：这是客户端临时接收授权码的地址，服务和数据仍位于生产域名。

Plugin 不携带 Google Client Secret、Gemini / YouTube Key、数据库配置或个人令牌。Google 网页登录和客户端 MCP 授权是两条独立流程。

## Cursor 授权失败排障

2026-09-30 服务端提交 `36f0b70`、`5b97020` 修复了 Cursor public-client 注册缺省 application_type 时的兼容问题。旧 `cursor://anysphere.cursor-mcp/oauth/callback`、桌面 `http://localhost:8787/callback` 与 IPv4 `http://127.0.0.1:8787/callback` 的明确组合现在可注册为 native；补丁范围见 [OAuth 补丁](../patches/README.md)。当前 Web 部署记录为 `sharing:5b97020`，插件仍为 `0.4.0`。

若日志包含 `web clients require https redirect URIs on non-loopback hosts`，失败发生在客户端动态注册阶段，早于浏览器打开。此轮错误不是弹窗权限证据。修复部署后执行 **Developer: Reload Window**，再从 Sharing MCP 连接点击授权，无需重装插件。连续重试后的 `429` 表示限流，暂停点击、等限流窗口结束再试；不修改 Google 回调或停用服务端限流。

生产验证已确认 localhost/IPv4 注册为 HTTP 201/native、授权请求指向 `/sign-in`、非法组合仍 400、未授权 MCP 401。真实 Cursor 浏览器打开、Google 登录、回跳及工具调用仍待确认，见 [Cursor 验收](validation/B_CURSOR_PLUGIN.md)。

## 使用与只读验证

在新的 Codex 聊天先验证现有数据：

```text
$sharing:list-shares 查询最近七天团队分享了什么
$sharing:list-members 查找 tao.xu@authright.com
$sharing:get-share 查看刚才那条分享的保存详情
```

若目标分享早于默认七天窗口，在请求中明确指定日期。`get-share` 根据目标分享的真实 ID 查询；生产数据与本地测试数据各自独立。

本项目的 Codex app-server 脚本可检查已安装插件是否加载六个 Skill、五个工具以及 OAuth 状态：

```sh
SHARING_CODEX_PLUGIN=1 SHARING_CODEX_INVENTORY_ONLY=1 pnpm test:codex
```

该检查不发起模型对话、不写分享，也不更新旧的 `codex-result.json`。它检查安装清单与认证状态，不能代替真正的 `list_shares`、`get_share`、`list_members` 查询。现有脚本的完整查询模式默认使用历史本地样本 ID 并覆盖历史证据文件；本轮生产验收先通过桌面实际只读调用记录，不直接使用其默认完整查询模式。

新版视频摘要通常覆盖语音和采样画面；历史音轨摘要可能只覆盖声音。三个查询 Skill 已改为根据返回的 `content_scope_note` 说明范围，保留 `full_content_available:false` 的边界。

## 本轮检查与后续工作

2026-09-30 已从本机通过 HTTPS 复查：

| 检查 | 结果 |
| --- | --- |
| `/api/health` | HTTP 200，`status:ok`，`database:reachable` |
| `/.well-known/oauth-protected-resource/mcp` | HTTP 200，resource 与授权服务器均使用生产域名，支持三项业务 scope |
| `/.well-known/oauth-authorization-server/api/auth` | HTTP 200，issuer、token、authorize、JWKS、registration 均使用生产域名；支持 DCR、CIMD、S256 和刷新令牌 |
| 未带凭据 POST `/mcp` | HTTP 401，要求认证 |

后续客户端证据：Claude 用户反馈“测试没问题”；2026-09-30 17:37 EDT，本 Codex 桌面聊天通过已加载的 Sharing `0.4.0` 连接成功执行 `list_shares`，返回生产七天窗口内 5 条分享且无下一页。该结果不替代其他工具、写入、刷新、撤权或 Git 来源安装验收。Cursor 真实浏览器登录与工具调用仍待确认。

首次 `0.2.0` 独立仓库上传仅包含八个 Plugin/Skill 文件、marketplace、README、CHANGELOG 和 .gitignore；已核对目录白名单、源文件一致性、六个 Skill 格式及真实凭据未进入产物。没有创建 Git 发布标签，也没有修改仓库可见性或访问权限。

接下来的验收依次为：从 Git 来源安装新版并重新授权、生产只读工具查询、按用户明确指定的测试链接验证提交和撤回、刷新与撤权重连、团队仓库权限和安装更新/回退流程。服务端 API 保持与网页共用；完善 Plugin 主要在客户端说明、分发和验收层进行。

参考：[OpenAI Plugin 包装与 marketplace](https://developers.openai.com/plugins/build/plugins)、[OpenAI 官方 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[早期本地验收](validation/B_CODEX_LOCAL.md)、[生产部署](DEPLOY_LIGHTSAIL.md)。
