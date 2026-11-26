import type { IEpisodeModel } from '../../player/src/types/Episode'

export interface PreviewAudition { bgm?: string; se?: string }

function musicAt(episode: IEpisodeModel, index: number) {
  for (let i = Math.min(index, episode.EpisodeDetail.length - 1); i >= 0; i--) {
    const bgm = episode.EpisodeDetail[i]?.BgmFileName
    if (bgm) return bgm === '999' ? undefined : bgm
  }
  return undefined
}

/** Audition a changed cue only, not the existing audio of a normally selected frame. */
export function changedPreviewAudio(before: IEpisodeModel, after: IEpisodeModel, index: number): PreviewAudition | undefined {
  if (before.EpisodeId !== after.EpisodeId) return
  const previous = before.EpisodeDetail[index]
  const current = after.EpisodeDetail[index]
  if (!previous || !current) return
  const bgm = musicAt(after, index)
  const se = current.SeFileName
  const changed: PreviewAudition = {
    bgm: bgm !== musicAt(before, index) ? bgm : undefined,
    se: se !== previous.SeFileName ? se : undefined,
  }
  return changed.bgm || changed.se ? changed : undefined
}
