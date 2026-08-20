// DSH 更新检查插件 - 主机端代码
// 负责从 npm registry 获取版本信息

return {
  inject: ['web'],
  apply(ctx) {
    const web = ctx.web
    
    // 测试网络连接
    async function testNetwork() {
      try {
        console.log('测试网络连接...')
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
        })
        
        console.log('web.fetch 返回:', result)
        console.log('statusCode:', result.statusCode)
        console.log('body.kind:', result.body.kind)
        console.log('body.content 长度:', result.body.content.length)
        
        return {
          success: true,
          statusCode: result.statusCode,
          bodyKind: result.body.kind,
          contentLength: result.body.content.length,
          contentPreview: result.body.content.substring(0, 200)
        }
      } catch (e) {
        console.error('网络测试失败:', e)
        return {
          success: false,
          error: e.message,
          stack: e.stack
        }
      }
    }
    
    // 从npm registry获取最新版本
    async function getLatestVersion() {
      try {
        console.log('正在获取最新版本...')
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
        })
        
        console.log('web.fetch 返回:', result)
        console.log('statusCode:', result.statusCode)
        
        if (result.statusCode === 200) {
          try {
            const data = JSON.parse(result.body.content)
            console.log('解析成功，version:', data.version)
            return data.version
          } catch (parseError) {
            console.error('JSON解析失败:', parseError.message)
            console.error('原始内容:', result.body.content.substring(0, 200))
            return null
          }
        }
        
        console.error('获取最新版本失败，状态码:', result.statusCode)
        return null
      } catch (e) {
        console.error('获取最新版本异常:', e)
        console.error('错误堆栈:', e.stack)
        return null
      }
    }
    
    // 获取当前版本
    async function getCurrentVersion() {
      try {
        console.log('正在获取当前版本...')
        
        // 从 npm registry 获取当前版本
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh'
        })
        
        if (result.statusCode === 200) {
          const data = JSON.parse(result.body.content)
          if (data['dist-tags'] && data['dist-tags'].latest) {
            console.log('从 npm registry 获取当前版本:', data['dist-tags'].latest)
            return data['dist-tags'].latest
          }
        }
        
        console.log('使用默认版本: 1.0.0')
        return '1.0.0'
      } catch (e) {
        console.error('获取当前版本异常:', e)
        console.error('错误堆栈:', e.stack)
        return '1.0.0'
      }
    }
    
    // 检查更新
    async function checkForUpdates() {
      console.log('开始检查更新...')
      
      const currentVersion = await getCurrentVersion()
      const latestVersion = await getLatestVersion()
      
      console.log('当前版本:', currentVersion)
      console.log('最新版本:', latestVersion)
      
      if (!latestVersion) {
        const errorMsg = '无法获取最新版本信息，请检查网络连接'
        console.error(errorMsg)
        return {
          currentVersion,
          latestVersion: null,
          hasUpdate: false,
          error: errorMsg
        }
      }
      
      // 版本比较
      let hasUpdate = false
      try {
        // 简单字符串比较
        hasUpdate = currentVersion !== latestVersion
        console.log('版本比较结果:', hasUpdate)
      } catch (e) {
        console.error('版本比较失败:', e.message)
        hasUpdate = currentVersion !== latestVersion
      }
      
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
    
    harness.handle('test-network', async () => {
      return await testNetwork()
    })
  }
}
