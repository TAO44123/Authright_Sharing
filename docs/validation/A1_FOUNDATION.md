# A1 数据与工程完善验收

> 后续需求修正：原成员允许名单和禁用准入已取消，bootstrap 仅预设管理员角色，旧 status 字段保留兼容存储。当前规则见 [公司账号自动加入](DOMAIN_SIGN_IN.md)。下文为 A1 当时的历史验收记录。

日期：2026-09-27。范围：开发计划 A1；A2–A6 的业务实现与外部验收仍按各阶段推进。

## 实现

- 增量迁移 `0002_a1_foundation` 保留 Better Auth 生成表和 S1 业务表名，补充内容摘要/视频元数据、成员更新时间、任务租约/冷却/失败信息及授权 scope 字段。
- 新增 `processing_attempts`、`usage_events`、`quota_reservations`、`settings`、`audit_events`。不增加正文、媒体或模型原始响应存储字段。
- 数据库检查成员角色/状态、内容类型/状态、摘要结构、视频字段、任务状态/计数；有效分享索引支持时间和用户分页。任务的部分唯一索引包含 queued、processing、retry_wait、deferred_quota。
- 尝试按任务/generation/序号唯一，用量按 attempt/service/invocation 唯一，额度预留按 attempt 唯一；未知用量保持 null，估算金额要求价格依据。设置单行且默认关闭额度。
- 历史 YouTube 内容从已有 dedupe key 回填 video ID；新提交同样保存 video ID。S1 的 share DTO、业务 scopes 和旧任务载荷继续兼容。
- Web 校验 canonical origin、OAuth URL/resource、独立密钥和 Google 配置完整性；生产公共 origin 要求 HTTPS，本地编译运行允许 loopback HTTP。启动错误只列配置字段，不输出配置值。
- 数据库模块与 Worker 不再导入 Web 配置；Worker 并发配置默认 2/1，内容消费继续暂停。
- 客户端依赖图检查覆盖本地转导出和动态导入，阻止客户端引用 server/worker 与服务器依赖；生产构建后扫描 `.next/static` 中是否存在当前配置的服务端秘密。
- 应用日志只输出允许的事件、状态、关联 ID 和数值，不序列化请求、异常、来源正文或自由文本消息。业务 HTTP 错误返回 `request_id`、`X-Request-ID` 和 private/no-store，并与应用日志关联。
- bootstrap 提取为可测试服务，重复调用保持原记录，拒绝自动提升普通成员或重新激活禁用成员。
- 新增 GitHub Actions 检查入口：锁定工具链、PostgreSQL、静态检查、单元/集成测试、生产构建和 Worker 启停检查。

## 本轮证据

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | lint、客户端依赖边界、TypeScript、19 项单元测试通过 |
| `pnpm test:integration` | 11 项通过，包含原 8 项 S1 事务/权限/OAuth/MCP 回归 |
| 全新数据库 | 原样执行全部迁移，重复迁移不重复初始化设置；重复 bootstrap、拒绝提权/重新激活通过 |
| S1 数据升级 | 原样执行前两份迁移并写入 S1 夹具与真实 pg-boss job，再执行 A1 迁移；分享、会话、幂等记录和 job 完整保留，授权和任务关联保留，video ID 正确回填 |
| 数据库约束 | 并发任务/预留只写入一条；重试等待与额度暂停仍占活跃任务位；未知用量、外键、状态、月份与单行设置检查通过 |
| Drizzle schema 对齐 | 再次 generate 返回 No schema changes |
| `pnpm build` | Webpack Web 构建、Worker TypeScript 编译及客户端秘密扫描通过 |
| `pnpm test:worker` | 仅传入 DATABASE_URL/LOG_LEVEL，启动后保持消费暂停，SIGTERM 正常退出；没有提供认证/Google/模型凭据 |
| 本地数据库 | 已执行 `pnpm db:migrate`，应用 0002 并确认队列入口可用 |

集成测试入口仍要求 `TEST_DATABASE_URL` 指向 `/sharing_test`。迁移专项测试需要该测试角色拥有 CREATEDB 权限：每次创建随机命名的 `sharing_test_migration_<uuid>` 空数据库，原样执行迁移，最后只删除本次创建的数据库；不重置本地业务库或共享测试库。生产角色不需要 CREATEDB。测试夹具不是真实用户或第三方验收。

默认 Turbopack 在本机即使提升执行权限仍遇到 CSS 处理子进程绑定端口的 EPERM；`pnpm build` 已固定使用当前 Next.js 官方支持的 `--webpack`，上述构建通过指此路径。

当前目录未初始化 Git，也没有远程 CI 运行记录；workflow 已提供，本地相同检查已执行，不能写成 GitHub Actions 已通过。

## 后续衔接

- 数据模型沿用 `contents.original_url` 表示首条原始链接、`content_tasks` 表示处理任务、`idempotency_keys` 表示幂等记录。任务终态沿用 `completed`；`process_content` 保留用于已有 S1 任务。A4 需兼容这些旧任务后才能启用消费者。
- 当前 DTO 仍为 S1 子集；A3/B2 负责完整字段、成员分页、列表/详情输出与命名统一。A1 新增存储字段不等于这些内容已生成或已返回。
- A2 负责管理服务与审计事件写入；A4/A6 负责租约恢复、实际用量事件、事务额度检查、暂停任务恢复和设置修改的版本控制。
- 新增的授权 scopes 字段默认只有 S1 `shares:read`；OAuth 授权范围仍由已验证 token/provider 控制，B1/B2 扩展时需同步持久化范围。
- 请求级成功日志、完整 MCP 关联、全部私有响应缓存策略、限流、独立 live/ready、备份恢复及真实内容处理留相应阶段。
- 客户端扫描检查当前配置值及常见编码形式，不代表通用泄露检测；依赖边界检查和最小 DTO 仍是主要隔离措施。
