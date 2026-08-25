# Bug 反馈：dsh-check-for-updates 设置项入口缺失（v1.13.0）

> 仓库：https://github.com/ShanHaiFish/dsh-check-for-updates
> 报告日期：2026-08-25
> 报告人：dsh 插件用户（经本地安装实测与源码比对）

---

## 1. Bug 概述

静态 bundle 形态的 **v1.13.0** 缺少 README 承诺的 **「设置 > 通用 · DSH 更新」设置项入口**（`settings.general.item` slot）。

- README（`README.md` 第 16 行 + `docs/screenshots/settings-entry.png`）明确承诺该入口存在，并展示截图。
- 但实际发布的 `client/client.js`（v1.13.0，npm 包与 GitHub main 一致）**从未注册** `settings.general.item`。
- 插件其余功能正常：host API 可调用、自动检查、更新弹卡、koffi 警告卡均工作。

**一句话**：README 声称有「设置 > 通用 · DSH 更新」入口，但 v1.13.0 客户端代码里没有这个入口。

---

## 2. 环境信息

| 项 | 值 |
|---|---|
| DSH 版本 | `0.1.1-rc.2` |
| 插件版本 | `1.13.0`（npm `latest` = 1.13.0） |
| 安装方式 | `dsh plugin --profile web add github:ShanHaiFish/dsh-check-for-updates` |
| 安装位置 | `~/.dsh/profiles/web/node_modules/dsh-check-for-updates/` |
| DSH 框架 slot | `settings.general.item` 真实存在（由 `dsh-client-ui-settings-general` 渲染 `renderSlot("settings.general.item", {})`） |
| 复现平台 | Windows，浏览器 Web GUI |

---

## 3. 复现步骤

1. 安装插件并重启 DSH：
   ```sh
   dsh plugin --profile web add github:ShanHaiFish/dsh-check-for-updates
   ```
2. 打开 DSH Web 界面，点击左下角 **设置（齿轮）→ 通用**。
3. 在「通用」设置页中查找「DSH 更新」区块。

**实际结果**：找不到「DSH 更新」入口。

**预期结果**（按 README 承诺）：出现「DSH 更新」区块，包含当前版本、最新版本、「检查更新」「测试网络」按钮，有新版本时提供【更新到 {版本}】按钮。

---

## 4. 证据链

### 4.1 代码层：v1.13.0 client 无设置项注册

| 文件 | 是否有 `settings.general.item` 注册 | 说明 |
|---|---|---|
| `client/client.js`（npm 1.13.0 tarball，已实测） | ❌ 无 | 只有自动检查 + DOM 弹卡 + `{ name, apply }` 导出 |
| `client/client.js`（GitHub main @ 1.13.0，已实测） | ❌ 无 | 同上，与 npm 包逻辑一致 |
| 根目录 `client.js`（**遗留动态形态 v1.12.0**） | ✅ 有 | 注册了 `settings.general.item` + `shell.overlay` |

安装版 v1.13.0 `client/client.js` 的关键结构（199 行）：

```js
// 只有这些功能，没有 settings.general.item 注册：
// - autoCheck() 首次打开自动检查
// - showCard() 更新弹卡
// - showDamageCard() koffi 断链/上次更新失败警告卡
// - 导出 { name: 'dsh-check-for-updates', apply }
function apply(ctx) {
  autoCheck()
  // 调试句柄挂 window
  if (!window.__dshUpdateChecker) { ... }
}
return { name: 'dsh-check-for-updates', apply }
```

### 4.2 Git 历史：设置项在静态 bundle 化时被遗漏

通过 GitHub commits API 比对：

| Commit | 日期 | 文件 | 设置项 |
|---|---|---|---|
| `f2fb0675` v1.12.0 | 2026-08-21 | 根目录 `client.js`（动态形态） | ✅ 有 `settings.general.item` |
| `896caaa6` 静态 bundle 化 | 2026-08-21 | 新建 `client/client.js` | ❌ **无**（只移植了弹窗/自动检查） |
| `2ea843e8` v1.13.0 | 2026-08-24 | 重写 `client/client.js` | ❌ **无**（修复导出形态 + 分离式更新器，未补回） |

**结论**：设置项在「静态 bundle 化」提交（`896caaa6`）重构客户端时被遗漏；v1.13.0（`2ea843e8`）重写时延续了该遗漏，且 README 未同步更新（或截图来自动态形态时代）。

### 4.3 运行层：插件加载正常，仅有设置项缺失

| 验证项 | 结果 |
|---|---|
| Boot manifest 包含插件 | ✅ `/plugins/dsh-check-for-updates/client.js?rev=...` 在清单中 |
| client.js HTTP 访问 | ✅ 200 |
| `load` id 与包名一致（金三角） | ✅ 均为 `dsh-check-for-updates` |
| host API `POST /dsh-update-check/api` | ✅ `check-for-updates`/`get-current-version`/`test-network`/`perform-update` 全部正常 |
| 设置页「DSH 更新」入口 | ❌ **缺失（本 Bug）** |

即：插件**加载正常**，不是安装问题；是**客户端代码没注册设置项**。

---

## 5. 影响

1. **用户无法在设置页手动检查更新**——只能依赖「首次打开页面自动检查」这一条路径，且自动检查只有在发现新版本时才弹卡；若自动检查失败（网络抖动等），没有任何手动重试入口。
2. **「测试网络」按钮缺失**——用户无法自助诊断网络/registry 连通性。
3. README（含截图）与实装行为不一致，误导用户。

> 注：由于上述入口缺失，「检查更新」/「测试网络」/「更新到」等 host API 能力完好但 UI 不可达。

---

## 6. 建议修复方案（供作者参考）

在 `client/client.js`（v1.13.0）中补回 `settings.general.item` 注册，样式沿用 v1.13.0 现有的 `tokens` 主题变量，并**对接 v1.13.0 的 host API 契约**（与 v1.12.0 不同）：

| Host 方法 | v1.13.0 返回契约 | 设置项 UI 用法 |
|---|---|---|
| `get-current-version` | `{ version }` | 挂载时显示当前版本 |
| `check-for-updates` | `{ currentVersion, latestVersion, hasUpdate, error, integrity, lastUpdaterResult }` | 「检查更新」按钮 |
| `test-network` | `{ success, message, statusCode, contentLength }` | 「测试网络」按钮 |
| `perform-update` | `{ updated, scheduled, installedVersion, needsRestart, message }` | 「更新到 {版本}」按钮（点击后为「安排更新」，显示"退出 DSH 后自动完成安装"） |

Key 实现要点：

1. client 已是 `window.__ModuleLoader__.load({ id, factory })` bundle 形态，可在 factory 内 `require('react')`（参考同仓库系 `dsh-plugin-security-review` 的 bundle client）。
2. `apply(ctx)` 内通过 `ctx.slots` 注册（需在导出对象声明 `inject: ['slots']`）：

```js
return { name: 'dsh-check-for-updates', inject: ['slots'], apply }
```

3. 注册代码示例（slot 名称与 v1.12.0 一致，保证插入「通用」设置页）：

```js
function apply(ctx) {
  autoCheck()
  if (!window.__dshUpdateChecker) { ... }
  const slots = ctx && (ctx.slots || (typeof ctx.get === 'function' && ctx.get('slots')))
  if (slots && typeof slots.inject === 'function') {
    slots.inject('settings.general.item', () => slots.register({
      name: 'settings.general.item',
      id: 'update-checker',
      order: 30
    }, UpdateSettingsItem))
  }
}
```

4. `UpdateSettingsItem` 为 React 组件：展示当前/最新版本、「检查更新」「测试网络」、「更新到 {版本}」（有更新时），全部通过 `fetch(API, { method: 'POST', body: JSON.stringify({ method }) })` 调 host。

5. 同步更新 README：若 v1.13.0 决定不再提供设置入口，应删除 README 第 16 行的截图②说明；若保留入口，则按上述补回代码。

---

## 7. 附：报告人已应用的本地补丁（临时 workaround）

由于该问题影响日常使用（无法手动检查更新），报告人已在本地安装副本打补丁，**未改动上游仓库**：

- 修复文件：`~/.dsh/profiles/web/node_modules/dsh-check-for-updates/client/client.js`
- 修复内容：补回 `settings.general.item` 设置项（`UpdateSettingsItem` React 组件），保留 v1.13.0 全部原生功能（自动检查、更新弹卡、koffi 警告卡、分离式更新安排）
- 修复后验证：
  - ✅ `node --check` 语法通过
  - ✅ boot manifest rev 哈希变化（`213dab29150d` → `7d5615f346d8`，浏览器自动失效缓存）
  - ✅ HTTP bundle 包含 `settings.general.item` + `UpdateSettingsItem`
  - ✅ host API 契约全部对齐 v1.13.0

> ⚠️ 该补丁为**本地修改**，`dsh plugin update` / 重装会被上游文件覆盖。建议上游合入正式修复并发布 `1.13.1`。

---

## 8. 补充观察（可选，供作者参考）

1. 根目录 `client.js`（动态形态 v1.12.0）与 `client/client.js`（静态 bundle v1.13.0）是**两套不同实现**，根目录文件已在 README 标注「遗留，不再维护」，建议未来在仓库中删除或加 `DEPRECATED` 说明，避免误读（报告人最初审查时即被根目录文件误导）。
2. README 截图 `docs/screenshots/settings-entry.png` 疑为动态形态时代的截图，与静态 bundle 当前行为不符，建议更新或注明版本。