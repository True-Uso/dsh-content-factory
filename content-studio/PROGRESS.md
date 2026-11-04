# 开发进度（跨轮次续跑用）

> 每轮结束更新本文件，记录**已验证的事实**与**下一步**。
> 需求基线：[../需求规格说明书.md](../需求规格说明书.md)（v0.3）

## 环境事实

| 项 | 值 |
|---|---|
| Node | v24.11.0 |
| ffmpeg（开发用） | `D:\Projects\内容创作\tools\bin\{ffmpeg,ffprobe}.exe` |
| ffmpeg（宿主用） | `%USERPROFILE%\.content-studio\bin\`（宿主 cwd 不是工作区，靠这个找到） |
| ffmpeg 解析 | 配置 → 环境变量 → PATH → 插件自身位置 → cwd 向上 4 层 → `$HOME/.content-studio/bin` → 常见安装路径 |
| 插件 | `@local/content-studio`，entryId `include:content-studio` |
| 热重载 | `plugin_manager set_plugin enabled=false` 再 `true` 可加载新代码，**不需要重启 Harness** |
| 数据目录 | `~/.content-studio`（`providers.json` `materials.json` `bin/` `voice-cache/` `batches/`） |

## 本轮（第 20 轮）：滚动修复 + 一句话创建

- **滚动**：DSH 主面板是固定高度，插件根节点原来没有自己的滚动容器。现在 `.cs-page` 是 `height:100% / overflow-y:auto` 的滚动层，内容放在 `.cs-page-inner`；预览里用 900px 容器验证 `scrollHeight=2060`、`scrollTop` 可改变。
- **创建流程**：总控台顶部改成「描述你想生产什么」的大输入框 + 素材目录 + 「让 AI 拆解」；AI 返回计划卡（用户消息 / AI 摘要 / 平台、条数、时长、审核、发布时间、成本上限 / assumptions），确认后才创建。完整表单收进「高级设置」，不再默认铺满页面。
- **解析**：`lib/brief.js` 本地规则解析（条数、平台、时长、每天时间、预算、自动放行）+ 可选 LLM JSON 解析；LLM 失败自动回退并在计划卡里说明。`POST /batches/parse`。
- **批次列表**：四格统计条改成标题旁的内联计数；批次仍为行列表。
- **ffmpeg**：修了插件位置向上查找的循环 bug（之前 4 次都停在 `lib/` 和 `content-studio/`，到不了工作区 `tools/bin`）；就绪检查改成紧凑 alert，并加「安装 ffmpeg」按钮：优先从工作区复制到插件安装目录 `bin/`（不可写回退数据目录），否则从 gyan.dev 下载。`POST /tools/install-ffmpeg`。
- **目录选择**：DSH 的组合选择器只提供 `browse`，直接调 `pickDirectory()` 会报 native capability 错误。改为用 `uiWorkspace.listDirectory` 自己渲染一个目录浏览弹窗（面包屑 + 子目录 + 选择当前目录），不再出现原始报错。
- **测试**：新增 `test-brief` 31 项；`test-api` 98、`test-client-render` 53，全套 **454 项**通过。

## 本轮（第 19 轮）：UI 与 DSH 宿主对齐

真机装进 DSH Desktop 后，页面能打开但视觉与宿主不协调：控件矮小、无标签的表单、堆叠的卡片和重复告警。这一轮只改表现层，不动业务逻辑：

- **样式层**：`client.js` 注入一份 `content-studio-styles`，全部使用宿主 token（`--dsw-*`）：0.5px 边框、32px 控件、12/13/18px 字阶、8/12px 圆角、语义状态色。
- **结构**：标题 + 右侧刷新；下划线页签；四格统计条；批次改成行列表；新建批次默认在有批次时折叠，空态才展开；表单单页分「内容规格 / 发布设置 / 素材」三组，每个控件有标签。
- **状态**：就绪检查改成紧凑的 warning alert；批次动作按状态只显示可用项；成本条、发布包、日志、失败重试沿用同一套按钮和标签。
- **验证**：`tools/ui-preview.html` + `tools/ui-preview-server.mjs` 用真实 React 组件和假接口在浏览器里检查 960/1200 宽度；`test-client-render` 49 项通过；Impeccable detector 无 findings。
- **真机**：插件以 `link:` 安装到 DSH Desktop，改完刷新页面即可；不放心可卸载重装。

## 本轮（第 18 轮）：需求对齐落地

按 [../docs/需求对齐-2026-11-04.md](../docs/需求对齐-2026-11-04.md) 把插件从「设置页工作台」改成「左侧栏主面板」，并补齐本期功能：

- **入口**：客户端改为注册 `main` 面板 + `sidebar.panellist` 图标；不再注册 `settings.section`。
- **批次字段**：平台（抖音/小红书/视频号）、发布起点、发布间隔、审核模式（required/auto）、成本上限；`lib/platforms.js` 统一归一化。
- **校验**：平台画幅/时长区间/封面尺寸为硬校验，文案长度仍只警告；报告带平台 id。
- **自动放行**：`reviewMode=auto` 的条目校验通过后直接 `approved`，写入 `review.json`（`mode: auto`）。
- **自动重试**：失败自动重跑一次，`item.autoRetries` 记录，事件 `item:retry`；仍失败才进 failures。
- **成本护栏**：批次累计成本到 80% 发 `batch:cost-warning`，到 100% 暂停并记 `pauseReason: cost_cap`；可改上限后继续。
- **发布包**：`lib/zip.js`（store ZIP + CRC32）+ `lib/export.js`；接口 `GET /items/:id/export`、`GET /batches/:id/export`。
- **生产日志**：`GET /batches/:id/log` 与 `GET /items/:id/log`；页面批次详情可展开查看。
- **分发**：`package.json` 加 `engines.dsh`、ffmpeg 平台依赖；`tools/make-index.mjs` 生成 format-1 索引；步骤见 [../docs/发布到GitHub.md](../docs/发布到GitHub.md)。
- **测试**：新增 `test-platforms`（22）、`test-export`（11）；`test-worker` +10、`test-api` +19、`test-client-render` +5、`test-media` +3。全套 **415 项**通过。

**未验证**：还没有装进真实 DSH Desktop 0.2.1-rc.4 验证 `main` / `sidebar.panellist` 槽位和 Host `webServer` 路由；这是下一轮第一件事。

## 本轮（第 17 轮）：迁移收尾与可复现

仓库从 `D:\Projects\内容创作` 搬到 `D:\Projects\内容生产\内容创作` 后，做了一次收尾：

**验收脚本不再写死路径**：`tools/acceptance.mjs` 原来硬编码工作区绝对路径。
改为从脚本自身位置推出工作区（`import.meta.url` → 上一级），换机器/换目录都能跑。

**演示状态重建**：`demo-output/.state` 里旧批次的所有路径都指向搬迁前的目录，
示例批次是断链的。清掉旧索引与旧批次后重跑验收，5/5 产出，新批次
`batch-20261104-100039-qa6k`，报告已刷新。

**重跑时抓到一个真实缺陷**：素材索引里残留旧根目录下的条目，扫描只清理
「本次扫过的根目录」，所以这些死路径一直留着。选材会选中一个不存在的文件，
直到 `visual` 步骤才报 `ffmpeg: No such file or directory`——第一次重跑 5 条挂了 3 条。
修法：`pickMaterials` 选材时跳过文件不存在的条目，但**不从索引里删**（硬盘插回来还能用）。
测试：索引里删掉文件的条目不再被选中，其余素材照常可用。

**验证**：9 个测试脚本 345 项断言全部通过（`test-media` 45 → 47）。

## 本轮（第 16 轮）：索引与缓存的生命周期

**素材删除后索引不清理（真实缺陷）**：`scanMaterials` 只会新增/更新，从不删除。
运营删掉或移走素材后，索引里还留着旧路径，选材会选中一个不存在的文件，
流水线直到「复制镜头」那一步才失败，报错还看不出是素材没了。

现在扫描结束会做两件清理，且**只清理本次扫过的根目录**（不误删其他素材库）：

- 文件已不存在的条目 → 移除
- 本次探测失败的（损坏文件）→ 移除

测试：扫描 4 个 → 删掉 1 个 → 重扫，`removed=1`、索引剩 3 条、选材不会选到已删文件。

**配音缓存无限增长**：每句话一个 WAV，长期跑会堆出几万个文件。
启动时后台清掉 30 天前的和残留的 `.tmp`。只按时间清理、不按数量淘汰——
按数量淘汰会删掉最近还在用的热门句子。

## 本轮（第 15 轮）：补齐状态机守卫

之前接口层不检查条目当前状态，几个洞：

| 操作 | 之前 | 现在 |
|---|---|---|
| 通过一个「失败」的条目 | 允许（会变成已通过但没产物） | 409 |
| 驳回一个「已通过」的条目 | 允许 | 409 |
| 重复通过 | 允许 | 409 |
| 已通过条目改文案 | 允许（UI 挡了，接口没挡） | 409 |
| 已通过条目重新入队 | 允许（会丢掉审核结论） | 409 |
| 正在运行中重做 | 允许（会把运行中的步骤重置） | 409 |
| 删除正在运行的批次 | 允许（worker 继续往已删目录写） | 409 |

最后一条最危险：`?purge=1` 直接 `rm -rf` 批次目录，但队列里可能还有在跑的条目，
FFmpeg 正往那个目录写 `master.mp4`——删掉之后要么报错要么产生一半的文件。

线上验证：通过 → 200，再通过 → 409，撤回 → 恢复待审。

## 本轮（第 14 轮）新增

**目录选择器**：素材目录原来要手打 `D:\素材\穿搭`。接上宿主的 `uiWorkspace.pickDirectory`，
表单加了「选择目录」按钮，多次选择自动追加一行。拿不到该服务时按钮禁用并退化成手填。

**密钥不回传**：`GET /providers` 之前把 apiKey 原样回传，等于密钥在页面和网络里来回跑。
现在返回 `apiKey: "__stored__"` + `hasApiKey`，页面上填新值即替换、留空即清除。

实现时踩到一个坑：`upsertProvider` 是 `{...existing, ...record}`，
用 `delete` 移除 apiKey 会让旧密钥从 existing 里活下来——必须显式置 `undefined`。
测试直接抓到了（「空字符串清除密钥」失败），改成 undefined 后通过。

## 本轮（第 13 轮）新增

**建批次前的可行性提示**（`lib/preflight.js`）：创建批次时顺带算一遍「这批能不能跑」，把问题在你点开始之前说出来。

线上实测（未配置任何模型 + 6 个素材、单条要 8 个镜头）：

`
warnings: 未配置文案模型，文案步骤会失败
        未配置配音模型，配音步骤会失败
        素材库只有 6 个可用素材，少于单条 8 个镜头，会有重复画面
        未配置视频模型，且素材不足以覆盖全部镜头
estimate: items=3 expectedMinutes=3
`

只警告不阻断——真正必挂的问题由页面顶部「就绪检查」挡住，这里管的是「配置看着齐了但本身不匹配」，
比如选了素材库没有的分类、一次 60 条要跑两小时、磁盘只剩几百兆。

## 本轮（第 12 轮）：去重复、去死代码

**轮询逻辑合并**：`pipeline.js` 里有一份自己写的 `waitForVideo`，与 `lib/runner.js` 的 `runToCompletion` 重复。
两处都实现「queued 不算失败 / 超时 / failed 抛错」——重复就是漂移风险（ComfyUI 的 404 修复只改了 provider 层，但两份轮询逻辑迟早会分叉）。
现在 pipeline 直接用 `runToCompletion`，删掉重复实现。线上回归：2 条内容正常产出，生成镜头的 `taskId` 正确记录。

**删除死代码**：
- `tools/check-host.mjs`（旧版 index.js 的测试，早已失败且被 test-api 取代）
- `lib/api.js` 的 `GET /jobs` 桩（永远返回空数组）
- `pipeline.js` 的 `sleep`（合并后不再使用）

## 本轮（第 11 轮）新增

**三个适配器第一次有了测试**（	ools/test-adapters.mjs，25 项）：ComfyUI、方舟 Seedance、生图。

ComfyUI 是本地 LTX 最可能的接入方式，之前**没有任何测试**。写完立刻抓到一个必然发生的问题：

> ComfyUI 的 `/history/{id}` 在任务还没进历史时可能返回 **404**。适配器把非 2xx 一律当致命错误，于是第一次轮询就让整条内容失败。

修法：轮询遇到 404 视为「排队中」。这是典型的「一接真实服务就挂」——mock 太友好就会掩盖。

同时验证了工作流占位符替换：文本占位符替换成字符串，数字占位符保持数字类型（ComfyUI 节点要求 number，给字符串会报错）。

方舟适配器也补齐了请求体断言：model / 文本块 / ratio / duration / seed / watermark，以及未配置 modelId 时明确报错而不是静默失败。

**provider「测试」按钮的 llm/tts/image 分支**：之前只测过视频分支，另三个分支没跑过。补了 3 条。

## 本轮（第 10 轮）新增

**补齐三条从未被测过的渲染分支**（BGM 闪避、图片镜头、非 9:16 画幅、非 30fps）：

之前只测过「视频 + 无 BGM + 9:16 + 30fps」这一条主路径。补测后发现这三条都正常，
但把它们纳入回归——否则以后改动渲染器时，坏掉的是这三条没人守着的分支。
新增 5 条断言：图片镜头能渲染、16:9 尺寸、25fps 保持、BGM 混音后仍有音频且音量可测。

**图片素材探测尺寸**：原先图片直接跳过 ffprobe，宽高记 null。
现在走 ffprobe 拿到真实尺寸（时长为 0），小图能被识别。

**批次级并发配置**：`config.concurrency` 之前被忽略，runner 固定 2。
现在 `startBatch` 读取批次配置设置并发度（1–8），UI 表单也有输入框。
修的过程中发现 `concurrency` 是解构出来的 `const`，赋值直接抛 `Assignment to constant variable`——测试抓到的。

## 本轮（第 9 轮）新增

**同批次素材去重**：一批内容原来很可能挑到同一批素材，成片看起来一模一样。

第一次实现是「构建候选池时先按 exclude 过滤」——**并发下失效**：两个任务同时构图池时 exclude 还是空的，同时挑中同一个素材。线上实测 6 个镜头只有 5 个不同来源。

改成**每次取镜头时才检查 exclude**，取走立刻登记。重新线上验证：6 个镜头 6 个不同素材。

同时补了两处：

- 素材被用完后不再让整条内容失败，而是回退复用（`pickMaterials` 的 fallback）
- 长素材的取用起点按条目序号分散（`pickInSec`），避免每条都从第 0 秒开始

## 本轮（第 8 轮）新增

**UI 真渲染测试**：在 `D:\Projects\内容创作\tools\react-test` 装了 React 18 + react-test-renderer（仅测试用，不随插件发布）。
`tools/test-client-render.mjs` 用真的 React 渲染工作台：
- 静态渲染：整棵组件树能构建，三个页签、表单、空态都在
- 挂载渲染：用假接口跑真实 `useEffect`，断言批次列表、审核卡片的标题/按钮/校验结论/播放器/翻页计数都出来了

这填上了之前唯一的盲区——页面对着浏览器跑不了。现在 42 项断言覆盖 UI。

**首次使用就绪检查**：缺 ffmpeg 或缺文案/配音/视频模型时，页面顶部直接列出缺什么，并给「去配置模型」按钮，而不是让用户建完批次才发现跑不动。

**provider「测试」按钮变成真生成**：视频适配器不再只做健康探测，而是真的提交一个 3 秒镜头、轮询到出片、返回地址。这是「填完配置就能用」的实证按钮。

## 本轮（第 7 轮）新增

**审核流程补齐**（SPEC FR-11）：

- 文案可编辑：标题 / 简介 / 标签 / 封面主副文案。**只重跑校验，不重新渲染**（`POST /items/:id/script`）
- 多张连翻：审核台带「上一条 / 下一条」和 `n / total` 计数，通过后自动跳下一条
- 键盘快捷键：`A` 通过 · `R` 驳回 · `← →` 翻页；输入框内打字不触发
- 批量通过：批次详情有「通过全部待审」，逐条调用并汇总失败
- 撤回通过：`POST /items/:id/unapprove`，记录 `decision: withdrawn`

## 本轮（第 6 轮）新增

**成本核算（SPEC FR-12）**：`lib/cost.js` + 各步用量采集。
只记录可测量的量：provider 报的 token、实际合成的字符、实际生成的秒数、实际生图的张数。
命中配音缓存的句子**不计费**（`ttsReusedCharacters` 单列）。没填价目表时金额为 0 且 `priced=false`，不编数字。

**批次删除**：`DELETE /batches/:id?purge=1` 会连产物目录一起删；UI 有按钮并二次确认。

**Origin 校验**：回环地址不够——浏览器里任何页面都能打 127.0.0.1。
现在带 `Origin` 头且不等于 `webServer.getOrigin()` 的请求直接 403（已线上验证：evil 403 / 自源 200）。

## 测试命令与当前结果

| 命令 | 覆盖 | 结果 |
|---|---|---|
| `node tools/check.mjs` | 27 个模块加载 | ✅ |
| `node tools/test-pipeline.mjs` | 字幕/ASS/WAV/文案/存储/配音 | ✅ 56 |
| `node tools/test-render.mjs` | EDL + 真渲染 + 循环/转场/BGM/图片/16:9 | ✅ 23 |
| `node tools/test-media.mjs` | 扫描/索引清理/封面/校验/平台硬规格/去重/图片 | ✅ 50 |
| `node tools/test-pipeline-e2e.mjs` | 单条全链路 8 步 + 用量核算 | ✅ 34 |
| `node tools/test-worker.mjs` | 并发/续跑/暂停/去重/自动重试/自动放行/成本上限 | ✅ 34 |
| `node tools/test-platforms.mjs` | 平台预设与批次配置归一化 | ✅ 22 |
| `node tools/test-brief.mjs` | 一句话需求解析、LLM 合并、失败回退 | ✅ 31 |
| `node tools/test-export.mjs` | 发布包 ZIP 结构、CRC、缺失成片守卫 | ✅ 11 |
| `node tools/test-adapters.mjs` | ComfyUI / 方舟 / 生图 适配器契约 | ✅ 25 |
| `node tools/stress-worker.mjs 8` | 并发压力（24 条） | ✅ NO FAILURES |
| `node tools/test-api.mjs` | 真 HTTP：CRUD/媒体/审核/重做/导出/日志/SSE/自动放行/brief 解析 | ✅ 98 |
| `node tools/test-activate.mjs` | 真 apply()：路由/effect/续跑/降级 | ✅ 17 |
| `node tools/test-client-render.mjs` | 真 React 渲染 UI（静态 + 挂载 + 主面板/侧栏注册） | ✅ 53 |
| `node tools/acceptance.mjs` | 5 条批量验收 → `../验收报告.md` | ✅ 5/5 |

合计 454 项断言通过，另有 24 条并发压测零失败。

> `test-client-render` 依赖 `../../tools/react-test/node_modules` 里的 React。
> 干净环境需先 `cd ../tools/react-test && npm i react@18 react-dom@18 react-test-renderer@18`。

## 真实宿主内验证（第 5–6 轮完成）

不是模拟，是通过线上插件接口跑的真实链路：

1. `plugin_manager` 关→开插件即可加载新代码（无需重启 Harness）
2. 起 `tools/mock-suite.mjs` 提供 OpenAI 兼容文案 / TTS / 异步视频
3. `PUT /providers` 配三个模型 → 健康检查全通过
4. `POST /materials/scan` → 6 个素材
5. `POST /batches` → `start` → 3 条在 4 秒内全部到 review_pending
6. 校验 18/18 通过，`GET /media` 200 + video/mp4，Range 206，路径穿越 403/404
7. **UI 槽位确认**：`Slots.listSubTree settings.section` 里能看到 `content-studio`（order 60，active）
8. **成本核算**：线上批次返回 `totals.usage` 与 `cost`，示例批次 3 条 ≈ ¥2.70

## 当前数据目录状态

- 迁移后的机器上还没有 `~/.content-studio`（插件尚未在宿主里重新激活），真实 key 需要重新填。
- 仓库内演示证据：`../demo-output/.state`（通过 `CONTENT_STUDIO_HOME` 指定），
  批次 `batch-20261104-100039-qa6k`，5 条待审，含成本明细。
- 旧机器的 `~/.content-studio/batches/batch-20261104-000914-v4tk` 不在本仓库。

## 已知未做

- 真实第三方 API Key 未验证（无 key）
- 还没有装进真实 DSH Desktop 0.2.1-rc.4 验证 `main` / `sidebar.panellist` 槽位与 Host `webServer` 路由
- 不是独立进程（关掉 DSH 不继续渲染）
- `api.log` / `render.log` 与系统通知未做（`batch.log` / `item.log` + 页面日志已有）
- UI 只在 React test-renderer 里渲染过，未在真实浏览器/宿主里做视觉验收

## 本轮修的缺陷

**1. ffmpeg 在真实宿主里找不到**
宿主进程 cwd 是安装目录，不是工作区，「从 cwd 向上找 tools/bin」在开发时能过、上线就挂。
修法：解析顺序加入**插件自身位置**和 `$HOME/.content-studio/bin`，并把静态构建复制到后者。
验证：线上 `/health` 从 `ffmpeg.ok=false` 变为 `true`。

**2. 素材比镜头时长短会截短成片**
原先 `-ss/-t` 直接切源片，源片 2s、镜头要 4s 时只能出 2s，concat 后总长短于配音。
修法：探测源片，不够长就用 `-stream_loop -1` 循环输入 + 输出侧 seek。
回归测试：3 个 2s 素材 + 14s 配音 → 成片 14s。

**3. 转场**
加了 dip-to-black（每镜头首尾 fade），`transition` 可按批次配置。
**没有做真 xfade**：交叉淡化会缩短时间轴，与「视频总长必须等于配音时长」冲突，收益不抵风险。

## 已完成

| 模块 | 文件 | 状态 |
|---|---|---|
| provider 注册表 + 6 种适配器 | `lib/providers.js` `lib/providers/*` | ✅ |
| 批次/条目存储 + 状态机 | `lib/batch-store.js` | ✅ |
| 素材扫描/索引/去重/分组 | `lib/steps/scan.js` | ✅ |
| 文案 / 配音 / 字幕 / 渲染 / 封面 / 校验 | `lib/steps/*` | ✅ |
| 单条编排（断点续跑） | `lib/pipeline.js` | ✅ |
| 批量队列（并发/暂停/取消/续跑） | `lib/worker.js` | ✅ |
| HTTP 接口（批次/条目/媒体/SSE/导出/日志/brief） | `lib/api.js` | ✅ 98 项 |
| 工作台 UI（批次/审核/模型配置） | `client.js` | ⚠️ 仅结构验证 |
| 启动自动续跑 | `index.js` | 代码就绪 |

## 待办

1. **装进真实 DSH Desktop 验证**：左侧栏图标、主面板、Host `webServer` 路由、ffmpeg 依赖解析；这是下一步的第一件事。
2. **真实模型联调**（需要 key）：方舟 Seedance 的模型 ID/响应字段、百炼字级时间戳、ChatGPT 文案契约。
3. **FR-13 独立 worker 进程**：持久化队列 + 任务级锁 + 优雅退出 + 崩溃退避，关掉 DSH 也能继续渲染。
4. **真实浏览器 UI 走查 + P4 压测**：20 条批量、杀进程续跑、成本上限极限验证。

## 已知偏差

- 常驻 worker 是宿主进程内队列 + 启动续跑，不是独立进程（关掉 Harness 不继续渲染）。
- 真实第三方模型（ChatGPT/百炼/方舟）未用真 key 跑过，全部用 mock 验证链路。

## 本轮修的三个真实缺陷

1. **跳过步骤返回了 `{skipped:true}` 哨兵**：续跑时下游步骤会拿到垃圾。改为每步有 loader 从磁盘重建产物。
2. **配音缓存并发写坏**：同批次多条相同句子共用一个缓存键，读到半写的 WAV。改为原子写 + 解析失败当缓存未命中。
3. **Windows 上 `rename` 偶发 EPERM**：`writeJson` 的临时文件名只带毫秒时间戳，同毫秒两次写入撞名；且 Windows 不允许覆盖正被读取的文件。改为唯一临时名 + 重试退避。压测 24 条后零失败。

## 下一步（按优先级）

1. **API 扩展**：`/batches` CRUD、启动/暂停/取消、`/items/:id/rerun|approve|reject`、媒体流。
2. **启动时续跑**：插件激活时 `resumeUnfinished()`。
3. **UI**：批次列表 → 批次详情（步骤进度）→ 审核台（播放/封面/通过/驳回/局部重做）。
4. **验收报告**：5 条真实批量 + 全部证据。

## 设计决策（代码已生效）

- 渲染多趟而非单条巨型 filter graph：失败可定位、单镜头可重渲。
- 字幕烧在 `-filter_complex` 内（`-vf` 与 `-filter_complex` 同流冲突）。
- 字幕在 EDL 中可选，无字幕也能出片。
- 配音时间轴由拼装 PCM 实测，不采信接口返回的时长。
- `stateMap` 权威：未映射状态一律 `running`，不回退内置别名。
- 渲染子进程 cwd 固定在本目录，规避 Windows 路径转义。
- v0.1 的「常驻 worker」是宿主进程内队列 + 启动续跑；独立进程化是后续升级项（已在报告标注）。







