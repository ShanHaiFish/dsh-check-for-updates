// Desktop 让位与配置项回归测试（v1.15.1）：
// 1) 宿主 Config 校验（默认值/合法值/非法值 issues）与 get-plugin-config 路由；
// 2) enabled:false 时除 get-plugin-config 外的方法被拒绝；
// 3) 客户端按 desktopMode/Desktop 桥决定是否自动检查，并在设置项渲染让位/禁用说明：
//    - Desktop + auto   → 不自动检查，设置项显示「已自动让位」；
//    - Desktop + always → 自动检查，设置项正常；
//    - Browser + auto   → 自动检查，设置项正常；
//    - Browser + disabled → 不自动检查，设置项显示「已通过配置禁用」。
// 手法：假 ctx/webServer 捕获路由；eval client bundle + 假 React/DOM 桩；无真实网络。
// CI 用法: node test/desktop-delegation.cjs
'use strict'
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const PLUGIN_ROOT = path.join(__dirname, '..')
const BUNDLE = path.join(PLUGIN_ROOT, 'client', 'client.js')
const code = fs.readFileSync(BUNDLE, 'utf8')
let failed = 0
function check(name, actual, expect) {
  const ok = actual === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expect)}）`}`)
}
const flush = () => new Promise((r) => setTimeout(r, 40))

// ---------------- 宿主：配置校验与路由 ----------------
function makeHost() {
  let handler = null
  const ctx = {
    inject(deps, cb) {
      cb({
        effect(fn) { fn(); return () => {} },
        webServer: { register(route) { handler = route; return () => {} } }
      })
    }
  }
  async function call(method) {
    const req = new EventEmitter()
    req.method = 'POST'
    req.headers = { 'content-type': 'application/json', host: '127.0.0.1:3080' }
    const res = { statusCode: 0, body: '' }
    res.writeHead = (c) => { res.statusCode = c }
    res.end = (b) => { res.body = String(b || '') }
    const pending = handler.handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify({ method })))
    req.emit('end')
    await pending
    return JSON.parse(res.body)
  }
  return { ctx, call }
}

// ---------------- 客户端：eval bundle + 假 React ----------------
function makeFakeReact(store) {
  let idx = 0
  const ranEffects = []
  const react = {
    useState(init) {
      const i = idx++
      if (i >= store.length) store.push({ v: typeof init === 'function' ? init() : init })
      return [store[i].v, (next) => {
        store[i].v = typeof next === 'function' ? next(store[i].v) : next
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
  return out.join('|')
}

async function runClient({ desktop, config, expectAutoCheck, expectText, forbidText }) {
  const session = new Map()
  const calls = []
  let loaded = null
  global.window = {
    __ModuleLoader__: { load(def) { loaded = def } },
    sessionStorage: { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)) }
  }
  if (desktop) globalThis.dshDesktop = { protocolVersion: 1, updates: {} }
  else delete globalThis.dshDesktop
  global.fetch = async (url, opts) => {
    const method = JSON.parse(opts.body).method
    calls.push(method)
    const table = {
      'get-plugin-config': config,
      'get-current-version': { version: '0.2.1-rc.5' },
      'check-for-updates': {
        currentVersion: '0.2.1-rc.5', latestVersion: '0.2.1-rc.5', hasUpdate: false,
        error: null, integrity: { checked: true, ok: true }, lastUpdaterResult: null
      }
    }
    return { json: async () => table[method] || { error: 'unknown method: ' + method } }
  }
  ;(0, eval)(code)
  const fake = makeFakeReact([])
  const plugin = loaded.factory((spec) => {
    if (spec === 'react') return fake.react
    throw new Error('unexpected require: ' + spec)
  })
  let injectTarget = null
  const registrations = []
  const ctx = {
    slots: {
      inject(name, cb) { injectTarget = { name, cb } },
      register(opts, comp) { registrations.push({ opts, comp }) }
    }
  }
  plugin.apply(ctx)
  injectTarget.cb()
  await flush()
  const reg = registrations.find((r) => r.opts.id === 'update-checker')
  if (!reg) throw new Error('设置项未注册')
  // 首渲染触发 gate 的 loadConfig effect；等异步配置落地后再渲染一次读取最终门控态
  collectTexts(fake.render(reg.comp))
  await flush()
  const texts = collectTexts(fake.render(reg.comp))
  return { calls, texts }
}

async function main() {
  // ---- 宿主配置 ----
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href)
  const valid = mod.Config['~standard'].validate(undefined)
  check('Config 默认值', JSON.stringify(valid.value), JSON.stringify({ enabled: true, desktopMode: 'auto' }))
  const okCfg = mod.Config['~standard'].validate({ enabled: false, desktopMode: 'always' })
  check('Config 合法值', JSON.stringify(okCfg.value), JSON.stringify({ enabled: false, desktopMode: 'always' }))
  const badCfg = mod.Config['~standard'].validate({ desktopMode: 'nope' })
  check('Config 非法值返回 issues', Array.isArray(badCfg.issues) && badCfg.issues[0].path[0], 'desktopMode')

  let host = makeHost()
  mod.apply(host.ctx, { enabled: true, desktopMode: 'always' })
  check('get-plugin-config 返回生效配置', JSON.stringify(await host.call('get-plugin-config')),
    JSON.stringify({ enabled: true, desktopMode: 'always' }))

  host = makeHost()
  mod.apply(host.ctx, { enabled: false })
  check('enabled:false 时 get-plugin-config 仍可读', (await host.call('get-plugin-config')).enabled, false)
  const denied = await host.call('check-for-updates')
  check('enabled:false 时 check-for-updates 被拒绝', denied.disabled, true)

  // ---- 客户端行为 ----
  let r = await runClient({ desktop: true, config: { enabled: true, desktopMode: 'auto' }, expectText: '已自动让位', forbidText: '检查更新' })
  check('Desktop+auto 不自动检查', r.calls.includes('check-for-updates'), false)
  check('Desktop+auto 设置项显示让位说明', r.texts.indexOf('已自动让位') !== -1, true)
  check('Desktop+auto 设置项无检查按钮', r.texts.indexOf('检查更新') === -1, true)

  r = await runClient({ desktop: true, config: { enabled: true, desktopMode: 'always' }, expectText: '检查更新', forbidText: '已自动让位' })
  check('Desktop+always 自动检查', r.calls.includes('check-for-updates'), true)
  check('Desktop+always 设置项正常', r.texts.indexOf('检查更新') !== -1, true)

  r = await runClient({ desktop: false, config: { enabled: true, desktopMode: 'auto' }, expectText: '检查更新', forbidText: '已自动让位' })
  check('Browser+auto 自动检查', r.calls.includes('check-for-updates'), true)
  check('Browser+auto 设置项正常', r.texts.indexOf('检查更新') !== -1, true)

  r = await runClient({ desktop: false, config: { enabled: false, desktopMode: 'auto' }, expectText: '已通过配置禁用', forbidText: '检查更新' })
  check('Browser+disabled 不自动检查', r.calls.includes('check-for-updates'), false)
  check('Browser+disabled 设置项显示禁用说明', r.texts.indexOf('已通过配置禁用') !== -1, true)

  if (failed) {
    console.error('FAILED: ' + failed + ' 项未通过')
    process.exit(1)
  }
  console.log('OK desktop-delegation: 全部通过')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
})
