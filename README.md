# DSH 更新检查插件

一个用于检查 DSH (DeepSeek Harness) 更新的动态 Cordis 插件。

## 功能特性

- ✅ 在设置 > 通用 中显示"DSH 更新"设置项
- ✅ 显示当前版本和最新版本信息
- ✅ 支持手动点击"检查更新"按钮
- ✅ 每次打开设置页面时自动检查更新
- ✅ 发现新版本时弹窗提示用户选择是否更新
- ✅ 添加"测试网络"按钮用于调试

## 文件结构

- `host.js` - 主机端代码，负责从 npm registry 获取版本信息
- `client.js` - 客户端代码，负责在设置中显示更新状态和弹窗提示

## 已修复问题

### 问题1：无法检查更新

**修复方案**：
1. 增强错误处理，添加详细的控制台日志
2. 验证 `web.fetch` 的正确用法
3. 添加"测试网络"按钮用于调试

### 问题2：当前版本硬编码

**修复方案**：
1. 使用 `ctx.fs` 服务读取本地 `package.json`
2. 路径：`node_modules/@deepseek-ai/dsh/package.json`
3. 解析 `version` 字段
4. 备用方案：从 npm registry 获取当前版本

**代码实现**：
```javascript
async function getCurrentVersion() {
  try {
    const fs = ctx.get('fs')
    if (fs) {
      const target = await fs.resolve('node_modules/@deepseek-ai/dsh/package.json')
      const content = await fs.readText(target)
      const pkg = JSON.parse(content)
      return pkg.version
    }
  } catch (e) {
    console.error('读取本地版本失败:', e)
  }
  
  // 备用方案：从 npm registry 获取
  try {
    const result = await web.fetch({
      url: 'https://registry.npmjs.org/@deepseek-ai/dsh'
    })
    if (result.statusCode === 200) {
      const data = JSON.parse(result.body.content)
      if (data['dist-tags'] && data['dist-tags'].latest) {
        return data['dist-tags'].latest
      }
    }
  } catch (e) {
    console.error('备用方案失败:', e)
  }
  
  return '1.0.0'
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

## 版本历史

- **v1.1.0** (当前) - 修复版本
  - 修复 `web.fetch` 调用问题
  - 添加获取本地版本功能
  - 增强错误处理和日志
  - 添加"测试网络"调试按钮

- **v1.0.0** - 初始版本
  - 设置项显示
  - 手动检查更新
  - 弹窗提示

## 许可证

MIT License
