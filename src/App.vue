<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Eye,
  FolderOpen,
  GitBranch,
  Info,
  Minus,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  Save,
  Square,
  Undo2,
  Upload,
  X,
} from 'lucide-vue-next'
import AiHarnessPanel from './components/AiHarnessPanel.vue'
import AssetPickerDialog, { type PickerAssetKind } from './components/AssetPickerDialog.vue'
import NodeInspector from './components/NodeInspector.vue'
import PlayerPreview from './components/PlayerPreview.vue'
import StoryGraph from './components/StoryGraph.vue'
// Lazy-load CodeMirror 6 DSL editor so memory stays low when using the default visual workbench
const DslEditor = defineAsyncComponent(() => import('./components/DslEditor.vue'))
import { compileDsl } from './dsl/compiler'
import { decompileEpisode } from './dsl/decompiler'
import { parseStoryGraph, serializeStoryGraph } from './dsl/graph'
import {
  ASSET_DRAG_MIME,
  computeSceneChanges,
  framesToSceneDsl,
  getSceneVisualFrames,
  parseAliasMap,
  type AssetDragPayload,
} from './dsl/sceneFrames'
import type { IEpisodeModel } from '../player/src/types/Episode'
import {
  ADV_RESOURCE_CDN,
  loadResourceCatalog,
  type ResourceCatalog,
} from './services/resourceCatalog'

import { SAMPLE_DSL } from './shared/templates'
import type { OpenProject, ProjectAsset, ProjectAssetKind } from './shared/project'

const props = defineProps<{ project?: OpenProject; layout?: string }>()
const DRAFT_STORAGE_KEY = 'sirius-adv-studio.draft.v1'
const LAYOUT_STORAGE_KEY = 'sirius-adv-studio.nle-layout.v3'
const MAX_UNDO = 50

interface SavedNleLayout {
  leftWidth: number
  inspectorWidth: number
  aiWidth: number
  topSplitPct: number
  showLeftPane: boolean
  showInspector: boolean
  showAiPanel: boolean
}

function loadLayout(): SavedNleLayout {
  const defaults: SavedNleLayout = {
    leftWidth: 220,
    inspectorWidth: 280,
    aiWidth: 340,
    topSplitPct: 48,
    showLeftPane: true,
    showInspector: true,
    showAiPanel: false,
  }
  try {
    const raw = props.layout ?? localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return defaults
    const p = (JSON.parse(raw) ?? {}) as Partial<SavedNleLayout>
    return {
      leftWidth: Math.max(170, Math.min(340, p.leftWidth ?? defaults.leftWidth)),
      inspectorWidth: Math.max(230, Math.min(420, p.inspectorWidth ?? defaults.inspectorWidth)),
      aiWidth: Math.max(280, Math.min(520, p.aiWidth ?? defaults.aiWidth)),
      topSplitPct: Math.max(28, Math.min(72, p.topSplitPct ?? defaults.topSplitPct)),
      showLeftPane: p.showLeftPane ?? defaults.showLeftPane,
      showInspector: p.showInspector ?? defaults.showInspector,
      showAiPanel: p.showAiPanel ?? defaults.showAiPanel,
    }
  } catch {
    return defaults
  }
}

function loadInitialScript(): string {
  try {
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (saved && saved.trim()) return saved
  } catch {
    // ignore
  }
  return SAMPLE_DSL
}

const initLayout = loadLayout()
const leftWidth = ref(initLayout.leftWidth)
const inspectorWidth = ref(initLayout.inspectorWidth)
const aiWidth = ref(initLayout.aiWidth)
const topSplitPct = ref(initLayout.topSplitPct)
const showLeftPane = ref(initLayout.showLeftPane)
const showInspector = ref(initLayout.showInspector)
const showAiPanel = ref(initLayout.showAiPanel)

const script = ref(props.project?.content ?? loadInitialScript())
const lastSavedScript = ref(script.value)
const isDirty = computed(() => script.value !== lastSavedScript.value)
const undoPast = ref<string[]>([])
const undoFuture = ref<string[]>([])
const nodeChanges = ref<Map<string, 'added' | 'modified'>>(new Map())

const currentFilePath = props.project?.filePath
const projectAssets = ref<ProjectAsset[]>([...(props.project?.manifest.assets ?? [])])
const assetBase = props.project?.assetBase ?? ''
const leftTab = ref<'resources' | 'outline'>('resources')
const resourceKind = ref<'backgrounds' | 'spines' | 'stills' | 'bgms' | 'ses'>('backgrounds')
const resourceQuery = ref('')
const catalog = ref<ResourceCatalog>({
  backgrounds: [],
  spines: [],
  stills: [],
  cards: [],
  bgms: [],
  ses: [],
})

const workspaceMode = ref<'visual' | 'code'>('visual')
const selectedNodeId = ref<string | null>('start')
const selectedLocalFrameIdx = ref(0)
const activeFrameIndex = ref(0)
const activeChoices = ref<Record<string, number>>({})
const playingAudioId = ref<string | null>(null)
const previewSpineId = ref<string | null>(null)
const showProjectMenu = ref(false)
const showAiMenu = ref(false)
const aiPanel = ref<InstanceType<typeof AiHarnessPanel> | null>(null)
const closeDestination = ref<'quit' | 'launcher'>('quit')
let allowClose = false
const showAboutModal = ref(false)
const showExitConfirmModal = ref(false)
const showExportModal = ref(false)
const assetPickerOpen = ref(false)
const assetPickerKind = ref<PickerAssetKind>('backgrounds')
const isElectronDesktop = typeof window !== 'undefined' && Boolean(window.siriusStudio)
const isMaximized = ref(false)
let unsubMax: (() => void) | null = null
let unsubClose: (() => void) | null = null

function minimizeWindow() {
  void window.siriusStudio?.windowMinimize()
}

function toggleMaximizeWindow() {
  void window.siriusStudio?.windowMaximize()
}

function requestCloseWindow(destination: 'quit' | 'launcher' = 'quit') {
  closeDestination.value = destination
  if (isDirty.value) {
    showExitConfirmModal.value = true
    return
  }
  forceCloseWindow()
}

async function saveAndCloseWindow() {
  if (await saveFile() && !isDirty.value) forceCloseWindow()
}

function forceCloseWindow() {
  showExitConfirmModal.value = false
  allowClose = true
  if (closeDestination.value === 'launcher') void window.siriusStudio?.showLauncher()
  else void window.siriusStudio?.windowClose()
}

async function openAiConfig(tab: 'connection' | 'skills' | 'mcp') {
  showAiMenu.value = false
  await nextTick()
  aiPanel.value?.openConfig(tab)
}

function closeMenus() {
  showAiMenu.value = false
  showProjectMenu.value = false
}
const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const jsonInputRef = ref<HTMLInputElement | null>(null)
const dslInputRef = ref<HTMLInputElement | null>(null)
const mainDeckRef = ref<HTMLElement | null>(null)
const editorRef = ref<{ insertLine: (s: string) => void; goToLine: (n: number) => void } | null>(null)
const playerRef = ref<InstanceType<typeof PlayerPreview> | null>(null)
let previewAudio: HTMLAudioElement | null = null

function notify(msg: string) {
  toastMsg.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMsg.value = ''
  }, 2600)
}

function commitScript(next: string, recordUndo: boolean = true) {
  if (next === script.value) return
  if (recordUndo) {
    undoPast.value.push(script.value)
    if (undoPast.value.length > MAX_UNDO) undoPast.value.shift()
    undoFuture.value = []
  }
  script.value = next
}

function undo() {
  const prev = undoPast.value.pop()
  if (prev === undefined) return
  undoFuture.value.push(script.value)
  script.value = prev
  notify('已撤销')
}

function redo() {
  const next = undoFuture.value.pop()
  if (next === undefined) return
  undoPast.value.push(script.value)
  script.value = next
  notify('已重做')
}

// Splitter Drag State
const resizingKind = ref<'left' | 'inspector' | 'ai' | 'topSplit' | null>(null)
let resizeStartX = 0
let resizeStartY = 0
let resizeOrigVal = 0

function startResize(kind: 'left' | 'inspector' | 'ai' | 'topSplit', e: MouseEvent) {
  e.preventDefault()
  resizingKind.value = kind
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  if (kind === 'left') resizeOrigVal = leftWidth.value
  else if (kind === 'inspector') resizeOrigVal = inspectorWidth.value
  else if (kind === 'ai') resizeOrigVal = aiWidth.value
  else resizeOrigVal = topSplitPct.value
}

function onGlobalMouseMove(e: MouseEvent) {
  if (!resizingKind.value) return
  if (resizingKind.value === 'left') {
    leftWidth.value = Math.max(170, Math.min(340, Math.round(resizeOrigVal + (e.clientX - resizeStartX))))
  } else if (resizingKind.value === 'inspector') {
    inspectorWidth.value = Math.max(230, Math.min(440, Math.round(resizeOrigVal - (e.clientX - resizeStartX))))
  } else if (resizingKind.value === 'ai') {
    aiWidth.value = Math.max(280, Math.min(540, Math.round(resizeOrigVal - (e.clientX - resizeStartX))))
  } else if (resizingKind.value === 'topSplit') {
    const h = mainDeckRef.value?.clientHeight ?? 760
    const deltaPct = ((e.clientY - resizeStartY) / Math.max(200, h)) * 100
    topSplitPct.value = Math.max(28, Math.min(72, Number((resizeOrigVal + deltaPct).toFixed(1))))
  }
}

function onGlobalMouseUp() {
  if (!resizingKind.value) return
  resizingKind.value = null
  persistLayout()
}

function persistLayout() {
  const layout = JSON.stringify({
    leftWidth: leftWidth.value, inspectorWidth: inspectorWidth.value, aiWidth: aiWidth.value,
    topSplitPct: topSplitPct.value, showLeftPane: showLeftPane.value,
    showInspector: showInspector.value, showAiPanel: showAiPanel.value,
  })
  if (window.siriusStudio) {
    void window.siriusStudio.writeLayout(layout).catch(() => {})
  } else {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, layout) } catch { /* storage unavailable */ }
  }
}

watch([showLeftPane, showInspector, showAiPanel], persistLayout)

watch(script, (val) => {
  try {
    if (!props.project) localStorage.setItem(DRAFT_STORAGE_KEY, val)
  } catch {
    // ignore
  }
})

const resourceSets = computed(() => ({
  backgrounds: new Set(catalog.value.backgrounds),
  spines: new Set(catalog.value.spines),
  stills: new Set(catalog.value.stills),
  bgms: new Set(catalog.value.bgms),
  ses: new Set(catalog.value.ses),
}))

const compiled = computed(() => compileDsl(script.value, resourceSets.value, activeChoices.value))
const missingExportAssets = computed(() => {
  const indexed = new Set(projectAssets.value.map((asset) => `${asset.kind}/${asset.id}`))
  const missing = new Set<string>()
  const fields = {
    background: 'BackgroundImageFileName', bgm: 'BgmFileName', se: 'SeFileName', voice: 'VoiceFileName',
  } as const
  for (const frame of compiled.value.episode.EpisodeDetail) {
    for (const kind of Object.keys(fields) as ProjectAssetKind[]) {
      const id = frame[fields[kind]]
      if (id?.startsWith('asset_') && !indexed.has(`${kind}/${id}`)) missing.add(`${kind}/${id}`)
    }
  }
  return [...missing]
})
const canExport = computed(() => compiled.value.episode.EpisodeDetail.length > 0 && !missingExportAssets.value.length)
const graphDoc = computed(() => parseStoryGraph(script.value))
const choiceNodes = computed(() => graphDoc.value.nodes.filter((n) => n.choices.length > 0))

const filteredResources = computed(() => {
  const list = catalog.value[resourceKind.value] || []
  const q = resourceQuery.value.trim().toLowerCase()
  const matched = q ? list.filter((id) => id.toLowerCase().includes(q) || assetDisplayName(id).toLowerCase().includes(q)) : list
  return matched.slice(0, 80)
})

watch(
  () => graphDoc.value.nodes,
  (nodes) => {
    if (nodes.length === 0) selectedNodeId.value = null
    else if (!selectedNodeId.value || !nodes.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = nodes[0].id
      selectedLocalFrameIdx.value = 0
    }
  },
  { immediate: true },
)

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeMenus()
    aiPanel.value?.closeConfig()
    showAboutModal.value = false
    showExitConfirmModal.value = false
    showExportModal.value = false
    assetPickerOpen.value = false
    previewSpineId.value = null
    return
  }
  const tag = (e.target as HTMLElement)?.tagName
  const inTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveFile()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    if (isElectronDesktop) requestCloseWindow('launcher')
  } else if (!inTextInput && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
  } else if (!inTextInput && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    redo()
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!allowClose && isDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', onGlobalMouseUp)
  window.addEventListener('beforeunload', onBeforeUnload)
  if (window.siriusStudio) {
    unsubClose = window.siriusStudio.onCloseBlocked(() => requestCloseWindow())
    isMaximized.value = await window.siriusStudio.windowIsMaximized().catch(() => false)
    unsubMax = window.siriusStudio.onWindowMaximized((val) => {
      isMaximized.value = val
    })
  }
  const official = await loadResourceCatalog()
  catalog.value = official
  for (const asset of projectAssets.value) registerLocalAsset(asset)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', onGlobalMouseUp)
  window.removeEventListener('beforeunload', onBeforeUnload)
  unsubMax?.()
  unsubClose?.()
  if (toastTimer) clearTimeout(toastTimer)
  previewAudio?.pause()
  previewAudio = null
})

function onAssetDragStart(e: DragEvent, id: string) {
  const kindMap: Record<typeof resourceKind.value, AssetDragPayload['kind']> = {
    backgrounds: 'background',
    spines: 'spine',
    stills: 'still',
    bgms: 'bgm',
    ses: 'se',
  }
  const payload: AssetDragPayload = { kind: kindMap[resourceKind.value], id }
  e.dataTransfer?.setData(ASSET_DRAG_MIME, JSON.stringify(payload))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

function toggleAudioPreview(kind: 'bgms' | 'ses', id: string) {
  const key = `${kind}:${id}`
  if (playingAudioId.value === key) {
    previewAudio?.pause()
    playingAudioId.value = null
    return
  }
  previewAudio?.pause()
  const folder = kind === 'bgms' ? 'bgm' : 'se'
  previewAudio = new Audio(id.startsWith('asset_') ? assetUrl(folder, id, 'mp3') : `${ADV_RESOURCE_CDN}/${folder}/${encodeURIComponent(id)}.mp3`)
  previewAudio.volume = 0.5
  previewAudio.onended = () => {
    playingAudioId.value = null
  }
  playingAudioId.value = key
  void previewAudio.play().catch(() => {
    playingAudioId.value = null
  })
}

function insertResourceSnippet(id: string) {
  const map: Record<typeof resourceKind.value, string> = {
    backgrounds: `@bg ${id} fade=cross`,
    spines: `@char 1 ${id} pos=center expr=normal body=normal`,
    stills: `@still ${id}`,
    bgms: `@bgm ${id}`,
    ses: `@se ${id}`,
  }
  if (workspaceMode.value === 'code') {
    editorRef.value?.insertLine(map[resourceKind.value])
  } else {
    notify(`拖入下方任意场景卡片即可应用 ${id}`)
  }
}

async function onJsonFileSelected(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const model = JSON.parse(text) as IEpisodeModel
    if (!model || !Array.isArray(model.EpisodeDetail)) throw new Error('文件不是 ADV 剧集 JSON')
    commitScript(decompileEpisode(model))
    notify(`已导入 ${file.name}`)
  } catch (err) {
    notify(`导入失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    ;(ev.target as HTMLInputElement).value = ''
  }
}

async function onDslFileSelected(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    commitScript(await file.text())
    notify(`已导入 ${file.name}`)
  } catch (err) {
    notify(`导入失败：${errorMessage(err)}`)
  } finally { input.value = '' }
}


function resolveFrameForLine(line: number): number | undefined {
  const map = compiled.value.lineToFrame
  if (map.size === 0) return undefined
  const exact = map.get(line)
  if (typeof exact === 'number') return exact
  let nextLine = Infinity
  let nextFrame: number | undefined
  let prevLine = -1
  let prevFrame: number | undefined
  for (const [l, f] of map.entries()) {
    if (l >= line && l < nextLine) {
      nextLine = l
      nextFrame = f
    }
    if (l <= line && l > prevLine) {
      prevLine = l
      prevFrame = f
    }
  }
  return nextFrame ?? prevFrame
}

async function applyAiScript(next: string) {
  const prev = script.value
  const prevLines = prev.split(/\r?\n/)
  const nextLines = next.split(/\r?\n/)
  let firstDiffLine = 1
  const maxCheck = Math.max(prevLines.length, nextLines.length)
  for (let i = 0; i < maxCheck; i++) {
    if (prevLines[i] !== nextLines[i]) {
      firstDiffLine = i + 1
      break
    }
  }

  nodeChanges.value = computeSceneChanges(prev, next)
  commitScript(next, true)
  notify(`AI 已更新 ${nodeChanges.value.size} 个场景`)
  await nextTick()
  const targetFrame = resolveFrameForLine(firstDiffLine) ?? 0
  activeFrameIndex.value = targetFrame
  playerRef.value?.pushEpisode(targetFrame)
}

async function pickBranch(sceneId: string, idx: number, targetId: string) {
  activeChoices.value = { ...activeChoices.value, [sceneId]: idx }
  await nextTick()
  const frameIdx = compiled.value.sceneStartFrames.get(targetId)
  if (typeof frameIdx === 'number') {
    activeFrameIndex.value = frameIdx
    playerRef.value?.pushEpisode(frameIdx)
  }
}

function onCursorLine(line: number) {
  const frameIdx = resolveFrameForLine(line)
  if (typeof frameIdx === 'number' && frameIdx !== activeFrameIndex.value) {
    activeFrameIndex.value = frameIdx
    playerRef.value?.seekTo(frameIdx)
  }
}

function onPlayerFrameChange(index: number) {
  activeFrameIndex.value = index
}

function selectFrameGlobal(idx: number) {
  activeFrameIndex.value = idx
  playerRef.value?.seekTo(idx)
  if (workspaceMode.value === 'code') {
    for (const [line, frameIdx] of compiled.value.lineToFrame.entries()) {
      if (frameIdx === idx) {
        editorRef.value?.goToLine(line)
        break
      }
    }
  }
}

function playSceneFromGraph(sceneId: string) {
  const frameIdx = compiled.value.sceneStartFrames.get(sceneId)
  if (typeof frameIdx === 'number') {
    activeFrameIndex.value = frameIdx
    playerRef.value?.seekTo(frameIdx)
  }
}

function openAssetPicker(kind: PickerAssetKind) {
  assetPickerKind.value = kind
  assetPickerOpen.value = true
}

function onPickerSelect(payload: { kind: PickerAssetKind; id: string }) {
  if (workspaceMode.value === 'code') {
    const map: Record<PickerAssetKind, string> = {
      backgrounds: `@bg ${payload.id} fade=cross`,
      spines: `@char 1 ${payload.id} pos=center expr=normal body=normal`,
      stills: `@still ${payload.id}`,
      bgms: `@bgm ${payload.id}`,
      ses: `@se ${payload.id}`,
    }
    editorRef.value?.insertLine(map[payload.kind])
    return
  }

  // Apply directly to the currently selected scene & frame
  const doc = parseStoryGraph(script.value)
  const targetNode = doc.nodes.find((n) => n.id === selectedNodeId.value) ?? doc.nodes[0]
  if (!targetNode) return
  const framesMap = getSceneVisualFrames(doc, compiled.value.sceneStartFrames)
  const frames = (framesMap.get(targetNode.id) ?? []).map((x) => JSON.parse(JSON.stringify(x.frame)))
  if (frames.length === 0) return
  const idx = Math.max(0, Math.min(selectedLocalFrameIdx.value, frames.length - 1))
  const f = frames[idx]
  if (payload.kind === 'backgrounds') {
    f.BackgroundImageFileName = payload.id
    f.BackgroundImageFileFadeType = 4
  } else if (payload.kind === 'stills') {
    f.StillPhotoFileName = payload.id
  } else if (payload.kind === 'bgms') {
    f.BgmFileName = payload.id
  } else if (payload.kind === 'ses') {
    f.SeFileName = payload.id
  } else if (payload.kind === 'spines') {
    const spineId = Number(payload.id)
    if (Number.isFinite(spineId)) {
      const used = new Set(f.CharacterMotions.map((c: any) => c.slotNumber))
      let slot = 1
      while (used.has(slot)) slot++
      f.CharacterMotions.push({
        slotNumber: slot,
        SpineId: spineId,
        CharacterPosition: slot === 1 ? 3 : slot === 2 ? 4 : 2,
        CharacterAppearanceType: 0,
        CharacterLayerType: 0,
        SpineSize: 1,
        FacialExpressionMasterId: 1,
        BodyMotionMasterId: 1,
      })
    }
  }
  targetNode.body = framesToSceneDsl(frames, parseAliasMap(doc.preamble))
  doc.hasExplicitScenes = true
  commitScript(serializeStoryGraph(doc))
  notify(`已应用 ${payload.id} 到当前帧`)
}

async function importLocalAsset(overrideKind?: 'background' | 'bgm' | 'se') {
  if (!window.siriusStudio) {
    notify('请在 Electron 桌面端中导入本地素材')
    return
  }
  const kindMap: Partial<Record<typeof resourceKind.value, 'background' | 'bgm' | 'se'>> = {
    backgrounds: 'background',
    bgms: 'bgm',
    ses: 'se',
  }
  const kind = overrideKind ?? kindMap[resourceKind.value]
  if (!kind) return
  try {
    const res = await window.siriusStudio.importLocalAsset(kind)
    if (!res) return
    projectAssets.value.push(res.asset)
    registerLocalAsset(res.asset)
    notify(`已导入 ${res.asset.originalName}`)
  } catch (err) {
    notify(`导入失败：${errorMessage(err)}`)
  }
}

function registerLocalAsset(asset: ProjectAsset) {
  const key = { background: 'backgrounds', bgm: 'bgms', se: 'ses', voice: null }[asset.kind] as 'backgrounds' | 'bgms' | 'ses' | null
  if (key && !catalog.value[key].includes(asset.id)) catalog.value[key].unshift(asset.id)
}

function assetDisplayName(id: string) {
  return projectAssets.value.find((asset) => asset.id === id)?.originalName ?? id
}

function assetUrl(kind: string, id: string, ext: string) {
  return `${assetBase}/${kind}/${encodeURIComponent(id)}.${ext}`
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

async function saveFile() {
  const content = script.value
  try {
    if (window.siriusStudio) await window.siriusStudio.saveStory(content)
    lastSavedScript.value = content
    notify('项目已保存')
    return true
  } catch (err) {
    notify(`保存失败：${errorMessage(err)}`)
    return false
  }
}

async function confirmExportZip() {
  if (!canExport.value) return
  showExportModal.value = false
  const json = JSON.stringify(compiled.value.episode, null, 2)
  const baseName = (compiled.value.episode.Title || 'episode').replace(/[\\/:*?"<>|]/g, '_')
  if (window.siriusStudio) {
    try {
      const res = await window.siriusStudio.exportZip({
        json,
        storyDsl: script.value,
        defaultName: `${baseName}.zip`,
        title: compiled.value.episode.Title,
        chapter: compiled.value.episode.Chapter,
      })
      if (res) notify(`已导出作品包（含 ${res.assetCount} 个扩展资源）`)
    } catch (err) {
      notify(`导出失败：${errorMessage(err)}`)
    }
    return
  }
  notify('请在 Electron 桌面端导出 ZIP 作品包')
}
</script>

<template>
  <div class="studio-root" :class="{ 'is-resizing': resizingKind !== null }">
    <div v-if="showAiMenu || showProjectMenu" class="toolbar-dismiss" @click="closeMenus" />
    <header class="top-bar" @dblclick.self="isElectronDesktop && toggleMaximizeWindow()">
      <div class="brand-group no-drag">
        <button
          class="icon-toggle"
          :class="{ active: showLeftPane }"
          type="button"
          title="素材箱"
          @click="showLeftPane = !showLeftPane"
        >
          <PanelLeft :size="15" />
        </button>
        <span class="brand-dot" />
        <span class="brand-name">SiriusAdvStudio</span>
        <span class="beta-badge">beta</span>
        <span class="episode-title" :title="currentFilePath || ''">
          <span v-if="isDirty" class="dirty-dot" title="有未保存改动" />
          {{ compiled.episode.Title }}
        </span>

        <div class="mode-pill">
          <button
            type="button"
            class="mode-seg"
            :class="{ active: workspaceMode === 'visual' }"
            @click="workspaceMode = 'visual'"
          >
            <GitBranch :size="12" /><span>可视化</span>
          </button>
          <button
            type="button"
            class="mode-seg"
            :class="{ active: workspaceMode === 'code' }"
            @click="workspaceMode = 'code'"
          >
            <Code2 :size="12" /><span>源码</span>
          </button>
        </div>

        <div class="undo-group">
          <button class="icon-toggle" type="button" title="撤销 (Ctrl+Z)" :disabled="undoPast.length === 0" @click="undo">
            <Undo2 :size="14" />
          </button>
          <button class="icon-toggle" type="button" title="重做 (Ctrl+Y)" :disabled="undoFuture.length === 0" @click="redo">
            <Redo2 :size="14" />
          </button>
        </div>

        <button
          v-if="compiled.diagnostics.length > 0"
          class="diag-chip"
          type="button"
          @click="workspaceMode = 'code'"
        >
          <AlertTriangle :size="11" /> {{ compiled.diagnostics.length }}
        </button>
      </div>

      <div class="toolbar-actions no-drag">
        <div class="toolbar-menu">
          <button class="tb-btn" type="button" :aria-expanded="showProjectMenu" @click="showProjectMenu = !showProjectMenu; showAiMenu = false">
            <FolderOpen :size="13" /><span>项目 ▾</span>
          </button>
          <div v-if="showProjectMenu" class="toolbar-popup">
            <button v-if="isElectronDesktop" @click="closeMenus(); requestCloseWindow('launcher')">项目向导 / 最近项目</button>
            <button @click="closeMenus(); jsonInputRef?.click()">导入 ADV JSON</button>
            <button @click="closeMenus(); dslInputRef?.click()">导入 DSL / .story</button>
          </div>
        </div>
        <button class="tb-btn" :class="{ dirty: isDirty }" type="button" title="保存项目 (Ctrl+S)" @click="saveFile">
          <Save :size="13" /><span>保存</span>
        </button>
        <input ref="jsonInputRef" type="file" accept=".json,application/json" style="display: none" @change="onJsonFileSelected" />

        <input ref="dslInputRef" type="file" accept=".dsl,.story,.txt" hidden @change="onDslFileSelected" />
        <button class="tb-btn primary" type="button" @click="showExportModal = true">
          <Download :size="13" /><span>导出 ZIP</span>
        </button>

        <span class="v-sep" />

        <button
          v-if="workspaceMode === 'visual'"
          class="icon-toggle"
          :class="{ active: showInspector }"
          type="button"
          title="属性栏"
          @click="showInspector = !showInspector"
        >
          <PanelRight :size="15" />
        </button>
        <div class="toolbar-menu">
          <button class="tb-btn" :class="{ active: showAiPanel }" type="button" :aria-expanded="showAiMenu" @click="showAiMenu = !showAiMenu; showProjectMenu = false">
            <Bot :size="13" /><span>AI ▾</span>
          </button>
          <div v-if="showAiMenu" class="toolbar-popup">
            <button @click="showAiPanel = !showAiPanel; closeMenus()">{{ showAiPanel ? '隐藏' : '显示' }} AI 对话</button>
            <button @click="openAiConfig('connection')">连接、模型与推理</button>
            <button @click="openAiConfig('skills')">Skills</button>
            <button @click="openAiConfig('mcp')">MCP</button>
          </div>
        </div>
        <button class="icon-toggle" type="button" title="关于 SiriusAdvStudio" @click="showAboutModal = true">
          <Info :size="14" />
        </button>

        <!-- Custom Electron Window Controls -->
        <div v-if="isElectronDesktop" class="win-controls">
          <button class="win-btn" type="button" title="最小化" @click="minimizeWindow">
            <Minus :size="13" />
          </button>
          <button class="win-btn" type="button" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximizeWindow">
            <Copy v-if="isMaximized" :size="11" />
            <Square v-else :size="11" />
          </button>
          <button class="win-btn close" type="button" title="关闭" @click="requestCloseWindow()">
            <X :size="13" />
          </button>
        </div>
      </div>
    </header>

    <!-- NLE Main Body -->
    <main class="studio-body">
      <div ref="mainDeckRef" class="nle-workbench">
        <!-- TOP DECK: Asset Bin | 16:9 Stage | Inspector -->
        <div class="top-deck" :style="{ height: `${topSplitPct}%` }">
          <aside v-if="showLeftPane" class="asset-bin" :style="{ width: `${leftWidth}px` }">
            <div class="tab-row">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: leftTab === 'resources' }"
                @click="leftTab = 'resources'"
              >
                素材
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: leftTab === 'outline' }"
                @click="leftTab = 'outline'"
              >
                大纲 ({{ compiled.episode.EpisodeDetail.length }})
              </button>
            </div>

            <div v-if="leftTab === 'outline'" class="bin-list">
              <button
                v-for="(frame, idx) in compiled.episode.EpisodeDetail"
                :key="frame.Id"
                type="button"
                class="list-item"
                :class="{ 'is-active': idx === activeFrameIndex }"
                @click="selectFrameGlobal(idx)"
              >
                <span class="item-idx">{{ idx + 1 }}</span>
                <span class="item-who">{{ frame.SpeakerName || '旁白' }}</span>
                <span class="item-text">{{ frame.Phrase || '(指令)' }}</span>
              </button>
            </div>

            <div v-else class="resource-browser">
              <div class="res-controls">
                <div style="display: flex; gap: 4px">
                  <select v-model="resourceKind" class="res-select" style="flex: 1">
                    <option value="backgrounds">背景 ({{ catalog.backgrounds.length }})</option>
                    <option value="spines">角色 ({{ catalog.spines.length }})</option>
                    <option value="stills">CG ({{ catalog.stills.length }})</option>
                    <option value="bgms">BGM ({{ catalog.bgms.length }})</option>
                    <option value="ses">SE ({{ catalog.ses.length }})</option>
                  </select>
                  <button class="tb-btn" style="height: 25px; padding: 0 7px; font-size: 11px" type="button" title="打开大型素材选择弹窗" @click="openAssetPicker(resourceKind)">
                    大图库
                  </button>
                </div>
                <input v-model="resourceQuery" class="res-search" type="text" placeholder="搜索并拖入场景…" />
                <button
                  v-if="resourceKind === 'backgrounds' || resourceKind === 'bgms' || resourceKind === 'ses'"
                  type="button"
                  class="tb-btn full-btn"
                  @click="importLocalAsset()"
                >
                  + 导入本地素材
                </button>
              </div>
              <div class="bin-list">
                <div
                  v-for="id in filteredResources"
                  :key="id"
                  class="res-row"
                  draggable="true"
                  @dragstart="onAssetDragStart($event, id)"
                >
                  <button
                    type="button"
                    class="list-item res-item"
                    :title="`拖拽 ${id} 到下方场景`"
                    @click="insertResourceSnippet(id)"
                  >
                    <img
                      v-if="resourceKind === 'backgrounds'"
                      :src="id.startsWith('asset_') ? assetUrl('background', id, 'png') : `${ADV_RESOURCE_CDN}/background/${encodeURIComponent(id)}.png`"
                      loading="lazy"
                      class="res-thumb"
                    />
                    <span class="res-id">{{ assetDisplayName(id) }}</span>
                  </button>
                  <button
                    v-if="resourceKind === 'bgms' || resourceKind === 'ses'"
                    type="button"
                    class="audio-btn"
                    @click="toggleAudioPreview(resourceKind, id)"
                  >
                    <Square v-if="playingAudioId === `${resourceKind}:${id}`" :size="10" />
                    <Play v-else :size="10" />
                  </button>
                  <button
                    v-if="resourceKind === 'spines'"
                    type="button"
                    class="audio-btn"
                    @click="previewSpineId = id"
                  >
                    <Eye :size="11" />
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <div v-if="showLeftPane" class="splitter-v" @mousedown="startResize('left', $event)" />

          <section class="stage-center">
            <div v-if="choiceNodes.length > 0" class="branch-bar">
              <template v-for="cNode in choiceNodes" :key="cNode.id">
                <span class="branch-title">{{ cNode.title }}:</span>
                <button
                  v-for="(c, cIdx) in cNode.choices"
                  :key="`${cNode.id}-${cIdx}`"
                  type="button"
                  class="branch-chip"
                  :class="{ active: (activeChoices[cNode.id] ?? 0) === cIdx }"
                  @click="pickBranch(cNode.id, cIdx, c.target)"
                >
                  {{ c.label }}
                </button>
              </template>
            </div>
            <div class="stage-player-wrap">
              <PlayerPreview
                :asset-base="assetBase"
                ref="playerRef"
                :episode="compiled.episode"
                @frame-change="onPlayerFrameChange"
              />
            </div>
          </section>

          <div
            v-if="workspaceMode === 'visual' && showInspector"
            class="splitter-v"
            @mousedown="startResize('inspector', $event)"
          />

          <aside
            v-if="workspaceMode === 'visual' && showInspector"
            class="inspector-pane"
            :style="{ width: `${inspectorWidth}px` }"
          >
            <NodeInspector
              :asset-base="assetBase"
              :local-voices="projectAssets.filter((asset) => asset.kind === 'voice')"
              @asset-imported="projectAssets.push($event)"
              :model-value="script"
              :episode="compiled.episode"
              :scene-start-frames="compiled.sceneStartFrames"
              :selected-node-id="selectedNodeId"
              :selected-local-frame-idx="selectedLocalFrameIdx"
              @update:model-value="commitScript($event)"
              @update:selected-local-frame-idx="selectedLocalFrameIdx = $event"
              @play-scene="playSceneFromGraph"
              @open-picker="openAssetPicker"
            />
          </aside>
        </div>

        <div
          class="splitter-h"
          title="拖拽调整高度（双击重置）"
          @mousedown="startResize('topSplit', $event)"
          @dblclick="topSplitPct = 48; persistLayout()"
        />

        <!-- BOTTOM DECK: MoeSekai-style Full-Width Visual Flow Canvas -->
        <section class="bottom-deck">
          <StoryGraph
            v-if="workspaceMode === 'visual'"
            :model-value="script"
            :episode="compiled.episode"
            :scene-start-frames="compiled.sceneStartFrames"
            :active-frame-index="activeFrameIndex"
            :selected-node-id="selectedNodeId"
            :selected-local-frame-idx="selectedLocalFrameIdx"
            :node-changes="nodeChanges"
            @update:model-value="commitScript($event)"
            @update:selected-node-id="selectedNodeId = $event"
            @update:selected-local-frame-idx="selectedLocalFrameIdx = $event"
            @play-scene="playSceneFromGraph"
            @select-frame="selectFrameGlobal"
            @clear-changes="nodeChanges = new Map()"
          />
          <DslEditor
            v-else
            ref="editorRef"
            :model-value="script"
            :diagnostics="compiled.diagnostics"
            :catalog="catalog"
            @update:model-value="commitScript($event)"
            @cursor-line="onCursorLine"
            @undo="undo"
            @redo="redo"
          />
        </section>
      </div>

      <div v-if="showAiPanel" class="splitter-v" @mousedown="startResize('ai', $event)" />
      <aside v-show="showAiPanel" class="ai-dock" :style="{ width: `${aiWidth}px` }">
        <AiHarnessPanel
          ref="aiPanel"
          :script="script"
          :file-path="currentFilePath"
          :diagnostics="compiled.diagnostics"
          @apply-script="applyAiScript"
        />
      </aside>
    </main>

    <!-- Subtle Floating Toast -->
    <div v-if="toastMsg" class="toast-pill">{{ toastMsg }}</div>

    <!-- Exit Confirmation Modal -->
    <div v-if="showExitConfirmModal" class="modal-backdrop spine-top" @click.self="showExitConfirmModal = false">
      <div class="preflight-modal">
        <div class="modal-header">
          <span>{{ closeDestination === 'launcher' ? '关闭项目前确认' : '退出前确认' }}</span>
          <button class="tb-btn" type="button" @click="showExitConfirmModal = false">取消</button>
        </div>
        <div class="preflight-body">
          <div class="pf-contents">当前剧本存在未保存的修改，是否在退出前保存？</div>
        </div>
        <div class="modal-footer">
          <button class="tb-btn" type="button" @click="forceCloseWindow">不保存退出</button>
          <button class="tb-btn primary" type="button" @click="saveAndCloseWindow">
            <Save :size="13" /> 保存并退出
          </button>
        </div>
      </div>
    </div>

    <!-- About Modal -->
    <div v-if="showAboutModal" class="modal-backdrop" @click.self="showAboutModal = false">
      <div class="preflight-modal">
        <div class="modal-header">
          <span>关于 SiriusAdvStudio beta</span>
          <button class="tb-btn" type="button" @click="showAboutModal = false">关闭</button>
        </div>
        <div class="preflight-body">
          <div class="about-hero">
            <span class="brand-dot" />
            <strong>SiriusAdvStudio</strong>
            <span class="beta-badge">beta v0.1.0</span>
          </div>
          <div class="pf-contents">
            面向 World Dai Star（WDS Adv Player）的 NLE 可视化剧情制作工作台，支持图形分镜编排、实时 Spine 舞台预览、本地 AI Harness（Antigravity / Claude / Codex / DeepSeek），并可接入本地原版剧情索引。
          </div>
          <div class="pf-stats">
            <div class="pf-stat"><span>架构</span><strong>Electron + Vue 3 + PixiJS / Spine 4.1</strong></div>
            <div class="pf-stat"><span>剧情语料</span><strong>可选本地索引</strong></div>
          </div>
          <div class="pf-contents">
            <strong>致谢：</strong>灵感与工作台架构致敬 <code>StarMoe-org/moesekai-story-studio</code> 与 <code>WDS Adv Player</code> 社区。
          </div>
        </div>
      </div>
    </div>

    <!-- Preflight ZIP Export Modal -->
    <div v-if="showExportModal" class="modal-backdrop" @click.self="showExportModal = false">
      <div class="preflight-modal">
        <div class="modal-header">
          <span>导出作品包 (.zip)</span>
          <button class="tb-btn" type="button" @click="showExportModal = false">关闭</button>
        </div>
        <div class="preflight-body">
          <div class="pf-stats">
            <div class="pf-stat"><span>剧集</span><strong>{{ compiled.episode.Title }}</strong></div>
            <div class="pf-stat"><span>规模</span><strong>{{ graphDoc.nodes.length }} 场景 · {{ compiled.episode.EpisodeDetail.length }} 帧</strong></div>
          </div>
          <div class="pf-contents">
            包含原版 ADV 格式的 <code>episode.json</code>、<code>manifest.json</code>、<code>story.dsl</code> 和 {{ projectAssets.length }} 个本地素材。
            <div v-if="choiceNodes.length">ADV JSON 导出当前路线，完整分支保留在 DSL 中。</div>
          </div>
          <div v-if="!canExport" class="pf-diag-box">
            <div v-if="!compiled.episode.EpisodeDetail.length">当前路线没有可导出的帧。</div>
            <div v-for="asset in missingExportAssets" :key="asset">未索引的项目素材 {{ asset }}</div>
          </div>
          <div v-if="compiled.diagnostics.length > 0" class="pf-diag-box">
            <div class="pf-diag-head">
              <AlertTriangle :size="13" /> {{ compiled.diagnostics.length }} 条诊断警告
            </div>
            <div v-for="(d, i) in compiled.diagnostics.slice(0, 5)" :key="i">L{{ d.line }}: {{ d.message }}</div>
          </div>
          <div v-else-if="canExport" class="pf-ok-box">
            <CheckCircle2 :size="14" /> 预检通过
          </div>
        </div>
        <div class="modal-footer">
          <button class="tb-btn" type="button" @click="showExportModal = false">取消</button>
          <button class="tb-btn primary" type="button" :disabled="!canExport" @click="confirmExportZip">
            <Download :size="13" /> 导出 .zip
          </button>
        </div>
      </div>
    </div>

    <!-- Large Visual Asset Picker Dialog -->
    <AssetPickerDialog
      :asset-base="assetBase"
      :open="assetPickerOpen"
      :initial-kind="assetPickerKind"
      :catalog="catalog"
      @close="assetPickerOpen = false"
      @select="onPickerSelect"
      @preview-spine="previewSpineId = $event"
      @import-local="importLocalAsset($event)"
    />

    <!-- Spine Preview Modal (z-index higher than AssetPickerDialog!) -->
    <div v-if="previewSpineId" class="modal-backdrop spine-top" @click.self="previewSpineId = null">
      <div class="spine-modal">
        <div class="modal-header">
          <span>Spine · {{ previewSpineId }}</span>
          <button class="tb-btn" type="button" @click="previewSpineId = null">关闭</button>
        </div>
        <iframe
          :src="`./wds-adv-player/index.html?spine=${encodeURIComponent(previewSpineId)}&renderer=webgl`"
          class="spine-iframe"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.studio-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #09090b;
  color: #f4f4f5;
  overflow: hidden;
}
.studio-root.is-resizing {
  user-select: none;
}
.studio-root.is-resizing :deep(iframe) {
  pointer-events: none;
}

.top-bar {
  height: 40px;
  padding: 0 8px 0 10px;
  background: #121215;
  border-bottom: 1px solid #232329;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.beta-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(236, 72, 153, 0.16);
  border: 1px solid rgba(236, 72, 153, 0.35);
  color: #f472b6;
}
.win-controls {
  display: flex;
  align-items: center;
  margin-left: 6px;
  padding-left: 6px;
  border-left: 1px solid #26262e;
  gap: 2px;
}
.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.win-btn:hover {
  background: #272731;
  color: #f4f4f5;
}
.win-btn.close:hover {
  background: #dc2626;
  color: #ffffff;
}
.brand-group,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.icon-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.icon-toggle:hover {
  background: #23232a;
  color: #f4f4f5;
}
.icon-toggle.active {
  background: #23232a;
  color: #f472b6;
}
.brand-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f472b6, #a855f7);
  flex-shrink: 0;
}
.brand-name {
  font-size: 13px;
  font-weight: 700;
  color: #fafafa;
  white-space: nowrap;
}
.episode-title {
  font-size: 12px;
  color: #a1a1aa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.mode-pill {
  display: inline-flex;
  background: #09090b;
  border: 1px solid #26262e;
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
  margin-left: 4px;
}
.mode-seg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.mode-seg.active {
  background: #27272f;
  color: #fff;
  font-weight: 600;
}
.diag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #991b1b;
  background: rgba(127, 29, 29, 0.35);
  color: #fca5a5;
  cursor: pointer;
}
.v-sep {
  width: 1px;
  height: 16px;
  background: #26262e;
  margin: 0 2px;
}
.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 9px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #e4e4e7;
  cursor: pointer;
  white-space: nowrap;
}
.tb-btn:hover {
  background: #26262f;
}
.tb-btn.primary {
  background: #db2777;
  border-color: #db2777;
  color: #fff;
}
.tb-btn.primary:hover {
  background: #be185d;
}
.tb-btn.ai-toggle.active {
  border-color: rgba(52, 211, 153, 0.45);
  background: rgba(16, 185, 129, 0.14);
  color: #34d399;
}
.ai-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #34d399;
}
.full-btn {
  width: 100%;
  justify-content: center;
  font-size: 11px;
  height: 25px;
}

.more-wrap {
  position: relative;
}
.more-menu {
  position: absolute;
  right: 0;
  top: 32px;
  min-width: 140px;
  padding: 4px;
  border-radius: 8px;
  background: #18181d;
  border: 1px solid #2e2e38;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 40;
}
.more-menu button {
  text-align: left;
  font-size: 12px;
  padding: 6px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #e4e4e7;
  cursor: pointer;
}
.more-menu button:hover {
  background: #272730;
}

/* Main NLE Body */
.studio-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.nle-workbench {
  flex: 1;
  min-width: 440px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.top-deck {
  display: flex;
  min-height: 190px;
  overflow: hidden;
  flex-shrink: 0;
}
.bottom-deck {
  flex: 1;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.bottom-deck :deep(.editor-shell) {
  border: 0;
  border-radius: 0;
}
.ai-dock {
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.splitter-v {
  width: 4px;
  cursor: col-resize;
  background: #141418;
  border-left: 1px solid #232329;
  flex-shrink: 0;
  transition: background 0.15s;
}
.splitter-v:hover {
  background: #db2777;
}
.splitter-h {
  height: 4px;
  cursor: row-resize;
  background: #141418;
  border-top: 1px solid #232329;
  flex-shrink: 0;
  transition: background 0.15s;
}
.splitter-h:hover {
  background: #db2777;
}

.asset-bin {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #101014;
  overflow: hidden;
}
.tab-row {
  display: flex;
  height: 34px;
  padding: 4px 6px;
  gap: 4px;
  background: #16161b;
  border-bottom: 1px solid #232329;
  flex-shrink: 0;
}
.tab-btn {
  flex: 1;
  font-size: 11px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.tab-btn.active {
  background: #26262f;
  color: #fff;
  font-weight: 600;
}
.bin-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}
.list-item {
  width: 100%;
  text-align: left;
  padding: 5px 7px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: #d4d4d8;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: center;
}
.list-item:hover {
  background: #1e1e24;
}
.list-item.is-active {
  background: rgba(236, 72, 153, 0.14);
  border-color: rgba(236, 72, 153, 0.35);
}
.item-idx {
  color: #71717a;
  font-size: 10px;
  min-width: 16px;
}
.item-who {
  color: #f472b6;
  font-weight: 600;
  flex-shrink: 0;
}
.item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #a1a1aa;
}
.resource-browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.res-controls {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-bottom: 1px solid #202026;
}
.res-select,
.res-search {
  width: 100%;
  font-size: 11px;
  padding: 4px 7px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #09090b;
  color: #e4e4e7;
}
.res-row {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: grab;
}
.res-item {
  flex: 1;
  min-width: 0;
  padding: 4px 5px;
}
.res-thumb {
  width: 40px;
  height: 22px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}
.res-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #16161b;
  color: #38bdf8;
  cursor: pointer;
}

.stage-center {
  flex: 1;
  min-width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #09090b;
  overflow: hidden;
}
.stage-player-wrap {
  flex: 1;
  min-height: 0;
}
.branch-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 4px 10px;
  background: #16161b;
  border-bottom: 1px solid #232329;
  flex-shrink: 0;
}
.branch-title {
  font-size: 11px;
  color: #fcd34d;
  font-weight: 600;
}
.branch-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid #303038;
  background: #09090b;
  color: #e4e4e7;
  cursor: pointer;
}
.branch-chip.active {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
}
.inspector-pane {
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.toast-pill {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(24, 24, 29, 0.92);
  border: 1px solid #3f3f46;
  color: #f4f4f5;
  font-size: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 60;
  pointer-events: none;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-backdrop.spine-top {
  z-index: 80;
}
.preflight-modal {
  width: 480px;
  max-width: 92vw;
  background: #18181d;
  border: 1px solid #303038;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.spine-modal {
  width: 560px;
  height: 440px;
  background: #18181d;
  border: 1px solid #303038;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #26262e;
  font-size: 13px;
  font-weight: 600;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #26262e;
}
.preflight-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pf-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.pf-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #111115;
  border: 1px solid #26262e;
}
.pf-stat span {
  font-size: 10px;
  color: #a1a1aa;
}
.pf-stat strong {
  font-size: 12px;
  color: #f4f4f5;
}
.pf-contents {
  font-size: 12px;
  color: #a1a1aa;
  line-height: 1.5;
}
.pf-contents code {
  color: #38bdf8;
}
.pf-diag-box {
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(127, 29, 29, 0.3);
  border: 1px solid #991b1b;
  color: #fecaca;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pf-diag-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}
.pf-ok-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(52, 211, 153, 0.4);
  color: #6ee7b7;
  font-size: 12px;
}
.icon-toggle:disabled {
  opacity: 0.35;
  cursor: default;
}
.undo-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}
.dirty-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #fbbf24;
  margin-right: 4px;
  vertical-align: middle;
}
.tb-btn.dirty {
  border-color: rgba(251, 191, 36, 0.45);
  color: #fde68a;
}
.project-modal {
  width: 540px;
}
.proj-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.recent-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
  margin-top: 4px;
}
.recent-empty {
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: #71717a;
  background: #111115;
  border-radius: 8px;
}
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 240px;
  overflow-y: auto;
}
.recent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  background: #111115;
  border: 1px solid #26262e;
  cursor: pointer;
}
.recent-row:hover {
  border-color: #ec4899;
  background: #18181f;
}
.recent-main {
  min-width: 0;
  flex: 1;
}
.recent-title {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
}
.recent-path {
  font-size: 10px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.about-hero {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.spine-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #09090b;
}
</style>
