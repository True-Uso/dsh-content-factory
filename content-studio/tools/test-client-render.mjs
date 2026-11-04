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
      if (id !== '@local/content-studio') throw new Error(`意外的模块 id：${id}`)
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
      if (key !== 'settings.section') throw new Error(`注入的 slot 不符：${key}`)
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
check('注册了一个 section', registrations.length === 1)
check('注册 id 正确', registrations[0].options.id === 'content-studio')
check('label 是函数且非空', typeof registrations[0].options.label === 'function' && Boolean(registrations[0].options.label()))

/* ---------- 真渲染 ---------- */
const Workbench = registrations[0].component
let html = ''
try {
  html = ReactDOMServer.renderToStaticMarkup(React.createElement(Workbench, {}))
} catch (error) {
  throw new Error(`渲染抛错：${error.message}\n${error.stack?.split('\n').slice(0, 6).join('\n')}`)
}

check('渲染出了非空 HTML', html.length > 200, `${html.length} chars`)
check('有页面标题', html.includes('内容工坊'))
check('三个页签都在', ['批次', '审核', '模型配置'].every((label) => html.includes(label)))
check('新建批次表单在', html.includes('新建批次'))
check('有主题输入框', html.includes('主题（必填）'))
check('有素材目录输入框', html.includes('素材目录'))
check('有创建按钮', html.includes('创建批次'))
check('初始状态显示空批次列表', html.includes('还没有批次'))
check('没有渲染期异常标记', !html.includes('接口不可用'))

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
check('就绪检查列出 ffmpeg 问题', notReady.includes('找不到 ffmpeg'))
check('就绪检查列出缺失模型', notReady.includes('缺少') && notReady.includes('文案模型'))
check('就绪检查给出跳转按钮', notReady.includes('去配置模型'))

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
const form = render(C.NewBatchForm, { groups: [{ group: '通勤穿搭', count: 3 }], health: { ffmpeg: { ok: true } } })
check('表单渲染分组选项', form.includes('通勤穿搭 (3)'))
check('表单有转场选项', form.includes('淡入淡出'))
check('ffmpeg 正常时不报警', !form.includes('ffmpeg 不可用'))
check('表单有选择目录入口', form.includes('选择目录'))

// 目录选择器可用时按钮不应禁用
const formWithPicker = render(C.NewBatchForm, {
  groups: [],
  health: { ffmpeg: { ok: true } },
  services: { pickDirectory: async () => null },
})
check('有目录选择器时按钮可用', formWithPicker.includes('选择目录') && !/disabled=""[^>]*>选择目录/.test(formWithPicker))

const formBad = render(C.NewBatchForm, { groups: [], health: { ffmpeg: { ok: false, error: 'ffmpeg 缺失' } } })
check('ffmpeg 缺失时表单告警', formBad.includes('ffmpeg 缺失'))

// 审核卡片：初始态不发请求，只验证能构建
const reviewHtml = render(C.ReviewCard, { itemId: 'x-001', index: 0, total: 3 })
check('审核卡片初始态可渲染', reviewHtml.includes('读取中'))

// 模型配置页初始态
const providersHtml = render(C.ProvidersPage, {})
check('模型配置页初始态可渲染', providersHtml.includes('读取中') || providersHtml.includes('文案模型'))

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
    : path.includes('/materials/groups')
      ? { groups: [{ group: '通勤穿搭', count: 3 }], total: 3 }
      : path.includes('/batches')
        ? { batches: [BATCH_FIXTURE] }
        : path.includes('/items/')
          ? ITEM_FIXTURE
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
check('挂载后拉到了批次列表', mounted.includes('夹具批次'), mounted.slice(0, 200))
check('挂载后显示条目数', mounted.includes('2 条'))
check('挂载后显示批次状态', mounted.includes('review'))
check('就绪后不再显示缺模型警告', !mounted.includes('还不能开始生产'))
check('批次列表不再为空态', !mounted.includes('还没有批次'))

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
check('审核卡片有驳回按钮', reviewMounted.includes('驳回'))
check('审核卡片显示校验结论', reviewMounted.includes('18/18'))
check('审核卡片显示视频播放器', reviewMounted.includes('video/mp4') || reviewMounted.includes('master.mp4'))
check('审核卡片显示连翻计数', reviewMounted.includes('1 / 2'))

await act(async () => {
  reviewTree.unmount()
  tree.unmount()
})

console.log(`\nALL CLIENT RENDER CHECKS PASSED (${passed})`)
