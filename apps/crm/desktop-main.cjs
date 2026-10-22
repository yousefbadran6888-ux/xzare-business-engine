module.exports = function launch(appDirectory, product) {
  if (
    ![
      'pos',
      'restaurant',
      'accounting',
      'inventory',
      'manufacturing',
      'workshop',
      'service-center',
      'clinic',
      'laboratory',
      'pharmacy',
      'hr',
      'crm',
    ].includes(product)
  )
    throw new Error('Invalid desktop product')
  const label =
    product === 'crm'
      ? 'Xzare CRM'
      : product === 'hr'
        ? 'Xzare HR'
        : product === 'pharmacy'
          ? 'Xzare Pharmacy'
          : product === 'laboratory'
            ? 'Xzare Laboratory'
            : product === 'clinic'
              ? 'Xzare Clinic'
              : product === 'service-center'
                ? 'Xzare Service Center'
                : product === 'workshop'
                  ? 'Xzare Workshop'
                  : product === 'manufacturing'
                    ? 'Xzare Manufacturing'
                    : product === 'inventory'
                      ? 'Xzare Inventory'
                      : product === 'accounting'
                        ? 'Xzare Accounting'
                        : product === 'restaurant'
                          ? 'Xzare Restaurant'
                          : 'Xzare POS'
  const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
  const { readFileSync } = require('node:fs')
  const { join } = require('node:path')
  const { pathToFileURL } = require('node:url')
  const { execFileSync } = require('node:child_process')
  const { randomUUID } = require('node:crypto')
  const os = require('node:os')
  const qa = !app.isPackaged && process.env.XZARE_TEST === '1'
  if (
    app.isPackaged &&
    ['no-sandbox', 'remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk'].some(
      (flag) => app.commandLine.hasSwitch(flag),
    )
  )
    app.exit(1)
  // QA data is isolated explicitly; installed application data survives upgrades/uninstall.
  if (!app.isPackaged && process.env.XZARE_DATA_DIR) {
    app.setPath('userData', process.env.XZARE_DATA_DIR)
    app.setPath('sessionData', join(process.env.XZARE_DATA_DIR, 'browser'))
  }
  let runtime,
    window,
    token = null,
    timer
  if (qa) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('in-process-gpu')
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (window) {
        if (window.isMinimized()) window.restore()
        window.focus()
      }
    })
    app
      .whenReady()
      .then(async () => {
        if (qa)
          app.on('child-process-gone', (_event, details) =>
            console.log('QA CHILD', details.type, details.reason, details.exitCode),
          )
        const { Runtime, publicError, OnlineLicense, httpsTransport } =
          await import('@xzare/engine')
        if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable())
          throw new Error('Windows license protection unavailable')
        const issuer = readFileSync(join(appDirectory, 'license-public-key.pem'), 'utf8')
        const config = JSON.parse(readFileSync(join(appDirectory, 'licensing.json'), 'utf8'))
        let bootId
        try {
          // Supported Windows installs use C:\Windows. Never execute caller-controlled SystemRoot/PSModulePath helpers.
          const system = 'C:\\Windows'
          bootId = execFileSync(
            join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              "$ErrorActionPreference='Stop'; $PSModuleAutoLoadingPreference='None'; Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -Force; Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\CimCmdlets\\CimCmdlets.psd1' -Force; (CimCmdlets\\Get-CimInstance -ClassName Win32_OperatingSystem -Property LastBootUpTime).LastBootUpTime.ToUniversalTime().Ticks.ToString()",
            ],
            {
              encoding: 'utf8',
              windowsHide: true,
              timeout: 7000,
              stdio: ['ignore', 'pipe', 'ignore'],
              env: {
                SystemRoot: system,
                WINDIR: system,
                PATH: join(system, 'System32'),
                PSModulePath: join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
              },
            },
          ).trim()
          if (!/^\d{10,22}$/.test(bootId)) throw new Error('Boot clock unavailable')
        } catch {
          bootId = randomUUID()
        } // Fail closed: renew after each launch if Windows boot identity is unavailable.
        const licensing = new OnlineLicense(
          app.getPath('userData'),
          issuer,
          {
            seal: (value) => safeStorage.encryptString(value),
            open: (value) => safeStorage.decryptString(value),
          },
          config.origin ? httpsTransport(config.origin) : null,
          Date.now,
          {
            uptime: () => os.uptime() * 1000,
            bootId,
            requireOnlineAfterReboot: config.requireOnlineAfterReboot !== false,
          },
          product === 'crm'
            ? 'xzare-crm'
            : product === 'hr'
              ? 'xzare-hr'
              : product === 'pharmacy'
                ? 'xzare-pharmacy'
                : product === 'laboratory'
                  ? 'xzare-laboratory'
                  : product === 'clinic'
                    ? 'xzare-clinic'
                    : product === 'service-center'
                      ? 'xzare-service-center'
                      : product === 'workshop'
                        ? 'xzare-workshop'
                        : product === 'manufacturing'
                          ? 'xzare-manufacturing'
                          : product === 'inventory'
                            ? 'xzare-inventory'
                            : product === 'accounting'
                              ? 'xzare-accounting'
                              : product === 'restaurant'
                                ? 'xzare-restaurant'
                                : 'xzare-pos',
        )
        runtime = new Runtime(app.getPath('userData'), issuer, licensing.device, licensing, product)
        window = new BrowserWindow({
          width: 1440,
          height: 960,
          minWidth: 1024,
          minHeight: 720,
          title: label,
          icon: join(appDirectory, 'build', 'icon.ico'),
          show: !qa,
          autoHideMenuBar: true,
          backgroundColor: '#f5f8fa',
          webPreferences: {
            preload: join(appDirectory, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: false,
            devTools: qa,
          },
        })
        const index = pathToFileURL(join(appDirectory, 'dist', 'index.html')).href
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        if (qa) {
          console.log('QA WINDOW', index)
          window.webContents.on('render-process-gone', (_event, details) =>
            console.log('QA RENDERER', details.reason, details.exitCode),
          )
          window.webContents.on('did-fail-load', (_event, code, message) =>
            console.log('QA LOAD', code, message),
          )
        }
        window.webContents.on('will-navigate', (event, url) => {
          if (url !== index) event.preventDefault()
        })
        window.webContents.on('will-attach-webview', (event) => event.preventDefault())
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false),
        )
        window.webContents.session.setPermissionCheckHandler(() => false)
        ipcMain.handle('xzare:call', async (event, action, payload) => {
          try {
            if (
              event.sender !== window.webContents ||
              event.senderFrame !== window.webContents.mainFrame ||
              event.senderFrame.url !== index
            )
              throw new Error('طلب غير مسموح')
            if (
              typeof action !== 'string' ||
              Buffer.byteLength(JSON.stringify(payload ?? {})) >
                (['laboratory', 'hr', 'crm'].includes(product) ? 1024 * 1024 : 65536)
            )
              throw new Error('حجم الطلب غير مسموح')
            let value
            if (action === 'backup.create') {
              runtime.engine.identity.require(token, 'admin')
              const choice = await dialog.showSaveDialog(window, {
                title: 'حفظ نسخة احتياطية',
                defaultPath: `Xzare-${new Date().toISOString().slice(0, 10)}.xzbak`,
                filters: [{ name: 'Xzare backup', extensions: ['xzbak'] }],
              })
              value = choice.canceled
                ? { cancelled: true }
                : await runtime.backup(token, choice.filePath)
            } else if (action === 'backup.restore') {
              runtime.engine.identity.require(token, 'admin')
              if (!payload || Object.keys(payload).some((k) => k !== 'password'))
                throw new Error('بيانات غير صالحة')
              const choice = await dialog.showOpenDialog(window, {
                title: 'اختيار النسخة المراد استعادتها',
                properties: ['openFile'],
                filters: [{ name: 'Xzare backup', extensions: ['xzbak'] }],
              })
              if (choice.canceled) return { ok: true, value: { cancelled: true } }
              await runtime.restore(token, payload.password, choice.filePaths[0])
              token = null
              value = { restored: true }
            } else {
              if (!runtime.actions.has(action)) throw new Error('العملية غير متاحة')
              value = await runtime.call(action, payload, token)
              if (action === 'setup' || action === 'login') {
                token = value.token
                value = { authenticated: true }
              }
              if (action === 'logout' || action === 'password.change') token = null
            }
            return { ok: true, value }
          } catch (error) {
            return { ok: false, error: publicError(error) }
          }
        })
        await window.loadURL(index)
        await runtime.dailyBackup()
        runtime.refreshLicense().catch(() => {})
        timer = setInterval(() => {
          runtime.dailyBackup().catch(() => {})
          runtime.refreshLicense().catch(() => {})
        }, 60 * 60000)
      })
      .catch((error) => {
        if (qa) console.error('QA STARTUP', error)
        else
          dialog.showErrorBox(
            label,
            'تعذر فتح قاعدة البيانات. احتفظ بملفات البيانات والنسخ الاحتياطية وتواصل مع hello@xzare.com',
          )
        app.quit()
      })
    app.on('window-all-closed', () => app.quit())
    let quitting = false
    app.on('before-quit', (event) => {
      clearInterval(timer)
      if (runtime && !quitting) {
        event.preventDefault()
        runtime.shutdown().finally(() => {
          quitting = true
          app.quit()
        })
      }
    })
  }
}
