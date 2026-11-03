# 适配评估：dsh-check-for-updates v1.14.x × DSH 0.2.1-rc.5

> 评估日期：2026-11-03 · 评估对象：本仓库工作区（评估时 v1.14.1 未提交）/ npm 已发布 v1.14.0
> 目标运行时：本机已安装 DSH `0.2.1-rc.5`（npm `latest`/`next` 标签；`alpha` = `0.2.2-alpha.2`）
> 本次评估只读：除本文件外未改动任何代码；未重启/未发布任何东西。
> 评估后已实施 v1.15.0（见 §七/§八），本文 §一～§五 保留评估当时的判断。

## 一、结论（TL;DR）

| 维度 | 结论 |
| --- | --- |
| 宿主 API 兼容性 | ✅ **兼容，无需改代码**。peer 校验、bundle 装载、`ctx.inject/effect`、`webServer.register({kind:'exact'})` 全部在 0.2.1-rc.5 实测通过 |
| 客户端兼容性 | ✅ **兼容，无需改代码**。`__ModuleLoader__`、seed `require('react')`、`settings.general.item` 注册、10 个主题 token（亮/暗）均有效；实测设置项 occupant `update-checker` 已激活 |
| 版本探测/更新根 | ✅ **v1.14.1 修复正确**。`dshInfo` = `0.2.1-rc.5`、`globalRoot = /usr/local`（= `npm prefix -g`）；koffi 3.1.1 一致 |
| 更新目标选择 | ❌ **需要改**：取“全量最高版本”会选中 alpha `0.2.2-alpha.2`（≠ `latest` 标签），当前实例已实际提示该更新；该版本要求 Node ≥ 24.9（本机 22.23.1） |
| 更新器可靠性 | ⚠️ **需要加固**：2026-11-02 一次真实更新失败（npm reify ENOENT），现场留下 3 个 updater 任务目录，其中两次执行时间重叠 → 重复调度/并发安装风险 |
| 发布与文档 | ⚠️ **需要同步**：v1.14.1 未提交、未发布（npm 仍是 1.14.0，Linux 用户仍会踩 `EACCES /usr/local/lib/lib`）；README 版本历史仍停在 v1.14.0 / 0.2.0 |

**判断：API 层不需要“适配 0.2.1”，但插件确实需要一次同步完善。** 真实问题是 DSH 发布通道变化（新增 alpha 预发布）撞上了插件“取 npm 绝对最高版本”的既有策略，叠加更新器并发防护与发布滞后。建议按下面 P0 → P2 推进，作为 **v1.15.0**（可先发 v1.14.1 止血）。

## 二、当前版本现状

| 位置 | 版本 / 状态 |
| --- | --- |
| git HEAD | `97ea05e` v1.14.0（2026-09-29） |
| 工作区 | **v1.15.0 未提交**（含 v1.14.1 Linux `--prefix` 修复 + 通道选版/单飞锁/路由加固，见 §七） |
| npm registry | `dsh-check-for-updates@1.14.0`（latest），无 1.14.1 / 1.15.0 |
| profile `web` | `link:/home/onemind/github/dsh-check-for-updates` → GUI 客户端每次加载工作区最新代码；运行中进程的宿主半仍是启动时版本 |
| 已装 DSH | `@deepseek-ai/dsh@0.2.1-rc.5`（`latest`=`next`），另有 `alpha` = `0.2.2-alpha.2` |

关键含义：v1.14.1 的 Linux `--prefix` 修复目前**只对本机 link 生效**；从 npm 装插件的用户仍是 1.14.0，在 Linux 上点“安排更新”会继续复现 `EACCES: mkdir '/usr/local/lib/lib'`。

## 三、兼容性实测证据（0.2.1-rc.5）

### 1. 宿主半：兼容 ✅

- **peer 校验**：`dsh-app-boot/lib/index.js:276-277` 用 `semver.satisfies(runtime, range, { includePrerelease: true })`；直接调用已安装的 `evaluatePluginCompatibility(package.json)` 对 0.2.1-rc.5 返回 `undefined`（= 通过）。注意默认 semver 语义下 `satisfies("0.2.1-rc.5","^0.2.0-rc.1") = false`（prerelease 同元组规则），但 DSH 显式开了 `includePrerelease`，所以**当前不会拒载**。`0.3.0-rc.1` 会被拒载（实测），届时需同步放宽 peer 范围。
- **bundle 装载**：`Config.listConfigs` 中 `status: "absent"` 的语义是“fiber 已激活但无 Config schema”（`dsh-tool-cordis/lib/types/config.js:4-17`），不是未加载。
- **host 契约**：`POST /dsh-update-check/api {"method":"get-current-version"}` 实际返回 `200 {"version":"0.2.1-rc.5"}`，`GET` 返回插件自己的 405 → `apply()` 已执行、路由已注册。
- **探测/更新根**：`dshInfo` = `{version:"0.2.1-rc.5", pkgDir:"/usr/local/lib/node_modules/@deepseek-ai/dsh", globalRoot:"/usr/local"}`；`npm prefix -g` = `/usr/local`；koffi `3.1.1/3.1.1` 一致。
- **回归测试**：评估时 CI 全部 6 步通过；实施 v1.15.0 后为 7 项回归测试（`smoke` / `interactive` / `version` / `dsh-info` / `updater-status-filter` / `updater-lock` / `route-guard`）全部通过。

### 2. 客户端半：兼容 ✅

- `window.__ModuleLoader__.load({id, factory})` 契约一致（`dsh-client-modules/lib/index.js:460-476`）；`id` 必须等于包名，插件满足。
- `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime` 已停止发布（npm `latest` 0.0.1-rc.1 / `next` 0.1.1-rc.2），0.2.1 对不存在条目**软跳过**（`dsh-client-modules/lib/client.js:789-792`），不影响加载。v1.15.0 实测复核后**决定保留**该条目以维持 README 声明的 0.1.x 兼容（该字段仅作加载元数据，0.2.x 软跳过无副作用）。
- 设置项实测：`settings.general.item` 槽位 occupants 含 `{registrant:"dsh-check-for-updates", id:"update-checker", order:30, active:true}`；该行 owner props 为空，插件无需改注册形态。
- 主题 token：插件用到的 10 个 `--dsw-alias-*` 在 0.2.1 基础调色板（亮/暗）中均有定义（`dsh-client-ui-theme/lib/client.js:1413`），包括 `button-primary-fill` 与 `label-primary-foreground`；0.2.1 的新增 token 也可正常级联。

## 四、需要“同步完善”的问题

### P0-1 更新目标选择过时（版本通道错位）

实测（本机 live API 与直接调用一致）：

```
current: 0.2.1-rc.5   latest(插件): 0.2.2-alpha.2   hasUpdate: true
npm dist-tags: latest = 0.2.1-rc.5    next = 0.2.1-rc.5    alpha = 0.2.2-alpha.2
```

原因：`lib/index.js` 的 `pickMax()` 取 packument 全部 versions 的 semver 最大者，跨过了发布通道。后果：

- 0.2.1-rc.5 已是最新推荐版，但 UI 持续提示“有新版本可用 0.2.2-alpha.2”；
- `0.2.2-alpha.2` 的 `engines.node = >=24.9.0`，而本机 Node 22.23.1；npm 只警告 `EBADENGINE` 仍会安装，属于把用户带到一个未经验证的 alpha + 不满足引擎要求的版本；
- 2026-11-02 的真实更新尝试正是冲 `0.2.2-alpha.2` 去的（见 P0-2）。

建议：改为**通道感知**。最小改动是 `pickMax` 时排除 `-alpha.*` 预发布（保留稳定/beta/rc），或直接以 `dist-tags.latest`（可选叠加 `next`）为候选集，fallback 才用“排除 alpha 后的最高版本”；并补回归用例：`{0.2.1-rc.5, 0.2.2-alpha.2}` → 期望 `0.2.1-rc.5`。

### P0-2 更新器重复调度 / 并发安装风险

现场取证（`/tmp`）：

```
/tmp/dsh-updater-FWDc84   2026-11-02 20:41:47   （先失败一次）
/tmp/dsh-updater-238Q5P   2026-11-02 20:46:03   ┐ 两次执行时间重叠
/tmp/dsh-updater-KMJXCt   2026-11-02 20:46:49   ┘
/tmp/dsh-updater-last-status.json  targetVersion=0.2.2-alpha.2, success=false,
  diskVersion=0.2.1-rc.2, install.code=1（logTail 结尾：
  npm error syscall chdir  .../@aws-sdk/middleware-websocket ENOENT
  以及大量 TAR_ENTRY_ERROR ENOENT lstat .../dsh-client-ui-sidebar-documentpreview/lib）
```

对照实验（隔离 prefix，不碰真实安装）：同参数 `npm install -g --prefix ... @deepseek-ai/dsh@0.2.1-rc.2 → rc.5 → 0.2.2-alpha.2` **单线程连续三次全部成功**（13s/14s，退出码 0）。说明：v1.14.1 的 `--prefix` 修复正确；11-02 的失败更像**同一 prefix 上多个 updater/npm 并发 reify** 导致的相互踩踏（推断，非 100% 复现）。

现状：`scheduleUpdater()` 没有任何“已有任务在排队/执行”的去重；`scheduleUpdater` 只等 `parentPid` 退出 + 3s 宽限，多个任务会同时开跑。触发面很大：弹卡与设置项两个入口、多个标签页（各页 `sessionStorage` 独立）、用户连点。

建议：宿主侧加单飞锁（如 `/tmp/dsh-updater.lock` 或状态文件含 `running`/`pid/parentPid` + 有效期），已有 update 任务时返回“已安排，请等待”而不是再建一个；updater 侧在 npm 安装前加互斥（lock/`flock`）并为并发场景给出可读错误；另外把 7KB 的 `logTail` 在 UI 上截断/摘要。

### P0-3 失败记录残留导致持续误报

`readLastUpdaterResult()` 只按“当前版本 ≥ 当次目标版本”过滤；本次目标 `0.2.2-alpha.2` 永远达不到（当前 0.2.1-rc.5 < alpha），于是即使 DSH 已回到最新推荐版，每次打开仍弹“上次自动更新未成功 / 可重新安排更新”。

建议：配合 P0-1，把 `latestVersion` 传入过滤逻辑——`currentVersion >= latestVersion` 时清除 update 类失败记录；或直接忽略“目标不在当前推荐通道”的历史记录。

### P1-1 v1.14.1 未提交 / 未发布（Linux 修复未送达用户）

Linux/npm 全局（`/usr/local`）用户点更新会 `EACCES mkdir '/usr/local/lib/lib'`（旧 `deriveGlobalRoot` 少算一级 `lib`）。工作区已修且测试通过，但 npm 仍是 1.14.0。建议：提交 v1.14.1 → README 版本历史补一条 → tag `v1.14.1` 走 `release.yaml` 自动测试+发布。

### P1-2 peer 范围与文档小幅落后

- peer 当前 `^0.2.0-rc.1` 因 DSH 的 `includePrerelease:true` 覆盖 0.2.1-rc.5，安全；但可选加固为 `^0.2.0-rc.1 || ^0.2.1-rc.1`，让默认 semver 语义也成立；0.3.x 发布前必须再放宽（0.3.0-rc.1 实测会被拒载）。
- README/`lib/index.js` 头注释仍写 v1.14.0 / “目标运行时 0.2.0-rc.1”，建议同步到 0.2.1-rc.5 与 v1.14.1/v1.15.0 历史。

### P2 清理与加固（不阻塞，可并入下一版）

1. `dsh.client.inject` 删除已停止发布的 `@deepseek-ai/dsh-client-runtime`（保留 connection/modules 或直接空列表即可，客户端只 `require('react')`）。
2. 仓库根 `host.js` / `client.js` 是 v1.10.x/v1.12 动态插件遗留：未随 npm 包发布（`files` 不含），但仍在版本库且易误导贡献者 → 移到 `docs/legacy/` 或删除。
3. `/dsh-update-check/api` 是未鉴权的 exact 路由：0.2.1 的 launch-token / Host-Origin 围栏只保护 Connection-owned 的 `/api` 前缀，插件路由可被跨站“simple POST”触发安排更新/修复 → 建议要求 `content-type: application/json` + 同源校验（或改走 connection 的 fetch 注册）。
4. 浮卡 `z-index:10000` 高于 0.2.1 shell 浮层体系（最高约 1100），会盖住设置弹窗/菜单；且卡片无 `ctx.effect` 清理，HMR/禁用插件后残留。建议改挂 `shell.overlay` 槽位或降到 1000 以下 + 卸载清理。
5. 设置行文案硬编码中文，未接 0.2.1 的 locale；英文 UI 下显示中文。

## 五、建议的版本化落地顺序

1. **v1.14.1（止血，1 个提交）**：P1-1 现有 Linux 修复提交 + README 历史 + tag 发布。
2. **v1.15.0（适配完善）**：P0-1 通道感知版本选择 + P0-3 失败记录过滤 + P0-2 单飞锁 + 测试用例 + P1-2 peer/文档；P2-1/2 顺手清理。
3. **后续**：0.3.x 发布前复核 peer 范围；按需做 P2-3/4/5。

> 实施时的选择：v1.14.1 从未发布，直接并入 **v1.15.0** 单次发布，避免两次发布链路；
> 0.1.x 客户端兼容优先级高于“清理元数据”，`dsh-client-runtime` inject 条目保留。
> 详见 §七/§八。

## 六、复现命令（只读）

```sh
# 版本现状
git -C /home/onemind/github/dsh-check-for-updates log --oneline -1 && git -C ... status --short
npm view @deepseek-ai/dsh dist-tags
npm view dsh-check-for-updates version

# 插件当前上报（等价于 GUI 弹卡的判断）
node --input-type=module -e "import('/home/onemind/github/dsh-check-for-updates/lib/index.js').then(async m=>console.log(await m.checkForUpdates()))"
curl -s -X POST http://127.0.0.1:3080/dsh-update-check/api -H 'content-type: application/json' -d '{"method":"check-for-updates"}'

# DSH 兼容校验语义
grep -n "includePrerelease" /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js
```

## 七、实施状态（2026-11-03，v1.15.0 工作区）

评估后已按 P0 → P1 实施（未提交、未发布；npm 仍为 1.14.0）：

| 项 | 状态 | 改动位置 |
| --- | --- | --- |
| P0-1 通道感知选版（latest/next，排除 alpha） | ✅ 已实现 | `lib/index.js` `pickLatestVersion()`（alpha 大小写不敏感、标签需存在于 versions）+ `test/version.cjs` 9 个通道用例 |
| P0-2 更新器单飞锁 | ✅ 已实现 | `lib/index.js` `acquireUpdaterLock/releaseUpdaterLock`（O_EXCL、updaterPid 判活、不可解析锁 60s 宽限、陈旧阈值 60min）、`lib/updater.cjs` 校验任务 id 后删锁、`test/updater-lock.cjs` 15 项断言 |
| P0-3 陈旧失败记录过滤（当前 ≥ 推荐最新） | ✅ 已实现 | `lib/index.js` `readLastUpdaterResult(current, latest)` + `test/updater-status-filter.cjs` 用例 B2/H/I |
| P0-4 API 路由加固（JSON + 同源） | ✅ 已实现 | `lib/index.js` `isSameOrigin` + `test/route-guard.cjs` |
| P1-1 v1.14.1 Linux 修复并入 v1.15.0 | ✅ 已在工作区（`deriveGlobalRoot`），`test/dsh-info.cjs` 覆盖 |
| P1-2 peer 追加 `^0.2.1-rc.1`、README/版本历史/清单同步 | ✅ 已更新 | `package.json`、`README.md`、`lib/index.d.ts` |
| P2-1 `@deepseek-ai/dsh-client-runtime` inject | ✅ 保留（0.1.x 兼容；0.2.x 软跳过已验证） | `package.json` |
| P2-4 浮卡 z-index / 卸载清理 | ✅ 已实现 | `client/client.js`（900 + `ctx.effect` 清理，smoke 增加 disposer 断言） |
| P2-2 遗留 `host.js`/`client.js` 归档 | ⏳ 未做（保持现状，README 已标注遗留） |
| P2-5 设置项 i18n | ⏳ 未做（超出本次范围） |
| 发布（commit / tag v1.15.0 / npm publish） | ⏳ 待用户确认后执行（需 `NPM_TOKEN`，不可逆） |

实现后实测（工作区、DSH 0.2.1-rc.5）：`checkForUpdates` → `current=0.2.1-rc.5,
latest=0.2.1-rc.5, hasUpdate=false, lastUpdaterResult=null`；全部 7 项回归测试通过；
跨进程并发抢锁实验（5 进程）恰好 1 个成功、4 个 busy。运行中 GUI 的宿主半需重启 DSH
才会加载新路由加固（当前进程内仍是旧版本，`/dsh-update-check/api` 对 text/plain 与
跨源请求仍返回 200；客户端半会随页面刷新生效）。

## 八、独立复核与残留风险

独立评审（新上下文、只读）结论：**READY to commit/tag v1.15.0，无功能阻塞**。已按评审
建议加固：锁内 updaterPid 判活（updater 写状态前被强杀可立即重排）、不可解析锁 60s
宽限、陈旧阈值 60min、updater 删锁前校验任务 id、alpha 判定大小写不敏感、标签版本
校验、README 测试清单/npm 链接修正。剩余为已知、非阻塞的限制：

1. **DNS rebinding 残余风险（LOW-MEDIUM，未改）**：`isSameOrigin` 只比较 Origin 与
   Host，攻击者页面若让两者同为攻击者域名（DNS 重绑定到 127.0.0.1）仍可触发安排
   更新/修复。DSH 自身 `/api` 围栏更严格（额外要求 loopback/bind/trusted Host），但
   加 Host 白名单会破坏反向代理/自定义域名部署，故暂不收紧；影响面限于“安排更新/
   修复”这一副作用，无任意输入执行。
2. **0.1.x 客户端兼容未实机验证（LOW）**：`dsh-client-runtime` inject 为兼容 0.1.x
   保留；0.2.1-rc.5 下已验证软跳过不影响加载。
3. **锁的极端窗口**：updater 被 SIGKILL 且未记录 updaterPid（spawn 与记录之间）时，
   最多等父进程退出 + 60min 才可重排；已用 updaterPid/id 校验把常见路径覆盖。
4. 运行中 GUI 需重启 DSH 才加载宿主半新代码（客户端半刷新页面即可）。


## 九、v1.15.1：Desktop 让位与配置项

**背景核实**（2026-11-03，DSH 0.2.1-rc.5 与 0.2.2-alpha.2 抽查）：`dsh web`/CLI 形态
**没有**内置检查更新功能——CLI 无 update/upgrade 命令，安装包中无 DSH 自身 registry
自检；设置页的 current-version 行只渲染构建内嵌版本。唯一内置更新属于 **DSH Desktop**
（Electron 外壳）：`dsh-client-ui-settings-general` 通过 `globalThis.dshDesktop`
（`protocolVersion === 1`）的 preload 桥取得更新状态，并注明 “absent in ordinary
browsers”；浏览器/CLI 形态没有该桥。因此插件在 `dsh web` 下仍是唯一更新入口。

**v1.15.1 实现**：

1. 新增插件配置 `enabled`（默认 true）与 `desktopMode`（`auto`/`always`，默认 `auto`），
   Cordis 4 Standard Schema 校验；profile patch 按 id 覆盖，`--dump-config` 已验证配置
   进入组合树、`resolveConfig` 默认值/非法值行为正确（非法值抛 ValidationError）。
2. 宿主新增 `get-plugin-config`；`enabled:false` 时除该读取方法外全部拒绝。
3. 客户端启动读取配置：Desktop 桥存在且 `desktopMode=auto` → 不自动检查、不弹浮卡，
   设置项只显示让位说明；`always` 强制启用；`enabled:false` 显示禁用说明。判定逻辑
   与 settings-general 的 DesktopUpdateSource 一致。
4. 新增 `test/desktop-delegation.cjs`（15 断言：Config 校验、路由配置、enabled 拦截、
   Desktop auto/always 与 Browser auto/disabled 四态），接入 CI/发布前测试。

当前环境（`dsh web`，无 Desktop 桥）下 `auto` 与 `always` 行为一致；Desktop 场景由
上述回归测试覆盖（用 `globalThis.dshDesktop` 桩模拟）。
