# DSH 更新检查插件

一个用于检查 DSH (DeepSeek Harness) 更新的动态 Cordis 插件。

## 功能特性

- ✅ 在设置 > 通用 中显示"DSH 更新"设置项
- ✅ 显示当前版本和最新版本信息
- ✅ 支持手动点击"检查更新"按钮
- ✅ 每次打开设置页面时自动检查更新
- ✅ 发现新版本时弹窗提示用户选择是否更新

## 文件结构

- `host.js` - 主机端代码，负责从 npm registry 获取版本信息
- `client.js` - 客户端代码，负责在设置中显示更新状态和弹窗提示

## 当前问题

1. **无法检查更新** - `web.fetch` 调用可能存在问题
2. **当前版本硬编码** - 应该读取 DSH 本地实际安装的版本

## 修复计划

### 问题1：无法检查更新

**可能原因**：
- `web.fetch` 返回格式理解错误
- npm registry 访问被阻止
- 错误处理不完善

**解决方案**：
- 添加详细的错误日志
- 验证 `web.fetch` 的正确用法
- 检查网络连接

### 问题2：当前版本硬编码

**当前代码**：
```javascript
async function getCurrentVersion() {
  return '1.0.0'  // ❌ 硬编码
}
```

**解决方案**：
- 使用 `ctx.fs` 服务读取本地 `package.json`
- 路径：`node_modules/@deepseek-ai/dsh/package.json`
- 解析 `version` 字段

**示例代码**：
```javascript
async function getCurrentVersion() {
  try {
    const fs = ctx.get('fs')
    if (!fs) return '1.0.0'
    
    const target = await fs.resolve('node_modules/@deepseek-ai/dsh/package.json')
    const content = await fs.readText(target)
    const pkg = JSON.parse(content)
    return pkg.version
  } catch (e) {
    console.error('读取本地版本失败:', e)
    return '1.0.0'
  }
}
```

## 使用方法

### 安装插件

1. 将 `host.js` 和 `client.js` 代码复制到 DSH 动态插件定义中
2. 使用 `cordis_define` 定义插件
3. 使用 `cordis_run` 运行插件

### 验证功能

1. 打开 DSH Web 界面
2. 进入 **设置 > 通用**
3. 找到 **DSH 更新** 设置项
4. 点击 **检查更新** 按钮
5. 验证版本信息是否正确显示

## 技术细节

### 主机端 (`host.js`)

- 注入 `web` 服务
- 使用 `web.fetch` 从 npm registry 获取版本信息
- 注册 `check-for-updates` 和 `get-current-version` RPC 方法

### 客户端 (`client.js`)

- 注册设置项到 `settings.general.item` 槽位
- 使用 `host.call` 调用主机端方法
- 注册弹窗到 `shell.overlay` 槽位

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

## 后续优化

1. **使用 semver 库**：进行语义化版本比较
2. **添加缓存机制**：避免频繁请求 npm registry
3. **定时检查**：实现每天自动检查一次更新
4. **改进错误处理**：显示更友好的错误信息
5. **添加更新日志**：显示新版本的更新内容

## 版本历史

- **v1.0.0** (当前) - 初始版本，基础功能实现
  - 设置项显示
  - 手动检查更新
  - 弹窗提示

## 许可证

MIT License
