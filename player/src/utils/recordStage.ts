import { sound, webaudio } from '@pixi/sound'
import { AdvPlayer } from '../AdvPlayer'

export function recordStage(canvas: HTMLCanvasElement, player: AdvPlayer) {
  const context = sound.context
  if (!(context instanceof webaudio.WebAudioContext)) throw new Error('当前环境不能录制 Web Audio')
  const audio = context.audioContext
  const destination = audio.createMediaStreamDestination()
  context.compressor.connect(destination)
  const stream = canvas.captureStream(30)
  for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)

  const nodeByElement = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  player.routeMovieAudio((element) => {
    if (!nodeByElement.has(element)) {
      const node = audio.createMediaElementSource(element)
      node.connect(context.analyser)
      nodeByElement.set(element, node)
    }
  })

  let recorder: MediaRecorder
  let pending = Promise.resolve()
  let disposed = false
  const send = (type: string, payload: Record<string, unknown> = {}, transfer: Transferable[] = []) => {
    window.parent.postMessage({ type, ...payload }, location.origin, transfer)
  }
  const release = () => {
    if (disposed) return
    disposed = true
    for (const track of stream.getTracks()) track.stop()
    try { context.compressor.disconnect(destination) } catch { /* already disconnected */ }
  }
  return {
    async start() {
      try {
        await audio.resume()
        const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
          .find(type => MediaRecorder.isTypeSupported(type))
        if (!mimeType) throw new Error('当前环境不支持 WebM 录制')
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 })
        recorder.ondataavailable = event => {
          if (!event.data.size) return
          pending = pending.then(async () => {
            const bytes = await event.data.arrayBuffer()
            send('wds-record-chunk', { bytes }, [bytes])
          })
        }
        recorder.onstop = () => {
          release()
          void pending.then(() => send('wds-record-finished')).catch(err => send('wds-record-error', { message: String(err) }))
        }
        recorder.onerror = () => {
          release()
          send('wds-record-error', { message: '浏览器录制舞台失败' })
        }
        recorder.start(800)
        send('wds-record-started')
        player.play()
      } catch (err) {
        release()
        throw err
      }
    },
    stop() {
      if (recorder?.state !== 'inactive') recorder?.stop()
    },
  }
}
