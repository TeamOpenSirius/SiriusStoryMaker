import { onMounted, ref, watch } from 'vue'
import { normalizeAudioMix } from '../../player/src/types/AudioMix'

export function useAudioMix(scope: 'editor' | 'player') {
  const mix = ref(normalizeAudioMix(null))
  let edited = false
  let loading = false
  onMounted(async () => {
    const stored = await window.siriusStudio?.readAudioMix(scope).catch(() => null)
    if (stored && !edited) {
      loading = true
      mix.value = normalizeAudioMix(stored)
      loading = false
    }
  })
  watch(mix, (value) => {
    if (loading) return
    edited = true
    void window.siriusStudio?.writeAudioMix(scope, normalizeAudioMix(value)).catch(() => {})
  }, { flush: 'sync' })
  return mix
}
