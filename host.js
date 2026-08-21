// DSH 更新检查插件 - 主机端代码
// 版本 v1.9.0
// - 本部署没有任何 fetch 提供方，web.fetch 永不工作。
//   因此本插件注册一个 curl 子进程 fetch 提供方（id: updck-curl）,
//   让 web.fetch 真正可用，并从 npm registry 读取实际发布的最高版本。
// - npm 的 /latest 标签可能滞后（如 rc.7），故读取 packument 的 versions
//   并用 semver 比较取最高者（rc.8），避免漏掉 next 标签上的新版本。
// - 仍保留 web.search 作为最后兜底。
// - 当前版本通过 fs 读取本地 @deepseek-ai/dsh/package.json。

return {
  inject: ['web', 'fs'],
  apply(ctx) {
    const web = ctx.web
    const fs = ctx.fs
    const subprocess = ctx.get('subprocess')

    // 本地 DSH package.json 路径（绝对路径，已验证可读取）
    const LOCAL_PACKAGE_JSON = 'C:/home/whaow/.npm-global/node_modules/@deepseek-ai/dsh/package.json'

    // 读取本地当前版本
    async function getCurrentVersion() {
      try {
        const target = await fs.resolve(LOCAL_PACKAGE_JSON)
        const content = await fs.readText(target)
        const pkg = JSON.parse(content)
        if (pkg.version) {
          return pkg.version
        }
        return '0.0.0'
      } catch (e) {
        console.error('读取本地版本失败:', e.message)
        return '0.0.0'
      }
    }

    // ---------- 语义化版本比较（无需依赖库） ----------
    function parseVersionNumber(v) {
      const s = String(v).trim()
      const dash = s.indexOf('-')
      const core = (dash === -1 ? s : s.slice(0, dash)).split('.')
      const pre = dash === -1 ? '' : s.slice(dash + 1)
      const parts = core.map((n) => { const x = parseInt(n, 10); return isNaN(x) ? 0 : x })
      return { parts, pre }
    }
    // 返回: >0 表示 a>b, <0 表示 a<b, 0 表示相等
    function compareVersions(a, b) {
      const A = parseVersionNumber(a)
      const B = parseVersionNumber(b)
      for (let i = 0; i < 3; i++) {
        if (A.parts[i] !== B.parts[i]) return A.parts[i] - B.parts[i]
      }
      if (A.pre === B.pre) return 0
      if (!A.pre) return 1 // 正式版 > 预发布
      if (!B.pre) return -1
      const num = (s) => { const m = String(s).match(/(\d+)/); return m ? parseInt(m[1], 10) : NaN }
      const na = num(A.pre)
      const nb = num(B.pre)
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
      return A.pre < B.pre ? -1 : 1
    }
    // 从 npm packument 的 versions 键中取最高版本
    function pickMaxVersion(versions) {
      let best = null
      for (const v of Object.keys(versions)) {
        if (best === null || compareVersions(v, best) > 0) best = v
      }
      return best
    }

    // ================= curl 子进程 fetch 提供方 =================
    // undefined = 未解析, null = 不可用, 字符串 = 已解析路径
    let curlResolved = undefined
    async function resolveCurl() {
      if (curlResolved === undefined) {
        try {
          curlResolved = await subprocess.resolveExecutable('curl')
        } catch (e) {
          try {
            curlResolved = await subprocess.resolveExecutable('C:/Windows/System32/curl.exe')
          } catch (e2) {
            curlResolved = null
          }
        }
      }
      return curlResolved
    }

    async function fetchViaCurl(url, signal) {
      const curlPath = await resolveCurl()
      if (!curlPath) {
        throw new Error('curl 不可用，无法抓取: ' + url)
      }
      const spec = {
        argv: [
          curlPath,
          '--silent', '--show-error', '--location', '--max-time', '20',
          '-H', 'Accept: application/vnd.npm.install-v1+json',
          '--write-out', '\n<<<STATUS>>>%{http_code}',
          url
        ],
        cwd: 'C:/home/whaow/.npm-global/node_modules/@deepseek-ai/dsh',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 400000 },
          stderr: { maxBytes: 4000 }
        },
        graceMs: 3000,
        signal
      }
      const handle = subprocess.spawn(spec)
      await handle.done
      const collected = (handle.collected && handle.collected.stdout)
        ? handle.collected.stdout.readFrom(0).text
        : ''
      const marker = '<<<STATUS>>>'
      const idx = collected.lastIndexOf(marker)
      let body = collected
      let statusText = ''
      if (idx !== -1) {
        body = collected.slice(0, idx).replace(/[\r\n]+$/, '')
        statusText = collected.slice(idx + marker.length).trim()
      }
      return {
        url,
        statusCode: parseInt(statusText, 10) || 0,
        body: { kind: 'text', content: body },
        truncated: false
      }
    }

    // 注册 curl fetch 提供方（subprocess 存在时）
    if (subprocess) {
      web.registerFetchProvider({
        id: 'updck-curl',
        available: () => true,
        fetch: (request, signal) => fetchViaCurl(request.url, signal)
      })
      console.log('[updck] 已注册 curl fetch 提供方: updck-curl')
    } else {
      console.log('[updck] subprocess 不可用，未注册 curl fetch 提供方')
    }
    // ===========================================================

    // 通过 web.fetch（现在走 updck-curl）获取实际发布的最高版本
    // npm 的 /latest 只返回 latest 标签（可能滞后，如 rc.7），
    // 因此这里读取完整 packument 的 versions 并取 semver 最高者（rc.8）。
    async function getLatestByFetch() {
      try {
        console.log('[fetch] 请求 npm registry packument...')
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh'
        })
        if (result && result.statusCode === 200) {
          const data = JSON.parse(result.body.content)
          if (data && data.versions) {
            const best = pickMaxVersion(data.versions)
            if (best) {
              console.log('[fetch] 最新版本:', best)
              return best
            }
          }
        }
        console.log('[fetch] 状态码:', result ? result.statusCode : 'unknown')
        return null
      } catch (e) {
        console.log('[fetch] 失败:', e.message)
        return null
      }
    }

    // 通过 web.search 搜索最新版本（降级方案）
    async function getLatestBySearch() {
      try {
        console.log('[search] 搜索 npm 版本...')
        const result = await web.search({
          query: '@deepseek-ai/dsh npm latest version',
          maxResults: 8
        })
        if (result && result.sources) {
          for (const s of result.sources) {
            const content = (s.snippet || '') + ' ' + (s.title || '') + ' ' + (s.url || '')
            const m = content.match(/@deepseek-ai\/dsh[@\s:]*v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)
            if (m) {
              console.log('[search] 提取版本:', m[1])
              return m[1]
            }
          }
        }
        return null
      } catch (e) {
        console.log('[search] 失败:', e.message)
        return null
      }
    }

    // 获取最新版本（fetch 优先，search 降级）
    async function getLatestVersion() {
      let version = await getLatestByFetch()
      if (!version) {
        version = await getLatestBySearch()
      }
      return version
    }

    // 测试网络连接
    async function testNetwork() {
      try {
        const result = await web.fetch({
          url: 'https://registry.npmjs.org/@deepseek-ai/dsh/latest'
        })
        return {
          success: true,
          message: '网络连接正常（web.fetch 可用，通过 updck-curl 提供方）',
          statusCode: result.statusCode,
          contentLength: result.body.content.length
        }
      } catch (e) {
        try {
          const result = await web.search({ query: 'test', maxResults: 1 })
          return {
            success: true,
            message: '网络连接正常（web.search 可用，web.fetch 不可用: ' + e.message + '）',
            resultCount: result.sources ? result.sources.length : 0
          }
        } catch (e2) {
          return {
            success: false,
            error: e.message + '; ' + e2.message
          }
        }
      }
    }

    // 检查更新
    async function checkForUpdates() {
      console.log('开始检查更新...')
      const currentVersion = await getCurrentVersion()
      const latestVersion = await getLatestVersion()
      console.log('当前版本:', currentVersion)
      console.log('最新版本:', latestVersion)

      let error = null
      if (!latestVersion) {
        error = '无法获取最新版本信息（curl fetch 提供方与 web.search 均未能取得版本号）'
      }

      let hasUpdate = false
      if (latestVersion) {
        hasUpdate = currentVersion !== latestVersion
      }

      return {
        currentVersion,
        latestVersion,
        hasUpdate,
        error
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
