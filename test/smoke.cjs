// 结构冒烟测试：加载 client/client.js（静态 bundle），验证插件形态、
// settings.general.item 注册与组件渲染。CI 用法: node test/smoke.cjs
'use strict'
const fs = require('fs')
const path = require('path')

const BUNDLE = path.join(__dirname, '..', 'client', 'client.js')
const code = fs.readFileSync(BUNDLE, 'utf8')

let loaded = null

// 假 React：最小 hooks runner + createElement（children 并入 props，与真实 React 一致）
function makeFakeReact() {
  const states = []
  let idx = 0
  const react = {
    useState(init) {
      const i = idx++
      if (i >= states.length) states.push({ v: typeof init === 'function' ? init() : init })
      return [states[i].v, (next) => {
        states[i].v = typeof next === 'function' ? next(states[i].v) : next
      }]
    },
    useEffect(fn) { idx++ },
    createElement(type, props, ...children) {
      const p = Object.assign({}, props || {})
      if (children.length === 1) p.children = children[0]
      else if (children.length > 1) p.children = children
      return { type, props: p }
    }
  }
  return { react, reset() { states.length = 0; idx = 0 } }
}
const fake = makeFakeReact()

// window / sessionStorage 桩（fetch 桩保证 autoCheck 静默成功）
const session = new Map()
global.window = {
  __ModuleLoader__: { load(def) { loaded = def } },
  sessionStorage: {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v))
  }
}
global.fetch = async () => ({ json: async () => ({ hasUpdate: false, integrity: null, lastUpdaterResult: null }) })

function fakeRequire(spec) {
  if (spec === 'react') return fake.react
  throw new Error('unexpected require: ' + spec)
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
}
function collectTexts(tree) {
  const out = []
  ;(function walk(n) {
    if (n === null || n === undefined) return
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (typeof n === 'object' && n.props && n.props.children !== undefined) {
      const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children]
      kids.forEach(walk)
    }
  })(tree)
  return out
}

try {
  // eslint-disable-next-line no-eval
  ;(0, eval)(code)
  assert(loaded && loaded.id === 'dsh-check-for-updates', 'loader 未收到 bundle 定义')

  const plugin = loaded.factory(fakeRequire)
  assert(plugin && typeof plugin.apply === 'function', '插件形态错误: 缺 apply')
  assert(plugin.name === 'dsh-check-for-updates', '插件名错误: ' + plugin.name)
  assert(Array.isArray(plugin.inject) && plugin.inject.indexOf('slots') !== -1,
    '未声明 inject slots: ' + JSON.stringify(plugin.inject))

  // 模拟 ctx.slots 注入/注册 + ctx.effect（v1.15.0 卸载清理）
  const registrations = []
  let injectTarget = null
  let effectDisposer = null
  const ctx = {
    effect(fn) {
      const dispose = fn()
      effectDisposer = dispose
      return dispose
    },
    slots: {
      inject(name, cb) { injectTarget = { name, cb } },
      register(opts, comp) { registrations.push({ opts, comp }) }
    }
  }
  plugin.apply(ctx)

  assert(injectTarget && injectTarget.name === 'settings.general.item',
    '未注入 settings.general.item，got: ' + (injectTarget && injectTarget.name))
  injectTarget.cb()
  const reg = registrations.find((r) => r.opts.name === 'settings.general.item' && r.opts.id === 'update-checker')
  assert(reg, 'settings.general.item 未注册')
  assert(reg.opts.order === 30, 'order 错误: ' + reg.opts.order)
  assert(typeof reg.comp === 'function', '设置项组件不是函数')

  // v1.15.0：apply 必须经 ctx.effect 注册卸载清理，且 disposer 可安全调用
  assert(typeof effectDisposer === 'function', '未注册 ctx.effect 卸载清理 disposer')
  effectDisposer()
  assert(window.__dshUpdckStarted === false, '卸载清理未复位 __dshUpdckStarted')

  // 渲染组件（单次，不执行 effect），断言关键文案
  fake.reset()
  const texts = collectTexts(reg.comp()).join('|')
  for (const expect of ['DSH 更新', '检查更新', '测试网络']) {
    assert(texts.indexOf(expect) !== -1, '渲染缺少 "' + expect + '"')
  }

  console.log('OK smoke: 插件形态(' + plugin.name + ', inject=' + JSON.stringify(plugin.inject) +
    ') + settings.general.item(id=update-checker, order=30) 注册 + 组件渲染 全部通过')
} catch (e) {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
}