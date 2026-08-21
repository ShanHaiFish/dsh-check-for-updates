# DSH 更新检查插件

![GitHub Release](https://img.shields.io/github/v/release/ShanHaiFish/dsh-check-for-updates)
![License](https://img.shields.io/github/license/ShanHaiFish/dsh-check-for-updates)
![GitHub Stars](https://img.shields.io/github/stars/ShanHaiFish/dsh-check-for-updates)

一个用于检查 DSH (DeepSeek Harness) 更新的动态 Cordis 插件。

## 安装（静态 bundle，推荐）

本仓库同时提供两种形态：

| 形态 | 文件 | 是否自动加载 |
| --- | --- | --- |
| **静态 bundle（推荐）** | `package.json` + `cordis.patch.yml` + `lib/` + `client/` | 是，`dsh plugin add` 后随 profile 层栈自动加载 |
| 动态插件（回退） | `host.js` + `client.js` | 否，需每次重启后 `cordis_define`/`cordis_run` |

```sh
# 从 GitHub：
dsh plugin --profile web add github:ShanHaiFish/dsh-check-for-updates

# 本地开发用 file: 指向本仓库（注意路径不能含空格）：
dsh plugin --profile web add "file:/absolute/path/to/dsh-check-for-updates"
```

> Mac/Linux 上若路径含空格或非 ASCII（如本机 `...2026-DeepSeekHarness相关\...`），建议先
> 复制到无空格的路径再 `file:` 安装。

**无硬编码路径**：bundle 版 host（`lib/index.js`）在运行时通过 `require.resolve('@deepseek-ai/dsh/package.json')`
与 `process.execPath` 探测 DSH 安装根/版本与 node/npm-cli，不写死任何本机路径，跨机器可用。
（动态回退形态 `host.js` 为受限沙箱、无法运行时探测，保留一个 documented 的默认安装根常量。）

**客户端**：bundle 版在左下部「设置」上方浮动弹窗（首次打开自动检查 + 【更新到】/【稍后】），
通过 `POST /dsh-update-check/api` 调用 host；「设置 > 通用」内的入口仅在动态形态提供。

## 功能特性

- ✅ 在设置 > 通用 中显示"DSH 更新"设置项
- ✅ 显示当前版本和最新版本信息
- ✅ 支持手动点击"检查更新"按钮
- ✅ 首次打开 Web 页面时自动触发一次更新检查
- ✅ 发现新版本时，在左下部"设置"按钮上方弹窗提示，并提供【更新到 {版本}】按钮
- ✅ 弹窗支持【稍后】关闭，同版本不再重复弹出
- ✅ 添加"测试网络"按钮用于调试

## 文件结构

- `host.js` - 主机端代码，负责从 npm registry 获取版本信息
- `client.js` - 客户端代码，负责在设置中显示更新状态和弹窗提示

## 版本历史

### v1.12.0 (当前版本)

**修改内容**：
1. **首次打开自动检查更新**（客户端）：页面加载时自动触发一次 `check-for-updates`（模块级
   `autoStarted` 标志保证每页只检查一次，不随 HMR 重复）；自动检查失败不打扰用户。
2. **设置按钮上方弹窗**（客户端）：检测到新版本且本会话未「稍后」过该版本时，在左下部「设置」
   按钮上方（`shell.overlay` 帧级浮动层，`fixed` 定位）弹出提示卡片，显示「有新版本可用」
   「当前→最新版本」，并提供【更新到 {版本}】主按钮与【稍后】次级按钮。
   - 点【更新到 {版本}】→ 复用 Host 的 `perform-update` 做精确版本安装 + 安装后对盘校验，
     成功/失败均在弹窗内反馈；成功后自动关闭弹窗。
   - 点【稍后】→ 该版本号记入 `sessionStorage`（`dsh-updck-dismissed-version`），同版本不再弹出；
     出现更新版本则重新弹出。
3. **状态订阅改多监听器**（客户端）：`updateState.onUpdate` 单值回调改为 `listeners: Set`，
   让「设置项」与「弹窗」两个组件同时实时刷新、互不覆盖。
4. **fetch 提供方 id 唯一化**（主机端 v1.10.1）：每次激活用唯一 id 注册 `updck-curl-*`，
   避免与先前面动态包已注册的 `updck-curl` 冲突导致 Host 启动失败；若已有可用提供方则跳过注册。
5. 弹窗配色沿用 `--dsw-alias-*` 语义化主题 token（带兜底），随亮/暗色与第三方主题自动适配。

**说明**：新增/改动均在既有 RPC（`check-for-updates` / `perform-update` / `get-current-version` /
`test-network`）之上完成，无需协议变更。

### v1.11.0

**修改内容**：
1. **主题适配**：客户端 UI 不再使用硬编码颜色（`#007bff`/`#28a745`/`#dc3545` 等），
   全部改用 DSH 语义化主题 token `--dsw-alias-*`：
   - 主按钮（更新）：`var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))`，
     文字 `var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-1))`
   - 成功/有新版本：`state-success-primary`；错误：`state-error-primary`；更新中：`state-warn-primary`
   - 边框 `border-l1/l2`；表面 `bg-layer-*`/`bg-module-platform`；文字 `label-primary/secondary/tertiary`
2. 对不确定存在的 token 使用 `var(--a, fallback)` 兜底，保证任意主题（含用户安装的主题插件、
   亮/暗色）下与整体配色一致。
3. 主机端无改动（仍 v1.10.0）。

### v1.10.0

**修改内容**：
1. **新增【更新】按钮自动执行升级**（方案 B）：
   - 检测到新版本时，设置页出现蓝色【更新到 {版本}】按钮。
   - 点击后 Host 端 `perform-update` 用 **node + npm-cli.js**（不经 cmd shell）执行
     `npm install -g --prefix <真实全局根> @deepseek-ai/dsh@<精确版本>`。
   - **显式 `--prefix` 从运行中的 package.json 程序化推导真实全局根**，规避 `.npmrc`
     中 `prefix=/home/whaow/.npm-global` 被 npm 在 Windows 误解析成不存在的 `M:\...` 的坑。
   - **精确版本固定**（用已校验的 semver 最高版本），不用 `latest`/`next` 标签，消除歧义。
   - **前置守卫**：仅当 `compareVersions(目标, 当前) > 0` 才执行；已是最新则 no-op。
   - **安装后对盘校验**：再次读取本地 package.json，版本必须等于目标才算成功。
   - **超时保护**（180s）自动 `terminate`；失败给出 npm 输出尾部可排查。
   - 成功后提示「已更新到 X，请重启 DSH 生效」——**不自动重启**（进程内自杀式重启不稳定，
     会终止当前会话/GUI），由用户重启加载新版本。
2. 客户端新增：`updating` 状态、更新按钮、更新结果信息、可展开的「执行日志」。
3. 打开设置页依旧不触发任何网络/升级动作；无更新时不显示【更新】按钮。

**稳定性保证**：精确版本 + 显式程序化 --prefix + 前置守卫 + 安装后校验 + 超时/取消上界 + 不自动重启。

### v1.9.0

**修改内容**：
1. **只手动检查更新**：打开设置页**不再自动**发起网络检查；挂载时仅本地读取并显示「当前版本」，只有点击「检查更新」才触发最新版本检查。
2. **注册 curl/subprocess fetch 提供方**（`updck-curl`）：本部署没有内置 fetch 提供方，`web.fetch` 原本永远报 `no usable web provider is registered`。插件用 `subprocess` 启动 `curl.exe` 抓取 npm registry，注册为 `WebFetchProvider`，让 `web.fetch` 真正可用。
3. **最新版本不再取 `/latest` 标签**：npm 的 `latest` 标签可能滞后（如仍指向 `0.1.0-rc.7`，而最新发布在 `next` 标签是 `0.1.0-rc.8`）。改为读取完整 packument `https://registry.npmjs.org/@deepseek-ai/dsh` 的 `versions`，用内置的小型 semver 比较器取**实际发布的最高版本**。
4. 保留 `web.search` 作为最后兜底。

**根因回顾**：
- `tool-web` 的 `fetch: true` 只注册模型侧 `web_fetch` 工具，**并不注册 fetch 后端**；fetch 后端必须由某插件调用 `web.registerFetchProvider` 注册——本部署没有，需插件自行提供。
- `/latest` 返回的是 `latest` dist-tag，可能滞后于 `next` 上的新 rc 版本。

**当前方案**：
- 当前版本：`fs.resolve/readText` 读取本地 `@deepseek-ai/dsh/package.json`
- 最新版本：curl 抓 npm packument → semver 取最高版本 → 失败降级 `web.search`

**注意事项**：
- 因为会 `spawn curl`（subprocess），安全审查判定为 BLOCK（120/300），需在插件安全白名单放行 `updck` 家族后运行。
- curl 不可用或 spawn 被拦截时，会降级 `web.search`（尽力而为）+ 显示错误提示。

### v1.7.0

**修改内容**：
1. 修复"当前版本: 0.0.0"问题 - 使用已验证的本地版本号 `0.1.0-rc.7`
2. 修复"无法获取最新版本信息"问题
3. 修改 `C:\Users\whaow\.dsh\profiles\web\cordis.patch.yml` 配置，启用 `fetch: true`（需要重启 dsh 生效）
4. 最新版本通过 `web.fetch` 请求 `https://registry.npmjs.org/@deepseek-ai/dsh/latest` 获取

**排查过程（已确认的根因）**：
- `web.fetch` 被 DSH 默认配置 `fetch: false` 禁用（`dsh-base/cordis.patch.yml`）
- `web.search` 返回的 snippet 全部为空，无法提取版本号
- 动态插件沙箱禁止 `require` 和 `globalThis.fetch`，只能使用 Cordis 服务
- 安全审查将"文件读取 + 网络访问"组合判定为数据外传路径（high），导致 ASK 审批

**当前方案**：
- 当前版本：写死为 `0.1.0-rc.7`（升级 DSH 后需手动更新此值）
- 最新版本：`web.fetch` 请求 npm registry

**注意事项**：
- ⚠️ 需要在 `cordis.patch.yml` 中启用 `fetch: true` 并**重启 DSH** 后，`web.fetch` 才可用
- 重启前点击"测试网络"会显示 web.fetch 不可用
- 升级 DSH 后，记得更新 `host.js` 中的 `CURRENT_VERSION` 常量

### v1.6.0

**修改内容**：
1. 修复 `no usable web provider is registered` 错误
2. 发现 DSH 配置中 `fetch: false`，web fetch 功能被禁用
3. 改用 `web.search()` 搜索 npm 包版本信息
4. 使用 `fs` 服务读取本地 `package.json` 获取当前版本
5. 从搜索结果中提取版本号

**根本原因**：
- DSH 默认配置 `fetch: false`，禁用了 web fetch 功能
- 动态插件无法使用 `require` 或 `globalThis.fetch`
- 必须使用 Cordis 服务（`ctx.web`, `ctx.fs`）

**解决方案**：
- 当前版本：使用 `fs.resolve()` + `fs.readText()` 读取本地 `@deepseek-ai/dsh/package.json`
- 最新版本：使用 `web.search()` 搜索 "@deepseek-ai/dsh npm version" 并提取版本号

**注意事项**：
- 搜索结果可能不准确，版本号提取依赖正则匹配
- 如果需要更准确的版本检测，需要在 DSH 配置中启用 `fetch: true`

### v1.4.0

**修改内容**：
1. 修复 `no usable web provider is registered` 错误
2. 移除对 `web` 和 `shell` 服务的硬依赖（`inject`）
3. 改用 `globalThis.fetch` 直接发起网络请求（Node.js 18+）
4. 简化代码结构，移除复杂的 provider 注册逻辑
5. 所有网络请求统一使用 `fetchUrl()` 封装函数

### v1.3.0

**修改内容**：
1. 修复 `getCurrentVersion()` 读取本地实际安装版本的 bug
2. 注入 `shell` 服务，通过 `node -e` 命令读取本地 `@deepseek-ai/dsh/package.json` 的版本
3. `getLatestVersion()` 继续从 npm registry 获取最新版本
4. 添加备用方案：本地读取失败时回退到 npm registry dist-tags
5. 修复版本比较逻辑（之前 current 和 latest 都从 npm 获取，永远相同）

### v1.2.0

**修改内容**：
1. 移除 `fs` 依赖，简化代码
2. 当前版本和最新版本都从 npm registry 获取
3. 增强错误处理和日志输出
4. 添加测试网络按钮用于调试

### v1.1.0

**修改内容**：
1. 增强 `web.fetch` 错误处理，添加详细日志
2. 添加获取本地 DSH 版本功能（使用 `ctx.fs`）
3. 添加备用方案：从 npm registry 获取当前版本
4. 添加测试网络按钮用于调试
5. 改进版本比较逻辑

### v1.0.0

**初始版本**：
- 设置项显示
- 手动检查更新
- 弹窗提示

## 使用方法

### 安装插件

1. 将 `host.js` 和 `client.js` 代码复制到 DSH 动态插件定义中
2. 使用 `cordis_define` 定义插件
3. 使用 `cordis_run` 运行插件

### 验证功能

1. 打开 DSH Web 界面
2. 进入 **设置 > 通用**
3. 找到 **DSH 更新** 设置项
4. 点击 **测试网络** 按钮验证网络连接
5. 点击 **检查更新** 按钮验证功能
6. 查看控制台日志获取详细信息

## 技术细节

### 主机端 (`host.js`)

- 注入 `web` 服务
- 使用 `web.fetch` 从 npm registry 获取版本信息
- 注册以下 RPC 方法：
  - `check-for-updates` - 检查更新
  - `get-current-version` - 获取当前版本
  - `test-network` - 测试网络连接

### 客户端 (`client.js`)

- 注册设置项到 `settings.general.item` 槽位
- 使用 `host.call` 调用主机端方法
- 注册弹窗到 `shell.overlay` 槽位
- 添加"测试网络"按钮用于调试

### WebFetchRequest 格式

```javascript
{
  url: 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
}
```

**注意**：不需要 `method` 和 `headers` 参数

### WebFetchResult 格式

```javascript
{
  url: string,           // 最终URL
  statusCode: number,    // HTTP状态码（不是 status）
  body: {                // 是对象，不是字符串
    kind: 'html' | 'text',
    content: string      // 实际内容
  },
  truncated: boolean
}
```

## 调试方法

### 1. 查看控制台日志

插件会在控制台输出详细的调试信息：
- `web.fetch` 的返回结果
- 版本获取过程
- 错误信息和堆栈

### 2. 使用"测试网络"按钮

点击"测试网络"按钮可以：
- 验证 `web.fetch` 是否正常工作
- 检查 npm registry 是否可访问
- 查看返回的数据格式

### 3. 检查错误信息

如果出现错误，插件会显示：
- 用户友好的错误提示
- 详细的控制台日志
- 错误堆栈信息

## 后续优化

1. **使用 semver 库**：进行语义化版本比较
2. **添加缓存机制**：避免频繁请求 npm registry
3. **定时检查**：实现每天自动检查一次更新
4. **改进错误处理**：显示更友好的错误信息
5. **添加更新日志**：显示新版本的更新内容

## 许可证

MIT License
