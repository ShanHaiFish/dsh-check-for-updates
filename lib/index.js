// ============================================================
// DSH 更新检查插件 — Host（静态 bundle 形态）v1.15.0
// 静态形态：随 profile 层栈自动加载，无需每次重启 cordis_define/run。
// 无硬编码路径：DSH 安装根/版本经 require.resolve('@deepseek-ai/dsh/package.json')
//   与 process.execPath 等运行时探测；node/npm-cli 从 execPath 派生；网络用 Node 全局 fetch。
// 客户端通过 POST /dsh-update-check/api （JSON {method}）调用下列方法。
//
// v1.14.0 DSH 0.2.0 适配：
//   peerDependencies 放宽为 `^0.1.0-rc.6 || ^0.2.0-rc.1`——DSH 0.2.0-rc.1 起启动时
//   按此字段做严格兼容校验，不匹配则整个 bundle 被拒载（宿主/客户端两半都不生效）。
//   0.1.x ↔ 0.2.0 宿主契约经逐一核对未变：webServer 服务名、register({kind:'exact',
//   path, handler(req,res)})、ctx.inject/ctx.effect、cordis 4.0.x 均兼容。
//   package.json 的 dsh.client.inject 补充 @deepseek-ai/dsh-client-modules
//   （0.2.0 中 window.__ModuleLoader__ 的提供方；不存在的注入条目会被软跳过）。
//   v1.15.0 复核：dsh-client-runtime 在 0.2.x 已停发、软跳过，但保留该条目以维持
//   README 声明的 0.1.x 兼容（该字段仅作加载元数据，不参与 apply 顺序）。
// v1.14.0 修复「当前版本显示 0.0.0」与 globalRoot 相对路径两个探测 bug：
//   1) dshInfo：node 与 DSH 安装根异位（如 /usr/bin/node-22 + /usr/local/lib/node_modules）
//      时旧探测链全落空。补充 Unix 标准布局 <root>/lib/node_modules 候选，并经 PATH 上
//      dsh 启动器软链（npm/pnpm 全局安装均为软链）realpath 向上找包根，与安装方式无关。
//   2) deriveGlobalRoot：split+filter(Boolean) 丢掉 Unix 绝对路径前导 '/'，得到
//      'usr/local/lib' 相对路径，破坏 updater 的 --prefix。改为按分隔符 lastIndexOf 切片。
// v1.14.0 修复「版本一致仍提示历史更新失败」：
//   1) hasUpdate 改走 semver 比较器（旧实现字符串 !==，本地比 npm 更新时会误报）；
//   2) readLastUpdaterResult 过滤目标已达成（当前版本 ≥ 当次目标版本）的 update
//      失败记录——更新实际已生效时「可重新安排更新」是误导；repair/成功记录不受影响。
//
// v1.15.0 同步完善（DSH 0.2.1-rc.5 发布通道变化）：
//   1) 版本通道错位：DSH 用 dist-tags 区分通道——latest/next=推荐版（0.2.1-rc.5），
//      alpha=实验版（0.2.2-alpha.2，且其 engines.node ≥24.9 高于常见环境）。旧实现
//      取全量 versions 的 semver 最大者，会跨通道把用户引向更高核心的 alpha。
//      改为 pickLatestVersion：候选 = latest/next 标签 ∪ 非 alpha 的最高版本
//      （兜底 latest 标签滞后），alpha 永不作为更新目标。
//   2) 失败记录残留：目标为 alpha（非推荐通道）的历史失败永远达不到“当前 ≥ 目标”，
//      会一直弹「上次自动更新未成功」。readLastUpdaterResult 追加「当前 ≥ 推荐最新」
//      即视为陈旧记录。
//   3) 更新器单飞：弹卡/设置项/多标签页可重复 schedule，多个 detached updater 在同
//      一父进程退出后并发跑 npm install，同一 prefix 的并发 reify 会互相踩踏
//      （2026-11-02 实测两个任务重叠 → TAR_ENTRY_ERROR ENOENT、退出码 1）。改为
//      O_EXCL 锁文件单飞，updater 完成后释放，父进程已死且超时的锁按陈旧清理。
//   4) /dsh-update-check/api 加固：要求 application/json + 同源 Origin，避免任意
//      网页对本地 exact 路由发起 simple POST 触发安排更新/修复。
//   5) 客户端清理：浮卡 z-index 10000→900（低于 0.2.1 shell 浮层/弹窗），卸载/HMR
//      时经 ctx.effect 清理浮卡并复位自动检查标志（见 client/client.js）。
//   6) 清单同步：peerDependencies 追加 ^0.2.1-rc.1（默认 semver 语义下也匹配
//      0.2.1-rc.5，0.3.x 发布前需再放宽）；dsh.client.inject 保留已停发的
//      @deepseek-ai/dsh-client-runtime 条目以维持 0.1.x 兼容（0.2.x 软跳过）。
//   7) 单飞锁加固：锁内含 updaterPid（updater 写状态前被强杀时立即判定陈旧）、
//      不可解析锁 60s 宽限、陈旧阈值 60min、updater 删锁前校验任务 id。
//
// v1.14.1 修复「Linux 上安排更新必失败（EACCES mkdir <prefix>/lib/lib）」：
//   deriveGlobalRoot 把 node_modules 的父目录当作 --prefix，Unix 布局少算一级 lib，
//   npm 实际去写 <prefix>/lib/lib/node_modules。改为返回 npm prefix 本身（Unix 先剥
//   <X>/lib/node_modules，Windows 布局退回 <X>/node_modules），旧用例期望随之修正。
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
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, sep } from 'node:path'
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

// 修复：旧实现 split+filter(Boolean) 会丢掉 Unix 绝对路径的前导 '/'，
// 得到 'usr/local/lib' 这样的相对路径，破坏 updater 的 --prefix 与对盘校验。
// 改为按平台分隔符 lastIndexOf 定位，slice 原样保留绝对前缀（含盘符/UNC 头）。
// v1.14.1 再修：updater 的 --prefix 需要的是 npm prefix 本身，而 npm 的全局
// 布局在 Unix 是 <prefix>/lib/node_modules、Windows 是 <prefix>/node_modules。
// 旧逻辑统一返回 node_modules 的父目录——Windows 恰好等于 prefix（侥幸正确），
// Unix 则少算一级 lib，npm 会去 mkdir <prefix>/lib/lib（2026-10-20 实测报
// EACCES: permission denied, mkdir '/usr/local/lib/lib'，退出码 243）。
// 故 Unix 优先匹配 <X>/lib/node_modules 返回 X，再退回 <X>/node_modules 返回 X
//（覆盖 Windows 布局与未来未知形态），nvm 的 <versions>/vX/lib/node_modules 亦命中。
function deriveGlobalRoot(pkgDir) {
  if (process.platform !== 'win32') {
    const unixIdx = pkgDir.lastIndexOf(sep + 'lib' + sep + 'node_modules' + sep)
    if (unixIdx > 0) return pkgDir.slice(0, unixIdx)
  }
  const idx = pkgDir.lastIndexOf(sep + 'node_modules' + sep)
  if (idx > 0) return pkgDir.slice(0, idx)
  return null
}

// 从疑似 dsh 入口文件（bin.js 等）向上找 package.json 名为 @deepseek-ai/dsh 的包根。
// PATH 上的 dsh 启动器在 npm/pnpm 全局安装下均为软链，realpath 直达真实入口，
// 与 node 可执行文件的位置无关（如 /usr/bin/node-22 + /usr/local/lib/node_modules）。
function dshPkgRootFromEntry(entryPath) {
  let dir = dirname(entryPath)
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const info = readJson(pkgPath)
        if (info && info.name === '@deepseek-ai/dsh' && info.version) {
          return { pkgJsonPath: pkgPath, pkgDir: dir, version: String(info.version) }
        }
      } catch (e) { /* 解析失败按不匹配处理 */ }
      return null // 命中其他包的 package.json，停止上溯
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

let dshInfoCache = null
function dshInfo() {
  if (dshInfoCache) return dshInfoCache
  const jsonCandidates = []
  const entryCandidates = []
  try { jsonCandidates.push(require.resolve('@deepseek-ai/dsh/package.json')) } catch (e) { /* ignore */ }
  try {
    const nodeDir = dirname(process.execPath)
    const rootDir = dirname(nodeDir)
    // node 同根布局去重探测两种形态：
    //   Windows 官方包/npm -g：node.exe 与 node_modules 同级 → <root>/node_modules
    //   Unix 标准布局（官方 tarball / make install / nvm）：<root>/lib/node_modules
    for (const base of rootDir !== nodeDir ? [rootDir, nodeDir] : [nodeDir]) {
      jsonCandidates.push(join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      jsonCandidates.push(join(base, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
    }
  } catch (e) { /* ignore */ }
  // PATH 上的 dsh 启动器：realpath 直达真实入口（覆盖 node 与 dsh 安装根异位的场景）
  for (const dir of [...(process.env.PATH || '').split(delimiter), '/usr/local/bin', '/usr/bin']) {
    if (!dir) continue
    try { entryCandidates.push(realpathSync(join(dir, 'dsh'))) } catch (e) { /* 该目录无 dsh，跳过 */ }
  }
  for (const base of [process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '', process.env.NPM_CONFIG_PREFIX || '']) {
    if (!base) continue
    try { jsonCandidates.push(join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')) } catch (e) { /* ignore */ }
  }
  for (const c of jsonCandidates) {
    try {
      const info = readJson(c)
      if (info && info.version) {
        const pkgDir = dirname(c)
        dshInfoCache = { pkgJsonPath: c, pkgDir, globalRoot: deriveGlobalRoot(pkgDir), version: String(info.version) }
        return dshInfoCache
      }
    } catch (e) { /* ignore */ }
  }
  for (const entry of entryCandidates) {
    const found = dshPkgRootFromEntry(entry)
    if (found) {
      dshInfoCache = {
        pkgJsonPath: found.pkgJsonPath,
        pkgDir: found.pkgDir,
        globalRoot: deriveGlobalRoot(found.pkgDir),
        version: found.version
      }
      return dshInfoCache
    }
  }
  dshInfoCache = { pkgJsonPath: null, pkgDir: null, globalRoot: null, version: '0.0.0' }
  return dshInfoCache
}
// 导出运行时探测供 test/dsh-info.cjs 回归测试使用（不参与插件契约，Cordis 只读 name/inject/apply）
export { dshInfo }
// 导出检查入口供 test/updater-status-filter.cjs 回归测试使用（不参与插件契约）
export { checkForUpdates }

function nodePaths() {
  const nodeExe = process.execPath || 'node'
  // 依次探测 npm-cli.js：官方 tarball 布局（node 同根）→ PATH 上 npm 启动器的真实指向
  // （Linux 发行版常把 /usr/bin/npm 做成软链，realpath 直达真实 npm-cli.js）→
  // 发行版版本化全局目录（Fedora/RHEL 的 /usr/lib/node_modules_22 等）。
  const nodeDir = dirname(nodeExe)
  const candidates = [join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  const shimDirs = [nodeDir, ...(process.env.PATH || '').split(delimiter), '/usr/local/bin', '/usr/bin']
  for (const dir of shimDirs) {
    if (!dir) continue
    try {
      const real = realpathSync(join(dir, 'npm'))
      if (basename(real) === 'npm-cli.js') { candidates.push(real); continue }
      // npm 启动器是 shell 包装而非软链（如 Debian）：退回其同根布局
      candidates.push(join(dirname(real), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    } catch (e) { /* 该目录无 npm 启动器，跳过 */ }
  }
  for (const base of ['/usr/lib', '/usr/lib64', '/usr/local/lib']) {
    try {
      for (const entry of readdirSync(base)) {
        if (entry === 'node_modules' || /^node_modules_\d+$/.test(entry)) {
          candidates.push(join(base, entry, 'npm', 'bin', 'npm-cli.js'))
        }
      }
    } catch (e) { /* 目录不可读，跳过 */ }
  }
  let resolved = ''
  for (const c of candidates) {
    try { if (c && existsSync(c)) { resolved = c; break } } catch (e) { /* ignore */ }
  }
  return { nodeExe, npmCli: resolved || candidates[0] }
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

// 发布通道感知的最新版本选择（v1.15.0）。
// 背景：npm 侧存在 dist-tags 通道——latest / next 为推荐通道，alpha 为实验通道。
// DSH 0.2.1-rc.5 时期：latest=next=0.2.1-rc.5，alpha=0.2.2-alpha.2（核心版本更高，
// semver 更大，但属于实验通道且 engines.node >=24.9）。旧实现只按 semver 取全量
// versions 最大者，会跨通道选中 alpha，把用户带离推荐通道。
// 规则：alpha 预发布永不作为更新目标；候选 = latest/next 标签值 ∪ 非 alpha 的最高
// 版本（兜底 latest 标签滞后于 next/未打标签的 rc 的情况），取最高者。
// 细节：alpha 判定只看 prerelease 首段（大小写不敏感，兼容 alpha/alpha.2/ALPHA1）；
// 标签指向的版本必须确实存在于 versions 中，避免 registry 脏标签带入不存在的版本。
function isAlphaPrerelease(v) {
  const s = String(v)
  const dash = s.indexOf('-')
  if (dash === -1) return false
  const first = s.slice(dash + 1).split('+')[0].split('.')[0]
  return first.toLowerCase().startsWith('alpha')
}

export function pickLatestVersion(packument) {
  if (!packument || typeof packument !== 'object') return null
  const tags = packument['dist-tags'] && typeof packument['dist-tags'] === 'object'
    ? packument['dist-tags'] : {}
  const versions = packument.versions && typeof packument.versions === 'object'
    ? packument.versions : {}
  const hasVersion = (v) => Object.prototype.hasOwnProperty.call(versions, v)
  let best = null
  const consider = (v, requireListed) => {
    if (typeof v !== 'string' || !isSafeVersion(v) || isAlphaPrerelease(v)) return
    if (requireListed && !hasVersion(v)) return
    if (best === null || compareVersions(v, best) > 0) best = v
  }
  consider(tags.latest, true)
  consider(tags.next, true)
  for (const v of Object.keys(versions)) consider(v, false)
  return best
}
// 导出比较器供 test/version.cjs 回归测试使用（不参与插件契约）
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
      const best = pickLatestVersion(data)
      if (best) return best
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

function readLastUpdaterResult(currentVersion, latestVersion) {
  try {
    const data = JSON.parse(readFileSync(updaterStatusFile(), 'utf8'))
    const finished = data.finishedAt ? Date.parse(data.finishedAt) : 0
    if (!finished || Date.now() - finished > 24 * 3600 * 1000) return null
    // 目标已达成（当前版本 ≥ 当次任务的目标版本）→ 历史失败不再提示：
    // 更新实际已生效（如失败后经其他途径完成），此时「可重新安排更新」是误导。
    // koffi 修复类任务无 targetVersion，不适用此过滤。
    if (data && data.success === false && data.mode === 'update' &&
      typeof data.targetVersion === 'string' && data.targetVersion &&
      typeof currentVersion === 'string' && currentVersion !== '0.0.0' &&
      compareVersions(currentVersion, data.targetVersion) >= 0) return null
    // v1.15.0：目标不是当前推荐版本（如历史上被误选的 alpha 通道目标）时，上面的
    // “当前 ≥ 目标”永远不成立，失败提示会无限残留。当前已 ≥ 推荐最新版本即视为
    // 陈旧记录——用户已经在推荐通道的最新版，没有需要重试的更新。
    if (data && data.success === false && data.mode === 'update' &&
      typeof latestVersion === 'string' && latestVersion &&
      typeof currentVersion === 'string' && currentVersion !== '0.0.0' &&
      compareVersions(currentVersion, latestVersion) >= 0) return null
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

// ---------------- 更新器单飞锁（v1.15.0） ----------------
// 弹卡、设置项、「再次安排更新」与多标签页都可以各安排一次；多个 detached
// updater 会等待同一个父进程退出后同时开跑 npm install，同一 prefix 上的并发
// reify 会互相踩踏（2026-11-02 实测两个任务重叠 → TAR_ENTRY_ERROR ENOENT 退出码 1）。
// 用 O_EXCL 创建锁文件保证同一时刻只有一个排队中的更新任务；updater 结束后释放。
const UPDATER_LOCK_NAME = 'dsh-updater.lock'
// updater 异常退出（被强杀/写状态前崩溃）留下的锁：没有 updaterPid 可判活时，
// 父进程已退出且超过该时长视为残留。updater 最坏运行 ≈ 等父进程最多 10min +
// 安装 15min + koffi 自愈/打包 ~4min，取 60min 留足余量，避免误删活锁。
const LOCK_ORPHAN_STALE_MS = 60 * 60 * 1000
// 锁内容暂不可解析（创建中途被读/文件损坏）时先按 busy 处理 60s，避免把正在
// 写入的活锁误判为陈旧而删除，导致双 updater 并发。
const LOCK_UNREADABLE_GRACE_MS = 60 * 1000

export function updaterLockPath() {
  return join(tmpdir(), UPDATER_LOCK_NAME)
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return !!(e && e.code === 'EPERM') }
}

// 读取锁快照：{ exists, lock, mtimeMs }，lock=null 表示内容不可解析
function readLockSnapshot(lockPath) {
  let mtimeMs = 0
  try { mtimeMs = statSync(lockPath).mtimeMs } catch (e) { return { exists: false, lock: null, mtimeMs: 0 } }
  let lock = null
  try { lock = JSON.parse(readFileSync(lockPath, 'utf8')) } catch (e) { lock = null }
  return { exists: true, lock, mtimeMs }
}

function lockIsStale(lock, mtimeMs) {
  const now = Date.now()
  if (!lock || typeof lock.createdAt !== 'string') {
    return now - (mtimeMs || 0) > LOCK_UNREADABLE_GRACE_MS
  }
  const created = Date.parse(lock.createdAt)
  if (!created) return now - (mtimeMs || 0) > LOCK_UNREADABLE_GRACE_MS
  // updater 进程已死但锁还在（写状态前被强杀/崩溃）→ 无需等超时，立即视为残留
  if (typeof lock.updaterPid === 'number' && lock.updaterPid > 0 && !pidAlive(lock.updaterPid)) return true
  // updater 已写完同 id 的结果（锁删除失败/进程被强杀在写状态之后）→ 陈旧
  if (typeof lock.id === 'string' && lock.id) {
    try {
      const st = JSON.parse(readFileSync(updaterStatusFile(), 'utf8'))
      if (st && st.id === lock.id && typeof st.finishedAt === 'string' && Date.parse(st.finishedAt) > 0) return true
    } catch (e) { /* 无状态文件：继续按存活/超时判断 */ }
  }
  // createdAt 明显晚于本机时间（时钟回拨/未来时间）→ 视为损坏锁，允许清理
  if (created > now + 60 * 1000) return true
  // 发起更新的 DSH 进程还活着 → 任务有效（updater 正在等它退出）
  if (typeof lock.parentPid === 'number' && pidAlive(lock.parentPid)) return false
  return now - created > LOCK_ORPHAN_STALE_MS
}

// 返回 { ok:true, lockPath } 或 { ok:false, busy?, holder?, error }
export function acquireUpdaterLock(info) {
  const lockPath = updaterLockPath()
  const payload = JSON.stringify(Object.assign({ createdAt: new Date().toISOString() }, info), null, 2)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, payload, { flag: 'wx' })
      return { ok: true, lockPath }
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, error: '创建更新锁失败: ' + ((e && e.message) || e) }
      const snap = readLockSnapshot(lockPath)
      if (!snap.exists) continue // 锁刚被删：直接重试
      if (lockIsStale(snap.lock, snap.mtimeMs)) {
        try { unlinkSync(lockPath) } catch (e2) { /* 与 updater 竞争删除：下一轮重试 */ }
        continue
      }
      const holder = snap.lock
      return {
        ok: false,
        busy: true,
        holder,
        error: '已有更新任务在排队' + (holder && holder.mode === 'repair' ? '（修复）' : '') +
          '：退出 DSH 后将自动执行，请勿重复安排'
      }
    }
  }
  return { ok: false, busy: true, error: '已有更新任务在排队，请稍后重试' }
}

export function releaseUpdaterLock(lockPath) {
  try { unlinkSync(lockPath) } catch (e) { /* 已释放/不存在视为成功 */ }
}

// 记录 updater 子进程 PID（写进锁文件）：updater 若在写状态前被强杀，宿主下次
// 安排时可据此立即判定锁陈旧，而不是干等 60 分钟。updater 已自行删锁时跳过
// （绝不重建锁）。
function recordLockUpdaterPid(lockPath, updaterPid) {
  try {
    const snap = readLockSnapshot(lockPath)
    if (!snap.exists || !snap.lock) return
    snap.lock.updaterPid = updaterPid
    writeFileSync(lockPath, JSON.stringify(snap.lock, null, 2))
  } catch (e) { /* 记录失败不改变单飞语义 */ }
}

// 阶段一：先抢单飞锁，再在系统临时目录下建一次性任务目录（mkdtemp 随机名，
// 脚本固定名），写入实例化后的 updater 脚本并经 launcher.cjs detached 启动。
// 任务 id 只进 JSON 配置，不参与任何路径/命令构造；launch 失败时释放锁。
function scheduleUpdater(cfg) {
  const lock = acquireUpdaterLock({
    id: cfg.id,
    mode: cfg.mode,
    parentPid: cfg.parentPid,
    targetVersion: cfg.targetVersion || null
  })
  if (!lock.ok) return lock
  let taskDir = null
  try {
    cfg.lockFile = lock.lockPath
    taskDir = mkdtempSync(join(tmpdir(), 'dsh-updater-'))
    const scriptPath = join(taskDir, UPDATER_SCRIPT_NAME)
    writeFileSync(scriptPath, buildUpdaterScript(cfg), 'utf8')
    const child = launchDetached(process.execPath, [scriptPath])
    if (child && typeof child.pid === 'number' && child.pid > 0) {
      recordLockUpdaterPid(lock.lockPath, child.pid)
    }
    return { ok: true, scriptPath, lockPath: lock.lockPath }
  } catch (e) {
    releaseUpdaterLock(lock.lockPath)
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
  if (!scheduled.ok) return { updated: false, reason: scheduled.busy ? 'already-scheduled' : 'schedule-failed', error: scheduled.error }

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
  if (!scheduled.ok) return { updated: false, reason: scheduled.busy ? 'already-scheduled' : 'schedule-failed', error: scheduled.error }

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
    // 修复：旧实现用字符串不等（!==）判断——版本相同虽为 false，但本地比 npm
    // 更新时也会误报；统一走 semver 比较器，仅“最新 > 当前”才提示。
    hasUpdate: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
    error,
    integrity: checkKoffiIntegrity(),
    lastUpdaterResult: readLastUpdaterResult(currentVersion, latestVersion)
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

// 同源校验：浏览器对同源 POST 也会带 Origin；跨站 simple POST 的 Origin 与 Host
// 不一致（无 Origin 的非浏览器调用照常放行）。配合 application/json 要求阻断
// 任意网页对本地 exact 路由发起「安排更新/修复」的副作用请求。
function isSameOrigin(origin, host) {
  if (!origin) return true
  try {
    const u = new URL(origin)
    return !host || u.host === host
  } catch (e) { return false }
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
            const contentType = String(request.headers['content-type'] || '').toLowerCase()
            if (!contentType.startsWith('application/json')) {
              sendJson(response, 415, { error: 'content-type must be application/json' })
              return
            }
            if (!isSameOrigin(request.headers.origin, request.headers.host)) {
              sendJson(response, 403, { error: 'cross-origin request rejected' })
              return
            }
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
