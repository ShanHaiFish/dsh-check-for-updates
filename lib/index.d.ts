// Type declaration for the static bundle plugin host.
// Runtime shape mirrors @deepseek-ai/dsh-tool-cordis: named exports only, no default.
import type { Context } from '@deepseek-ai/cordis'

export declare const name: 'dsh-check-for-updates'
export declare const inject: ['webServer']

// v1.15.1 插件配置（profile patch 中按 id 覆盖配置）
export interface PluginConfig {
  /** 总开关；false 时宿主拒绝除 get-plugin-config 外的所有方法 */
  enabled: boolean
  /** auto：检测到 DSH Desktop 内置更新时自动让位；always：始终使用本插件 */
  desktopMode: 'auto' | 'always'
}

/** Cordis 4 Standard Schema 形态的配置校验器（不依赖 zod） */
export declare const Config: {
  '~standard': {
    version: 1
    vendor: 'dsh-check-for-updates'
    validate(value: unknown): { value: PluginConfig } | { issues: Array<{ message: string; path?: PropertyKey[] }> }
  }
}

export declare function apply(ctx: Context, config?: PluginConfig): void

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
  /** v1.15.0：单飞锁文件路径（updater 完成/退出时删除） */
  lockFile?: string
  dryRun?: boolean
  waitParentMs?: number
  installTimeoutMs?: number
}

/** 校验 koffi 主包/平台包声明版本与原生二进制内嵌版本是否一致（只读，无副作用） */
export declare function checkKoffiIntegrity(): KoffiIntegrity

/** 读取 lib/updater.cjs 模板并注入任务配置，生成可独立运行的更新器脚本 */
export declare function buildUpdaterScript(cfg: UpdaterConfig): string

// v1.13.3 导出：语义化版本比较器（semver §11，供 test/version.cjs 回归测试使用）
/** 比较两个 semver 版本：>0 表示 a>b, <0 表示 a<b, 0 表示相等（预发布按 alpha < beta < rc 排序） */
export declare function compareVersions(a: string, b: string): number

/** 从 packument versions 键集合中取最高版本 */
export declare function pickMax(versions: Record<string, unknown>): string | null

// v1.15.0 导出：发布通道感知的最新版本选择（供 test/version.cjs 回归测试使用）
/** packument：省略或缺失时按非 alpha 最高版本兜底；alpha 预发布永不作为更新目标 */
export declare function pickLatestVersion(packument: unknown): string | null

// v1.15.0 导出：更新器单飞锁（供 test/updater-lock.cjs 回归测试使用）
/** 单飞锁文件绝对路径（系统临时目录） */
export declare function updaterLockPath(): string

export interface UpdaterLockHolder {
  id?: string
  mode?: 'update' | 'repair'
  parentPid?: number
  targetVersion?: string | null
  createdAt?: string
}

export type UpdaterLockResult =
  | { ok: true; lockPath: string }
  | { ok: false; busy?: boolean; holder?: UpdaterLockHolder; error: string }

/** 以 O_EXCL 抢锁；已存在且非陈旧时返回 {ok:false, busy:true} */
export declare function acquireUpdaterLock(info: UpdaterLockHolder): UpdaterLockResult

/** 释放单飞锁（不存在视为成功） */
export declare function releaseUpdaterLock(lockPath: string): void
