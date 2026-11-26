import { describe, expect, it, vi } from 'vitest'
import { AdventureAnimationStandCharacter } from './characterSpineModel'

vi.mock('@esotericsoftware/spine-pixi', () => ({ Spine: vi.fn() }))

function fakeCharacter() {
  type Entry = { animation: { name: string }; trackTime: number; timeScale: number; loop: boolean }
  const tracks: Array<Entry | undefined> = []
  const setAnimation = vi.fn((index: number, name: string, loop: boolean) =>
    tracks[index] = { animation: { name }, trackTime: 0, timeScale: 1, loop })
  const state = {
    tracks, setAnimation,
    getCurrent: (index: number) => tracks[index],
    clearTrack: (index: number) => { tracks[index] = undefined },
    setEmptyAnimation: (index: number) => setAnimation(index, '<empty>', false),
  }
  const model = { state, visible: true, autoUpdate: true, update: vi.fn(), skeleton: { data: { findAnimation: () => true } } }
  const character: AdventureAnimationStandCharacter = Object.assign(
    Object.create(AdventureAnimationStandCharacter.prototype), { _model: model },
  )
  return { character, model, tracks, setAnimation }
}

const pose = {
  bodyAnimationName: 'body/normal', eyeAnimationName: 'blink', eyeMotionName: 'eyes/normal',
  mouthAnimationName: 'mouth/normal', headAnimationName: 'dir/normal', headMotionName: 'head/nod',
}

describe('inherited Spine tracks', () => {
  it('does not replay motion or blink when a narration frame carries the same pose', () => {
    const { character, tracks, setAnimation } = fakeCharacter()
    character.SetAllAnimation(pose)
    const entries = [...tracks]
    tracks[1]!.trackTime = 2
    setAnimation.mockClear()
    character.SetAllAnimation({ ...pose })
    expect(setAnimation).not.toHaveBeenCalled()
    expect(tracks).toEqual(entries)
    expect(tracks[1]!.trackTime).toBe(2)
  })

  it('updates only changed tracks or an explicitly replayed body/head motion', () => {
    const { character, setAnimation } = fakeCharacter()
    character.SetAllAnimation(pose)
    setAnimation.mockClear()
    const changed = { ...pose, bodyAnimationName: 'body/happy' }
    character.SetAllAnimation(changed)
    expect(setAnimation.mock.calls).toEqual([[1, 'body/happy', false]])
    setAnimation.mockClear()
    character.SetAllAnimation(changed, true)
    expect(setAnimation.mock.calls).toEqual([[1, 'body/happy', false], [8, 'head/nod', false]])
  })

  it('does not restart motion when a scene transition only hides the character temporarily', () => {
    const { character, tracks, setAnimation } = fakeCharacter()
    character.SetAllAnimation(pose)
    const body = tracks[1]
    setAnimation.mockClear()
    character.hideCharacter(false)
    character.showCharacter()
    character.SetAllAnimation(pose)
    expect(tracks[1]).toBe(body)
    expect(setAnimation).not.toHaveBeenCalled()
  })

  it('arms lip sync only for voiced playback and restores tracks after hiding', () => {
    const { character, model, tracks, setAnimation } = fakeCharacter()
    character.SetAllAnimation(pose)
    expect(tracks[5]!.timeScale).toBe(0)
    character.onLipSync()
    expect(tracks[5]!.timeScale).toBe(1)
    character.offLipSync()
    expect(tracks[5]!.timeScale).toBe(0)
    character.hideCharacter()
    expect(model.visible).toBe(false)
    character.showCharacter()
    setAnimation.mockClear()
    character.SetAllAnimation(pose)
    expect(model.visible).toBe(true)
    expect(setAnimation.mock.calls).toEqual([[1, 'body/normal', false], [4, 'blink', false]])
  })
})
