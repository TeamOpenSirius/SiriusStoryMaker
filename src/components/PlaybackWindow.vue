<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlaybackFile } from '../shared/playback'
import { useAudioMix } from '../services/audioMix'
import AudioMixControls from './AudioMixControls.vue'

const props = defineProps<{ initial: PlaybackFile }>()
const api = window.siriusStudio!
const file = ref(props.initial)
const iframe = ref<HTMLIFrameElement>()
const revision = ref(0)
const busy = ref(false)
const message = ref('')
const ended = ref(false)
const missingAudio = ref<string[]>([])
const mix = useAudioMix('player')
const audioDialog = ref<HTMLDialogElement>()
const playerUrl = computed(() => `./wds-adv-player/index.html?mode=standalone&assets=${encodeURIComponent(file.value.assetBase)}`)
let unsubscribe: (() => void) | undefined

function send(data: object) { iframe.value?.contentWindow?.postMessage(data, location.origin) }

function configureAudio() {
  if (!audioDialog.value?.open) audioDialog.value?.showModal()
}

async function openFile() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const selected = await api.openPlayback()
    if (selected && selected !== true) {
      file.value = selected
      missingAudio.value = []
      replay()
    }
  } catch (err) {
    message.value = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  } finally { busy.value = false }
}

function replay() {
  ended.value = false
  revision.value++
}

function onKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === 'o') { event.preventDefault(); void openFile() }
  if (event.key === ',') { event.preventDefault(); configureAudio() }
}

function onMessage(event: MessageEvent) {
  if (event.source !== iframe.value?.contentWindow || event.origin !== location.origin) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'wds-adv-player-ready') {
    send({ type: 'wds-load-episode', episode: JSON.parse(JSON.stringify(file.value.episode)), audioMix: { ...mix.value } })
  } else if (data.type === 'wds-adv-player-loaded') {
    missingAudio.value = Array.isArray(data.missingAudio) ? data.missingAudio.filter((id: unknown) => typeof id === 'string') : []
  } else if (data.type === 'wds-adv-player-ended') {
    ended.value = true
  } else if (data.type === 'wds-open-audio-settings') {
    configureAudio()
  } else if (data.type === 'wds-open-playback-file') {
    void openFile()
  }
}

watch(mix, value => send({ type: 'wds-audio-mix', audioMix: { ...value } }))
onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKey)
  unsubscribe = api.onPlaybackAction(action => { if (action === 'open') void openFile(); else configureAudio() })
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  window.removeEventListener('keydown', onKey)
  unsubscribe?.()
})
</script>

<template>
  <main class="native-playback">
    <iframe :key="revision" ref="iframe" :src="playerUrl" title="WDS ADV Player" allow="autoplay; fullscreen" />
    <p v-if="message || file.missingAssets.length || missingAudio.length" class="playback-warning" role="status">
      {{ message || `有 ${new Set([...file.missingAssets, ...missingAudio.map(id => id.replace(/^(bgm|voice|se)_/, '$1/'))]).size} 个资源未能加载。` }}
      <button v-if="message" type="button" @click="message = ''">关闭</button>
    </p>
    <div v-if="ended" class="playback-end-overlay">
      <section class="playback-end" aria-label="剧情播放结束">
        <h2>剧情播放结束</h2>
        <p>{{ file.episode.Title || file.name }}</p>
        <div>
          <button type="button" @click="replay">再看一遍</button>
          <button type="button" :disabled="busy" @click="openFile">打开其他剧情</button>
        </div>
      </section>
    </div>
    <dialog ref="audioDialog" class="native-audio" aria-label="播放器设置">
      <form method="dialog">
        <h2>播放器设置</h2>
        <h3>音频</h3>
        <AudioMixControls v-model="mix" />
        <button type="submit">确定</button>
      </form>
    </dialog>
  </main>
</template>

<style scoped>
.native-playback { height:100%;background:#000 }
iframe { display:block;width:100%;height:100%;border:0 }
.playback-warning { position:fixed;bottom:12px;left:12px;margin:0;background:#fff0ec;color:#603748;padding:6px 12px;border-radius:5px;font-size:13px }
.native-audio { width:min(360px,calc(100% - 24px));border:2px solid #d88ba6;border-radius:10px;background:#fff8fa;color:#4a424b;padding:0 }
.native-audio::backdrop { background:#251a2a99 }
form { margin:0;padding:18px 24px }
h2 { margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid #eed4df;font-size:18px }
h3 { margin:0 0 10px;font-size:14px }
form button { display:block;margin:16px auto 0;padding:6px 22px;color:white;background:#bc557e;border:0;border-radius:4px;cursor:pointer }
.playback-end-overlay { position:fixed;inset:0;display:grid;place-items:center;background:#251a2a99 }
.playback-end { width:min(390px,calc(100% - 24px));background:#fff8fa;color:#4a424b;border:2px solid #d88ba6;border-radius:10px;padding:20px 24px;text-align:center }
.playback-end p { overflow-wrap:anywhere }
.playback-end button { margin:0 4px;padding:6px 14px;border:0;border-radius:4px;background:#bc557e;color:white;cursor:pointer }
</style>
