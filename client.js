// DSH 更新检查插件 - 客户端代码
// 版本 v1.12.0
// 主题适配：不再使用硬编码颜色，全部改用 DSH 语义化主题 token（--dsw-alias-*）。
// 这样在用户安装其它主题插件、或切换亮/暗色时，本插件 UI 自动跟随整体配色，
// 与设置页其它项目保持一致。对不确定存在的 token 使用 var(--a, fallback) 兜底。
//
// v1.12.0 新增：
//   - 首次打开 Web 页面时自动触发一次更新检查（页面加载即检查，单次，不随 HMR 重复）。
//   - 检测到新版本时，在左下部「设置」按钮上方弹出提示卡片（shell.overlay），
//     卡片内提供【更新到 {版本}】主按钮与【稍后】次级按钮。
//   - 状态订阅改为多监听器（listeners: Set），让「设置项」与「弹窗」两个组件
//     同时实时刷新，互不覆盖。
//
// 关键映射（与官方设置 UI 一致）：
//   主按钮背景 var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))
//   主按钮文字 var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-1))
//   成功/有新版本 var(--dsw-alias-state-success-primary)
//   错误 var(--dsw-alias-state-error-primary)   警告/更新中 var(--dsw-alias-state-warn-primary)
//   次级按钮/边框 var(--dsw-alias-border-l2)     表面 var(--dsw-alias-bg-layer-*)
//   正文 var(--dsw-alias-label-primary) 次要 label-secondary 弱化 label-tertiary

// 模块作用域标志：保证「首次打开自动检查」每个页面加载只执行一次（跨 HMR 持久）。
let autoStarted = false

// 弹窗「稍后」记住的版本号（sessionStorage），同版本不重复弹窗。
const DISMISS_KEY = 'dsh-updck-dismissed-version'

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 状态管理（多监听器）
    let updateState = {
      currentVersion: null,
      latestVersion: null,
      hasUpdate: false,
      checking: false,
      updating: false,
      error: null,
      updateMessage: null,
      logTail: null,
      lastChecked: null,
      popupVisible: false,
      debug: []
    }

    const listeners = new Set()

    function setUpdateState(newState) {
      updateState = { ...updateState, ...newState }
      for (const l of listeners) l(updateState)
    }

    // 检查更新（点击按钮或首次打开页面时触发网络请求）
    async function checkForUpdates() {
      if (updateState.checking || updateState.updating) return null
      setUpdateState({ checking: true, error: null })
      try {
        const result = await host.call('check-for-updates')
        setUpdateState({
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          hasUpdate: result.hasUpdate,
          checking: false,
          error: result.error,
          lastChecked: new Date(),
          debug: result.debug || []
        })
        return result
      } catch (e) {
        setUpdateState({
          checking: false,
          error: e.message
        })
        return null
      }
    }

    // 首次打开页面：自动检查一次；若有更新且本会话未「稍后」过该版本，则弹出提示。
    async function autoCheck() {
      const result = await checkForUpdates()
      if (!result || !result.hasUpdate) return
      let dismissed = null
      try { dismissed = sessionStorage.getItem(DISMISS_KEY) } catch (e) { dismissed = null }
      if (dismissed !== result.latestVersion) {
        setUpdateState({ popupVisible: true })
      }
    }

    // 关闭弹窗（记住版本，同版本不再弹出）
    function dismissPopup() {
      try { sessionStorage.setItem(DISMISS_KEY, updateState.latestVersion || '') } catch (e) { /* ignore */ }
      setUpdateState({ popupVisible: false })
    }

    // 自动更新（点击后执行安装）
    async function performUpdate() {
      if (updateState.updating) return
      setUpdateState({ updating: true, error: null, updateMessage: null, logTail: null })
      try {
        const result = await host.call('perform-update')
        if (result && result.updated) {
          try { sessionStorage.setItem(DISMISS_KEY, result.installedVersion || '') } catch (e) { /* ignore */ }
          setUpdateState({
            updating: false,
            updateMessage: result.message,
            latestVersion: result.installedVersion,
            hasUpdate: false,
            popupVisible: false,
            logTail: result.logTail
          })
        } else {
          setUpdateState({
            updating: false,
            error: (result && result.error) || '更新失败',
            logTail: result && result.logTail
          })
        }
      } catch (e) {
        setUpdateState({ updating: false, error: e.message })
      }
    }

    // 测试网络
    async function testNetwork() {
      console.log('测试网络连接...')
      try {
        const result = await host.call('test-network')
        console.log('网络测试结果:', result)
        if (result.success) {
          alert('网络测试成功！' + (result.message ? ' ' + result.message : ''))
        } else {
          alert('网络测试失败: ' + result.error)
        }
      } catch (e) {
        console.error('网络测试失败:', e)
        alert('网络测试失败: ' + e.message)
      }
    }

    // 主题变量引用（含兜底，保证任意主题下可用）
    const V = {
      border: 'var(--dsw-alias-border-l2)',
      borderSoft: 'var(--dsw-alias-border-l1)',
      bgLayer1: 'var(--dsw-alias-bg-layer-1)',
      bgLayer2: 'var(--dsw-alias-bg-layer-2)',
      bgModule: 'var(--dsw-alias-bg-module-platform)',
      textSecondary: 'var(--dsw-alias-label-secondary)',
      textTertiary: 'var(--dsw-alias-label-tertiary)',
      textPrimary: 'var(--dsw-alias-label-primary, inherit)',
      success: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      // 主按钮：fill/foreground 若当前主题未定义则回落品牌色/亮底
      primaryFill: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
      primaryHover: 'var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary))',
      primaryForeground: 'var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-1))'
    }

    function rowSeparator() {
      return { padding: '12px 0', borderBottom: '1px solid ' + V.borderSoft }
    }
    function secondaryButtonStyle(active) {
      return {
        padding: '4px 12px',
        border: '1px solid ' + V.border,
        borderRadius: '4px',
        backgroundColor: active ? V.bgModule : 'transparent',
        color: V.textSecondary,
        cursor: active ? 'not-allowed' : 'pointer',
        fontSize: '14px'
      }
    }
    function primaryButtonStyle(progress) {
      return {
        marginTop: '10px',
        padding: '6px 16px',
        border: 'none',
        borderRadius: '4px',
        backgroundColor: progress ? V.warn : V.primaryFill,
        color: V.primaryForeground,
        cursor: progress ? 'not-allowed' : 'pointer',
        fontSize: '14px'
      }
    }
    function logBlockStyle() {
      return {
        margin: '8px 0 0 0',
        padding: '8px',
        backgroundColor: V.bgLayer2,
        borderRadius: '4px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontSize: '11px',
        lineHeight: '1.5',
        color: V.textTertiary
      }
    }
    // 弹出卡片（设置按钮上方）样式
    function popupCardStyle() {
      return {
        position: 'fixed',
        bottom: '96px',
        left: '16px',
        zIndex: 10000,
        width: '290px',
        maxWidth: 'calc(100vw - 32px)',
        padding: '14px 16px',
        backgroundColor: V.bgLayer1,
        border: '1px solid ' + V.border,
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: V.textPrimary,
        fontSize: '13px',
        lineHeight: '1.5'
      }
    }

    // ---------- 弹窗：左下部「设置」按钮上方提示 ----------
    if (slots) {
      slots.inject('shell.overlay', () => {
        slots.register(
          { name: 'shell.overlay', id: 'update-checker-popup', order: 10 },
          () => {
            const [state, setState] = React.useState(updateState)
            React.useEffect(() => {
              listeners.add(setState)
              return () => listeners.delete(setState)
            }, [])
            if (!state.popupVisible || !state.hasUpdate) return null

            return React.createElement('div', { style: popupCardStyle() },
              React.createElement('div', {
                style: { fontWeight: '600', marginBottom: '6px', color: V.textPrimary }
              }, '有新版本可用'),
              React.createElement('div', {
                style: { fontSize: '13px', color: V.textSecondary, marginBottom: '4px' }
              }, '当前 ' + (state.currentVersion || '?') + '  →  ' + state.latestVersion),
              React.createElement('div', {
                style: { fontSize: '13px', color: V.success }
              }, '点击下方按钮立即更新'),
              React.createElement('div', {
                style: { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }
              },
                React.createElement('button', {
                  onClick: performUpdate,
                  disabled: state.updating,
                  style: {
                    padding: '6px 14px',
                    border: 'none',
                    borderRadius: '6px',
                    backgroundColor: state.updating ? V.warn : V.primaryFill,
                    color: V.primaryForeground,
                    cursor: state.updating ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }
                }, state.updating ? '更新中...' : '更新到 ' + state.latestVersion),
                React.createElement('button', {
                  onClick: dismissPopup,
                  disabled: state.updating,
                  style: secondaryButtonStyle(state.updating)
                }, '稍后')
              ),
              state.updating && React.createElement('div', {
                style: { fontSize: '12px', color: V.textTertiary, marginTop: '8px' }
              }, '正在安装 ' + state.latestVersion + '，请稍候…'),
              state.updateMessage && React.createElement('div', {
                style: { fontSize: '12px', color: V.success, marginTop: '8px' }
              }, state.updateMessage),
              state.error && React.createElement('div', {
                style: { fontSize: '12px', color: V.error, marginTop: '8px' }
              }, '错误: ' + state.error)
            )
          }
        )
      })
    }

    // ---------- 注册设置项 ----------
    slots.inject('settings.general.item', () => {
      slots.register(
        { name: 'settings.general.item', id: 'update-checker', order: 30 },
        () => {
          const [state, setState] = React.useState(updateState)

          React.useEffect(() => {
            listeners.add(setState)
            return () => listeners.delete(setState)
          }, [])

          // 打开设置时只显示当前版本（本地读取），不触发网络检查
          React.useEffect(() => {
            let cancelled = false
            host.call('get-current-version')
              .then((v) => {
                if (!cancelled) setUpdateState({ currentVersion: v })
              })
              .catch(() => {})
            return () => { cancelled = true }
          }, [])

          return React.createElement('div', { style: rowSeparator() },
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }
            },
              React.createElement('span', {
                style: { fontWeight: '500', color: V.textPrimary }
              }, 'DSH 更新'),
              React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                React.createElement('button', {
                  onClick: checkForUpdates,
                  disabled: state.checking || state.updating,
                  style: secondaryButtonStyle(state.checking || state.updating)
                }, state.checking ? '检查中...' : '检查更新'),
                React.createElement('button', {
                  onClick: testNetwork,
                  style: {
                    padding: '4px 8px',
                    border: '1px solid ' + V.border,
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: V.textSecondary,
                    cursor: 'pointer',
                    fontSize: '12px'
                  }
                }, '测试网络')
              )
            ),
            state.currentVersion && React.createElement('div', {
              style: { fontSize: '14px', color: V.textSecondary, marginBottom: '4px' }
            }, '当前版本: ' + state.currentVersion),
            state.latestVersion && React.createElement('div', {
              style: { fontSize: '14px', color: state.hasUpdate ? V.success : V.textSecondary }
            }, '最新版本: ' + state.latestVersion),
            state.hasUpdate && React.createElement('div', {
              style: { fontSize: '14px', color: V.success, marginTop: '4px' }
            }, '有新版本可用！'),
            state.hasUpdate && React.createElement('button', {
              onClick: performUpdate,
              disabled: state.updating,
              style: primaryButtonStyle(state.updating)
            }, state.updating ? '更新中...' : '更新到 ' + state.latestVersion),
            state.updateMessage && React.createElement('div', {
              style: { fontSize: '14px', color: V.success, marginTop: '6px' }
            }, state.updateMessage),
            (state.updateMessage || state.hasUpdate) && React.createElement('div', {
              style: { fontSize: '12px', color: V.textTertiary, marginTop: '4px' }
            }, '升级完成后请重启 DSH（重新运行启动命令，如 dsh web）以加载新版本'),
            state.error && React.createElement('div', {
              style: { fontSize: '14px', color: V.error, marginTop: '6px' }
            }, '错误: ' + state.error),
            state.lastChecked && React.createElement('div', {
              style: { fontSize: '12px', color: V.textTertiary, marginTop: '4px' }
            }, '上次检查: ' + state.lastChecked.toLocaleString()),
            state.logTail && React.createElement('details', {
              style: { marginTop: '8px', fontSize: '12px', color: V.textTertiary }
            },
              React.createElement('summary', null, '执行日志'),
              React.createElement('pre', Object.assign({ maxHeight: '200px', overflow: 'auto' }, logBlockStyle()), state.logTail)
            ),
            state.debug && state.debug.length > 0 && React.createElement('details', {
              style: { marginTop: '8px', fontSize: '12px', color: V.textTertiary }
            },
              React.createElement('summary', null, '调试信息 (' + state.debug.length + ' 条)'),
              React.createElement('pre', logBlockStyle(), state.debug.join('\n'))
            )
          )
        }
      )
    })

    // 首次打开页面：触发一次自动检查
    if (!autoStarted) {
      autoStarted = true
      autoCheck()
    }
  }
}
