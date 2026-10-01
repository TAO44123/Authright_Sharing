# Authright Sharing Plugin

通过 **Cursor、Claude Code 或 Codex** 查询和分享团队链接。当前 Plugin 版本：**0.4.0**。

MCP 地址：`https://sharing.authright.com/mcp`。Web、Worker、数据库和 Gemini / YouTube 调用均在服务器运行，使用插件无需启动本地 Sharing 服务或 Docker，无需填写 API Key。

本仓库是分发产物；开发源位于 [Authright_Sharing](https://github.com/TAO44123/Authright_Sharing) 的 `plugins/`。三个客户端共用六个 Skill 和 MCP 配置，分别使用自己的插件声明和 marketplace。本版增加 Cursor 桌面端安装支持；Claude 网页版和 Cowork 尚未纳入验收。

## Cursor 桌面端安装

前提：Cursor 支持本地 Plugin 导入，安装脚本需要 Node.js 22 或以上；本机客户端验证基线为 `3.21.18`。首次在终端执行：

```sh
git clone https://github.com/TAO44123/Authright_Sharing_Plugin.git
cd Authright_Sharing_Plugin
node scripts/install-cursor-plugin.mjs
```

脚本将插件复制到 `~/.cursor/plugins/local/sharing/`，包括隐藏 manifest、MCP 配置及六个 Skill。随后在 Cursor 命令面板运行 **Developer: Reload Window**，打开 **Customize** 检查 Sharing 的组件，并在 MCP 连接界面完成公司 Google 登录与 Sharing 授权。先发送“使用 Sharing 展示所有成员列表”验证只读查询；六个 Skill 可从技能选择界面调用，显式名称以实际界面为准。

更新已有克隆和安装：

```sh
git pull --ff-only
node scripts/install-cursor-plugin.mjs
```

重载 Cursor 后核对版本。更新前自动将旧安装完整移到 `~/.cursor/plugins/backups/sharing/<时间-随机标识>/`，不会把备份当作第二个插件加载。脚本输出实际备份路径；失败时恢复原安装。若需回退发布文件：

```sh
node scripts/install-cursor-plugin.mjs --source '/absolute/path/to/previous-backup'
```

此命令恢复备份里的已知 Plugin 文件，额外自定义文件仍保存在原备份中。Cursor 首个适配版本是 `0.4.0`，`0.3.0` 包没有 Cursor manifest，不能用来回退 Cursor。

本地卸载会将安装移入备份，可恢复：

```sh
node scripts/install-cursor-plugin.mjs --uninstall
```

卸载后重载 Cursor；若需撤销业务访问，在 Sharing 账户页单独撤销连接。

### Cursor 团队 marketplace

Teams / Enterprise 可在 Dashboard → **Plugins & MCPs** 通过 **Import from Repo** 导入本仓库，选择 Sharing 的可见范围与安装方式，同事随后从 Customize 安装。仓库根的 `.cursor-plugin/marketplace.json` 指向 `plugins/sharing/`。团队目录接入需要相应套餐、仓库权限和管理权限，未执行导入前不视为团队分发验收通过。

组织可能限制 **Allow Local Plugin Imports**，Enterprise 默认关闭；管理员需允许后才能本地加载。已有同名 marketplace 插件会优先于本地副本，排障时核对安装来源。请复制真实目录，不要创建指向插件仓库的外部符号链接。MCP 服务始终是生产 HTTPS，本地插件不需要运行 Sharing Web 或 Worker。

## Claude Code 安装

前提：已安装支持 Plugin 的 Claude Code，拥有本仓库读取权限，并使用 `@authright.com` 公司 Google 账号授权。开发校验基线为 Claude Code `2.1.274`。

在终端执行：

```sh
claude plugin marketplace add TAO44123/Authright_Sharing_Plugin
claude plugin install sharing@authright-sharing
claude plugin list
claude plugin details sharing
```

确认版本为 `0.4.0`，组件包含六个 Skill 和一个 Sharing MCP 连接。随后启动新的 Claude Code 会话，输入 `/mcp`，选择 Sharing 插件提供的连接并发起认证。在浏览器使用公司 Google 账号登录 Sharing，核对账号与权限后点击 **Allow access**。

返回 Claude，执行只读查询：

```text
/sharing:list-members 展示所有成员列表
/sharing:list-shares 查询最近七天团队分享了什么
```

安装会使用用户作用域。同事使用私有仓库时，需要先配置 GitHub HTTPS 或 SSH 读取权限；SSH 来源可使用 `git@github.com:TAO44123/Authright_Sharing_Plugin.git`。GitHub 仓库权限与 Sharing 业务授权独立。

如已有手动配置的 Sharing MCP 或其他来源的同名插件，先在 `/mcp`、`/plugin` 确认连接来源，避免旧连接覆盖插件连接。验收必须使用插件所提供的生产连接。

## Codex 安装

```sh
codex plugin marketplace add TAO44123/Authright_Sharing_Plugin --ref main
codex plugin add sharing@authright-sharing
```

在插件页面确认版本 `0.4.0` 和生产 MCP 地址，从 Sharing 连接设置发起 OAuth，完成公司 Google 登录与授权后打开新的聊天：

```text
$sharing:list-members 展示所有成员列表
$sharing:list-shares 查询最近七天团队分享了什么
```

此前使用 `sharing-local` 开发目录的用户，迁移时关闭旧来源下的 Sharing，再启用 `authright-sharing`，避免重复连接。已有安装缓存不会因为 Git push 自动更新。

## 六个指令入口

| Claude Code | Codex | 功能 |
| --- | --- | --- |
| `/sharing:sharing` | `$sharing:sharing` | 综合入口，根据需求组合下面的操作。 |
| `/sharing:list-shares` | `$sharing:list-shares` | 按时间、成员、关键词查询分享并分页；默认最近七天。 |
| `/sharing:get-share` | `$sharing:get-share` | 查看一条分享的来源、分享者、处理状态和已保存摘要。 |
| `/sharing:list-members` | `$sharing:list-members` | 列出所有成员，或按姓名、邮箱查询并消除同名歧义。 |
| `/sharing:share-link` | `$sharing:share-link` | 按用户要求提交指定链接，归属当前授权用户。 |
| `/sharing:withdraw-share` | `$sharing:withdraw-share` | 按用户要求撤回本人指定分享。 |

视频覆盖范围以返回的 `content_scope_note` 为准：当前摘要可以使用语音和采样画面，历史摘要可能只有音轨。保存内容不等于完整文章或视频逐字稿。分享成功也不等于摘要已经处理完成。

## 授权与重连

业务权限为 `shares:read`、`shares:write`、`members:read`，刷新令牌使用 `offline_access`。安装包不包含个人令牌、Google Client Secret、模型 Key 或数据库凭据。

OAuth 回跳可能出现 `127.0.0.1` 临时端口，这是客户端接收授权码的地址，业务服务仍位于生产域名。不要把旧 localhost 服务的令牌当作生产令牌。

Cursor 从 Customize 的 MCP 连接界面重新授权；Claude 出现需要认证或权限不足时，从 `/mcp` 的 Sharing 连接重新认证；Codex 从插件连接设置重连。不要在聊天或问题报告里粘贴令牌、授权码或带敏感参数的回调 URL。

## Cursor 授权排障

2026-09-30 Sharing 服务端已部署 Cursor 回调兼容修复（应用 `5b97020`），插件版本仍为 `0.4.0`，无需为此重新安装。若日志提示 `web clients require https redirect URIs on non-loopback hosts`，错误发生在打开浏览器前的 OAuth 客户端注册阶段。执行 **Developer: Reload Window** 后，从 Sharing MCP 连接再次授权。

支持的 Cursor 桌面回调包括 `http://localhost:8787/callback`、`http://127.0.0.1:8787/callback`；这些是接收授权码的客户端地址，业务服务仍在生产 HTTPS。无需将它们加入 Google Web OAuth 客户端的回调列表。连续重试导致 `429` 时，暂停点击并等待限流窗口结束再试。

线上注册和进入登录页的验证已通过；真实 Cursor 浏览器登录、回跳及工具调用仍需实际确认。详细修复与验收见 [应用仓库 Cursor 记录](https://github.com/TAO44123/Authright_Sharing/blob/main/docs/validation/B_CURSOR_PLUGIN.md)。

## 更新、回退与卸载

Claude Code 更新：

```sh
claude plugin marketplace update authright-sharing
claude plugin update sharing@authright-sharing
```

随后重启 Claude 会话，检查实际版本和组件。Codex 先刷新目录，再在插件界面更新或重新安装：

```sh
codex plugin marketplace upgrade authright-sharing
codex plugin add sharing@authright-sharing
```

插件版本与服务端版本独立。回退时使用已记录的 Git commit/tag 克隆一个独立目录，在客户端移除当前目录源，再添加该本地目录并重新安装。切换目录来源会影响已有安装，应记录当前版本和连接状态；不要直接改客户端缓存。`0.2.0`（`46c45fa`）只有 Codex，不能用作 Claude 回退版本。Claude 首版为 `0.3.0`。

Claude 卸载命令：

```sh
claude plugin uninstall sharing@authright-sharing
```

Codex 在插件页面移除。还需要撤销数据访问权时，进入 [Sharing 账户页](https://sharing.authright.com/account) 撤销对应 Agent 连接；卸载插件不代表服务端授权已撤销。

## 验收范围

安装、加载和授权是不同的检查项。此前 `0.3.0` 在 Claude Code `2.1.274` 中已通过严格格式校验、本地目录安装、六个 Skill 和一个生产 MCP 连接的组件检查。生产服务健康检查和 OAuth 发现此前已通过；详细结果记录在应用仓库的 `docs/validation/B_CLAUDE_PLUGIN.md`。真实 Google OAuth、五工具调用、刷新、撤权重连以及跨版本更新/回退，必须完成实际操作后才能认定通过。用户已反馈 Claude 测试正常；未提供逐项结果的刷新、撤权和写入场景保持独立验收。2026-09-30 Codex 桌面通过 0.4.0 生产连接成功查询最近七天的 5 条分享；该只读查询不替代其他工具、刷新、撤权或安装来源验收。Cursor 的安装、运行时组件加载、OAuth 与业务调用分别记录于应用仓库 `docs/validation/B_CURSOR_PLUGIN.md`。仅文件校验或复制成功不能代替运行时检查。

## 维护者发布

在应用仓库修改源文件和本 README 模板，然后执行：

```sh
pnpm plugin:export /absolute/path/to/Authright_Sharing_Plugin
pnpm plugin:export --check /absolute/path/to/Authright_Sharing_Plugin
claude plugin validate /absolute/path/to/Authright_Sharing_Plugin --strict
```

导出脚本只复制白名单内文件，核对三端版本、目录入口和生产 MCP 配置；目标包含额外文件或符号链接时停止，不删除文件。提交前查看分发仓库 diff，提交并推送后，再从 Git 来源进行干净安装验证。

参考：[Cursor 插件格式](https://cursor.com/docs/reference/plugins)、[Cursor 安装与团队目录](https://cursor.com/docs/plugins)、[Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces)、[Claude 插件格式](https://code.claude.com/docs/en/plugins-reference)、[Claude MCP 与 OAuth](https://code.claude.com/docs/en/mcp)、[Codex 插件格式](https://developers.openai.com/plugins/build/plugins)。
