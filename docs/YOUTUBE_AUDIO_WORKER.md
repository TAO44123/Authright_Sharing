# YouTube 音频摘要 Worker

2026-09-28 按用户要求替换视频只获取 Description 的流程。文章处理方式保持不变。

## 本地运行状态与启动检查

本地状态为 2026-09-28 23:23 UTC 的快照，Lightsail 状态更新于 2026-09-29；以下不是实时监控：

| 项目 | 已确认状态 |
| --- | --- |
| 本地 Web | Next.js 在 localhost:3000 运行 |
| 本地 Worker | 已启动；日志确认 worker_ready、enabled 和 heartbeat |
| 本地迁移 | `0003_lively_ikaris` 已应用；迁移时核对原有 9 条内容、9 条分享及处理记录未变，随后又新增了视频分享 |
| 队列超时 | 长视频修订后默认值为 1020 秒；迁移脚本会同步更新尚在等待的任务 |
| Claude.ai 分享 | generation=3，completed，attempts=1；内容 ready，概述和 4 个要点已入库 |
| 主机音频工具 | 已在忽略提交的 `.local/audio-tools` 安装 yt-dlp 2026.8.19、yt-dlp-ejs 0.8.0、imageio-ffmpeg 0.6.0（FFmpeg 7.1），`.env` 已设绝对路径 |
| 新 Worker 实际生成 | Claude.ai 短视频和 Andrew Ng 110 分钟长视频均完整成功；后者 generation=5，耗时约 78 秒 |
| Lightsail 音频版本 | 2026-09-29 已部署 `cdca1f0` 并应用迁移；YouTube 对服务器出口要求人机验证，生产音频摘要尚未通过验收 |

当前界面把 queued 与 processing 都显示为 Generating summary / Generating video summary。排查时以数据库任务状态、attempts、started_at 和 Worker 日志为准。这里记录实际行为，没有把尚未实现的独立“排队中”文案当作已完成。

本地启动检查（本机已完成；重建环境时按以下步骤）：

1. 保留现有 `.env` 和凭据；设置可执行的 `YT_DLP_PATH`、`FFMPEG_PATH`，确认 yt-dlp 同环境包含 yt-dlp-ejs，并可使用 Node 24。
2. 确认 GEMINI_API_KEY、YOUTUBE_API_KEY、GEMINI_BILLING_TIER 和 CONTENT_PROCESSING_ENABLED 配置正确，不把真实值写入日志或文档。
3. 代码升级后运行 `pnpm db:migrate`；本地本轮已完成，可幂等重跑。迁移不会领取任务。
4. 在独立终端运行 `pnpm dev:worker`。`pnpm dev` 只运行网页；宿主机运行 Worker 不会自动使用 Docker 镜像中的工具。
5. 确认日志出现 worker_ready 且 contentConsumption=enabled；随后观察任务从 queued 转 processing，最终 ready 或明确 failed。启动会消费现有等待任务，不要为等待中的分享重复提交或直接调用模型。

### 本次故障修复

Claude.ai 的 generation=2 于 22:54 UTC 因 `AUDIO_TOOLS_UNAVAILABLE` 失败：主机没有默认的 yt-dlp/FFmpeg 命令，与 API Key 无关。安装项目本地依赖并设置路径后重启 Worker，再通过正常重试服务创建 generation=3，于 23:08:20–23:08:30 UTC 完整成功。任务 ID 为 `f213585a-e967-41e7-bc9c-250c870eefe0`。

界面现在把工具缺失单独显示为 `Audio processing tools are unavailable`；API 配置缺失仍为 `Processing service is not configured`。失败后 60 秒内重试会被限流，等待结束再试；没有绕过冷却或改写历史失败记录。修改 `.env` 后需重启 Worker；`tsx watch` 不保证重新读取环境变量。

## 行为

1. YouTube Data API 获取标题、频道、封面、作者 Description 和嵌入状态。
2. yt-dlp 只下载音轨，FFmpeg 将完整音轨转成单声道、24 kHz、48 kb/s MP3。
3. 不超过 14 MiB 的 MP3 内联发送，更大的音频先上传 Gemini Files API、等待 ACTIVE 后引用 fileData；Gemini 3.5 Flash-Lite 从音频提取英文信息笔记，不传视频标题、描述或字幕作为依据，不生成时间戳。
4. 同一模型根据笔记生成英文一句话概述和 3–5 个要点，使用视频专用提示词。
5. 只保存最终摘要；临时音轨在成功、失败、取消时删除，信息笔记不写入数据库。已取得文件 ID 的 Gemini 上传文件在成功、失败及取消后均尝试删除；删除失败仅记录脱敏事件，不重做生成，供应商文件会在 48 小时后过期。上传响应丢失或进程异常退出也可能需要等待供应商过期清理。进程被 SIGKILL 或主机崩溃时无法执行清理，容器临时目录随容器替换回收。

网页分别显示 `AI video summary`（音频来源）与 `Video description`（作者原文）。MCP `source=ai_video_summary`，详情字段为 `video_summary`；列表只返回摘要概述 `excerpt`，详情包含全部要点。`article_summary` 仅用于文章，`full_content_available=false`。

原链接始终保留。已完成的旧视频不会自动批量调用模型，分享者可点击 `Retry processing` 生成音频摘要。新提交的视频按新流程处理；同一视频复用已有内容记录。API 元数据刷新不重新调用模型，也不将摘要失败标为成功；音频摘要独立于 30 天元数据缓存，过期后仍可读取和搜索。

## 边界与用量

- 无时间戳比对，不因音轨与视频时长差异失败；不分析画面，也不提供完整转录。
- 源音轨上限 512 MiB，工作目录上限 700 MiB；完整 MP3 上限 128 MiB。14 MiB 仅为内联/上传切换阈值，不再作为拒绝长视频的上限。超过实际大小上限明确失败，不截断音轨；实际可处理范围还取决于下载速度、任务期限和模型配额。
- 下载和转码合计最多 300 秒；文件上传及就绪等待合计 180 秒；音频提取请求 180 秒，文本摘要请求 90 秒；任务总期限 900 秒，租约 960 秒，队列期限 1020 秒。远端文件删除另有独立 10 秒期限。
- yt-dlp 使用 Node 运行 EJS，禁用用户配置、插件目录、cookies、远程组件和内部下载重试；子进程不继承 API 密钥。只接受校验过的 11 位视频 ID，构造固定 YouTube URL，无 shell 拼接。
- 每次视频任务原子预留 2 个调用单位。`usage_events` 分别记录 `audio_extract` / `summary` 及调用序号。第一步失败时释放第二步未用额度；已发送但结果未知的调用保守计量，不自动重试。
- Gemini 429/503、网络失败、YouTube 下载限制均不伪造摘要。失败保留元数据和原链接，用户可重试。时间戳不准确不会影响处理。
- [官方价格页](https://ai.google.dev/gemini-api/docs/pricing) 2026-09-28 列出的 3.5 Flash-Lite 音频和文本输入同为 $0.30/百万 tokens，输出 $2.50；Free tier 输入输出免费。按配置保存价格快照，不将估算当作账单。

## 配置与部署

现有 `GEMINI_API_KEY`、`GEMINI_BILLING_TIER`、`YOUTUBE_API_KEY`、`CONTENT_PROCESSING_ENABLED` 继续使用。新增仅 Worker 使用的 `YT_DLP_PATH`（默认 `yt-dlp`）和 `FFMPEG_PATH`（默认 `ffmpeg`）。本地需可执行的 yt-dlp、yt-dlp-ejs、FFmpeg 和 Node；Docker 镜像已经加入 Python venv、yt-dlp 2026.8.19、yt-dlp-ejs 0.8.0、FFmpeg。

部署顺序：备份数据库 → 构建新镜像 → 停止旧 Worker → 运行 `scripts/migrate.ts` → 替换 Web/Worker → 验证真实样本。迁移 `0003_lively_ikaris.sql` 放开视频摘要字段并允许两单位预留；迁移脚本也更新既有队列默认超时，并通过 pg-boss API 把尚未开始的排队任务更新为 1020 秒，保留任务 ID、载荷和重试状态。不能仅重启旧镜像；不要回滚数据约束到禁止视频摘要的版本。

Lightsail Compose 的 Worker 退出等待改为 16 分钟。生产 Worker 当前已启用。服务器出口实际触发 YouTube 人机验证，两条公开视频及 Android 提取客户端均无法取得音轨；此前本地成功不代表该 IP 可下载。部署详情见 [Lightsail 记录](DEPLOY_LIGHTSAIL.md)。

## 长视频修订

Andrew Ng 样本（`58n-n-3oRic`）长 6617 秒，原始 M4A 107090892 bytes。旧版本超过 100 MiB 时 yt-dlp 跳过下载但退出码仍为 0，应用误记 `AUDIO_UNAVAILABLE`。现在识别该跳过信息为 `AUDIO_TOO_LARGE`，同时按用户要求扩大容量并接入 Files API，模型仍只执行音频提取和摘要两次调用。实际复测结果见 [验证记录](validation/YOUTUBE_AUDIO_GEMINI.md)。

## 验证

- 单元测试：Gemini 内联与 Files API 音频请求、上传状态与清理、专用视频提示词、输出校验、大小限制、无隐式重试、下载参数和临时文件清理。
- 集成测试：真实 PostgreSQL 迁移；视频两阶段成功、第二阶段失败、第一阶段结果未知、额度不足、读取与搜索、旧视频手动升级、元数据刷新和租约保护。
- 浏览器测试：桌面和手机视口的音频摘要、作者描述及播放回退。
- `scripts/validate-youtube-worker.ts VIDEO_ID`：仅使用 `TEST_DATABASE_URL` 派生的临时数据库，真实下载、转码和调用 Gemini；输出证据到 `test-results/youtube-worker`，结束删除临时数据库。需现有 Free tier 配置，不改正式分享。

依据：[yt-dlp](https://github.com/yt-dlp/yt-dlp)、[Gemini 音频输入](https://ai.google.dev/gemini-api/docs/audio)。
