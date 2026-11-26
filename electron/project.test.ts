import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addProjectAsset, buildProjectPackage, createProject, openProject, projectPath, removeProjectAsset, writeAtomic } from './project'

function unpack(buffer: Buffer) {
  const entries = new Map<string, Buffer>()
  let cursor = 0
  while (buffer.readUInt32LE(cursor) === 0x04034b50) {
    const method = buffer.readUInt16LE(cursor + 8)
    const bodyLength = buffer.readUInt32LE(cursor + 18)
    const nameLength = buffer.readUInt16LE(cursor + 26)
    const extraLength = buffer.readUInt16LE(cursor + 28)
    const name = buffer.toString('utf8', cursor + 30, cursor + 30 + nameLength)
    cursor += 30 + nameLength + extraLength
    const data = buffer.subarray(cursor, cursor + bodyLength)
    entries.set(name, method === 8 ? inflateRawSync(data) : data)
    cursor += bodyLength
  }
  return entries
}

describe('desktop project storage', () => {
  let temp: string
  let directory: string
  const story = '@title Project Test\n: Hello\n'
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-project-test-'))
    directory = path.join(temp, '项目')
    await fs.mkdir(directory)
  })
  afterEach(() => fs.rm(temp, { recursive: true, force: true }))

  it('creates a movable index, preserves unrelated files and reopens the edited DSL', async () => {
    await fs.writeFile(path.join(directory, 'notes.txt'), 'keep')
    const project = await createProject(directory, '我的项目', story)
    expect(project.manifest.story).toBe('story.dsl')
    expect(await fs.readdir(directory)).toEqual(['ai-cache', 'assets', 'notes.txt', 'project.sav', 'story.dsl'])
    await writeAtomic(path.join(directory, project.manifest.story), story + ': Updated\n')
    const moved = path.join(temp, 'moved')
    await fs.rename(directory, moved)
    const reopened = await openProject(path.join(moved, 'project.sav'))
    expect(reopened.content).toBe(story + ': Updated\n')
    expect(reopened.manifest.title).toBe('我的项目')
  })

  it('does not replace an existing project or partial paths', async () => {
    await fs.writeFile(path.join(directory, 'story.dsl'), 'original')
    await expect(createProject(directory, 'new', story)).rejects.toThrow('已有同名')
    expect(await fs.readdir(directory)).toEqual(['story.dsl'])
    expect(await fs.readFile(path.join(directory, 'story.dsl'), 'utf8')).toBe('original')
  })

  it('indexes and packages unmodified image, music, effect and voice bytes without AI cache', async () => {
    const project = await createProject(directory, 'Case', story)
    const seeds = [
      ['background', '测试.webp', Buffer.from('image bytes')],
      ['bgm', 'score.ogg', Buffer.from('OggS score bytes')],
      ['se', 'sound.mp3', Buffer.from('ID3 effect bytes')],
      ['voice', '对白.wav', Buffer.from('RIFF voice bytes')],
    ] as const
    const assets = []
    for (const [kind, name, data] of seeds) {
      const source = path.join(temp, name)
      await fs.writeFile(source, data)
      assets.push(await addProjectAsset(project, kind, source))
    }
    await fs.writeFile(path.join(directory, project.manifest.aiCache, 'history.json'), 'private project state')
    const loaded = await openProject(project.filePath)
    expect(loaded.manifest.assets).toEqual(assets)
    const episode = JSON.stringify({ Title: 'Case', EpisodeDetail: [{ VoiceFileName: assets[3].id }] })
    const zip = unpack(await buildProjectPackage(loaded, { json: episode, storyDsl: story }))
    const index = JSON.parse(zip.get('manifest.json')!.toString())
    expect(index.episodeFile).toBe('episode.json')
    expect(index.storyFile).toBe('story.dsl')
    expect(zip.get(index.episodeFile)?.toString()).toBe(episode)
    expect(zip.get(index.storyFile)?.toString()).toBe(story)
    expect(index.assets).toEqual(assets)
    for (const [i, item] of assets.entries()) {
      expect(path.extname(item.file)).toBe(path.extname(seeds[i][1]))
      expect(zip.get(item.file)).toEqual(seeds[i][2])
    }
    expect([...zip.keys()].some((name) => name.includes('ai-cache'))).toBe(false)
    await fs.rm(projectPath(loaded.root, assets[3].file))
    await expect(buildProjectPackage(loaded, { json: episode })).rejects.toThrow('缺少项目素材')
  })

  it('rejects non-relative or malformed index paths', async () => {
    const project = await createProject(directory, 'Case', story)
    await writeAtomic(project.filePath, JSON.stringify({ ...project.manifest, story: '../outside.dsl' }))
    await expect(openProject(project.filePath)).rejects.toThrow('无效的相对路径')
  })

  it('removes a project asset from manifest and disk', async () => {
    const project = await createProject(directory, 'RemoveCase', story)
    const src = path.join(temp, 'bg.png')
    await fs.writeFile(src, Buffer.from('png'))
    const asset = await addProjectAsset(project, 'background', src)
    const assetDiskPath = projectPath(project.root, asset.file)
    expect(await fs.readFile(assetDiskPath)).toEqual(Buffer.from('png'))
    const remaining = await removeProjectAsset(project, 'background', asset.id)
    expect(remaining).toEqual([])
    const reopened = await openProject(project.filePath)
    expect(reopened.manifest.assets).toEqual([])
    await expect(fs.stat(assetDiskPath)).rejects.toThrow()
  })
})
