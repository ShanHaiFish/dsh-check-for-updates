// ============================================================
// DSH 更新检查插件 — Host（静态 bundle 形态）v1.12.0
// 静态形态：随 profile 层栈自动加载，无需每次重启 cordis_define/run。
// 无硬编码路径：DSH 安装根/版本经 require.resolve('@deepseek-ai/dsh/package.json')
//   与 process.execPath 等运行时探测；node/npm-cli 从 execPath 派生；网络用 Node 全局 fetch。
// 客户端通过 POST /dsh-update-check/api （JSON {method}）调用下列方法。
// ============================================================
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, sep } from 'node:path'

const require = createRequire(import.meta.url)

export const name = 'dsh-check-for-updates'
export const inject = ['webServer']

// ---------------- 运行时探测（无硬编码路径） ----------------
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function deriveGlobalRoot(pkgDir) {
  const parts = pkgDir.split(/[\\/]/).filter(Boolean)
  const idx = parts.lastIndexOf('node_modules')
  if (idx > 0) return parts.slice(0, idx).join(sep)
  return null
}

let dshInfoCache = null
function dshInfo() {
  if (dshInfoCache) return dshInfoCache
  const candidates = []
  try { candidates.push(require.resolve('@deepseek-ai/dsh/package.json')) } catch (e) { /* ignore */ }
  try {
    const nodeDir = dirname(process.execPath)
    candidates.push(join(dirname(nodeDir), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  } catch (e) { /* ignore */ }
  for (const base of [process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '', process.env.NPM_CONFIG_PREFIX || '']) {
    if (!base) continue
    try { candidates.push(join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')) } catch (e) { /* ignore */ }
  }
  for (const c of candidates) {
    try {
      const info = readJson(c)
      if (info && info.version) {
        const pkgDir = dirname(c)
        dshInfoCache = { pkgJsonPath: c, pkgDir, globalRoot: deriveGlobalRoot(pkgDir), version: String(info.version) }
        return dshInfoCache
      }
    } catch (e) { /* ignore */ }
  }
  dshInfoCache = { pkgJsonPath: null, pkgDir: null, globalRoot: null, version: '0.0.0' }
  return dshInfoCache
}

function nodePaths() {
  const nodeExe = process.execPath || 'node'
  const npmCli = join(dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return { nodeExe, npmCli }
}

async function getCurrentVersion() {
  try {
    const info = dshInfo()
    if (info.version && info.version !== '0.0.0') return info.version
    return '0.0.0'
  } catch (e) {
    return '0.0.0'
  }
}

// ---------------- 语义化版本比较 ----------------
function parseVer(v) {
  const s = String(v).trim()
  const dash = s.indexOf('-')
  const core = (dash === -1 ? s : s.slice(0, dash)).split('.')
  const pre = dash === -1 ? '' : s.slice(dash + 1)
  const parts = core.map((n) => { const x = parseInt(n, 10); return isNaN(x) ? 0 : x })
  return { parts, pre }
}
function compareVersions(a, b) {
  const A = parseVer(a), B = parseVer(b)
  for (let i = 0; i < 3; i++) if (A.parts[i] !== B.parts[i]) return A.parts[i] - B.parts[i]
  if (A.pre === B.pre) return 0
  if (!A.pre) return 1
  if (!B.pre) return -1
  const num = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : NaN }
  const na = num(A.pre), nb = num(B.pre)
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
  return A.pre < B.pre ? -1 : 1
}
function pickMax(versions) {
  let best = null
  for (const v of Object.keys(versions)) if (best === null || compareVersions(v, best) > 0) best = v
  return best
}

// ---------------- 网络（Node 全局 fetch） ----------------
async function fetchPackument() {
  const res = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', {
    headers: { accept: 'application/vnd.npm.install-v1+json' }
  })
  const text = await res.text()
  return { status: res.status, text }
}

async function getLatestByFetch() {
  try {
    const r = await fetchPackument()
    if (r.status === 200) {
      const data = JSON.parse(r.text)
      if (data && data.versions) {
        const best = pickMax(data.versions)
        if (best) return best
      }
    }
    return null
  } catch (e) {
    console.log('[updck] fetch 失败:', e.message)
    return null
  }
}

async function getLatestVersion() {
  return await getLatestByFetch()
}

async function testNetwork() {
  try {
    const r = await fetchPackument()
    return { success: true, message: '网络连接正常（host fetch 可用）', statusCode: r.status, contentLength: r.text.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ---------------- 升级（node + npm-cli，运行时探测） ----------------
function runCommand(argv, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return reject(e)
    }
    let out = '', err = '', timedOut = false
    child.stdout && child.stdout.on('data', (d) => { out += d })
    child.stderr && child.stderr.on('data', (d) => { err += d })
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGTERM') } catch (e) { /* ignore */ } }, timeoutMs)
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, timedOut }) })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

function tailLines(s, n) {
  return String(s || '').split(/\r?\n/).filter(Boolean).slice(-n).join('\n')
}

async function performUpdate() {
  const currentVersion = await getCurrentVersion()
  const target = await getLatestVersion()
  if (!target) return { updated: false, error: '无法获取最新版本信息，已取消更新' }
  if (compareVersions(target, currentVersion) <= 0) return { updated: false, reason: 'already-latest', latestVersion: target }

  const info = dshInfo()
  const { nodeExe, npmCli } = nodePaths()
  const missing = []
  if (!info.globalRoot) missing.push('无法推导全局安装根')
  if (!nodeExe) missing.push('node 不可用')
  if (!npmCli) missing.push('npm-cli.js 不可用')
  if (missing.length) return { updated: false, error: missing.join('；') }

  const argv = [nodeExe, npmCli, 'install', '-g', '--prefix', info.globalRoot, '@deepseek-ai/dsh@' + target]
  console.log('[updck] 执行安装(目标 ' + target + '):', argv.join(' '))

  let result
  try {
    result = await runCommand(argv, info.globalRoot, 180000)
  } catch (e) {
    return { updated: false, error: '安装执行失败: ' + e.message }
  }
  const fullLog = tailLines(result.out + '\n' + result.err, 40)
  if (result.timedOut) return { updated: false, error: '安装超时（180s）已中止', logTail: fullLog }
  return { updated: true, installedVersion: target, needsRestart: true, message: 'DSH 已成功更新到 ' + target + '，请重启 DSH 后生效', logTail: fullLog }
}

async function checkForUpdates() {
  const currentVersion = await getCurrentVersion()
  const latestVersion = await getLatestVersion()
  let error = null
  if (!latestVersion) error = '无法获取最新版本信息（fetch 未能取得版本号）'
  return { currentVersion, latestVersion, hasUpdate: latestVersion ? currentVersion !== latestVersion : false, error }
}

// ---------------- HTTP 工具与路由 ----------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function dispatch(method) {
  switch (method) {
    case 'check-for-updates': return await checkForUpdates()
    case 'get-current-version': return { version: await getCurrentVersion() }
    case 'test-network': return await testNetwork()
    case 'perform-update': return await performUpdate()
    default: return { error: 'unknown method: ' + method }
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const disposers = [
        hostCtx.webServer.register({
          kind: 'exact',
          path: '/dsh-update-check/api',
          handler: async (request, response) => {
            if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST', 'content-type': 'application/json' }); response.end(); return }
            let body = null
            try { body = JSON.parse(await readBody(request)) } catch (e) { body = null }
            const method = body && typeof body.method === 'string' ? body.method : ''
            let result
            try { result = await dispatch(method) } catch (e) { result = { error: String((e && e.message) || e) } }
            sendJson(response, 200, result)
          }
        })
      ]
      return () => { for (const d of disposers) d() }
    }, 'dsh-check-for-updates: api')
  })
}
