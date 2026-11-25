import { describe, expect, it } from 'vitest'
import { compileDsl } from './compiler'
import { parseStoryGraph, serializeStoryGraph } from './graph'

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
      '走了左路',
    ])
  })
})
