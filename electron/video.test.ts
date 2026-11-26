import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { probeFfmpeg, VideoJob } from './video'

describe('video output ownership and cleanup', () => {
  let dir: string
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-video-test-')) })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('rejects a missing executable without throwing out of the setup wizard', async () => {
    expect(await probeFfmpeg(path.join(dir, 'not-ffmpeg'))).toMatchObject({ path: null, error: expect.any(String) })
  })

  it('does not alter the destination if recording is empty or cancelled', async () => {
    const destination = path.join(dir, 'episode.mp4')
    await fs.writeFile(destination, 'prior video')
    const empty = await VideoJob.create(destination, 'unused')
    await expect(empty.finish()).rejects.toThrow('没有录制到画面')
    const job = await VideoJob.create(destination, 'unused')
    await job.append(new Uint8Array([1, 2, 3]).buffer)
    await job.cancel()
    await expect(job.finish()).rejects.toThrow('录像已结束')
    expect(await fs.readFile(destination, 'utf8')).toBe('prior video')
    expect(await fs.readdir(dir)).toEqual(['episode.mp4'])
  })
})
