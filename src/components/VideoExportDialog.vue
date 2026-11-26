<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { Download, FolderOpen, RefreshCw, X } from 'lucide-vue-next'
import { normalizeAudioMix, type AudioMix } from '../../player/src/types/AudioMix'
import type { IEpisodeModel } from '../../player/src/types/Episode'
import type { FfmpegStatus } from '../shared/playback'

const props = defineProps<{ episode: IEpisodeModel; assetBase: string; setupOnly?: boolean; audioMix?: AudioMix }>()
const emit = defineEmits<{ close: []; openSettings: [] }>()
const api = window.siriusStudio
const state = ref<'setup' | 'loading' | 'recording' | 'converting' | 'done' | 'error'>('setup')
const encoder = ref<FfmpegStatus | null>(null)
const checking = ref(false)
const message = ref('')
const saved = ref('')
const missingAudio = ref<string[]>([])
const frame = ref(0)
const iframe = ref<HTMLIFrameElement>()
const snapshot = ref<IEpisodeModel>()
const total = computed(() => snapshot.value?.EpisodeDetail.length ?? props.episode.EpisodeDetail.length)
const frameUrl = `./wds-adv-player/index.html?mode=record&renderer=webgl&assets=${encodeURIComponent(props.assetBase)}`
const active = computed(() => ['loading', 'recording', 'converting'].includes(state.value))
let job: string | undefined
let writes = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false

function errorText(err: unknown) {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
async function check(manual = false) {
  if (!api || checking.value) return
  checking.value = true
  message.value = ''
  try {
    const result = await (manual ? api.chooseFfmpeg() : api.detectFfmpeg())
    if (result) encoder.value = result
  } catch (err) { message.value = errorText(err) }
  finally { checking.value = false }
}
function send(data: object) {
  iframe.value?.contentWindow?.postMessage(data, location.origin)
}
async function cancel() {
  clearTimeout(timer)
  const id = job
  job = undefined
  if (id) await api?.cancelVideo(id).catch(() => {})
}
function close() {
  void cancel()
  emit('close')
}
async function fail(err: unknown) {
  message.value = errorText(err)
  state.value = 'error'
  await cancel()
}
async function start() {
  if (!api || active.value || checking.value || !encoder.value?.path || !total.value) return
  checking.value = true
  message.value = ''
  const episode = JSON.parse(JSON.stringify(props.episode)) as IEpisodeModel
  try {
    const result = await api.beginVideo(episode.Title)
    if (!result) return
    if (disposed) { await api.cancelVideo(result.id); return }
    job = result.id
    writes = Promise.resolve()
    snapshot.value = episode
    missingAudio.value = []
    frame.value = 0
    state.value = 'loading'
    timer = setTimeout(() => { void fail('舞台资源加载超时，请检查网络或素材后重试') }, 120_000)
  } catch (err) { await fail(err) }
  finally { checking.value = false }
}
async function onMessage(event: MessageEvent) {
  if (!api || !job || event.origin !== location.origin || event.source !== iframe.value?.contentWindow) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'wds-adv-player-ready' && state.value === 'loading') {
    send({ type: 'wds-load-episode', episode: JSON.parse(JSON.stringify(snapshot.value)), muted: false, audioMix: normalizeAudioMix(props.audioMix) })
  } else if (data.type === 'wds-adv-player-loaded' && state.value === 'loading') {
    missingAudio.value = Array.isArray(data.missingAudio) ? data.missingAudio.filter((id: unknown) => typeof id === 'string') : []
    send({ type: 'wds-record-start' })
  } else if (data.type === 'wds-record-started' && state.value === 'loading') {
    clearTimeout(timer)
    state.value = 'recording'
  } else if (data.type === 'wds-adv-player-frame' && typeof data.index === 'number') {
    frame.value = data.index + 1
  } else if (data.type === 'wds-adv-player-ended' && state.value === 'recording') {
    send({ type: 'wds-record-stop' })
    timer = setTimeout(() => { void fail('未收到录制结束信号') }, 20_000)
  } else if (data.type === 'wds-record-chunk' && state.value === 'recording' && data.bytes instanceof ArrayBuffer) {
    const id = job
    writes = writes.then(() => job === id ? api.writeVideoChunk(id, data.bytes) : undefined)
    void writes.catch(err => { if (job === id) void fail(err) })
  } else if (data.type === 'wds-record-finished' && state.value === 'recording') {
    clearTimeout(timer)
    const id = job
    state.value = 'converting'
    try {
      await writes
      if (job !== id) return
      const file = await api.finishVideo(id)
      if (job !== id) return
      job = undefined
      saved.value = file
      state.value = 'done'
    } catch (err) { if (job === id) await fail(err) }
  } else if ((data.type === 'wds-adv-player-error' || data.type === 'wds-record-error') && active.value) {
    await fail(data.message || '录制预览失败')
  }
}
onMounted(() => {
  window.addEventListener('message', onMessage)
  void check()
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('message', onMessage)
  void cancel()
})
</script>

<template>
  <Teleport to="body">
    <div class="video-backdrop" @keydown.esc.stop="close">
      <section class="video-dialog" role="dialog" aria-modal="true" :aria-label="setupOnly ? 'FFmpeg 配置向导' : '导出视频'">
        <header><strong>{{ setupOnly ? 'FFmpeg 配置向导' : '导出剧情视频' }}</strong>
          <button type="button" aria-label="关闭视频窗口" @click="close"><X :size="16" /></button>
        </header>
        <template v-if="state === 'setup'">
          <div class="video-content">
            <h3>1. 检测 FFmpeg</h3>
            <p v-if="checking">正在检测…</p>
            <p v-else-if="encoder?.path" class="video-ok">已就绪 · {{ encoder.version }}</p>
            <p v-else>{{ encoder?.error || '等待检测' }}</p>
            <p v-if="encoder?.path" class="video-path">{{ encoder.path }}</p>
            <div v-if="setupOnly" class="video-actions">
              <button type="button" :disabled="checking" @click="check()"><RefreshCw :size="13" /> 重新检测</button>
              <button type="button" :disabled="checking" @click="check(true)"><FolderOpen :size="13" /> 选择可执行文件</button>
            </div>
            <p v-if="setupOnly">应用不附带 FFmpeg。可前往 <a href="https://github.com/BtbN/FFmpeg-Builds/releases" target="_blank" rel="noreferrer">GitHub Releases</a>，安装带 H.264（libx264）和 AAC 编码器的版本。</p>
            <p v-if="message" role="alert" class="video-error">{{ message }}</p>
            <template v-if="!setupOnly">
              <button v-if="!encoder?.path && !checking" type="button" @click="emit('openSettings')">前往设置</button>
              <h3>选择保存位置并导出</h3>
              <p>先播放原生片头，再自动播放当前路线，按实际播放速度录制 1080p、30 fps 的画面和游戏声音，再转成 MP4。不录制编辑器界面。录制使用预览的三路音量，忽略预览的总静音开关。</p>
              <button class="video-primary" type="button" :disabled="!encoder?.path || checking || !total" @click="start"><Download :size="14" /> 选择位置并录制</button>
            </template>
          </div>
        </template>
        <template v-else-if="active">
          <iframe v-if="state !== 'converting'" ref="iframe" class="video-stage" title="视频录制舞台" :src="frameUrl" allow="autoplay" />
          <div class="video-content video-work">
            <span role="status">{{ state === 'loading' ? '加载舞台资源…' : state === 'converting' ? '正在转码 MP4…' : `正在录制 · 第 ${frame} / ${total} 帧` }}</span>
            <button type="button" @click="close">取消导出</button>
          </div>
        </template>
        <div v-else class="video-content">
          <h3>{{ state === 'done' ? '视频已保存' : '视频导出失败' }}</h3>
          <p :class="state === 'error' ? 'video-error' : 'video-path'">{{ state === 'done' ? saved : message }}</p>
          <p v-if="state === 'done' && missingAudio.length" class="video-error">以下音频未能加载，未录入视频：{{ missingAudio.join('、') }}</p>
          <button v-if="state === 'error'" type="button" @click="state = 'setup'; message = ''">返回设置</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.video-backdrop { position:fixed;inset:0;background:#07070bce;display:grid;place-items:center;z-index:120;padding:20px }
.video-dialog { width:min(700px,100%);max-height:95vh;overflow:auto;background:#19191f;color:#eeeef7;border:1px solid #3a3a48;border-radius:10px;box-shadow:0 16px 60px #0009;font-size:14px }
header { display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #383843;padding:10px 16px }
.video-content { padding:16px 20px 20px;line-height:1.6 }
h3 { margin:0 0 8px } h3:not(:first-child) { margin-top:18px }
p { margin:6px 0 12px } a { color:#d0b4ff }
button { display:inline-flex;gap:6px;align-items:center;color:inherit;background:#292934;border:1px solid #444454;border-radius:5px;padding:6px 10px;cursor:pointer }
button:disabled { opacity:.5;cursor:default }
.video-primary { background:#6e44be;border-color:#9566db }
.video-actions,.video-work { display:flex;gap:8px;align-items:center }.video-work{justify-content:space-between}
.video-ok { color:#a7e3b2 }.video-error { color:#ffaaaa }.video-path { overflow-wrap:anywhere;color:#c3c3d6 }
.video-stage { pointer-events:none;display:block;width:100%;aspect-ratio:16/9;border:0;background:#000 }
</style>
