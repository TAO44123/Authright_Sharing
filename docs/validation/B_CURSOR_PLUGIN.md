# Cursor Plugin 0.4.0 验收

日期：2026-09-30。本机 Cursor `3.21.18`，macOS x64。
分发仓库：`https://github.com/TAO44123/Authright_Sharing_Plugin.git`。
已推送提交：`f66331da372aa2a290e16cc9a73a0480fa53fea0`（`main`）；分发工作区干净，推送后的 `origin/main` 与本地 HEAD 一致。

## 本轮已完成

- 新增 `.cursor-plugin/marketplace.json` 和 `plugins/sharing/.cursor-plugin/plugin.json`。Cursor manifest 显式引用 `./.mcp.json` 和 `./skills/`。
- Codex / Claude Code / Cursor 均为 `0.4.0`，复用相同六个 Skill 和 `https://sharing.authright.com/mcp`。
- 导出脚本验证三个客户端版本和路径；17 个分发文件一致性检查通过。
- 本地安装脚本从发布目录复制 10 个插件文件到 `~/.cursor/plugins/local/sharing/`；逐文件与源比对通过，隐藏 manifest 和 MCP 文件均包含。
- 安装器的 6 项自动测试通过：安装、备份更新及旧版恢复、拒绝错误源、拒绝覆盖其他插件、拒绝符号链接、可恢复卸载。更新/卸载保留原目录，自定义文件保存在备份中。
- `pnpm check` 通过：ESLint、客户端/服务端边界、TypeScript、11 个测试文件共 73 项单元测试。
- Claude marketplace 严格校验通过。此项只验证 Claude 包结构，不充当 Cursor 格式的官方校验。

安装器只处理插件文件，不读取或复制 OAuth 凭据，不修改用户 MCP 配置，不启动 Sharing 本地服务。安装或更新后需要重载 Cursor；文件存在不能代表客户端已经加载。

## 等待界面与账号验收

### 2026-09-30 OAuth 故障定位

用户反馈点击授权不打开浏览器。Cursor 当日日志显示插件连接
`plugin-sharing-sharing` 已创建，但 DCR 返回：
`web clients require https redirect URIs on non-loopback hosts: cursor://anysphere.cursor-mcp/oauth/callback`。
生产注册端点复现 HTTP 400 / `invalid_redirect_uri`；这是打开浏览器之前的服务端注册失败，尚无证据表明本机弹窗权限是本次原因。

应用修复提交 `36f0b70` 为 OAuth Provider 1.7.6 添加版本固定的 pnpm 补丁，范围及升级移除条件见 `patches/README.md`。仅兼容 Cursor 已知回调与 public-client 注册组合，不放宽一般回调校验。3 项 OAuth 集成测试通过（包含 PKCE、用户同意及撤权），静态检查与 73 项单元测试通过。完整 core 集成测试有一条旧视频摘要音轨覆盖断言失败，与 OAuth 无关，未算作通过。

服务端修复不改变 Plugin `0.4.0` 文件，不要求用户重新安装插件。生产部署结果与 Cursor 重试结果分别追加记录。

2026-09-30 17:18 EDT：服务端 `36f0b70` 已构建并部署，Web 容器 healthy，Worker 保持 `sharing:6581554` 运行，本轮无数据库迁移。部署前配置备份为 `/etc/sharing/lightsail.env.pre-cursor-oauth-20260930T211526Z`，数据库备份为 `/home/ubuntu/sharing-backups/sharing-pre-cursor-oauth-20260930T211526Z.dump`（pg_restore 目录检查通过）。生产 SHARING_IMAGE 已设为新镜像，后续整体 up 会让 Worker 使用兼容的新镜像。

生产检查：原始 Cursor DCR 失败由 HTTP 400 变为 201，返回 `application_type:native` 且无 client secret；未登录授权请求返回指向生产 `/sign-in` 的 JSON redirect（fetch 模式为 HTTP 200）；三种错误回调组合仍返回 400，未授权 MCP 仍返回 401，health 200。检查仅创建无用户授权的诊断客户端，没有登录用户或写业务分享。结果在 `.local/deployments/36f0b70-cursor-oauth/verification.json`。用户需重载 Cursor 重试，实际浏览器打开、Google 登录、回跳和工具调用尚待确认。

- 在 Cursor 执行 Developer: Reload Window，确认 Customize 中的 Sharing、六个 Skill 和 MCP 连接。
- 完成公司 Google 登录和 Sharing OAuth，验证五个工具、分页、时间筛选及权限。
- 测试令牌刷新、客户端重启恢复、Sharing 账户撤权后重连。
- 使用专门测试链接验证分享、幂等重试及撤回。
- 团队套餐、Allow Local Plugin Imports 策略、私有仓库读取权限和团队 marketplace 导入。
- 同名 marketplace 插件优先级、真实客户端版本更新/回退，以及 Codex / Claude `0.4.0` 运行时回归。

用户已反馈 Claude 上一版“测试没问题”，记录于 B_CLAUDE_PLUGIN.md；不据此推断 Cursor 验收或所有 OAuth 边界测试已经通过。

## 2026-09-30 localhost 回调补充修复

用户 17:21–17:23 日志仍返回 `web clients require https redirect URIs on non-loopback hosts: http://localhost:8787/callback`，连续重试另触发 429。前一补丁只在存在旧 `cursor://` 回调时推断 native，漏掉当前桌面 loopback 模式。

本机 Cursor MCP 进程源码显示，loopback 模式的注册列表可以仅为 HTTPS agents 回调与 localhost，也可追加 127.0.0.1 回调。已先用桌面列表测试复现与用户一致的 400，再扩展受限回调集合与 native 推断条件。应用提交 `5b97020` 覆盖旧协议、桌面 loopback、IPv4 和单独 loopback 列表；显式 web、confidential、混入其他地址或不同端口/路径仍拒绝。未降低限流。

验证：7 项 OAuth 集成测试通过（包括 5 组 Cursor 回调各自的注册、PKCE、用户同意及未注册回调拒绝）；`pnpm check` 静态检查及 73 项单元测试通过。真实 Cursor 浏览器打开、公司 Google 登录及工具连接仍待用户重试确认。

2026-09-30 17:36 EDT：`sharing:5b97020` 已部署，Web healthy。备份：`/etc/sharing/lightsail.env.pre-cursor-oauth-20260930T213543Z` 和 `/home/ubuntu/sharing-backups/sharing-pre-cursor-oauth-20260930T213543Z.dump`。线上 localhost 与 IPv4 注册均 HTTP 201/native，授权请求指向生产 `/sign-in`，三个非法回调组合仍 400，未授权 MCP 401，健康检查 200。结果：`.local/deployments/5b97020-cursor-oauth/verification.json`；未替用户完成登录，真实 Cursor 连接仍待确认。

## 安装、更新和恢复

分发仓库内运行 `node scripts/install-cursor-plugin.mjs`；应用仓库可用 `pnpm plugin:cursor:install`。

更新前将旧安装移到 `~/.cursor/plugins/backups/sharing/<时间-随机标识>/`，备份位于 `local/` 外，避免 Cursor 自动发现第二份插件。安装脚本 `--source <backup-directory>` 恢复备份内的发布文件；额外自定义文件保留在原备份，需另行恢复。`--uninstall` 将整个安装移入备份，服务端撤权单独完成。

安装脚本提供 `--target <directory>` 供隔离文件操作测试，不表示 Cursor 会自动发现任意目录。默认安装依赖组织允许 Local Plugin Imports，脚本不改变组织策略。

参考：[Cursor 插件格式](https://cursor.com/docs/reference/plugins)、[本地安装与团队目录](https://cursor.com/docs/plugins)。
