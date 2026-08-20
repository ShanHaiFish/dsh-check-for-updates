// DSH 更新检查插件 - 客户端代码
// 负责在设置中显示更新状态和弹窗提示

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
      error: null,
      lastChecked: null
    }
    
    // 更新状态
    function setUpdateState(newState) {
      updateState = { ...updateState, ...newState }
      // 触发UI更新
      if (updateState.onUpdate) {
        updateState.onUpdate(updateState)
      }
    }
    
    // 检查更新
    async function checkForUpdates() {
      setUpdateState({ checking: true, error: null })
      try {
        const result = await host.call('check-for-updates')
        setUpdateState({
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          hasUpdate: result.hasUpdate,
          checking: false,
          error: result.error,
          lastChecked: new Date()
        })
        
        // 如果有更新，显示弹窗
        if (result.hasUpdate) {
          showUpdateModal(result)
        }
        
        return result
      } catch (e) {
        setUpdateState({
          checking: false,
          error: e.message
        })
        return null
      }
    }
    
    // 显示更新弹窗
    function showUpdateModal(updateInfo) {
      // 注册覆盖层
      slots.inject('shell.overlay', () => {
        slots.register(
          { name: 'shell.overlay', id: 'update-modal' },
          (props) => {
            return React.createElement('div', {
              style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000
              }
            },
              React.createElement('div', {
                style: {
                  backgroundColor: 'white',
                  borderRadius: '8px',
                  padding: '24px',
                  maxWidth: '400px',
                  width: '90%',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                }
              },
                React.createElement('h3', {
                  style: {
                    margin: '0 0 16px 0',
                    fontSize: '18px',
                    fontWeight: '600'
                  }
                }, '发现新版本'),
                React.createElement('p', {
                  style: {
                    margin: '0 0 8px 0',
                    color: '#666'
                  }
                }, `当前版本: ${updateInfo.currentVersion}`),
                React.createElement('p', {
                  style: {
                    margin: '0 0 20px 0',
                    color: '#666'
                  }
                }, `最新版本: ${updateInfo.latestVersion}`),
                React.createElement('div', {
                  style: {
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                  }
                },
                  React.createElement('button', {
                    onClick: () => {
                      // 关闭弹窗
                      slots.inject('shell.overlay', () => {
                        slots.register(
                          { name: 'shell.overlay', id: 'update-modal' },
                          () => null
                        )
                      })
                    },
                    style: {
                      padding: '8px 16px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      backgroundColor: 'white',
                      cursor: 'pointer'
                    }
                  }, '稍后再说'),
                  React.createElement('button', {
                    onClick: () => {
                      // 打开npm页面
                      window.open('https://www.npmjs.com/package/@deepseek-ai/dsh', '_blank')
                      // 关闭弹窗
                      slots.inject('shell.overlay', () => {
                        slots.register(
                          { name: 'shell.overlay', id: 'update-modal' },
                          () => null
                        )
                      })
                    },
                    style: {
                      padding: '8px 16px',
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      cursor: 'pointer'
                    }
                  }, '立即更新')
                )
              )
            )
          }
        )
      })
    }
    
    // 注册设置项
    slots.inject('settings.general.item', () => {
      slots.register(
        { name: 'settings.general.item', id: 'update-checker', order: 30 },
        (props) => {
          const [state, setState] = React.useState(updateState)
          
          // 订阅状态更新
          React.useEffect(() => {
            updateState.onUpdate = setState
            return () => {
              updateState.onUpdate = null
            }
          }, [])
          
          // 初始检查
          React.useEffect(() => {
            checkForUpdates()
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
              React.createElement('button', {
                onClick: checkForUpdates,
                disabled: state.checking,
                style: {
                  padding: '4px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: state.checking ? '#f5f5f5' : 'white',
                  cursor: state.checking ? 'not-allowed' : 'pointer',
                  fontSize: '14px'
                }
              }, state.checking ? '检查中...' : '检查更新')
            ),
            state.currentVersion && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#666',
                marginBottom: '4px'
              }
            }, `当前版本: ${state.currentVersion}`),
            state.latestVersion && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: state.hasUpdate ? '#28a745' : '#666'
              }
            }, `最新版本: ${state.latestVersion}`),
            state.hasUpdate && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#28a745',
                marginTop: '4px'
              }
            }, '有新版本可用！'),
            state.error && React.createElement('div', {
              style: {
                fontSize: '14px',
                color: '#dc3545',
                marginTop: '4px'
              }
            }, `错误: ${state.error}`),
            state.lastChecked && React.createElement('div', {
              style: {
                fontSize: '12px',
                color: '#999',
                marginTop: '4px'
              }
            }, `上次检查: ${state.lastChecked.toLocaleString()}`)
          )
        }
      )
    })
  }
}
