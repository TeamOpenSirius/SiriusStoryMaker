import { describe, expect, it } from 'vitest'
import { compileDsl } from '../dsl/compiler'
import { changedPreviewAudio } from './previewAudio'

const makeEpisode = (bgm = '', se = '', voice = '', text = 'Second') => compileDsl(
  `@episode 7\n@scene a${bgm ? ` bgm="${bgm}"` : ''}\n: First\n${se ? `@se ${se}\n` : ''}${voice ? `@voice ${voice}\n` : ''}: ${text}\n: Third`,
).episode

describe('live preview audio edits', () => {
  it('auditions a changed scene BGM even when the selection is not the first frame', () => {
    expect(changedPreviewAudio(makeEpisode('old'), makeEpisode('new'), 1)?.bgm).toBe('new')
    expect(changedPreviewAudio(makeEpisode('old'), makeEpisode('stop'), 1)).toBeUndefined()
  })
  it('auditions SE only on its frame and ignores Vocal or dialogue edits', () => {
    const before = makeEpisode('same')
    const after = makeEpisode('same', 'tap', 'line')
    expect(changedPreviewAudio(before, after, 1)?.se).toBe('tap')
    expect(changedPreviewAudio(before, after, 2)).toBeUndefined()
    expect(changedPreviewAudio(after, makeEpisode('same', 'tap', 'other', 'Edited'), 1)).toBeUndefined()
  })
})
