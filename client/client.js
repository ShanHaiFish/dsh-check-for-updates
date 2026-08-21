// DSH 更新检查插件 — Client（静态 bundle 形态）v1.12.0
// 首次打开自动检查一次更新（每页一次，跨 HMR 用 window 标志持久）；有新版本时在
// 左下部「设置」按钮上方浮动卡片提示，提供【更新到 {版本}】/【稍后】。
// host 调用走 POST /dsh-update-check/api（JSON {method}）。
// 配色使用 DSH 语义化主题 token（--dsw-alias-*）以兼容第三方主题/亮暗色。
window.__ModuleLoader__.load({
  id: 'dsh-check-for-updates',
  factory: (require) => {
    const DISMISS_KEY = 'dsh-updck-dismissed-version'
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
    function getDismissed() { try { return window.sessionStorage.getItem(DISMISS_KEY) } catch (e) { return null } }
    function setDismissed(v) { try { window.sessionStorage.setItem(DISMISS_KEY, v) } catch (e) { /* ignore */ } }
    function el(tag, style) {
      const node = document.createElement(tag)
      for (const k in style) node.style[k] = style[k]
      return node
    }

    let card = null
    function close() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null }
    function showCard(state) {
      close()
      card = el('div', {
        position: 'fixed', bottom: '96px', left: '16px', zIndex: '10000',
        width: '290px', maxWidth: 'calc(100vw - 32px)', padding: '14px 16px',
        backgroundColor: tokens.bg, border: '1px solid ' + tokens.border, borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', color: tokens.text, fontSize: '13px', lineHeight: '1.5'
      })
      const title = el('div', { fontWeight: '600', marginBottom: '6px' })
      title.textContent = '有新版本可用'
      const line = el('div', { fontSize: '13px', color: tokens.text2, marginBottom: '4px' })
      line.textContent = '当前 ' + (state.currentVersion || '?') + '  →  ' + state.latestVersion
      const hint = el('div', { fontSize: '13px', color: tokens.success })
      hint.textContent = '点击下方按钮立即更新'
      const buttons = el('div', { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' })
      const updBtn = el('button', { padding: '6px 14px', border: 'none', borderRadius: '6px', backgroundColor: tokens.primaryFill, color: tokens.primaryFg, cursor: 'pointer', fontSize: '13px' })
      updBtn.textContent = '更新到 ' + state.latestVersion
      const laterBtn = el('button', { padding: '6px 12px', border: '1px solid ' + tokens.border, borderRadius: '6px', backgroundColor: 'transparent', color: tokens.text2, cursor: 'pointer', fontSize: '13px' })
      laterBtn.textContent = '稍后'
      const statusLine = el('div', { fontSize: '12px', color: tokens.text3, marginTop: '8px' })

      updBtn.addEventListener('click', async () => {
        updBtn.disabled = true
        updBtn.textContent = '更新中...'
        statusLine.textContent = '正在安装 ' + state.latestVersion + '，请稍候…'
        try {
          const r = await call('perform-update')
          if (r && r.updated) { setDismissed(r.installedVersion); close(); return }
          updBtn.disabled = false
          updBtn.textContent = '重试更新'
          statusLine.style.color = tokens.error
          statusLine.textContent = (r && r.error) || '更新失败'
        } catch (e) {
          updBtn.disabled = false
          updBtn.textContent = '重试更新'
          statusLine.style.color = tokens.error
          statusLine.textContent = String((e && e.message) || e)
        }
      })
      laterBtn.addEventListener('click', () => { setDismissed(state.latestVersion); close() })
      buttons.append(updBtn, laterBtn)
      card.append(title, line, hint, buttons, statusLine)
      document.body.appendChild(card)
    }

    async function autoCheck() {
      if (window.__dshUpdckStarted) return
      window.__dshUpdckStarted = true
      try {
        const r = await call('check-for-updates')
        if (r && r.hasUpdate && r.latestVersion && getDismissed() !== r.latestVersion) showCard(r)
      } catch (e) { /* 自动检查失败不打扰用户 */ }
    }

    autoCheck()
    return { __dshUpdateChecker: true, recheck: () => call('check-for-updates') }
  }
})
