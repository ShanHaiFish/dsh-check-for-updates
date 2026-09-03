// ============================================================
// DSH 更新检查插件 — Host（静态 bundle 形态）v1.13.0
// 静态形态：随 profile 层栈自动加载，无需每次重启 cordis_define/run。
// 无硬编码路径：DSH 安装根/版本经 require.resolve('@deepseek-ai/dsh/package.json')
//   与 process.execPath 等运行时探测；node/npm-cli 从 execPath 派生；网络用 Node 全局 fetch。
// 客户端通过 POST /dsh-update-check/api （JSON {method}）调用下列方法。
//
// v1.13.0 更新安全改造（分离式两阶段更新器）：
//   旧版在 dsh 进程运行中就地执行 `npm install -g`——Windows 会锁住已加载的
//   koffi.node，npm 替换元数据成功但二进制残留旧版，导致 dsh 下次启动即报
//   "Mismatched native Koffi modules" 崩溃；且旧版不检查 npm 退出码、声称的
//   安装后对盘校验也缺失。新版改为：
//   阶段一（本进程）：仅把 lib/updater.cjs 模板实例化（注入任务配置）写入
//     一次性任务目录，经 lib/launcher.cjs 以 detached 子进程启动；
//   阶段二（updater，脱离 dsh 生命周期）：轮询等待本进程退出 → npm 安装 →
//     退出码 / 对盘版本 / koffi 原生模块三重校验 → koffi 断链时从 registry
//     tarball 自愈 → 结果写状态文件（下次启动时反馈给用户）。
// ============================================================
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// detached 启动分离式更新器的辅助模块（含参数防御性校验，见 lib/launcher.cjs）
const { launchDetached } = require('./launcher.cjs')

export const name = 'dsh-check-for-updates'
export const inject = ['webServer']

// 版本号白名单：来自 package.json / registry packument 的版本字符串在进入
// npm 参数前必须匹配严格 semver 形态，阻断任何畸形注入。
function isSafeVersion(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v)
}

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

// ---------------- 语义化版本比较（semver 规范 §11） ----------------
// 解析出版本核心数字与预发布标识符数组；build 元数据(+xxx)不参与比较。
function parseVer(v) {
  const s = String(v).trim().replace(/\+[0-9A-Za-z.-]*$/, '')
  const dash = s.indexOf('-')
  const core = (dash === -1 ? s : s.slice(0, dash)).split('.')
  const pre = dash === -1 ? '' : s.slice(dash + 1)
  const parts = []
  for (let i = 0; i < 3; i++) {
    const x = parseInt(core[i], 10)
    parts.push(isNaN(x) ? 0 : x)
  }
  return { parts, pre: pre ? pre.split('.') : [] }
}
// 返回: >0 表示 a>b, <0 表示 a<b, 0 表示相等
//   - 核心数字先比；正式版 > 预发布
//   - 预发布标识符逐段（`.` 分隔）从左到右比较：数字标识符 < 字母数字标识符；
//     数字按数值比大小，字母数字按 ASCII 字典序（alpha < beta < rc）；
//     前缀相同时标识符更多者更高（如 -alpha < -alpha.1）
// 修复：旧实现抓取预发布串中“第一个数字”直接比大小（rc.1→1、alpha.5→5），
// 把 0.1.2-alpha.5 误判为高于 0.1.2-rc.1，导致取到的“最新版本”是 Alpha 而非 RC。
function compareVersions(a, b) {
  const A = parseVer(a), B = parseVer(b)
  for (let i = 0; i < 3; i++) if (A.parts[i] !== B.parts[i]) return A.parts[i] - B.parts[i]
  if (A.pre.length === 0 && B.pre.length === 0) return 0
  if (A.pre.length === 0) return 1
  if (B.pre.length === 0) return -1
  const isNum = (s) => /^\d+$/.test(s)
  const maxLen = Math.max(A.pre.length, B.pre.length)
  for (let i = 0; i < maxLen; i++) {
    if (i >= A.pre.length) return -1 // A 前缀与 B 相同但标识符更少 → A 更低
    if (i >= B.pre.length) return 1
    const x = A.pre[i], y = B.pre[i]
    const xn = isNum(x), yn = isNum(y)
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10)
      if (d !== 0) return d
    } else if (xn !== yn) {
      return xn ? -1 : 1 // 数字标识符 < 字母数字标识符
    } else if (x !== y) {
      return x < y ? -1 : 1 // ASCII 字典序
    }
  }
  return 0
}
function pickMax(versions) {
  let best = null
  for (const v of Object.keys(versions)) if (best === null || compareVersions(v, best) > 0) best = v
  return best
}
// 导出比较器供 test/version.cjs 回归测试使用（不参与插件契约，Cordis 只读 name/inject/apply）
export { compareVersions, pickMax }

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

// ---------------- koffi 原生模块完整性自检（无副作用，只读文件） ----------------
// 背景：Windows 下运行中的 dsh 锁住 koffi.node，npm 就地升级会留下
// “包元数据已新、原生二进制残留旧版”的断链，dsh 下次启动即崩。
// 校验方式：koffi 的原生二进制内嵌自身版本字符串（koffi.version 即来自该
// 字面量），在二进制字节中查找“带边界的声明版本字面量”即可判断二者是否
// 一致，无需加载原生模块（避免 require 缓存与 DLL 载入副作用）。
function hasVersionLiteral(buf, ver) {
  if (!buf || !ver) return false
  const needle = Buffer.from(String(ver), 'latin1')
  if (!needle.length) return false
  const isDigit = (c) => c >= 0x30 && c <= 0x39
  let idx = 0
  while ((idx = buf.indexOf(needle, idx)) !== -1) {
    const before = idx > 0 ? buf[idx - 1] : 0
    const after = buf[idx + needle.length] || 0
    // 前后都不是数字/点号，才算独立的版本字面量（排除 "13.1.6" 命中 "3.1.6"）
    if (!isDigit(before) && before !== 0x2e && !isDigit(after) && after !== 0x2e) return true
    idx += 1
  }
  return false
}

// 从包入口文件向上定位包根目录（package.json 所在且 name 匹配的目录）。
// 不能直接 resolve('<pkg>/package.json')：koffi 等包的 exports 字段会拒绝
// 该子路径（ERR_PACKAGE_PATH_NOT_EXPORTED），而主入口总是可解析的。
function findPkgRoot(req, spec, expectedName) {
  let entry = null
  try { entry = req.resolve(spec) } catch (e) { return null }
  let dir = dirname(entry)
  while (true) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        if (readJson(pkgPath).name === expectedName) return dir
      } catch (e) { /* 解析失败按不匹配处理 */ }
      return null
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function koffiPaths(dshPkgJson) {
  // 从 dsh 的 package.json 位置创建 require，让 Node 解析算法沿 node_modules 链
  // 找到 koffi 主包与平台二进制包（嵌套于 dsh/node_modules 或提升至全局根均可命中）
  const req = createRequire(dshPkgJson)
  const out = {}
  out.mainDir = findPkgRoot(req, 'koffi', 'koffi')
  const platScope = '@koromix/koffi-' + process.platform + '-' + process.arch
  out.platDir = findPkgRoot(req, platScope, platScope)
  if (out.mainDir) out.mainPkg = join(out.mainDir, 'package.json')
  if (out.platDir) {
    out.platPkg = join(out.platDir, 'package.json')
    out.bin = join(out.platDir, process.platform + '_' + process.arch, 'koffi.node')
  }
  return out
}

export function checkKoffiIntegrity() {
  try {
    const info = dshInfo()
    if (!info.pkgJsonPath) return { checked: false, ok: true, note: '未找到 DSH 安装，跳过' }
    const p = koffiPaths(info.pkgJsonPath)
    if (!p.mainPkg || !p.platPkg || !p.bin) return { checked: false, ok: true, note: '未找到 koffi 依赖，跳过' }
    const koffiVersion = readJson(p.mainPkg).version
    const platformVersion = readJson(p.platPkg).version
    let binExists = true
    let binOk = false
    try {
      const buf = readFileSync(p.bin)
      binOk = hasVersionLiteral(buf, koffiVersion) &&
        (koffiVersion === platformVersion || hasVersionLiteral(buf, platformVersion))
    } catch (e) { binExists = false }
    return {
      checked: true,
      ok: binExists && binOk,
      koffiVersion,
      platformVersion,
      binaryPath: p.bin,
      note: binExists
        ? (binOk ? 'koffi 原生模块一致' : 'koffi 二进制与声明版本不一致（疑似部分更新残留）')
        : 'koffi 二进制缺失'
    }
  } catch (e) {
    return { checked: false, ok: true, note: '自检异常：' + e.message }
  }
}

// ---------------- 分离式更新器（阶段一：实例化模板并 detached 启动） ----------------
function updaterStatusFile() {
  return join(tmpdir(), 'dsh-updater-last-status.json')
}

function readLastUpdaterResult() {
  try {
    const data = JSON.parse(readFileSync(updaterStatusFile(), 'utf8'))
    const finished = data.finishedAt ? Date.parse(data.finishedAt) : 0
    if (!finished || Date.now() - finished > 24 * 3600 * 1000) return null
    return data
  } catch (e) { return null }
}

const UPDATER_CFG_PLACEHOLDER = '/*__DSH_UPDATER_CFG__*/null'
const UPDATER_SCRIPT_NAME = 'updater.cjs'

// 读取 lib/updater.cjs 模板，把配置占位符替换为任务 JSON，得到可独立运行的脚本。
export function buildUpdaterScript(cfg) {
  const templatePath = fileURLToPath(new URL('./updater.cjs', import.meta.url))
  const template = readFileSync(templatePath, 'utf8')
  if (template.indexOf(UPDATER_CFG_PLACEHOLDER) === -1) {
    throw new Error('updater 模板缺少配置占位符')
  }
  return template.replace(UPDATER_CFG_PLACEHOLDER, JSON.stringify(cfg, null, 2))
}

// 阶段一：在系统临时目录下建一次性任务目录（mkdtemp 随机名，脚本固定名），
// 写入实例化后的 updater 脚本并经 launcher.cjs detached 启动。任务 id 只进
// JSON 配置，不参与任何路径/命令构造。
function scheduleUpdater(cfg) {
  let taskDir = null
  try {
    taskDir = mkdtempSync(join(tmpdir(), 'dsh-updater-'))
    const scriptPath = join(taskDir, UPDATER_SCRIPT_NAME)
    writeFileSync(scriptPath, buildUpdaterScript(cfg), 'utf8')
    launchDetached(process.execPath, [scriptPath])
    return { ok: true, scriptPath }
  } catch (e) {
    return { ok: false, error: '启动分离式更新器失败: ' + e.message }
  }
}

// ---------------- 更新与修复入口 ----------------
async function performUpdate() {
  const currentVersion = await getCurrentVersion()
  const target = await getLatestVersion()
  if (!target) return { updated: false, error: '无法获取最新版本信息，已取消更新' }
  if (!isSafeVersion(target)) return { updated: false, error: '获取到的版本号异常: ' + target }
  if (compareVersions(target, currentVersion) <= 0) return { updated: false, reason: 'already-latest', latestVersion: target }

  const info = dshInfo()
  const { nodeExe, npmCli } = nodePaths()
  const missing = []
  if (!info.globalRoot) missing.push('无法推导全局安装根')
  if (!info.pkgJsonPath) missing.push('无法定位 DSH package.json')
  if (!nodeExe) missing.push('node 不可用')
  if (!npmCli || !existsSync(npmCli)) missing.push('npm-cli.js 不可用')
  if (missing.length) return { updated: false, error: missing.join('；') }

  const taskStamp = Date.now().toString(36)
  const scheduled = scheduleUpdater({
    id: 'upd-' + taskStamp + '-' + process.pid,
    mode: 'update',
    targetVersion: target,
    globalRoot: info.globalRoot,
    dshPkgJson: info.pkgJsonPath,
    parentPid: process.pid,
    nodeExe,
    npmCli,
    statusFile: updaterStatusFile(),
    createdAt: new Date().toISOString()
  })
  if (!scheduled.ok) return { updated: false, error: scheduled.error }

  console.log('[updck] 已安排分离式更新到 ' + target + '：等本进程(PID ' + process.pid + ')退出后由 updater 执行安装')
  return {
    updated: true,
    scheduled: true,
    installedVersion: target,
    needsRestart: true,
    message: '已安排更新到 ' + target + '：退出 DSH 后将自动完成安装，随后重新运行 dsh 即可使用新版本'
  }
}

async function performRepair() {
  const integ = checkKoffiIntegrity()
  if (!integ.checked) return { updated: false, error: '无法定位 koffi 安装：' + (integ.note || '') }
  if (integ.ok) return { updated: false, reason: 'already-ok', message: '未检测到 koffi 断链，无需修复' }

  const info = dshInfo()
  const { nodeExe, npmCli } = nodePaths()
  const missing = []
  if (!info.globalRoot) missing.push('无法推导全局安装根')
  if (!nodeExe) missing.push('node 不可用')
  if (!npmCli || !existsSync(npmCli)) missing.push('npm-cli.js 不可用')
  if (missing.length) return { updated: false, error: missing.join('；') }

  const taskStamp = Date.now().toString(36)
  const scheduled = scheduleUpdater({
    id: 'fix-' + taskStamp + '-' + process.pid,
    mode: 'repair',
    globalRoot: info.globalRoot,
    dshPkgJson: info.pkgJsonPath,
    parentPid: process.pid,
    nodeExe,
    npmCli,
    statusFile: updaterStatusFile(),
    createdAt: new Date().toISOString()
  })
  if (!scheduled.ok) return { updated: false, error: scheduled.error }

  console.log('[updck] 已安排分离式 koffi 修复：等本进程(PID ' + process.pid + ')退出后执行')
  return {
    updated: true,
    scheduled: true,
    needsRestart: true,
    message: '已安排修复：退出 DSH 后将自动校验并修复 koffi 原生模块'
  }
}

async function checkForUpdates() {
  const currentVersion = await getCurrentVersion()
  const latestVersion = await getLatestVersion()
  let error = null
  if (!latestVersion) error = '无法获取最新版本信息（fetch 未能取得版本号）'
  return {
    currentVersion,
    latestVersion,
    hasUpdate: latestVersion ? currentVersion !== latestVersion : false,
    error,
    integrity: checkKoffiIntegrity(),
    lastUpdaterResult: readLastUpdaterResult()
  }
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
    case 'perform-repair': return await performRepair()
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
