import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell } from 'electron'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeAudioMix } from '../player/src/types/AudioMix'
import { openPlayback, type OpenPlayback } from './playback'
import { detectFfmpeg, probeFfmpeg, VideoJob } from './video'
import { fileURLToPath } from 'node:url'
import {
  detectHarnesses,
  getStudioMcpInfo,
  listStudioSkills,
  runHarnessTurn,
  stopActiveHarness,
  type RunHarnessParams,
} from './harness'
import { addProjectAsset, buildProjectPackage, createProject, openProject, projectPath, removeProjectAsset, writeAtomic, type Project } from './project'
import { PROJECT_ASSET_KINDS, type ProjectAssetKind, type RecentProject } from '../src/shared/project'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.setName('SiriusStoryMaker')
// Keep existing settings, recents and caches under the same profile after renaming.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'sirius-adv-studio'))
}

let mainWindow: BrowserWindow | null = null
let staticServer: http.Server | null = null
let launcherWindow: BrowserWindow | null = null
let activeProject: Project | null = null
let serverUrl = ''
let recentProjects: RecentProject[] = []
const playbackWindows = new Map<number, { token: string; file: OpenPlayback }>()
const playbackAssets = new Map<string, OpenPlayback['assets']>()
const videoJobs = new Map<number, VideoJob>()
const pendingVideoWindows = new Set<number>()
const ffmpegPath = () => path.join(app.getPath('userData'), 'ffmpeg.json')

async function currentFfmpeg() {
  const config = await fs.readFile(ffmpegPath(), 'utf8').then(data => JSON.parse(data)).catch(() => null)
  return detectFfmpeg(typeof config?.path === 'string' ? config.path : undefined)
}

function clearPlayback(id: number) {
  const entry = playbackWindows.get(id)
  if (entry) playbackAssets.delete(entry.token)
  playbackWindows.delete(id)
}

function playbackForRenderer(id: number) {
  const entry = playbackWindows.get(id)
  if (!entry) return null
  const { name, episode, missingAssets } = entry.file
  return { name, episode, missingAssets, assetBase: `${serverUrl}/playback-assets/${entry.token}` }
}
let projectMutation = Promise.resolve<unknown>(undefined)
const enqueue = <T>(operation: () => Promise<T>) => {
  const result = projectMutation.then(operation)
  projectMutation = result.catch(() => {})
  return result
}
const recentPath = () => path.join(app.getPath('userData'), 'recent-projects.json')
const prefsPath = () => path.join(app.getPath('userData'), 'ai-settings.json')
const layoutPath = () => path.join(app.getPath('userData'), 'editor-layout.json')
const thumbCacheRoot = () => path.join(app.getPath('userData'), 'thumb-cache')
const ADV_CDN_BASE = 'https://cdn.jsdelivr.net/gh/wds-sirius/Adv-Resource@main'
const inflightThumbs = new Map<string, Promise<Buffer | null>>()
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
        if (rel.startsWith('/thumb-cache/')) {
          const parts = rel.split('/')
          const kind = parts[2]
          const file = parts[3]
          if (
            parts.length !== 4 ||
            !['background', 'still', 'spine'].includes(kind) ||
            !file ||
            file.includes('..') ||
            file.includes('\\') ||
            !/^[^/\\]+\.(png|webp|jpg|jpeg)$/i.test(file)
          ) {
            res.writeHead(400).end('Bad request')
            return
          }
          const cacheDir = path.join(thumbCacheRoot(), kind)
          filePath = path.join(cacheDir, file)
          try {
            const cached = await fs.readFile(filePath)
            const ext = path.extname(filePath).toLowerCase()
            res.writeHead(200, {
              'Content-Type': MIME_TYPES[ext] || 'image/png',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=31536000, immutable',
            })
            res.end(cached)
            return
          } catch {
            if (kind === 'spine') {
              res.writeHead(404).end('Not found')
              return
            }
            // Transparently fetch remote background/still via Chromium net.fetch (respects system proxy) and persist to disk cache
            const remoteUrl = `${ADV_CDN_BASE}/${kind}/${encodeURIComponent(file)}`
            const cacheKey = `${kind}/${file}`
            let pending = inflightThumbs.get(cacheKey)
            if (!pending) {
              pending = (async () => {
                try {
                  const resp = await net.fetch(remoteUrl)
                  if (!resp.ok) return null
                  const buf = Buffer.from(await resp.arrayBuffer())
                  await fs.mkdir(cacheDir, { recursive: true })
                  await writeAtomic(filePath, buf).catch(() => {})
                  return buf
                } catch (err) {
                  console.warn('[thumb-cache] fetch failed:', remoteUrl, err)
                  return null
                } finally {
                  inflightThumbs.delete(cacheKey)
                }
              })()
              inflightThumbs.set(cacheKey, pending)
            }
            const buf = await pending
            if (!buf) {
              res.writeHead(404).end('Upstream not found')
              return
            }
            const ext = path.extname(filePath).toLowerCase()
            res.writeHead(200, {
              'Content-Type': MIME_TYPES[ext] || 'image/png',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=31536000, immutable',
            })
            res.end(buf)
            return
          }
        } else if (rel.startsWith('/playback-assets/')) {
          const [, , token, kind, file, extra] = rel.split('/')
          const id = file?.replace(/\.[^.]+$/, '')
          const asset = extra === undefined && playbackAssets.get(token)?.get(`${kind}/${id}`)
          if (!asset) { res.writeHead(404).end('Not found'); return }
          const data = await asset.read()
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(asset.filename).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'private, max-age=3600',
          })
          res.end(data)
          return
        } else if (rel.startsWith('/local-assets/')) {
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

function createWindow(mode: 'launcher' | 'editor' | 'player') {
  const launcher = mode === 'launcher'
  const player = mode === 'player'
  const minWidth = launcher || player ? 720 : 1200
  const minHeight = launcher || player ? 480 : 720
  const win = new BrowserWindow({
    width: launcher ? 880 : player ? 1160 : 1480,
    height: launcher ? 580 : player ? 760 : 860,
    minWidth,
    minHeight,
    frame: player,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: player ? 'SiriusStoryMaker · 播放器' : 'SiriusStoryMaker',
    icon: path.join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../public' : '../dist', 'sirius-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: launcher,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  if (player && process.platform !== 'darwin') {
    win.setMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [
        { label: '打开剧情', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('playback:action', 'open') },
        { role: 'close', label: '关闭播放器' },
      ] },
      { label: '播放', submenu: [
        { label: '播放器设置', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('playback:action', 'audio') },
        { role: 'togglefullscreen', label: '全屏 / 退出全屏' },
      ] },
    ]))
    win.setMenuBarVisibility(false)
  }
  win.setMinimumSize(minWidth, minHeight)
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) void shell.openExternal(targetUrl)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false))
  if (mode === 'editor') win.webContents.on('will-prevent-unload', () => win.webContents.send('window:close-blocked'))
  const owner = win.webContents.id
  win.on('closed', () => {
    clearPlayback(owner)
    const video = videoJobs.get(owner)
    videoJobs.delete(owner)
    if (video) void video.cancel().catch(() => {})
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
      title: '打开项目', filters: [{ name: 'SiriusStoryMaker 项目', extensions: ['sav'] }], properties: ['openFile'],
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
ipcMain.handle('playback:open', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (!parent) return null
  const result = await dialog.showOpenDialog(parent, {
    title: '打开剧情作品', properties: ['openFile'],
    filters: [{ name: 'Sirius 剧情作品 / ADV JSON', extensions: ['zip', 'json'] }],
  })
  if (result.canceled || !result.filePaths[0] || parent.isDestroyed()) return null
  const file = await openPlayback(result.filePaths[0])
  if (parent.isDestroyed()) return null
  const isPlayer = playbackWindows.has(event.sender.id)
  const win = isPlayer ? parent : createWindow('player')
  const owner = win.webContents.id
  clearPlayback(owner)
  const token = randomUUID()
  playbackWindows.set(owner, { token, file })
  playbackAssets.set(token, file.assets)
  return isPlayer ? playbackForRenderer(owner) : true
})
ipcMain.handle('playback:current', event => playbackForRenderer(event.sender.id))

const audioSettingsPath = () => path.join(app.getPath('userData'), 'audio-mix.json')
async function readAudioSettings() {
  const stored = await fs.readFile(audioSettingsPath(), 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
  return { editor: normalizeAudioMix(stored?.editor), player: normalizeAudioMix(stored?.player) }
}
ipcMain.handle('audio:read', async (_event, scope: 'editor' | 'player') =>
  (await readAudioSettings())[scope === 'player' ? 'player' : 'editor'])
ipcMain.handle('audio:write', (_event, scope: 'editor' | 'player', mix: unknown) => enqueue(async () => {
  const stored = await readAudioSettings()
  stored[scope === 'player' ? 'player' : 'editor'] = normalizeAudioMix(mix)
  await writeAtomic(audioSettingsPath(), JSON.stringify(stored))
}))

ipcMain.handle('ffmpeg:detect', currentFfmpeg)
ipcMain.handle('ffmpeg:choose', async event => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (!parent) return null
  const selected = await dialog.showOpenDialog(parent, {
    title: '选择 FFmpeg 可执行文件', properties: ['openFile'],
    ...(process.platform === 'win32' ? { filters: [{ name: 'FFmpeg', extensions: ['exe'] }] } : {}),
  })
  if (selected.canceled || !selected.filePaths[0]) return null
  const status = await probeFfmpeg(selected.filePaths[0])
  if (status.path) await writeAtomic(ffmpegPath(), JSON.stringify({ path: status.path }))
  return status
})

ipcMain.handle('video:begin', async (event, title: string) => {
  const parent = BrowserWindow.fromWebContents(event.sender)
  const owner = event.sender.id
  if (!parent || videoJobs.has(owner) || pendingVideoWindows.has(owner)) return null
  pendingVideoWindows.add(owner)
  try {
    const ffmpeg = await currentFfmpeg()
    if (!ffmpeg.path) throw new Error(ffmpeg.error || '请先配置 FFmpeg')
    if (parent.isDestroyed()) return null
    const filename = String(title || 'episode').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120).trim() || 'episode'
    const result = await dialog.showSaveDialog(parent, {
      title: '导出剧情视频', defaultPath: `${filename}.mp4`, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    })
    if (result.canceled || !result.filePath || parent.isDestroyed()) return null
    const target = /\.mp4$/i.test(result.filePath) ? result.filePath : `${result.filePath}.mp4`
    const job = await VideoJob.create(target, ffmpeg.path)
    if (parent.isDestroyed()) { await job.cancel(); return null }
    videoJobs.set(owner, job)
    return { id: job.id }
  } finally {
    pendingVideoWindows.delete(owner)
  }
})
ipcMain.handle('video:chunk', (event, id: string, data: ArrayBuffer) => {
  const job = videoJobs.get(event.sender.id)
  if (!job || job.id !== id) throw new Error('此视频导出已关闭')
  return job.append(data)
})
ipcMain.handle('video:finish', async (event, id: string) => {
  const owner = event.sender.id
  const job = videoJobs.get(owner)
  if (!job || job.id !== id) throw new Error('此视频导出已关闭')
  try { return await job.finish() } finally {
    if (videoJobs.get(owner) === job) videoJobs.delete(owner)
  }
})
ipcMain.handle('video:cancel', async (event, id: string) => {
  const job = videoJobs.get(event.sender.id)
  if (!job || job.id !== id) return
  videoJobs.delete(event.sender.id)
  await job.cancel()
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
ipcMain.handle('project:remove-asset', (_event, payload: { kind: ProjectAssetKind; id: string }) =>
  enqueue(async () => {
    const project = requireProject()
    if (!PROJECT_ASSET_KINDS.includes(payload.kind)) throw new Error('无效的素材类型')
    return removeProjectAsset(project, payload.kind, payload.id)
  }),
)
ipcMain.handle('project:reveal-asset', async (_event, payload?: { kind: ProjectAssetKind; id: string }) => {
  const project = requireProject()
  if (payload) {
    const asset = project.manifest.assets.find((item) => item.kind === payload.kind && item.id === payload.id)
    if (asset) {
      shell.showItemInFolder(projectPath(project.root, asset.file))
      return true
    }
  }
  await shell.openPath(project.root)
  return true
})
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
  await shell.openExternal(url)
  return true
})
ipcMain.handle('thumb:info', async () => {
  const spineDir = path.join(thumbCacheRoot(), 'spine')
  const entries = await fs.readdir(spineDir).catch(() => [] as string[])
  const cachedSpines = entries
    .filter((name) => name.endsWith('.webp'))
    .map((name) => name.slice(0, -5))
  let cacheReady = false
  try {
    const meta = JSON.parse(await fs.readFile(path.join(thumbCacheRoot(), 'manifest.json'), 'utf8'))
    cacheReady = meta?.version === 1 && cachedSpines.length > 0
  } catch {
    cacheReady = false
  }
  return { thumbBase: `${serverUrl}/thumb-cache`, cachedSpines, cacheReady }
})
ipcMain.handle('thumb:mark-ready', async (_event, spineCount: number) => {
  await fs.mkdir(thumbCacheRoot(), { recursive: true })
  await writeAtomic(
    path.join(thumbCacheRoot(), 'manifest.json'),
    JSON.stringify({ version: 1, builtAt: Date.now(), spineCount }, null, 2),
  )
  return true
})
ipcMain.handle('thumb:clear', async () => {
  await fs.rm(thumbCacheRoot(), { recursive: true, force: true }).catch(() => {})
  return true
})
ipcMain.handle('thumb:save-spine', async (_event, payload: { id: string; dataUrl: string }) => {
  if (!payload || !/^[\w-]+$/.test(payload.id) || typeof payload.dataUrl !== 'string') return null
  const match = payload.dataUrl.match(/^data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  const spineDir = path.join(thumbCacheRoot(), 'spine')
  await fs.mkdir(spineDir, { recursive: true })
  const target = path.join(spineDir, `${payload.id}.webp`)
  await writeAtomic(target, Buffer.from(match[2], 'base64'))
  return `${serverUrl}/thumb-cache/spine/${encodeURIComponent(payload.id)}.webp`
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
