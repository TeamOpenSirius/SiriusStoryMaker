import { Assets } from '@pixi/assets'
import { sound, type IMediaInstance, type Sound } from '@pixi/sound'
import type { IEpisodeSound } from '../types/Episode'
import { normalizeAudioMix, type AudioMix } from '../types/AudioMix'

export class SoundController {
  protected _isVoice = true
  protected _voiceDuration = 0
  private mix = normalizeAudioMix(null)
  private playing: Partial<Record<keyof AudioMix, { sound: Sound; alias: string }>> = {}
  private voiceEnd?: () => void

  static new() { return new this() }

  constructor() {
    sound.disableAutoPause = true
    sound.volumeAll = 1
  }

  setMuted(muted: boolean) { if (muted) sound.muteAll(); else sound.unmuteAll() }

  setMix(mix: AudioMix) {
    this.mix = normalizeAudioMix(mix)
    for (const channel of Object.keys(this.playing) as (keyof AudioMix)[]) {
      const entry = this.playing[channel]
      if (entry) entry.sound.volume = this.mix[channel]
    }
  }

  private stop(channel: keyof AudioMix) {
    const entry = this.playing[channel]
    delete this.playing[channel]
    entry?.sound.stop()
    if (channel === 'voice') this.voiceEnd = undefined
  }

  private play(channel: keyof AudioMix, alias: string) {
    if (channel === 'music' && this.playing.music?.alias === alias) return
    const onVoiceEnd = this.voiceEnd
    this.stop(channel)
    if (channel === 'voice') this.voiceEnd = onVoiceEnd
    if (!Assets.cache.has(alias)) return
    const clip = Assets.get<Sound>(alias)
    clip.volume = this.mix[channel]
    const entry = { sound: clip, alias }
    this.playing[channel] = entry
    const attach = (instance: IMediaInstance) => {
      if (this.playing[channel] !== entry) { instance.stop(); return }
      instance.on('end', () => {
        if (this.playing[channel] !== entry) return
        delete this.playing[channel]
        if (channel === 'voice') {
          const end = this.voiceEnd
          this.voiceEnd = undefined
          end?.()
        }
      })
    }
    const failed = (err: unknown) => {
      if (this.playing[channel] === entry) this.stop(channel)
      console.warn('Unable to start ADV sound', alias, err)
    }
    try {
      const playback = clip.play({ loop: channel === 'music', singleInstance: true })
      if (playback instanceof Promise) void playback.then(attach).catch(failed)
      else attach(playback)
    } catch (err) { failed(err) }
    if (channel !== 'music') this._voiceDuration = Math.max(this._voiceDuration, (clip.duration || 0) * 1000)
  }

  playBgm(name?: string) {
    if (!name || name === '999') this.stop('music')
    else this.play('music', `bgm_${name}`)
  }

  audition(bgm?: string, se?: string) {
    if (bgm) this.playBgm(bgm)
    if (se) this.play('effects', `se_${se}`)
  }

  reset() {
    this.stop('music')
    this.stopPrevSound()
  }

  sound({ BgmFileName, SeFileName }: IEpisodeSound) {
    this.stopPrevSound()
    if (BgmFileName) this.playBgm(BgmFileName)
    if (SeFileName) this.play('effects', `se_${SeFileName}`)
  }

  voice({ VoiceFileName }: IEpisodeSound) {
    if (VoiceFileName && this._isVoice) this.play('voice', `voice_${VoiceFileName}`)
    else { this.voiceEnd?.(); this.stop('voice') }
  }

  stopPrevSound() {
    this.stop('effects')
    this.stop('voice')
    this._voiceDuration = 0
  }

  get voiceDuration() { return this._voiceDuration }
  set onVoiceEnd(callback: () => void) { this.voiceEnd = callback }
  set isVoice(value: boolean) { this._isVoice = value; if (!value) this.stop('voice') }
  get isVoice() { return this._isVoice }
}
