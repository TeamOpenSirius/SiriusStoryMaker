import type { IEpisodeDetail } from '../types/Episode'

type CueFrame = Pick<IEpisodeDetail, 'BackgroundImageFileName' | 'StillPhotoFileName' | 'BgmFileName'>

export interface StageCue {
  readonly background?: string
  readonly still?: string
  readonly music?: string
}

/** One entry per frame; unchanged spans share the same cue object. */
export function indexStageCues(frames: readonly CueFrame[]): readonly StageCue[] {
  let cue: StageCue = {}
  return frames.map(frame => {
    const background = frame.BackgroundImageFileName || cue.background
    const still = frame.StillPhotoFileName || (frame.BackgroundImageFileName ? undefined : cue.still)
    const music = frame.BgmFileName === '999' ? undefined : frame.BgmFileName || cue.music
    if (cue.background !== background || cue.still !== still || cue.music !== music) {
      cue = { background, still, music }
    }
    return cue
  })
}
