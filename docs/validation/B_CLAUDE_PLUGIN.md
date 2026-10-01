# Claude Code Plugin 0.3.0 验收

日期：2026-09-30。客户端：本机 macOS Claude Code `2.1.274`。

分发仓库：`https://github.com/TAO44123/Authright_Sharing_Plugin.git`。
已推送并从 Git 来源实际安装的提交：`5ecbb14c945c296480f096e7cc0c25eed5fa1755`。
Plugin：`sharing@authright-sharing`，版本 `0.3.0`。

## 已完成

| 检查 | 证据 / 结果 |
| --- | --- |
| Plugin 格式 | `claude plugin validate plugins/sharing --strict` 通过 |
| 分发 marketplace 格式 | `claude plugin validate <distribution-root> --strict` 通过，无警告 |
| Skill 格式 | `quick_validate.py` 检查六个 Skill 全部通过 |
| 本地目录安装 | 在独立 `CLAUDE_CONFIG_DIR` 添加本地 marketplace 并安装成功 |
| Git 来源干净安装 | 第二个独立 `CLAUDE_CONFIG_DIR`，通过 `claude plugin marketplace add TAO44123/Authright_Sharing_Plugin` 和 `claude plugin install sharing@authright-sharing` 成功安装 |
| Git 快照 | 客户端克隆的 HEAD 为上述 `5ecbb14`，与推送提交一致 |
| 加载清单 | `claude plugin details sharing` 显示六个 Skill、一个 MCP 连接、零 agent/hook |
| 启用及地址 | `claude plugin list --json` 显示 `enabled:true`、`version:0.3.0`，MCP 为 HTTP / `https://sharing.authright.com/mcp` |
| 导出一致性 | `pnpm plugin:export --check <distribution-root>` 通过；对 Claude 从 GitHub 克隆的目录也通过，14 个文件与源一致 |
| 导出失败场景 | 实际运行验证内容漂移检测、额外 `.env` 文件拒绝、符号链接拒绝；失败时未覆盖原有文件或链接目标 |
| 应用检查 | `pnpm check` 通过：ESLint、客户端/服务端边界、TypeScript、10 个文件共 67 项单元测试 |

本机 GitHub 简写最初尝试 SSH，随后 Claude 自动切换到 HTTPS 并成功克隆。沙箱中的网络解析、tsx IPC 被限制后，经过授权在沙箱外完成相应检查。这些限制不属于插件格式错误。

两个安装验证均使用临时独立配置和工作目录，没有给用户常用 Claude 配置安装插件，没有复制现有 OAuth 凭据，也没有启动模型会话或向团队发送测试分享。当前本机仓库访问成功不代表其他成员的仓库权限已验证。

## 用户反馈

2026-09-30：用户反馈“测试没问题”，确认 Claude 使用测试正常。未提供逐项测试记录，不据此自动完成刷新、撤权、五工具写入或跨版本回退验收。

## 逐项验收记录仍需补充

- 公司 Google 登录与首次 Sharing OAuth，确认 `shares:read`、`shares:write`、`members:read`，及刷新所需的 `offline_access`。
- 从插件连接实际调用 `list_members`、`list_shares`、`get_share`，验证分页和时间范围。
- 按用户指定的测试链接调用 `share_link`、`withdraw_share`，检查幂等重试和归属限制。
- 令牌刷新、账户页撤权后重连。
- 跨版本更新/回退与非开发成员安装；Claude 第一版为 `0.3.0`，此前 `0.2.0` 仅支持 Codex。
- Claude 桌面/IDE 界面与 Codex `0.3.0` 的实际生产业务回归。

`plugin details` 只发现 MCP 连接配置，工具 schema 在运行时解析，不能据此宣称五个工具已调用成功。当前校验器版本早于官方文档所述的 `2.1.281` 增强 MCP 校验；本项目另外通过导出脚本验证了生产 MCP JSON，并通过安装清单确认实际加载地址。

用户下一步在常用终端执行：

```sh
claude plugin marketplace add TAO44123/Authright_Sharing_Plugin
claude plugin install sharing@authright-sharing
```

开启新的 Claude Code 会话，输入 `/mcp` 并选择 Sharing 插件连接完成授权；随后运行 `/sharing:list-members 展示所有成员列表`。OAuth/工具调用结果应追加到本记录，不覆盖本次安装证据。

## 服务端与客户端变更边界

本次应用源文件 `src/server/mcp.ts` 修正了两个工具描述：视频摘要使用 `content_scope_note` 判断覆盖范围，成员查询可省略 `query`。业务处理、授权与 schema 未改动。这两个描述修正尚未部署到生产，需随下一次 Web 服务部署生效；插件发布不包含服务端源码。

Codex marketplace 保持原字段语义，共享 MCP 地址不变，版本与共享 Skill 同步更新。六个 Skill 格式已验证；本次没有把 Codex 历史调用证据当作 `0.3.0` 的生产回归结果。

参考：[Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces)、[插件格式与校验范围](https://code.claude.com/docs/en/plugins-reference)、[配置隔离](https://code.claude.com/docs/en/settings)。
