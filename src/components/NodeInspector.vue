<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  Film,
  GitBranch,
  Image as ImageIcon,
  Mic,
  Music,
  Play,
  Plus,
  Trash2,
  Upload,
  User,
} from 'lucide-vue-next'
import type { IEpisodeDetail, IEpisodeModel } from '../../player/src/types/Episode'
import { parseStoryGraph, serializeStoryGraph, type StoryGraphDoc } from '../dsl/graph'
import {
  BODY_LABELS,
  BUILTIN_CAST,
  EXPR_LABELS,
  framesToSceneDsl,
  getSceneVisualFrames,
  parseAliasMap,
  POS_LABELS,
} from '../dsl/sceneFrames'
import { ADV_RESOURCE_CDN } from '../services/resourceCatalog'

import type { ProjectAsset } from "../shared/project"

const props = defineProps<{
  assetBase?: string
  localVoices?: ProjectAsset[]
  modelValue: string
  episode: IEpisodeModel
  sceneStartFrames: Map<string, number>
  selectedNodeId: string | null
  selectedLocalFrameIdx: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedLocalFrameIdx': [idx: number]
  assetImported: [asset: ProjectAsset]
  playScene: [sceneId: string]
  openPicker: [kind: 'backgrounds' | 'spines' | 'stills' | 'bgms' | 'ses']
}>()

const activeTab = ref<'frame' | 'scene'>('frame')
let voicePreview: HTMLAudioElement | undefined
onBeforeUnmount(() => voicePreview?.pause())
const aiVoiceNotice = ref('')

async function importLocalVoice() {
  if (!window.siriusStudio) {
    aiVoiceNotice.value = '请在 Electron 桌面端导入本地语音文件'
    return
  }
  try {
    const res = await window.siriusStudio.importLocalAsset('voice')
    if (!res) return
    emit('assetImported', res.asset)
    mutateFrame((f) => { f.VoiceFileName = res.assetId })
    aiVoiceNotice.value = `已绑定 ${res.asset.originalName}`
  } catch (err) {
    aiVoiceNotice.value = `导入失败：${err instanceof Error ? err.message : String(err)}`
  }
}

function playCurrentVoice(voiceId?: string) {
  if (!voiceId) return
  const url = voiceId.startsWith('asset_')
    ? `${props.assetBase}/voice/${encodeURIComponent(voiceId)}.mp3`
    : `${ADV_RESOURCE_CDN}/voice/${props.episode.EpisodeId}/${encodeURIComponent(voiceId)}.mp3`
  voicePreview?.pause()
  const audio = voicePreview = new Audio(url)
  audio.volume = 0.7
  void audio.play().catch(() => {
    aiVoiceNotice.value = `试听失败：未找到语音文件 ${voiceId}`
  })
}



const doc = computed<StoryGraphDoc>(() => parseStoryGraph(props.modelValue))
const aliasMap = computed(() => parseAliasMap(doc.value.preamble))
const sceneFramesMap = computed(() => getSceneVisualFrames(doc.value, props.sceneStartFrames))

const selectedNode = computed(
  () => doc.value.nodes.find((n) => n.id === props.selectedNodeId) ?? doc.value.nodes[0],
)

const sceneFrames = computed(() =>
  selectedNode.value ? sceneFramesMap.value.get(selectedNode.value.id) ?? [] : [],
)

const selectedFrameItem = computed(() => {
  if (sceneFrames.value.length === 0) return undefined
  const idx = Math.max(0, Math.min(props.selectedLocalFrameIdx, sceneFrames.value.length - 1))
  return sceneFrames.value[idx]
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

function mutateFrame(mutator: (frame: IEpisodeDetail) => void) {
  if (!selectedNode.value) return
  const list = sceneFrames.value.map((x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail)
  const idx = Math.max(0, Math.min(props.selectedLocalFrameIdx, list.length - 1))
  if (!list[idx]) return
  mutator(list[idx])
  const nextDoc = cloneDoc()
  const target = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)
  if (!target) return
  target.body = framesToSceneDsl(list, aliasMap.value)
  commitDoc(nextDoc)
}

function appendFrame() {
  if (!selectedNode.value) return
  const list = sceneFrames.value.map((x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail)
  const last = list[list.length - 1]
  list.push({
    Id: list.length + 1,
    EpisodeMasterId: props.episode.EpisodeId,
    Order: 1 as any,
    GroupOrder: (last?.GroupOrder ?? 0) + 1,
    SpeakerName: last?.SpeakerName || '心菜',
    Phrase: '新的一句台词……',
    FontSize: 2 as any,
    WindowEffect: last?.WindowEffect,
    CharacterMotions: last ? JSON.parse(JSON.stringify(last.CharacterMotions)) : [],
  })
  const nextDoc = cloneDoc()
  const target = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)
  if (!target) return
  target.body = framesToSceneDsl(list, aliasMap.value)
  emit('update:selectedLocalFrameIdx', list.length - 1)
  commitDoc(nextDoc)
}

function deleteFrame() {
  if (!selectedNode.value || sceneFrames.value.length <= 1) return
  const list = sceneFrames.value.map((x) => JSON.parse(JSON.stringify(x.frame)) as IEpisodeDetail)
  const idx = Math.max(0, Math.min(props.selectedLocalFrameIdx, list.length - 1))
  list.splice(idx, 1)
  emit('update:selectedLocalFrameIdx', Math.max(0, idx - 1))
  const nextDoc = cloneDoc()
  const target = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)
  if (!target) return
  target.body = framesToSceneDsl(list, aliasMap.value)
  commitDoc(nextDoc)
}

function addCharacter() {
  mutateFrame((f) => {
    const used = new Set(f.CharacterMotions.map((c) => c.slotNumber))
    let slot = 1
    while (used.has(slot)) slot++
    f.CharacterMotions.push({
      slotNumber: slot,
      SpineId: slot === 1 ? 10101 : 10102,
      CharacterPosition: (slot === 1 ? 3 : slot === 2 ? 4 : 2) as any,
      CharacterAppearanceType: 0 as any,
      CharacterLayerType: 0 as any,
      SpineSize: 1 as any,
      FacialExpressionMasterId: 1,
      BodyMotionMasterId: 1,
    })
  })
}

function removeCharacter(idx: number) {
  mutateFrame((f) => {
    f.CharacterMotions.splice(idx, 1)
  })
}

function updateSceneField(field: 'title' | 'next', value: string) {
  if (!selectedNode.value) return
  const nextDoc = cloneDoc()
  const target = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)
  if (!target) return
  if (field === 'next') target.next = value || undefined
  else target.title = value
  commitDoc(nextDoc)
}

function addChoice() {
  if (!selectedNode.value) return
  const id = selectedNode.value.id
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === id)
  if (!node) return
  const fallback = nextDoc.nodes.find((n) => n.id !== id)?.id ?? id
  node.choices.push({ label: `选项 ${node.choices.length + 1}`, target: fallback })
  commitDoc(nextDoc)
}

function updateChoice(idx: number, patch: { label?: string; target?: string }) {
  if (!selectedNode.value) return
  const nextDoc = cloneDoc()
  const choice = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)?.choices[idx]
  if (!choice) return
  if (patch.label !== undefined) choice.label = patch.label
  if (patch.target !== undefined) choice.target = patch.target
  commitDoc(nextDoc)
}

function removeChoice(idx: number) {
  if (!selectedNode.value) return
  const nextDoc = cloneDoc()
  const node = nextDoc.nodes.find((n) => n.id === selectedNode.value!.id)
  if (!node) return
  node.choices.splice(idx, 1)
  commitDoc(nextDoc)
}
</script>

<template>
  <div class="inspector-shell">
    <div class="insp-header">
      <div class="insp-tabs">
        <button
          type="button"
          class="insp-tab"
          :class="{ active: activeTab === 'frame' }"
          @click="activeTab = 'frame'"
        >
          <Film :size="12" />
          <span>帧属性</span>
        </button>
        <button
          type="button"
          class="insp-tab"
          :class="{ active: activeTab === 'scene' }"
          @click="activeTab = 'scene'"
        >
          <GitBranch :size="12" />
          <span>场景与分支</span>
        </button>
      </div>
      <div v-if="selectedNode" class="insp-head-actions">
        <button class="mini-btn" type="button" title="从该场景播放" @click="emit('playScene', selectedNode.id)">
          <Play :size="11" />
        </button>
        <button class="mini-btn" type="button" title="追加一帧" @click="appendFrame">
          <Plus :size="11" />
        </button>
      </div>
    </div>

    <div v-if="!selectedNode" class="empty-insp">
      请在下方分镜画布中选中一个场景或帧
    </div>

    <!-- Tab 1: Frame Visual Properties -->
    <div v-else-if="activeTab === 'frame' && selectedFrameItem" class="insp-scroll">
      <div class="section-card">
        <div class="section-head">
          <span>对话内容 · 第 {{ selectedFrameItem.globalIdx !== null ? selectedFrameItem.globalIdx + 1 : selectedFrameItem.localIdx + 1 }} 帧</span>
          <button
            class="icon-del"
            type="button"
            title="删除此帧"
            :disabled="sceneFrames.length <= 1"
            @click="deleteFrame"
          >
            <Trash2 :size="11" />
          </button>
        </div>
        <div class="field-row">
          <input
            :value="selectedFrameItem.frame.SpeakerName || ''"
            class="f-input"
            placeholder="说话人（留空=旁白）"
            @input="mutateFrame((f) => { f.SpeakerName = ($event.target as HTMLInputElement).value || undefined })"
          />
          <select
            :value="selectedFrameItem.frame.FontSize || 2"
            class="f-select narrow"
            @change="mutateFrame((f) => { f.FontSize = Number(($event.target as HTMLSelectElement).value) as any })"
          >
            <option :value="1">小字</option>
            <option :value="2">标准</option>
            <option :value="3">大字</option>
          </select>
        </div>
        <textarea
          :value="selectedFrameItem.frame.Phrase || ''"
          class="f-textarea"
          rows="3"
          placeholder="输入台词或旁白…"
          @input="mutateFrame((f) => { f.Phrase = ($event.target as HTMLTextAreaElement).value })"
        />
      </div>

      <div class="section-card">
        <div class="section-head">
          <span><ImageIcon :size="11" /> 舞台与背景</span>
          <button class="mini-btn" type="button" @click="emit('openPicker', 'backgrounds')">选图</button>
        </div>
        <div v-if="selectedFrameItem.frame.BackgroundImageFileName && !selectedFrameItem.frame.BackgroundImageFileName.startsWith('asset_')" class="bg-preview-box">
          <img
            :src="`${ADV_RESOURCE_CDN}/background/${encodeURIComponent(selectedFrameItem.frame.BackgroundImageFileName)}.png`"
            class="bg-preview-img"
          />
          <span class="bg-preview-tag">BG {{ selectedFrameItem.frame.BackgroundImageFileName }}</span>
        </div>
        <div class="field-grid">
          <label>背景 ID</label>
          <input
            :value="selectedFrameItem.frame.BackgroundImageFileName || ''"
            class="f-input"
            placeholder="如 1000 或拖入背景"
            @input="mutateFrame((f) => { f.BackgroundImageFileName = ($event.target as HTMLInputElement).value.trim() || undefined })"
          />
          <label>转场</label>
          <select
            :value="selectedFrameItem.frame.BackgroundImageFileFadeType || 0"
            class="f-select"
            @change="mutateFrame((f) => { const v = Number(($event.target as HTMLSelectElement).value); f.BackgroundImageFileFadeType = (v || undefined) as any })"
          >
            <option :value="0">无</option>
            <option :value="4">交叉淡入</option>
            <option :value="1">黑场</option>
            <option :value="2">白场</option>
            <option :value="3">时间流逝</option>
          </select>
          <label>镜头</label>
          <select
            :value="selectedFrameItem.frame.SceneCameraMasterId || 0"
            class="f-select"
            @change="mutateFrame((f) => { const v = Number(($event.target as HTMLSelectElement).value); f.SceneCameraMasterId = v || undefined })"
          >
            <option :value="0">默认镜头</option>
            <option v-for="c in 6" :key="c" :value="c">镜头 #{{ c }}</option>
          </select>
          <label><Sparkles :size="10" /> 滤镜</label>
          <select
            :value="selectedFrameItem.frame.WindowEffect || 0"
            class="f-select"
            @change="mutateFrame((f) => { const v = Number(($event.target as HTMLSelectElement).value); f.WindowEffect = (v || undefined) as any })"
          >
            <option :value="0">无</option>
            <option :value="1">怀旧 (Sepia)</option>
            <option :value="2">柔白 (Blur)</option>
          </select>
        </div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <span><User :size="11" /> 场上角色 ({{ selectedFrameItem.frame.CharacterMotions.length }})</span>
          <button class="mini-btn" type="button" @click="addCharacter">
            <Plus :size="11" /> 加角色
          </button>
        </div>
        <div v-if="selectedFrameItem.frame.CharacterMotions.length === 0" class="muted-hint">
          暂无角色，点击「加角色」或从左侧拖入 Spine
        </div>
        <div v-for="(c, cIdx) in selectedFrameItem.frame.CharacterMotions" :key="cIdx" class="char-card">
          <div class="char-card-top">
            <span class="slot-pill">槽位 {{ c.slotNumber }}</span>
            <select
              :value="c.SpineId"
              class="f-select flex1"
              @change="mutateFrame((f) => { f.CharacterMotions[cIdx].SpineId = Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="(name, id) in BUILTIN_CAST" :key="id" :value="Number(id)">
                {{ name }} ({{ id }})
              </option>
              <option v-if="!BUILTIN_CAST[c.SpineId]" :value="c.SpineId">Spine {{ c.SpineId }}</option>
            </select>
            <button class="icon-del" type="button" @click="removeCharacter(cIdx)">×</button>
          </div>
          <div class="char-card-attrs">
            <select
              :value="c.CharacterPosition"
              class="f-select"
              title="站位"
              @change="mutateFrame((f) => { f.CharacterMotions[cIdx].CharacterPosition = Number(($event.target as HTMLSelectElement).value) as any })"
            >
              <option v-for="(lbl, id) in POS_LABELS" :key="id" :value="Number(id)">{{ lbl }}</option>
            </select>
            <select
              :value="c.FacialExpressionMasterId || 1"
              class="f-select"
              title="表情"
              @change="mutateFrame((f) => { f.CharacterMotions[cIdx].FacialExpressionMasterId = Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="(lbl, id) in EXPR_LABELS" :key="id" :value="Number(id)">{{ lbl }}</option>
            </select>
            <select
              :value="c.BodyMotionMasterId || 1"
              class="f-select"
              title="动作"
              @change="mutateFrame((f) => { f.CharacterMotions[cIdx].BodyMotionMasterId = Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="(lbl, id) in BODY_LABELS" :key="id" :value="Number(id)">{{ lbl }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <span><Music :size="11" /> 音频 (BGM / SE)</span>
          <button class="mini-btn" type="button" @click="emit('openPicker', 'bgms')">选音乐</button>
        </div>
        <div class="field-grid">
          <label>BGM</label>
          <input
            :value="selectedFrameItem.frame.BgmFileName === '999' ? 'stop' : (selectedFrameItem.frame.BgmFileName || '')"
            class="f-input"
            placeholder="BGM ID 或 stop"
            @input="mutateFrame((f) => { const v = ($event.target as HTMLInputElement).value.trim(); f.BgmFileName = v === 'stop' ? '999' : (v || undefined) })"
          />
          <label>SE 音效</label>
          <input
            :value="selectedFrameItem.frame.SeFileName || ''"
            class="f-input"
            placeholder="SE ID"
            @input="mutateFrame((f) => { f.SeFileName = ($event.target as HTMLInputElement).value.trim() || undefined })"
          />
        </div>
      </div>

      <!-- Vocal / Voice Audio + AI TTS Placeholder -->
      <div class="section-card">
        <div class="section-head">
          <span><Mic :size="11" /> 语音 (Vocal)</span>
          <div class="insp-head-actions">
            <button
              v-if="selectedFrameItem.frame.VoiceFileName"
              class="mini-btn"
              type="button"
              title="试听当前语音"
              @click="playCurrentVoice(selectedFrameItem.frame.VoiceFileName)"
            >
              <Play :size="10" />
            </button>
            <button class="mini-btn" type="button" title="导入本地语音 (.mp3/.wav)" @click="importLocalVoice">
              <Upload :size="10" /> 导入
            </button>
          </div>
        </div>
        <div class="field-grid">
          <label>语音 ID</label>
          <input
            :value="selectedFrameItem.frame.VoiceFileName || ''"
            class="f-input"
            placeholder="官方语音 ID 或本地素材"
            list="project-vocals"
            @input="mutateFrame((f) => { f.VoiceFileName = ($event.target as HTMLInputElement).value.trim() || undefined })"
          />
        </div>

        <datalist id="project-vocals">
          <option v-for="voice in localVoices" :key="voice.id" :value="voice.id">{{ voice.originalName }}</option>
        </datalist>
        <div v-if="aiVoiceNotice" class="tts-notice">{{ aiVoiceNotice }}</div>
      </div>
    </div>

    <!-- Tab 2: Scene & Branch Relationships -->
    <div v-else class="insp-scroll">
      <div class="section-card">
        <div class="section-head">
          <span>场景信息 (#{{ selectedNode.id }})</span>
        </div>
        <div class="field-grid">
          <label>场景名称</label>
          <input
            :value="selectedNode.title"
            class="f-input"
            placeholder="场景标题"
            @input="updateSceneField('title', ($event.target as HTMLInputElement).value)"
          />
          <label>顺序流向</label>
          <select
            :value="selectedNode.next || ''"
            class="f-select"
            @change="updateSceneField('next', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">（终点 / 结局）</option>
            <option
              v-for="opt in doc.nodes.filter((n) => n.id !== selectedNode!.id)"
              :key="opt.id"
              :value="opt.id"
            >
              → {{ opt.title }} (#{{ opt.id }})
            </option>
          </select>
        </div>
      </div>

      <div class="section-card">
        <div class="section-head">
          <span><GitBranch :size="11" /> 分支选项 ({{ selectedNode.choices.length }})</span>
          <button class="mini-btn" type="button" @click="addChoice">
            <Plus :size="11" /> 加分支
          </button>
        </div>
        <div v-if="selectedNode.choices.length === 0" class="muted-hint">
          暂无分支选项，添加后可连接不同后续场景
        </div>
        <div v-for="(c, cIdx) in selectedNode.choices" :key="cIdx" class="char-card">
          <div class="char-card-top">
            <input
              :value="c.label"
              class="f-input flex1"
              placeholder="选项文案"
              @input="updateChoice(cIdx, { label: ($event.target as HTMLInputElement).value })"
            />
            <button class="icon-del" type="button" @click="removeChoice(cIdx)">×</button>
          </div>
          <select
            :value="c.target"
            class="f-select"
            @change="updateChoice(cIdx, { target: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="opt in doc.nodes" :key="opt.id" :value="opt.id">
              → {{ opt.title }} (#{{ opt.id }})
            </option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #111114;
  overflow: hidden;
}
.insp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 8px;
  background: #18181b;
  border-bottom: 1px solid #27272a;
  flex-shrink: 0;
}
.insp-tabs,
.insp-head-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.insp-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.insp-tab.active {
  background: #27272a;
  color: #f4f4f5;
  font-weight: 600;
}
.mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  height: 22px;
  padding: 0 7px;
  border-radius: 5px;
  border: 1px solid #303036;
  background: #222228;
  color: #e4e4e7;
  cursor: pointer;
}
.mini-btn:hover {
  background: #2f2f37;
}
.empty-insp {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #71717a;
}
.insp-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: #16161b;
  border: 1px solid #24242c;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: #d4d4d8;
}
.section-head span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.field-row {
  display: flex;
  gap: 6px;
}
.field-grid {
  display: grid;
  grid-template-columns: 58px 1fr;
  align-items: center;
  gap: 6px;
}
.field-grid label {
  font-size: 11px;
  color: #a1a1aa;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.f-input,
.f-select,
.f-textarea {
  width: 100%;
  font-size: 11px;
  padding: 4px 7px;
  border-radius: 5px;
  border: 1px solid #303036;
  background: #09090b;
  color: #f4f4f5;
  font-family: inherit;
}
.f-input:focus,
.f-select:focus,
.f-textarea:focus {
  outline: none;
  border-color: #ec4899;
}
.f-select.narrow {
  width: 72px;
  flex-shrink: 0;
}
.f-textarea {
  resize: vertical;
  line-height: 1.45;
}
.bg-preview-box {
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  height: 76px;
  background: #09090b;
}
.bg-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.bg-preview-tag {
  position: absolute;
  left: 6px;
  bottom: 5px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(9, 9, 11, 0.78);
  color: #7dd3fc;
}
.char-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-radius: 6px;
  background: #0c0c10;
  border: 1px solid #23232b;
}
.char-card-top {
  display: flex;
  align-items: center;
  gap: 5px;
}
.char-card-attrs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.slot-pill {
  font-size: 10px;
  color: #f472b6;
  white-space: nowrap;
}
.flex1 {
  flex: 1;
  min-width: 0;
}
.icon-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: #71717a;
  cursor: pointer;
}
.icon-del:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.35);
  color: #fca5a5;
}
.icon-del:disabled {
  opacity: 0.35;
  cursor: default;
}
.muted-hint {
  font-size: 11px;
  color: #71717a;
  text-align: center;
  padding: 6px 0;
}
.tts-placeholder {
  margin-top: 4px;
  padding: 7px;
  border-radius: 6px;
  border: 1px dashed #353542;
  background: rgba(168, 85, 247, 0.05);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 600;
  color: #d8b4fe;
}
.tts-head span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tts-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.2);
  color: #e9d5ff;
}
.tts-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 25px;
  border-radius: 5px;
  border: 1px solid rgba(168, 85, 247, 0.35);
  background: rgba(168, 85, 247, 0.14);
  color: #e9d5ff;
  font-size: 11px;
  cursor: pointer;
}
.tts-btn:hover {
  background: rgba(168, 85, 247, 0.24);
}
.tts-notice {
  font-size: 10px;
  color: #a1a1aa;
  line-height: 1.35;
}
</style>
