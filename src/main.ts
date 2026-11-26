import { createApp } from 'vue'
import './style.css'

const mount = '#app'
const mode = new URLSearchParams(location.search).get('mode')

async function bootstrap() {
  const api = window.siriusStudio
  if (api && mode === 'player') {
    const [initial, { default: PlaybackWindow }] = await Promise.all([
      api.currentPlayback(), import('./components/PlaybackWindow.vue'),
    ])
    if (!initial) throw new Error('没有打开的剧情作品')
    createApp(PlaybackWindow, { initial }).mount(mount)
    return
  }
  if (api && mode !== 'editor') {
    const { default: ProjectLauncher } = await import('./components/ProjectLauncher.vue')
    createApp(ProjectLauncher).mount(mount)
    return
  }
  const [project, layout, { default: App }] = await Promise.all([
    api?.currentProject(), api?.readLayout().catch(() => undefined), import('./App.vue'),
  ])
  createApp(App, { project, layout }).mount(mount)
}

void bootstrap().catch((err) => {
  const root = document.querySelector(mount)
  if (root) {
    const wrap = document.createElement('div')
    wrap.className = 'boot-error'
    const message = document.createElement('p')
    message.textContent = `无法加载项目：${err instanceof Error ? err.message : String(err)}`
    const back = document.createElement('button')
    back.textContent = '返回项目向导'
    back.onclick = () => { void window.siriusStudio?.showLauncher() }
    wrap.append(message, back)
    root.replaceChildren(wrap)
  }
})
