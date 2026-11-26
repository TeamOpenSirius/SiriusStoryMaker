<script setup lang="ts">
import type { AudioMix } from '../../player/src/types/AudioMix'
const props = defineProps<{ modelValue: AudioMix }>()
const emit = defineEmits<{ 'update:modelValue': [AudioMix] }>()
const channels = [
  ['music', '音乐 / Music'], ['voice', '语音 / Voice'], ['effects', '音效 / SE'],
] as const
</script>

<template>
  <div class="audio-channels">
    <label v-for="[key, name] in channels" :key="key">
      <span>{{ name }}</span>
      <input type="range" min="0" max="100" step="1" :value="Math.round(modelValue[key] * 100)"
        @input="emit('update:modelValue', { ...props.modelValue, [key]: Number(($event.target as HTMLInputElement).value) / 100 })" />
      <output>{{ Math.round(modelValue[key] * 100) }}%</output>
    </label>
  </div>
</template>

<style scoped>
.audio-channels { display:grid;gap:10px;font-size:13px }
label { display:grid;grid-template-columns:8em minmax(90px,1fr) 3em;align-items:center;gap:8px }
input { width:100%;accent-color:#d35f88;margin:0 }
output { text-align:right;font-variant-numeric:tabular-nums }
</style>
