# Changelog

## 文档更新 — 2026-10-01

- 增加 Cursor OAuth 注册失败与重试限流的排障说明。
- 记录服务端已部署 `5b97020`；本次仅更新安装文档，插件版本维持 `0.4.0`。

## 0.4.0 — 2026-09-30

- 增加 Cursor 插件声明和 marketplace，显式引用共享 `.mcp.json`。
- 三端版本统一为 `0.4.0`，继续共用六个 Skill 和生产 MCP。
- 提供 Node.js 本地安装、更新、备份恢复和可恢复卸载脚本。
- 导出白名单扩展为 17 个文件，并验证 Cursor 路径和三端版本。
- 新增 Cursor 本地安装、团队目录接入和授权说明；运行时/OAuth 验收独立记录。

## 0.3.0 — 2026-09-30

- 增加 Claude Code marketplace 和插件声明，支持从同一个 GitHub 仓库安装。
- Claude Code 与 Codex 共用六个 Skill 和生产 MCP 配置；版本统一为 `0.3.0`。
- 共享 Skill 使用客户端通用授权说明，成员查询明确支持省略查询条件并遍历所有分页。
- 增加两端安装、授权、更新、卸载说明；发布文件由应用仓库白名单导出脚本生成。
- 安装与组件加载、Google OAuth、真实工具调用的验证结果分别记录，不以配置检查代替业务验收。

## 0.2.0 — 2026-09-30

- 初次上传独立 Codex Plugin 仓库（`46c45fa`），marketplace 名称为 `authright-sharing`。
- MCP 默认连接 `https://sharing.authright.com/mcp`。
- 提供一个综合 Skill 和五个操作 Skill。
- 查询说明根据 `content_scope_note` 区分新版视频语音/采样画面摘要与历史音轨摘要。
- 生产健康检查、OAuth discovery 与未登录 MCP 401 已复查；本版未建立 Claude 支持。
