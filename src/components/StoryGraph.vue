<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Film,
  Flag,
  GitBranch,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Music,
  Play,
  Plus,
  Sparkles,
  Trash2,
  User,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next'
import type { IEpisodeDetail } from '../../player/src/types/Episode'
import {
  getSceneBgm,
  setSceneBgm,
  serializeStoryGraph,
  type StoryGraphDoc,
  type StorySceneNode,
} from '../dsl/graph'
import {
  ASSET_DRAG_MIME,
  framesToSceneDsl,
  parseAliasMap,
  type AssetDragPayload,
  type VisualFrameItem,
} from '../dsl/sceneFrames'
import { ADV_RESOURCE_CDN } from '../services/resourceCatalog'

const NODE_W = 292
const MAX_VISIBLE_BEATS = 5

const props = defineProps<{
  graphDoc: StoryGraphDoc
  visualFrames: Map<string, VisualFrameItem[]>
  activeFrameIndex?: number
  selectedNodeId: string | null
  selectedLocalFrameIdx: number
  nodeChanges?: Map<string, 'added' | 'modified'>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedNodeId': [id: string | null]
  'update:selectedLocalFrameIdx': [idx: number]
  playScene: [sceneId: string]
  selectFrame: [frameIndex: number]
  clearChanges: []
}>()

const canvasRef = ref<HTMLElement | null>(null)
const panX = ref(48)
const panY = ref(48)
const zoom = ref(0.95)
const hoveredNodeId = ref<string | null>(null)
const dropTargetNodeId = ref<string | null>(null)
const expandedNodes = ref<Set<string>>(new Set())

const doc = computed(() => props.graphDoc)
const aliasMap = computed(() => parseAliasMap(doc.value.preamble))
const sceneFramesMap = computed(() => props.visualFrames)

function charLabel(spineId: number): string {
  return aliasMap.value.get(spineId) || `#${spineId}`
}

function getNodeKind(node: StorySceneNode, idx: number): 'start' | 'choice' | 'end' | 'scene' {
  if (idx === 0) return 'start'
  if (node.choices.length > 0) return 'choice'
  if (!node.next) return 'end'
  return 'scene'
}

// Memoize MoeSekai-style Scene Stage Sockets once per reactive change
const sceneSocketsMap = computed(() => {
  const map = new Map<
    string,
    { bg?: string; bgm?: string; effect?: number; cast: Array<{ id: number; name: string }> }
  >()
  for (const node of doc.value.nodes) {
    const items = sceneFramesMap.value.get(node.id) ?? []
    let bg: string | undefined
    const bgm = getSceneBgm(node)
    let effect: number | undefined
    const castIds = new Set<number>()
    for (const item of items) {
      if (!bg && item.frame.BackgroundImageFileName) bg = item.frame.BackgroundImageFileName
      if (effect === undefined && item.frame.WindowEffect) effect = item.frame.WindowEffect
      for (const c of item.frame.CharacterMotions) {
        if (c.SpineId > 0) castIds.add(c.SpineId)
      }
    }
    map.set(node.id, {
      bg,
      bgm,
      effect,
      cast: Array.from(castIds).map((id) => ({ id, name: charLabel(id) })),
    })
  }
  return map
})

function getSceneSockets(nodeId: string) {
  return sceneSocketsMap.value.get(nodeId) ?? { cast: [] }
}

function toggleExpandNode(nodeId: string) {
  const next = new Set(expandedNodes.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  expandedNodes.value = next
}

function visibleFrames(nodeId: string): VisualFrameItem[] {
  const all = sceneFramesMap.value.get(nodeId) ?? []
  if (expandedNodes.value.has(nodeId) || all.length <= MAX_VISIBLE_BEATS) return all
  return all.slice(0, MAX_VISIBLE_BEATS)
}

function estimateNodeHeight(node: StorySceneNode): number {
  const count = Math.min(MAX_VISIBLE_BEATS, Math.max(1, sceneFramesMap.value.get(node.id)?.length ?? 1))
  const choicesH = node.choices.length * 34
  return 118 + count * 34 + choicesH
}

// Drag state
type DragMode =
  | { kind: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
  | { kind: 'node'; nodeId: string; startX: number; startY: number; origX: number; origY: number; curX: number; curY: number }
  | { kind: 'wire'; fromId: string; choiceIndex?: number; fromX: number; fromY: number; curX: number; curY: number }

const drag = ref<DragMode | null>(null)

function nodePos(node: StorySceneNode): { x: number; y: number } {
  if (drag.value?.kind === 'node' && drag.value.nodeId === node.id) {
    return { x: drag.value.curX, y: drag.value.curY }
  }
  return { x: node.x, y: node.y }
}

interface WireEdge {
  key: string
  fromId: string
  toId: string
  label?: string
  choiceIndex?: number
  path: string
  midX: number
  midY: number
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(68, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

const wires = computed<WireEdge[]>(() => {
  const byId = new Map(doc.value.nodes.map((n) => [n.id, n]))
  const list: WireEdge[] = []

  for (const node of doc.value.nodes) {
    const pos = nodePos(node)
    const outX = pos.x + NODE_W
    const outY = pos.y + 20

    if (node.next) {
      const target = byId.get(node.next)
      if (target) {
        const tPos = nodePos(target)
        const inX = tPos.x
        const inY = tPos.y + 20
        list.push({
          key: `${node.id}->${target.id}`,
          fromId: node.id,
          toId: target.id,
          path: bezierPath(outX, outY, inX, inY),
          midX: (outX + inX) / 2,
          midY: (outY + inY) / 2,
        })
      }
    }

    const baseChoiceY = pos.y + estimateNodeHeight(node) - node.choices.length * 34 + 17
    node.choices.forEach((choice, idx) => {
      const target = byId.get(choice.target)
      if (!target) return
      const tPos = nodePos(target)
      const cy = baseChoiceY + idx * 34
      const inX = tPos.x
      const inY = tPos.y + 20
      list.push({
        key: `${node.id}:c${idx}->${target.id}`,
        fromId: node.id,
        toId: target.id,
        label: choice.label,
        choiceIndex: idx,
        path: bezierPath(outX, cy, inX, inY),
        midX: (outX + inX) / 2,
        midY: (cy + inY) / 2,
      })
    })
  }
  return list
})

function cloneDoc(): StoryGraphDoc {
  return {
    hasExplicitScenes: doc.value.hasExplicitScenes,
    preamble: doc.value.preamble,
    nodes: doc.value.nodes.map((n) => ({
      ...n,
      choices: n.choices.map((c) => ({ ...c })),
    })),
  }
}

function commitDoc(nextDoc: StoryGraphDoc) {
  nextDoc.hasExplicitScenes = true
  emit('update:modelValue', serializeStoryGraph(nextDoc))
}

function selectBeat(nodeId: string, item: VisualFrameItem) {
  emit('update:selectedNodeId', nodeId)
  emit('update:selectedLocalFrameIdx', item.localIdx)
  if (typeof item.globalIdx === 'number') emit('selectFrame', item.globalIdx)
}

function moveBeat(nodeId: string, localIdx: number, delta: -1 | 1) {
  const frames = (sceneFramesMap.value.get(nodeId) ?? []).map(
    (x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail,
  )
  const targetIdx = localIdx + delta
  if (targetIdx < 0 || targetIdx >= frames.length) return
  const [moved] = frames.splice(localIdx, 1)
  frames.splice(targetIdx, 0, moved)
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === nodeId)
  if (!node) return
  node.body = framesToSceneDsl(frames, aliasMap.value)
  emit('update:selectedNodeId', nodeId)
  emit('update:selectedLocalFrameIdx', targetIdx)
  commitDoc(nextDoc)
}

function duplicateBeat(nodeId: string, localIdx: number) {
  const frames = (sceneFramesMap.value.get(nodeId) ?? []).map(
    (x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail,
  )
  if (!frames[localIdx]) return
  frames.splice(localIdx + 1, 0, JSON.parse(JSON.stringify(frames[localIdx])))
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === nodeId)
  if (!node) return
  node.body = framesToSceneDsl(frames, aliasMap.value)
  emit('update:selectedNodeId', nodeId)
  emit('update:selectedLocalFrameIdx', localIdx + 1)
  commitDoc(nextDoc)
}

function deleteBeat(nodeId: string, localIdx: number) {
  const frames = (sceneFramesMap.value.get(nodeId) ?? []).map(
    (x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail,
  )
  if (frames.length <= 1) return
  frames.splice(localIdx, 1)
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === nodeId)
  if (!node) return
  node.body = framesToSceneDsl(frames, aliasMap.value)
  emit('update:selectedNodeId', nodeId)
  emit('update:selectedLocalFrameIdx', Math.max(0, localIdx - 1))
  commitDoc(nextDoc)
}

function parseAssetDrop(e: DragEvent): AssetDragPayload | null {
  const raw = e.dataTransfer?.getData(ASSET_DRAG_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AssetDragPayload
  } catch {
    return null
  }
}

function onNodeDragOver(e: DragEvent, nodeId: string) {
  if (!e.dataTransfer?.types.includes(ASSET_DRAG_MIME)) return
  e.preventDefault()
  e.stopPropagation()
  dropTargetNodeId.value = nodeId
}

function onNodeDrop(e: DragEvent, nodeId: string) {
  const payload = parseAssetDrop(e)
  dropTargetNodeId.value = null
  if (!payload) return
  e.preventDefault()
  e.stopPropagation()

  if (payload.kind === 'bgm') {
    const nextDoc = cloneDoc()
    const node = nextDoc.nodes.find((item) => item.id === nodeId)
    if (!node) return
    setSceneBgm(node, payload.id)
    commitDoc(nextDoc)
    if (props.selectedNodeId !== nodeId) emit('update:selectedNodeId', nodeId)
    return
  }

  const frames = (sceneFramesMap.value.get(nodeId) ?? []).map(
    (x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail,
  )
  if (frames.length === 0) return
  const targetIdx =
    props.selectedNodeId === nodeId
      ? Math.max(0, Math.min(props.selectedLocalFrameIdx, frames.length - 1))
      : 0
  const f = frames[targetIdx]

  if (payload.kind === 'background') {
    f.BackgroundImageFileName = payload.id
    f.BackgroundImageFileFadeType = 4 as any
  } else if (payload.kind === 'still') {
    f.StillPhotoFileName = payload.id
  } else if (payload.kind === 'se') {
    f.SeFileName = payload.id
  } else if (payload.kind === 'spine') {
    const spineId = Number(payload.id)
    if (Number.isFinite(spineId)) {
      const used = new Set(f.CharacterMotions.map((c) => c.slotNumber))
      let slot = 1
      while (used.has(slot)) slot++
      f.CharacterMotions.push({
        slotNumber: slot,
        SpineId: spineId,
        CharacterPosition: (slot === 1 ? 3 : slot === 2 ? 4 : 2) as any,
        CharacterAppearanceType: 0 as any,
        CharacterLayerType: 0 as any,
        SpineSize: 1 as any,
        FacialExpressionMasterId: 1,
        BodyMotionMasterId: 1,
      })
    }
  }

  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === nodeId)
  if (!node) return
  node.body = framesToSceneDsl(frames, aliasMap.value)
  emit('update:selectedNodeId', nodeId)
  emit('update:selectedLocalFrameIdx', targetIdx)
  commitDoc(nextDoc)
}

function onCanvasDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes(ASSET_DRAG_MIME)) return
  e.preventDefault()
}

function onCanvasDrop(e: DragEvent) {
  const payload = parseAssetDrop(e)
  dropTargetNodeId.value = null
  if (!payload) return
  e.preventDefault()

  const pos = toWorld(e.clientX, e.clientY)
  const nextDoc = cloneDoc()
  let n = nextDoc.nodes.length + 1
  while (nextDoc.nodes.some((x) => x.id === `scene_${n}`)) n++
  const prefix =
    payload.kind === 'background'
      ? `@bg ${payload.id} fade=cross`
      : payload.kind === 'spine'
        ? `@char 1 ${payload.id} pos=center expr=normal body=normal`
        : payload.kind === 'bgm'
          ? ''
          : payload.kind === 'se'
            ? `@se ${payload.id}`
            : `@still ${payload.id}`
  const newNode: StorySceneNode = {
    id: `scene_${n}`,
    title: `新场景 ${n}`,
    x: Math.round(pos.x - NODE_W / 2),
    y: Math.round(pos.y - 30),
    body: prefix ? `${prefix}\n心菜: 新场景开始……` : '心菜: 新场景开始……',
    bgm: payload.kind === 'bgm' ? payload.id : undefined,
    choices: [],
  }
  nextDoc.nodes.push(newNode)
  emit('update:selectedNodeId', newNode.id)
  emit('update:selectedLocalFrameIdx', 0)
  commitDoc(nextDoc)
}

function toWorld(clientX: number, clientY: number) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: (clientX - rect.left - panX.value) / zoom.value,
    y: (clientY - rect.top - panY.value) / zoom.value,
  }
}

function startPan(e: MouseEvent) {
  if (e.button !== 0) return
  drag.value = {
    kind: 'pan',
    startX: e.clientX,
    startY: e.clientY,
    origPanX: panX.value,
    origPanY: panY.value,
  }
}

function startNodeDrag(e: MouseEvent, node: StorySceneNode) {
  if (e.button !== 0) return
  e.stopPropagation()
  emit('update:selectedNodeId', node.id)
  drag.value = {
    kind: 'node',
    nodeId: node.id,
    startX: e.clientX,
    startY: e.clientY,
    origX: node.x,
    origY: node.y,
    curX: node.x,
    curY: node.y,
  }
}

function startWireDrag(e: MouseEvent, node: StorySceneNode, choiceIndex?: number) {
  e.stopPropagation()
  e.preventDefault()
  emit('update:selectedNodeId', node.id)
  const pos = nodePos(node)
  const fromX = pos.x + NODE_W
  const fromY =
    typeof choiceIndex === 'number'
      ? pos.y + estimateNodeHeight(node) - node.choices.length * 34 + 17 + choiceIndex * 34
      : pos.y + 20
  drag.value = {
    kind: 'wire',
    fromId: node.id,
    choiceIndex,
    fromX,
    fromY,
    curX: fromX,
    curY: fromY,
  }
}

function finishWireOnNode(e: MouseEvent, targetId: string) {
  if (drag.value?.kind !== 'wire') return
  e.stopPropagation()
  const { fromId, choiceIndex } = drag.value
  drag.value = null
  hoveredNodeId.value = null
  if (fromId === targetId) return
  const nextDoc = cloneDoc()
  const src = nextDoc.nodes.find((n) => n.id === fromId)
  if (!src) return
  if (typeof choiceIndex === 'number' && src.choices[choiceIndex]) {
    src.choices[choiceIndex].target = targetId
  } else {
    src.next = targetId
  }
  commitDoc(nextDoc)
}

function onMouseMove(e: MouseEvent) {
  const d = drag.value
  if (!d) return
  if (d.kind === 'pan') {
    panX.value = Math.round(d.origPanX + (e.clientX - d.startX))
    panY.value = Math.round(d.origPanY + (e.clientY - d.startY))
  } else if (d.kind === 'node') {
    const dx = (e.clientX - d.startX) / zoom.value
    const dy = (e.clientY - d.startY) / zoom.value
    d.curX = Math.round((d.origX + dx) / 16) * 16
    d.curY = Math.round((d.origY + dy) / 16) * 16
  } else if (d.kind === 'wire') {
    const w = toWorld(e.clientX, e.clientY)
    d.curX = w.x
    d.curY = w.y
  }
}

function onMouseUp() {
  const d = drag.value
  drag.value = null
  hoveredNodeId.value = null
  if (d?.kind === 'node' && (d.curX !== d.origX || d.curY !== d.origY)) {
    const nextDoc = cloneDoc()
    const target = nextDoc.nodes.find((n) => n.id === d.nodeId)
    if (target) {
      target.x = d.curX
      target.y = d.curY
      commitDoc(nextDoc)
    }
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const oldZoom = zoom.value
  const factor = e.deltaY > 0 ? 0.92 : 1.08
  const nextZoom = Math.max(0.4, Math.min(1.6, Number((oldZoom * factor).toFixed(3))))
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  panX.value = Math.round(mx - ((mx - panX.value) / oldZoom) * nextZoom)
  panY.value = Math.round(my - ((my - panY.value) / oldZoom) * nextZoom)
  zoom.value = nextZoom
}

function zoomBy(delta: number) {
  const rect = canvasRef.value?.getBoundingClientRect()
  const oldZoom = zoom.value
  const nextZoom = Math.max(0.4, Math.min(1.6, Number((oldZoom + delta).toFixed(2))))
  if (rect) {
    const cx = rect.width / 2
    const cy = rect.height / 2
    panX.value = Math.round(cx - ((cx - panX.value) / oldZoom) * nextZoom)
    panY.value = Math.round(cy - ((cy - panY.value) / oldZoom) * nextZoom)
  }
  zoom.value = nextZoom
}

function removeWire(edge: WireEdge) {
  const nextDoc = cloneDoc()
  const src = nextDoc.nodes.find((n) => n.id === edge.fromId)
  if (!src) return
  if (typeof edge.choiceIndex === 'number') src.choices.splice(edge.choiceIndex, 1)
  else src.next = undefined
  commitDoc(nextDoc)
}

function addSceneNode() {
  const nextDoc = cloneDoc()
  let n = nextDoc.nodes.length + 1
  while (nextDoc.nodes.some((x) => x.id === `scene_${n}`)) n++
  const anchor =
    (props.selectedNodeId ? nextDoc.nodes.find((x) => x.id === props.selectedNodeId) : undefined) ??
    nextDoc.nodes[nextDoc.nodes.length - 1]
  const newNode: StorySceneNode = {
    id: `scene_${n}`,
    title: `新场景 ${n}`,
    x: anchor ? anchor.x + 352 : 64,
    y: anchor ? anchor.y : 48,
    body: '@bg 1000 fade=cross\n@char 1 心菜 pos=center expr=normal body=normal\n心菜: 这里是新场景的台词。',
    choices: [],
  }
  if (anchor && !anchor.next && anchor.choices.length === 0) anchor.next = newNode.id
  nextDoc.nodes.push(newNode)
  emit('update:selectedNodeId', newNode.id)
  emit('update:selectedLocalFrameIdx', 0)
  commitDoc(nextDoc)
  void nextTick(() => fitView())
}

function deleteSelectedNode() {
  if (!props.selectedNodeId || doc.value.nodes.length <= 1) return
  const delId = props.selectedNodeId
  const nextDoc = cloneDoc()
  nextDoc.nodes = nextDoc.nodes.filter((n) => n.id !== delId)
  for (const node of nextDoc.nodes) {
    if (node.next === delId) node.next = undefined
    node.choices = node.choices.filter((c) => c.target !== delId)
  }
  emit('update:selectedNodeId', nextDoc.nodes[0]?.id ?? null)
  emit('update:selectedLocalFrameIdx', 0)
  commitDoc(nextDoc)
}

function autoLayout() {
  const nextDoc = cloneDoc()
  if (nextDoc.nodes.length === 0) return

  const byId = new Map(nextDoc.nodes.map((n) => [n.id, n]))
  const depth = new Map<string, number>()
  const queue: string[] = [nextDoc.nodes[0].id]
  depth.set(nextDoc.nodes[0].id, 0)

  while (queue.length > 0) {
    const id = queue.shift()!
    const node = byId.get(id)
    if (!node) continue
    const d = depth.get(id) ?? 0
    const targets: string[] = []
    if (node.next) targets.push(node.next)
    for (const c of node.choices) targets.push(c.target)
    for (const t of targets) {
      if (byId.has(t) && !depth.has(t)) {
        depth.set(t, d + 1)
        queue.push(t)
      }
    }
  }

  let maxDepth = Math.max(0, ...Array.from(depth.values()))
  for (const n of nextDoc.nodes) {
    if (!depth.has(n.id)) {
      maxDepth += 1
      depth.set(n.id, maxDepth)
    }
  }

  const columns = new Map<number, StorySceneNode[]>()
  for (const n of nextDoc.nodes) {
    const col = depth.get(n.id) ?? 0
    const arr = columns.get(col) ?? []
    arr.push(n)
    columns.set(col, arr)
  }

  for (const [col, list] of columns.entries()) {
    let curY = 48
    for (const node of list) {
      node.x = 48 + col * 352
      node.y = curY
      curY += estimateNodeHeight(node) + 32
    }
  }

  commitDoc(nextDoc)
  void nextTick(() => fitView())
}

function fitView() {
  const nodes = doc.value.nodes
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect || rect.width < 40 || rect.height < 40 || nodes.length === 0) return
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W))
  const maxY = Math.max(...nodes.map((n) => n.y + estimateNodeHeight(n)))
  const contentW = Math.max(280, maxX - minX)
  const contentH = Math.max(160, maxY - minY)
  const pad = 44
  const nextZoom = Math.max(
    0.42,
    Math.min(1.05, Math.min((rect.width - pad * 2) / contentW, (rect.height - pad * 2) / contentH)),
  )
  zoom.value = Number(nextZoom.toFixed(2))
  panX.value = Math.round((rect.width - contentW * zoom.value) / 2 - minX * zoom.value)
  panY.value = Math.round((rect.height - contentH * zoom.value) / 2 - minY * zoom.value)
}

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  void nextTick(() => setTimeout(() => fitView(), 40))
})
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})

defineExpose({ fitView, autoLayout })
</script>

<template>
  <div
    ref="canvasRef"
    class="flow-canvas"
    :class="{ 'is-wiring': drag?.kind === 'wire' }"
    @mousedown="startPan"
    @wheel="onWheel"
    @dragover="onCanvasDragOver"
    @drop="onCanvasDrop"
  >
    <!-- Floating Top-Left Pill Toolbar (MoeSekai style) -->
    <div class="float-bar top-left" @mousedown.stop>
      <button class="f-btn primary" type="button" @click="addSceneNode">
        <Plus :size="12" /><span>新建场景</span>
      </button>
      <button class="f-btn" type="button" title="拓扑自动排布" @click="autoLayout">
        <LayoutGrid :size="12" /><span>自动排布</span>
      </button>
      <button class="f-btn icon" type="button" title="适应画布" @click="fitView">
        <Maximize2 :size="12" />
      </button>
      <span class="f-sep" />

      <button
        class="f-btn icon danger"
        type="button"
        title="删除选中场景"
        :disabled="doc.nodes.length <= 1"
        @click="deleteSelectedNode"
      >
        <Trash2 :size="12" />
      </button>
      <button
        v-if="(nodeChanges?.size ?? 0) > 0"
        class="f-btn ai-pill"
        type="button"
        @click="emit('clearChanges')"
      >
        AI 变更 ({{ nodeChanges?.size }}) ×
      </button>
    </div>

    <!-- Floating Bottom-Right Zoom Pill -->
    <div class="float-bar bottom-right" @mousedown.stop>
      <button class="f-btn icon" type="button" @click="zoomBy(-0.12)"><ZoomOut :size="12" /></button>
      <span class="zoom-txt">{{ Math.round(zoom * 100) }}%</span>
      <button class="f-btn icon" type="button" @click="zoomBy(0.12)"><ZoomIn :size="12" /></button>
    </div>

    <!-- World Transform Container -->
    <div
      class="flow-world"
      :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }"
    >
      <!-- SVG Wires -->
      <svg class="wire-layer" width="1" height="1">
        <defs>
          <marker id="arr-seq" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
          </marker>
          <marker id="arr-choice" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
          </marker>
        </defs>

        <g v-for="edge in wires" :key="edge.key" class="wire-group" @click.stop="removeWire(edge)">
          <path :d="edge.path" class="wire-hit" />
          <path
            :d="edge.path"
            class="wire-stroke"
            :class="{ choice: typeof edge.choiceIndex === 'number' }"
            :marker-end="typeof edge.choiceIndex === 'number' ? 'url(#arr-choice)' : 'url(#arr-seq)'"
          />
          <g :transform="`translate(${edge.midX}, ${edge.midY})`" class="wire-pill-g">
            <rect v-if="edge.label" x="-44" y="-10" width="88" height="20" rx="10" class="wire-label-bg" />
            <text v-if="edge.label" text-anchor="middle" dy="3.5" class="wire-label-txt">
              {{ edge.label.slice(0, 9) }}
            </text>
            <circle v-else r="8" class="wire-del-bg" />
            <text v-if="!edge.label" text-anchor="middle" dy="3.5" class="wire-del-txt">×</text>
          </g>
        </g>

        <path
          v-if="drag?.kind === 'wire'"
          :d="bezierPath(drag.fromX, drag.fromY, drag.curX, drag.curY)"
          class="wire-preview"
        />
      </svg>

      <!-- MoeSekai-Style Scene Puzzle Cards -->
      <div
        v-for="(node, nIdx) in doc.nodes"
        :key="node.id"
        class="puzzle-card"
        :class="[
          `kind-${getNodeKind(node, nIdx)}`,
          {
            selected: selectedNodeId === node.id,
            'drop-target':
              (drag?.kind === 'wire' && drag.fromId !== node.id && hoveredNodeId === node.id) ||
              dropTargetNodeId === node.id,
            'ai-added': nodeChanges?.get(node.id) === 'added',
            'ai-modified': nodeChanges?.get(node.id) === 'modified',
          },
        ]"
        :style="{ left: `${nodePos(node).x}px`, top: `${nodePos(node).y}px`, width: `${NODE_W}px` }"
        @mouseenter="hoveredNodeId = node.id"
        @mouseleave="hoveredNodeId = hoveredNodeId === node.id ? null : hoveredNodeId"
        @mouseup="finishWireOnNode($event, node.id)"
        @dragover="onNodeDragOver($event, node.id)"
        @dragleave="dropTargetNodeId = dropTargetNodeId === node.id ? null : dropTargetNodeId"
        @drop="onNodeDrop($event, node.id)"
      >
        <span v-if="nodeChanges?.get(node.id)" class="ai-badge" :class="nodeChanges.get(node.id)">
          {{ nodeChanges.get(node.id) === 'added' ? 'AI 新增' : 'AI 修改' }}
        </span>

        <!-- Header Bar (Draggable Handle + Ports) -->
        <div class="card-head" @mousedown="startNodeDrag($event, node)">
          <div class="port port-in" title="连线入口" @mouseup="finishWireOnNode($event, node.id)" />

          <GripVertical :size="13" class="drag-grip" />
          <span class="kind-icon" :class="getNodeKind(node, nIdx)">
            <Play v-if="getNodeKind(node, nIdx) === 'start'" :size="11" />
            <GitBranch v-else-if="getNodeKind(node, nIdx) === 'choice'" :size="11" />
            <Flag v-else-if="getNodeKind(node, nIdx) === 'end'" :size="11" />
            <Film v-else :size="11" />
          </span>
          <span class="card-title">{{ node.title }}</span>

          <button
            class="head-play"
            type="button"
            title="从该场景播放"
            @mousedown.stop
            @click.stop="emit('update:selectedNodeId', node.id); emit('playScene', node.id)"
          >
            <Play :size="11" />
          </button>
          <span class="beat-count">{{ sceneFramesMap.get(node.id)?.length ?? 0 }}</span>

          <div
            v-if="node.choices.length === 0"
            class="port port-out"
            title="拖拽连接到下一个场景"
            @mousedown="startWireDrag($event, node)"
          />
        </div>

        <!-- Upper Section: Stage Sockets (BG / BGM / Effect / Cast) -->
        <div class="stage-sockets" @mousedown.stop>
          <div class="socket-row">
            <span class="socket-chip" :class="{ filled: Boolean(getSceneSockets(node.id).bg) }">
              <img
                v-if="getSceneSockets(node.id).bg && !getSceneSockets(node.id).bg!.startsWith('asset_')"
                :src="`${ADV_RESOURCE_CDN}/background/${encodeURIComponent(getSceneSockets(node.id).bg!)}.png`"
                class="sock-thumb"
                loading="lazy"
              />
              <ImageIcon v-else :size="11" />
              <span>{{ getSceneSockets(node.id).bg || '继承背景' }}</span>
            </span>

            <span v-if="getSceneSockets(node.id).bgm" class="socket-chip audio">
              <Music :size="10" />
              <span>{{ getSceneSockets(node.id).bgm === 'inherit' ? '沿用音乐' : getSceneSockets(node.id).bgm === 'stop' ? '无音乐' : getSceneSockets(node.id).bgm }}</span>
            </span>

            <span v-if="getSceneSockets(node.id).effect" class="socket-chip fx">
              <Sparkles :size="10" />
              <span>{{ getSceneSockets(node.id).effect === 1 ? '怀旧' : '柔白' }}</span>
            </span>
          </div>

          <div v-if="getSceneSockets(node.id).cast.length > 0" class="socket-cast">
            <span v-for="c in getSceneSockets(node.id).cast" :key="c.id" class="cast-chip">
              <User :size="10" /> {{ c.name }}
            </span>
          </div>
        </div>

        <!-- Lower Section: Compact Beat Track -->
        <div class="beat-track" @mousedown.stop>
          <div
            v-for="item in visibleFrames(node.id)"
            :key="item.localIdx"
            class="beat-row"
            :class="{
              active: item.globalIdx !== null && item.globalIdx === activeFrameIndex,
              selected: selectedNodeId === node.id && selectedLocalFrameIdx === item.localIdx,
            }"
            @click="selectBeat(node.id, item)"
          >
            <MessageSquare :size="11" class="beat-ico" />
            <span class="beat-who">{{ item.frame.SpeakerName || '旁白' }}</span>
            <span class="beat-text">{{ item.frame.Phrase || '(指令帧)' }}</span>
            <div class="beat-acts" @click.stop>
              <button type="button" :disabled="item.localIdx === 0" @click="moveBeat(node.id, item.localIdx, -1)"><ArrowUp :size="10" /></button>
              <button type="button" :disabled="item.localIdx >= (sceneFramesMap.get(node.id)?.length ?? 1) - 1" @click="moveBeat(node.id, item.localIdx, 1)"><ArrowDown :size="10" /></button>
              <button type="button" @click="duplicateBeat(node.id, item.localIdx)"><Copy :size="10" /></button>
              <button type="button" class="del" :disabled="(sceneFramesMap.get(node.id)?.length ?? 1) <= 1" @click="deleteBeat(node.id, item.localIdx)">×</button>
            </div>
          </div>

          <button
            v-if="(sceneFramesMap.get(node.id)?.length ?? 0) > MAX_VISIBLE_BEATS"
            type="button"
            class="expand-beats-btn"
            @click="toggleExpandNode(node.id)"
          >
            <ChevronUp v-if="expandedNodes.has(node.id)" :size="11" />
            <ChevronDown v-else :size="11" />
            <span>
              {{ expandedNodes.has(node.id) ? '收起' : `展开其余 ${(sceneFramesMap.get(node.id)?.length ?? 0) - MAX_VISIBLE_BEATS} 帧` }}
            </span>
          </button>
        </div>

        <!-- Choice Option Rows (each with its own individual output port!) -->
        <div v-if="node.choices.length > 0" class="choice-ports" @mousedown.stop>
          <div v-for="(c, cIdx) in node.choices" :key="cIdx" class="choice-port-row">
            <span class="choice-num">{{ cIdx + 1 }}</span>
            <span class="choice-txt">{{ c.label }}</span>
            <div
              class="port port-out choice"
              title="拖拽连接此分支"
              @mousedown="startWireDrag($event, node, cIdx)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background-color: #0b0b0e;
  background-image: radial-gradient(#23232b 1px, transparent 1px);
  background-size: 20px 20px;
  cursor: grab;
}
.flow-canvas:active {
  cursor: grabbing;
}
.flow-canvas.is-wiring {
  cursor: crosshair;
}

/* Floating Pill Toolbars */
.float-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(20, 20, 25, 0.88);
  border: 1px solid #2b2b34;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.float-bar.top-left {
  top: 10px;
  left: 10px;
}
.float-bar.bottom-right {
  right: 10px;
  bottom: 10px;
}
.f-sep {
  width: 1px;
  height: 14px;
  background: #2b2b34;
  margin: 0 2px;
}
.f-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: #d4d4d8;
  font-size: 11px;
  cursor: pointer;
}
.f-btn:hover:not(:disabled) {
  background: #272731;
  color: #fff;
}
.f-btn.icon {
  padding: 0 6px;
}
.f-btn.primary {
  background: #db2777;
  color: #fff;
}
.f-btn.primary:hover {
  background: #be185d;
}
.f-btn.danger:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.4);
  color: #fca5a5;
}
.f-btn.ai-pill {
  background: rgba(16, 185, 129, 0.16);
  color: #6ee7b7;
}
.f-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.zoom-txt {
  font-size: 11px;
  color: #a1a1aa;
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.flow-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.wire-layer {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
.wire-group {
  pointer-events: auto;
  cursor: pointer;
}
.wire-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
}
.wire-stroke {
  fill: none;
  stroke: #38bdf8;
  stroke-width: 2.2;
}
.wire-stroke.choice {
  stroke: #f59e0b;
  stroke-dasharray: 5 3;
}
.wire-group:hover .wire-stroke {
  stroke: #f472b6;
  stroke-width: 2.8;
}
.wire-preview {
  fill: none;
  stroke: #ec4899;
  stroke-width: 2.4;
  stroke-dasharray: 6 4;
}
.wire-del-bg {
  fill: #18181d;
  stroke: #38bdf8;
  stroke-width: 1.5;
}
.wire-del-txt {
  fill: #e4e4e7;
  font-size: 11px;
}
.wire-label-bg {
  fill: #18181d;
  stroke: #f59e0b;
  stroke-width: 1.5;
}
.wire-label-txt {
  fill: #fcd34d;
  font-size: 10px;
}

/* MoeSekai-Style Scene Puzzle Card */
.puzzle-card {
  position: absolute;
  border-radius: 14px;
  border: 1px solid #2b2b34;
  background: #15151a;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48);
  display: flex;
  flex-direction: column;
  user-select: none;
  transition: border-color 0.14s, box-shadow 0.14s;
}
.puzzle-card.selected {
  border-color: #ec4899;
  box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.35), 0 14px 32px rgba(0, 0, 0, 0.6);
}
.puzzle-card.ai-added {
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.65);
}
.puzzle-card.ai-modified {
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.65);
}
.puzzle-card.drop-target {
  border-color: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.5);
}
.ai-badge {
  position: absolute;
  top: -10px;
  left: 14px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  z-index: 4;
}
.ai-badge.added {
  background: #10b981;
  color: #052e16;
}
.ai-badge.modified {
  background: #38bdf8;
  color: #082f49;
}

.card-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 13px 13px 0 0;
  background: #1c1c23;
  border-bottom: 1px solid #26262f;
  cursor: grab;
}
.card-head:active {
  cursor: grabbing;
}
.puzzle-card.kind-start .card-head {
  background: rgba(16, 185, 129, 0.14);
}
.puzzle-card.kind-choice .card-head {
  background: rgba(245, 158, 11, 0.14);
}
.puzzle-card.kind-end .card-head {
  background: rgba(168, 85, 247, 0.14);
}
.drag-grip {
  color: #71717a;
  flex-shrink: 0;
}
.kind-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #38bdf8;
}
.kind-icon.start {
  color: #34d399;
}
.kind-icon.choice {
  color: #fbbf24;
}
.kind-icon.end {
  color: #c084fc;
}
.card-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: #f4f4f5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: #34d399;
  cursor: pointer;
}
.head-play:hover {
  background: rgba(52, 211, 153, 0.18);
}
.beat-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #0d0d11;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}

/* Stage Sockets */
.stage-sockets {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 10px;
  background: #121217;
  border-bottom: 1px solid #22222a;
}
.socket-row,
.socket-cast {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.socket-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  background: #1c1c23;
  color: #71717a;
}
.socket-chip.filled {
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}
.socket-chip.audio {
  background: rgba(16, 185, 129, 0.14);
  color: #6ee7b7;
}
.socket-chip.fx {
  background: rgba(168, 85, 247, 0.16);
  color: #d8b4fe;
}
.sock-thumb {
  width: 20px;
  height: 12px;
  object-fit: cover;
  border-radius: 2px;
}
.cast-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(244, 114, 182, 0.12);
  color: #f9a8d4;
}

/* Compact Beat Track */
.beat-track {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
}
.beat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 7px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
.beat-row:hover {
  background: #1d1d24;
}
.beat-row.selected {
  background: rgba(236, 72, 153, 0.1);
  border-color: rgba(236, 72, 153, 0.4);
}
.beat-row.active {
  border-color: rgba(16, 185, 129, 0.55);
  box-shadow: inset 2px 0 0 #10b981;
}
.beat-ico {
  color: #71717a;
  flex-shrink: 0;
}
.beat-who {
  color: #f472b6;
  font-weight: 600;
  flex-shrink: 0;
}
.beat-text {
  flex: 1;
  min-width: 0;
  color: #d4d4d8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.beat-acts {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.beat-row:hover .beat-acts {
  display: flex;
}
.beat-acts button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 0;
  background: #272731;
  color: #a1a1aa;
  font-size: 11px;
  cursor: pointer;
}
.beat-acts button:hover:not(:disabled) {
  background: #363643;
  color: #fff;
}
.beat-acts button.del:hover:not(:disabled) {
  background: #7f1d1d;
  color: #fecaca;
}
.beat-acts button:disabled {
  opacity: 0.3;
  cursor: default;
}
.expand-beats-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  margin-top: 2px;
  border: 0;
  border-radius: 6px;
  background: #1b1b22;
  color: #a1a1aa;
  font-size: 10px;
  cursor: pointer;
}
.expand-beats-btn:hover {
  background: #25252f;
  color: #f4f4f5;
}

/* Per-Choice Output Port Rows */
.choice-ports {
  border-top: 1px solid #25252e;
  display: flex;
  flex-direction: column;
}
.choice-port-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 18px 0 10px;
  border-bottom: 1px solid #1e1e26;
  font-size: 11px;
}
.choice-port-row:last-child {
  border-bottom: 0;
}
.choice-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.choice-txt {
  flex: 1;
  min-width: 0;
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Ports */
.port {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-top: -6px;
  border-radius: 999px;
  border: 2px solid #0b0b0e;
  z-index: 4;
}
.port-in {
  left: -6px;
  background: #a1a1aa;
}
.port-out {
  right: -6px;
  background: #38bdf8;
  cursor: crosshair;
}
.port-out.choice {
  background: #f59e0b;
}
.port-out:hover {
  transform: scale(1.25);
  background: #f472b6;
}
</style>
