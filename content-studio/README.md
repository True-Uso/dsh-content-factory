# Content Studio（内容工坊）

DeepSeek Harness 插件：**批量生产短视频**，从素材到成片到审核一次跑完。

```
素材扫描 → 文案 → 配音 → 字幕 → 画面（素材库 + AI 生成）
        → 剪辑方案 → 渲染 → 封面 → 三级校验 → 人工审核
```

- **可插拔模型**：方舟 Seedance、本地 ComfyUI、任意自建 HTTP 服务、ChatGPT、百炼——填配置就接，不改代码
- **确定性渲染**：LLM 只输出剪辑方案（EDL），FFmpeg 负责执行；同方案同输出
- **断点续跑**：任何一步失败只重跑那一步；进程崩溃后自动续跑
- **人工闸口**：通过 / 驳回 / 局部重做，发布前必须过人

完整需求见 [`../需求规格说明书.md`](../需求规格说明书.md)，开发进度见 [`PROGRESS.md`](PROGRESS.md)。

---

## 安装

插件已作为 bundle 装入当前 profile（entryId `include:content-studio`）。

**1. 准备 ffmpeg**

解析顺序：配置路径 → `CONTENT_STUDIO_FFMPEG` / `CONTENT_STUDIO_FFPROBE` → PATH → 插件自身位置 → 工作目录向上 4 层的 `tools/bin` → `~/.content-studio/bin` → `C:\ffmpeg\bin`。

宿主的 cwd 是安装目录而不是工作区，所以**首选把二进制放到 `~/.content-studio/bin/`**（本机已经放好）。打开「设置 → 内容工坊 → 模型配置」能看到 ffmpeg 是否就绪。

**2. 改代码后怎么生效**

不用重启 Harness：`plugin_manager` 把 `include:content-studio` 关掉再打开即可加载新代码。
（`client.js` 侧由 HMR 处理；`index.js` 这类 Host 模块靠重新激活换一代。）

**3. 配模型**

至少要三类才能产出：

| 角色 | 推荐 | 说明 |
|---|---|---|
| 文案 `llm` | OpenAI 兼容 `/chat/completions` | ChatGPT 或任意兼容网关 |
| 配音 `tts` | 百炼 `compatible-mode/v1` 的 `qwen-tts` | 也支持 OpenAI `/audio/speech` |
| 视频 `video` | `ark-seedance` / `comfyui` / `http-generic` | 本地 LTX 走后两个 |

生图 `image` 可选——不配时封面会用纯色底图，并在校验报告里标记 `degraded`。

配置写在 `~/.content-studio/providers.json`（可用 `CONTENT_STUDIO_HOME` 覆盖）。

---

## 用起来

1. 打开 **设置 → 内容工坊**
2. 「批次」页填主题、条数、素材目录，先点「扫描素材」
3. 「创建批次」→ 在列表里点开 → 「开始」
4. 跑完在「审核」页逐条看片、过稿或驳回

审核台支持按步骤局部重做：改文案就重跑「文案起」，换封面就重跑「封面起」，不重跑前面的。

审核台的效率设计：

- **文案直接改**：标题 / 简介 / 标签 / 封面文案可编辑，保存后**只重跑校验**，不重新渲染
- **连翻**：上一条 / 下一条 + 计数，通过后自动跳下一条
- **快捷键**：`A` 通过 · `R` 驳回 · `← →` 翻页
- **批量通过**：批次详情里一键通过全部待审
- **撤回**：已通过的条目可以撤回重审

---

## 模型接入：三种视频适配器

### `http-generic`：任意自建 HTTP 服务

```json
{
  "id": "ltx-local",
  "kind": "http-generic",
  "enabled": true,
  "baseUrl": "http://127.0.0.1:9000",
  "defaults": { "width": 768, "height": 1344, "durationSec": 5, "fps": 24 },
  "poll": { "intervalMs": 2000, "timeoutMs": 900000 },
  "protocol": {
    "health": { "method": "GET", "path": "/health" },
    "submit": { "method": "POST", "path": "/generate",
                "body": { "prompt": "${prompt}", "num_frames": "${frames}", "seed": "${seed}" } },
    "poll":   { "method": "GET", "path": "/tasks/${taskId}" },
    "extract": {
      "taskId": "$.task_id",
      "state": "$.data.status",
      "videoUrl": "$.data.video_url",
      "error": "$.data.message"
    },
    "stateMap": {
      "queued": ["pending", "queued"],
      "running": ["running", "processing"],
      "succeeded": ["success", "done"],
      "failed": ["error", "failed"]
    }
  }
}
```

规则：

- `${x}` 在字符串里做替换；**整个字符串恰好是 `${x}`** 时按原类型插入（数字保持数字）
- 可用变量：`prompt` `negativePrompt` `seed` `durationSec` `frames` `width` `height` `fps` `aspectRatio` `resolution` `imageUrl` `firstFrame` `lastFrame` `watermark` `taskId`，外加 `defaults` 里的自定义键
- **`stateMap` 是权威的**：配了它之后未映射的状态一律按 `running` 处理，不会偷偷回退到内置别名。映射写错会表现为一直 `running` 直到超时——这是故意的，静默成功更难查

### `comfyui`：本地 ComfyUI

导出 API 格式工作流 JSON，把要变的节点值写成 `{{prompt}}` `{{seed}}` `{{width}}` 这类占位符，配置里用 `workflowRef` 指过去（或 `workflow` 内联）。

### `ark-seedance`：字节方舟

**预留状态**：填入控制台开通的模型 ID 与 API Key 后启用。未配置时健康检查会明确报「缺少 modelId」，不会假装可用。

---

## HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/content-studio/api/meta` | 适配器类型、步骤、审核原因 |
| GET | `/content-studio/api/health` | ffmpeg 状态、滤镜能力、队列 |
| GET/PUT/DELETE | `/providers[/:id]` | 模型配置 |
| POST | `/providers/:id/health` `/test` | 健康检查 / 试跑 |
| POST | `/materials/scan` | 扫描素材目录 |
| GET | `/materials/groups` | 素材分组统计 |
| GET/POST | `/batches` | 批次列表（带用量与成本汇总）/ 创建 |
| DELETE | `/batches/:id?purge=1` | 取消并删除产物目录 |
| POST | `/batches/:id/start\|pause\|resume\|cancel` | 批次控制 |
| GET | `/batches/:id` | 批次详情（含步骤与校验报告） |
| GET | `/items/:id` | 条目详情 |
| POST | `/items/:id/rerun` | 从某步重做（`{from:'script'\|'voice'\|'render'\|'cover'}`） |
| POST | `/items/:id/approve\|reject\|retry` | 审核 |
| GET | `/media/:batchId/:itemId/<相对路径>` | 产物（支持 Range） |
| GET | `/events` | SSE 进度流 |

仅接受本机回环请求，并校验 `Origin`：带来源头且与本机 Web 源不符的请求返回 403。

## 用量与成本

每个条目记录可测量的用量：文案 token、实际合成字符、命中缓存的字符、生成秒数、生图张数。
金额 = 用量 × 批次配置里的 `pricing`；**不配价目表时金额为 0 且标记 `priced: false`**，不会编造数字。

```json
"pricing": { "llmPerMTokens": 2, "ttsPerKChars": 0.1, "videoPerSecond": 0.3, "imagePerImage": 0.2 }
```

命中配音缓存的句子不计费——同一批次里重复的句子只收一次钱。

---

## 目录结构

```
content-studio/
├─ index.js              # Host：接线（runner + api + 续跑）
├─ client.js             # Client：工作台 UI
├─ lib/
│  ├─ api.js             # HTTP 接口
│  ├─ worker.js          # 并发队列、暂停、续跑
│  ├─ pipeline.js        # 单条 8 步流水线
│  ├─ batch-store.js     # 批次/条目存储与状态机
│  ├─ edl.js             # 剪辑方案与校验
│  ├─ ffmpeg.js          # 二进制解析、探测、响度、抽帧
│  ├─ wav.js             # PCM 拼装
│  ├─ providers/         # llm / tts / image
│  └─ steps/             # scan / script / voice / subtitle / cover / render / validate
└─ tools/                # 测试与验收脚本（不随包发布）
```

产物目录：

```
~/.content-studio/batches/batch-YYYYMMDD-HHMMSS-xxxx/item-001/
  01-script/script.json
  02-voice/voice.wav  voice.mp3  voice.segments.json  duration.json
  03-subtitle/subtitle.srt  subtitle.ass  subtitle.json
  04-visual/gen/…  picked/…  manifest.json
  05-edl/edit-plan.json
  06-render/master.mp4  thumb.jpg
  07-cover/bg.png  cover-vertical.png  cover-horizontal.png  cover-square.png
  08-validate/report.json
  09-review/review.json
```

---

## 测试

```bash
node tools/check.mjs              # 22 个模块加载
node tools/test-pipeline.mjs      # 56 项：字幕/ASS/WAV/文案/存储/配音
node tools/test-render.mjs        # 23 项：EDL + 真渲染 + 循环/转场/BGM/图片/16:9
node tools/test-media.mjs         # 47 项：扫描/索引清理/封面/三级校验/素材去重/图片探测
node tools/test-pipeline-e2e.mjs  # 34 项：单条全链路 + 用量核算
node tools/test-worker.mjs        # 24 项：并发/续跑/暂停/去重/并发配置
node tools/test-api.mjs           # 75 项：真 HTTP + 媒体 + 审核 + 模型测试
node tools/test-adapters.mjs      # 25 项：ComfyUI / 方舟 / 生图 适配器契约
node tools/test-activate.mjs      # 17 项：激活路径
node tools/test-client-render.mjs # 44 项：真 React 渲染 UI
node tools/acceptance.mjs         # 5 条批量验收，产出报告
```

合计 345 项断言。

`test-client-render` 需要本地 React：

```bash
cd ../tools/react-test && npm i react@18 react-dom@18 react-test-renderer@18
```

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 不是独立进程 | 队列跑在宿主进程内，关掉 Harness 不继续渲染；重启后自动续跑 |
| 未接真实模型 | 第三方模型用本地 mock 服务验证过完整链路，但没有用真实 API Key 跑过 |
| 成本护栏 | 只有用量记账与建批次预检；运行中 80% 告警、100% 自动暂停未实现 |
| 日志与告警 | 有 `batch.log` / `item.log`；`api.log` / `render.log` 与页面红点未实现 |
| 封面底图 | 未配生图模型时用纯色底图，报告标 `degraded` |
| 转场 | 只有硬切和淡入淡出（dip-to-black），没有交叉淡化——xfade 会缩短时间轴，与配音对齐冲突 |






