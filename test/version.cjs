// 版本比较回归测试：验证 semver 预发布排序（alpha < beta < rc < 正式版）、
// 从真实 npm 发布集合中取到的最高版本必须是 RC 而非 Alpha，以及 v1.15.0 的
// 发布通道选版（alpha 实验通道永不作为更新目标）。
// CI 用法: node test/version.cjs
'use strict'

async function main() {
  // lib/index.js 只 import node 内置模块 + require 无副作用的 launcher.cjs，
  // 动态 import 不会触发插件 apply/网络请求，可安全复用其导出的比较器。
  const { compareVersions, pickMax, pickLatestVersion } = await import('../lib/index.js')

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

  // v1.15.0 发布通道回归：alpha 实验通道永不作为更新目标。真实 2026-11 快照：
  // latest/next = 0.2.1-rc.5，alpha = 0.2.2-alpha.2——后者的核心版本更高，纯
  // semver 比较会选中它，但它是实验通道且 engines.node >=24.9（旧实现即因此把
  // 用户引向 alpha，并触发了一次失败的自动更新）。
  const channelCases = [
    ['忽略更高核心的 alpha（dist-tags 参与）',
      { 'dist-tags': { latest: '0.2.1-rc.5', next: '0.2.1-rc.5', alpha: '0.2.2-alpha.2' },
        versions: { '0.2.1-rc.4': {}, '0.2.1-rc.5': {}, '0.2.2-alpha.2': {} } },
      '0.2.1-rc.5'],
    ['无 dist-tags 时排除 alpha 取最高非 alpha',
      { versions: { '0.2.1-rc.4': {}, '0.2.1-rc.5': {}, '0.2.2-alpha.2': {} } },
      '0.2.1-rc.5'],
    ['latest 标签滞后时采用 next 上更新的 rc',
      { 'dist-tags': { latest: '0.2.1-rc.5', next: '0.2.1-rc.6' },
        versions: { '0.2.1-rc.5': {}, '0.2.1-rc.6': {} } },
      '0.2.1-rc.6'],
    ['未打标签的更新 rc 作为兜底',
      { 'dist-tags': { latest: '0.2.1-rc.5' },
        versions: { '0.2.1-rc.5': {}, '0.2.1-rc.7': {} } },
      '0.2.1-rc.7'],
    ['只有更新核心的 alpha 时保持推荐版',
      { 'dist-tags': { latest: '0.2.1-rc.5' },
        versions: { '0.2.1-rc.5': {}, '0.3.0-alpha.1': {} } },
      '0.2.1-rc.5'],
    ['alpha 判定大小写不敏感（ALPHA.2）',
      { versions: { '0.2.1-rc.5': {}, '0.3.0-ALPHA.2': {} } },
      '0.2.1-rc.5'],
    ['非点分的 alpha 标识符也排除（alpha1）',
      { versions: { '0.2.1-rc.5': {}, '0.3.0-alpha1': {} } },
      '0.2.1-rc.5'],
    ['标签指向 versions 中不存在的版本时不采用',
      { 'dist-tags': { latest: '9.9.9-absent' }, versions: { '0.2.1-rc.5': {} } },
      '0.2.1-rc.5'],
    ['空 packument 返回 null', {}, null]
  ]
  for (const [label, packument, expect] of channelCases) {
    const got = pickLatestVersion(packument)
    const ok = got === expect
    console.log((ok ? 'PASS' : 'FAIL') + '  pickLatestVersion(' + label + ') = ' +
      JSON.stringify(got) + ' (期望 ' + JSON.stringify(expect) + ')')
    if (!ok) failed++
  }

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