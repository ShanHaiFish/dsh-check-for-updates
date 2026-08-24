// DSH 更新检查插件 — Client（静态 bundle 形态）v1.13.0
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
window.__ModuleLoader__.load({
  id: 'dsh-check-for-updates',
  factory: (require) => {
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

    // cordis 插件入口：浏览器侧 loader 会把本 factory 的返回值作为插件应用，
    // 必须是函数或含 apply 方法的对象（见文件头 v1.13.0 说明）。
    function apply(ctx) {
      autoCheck()
      // 调试句柄挂 window（普通对象不能作为模块导出返回）
      if (!window.__dshUpdateChecker) {
        window.__dshUpdateChecker = { recheck: () => call('check-for-updates') }
      }
    }

    return { name: 'dsh-check-for-updates', apply }
  }
})
