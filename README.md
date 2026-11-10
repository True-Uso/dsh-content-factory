# dsh-content-factory（内容生产）

DeepSeek Harness（DSH）插件：**一句话批量生产社交媒体短视频**，从素材到文案、配音、混剪、封面、校验、人工审核、发布包导出，一条链路跑完。

```
描述需求 → AI 拆解计划 → 素材/文案 → 配音 → 字幕 → 画面 → 剪辑 → 渲染
        → 封面 → 三级校验 → 人工审核/自动放行 → 发布包导出
```

插件代码在 [`content-studio/`](content-studio/)；包名与仓库名是 `dsh-content-factory`，市场显示名为「内容生产」。

---

## 能做什么

- **一句话创建**：写「做 5 条秋日通勤穿搭，发抖音，每天 18:00 一条，预算 20 元」，AI 拆成批次计划，确认后创建
- **批量生产**：文案、配音、字幕、素材混剪、AI 生成镜头、确定性渲染，断点续跑
- **可插拔模型**：方舟 Seedance、本地 ComfyUI、任意自建 HTTP 视频服务；文案/配音/生图走 OpenAI 兼容接口
- **质量闸口**：L1/L2/L3 三级校验 + 平台规格硬校验；失败自动重试一次
- **人工审核**：按批次配置「需审核 / 自动放行」，支持通过、驳回、局部重做、批量通过、撤回
- **成本护栏**：批次成本 80% 提示、100% 自动暂停
- **发布包**：成片 + 三尺寸封面 + 文案 + 校验报告，打成 ZIP 交给运营手工发布

---

## 安装

### 直接 GitHub（推荐给同事）

1. **插件 → 添加插件**
2. 安装来源填：
   `https://github.com/True-Uso/dsh-content-factory`
3. 确认来源 → 安装；装完刷新，左侧栏出现「内容生产」

仓库根目录是一个可安装的 DSH 包，实际代码在 [`content-studio/`](content-studio/)，根入口只负责转发 Host/Client。

### 本地开发（DSH Desktop）

插件管理器也可以直接安装本地目录：

1. **插件 → 添加插件**
2. 安装来源填本仓库根目录
3. 装完刷新；左侧栏出现「内容生产」

当前 profile 也可以通过 `link:` 指向本仓库，改代码后关开插件即可重载 Host 半侧。

### 团队分发（GitHub + 自建索引）

代码留在 GitHub，另建一个公开的 metadata 索引仓库，同事在 DSH「插件 → 发现」添加索引源后一键安装/更新。完整步骤见 [docs/发布到GitHub.md](docs/发布到GitHub.md)。索引的 source 指向仓库根目录（根包），不需要 `--path`。

---

## 第一次使用

1. 打开左侧栏 **内容生产 → 设置**，配置文案、配音、视频模型；生图可选
2. 如果 ffmpeg 未就绪，点「安装 ffmpeg」（优先从插件安装目录/工作区 `tools/bin` 复制，否则下载）
3. 回「总控台」，在输入框描述需求，点「让 AI 拆解」
4. 确认计划后创建批次 → 开始
5. 跑完在「审核」过稿；「待发布」导出发布包

---

## 测试

```bash
cd content-studio
node tools/check.mjs               # 27 个模块加载
node tools/check-client.mjs        # 客户端 main/sidebar 契约
node tools/test-brief.mjs          # 一句话解析
node tools/test-pipeline.mjs       # 字幕/WAV/文案/存储/配音
node tools/test-render.mjs         # EDL + 真渲染
node tools/test-media.mjs          # 扫描/校验/封面/去重
node tools/test-pipeline-e2e.mjs   # 单条全链路
node tools/test-worker.mjs         # 并发/续跑/重试/成本上限
node tools/test-platforms.mjs      # 平台预设
node tools/test-export.mjs         # 发布包 ZIP
node tools/test-api.mjs            # 真 HTTP 接口
node tools/test-activate.mjs       # 激活路径
node tools/test-client-render.mjs  # 真 React 渲染 UI
node tools/acceptance.mjs          # 5 条批量验收
```

合计 **454 项断言**。`test-client-render` 需要本地 React（见 `content-studio/README.md`）。

---

## 目录

```
.
├─ content-studio/          # DSH 插件本体（Host + Client）
│  ├─ index.js              # Host 入口：webServer 路由 + runner
│  ├─ client.js             # 客户端：左侧栏主面板 + 总控台 UI
│  ├─ lib/                  # 流水线、适配器、存储、接口、brief 解析
│  └─ tools/                # 测试、验收、索引生成、UI 预览（不随包发布）
├─ docs/
│  ├─ 需求对齐-2026-11-04.md
│  ├─ 发布到GitHub.md
│  └─ adr/                  # 6 条架构决策
├─ GLOSSARY.md              # 领域术语
├─ 需求规格说明书.md          # v0.3 基线
├─ 验收报告.md               # 5 条批量验收证据
└─ 验收指南.md               # 怎么验收、哪些没做到
```

## 文档

- 需求基线：[需求规格说明书.md](需求规格说明书.md)
- 本轮对齐：[docs/需求对齐-2026-11-04.md](docs/需求对齐-2026-11-04.md)
- 开发过程与决策：[content-studio/PROGRESS.md](content-studio/PROGRESS.md)
- 术语：[GLOSSARY.md](GLOSSARY.md)
- 架构决策：[docs/adr/](docs/adr/)
- 验收：[验收报告.md](验收报告.md) · [验收指南.md](验收指南.md)

## 已知限制

- 平台自动上传/发布、日历排期未做（本期只产出发布包）
- 不是独立 worker 进程：关掉 DSH 会停止渲染，重启后断点续跑
- 真实第三方 API key 尚未联调（方舟 Seedance / 百炼 TTS / ChatGPT）
- 随包 ffmpeg 为 4.x，真实安装后需要回归渲染滤镜
- 单机单用户，无团队账号与权限体系
