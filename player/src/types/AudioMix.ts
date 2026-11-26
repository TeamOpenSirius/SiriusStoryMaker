export interface AudioMix { music: number; voice: number; effects: number }

export const DEFAULT_AUDIO_MIX: AudioMix = { music: 0.55, voice: 1, effects: 0.85 }

export function normalizeAudioMix(value: unknown): AudioMix {
  const mix = { ...DEFAULT_AUDIO_MIX }
  if (!value || typeof value !== 'object') return mix
  for (const key of Object.keys(mix) as (keyof AudioMix)[]) {
    const level = (value as Partial<AudioMix>)[key]
    if (typeof level === 'number' && Number.isFinite(level)) mix[key] = Math.max(0, Math.min(1, level))
  }
  return mix
}
