import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectHarnesses, runHarnessTurn, stopActiveHarness, type HarnessInfo } from './harness'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let staticServer: http.Server | null = null
let customAssetDir: string = path.join(os.tmpdir(), 'sirius-adv-studio-workspace', 'assets')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

function startStaticServer(rootDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
        let rel = decodeURIComponent(reqUrl.pathname)
        let baseDir = rootDir
        if (rel.startsWith('/local-assets/') && customAssetDir) {
          baseDir = customAssetDir
          rel = rel.slice('/local-assets'.length)
        }
        if (rel === '/') rel = '/index.html'
        const filePath = path.resolve(baseDir, `.${rel}`)
        if (!filePath.startsWith(baseDir)) {
          res.writeHead(403).end('Forbidden')
          return
        }
        const data = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase()
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
        res.end(data)
      } catch {
        res.writeHead(404).end('Not found')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        staticServer = server
        resolve(`http://127.0.0.1:${addr.port}`)
      } else {
        reject(new Error('Failed to bind local static server'))
      }
    })
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 860,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#09090b',
    title: 'SiriusAdvStudio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    const url = await startStaticServer(path.join(__dirname, '../dist'))
    void mainWindow.loadURL(url)
  }
}

ipcMain.handle('story:open', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开剧情脚本',
    filters: [{ name: 'Story DSL', extensions: ['story', 'txt'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  customAssetDir = path.join(path.dirname(filePath), 'assets')
  const content = await fs.readFile(filePath, 'utf-8')
  return { filePath, content }
})

ipcMain.handle('story:save', async (_event, payload: { filePath?: string; content: string }) => {
  if (!mainWindow) return null
  let targetPath = payload.filePath
  if (!targetPath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存剧情脚本',
      defaultPath: 'episode.story',
      filters: [{ name: 'Story DSL', extensions: ['story', 'txt'] }],
    })
    if (result.canceled || !result.filePath) return null
    targetPath = result.filePath
  }
  await fs.writeFile(targetPath, payload.content, 'utf-8')
  customAssetDir = path.join(path.dirname(targetPath), 'assets')
  return { filePath: targetPath }
})

ipcMain.handle('story:export-json', async (_event, payload: { json: string; defaultName?: string }) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 IEpisodeModel JSON',
    defaultPath: payload.defaultName || 'episode.json',
    filters: [{ name: 'Episode JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, payload.json, 'utf-8')
  return { filePath: result.filePath }
})

ipcMain.handle('story:import-local-asset', async (_event, kind: 'background' | 'bgm' | 'se' = 'background') => {
  if (!mainWindow) return null
  const isImage = kind === 'background'
  const result = await dialog.showOpenDialog(mainWindow, {
    title: isImage ? '导入本地背景图片' : `导入本地 ${kind.toUpperCase()} 音频`,
    filters: [
      isImage
        ? { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
        : { name: 'Audio', extensions: ['mp3', 'ogg', 'wav'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const srcPath = result.filePaths[0]
  const rawBase = path.basename(srcPath, path.extname(srcPath))
  const safeBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '') || `${kind}_${Date.now()}`
  const assetId = safeBase.startsWith('asset_') ? safeBase : `asset_${safeBase}`
  const targetDir = path.join(customAssetDir, kind)
  await fs.mkdir(targetDir, { recursive: true })
  const destPath = path.join(targetDir, `${assetId}.${isImage ? 'png' : 'mp3'}`)
  await fs.copyFile(srcPath, destPath)
  return { assetId, destPath }
})

ipcMain.handle('harness:detect', () => detectHarnesses())

ipcMain.handle(
  'harness:send',
  async (
    _event,
    payload: {
      harnessId: HarnessInfo['id']
      command: string
      prompt: string
      script: string
      sessionId?: string
      filePath?: string
    },
  ) => {
    await runHarnessTurn(payload, (ev) => {
      mainWindow?.webContents.send('harness:event', ev)
    })
  },
)

ipcMain.handle('harness:stop', () => {
  stopActiveHarness()
})

app.whenReady().then(async () => {
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  staticServer?.close()
  if (process.platform !== 'darwin') app.quit()
})
