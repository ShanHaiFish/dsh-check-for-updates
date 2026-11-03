// 更新器单飞锁回归测试（v1.15.0）：
// 同一临时目录（TMPDIR）内，已有有效锁时再次安排更新必须被拦截（返回 busy），
// 避免多个 detached updater 等父进程退出后并发执行 npm install（同一 prefix 的
// 并发 reify 会互相踩踏）。同时覆盖锁的清理判定：
//   - 父进程已死且超过陈旧阈值 → 清理；
//   - 父进程仍存活（用户安排后长时间不退出）→ 即使 createdAt 很旧也保持有效；
//   - updater 已写完同 id 结果（锁删除失败）→ 按陈旧清理；
//   - updater 正常执行结束 → 自清理删除锁与脚本（dryRun 模式，不安装任何东西）。
// CI 用法: node test/updater-lock.cjs
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const PLUGIN_ROOT = path.join(__dirname, '..')
const LOCK_NAME = 'dsh-updater.lock'
const STATUS_NAME = 'dsh-updater-last-status.json'
const MODULE_URL = pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href
let failed = 0
function check(name, actual, expect) {
  const ok = actual === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expect)}）`}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'updck-lock-'))
const lockFile = path.join(tmp, LOCK_NAME)
const statusFile = path.join(tmp, STATUS_NAME)

// 在受控 TMPDIR 下跑一段脚本，返回脚本最后一行 RESULT: 后的 JSON
function run(body) {
  const script = `
    const m = await import(${JSON.stringify(MODULE_URL)})
    ${body}
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: PLUGIN_ROOT,
    env: Object.assign({}, process.env, { TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error('探测子进程失败: ' + r.stderr)
  const last = r.stdout.trim().split('\n').filter(Boolean).at(-1)
  return JSON.parse(last.replace(/^RESULT:/, ''))
}

async function main() {
  try {
    // 用例 A：首次抢锁成功；有效锁存在时第二次被拦截（busy + holder 任务 id）；释放后可再抢
    let out = run(`
      const first = m.acquireUpdaterLock({ id: 'lock-a', parentPid: process.pid, mode: 'update' })
      const second = m.acquireUpdaterLock({ id: 'lock-b', parentPid: process.pid, mode: 'update' })
      const busyId = second.ok ? null : (second.holder && second.holder.id)
      m.releaseUpdaterLock(first.lockPath)
      const third = m.acquireUpdaterLock({ id: 'lock-c', parentPid: process.pid, mode: 'repair' })
      if (third.ok) m.releaseUpdaterLock(third.lockPath)
      console.log('RESULT:' + JSON.stringify({
        firstOk: first.ok, secondOk: second.ok, secondBusy: !!second.busy, busyId, thirdOk: third.ok
      }))
    `)
    check('A 首次抢锁成功', out.firstOk, true)
    check('A 有效锁存在时再次抢锁被拦截', out.secondOk, false)
    check('A 拦截返回 busy 标记', out.secondBusy, true)
    check('A 拦截结果指向持锁任务', out.busyId, 'lock-a')
    check('A 释放后可再次抢锁', out.thirdOk, true)

    // 用例 B：父进程已死 + 超过 60 分钟 → 陈旧锁被清理，可重新抢锁
    fs.writeFileSync(lockFile, JSON.stringify({
      id: 'lock-stale',
      parentPid: 2147483646,
      createdAt: new Date(Date.now() - 61 * 60 * 1000).toISOString()
    }))
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-after-stale', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('B 父进程已死的超时锁被清理后可抢锁', out.ok, true)

    // 用例 C：父进程仍存活（测试进程）→ 即使 createdAt 很旧也视为有效（用户在排队中）
    fs.writeFileSync(lockFile, JSON.stringify({
      id: 'lock-long',
      parentPid: process.pid,
      createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString()
    }))
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-while-alive', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('C 父进程存活时不按超时清理', out.ok, false)

    // 用例 D：updater 已写完同 id 结果但锁未删除 → 视为陈旧，可重新抢锁
    fs.writeFileSync(statusFile, JSON.stringify({ id: 'lock-done', finishedAt: new Date().toISOString(), success: false }))
    fs.writeFileSync(lockFile, JSON.stringify({
      id: 'lock-done',
      parentPid: 2147483646,
      createdAt: new Date().toISOString()
    }))
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-after-done', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('D 已写完结果的残留锁被清理', out.ok, true)

    // 用例 F：updater 进程已死（写状态前被强杀）→ 即使父进程还活着也立即判定陈旧
    fs.writeFileSync(lockFile, JSON.stringify({
      id: 'lock-dead-updater',
      parentPid: process.pid,
      updaterPid: 2147483646,
      createdAt: new Date().toISOString()
    }))
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-after-dead', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('F updater 已死的锁立即陈旧（无需等超时/父进程退出）', out.ok, true)

    // 用例 G：锁内容不可解析但很新（创建中途被读）→ 按 busy 处理，不误删活锁
    fs.writeFileSync(lockFile, 'not-json')
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-g', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('G 不可解析的新锁按 busy 处理', out.ok, false)

    // 用例 H：不可解析且已超过 60s 宽限 → 视为残留锁，可清理后抢锁
    fs.writeFileSync(lockFile, 'not-json')
    const oldTime = new Date(Date.now() - 2 * 60 * 1000)
    fs.utimesSync(lockFile, oldTime, oldTime)
    out = run(`
      const r = m.acquireUpdaterLock({ id: 'lock-h', parentPid: process.pid })
      if (r.ok) m.releaseUpdaterLock(r.lockPath)
      console.log('RESULT:' + JSON.stringify({ ok: r.ok }))
    `)
    check('H 超过宽限的不可解析锁被清理', out.ok, true)

    // 用例 E：updater 正常结束（dryRun，不安装）→ 自清理删除锁文件与脚本
    const mod = await import(MODULE_URL)
    const scriptPath = path.join(tmp, 'updater-dryrun.cjs')
    fs.writeFileSync(lockFile, JSON.stringify({
      id: 'lock-e',
      parentPid: process.pid,
      createdAt: new Date().toISOString()
    }))
    fs.writeFileSync(scriptPath, mod.buildUpdaterScript({
      id: 'lock-e',
      mode: 'update',
      targetVersion: '0.0.0-fixture',
      globalRoot: tmp,
      dshPkgJson: path.join(tmp, 'no-such-dsh', 'package.json'),
      parentPid: process.pid,
      nodeExe: process.execPath,
      npmCli: path.join(tmp, 'no-such-npm-cli.js'),
      statusFile,
      lockFile,
      createdAt: new Date().toISOString(),
      dryRun: true
    }))
    const r = spawnSync(process.execPath, [scriptPath], {
      cwd: PLUGIN_ROOT,
      env: Object.assign({}, process.env, { TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
      encoding: 'utf8'
    })
    check('E updater dryRun 正常退出', r.status, 0)
    check('E updater 删除单飞锁', fs.existsSync(lockFile), false)
    check('E updater 自删除脚本', fs.existsSync(scriptPath), false)
    check('E updater 写入结果状态', JSON.parse(fs.readFileSync(statusFile, 'utf8')).id, 'lock-e')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  if (failed) {
    console.error('FAILED: ' + failed + ' 项未通过')
    process.exit(1)
  }
  console.log('OK updater-lock: 全部通过')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
})
