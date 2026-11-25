<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IEpisodeModel } from '../../player/src/types/Episode'

const props = defineProps<{
  episode: IEpisodeModel
  startIndex?: number
}>()

const frameRef = ref<HTMLIFrameElement | null>(null)
const ready = ref(false)
const errorMsg = ref('')
const reloadKey = ref(0)
const currentFrameIndex = ref(props.startIndex ?? 0)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const assetsBase = typeof window !== 'undefined' ? `${window.location.origin}/local-assets` : ''
const playerUrl = `./wds-adv-player/index.html?mode=live&renderer=webgl&assets=${encodeURIComponent(assetsBase)}`

function pushEpisode() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const win = frameRef.value?.contentWindow
  if (!win || !ready.value) return
  errorMsg.value = ''
  const maxIdx = Math.max(0, (props.episode.EpisodeDetail?.length ?? 1) - 1)
  const clampedStart = Math.min(currentFrameIndex.value, maxIdx)
  win.postMessage(
    {
      type: 'wds-load-episode',
      episode: JSON.parse(JSON.stringify(props.episode)),
      startIndex: clampedStart,
      voice: true,
    },
    '*',
  )
}

function seekTo(index: number) {
  currentFrameIndex.value = Math.max(0, index)
  const win = frameRef.value?.contentWindow
  if (!win || !ready.value) return
  win.postMessage({ type: 'wds-seek', index }, '*')
}

function reloadPlayer() {
  ready.value = false
  errorMsg.value = ''
  reloadKey.value++
}

function onMessage(event: MessageEvent) {
  if (event.source !== frameRef.value?.contentWindow) return
  if (event.data?.type === 'wds-adv-player-ready') {
    ready.value = true
    pushEpisode()
  } else if (event.data?.type === 'wds-adv-player-error') {
    errorMsg.value = event.data.message || '播放器加载失败'
  }
}

watch(
  () => props.episode,
  () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      pushEpisode()
    }, 400)
  },
  { deep: true },
)

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  window.removeEventListener('message', onMessage)
})

defineExpose({ pushEpisode, seekTo, reloadPlayer })
</script>

<template>
  <div class="player-shell">
    <div class="player-header">
      <span class="player-title">WDS Adv Player · 实时舞台预览</span>
      <div class="player-actions">
        <span v-if="!ready" class="status-pill">初始化中…</span>
        <span v-else class="status-pill ok">就绪</span>
        <button class="mini-btn" type="button" @click="pushEpisode">重新加载剧情</button>
        <button class="mini-btn" type="button" @click="reloadPlayer">重启播放器</button>
      </div>
    </div>
    <div v-if="errorMsg" class="player-error">{{ errorMsg }}</div>
    <div class="player-stage">
      <iframe
        ref="frameRef"
        :key="reloadKey"
        :src="playerUrl"
        title="WDS Adv Player"
        class="player-iframe"
        allow="autoplay; fullscreen"
      />
    </div>
  </div>
</template>

<style scoped>
.player-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid #27272a;
  border-radius: 10px;
  background: #18181b;
  overflow: hidden;
}
.player-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #27272a;
}
.player-title {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
}
.player-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #27272a;
  color: #a1a1aa;
}
.status-pill.ok {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.mini-btn {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #f4f4f5;
  cursor: pointer;
}
.mini-btn:hover {
  background: #3f3f46;
}
.player-error {
  padding: 6px 12px;
  font-size: 12px;
  background: rgba(127, 29, 29, 0.5);
  color: #fecaca;
}
.player-stage {
  flex: 1;
  min-height: 0;
  background: #000;
}
.player-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
