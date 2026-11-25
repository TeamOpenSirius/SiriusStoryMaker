<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  RefreshCw,
  SkipBack,
  Volume2,
  VolumeX,
} from 'lucide-vue-next'
import type { IEpisodeModel } from '../../player/src/types/Episode'

const props = defineProps<{
  episode: IEpisodeModel
  startIndex?: number
  assetBase?: string
}>()

const emit = defineEmits<{
  frameChange: [index: number]
}>()

const frameRef = ref<HTMLIFrameElement | null>(null)
const status = ref<'init' | 'loading' | 'ready' | 'ended' | 'error'>('init')
const errorMsg = ref('')
const reloadKey = ref(0)
const currentFrameIndex = ref(props.startIndex ?? 0)
const isPlaying = ref(false)
const audioEnabled = ref(true)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let iframeReady = false
let lastPushedSignature = ''

const totalFrames = computed(() => props.episode.EpisodeDetail?.length ?? 0)

const assetsBase = props.assetBase ?? ''
const playerUrl = `./wds-adv-player/index.html?mode=live&renderer=webgl&assets=${encodeURIComponent(assetsBase)}`

function pushEpisode(forceStartIndex?: number) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady) return
  status.value = 'loading'
  errorMsg.value = ''
  const maxIdx = Math.max(0, totalFrames.value - 1)
  const targetStart = forceStartIndex !== undefined ? forceStartIndex : currentFrameIndex.value
  const clampedStart = Math.max(0, Math.min(targetStart, maxIdx))
  currentFrameIndex.value = clampedStart
  const serialized = JSON.stringify(props.episode)
  lastPushedSignature = serialized
  win.postMessage(
    {
      type: 'wds-load-episode',
      episode: JSON.parse(serialized),
      startIndex: clampedStart,
      muted: !audioEnabled.value,
    },
    '*',
  )
}

function seekTo(index: number) {
  const maxIdx = Math.max(0, totalFrames.value - 1)
  const clamped = Math.max(0, Math.min(index, maxIdx))
  currentFrameIndex.value = clamped
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady) return
  win.postMessage({ type: 'wds-seek', index: clamped, instant: true }, '*')
}

function stepPrev() {
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady) return
  win.postMessage({ type: 'wds-prev' }, '*')
}

function stepNext() {
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady) return
  win.postMessage({ type: 'wds-next' }, '*')
}

function togglePlay() {
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady || status.value === 'loading' || totalFrames.value === 0) return
  const nextState = !isPlaying.value
  isPlaying.value = nextState
  win.postMessage({ type: nextState ? 'wds-play' : 'wds-pause' }, '*')
}

function toggleMute() {
  audioEnabled.value = !audioEnabled.value
  frameRef.value?.contentWindow?.postMessage({ type: 'wds-mute', muted: !audioEnabled.value }, '*')
}

function restartFromBeginning() {
  currentFrameIndex.value = 0
  if (status.value === 'ended') {
    pushEpisode(0)
  } else {
    seekTo(0)
  }
}

function reloadPlayer() {
  iframeReady = false
  status.value = 'init'
  errorMsg.value = ''
  reloadKey.value++
}

function onMessage(event: MessageEvent) {
  if (event.source !== frameRef.value?.contentWindow || event.origin !== window.location.origin) return
  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'wds-adv-player-ready') {
    iframeReady = true
    pushEpisode()
  } else if (data.type === 'wds-adv-player-loaded') {
    status.value = 'ready'
    errorMsg.value = ''
  } else if (data.type === 'wds-adv-player-frame' && typeof data.index === 'number') {
    status.value = 'ready'
    currentFrameIndex.value = data.index
    emit('frameChange', data.index)
  } else if (data.type === 'wds-adv-player-playstate' && typeof data.playing === 'boolean') {
    isPlaying.value = data.playing
  } else if (data.type === 'wds-adv-player-ended') {
    isPlaying.value = false
    status.value = 'ended'
  } else if (data.type === 'wds-adv-player-error') {
    status.value = 'error'
    errorMsg.value = data.message || '播放器加载失败'
  }
}

watch(
  () => props.episode,
  () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const sig = JSON.stringify(props.episode)
      if (sig === lastPushedSignature) return
      pushEpisode()
    }, 350)
  },
)

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  window.removeEventListener('message', onMessage)
})

defineExpose({ pushEpisode, seekTo, reloadPlayer, stepNext, stepPrev })
</script>

<template>
  <div class="player-shell">
    <div class="player-header">
      <div class="player-title-group">
        <span class="player-title">实时舞台预览</span>
        <span
          class="status-pill"
          :class="{
            ok: status === 'ready',
            warn: status === 'loading' || status === 'init',
            ended: status === 'ended',
            err: status === 'error',
          }"
        >
          <template v-if="status === 'init'">初始化中…</template>
          <template v-else-if="status === 'loading'">加载资源…</template>
          <template v-else-if="status === 'ready'">{{ isPlaying ? '播放中' : '已暂停' }}</template>
          <template v-else-if="status === 'ended'">播放结束</template>
          <template v-else>加载异常</template>
        </span>
      </div>

      <div class="player-controls">
        <div class="transport-group">
          <button class="icon-btn" type="button" title="回到第 1 帧" @click="restartFromBeginning">
            <SkipBack :size="13" />
          </button>
          <button class="icon-btn" type="button" title="上一帧" @click="stepPrev">
            <ChevronLeft :size="14" />
          </button>
          <button
            class="icon-btn"
            :class="{ active: isPlaying }"
            type="button"
            :title="isPlaying ? '暂停播放' : '开始播放'"
            @click="togglePlay"
          >
            <Pause v-if="isPlaying" :size="13" />
            <Play v-else :size="13" />
          </button>
          <span class="frame-counter">
            {{ totalFrames > 0 ? currentFrameIndex + 1 : 0 }} / {{ totalFrames }}
          </span>
          <button class="icon-btn" type="button" title="下一帧" @click="stepNext">
            <ChevronRight :size="14" />
          </button>
        </div>

        <button
          class="icon-btn"
          :class="{ active: audioEnabled }"
          type="button"
          :title="audioEnabled ? '预览声音已开启' : '预览已静音'"
          @click="toggleMute"
        >
          <Volume2 v-if="audioEnabled" :size="13" />
          <VolumeX v-else :size="13" />
        </button>

        <button class="icon-btn" type="button" title="重新推送当前剧情" @click="pushEpisode()">
          <RefreshCw :size="13" />
        </button>
        <button class="icon-btn" type="button" title="重启播放器" @click="reloadPlayer">
          <RotateCcw :size="13" />
        </button>
      </div>
    </div>

    <div v-if="errorMsg" class="player-error">
      <span class="error-text">{{ errorMsg }}</span>
      <button class="retry-btn" type="button" @click="reloadPlayer">重试</button>
    </div>

    <div class="player-stage">
      <div class="stage-aspect">
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
  </div>
</template>

<style scoped>
.player-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #111114;
  overflow: hidden;
}
.player-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  background: #18181b;
  border-bottom: 1px solid #27272a;
  flex-shrink: 0;
}
.player-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.player-title {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
  white-space: nowrap;
}
.status-pill {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #27272a;
  color: #a1a1aa;
  white-space: nowrap;
}
.status-pill.ok {
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}
.status-pill.warn {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}
.status-pill.ended {
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
}
.status-pill.err {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.player-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.transport-group {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  background: #09090b;
  border: 1px solid #27272a;
  border-radius: 6px;
  margin-right: 4px;
}
.frame-counter {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #d4d4d8;
  padding: 0 6px;
  min-width: 44px;
  text-align: center;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.icon-btn:hover {
  background: #27272a;
  color: #f4f4f5;
}
.icon-btn.active {
  color: #f472b6;
  background: rgba(244, 114, 182, 0.12);
}
.player-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  background: rgba(127, 29, 29, 0.55);
  border-bottom: 1px solid #991b1b;
  color: #fecaca;
  flex-shrink: 0;
}
.error-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.retry-btn {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #f87171;
  background: transparent;
  color: #fecaca;
  cursor: pointer;
}
.player-stage {
  flex: 1;
  min-height: 0;
  background: #050507;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  overflow: hidden;
}
.stage-aspect {
  position: relative;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.player-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  border-radius: 4px;
  background: #000;
}
</style>
