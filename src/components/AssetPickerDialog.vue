<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Eye,
  Image as ImageIcon,
  Music,
  Play,
  Plus,
  Search,
  Square,
  User,
  Volume2,
  X,
} from 'lucide-vue-next'
import { BUILTIN_CAST } from '../dsl/sceneFrames'
import { ADV_RESOURCE_CDN, type ResourceCatalog } from '../services/resourceCatalog'

export type PickerAssetKind = 'backgrounds' | 'spines' | 'stills' | 'bgms' | 'ses'

const props = defineProps<{
  open: boolean
  initialKind: PickerAssetKind
  catalog: ResourceCatalog
  assetBase?: string
  thumbBase?: string
  spineThumbs?: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  select: [payload: { kind: PickerAssetKind; id: string }]
  previewSpine: [id: string]
  importLocal: [kind: 'background' | 'bgm' | 'se']
}>()

const kind = ref<PickerAssetKind>(props.initialKind)
const query = ref('')
const visibleLimit = ref(80)
const bodyRef = ref<HTMLElement | null>(null)
const playingKey = ref<string | null>(null)
let audio: HTMLAudioElement | null = null

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      kind.value = props.initialKind
      query.value = ''
      visibleLimit.value = 80
      if (bodyRef.value) bodyRef.value.scrollTop = 0
    } else {
      stopAudio()
    }
  },
)

watch([kind, query], () => {
  visibleLimit.value = 80
  if (bodyRef.value) bodyRef.value.scrollTop = 0
})

const matchedItems = computed(() => {
  const list = props.catalog[kind.value] || []
  const q = query.value.trim().toLowerCase()
  return q
    ? list.filter((id) => {
        const name = kind.value === 'spines' ? BUILTIN_CAST[Number(id)] || '' : ''
        return id.toLowerCase().includes(q) || name.toLowerCase().includes(q)
      })
    : list
})

const items = computed(() => matchedItems.value.slice(0, visibleLimit.value))
const hasMore = computed(() => visibleLimit.value < matchedItems.value.length)

function loadMore() {
  if (!hasMore.value) return
  visibleLimit.value = Math.min(matchedItems.value.length, visibleLimit.value + 80)
}

function onBodyScroll(e: Event) {
  const el = e.target as HTMLElement | null
  if (!el || !hasMore.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 280) {
    loadMore()
  }
}

function stopAudio() {
  audio?.pause()
  audio = null
  playingKey.value = null
}

function toggleAudio(id: string) {
  const key = `${kind.value}:${id}`
  if (playingKey.value === key) {
    stopAudio()
    return
  }
  stopAudio()
  const folder = kind.value === 'bgms' ? 'bgm' : 'se'
  const url = id.startsWith('asset_')
    ? `${props.assetBase}/${folder}/${encodeURIComponent(id)}.mp3`
    : `${ADV_RESOURCE_CDN}/${folder}/${encodeURIComponent(id)}.mp3`
  audio = new Audio(url)
  audio.volume = 0.5
  audio.onended = () => {
    playingKey.value = null
  }
  playingKey.value = key
  void audio.play().catch(() => {
    playingKey.value = null
  })
}

function thumbUrl(id: string): string {
  const folder = kind.value === 'stills' ? 'still' : 'background'
  if (id.startsWith('asset_')) {
    return `${props.assetBase}/${folder}/${encodeURIComponent(id)}.png`
  }
  if (props.thumbBase) {
    return `${props.thumbBase}/${folder}/${encodeURIComponent(id)}.png`
  }
  return `${ADV_RESOURCE_CDN}/${folder}/${encodeURIComponent(id)}.png`
}

function onImgError(e: Event, id: string) {
  const img = e.target as HTMLImageElement | null
  if (!img || img.dataset.fallbackApplied || id.startsWith('asset_')) return
  img.dataset.fallbackApplied = '1'
  const folder = kind.value === 'stills' ? 'still' : 'background'
  img.src = `${ADV_RESOURCE_CDN}/${folder}/${encodeURIComponent(id)}.png`
}

function triggerImport() {
  const map: Partial<Record<PickerAssetKind, 'background' | 'bgm' | 'se'>> = {
    backgrounds: 'background',
    bgms: 'bgm',
    ses: 'se',
  }
  const k = map[kind.value]
  if (k) emit('importLocal', k)
}

onBeforeUnmount(stopAudio)
</script>

<template>
  <div v-if="open" class="picker-backdrop" @click.self="emit('close')">
    <div class="picker-dialog">
      <!-- Header -->
      <div class="picker-head">
        <div class="picker-tabs">
          <button type="button" :class="{ active: kind === 'backgrounds' }" @click="kind = 'backgrounds'">
            <ImageIcon :size="13" /> 背景 ({{ catalog.backgrounds.length }})
          </button>
          <button type="button" :class="{ active: kind === 'spines' }" @click="kind = 'spines'">
            <User :size="13" /> 角色 Spine ({{ catalog.spines.length }})
          </button>
          <button type="button" :class="{ active: kind === 'stills' }" @click="kind = 'stills'">
            <ImageIcon :size="13" /> CG Still ({{ catalog.stills.length }})
          </button>
          <button type="button" :class="{ active: kind === 'bgms' }" @click="kind = 'bgms'">
            <Music :size="13" /> BGM ({{ catalog.bgms.length }})
          </button>
          <button type="button" :class="{ active: kind === 'ses' }" @click="kind = 'ses'">
            <Volume2 :size="13" /> SE ({{ catalog.ses.length }})
          </button>
        </div>
        <button class="close-btn" type="button" @click="emit('close')">
          <X :size="15" />
        </button>
      </div>

      <!-- Search & Import Bar -->
      <div class="picker-bar">
        <div class="search-box">
          <Search :size="13" class="search-ico" />
          <input v-model="query" type="text" placeholder="输入素材 ID 或角色名筛选…" />
        </div>
        <button
          v-if="kind === 'backgrounds' || kind === 'bgms' || kind === 'ses'"
          class="import-btn"
          type="button"
          @click="triggerImport"
        >
          <Plus :size="13" /> 导入本地{{ kind === 'backgrounds' ? '背景图' : kind === 'bgms' ? 'BGM' : '音效' }}
        </button>
      </div>

      <!-- Visual Grid -->
      <div ref="bodyRef" class="picker-body" @scroll.passive="onBodyScroll">
        <!-- Image Grid for Backgrounds & Stills -->
        <div v-if="kind === 'backgrounds' || kind === 'stills'" class="img-grid">
          <button
            v-for="id in items"
            :key="id"
            type="button"
            class="img-card"
            @click="emit('select', { kind, id }); emit('close')"
          >
            <div class="img-wrap">
              <img :src="thumbUrl(id)" loading="lazy" @error="onImgError($event, id)" />
            </div>
            <span class="card-label">{{ id }}</span>
          </button>
        </div>

        <!-- Character Spine Grid -->
        <div v-else-if="kind === 'spines'" class="spine-grid">
          <div
            v-for="id in items"
            :key="id"
            class="spine-card"
            @click="emit('select', { kind, id }); emit('close')"
          >
            <div class="spine-avatar">
              <img v-if="props.spineThumbs?.[id]" :src="props.spineThumbs[id]" loading="lazy" :alt="id" />
              <User v-else :size="18" class="avatar-ph" />
            </div>
            <div class="spine-info">
              <span class="spine-name">{{ BUILTIN_CAST[Number(id)] || '角色 Spine' }}</span>
              <span class="spine-id">#{{ id }}</span>
            </div>
            <button
              class="preview-eye"
              type="button"
              title="预览 Spine 动画"
              @click.stop="emit('previewSpine', id)"
            >
              <Eye :size="13" />
            </button>
          </div>
        </div>

        <!-- Audio Grid for BGMs & SEs -->
        <div v-else class="audio-grid">
          <div
            v-for="id in items"
            :key="id"
            class="audio-card"
            @click="emit('select', { kind, id }); emit('close')"
          >
            <button
              class="play-circle"
              type="button"
              :title="playingKey === `${kind}:${id}` ? '停止' : '试听'"
              @click.stop="toggleAudio(id)"
            >
              <Square v-if="playingKey === `${kind}:${id}`" :size="11" />
              <Play v-else :size="11" />
            </button>
            <span class="audio-id">{{ id }}</span>
          </div>
        </div>

        <div v-if="matchedItems.length > 0" class="picker-load-bar">
          <span class="load-meta">已显示 {{ items.length }} / {{ matchedItems.length }} 项</span>
          <button v-if="hasMore" class="load-more-btn" type="button" @click="loadMore">
            加载更多
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.picker-dialog {
  width: 900px;
  max-width: 92vw;
  height: 620px;
  max-height: 86vh;
  background: #141418;
  border: 1px solid #2e2e38;
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #1a1a20;
  border-bottom: 1px solid #26262f;
}
.picker-tabs {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.picker-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 7px;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.picker-tabs button:hover {
  background: #25252e;
  color: #f4f4f5;
}
.picker-tabs button.active {
  background: #db2777;
  color: #fff;
  font-weight: 600;
}
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.close-btn:hover {
  background: #272731;
  color: #fff;
}

.picker-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #22222b;
  background: #121216;
}
.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 32px;
  border-radius: 7px;
  border: 1px solid #2d2d36;
  background: #09090b;
}
.search-ico {
  color: #71717a;
}
.search-box input {
  flex: 1;
  border: 0;
  background: transparent;
  color: #f4f4f5;
  font-size: 12px;
}
.search-box input:focus {
  outline: none;
}
.import-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  border: 1px solid #30303a;
  background: #22222a;
  color: #f4f4f5;
  font-size: 12px;
  cursor: pointer;
}
.import-btn:hover {
  background: #2e2e39;
}

.picker-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}
.img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.img-card {
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: 9px;
  border: 1px solid #26262f;
  background: #1a1a20;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s, transform 0.12s;
}
.img-card:hover {
  border-color: #ec4899;
  transform: translateY(-2px);
}
.img-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #09090b;
  overflow: hidden;
}
.img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.card-label {
  padding: 6px 8px;
  font-size: 11px;
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.audio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 8px;
}
.spine-card,
.audio-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #26262f;
  background: #191920;
  cursor: pointer;
}
.spine-avatar {
  width: 48px;
  height: 48px;
  border-radius: 7px;
  border: 1px solid #2c2c36;
  background: radial-gradient(circle at 50% 35%, #242430, #111116);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.spine-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar-ph {
  color: #52525b;
}
.picker-load-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 0 6px;
}
.load-meta {
  font-size: 11px;
  color: #71717a;
}
.load-more-btn {
  height: 26px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid #2e2e38;
  background: #1a1a22;
  color: #e4e4e7;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.load-more-btn:hover {
  border-color: #ec4899;
  color: #f472b6;
}
.spine-card:hover,
.audio-card:hover {
  border-color: #ec4899;
  background: #21212a;
}
.spine-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.spine-name {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
}
.spine-id {
  font-size: 11px;
  color: #7dd3fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.preview-eye,
.play-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid #30303a;
  background: #101014;
  color: #38bdf8;
  cursor: pointer;
  flex-shrink: 0;
}
.audio-id {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
