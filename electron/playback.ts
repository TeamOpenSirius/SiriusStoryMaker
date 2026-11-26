import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECT_ASSET_KINDS, type ProjectAssetKind } from '../src/shared/project'
import type { PlaybackFile } from '../src/shared/playback'
import type { IEpisodeModel } from '../player/src/types/Episode'
import { openZip } from './zip'

const MiB = 1024 * 1024
const extensions: Record<ProjectAssetKind, string[]> = {
  background: ['png', 'jpg', 'jpeg', 'webp'],
  bgm: ['mp3', 'ogg', 'wav'],
  se: ['mp3', 'ogg', 'wav'],
  voice: ['mp3', 'ogg', 'wav'],
}
const fields = { background: 'BackgroundImageFileName', bgm: 'BgmFileName', se: 'SeFileName', voice: 'VoiceFileName' } as const

type Asset = { filename: string; read: () => Promise<Buffer> }
export type OpenPlayback = Omit<PlaybackFile, 'assetBase'> & { assets: Map<string, Asset> }

async function readLimited(file: string, limit: number) {
  if ((await fs.stat(file)).size > limit) throw new Error('剧情文件超出大小限制')
  return fs.readFile(file)
}

function parseEpisode(data: Buffer): IEpisodeModel {
  const value = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''))
  if (!value || !Array.isArray(value.EpisodeDetail) || value.EpisodeDetail.length === 0 ||
      value.EpisodeDetail.some((frame: unknown) => frame == null || typeof frame !== 'object' || Array.isArray(frame))) {
    throw new Error('此文件不含可播放的 ADV 剧情帧')
  }
  // Original ADV data can omit optional empty dialogue/motions on instruction frames.
  value.EpisodeDetail = value.EpisodeDetail.map((frame: Record<string, unknown>) => ({
    ...frame, Phrase: String(frame.Phrase ?? ''), CharacterMotions: Array.isArray(frame.CharacterMotions) ? frame.CharacterMotions.filter(Boolean) : [],
  }))
  return value
}

export async function openPlayback(file: string): Promise<OpenPlayback> {
  const name = path.basename(file)
  const assets = new Map<string, Asset>()
  const ext = path.extname(file).toLowerCase()
  let episode: IEpisodeModel
  if (ext === '.zip') {
    const zip = openZip(await readLimited(file, 512 * MiB))
    const manifest = JSON.parse(zip.read('manifest.json', 2 * MiB).toString('utf8'))
    if (manifest?.format !== 'sirius-adv-package' || manifest.version !== 1 ||
        typeof manifest.episodeFile !== 'string' || !/^[\w.-]+\.json$/i.test(manifest.episodeFile) || !Array.isArray(manifest.assets)) {
      throw new Error('仅支持 SiriusStoryMaker 导出的 ZIP 作品包')
    }
    episode = parseEpisode(zip.read(manifest.episodeFile, 32 * MiB))
    for (const asset of manifest.assets) {
      const route = typeof asset === 'string' ? asset : asset?.file
      const match = typeof route === 'string' && /^assets\/(background|bgm|se|voice)\/(asset_[\w-]+)\.([a-z0-9]+)$/i.exec(route)
      if (!match) throw new Error('作品包中的素材索引无效')
      const [, kind, id, format] = match as RegExpExecArray
      if (!extensions[kind as ProjectAssetKind]?.includes(format.toLowerCase()) ||
          (typeof asset !== 'string' && (asset.kind !== kind || asset.id !== id))) throw new Error('作品包中的素材类型不匹配')
      if (!zip.has(route)) throw new Error(`作品包缺少素材 ${route}`)
      assets.set(`${kind}/${id}`, { filename: route, read: async () => zip.read(route, 256 * MiB) })
    }
  } else if (ext === '.json') {
    episode = parseEpisode(await readLimited(file, 32 * MiB))
  } else throw new Error('请选择 ZIP 作品包或 ADV JSON')
  const missingAssets = new Set<string>()
  for (const kind of PROJECT_ASSET_KINDS) {
    const ids = new Set(episode.EpisodeDetail.map((frame) => frame[fields[kind]]).filter((id): id is string => typeof id === 'string' && /^asset_[\w-]+$/.test(id)))
    for (const id of ids) {
      const key = `${kind}/${id}`
      if (assets.has(key)) continue
      if (ext === '.json') {
        for (const suffix of extensions[kind]) {
          const candidate = path.join(path.dirname(file), 'assets', kind, `${id}.${suffix}`)
          if ((await fs.stat(candidate).catch(() => null))?.isFile()) {
            assets.set(key, { filename: candidate, read: () => readLimited(candidate, 256 * MiB) })
            break
          }
        }
      }
      if (!assets.has(key)) missingAssets.add(key)
    }
  }
  return { name, episode, assets, missingAssets: [...missingAssets] }
}
