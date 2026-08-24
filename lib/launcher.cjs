// DSH 更新检查插件辅助模块 v1.13.0：以 detached 方式启动分离式更新器进程。
// 独立成模块是为了让宿主入口 lib/index.js 不直接触碰子进程 API：
// 更新器脚本路径全部来自宿主生成的一次性任务目录（mkdtemp 随机目录 +
// 固定脚本名 updater.cjs），本模块仍按“可执行文件 + 字符串参数数组”的
// 最小接口做防御性校验，杜绝任何 shell 字符串拼接。
'use strict'
const cp = require('child_process')

function spawnChild(file, args, opts) {
  return cp.spawn(file, args, opts)
}

// detached + unref：子进程完全脱离 dsh 进程生命周期（dsh 退出/被杀都不受
// 牵连）；windowsHide 避免在 Windows 上弹出控制台窗口。
function launchDetached(file, args) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('可执行文件路径非法')
  if (!Array.isArray(args)) throw new Error('参数必须是数组')
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0) throw new Error('存在非法参数')
  }
  const child = spawnChild(file, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child
}

module.exports = { launchDetached }
