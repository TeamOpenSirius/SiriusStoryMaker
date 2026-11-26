<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  BookMarked,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileJson,
  FolderOpen,
  FolderRoot,
  GitBranch,
  Images,
  Info,
  LayoutGrid,
  LogOut,
  Minus,
  PanelLeft,
  PanelRight,
  Play,
  Plug,
  Redo2,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Square,
  Undo2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-vue-next'
import AiHarnessPanel from './components/AiHarnessPanel.vue'
import AssetPickerDialog, { type PickerAssetKind } from './components/AssetPickerDialog.vue'
import NodeInspector from './components/NodeInspector.vue'
import PlayerPreview from './components/PlayerPreview.vue'
import VideoExportDialog from './components/VideoExportDialog.vue'
import { useAudioMix } from './services/audioMix'
import ProjectFilesPanel from './components/ProjectFilesPanel.vue'
import SettingsModal from './components/SettingsModal.vue'
import StoryGraph from './components/StoryGraph.vue'
// Lazy-load CodeMirror 6 DSL editor so memory stays low when using the default visual workbench
const DslEditor = defineAsyncComponent(() => import('./components/DslEditor.vue'))
import { compileDsl } from './dsl/compiler'
import { decompileEpisode } from './dsl/decompiler'
import { setSceneBgm, parseStoryGraph, serializeStoryGraph } from './dsl/graph'
import {
  ASSET_DRAG_MIME,
  BUILTIN_CAST,
  computeSceneChanges,
  framesToSceneDsl,
  createSceneFrameResolver,
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
import { useI18n } from './i18n'

const { tr } = useI18n()

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
const thumbBase = ref('')
const spineThumbs = ref<Record<string, string>>({})
const spineThumbWorkerActive = ref(false)
const spineThumbFrameRef = ref<HTMLIFrameElement | null>(null)
const spineThumbWorkerKey = ref(0)
const thumbBuildTotal = ref(0)
const thumbBuildDone = ref(0)
const thumbBuildFailed = ref(0)
const thumbBuildCurrentId = ref('')
const binLimit = ref(80)
const binListRef = ref<HTMLElement | null>(null)
let spineThumbQueue: string[] = []
let spineThumbTimer: ReturnType<typeof setTimeout> | null = null
let spineThumbTimeout: ReturnType<typeof setTimeout> | null = null
let pendingSpineId: string | null = null
let announceThumbBuild = false
const pendingThumbWrites = new Set<Promise<unknown>>()
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
const bottomTab = ref<'story' | 'files'>('story')
watch(workspaceMode, () => {
  bottomTab.value = 'story'
})
const selectedNodeId = ref<string | null>('start')
const selectedLocalFrameIdx = ref(0)
const activeFrameIndex = ref(0)
const activeChoices = ref<Record<string, number>>({})
const playingAudioId = ref<string | null>(null)
const previewSpineId = ref<string | null>(null)
const activeMenu = ref<'file' | 'edit' | 'model' | 'ai' | 'about' | null>(null)
const aiPanel = ref<InstanceType<typeof AiHarnessPanel> | null>(null)
const closeDestination = ref<'quit' | 'launcher'>('quit')
let allowClose = false
const showAboutModal = ref(false)
const showSettingsModal = ref(false)
const showExitConfirmModal = ref(false)
const showExportModal = ref(false)
const confirmBeforeExit = ref(localStorage.getItem('sirius-adv-studio.confirm-exit') !== 'false')
const assetPickerOpen = ref(false)
const assetPickerKind = ref<PickerAssetKind>('backgrounds')
const isElectronDesktop = typeof window !== 'undefined' && Boolean(window.siriusStudio)
const isMaximized = ref(false)
let unsubMax: (() => void) | null = null
let unsubClose: (() => void) | null = null

watch(confirmBeforeExit, (val) => {
  try { localStorage.setItem('sirius-adv-studio.confirm-exit', val ? 'true' : 'false') } catch { /* ignore */ }
})

function toggleMenu(name: 'file' | 'edit' | 'model' | 'ai' | 'about') {
  activeMenu.value = activeMenu.value === name ? null : name
}

function hoverMenu(name: 'file' | 'edit' | 'model' | 'ai' | 'about') {
  if (activeMenu.value !== null) activeMenu.value = name
}

function resetLayout() {
  leftWidth.value = 220
  inspectorWidth.value = 280
  aiWidth.value = 340
  topSplitPct.value = 48
  showLeftPane.value = true
  showInspector.value = true
  showAiPanel.value = false
  persistLayout()
  notify('已重置默认布局')
}

function minimizeWindow() {
  void window.siriusStudio?.windowMinimize()
}

function toggleMaximizeWindow() {
  void window.siriusStudio?.windowMaximize()
}

function requestCloseWindow(destination: 'quit' | 'launcher' = 'quit') {
  closeDestination.value = destination
  if (confirmBeforeExit.value && isDirty.value) {
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
  activeMenu.value = null
  await nextTick()
  aiPanel.value?.openConfig(tab)
}

function closeMenus() {
  activeMenu.value = null
}
const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const jsonInputRef = ref<HTMLInputElement | null>(null)
const dslInputRef = ref<HTMLInputElement | null>(null)
const mainDeckRef = ref<HTMLElement | null>(null)
const editorRef = ref<{ insertLine: (s: string) => void; goToLine: (n: number) => void; getCursorLine: () => number | undefined } | null>(null)
const videoDialog = ref<'export' | 'setup' | null>(null)
const editorMix = useAudioMix('editor')
const previewMuted = ref(false)
function openVideoDialog(kind: 'export' | 'setup') {
  closeMenus()
  if (kind === 'export') playerRef.value?.pause()
  videoDialog.value = kind
}
async function openPlayback() {
  closeMenus()
  try { await window.siriusStudio?.openPlayback() }
  catch (err) { notify(`无法打开剧情：${errorMessage(err)}`) }
}
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
const previewSceneId = ref<string | null>(null)
const previewRouteKey = computed(() => JSON.stringify([previewSceneId.value, activeChoices.value]))
const previewCompiled = computed(() => previewSceneId.value
  ? compileDsl(script.value, resourceSets.value, activeChoices.value, previewSceneId.value)
  : compiled.value)
let stageAction = 0

async function seekStage(index: number, alternate: string | null = null, play = false) {
  const action = ++stageAction
  previewSceneId.value = alternate
  activeFrameIndex.value = index
  await nextTick()
  if (action !== stageAction) return
  if (play) playerRef.value?.playFrom(index)
  else playerRef.value?.seekTo(index)
}
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
const resolveSceneFrames = createSceneFrameResolver()
const visualSceneFrames = computed(() => resolveSceneFrames(graphDoc.value, compiled.value.sceneStartFrames))
const choiceNodes = computed(() => graphDoc.value.nodes.filter((n) => n.choices.length > 0))

watch([resourceKind, resourceQuery], () => {
  binLimit.value = 80
  if (binListRef.value) binListRef.value.scrollTop = 0
})

const matchedResources = computed(() => {
  const list = catalog.value[resourceKind.value] || []
  const q = resourceQuery.value.trim().toLowerCase()
  return q
    ? list.filter((id) => {
        const castName = resourceKind.value === 'spines' ? (BUILTIN_CAST[Number(id)] || '') : ''
        return id.toLowerCase().includes(q) || assetDisplayName(id).toLowerCase().includes(q) || castName.toLowerCase().includes(q)
      })
    : list
})

const filteredResources = computed(() => matchedResources.value.slice(0, binLimit.value))

function onBinScroll(e: Event) {
  const el = e.target as HTMLElement | null
  if (!el || binLimit.value >= matchedResources.value.length) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
    binLimit.value = Math.min(matchedResources.value.length, binLimit.value + 80)
  }
}

watch(
  () => graphDoc.value.nodes,
  (nodes) => {
    if (previewSceneId.value && !nodes.some((node) => node.id === previewSceneId.value)) previewSceneId.value = null
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
    showSettingsModal.value = false
    showExitConfirmModal.value = false
    showExportModal.value = false
    assetPickerOpen.value = false
    previewSpineId.value = null
    return
  }
  const tag = (e.target as HTMLElement)?.tagName
  const inTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault()
    closeMenus()
    showSettingsModal.value = !showSettingsModal.value
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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

function stopThumbBuild() {
  if (spineThumbTimer) clearTimeout(spineThumbTimer)
  if (spineThumbTimeout) clearTimeout(spineThumbTimeout)
  spineThumbTimer = null
  spineThumbTimeout = null
  pendingSpineId = null
  spineThumbQueue = []
  spineThumbWorkerActive.value = false
  thumbBuildCurrentId.value = ''
}

function finishThumbBuild() {
  const announce = announceThumbBuild
  stopThumbBuild()
  if (window.siriusStudio) {
    void window.siriusStudio.markThumbCacheReady(Object.keys(spineThumbs.value).length).catch(() => {})
  }
  if (announce) {
    notify(thumbBuildFailed.value > 0
      ? `缩略图构建完成，${thumbBuildFailed.value} 项暂不可用`
      : '缩略图缓存构建完成')
  }
}

function restartSpineThumbWorker() {
  spineThumbWorkerKey.value += 1
  spineThumbTimeout = setTimeout(() => {
    stopThumbBuild()
    if (announceThumbBuild) notify('缩略图渲染器启动超时，仍可继续编辑')
  }, 8000)
}

function pumpNextSpineThumb() {
  if (!spineThumbWorkerActive.value || pendingSpineId !== null) return
  if (spineThumbTimeout) clearTimeout(spineThumbTimeout)
  spineThumbTimeout = null
  const nextId = spineThumbQueue.shift()
  if (!nextId) {
    finishThumbBuild()
    return
  }
  const win = spineThumbFrameRef.value?.contentWindow
  if (!win) {
    stopThumbBuild()
    return
  }
  pendingSpineId = nextId
  thumbBuildCurrentId.value = nextId
  win.postMessage({ type: 'wds-render-spine-thumb', id: nextId }, window.location.origin)
  spineThumbTimeout = setTimeout(() => {
    pendingSpineId = null
    thumbBuildDone.value += 1
    thumbBuildFailed.value += 1
    if (spineThumbQueue.length === 0) finishThumbBuild()
    // The iframe can still be busy waiting for a remote asset. A fresh worker
    // prevents it from ignoring the rest of the queue after one timeout.
    else restartSpineThumbWorker()
  }, 8000)
}

function startSpineThumbBuild(ids: string[], announce = false) {
  if (ids.length === 0) return
  stopThumbBuild()
  spineThumbQueue = [...ids]
  announceThumbBuild = announce
  thumbBuildTotal.value = ids.length
  thumbBuildDone.value = 0
  thumbBuildFailed.value = 0
  spineThumbWorkerActive.value = true
  restartSpineThumbWorker()
}

async function rebuildThumbCache(full: boolean = false) {
  let cachedSet = new Set<string>()
  if (full) {
    stopThumbBuild()
    await Promise.allSettled([...pendingThumbWrites])
    if (window.siriusStudio) {
      await window.siriusStudio.clearThumbCache().catch(() => {})
    }
    spineThumbs.value = {}
  } else if (window.siriusStudio) {
    const info = await window.siriusStudio.getThumbInfo().catch(() => null)
    if (info) cachedSet = new Set(info.cachedSpines)
  }
  const priorityIds = Object.keys(BUILTIN_CAST)
  const orderedSpines = [
    ...priorityIds.filter((id) => catalog.value.spines.includes(id)),
    ...catalog.value.spines.filter((id) => !priorityIds.includes(id)),
  ]
  const targets = full ? orderedSpines : orderedSpines.filter((id) => !cachedSet.has(id))
  if (targets.length === 0) {
    notify('缩略图缓存已是最新，无需重建')
    return
  }
  startSpineThumbBuild(targets, true)
}

function onSpineThumbMessage(event: MessageEvent) {
  if (event.source !== spineThumbFrameRef.value?.contentWindow || event.origin !== window.location.origin) return
  const data = event.data
  if (!data || typeof data !== 'object' || !spineThumbWorkerActive.value) return
  if (data.type === 'wds-spine-thumb-ready') {
    pumpNextSpineThumb()
    return
  }
  if (!pendingSpineId || String(data.id) !== pendingSpineId) return
  if (data.type !== 'wds-spine-thumb-result' && data.type !== 'wds-spine-thumb-error') return

  const id = pendingSpineId
  pendingSpineId = null
  if (spineThumbTimeout) clearTimeout(spineThumbTimeout)
  spineThumbTimeout = null
  thumbBuildDone.value += 1
  if (data.type === 'wds-spine-thumb-result' && typeof data.dataUrl === 'string') {
    const dataUrl = data.dataUrl
    spineThumbs.value = { ...spineThumbs.value, [id]: dataUrl }
    if (window.siriusStudio) {
      const write = window.siriusStudio.saveSpineThumb(id, dataUrl).then((url) => {
        if (url && spineThumbs.value[id] === dataUrl) spineThumbs.value = { ...spineThumbs.value, [id]: url }
      }).catch(() => {})
      pendingThumbWrites.add(write)
      void write.finally(() => pendingThumbWrites.delete(write))
    }
  } else {
    thumbBuildFailed.value += 1
  }
  spineThumbTimer = setTimeout(pumpNextSpineThumb, 12)
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('mousemove', onGlobalMouseMove)
  window.addEventListener('mouseup', onGlobalMouseUp)
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('message', onSpineThumbMessage)
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

  // Check persistent disk thumbnail cache; if not built yet, show blocking rebuild dialog before editing
  let cachedSet = new Set<string>()
  let cacheReady = !window.siriusStudio
  if (window.siriusStudio) {
    const info = await window.siriusStudio.getThumbInfo().catch(() => null)
    if (info) {
      thumbBase.value = info.thumbBase
      cacheReady = info.cacheReady
      cachedSet = new Set(info.cachedSpines)
      const map: Record<string, string> = {}
      for (const id of info.cachedSpines) {
        map[id] = `${info.thumbBase}/spine/${encodeURIComponent(id)}.webp`
      }
      spineThumbs.value = map
    }
  }
  const priorityIds = Object.keys(BUILTIN_CAST)
  const orderedSpines = [
    ...priorityIds.filter((id) => official.spines.includes(id)),
    ...official.spines.filter((id) => !priorityIds.includes(id)),
  ]
  const missingSpines = orderedSpines.filter((id) => !cachedSet.has(id))
  if (missingSpines.length > 0) {
    startSpineThumbBuild(missingSpines)
  } else if (!cacheReady && window.siriusStudio) {
    void window.siriusStudio.markThumbCacheReady(cachedSet.size).catch(() => {})
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
  window.removeEventListener('mousemove', onGlobalMouseMove)
  window.removeEventListener('mouseup', onGlobalMouseUp)
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('message', onSpineThumbMessage)
  unsubMax?.()
  unsubClose?.()
  if (toastTimer) clearTimeout(toastTimer)
  stopThumbBuild()
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
  if (resourceKind.value === 'bgms') {
    if (workspaceMode.value === 'code') onPickerSelect({ kind: 'bgms', id })
    else notify(`拖到场景卡片即可设置 BGM ${id}`)
    return
  }
  const map: Record<Exclude<typeof resourceKind.value, 'bgms'>, string> = {
    backgrounds: `@bg ${id} fade=cross`,
    spines: `@char 1 ${id} pos=center expr=normal body=normal`,
    stills: `@still ${id}`,
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

  previewSceneId.value = null
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
  await seekStage(compiled.value.sceneStartFrames.get(targetId) ?? 0)
}

function onCursorLine(line: number) {
  const frameIdx = resolveFrameForLine(line)
  if (typeof frameIdx === 'number' && (previewSceneId.value || frameIdx !== activeFrameIndex.value)) {
    void seekStage(frameIdx)
  }
}

function onPlayerFrameChange(index: number) {
  activeFrameIndex.value = index
}

function selectFrameGlobal(idx: number) {
  void seekStage(idx)
  if (workspaceMode.value === 'code') {
    for (const [line, frameIdx] of compiled.value.lineToFrame.entries()) {
      if (frameIdx === idx) {
        editorRef.value?.goToLine(line)
        break
      }
    }
  }
}

function focusSceneFrame(sceneId: string, localIdx = 0, play = false) {
  const start = compiled.value.sceneStartFrames.get(sceneId)
  if (typeof start === 'number') {
    void seekStage(start + localIdx, null, play)
    return
  }
  const alternate = compileDsl(script.value, resourceSets.value, activeChoices.value, sceneId)
  const alternateStart = alternate.sceneStartFrames.get(sceneId)
  if (typeof alternateStart === 'number') {
    void seekStage(alternateStart + localIdx, sceneId, play)
  } else if (play) {
    notify('当前场景没有可播放的帧')
  }
}

function onSelectSceneNode(nodeId: string | null) {
  selectedNodeId.value = nodeId
  selectedLocalFrameIdx.value = 0
  if (nodeId) focusSceneFrame(nodeId)
}

function onInspectorSelectFrame(localIdx: number) {
  selectedLocalFrameIdx.value = localIdx
  if (selectedNodeId.value) focusSceneFrame(selectedNodeId.value, localIdx)
}

function playSceneFromGraph(sceneId: string) {
  focusSceneFrame(sceneId, 0, true)
}

function openAssetPicker(kind: PickerAssetKind) {
  assetPickerKind.value = kind
  assetPickerOpen.value = true
}

function onPickerSelect(payload: { kind: PickerAssetKind; id: string }) {
  if (payload.kind === 'bgms') {
    const doc = parseStoryGraph(script.value)
    const cursorLine = workspaceMode.value === 'code' ? editorRef.value?.getCursorLine() : undefined
    const targetId = cursorLine === undefined
      ? selectedNodeId.value
      : parseStoryGraph(script.value.split('\n').slice(0, cursorLine).join('\n')).nodes.at(-1)?.id
    const scene = doc.nodes.find((n) => n.id === targetId) ?? doc.nodes[0]
    if (!scene) return
    setSceneBgm(scene, payload.id)
    doc.hasExplicitScenes = true
    commitScript(serializeStoryGraph(doc))
    notify(`已为「${scene.title}」设置 BGM ${payload.id}`)
    return
  }
  if (workspaceMode.value === 'code') {
    const map: Record<Exclude<PickerAssetKind, 'bgms'>, string> = {
      backgrounds: `@bg ${payload.id} fade=cross`,
      spines: `@char 1 ${payload.id} pos=center expr=normal body=normal`,
      stills: `@still ${payload.id}`,
      ses: `@se ${payload.id}`,
    }
    editorRef.value?.insertLine(map[payload.kind])
    return
  }

  // Apply directly to the currently selected scene & frame
  const doc = parseStoryGraph(script.value)
  const targetNode = doc.nodes.find((n) => n.id === selectedNodeId.value) ?? doc.nodes[0]
  if (!targetNode) return
  const frames = (visualSceneFrames.value.get(targetNode.id) ?? []).map((x) => JSON.parse(JSON.stringify(x.frame)))
  if (frames.length === 0) return
  const idx = Math.max(0, Math.min(selectedLocalFrameIdx.value, frames.length - 1))
  const f = frames[idx]
  if (payload.kind === 'backgrounds') {
    f.BackgroundImageFileName = payload.id
    f.BackgroundImageFileFadeType = 4
  } else if (payload.kind === 'stills') {
    f.StillPhotoFileName = payload.id
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

const usedProjectAssetIds = computed(() => {
  const used = new Set<string>()
  const text = script.value
  for (const a of projectAssets.value) {
    if (text.includes(a.id)) used.add(a.id)
  }
  return used
})

async function importLocalAsset(overrideKind?: ProjectAssetKind) {
  if (!window.siriusStudio) {
    notify('请在 Electron 桌面端中导入本地素材')
    return
  }
  const kindMap: Partial<Record<typeof resourceKind.value, ProjectAssetKind>> = {
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

async function removeLocalAsset(asset: ProjectAsset) {
  if (!window.siriusStudio) return
  try {
    const remaining = await window.siriusStudio.removeProjectAsset(asset.kind, asset.id)
    projectAssets.value = remaining
    const key = { background: 'backgrounds', bgm: 'bgms', se: 'ses', voice: null }[asset.kind] as 'backgrounds' | 'bgms' | 'ses' | null
    if (key) {
      catalog.value[key] = catalog.value[key].filter((id) => id !== asset.id)
    }
    notify(`已删除资源 ${asset.originalName}`)
  } catch (err) {
    notify(`删除失败：${errorMessage(err)}`)
  }
}

function revealLocalAsset(asset?: ProjectAsset) {
  if (!window.siriusStudio) return
  void window.siriusStudio.revealProjectAsset(asset ? { kind: asset.kind, id: asset.id } : undefined)
}

async function copyAssetId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    notify(`已复制素材 ID：${id}`)
  } catch {
    notify(id)
  }
}

function openExternalUrl(url: string) {
  if (window.siriusStudio) {
    void window.siriusStudio.openExternal(url)
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
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

function cachedThumbUrl(kind: 'background' | 'still', id: string) {
  if (id.startsWith('asset_')) return assetUrl(kind, id, 'png')
  if (thumbBase.value) return `${thumbBase.value}/${kind}/${encodeURIComponent(id)}.png`
  return `${ADV_RESOURCE_CDN}/${kind}/${encodeURIComponent(id)}.png`
}

function onThumbImgError(e: Event, kind: 'background' | 'still', id: string) {
  const img = e.target as HTMLImageElement | null
  if (!img || img.dataset.fallbackApplied || id.startsWith('asset_')) return
  img.dataset.fallbackApplied = '1'
  img.src = `${ADV_RESOURCE_CDN}/${kind}/${encodeURIComponent(id)}.png`
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
    <div v-if="activeMenu !== null" class="toolbar-dismiss" @click="closeMenus" />
    <header class="top-bar" @dblclick.self="isElectronDesktop && toggleMaximizeWindow()">
      <div class="brand-group no-drag">
        <img class="brand-logo" src="/sirius-logo.png" alt="" width="22" height="22" draggable="false" />
        <span class="brand-name">SiriusStoryMaker</span>
        <span class="beta-badge">beta</span>

        <nav class="menu-bar" :aria-label="tr('主菜单', 'Main Menu')">
          <!-- 文件 -->
          <div class="menu-wrap">
            <button
              class="menu-trigger"
              :class="{ open: activeMenu === 'file' }"
              type="button"
              :aria-expanded="activeMenu === 'file'"
              @click="toggleMenu('file')"
              @mouseenter="hoverMenu('file')"
            >
              {{ tr('文件', 'File') }}
            </button>
            <div v-if="activeMenu === 'file'" class="toolbar-popup left">
              <button v-if="isElectronDesktop" type="button" @click="closeMenus(); requestCloseWindow('launcher')">
                <FolderOpen :size="13" /><span class="m-label">{{ tr('项目向导 / 最近项目', 'Project Launcher / Recent') }}</span><span class="m-kbd">Ctrl+O</span>
              </button>
              <button type="button" @click="closeMenus(); saveFile()">
                <Save :size="13" /><span class="m-label">{{ tr('保存项目', 'Save Project') }}</span><span class="m-kbd">Ctrl+S</span>
              </button>
              <button type="button" @click="closeMenus(); bottomTab = 'files'">
                <FolderRoot :size="13" /><span class="m-label">{{ tr('项目资源文件管理', 'Project Assets Manager') }}</span><span class="m-kbd">{{ projectAssets.length }}</span>
              </button>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); jsonInputRef?.click()">
                <FileJson :size="13" /><span class="m-label">{{ tr('导入 ADV JSON…', 'Import ADV JSON…') }}</span>
              </button>
              <button type="button" @click="closeMenus(); dslInputRef?.click()">
                <FileCode2 :size="13" /><span class="m-label">{{ tr('导入 DSL / .story…', 'Import DSL / .story…') }}</span>
              </button>
              <button type="button" @click="closeMenus(); showExportModal = true">
                <Download :size="13" /><span class="m-label">{{ tr('导出作品包 (.zip)…', 'Export Package (.zip)…') }}</span>
              </button>
              <template v-if="isElectronDesktop">
                <button type="button" @click="openPlayback">
                  <Play :size="13" /><span class="m-label">{{ tr('用独立播放器打开作品…', 'Open in Standalone Player…') }}</span>
                </button>
                <button type="button" :disabled="!canExport" @click="openVideoDialog('export')">
                  <Download :size="13" /><span class="m-label">{{ tr('导出剧情视频（MP4）…', 'Export Story Video (MP4)…') }}</span>
                </button>
              </template>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); showSettingsModal = true">
                <Settings :size="13" /><span class="m-label">{{ tr('设置…', 'Settings…') }}</span><span class="m-kbd">Ctrl+,</span>
              </button>
              <template v-if="isElectronDesktop">
                <div class="popup-sep" />
                <button type="button" @click="closeMenus(); requestCloseWindow()">
                  <LogOut :size="13" /><span class="m-label">{{ tr('退出', 'Exit') }}</span>
                </button>
              </template>
            </div>
          </div>

          <!-- 编辑 -->
          <div class="menu-wrap">
            <button
              class="menu-trigger"
              :class="{ open: activeMenu === 'edit' }"
              type="button"
              :aria-expanded="activeMenu === 'edit'"
              @click="toggleMenu('edit')"
              @mouseenter="hoverMenu('edit')"
            >
              {{ tr('编辑', 'Edit') }}
            </button>
            <div v-if="activeMenu === 'edit'" class="toolbar-popup left">
              <button type="button" :disabled="undoPast.length === 0" @click="closeMenus(); undo()">
                <Undo2 :size="13" /><span class="m-label">{{ tr('撤销', 'Undo') }}</span><span class="m-kbd">Ctrl+Z</span>
              </button>
              <button type="button" :disabled="undoFuture.length === 0" @click="closeMenus(); redo()">
                <Redo2 :size="13" /><span class="m-label">{{ tr('重做', 'Redo') }}</span><span class="m-kbd">Ctrl+Y</span>
              </button>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); workspaceMode = 'visual'">
                <GitBranch :size="13" /><span class="m-label">{{ tr('可视化工作台', 'Visual Workbench') }}</span><Check v-if="workspaceMode === 'visual'" :size="12" class="m-chk" />
              </button>
              <button type="button" @click="closeMenus(); workspaceMode = 'code'">
                <Code2 :size="13" /><span class="m-label">{{ tr('DSL 源码编辑', 'DSL Source Editor') }}</span><Check v-if="workspaceMode === 'code'" :size="12" class="m-chk" />
              </button>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); showLeftPane = !showLeftPane">
                <PanelLeft :size="13" /><span class="m-label">{{ showLeftPane ? tr('隐藏素材箱', 'Hide Asset Bin') : tr('显示素材箱', 'Show Asset Bin') }}</span>
              </button>
              <button v-if="workspaceMode === 'visual'" type="button" @click="closeMenus(); showInspector = !showInspector">
                <PanelRight :size="13" /><span class="m-label">{{ showInspector ? tr('隐藏属性栏', 'Hide Inspector') : tr('显示属性栏', 'Show Inspector') }}</span>
              </button>
              <button type="button" @click="closeMenus(); resetLayout()">
                <RotateCcw :size="13" /><span class="m-label">{{ tr('重置默认布局', 'Reset Default Layout') }}</span>
              </button>
            </div>
          </div>

          <!-- 模型 -->
          <div class="menu-wrap">
            <button
              class="menu-trigger"
              :class="{ open: activeMenu === 'model' }"
              type="button"
              :aria-expanded="activeMenu === 'model'"
              @click="toggleMenu('model')"
              @mouseenter="hoverMenu('model')"
            >
              {{ tr('模型', 'Models') }}
            </button>
            <div v-if="activeMenu === 'model'" class="toolbar-popup left">
              <button type="button" @click="openAiConfig('connection')">
                <SlidersHorizontal :size="13" /><span class="m-label">{{ tr('AI 模型与接口配置…', 'AI Models & Providers…') }}</span>
              </button>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); openAssetPicker('spines')">
                <Users :size="13" /><span class="m-label">{{ tr('角色 Spine 模型库…', 'Character Spine Library…') }}</span>
              </button>
              <button type="button" @click="closeMenus(); openAssetPicker('backgrounds')">
                <Images :size="13" /><span class="m-label">{{ tr('全量素材图库…', 'Full Asset Gallery…') }}</span>
              </button>
            </div>
          </div>

          <!-- AI -->
          <div class="menu-wrap">
            <button
              class="menu-trigger"
              :class="{ open: activeMenu === 'ai', 'is-active-dot': showAiPanel }"
              type="button"
              :aria-expanded="activeMenu === 'ai'"
              @click="toggleMenu('ai')"
              @mouseenter="hoverMenu('ai')"
            >
              <span>AI</span>
              <span v-if="showAiPanel" class="ai-dot" />
            </button>
            <div v-if="activeMenu === 'ai'" class="toolbar-popup left">
              <button type="button" @click="showAiPanel = !showAiPanel; closeMenus()">
                <Bot :size="13" /><span class="m-label">{{ showAiPanel ? tr('隐藏 AI 导演面板', 'Hide AI Director') : tr('显示 AI 导演面板', 'Show AI Director') }}</span>
              </button>
              <div class="popup-sep" />
              <button type="button" @click="openAiConfig('connection')">
                <SlidersHorizontal :size="13" /><span class="m-label">{{ tr('连接、模型与推理…', 'Connection, Models & Reasoning…') }}</span>
              </button>
              <button type="button" @click="openAiConfig('skills')">
                <BookMarked :size="13" /><span class="m-label">{{ tr('Skills 技能库…', 'Skills Library…') }}</span>
              </button>
              <button type="button" @click="openAiConfig('mcp')">
                <Plug :size="13" /><span class="m-label">{{ tr('MCP 工具服务…', 'MCP Tool Server…') }}</span>
              </button>
            </div>
          </div>

          <!-- 关于 -->
          <div class="menu-wrap">
            <button
              class="menu-trigger"
              :class="{ open: activeMenu === 'about' }"
              type="button"
              :aria-expanded="activeMenu === 'about'"
              @click="toggleMenu('about')"
              @mouseenter="hoverMenu('about')"
            >
              {{ tr('关于', 'About') }}
            </button>
            <div v-if="activeMenu === 'about'" class="toolbar-popup left">
              <button type="button" @click="closeMenus(); showSettingsModal = true">
                <Settings :size="13" /><span class="m-label">{{ tr('偏好设置…', 'Preferences…') }}</span><span class="m-kbd">Ctrl+,</span>
              </button>
              <div class="popup-sep" />
              <button type="button" @click="closeMenus(); showAboutModal = true">
                <Info :size="13" /><span class="m-label">{{ tr('关于 SiriusStoryMaker', 'About SiriusStoryMaker') }}</span>
              </button>
            </div>
          </div>
        </nav>

        <span class="v-sep" />

        <span class="episode-title" :title="currentFilePath || ''">
          <span v-if="isDirty" class="dirty-dot" :title="tr('有未保存改动', 'Unsaved changes')" />
          {{ compiled.episode.Title }}
        </span>

        <button
          v-if="compiled.diagnostics.length > 0"
          class="diag-chip"
          type="button"
          :title="tr('查看编译诊断', 'View diagnostics')"
          @click="workspaceMode = 'code'"
        >
          <AlertTriangle :size="11" /> {{ compiled.diagnostics.length }}
        </button>
      </div>

      <div class="toolbar-actions no-drag">
        <div v-if="spineThumbWorkerActive" class="thumb-progress">
          <span :title="thumbBuildCurrentId ? tr(`正在缓存 Spine #${thumbBuildCurrentId}`, `Caching Spine #${thumbBuildCurrentId}`) : tr('正在启动缩略图缓存', 'Starting thumbnail cache')">
            {{ tr('缩略图', 'Thumbs') }} {{ thumbBuildDone }}/{{ thumbBuildTotal }}
          </span>
          <button class="icon-toggle" type="button" :title="tr('停止后台缩略图生成', 'Stop background thumbnail rendering')" :aria-label="tr('停止后台缩略图生成', 'Stop background thumbnail rendering')" @click="stopThumbBuild">
            <X :size="12" />
          </button>
        </div>
        <div class="mode-pill">
          <button
            type="button"
            class="mode-seg"
            :class="{ active: workspaceMode === 'visual' }"
            @click="workspaceMode = 'visual'"
          >
            <GitBranch :size="12" /><span>{{ tr('可视化', 'Visual') }}</span>
          </button>
          <button
            type="button"
            class="mode-seg"
            :class="{ active: workspaceMode === 'code' }"
            @click="workspaceMode = 'code'"
          >
            <Code2 :size="12" /><span>{{ tr('源码', 'Source') }}</span>
          </button>
        </div>

        <button class="tb-btn" :class="{ dirty: isDirty }" type="button" :title="tr('保存项目 (Ctrl+S)', 'Save Project (Ctrl+S)')" @click="saveFile">
          <Save :size="13" /><span>{{ tr('保存', 'Save') }}</span>
        </button>
        <input ref="jsonInputRef" type="file" accept=".json,application/json" style="display: none" @change="onJsonFileSelected" />
        <input ref="dslInputRef" type="file" accept=".dsl,.story,.txt" hidden @change="onDslFileSelected" />

        <button class="tb-btn primary" type="button" @click="showExportModal = true">
          <Download :size="13" /><span>{{ tr('导出 ZIP', 'Export ZIP') }}</span>
        </button>

        <!-- Custom Electron Window Controls -->
        <div v-if="isElectronDesktop" class="win-controls">
          <button class="win-btn" type="button" :title="tr('最小化', 'Minimize')" @click="minimizeWindow">
            <Minus :size="13" />
          </button>
          <button class="win-btn" type="button" :title="isMaximized ? tr('还原', 'Restore') : tr('最大化', 'Maximize')" @click="toggleMaximizeWindow">
            <Copy v-if="isMaximized" :size="11" />
            <Square v-else :size="11" />
          </button>
          <button class="win-btn close" type="button" :title="tr('关闭', 'Close')" @click="requestCloseWindow()">
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
                {{ tr('素材', 'Assets') }}
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: leftTab === 'outline' }"
                @click="leftTab = 'outline'"
              >
                {{ tr('大纲', 'Outline') }} ({{ compiled.episode.EpisodeDetail.length }})
              </button>
            </div>

            <div v-if="leftTab === 'outline'" class="bin-list">
              <button
                v-for="(frame, idx) in compiled.episode.EpisodeDetail"
                :key="frame.Id"
                type="button"
                class="list-item"
                :class="{ 'is-active': !previewSceneId && idx === activeFrameIndex }"
                @click="selectFrameGlobal(idx)"
              >
                <span class="item-idx">{{ idx + 1 }}</span>
                <span class="item-who">{{ frame.SpeakerName || tr('旁白', 'Narrator') }}</span>
                <span class="item-text">{{ frame.Phrase || tr('(指令)', '(Cue)') }}</span>
              </button>
            </div>

            <div v-else class="resource-browser">
              <div class="res-controls">
                <div class="res-top-row">
                  <select v-model="resourceKind" class="res-select">
                    <option value="backgrounds">{{ tr('背景', 'Backgrounds') }} ({{ catalog.backgrounds.length }})</option>
                    <option value="spines">{{ tr('角色', 'Characters') }} ({{ catalog.spines.length }})</option>
                    <option value="stills">CG ({{ catalog.stills.length }})</option>
                    <option value="bgms">BGM ({{ catalog.bgms.length }})</option>
                    <option value="ses">SE ({{ catalog.ses.length }})</option>
                  </select>
                  <button
                    class="res-icon-btn"
                    type="button"
                    :disabled="resourceKind === 'spines' || resourceKind === 'stills'"
                    :title="tr('导入本地素材', 'Import local asset')"
                    @click="importLocalAsset()"
                  >
                    <Upload :size="13" />
                  </button>
                  <button
                    class="res-icon-btn"
                    type="button"
                    :title="tr('打开大型素材图库', 'Open Asset Gallery')"
                    @click="openAssetPicker(resourceKind)"
                  >
                    <LayoutGrid :size="13" />
                  </button>
                </div>
                <input v-model="resourceQuery" class="res-search" type="text" :placeholder="tr('搜索并拖入场景…', 'Search & drag to scene…')" />
              </div>
              <div ref="binListRef" class="bin-list" @scroll.passive="onBinScroll">
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
                      v-if="resourceKind === 'backgrounds' || resourceKind === 'stills'"
                      :src="cachedThumbUrl(resourceKind === 'stills' ? 'still' : 'background', id)"
                      loading="lazy"
                      class="res-thumb"
                      @error="onThumbImgError($event, resourceKind === 'stills' ? 'still' : 'background', id)"
                    />
                    <div v-else-if="resourceKind === 'spines'" class="res-spine-thumb">
                      <img v-if="spineThumbs[id]" :src="spineThumbs[id]" loading="lazy" :alt="id" />
                      <User v-else :size="15" class="spine-ph" />
                    </div>
                    <span class="res-id-wrap">
                      <span class="res-id">{{ resourceKind === 'spines' ? (BUILTIN_CAST[Number(id)] || assetDisplayName(id)) : assetDisplayName(id) }}</span>
                      <small v-if="resourceKind === 'spines'" class="res-sub-id">#{{ id }}</small>
                    </span>
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
                    title="预览 Spine 动画"
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
            <div v-if="previewSceneId" class="branch-bar">
              <span class="branch-title">单独预览 {{ graphDoc.nodes.find(node => node.id === previewSceneId)?.title }}</span>
              <button class="branch-chip" type="button" @click="seekStage(0)">返回当前路线</button>
            </div>
            <div class="stage-player-wrap">
              <PlayerPreview
                :asset-base="assetBase"
                :audio-mix="editorMix"
                :muted="previewMuted"
                ref="playerRef"
                :episode="previewCompiled.episode"
                :route-key="previewRouteKey"
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
              :graph-doc="graphDoc"
              :episode="compiled.episode"
              :visual-frames="visualSceneFrames"
              :selected-node-id="selectedNodeId"
              :selected-local-frame-idx="selectedLocalFrameIdx"
              @update:model-value="commitScript($event)"
              @update:selected-local-frame-idx="onInspectorSelectFrame"
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

        <!-- BOTTOM DECK: Story Flow / DSL Editor + Project Resource Files Tab -->
        <section class="bottom-deck">
          <div class="deck-tab-bar">
            <button
              type="button"
              class="deck-tab"
              :class="{ active: bottomTab === 'story' }"
              @click="bottomTab = 'story'"
            >
              <GitBranch v-if="workspaceMode === 'visual'" :size="12" />
              <Code2 v-else :size="12" />
              <span>{{ workspaceMode === 'visual' ? tr('剧情分镜图', 'Storyboard Graph') : tr('DSL 源码', 'DSL Source') }}</span>
            </button>
            <button
              type="button"
              class="deck-tab"
              :class="{ active: bottomTab === 'files' }"
              @click="bottomTab = 'files'"
            >
              <FolderRoot :size="12" />
              <span>{{ tr('项目文件', 'Project Files') }}</span>
              <span class="deck-tab-badge">{{ projectAssets.length }}</span>
            </button>
          </div>

          <div class="deck-tab-body">
            <template v-if="bottomTab === 'story'">
              <StoryGraph
                v-if="workspaceMode === 'visual'"
                :graph-doc="graphDoc"
                :visual-frames="visualSceneFrames"
                :active-frame-index="previewSceneId ? -1 : activeFrameIndex"
                :selected-node-id="selectedNodeId"
                :selected-local-frame-idx="selectedLocalFrameIdx"
                :node-changes="nodeChanges"
                @update:model-value="commitScript($event)"
                @update:selected-node-id="onSelectSceneNode"
                @update:selected-local-frame-idx="onInspectorSelectFrame"
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
            </template>
            <ProjectFilesPanel
              v-else
              :assets="projectAssets"
              :asset-base="assetBase"
              :used-asset-ids="usedProjectAssetIds"
              :is-electron="isElectronDesktop"
              @import="importLocalAsset($event)"
              @remove="removeLocalAsset($event)"
              @reveal="revealLocalAsset($event)"
              @copy-id="copyAssetId($event)"
            />
          </div>
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
          <span>{{ closeDestination === 'launcher' ? tr('关闭项目前确认', 'Confirm Close Project') : tr('退出前确认', 'Confirm Exit') }}</span>
          <button class="tb-btn" type="button" @click="showExitConfirmModal = false">{{ tr('取消', 'Cancel') }}</button>
        </div>
        <div class="preflight-body">
          <div class="pf-contents">
            {{ closeDestination === 'launcher'
              ? tr('当前剧本存在未保存的修改，是否在返回项目向导前保存？', 'You have unsaved changes. Save before returning to the Project Launcher?')
              : tr('当前剧本存在未保存的修改，是否在退出前保存？', 'You have unsaved changes. Save before exiting?') }}
          </div>
        </div>
        <div class="modal-footer">
          <button class="tb-btn" type="button" @click="forceCloseWindow">
            {{ closeDestination === 'launcher' ? tr('不保存返回', 'Discard & Return') : tr('不保存退出', 'Discard & Exit') }}
          </button>
          <button class="tb-btn primary" type="button" @click="saveAndCloseWindow">
            <Save :size="13" /> {{ closeDestination === 'launcher' ? tr('保存并返回', 'Save & Return') : tr('保存并退出', 'Save & Exit') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Settings Modal -->
    <SettingsModal
      :open="showSettingsModal"
      :workspace-mode="workspaceMode"
      :show-left-pane="showLeftPane"
      :show-inspector="showInspector"
      :show-ai-panel="showAiPanel"
      :top-split-pct="topSplitPct"
      :confirm-before-exit="confirmBeforeExit"
      :project-path="currentFilePath"
      :asset-count="projectAssets.length"
      v-model:audio-mix="editorMix"
      v-model:preview-muted="previewMuted"
      @close="showSettingsModal = false"
      @update:workspace-mode="workspaceMode = $event"
      @update:show-left-pane="showLeftPane = $event"
      @update:show-inspector="showInspector = $event"
      @update:show-ai-panel="showAiPanel = $event"
      @update:top-split-pct="topSplitPct = $event; persistLayout()"
      @update:confirm-before-exit="confirmBeforeExit = $event"
      @reset-layout="resetLayout"
      @rebuild-thumb-cache="rebuildThumbCache($event)"
      @open-ai-config="openAiConfig($event)"
      @open-ffmpeg="showSettingsModal = false; openVideoDialog('setup')"
    />

    <!-- About Modal -->
    <div v-if="showAboutModal" class="modal-backdrop" @click.self="showAboutModal = false">
      <div class="preflight-modal about-modal">
        <div class="modal-header">
          <span>{{ tr('关于 SiriusStoryMaker beta', 'About SiriusStoryMaker beta') }}</span>
          <button class="tb-btn" type="button" @click="showAboutModal = false">{{ tr('关闭', 'Close') }}</button>
        </div>
        <div class="preflight-body">
          <div class="about-hero">
            <img class="brand-logo" src="/sirius-logo.png" alt="" width="22" height="22" draggable="false" />
            <strong>SiriusStoryMaker</strong>
            <span class="beta-badge">beta v0.1.0</span>
          </div>
          <div class="pf-contents">
            {{ tr(
              '面向 World Dai Star（WDS Adv Player）的 NLE 可视化剧情制作工作台，支持图形分镜编排、实时 Spine 舞台预览、独立播放、MP4 导出与本地 AI Harness。',
              'NLE visual ADV story authoring studio for World Dai Star (WDS Adv Player), featuring storyboard graphs, live Spine 4.1 preview, standalone playback, MP4 export, and local AI Harnesses.',
            ) }}
          </div>
          <div class="pf-stats">
            <div class="pf-stat"><span>{{ tr('架构', 'Stack') }}</span><strong>Electron + Vue 3 + PixiJS / Spine 4.1</strong></div>
            <div class="pf-stat"><span>{{ tr('开源协议', 'License') }}</span><strong>MPL-2.0</strong></div>
          </div>

          <div class="about-links">
            <div class="about-links-title">{{ tr('项目与致谢', 'Repository & Acknowledgements') }}</div>
            <button
              type="button"
              class="about-link-card"
              @click="openExternalUrl('https://github.com/TeamOpenSirius/SiriusStoryMaker')"
            >
              <span class="al-copy">
                <strong>TeamOpenSirius / SiriusStoryMaker</strong>
                <small>{{ tr('本项目源码仓库与问题反馈', 'Source repository & issue tracker') }}</small>
              </span>
              <ExternalLink :size="13" class="al-ico" />
            </button>
            <button
              type="button"
              class="about-link-card"
              @click="openExternalUrl('https://github.com/Cpk0521/WDS_Adv_Player')"
            >
              <span class="al-copy">
                <strong>Cpk0521 / WDS_Adv_Player</strong>
                <small>{{ tr('致谢：World Dai Star 剧情渲染引擎与内嵌播放器核心', 'Thanks: World Dai Star ADV rendering engine & player core') }}</small>
              </span>
              <ExternalLink :size="13" class="al-ico" />
            </button>
            <button
              type="button"
              class="about-link-card"
              @click="openExternalUrl('https://github.com/StarMoe-org/moesekai-story-studio')"
            >
              <span class="al-copy">
                <strong>StarMoe-org / moesekai-story-studio</strong>
                <small>{{ tr('致谢：NLE 工作台与可视化剧情编排设计启发', 'Thanks: NLE workbench & storyboard design inspiration') }}</small>
              </span>
              <ExternalLink :size="13" class="al-ico" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preflight ZIP Export Modal -->
    <div v-if="showExportModal" class="modal-backdrop" @click.self="showExportModal = false">
      <div class="preflight-modal">
        <div class="modal-header">
          <span>{{ tr('导出作品包 (.zip)', 'Export Story Package (.zip)') }}</span>
          <button class="tb-btn" type="button" @click="showExportModal = false">{{ tr('关闭', 'Close') }}</button>
        </div>
        <div class="preflight-body">
          <div class="pf-stats">
            <div class="pf-stat"><span>{{ tr('剧集', 'Episode') }}</span><strong>{{ compiled.episode.Title }}</strong></div>
            <div class="pf-stat"><span>{{ tr('规模', 'Scale') }}</span><strong>{{ graphDoc.nodes.length }} {{ tr('场景', 'scenes') }} · {{ compiled.episode.EpisodeDetail.length }} {{ tr('帧', 'frames') }}</strong></div>
          </div>
          <div class="pf-contents">
            {{ tr('包含原版 ADV 格式的', 'Includes WDS ADV format') }} <code>episode.json</code>、<code>manifest.json</code>、<code>story.dsl</code> {{ tr(`和 ${projectAssets.length} 个本地素材。`, `and ${projectAssets.length} local asset(s).`) }}
            <div v-if="choiceNodes.length">{{ tr('ADV JSON 导出当前路线，完整分支保留在 DSL 中。', 'ADV JSON exports the selected route; full branching is preserved in DSL.') }}</div>
          </div>
          <div v-if="!canExport" class="pf-diag-box">
            <div v-if="!compiled.episode.EpisodeDetail.length">{{ tr('当前路线没有可导出的帧。', 'No frames to export on the current route.') }}</div>
            <div v-for="asset in missingExportAssets" :key="asset">{{ tr(`未索引的项目素材 ${asset}`, `Unindexed project asset: ${asset}`) }}</div>
          </div>
          <div v-if="compiled.diagnostics.length > 0" class="pf-diag-box">
            <div class="pf-diag-head">
              <AlertTriangle :size="13" /> {{ tr(`${compiled.diagnostics.length} 条诊断警告`, `${compiled.diagnostics.length} diagnostic warning(s)`) }}
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
      :thumb-base="thumbBase"
      :spine-thumbs="spineThumbs"
      :open="assetPickerOpen"
      :initial-kind="assetPickerKind"
      :catalog="catalog"
      @close="assetPickerOpen = false"
      @select="onPickerSelect"
      @preview-spine="previewSpineId = $event"
      @import-local="importLocalAsset($event)"
    />

    <VideoExportDialog
      v-if="videoDialog"
      :episode="compiled.episode"
      :asset-base="assetBase"
      :setup-only="videoDialog === 'setup'"
      :audio-mix="editorMix"
      @open-settings="videoDialog = null; showSettingsModal = true"
      @close="videoDialog = null"
    />

    <!-- Offscreen Spine Thumbnail Renderer (auto-unmounts once all thumbnails are cached) -->
    <iframe
      v-if="spineThumbWorkerActive"
      :key="spineThumbWorkerKey"
      ref="spineThumbFrameRef"
      src="./wds-adv-player/index.html?mode=spine-thumb"
      class="thumb-worker-iframe"
      aria-hidden="true"
      tabindex="-1"
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
  position: relative;
  z-index: 20;
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
.toolbar-dismiss {
  position: fixed;
  inset: 0;
  z-index: 19;
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
.brand-logo {
  display: block;
  border-radius: 5px;
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

.menu-bar {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: 6px;
}
.menu-wrap {
  position: relative;
  flex-shrink: 0;
}
.menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #d4d4d8;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.menu-trigger:hover,
.menu-trigger.open {
  background: #23232c;
  color: #ffffff;
}
.toolbar-popup {
  position: absolute;
  right: 0;
  top: calc(100% + 5px);
  min-width: 210px;
  padding: 4px;
  border-radius: 8px;
  background: #18181d;
  border: 1px solid #2e2e38;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.58);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 40;
}
.toolbar-popup.left {
  left: 0;
  right: auto;
}
.toolbar-popup button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  white-space: nowrap;
  font-size: 12px;
  font-family: inherit;
  padding: 6px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #e4e4e7;
  cursor: pointer;
}
.toolbar-popup button:hover:not(:disabled),
.toolbar-popup button:focus-visible {
  background: #272730;
  color: #ffffff;
  outline: none;
}
.toolbar-popup button:disabled {
  opacity: 0.38;
  cursor: default;
}
.m-label {
  flex: 1;
}
.m-kbd {
  font-size: 10px;
  color: #71717a;
  margin-left: 12px;
}
.m-chk {
  color: #f472b6;
  margin-left: 8px;
}
.popup-sep {
  height: 1px;
  background: #26262e;
  margin: 3px 6px;
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
.deck-tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  background: #141418;
  border-bottom: 1px solid #232329;
  flex-shrink: 0;
}
.deck-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: #a1a1aa;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.deck-tab:hover {
  background: #1f1f27;
  color: #f4f4f5;
}
.deck-tab.active {
  background: #24242d;
  border-color: #343442;
  color: #ffffff;
  font-weight: 600;
}
.deck-tab-badge {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(236, 72, 153, 0.16);
  color: #f472b6;
  font-weight: 600;
}
.deck-tab-body {
  flex: 1;
  min-height: 0;
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
.res-top-row {
  display: flex;
  align-items: center;
  gap: 4px;
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
.res-top-row .res-select {
  flex: 1;
  min-width: 0;
  height: 26px;
}
.res-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #d4d4d8;
  cursor: pointer;
}
.res-icon-btn:hover:not(:disabled) {
  background: #26262f;
  color: #ffffff;
  border-color: #3f3f4a;
}
.res-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
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
  padding: 4px 6px;
  gap: 8px;
}
.res-thumb {
  width: 76px;
  height: 43px;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid #272730;
  background: #141418;
  flex-shrink: 0;
}
.res-spine-thumb {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  border: 1px solid #272730;
  background: radial-gradient(circle at 50% 35%, #23232e, #121216);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.res-spine-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.spine-ph {
  color: #52525b;
}
.res-id-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.res-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.res-sub-id {
  font-size: 10px;
  color: #71717a;
}
.thumb-worker-iframe {
  position: fixed;
  width: 200px;
  height: 200px;
  left: -9999px;
  top: -9999px;
  opacity: 0;
  pointer-events: none;
  border: 0;
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
.thumb-progress {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 11px;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}
.thumb-progress button { width: 22px; height: 23px; }
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
.about-hero {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.about-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid #26262e;
}
.about-links-title {
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
}
.about-link-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid #26262e;
  background: #111115;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.about-link-card:hover {
  border-color: #ec4899;
  background: #1a1720;
}
.al-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.al-copy strong {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
}
.al-copy small {
  font-size: 11px;
  color: #a1a1aa;
}
.al-ico {
  color: #71717a;
  flex-shrink: 0;
}
.about-link-card:hover .al-ico {
  color: #f472b6;
}
.spine-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #09090b;
}
</style>
