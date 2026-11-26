import type { IEpisodeModel } from '../../player/src/types/Episode'

export interface PlaybackFile {
  name: string
  episode: IEpisodeModel
  assetBase: string
  missingAssets: string[]
}

export interface FfmpegStatus {
  path: string | null
  version?: string
  error?: string
}
