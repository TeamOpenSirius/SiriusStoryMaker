import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { FfmpegStatus } from '../src/shared/playback'

const exec = promisify(execFile)

export async function probeFfmpeg(executable: string): Promise<FfmpegStatus> {
  try {
    const { stdout } = await exec(executable, ['-hide_banner', '-encoders'], { timeout: 5000, windowsHide: true })
    if (!/\blibx264\b/.test(stdout) || !/\baac\b/.test(stdout)) {
      return { path: null, error: '这个 FFmpeg 构建缺少 libx264 或 AAC 编码器' }
    }
    const version = (await exec(executable, ['-version'], { timeout: 5000, windowsHide: true })).stdout.split('\n')[0]
    return { path: executable, version }
  } catch {
    return { path: null, error: '无法运行 FFmpeg。请安装后重新检测，或手动选择可执行文件。' }
  }
}

export async function detectFfmpeg(preferred?: string): Promise<FfmpegStatus> {
  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const folders = [...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  const candidates = [preferred, ...folders.filter(Boolean).map((dir) => path.resolve(dir, bin))].filter((file): file is string => Boolean(file))
  let unusable: FfmpegStatus | undefined
  for (const file of new Set(candidates)) {
    try { await fs.access(file) } catch { continue }
    const status = await probeFfmpeg(file)
    if (status.path) return status
    unusable ??= status
  }
  return unusable ?? { path: null, error: '未找到 FFmpeg' }
}

export class VideoJob {
  readonly id = randomUUID()
  private pending = Promise.resolve()
  private process?: ChildProcess
  private cancelled = false
  private finishing = false
  private size = 0
  private constructor(readonly destination: string, readonly encoder: string, private dir: string) {}
  static async create(destination: string, encoder: string) {
    return new VideoJob(destination, encoder, await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-video-')))
  }

  append(data: ArrayBuffer) {
    if (this.cancelled || this.finishing || !(data instanceof ArrayBuffer) || data.byteLength > 32 * 1024 * 1024) throw new Error('录像数据无效')
    this.size += data.byteLength
    this.pending = this.pending.then(() => fs.appendFile(path.join(this.dir, 'capture.webm'), Buffer.from(data)))
    return this.pending
  }

  async finish() {
    if (this.cancelled || this.finishing) throw new Error('录像已结束')
    this.finishing = true
    const temporary = path.join(path.dirname(this.destination), `.sirius-${this.id}.mp4`)
    try {
      await this.pending
      if (!this.size) throw new Error('没有录制到画面')
      if (this.cancelled) throw new Error('已取消视频导出')
      await new Promise<void>((resolve, reject) => {
        const child = this.process = spawn(this.encoder, [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path.join(this.dir, 'capture.webm'),
          '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
          '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary,
        ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
        let stderr = ''
        child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-2500) })
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve() : reject(new Error(this.cancelled ? '已取消视频导出' : `FFmpeg 转码失败：${stderr || code}`)))
      })
      if (this.cancelled) throw new Error('已取消视频导出')
      await fs.rename(temporary, this.destination)
      return this.destination
    } finally {
      this.process = undefined
      await fs.rm(temporary, { force: true }).catch(() => {})
      await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async cancel() {
    this.cancelled = true
    this.process?.kill()
    if (!this.finishing) {
      await this.pending.catch(() => {})
      await fs.rm(this.dir, { recursive: true, force: true })
    }
  }
}
