// 交互契约测试：模拟点击设置项各按钮，验证 client 与 host API 契约对齐。
// 覆盖: 挂载 get-current-version / 检查更新 / 测试网络 / 更新(安排语义+DISMISS_KEY)。
// CI 用法: node test/interactive.cjs
'use strict'
const fs = require('fs')
const path = require('path')

const BUNDLE = path.join(__dirname, '..', 'client', 'client.js')
const code = fs.readFileSync(BUNDLE, 'utf8')

let loaded = null
const fetchLog = []
const session = new Map()

// 可多次渲染的假 React（state 在渲染间保留，模拟真实 React）
function makeFakeReact() {
  const states = []
  const ranEffects = []
  let idx = 0
  const react = {
    useState(init) {
      const i = idx++
      if (i >= states.length) states.push({ v: typeof init === 'function' ? init() : init })
      return [states[i].v, (next) => {
        states[i].v = typeof next === 'function' ? next(states[i].v) : next
      }]
    },
    useEffect(fn) {
      const i = idx++
      if (!ranEffects[i]) { ranEffects[i] = true; fn() }
    },
    createElement(type, props, ...children) {
      const p = Object.assign({}, props || {})
      if (children.length === 1) p.children = children[0]
      else if (children.length > 1) p.children = children
      return { type, props: p }
    }
  }
  return { react, render(comp) { idx = 0; return comp() } }
}
const fake = makeFakeReact()

// ---- host 契约桩（与 lib/index.js v1.13.x dispatch 保持一致） ----
const responses = {
  'check-for-updates': {
    currentVersion: '1.13.1',
    latestVersion: '1.14.0',
    hasUpdate: true,
    error: null,
    integrity: { checked: true, ok: true, koffiVersion: '3.1.6', platformVersion: '3.1.6' },
    lastUpdaterResult: null
  },
  'get-current-version': { version: '1.13.1' },
  'test-network': { success: true, message: '网络连接正常（host fetch 可用）', statusCode: 200, contentLength: 123456 },
  'perform-update': {
    updated: true, scheduled: true, installedVersion: '1.14.0', needsRestart: true,
    message: '已安排更新到 1.14.0：退出 DSH 后将自动完成安装，随后重新运行 dsh 即可使用新版本'
  }
}

global.window = {
  __ModuleLoader__: { load(def) { loaded = def } },
  sessionStorage: {
    getItem: (k) => (session.has(k) ? session.get(k) : null),
    setItem: (k, v) => session.set(k, String(v))
  }
}
// client 使用裸 fetch（全局绑定）
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body)
  fetchLog.push(body.method)
  return { json: async () => responses[body.method] || { error: 'unknown method: ' + body.method } }
}

function fakeRequire(spec) {
  if (spec === 'react') return fake.react
  throw new Error('unexpected require: ' + spec)
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg)
}
function findButtons(tree, text) {
  const out = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (n.type === 'button' && String(n.props.children) === text) out.push(n)
    if (n.props && n.props.children !== undefined) {
      const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children]
      kids.forEach(walk)
    }
  })(tree)
  return out
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
function flush() {
  // 两轮 macrotask，确保 fetch 的 await 链全部落地
  return new Promise((r) => setImmediate(() => setImmediate(r)))
}

;(async () => {
  ;(0, eval)(code)
  assert(loaded && loaded.id === 'dsh-check-for-updates', 'loader 未收到 bundle 定义')
  const plugin = loaded.factory(fakeRequire)
  const registrations = []
  let injectTarget = null
  const ctx = {
    slots: {
      inject(name, cb) { injectTarget = { name, cb } },
      register(opts, comp) { registrations.push({ opts, comp }) }
    }
  }
  plugin.apply(ctx)
  injectTarget.cb()
  const reg = registrations.find((r) => r.opts.name === 'settings.general.item' && r.opts.id === 'update-checker')
  assert(reg, 'settings.general.item 未注册')

  // 1) 首次渲染：挂载 effect 触发 get-current-version
  let tree = fake.render(reg.comp)
  await flush()
  tree = fake.render(reg.comp)
  let texts = collectTexts(tree).join('|')
  assert(fetchLog.indexOf('get-current-version') !== -1, '挂载未调用 get-current-version，log=' + fetchLog)
  assert(texts.indexOf('当前版本: 1.13.1') !== -1, '未显示当前版本。texts=' + texts)

  // 2) 点击「检查更新」
  fetchLog.length = 0
  let btn = findButtons(tree, '检查更新')[0]
  assert(btn && typeof btn.props.onClick === 'function', '缺少「检查更新」按钮')
  btn.props.onClick()
  await flush()
  tree = fake.render(reg.comp)
  texts = collectTexts(tree).join('|')
  assert(fetchLog.indexOf('check-for-updates') !== -1, '检查更新未调用 host')
  assert(texts.indexOf('最新版本: 1.14.0') !== -1, '未显示最新版本')
  assert(texts.indexOf('有新版本可用！') !== -1, '未显示有新版本提示')
  assert(findButtons(tree, '更新到 1.14.0').length === 1, '未出现「更新到 1.14.0」按钮')

  // 3) 点击「测试网络」
  fetchLog.length = 0
  btn = findButtons(tree, '测试网络')[0]
  btn.props.onClick()
  await flush()
  tree = fake.render(reg.comp)
  texts = collectTexts(tree).join('|')
  assert(fetchLog.indexOf('test-network') !== -1, '测试网络未调用 host')
  assert(texts.indexOf('网络测试: 网络连接正常（host fetch 可用）（HTTP 200）') !== -1, '网络测试结果未显示。texts=' + texts)

  // 4) 点击「更新到 1.14.0」（v1.13.x 安排语义）
  fetchLog.length = 0
  btn = findButtons(tree, '更新到 1.14.0')[0]
  btn.props.onClick()
  await flush()
  tree = fake.render(reg.comp)
  texts = collectTexts(tree).join('|')
  assert(fetchLog.indexOf('perform-update') !== -1, '更新未调用 host')
  assert(session.get('dsh-updck-dismissed-version') === '1.14.0', '安排更新后未写入 DISMISS_KEY')
  assert(texts.indexOf('已安排更新到 1.14.0') !== -1, '未显示安排成功消息。texts=' + texts)
  assert(texts.indexOf('升级完成后请退出并重新运行 dsh') !== -1, '缺少重启提示')

  console.log('OK interactive: 挂载 get-current-version → 检查更新 → 测试网络 → 更新(安排语义+DISMISS_KEY) 全部契约对齐')
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
})