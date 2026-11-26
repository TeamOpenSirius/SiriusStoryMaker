<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { normalizeAudioMix, type AudioMix } from '../../player/src/types/AudioMix'
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  RefreshCw,
  SkipBack,
} from 'lucide-vue-next'
import { changedPreviewAudio, type PreviewAudition } from '../services/previewAudio'
import type { IEpisodeModel } from '../../player/src/types/Episode'

const props = defineProps<{
  episode: IEpisodeModel
  routeKey: string
  startIndex?: number
  assetBase?: string
  audioMix?: AudioMix
  muted?: boolean
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
const mix = computed(() => normalizeAudioMix(props.audioMix))
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let iframeReady = false
const pendingPlay = ref(false)
const playingOrQueued = computed(() => pendingPlay.value || isPlaying.value)
let pendingAudition: PreviewAudition | undefined
interface PostedEpisode {
  episode: IEpisodeModel
  route: string
  serialized: string
}
let lastPosted: PostedEpisode | undefined
let lastLoaded: PostedEpisode | undefined
let loadId = 0

const totalFrames = computed(() => props.episode.EpisodeDetail?.length ?? 0)
const episodeSignature = computed(() => JSON.stringify(props.episode))

const assetsBase = props.assetBase ?? ''
const playerUrl = `./wds-adv-player/index.html?mode=live&renderer=webgl&assets=${encodeURIComponent(assetsBase)}`

function episodeWasPosted() {
  return lastPosted?.route === props.routeKey && lastPosted.serialized === episodeSignature.value
}

function pushEpisode(forceStartIndex?: number, autoplay = false, auditionChanges = false) {
  if (forceStartIndex !== undefined) currentFrameIndex.value = forceStartIndex
  pendingPlay.value = autoplay
  pendingAudition = undefined
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady) return
  status.value = 'loading'
  isPlaying.value = false
  errorMsg.value = ''
  const maxIdx = Math.max(0, totalFrames.value - 1)
  const targetStart = forceStartIndex !== undefined ? forceStartIndex : currentFrameIndex.value
  const clampedStart = Math.max(0, Math.min(targetStart, maxIdx))
  currentFrameIndex.value = clampedStart
  const serialized = episodeSignature.value
  const episode = JSON.parse(serialized) as IEpisodeModel
  if (!autoplay && auditionChanges && !props.muted && lastLoaded?.route === props.routeKey) {
    pendingAudition = changedPreviewAudio(lastLoaded.episode, episode, clampedStart)
  }
  lastPosted = { episode, route: props.routeKey, serialized }
  win.postMessage(
    {
      type: 'wds-load-episode',
      loadId: ++loadId,
      episode,
      startIndex: clampedStart,
      muted: props.muted === true,
      audioMix: mix.value,
    },
    '*',
  )
}

function seekTo(index: number, play = playingOrQueued.value) {
  const maxIdx = Math.max(0, totalFrames.value - 1)
  const clamped = Math.max(0, Math.min(index, maxIdx))
  pendingAudition = undefined
  currentFrameIndex.value = clamped
  if (!iframeReady || !episodeWasPosted() || status.value === 'error') {
    pushEpisode(clamped, play, true)
    return
  }
  const loading = status.value === 'loading'
  pendingPlay.value = loading && play
  if (!loading) isPlaying.value = play
  frameRef.value?.contentWindow?.postMessage({ type: 'wds-seek', index: clamped, play: !loading && play }, location.origin)
}

function playFrom(index: number) {
  if (totalFrames.value) seekTo(index, true)
}

function stepPrev() {
  if (currentFrameIndex.value > 0) seekTo(currentFrameIndex.value - 1)
}

function stepNext() {
  if (currentFrameIndex.value + 1 < totalFrames.value) seekTo(currentFrameIndex.value + 1)
}

function togglePlay() {
  const win = frameRef.value?.contentWindow
  if (!win || !iframeReady || totalFrames.value === 0) return
  if (status.value === 'loading') {
    pendingPlay.value = !pendingPlay.value
    pendingAudition = undefined
    return
  }
  const nextState = !isPlaying.value
  if (!episodeWasPosted()) {
    seekTo(currentFrameIndex.value, nextState)
    return
  }
  isPlaying.value = nextState
  win.postMessage({ type: nextState ? 'wds-play' : 'wds-pause' }, '*')
}

function pause() {
  pendingPlay.value = false
  pendingAudition = undefined
  if (isPlaying.value) frameRef.value?.contentWindow?.postMessage({ type: 'wds-pause' }, location.origin)
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
  lastPosted = undefined
  lastLoaded = undefined
  pendingAudition = undefined
  pendingPlay.value = false
  isPlaying.value = false
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
    pushEpisode(currentFrameIndex.value, pendingPlay.value)
  } else if (data.type === 'wds-adv-player-loaded' && data.loadId === loadId) {
    status.value = 'ready'
    lastLoaded = lastPosted
    const missing = Array.isArray(data.missingAudio) ? data.missingAudio : []
    errorMsg.value = missing.length ? `这些音频未能加载：${missing.join('、')}` : ''
    if (pendingPlay.value) {
      pendingPlay.value = false
      isPlaying.value = true
      frameRef.value?.contentWindow?.postMessage({ type: 'wds-play' }, location.origin)
    } else if (pendingAudition && !props.muted) {
      frameRef.value?.contentWindow?.postMessage({ type: 'wds-audition-audio', ...pendingAudition }, location.origin)
    }
    pendingAudition = undefined
  } else if (data.type === 'wds-adv-player-frame' && typeof data.index === 'number') {
    if (status.value !== 'loading') status.value = 'ready'
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
  [() => props.episode, () => props.routeKey],
  () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (episodeWasPosted()) return
      pushEpisode(undefined, playingOrQueued.value, true)
    }, 100)
  },
)

watch(mix, audioMix => {
  frameRef.value?.contentWindow?.postMessage({ type: 'wds-audio-mix', audioMix }, location.origin)
})

watch(() => props.muted, muted => {
  frameRef.value?.contentWindow?.postMessage({ type: 'wds-mute', muted: muted === true }, location.origin)
})

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  window.removeEventListener('message', onMessage)
})

defineExpose({ pushEpisode, seekTo, playFrom, pause, reloadPlayer, stepNext, stepPrev })
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
            :class="{ active: playingOrQueued }"
            type="button"
            :title="playingOrQueued ? '暂停播放' : '开始播放'"
            @click="togglePlay"
          >
            <Pause v-if="playingOrQueued" :size="13" />
            <Play v-else :size="13" />
          </button>
          <span class="frame-counter">
            {{ totalFrames > 0 ? currentFrameIndex + 1 : 0 }} / {{ totalFrames }}
          </span>
          <button class="icon-btn" type="button" title="下一帧" @click="stepNext">
            <ChevronRight :size="14" />
          </button>
        </div>

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
