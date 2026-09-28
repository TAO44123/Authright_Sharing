# A4 真实服务验收

> 历史记录：以下是 2026-09-27 的文章摘要和视频元数据验收，不代表新音频摘要流程已验收，也不是当前分享状态。Claude.ai 样本后续 generation=2 因主机音频工具缺失失败，修复后 generation=3 已完成音频摘要。新流程及本地迁移状态见 [音轨验证](YOUTUBE_AUDIO_GEMINI.md)。旧 A4 脚本用于历史流程，新音频 Worker 的独立复测使用 `scripts/validate-youtube-worker.ts`。

日期：2026-09-27。用户将样本要求由 15–20 条改为 6 条（文章、视频各 3 条），并要求测试后保留。以下 6 条已通过普通分享流程保存在本地 `sharing` 库的管理员账号名下，验收当时状态均为 `ready`；再次运行 `pnpm a4:validate tao.xu@authright.com` 使用固定幂等键复查，不会重复创建分享或重新调用已完成内容。

| 类型 | 公开 AI 来源 | 分享 ID | 实际结果 |
| --- | --- | --- | --- |
| 文章 | [DeepMind AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) | `0af83278-e559-4a97-b0ff-06ed482e9227` | 10,501 字符正文，英文概述和 4 个要点 |
| 文章 | [Google ATLAS](https://blog.google/innovation-and-ai/technology/research/understanding-the-ai-economy/) | `abf50a79-a5fd-46eb-acd6-51cfd33400b2` | 7,119 字符正文，英文概述和 5 个要点 |
| 文章 | [Hugging Face smolagents](https://huggingface.co/blog/smolagents) | `17661d51-cbd0-4433-88e0-4bab727dff47` | 11,548 字符正文，英文概述和 4 个要点 |
| YouTube | [Google DeepMind + Gemini I/O 2025](https://www.youtube.com/watch?v=Z8Qip0kgl3A) | `5c126d01-80d3-4612-97eb-b5f88eff07d2` | 标题、可嵌入状态、原始 Description（728 字符） |
| YouTube | [OpenAI Introducing GPT-5](https://www.youtube.com/watch?v=boJG84Jcf-4) | `d40ba8ed-22d2-4c6a-b7f3-e6534faee7b0` | 标题、可嵌入状态、原始 Description（502 字符） |
| YouTube | [Anthropic Getting started with Claude.ai](https://www.youtube.com/watch?v=0vZ_UVLhSQQ) | `8f2511da-a2b8-441a-839b-8d58c8d58936` | 标题、可嵌入状态、原始 Description（479 字符） |

候选 [OpenAI NextGenAI](https://openai.com/index/introducing-nextgenai/) 对应用的服务器抓取返回 `ACCESS_RESTRICTED`，因此按失败分类记录并换为 Hugging Face 文章。没有绕过来源访问限制。页面可访问性、可嵌入声明与浏览器实际视频播放是不同事项；真实 API 已验证元数据和 `embeddable=true`。后续 A5 浏览器核对发现 iframe 的 `no-referrer` 会触发 YouTube 153 配置错误，已改为发送站点 origin，并验证嵌入请求的 Referer；视频真正开始播放仍取决于用户浏览器及网络，尚未作为完成项。

文章使用 `gemini-3.5-flash-lite` 的单次 `generateContent` REST 调用，限制 JSON 结构、最多 2048 输出 tokens、90 秒请求期限；不启用 SDK 或隐式重试。三篇生产处理事件均记录输入、含思考 tokens 的输出、模型、请求 ID、单价版本。验收当时应用误用了 Paid tier 单价，下面保留原始快照仅供核对：

| 文章 | 输入 tokens | 输出 tokens | 按付费标准价估算 |
| --- | ---: | ---: | ---: |
| AlphaEvolve | 2,120 | 172 | $0.0010660 |
| ATLAS | 1,560 | 205 | $0.0009805 |
| smolagents | 2,754 | 144 | $0.0011862 |
| 合计 | 6,434 | 521 | $0.0032327 |

用户随后确认当前 Gemini API 项目为 Free tier。[官方价格页](https://ai.google.dev/gemini-api/docs/pricing)列出的本模型 Free tier 文本输入和输出均免费。因此上表及接入前 AlphaEvolve 独立探测（2,120 输入、178 输出 tokens，按 Paid 价等价 $0.001081）均**不是实际支出**；历史 `usage_events` 快照保留，不改写审计事实。此后 Worker 通过显式 `GEMINI_BILLING_TIER=free` 为已知成功调用写入零单价/零估算金额；如项目变为 Paid tier，须同步修改配置并核对 AI Studio。

人工抽查了摘要中 AlphaEvolve 的算法改进、ATLAS 的工作任务比例及非工作用途、smolagents 的代码动作和沙箱支持，均能在原文找到依据。抽样结果不能保证其他站点的可抓取率或所有摘要的事实准确性。结构、故障、并发、配额及视频空描述/不可嵌入回退另由单元、集成和浏览器夹具测试覆盖。`CONTENT_PROCESSING_ENABLED=true` 已写入本地 `.env`；模板继续默认 `false`，需要 Worker 进程运行才会自动消费后续链接。

本地 Worker 曾以启用模式启动并处理此前排队的两条链接：Better Auth 文档生成了摘要；知乎链接返回 `ACCESS_RESTRICTED`，原分享保留并显示失败。六条样本的验收命令再次运行后分享 ID 未变；数据库总分享数仍为 8，模型事件为 4 条（3 条样本文章及 1 条原有 Better Auth 文章），证明复查未新增模型调用。
