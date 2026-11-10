/**
 * Client half contract check — no browser needed.
 *
 * Loads client.js with a stub module loader and a stub React, then asserts the
 * factory registers into `main` + `sidebar.panellist` and that the component
 * tree builds. This proves the module contract and the slot wiring; it does not
 * prove how the page looks in the real page.
 */
const registered = []
let factorySeen = null

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      registered.push(id)
      factorySeen = factory
    },
  },
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
}

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}

await import('../client.js')

if (!factorySeen) throw new Error('client.js 没有调用 __ModuleLoader__.load')
if (registered[0] !== 'dsh-content-factory') throw new Error(`模块 id 不符：${registered[0]}`)

const mod = factorySeen(requireStub)
if (!mod || typeof mod.apply !== 'function') throw new Error('factory 未返回 apply')

const registrations = []
const injectedInto = []
const ctx = {
  locale: { getLocale: () => ({ id: 'zh' }) },
  slots: {
    inject(key, callback) {
      injectedInto.push(key)
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

if (!injectedInto.includes('main')) throw new Error(`没有注入 main：${injectedInto.join(', ')}`)
if (!injectedInto.includes('sidebar.panellist')) throw new Error(`没有注入 sidebar.panellist：${injectedInto.join(', ')}`)
if (registrations.length !== 2) throw new Error(`期望 2 个注册，实际 ${registrations.length}`)

const main = registrations.find((entry) => entry.options.name === 'main')
const side = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
if (!main || !side) throw new Error('缺少 main 或 sidebar.panellist 注册')
if (main.options.key !== 'content-studio') throw new Error(`main key 不符：${main.options.key}`)
if (side.options.id !== 'content-studio') throw new Error(`侧栏 id 不符：${side.options.id}`)
if (typeof side.options.label !== 'function' || !side.options.label()) throw new Error('侧栏 label 应为返回非空字符串的函数')

// 组件必须能构建出树；不挂载、不跑副作用。
const tree = main.component({})
if (!tree || typeof tree !== 'object') throw new Error('组件未返回可渲染的树')

console.log('main:', JSON.stringify({ key: main.options.key }))
console.log('sidebar:', JSON.stringify({ id: side.options.id, label: side.options.label() }))
console.log('component root:', tree.type)
console.log('\nCLIENT CONTRACT CHECKS PASSED')
