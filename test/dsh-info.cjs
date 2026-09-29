// DSH 安装探测回归测试：模拟「node 与 dsh 安装根异位 + Unix lib/node_modules 布局」
// —— v1.14.0 修复的场景：node 为 /usr/bin/node-22（发行版命名）而 dsh 装在
// /usr/local/lib/node_modules，旧探测链（仅 execPath 同根 + require.resolve）两者
// 都够不着，返回 0.0.0。修复后经 PATH 上 dsh 启动器软链 realpath 向上找包根。
// CI 用法: node test/dsh-info.cjs
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PLUGIN_ROOT = path.join(__dirname, '..')
let failed = 0
function check(name, actual, expect) {
  const ok = actual === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expect)}）`}`)
}

// 构造最小 Unix 全局布局：prefix/bin/dsh（软链）→ prefix/lib/node_modules/@deepseek-ai/dsh
function makeFixture(prefix, version) {
  const pkgDir = path.join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
  fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), '// fake dsh entry\n')
  fs.symlinkSync(path.join(pkgDir, 'lib', 'bin.js'), path.join(prefix, 'bin', 'dsh'))
  return pkgDir
}

// 在受限 PATH 下起子进程探测（PATH 首位只放 fixture，确保命中的是假包而非真机安装）
function probe(fixturePrefix) {
  const script = `
    import(${JSON.stringify(require('url').pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'index.js')).href)})
      .then((m) => console.log(JSON.stringify(m.dshInfo())))
      .catch((e) => { console.error(e); process.exit(1) })
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: PLUGIN_ROOT,
    env: Object.assign({}, process.env, { PATH: path.join(fixturePrefix, 'bin') }),
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error('探测子进程失败: ' + r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').at(-1))
}

// 用例 1：bin/dsh 软链 + lib/node_modules 布局，node 异位（子进程 execPath 是真机 node）
const prefix1 = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-info-case1-'))
makeFixture(prefix1, '9.9.9-fixture')
const info1 = probe(prefix1)
check('用例1 命中 fixture 版本', info1.version, '9.9.9-fixture')
check('用例1 pkgDir', info1.pkgDir, path.join(prefix1, 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
check('用例1 globalRoot 推导（updater --prefix 依赖）', info1.globalRoot, path.join(prefix1, 'lib'))

// 用例 2：非 dsh 包同名入口不应误报——bin 下软链指向别的包
const prefix2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-info-case2-'))
{
  const other = path.join(prefix2, 'lib', 'node_modules', 'other-pkg')
  fs.mkdirSync(path.join(other, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(prefix2, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ name: 'other-pkg', version: '1.0.0' }))
  fs.writeFileSync(path.join(other, 'lib', 'bin.js'), '// not dsh\n')
  fs.symlinkSync(path.join(other, 'lib', 'bin.js'), path.join(prefix2, 'bin', 'dsh'))
}
const info2 = probe(prefix2)
// PATH 上的假包被正确拒绝后，插件会按设计走 /usr/local/bin 等兜底路径——
// 可能命中真机安装，但绝不能误报 other-pkg 的版本
check('用例2 非 dsh 包不误报', info2.version === '1.0.0', false)

// 清理
for (const dir of [prefix1, prefix2]) fs.rmSync(dir, { recursive: true, force: true })

console.log(failed === 0 ? 'OK dsh-info: 全部通过' : `FAIL dsh-info: ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
