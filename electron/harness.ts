import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const execFileAsync = promisify(execFile)

export interface HarnessInfo {
  id: 'claude' | 'codex' | 'gemini' | 'opencode'
  name: string
  command: string
  version: string
  available: boolean
}

export type HarnessStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'script_updated'; content: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

const HARNESS_SPECS: Array<{ id: HarnessInfo['id']; name: string; bin: string }> = [
  { id: 'claude', name: 'Claude Code', bin: 'claude' },
  { id: 'codex', name: 'OpenAI Codex', bin: 'codex' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode' },
]

const DSL_GUIDE_MD = `# SiriusAdvStudio Story DSL Specification

You are writing visual novel / ADV scripts for **WDS Adv Player** in SiriusAdvStudio.
Always edit \`current.story\` directly in this workspace (and/or reply with a \`\`\`story code block).

## Minimalist DSL Syntax
- \`@title <text>\` — Episode title
- \`@chapter <text>\` — Chapter name
- \`@episode <number>\` — Episode ID (e.g. \`1001\`)
- \`@bg <id> [fade=cross|black|white|time] [camera=<1..6>]\` — Background image (e.g. \`1000\`, \`1001\`, \`1010\`, \`1020\`, \`1030\`)
- \`@still <id>\` / \`@card <id>\` — Still CG or card overlay
- \`@bgm <id|stop>\` / \`@se <id>\` / \`@voice <id>\` — Audio
- \`@effect <sepia|blur|none>\` — Screen filter
- \`@fade <black|white|time|cross> [v1] [v2] [v3]\` — Transition fade
- \`@alias <name> <spine_id>\` — Define a readable character alias (e.g. \`@alias 心菜 10101\`)
- \`@char <slot> <spine_id|alias> [pos=outer_left|left|center|right|outer_right] [size=s|m|l] [appear=fade|left|right|bottom] [expr=normal|happy|smile|sad|angry|surprise|shy|close|close_happy] [body=normal|happy|angry|sad|amazement|shy|think] [head=nod|shake|nod2|shake2] [dir=normal|left|right|down|up|tilt_left|tilt_right]\`
  - Example Spine IDs: \`10101\`, \`10102\`, \`10103\`, \`10104\`, \`10105\`, \`10107\`
- \`@clear_chars\` — Remove all characters from stage
- \`Speaker: Dialogue\` or \`Speaker(small|middle|large): Dialogue\` — Spoken line
- \`+ Continuation line\` — Same group order continuation
- \`: Narration\` — Narration without speaker badge
- \`# comment\` — Comment
`

let activeChild: ChildProcess | null = null

async function findExecutable(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin], { timeout: 2000 })
    const found = stdout.trim().split('\n')[0]
    if (found) return found
  } catch {
    // Fallback to common user binary paths
  }
  const home = os.homedir()
  const candidates = [
    path.join(home, '.local', 'bin', bin),
    path.join(home, '.npm-global', 'bin', bin),
    `/usr/local/bin/${bin}`,
  ]
  for (const c of candidates) {
    try {
      await fs.access(c)
      return c
    } catch {
      continue
    }
  }
  return null
}

export async function detectHarnesses(): Promise<HarnessInfo[]> {
  const results: HarnessInfo[] = []
  for (const spec of HARNESS_SPECS) {
    const cmdPath = await findExecutable(spec.bin)
    if (!cmdPath) {
      results.push({ id: spec.id, name: spec.name, command: spec.bin, version: '', available: false })
      continue
    }
    let version = 'installed'
    try {
      const { stdout } = await execFileAsync(cmdPath, ['--version'], { timeout: 3000 })
      version = stdout.trim().split('\n')[0] || 'installed'
    } catch {
      // Keep default installed label
    }
    results.push({ id: spec.id, name: spec.name, command: cmdPath, version, available: true })
  }
  return results
}

async function loadResourceSummary(): Promise<string> {
  const candidates = [
    path.join(__dirname, '../dist/adv-resource-tree.json'),
    path.join(__dirname, '../public/adv-resource-tree.json'),
  ]
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8')
      const tree = (JSON.parse(raw) as { tree?: Array<{ path: string }> }).tree ?? []
      const bgs = tree.filter((x) => x.path.startsWith('background/') && x.path.endsWith('.png')).slice(0, 30).map((x) => x.path.slice(11, -4))
      const spines = tree.filter((x) => x.path.startsWith('spine/') && x.path.endsWith('.skel')).slice(0, 30).map((x) => x.path.slice(6, -5))
      const bgms = tree.filter((x) => x.path.startsWith('bgm/') && x.path.endsWith('.mp3')).slice(0, 20).map((x) => x.path.slice(4, -4))
      return `\n## Verified Sample Resource IDs\n- Backgrounds: ${bgs.join(', ')}\n- Spines: ${spines.join(', ')}\n- BGMs: ${bgms.join(', ')}\n(Full list is in \`adv-resource-tree.json\` if needed.)\n`
    } catch {
      continue
    }
  }
  return ''
}

async function prepareWorkspace(script: string, filePath?: string): Promise<{ dir: string; storyFile: string }> {
  const dir = filePath
    ? path.dirname(filePath)
    : path.join(os.tmpdir(), 'sirius-adv-studio-workspace')
  await fs.mkdir(dir, { recursive: true })
  const storyFile = filePath || path.join(dir, 'current.story')
  const guide = DSL_GUIDE_MD + (await loadResourceSummary())
  await fs.writeFile(storyFile, script, 'utf-8')
  await fs.writeFile(path.join(dir, 'AGENTS.md'), guide, 'utf-8')
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), guide, 'utf-8')
  return { dir, storyFile }
}

export function stopActiveHarness() {
  if (activeChild && !activeChild.killed) {
    activeChild.kill('SIGTERM')
    activeChild = null
  }
}

export function parseHarnessOutputLine(
  line: string,
  emit: (ev: HarnessStreamEvent) => void,
) {
  const trimmed = line.trim()
  if (!trimmed) return
  if (!trimmed.startsWith('{')) {
    emit({ type: 'delta', text: trimmed + '\n' })
    return
  }
  try {
    const obj = JSON.parse(trimmed) as Record<string, any>
    if (typeof obj.session_id === 'string') {
      emit({ type: 'session', sessionId: obj.session_id })
    } else if (typeof obj.thread_id === 'string') {
      emit({ type: 'session', sessionId: obj.thread_id })
    }

    // Claude stream-json format
    if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          emit({ type: 'delta', text: block.text })
        } else if (block?.type === 'tool_use' && block.name) {
          emit({ type: 'status', text: `执行工具: ${block.name}` })
        }
      }
    } else if (obj.type === 'result' && typeof obj.result === 'string') {
      emit({ type: 'status', text: '已完成回复' })
    }
    // Codex exec --json format
    else if (obj.type === 'item.completed' && obj.item) {
      if (obj.item.type === 'agent_message' && typeof obj.item.text === 'string') {
        emit({ type: 'delta', text: obj.item.text + '\n' })
      } else if (obj.item.type === 'command_execution') {
        emit({ type: 'status', text: `命令完成: ${obj.item.command || ''}` })
      }
    }
  } catch {
    emit({ type: 'delta', text: trimmed + '\n' })
  }
}

export async function runHarnessTurn(
  params: {
    harnessId: HarnessInfo['id']
    command: string
    prompt: string
    script: string
    sessionId?: string
    filePath?: string
  },
  emit: (ev: HarnessStreamEvent) => void,
): Promise<void> {
  stopActiveHarness()
  const { dir, storyFile } = await prepareWorkspace(params.script, params.filePath)
  const storyBase = path.basename(storyFile)
  const fullPrompt = `${params.prompt}\n\n(当前剧本文件为 \`${storyBase}\`，请直接修改该文件或在回复中给出完整的 \`\`\`story 代码块。)`

  let args: string[]
  if (params.harnessId === 'claude') {
    args = ['-p', fullPrompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']
    if (params.sessionId) args.push('--resume', params.sessionId)
  } else if (params.harnessId === 'codex') {
    args = params.sessionId
      ? ['exec', 'resume', params.sessionId, '--json', '--full-auto', fullPrompt]
      : ['exec', '--json', '--full-auto', fullPrompt]
  } else {
    args = ['-p', fullPrompt]
  }

  emit({ type: 'status', text: `正在调用 ${params.harnessId}…` })

  const child = spawn(params.command, args, {
    cwd: dir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeChild = child

  let lastSynced = params.script
  let watchTimer: NodeJS.Timeout | null = null
  const watcher = fsSync.watch(storyFile, () => {
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = setTimeout(async () => {
      try {
        const next = await fs.readFile(storyFile, 'utf-8')
        if (next !== lastSynced) {
          lastSynced = next
          emit({ type: 'script_updated', content: next })
        }
      } catch {
        // ignore transient file locks
      }
    }, 150)
  })

  let buf = ''
  const handleStdoutLine = (line: string) => parseHarnessOutputLine(line, emit)

  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8')
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) handleStdoutLine(line)
  })

  let stderrBuf = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8')
  })

  child.on('error', (err) => {
    watcher.close()
    activeChild = null
    emit({ type: 'error', message: err.message })
  })

  child.on('close', async (code) => {
    watcher.close()
    if (watchTimer) clearTimeout(watchTimer)
    activeChild = null
    if (buf.trim()) handleStdoutLine(buf)
    try {
      const updated = await fs.readFile(storyFile, 'utf-8')
      if (updated !== lastSynced) {
        lastSynced = updated
        emit({ type: 'script_updated', content: updated })
      }
    } catch {
      // ignore if missing
    }
    if ((code ?? 0) !== 0 && stderrBuf.trim()) {
      emit({ type: 'error', message: stderrBuf.trim() })
    }
    emit({ type: 'done', exitCode: code ?? 0 })
  })
}
