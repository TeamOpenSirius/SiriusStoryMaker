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

  it('keeps intentional empty frames when a scene is edited or imported', () => {
    const frames = compileDsl(':\n: after').episode
    expect(compileDsl(framesToSceneDsl(frames.EpisodeDetail, new Map())).episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['', 'after'])
    expect(compileDsl(decompileEpisode(frames)).episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['', 'after'])
  })
})
