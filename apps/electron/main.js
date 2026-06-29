const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, protocol, net: electronNet } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const os = require('os')
const fs = require('fs')
const url = require('url')

// ── Paths ─────────────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData')

function _devProjectRoot() {
  if (process.env.VEX_DIR) return process.env.VEX_DIR
  const persist = path.join(USER_DATA, 'vex-project-root.txt')
  try {
    const p = fs.readFileSync(persist, 'utf8').trim()
    if (p && fs.existsSync(path.join(p, 'apps', 'api', 'main.py'))) return p
  } catch {}
  for (const c of [
    path.join(os.homedir(), 'Desktop', 'Vex'),
    path.join(os.homedir(), 'Desktop', 'vex'),
    path.join(os.homedir(), 'Desktop', 'netindavoid'),
    path.join(os.homedir(), 'Vex'),
    path.join(os.homedir(), 'vex'),
    path.join(os.homedir(), 'netindavoid'),
  ]) {
    if (fs.existsSync(path.join(c, 'apps', 'api', 'main.py'))) return c
  }
  return null
}

// Bundled Python runtime (inside app bundle on release, system python3 on dev)
const PYTHON_HOME = app.isPackaged
  ? path.join(process.resourcesPath, 'python-runtime')
  : null

const API_PYTHON = app.isPackaged
  ? path.join(process.resourcesPath, 'python-runtime', 'bin', 'python3')
  : 'python3'

const API_SRC = app.isPackaged
  ? path.join(process.resourcesPath, 'api-src')
  : path.join(_devProjectRoot() || path.join(os.homedir(), 'Desktop', 'Vex'), 'apps', 'api')

// SQLite database lives in userData — persists across app updates
const DB_PATH = path.join(USER_DATA, 'vex.db')
const DB_URL  = `sqlite+aiosqlite:////${DB_PATH}`

// Static web files
const WEB_OUT = app.isPackaged
  ? path.join(process.resourcesPath, 'web-out')
  : path.join(API_SRC, '..', '..', 'web', 'out')

let mainWindow = null
let tray = null
let apiProc = null
let isQuitting = false
let apiLastError = ''

// ── Register app:// scheme BEFORE app is ready ────────────────────────────────
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}])

// ── Loading status helper ─────────────────────────────────────────────────────
function setStatus(win, text) {
  if (!win || win.isDestroyed()) return
  win.webContents.executeJavaScript(
    `document.getElementById('status').textContent = ${JSON.stringify(text)}`
  ).catch(() => {})
}

// ── API process ───────────────────────────────────────────────────────────────
function startAPI() {
  // Ensure userData exists (SQLite db will be created here)
  try { fs.mkdirSync(USER_DATA, { recursive: true }) } catch (_) {}

  const env = {
    ...process.env,
    // Point Python to its bundled home so it finds stdlib + site-packages
    ...(PYTHON_HOME ? { PYTHONHOME: PYTHON_HOME } : {}),
    NODE_ENV:       'production',
    DATABASE_URL:   DB_URL,
    // Structured logging: plain output for Electron's console
    PYTHONUNBUFFERED: '1',
  }

  apiProc = spawn(API_PYTHON, [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', '8000',
    '--workers', '1',
  ], { cwd: API_SRC, env })

  apiProc.stderr.on('data', (d) => {
    const line = d.toString().trim()
    console.error('[API]', line)
    if (line) apiLastError = line
  })
  apiProc.stdout.on('data', (d) => console.log('[API]', d.toString().trim()))
  apiProc.on('error', (e) => { apiLastError = e.message })
  apiProc.on('exit', (code) => {
    if (!isQuitting) console.warn('API exited with code', code)
  })

  return apiProc
}

function killAll() {
  isQuitting = true
  if (apiProc) { try { apiProc.kill('SIGTERM') } catch (_) {} }
}

function waitForAPI(timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs

    if (apiProc) {
      apiProc.once('exit', (code) => {
        if (!isQuitting) reject(new Error(`API process exited (code ${code})\n\n${apiLastError}`))
      })
    }

    const check = () => {
      http.get('http://127.0.0.1:8000/health', (res) => {
        res.resume()
        if (res.statusCode < 500) return resolve()
        if (Date.now() > deadline) return reject(new Error(`API health check timed out.\n\n${apiLastError}`))
        setTimeout(check, 1500)
      }).on('error', () => {
        if (Date.now() > deadline) {
          return reject(new Error(
            `API did not start within ${timeoutMs / 1000}s.\n\nLast error: ${apiLastError || 'none'}`
          ))
        }
        setTimeout(check, 1500)
      })
    }
    check()
  })
}

// ── app:// protocol handler ───────────────────────────────────────────────────
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    let { pathname } = new URL(request.url)
    pathname = decodeURIComponent(pathname)

    if (pathname === '/' || pathname === '') {
      return electronNet.fetch(url.pathToFileURL(path.join(WEB_OUT, 'index.html')).href)
    }

    const exact = path.join(WEB_OUT, pathname)
    if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
      return electronNet.fetch(url.pathToFileURL(exact).href)
    }

    const asDir = path.join(WEB_OUT, pathname.replace(/\/$/, ''), 'index.html')
    if (fs.existsSync(asDir)) {
      return electronNet.fetch(url.pathToFileURL(asDir).href)
    }

    return electronNet.fetch(url.pathToFileURL(path.join(WEB_OUT, 'index.html')).href)
  })
}

// ── Loading screen ────────────────────────────────────────────────────────────
function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#111111',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, 'build', 'icon.icns'),
  })
  win.loadFile(path.join(__dirname, 'loading.html'))
  return win
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 11 },
    backgroundColor: '#111111',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  })

  mainWindow.loadURL('app://localhost')
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide() }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u)
    return { action: 'deny' }
  })
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const trayPng = path.join(__dirname, 'build', 'tray-icon.png')
  const img = nativeImage.createFromPath(trayPng)
  tray = new Tray(img)
  tray.setToolTip('Vex')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Vex', click: () => { mainWindow?.show() } },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdatesAndNotify() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => mainWindow?.show())
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update Available',
      message: 'A new version of Vex is downloading in the background.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update Ready',
      message: 'Update downloaded. Vex will restart to apply it.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall() }
    })
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000)
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
function isAPIAlreadyUp() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:8000/health', (res) => {
      res.resume()
      resolve(res.statusCode < 500)
    }).on('error', () => resolve(false))
  })
}

app.whenReady().then(async () => {
  registerAppProtocol()

  const loading = createLoadingWindow()
  await new Promise(r => setTimeout(r, 300))

  const alreadyUp = await isAPIAlreadyUp()
  if (!alreadyUp) {
    setStatus(loading, 'Starting Vex…')
    const proc = startAPI()

    proc.stderr.on('data', (d) => {
      const line = d.toString().trim().split('\n').pop() || ''
      if (line && !line.includes('DeprecationWarning')) {
        setStatus(loading, line.length > 60 ? line.slice(0, 57) + '…' : line)
      }
    })

    try {
      await waitForAPI()
    } catch (err) {
      loading.close()
      dialog.showErrorBox(
        'Startup failed',
        `Vex could not start.\n\n${err.message}\n\nTry relaunching Vex.`
      )
      app.quit()
      return
    }
  }

  setStatus(loading, 'Loading…')
  loading.close()
  createMainWindow()
  createTray()
  setupAutoUpdater()
})

app.on('before-quit', killAll)
app.on('will-quit', killAll)
app.on('activate', () => { if (mainWindow) mainWindow.show() })

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
}
