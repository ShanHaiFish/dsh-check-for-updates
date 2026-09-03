// 版本比较回归测试：验证 semver 预发布排序（alpha < beta < rc < 正式版），
// 以及从真实 npm 发布集合中取到的最高版本必须是 RC 而非 Alpha。
// CI 用法: node test/version.cjs
'use strict'

async function main() {
  // lib/index.js 只 import node 内置模块 + require 无副作用的 launcher.cjs，
  // 动态 import 不会触发插件 apply/网络请求，可安全复用其导出的比较器。
  const { compareVersions, pickMax } = await import('../lib/index.js')

  // 逐条回归：比较结果符号符合期望（常见 bug 是把 rc.1 与 alpha.5 的数字后缀比大小）
  const cases = [
    // 回归根因：RC 必须高于任何 alpha（旧实现 rc.1→1 < alpha.5→5，误判）
    ['0.1.2-rc.1', '0.1.2-alpha.5', 1],
    ['0.1.2-alpha.5', '0.1.2-rc.1', -1],
    // 同位置数字按数值比较
    ['0.1.2-alpha.5', '0.1.2-alpha.4', 1],
    ['0.1.2-alpha.4', '0.1.2-alpha.5', -1],
    // 核心版本优先；正式版 > 预发布
    ['0.1.2-rc.1', '0.1.1-rc.2', 1],
    ['1.2.0', '1.2.0-rc.1', 1],
    ['1.2.0-rc.1', '1.2.0', -1],
    // semver §11：前缀相同，标识符更多者更高；数字标识符 < 字母数字标识符；ASCII 字典序
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-alpha.beta', '1.0.0-beta', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-beta.11', '1.0.0-rc.1', -1],
    // 相等与 build 元数据
    ['0.1.2-rc.1', '0.1.2-rc.1', 0],
    ['0.1.2-rc.1+build.7', '0.1.2-rc.1', 0]
  ]

  let failed = 0
  for (const [a, b, expect] of cases) {
    const got = compareVersions(a, b)
    const ok = (expect === 0 && got === 0) || (expect > 0 && got > 0) || (expect < 0 && got < 0)
    console.log((ok ? 'PASS' : 'FAIL') + '  compare(' + a + ', ' + b + ') = ' + got + ' (期望符号 ' + expect + ')')
    if (!ok) failed++
  }

  // 真实 npm 发布集合（registry.npmjs.org/@deepseek-ai/dsh versions，2026-09 快照）：
  // 最高版本必须是 0.1.2-rc.1，而不是 0.1.2-alpha.5
  const versions = {
    '0.0.1-rc.1': true, '0.0.1-rc.2': true, '0.0.1-rc.5': true,
    '0.1.0-rc.2': true, '0.1.0-rc.3': true, '0.1.0-rc.6': true,
    '0.1.0-rc.7': true, '0.1.0-rc.8': true,
    '0.1.1-rc.1': true, '0.1.1-rc.2': true,
    '0.1.2-alpha.2': true, '0.1.2-alpha.3': true, '0.1.2-alpha.4': true,
    '0.1.2-alpha.5': true, '0.1.2-rc.1': true
  }
  const best = pickMax(versions)
  const bestOk = best === '0.1.2-rc.1'
  console.log((bestOk ? 'PASS' : 'FAIL') + '  pickMax(真实发布集合) = ' + best + ' (期望 0.1.2-rc.1)')
  if (!bestOk) failed++

  if (failed) {
    console.error('FAILED: ' + failed + ' 项未通过')
    process.exit(1)
  }
  console.log('OK version: 全部通过')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e))
  process.exit(1)
})