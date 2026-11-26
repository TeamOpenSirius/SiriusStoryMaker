import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundController } from './soundController'

const assets = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@pixi/assets', () => ({ Assets: { cache: assets, get: (name: string) => assets.get(name) } }))
vi.mock('@pixi/sound', () => ({ sound: { disableAutoPause: false, volumeAll: 1 } }))

function clip(alias: string) {
  const value = { play: vi.fn(() => ({ on: vi.fn() })), stop: vi.fn(), volume: 1, duration: 1 }
  assets.set(alias, value)
  return value
}

beforeEach(() => assets.clear())

describe('scene music playback', () => {
  it('keeps the current loop when a seek resolves a cue and the target frame repeats it', () => {
    const music = clip('bgm_opening')
    const effect = clip('se_door')
    const controller = new SoundController()
    controller.sound({ BgmFileName: 'opening', SeFileName: 'door' })
    controller.stopPrevSound()
    controller.playBgm('opening')
    controller.sound({ BgmFileName: 'opening', SeFileName: 'door' })
    expect(music.play).toHaveBeenCalledTimes(1)
    expect(music.stop).not.toHaveBeenCalled()
    expect(effect.play).toHaveBeenCalledTimes(2)
  })

  it('replaces different music and permits a fresh start after an explicit stop', () => {
    const opening = clip('bgm_opening')
    const next = clip('bgm_next')
    const controller = new SoundController()
    controller.playBgm('opening')
    controller.playBgm('next')
    controller.sound({ BgmFileName: '999' })
    controller.playBgm('next')
    expect(opening.stop).toHaveBeenCalledTimes(1)
    expect(next.stop).toHaveBeenCalledTimes(1)
    expect(next.play).toHaveBeenCalledTimes(2)
  })
})
