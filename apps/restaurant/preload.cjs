const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld(
  'xzare',
  Object.freeze({
    call: async (action, payload = {}) => {
      const result = await ipcRenderer.invoke('xzare:call', action, payload)
      if (!result.ok) {
        const error = new Error(result.error)
        if (result.code === 'DEVICE_QUOTA_EXCEEDED' && Array.isArray(result.devices)) error.devices = result.devices.slice(0, 2)
        throw error
      }
      return result.value
    },
  }),
)
