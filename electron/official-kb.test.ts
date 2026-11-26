import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { executeStudioMcpTool, STUDIO_MCP_TOOLS } from './mcp-server'

let directory: string
let db: string
beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'sirius-kb-test-'))
  const episodes = path.join(directory, 'source')
  mkdirSync(episodes)
  db = path.join(directory, 'fixture.sqlite')
  writeFileSync(path.join(episodes, 'test-a.json'), JSON.stringify({
    EpisodeId: 42, Title: '登台', Chapter: '演出', Next: 43, EpisodeDetail: [
      { SpeakerName: '心菜', Phrase: '走到排练室门口%_', BackgroundImageFileName: '1000', BgmFileName: 23,
        CharacterMotions: [{ slotNumber: 1, SpineId: 10101, BodyMotionMasterId: 2 }] },
      { Phrase: '脚步声近了', SeFileName: '101' },
      { Phrase: '走到舞台上', BackgroundImageFileName: '1010' },
      { Phrase: '音乐停了', BgmFileName: 999, SeFileName: 'not_in_catalog' },
    ],
  }))
  writeFileSync(path.join(episodes, 'test-b.json'), JSON.stringify({
    EpisodeId: 43, Title: '落幕', Chapter: '演出', Prev: 42, EpisodeDetail: [
      { Phrase: '重新排练', BackgroundImageFileName: '1000', BgmFileName: '23' },
      { Phrase: '退到侧台', SeFileName: '101' },
    ],
  }))
  execFileSync(process.execPath, ['scripts/build-official-kb.mjs'], {
    env: { ...process.env, SIRIUS_EPISODE_DIR: episodes, SIRIUS_KB_PATH: db },
  })
  rmSync(episodes, { recursive: true })
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const query = async (name: string, args: Record<string, unknown>) => JSON.parse(
  await executeStudioMcpTool(name, args, { storyFile: 'not-needed.dsl', kbPath: db }),
)

describe('bundled official story SQLite graph', () => {
  it('searches Chinese full dialogue and treats wildcard characters literally', async () => {
    const indexed = await query('search_official_episodes', { query: '排练室', speaker: '心菜' })
    expect(indexed.totalMatches).toBe(1)
    expect(indexed.episodes[0]).toMatchObject({ id: 42, sceneId: 1, startLine: 1 })
    expect((await query('search_official_episodes', { query: '%_' })).episodes.map((e: {id: number}) => e.id)).toEqual([42])
  })

  it('retrieves official dialogue and direction without the source files', async () => {
    const episode = await query('inspect_official_episode', { episodeId: 42 })
    expect(episode).toMatchObject({ nextEpisodeId: 43, totalLines: 4 })
    expect(episode.lines[0].chars[0]).toMatchObject({ spine: 10101, body: 2 })
    expect(episode.lines.map((line: { activeBgm: string | null }) => line.activeBgm)).toEqual(['23','23','23',null])
    expect((await query('study_character', { name: '心菜' })).topSpines).toEqual([{ id: 10101, count: 1 }])
  })

  it('follows adjacent scenes and finds related episodes by shared resources', async () => {
    const first = await query('trace_official_scene', { sceneId: 1 })
    expect(first).toMatchObject({ nextSceneId: 2, startLine: 1, endLine: 2, background: '1000' })
    expect(first.relatedScenes[0]).toMatchObject({ sceneId: 3, episodeId: 43, sharedResources: 3 })
    const next = await query('trace_official_scene', { sceneId: 2 })
    expect(next.resources).toContainEqual(expect.objectContaining({ kind: 'bgm', id: '23', cueCount: 0, activeFrames: 1 }))
  })

  it('returns evidence for available assets and separates uncatalogued exact lookups', async () => {
    expect(STUDIO_MCP_TOOLS.map(t => t.name)).toContain('search_official_asset_usage')
    const effect = await query('search_official_asset_usage', { kind: 'se', query: '脚步', background: '1000', bgm: '23' })
    expect(effect.matches[0]).toMatchObject({ id: '101', inCatalog: true, cueCount: 1,
      examples: [{ episodeId: 42, line: 2, activeBgm: '23', distanceToKeyword: 0 }] })
    expect((await query('search_official_asset_usage', { kind: 'se', query: '音乐停了' })).matches).toEqual([])
    expect((await query('search_official_asset_usage', { kind: 'se', id: 'not_in_catalog' })).matches[0])
      .toMatchObject({ inCatalog: false, id: 'not_in_catalog' })
  })
})
