import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openPlayback } from './playback'
import { createZipBuffer, openZip } from './zip'

const episode = {
  Title: 'Stage', EpisodeId: 42,
  EpisodeDetail: [{ Phrase: 'start', BackgroundImageFileName: 'asset_backdrop', BgmFileName: 'asset_music' }],
}
const bg = 'assets/background/asset_backdrop.png'
const audio = 'assets/bgm/asset_music.wav'

describe('standalone episode loading', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-playback-test-')) })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  async function makeArchive(assets: unknown[], name = 'episode.zip') {
    const output = path.join(dir, name)
    await fs.writeFile(output, createZipBuffer([
      { name: 'episode.json', data: JSON.stringify(episode) },
      { name: 'manifest.json', data: JSON.stringify({ format: 'sirius-adv-package', version: 1, episodeFile: 'episode.json', assets }) },
      { name: bg, data: 'picture' },
      { name: audio, data: Buffer.alloc(4000, 0x41) },
    ]))
    return output
  }

  it('plays a studio ZIP and reads media with its real extension without extracting it', async () => {
    const file = await makeArchive([
      { id: 'asset_backdrop', kind: 'background', file: bg },
      { id: 'asset_music', kind: 'bgm', file: audio },
    ])
    const loaded = await openPlayback(file)
    expect(loaded.episode.Title).toBe('Stage')
    expect(loaded.episode.EpisodeDetail[0].CharacterMotions).toEqual([])
    expect(loaded.missingAssets).toEqual([])
    expect((await loaded.assets.get('background/asset_backdrop')?.read())?.toString()).toBe('picture')
    expect(await loaded.assets.get('bgm/asset_music')?.read()).toEqual(Buffer.alloc(4000, 0x41))
    expect(await fs.readdir(dir)).toEqual(['episode.zip'])
  })

  it('supports the older string asset index and rejects an invalid manifest path', async () => {
    expect((await openPlayback(await makeArchive([bg, audio]))).missingAssets).toEqual([])
    const invalid = await makeArchive(['../elsewhere.wav'], 'bad.zip')
    await expect(openPlayback(invalid)).rejects.toThrow('素材索引无效')
  })

  it('loads a loose ADV JSON and reports missing sibling assets instead of failing the episode', async () => {
    const file = path.join(dir, 'episode.json')
    await fs.mkdir(path.join(dir, 'assets', 'bgm'), { recursive: true })
    await fs.writeFile(path.join(dir, audio), 'audio')
    await fs.writeFile(file, '\uFEFF' + JSON.stringify(episode))
    const loaded = await openPlayback(file)
    expect(loaded.missingAssets).toEqual(['background/asset_backdrop'])
    expect((await loaded.assets.get('bgm/asset_music')?.read())?.toString()).toBe('audio')
  })

  it('rejects corrupt entries and excessive expansion before serving them', () => {
    const archive = createZipBuffer([{ name: 'asset', data: Buffer.alloc(3000, 0x55) }])
    expect(() => openZip(archive).read('asset', 10)).toThrow('大小限制')
    expect(() => openZip(archive.subarray(0, 40))).toThrow('ZIP')
    const stored = createZipBuffer([{ name: 'x', data: 'original' }])
    stored[31] ^= 0xff
    expect(() => openZip(stored).read('x', 100)).toThrow('ZIP')
  })
})
