import { describe, expect, it } from 'vitest'
import { compileDsl } from './compiler'
import { decodeDialoguePhrase } from './dialogue'
import { decompileEpisode } from './decompiler'
import { parseStoryGraph } from './graph'
import { createSceneFrameResolver, framesToSceneDsl, parseAliasMap, replaceSceneDialogue } from './sceneFrames'

const preamble = '@title QA\n@alias 心菜 10101'
const rich = [
  '# Preserve this note',
  '@bg 1000 camera=3',
  '@fade time 0.4 0.5 0.6',
  '@movie stage_intro',
  '@card 10101',
  '@effect sepia',
  '@effect splash',
  '@char 1 心菜 pos=right expr=smile body=happy appear=left size=large layer=2 head=4 dir=1 lip=3',
  '@bgm score',
  '@se effect',
  '@voice voice',
  '心菜: Before edit',
  '@clear_chars',
  '@effect none',
  ':',
].join('\n')

describe('visual scene editing', () => {
  it('edits a single dialogue line without rewriting other scene source', () => {
    const next = replaceSceneDialogue(preamble, rich, 0, (frame) => { frame.Phrase = 'After edit' })
    expect(next).toEqual(rich.replace('Before edit', 'After edit'))
  })

  it('stores multiple line breaks in one WDS frame, retaining following directives and text', () => {
    const next = replaceSceneDialogue(preamble, rich, 0, (frame) => {
      frame.Phrase = '第一行\r\n第二行\n\n第四行'
    })!
    const result = compileDsl(preamble + '\n' + next)
    expect(result.diagnostics).toEqual([])
    expect(result.episode.EpisodeDetail).toHaveLength(2)
    expect(result.episode.EpisodeDetail[0].Phrase).toBe('第一行/n第二行/n/n第四行')
    expect(decodeDialoguePhrase(result.episode.EpisodeDetail[0].Phrase)).toBe('第一行\n第二行\n\n第四行')
    expect(result.episode.EpisodeDetail[1].CharacterMotions).toEqual([])
  })

  it('accepts standard and legacy break markers in dialogue, narration and continuation frames', () => {
    const source = [
      String.raw`心菜: 一\n二/n三`,
      String.raw`+ 四\n五`,
      String.raw`: 六\n\n八`,
    ].join('\n')
    const result = compileDsl(source)
    expect(result.diagnostics).toEqual([])
    expect(result.episode.EpisodeDetail.map(f => f.Phrase)).toEqual(['一/n二/n三', '四/n五', '六/n/n八'])
    expect(result.episode.EpisodeDetail.map(f => f.Order)).toEqual([1, 2, 1])
    expect(decodeDialoguePhrase(String.raw`导入 ADV\n第二行/n第三行`)).toBe('导入 ADV\n第二行\n第三行')
  })

  it('round-trips supported stage and character fields when frames are rebuilt', () => {
    const original = compileDsl(preamble + '\n' + rich).episode.EpisodeDetail
    const next = framesToSceneDsl(original, parseAliasMap(preamble))
    const result = compileDsl(preamble + '\n' + next)
    expect(result.diagnostics).toEqual([])
    expect(result.episode.EpisodeDetail).toEqual(original)
    const imported = decompileEpisode(compileDsl(preamble + '\n' + rich).episode)
    expect(compileDsl(imported).episode.EpisodeDetail).toEqual(original)
  })

  it('reuses unchanged local frames across edits and recalculates their route index', () => {
    const resolve = createSceneFrameResolver()
    const source = '@episode 7\n@scene a x=10\n: A\n@scene b\n: B'
    const first = resolve(parseStoryGraph(source), new Map([['a', 0], ['b', 1]]))
    const moved = resolve(parseStoryGraph(source.replace('x=10', 'x=50')), new Map([['a', 0], ['b', 1]]))
    expect(moved.get('a')).toBe(first.get('a'))
    expect(moved.get('b')).toBe(first.get('b'))

    const edited = resolve(parseStoryGraph(source.replace(': A', ': A\n: More')), new Map([['a', 0], ['b', 2]]))
    expect(edited.get('a')).toHaveLength(2)
    expect(edited.get('b')?.[0].frame).toBe(first.get('b')?.[0].frame)
    expect(edited.get('b')?.[0].globalIdx).toBe(2)
    expect(first.get('b')?.[0].globalIdx).toBe(1)

    const rerouted = resolve(parseStoryGraph(source), new Map([['a', 0]]))
    expect(rerouted.get('b')?.[0].globalIdx).toBeNull()
    const changedPreamble = resolve(parseStoryGraph(source.replace('@episode 7', '@episode 8')), new Map([['b', 0]]))
    expect(changedPreamble.get('b')?.[0].frame.EpisodeMasterId).toBe(8)
    expect(changedPreamble.get('b')?.[0].frame).not.toBe(first.get('b')?.[0].frame)
  })

  it('round-trips a deliberate replay without propagating it to later narration', () => {
    const source = '@char 1 10101 body=happy\n: Start\n@char 1 10101 replay=true\n: Again\n: Hold'
    const original = compileDsl(source).episode
    expect(original.EpisodeDetail.map(f => f.CharacterMotions[0].ReplayMotion)).toEqual([undefined, true, undefined])
    const edited = decompileEpisode(original)
    expect(edited.match(/replay=true/g)).toHaveLength(1)
    expect(compileDsl(edited).episode.EpisodeDetail).toEqual(original.EpisodeDetail)
  })

  it('keeps intentional empty frames when a scene is edited or imported', () => {
    const frames = compileDsl(':\n: after').episode
    expect(compileDsl(framesToSceneDsl(frames.EpisodeDetail, new Map())).episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['', 'after'])
    expect(compileDsl(decompileEpisode(frames)).episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['', 'after'])
  })
})
