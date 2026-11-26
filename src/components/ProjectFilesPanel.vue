<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  Copy,
  FolderOpen,
  Image as ImageIcon,
  Mic,
  Music,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
  Volume2,
} from 'lucide-vue-next'
import type { ProjectAsset, ProjectAssetKind } from '../shared/project'

const props = defineProps<{
  assets: ProjectAsset[]
  assetBase: string
  usedAssetIds: Set<string>
  isElectron: boolean
}>()

const emit = defineEmits<{
  (e: 'import', kind: ProjectAssetKind): void
  (e: 'remove', asset: ProjectAsset): void
  (e: 'reveal', asset?: ProjectAsset): void
  (e: 'copyId', id: string): void
}>()

type FilterKind = 'all' | ProjectAssetKind
const activeKind = ref<FilterKind>('all')
const query = ref('')
const playingKey = ref<string | null>(null)
const pendingDeleteKey = ref<string | null>(null)
let previewAudio: HTMLAudioElement | null = null

const KIND_META: Record<ProjectAssetKind, { label: string; ext: string }> = {
  background: { label: '背景', ext: 'png' },
  bgm: { label: 'BGM', ext: 'mp3' },
  se: { label: 'SE 音效', ext: 'mp3' },
  voice: { label: '语音 Vocal', ext: 'mp3' },
}

const counts = computed(() => {
  const map: Record<FilterKind, number> = {
    all: props.assets.length,
    background: 0,
    bgm: 0,
    se: 0,
    voice: 0,
  }
  for (const a of props.assets) map[a.kind] += 1
  return map
})

const filteredAssets = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.assets.filter((a) => {
    if (activeKind.value !== 'all' && a.kind !== activeKind.value) return false
    if (!q) return true
    return (
      a.originalName.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.file.toLowerCase().includes(q)
    )
  })
})

function assetUrl(asset: ProjectAsset): string {
  const base = props.assetBase.replace(/\/+$/, '')
  const ext = KIND_META[asset.kind].ext
  return `${base}/${asset.kind}/${encodeURIComponent(asset.id)}.${ext}`
}

function assetKey(asset: ProjectAsset): string {
  return `${asset.kind}:${asset.id}`
}

function toggleAudio(asset: ProjectAsset) {
  const key = assetKey(asset)
  if (playingKey.value === key) {
    previewAudio?.pause()
    playingKey.value = null
    return
  }
  previewAudio?.pause()
  previewAudio = new Audio(assetUrl(asset))
  previewAudio.volume = 0.55
  previewAudio.onended = () => { playingKey.value = null }
  playingKey.value = key
  void previewAudio.play().catch(() => { playingKey.value = null })
}

function requestDelete(asset: ProjectAsset) {
  const key = assetKey(asset)
  if (pendingDeleteKey.value === key) {
    if (playingKey.value === key) {
      previewAudio?.pause()
      playingKey.value = null
    }
    pendingDeleteKey.value = null
    emit('remove', asset)
  } else {
    pendingDeleteKey.value = key
  }
}

onBeforeUnmount(() => {
  previewAudio?.pause()
  previewAudio = null
})
</script>

<template>
  <div class="fm-panel">
    <div class="fm-toolbar">
      <div class="fm-tabs">
        <button
          v-for="tab in (['all', 'background', 'bgm', 'se', 'voice'] as FilterKind[])"
          :key="tab"
          type="button"
          class="fm-tab"
          :class="{ active: activeKind === tab }"
          @click="activeKind = tab"
        >
          <span>{{ tab === 'all' ? '全部' : KIND_META[tab].label }}</span>
          <span class="tab-cnt">{{ counts[tab] }}</span>
        </button>
      </div>

      <div class="fm-actions">
        <div class="fm-import-group">
          <button class="fm-chip-btn" type="button" title="导入本地背景图" @click="emit('import', 'background')">
            <Plus :size="11" /><ImageIcon :size="11" /><span>背景</span>
          </button>
          <button class="fm-chip-btn" type="button" title="导入本地 BGM" @click="emit('import', 'bgm')">
            <Plus :size="11" /><Music :size="11" /><span>BGM</span>
          </button>
          <button class="fm-chip-btn" type="button" title="导入本地 SE 音效" @click="emit('import', 'se')">
            <Plus :size="11" /><Volume2 :size="11" /><span>SE</span>
          </button>
          <button class="fm-chip-btn" type="button" title="导入本地语音 Vocal" @click="emit('import', 'voice')">
            <Plus :size="11" /><Mic :size="11" /><span>语音</span>
          </button>
        </div>

        <div class="fm-search-wrap">
          <Search :size="12" class="search-ico" />
          <input v-model="query" class="fm-search" type="text" placeholder="搜索文件名或素材 ID…" />
        </div>

        <button
          v-if="isElectron"
          class="fm-btn"
          type="button"
          title="在系统文件管理器中打开项目目录"
          @click="emit('reveal')"
        >
          <FolderOpen :size="12" />
          <span>打开目录</span>
        </button>
      </div>
    </div>

    <div class="fm-list">
      <div v-if="filteredAssets.length === 0" class="fm-empty">
        <FolderOpen :size="22" class="empty-ico" />
        <p>{{ assets.length === 0 ? '当前项目还没有导入本地资源文件' : '没有匹配的素材文件' }}</p>
        <small>点击右上角导入按钮添加本地图片或音频，导入后会自动归档至项目的 assets/ 目录。</small>
      </div>

      <div v-else class="fm-grid">
        <div v-for="asset in filteredAssets" :key="assetKey(asset)" class="fm-row">
          <div class="fm-preview">
            <img
              v-if="asset.kind === 'background'"
              :src="assetUrl(asset)"
              loading="lazy"
              class="bg-thumb"
              :alt="asset.originalName"
            />
            <button
              v-else
              class="audio-play-btn"
              :class="{ playing: playingKey === assetKey(asset) }"
              type="button"
              title="试听"
              @click="toggleAudio(asset)"
            >
              <Square v-if="playingKey === assetKey(asset)" :size="11" />
              <Play v-else :size="11" />
            </button>
          </div>

          <div class="fm-meta">
            <div class="fm-name-line">
              <strong class="fm-orig" :title="asset.originalName">{{ asset.originalName }}</strong>
              <span class="kind-pill">{{ KIND_META[asset.kind].label }}</span>
              <span class="use-pill" :class="{ used: usedAssetIds.has(asset.id) }">
                {{ usedAssetIds.has(asset.id) ? '已引用' : '未引用' }}
              </span>
            </div>
            <div class="fm-sub-line">
              <code class="fm-id">{{ asset.id }}</code>
              <span>·</span>
              <span class="fm-rel" :title="asset.file">{{ asset.file }}</span>
            </div>
          </div>

          <div class="fm-row-actions">
            <button class="fm-ico-btn" type="button" title="复制素材 ID" @click="emit('copyId', asset.id)">
              <Copy :size="12" />
            </button>
            <button
              v-if="isElectron"
              class="fm-ico-btn"
              type="button"
              title="在文件夹中显示"
              @click="emit('reveal', asset)"
            >
              <FolderOpen :size="12" />
            </button>
            <button
              class="fm-ico-btn danger"
              :class="{ confirm: pendingDeleteKey === assetKey(asset) }"
              type="button"
              :title="pendingDeleteKey === assetKey(asset) ? '再次点击确认删除' : '删除此资源文件'"
              @click="requestDelete(asset)"
              @mouseleave="pendingDeleteKey = null"
            >
              <Trash2 :size="12" />
              <span v-if="pendingDeleteKey === assetKey(asset)" class="confirm-txt">
                {{ usedAssetIds.has(asset.id) ? '仍要删除？' : '确认' }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fm-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0d0d11;
  color: #f4f4f5;
  overflow: hidden;
}
.fm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: #121216;
  border-bottom: 1px solid #232329;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.fm-tabs {
  display: inline-flex;
  gap: 3px;
  flex-wrap: wrap;
}
.fm-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: #a1a1aa;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.fm-tab:hover {
  background: #1e1e26;
  color: #f4f4f5;
}
.fm-tab.active {
  background: rgba(236, 72, 153, 0.14);
  border-color: rgba(236, 72, 153, 0.35);
  color: #f472b6;
  font-weight: 600;
}
.tab-cnt {
  font-size: 10px;
  opacity: 0.75;
}

.fm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fm-import-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.fm-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #e4e4e7;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.fm-chip-btn:hover {
  border-color: #ec4899;
  color: #f472b6;
  background: rgba(236, 72, 153, 0.1);
}
.fm-search-wrap {
  position: relative;
  width: 180px;
}
.search-ico {
  position: absolute;
  left: 7px;
  top: 50%;
  transform: translateY(-50%);
  color: #71717a;
  pointer-events: none;
}
.fm-search {
  width: 100%;
  height: 24px;
  padding: 0 7px 0 24px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #09090b;
  color: #f4f4f5;
  font-size: 11px;
  font-family: inherit;
  outline: none;
}
.fm-search:focus {
  border-color: #ec4899;
}
.fm-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #e4e4e7;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.fm-btn:hover {
  background: #26262f;
}

.fm-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
}
.fm-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 24px 16px;
  border-radius: 8px;
  border: 1px dashed #26262e;
  background: #111116;
  text-align: center;
}
.empty-ico {
  color: #52525b;
}
.fm-empty p {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #d4d4d8;
}
.fm-empty small {
  font-size: 11px;
  color: #71717a;
}

.fm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 6px;
}
.fm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: 7px;
  background: #141419;
  border: 1px solid #23232c;
}
.fm-row:hover {
  border-color: #343442;
  background: #18181f;
}
.fm-preview {
  width: 52px;
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bg-thumb {
  width: 52px;
  height: 30px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #2c2c36;
}
.audio-play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid #2c2c36;
  background: #1a1a22;
  color: #38bdf8;
  cursor: pointer;
}
.audio-play-btn:hover,
.audio-play-btn.playing {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.14);
}

.fm-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fm-name-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.fm-orig {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kind-pill {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #23232c;
  color: #a1a1aa;
  flex-shrink: 0;
}
.use-pill {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  background: #1f1f27;
  color: #71717a;
  flex-shrink: 0;
}
.use-pill.used {
  background: rgba(16, 185, 129, 0.14);
  color: #34d399;
}
.fm-sub-line {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #71717a;
  overflow: hidden;
}
.fm-id {
  color: #7dd3fc;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  flex-shrink: 0;
}
.fm-rel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.fm-ico-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 24px;
  min-width: 24px;
  padding: 0 5px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: #a1a1aa;
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
}
.fm-ico-btn:hover {
  background: #262631;
  color: #ffffff;
}
.fm-ico-btn.danger:hover,
.fm-ico-btn.danger.confirm {
  background: rgba(153, 27, 27, 0.35);
  border-color: #991b1b;
  color: #fca5a5;
}
.confirm-txt {
  white-space: nowrap;
}
</style>
