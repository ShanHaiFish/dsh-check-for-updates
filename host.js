// DSH 更新检查插件 - 主机端代码
// 版本 v1.10.1 - fetch 提供方 id 唯一化，避免与先前动态包注册的 updck-curl 冲突
// - 本部署没有任何 fetch 提供方，web.fetch 永不工作。
//   因此本插件注册一个 curl 子进程 fetch 提供方（id: updck-curl）,
//   让 web.fetch 真正可用，并从 npm registry 读取实际发布的最高版本。
// - npm 的 /latest 标签可能滞后（如 rc.7），故读取 packument 的 versions
//   并用 semver 比较取最高者（rc.8），避免漏掉 next 标签上的新版本。
// - 仍保留 web.search 作为最后兜底。
// - 当前版本通过 fs 读取本地 @deepseek-ai/dsh/package.json。
// - 自动升级：perform-update 用 node+npm-cli 安装精确版本到真实全局根
//   （显式 --prefix，规避 .npmrc 的 M: 误解析），安装后对盘校验版本。

return {
  inject: ['web', 'fs', 'timer'],
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
    // 每次激活使用唯一 id，避免与先前动态包已注册的 updck-curl 冲突；
    // 若已存在可用提供方（含先前版本），则跳过注册，web.fetch 仍可正常工作。
    if (subprocess) {
      const providerId = 'updck-curl-' + Math.random().toString(36).slice(2, 8)
      try {
        web.registerFetchProvider({
          id: providerId,
          available: () => true,
          fetch: (request, signal) => fetchViaCurl(request.url, signal)
        })
        console.log('[updck] 已注册 curl fetch 提供方: ' + providerId)
      } catch (e) {
        console.log('[updck] 注册 curl fetch 提供方冲突，跳过（web.fetch 可能已可用）: ' + e.message)
      }
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

    // ---------- 自动升级（安装到真实全局根，安装后对盘校验） ----------
    function tailLines(s, n) {
      const a = String(s || '').split(/\r?\n/).filter(Boolean)
      return a.slice(-n).join('\n')
    }
    // 从运行中 package.json 推导真实全局根，规避 .npmrc 里被误解析成 M: 的 prefix
    function deriveGlobalRoot() {
      const marker = 'node_modules/@deepseek-ai/dsh'
      const idx = LOCAL_PACKAGE_JSON.indexOf(marker)
      if (idx === -1) return null
      return LOCAL_PACKAGE_JSON.slice(0, idx).replace(/[\\/]+$/, '')
    }

    let nodeResolved = undefined
    async function resolveNode() {
      if (nodeResolved === undefined) {
        try {
          nodeResolved = await subprocess.resolveExecutable('node')
        } catch (e) {
          try {
            nodeResolved = await subprocess.resolveExecutable('C:/Program Files/nodejs/node.exe')
          } catch (e2) {
            nodeResolved = null
          }
        }
      }
      return nodeResolved
    }

    let npmCliResolved = undefined
    async function resolveNpmCli() {
      if (npmCliResolved !== undefined) return npmCliResolved
      const nodePath = await resolveNode()
      const candidates = []
      if (nodePath) {
        // 从 node.exe 所在目录推导同款 npm
        candidates.push(nodePath.replace(/[\\/][^\\/]+$/, '') + '/node_modules/npm/bin/npm-cli.js')
      }
      candidates.push('C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js')
      candidates.push('C:/Program Files (x86)/nodejs/node_modules/npm/bin/npm-cli.js')
      for (const c of candidates) {
        try {
          const t = await fs.resolve(c)
          const info = await fs.stat(t)
          if (info !== undefined) { npmCliResolved = c; return c }
        } catch (e) { /* try next */ }
      }
      npmCliResolved = null
      return null
    }

    // 执行安装；超时调用 handle.terminate()（幂等），读取 collect 输出
    function runInstall(argv, timeoutMs) {
      return new Promise((resolve, reject) => {
        let handle
        try {
          handle = subprocess.spawn({
            argv,
            cwd: deriveGlobalRoot(),
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: 2000000 },
              stderr: { maxBytes: 2000000 }
            },
            graceMs: 5000
          })
        } catch (e) {
          return reject(e)
        }
        let timedOut = false
        const t = ctx.timeout(() => { timedOut = true; handle.terminate() }, timeoutMs)
        handle.done.then(() => {
          t()
          const out = (handle.collected && handle.collected.stdout) ? handle.collected.stdout.readFrom(0).text : ''
          const err = (handle.collected && handle.collected.stderr) ? handle.collected.stderr.readFrom(0).text : ''
          resolve({ out, err, timedOut })
        }).catch((e) => { t(); reject(e) })
      })
    }

    async function performUpdate() {
      const currentVersion = await getCurrentVersion()
      if (!subprocess) {
        return { updated: false, error: 'subprocess 服务不可用，无法自动执行安装' }
      }
      const target = await getLatestVersion()
      if (!target) {
        return { updated: false, error: '无法获取最新版本信息，已取消更新' }
      }
      // 前置守卫：仅当确实发现新版本才执行
      if (compareVersions(target, currentVersion) <= 0) {
        return { updated: false, reason: 'already-latest', latestVersion: target }
      }

      const root = deriveGlobalRoot()
      const nodePath = await resolveNode()
      const npmCli = await resolveNpmCli()
      const missing = []
      if (!root) missing.push('无法推导全局安装根')
      if (!nodePath) missing.push('node 不可用')
      if (!npmCli) missing.push('npm-cli.js 不可用')
      if (missing.length) return { updated: false, error: missing.join('；') }

      const argv = [nodePath, npmCli, 'install', '-g', '--prefix', root, '@deepseek-ai/dsh@' + target]
      console.log('[update] 执行安装(目标 ' + target + '):', argv.join(' '))

      let result
      try {
        result = await runInstall(argv, 180000)
      } catch (e) {
        return { updated: false, error: '安装执行失败: ' + e.message }
      }
      const fullLog = tailLines(result.out + '\n' + result.err, 40)
      if (result.timedOut) {
        return { updated: false, error: '安装超时（180s）已中止', logTail: fullLog }
      }
      // 安装后对盘校验：版本必须等于目标
      const installed = await getCurrentVersion()
      if (installed === target) {
        console.log('[update] 已更新到 ' + installed)
        return {
          updated: true,
          installedVersion: installed,
          needsRestart: true,
          message: 'DSH 已成功更新到 ' + installed + '，请重启 DSH 后生效',
          logTail: fullLog
        }
      }
      return { updated: false, error: '安装后版本校验失败：当前仍为 ' + installed + '（期望 ' + target + '）', logTail: fullLog }
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

    harness.handle('perform-update', async () => {
      return await performUpdate()
    })
  }
}
