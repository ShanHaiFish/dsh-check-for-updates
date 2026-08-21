// Type declaration for the static bundle plugin host.
// Runtime shape mirrors @deepseek-ai/dsh-tool-cordis: named exports only, no default.
import type { Context } from '@deepseek-ai/cordis'

export declare const name: 'dsh-check-for-updates'
export declare const inject: ['webServer']
export declare function apply(ctx: Context): void
