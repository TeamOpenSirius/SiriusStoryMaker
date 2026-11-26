import type { AudioMix } from '../player/src/types/AudioMix'
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('siriusStudio', {
  readAudioMix: (scope: 'editor' | 'player') => ipcRenderer.invoke('audio:read', scope),
  writeAudioMix: (scope: 'editor' | 'player', mix: AudioMix) => ipcRenderer.invoke('audio:write', scope, mix),
  onPlaybackAction: (callback: (action: 'open' | 'audio') => void) => {
    const handler = (_event: unknown, action: 'open' | 'audio') => callback(action)
    ipcRenderer.on('playback:action', handler)
    return () => ipcRenderer.removeListener('playback:action', handler)
  },
  openPlayback: () => ipcRenderer.invoke('playback:open'),
  currentPlayback: () => ipcRenderer.invoke('playback:current'),
  detectFfmpeg: () => ipcRenderer.invoke('ffmpeg:detect'),
  chooseFfmpeg: () => ipcRenderer.invoke('ffmpeg:choose'),
  beginVideo: (title: string) => ipcRenderer.invoke('video:begin', title),
  writeVideoChunk: (id: string, data: ArrayBuffer) => ipcRenderer.invoke('video:chunk', id, data),
  finishVideo: (id: string) => ipcRenderer.invoke('video:finish', id),
  cancelVideo: (id: string) => ipcRenderer.invoke('video:cancel', id),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  forgetProject: (filePath: string) => ipcRenderer.invoke('project:forget', filePath),
  chooseProjectFolder: () => ipcRenderer.invoke('project:choose-folder'),
  createProject: (payload: { folder: string; title: string; content: string }) => ipcRenderer.invoke('project:create', payload),
  openProject: (filePath?: string) => ipcRenderer.invoke('project:open', filePath),
  currentProject: () => ipcRenderer.invoke('project:current'),
  showLauncher: () => ipcRenderer.invoke('project:launcher'),
  saveStory: (content: string) => ipcRenderer.invoke('story:save', content),
  readLayout: () => ipcRenderer.invoke('layout:read'),
  writeLayout: (data: string) => ipcRenderer.invoke('layout:write', data),
  onCloseBlocked: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('window:close-blocked', handler)
    return () => ipcRenderer.removeListener('window:close-blocked', handler)
  },
  readAiSettings: () => ipcRenderer.invoke('ai:settings-read'),
  writeAiSettings: (data: string) => ipcRenderer.invoke('ai:settings-write', data),
  readAiHistory: () => ipcRenderer.invoke('ai:history-read'),
  writeAiHistory: (data: string) => ipcRenderer.invoke('ai:history-write', data),
  exportZip: (payload: {
    json: string
    storyDsl?: string
    defaultName?: string
    title?: string
    chapter?: string
  }) => ipcRenderer.invoke('story:export-zip', payload),
  importLocalAsset: (kind: 'background' | 'bgm' | 'se' | 'voice') =>
    ipcRenderer.invoke('story:import-local-asset', kind),
  removeProjectAsset: (kind: 'background' | 'bgm' | 'se' | 'voice', id: string) =>
    ipcRenderer.invoke('project:remove-asset', { kind, id }),
  revealProjectAsset: (payload?: { kind: 'background' | 'bgm' | 'se' | 'voice'; id: string }) =>
    ipcRenderer.invoke('project:reveal-asset', payload),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getThumbInfo: () => ipcRenderer.invoke('thumb:info'),
  saveSpineThumb: (id: string, dataUrl: string) => ipcRenderer.invoke('thumb:save-spine', { id, dataUrl }),
  markThumbCacheReady: (spineCount: number) => ipcRenderer.invoke('thumb:mark-ready', spineCount),
  clearThumbCache: () => ipcRenderer.invoke('thumb:clear'),
  detectHarnesses: (forceRefresh?: boolean) => ipcRenderer.invoke('harness:detect', forceRefresh),
  listSkills: (forceRefresh?: boolean) => ipcRenderer.invoke('harness:skills', forceRefresh),
  getOfficialReference: (prompt: string) => ipcRenderer.invoke('harness:official-reference', prompt),
  getMcpInfo: () => ipcRenderer.invoke('harness:mcp-info'),
  sendHarnessPrompt: (payload: {
    harnessId: string
    command: string
    prompt: string
    script: string
    sessionId?: string
    filePath?: string
    model?: string
    effort?: string
    enabledSkills?: string[]
    enableMcp?: boolean
    apiKey?: string
    baseUrl?: string
  }) => ipcRenderer.invoke('harness:send', payload),
  stopHarness: () => ipcRenderer.invoke('harness:stop'),
  onHarnessEvent: (cb: (event: unknown) => void) => {
    const handler = (_: unknown, ev: unknown) => cb(ev)
    ipcRenderer.on('harness:event', handler)
    return () => ipcRenderer.removeListener('harness:event', handler)
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximized: (cb: (maximized: boolean) => void) => {
    const handler = (_: unknown, val: boolean) => cb(val)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
})
