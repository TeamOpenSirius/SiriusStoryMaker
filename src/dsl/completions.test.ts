import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { describe, expect, it } from 'vitest'
import { createDslCompletionSource } from './completions'
import type { ResourceCatalog } from '../services/resourceCatalog'

const mockCatalog: ResourceCatalog = {
  backgrounds: ['1000', '1001'],
  spines: ['10101', '10102'],
  stills: [],
  cards: [],
  bgms: ['bgm_001'],
  ses: ['se_001'],
}

function completeAt(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc })
  const source = createDslCompletionSource(() => mockCatalog)
  return source(new CompletionContext(state, pos, true))
}

describe('createDslCompletionSource', () => {
  it('completes @directives at line start', () => {
    const res = completeAt('@b')
    expect(res?.options.some((o) => o.label === '@bg')).toBe(true)
    expect(res?.options.some((o) => o.label === '@bgm')).toBe(true)
  })

  it('completes expr= enum values', () => {
    const res = completeAt('@char 1 10101 expr=sm')
    expect(res?.options.some((o) => o.label === 'smile')).toBe(true)
  })

  it('completes @bg resource IDs from catalog', () => {
    const res = completeAt('@bg 10')
    expect(res?.options.map((o) => o.label)).toEqual(['1000', '1001'])
  })

  it('completes @alias names and Spine IDs for @char', () => {
    const res = completeAt('@alias 心菜 10101\n@char 1 心')
    expect(res?.options.some((o) => o.label === '心菜')).toBe(true)
    expect(res?.options.some((o) => o.label === '10101')).toBe(true)
  })

  it('completes @scene target IDs after ->', () => {
    const res = completeAt('@scene start title="开场"\n@scene ending title="结局"\n-> en')
    expect(res?.options.some((o) => o.label === 'ending')).toBe(true)
  })
})
