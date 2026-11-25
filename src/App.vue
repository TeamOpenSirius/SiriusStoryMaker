<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AiHarnessPanel from './components/AiHarnessPanel.vue'
import DslEditor from './components/DslEditor.vue'
import PlayerPreview from './components/PlayerPreview.vue'
import StoryGraph from './components/StoryGraph.vue'
import { compileDsl, DSL_SNIPPETS } from './dsl/compiler'
import { decompileEpisode } from './dsl/decompiler'
import { parseStoryGraph } from './dsl/graph'
import type { IEpisodeModel } from '../player/src/types/Episode'
import {
  ADV_RESOURCE_CDN,
  loadResourceCatalog,
  type ResourceCatalog,
} from './services/resourceCatalog'
import type { HarnessInfo } from './env'

const SAMPLE_DSL = `@title 星屑舞台的排练前夜
@chapter 第一章 · 排练室
@episode 1001
@alias 心菜 10101

@scene start title="排练室开场" x=60 y=90
@bg 1000 fade=cross camera=6
@char 1 心菜 pos=center expr=smile body=happy
心菜: 大家准备好了吗？今天要把新曲的走位全部顺一遍哦！
+ 哪怕还有一点紧张，只要站在舞台上就没问题！
-> flashback

@scene flashback title="回忆片段" x=360 y=90
@effect sepia
心菜(small): （回想起第一次站在 Sirius 剧场的那一天……）
-> ending

@scene ending title="回到现实" x=660 y=90
@effect none
@fade time 0.35 0.5 0.35
@char 1 心菜 pos=left appear=left expr=normal body=think
: 排练室的灯光缓缓亮起，新的一幕即将开始。
`

const DRAFT_STORAGE_KEY = 'sirius-adv-studio.draft.v1'

function loadInitialScript(): string {
  try {
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (saved && saved.trim()) return saved
  } catch {
    // ignore storage errors
  }
  return SAMPLE_DSL
}

const script = ref(loadInitialScript())
const currentFilePath = ref<string | undefined>(undefined)
const sidebarTab = ref<'outline' | 'snippets' | 'resources'>('outline')
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
const jsonInputRef = ref<HTMLInputElement | null>(null)
const editorMode = ref<'dsl' | 'graph' | 'json'>('dsl')
const showHelpModal = ref(false)
const activeFrameIndex = ref(0)
const activeChoices = ref<Record<string, number>>({})
const playingAudioId = ref<string | null>(null)
const previewSpineId = ref<string | null>(null)
let previewAudio: HTMLAudioElement | null = null

watch(script, (val) => {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, val)
  } catch {
    // ignore storage quota errors
  }
})
const showAiPanel = ref(true)
const availableHarnessCount = ref(0)
const statusMsg = ref('就绪 · 实时编译已开启')
const editorRef = ref<InstanceType<typeof DslEditor> | null>(null)
const playerRef = ref<InstanceType<typeof PlayerPreview> | null>(null)

const filteredResources = computed(() => {
  const list = catalog.value[resourceKind.value] || []
  const q = resourceQuery.value.trim().toLowerCase()
  const matched = q ? list.filter((id) => id.toLowerCase().includes(q)) : list
  return matched.slice(0, 60)
})

function onGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    showHelpModal.value = false
    previewSpineId.value = null
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveFile()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    void openFile()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeyDown)
  catalog.value = await loadResourceCatalog()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
  previewAudio?.pause()
  previewAudio = null
})

function toggleAudioPreview(kind: 'bgms' | 'ses', id: string) {
  const key = `${kind}:${id}`
  if (playingAudioId.value === key) {
    previewAudio?.pause()
    playingAudioId.value = null
    return
  }
  previewAudio?.pause()
  const folder = kind === 'bgms' ? 'bgm' : 'se'
  previewAudio = new Audio(`${ADV_RESOURCE_CDN}/${folder}/${encodeURIComponent(id)}.mp3`)
  previewAudio.volume = 0.5
  previewAudio.onended = () => {
    playingAudioId.value = null
  }
  playingAudioId.value = key
  void previewAudio.play().catch(() => {
    playingAudioId.value = null
  })
}

function newStory() {
  currentFilePath.value = undefined
  script.value = `@title 新建剧集\n@chapter 第一章\n@episode 1001\n\n@bg 1000 fade=cross\n@char 1 10101 pos=center expr=normal body=normal\n心菜: 从这里开始写你的新剧情吧！\n`
  statusMsg.value = '已新建空白剧本'
}

function resetSample() {
  currentFilePath.value = undefined
  script.value = SAMPLE_DSL
  statusMsg.value = '已恢复示例剧本'
}

function insertResourceSnippet(id: string) {
  const map: Record<typeof resourceKind.value, string> = {
    backgrounds: `@bg ${id} fade=cross`,
    spines: `@char 1 ${id} pos=center expr=normal body=normal`,
    stills: `@still ${id}`,
    bgms: `@bgm ${id}`,
    ses: `@se ${id}`,
  }
  insertSnippet(map[resourceKind.value])
}

async function onJsonFileSelected(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const model = JSON.parse(text) as IEpisodeModel
    script.value = decompileEpisode(model)
    currentFilePath.value = undefined
    statusMsg.value = `已导入并反编译 ${file.name}`
  } catch (err) {
    statusMsg.value = `JSON 导入失败: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    ;(ev.target as HTMLInputElement).value = ''
  }
}

function onHarnessesLoaded(list: HarnessInfo[]) {
  availableHarnessCount.value = list.filter((h) => h.available).length
}

function applyAiScript(next: string) {
  script.value = next
  statusMsg.value = '已应用 AI 生成剧本'
}

const resourceSets = computed(() => ({
  backgrounds: new Set(catalog.value.backgrounds),
  spines: new Set(catalog.value.spines),
  stills: new Set(catalog.value.stills),
  bgms: new Set(catalog.value.bgms),
  ses: new Set(catalog.value.ses),
}))

const compiled = computed(() => compileDsl(script.value, resourceSets.value, activeChoices.value))

const choiceNodes = computed(() => {
  const doc = parseStoryGraph(script.value)
  return doc.nodes.filter((n) => n.choices.length > 0)
})

async function pickBranch(sceneId: string, idx: number, targetId: string) {
  activeChoices.value = { ...activeChoices.value, [sceneId]: idx }
  await nextTick()
  const frameIdx = compiled.value.sceneStartFrames.get(targetId)
  if (typeof frameIdx === 'number') {
    activeFrameIndex.value = frameIdx
    playerRef.value?.seekTo(frameIdx)
    playerRef.value?.pushEpisode()
  }
}

function onCursorLine(line: number) {
  const frameIdx = compiled.value.lineToFrame.get(line)
  if (typeof frameIdx === 'number') {
    activeFrameIndex.value = frameIdx
    playerRef.value?.seekTo(frameIdx)
  }
}

function selectOutlineFrame(idx: number) {
  activeFrameIndex.value = idx
  playerRef.value?.seekTo(idx)
  if (editorMode.value === 'dsl') {
    for (const [line, frameIdx] of compiled.value.lineToFrame.entries()) {
      if (frameIdx === idx) {
        editorRef.value?.goToLine(line)
        break
      }
    }
  }
}

async function importLocalAsset() {
  if (!window.siriusStudio) {
    statusMsg.value = '请在 Electron 桌面端中导入本地素材'
    return
  }
  const kindMap: Partial<Record<typeof resourceKind.value, 'background' | 'bgm' | 'se'>> = {
    backgrounds: 'background',
    bgms: 'bgm',
    ses: 'se',
  }
  const kind = kindMap[resourceKind.value]
  if (!kind) return
  const res = await window.siriusStudio.importLocalAsset(kind)
  if (res) {
    const cmd = kind === 'background' ? `@bg ${res.assetId} fade=cross` : `@${kind} ${res.assetId}`
    insertSnippet(cmd)
    statusMsg.value = `已导入本地素材 ${res.assetId}`
  }
}

function playSceneFromGraph(sceneId: string) {
  const frameIdx = compiled.value.sceneStartFrames.get(sceneId)
  if (typeof frameIdx === 'number') {
    activeFrameIndex.value = frameIdx
    playerRef.value?.seekTo(frameIdx)
  }
}

async function editSceneInDsl(sceneId: string) {
  editorMode.value = 'dsl'
  await nextTick()
  const lines = script.value.split(/\r?\n/)
  const idx = lines.findIndex((l) => l.trim().startsWith(`@scene ${sceneId}`))
  if (idx !== -1) {
    editorRef.value?.goToLine(idx + 1)
  }
}

async function copyCompiledJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(compiled.value.episode, null, 2))
    statusMsg.value = '已复制 IEpisodeModel JSON 到剪贴板'
  } catch {
    statusMsg.value = '复制失败，请使用导出 JSON'
  }
}

function insertSnippet(code: string) {
  editorRef.value?.insertLine(code)
}

async function openFile() {
  if (!window.siriusStudio) {
    statusMsg.value = '当前在浏览器预览模式，请在 Electron 中打开文件'
    return
  }
  const res = await window.siriusStudio.openStory()
  if (res) {
    currentFilePath.value = res.filePath
    script.value = res.content
    statusMsg.value = `已打开 ${res.filePath}`
  }
}

async function saveFile() {
  if (!window.siriusStudio) return
  const res = await window.siriusStudio.saveStory({
    filePath: currentFilePath.value,
    content: script.value,
  })
  if (res) {
    currentFilePath.value = res.filePath
    statusMsg.value = `已保存 ${res.filePath}`
  }
}

async function exportJson() {
  const json = JSON.stringify(compiled.value.episode, null, 2)
  if (window.siriusStudio) {
    const res = await window.siriusStudio.exportJson({
      json,
      defaultName: `${compiled.value.episode.Title || 'episode'}.json`,
    })
    if (res) statusMsg.value = `已导出 ${res.filePath}`
    return
  }
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'episode.json'
  a.click()
  URL.revokeObjectURL(url)
  statusMsg.value = '已下载 episode.json'
}
</script>

<template>
  <div class="studio-root">
    <!-- Top Header -->
    <header class="top-bar">
      <div class="brand-group">
        <span class="brand-name">SiriusAdvStudio</span>
        <span class="episode-badge">
          {{ compiled.episode.Chapter }} · {{ compiled.episode.Title }}
          <template v-if="currentFilePath"> · {{ currentFilePath.split(/[\\/]/).pop() }}</template>
        </span>
      </div>
      <div class="toolbar-actions">
        <button class="harness-pill clickable" type="button" @click="showAiPanel = !showAiPanel">
          AI 导演 ({{ availableHarnessCount }} 可用)
        </button>
        <button class="btn" type="button" @click="showHelpModal = true">语法速查</button>
        <button class="btn" type="button" @click="newStory">新建</button>
        <button class="btn" type="button" @click="resetSample">示例</button>
        <button class="btn" type="button" @click="openFile">打开</button>
        <button class="btn" type="button" @click="saveFile">保存</button>
        <button class="btn" type="button" @click="jsonInputRef?.click()">导入 JSON</button>
        <input ref="jsonInputRef" type="file" accept=".json,application/json" style="display: none" @change="onJsonFileSelected" />
        <button class="btn primary" type="button" @click="exportJson">导出 JSON</button>
      </div>
    </header>

    <!-- 3/4-Pane IDE Body -->
    <main class="workspace" :class="{ 'with-ai': showAiPanel }">
      <!-- Pane 1: Outline & Snippets -->
      <aside class="sidebar">
        <div class="tab-row">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: sidebarTab === 'outline' }"
            @click="sidebarTab = 'outline'"
          >
            大纲 ({{ compiled.episode.EpisodeDetail.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: sidebarTab === 'snippets' }"
            @click="sidebarTab = 'snippets'"
          >
            速插
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: sidebarTab === 'resources' }"
            @click="sidebarTab = 'resources'"
          >
            资源库
          </button>
        </div>

        <div v-if="sidebarTab === 'outline'" class="sidebar-list">
          <button
            v-for="(frame, idx) in compiled.episode.EpisodeDetail"
            :key="frame.Id"
            type="button"
            class="list-item"
            :class="{ 'is-active': idx === activeFrameIndex }"
            @click="selectOutlineFrame(idx)"
          >
            <span class="item-idx">#{{ idx + 1 }}</span>
            <span class="item-who">[{{ frame.SpeakerName || '旁白' }}]</span>
            <span class="item-text">{{ frame.Phrase || '(指令帧)' }}</span>
          </button>
        </div>

        <div v-else-if="sidebarTab === 'snippets'" class="sidebar-list">
          <button
            v-for="(snip, idx) in DSL_SNIPPETS"
            :key="idx"
            type="button"
            class="list-item col"
            @click="insertSnippet(snip.code)"
          >
            <span class="snip-cat">[{{ snip.category }}] {{ snip.label }}</span>
            <code class="snip-code">{{ snip.code }}</code>
          </button>
        </div>

        <div v-else class="resource-browser">
          <select v-model="resourceKind" class="res-select">
            <option value="backgrounds">背景 ({{ catalog.backgrounds.length }})</option>
            <option value="spines">角色 Spine ({{ catalog.spines.length }})</option>
            <option value="stills">CG Still ({{ catalog.stills.length }})</option>
            <option value="bgms">BGM ({{ catalog.bgms.length }})</option>
            <option value="ses">音效 SE ({{ catalog.ses.length }})</option>
          </select>
          <input v-model="resourceQuery" class="res-search" type="text" placeholder="筛选 ID…" />
          <button
            v-if="resourceKind === 'backgrounds' || resourceKind === 'bgms' || resourceKind === 'ses'"
            type="button"
            class="btn"
            style="width: 100%; font-size: 11px; padding: 4px 8px"
            @click="importLocalAsset"
          >
            + 导入本地{{ resourceKind === 'backgrounds' ? '背景图' : resourceKind === 'bgms' ? 'BGM' : '音效' }}
          </button>
          <div class="sidebar-list">
            <div
              v-for="id in filteredResources"
              :key="id"
              class="res-row"
            >
              <button
                type="button"
                class="list-item res-item"
                @click="insertResourceSnippet(id)"
              >
                <img
                  v-if="resourceKind === 'backgrounds'"
                  :src="`${ADV_RESOURCE_CDN}/background/${encodeURIComponent(id)}.png`"
                  loading="lazy"
                  class="res-thumb"
                />
                <span class="res-id">{{ id }}</span>
              </button>
              <button
                v-if="resourceKind === 'bgms' || resourceKind === 'ses'"
                type="button"
                class="audio-btn"
                @click="toggleAudioPreview(resourceKind, id)"
              >
                {{ playingAudioId === `${resourceKind}:${id}` ? '■' : '▶' }}
              </button>
              <button
                v-if="resourceKind === 'spines'"
                type="button"
                class="audio-btn"
                title="预览 Spine"
                @click="previewSpineId = id"
              >
                👁
              </button>
            </div>
          </div>
        </div>
      </aside>

      <!-- Pane 2: DSL Script Editor / Compiled JSON Inspector -->
      <section class="editor-pane">
        <div class="pane-header">
          <div class="pane-tabs">
            <button
              type="button"
              class="mini-tab"
              :class="{ active: editorMode === 'dsl' }"
              @click="editorMode = 'dsl'"
            >
              DSL 编辑器
            </button>
            <button
              type="button"
              class="mini-tab"
              :class="{ active: editorMode === 'graph' }"
              @click="editorMode = 'graph'"
            >
              节点图
            </button>
            <button
              type="button"
              class="mini-tab"
              :class="{ active: editorMode === 'json' }"
              @click="editorMode = 'json'"
            >
              JSON 预览
            </button>
            <button
              v-if="editorMode === 'json'"
              type="button"
              class="mini-tab"
              @click="copyCompiledJson"
            >
              复制 JSON
            </button>
          </div>
          <span class="pane-status">{{ statusMsg }}</span>
        </div>
        <div class="pane-body">
          <DslEditor
            v-if="editorMode === 'dsl'"
            ref="editorRef"
            v-model="script"
            :diagnostics="compiled.diagnostics"
            :catalog="catalog"
            @cursor-line="onCursorLine"
          />
          <StoryGraph
            v-else-if="editorMode === 'graph'"
            v-model="script"
            :scene-start-frames="compiled.sceneStartFrames"
            :active-frame-index="activeFrameIndex"
            @play-scene="playSceneFromGraph"
            @edit-in-dsl="editSceneInDsl"
          />
          <pre v-else class="json-preview">{{ JSON.stringify(compiled.episode, null, 2) }}</pre>
        </div>
      </section>

      <!-- Pane 3: AI Harness Conversation Panel -->
      <section v-if="showAiPanel" class="ai-pane">
        <AiHarnessPanel
          :script="script"
          :file-path="currentFilePath"
          :diagnostics="compiled.diagnostics"
          @apply-script="applyAiScript"
          @harnesses-loaded="onHarnessesLoaded"
        />
      </section>

      <!-- Pane 4: Embedded Original WDS Adv Player -->
      <section class="player-pane">
        <div v-if="choiceNodes.length > 0" class="branch-bar">
          <template v-for="cNode in choiceNodes" :key="cNode.id">
            <span class="branch-title">分支 ({{ cNode.title }}):</span>
            <button
              v-for="(c, cIdx) in cNode.choices"
              :key="`${cNode.id}-${cIdx}`"
              type="button"
              class="branch-chip"
              :class="{ active: (activeChoices[cNode.id] ?? 0) === cIdx }"
              @click="pickBranch(cNode.id, cIdx, c.target)"
            >
              {{ c.label }} → {{ c.target }}
            </button>
          </template>
        </div>
        <PlayerPreview ref="playerRef" :episode="compiled.episode" />
      </section>
    </main>

    <!-- Spine Quick Preview Modal -->
    <div v-if="previewSpineId" class="spine-modal-backdrop" @click.self="previewSpineId = null">
      <div class="spine-modal">
        <div class="spine-modal-header">
          <span>Spine 角色预览 · {{ previewSpineId }}</span>
          <div class="spine-modal-actions">
            <button class="btn primary" type="button" @click="insertResourceSnippet(previewSpineId); previewSpineId = null">
              插入角色
            </button>
            <button class="btn" type="button" @click="previewSpineId = null">关闭</button>
          </div>
        </div>
        <iframe
          :src="`./wds-adv-player/index.html?spine=${encodeURIComponent(previewSpineId)}&renderer=webgl`"
          class="spine-iframe"
        />
      </div>
    </div>

    <!-- DSL Cheat Sheet Modal -->
    <div v-if="showHelpModal" class="spine-modal-backdrop" @click.self="showHelpModal = false">
      <div class="help-modal">
        <div class="spine-modal-header">
          <span>极简剧本 DSL 语法速查</span>
          <button class="btn" type="button" @click="showHelpModal = false">关闭</button>
        </div>
        <div class="help-body">
          <div class="help-row"><code>@title / @chapter / @episode</code><span>设置剧集标题、章节名与 ID</span></div>
          <div class="help-row"><code>@alias 心菜 10101</code><span>为 Spine ID 定义可读角色别名</span></div>
          <div class="help-row"><code>@scene id title="名称" x=0 y=0</code><span>定义节点图场景块，配合 <code>-&gt; id</code> 跳转</span></div>
          <div class="help-row"><code>@choice "选项文案" -&gt; id</code><span>定义分支连线，可在播放器上方切换试玩</span></div>
          <div class="help-row"><code>@bg 1000 fade=cross camera=6</code><span>切换背景（支持本地 <code>asset_*</code>）、淡入与镜头</span></div>
          <div class="help-row"><code>@char 1 心菜 pos=left expr=smile body=happy</code><span>角色登场/动作（支持 <code>head=</code> / <code>dir=</code> / <code>lip=</code>）</span></div>
          <div class="help-row"><code>@clear_chars</code><span>清空场上所有角色</span></div>
          <div class="help-row"><code>@effect sepia|blur|none</code><span>持续性画面滤镜，直到 <code>none</code> 清除</span></div>
          <div class="help-row"><code>@fade black|white|time 0.4 0.5 0.4</code><span>黑/白/时间流逝转场</span></div>
          <div class="help-row"><code>@bgm id|stop / @se id / @voice id</code><span>播放背景音乐、音效与语音</span></div>
          <div class="help-row"><code>说话人(small|large): 台词</code><span>台词（省略说话人为旁白，<code>+ </code> 同组续行）</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.studio-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #09090b;
}
.top-bar {
  height: 46px;
  padding: 0 14px;
  background: #18181b;
  border-bottom: 1px solid #27272a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.brand-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-name {
  font-size: 14px;
  font-weight: 700;
  color: #f472b6;
}
.episode-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #27272a;
  color: #d4d4d8;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.harness-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #34d399;
  cursor: pointer;
}
.btn {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #f4f4f5;
  cursor: pointer;
}
.btn:hover {
  background: #3f3f46;
}
.btn.primary {
  background: #db2777;
  border-color: #db2777;
}
.btn.primary:hover {
  background: #be185d;
}
.workspace {
  flex: 1;
  min-height: 0;
  padding: 10px;
  display: grid;
  grid-template-columns: 220px minmax(340px, 0.9fr) minmax(480px, 1.3fr);
  gap: 10px;
}
.workspace.with-ai {
  grid-template-columns: 210px minmax(300px, 0.85fr) minmax(290px, 0.8fr) minmax(440px, 1.2fr);
}
.ai-pane {
  min-height: 0;
}
.resource-browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.res-select,
.res-search {
  width: 100%;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #e4e4e7;
}
.res-item {
  align-items: center;
  flex: 1;
  min-width: 0;
}
.res-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.audio-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #38bdf8;
  font-size: 11px;
  cursor: pointer;
}
.audio-btn:hover {
  background: #27272a;
}
.spine-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.spine-modal {
  width: 560px;
  height: 440px;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.spine-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #27272a;
  font-size: 13px;
  font-weight: 600;
}
.spine-modal-actions {
  display: flex;
  gap: 8px;
}
.spine-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #09090b;
}
.help-modal {
  width: 640px;
  max-width: 92vw;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.help-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 70vh;
  overflow-y: auto;
}
.help-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid #27272a;
}
.help-row code {
  color: #38bdf8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}
.help-row span {
  color: #d4d4d8;
  text-align: right;
}
.res-thumb {
  width: 44px;
  height: 25px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  background: #18181b;
}
.res-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar,
.editor-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 10px;
  padding: 8px;
  gap: 8px;
}
.player-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.branch-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 8px;
}
.branch-title {
  font-size: 11px;
  color: #fcd34d;
  font-weight: 600;
}
.branch-chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #e4e4e7;
  cursor: pointer;
}
.branch-chip.active {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  color: #fcd34d;
}
.tab-row {
  display: flex;
  gap: 6px;
}
.tab-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: 6px;
  border: 0;
  background: #09090b;
  color: #a1a1aa;
  cursor: pointer;
}
.tab-btn.active {
  background: #27272a;
  color: #ffffff;
  font-weight: 600;
}
.sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.list-item {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  border: 0;
  background: #09090b;
  color: #d4d4d8;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.list-item.col {
  flex-direction: column;
  gap: 2px;
}
.list-item:hover {
  background: #27272a;
}
.list-item.is-active {
  background: rgba(236, 72, 153, 0.16);
  border: 1px solid rgba(236, 72, 153, 0.4);
}
.item-idx {
  color: #71717a;
  flex-shrink: 0;
}
.item-who {
  color: #f472b6;
  flex-shrink: 0;
}
.item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.snip-cat {
  color: #38bdf8;
  font-size: 11px;
}
.snip-code {
  color: #a1a1aa;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}
.pane-title {
  font-size: 12px;
  font-weight: 600;
}
.pane-status {
  font-size: 11px;
  color: #a1a1aa;
}
.pane-body {
  flex: 1;
  min-height: 0;
}
.pane-tabs {
  display: flex;
  gap: 4px;
}
.mini-tab {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 6px;
  border: 0;
  background: #09090b;
  color: #a1a1aa;
  cursor: pointer;
}
.mini-tab.active {
  background: #27272a;
  color: #f4f4f5;
  font-weight: 600;
}
.json-preview {
  margin: 0;
  height: 100%;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #27272a;
  background: #09090b;
  color: #a1a1aa;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
