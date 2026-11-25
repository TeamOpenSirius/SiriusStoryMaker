import { describe, expect, it } from 'vitest'
import { compileDsl } from './compiler'
import { decompileEpisode } from './decompiler'

describe('compileDsl', () => {
  it('compiles directives, characters, dialogue, and group orders into IEpisodeModel', () => {
    const script = `
@title 星屑舞台的排练前夜
@chapter 第一章
@episode 1001
@bg adv_bg_001_001 fade=cross camera=6
@char 1 101001 pos=left expr=smile body=happy
心菜: 大家早上好！
+ 今天也要全力以赴！
@effect sepia
: 灯光渐渐暗了下来。
`
    const result = compileDsl(script)
    expect(result.diagnostics).toEqual([])
    expect(result.episode.Title).toBe('星屑舞台的排练前夜')
    expect(result.episode.EpisodeId).toBe(1001)
    expect(result.episode.EpisodeDetail).toHaveLength(3)

    const f0 = result.episode.EpisodeDetail[0]
    expect(f0.BackgroundImageFileName).toBe('adv_bg_001_001')
    expect(f0.BackgroundImageFileFadeType).toBe(4)
    expect(f0.SceneCameraMasterId).toBe(6)
    expect(f0.CharacterMotions[0].SpineId).toBe(101001)
    expect(f0.SpeakerName).toBe('心菜')

    const f1 = result.episode.EpisodeDetail[1]
    expect(f1.Order).toBe(2)
    expect(f1.GroupOrder).toBe(f0.GroupOrder)
    expect(f1.CharacterMotions).toHaveLength(1)
    expect(f1.CharacterMotions[0].SpineId).toBe(101001)

    const f2 = result.episode.EpisodeDetail[2]
    expect(f2.WindowEffect).toBe(1)
    expect(f2.SpeakerName).toBeUndefined()
  })

  it('round-trips IEpisodeModel through decompileEpisode', () => {
    const dsl = `@title 测试\n@chapter 第一章\n@episode 42\n\n@bg 1000 fade=cross\n@char 1 10101 pos=left expr=3 body=2\n心菜: 你好世界`
    const first = compileDsl(dsl).episode
    const text = decompileEpisode(first)
    const second = compileDsl(text).episode
    expect(second.Title).toBe('测试')
    expect(second.EpisodeDetail[0].BackgroundImageFileName).toBe('1000')
    expect(second.EpisodeDetail[0].CharacterMotions[0].SpineId).toBe(10101)
    expect(second.EpisodeDetail[0].Phrase).toBe('你好世界')
  })

  it('reports diagnostics for unknown resource IDs when catalog sets are provided', () => {
    const dsl = `@bg 999999\n@char 1 888888\n心菜: 测试`
    const out = compileDsl(dsl, {
      backgrounds: new Set(['1000']),
      spines: new Set(['10101']),
    })
    expect(out.diagnostics.length).toBe(2)
    expect(out.diagnostics[0].line).toBe(1)
    expect(out.diagnostics[1].line).toBe(2)
  })

  it('allows custom local asset_* background IDs without false-positive diagnostics', () => {
    const out = compileDsl('@bg asset_custom_room fade=cross\n心菜: 本地背景测试', {
      backgrounds: new Set(['1000']),
    })
    expect(out.diagnostics).toEqual([])
  })

  it('resolves @alias character names to Spine IDs and validates them', () => {
    const out = compileDsl('@alias 心菜 10101\n@char 1 心菜 pos=left expr=smile\n心菜: 别名测试\n@clear_chars\n: 退场后', {
      spines: new Set(['10101']),
    })
    expect(out.diagnostics).toEqual([])
    expect(out.episode.EpisodeDetail[0].CharacterMotions[0].SpineId).toBe(10101)
    expect(out.episode.EpisodeDetail[1].CharacterMotions).toEqual([])
  })

  it('persists @effect window filter across frames until @effect none', () => {
    const out = compileDsl('@effect sepia\n心菜: 第一句回忆\n心菜: 第二句回忆\n@effect none\n心菜: 回到现实')
    expect(out.episode.EpisodeDetail[0].WindowEffect).toBe(1)
    expect(out.episode.EpisodeDetail[1].WindowEffect).toBe(1)
    expect(out.episode.EpisodeDetail[2].WindowEffect).toBeUndefined()
  })

  it('deduplicates unchanged @char and @effect directives during decompilation', () => {
    const dsl = `@char 1 10101 pos=center lip=happy\n@effect sepia\n心菜: 第一句\n心菜: 第二句\n@clear_chars\n@effect none\n: 结束`
    const ep = compileDsl(dsl).episode
    const decompiled = decompileEpisode(ep)
    expect(decompiled.match(/@char /g)?.length).toBe(1)
    expect(decompiled.match(/@effect sepia/g)?.length).toBe(1)
    expect(decompiled).toContain('@clear_chars')
    expect(decompiled).toContain('@effect none')
    expect(decompiled).toContain('expr=normal')
    expect(decompiled).toContain('body=normal')
    expect(decompiled).toContain('lip=happy')
  })
})
