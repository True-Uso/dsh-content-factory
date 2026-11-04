/**
 * Client half contract check — no browser needed.
 *
 * Loads client.js with a stub module loader and a stub React, then asserts the
 * factory registers into `settings.section` and that the component tree builds.
 * This proves the module contract and the slot wiring; it does not prove how the
 * page looks in the real page.
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
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
}

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}

await import('../client.js')

if (!factorySeen) throw new Error('client.js 没有调用 __ModuleLoader__.load')
if (registered[0] !== '@local/content-studio') throw new Error(`模块 id 不符：${registered[0]}`)

const mod = factorySeen(requireStub)
if (!mod || typeof mod.apply !== 'function') throw new Error('factory 未返回 apply')

const registrations = []
let injectedInto = ''
const ctx = {
  locale: { getLocale: () => ({ id: 'zh' }) },
  slots: {
    inject(key, callback) {
      injectedInto = key
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

if (injectedInto !== 'settings.section') throw new Error(`注入的 slot 不符：${injectedInto}`)
if (registrations.length !== 1) throw new Error(`期望 1 个注册，实际 ${registrations.length}`)

const { options, component } = registrations[0]
if (options.name !== 'settings.section') throw new Error('注册的 slot 名不符')
if (typeof options.label !== 'function' || !options.label()) throw new Error('label 应为返回非空字符串的函数')

// 组件必须能构建出树；不挂载、不跑副作用。
const tree = component({})
if (!tree || typeof tree !== 'object') throw new Error('组件未返回可渲染的树')

console.log('registration:', JSON.stringify({ slot: options.name, id: options.id, order: options.order, label: options.label() }))
console.log('component root:', tree.type)
console.log('\nCLIENT CONTRACT CHECKS PASSED')
