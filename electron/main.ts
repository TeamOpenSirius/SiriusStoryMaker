import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  detectHarnesses,
  getStudioMcpInfo,
  listStudioSkills,
  runHarnessTurn,
  stopActiveHarness,
  type RunHarnessParams,
} from './harness'
import { addProjectAsset, buildProjectPackage, createProject, openProject, projectPath, writeAtomic, type Project } from './project'
import { PROJECT_ASSET_KINDS, type ProjectAssetKind, type RecentProject } from '../src/shared/project'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let staticServer: http.Server | null = null
let launcherWindow: BrowserWindow | null = null
let activeProject: Project | null = null
let serverUrl = ''
let recentProjects: RecentProject[] = []
let projectMutation = Promise.resolve<unknown>(undefined)
const enqueue = <T>(operation: () => Promise<T>) => {
  const result = projectMutation.then(operation)
  projectMutation = result.catch(() => {})
  return result
}
const recentPath = () => path.join(app.getPath('userData'), 'recent-projects.json')
const prefsPath = () => path.join(app.getPath('userData'), 'ai-settings.json')
const layoutPath = () => path.join(app.getPath('userData'), 'editor-layout.json')
const activeWindow = () => mainWindow ?? launcherWindow
function requireProject() {
  if (!activeProject) throw new Error('请先打开项目')
  return activeProject
}

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
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
}

function startStaticServer(rootDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
        let rel = decodeURIComponent(reqUrl.pathname)
        let filePath: string
        if (rel.startsWith('/local-assets/')) {
          const project = activeProject
          const [, , kind, file] = rel.split('/')
          const id = file?.replace(/\.[^.]+$/, '')
          const asset = project?.manifest.assets.find((item) => item.kind === kind && item.id === id)
          if (!project || !asset || rel.split('/').length !== 4) {
            res.writeHead(404).end('Not found')
            return
          }
          filePath = projectPath(project.root, asset.file)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cache-Control', 'no-store')
        } else {
          if (rel === '/') rel = '/index.html'
          filePath = path.resolve(rootDir, `.${rel}`)
          if (!filePath.startsWith(rootDir + path.sep)) {
            res.writeHead(403).end('Forbidden')
            return
          }
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

function createWindow(mode: 'launcher' | 'editor') {
  const launcher = mode === 'launcher'
  const win = new BrowserWindow({
    width: launcher ? 860 : 1480,
    height: launcher ? 560 : 860,
    minWidth: launcher ? 690 : 1080,
    minHeight: launcher ? 490 : 680,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'SiriusAdvStudio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false))
  if (!launcher) win.webContents.on('will-prevent-unload', () => win.webContents.send('window:close-blocked'))
  win.on('closed', () => {
    if (launcherWindow === win) launcherWindow = null
    if (mainWindow === win) {
      mainWindow = null
      activeProject = null
      stopActiveHarness()
    }
  })
  const url = new URL(process.env.VITE_DEV_SERVER_URL || serverUrl)
  url.searchParams.set('mode', mode)
  void win.loadURL(url.href)
  return win
}

function showLauncher() {
  if (launcherWindow) launcherWindow.focus()
  else launcherWindow = createWindow('launcher')
}

async function enterProject(project: Project) {
  if (mainWindow) throw new Error('请先关闭当前项目')
  recentProjects = [{ filePath: project.filePath, title: project.manifest.title, updatedAt: Date.now() },
    ...recentProjects.filter((item) => item.filePath !== project.filePath)].slice(0, 15)
  await writeAtomic(recentPath(), JSON.stringify(recentProjects)).catch(console.warn)
  activeProject = project
  mainWindow = createWindow('editor')
  mainWindow.once('ready-to-show', () => launcherWindow?.close())
}

ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})
ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
ipcMain.handle('project:recent', () => recentProjects)
ipcMain.handle('project:forget', (_event, filePath: string) => enqueue(async () => {
  recentProjects = recentProjects.filter((item) => item.filePath !== filePath)
  await writeAtomic(recentPath(), JSON.stringify(recentProjects))
  return recentProjects
}))
ipcMain.handle('project:choose-folder', async () => {
  if (!launcherWindow) return null
  const result = await dialog.showOpenDialog(launcherWindow, { title: '选择项目文件夹', properties: ['openDirectory', 'createDirectory'] })
  return result.filePaths[0] ?? null
})
ipcMain.handle('project:create', (_event, payload: { folder: string; title: string; content: string }) =>
  enqueue(async () => {
    if (!launcherWindow || mainWindow) return false
    await enterProject(await createProject(path.resolve(payload.folder), payload.title, payload.content))
    return true
  }))
ipcMain.handle('project:open', (_event, recentPath?: string) => enqueue(async () => {
  if (!launcherWindow || mainWindow) return false
  let filePath = recentPath
  if (!filePath) {
    const result = await dialog.showOpenDialog(launcherWindow, {
      title: '打开项目', filters: [{ name: 'SiriusAdvStudio 项目', extensions: ['sav'] }], properties: ['openFile'],
    })
    filePath = result.filePaths[0]
  }
  if (!filePath) return false
  await enterProject(await openProject(filePath))
  return true
}))
ipcMain.handle('project:current', () => {
  const project = requireProject()
  return { filePath: project.filePath, manifest: project.manifest, content: project.content, assetBase: `${serverUrl}/local-assets` }
})
ipcMain.handle('project:launcher', () => {
  showLauncher()
  mainWindow?.close()
})
ipcMain.handle('story:save', (_event, content: string) => enqueue(async () => {
  const project = requireProject()
  await writeAtomic(projectPath(project.root, project.manifest.story), content)
  project.content = content
}))
ipcMain.handle('story:export-zip', async (_event, payload: {
  json: string; storyDsl?: string; defaultName?: string; title?: string; chapter?: string
}) => {
  const project = requireProject()
  if (!mainWindow) return null
  const safeName = (payload.defaultName || 'episode').replace(/[\\/:*?"<>|]/g, '_').replace(/\.zip$/i, '') + '.zip'
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出作品包 (.zip)', defaultPath: path.join(project.root, safeName),
    filters: [{ name: 'Sirius Story Package', extensions: ['zip'] }],
  })
  if (result.canceled || !result.filePath) return null
  return enqueue(async () => {
    if (result.filePath === project.filePath || result.filePath === projectPath(project.root, project.manifest.story) ||
        project.manifest.assets.some((asset) => result.filePath === projectPath(project.root, asset.file))) {
      throw new Error('不能用作品包覆盖项目文件')
    }
    await writeAtomic(result.filePath!, await buildProjectPackage(project, payload))
    return { filePath: result.filePath!, assetCount: project.manifest.assets.length }
  })
})
ipcMain.handle('story:import-local-asset', async (_event, kind: ProjectAssetKind) => {
  const project = requireProject()
  if (!mainWindow || !PROJECT_ASSET_KINDS.includes(kind)) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入项目素材',
    filters: [kind === 'background'
      ? { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      : { name: '音频', extensions: ['mp3', 'ogg', 'wav'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return enqueue(async () => {
    if (activeProject !== project) return null
    const asset = await addProjectAsset(project, kind, result.filePaths[0])
    return { assetId: asset.id, asset }
  })
})
ipcMain.handle('layout:read', () => fs.readFile(layoutPath(), 'utf8').catch(() => 'null'))
ipcMain.handle('layout:write', (_event, data: string) => enqueue(() => writeAtomic(layoutPath(), data)))
ipcMain.handle('ai:settings-read', () => fs.readFile(prefsPath(), 'utf8').catch(() => 'null'))
ipcMain.handle('ai:settings-write', (_event, data: string) => enqueue(() => writeAtomic(prefsPath(), data)))
ipcMain.handle('ai:history-read', () => {
  const project = requireProject()
  return fs.readFile(path.join(projectPath(project.root, project.manifest.aiCache), 'history.json'), 'utf8').catch(() => '[]')
})
ipcMain.handle('ai:history-write', (_event, data: string) => {
  const project = requireProject()
  return enqueue(async () => {
    const cache = projectPath(project.root, project.manifest.aiCache)
    await fs.mkdir(cache, { recursive: true })
    await writeAtomic(path.join(cache, 'history.json'), data)
  })
})

ipcMain.handle('harness:detect', (_event, forceRefresh?: boolean) => detectHarnesses(forceRefresh))
ipcMain.handle('harness:skills', (_event, forceRefresh?: boolean) => listStudioSkills(forceRefresh))
ipcMain.handle('harness:mcp-info', () => getStudioMcpInfo())

ipcMain.handle(
  'harness:send',
  async (event, payload: RunHarnessParams) => {
    const project = requireProject()
    const workspace = path.join(projectPath(project.root, project.manifest.aiCache), 'workspace')
    await runHarnessTurn({ ...payload, workspace }, (ev) => {
      if (!event.sender.isDestroyed()) event.sender.send('harness:event', ev)
    })
  },
)

ipcMain.handle('harness:stop', () => {
  stopActiveHarness()
})

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  try {
    const loaded = JSON.parse(await fs.readFile(recentPath(), 'utf8'))
    if (Array.isArray(loaded)) recentProjects = loaded
  } catch { /* no recent projects yet */ }
  serverUrl = await startStaticServer(path.join(__dirname, '../dist'))
  showLauncher()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showLauncher()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => { staticServer?.close(); stopActiveHarness() })
