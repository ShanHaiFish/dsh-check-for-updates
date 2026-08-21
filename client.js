// DSH 更新检查插件 - 客户端代码
// 版本 v1.10.0
// - 不再在打开设置时自动检查更新（不触发网络请求）。
// - 打开设置时仅显示当前版本（本地读取），
//   只有点击【检查更新】才发起完整的最新版本检查。
// - 检测到新版本时提供【更新】按钮：点击后调用 perform-update，
//   自动安装并显示结果（成功后引导重启 DSH 生效）。

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 状态管理
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
      debug: []
    }

    function setUpdateState(newState) {
      updateState = { ...updateState, ...newState }
      if (updateState.onUpdate) {
        updateState.onUpdate(updateState)
      }
    }

    // 检查更新（仅点击按钮时触发网络请求）
    async function checkForUpdates() {
      if (updateState.checking || updateState.updating) return
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

    // 自动更新（点击后执行安装）
    async function performUpdate() {
      if (updateState.updating) return
      setUpdateState({ updating: true, error: null, updateMessage: null, logTail: null })
      try {
        const result = await host.call('perform-update')
        if (result && result.updated) {
          setUpdateState({
            updating: false,
            updateMessage: result.message,
            latestVersion: result.installedVersion,
            hasUpdate: false,
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

    // 注册设置项
    slots.inject('settings.general.item', () => {
      slots.register(
        { name: 'settings.general.item', id: 'update-checker', order: 30 },
        (props) => {
          const [state, setState] = React.useState(updateState)

          React.useEffect(() => {
            updateState.onUpdate = setState
            return () => {
              updateState.onUpdate = null
            }
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

          return React.createElement('div', {
            style: {
              padding: '12px 0',
              borderBottom: '1px solid #eee'
            }
          },
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }
            },
              React.createElement('span', {
                style: {
                  fontWeight: '500'
                }
              }, 'DSH 更新'),
              React.createElement('div', {
                style: {
                  display: 'flex',
                  gap: '8px'
                }
              },
                React.createElement('button', {
                  onClick: checkForUpdates,
                  disabled: state.checking || state.updating,
                  style: {
                    padding: '4px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    backgroundColor: state.checking ? '#f5f5f5' : 'white',
                    cursor: state.checking ? 'not-allowed' : 'pointer',
                    fontSize: '14px'
                  }
                }, state.checking ? '检查中...' : '检查更新'),
                React.createElement('button', {
                  onClick: testNetwork,
                  style: {
                    padding: '4px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    backgroundColor: '#f8f9fa',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }
                }, '测试网络')
              )
            ),
            state.currentVersion && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#666',
                marginBottom: '4px'
              }
            }, '当前版本: ' + state.currentVersion),
            state.latestVersion && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: state.hasUpdate ? '#28a745' : '#666'
              }
            }, '最新版本: ' + state.latestVersion),
            state.hasUpdate && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#28a745',
                marginTop: '4px'
              }
            }, '有新版本可用！'),
            state.hasUpdate && React.createElement('button', {
              onClick: performUpdate,
              disabled: state.updating,
              style: {
                marginTop: '10px',
                padding: '6px 16px',
                border: 'none',
                borderRadius: '4px',
                backgroundColor: state.updating ? '#f5a623' : '#007bff',
                color: 'white',
                cursor: state.updating ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }
            }, state.updating ? '更新中...' : '更新到 ' + state.latestVersion),
            state.updateMessage && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#28a745',
                marginTop: '6px'
              }
            }, state.updateMessage),
            (state.updateMessage || state.hasUpdate) && React.createElement('div', {
              style: {
                fontSize: '12px',
                color: '#888',
                marginTop: '4px'
              }
            }, '升级完成后请重启 DSH（重新运行启动命令，如 dsh web）以加载新版本'),
            state.error && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#dc3545',
                marginTop: '6px'
              }
            }, '错误: ' + state.error),
            state.lastChecked && React.createElement('div', {
              style: {
                fontSize: '12px',
                color: '#999',
                marginTop: '4px'
              }
            }, '上次检查: ' + state.lastChecked.toLocaleString()),
            state.logTail && React.createElement('details', {
              style: {
                marginTop: '8px',
                fontSize: '12px',
                color: '#999'
              }
            },
              React.createElement('summary', null, '执行日志'),
              React.createElement('pre', {
                style: {
                  margin: '8px 0 0 0',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: '11px',
                  lineHeight: '1.5',
                  maxHeight: '200px',
                  overflow: 'auto'
                }
              }, state.logTail)
            ),
            state.debug && state.debug.length > 0 && React.createElement('details', {
              style: {
                marginTop: '8px',
                fontSize: '12px',
                color: '#999'
              }
            },
              React.createElement('summary', null, '调试信息 (' + state.debug.length + ' 条)'),
              React.createElement('pre', {
                style: {
                  margin: '8px 0 0 0',
                  padding: '8px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: '11px',
                  lineHeight: '1.5'
                }
              }, state.debug.join('\n'))
            )
          )
        }
      )
    })
  }
}
