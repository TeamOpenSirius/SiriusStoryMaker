import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('siriusStudio', {
  openStory: () => ipcRenderer.invoke('story:open'),
  saveStory: (payload: { filePath?: string; content: string }) =>
    ipcRenderer.invoke('story:save', payload),
  exportJson: (payload: { json: string; defaultName?: string }) =>
    ipcRenderer.invoke('story:export-json', payload),
  importLocalAsset: (kind: 'background' | 'bgm' | 'se') =>
    ipcRenderer.invoke('story:import-local-asset', kind),
  detectHarnesses: () => ipcRenderer.invoke('harness:detect'),
  sendHarnessPrompt: (payload: {
    harnessId: string
    command: string
    prompt: string
    script: string
    sessionId?: string
    filePath?: string
  }) => ipcRenderer.invoke('harness:send', payload),
  stopHarness: () => ipcRenderer.invoke('harness:stop'),
  onHarnessEvent: (cb: (event: unknown) => void) => {
    const handler = (_: unknown, ev: unknown) => cb(ev)
    ipcRenderer.on('harness:event', handler)
    return () => ipcRenderer.removeListener('harness:event', handler)
  },
})
