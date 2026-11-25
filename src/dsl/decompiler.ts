import type { IEpisodeModel } from '../../player/src/types/Episode'
import { BODY_MAP, DIR_MAP, EXPR_MAP, HEAD_MAP, LIP_MAP } from './compiler'

function invertMap(map: Record<string, number>): Record<number, string> {
  const inv: Record<number, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (!(v in inv)) inv[v] = k
  }
  return inv
}

const EXPR_NAMES = invertMap(EXPR_MAP)
const BODY_NAMES = invertMap(BODY_MAP)
const HEAD_NAMES = invertMap(HEAD_MAP)
const DIR_NAMES = invertMap(DIR_MAP)
const LIP_NAMES = invertMap(LIP_MAP)

const FADE_NAMES: Record<number, string> = {
  1: 'black',
  2: 'white',
  3: 'time',
  4: 'cross',
}

const POS_NAMES: Record<number, string> = {
  1: 'outer_left',
  2: 'left',
  3: 'center',
  4: 'right',
  5: 'outer_right',
}

const SIZE_NAMES: Record<number, string> = {
  1: 's',
  2: 'm',
  3: 'l',
}

const APPEAR_NAMES: Record<number, string> = {
  0: 'fade',
  1: 'right',
  2: 'left',
  3: 'bottom',
}

export function decompileEpisode(episode: IEpisodeModel): string {
  const out: string[] = []
  if (episode.Title) out.push(`@title ${episode.Title}`)
  if (episode.Chapter) out.push(`@chapter ${episode.Chapter}`)
  if (episode.EpisodeId) out.push(`@episode ${episode.EpisodeId}`)
  out.push('')

  let prevCharsKey = ''
  let prevEffect: number | undefined

  for (const frame of episode.EpisodeDetail || []) {
    if (frame.BackgroundImageFileName) {
      const parts = [`@bg ${frame.BackgroundImageFileName}`]
      const fade = frame.BackgroundImageFileFadeType ? FADE_NAMES[frame.BackgroundImageFileFadeType] : undefined
      if (fade) parts.push(`fade=${fade}`)
      if (frame.SceneCameraMasterId) parts.push(`camera=${frame.SceneCameraMasterId}`)
      out.push(parts.join(' '))
    } else if (frame.BackgroundImageFileFadeType) {
      const fade = FADE_NAMES[frame.BackgroundImageFileFadeType]
      if (fade) {
        const vals = [frame.FadeValue1, frame.FadeValue2, frame.FadeValue3].filter((v) => v != null)
        out.push(vals.length ? `@fade ${fade} ${vals.join(' ')}` : `@fade ${fade}`)
      }
    }

    if (frame.StillPhotoFileName) out.push(`@still ${frame.StillPhotoFileName}`)
    if (frame.BackgroundCharacterImageFileName) out.push(`@card ${frame.BackgroundCharacterImageFileName}`)
    if (frame.BgmFileName) out.push(`@bgm ${frame.BgmFileName === '999' ? 'stop' : frame.BgmFileName}`)
    if (frame.SeFileName) out.push(`@se ${frame.SeFileName}`)
    if (frame.VoiceFileName) out.push(`@voice ${frame.VoiceFileName}`)

    if (frame.WindowEffect !== prevEffect) {
      if (frame.WindowEffect === 1) out.push('@effect sepia')
      else if (frame.WindowEffect === 2) out.push('@effect blur')
      else if (prevEffect !== undefined) out.push('@effect none')
      prevEffect = frame.WindowEffect
    }

    const chars = frame.CharacterMotions || []
    const charsKey = JSON.stringify(chars)
    if (charsKey !== prevCharsKey) {
      if (chars.length === 0 && prevCharsKey !== '' && prevCharsKey !== '[]') {
        out.push('@clear_chars')
      } else {
        for (const c of chars) {
          const parts = [`@char ${c.slotNumber} ${c.SpineId}`]
          const pos = POS_NAMES[c.CharacterPosition]
          if (pos) parts.push(`pos=${pos}`)
          const size = SIZE_NAMES[c.SpineSize]
          if (size && size !== 's') parts.push(`size=${size}`)
          const appear = APPEAR_NAMES[c.CharacterAppearanceType]
          if (appear && appear !== 'fade') parts.push(`appear=${appear}`)
          if (c.FacialExpressionMasterId) {
            parts.push(`expr=${EXPR_NAMES[c.FacialExpressionMasterId] ?? c.FacialExpressionMasterId}`)
          }
          if (c.BodyMotionMasterId) {
            parts.push(`body=${BODY_NAMES[c.BodyMotionMasterId] ?? c.BodyMotionMasterId}`)
          }
          if (c.HeadMotionMasterId) {
            parts.push(`head=${HEAD_NAMES[c.HeadMotionMasterId] ?? c.HeadMotionMasterId}`)
          }
          if (c.HeadDirectionMasterId) {
            parts.push(`dir=${DIR_NAMES[c.HeadDirectionMasterId] ?? c.HeadDirectionMasterId}`)
          }
          if (c.LipSyncMasterId) {
            parts.push(`lip=${LIP_NAMES[c.LipSyncMasterId] ?? c.LipSyncMasterId}`)
          }
          out.push(parts.join(' '))
        }
      }
      prevCharsKey = charsKey
    }

    if (frame.Order === 2) {
      out.push(`+ ${frame.Phrase}`)
    } else if (frame.Phrase || frame.SpeakerName) {
      const sizeSuffix = frame.FontSize === 1 ? '(small)' : frame.FontSize === 3 ? '(large)' : ''
      const who = frame.SpeakerName ? `${frame.SpeakerName}${sizeSuffix}` : ''
      out.push(`${who}: ${frame.Phrase}`)
    }
  }

  return out.join('\n')
}
