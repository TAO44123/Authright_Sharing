# Sharing 当前可执行契约（A2–A5）

源文件：`src/contracts/index.ts`。网页与 MCP 调用同一个 `src/server/shares.ts`，身份入口集中在 `auth-options.ts`、`http.ts`、`membership.ts`。

## 业务边界

| 工具 | 输入 | 输出 | Scope | 当前状态 |
| --- | --- | --- | --- | --- |
| share_link | url、idempotency_key | share、replayed | shares:write | Web 服务已实现；MCP 写工具留 B2 |
| list_shares | from/to、limit、cursor、user_id、keyword | items、next_cursor、实际 from/to | shares:read | 已实现 |
| get_share | share_id | share DTO | shares:read | 已实现 |
| list_members | query、limit、cursor | members、next_cursor | members:read | A3 服务与 REST 已实现；MCP 留 B2 |
| withdraw_share | share_id | share_id、withdrawn=true | shares:write | A3 服务与 REST 已实现；MCP 留 B2 |

Actor 的 userId 来自已验证 session 或 MCP token subject，不能由业务请求提供。MCP Actor 另带 verified client_id、sharing_grant、scope；每次业务调用检查用户的已验证公司邮箱及未撤销 grant。公司用户首次登录自动建档，旧成员禁用状态不再限制访问。网页不依赖 token scope，但使用同一公司身份检查。

## 当前接口与完整设计的差异

调用方应以 `src/contracts/index.ts` 为准。A3 扩展保留 S1 字段别名；正式分发前由 B2 统一版本、scope 和五个 MCP 工具，不静默改变已发布客户端契约。

| 项目 | 当前可执行接口 | 完整设计 / 后续阶段 |
| --- | --- | --- |
| 分享输入 | `POST /api/shares` 的 `url` 加 JSON `idempotency_key` 或 `Idempotency-Key` header；两者不一致则拒绝 | MCP 写工具和可选 key 策略留 B2 |
| 查询过滤 | `user_id`/`sharer_id`、`keyword`/`query`、`from`、`to`、`limit`、`cursor`；冲突别名拒绝 | 自然语言日期由 Agent 转成显式时间范围 |
| 分享 DTO | 保留 `id`/`shared_by`/`status`，新增 `share_id`/`sharer`/`processing_status`、`normalized_url`、范围说明及摘要/描述字段 | 列表仅 excerpt，详情返回已保存摘要/描述 |
| 成员与撤回 | `GET /api/members` 支持分页/active/同名消歧；`DELETE /api/shares/:id` 只撤回本人 | 对应 MCP 工具留 B2 |
| 网页失败重试 | `POST /api/shares/:id/retry`，JSON `idempotency_key`，只允许本人有效且失败的分享 | 新 generation，同 key 重放、活动任务去重及 60 秒冷却 |
| 管理员与时区 | `GET /api/admin/members` 查看已登录用户、`PATCH /api/admin/members/:id` 仅修改 role；`PATCH /api/account` 更新本人 IANA 时区 | 成员 POST 已移除，status 修改拒绝；管理仅接受管理员网页 Actor；安装入口留 B4 |
| 连接管理 | `/account` 服务端读取自己的连接；`DELETE /api/grants/:id` 撤权 | 设计中的 `/api/account/connections` 列表/删除路由尚未实现 |
| 健康检查 / 错误 | `/api/health` 检查数据库；业务 HTTP 错误带 request ID | 独立 live/ready、Worker 健康状态与完整请求关联留 A6 |

当前只开放 MCP `shares:read`；`shares:write`、`members:read` 虽有契约定义，尚未加入 OAuth 可授予的业务 scope，也没有对应 MCP 工具。`list_members` 业务契约含分页、email 和 active；active 依据已验证公司邮箱计算，保留有历史分享但已不符合域名资格的账号用于检索。

## 授权失效与重连

- 新连接按 OAuth 授权码的哈希标识绑定，每次授权有独立 `agent_grants.id`；同一网页登录会话可以重新授权，无需退出再登录。
- `storeTokens.hash` 与连接标识共用 SHA-256/base64url，与原有 Better Auth 默认存储格式兼容。只有 provider 完成授权码/PKCE 或刷新凭据验证后，claims hook 才按可信 user/client/session 解析连接。
- 刷新时从该刷新凭据的数据库记录读取 `authorizationCodeId`，只复用对应连接，不选择“最新有效连接”。旧版本连接的空标识仅作为 legacy 刷新回退，永不恢复已撤销记录。
- 撤销事务标记连接失效、删除该授权的所有刷新代次、清除该用户/客户端的 remembered consent；保留网页登录会话及其他授权。下次 OAuth 需要再次确认 Allow access。
- MCP 缺失或失效凭据返回 `401` 及 `WWW-Authenticate`；自定义连接撤销响应保留 `GRANT_REVOKED`，挑战包含 `error="invalid_token"`、受保护资源元数据 URL 和 `scope="shares:read"`。非公司/未验证邮箱及操作权限不足返回 `403`。
- 已撤销/失效刷新凭据在 token endpoint 返回 `400 invalid_grant`；客户端据此清除旧凭据、重新发起 OAuth。是否自动展示认证 UI 由客户端实现决定，不能由服务端承诺。

## 时间、分页与幂等

- 默认窗口：服务端现在向前滚动 7 天；边界 `[from, to)`，请求时间必须携带时区，输出 UTC ISO。
- 网页例外：Home 显式查询全部历史的最新 5 条；Library 显式查询全部历史，每批 10 条，接近列表底部按 next_cursor 加载，搜索/筛选全部位于 `/library`。后续请求只带 cursor，保持初始条件及批大小。
- 默认 20 条，最多 100 条；按 `(created_at, id)` 降序。业务时间戳精确到毫秒，游标不会丢失 PostgreSQL 的微秒位。
- HMAC 游标绑定用户、过滤条件、初始窗口、limit 和最后一条记录；有效期一小时。后续可只传 cursor；若重复传过滤条件，必须与原查询一致。cursor 内的 limit 优先于新的 limit。
- `keyword` 在原始链接、有效标题、保存的摘要/要点与有效视频描述中做字面量搜索；不检索全文。过期视频元数据不参与匹配。
- 同 user + operation + key 对相同 trimmed URL 重放原分享；不同 URL 返回 `IDEMPOTENCY_CONFLICT`。主动再次分享用新 key，可产生独立分享记录。
- 内容去重和分享记录分离。文章保留 path、query 顺序与 fragment；YouTube 已知域名按精确 video ID 去重。
- 分享、幂等记录、content task 与 pg-boss job 在同一 PG 事务中提交。入队失败或任务记录失败会整体回滚。
- 已撤回分享的原 key 仍返回原记录和 `withdrawn=true`，不会重新创建分享。正常查询及详情隐藏撤回记录，其他人的同内容分享不受影响。
- 全部分享撤回后尚未开始的处理可取消；该内容随后被再次分享时显示可重试的失败状态，不永久停在 queued。

## 输出与错误

share DTO 返回分享者平台 ID/姓名、原始/规范 URL、UTC 时间、content ID/type/status、nullable title、来源与内容范围。`source` 为 `none`、`ai_article_summary` 或 `youtube_description`，`full_content_available` 恒为 false。空视频描述仍属于 `youtube_description`。文章摘要含英文概述和 3–5 条要点；接口能验证结构，真实英文质量待模型验收。列表返回最多 500 字符的 excerpt 和 truncated，详情返回保存的完整摘要或描述。查询不会触发抓取或模型调用。

错误 schema：`INVALID_INPUT`、`UNAUTHENTICATED`、`MEMBER_DISABLED`、`FORBIDDEN`、`GRANT_REVOKED`、`NOT_FOUND`、`IDEMPOTENCY_CONFLICT`、`INVALID_CURSOR`、`CONFLICT`、`RATE_LIMITED`、`INTERNAL_ERROR`。REST 错误返回 `{error:{code,message,request_id}}`，同时发送 `X-Request-ID` 和 `Cache-Control: private, no-store`；MCP 工具业务错误使用 `isError=true`，认证失败在进入工具前由 HTTP 401/403 拒绝。

URL 输入拒绝非 HTTP(S)、用户信息、超过 8 KiB、localhost 与私有/保留 IP，以及已知 YouTube 域名上没有合法视频 ID 的链接。A4 抓取器逐跳检查全部 DNS 地址并固定已验证 IP，限制重定向、传输/解压大小和总超时。处理模板默认暂停，开启方式与真实服务结果见 [A4 真实服务验收](A4_REAL_SERVICES.md)。

## A1 数据扩展

迁移 `0002_a1_foundation` 补充处理、计量、设置和审计存储，不改变上述 S1 成功响应或开启内容消费。字段兼容、测试与后续约定见 [A1 验收记录](A1_FOUNDATION.md)。
