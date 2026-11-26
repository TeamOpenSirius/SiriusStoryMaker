import { describe, expect, it } from 'vitest'
import { indexStageCues } from './stageCues'

describe('stage cues for random seeks', () => {
  it('restores inherited cues in either seek direction and honors clear and stop', () => {
    const indexed = indexStageCues([
      {},
      { BackgroundImageFileName: 'room', BgmFileName: 'theme' },
      { StillPhotoFileName: 'photo' },
      {},
      { BackgroundImageFileName: 'room' },
      { BgmFileName: '999' },
      { BackgroundImageFileName: 'hall', StillPhotoFileName: 'cutaway', BgmFileName: 'encore' },
    ])
    expect(indexed[6]).toEqual({ background: 'hall', still: 'cutaway', music: 'encore' })
    expect(indexed[5]).toEqual({ background: 'room', still: undefined, music: undefined })
    expect(indexed[4]).toEqual({ background: 'room', still: undefined, music: 'theme' })
    expect(indexed[2]).toEqual({ background: 'room', still: 'photo', music: 'theme' })
    expect(indexed[3]).toBe(indexed[2])
    expect(indexed[0]).toEqual({})
  })

  it('does not carry state into a newly loaded episode', () => {
    expect(indexStageCues([{ BgmFileName: 'theme' }])[0].music).toBe('theme')
    expect(indexStageCues([{}])[0].music).toBeUndefined()
    expect(indexStageCues([])).toEqual([])
  })
})
