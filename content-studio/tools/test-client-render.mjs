/**
 * 客户端真实渲染测试（用真 React 18 + react-dom/server）。
 * 覆盖最容易导致「页面整块空白」的问题：hooks 顺序、渲染期未定义访问、非法元素类型。
 *   node tools/test-client-render.mjs
 *
 * React 装在 ../../tools/react-test/node_modules（仅测试用，不随插件发布）。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const REACT_DIR = join(process.cwd(), '..', 'tools', 'react-test', 'node_modules')
const React = await import(pathToFileURL(join(REACT_DIR, 'react', 'index.js')).href)
const ReactDOMServer = await import(pathToFileURL(join(REACT_DIR, 'react-dom', 'server.node.js')).href)

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

/* ---------- 模块加载器桩 ---------- */
let factory = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory: fn }) {
      if (id !== 'dsh-content-factory') throw new Error(`意外的模块 id：${id}`)
      factory = fn
    },
  },
  addEventListener() {},
  removeEventListener() {},
  confirm: () => false,
}

// 组件首次渲染不会真的发请求（useEffect 在 SSR 不执行），这里仍然给一个桩，
// 防止未来某次改动把 fetch 提前到渲染期而静默失败。
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  text: async () => '{}',
  json: async () => ({}),
})

await import('../client.js')
check('client.js 调用了模块加载器', typeof factory === 'function')

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}
const mod = factory(requireStub)
check('factory 返回 apply', typeof mod.apply === 'function')

/* ---------- 注册到假 slots ---------- */
const registrations = []
const ctx = {
  slots: {
    inject(key, callback) {
      if (key !== 'main' && key !== 'sidebar.panellist') throw new Error(`注入的 slot 不符：${key}`)
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)
check('注册了主面板和侧栏图标', registrations.length === 2)
const mainReg = registrations.find((entry) => entry.options.name === 'main')
const sideReg = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check('主面板 id 正确', mainReg?.options.key === 'content-studio')
check('侧栏 id 与主面板一致', sideReg?.options.id === 'content-studio')
check('侧栏 label 是函数且非空', typeof sideReg?.options.label === 'function' && Boolean(sideReg.options.label()))

/* ---------- 真渲染 ---------- */
const Workbench = mainReg.component
let html = ''
try {
  html = ReactDOMServer.renderToStaticMarkup(React.createElement(Workbench, {}))
} catch (error) {
  throw new Error(`渲染抛错：${error.message}\n${error.stack?.split('\n').slice(0, 6).join('\n')}`)
}

check('渲染出了非空 HTML', html.length > 200, `${html.length} chars`)
check('有页面标题', html.includes('生成'))
check('四个页签都在', ['生成', '审核', '待分发', '设置'].every((label) => html.includes(label)))
check('有提示词框', html.includes('描述要生成的镜头'))
check('有生成按钮', html.includes('生成'))
check('有成片入口', html.includes('开始成片'))
check('初始状态显示空镜头墙', html.includes('还没有镜头'))
check('没有渲染期异常标记', !html.includes('接口不可用'))

const iconHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(sideReg.component, { size: 18, active: true }))
check('侧栏图标渲染 SVG', iconHtml.includes('<svg'))

/* ---------- 二次渲染稳定（hooks 顺序不能变） ---------- */
const second = ReactDOMServer.renderToStaticMarkup(React.createElement(Workbench, {}))
check('重复渲染结果一致', second === html)

/* ---------- 子组件：带真实 props 渲染 ---------- */
const C = mod.__components
check('暴露了测试缝隙', Boolean(C) && typeof C.Readiness === 'function')

const render = (Component, props) => ReactDOMServer.renderToStaticMarkup(React.createElement(Component, props))

// 就绪检查：缺模型 + ffmpeg 不可用
const notReady = render(C.Readiness, {
  health: { ffmpeg: { ok: false, error: '找不到 ffmpeg/ffprobe' }, providers: [] },
  onConfigure: () => {},
})
check('就绪检查列出 ffmpeg 问题', notReady.includes('ffmpeg 未就绪'))
check('就绪检查列出缺失视频模型', notReady.includes('缺少视频模型'))
check('就绪检查给出跳转按钮', notReady.includes('配置模型'))

const videoOnlyMissing = render(C.Readiness, {
  health: { ffmpeg: { ok: true }, providers: [] },
  onConfigure: () => {},
})
check('健康检查返回后缺视频模型仍能渲染', videoOnlyMissing.includes('缺少视频模型') && videoOnlyMissing.includes('配置模型'))

// 就绪时不应出现警告
const ready = render(C.Readiness, {
  health: { ffmpeg: { ok: true }, providers: [{ role: 'llm', enabled: true }, { role: 'tts', enabled: true }, { role: 'video', enabled: true }] },
  onConfigure: () => {},
})
check('就绪时不出警告', ready === '')

// 用量行
const usageHtml = render(C.UsageLine, {
  totals: {
    usage: { llmTokens: 1200, ttsCharacters: 41, ttsSeconds: 7, videoSeconds: 9, videoShots: 3, imageCount: 1 },
    cost: { priced: true, currency: 'CNY', total: 2.7024 },
  },
})
check('用量行显示 token', usageHtml.includes('1200 token'))
check('用量行显示视频秒数', usageHtml.includes('9.0s'))
check('用量行显示金额', usageHtml.includes('CNY') && usageHtml.includes('2.70'))

const unpriced = render(C.UsageLine, { totals: { usage: { llmTokens: 10 }, cost: { priced: false } } })
check('未定价时提示配置价目表', unpriced.includes('未配置价目表'))

// 步骤条
const strip = render(C.StepStrip, { steps: { script: { status: 'done' }, render: { status: 'failed' } } })
check('步骤条渲染全部步骤', ['文案', '配音', '字幕', '画面', '剪辑方案', '渲染', '封面', '校验'].every((label) => strip.includes(label)))

// 新建批次表单（带分组）
const PLATFORM_FIXTURE = [
  { id: 'douyin', label: '抖音', aspectRatio: '9:16', targetSec: 26, titleMaxLength: 30, coverWidth: 1080, coverHeight: 1920 },
  { id: 'xiaohongshu', label: '小红书', aspectRatio: '9:16', targetSec: 26, titleMaxLength: 20, coverWidth: 1080, coverHeight: 1920 },
]
const form = render(C.NewBatchForm, { groups: [{ group: '通勤穿搭', count: 3 }], health: { ffmpeg: { ok: true } }, platforms: PLATFORM_FIXTURE })
check('表单渲染分组选项', form.includes('通勤穿搭 (3)'))
check('表单有转场选项', form.includes('淡入淡出'))
check('ffmpeg 正常时不报警', !form.includes('ffmpeg 不可用'))
check('表单有选择目录入口', form.includes('选择目录'))
check('表单有平台选项', form.includes('抖音') && form.includes('小红书'))
check('表单有发布设置', form.includes('发布设置') && form.includes('需人工审核') && form.includes('自动放行'))
check('表单有成本上限', form.includes('成本上限'))

// 目录选择器可用时按钮不应禁用
const formWithPicker = render(C.NewBatchForm, {
  groups: [],
  health: { ffmpeg: { ok: true } },
  platforms: PLATFORM_FIXTURE,
  services: { pickDirectory: async () => null },
})
check('有目录选择器时按钮可用', formWithPicker.includes('选择目录') && !/disabled=""[^>]*>选择目录/.test(formWithPicker))

const formBad = render(C.NewBatchForm, { groups: [], health: { ffmpeg: { ok: false, error: 'ffmpeg 缺失' } }, platforms: PLATFORM_FIXTURE })
check('ffmpeg 缺失时表单仍可渲染', formBad.includes('创建批次') && !formBad.includes('ffmpeg 缺失'))

const composer = render(C.CreateComposer, { onCreated: () => {} })
check('composer 有提示词框', composer.includes('描述要生成的镜头'))
check('composer 有画幅选项', composer.includes('9:16') && composer.includes('16:9'))
check('composer 有清晰度选项', composer.includes('480P') && composer.includes('1080P'))
check('composer 有成片时长', composer.includes('15秒') && composer.includes('30秒') && composer.includes('1分钟') && composer.includes('自定义'))
check('composer 有生成按钮', composer.includes('生成'))

// 审核卡片：初始态不发请求，只验证能构建
const reviewHtml = render(C.ReviewCard, { itemId: 'x-001', index: 0, total: 3 })
check('审核卡片初始态可渲染', reviewHtml.includes('读取中'))

// 模型配置页初始态
const providersHtml = render(C.ProvidersPage, {})
check('模型配置页初始态可渲染', providersHtml.includes('读取中') || providersHtml.includes('文案模型'))
check('模型配置不是 JSON 编辑器', !providersHtml.includes('整段 JSON'))
const readyHtml = render(C.ReadyPage, {})
check('待分发说明导出是 zip', readyHtml.includes('导出发布包是成片') || readyHtml.includes('Postiz'))
check('待分发有分发入口', readyHtml.includes('分发'))

/* ---------- 挂载状态：跑真实 effect + 假接口 ---------- */
const TestRenderer = await import(pathToFileURL(join(REACT_DIR, 'react-test-renderer', 'index.js')).href)
const { act } = TestRenderer
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const BATCH_FIXTURE = {
  id: 'batch-fixture',
  title: '夹具批次',
  status: 'review',
  createdAt: Date.now(),
  items: [
    { id: 'batch-fixture-001', seq: 1, title: '夹具内容一', status: 'review_pending', durationSec: 7.2, steps: { script: { status: 'done' } } },
    { id: 'batch-fixture-002', seq: 2, title: '夹具内容二', status: 'approved', durationSec: 6.8, steps: { script: { status: 'done' } } },
  ],
  totals: { usage: { llmTokens: 800, videoSeconds: 6, videoShots: 2 }, cost: { priced: true, currency: 'CNY', total: 1.8 } },
}

const ITEM_FIXTURE = {
  item: { id: 'batch-fixture-001', status: 'review_pending', durationSec: 7.2 },
  script: { title: '夹具内容一', description: '简介', hashtags: ['#a'], coverText: { main: '主', sub: '副' } },
  report: { status: 'passed', summary: { total: 18, passed: 18, warnings: 0 }, errors: [], warnings: [] },
  review: null,
  media: { master: 1024, base: '/content-studio/api/media/b/i', covers: { vertical: 10, horizontal: 10, square: 10 } },
}

globalThis.fetch = async (url) => {
  const path = String(url).replace('http://test', '')
  const body = path.includes('/health')
    ? { ffmpeg: { ok: true }, providers: [{ id: 'p', role: 'llm', enabled: true }, { id: 'q', role: 'tts', enabled: true }, { id: 'v', role: 'video', enabled: true }], queue: null }
    : path.includes('/meta')
      ? { platforms: PLATFORM_FIXTURE, reviewModes: [{ id: 'required', label: '需人工审核' }, { id: 'auto', label: '自动放行' }] }
      : path.includes('/materials/groups')
        ? { groups: [{ group: '通勤穿搭', count: 3 }], total: 3 }
        : path.includes('/clips')
          ? { clips: [] }
          : path.includes('/postiz')
            ? { configured: false, apiUrl: 'https://api.postiz.com', hasApiKey: false, channels: [] }
            : path.includes('/items/')
            ? ITEM_FIXTURE
            : /\/batches\/[^/]+$/.test(path)
              ? { batch: BATCH_FIXTURE }
              : path.includes('/batches')
                ? { batches: [BATCH_FIXTURE] }
                : {}
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
}

let tree
await act(async () => {
  tree = TestRenderer.create(React.createElement(Workbench, {}))
})
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
})

const mounted = JSON.stringify(tree.toJSON())
check('生成页不塞成片列表', !mounted.includes('夹具批次'), mounted.slice(0, 200))
check('生成页仍是镜头墙', mounted.includes('还没有镜头') && mounted.includes('开始成片'))
check('审核页签带待审数量', mounted.includes('审核 1'))
check('就绪后不再显示缺模型警告', !mounted.includes('还不能开始生产'))

const reviewTab = tree.root.findAll((node) => node.type === 'button' && String(node.props?.className || '').includes('cs-tab'))
  .find((node) => String(node.children?.join?.('') || '').includes('审核'))
check('找得到审核页签', Boolean(reviewTab))
await act(async () => { reviewTab.props.onClick() })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
const reviewPage = JSON.stringify(tree.toJSON())
check('点审核后拉到了批次列表', reviewPage.includes('夹具批次'), reviewPage.slice(0, 200))
check('审核页显示条目数', reviewPage.includes('2 条'))
check('审核页直接打开待审卡片', reviewPage.includes('夹具内容一') && reviewPage.includes('驳回并重做'))
check('审核页显示批次状态', reviewPage.includes('待审核'))

// 打开审核：模拟点击「去审核」不可行（需要先选批次），改为直接挂 ReviewCard 加载
let reviewTree
await act(async () => {
  reviewTree = TestRenderer.create(React.createElement(C.ReviewCard, { itemId: 'batch-fixture-001', index: 0, total: 2, onDone: () => {} }))
})
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
})
const reviewMounted = JSON.stringify(reviewTree.toJSON())
check('审核卡片加载出标题输入框', reviewMounted.includes('夹具内容一'))
check('审核卡片有通过按钮', reviewMounted.includes('通过'))
check('审核卡片有驳回按钮', reviewMounted.includes('驳回并重做'))
check('审核卡片显示校验结论', reviewMounted.includes('18/18'))
check('审核卡片显示视频播放器', reviewMounted.includes('video/mp4') || reviewMounted.includes('master.mp4'))
check('审核卡片显示连翻计数', reviewMounted.includes('1 / 2'))
check('审核封面是小图', reviewMounted.includes('封面 · 点击放大') && reviewMounted.includes('cs-cover-thumb'))
check('审核封面未撑满', !reviewMounted.includes('cs-cover"') && reviewMounted.includes('cover-vertical.png'))

const readyTab = tree.root.findAll((node) => node.type === 'button' && String(node.props?.className || '').includes('cs-tab'))
  .find((node) => String(node.children?.join?.('') || '').includes('待分发'))
check('找得到待分发页签', Boolean(readyTab))
await act(async () => { readyTab.props.onClick() })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
const readyPage = JSON.stringify(tree.toJSON())
check('待分发页接 Postiz', readyPage.includes('Postiz') && readyPage.includes('API 密钥'))
check('待分发列出已通过条目', readyPage.includes('夹具内容二'))
check('待分发主按钮是分发', readyPage.includes('分发') && readyPage.includes('导出 zip'))

await act(async () => {
  reviewTree.unmount()
  tree.unmount()
})

let providersTree
await act(async () => {
  providersTree = TestRenderer.create(React.createElement(C.ProvidersPage, {}))
})
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
})
const addWan = providersTree.root.find((node) => node.type === 'button' && node.children.join('') === '＋ 百炼万相')
await act(async () => { addWan.props.onClick() })
const wanForm = JSON.stringify(providersTree.toJSON())
check('万相表单有地址栏', wanForm.includes('https://dashscope.aliyuncs.com'))
check('万相表单可测联通', wanForm.includes('测试联通'))
check('万相表单可拉模型', wanForm.includes('获取模型'))
await act(async () => { providersTree.unmount() })

console.log(`\nALL CLIENT RENDER CHECKS PASSED (${passed})`)
