/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export interface HarnessInfo {
  id: 'claude' | 'codex' | 'gemini' | 'opencode'
  name: string
  command: string
  version: string
  available: boolean
}

export type HarnessStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'script_updated'; content: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

interface SiriusStudioApi {
  openStory: () => Promise<{ filePath: string; content: string } | null>
  saveStory: (payload: { filePath?: string; content: string }) => Promise<{ filePath: string } | null>
  exportJson: (payload: { json: string; defaultName?: string }) => Promise<{ filePath: string } | null>
  importLocalAsset: (kind: 'background' | 'bgm' | 'se') => Promise<{ assetId: string; destPath: string } | null>
  detectHarnesses: () => Promise<HarnessInfo[]>
  sendHarnessPrompt: (payload: {
    harnessId: string
    command: string
    prompt: string
    script: string
    sessionId?: string
    filePath?: string
  }) => Promise<void>
  stopHarness: () => Promise<void>
  onHarnessEvent: (cb: (event: HarnessStreamEvent) => void) => () => void
}

declare global {
  interface Window {
    siriusStudio?: SiriusStudioApi
  }
}

export {}
