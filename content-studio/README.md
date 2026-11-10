# dsh-content-factory（内容生产）

> 2026-11-04 起的产品形态与分发方式以 [需求对齐稿](../docs/需求对齐-2026-11-04.md) 为准：左侧栏主面板入口、私有 GitHub + 公开索引分发、本期不做独立 worker。

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

插件从**私有 GitHub 仓库** `https://github.com/True-Uso/dsh-content-factory` 分发；代码仓库保持私有，只把一份 metadata 索引放到公开静态页。同事在 DSH 的「插件 → 发现」里添加一次索引源，之后点「安装 / 更新」即可。完整步骤见 [docs/发布到GitHub.md](../docs/发布到GitHub.md)。

**1. 依赖**

`@ffmpeg-installer/ffmpeg` 和 `@ffprobe-installer/ffprobe` 会随 npm 安装按平台取二进制，运营不需要手动放 ffmpeg。解析顺序：显式配置 → `CONTENT_STUDIO_FFMPEG` / `CONTENT_STUDIO_FFPROBE` → `CONTENT_STUDIO_FFMPEG_DIR` → PATH → 插件安装目录的 `bin/` 和上级 `tools/bin` → `~/.content-studio/bin` → 随包安装的二进制。路径都由插件位置推导，不写死工作区。

如果仍然找不到，总控台就绪检查里有 **安装 ffmpeg** 按钮：优先从工作区 `tools/bin` 复制到插件安装目录的 `bin/`；插件目录不可写时回退到 `~/.content-studio/bin`；没有本地源才从 gyan.dev 下载。

**2. 配模型**

左侧栏「内容生产」→ **设置** → 模型配置。至少要三类才能产出：

| 角色 | 推荐 | 说明 |
|---|---|---|
| 文案 `llm` | OpenAI 兼容 `/chat/completions` | ChatGPT 或任意兼容网关 |
| 配音 `tts` | 百炼 `compatible-mode/v1` 的 `qwen-tts` | 也支持 OpenAI `/audio/speech` |
| 视频 `video` | `ark-seedance` / `comfyui` / `http-generic` | 本地 LTX 走后两个 |

生图 `image` 可选——不配时封面会用纯色底图，并在校验报告里标记 `degraded`。

配置写在 `~/.content-studio/providers.json`（可用 `CONTENT_STUDIO_HOME` 覆盖）。

**3. 本地改代码后怎么生效**

不用重启 DSH：用插件的热重载/重新激活加载新代码。Host 半侧（`index.js`、`lib/`）需要重新激活一代；客户端半侧由 DSH 的 HMR 处理。

---

## 用起来

1. 左侧栏「内容生产」打开**总控台**
2. 在输入框里写一句话，例如：`做 5 条秋日通勤穿搭，发抖音，每天 18:00 一条，预算 20 元`；素材目录可以一起填，点「让 AI 拆解」
3. 看 AI 给出的生产计划（平台、条数、时长、审核方式、发布时间、成本上限），确认创建；需要精确控制时点「高级设置」
4. 审核模式为「需人工审核」的批次，在「审核」页逐条看片、过稿或驳回；「自动放行」的批次直接进「待发布」
5. 「待发布」页逐条导出发布包；批次详情也能「导出整批」
6. 批次详情里点「生产日志」看批次与条目的完整执行记录

批次级护栏：

- **成本上限**：到 80% 页面提示，到 100% 自动暂停；批次详情可「提高上限并继续」
- **自动重试**：条目失败后自动重跑一次，仍失败才标记失败并保留原始错误
- **发布排期**：发布起点与间隔只记录，本期不自动发布

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
| GET | `/content-studio/api/meta` | 适配器类型、步骤、审核原因、平台预设 |
| GET | `/content-studio/api/health` | ffmpeg 状态、滤镜能力、队列 |
| POST | `/tools/install-ffmpeg` | 复制/下载 ffmpeg 到插件 `bin/`（不可写时回退到数据目录） |
| GET/PUT/DELETE | `/providers[/:id]` | 模型配置 |
| POST | `/providers/:id/health` `/test` | 健康检查 / 试跑 |
| POST | `/materials/scan` | 扫描素材目录 |
| GET | `/materials/groups` | 素材分组统计 |
| GET/POST | `/batches` | 批次列表（带用量、成本、成本上限状态）/ 创建 |
| POST | `/batches/parse` | 一句话需求 → 批次计划（LLM 或本地解析） |
| DELETE | `/batches/:id?purge=1` | 取消并删除产物目录 |
| POST | `/batches/:id/start\|pause\|resume\|cancel` | 批次控制 |
| POST | `/batches/:id/config` | 运行中改成本上限 / 审核模式 / 发布时间 |
| GET | `/batches/:id` | 批次详情（含步骤与校验报告） |
| GET | `/batches/:id/log` | 批次与全部条目的生产日志 |
| GET | `/batches/:id/export` | 整批发布包 ZIP |
| GET | `/items/:id` | 条目详情 |
| GET | `/items/:id/log` | 单条生产日志 |
| GET | `/items/:id/export` | 单条发布包 ZIP |
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
node tools/check.mjs               # 27 个模块加载
node tools/check-client.mjs        # 客户端 main/sidebar 契约
node tools/test-pipeline.mjs       # 56 项：字幕/ASS/WAV/文案/存储/配音
node tools/test-render.mjs         # 23 项：EDL + 真渲染 + 循环/转场/BGM/图片/16:9
node tools/test-media.mjs          # 50 项：扫描/索引清理/封面/三级校验/平台硬规格/去重/图片探测
node tools/test-pipeline-e2e.mjs   # 34 项：单条全链路 + 用量核算
node tools/test-worker.mjs         # 34 项：并发/续跑/暂停/去重/自动重试/自动放行/成本上限
node tools/test-platforms.mjs      # 22 项：平台预设与批次配置归一化
node tools/test-brief.mjs          # 31 项：一句话需求解析、LLM 合并、失败回退
node tools/test-export.mjs         # 11 项：发布包 ZIP 结构、CRC、缺失成片守卫
node tools/test-api.mjs            # 98 项：真 HTTP + 媒体 + 审核 + 导出 + 日志 + 自动放行 + brief 解析
node tools/test-adapters.mjs       # 25 项：ComfyUI / 方舟 / 生图 适配器契约
node tools/test-activate.mjs       # 17 项：激活路径
node tools/test-client-render.mjs  # 53 项：真 React 渲染 UI
node tools/acceptance.mjs          # 5 条批量验收，产出报告
```

合计 454 项断言。

`test-client-render` 需要本地 React：

```bash
cd ../tools/react-test && npm i react@18 react-dom@18 react-test-renderer@18
```

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 不是独立进程 | 队列跑在宿主进程内，关掉 DSH 不继续渲染；重启后自动续跑 |
| 未接真实模型 | 第三方模型用本地 mock 服务验证过完整链路，但没有用真实 API Key 跑过 |
| 日志与告警 | 有 `batch.log` / `item.log` 和页面日志查看；`api.log` / `render.log` 与系统通知未实现 |
| 分发 | 私有 GitHub + 自建索引，没有公共 npm/市场目录；索引文件需要单独托管 |
| ffmpeg 版本 | 随包安装的是 4.x 平台二进制；显式配置或 PATH 里的更新版本优先，需要回归滤镜 |
| 封面底图 | 未配生图模型时用纯色底图，报告标 `degraded` |
| 转场 | 只有硬切和淡入淡出（dip-to-black），没有交叉淡化——xfade 会缩短时间轴，与配音对齐冲突 |






