<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  parseStoryGraph,
  serializeStoryGraph,
  type StoryGraphDoc,
  type StorySceneNode,
} from '../dsl/graph'

const NODE_W = 228
const NODE_H = 112

const props = defineProps<{
  modelValue: string
  sceneStartFrames: Map<string, number>
  activeFrameIndex?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  playScene: [sceneId: string]
}>()

const canvasRef = ref<HTMLElement | null>(null)
const panX = ref(24)
const panY = ref(24)
const zoom = ref(1)
const selectedNodeId = ref<string | null>(null)

const doc = computed<StoryGraphDoc>(() => parseStoryGraph(props.modelValue))
const selectedNode = computed<StorySceneNode | undefined>(() =>
  doc.value.nodes.find((n) => n.id === selectedNodeId.value) ?? doc.value.nodes[0],
)

interface WireEdge {
  key: string
  fromId: string
  toId: string
  label?: string
  choiceIndex?: number
  x1: number
  y1: number
  x2: number
  y2: number
  path: string
  midX: number
  midY: number
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

const wires = computed<WireEdge[]>(() => {
  const byId = new Map(doc.value.nodes.map((n) => [n.id, n]))
  const list: WireEdge[] = []

  for (const node of doc.value.nodes) {
    const outX = node.x + NODE_W
    const outY = node.y + NODE_H / 2

    if (node.next) {
      const target = byId.get(node.next)
      if (target) {
        const inX = target.x
        const inY = target.y + NODE_H / 2
        list.push({
          key: `${node.id}->${target.id}`,
          fromId: node.id,
          toId: target.id,
          x1: outX,
          y1: outY,
          x2: inX,
          y2: inY,
          path: bezierPath(outX, outY, inX, inY),
          midX: (outX + inX) / 2,
          midY: (outY + inY) / 2,
        })
      }
    }

    node.choices.forEach((choice, idx) => {
      const target = byId.get(choice.target)
      if (!target) return
      const cy = node.y + 44 + idx * 18
      const inX = target.x
      const inY = target.y + NODE_H / 2
      list.push({
        key: `${node.id}:c${idx}->${target.id}`,
        fromId: node.id,
        toId: target.id,
        label: choice.label,
        choiceIndex: idx,
        x1: outX,
        y1: cy,
        x2: inX,
        y2: inY,
        path: bezierPath(outX, cy, inX, inY),
        midX: (outX + inX) / 2,
        midY: (cy + inY) / 2,
      })
    })
  }
  return list
})

// Drag state
type DragMode =
  | { kind: 'pan'; startX: number; startY: number; origPanX: number; origPanY: number }
  | { kind: 'node'; nodeId: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'wire'; fromId: string; fromX: number; fromY: number; curX: number; curY: number }

const drag = ref<DragMode | null>(null)

function commitDoc(nextDoc: StoryGraphDoc) {
  nextDoc.hasExplicitScenes = true
  emit('update:modelValue', serializeStoryGraph(nextDoc))
}

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
  e.stopPropagation()
  selectedNodeId.value = node.id
  drag.value = {
    kind: 'node',
    nodeId: node.id,
    startX: e.clientX,
    startY: e.clientY,
    origX: node.x,
    origY: node.y,
  }
}

function startWireDrag(e: MouseEvent, node: StorySceneNode) {
  e.stopPropagation()
  selectedNodeId.value = node.id
  const fromX = node.x + NODE_W
  const fromY = node.y + NODE_H / 2
  drag.value = {
    kind: 'wire',
    fromId: node.id,
    fromX,
    fromY,
    curX: fromX,
    curY: fromY,
  }
}

function finishWireOnNode(e: MouseEvent, targetId: string) {
  if (drag.value?.kind !== 'wire') return
  e.stopPropagation()
  const fromId = drag.value.fromId
  drag.value = null
  if (fromId === targetId) return
  const nextDoc = cloneDoc()
  const src = nextDoc.nodes.find((n) => n.id === fromId)
  if (src) {
    src.next = targetId
    commitDoc(nextDoc)
  }
}

function onMouseMove(e: MouseEvent) {
  const d = drag.value
  if (!d) return
  if (d.kind === 'pan') {
    panX.value = d.origPanX + (e.clientX - d.startX)
    panY.value = d.origPanY + (e.clientY - d.startY)
  } else if (d.kind === 'node') {
    const dx = (e.clientX - d.startX) / zoom.value
    const dy = (e.clientY - d.startY) / zoom.value
    const nextDoc = cloneDoc()
    const target = nextDoc.nodes.find((n) => n.id === d.nodeId)
    if (target) {
      target.x = Math.round(d.origX + dx)
      target.y = Math.round(d.origY + dy)
      commitDoc(nextDoc)
    }
  } else if (d.kind === 'wire') {
    const w = toWorld(e.clientX, e.clientY)
    d.curX = w.x
    d.curY = w.y
  }
}

function onMouseUp() {
  drag.value = null
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.08 : 0.08
  zoom.value = Math.max(0.4, Math.min(1.6, Number((zoom.value + delta).toFixed(2))))
}

function removeWire(edge: WireEdge) {
  const nextDoc = cloneDoc()
  const src = nextDoc.nodes.find((n) => n.id === edge.fromId)
  if (!src) return
  if (typeof edge.choiceIndex === 'number') {
    src.choices.splice(edge.choiceIndex, 1)
  } else {
    src.next = undefined
  }
  commitDoc(nextDoc)
}

function addSceneNode() {
  const nextDoc = cloneDoc()
  let n = nextDoc.nodes.length + 1
  while (nextDoc.nodes.some((x) => x.id === `scene_${n}`)) n++
  const last = nextDoc.nodes[nextDoc.nodes.length - 1]
  const newNode: StorySceneNode = {
    id: `scene_${n}`,
    title: `新场景 ${n}`,
    x: last ? last.x + 300 : 100,
    y: last ? last.y : 120,
    body: '心菜: 这里是新场景的台词。',
    choices: [],
  }
  if (last && !last.next) last.next = newNode.id
  nextDoc.nodes.push(newNode)
  selectedNodeId.value = newNode.id
  commitDoc(nextDoc)
}

function deleteSelectedNode() {
  if (!selectedNode.value || doc.value.nodes.length <= 1) return
  const delId = selectedNode.value.id
  const nextDoc = cloneDoc()
  nextDoc.nodes = nextDoc.nodes.filter((n) => n.id !== delId)
  for (const node of nextDoc.nodes) {
    if (node.next === delId) node.next = undefined
    node.choices = node.choices.filter((c) => c.target !== delId)
  }
  selectedNodeId.value = nextDoc.nodes[0]?.id ?? null
  commitDoc(nextDoc)
}

function autoLayout() {
  const nextDoc = cloneDoc()
  nextDoc.nodes.forEach((n, idx) => {
    n.x = 60 + (idx % 3) * 300
    n.y = 80 + Math.floor(idx / 3) * 180
  })
  panX.value = 24
  panY.value = 24
  zoom.value = 1
  commitDoc(nextDoc)
}

function fitView() {
  const nodes = doc.value.nodes
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect || nodes.length === 0) return
  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W))
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H))
  const spanW = Math.max(200, maxX - minX + 80)
  const spanH = Math.max(150, maxY - minY + 80)
  const nextZoom = Math.max(0.4, Math.min(1.2, Math.min(rect.width / spanW, rect.height / spanH)))
  zoom.value = Number(nextZoom.toFixed(2))
  panX.value = Math.round((rect.width - (maxX - minX) * zoom.value) / 2 - minX * zoom.value)
  panY.value = Math.round((rect.height - (maxY - minY) * zoom.value) / 2 - minY * zoom.value)
}

function onCanvasDblClick(e: MouseEvent) {
  if (e.target !== canvasRef.value) return
  const pos = toWorld(e.clientX, e.clientY)
  const nextDoc = cloneDoc()
  let n = nextDoc.nodes.length + 1
  while (nextDoc.nodes.some((x) => x.id === `scene_${n}`)) n++
  const newNode: StorySceneNode = {
    id: `scene_${n}`,
    title: `新场景 ${n}`,
    x: Math.round(pos.x - NODE_W / 2),
    y: Math.round(pos.y - NODE_H / 2),
    body: '心菜: 这里是新场景的台词。',
    choices: [],
  }
  nextDoc.nodes.push(newNode)
  selectedNodeId.value = newNode.id
  commitDoc(nextDoc)
}

function updateSelectedField(field: 'title' | 'body', value: string) {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  const nextDoc = cloneDoc()
  const target = nextDoc.nodes.find((n) => n.id === id)
  if (target) {
    target[field] = value
    commitDoc(nextDoc)
  }
}

function addChoice() {
  if (!selectedNode.value || doc.value.nodes.length === 0) return
  const id = selectedNode.value.id
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === id)
  if (!node) return
  const fallbackTarget = nextDoc.nodes.find((n) => n.id !== id)?.id ?? id
  node.choices.push({ label: `选项 ${node.choices.length + 1}`, target: fallbackTarget })
  commitDoc(nextDoc)
}

function updateChoice(idx: number, patch: { label?: string; target?: string }) {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === id)
  const choice = node?.choices[idx]
  if (!choice) return
  if (patch.label !== undefined) choice.label = patch.label
  if (patch.target !== undefined) choice.target = patch.target
  commitDoc(nextDoc)
}

function removeChoice(idx: number) {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === id)
  if (!node) return
  node.choices.splice(idx, 1)
  commitDoc(nextDoc)
}

const activeSceneId = computed(() => {
  if (props.activeFrameIndex == null) return null
  let matched: string | null = null
  let bestStart = -1
  for (const [id, start] of props.sceneStartFrames.entries()) {
    if (start <= props.activeFrameIndex && start >= bestStart) {
      bestStart = start
      matched = id
    }
  }
  return matched
})

onMounted(() => {
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div class="graph-root">
    <!-- Graph Toolbar -->
    <div class="graph-toolbar">
      <div class="toolbar-left">
        <button class="g-btn primary" type="button" @click="addSceneNode">+ 新建场景节点</button>
        <button class="g-btn" type="button" @click="autoLayout">自动整理</button>
        <button class="g-btn" type="button" @click="fitView">适应画布</button>
        <button class="g-btn" type="button" :disabled="doc.nodes.length <= 1" @click="deleteSelectedNode">
          删除选中节点
        </button>
      </div>
      <div class="toolbar-right">
        <span class="hint">拖拽端口连线 · 点击连线可断开</span>
        <button class="g-btn" type="button" @click="zoom = Math.max(0.4, +(zoom - 0.1).toFixed(2))">-</button>
        <span class="zoom-label">{{ Math.round(zoom * 100) }}%</span>
        <button class="g-btn" type="button" @click="zoom = Math.min(1.6, +(zoom + 0.1).toFixed(2))">+</button>
      </div>
    </div>

    <!-- Interactive Canvas -->
    <div ref="canvasRef" class="graph-canvas" @mousedown="startPan" @dblclick="onCanvasDblClick" @wheel="onWheel">
      <div
        class="graph-world"
        :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }"
      >
        <!-- SVG Bezier Wires -->
        <svg class="wire-layer" width="4000" height="4000">
          <g v-for="edge in wires" :key="edge.key" class="wire-group" @click.stop="removeWire(edge)">
            <path :d="edge.path" class="wire-hit" />
            <path
              :d="edge.path"
              class="wire-stroke"
              :class="{ choice: typeof edge.choiceIndex === 'number' }"
            />
            <g :transform="`translate(${edge.midX}, ${edge.midY})`" class="wire-badge">
              <rect v-if="edge.label" x="-42" y="-11" width="84" height="22" rx="11" class="wire-label-bg" />
              <text v-if="edge.label" text-anchor="middle" dy="4" class="wire-label-txt">
                {{ edge.label.slice(0, 10) }}
              </text>
              <circle v-else r="9" class="wire-del-bg" />
              <text v-if="!edge.label" text-anchor="middle" dy="3.5" class="wire-del-txt">×</text>
            </g>
          </g>

          <!-- Dragging preview wire -->
          <path
            v-if="drag?.kind === 'wire'"
            :d="bezierPath(drag.fromX, drag.fromY, drag.curX, drag.curY)"
            class="wire-preview"
          />
        </svg>

        <!-- Scene Nodes -->
        <div
          v-for="node in doc.nodes"
          :key="node.id"
          class="scene-node"
          :class="{ selected: selectedNode?.id === node.id, playing: activeSceneId === node.id }"
          :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${NODE_W}px`, minHeight: `${NODE_H}px` }"
          @mousedown="startNodeDrag($event, node)"
          @mouseup="finishWireOnNode($event, node.id)"
        >
          <!-- Input Port -->
          <div
            class="port port-in"
            title="连线入口"
            @mouseup="finishWireOnNode($event, node.id)"
          />

          <div class="node-head">
            <div class="node-title-wrap">
              <span class="node-id">#{{ node.id }}</span>
              <span class="node-title">{{ node.title }}</span>
            </div>
            <button
              class="node-play"
              type="button"
              title="从该场景开始预览"
              @mousedown.stop
              @click.stop="emit('playScene', node.id)"
            >
              ▶
            </button>
          </div>

          <div class="node-body-preview">
            {{ node.body || '(空场景)' }}
          </div>

          <div class="node-foot">
            <span>帧起点: #{{ (sceneStartFrames.get(node.id) ?? 0) + 1 }}</span>
            <span>{{ node.next ? `→ ${node.next}` : node.choices.length ? `${node.choices.length} 分支` : '终点' }}</span>
          </div>

          <!-- Output Port -->
          <div
            class="port port-out"
            title="拖拽连接到下一个场景"
            @mousedown="startWireDrag($event, node)"
          />
        </div>
      </div>
    </div>

    <!-- Selected Node Quick Inspector -->
    <div v-if="selectedNode" class="node-inspector">
      <div class="insp-row">
        <span class="insp-label">节点 {{ selectedNode.id }}</span>
        <input
          :value="selectedNode.title"
          class="insp-title"
          placeholder="场景标题"
          @input="updateSelectedField('title', ($event.target as HTMLInputElement).value)"
        />
        <button class="g-btn primary" type="button" @click="emit('playScene', selectedNode.id)">
          播放此场景
        </button>
        <button class="g-btn" type="button" @click="addChoice">+ 分支</button>
      </div>
      <div v-if="selectedNode.choices.length > 0" class="choice-list">
        <div v-for="(c, cIdx) in selectedNode.choices" :key="cIdx" class="choice-row">
          <input
            :value="c.label"
            class="choice-input"
            placeholder="选项文案"
            @input="updateChoice(cIdx, { label: ($event.target as HTMLInputElement).value })"
          />
          <span class="choice-arrow">→</span>
          <select
            :value="c.target"
            class="choice-select"
            @change="updateChoice(cIdx, { target: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="opt in doc.nodes" :key="opt.id" :value="opt.id">
              {{ opt.id }} ({{ opt.title }})
            </option>
          </select>
          <button class="g-btn" type="button" @click="removeChoice(cIdx)">×</button>
        </div>
      </div>
      <textarea
        :value="selectedNode.body"
        class="insp-body"
        rows="4"
        placeholder="在此直接编辑该场景节点的 DSL 台词与指令…"
        @input="updateSelectedField('body', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>

<style scoped>
.graph-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid #27272a;
  border-radius: 8px;
  overflow: hidden;
  background: #09090b;
}
.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: #18181b;
  border-bottom: 1px solid #27272a;
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hint {
  font-size: 11px;
  color: #71717a;
}
.zoom-label {
  font-size: 11px;
  color: #a1a1aa;
  min-width: 36px;
  text-align: center;
}
.g-btn {
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #f4f4f5;
  cursor: pointer;
}
.g-btn.primary {
  background: #db2777;
  border-color: #db2777;
}
.g-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.graph-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background-image: radial-gradient(#27272a 1px, transparent 1px);
  background-size: 20px 20px;
  cursor: grab;
}
.graph-canvas:active {
  cursor: grabbing;
}
.graph-world {
  position: absolute;
  inset: 0;
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
  stroke-width: 14;
}
.wire-stroke {
  fill: none;
  stroke: #38bdf8;
  stroke-width: 2.5;
}
.wire-stroke.choice {
  stroke: #f59e0b;
  stroke-dasharray: 5 3;
}
.wire-preview {
  fill: none;
  stroke: #ec4899;
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
}
.wire-del-bg {
  fill: #18181b;
  stroke: #38bdf8;
  stroke-width: 1.5;
}
.wire-del-txt {
  fill: #e4e4e7;
  font-size: 12px;
}
.wire-label-bg {
  fill: #18181b;
  stroke: #f59e0b;
  stroke-width: 1.5;
}
.wire-label-txt {
  fill: #fcd34d;
  font-size: 10px;
}
.scene-node {
  position: absolute;
  border-radius: 10px;
  border: 1px solid #3f3f46;
  background: #18181b;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  user-select: none;
}
.scene-node.selected {
  border-color: #ec4899;
  box-shadow: 0 0 0 1px rgba(236, 72, 153, 0.5), 0 8px 24px rgba(0, 0, 0, 0.6);
}
.scene-node.playing {
  border-color: #10b981;
}
.choice-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.choice-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.choice-input,
.choice-select {
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #fcd34d;
}
.choice-input {
  flex: 1;
}
.choice-arrow {
  font-size: 11px;
  color: #71717a;
}
.node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid #27272a;
  gap: 6px;
}
.node-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.node-id {
  font-size: 10px;
  color: #38bdf8;
  flex-shrink: 0;
}
.node-title {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-play {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 0;
  background: #27272a;
  color: #34d399;
  cursor: pointer;
}
.node-body-preview {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
  color: #a1a1aa;
  white-space: pre-wrap;
  overflow: hidden;
  max-height: 54px;
}
.node-foot {
  display: flex;
  justify-content: space-between;
  padding: 4px 10px;
  border-top: 1px solid #27272a;
  font-size: 10px;
  color: #71717a;
}
.port {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-top: -6px;
  border-radius: 999px;
  border: 2px solid #09090b;
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
.port-out:hover {
  background: #ec4899;
  transform: scale(1.2);
}
.node-inspector {
  border-top: 1px solid #27272a;
  background: #18181b;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.insp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.insp-label {
  font-size: 11px;
  color: #38bdf8;
  font-weight: 600;
}
.insp-title {
  flex: 1;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #f4f4f5;
}
.insp-body {
  width: 100%;
  resize: none;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #e4e4e7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
