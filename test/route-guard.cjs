// API 路由加固回归测试（v1.15.0）：
// /dsh-update-check/api 必须拒绝非 POST（405）、非 application/json（415）、
// 跨源 Origin（403）；同源 Origin 与无 Origin（非浏览器调用）正常放行（200）。
// 手法：用假 ctx/webServer 捕获 apply() 注册的 handler，再用假 req/res 驱动；
// 不启动服务器、不依赖运行中的 GUI。CI 用法: node test/route-guard.cjs
'use strict'
const path = require('path')
const { pathToFileURL } = require('url')

let failed = 0
function check(name, actual, expect) {
  const ok = actual === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expect)}）`}`)
}

// 假 request：readBody 只监听 data/end，由 send() 一次性注入
function makeRequest(method, headers, body) {
  const listeners = { data: [], end: [], error: [] }
  const req = {
    method,
    headers: headers || {},
    on(event, fn) { (listeners[event] || (listeners[event] = [])).push(fn); return req }
  }
  req.send = () => {
    if (body !== undefined) for (const fn of listeners.data) fn(Buffer.from(body))
    for (const fn of listeners.end) fn()
  }
  return req
}

function makeResponse() {
  const res = { statusCode: null, headers: null, body: '', ended: false }
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {} }
  res.end = (body) => { res.body = body === undefined ? '' : String(body); res.ended = true }
  return res
}

async function main() {
  // 捕获 apply() 注册的 exact 路由
  let captured = null
  const fakeCtx = {
    inject(deps, cb) {
      cb({
        effect(fn) { fn(); return () => {} },
        webServer: {
          register(route) { captured = route; return () => {} }
        }
      })
    }
  }
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href)
  mod.apply(fakeCtx)
  check('路由已注册', captured && captured.kind + ' ' + captured.path, 'exact /dsh-update-check/api')

  async function call(method, headers, body) {
    const req = makeRequest(method, headers, body)
    const res = makeResponse()
    const pending = captured.handler(req, res)
    req.send()
    await pending
    return res
  }

  let res = await call('GET', {}, undefined)
  check('GET 返回 405', res.statusCode, 405)
  check('405 带 allow: POST', res.headers && res.headers.allow, 'POST')

  res = await call('POST', { 'content-type': 'text/plain' }, '{"method":"x"}')
  check('非 JSON content-type 返回 415', res.statusCode, 415)
  check('415 返回 JSON 错误体', JSON.parse(res.body).error.indexOf('application/json') !== -1, true)

  res = await call('POST', { 'content-type': 'application/json', origin: 'https://evil.example', host: '127.0.0.1:3080' }, '{"method":"x"}')
  check('跨源 Origin 返回 403', res.statusCode, 403)

  res = await call('POST', { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' }, '{"method":"unknown-probe"}')
  check('同源 Origin 放行（200）', res.statusCode, 200)
  check('同源请求命中 dispatch（未知方法）', JSON.parse(res.body).error, 'unknown method: unknown-probe')

  res = await call('POST', { 'content-type': 'application/json', host: '127.0.0.1:3080' }, '{"method":"unknown-probe"}')
  check('无 Origin（非浏览器调用）放行（200）', res.statusCode, 200)

  res = await call('POST', { 'content-type': 'application/json; charset=utf-8', host: 'h' }, '{"method":"unknown-probe"}')
  check('带 charset 的 JSON content-type 放行', res.statusCode, 200)

  res = await call('POST', { 'content-type': 'application/json', origin: 'not-a-url', host: 'h' }, '{"method":"x"}')
  check('无法解析的 Origin 拒绝（403）', res.statusCode, 403)

  if (failed) {
    console.error('FAILED: ' + failed + ' 项未通过')
    process.exit(1)
  }
  console.log('OK route-guard: 全部通过')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
})
