// DSH 更新检查插件 - 主机端代码
// 负责从 npm registry 获取版本信息

return {
  inject: ['web'],
  apply(ctx) {
    const web = ctx.web
    
    // 从npm registry获取最新版本
    async function getLatestVersion() {
      try {
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
        })
        
        if (result.statusCode === 200) {
          const data = JSON.parse(result.body.content)
          return data.version
        }
        
        console.error('获取最新版本失败，状态码:', result.statusCode)
        return null
      } catch (e) {
        console.error('获取最新版本异常:', e)
        return null
      }
    }
    
    // 获取当前版本（暂时使用硬编码，后续可优化）
    async function getCurrentVersion() {
      // 可以从配置或环境获取，这里使用硬编码
      // 实际部署时应更新为真实版本
      return '1.0.0'
    }
    
    // 检查更新
    async function checkForUpdates() {
      const currentVersion = await getCurrentVersion()
      const latestVersion = await getLatestVersion()
      
      if (!latestVersion) {
        return {
          currentVersion,
          latestVersion: null,
          hasUpdate: false,
          error: '无法获取最新版本信息'
        }
      }
      
      // 简单版本比较
      const hasUpdate = currentVersion !== latestVersion
      
      return {
        currentVersion,
        latestVersion,
        hasUpdate,
        error: null
      }
    }
    
    // 注册RPC方法供客户端调用
    harness.handle('check-for-updates', async () => {
      return await checkForUpdates()
    })
    
    harness.handle('get-current-version', async () => {
      return await getCurrentVersion()
    })
  }
}
