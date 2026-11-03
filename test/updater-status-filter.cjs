// 「版本一致不再提示历史更新失败」回归测试：
// 1) checkForUpdates().hasUpdate 走 semver 比较——版本相同为 false，本地更新时也不误报；
// 2) update 模式的历史失败记录在目标已达成（当前版本 ≥ 目标版本）时被过滤，
//    不再显示「上次自动更新未完成：…，可重新安排更新」；repair 记录与成功记录不受影响；
// 3) v1.15.0：目标为 alpha 实验通道的陈旧失败记录，在当前已是推荐最新版时也过滤；
//    但若确实存在更新的推荐版，失败提示保留（仍需要用户重试）。
// 手法：fixture DSH 安装（bin/dsh 软链）+ 受控 TMPDIR 状态文件 + fetch 桩，无真实网络。
// CI 用法: node test/updater-status-filter.cjs
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const PLUGIN_ROOT = path.join(__dirname, '..')
const STATUS_NAME = 'dsh-updater-last-status.json'
let failed = 0
function check(name, actual, expect) {
  const ok = actual === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expect)}）`}`)
}

// 构造 fixture DSH 安装：prefix/bin/dsh（软链）→ prefix/lib/node_modules/@deepseek-ai/dsh
function makeFixture(prefix, version) {
  const pkgDir = path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), '// fake dsh entry\n')
  fs.symlinkSync(path.join(pkgDir, 'lib', 'bin.js'), path.join(prefix, 'bin', 'dsh'))
}

// 在 fixture + 受控环境里跑 checkForUpdates：statuses 为 null（不写状态文件）或对象。
// stubPackument：完整 packument（含 versions/dist-tags），或直接给 versions 映射（向后兼容）。
function probe(fixturePrefix, tmpDir, stubPackument, statuses) {
  if (statuses) {
    fs.writeFileSync(path.join(tmpDir, STATUS_NAME), JSON.stringify(statuses))
  } else {
    fs.rmSync(path.join(tmpDir, STATUS_NAME), { force: true })
  }
  const packument = stubPackument && stubPackument.versions
    ? stubPackument
    : { versions: stubPackument || {} }
  const script = `
    globalThis.fetch = async () => ({ status: 200, text: async () =>
      JSON.stringify(${JSON.stringify(packument)}) })
    import(${JSON.stringify(pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href)})
      .then((m) => m.checkForUpdates())
      .then((r) => console.log('RESULT:' + JSON.stringify(r)))
      .catch((e) => { console.error(e); process.exit(1) })
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: PLUGIN_ROOT,
    env: Object.assign({}, process.env, {
      PATH: path.join(fixturePrefix, 'bin'),
      TMPDIR: tmpDir,
      TEMP: tmpDir,
      TMP: tmpDir
    }),
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error('探测子进程失败: ' + r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').at(-1).replace(/^RESULT:/, ''))
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'updck-fixture-'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'updck-status-'))
const NOW = new Date().toISOString()
try {
  makeFixture(fixture, '9.9.9-fixture')

  // 用例 A：版本相同 + 失败目标已达成 → 过滤（本修复的核心场景）
  let r = probe(fixture, tmp, { '9.9.9-fixture': {}, '9.9.8-fixture': {} }, {
    success: false, mode: 'update', targetVersion: '9.9.9-fixture',
    error: 'spawnSync /usr/bin/node-22 ENOENT', finishedAt: NOW, id: 'upd-a'
  })
  check('A 版本一致时 hasUpdate=false', r.hasUpdate, false)
  check('A 目标已达成的失败记录被过滤', r.lastUpdaterResult, null)

  // 用例 B：失败目标未达成，且该目标仍是当前推荐最新（npm 上确实有更新）→ 保留提示
  r = probe(fixture, tmp, { '9.9.9-fixture': {}, '10.0.0-fixture': {} }, {
    success: false, mode: 'update', targetVersion: '10.0.0-fixture',
    error: 'boom', finishedAt: NOW, id: 'upd-b'
  })
  check('B 目标未达成且仍是推荐最新时保留', r.lastUpdaterResult && r.lastUpdaterResult.id, 'upd-b')

  // 用例 B2：目标已不在 registry（推荐最新已回退/撤销）→ 陈旧记录过滤，
  // 否则「再次安排更新」按钮实际会 no-op（perform-update 判 already-latest）。
  r = probe(fixture, tmp, { '9.9.9-fixture': {} }, {
    success: false, mode: 'update', targetVersion: '10.0.0-fixture',
    error: 'boom', finishedAt: NOW, id: 'upd-b2'
  })
  check('B2 目标已不可达的失败记录被过滤', r.lastUpdaterResult, null)

  // 用例 C：koffi 修复类失败记录（无 targetVersion）→ 保留
  r = probe(fixture, tmp, { '9.9.9-fixture': {} }, {
    success: false, mode: 'repair', error: 'boom', finishedAt: NOW, id: 'fix-c'
  })
  check('C repair 失败记录保留', r.lastUpdaterResult && r.lastUpdaterResult.id, 'fix-c')

  // 用例 D：成功记录 → 不过滤（客户端本就不展示成功记录）
  r = probe(fixture, tmp, { '9.9.9-fixture': {} }, {
    success: true, mode: 'update', targetVersion: '9.9.9-fixture',
    finishedAt: NOW, id: 'upd-d'
  })
  check('D 成功记录不受过滤影响', r.lastUpdaterResult && r.lastUpdaterResult.id, 'upd-d')

  // 用例 E：npm 出现更高版本 → hasUpdate=true（仍正常提示）
  r = probe(fixture, tmp, { '10.0.0-fixture': {}, '9.9.9-fixture': {} }, null)
  check('E 有更高版本时 hasUpdate=true', r.hasUpdate, true)
  check('E 取到的最新版本正确', r.latestVersion, '10.0.0-fixture')

  // 用例 F：本地比 npm 高（npm 回退/滞后）→ 不误报
  r = probe(fixture, tmp, { '9.9.8-fixture': {} }, null)
  check('F 本地更新时不误报 hasUpdate', r.hasUpdate, false)

  // 用例 G：更高核心的 alpha 存在，但 latest 标签是当前版本 → 不提示 alpha（v1.15.0）
  r = probe(fixture, tmp, {
    'dist-tags': { latest: '9.9.9-fixture', next: '9.9.9-fixture', alpha: '10.0.0-alpha.2' },
    versions: { '9.9.9-fixture': {}, '10.0.0-alpha.2': {} }
  }, null)
  check('G alpha 不被选为最新版本', r.latestVersion, '9.9.9-fixture')
  check('G 有更高核心 alpha 时 hasUpdate=false', r.hasUpdate, false)

  // 用例 H：历史上误选 alpha 的失败记录 + 当前已是推荐最新 → 过滤（陈旧记录）
  r = probe(fixture, tmp, {
    'dist-tags': { latest: '9.9.9-fixture' },
    versions: { '9.9.9-fixture': {}, '10.0.0-alpha.2': {} }
  }, {
    success: false, mode: 'update', targetVersion: '10.0.0-alpha.2',
    error: 'npm install 退出码 1', finishedAt: NOW, id: 'upd-h'
  })
  check('H 目标为 alpha 且当前已是推荐最新时过滤', r.lastUpdaterResult, null)

  // 用例 I：同样有 alpha 失败记录，但确有更新的推荐版 → 保留提示（仍需重试）
  r = probe(fixture, tmp, {
    'dist-tags': { latest: '9.9.10-fixture' },
    versions: { '9.9.9-fixture': {}, '9.9.10-fixture': {}, '10.0.0-alpha.2': {} }
  }, {
    success: false, mode: 'update', targetVersion: '10.0.0-alpha.2',
    error: 'npm install 退出码 1', finishedAt: NOW, id: 'upd-i'
  })
  check('I 存在更新推荐版时失败记录保留', r.lastUpdaterResult && r.lastUpdaterResult.id, 'upd-i')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failed === 0 ? 'OK updater-status-filter: 全部通过' : `FAIL updater-status-filter: ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
