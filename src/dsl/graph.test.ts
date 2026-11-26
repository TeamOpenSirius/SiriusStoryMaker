import { describe, expect, it } from 'vitest'
import { compileDsl } from './compiler'
import { getSceneBgm, parseStoryGraph, serializeStoryGraph, setSceneBgm } from './graph'
import { computeSceneChanges, framesToSceneDsl, getSceneVisualFrames } from './sceneFrames'

describe('StoryGraph DSL', () => {
  it('parses @scene nodes, wires, and choices and round-trips cleanly', () => {
    const src = `@title 测试图\n@alias 心菜 10101\n\n@scene s1 title="开场" x=50 y=80\n心菜: 第一幕\n-> s2\n\n@scene s2 title="分支" x=320 y=80\n@choice "去结局" -> s3\n@choice "回开场" -> s1\n\n@scene s3 title="结局" x=600 y=80\n: 结束\n`
    const doc = parseStoryGraph(src)
    expect(doc.hasExplicitScenes).toBe(true)
    expect(doc.nodes).toHaveLength(3)
    expect(doc.nodes[0].next).toBe('s2')
    expect(doc.nodes[1].choices).toHaveLength(2)

    const reserialized = serializeStoryGraph(doc)
    const reparsed = parseStoryGraph(reserialized)
    expect(reparsed.nodes.map((n) => n.id)).toEqual(['s1', 's2', 's3'])
  })

  it('compiles connected @scene nodes in wire order and tracks sceneStartFrames', () => {
    const src = `
@title 连线顺序测试
@scene a title="A" x=0 y=0
心菜: A 句
-> c

@scene b title="B" x=100 y=0
心菜: B 句

@scene c title="C" x=200 y=0
心菜: C 句
-> b
`
    const out = compileDsl(src)
    expect(out.diagnostics).toEqual([])
    expect(out.episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['A 句', 'C 句', 'B 句'])
    expect(out.sceneStartFrames.get('a')).toBe(0)
    expect(out.sceneStartFrames.get('c')).toBe(1)
    expect(out.sceneStartFrames.get('b')).toBe(2)
  })

  it('follows selected activeChoices branch during compilation', () => {
    const src = `
@scene s1 title="入口"
心菜: 选哪条路？
@choice "左路" -> left
@choice "右路" -> right

@scene left title="左"
心菜: 走了左路

@scene right title="右"
心菜: 走了右路
`
    const outRight = compileDsl(src, undefined, { s1: 1 })
    expect(outRight.episode.EpisodeDetail.map((f) => f.Phrase)).toEqual([
      '选哪条路？',
      '走了右路',
    ])
  })

  it('does not include disconnected scenes or another branch in the export route', () => {
    const source = `@scene start
: Start
-> draft
@choice "Finish" -> final
@scene draft
: Draft only
@scene final
: End`
    const route = compileDsl(source)
    expect(route.episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['Start', 'End'])
    expect(route.sceneStartFrames.has('draft')).toBe(false)
    expect(compileDsl(source, undefined, {}, 'draft').episode.EpisodeDetail.map((f) => f.Phrase)).toEqual(['Draft only'])
    expect(parseStoryGraph(source).nodes.map((n) => n.id)).toEqual(['start', 'draft', 'final'])
  })

  it('does not map an empty scene to the following scene’s first frame', () => {
    const source = '@scene empty\n-> next\n@scene next\n: First frame'
    const route = compileDsl(source)
    expect(route.sceneStartFrames.has('empty')).toBe(false)
    expect(route.sceneStartFrames.get('next')).toBe(0)
  })

  it('keeps music on scene entry when frames move, with SE and Vocal staying on their frame', () => {
    const source = `@scene entry title="Opening" bgm="asset_open"
: First
@se asset_tap
@voice asset_line
: Second
-> next
@scene next bgm="asset_next"
: Third
-> final
@scene final bgm="stop"
: Last`
    const doc = parseStoryGraph(source)
    const initial = compileDsl(source)
    const frames = getSceneVisualFrames(doc, initial.sceneStartFrames).get('entry')!
    expect(frames.every(({ frame }) => !frame.BgmFileName)).toBe(true)
    doc.nodes[0].body = framesToSceneDsl(frames.reverse().map(({ frame }) => frame), new Map())
    const edited = serializeStoryGraph(doc)
    const output = compileDsl(edited)
    expect(output.diagnostics).toEqual([])
    expect(output.episode.EpisodeDetail.map(f => [
      f.Phrase, f.BgmFileName, f.SeFileName, f.VoiceFileName,
    ])).toEqual([
      ['Second', 'asset_open', 'asset_tap', 'asset_line'],
      ['First', undefined, undefined, undefined],
      ['Third', 'asset_next', undefined, undefined],
      ['Last', '999', undefined, undefined],
    ])
    expect(output.sceneStartFrames.get('next')).toBe(2)
    expect(edited).not.toContain('@bgm')
  })

  it('inherits music by default and emits native stop cues only when requested', () => {
    const src = `@scene opening bgm="asset_song"
: Opening
-> silent
@scene silent
: Silence
-> scored
@scene scored bgm="asset_next"
: New song
-> bridge
@scene bridge
-> encore
@scene encore bgm="inherit"
: Keep the song
: Keep going
-> closing
@scene closing bgm="stop"
: No song
-> empty
@scene empty`
    const output = compileDsl(src)
    expect(output.diagnostics).toEqual([])
    expect(output.episode.EpisodeDetail.map(frame => frame.BgmFileName))
      .toEqual(['asset_song', undefined, 'asset_next', undefined, undefined, '999'])
    expect(output.sceneStartFrames.has('bridge')).toBe(false)
    expect(output.sceneStartFrames.has('empty')).toBe(false)
    expect(serializeStoryGraph(parseStoryGraph(src))).toContain('bgm="inherit"')
    expect(compileDsl(src, undefined, {}, 'encore').episode.EpisodeDetail[0].BgmFileName).toBeUndefined()
  })

  it('moves an old entry cue to the scene header, while preserving later scripted cues', () => {
    const old = '@scene a\n@bgm old\n: First\n@bgm mid\n: Second'
    const graph = parseStoryGraph(old)
    expect(getSceneBgm(graph.nodes[0])).toBe('old')
    expect(graph.nodes[0].body).not.toContain('@bgm old')
    expect(compileDsl(serializeStoryGraph(graph)).episode.EpisodeDetail.map(f => f.BgmFileName)).toEqual(['old', 'mid'])
    setSceneBgm(graph.nodes[0], '999')
    const updated = serializeStoryGraph(graph)
    expect(updated).toContain('bgm="stop"')
    expect(updated).not.toContain('@bgm old')
    expect(updated).toContain('@bgm mid')
    expect(compileDsl(updated).episode.EpisodeDetail.map(f => f.BgmFileName)).toEqual(['999', 'mid'])
    setSceneBgm(graph.nodes[0], '')
    const inherit = serializeStoryGraph(graph)
    expect(computeSceneChanges(updated, inherit).get('a')).toBe('modified')
    expect(compileDsl(inherit).episode.EpisodeDetail.map(f => f.BgmFileName)).toEqual([undefined, 'mid'])
  })

  it('validates disconnected wires against the original source lines', () => {
    const src = '@scene start\n: Main\n@scene unused\n: Other\n@choice "Missing" -> gone\n-> also_missing'
    const out = compileDsl(src)
    expect(out.episode.EpisodeDetail.map(f => f.Phrase)).toEqual(['Main'])
    expect(out.diagnostics.map(d => d.line)).toEqual([5, 6])
  })

  it('reports diagnostics for dangling -> or @choice scene targets', () => {
    const src = `@scene s1 title="A"\n心菜: 测试\n-> missing_scene\n`
    const out = compileDsl(src)
    expect(out.diagnostics).toHaveLength(1)
    expect(out.diagnostics[0].line).toBe(3)
    expect(out.diagnostics[0].message).toContain('missing_scene')
  })
})
