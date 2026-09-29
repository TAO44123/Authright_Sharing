# YouTube 视频摘要 Worker

2026-09-29：按用户要求改为 YouTube URL → Gemini 非流式 `generateContent` → 一次生成英文摘要。文件名保留以兼容既有文档链接；旧下载音轨流程的实测证据保存在 [历史音频验收](validation/YOUTUBE_AUDIO_GEMINI.md)。

代码已于本轮提交并推送到 GitHub `main`：[f9cd079](https://github.com/TAO44123/Authright_Sharing/commit/f9cd079eb22cc2cedd15c67fb33dafdf10a5c02c)。本地迁移和真实隔离短/长视频处理已通过；生产仍待按部署手册升级镜像与迁移。下方状态是本轮记录，不是实时监控。

## 行为

1. 校验 11 位视频 ID，用 YouTube Data API 获取标题、频道、封面、原始 Description、时长和嵌入状态。
2. 领取模型并发槽，原子预留一个调用单位，写入 `service=video_summary`、`invocation_index=1` 的调用开始事件。
3. 直接把固定的 `https://www.youtube.com/watch?v=VIDEO_ID` 作为 `fileData.fileUri` 发送给 Gemini 3.5 Flash-Lite。非流式单次 HTTP 请求，不下载音轨、不上传 Files API，不把标题或 Description 作为摘要依据。
4. 时长至少 1800 秒或未知时使用 `videoMetadata.fps=0.1`；短视频采用供应商默认采样。模型结合语音和采样画面，覆盖开头、中间、结尾；不要求音频与视频时长比对或时间戳，不生成完整转录。
5. 只有完整 `STOP` 响应、`available=true`、有效英文概述和 3–5 条要点才能落库。无法访问视频时明确失败；模型自报可访问仍不能独立证明所有内容均被正确理解，质量需抽查。

任务记录使用 `prompt_version=youtube-url-en-v1`。Web/MCP 继续使用 `ai_video_summary` / `video_summary`，作者 Description 单独显示；新摘要注明基于语音和采样画面，旧音频摘要继续注明未分析画面。已完成内容不会批量重生成；同视频复用已有摘要，仅有 Description 的历史视频或失败任务可按原重试入口处理。

元数据刷新不调用模型，也不把摘要失败标为成功。API 缓存到期清除元数据，但保留摘要及搜索能力。`full_content_available=false`，数据库不存视频、音频、完整转录或模型思考内容。文章流程保持原样。

## 超时、失败与用量

- 视频非流式请求最长 600 秒；任务总期限 900 秒，租约 960 秒，pg-boss 期限 1020 秒，容器退出等待 16 分钟。
- 请求发送后不隐式重试；429/503、无法访问、格式错误均保留分享和明确失败。连接中断或超时无法确认生成结果时记为 `OUTCOME_UNKNOWN` 并保守计量。手动重试仍受 60 秒冷却和活跃任务限制。
- 每个新视频任务只预留 1 单位。元数据刷新为 0 次模型调用；旧 `audio_extract` / `summary` 记录及两单位预留不改写。
- `usage_events.usage_details` 仅存白名单 token 计数及模态明细（包括缓存），不存原始响应。`cached_input_price_per_million` 保存调用时缓存输入价格快照；无已知用量时不伪造 token 或费用。
- Paid 估算：非缓存输入 × 输入单价 + 缓存输入 × 缓存单价 + 输出 × 输出单价；不能把缓存 token 再按普通输入全价计算。价格快照有缓存量但缺缓存价时，估算留空。
- 当前 [官方价格](https://ai.google.dev/gemini-api/docs/pricing)：3.5 Flash-Lite Standard 输入 $0.30/百万、缓存输入 $0.03/百万、输出 $2.50/百万；Free 输入/输出为零。实际账单和 RPM/TPM/RPD 以项目为准，估算不是账单。

直接 URL 是 [Gemini 的 YouTube 输入能力](https://ai.google.dev/gemini-api/docs/video-understanding)，当前仅支持公开视频，仍有供应商可访问性、上下文、时长及项目额度限制。降低 fps 减少画面采样，不能保证任意长度视频成功。

## 本地运行状态与启动检查

本轮诊断已在 Lightsail 当前容器中验证短视频和约 110 分钟长视频的非流式 URL 请求均成功；这不代表旧容器已替换为新 Worker。新版 Worker 的隔离短/长视频测试也已落库成功；本地已应用 `0004`，生产新镜像尚未发布。完整验收结果见 [URL 验证](validation/YOUTUBE_URL_GEMINI.md)。

1. 配置 `GEMINI_API_KEY`、`GEMINI_BILLING_TIER`、`YOUTUBE_API_KEY`、`CONTENT_PROCESSING_ENABLED=true`。
2. 更新代码后先 `pnpm db:migrate`，再启动或重启 `pnpm dev:worker`；`pnpm dev` 只启动网页。修改 `.env` 后也需重启 Worker。
3. 确认 `worker_ready`、处理已启用和持续 heartbeat。启动会领取现有等待任务，不要重复提交等待中的分享。
4. 页面区分 `Video summary queued` / `Generating video summary`；以任务 state、attempts、started_at 和脱敏日志排查。

无需 yt-dlp、EJS、FFmpeg、下载代理或 Tunelio；`YT_DLP_PATH`、`FFMPEG_PATH`、`YOUTUBE_PROXY_URL` 已退出 Worker 配置。

## 旧配置的移除范围

| 位置 | 当前状态 |
| --- | --- |
| `src/worker/index.ts` | 已取消音轨下载和音频提取调用，使用 URL 视频摘要 provider |
| `src/server/env.ts` | 不再读取 `YT_DLP_PATH`、`FFMPEG_PATH`、`YOUTUBE_PROXY_URL` |
| `.env.example`、Lightsail 模板及 Compose | 已移除工具路径和下载代理配置 |
| Lightsail Dockerfile | 已删除 Python、yt-dlp、EJS、FFmpeg 安装；构建并部署新镜像后生效 |
| 本机忽略提交的 `.env` | 仍保留 `YT_DLP_PATH`、`FFMPEG_PATH`；新 Worker 不读取，可删除这两行并保留其余配置 |
| 本机 `.local/audio-tools` | 仍保留旧工具安装，新 Worker 不使用 |
| `youtube-audio.ts`、`gemini-files.ts`、`createGeminiAudio` 及相关测试 | 仍保留旧实现和测试，当前 Worker 不调用旧音频流程 |
| `scripts/validate-youtube-audio.mjs` | 仍保留手动音频诊断脚本，不由当前 Worker 调用；主动运行会发送真实模型请求 |
| 最近确认的生产 `sharing:cdca1f0` | 仍是旧音频镜像，尚未由 URL Worker 替换 |

当前改动移除了新 Worker 的下载依赖，并非彻底删除所有历史文件。本地工具/模块的进一步清理可单独进行；历史音频摘要、失败码和用量记录继续保留。

## 迁移与部署

新增 `0004_slow_menace.sql` 只增加两个 nullable 用量字段，不重写摘要、历史调用或额度；本地已应用，生产待执行。代码已推送 GitHub；下一步按 [Lightsail 更新流程](DEPLOY_LIGHTSAIL.md#7-后续更新和回滚) 拉取最新 `main`、构建、备份、停止旧 Web/Worker、执行迁移、启动同版本服务。部署时取实际拉取的 Git SHA 作为镜像标签；该提交必须包含 `f9cd079` 的 URL Worker 改动。不能仅重启旧镜像。

Dockerfile 已移除 Python/yt-dlp/EJS/FFmpeg 安装；Compose 移除下载代理变量，保留既有 API keys、模型并发和任务期限。服务器配置文件可删去历史下载工具变量，其余凭据保留。新增 nullable 字段与上一个音频版本兼容；回退代码时保留迁移，不改历史记录。

## 验证

- 单元：非流式规范 URL、长视频采样、600 秒请求期限、输出校验、缓存计数、无隐式重试。
- PostgreSQL 集成：一次调用计量、单单位额度及恢复、失败已知用量、结果未知、租约保护、元数据维护、旧摘要来源标注、旧库升级和空库迁移。
- 浏览器：桌面/手机排队提示、新旧摘要来源和作者 Description、播放回退。
- 真实隔离 Worker：`node --env-file=.env --import tsx scripts/validate-youtube-worker.ts VIDEO_ID`，在 `TEST_DATABASE_URL` 派生的一次性库执行元数据获取、真实模型调用与落库断言；报告在 `.local/validation/youtube-worker`，结束删除测试库，不修改已有分享。
- 独立 API CLI：`node --env-file-if-exists=.env scripts/test-gemini-youtube.mjs URL --timeout 600 --fps 0.1`；默认非流式，`--stream` 仅用于对照测试，不用于 Worker。
