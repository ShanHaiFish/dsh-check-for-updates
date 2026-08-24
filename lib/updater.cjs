#!/usr/bin/env node
// ============================================================
// DSH 分离式更新器模板 v1.13.0（由 dsh-check-for-updates 宿主实例化）
//
// 宿主（lib/index.js）读取本文件，把下方 CFG 行的配置占位注释替换为
// 任务配置 JSON 后写入临时目录，再以 detached 子进程启动。
//
// 职责（阶段二，脱离 DSH 进程生命周期）：
//   1. 轮询等待发起更新的 DSH 进程（CFG.parentPid）退出（Windows 下运行中的
//      DSH 会锁住 koffi.node，运行中安装正是“元数据已新、二进制残留旧版”
//      部分更新损坏的根源）；退出后再宽限 3 秒等句柄彻底释放。
//   2. update 模式：npm 精确版本安装 → 退出码 / 对盘版本 / koffi 原生模块
//      三重校验；repair 模式：仅校验并修复 koffi。
//   3. koffi 断链时按主包声明版本拉取官方 tarball（npm pack + 系统 tar），
//      校验 tarball 内二进制版本后全量覆盖平台包目录完成自愈。
//   4. 结果写入 CFG.statusFile（DSH 下次启动时由插件读取并反馈给用户），
//      随后自删除脚本文件。
//
// 安全约束：所有子进程均以“文件 + 字符串参数数组”方式调用（不经 shell），
// 版本号先经 isSafeVersion 白名单校验，路径均来自宿主注入的配置或 Node API。
// ============================================================
'use strict'
const CFG = /*__DSH_UPDATER_CFG__*/null
if (!CFG) {
  console.error('[dsh-updater] 缺少任务配置（本文件是模板，需由宿主实例化）')
  process.exit(2)
}

const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')
const { createRequire } = require('module')

function isSafeVersion(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v)
}

// 统一子进程入口：只接受“可执行文件 + 字符串参数数组”，参数逐个校验，
// 任何调用点都不做 shell 字符串拼接。
function runTool(file, args, opts) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('可执行文件路径非法')
  if (!Array.isArray(args)) throw new Error('参数必须是数组')
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0) throw new Error('存在非法参数')
  }
  return cp.spawnSync(file, args, opts)
}

function tail(s, n) {
  return String(s || '').split(/\r?\n/).filter(Boolean).slice(-n).join('\n')
}

function writeStatus(fields) {
  const payload = Object.assign(
    { id: CFG.id, mode: CFG.mode, createdAt: CFG.createdAt, finishedAt: new Date().toISOString() },
    fields
  )
  try {
    fs.writeFileSync(CFG.statusFile, JSON.stringify(payload, null, 2))
  } catch (e) {
    console.error('[dsh-updater] 写状态文件失败: ' + e.message)
  }
  return payload
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function waitExit(pid, maxMs) {
  const start = Date.now()
  while (true) {
    if (!isAlive(pid)) return true
    if (Date.now() - start >= maxMs) return false
    await sleep(1000)
  }
}

// koffi 的原生二进制内嵌自身版本字符串（koffi.version 即来自该字面量）。
// 在二进制字节中查找“带边界的声明版本字面量”即可判断包声明与二进制是否
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
  let dir = path.dirname(entry)
  while (true) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name === expectedName) return dir
      } catch (e) { /* 解析失败按不匹配处理 */ }
      return null
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function koffiState() {
  try {
    if (!CFG.dshPkgJson || !fs.existsSync(CFG.dshPkgJson)) return { present: false }
    const req = createRequire(CFG.dshPkgJson)
    const mainDir = findPkgRoot(req, 'koffi', 'koffi')
    const platScope = '@koromix/koffi-' + process.platform + '-' + process.arch
    const platDir = findPkgRoot(req, platScope, platScope)
    if (!mainDir || !platDir) return { present: false }
    const mainPkg = path.join(mainDir, 'package.json')
    const platPkg = path.join(platDir, 'package.json')
    const binPath = path.join(platDir, process.platform + '_' + process.arch, 'koffi.node')
    const koffiVersion = JSON.parse(fs.readFileSync(mainPkg, 'utf8')).version
    const platformVersion = JSON.parse(fs.readFileSync(platPkg, 'utf8')).version
    let ok = false
    try {
      const buf = fs.readFileSync(binPath)
      ok = hasVersionLiteral(buf, koffiVersion) &&
        (koffiVersion === platformVersion || hasVersionLiteral(buf, platformVersion))
    } catch (e) { ok = false }
    return {
      present: true,
      ok: ok,
      koffiVersion: koffiVersion,
      platformVersion: platformVersion,
      binPath: binPath,
      platDir: platDir
    }
  } catch (e) {
    return { present: false, error: e.message }
  }
}

function describeKoffi(k) {
  if (!k || !k.present) return { checked: false, ok: true, note: (k && k.error) || '未找到 koffi 依赖' }
  return { checked: true, ok: !!k.ok, koffiVersion: k.koffiVersion, platformVersion: k.platformVersion }
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) copyTree(s, d)
    else fs.copyFileSync(s, d)
  }
}

// 自愈：按主包声明版本拉取官方 tarball，全量覆盖平台包目录（含 package.json
// 与二进制），消除任何形态的部分更新残留。需要系统 tar（Windows 10 1803+ 自带）。
function healKoffi(state) {
  if (!isSafeVersion(state.koffiVersion)) return { ok: false, error: 'koffi 声明版本非法: ' + state.koffiVersion }
  const platScope = '@koromix/koffi-' + process.platform + '-' + process.arch
  const pkgSpec = platScope + '@' + state.koffiVersion
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-koffi-heal-'))
  try {
    const packArgs = ['pack', pkgSpec, '--pack-destination', workDir]
    const pack = runTool(CFG.nodeExe, [CFG.npmCli].concat(packArgs), { encoding: 'utf8', timeout: 180000 })
    if (pack.status !== 0) {
      return { ok: false, error: 'npm pack 失败(' + pack.status + '): ' + tail(pack.stderr || pack.stdout, 5) }
    }
    const tgzName = String(pack.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop()
    if (!tgzName) return { ok: false, error: 'npm pack 未输出 tgz 文件名' }
    const tgzPath = path.join(workDir, tgzName)
    const untarArgs = ['-xzf', tgzPath, '-C', workDir]
    const untar = runTool('tar', untarArgs, { encoding: 'utf8', timeout: 60000 })
    if (untar.status !== 0) return { ok: false, error: 'tar 解压失败: ' + tail(untar.stderr, 3) }
    const pkgDir = path.join(workDir, 'package')
    const binSubdir = process.platform + '_' + process.arch
    const srcBin = path.join(pkgDir, binSubdir, 'koffi.node')
    if (!fs.existsSync(srcBin)) return { ok: false, error: 'tarball 中缺少 ' + binSubdir + '/koffi.node' }
    if (!hasVersionLiteral(fs.readFileSync(srcBin), state.koffiVersion)) {
      return { ok: false, error: 'tarball 内二进制版本与声明不符，放弃覆盖' }
    }
    try { fs.copyFileSync(state.binPath, state.binPath + '.bak') } catch (e) { /* 无旧文件可备份 */ }
    copyTree(pkgDir, state.platDir)
    return { ok: true }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}

function selfCleanup() {
  // 只删除脚本自身；所在任务目录留给操作系统临时目录机制回收，
  // 避免误删用户指定的状态文件等非本脚本内容
  try { fs.rmSync(__filename, { force: true }) } catch (e) { /* ignore */ }
}

async function main() {
  if (CFG.dryRun) {
    const k = koffiState()
    writeStatus({ success: true, dryRun: true, parentPid: CFG.parentPid, koffi: describeKoffi(k) })
    return
  }

  const exited = await waitExit(CFG.parentPid, CFG.waitParentMs || 600000)
  if (!exited) {
    writeStatus({
      success: false,
      parentExited: false,
      error: '等待 DSH 进程(PID ' + CFG.parentPid + ')退出超时，未执行安装。可重新打开 DSH 再次安排更新。'
    })
    return
  }
  await sleep(3000) // 宽限：等句柄/文件锁彻底释放

  const result = { parentExited: true, targetVersion: CFG.targetVersion }

  if (CFG.mode === 'repair') {
    const k = koffiState()
    if (!k.present) {
      writeStatus(Object.assign(result, { success: false, error: '未找到 koffi 安装，修复中止' }))
      return
    }
    if (k.ok) {
      writeStatus(Object.assign(result, { success: true, koffi: describeKoffi(k) }))
      return
    }
    const healed = healKoffi(k)
    const after = koffiState()
    const okAfter = after.present && after.ok
    writeStatus(Object.assign(result, {
      success: okAfter,
      koffi: Object.assign(describeKoffi(after), { wasBroken: true, repaired: healed.ok, repairError: healed.ok ? null : healed.error }),
      error: okAfter ? null : 'koffi 修复未成功: ' + (healed.error || '复验仍不一致')
    }))
    return
  }

  // mode === 'update'：目标版本先过白名单
  if (!isSafeVersion(CFG.targetVersion)) {
    writeStatus(Object.assign(result, { success: false, error: '目标版本号非法: ' + CFG.targetVersion }))
    return
  }
  const install = { code: null, timedOut: false, logTail: '' }
  let failure = null
  try {
    const dshSpec = '@deepseek-ai/dsh@' + CFG.targetVersion
    const installArgs = ['install', '-g', '--no-audit', '--no-fund', '--prefix', CFG.globalRoot, dshSpec]
    const r = runTool(CFG.nodeExe, [CFG.npmCli].concat(installArgs), {
      cwd: CFG.globalRoot,
      encoding: 'utf8',
      timeout: CFG.installTimeoutMs || 900000,
      maxBuffer: 8 * 1024 * 1024
    })
    install.timedOut = !!(r.error && r.error.code === 'ETIMEDOUT')
    install.code = r.status
    install.logTail = tail(String(r.stdout || '') + '\n' + String(r.stderr || ''), 40)
    if (r.error && !install.timedOut) failure = '安装进程失败: ' + r.error.message
    else if (install.timedOut) failure = '安装超时被中止，已继续做完整性校验'
    else if (r.status !== 0) failure = 'npm install 退出码 ' + r.status
  } catch (e) {
    failure = '安装执行异常: ' + e.message
  }

  // 对盘校验：磁盘上的版本必须等于目标
  let diskVersion = null
  try { diskVersion = JSON.parse(fs.readFileSync(CFG.dshPkgJson, 'utf8')).version } catch (e) { /* 读不到按失败处理 */ }
  result.diskVersion = diskVersion
  if (!failure && diskVersion !== CFG.targetVersion) {
    failure = '安装后对盘校验失败：磁盘版本 ' + diskVersion + '，期望 ' + CFG.targetVersion
  }

  // koffi 完整性校验 + 自愈
  const k = koffiState()
  result.koffi = describeKoffi(k)
  if (k.present && !k.ok) {
    const healed = healKoffi(k)
    const after = koffiState()
    const okAfter = after.present && after.ok
    result.koffi = Object.assign(describeKoffi(after), { wasBroken: true, repaired: healed.ok, repairError: healed.ok ? null : healed.error })
    if (!okAfter && !failure) failure = 'koffi 断链自愈失败: ' + (healed.error || '复验仍不一致')
  }

  writeStatus(Object.assign(result, { success: !failure, install: install, error: failure }))
}

main().then(() => selfCleanup()).catch((e) => {
  writeStatus({ success: false, error: 'updater 异常: ' + ((e && e.stack) || String(e)) })
  selfCleanup()
})
