# YouTube 音轨 → Gemini 验证

日期：2026-09-28。用户要求只跑通一个样本证明可行，因此只向 Gemini 提交了一个视频的音频。当前结论：**音轨获取和 Gemini 音频输入识别成功；信息提取和总结尚未跑通，生成接口返回服务不可用。**

## 样本与已验证结果

- 样本：[Getting started with Claude.ai](https://www.youtube.com/watch?v=0vZ_UVLhSQQ)。YouTube 元数据时长 319 秒。
- 临时环境：现有 Python 3.12.14、Node 24.21.0；新增临时依赖 yt-dlp 2026.8.19、yt-dlp-ejs 0.8.0、imageio-ffmpeg 0.6.0（FFmpeg 7.1）。原项目依赖和业务处理代码未改动。
- yt-dlp 成功取得纯音轨：format `140-12`，`vcodec=none`，`acodec=mp4a.40.2`，语言 `en-US`。未使用登录 cookies。
- FFmpeg 成功转换并完整解码：MP3、单声道、24 kHz、48 kb/s，318.79 秒，1,913,081 bytes。音频 SHA-256：`f47664d85d29c7e19193fb53ad13cf4f80cb0a6374ea4e20688ce66ff4183b26`。
- Gemini `gemini-3.5-flash-lite:countTokens` 返回 HTTP 200，`totalTokens=10201`，模态明细为 `AUDIO`。这证明接口可识别实际音频输入，不能替代生成能力验证。
- 信息提取请求只发送音频和提取指令，不提供视频标题、作者描述、字幕或链接作为模型依据。计划先提取带近似时间段的信息，再调用现有文本摘要适配器生成英文概述和 3–5 个要点。

## 实际生成结果

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

服务恢复后可明确发起一次新尝试（这会调用 Gemini）：

```bash
node --env-file=.env --import tsx scripts/validate-youtube-audio.mjs \
  /private/tmp/sharing-youtube-audio/0vZ_UVLhSQQ.mp3 \
  0vZ_UVLhSQQ recovery-1
```

脚本使用唯一尝试目录，拒绝覆盖既有记录；90 秒请求超时，无隐式重试。备用模型仅作用于该探测脚本。生成成功后才会继续摘要和结构校验，不会把部分成功记作完整成功。脚本已通过 Node 语法检查和 ESLint；不涉及 Next.js 页面或生产流程变更。

依据：[yt-dlp](https://github.com/yt-dlp/yt-dlp)、[Gemini 音频输入](https://ai.google.dev/gemini-api/docs/audio)、[生成 API](https://ai.google.dev/api/generate-content)、[模型价格页](https://ai.google.dev/gemini-api/docs/pricing)。
