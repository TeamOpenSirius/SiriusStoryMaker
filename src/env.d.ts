import type { AudioMix } from '../player/src/types/AudioMix'
import type { PlaybackFile, FfmpegStatus } from './shared/playback'
import type { OpenProject, ProjectAsset, ProjectAssetKind, RecentProject } from './shared/project'
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export type HarnessId = 'agy' | 'claude' | 'codex' | 'dsh' | 'deepseek' | 'gemini' | 'opencode'

export interface HarnessModelOption {
  id: string
  label: string
  efforts?: string[]
}

export interface HarnessInfo {
  id: HarnessId
  name: string
  command: string
  version: string
  available: boolean
  models: HarnessModelOption[]
  efforts: string[]
  supportsMcp: boolean
  supportsSkills: boolean
  requiresApiKey?: boolean
  modelError?: string
}

export interface StudioSkillInfo {
  id: string
  name: string
  description: string
  path: string
}

export interface StudioMcpInfo {
  serverName: string
  command: string
  scriptPath: string
  available: boolean
  tools: Array<{ name: string; description: string }>
}

export type HarnessStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'script_updated'; content: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

interface SiriusStudioApi {
  readAudioMix: (scope: 'editor' | 'player') => Promise<AudioMix>
  writeAudioMix: (scope: 'editor' | 'player', mix: AudioMix) => Promise<void>
  onPlaybackAction: (callback: (action: 'open' | 'audio') => void) => () => void
  openPlayback: () => Promise<PlaybackFile | true | null>
  currentPlayback: () => Promise<PlaybackFile | null>
  detectFfmpeg: () => Promise<FfmpegStatus>
  chooseFfmpeg: () => Promise<FfmpegStatus | null>
  beginVideo: (title: string) => Promise<{ id: string } | null>
  writeVideoChunk: (id: string, data: ArrayBuffer) => Promise<void>
  finishVideo: (id: string) => Promise<string>
  cancelVideo: (id: string) => Promise<void>
  recentProjects: () => Promise<RecentProject[]>
  forgetProject: (filePath: string) => Promise<RecentProject[]>
  chooseProjectFolder: () => Promise<string | null>
  createProject: (payload: { folder: string; title: string; content: string }) => Promise<boolean>
  openProject: (filePath?: string) => Promise<boolean>
  currentProject: () => Promise<OpenProject>
  showLauncher: () => Promise<void>
  saveStory: (content: string) => Promise<void>
  readLayout: () => Promise<string>
  writeLayout: (data: string) => Promise<void>
  onCloseBlocked: (cb: () => void) => () => void
  readAiSettings: () => Promise<string>
  writeAiSettings: (data: string) => Promise<void>
  readAiHistory: () => Promise<string>
  writeAiHistory: (data: string) => Promise<void>
  exportZip: (payload: {
    json: string
    storyDsl?: string
    defaultName?: string
    title?: string
    chapter?: string
  }) => Promise<{ filePath: string; assetCount: number } | null>
  importLocalAsset: (kind: ProjectAssetKind) => Promise<{ assetId: string; asset: ProjectAsset } | null>
  removeProjectAsset: (kind: ProjectAssetKind, id: string) => Promise<ProjectAsset[]>
  revealProjectAsset: (payload?: { kind: ProjectAssetKind; id: string }) => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  getThumbInfo: () => Promise<{ thumbBase: string; cachedSpines: string[]; cacheReady: boolean }>
  saveSpineThumb: (id: string, dataUrl: string) => Promise<string | null>
  markThumbCacheReady: (spineCount: number) => Promise<boolean>
  clearThumbCache: () => Promise<boolean>
  detectHarnesses: (forceRefresh?: boolean) => Promise<HarnessInfo[]>
  listSkills: (forceRefresh?: boolean) => Promise<StudioSkillInfo[]>
  getOfficialReference: (prompt: string) => Promise<Array<{ query: string; assets: unknown[] }>>
  getMcpInfo: () => Promise<StudioMcpInfo>
  sendHarnessPrompt: (payload: {
    harnessId: HarnessId
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
  }) => Promise<void>
  stopHarness: () => Promise<void>
  onHarnessEvent: (cb: (event: HarnessStreamEvent) => void) => () => void
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<boolean>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  onWindowMaximized: (cb: (maximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    siriusStudio?: SiriusStudioApi
  }
}

export {}
