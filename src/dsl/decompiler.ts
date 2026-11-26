import type { IEpisodeModel } from '../../player/src/types/Episode'
import { framesToSceneDsl } from './sceneFrames'

export function decompileEpisode(episode: IEpisodeModel): string {
  const headers: string[] = []
  if (episode.Title) headers.push(`@title ${episode.Title}`)
  if (episode.Chapter) headers.push(`@chapter ${episode.Chapter}`)
  if (episode.EpisodeId) headers.push(`@episode ${episode.EpisodeId}`)
  const frames = framesToSceneDsl(episode.EpisodeDetail ?? [], new Map())
  return [headers.join('\n'), frames].filter(Boolean).join('\n\n')
}
