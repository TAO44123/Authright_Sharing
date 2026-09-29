# YouTube 音轨 → Gemini 验证

> 历史音频流程记录：2026-09-29 起新版 Worker 改为 YouTube URL 非流式一次调用；当前行为和验收见 [URL 验证](YOUTUBE_URL_GEMINI.md)。本文件保留当时证据，不代表当前实现。

日期：2026-09-28 至 29。先验证 Claude.ai 短视频，再按用户要求验证 Andrew Ng 的 110 分钟长视频。**本地 Worker 已分别在 23:08 UTC 和 23:23 UTC 完成两条视频的真实音频摘要并落库；Lightsail 已部署代码和迁移，但服务器出口触发 YouTube 人机验证，生产音频验收未通过。**下方保留早期 Gemini 503、工具缺失和大小限制的失败记录，供排查过程参考。

23:23 UTC 的本地检查中 Worker 已运行：Claude.ai 分享为 `ready`，generation=3、attempts=1；Andrew Ng 分享也为 `ready`，generation=5、attempts=1。两者的任务均已 completed，各保存概述及 4 个要点。新版已去掉时间戳并使用视频专用提示词；下文时间戳越界、This article 措辞是旧探测的历史问题。

## 恢复重试（2026-09-28 20:19 UTC）

按用户要求复用下述已下载 MP3（SHA-256 一致），未重新下载或引入其他视频。`recovery-1` 在本地沙箱中报 `fetch failed`，未取得 HTTP 响应；获准联网后执行独立尝试 `recovery-1-network`，两次生成均成功，合计约 20.4 秒。

| 阶段 | 模型 | 结果 | 用量 | 耗时 |
| --- | --- | --- | --- | --- |
| 音频信息提取 | gemini-3.5-flash-lite | HTTP 200；11 段英文信息，结构校验通过 | 输入 8,057（音频 7,969、文本 88），输出 597 tokens | 8.9 秒 |
| 信息摘要 | gemini-3.5-flash-lite | 英文概述和 5 个要点，结构校验通过 | 输入 501，输出 153 tokens | 11.5 秒 |

两次成功调用合计输入 8,558、输出 750、总计 9,308 tokens。保留现有 `free` 配置，未核验账单。原始结果保存于 `test-results/youtube-audio/0vZ_UVLhSQQ/recovery-1-network/result.json`，包括请求 ID、用量和模型原文。

摘要内容（中文转述）：视频介绍如何有效使用 Claude，包括自然简洁的提示词，明确角色、目标和风格，补充上下文与文件，以及模型选择、扩展思考和 Research 功能。

质量边界：

- 提取结果最后一个时间段到 515 秒，超过音频实际长度 318.79 秒；11 段中有 5 段结束时间越界。结构校验未检查音频总长，因此本次成功只说明生成与结构链路跑通，时间定位不合格，不可用于跳转。
- 复用的文本摘要提示词面向文章，生成概述以 `This article` 开头。接入视频前需要专用提示词。
- 尚未逐段人工对照音频核验事实覆盖率。没有修改分享数据、生产 Worker 或启用线上音轨处理。

## 样本与已验证结果

- 样本：[Getting started with Claude.ai](https://www.youtube.com/watch?v=0vZ_UVLhSQQ)。YouTube 元数据时长 319 秒。
- 临时环境：现有 Python 3.12.14、Node 24.21.0；新增临时依赖 yt-dlp 2026.8.19、yt-dlp-ejs 0.8.0、imageio-ffmpeg 0.6.0（FFmpeg 7.1）。原项目依赖和业务处理代码未改动。
- yt-dlp 成功取得纯音轨：format `140-12`，`vcodec=none`，`acodec=mp4a.40.2`，语言 `en-US`。未使用登录 cookies。
- FFmpeg 成功转换并完整解码：MP3、单声道、24 kHz、48 kb/s，318.79 秒，1,913,081 bytes。音频 SHA-256：`f47664d85d29c7e19193fb53ad13cf4f80cb0a6374ea4e20688ce66ff4183b26`。
- Gemini `gemini-3.5-flash-lite:countTokens` 返回 HTTP 200，`totalTokens=10201`，模态明细为 `AUDIO`。这证明接口可识别实际音频输入，不能替代生成能力验证。
- 信息提取请求只发送音频和提取指令，不提供视频标题、作者描述、字幕或链接作为模型依据。计划先提取带近似时间段的信息，再调用现有文本摘要适配器生成英文概述和 3–5 个要点。

## 首轮实际生成结果（恢复重试前）

| 请求 | 模型 | 结果 |
| --- | --- | --- |
| 音频提取 | gemini-3.5-flash-lite | HTTP 503 UNAVAILABLE |
| 同一样本明确重试一次 | gemini-3.5-flash-lite | HTTP 503 UNAVAILABLE |
| 极短纯文本健康检查 | gemini-3.5-flash-lite | HTTP 503，返回模型需求过高的说明 |
| 同一样本备用模型 | gemini-2.5-flash-lite | HTTP 404 NOT_FOUND；虽然模型列表列出该模型，生成请求实际不可用 |
| 同一样本备用模型 | gemini-3.1-flash-lite | HTTP 503 UNAVAILABLE |

纯文本健康检查的供应商错误说明：`This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.` 因此至少当前主模型存在整体生成可用性问题，不能把失败归因于音频格式不支持。没有任何一次提取返回内容，后续摘要阶段均未调用。共 5 次生成请求失败；未返回的 token 用量视为未知，不写为零。

复用现有 Gemini Key 和 `GEMINI_BILLING_TIER=free`；未修改账户计费设置、分享数据或生产模型。实际套餐/账单未通过账单系统核验。用户缩减范围前，另外两个已有样本的音轨已下载到临时目录，但未发送给 Gemini。

## 证据和复测

- 探测脚本：`scripts/validate-youtube-audio.mjs`。
- 首次记录：`test-results/youtube-audio/0vZ_UVLhSQQ/result.json`。
- 重试记录：`test-results/youtube-audio/0vZ_UVLhSQQ/retry-503/result.json`。
- 备用模型记录：同目录下 `fallback-25/result.json` 和 `fallback-31/result.json`。
- 音频计数与文本健康检查：`test-results/youtube-audio/diagnostics.json`。
- 临时音轨：`/private/tmp/sharing-youtube-audio/0vZ_UVLhSQQ.mp3`。临时目录可能被系统清理。

以下是当时用于手动复测的历史命令，会再次调用 Gemini；当前两条正式分享已成功，无需运行它：

```bash
node --env-file=.env --import tsx scripts/validate-youtube-audio.mjs \
  /private/tmp/sharing-youtube-audio/0vZ_UVLhSQQ.mp3 \
  0vZ_UVLhSQQ recovery-2
```

脚本使用唯一尝试目录，拒绝覆盖既有记录；90 秒请求超时，无隐式重试。备用模型仅作用于该探测脚本。生成成功后才会继续摘要和结构校验，不会把部分成功记作完整成功。脚本已通过 Node 语法检查和 ESLint；不涉及 Next.js 页面或生产流程变更。

依据：[yt-dlp](https://github.com/yt-dlp/yt-dlp)、[Gemini 音频输入](https://ai.google.dev/gemini-api/docs/audio)、[生成 API](https://ai.google.dev/api/generate-content)、[模型价格页](https://ai.google.dev/gemini-api/docs/pricing)。


## 早期 Worker 接入探测（23:08 UTC 成功前）

用户确认将此流程接入 Worker，且不要求音频时间戳与视频时长一致。源码已实现专用无时间戳信息提取、视频摘要提示词、临时音轨清理、分阶段计量、网页和 MCP 视频摘要字段；部署说明见 [音轨 Worker](../YOUTUBE_AUDIO_WORKER.md)。尚未部署到 Lightsail，也未启用生产内容消费。

- 静态检查、51 项单元测试、15 项数据库集成测试、12 项桌面/手机浏览器测试通过；Web/Worker 构建及客户端凭据检查通过。
- 通过新下载器重新下载和转码同一样本成功，未复用之前 MP3。
- 两次独立真实 Worker 探测均在音频提取调用失败；第二次明确记录 HTTP 503。第一步用量未知，摘要步骤未发送、第二个额度单位已释放。报告分别位于 `test-results/youtube-worker/0vZ_UVLhSQQ-1790628257442/result.json` 和 `test-results/youtube-worker/0vZ_UVLhSQQ-1790628471168/result.json`。
- 此时的成功仅来自独立探测，真实 Worker 的两次探测仍因 Gemini 503 未通过；后续 23:08 UTC 的 Claude.ai 正式分享与 23:23 UTC 的 Andrew Ng 长视频正式分享已分别成功，见下方验收记录。
- 浏览器截图已检查音频摘要与作者描述分区、桌面/手机布局；浏览器快速导航仍偶发已有的 `destination stream closed early` 日志，12 项断言全部通过。

- Docker 构建成功；断网临时容器中以 uid=1000 执行 yt-dlp 版本检查与 FFmpeg MP3 编码成功。构建期 OAuth 初始化会对占位数据库输出连接拒绝日志，但构建退出码为 0；不构成运行时数据库验收。

## 本地数据库迁移与运行检查

用户确认后已在本地应用 `0003_lively_ikaris`：视频可保存摘要，额度预留支持 1–2 单位；队列及两条尚未开始的任务超时均为 480 秒。迁移前后核对 9 条内容、9 条分享及全部任务、尝试和用量记录的行指纹一致。迁移当时未启动 Worker；Claude.ai 样本当时仍为 queued、attempts=0，等待消费。分享 ID 为 `8f2511da-a2b8-441a-839b-8d58c8d58936`，当时 task ID 为 `cfb63d45-5288-4820-a930-1df7f4945d4a`，generation=2。此前已完成的 generation=1 仅获取元数据，未调用 Gemini。

迁移后的初次运行检查仅发现 Next.js Web 进程；`.env` 的 CONTENT_PROCESSING_ENABLED=true 不会自行创建 Worker。主机 PATH 未找到 yt-dlp/ffmpeg，需要配置已安装工具的绝对路径或安装到 PATH；临时目录中的验证工具可能被系统清理。准备步骤见 [音轨 Worker](../YOUTUBE_AUDIO_WORKER.md#本地运行状态与启动检查)。

## 主机工具修复与正式分享验收（2026-09-28 23:08 UTC）

随后启动的 Worker 因主机工具不可执行而将 generation=2 标为 `AUDIO_TOOLS_UNAVAILABLE`。在项目 `.local/audio-tools` 安装依赖、设置 `.env` 的两个工具路径并重启 Worker 后，使用现有 retryShare 服务重试同一分享，保留所有权、冷却及幂等检查。generation=3（任务 `f213585a-e967-41e7-bc9c-250c870eefe0`）于 23:08:20.310–23:08:30.596 UTC 完成，attempts=1；内容状态 ready、failure_code=null，概述及 4 个要点已落库。此为新 Worker 完整实际成功记录，未部署到 Lightsail，也未批量重试其他失败分享。

## 长视频真实 Worker 验收（2026-09-28 23:23 UTC）

用户授权支持长视频并重试 Andrew Ng 样本。分享 ID `c2d0d94f-462c-4e96-97a8-a5269eb13163`，视频 ID `58n-n-3oRic`，时长 6617 秒，选中 M4A 音轨大小 107090892 bytes。旧 generation=4 触发 100 MiB 下载限制，下载器成功退出但没有文件，误报 AUDIO_UNAVAILABLE。

修订后源音轨限额 512 MiB、完整 MP3 限额 128 MiB；超过 14 MiB 自动通过 Gemini Files API 上传并引用。未截取音轨、未改用描述或字幕。文件上传/就绪检查和删除不额外生成摘要，模型仍调用两次。对上传目标做同源校验；删除失败不会重做模型请求。

通过应用 retryShare 服务创建 generation=5，任务 `d32895ae-065e-43dc-a37a-54e0b508edfd`，attempts=1，23:22:18.485 UTC 开始，23:23:36.554 UTC 完成，耗时 78.069 秒。内容 ready、failure_code=null，保存英文概述及 4 个要点，涵盖迭代式 Agent 工作流、工具调用、人工输入和持久化、LangGraph 循环图。

| 阶段 | 状态 | 输入 tokens | 输出 tokens |
| --- | --- | ---: | ---: |
| audio_extract | succeeded | 165545 | 848 |
| summary | succeeded | 903 | 144 |

脱敏数据库结果保存于 `test-results/long-video-result.json`。本地队列默认期限已查询确认为 1020 秒。58 项单元测试、15 项集成测试、lint、类型及客户端边界检查、Web/Worker 构建和客户端凭据扫描通过。没有重跑此前桌面/手机 E2E 或重建 Docker 镜像；未部署 Lightsail。成功说明该样本的完整技术链路通过，不代表人工逐段核验过全部音频事实，也不保证所有长视频均可处理。

文件上传协议和清理依据：[Gemini Files API](https://ai.google.dev/gemini-api/docs/files)。

## Lightsail 部署与生产验收（2026-09-29）

服务器从 GitHub 拉取 `cdca1f0`，构建同名镜像；无网络容器中的 yt-dlp 版本检查、FFmpeg MP3 编码和 Worker 产物检查通过。迁移 `0003` 成功，pg-boss `process-content` 队列期限为 1020 秒；Web 和 Worker 均运行新镜像，公网健康检查返回 `{"status":"ok","database":"reachable"}`，Worker 日志出现 `worker_ready` 且内容消费启用。

使用一次性容器和独立测试数据库对 Andrew Ng 样本执行真实处理，约 1.8 秒后在下载阶段返回 `AUDIO_DOWNLOAD_FAILED`，`httpStatuses=[]`、模型调用记录为空。直接运行 yt-dlp 显示 YouTube 要求 `Sign in to confirm you’re not a bot`；Claude.ai 短视频和 Android 提取客户端同样失败，指向服务器出口访问限制。测试基库及脚本创建的子库已删除；正式数据库仍有原来的 1 条 YouTube 分享，状态 ready，未改写其内容。**此为生产音频验收失败，不影响此前本地短视频和长视频成功记录。**
