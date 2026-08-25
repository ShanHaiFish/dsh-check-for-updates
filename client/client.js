// DSH 更新检查插件 — Client（静态 bundle 形态）v1.13.1
// 首次打开自动检查一次更新（每页一次，跨 HMR 用 window 标志持久）；有新版本时在
// 左下部「设置」按钮上方浮动卡片提示，提供【更新到 {版本}】/【稍后】。
// host 调用走 POST /dsh-update-check/api（JSON {method}）。
// 配色使用 DSH 语义化主题 token（--dsw-alias-*）以兼容第三方主题/亮暗色。
//
// v1.13.0 变更：
//   - factory 的返回值必须是 cordis 插件形态（函数或带 apply 方法的对象）。
//     v1.12.0 返回 { __dshUpdateChecker, recheck } 普通对象，浏览器侧 cordis
//     loader 校验失败，导致每次安装后启动页必报
//     "invalid plugin, expect function or object with an 'apply' method"。
//     调试句柄改挂 window.__dshUpdateChecker，不再作为模块导出。
//   - 更新改为「分离式两阶段」：点击更新后 host 只安排一个独立 updater 进程，
//     等本 DSH 进程退出后再执行安装（避免 Windows 下运行中替换 koffi.node 造成
//     安装损坏），卡片话术相应改为「退出 DSH 后将自动完成安装」。
//   - 检查时若 host 报告 koffi 原生模块断链（或上次自动更新失败），弹出警告卡
//     提供【安排修复】/【再次安排更新】。
//
// v1.13.1 修复（来源 bug-report-dsh-check-for-updates-settings-entry-missing.md）：
//   - 补回 README 承诺的「设置 > 通用 · DSH 更新」设置项入口：静态 bundle 化
//     （896caaa6）与 v1.13.0 重写（2ea843e）时遗漏了 settings.general.item 注册，
//     用户只能依赖自动检查，无法手动检查更新/测试网络。
//   - 实现方式：导出声明 inject: ['slots']，apply() 内经 ctx.slots 注册
//     UpdateSettingsItem（React 组件），host 调用复用本文件 call()——
//     POST /dsh-update-check/api（JSON {method}），完整对接 v1.13.0 host 契约
//     （get-current-version→{version}；check-for-updates→{currentVersion,
//     latestVersion, hasUpdate, error, integrity, lastUpdaterResult}；
//     test-network→{success, message, statusCode, contentLength}；
//     perform-update→{updated, scheduled, installedVersion, needsRestart, message}）。
window.__ModuleLoader__.load({
  id: 'dsh-check-for-updates',
  factory: (require) => {
    const React = require('react')
    const DISMISS_KEY = 'dsh-updck-dismissed-version'
    const REPORTED_KEY = 'dsh-updck-reported-status'
    const API = '/dsh-update-check/api'

    const tokens = {
      primaryFill: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
      primaryFg: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
      bg: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      border: 'var(--dsw-alias-border-l2, #e3e3e9)',
      text: 'var(--dsw-alias-label-primary, #1b1b1f)',
      text2: 'var(--dsw-alias-label-secondary, #5c5c66)',
      text3: 'var(--dsw-alias-label-tertiary, #8a8a94)',
      success: 'var(--dsw-alias-state-success-primary, #16a34a)',
      error: 'var(--dsw-alias-state-error-primary, #dc2626)'
    }

    async function call(method) {
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method }) })
      return res.json()
    }
    function ssGet(k) { try { return window.sessionStorage.getItem(k) } catch (e) { return null } }
    function ssSet(k, v) { try { window.sessionStorage.setItem(k, v) } catch (e) { /* ignore */ } }
    function el(tag, style) {
      const node = document.createElement(tag)
      for (const k in style) node.style[k] = style[k]
      return node
    }

    let card = null
    function close() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null }
    function newCard() {
      close()
      card = el('div', {
        position: 'fixed', bottom: '96px', left: '16px', zIndex: '10000',
        width: '290px', maxWidth: 'calc(100vw - 32px)', padding: '14px 16px',
        backgroundColor: tokens.bg, border: '1px solid ' + tokens.border, borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', color: tokens.text, fontSize: '13px', lineHeight: '1.5'
      })
      document.body.appendChild(card)
      return card
    }

    // ---------- 更新卡：有新版本时提示 ----------
    function showCard(state) {
      const box = newCard()
      const title = el('div', { fontWeight: '600', marginBottom: '6px' })
      title.textContent = '有新版本可用'
      const line = el('div', { fontSize: '13px', color: tokens.text2, marginBottom: '4px' })
      line.textContent = '当前 ' + (state.currentVersion || '?') + '  →  ' + state.latestVersion
      const hint = el('div', { fontSize: '13px', color: tokens.success })
      hint.textContent = '点击下方按钮安排更新'
      const buttons = el('div', { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' })
      const updBtn = el('button', { padding: '6px 14px', border: 'none', borderRadius: '6px', backgroundColor: tokens.primaryFill, color: tokens.primaryFg, cursor: 'pointer', fontSize: '13px' })
      updBtn.textContent = '更新到 ' + state.latestVersion
      const laterBtn = el('button', { padding: '6px 12px', border: '1px solid ' + tokens.border, borderRadius: '6px', backgroundColor: 'transparent', color: tokens.text2, cursor: 'pointer', fontSize: '13px' })
      laterBtn.textContent = '稍后'
      const statusLine = el('div', { fontSize: '12px', color: tokens.text3, marginTop: '8px' })

      updBtn.addEventListener('click', async () => {
        updBtn.disabled = true
        updBtn.textContent = '安排中...'
        statusLine.textContent = '正在安排更新任务…'
        try {
          const r = await call('perform-update')
          if (r && r.scheduled) {
            ssSet(DISMISS_KEY, r.installedVersion || '')
            updBtn.textContent = '已安排 ✓'
            laterBtn.textContent = '知道了'
            statusLine.style.color = tokens.success
            statusLine.textContent = r.message || ('已安排更新到 ' + r.installedVersion + '：退出 DSH 后将自动完成安装')
            return
          }
          updBtn.disabled = false
          updBtn.textContent = '重试'
          statusLine.style.color = tokens.error
          statusLine.textContent = (r && r.error) || '安排更新失败'
        } catch (e) {
          updBtn.disabled = false
          updBtn.textContent = '重试'
          statusLine.style.color = tokens.error
          statusLine.textContent = String((e && e.message) || e)
        }
      })
      laterBtn.addEventListener('click', () => { ssSet(DISMISS_KEY, state.latestVersion); close() })
      buttons.append(updBtn, laterBtn)
      box.append(title, line, hint, buttons, statusLine)
    }

    // ---------- 警告卡：koffi 断链（安装损坏）或上次自动更新失败 ----------
    function showDamageCard(r) {
      const integ = r && r.integrity
      const last = r && r.lastUpdaterResult
      const broken = !!(integ && integ.checked && !integ.ok)
      const box = newCard()
      if (broken) box.style.border = '1px solid ' + tokens.error
      const title = el('div', { fontWeight: '600', marginBottom: '6px', color: broken ? tokens.error : tokens.text })
      title.textContent = broken ? 'DSH 安装文件损坏' : '上次自动更新未成功'
      const line = el('div', { fontSize: '12px', color: tokens.text2, marginBottom: '4px' })
      if (broken) {
        line.textContent = '检测到 koffi 原生模块与包声明版本不一致（koffi ' + (integ.koffiVersion || '?') +
          '），此时重启 DSH 可能报 "Mismatched native Koffi modules" 而无法启动，建议安排修复。'
      } else {
        line.textContent = '退出 DSH 后的自动更新任务未完成：' + (last && last.error ? last.error : '未知原因') +
          '。可重新安排更新，或手动执行 npm install -g @deepseek-ai/dsh。'
      }
      const lastLine = (broken && last && last.success === false)
        ? el('div', { fontSize: '12px', color: tokens.text3, marginBottom: '4px' })
        : null
      if (lastLine) lastLine.textContent = '上次自动更新失败：' + (last.error || '未知原因')
      const buttons = el('div', { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' })
      const actionBtn = el('button', { padding: '6px 14px', border: 'none', borderRadius: '6px', backgroundColor: broken ? tokens.error : tokens.primaryFill, color: '#ffffff', cursor: 'pointer', fontSize: '13px' })
      actionBtn.textContent = broken ? '安排修复' : '再次安排更新'
      const okBtn = el('button', { padding: '6px 12px', border: '1px solid ' + tokens.border, borderRadius: '6px', backgroundColor: 'transparent', color: tokens.text2, cursor: 'pointer', fontSize: '13px' })
      okBtn.textContent = '知道了'
      const statusLine = el('div', { fontSize: '12px', color: tokens.text3, marginTop: '8px' })

      actionBtn.addEventListener('click', async () => {
        actionBtn.disabled = true
        actionBtn.textContent = '安排中...'
        statusLine.textContent = '正在安排任务…'
        try {
          const rr = await call(broken ? 'perform-repair' : 'perform-update')
          if (rr && rr.scheduled) {
            actionBtn.textContent = '已安排 ✓'
            okBtn.textContent = '知道了'
            statusLine.style.color = tokens.success
            statusLine.textContent = rr.message || '已安排：退出 DSH 后自动执行'
            return
          }
          actionBtn.disabled = false
          actionBtn.textContent = '重试'
          statusLine.style.color = tokens.error
          statusLine.textContent = (rr && rr.error) || '安排失败'
        } catch (e) {
          actionBtn.disabled = false
          actionBtn.textContent = '重试'
          statusLine.style.color = tokens.error
          statusLine.textContent = String((e && e.message) || e)
        }
      })
      okBtn.addEventListener('click', () => {
        if (last && last.id) ssSet(REPORTED_KEY, last.id)
        close()
      })
      buttons.append(actionBtn, okBtn)
      box.append(title, line)
      if (lastLine) box.append(lastLine)
      box.append(buttons, statusLine)
    }

    async function autoCheck() {
      if (window.__dshUpdckStarted) return
      window.__dshUpdckStarted = true
      try {
        const r = await call('check-for-updates')
        const integ = r && r.integrity
        if (integ && integ.checked && !integ.ok) { showDamageCard(r); return }
        const last = r && r.lastUpdaterResult
        if (last && last.success === false && last.id && ssGet(REPORTED_KEY) !== last.id) {
          showDamageCard({ integrity: integ, lastUpdaterResult: last })
          return
        }
        if (r && r.hasUpdate && r.latestVersion && ssGet(DISMISS_KEY) !== r.latestVersion) showCard(r)
      } catch (e) { /* 自动检查失败不打扰用户 */ }
    }

    // ---------- 设置项：设置 > 通用 · DSH 更新（v1.13.1 补回） ----------
    // 挂载时只读当前版本（不触发网络动作）；「检查更新」/「测试网络」/「更新到」
    // 均通过 call() 走 v1.13.0 host 契约；perform-update 为「安排」语义——
    // 显示"退出 DSH 后自动完成安装"，并把目标版本写入 sessionStorage，
    // 与浮动弹卡共享 DISMISS_KEY，避免安排后弹卡重复出现。
    function UpdateSettingsItem() {
      const [state, setState] = React.useState({
        currentVersion: null,
        latestVersion: null,
        hasUpdate: false,
        checking: false,
        updating: false,
        repairing: false,
        error: null,
        message: null,
        network: null,
        damage: null
      })

      React.useEffect(() => {
        let cancelled = false
        call('get-current-version').then((r) => {
          if (!cancelled && r && r.version) {
            setState((s) => Object.assign({}, s, { currentVersion: r.version }))
          }
        }).catch(() => { /* 挂载时读取失败不打扰 */ })
        return () => { cancelled = true }
      }, [])

      function doCheck() {
        setState((s) => Object.assign({}, s, { checking: true, error: null, network: null, message: null }))
        call('check-for-updates').then((r) => {
          const integ = r && r.integrity
          const last = r && r.lastUpdaterResult
          const damage = (integ && integ.checked && !integ.ok)
            ? '检测到 koffi 原生模块与声明版本不一致（koffi ' + (integ.koffiVersion || '?') + '），此时重启 DSH 可能报 "Mismatched native Koffi modules" 而无法启动，请安排修复。'
            : (last && last.success === false ? '上次自动更新未完成：' + (last.error || '未知原因') + '，可重新安排更新。' : null)
          setState((s) => Object.assign({}, s, {
            checking: false,
            currentVersion: (r && r.currentVersion) || s.currentVersion,
            latestVersion: (r && r.latestVersion) || null,
            hasUpdate: !!(r && r.hasUpdate),
            error: (r && r.error) || null,
            damage
          }))
        }).catch((e) => {
          setState((s) => Object.assign({}, s, { checking: false, error: String((e && e.message) || e) }))
        })
      }

      function doTestNetwork() {
        setState((s) => Object.assign({}, s, { network: 'testing' }))
        call('test-network').then((r) => {
          setState((s) => Object.assign({}, s, {
            network: (r && r.success)
              ? { ok: true, text: (r.message || '网络连接正常') + (r.statusCode ? '（HTTP ' + r.statusCode + '）' : '') }
              : { ok: false, text: (r && r.error) || '网络测试失败' }
          }))
        }).catch((e) => {
          setState((s) => Object.assign({}, s, { network: { ok: false, text: String((e && e.message) || e) } }))
        })
      }

      function doUpdate() {
        setState((s) => Object.assign({}, s, { updating: true, error: null, message: null, network: null }))
        call('perform-update').then((r) => {
          if (r && r.scheduled) {
            if (r.installedVersion) ssSet(DISMISS_KEY, r.installedVersion)
            setState((s) => Object.assign({}, s, {
              updating: false,
              message: r.message || ('已安排更新到 ' + r.installedVersion + '：退出 DSH 后将自动完成安装，随后重新运行 dsh 即可使用新版本'),
              hasUpdate: false
            }))
          } else {
            setState((s) => Object.assign({}, s, { updating: false, error: (r && r.error) || '安排更新失败' }))
          }
        }).catch((e) => {
          setState((s) => Object.assign({}, s, { updating: false, error: String((e && e.message) || e) }))
        })
      }

      function doRepair() {
        setState((s) => Object.assign({}, s, { repairing: true, error: null, message: null, network: null }))
        call('perform-repair').then((r) => {
          if (r && r.scheduled) {
            setState((s) => Object.assign({}, s, {
              repairing: false,
              message: r.message || '已安排修复：退出 DSH 后将自动校验并修复 koffi 原生模块',
              damage: null
            }))
          } else {
            setState((s) => Object.assign({}, s, { repairing: false, error: (r && r.error) || '安排修复失败' }))
          }
        }).catch((e) => {
          setState((s) => Object.assign({}, s, { repairing: false, error: String((e && e.message) || e) }))
        })
      }

      const busy = state.checking || state.updating || state.repairing
      const row = { padding: '12px 0', borderBottom: '1px solid ' + tokens.border }
      const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }
      const title = { fontWeight: '500', color: tokens.text, fontSize: '14px' }
      const secBtn = {
        padding: '4px 12px', border: '1px solid ' + tokens.border, borderRadius: '4px',
        backgroundColor: 'transparent', color: tokens.text2,
        cursor: busy ? 'not-allowed' : 'pointer', fontSize: '13px'
      }
      const primBtn = {
        marginTop: '10px', padding: '6px 16px', border: 'none', borderRadius: '6px',
        backgroundColor: state.updating ? tokens.error : tokens.primaryFill,
        color: tokens.primaryFg, cursor: state.updating ? 'not-allowed' : 'pointer', fontSize: '13px'
      }
      const repairBtn = {
        marginTop: '10px', padding: '6px 16px', border: 'none', borderRadius: '6px',
        backgroundColor: tokens.error, color: '#ffffff',
        cursor: state.repairing ? 'not-allowed' : 'pointer', fontSize: '13px'
      }
      const line = (color, margin) => Object.assign(
        { fontSize: '13px', color: color || tokens.text2, marginTop: margin || '4px' }, {}
      )

      return React.createElement('div', { style: row },
        React.createElement('div', { style: head },
          React.createElement('span', { style: title }, 'DSH 更新'),
          React.createElement('div', { style: { display: 'flex', gap: '8px' } },
            React.createElement('button', {
              onClick: doCheck,
              disabled: busy,
              style: secBtn
            }, state.checking ? '检查中...' : '检查更新'),
            React.createElement('button', {
              onClick: doTestNetwork,
              disabled: busy,
              style: secBtn
            }, '测试网络')
          )
        ),
        state.currentVersion && React.createElement('div', { style: line() }, '当前版本: ' + state.currentVersion),
        state.latestVersion && React.createElement('div', {
          style: line(state.hasUpdate ? tokens.success : tokens.text2)
        }, '最新版本: ' + state.latestVersion),
        state.hasUpdate && React.createElement('div', { style: line(tokens.success) }, '有新版本可用！'),
        state.hasUpdate && React.createElement('button', {
          onClick: doUpdate,
          disabled: busy,
          style: primBtn
        }, state.updating ? '安排中...' : '更新到 ' + state.latestVersion),
        state.damage && React.createElement('div', { style: line(tokens.error) }, state.damage),
        state.damage && React.createElement('button', {
          onClick: doRepair,
          disabled: busy,
          style: repairBtn
        }, state.repairing ? '安排中...' : '安排修复'),
        state.message && React.createElement('div', { style: line(tokens.success) }, state.message),
        (state.message || state.hasUpdate) && React.createElement('div', {
          style: { fontSize: '12px', color: tokens.text3, marginTop: '4px' }
        }, '升级完成后请退出并重新运行 dsh（如 dsh web）以加载新版本'),
        state.error && React.createElement('div', { style: line(tokens.error) }, '错误: ' + state.error),
        state.network && state.network !== 'testing' && React.createElement('div', {
          style: line(state.network.ok ? tokens.success : tokens.error, '8px')
        }, '网络测试: ' + state.network.text),
        state.network === 'testing' && React.createElement('div', { style: line(tokens.text3, '8px') }, '网络测试中…')
      )
    }

    // cordis 插件入口：浏览器侧 loader 会把本 factory 的返回值作为插件应用，
    // 必须是函数或含 apply 方法的对象（见文件头 v1.13.0 说明）。
    function apply(ctx) {
      autoCheck()
      // 调试句柄挂 window（普通对象不能作为模块导出返回）
      if (!window.__dshUpdateChecker) {
        window.__dshUpdateChecker = { recheck: () => call('check-for-updates') }
      }
      // v1.13.1：补回「设置 > 通用 · DSH 更新」设置项入口
      const slots = ctx && (ctx.slots || (typeof ctx.get === 'function' && ctx.get('slots')))
      if (slots && typeof slots.inject === 'function') {
        slots.inject('settings.general.item', () => slots.register({
          name: 'settings.general.item',
          id: 'update-checker',
          order: 30
        }, UpdateSettingsItem))
      }
    }

    return { name: 'dsh-check-for-updates', inject: ['slots'], apply }
  }
})
