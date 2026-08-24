// Type declaration for the static bundle plugin host.
// Runtime shape mirrors @deepseek-ai/dsh-tool-cordis: named exports only, no default.
import type { Context } from '@deepseek-ai/cordis'

export declare const name: 'dsh-check-for-updates'
export declare const inject: ['webServer']
export declare function apply(ctx: Context): void

// v1.13.0 诊断导出（也用于更新器脚本生成）
export interface KoffiIntegrity {
  /** 是否实际执行了校验（未找到 DSH/koffi 安装时为 false，不视为损坏） */
  checked: boolean
  /** koffi 包声明版本与原生二进制内嵌版本是否一致 */
  ok: boolean
  koffiVersion?: string
  platformVersion?: string
  binaryPath?: string
  note?: string
}

export interface UpdaterConfig {
  id: string
  mode: 'update' | 'repair'
  targetVersion?: string
  globalRoot: string
  dshPkgJson: string
  parentPid: number
  nodeExe: string
  npmCli: string
  statusFile: string
  createdAt: string
  dryRun?: boolean
  waitParentMs?: number
  installTimeoutMs?: number
}

/** 校验 koffi 主包/平台包声明版本与原生二进制内嵌版本是否一致（只读，无副作用） */
export declare function checkKoffiIntegrity(): KoffiIntegrity

/** 读取 lib/updater.cjs 模板并注入任务配置，生成可独立运行的更新器脚本 */
export declare function buildUpdaterScript(cfg: UpdaterConfig): string
