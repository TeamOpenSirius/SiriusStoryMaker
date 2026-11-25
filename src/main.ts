import { createApp } from 'vue'
import './style.css'

const mount = '#app'
const mode = new URLSearchParams(location.search).get('mode')

async function bootstrap() {
  const api = window.siriusStudio
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
    const message = document.createElement('p')
    message.textContent = `无法加载项目：${err instanceof Error ? err.message : String(err)}`
    const back = document.createElement('button')
    back.textContent = '返回项目向导'
    back.onclick = () => { void window.siriusStudio?.showLauncher() }
    root.replaceChildren(message, back)
  }
})
