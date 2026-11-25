import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface CodexModel {
  id: string
  label: string
  efforts?: string[]
}

export function listCodexModels(command: string, cwd?: string, env?: NodeJS.ProcessEnv): Promise<CodexModel[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server', '--listen', 'stdio://'], {
      cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    })
    const lines = createInterface({ input: child.stdout })
    const models: CodexModel[] = []
    let finished = false
    let requestId = 1
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      lines.close()
      child.stdin.end()
      child.kill()
      if (error) reject(error)
      else resolve(models)
    }
    const deadline = setTimeout(() => finish(new Error('Codex 模型列表查询超时')), 8000)
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n')
    const list = (cursor?: string) => send({
      id: ++requestId, method: 'model/list', params: { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) },
    })
    child.on('error', finish)
    child.stdin.on('error', finish)
    child.on('close', () => finish(new Error('Codex app-server 未返回模型目录')))
    lines.on('line', (line) => {
      let response: any
      try { response = JSON.parse(line) } catch { return }
      if (response.id !== requestId) return
      if (response.error) return finish(new Error(response.error.message || 'Codex 模型列表查询失败'))
      if (response.id === 1) {
        send({ method: 'initialized' })
        return list()
      }
      if (!Array.isArray(response.result?.data)) return finish(new Error('Codex 返回了无效的模型列表'))
      for (const model of response.result.data) {
        const id = model.model || model.id
        if (typeof id !== 'string' || model.hidden || models.some((entry) => entry.id === id)) continue
        models.push({
          id, label: model.displayName || id,
          efforts: Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts
            .map((entry: any) => entry.reasoningEffort).filter((value: unknown) => typeof value === 'string') : undefined,
        })
      }
      if (typeof response.result.nextCursor === 'string' && response.result.nextCursor) list(response.result.nextCursor)
      else finish()
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'sirius_adv_studio', title: 'SiriusAdvStudio', version: '0.1.0' } } })
  })
}
