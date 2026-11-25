import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { listCodexModels } from './codex-models'
import { executeStudioMcpTool, STUDIO_MCP_TOOLS } from './mcp-server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

export type HarnessId = 'agy' | 'claude' | 'codex' | 'dsh' | 'deepseek' | 'gemini' | 'opencode'

export interface HarnessModelOption {
  id: string
  label: string
  efforts?: string[]
}

export interface HarnessInfo {
  id: HarnessId
  name: string
  command: string
  version: string
  available: boolean
  models: HarnessModelOption[]
  efforts: string[]
  supportsMcp: boolean
  supportsSkills: boolean
  requiresApiKey?: boolean
  modelError?: string
}

export interface StudioSkillInfo {
  id: string
  name: string
  description: string
  path: string
}

export interface StudioMcpInfo {
  serverName: string
  command: string
  scriptPath: string
  available: boolean
  tools: Array<{ name: string; description: string }>
}

export type HarnessStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'status'; text: string }
  | { type: 'script_updated'; content: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string }

export interface RunHarnessParams {
  harnessId: HarnessId
  command: string
  prompt: string
  script: string
  sessionId?: string
  filePath?: string
  model?: string
  effort?: string
  enabledSkills?: string[]
  enableMcp?: boolean
  apiKey?: string
  baseUrl?: string
  workspace?: string
}

const DEFAULT_MODELS: Record<HarnessId, HarnessModelOption[]> = {
  agy: [
    { id: '', label: '默认模型' },
    { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
    { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
  ],
  claude: [
    { id: '', label: 'Claude 配置默认模型' },
    { id: 'sonnet', label: 'Sonnet（CLI 别名）' },
    { id: 'opus', label: 'Opus（CLI 别名）' },
    { id: 'haiku', label: 'Haiku（CLI 别名）' },
  ],
  codex: [{ id: '', label: 'Codex 配置默认模型' }],
  dsh: [{ id: '', label: 'DSH headless 配置模型' }],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
  ],
  gemini: [
    { id: '', label: '默认模型' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  opencode: [
    { id: '', label: '默认模型' },
  ],
}

const SUPPORTED_EFFORTS: Record<HarnessId, string[]> = {
  agy: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
  claude: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['default'],
  dsh: ['default'],
  deepseek: ['default', 'low', 'medium', 'high'],
  gemini: ['default'],
  opencode: ['default'],
}

const HARNESS_SPECS: Array<{ id: HarnessId; name: string; bin: string; supportsMcp: boolean; supportsSkills: boolean }> = [
  { id: 'agy', name: 'Antigravity CLI', bin: 'agy', supportsMcp: true, supportsSkills: true },
  { id: 'claude', name: 'Claude Code', bin: 'claude', supportsMcp: true, supportsSkills: true },
  { id: 'codex', name: 'OpenAI Codex', bin: 'codex', supportsMcp: true, supportsSkills: true },
  { id: 'dsh', name: 'DeepSeek Harness (dsh)', bin: 'dsh', supportsMcp: false, supportsSkills: true },
  { id: 'deepseek', name: 'DeepSeek API（内置）', bin: 'deepseek', supportsMcp: true, supportsSkills: true },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', supportsMcp: true, supportsSkills: true },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', supportsMcp: true, supportsSkills: true },
]

export const DSL_GUIDE_MD = `# SiriusAdvStudio Story DSL Specification

You are an expert visual novel / ADV script director for **WDS Adv Player** in SiriusAdvStudio.
Always edit \`current.story\` directly in this workspace (or use the \`write_story\` MCP tool, and/or reply with a complete \`\`\`story code block).

## Minimalist DSL Syntax
- \`@title <text>\` — Episode title
- \`@chapter <text>\` — Chapter name
- \`@episode <number>\` — Episode ID (e.g. \`1001\`)
- \`@alias <name> <spine_id>\` — Define a readable character alias (e.g. \`@alias 心菜 10101\`)
- \`@scene <id> title="<name>" x=<n> y=<n>\` — Scene node block for the visual Story Graph
- \`-> <scene_id>\` / \`@choice "<label>" -> <scene_id>\` — Linear jump or branch wire between scene nodes
- \`@bg <id> [fade=cross|black|white|time] [camera=<1..6>]\` — Background image (e.g. \`1000\`, \`1001\`, \`1010\`, \`1020\`, \`1030\`)
- \`@still <id>\` / \`@card <id>\` — Still CG or card overlay
- \`@bgm <id|stop>\` / \`@se <id>\` / \`@voice <id>\` — Audio
- \`@effect <sepia|blur|none>\` — Screen filter (persists until \`@effect none\`)
- \`@fade <black|white|time|cross> [v1] [v2] [v3]\` — Transition fade
- \`@char <slot> <spine_id|alias> [pos=outer_left|left|center|right|outer_right] [size=s|m|l] [appear=fade|left|right|bottom] [expr=normal|happy|smile|sad|angry|surprise|shy|close|close_happy] [body=normal|happy|angry|sad|amazement|shy|think] [head=nod|shake|nod2|shake2] [dir=normal|left|right|down|up|tilt_left|tilt_right]\`
  - Verified Sirius Spine IDs (101xx=心菜, 102xx=静香, 103xx=卡特莉娜, 104xx=八惠, 105xx=潘达, 106xx=知沙):
    \`10101\` (心菜), \`10201\` (静香), \`10301\` (卡特莉娜), \`10401\` (八惠), \`10501\` (潘达), \`10601\` (知沙) — NEVER use 10104 for 八惠 (101xx are all 心菜 costumes)! Always verify with \`study_character\` MCP tool for other characters.
- \`@clear_chars\` — Remove all characters from stage
- \`Speaker: Dialogue\` or \`Speaker(small|middle|large): Dialogue\` — Spoken line
- \`+ Continuation line\` — Same group order continuation
- \`: Narration\` — Narration without speaker badge
- \`# comment\` — Comment

## Rules
1. Keep all existing \`@scene\` / \`->\` / \`@choice\` targets valid so there are no dangling links.
2. Only use verified background, spine, BGM, and SE IDs (use \`search_resources\` MCP tool if available).
3. Preserve the user's story language (Chinese by default) and character voice.
`

let activeChild: ChildProcess | null = null
let activeAbort: AbortController | null = null
const deepseekSessions = new Map<string, Array<{ role: string; content: string }>>()

// In-memory caches to avoid repeated disk reads & CLI probes on every turn
let cachedHarnesses: { list: HarnessInfo[]; ts: number } | null = null
let cachedSkills: { list: StudioSkillInfo[]; ts: number } | null = null
let cachedResourceSummary: string | null = null
let cachedNodeCommand: string | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

function resolveProjectRoot(): string {
  // In dist-electron/, __dirname is <repo>/dist-electron; in vitest, __dirname is <repo>/electron
  return path.resolve(__dirname, '..')
}

function resolveResourceTreePath(): string {
  const root = resolveProjectRoot()
  const candidates = [
    path.join(root, 'dist', 'adv-resource-tree.json'),
    path.join(root, 'public', 'adv-resource-tree.json'),
  ]
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return p
  }
  return ''
}

function resolveMcpServerPath(): string {
  const root = resolveProjectRoot()
  const candidates = [
    path.join(root, 'dist-electron', 'mcp-server.mjs'),
    path.join(root, 'dist-electron', 'mcp-server.js'),
  ]
  for (const p of candidates) {
    if (fsSync.existsSync(p)) return p
  }
  return candidates[0]
}

function resolveSkillsRoot(): string {
  return path.join(resolveProjectRoot(), 'skills')
}

export async function listStudioSkills(forceRefresh: boolean = false): Promise<StudioSkillInfo[]> {
  if (!forceRefresh && cachedSkills && Date.now() - cachedSkills.ts < CACHE_TTL_MS) {
    return cachedSkills.list
  }
  const root = resolveSkillsRoot()
  const results: StudioSkillInfo[] = []
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMd = path.join(root, entry.name, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillMd, 'utf-8')
        const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/)
        let name = entry.name
        let description = ''
        if (fm) {
          const nameM = fm[1].match(/^name:\s*(.+)$/m)
          const descM = fm[1].match(/^description:\s*(.+)$/m)
          if (nameM) name = nameM[1].trim()
          if (descM) description = descM[1].trim()
        }
        results.push({ id: entry.name, name, description, path: skillMd })
      } catch {
        continue
      }
    }
  } catch {
    // skills directory missing
  }
  const sorted = results.sort((a, b) => a.id.localeCompare(b.id))
  cachedSkills = { list: sorted, ts: Date.now() }
  return sorted
}

export function getStudioMcpInfo(): StudioMcpInfo {
  const scriptPath = resolveMcpServerPath()
  return {
    serverName: 'sirius-adv-studio',
    command: process.execPath.includes('electron') ? 'node' : process.execPath,
    scriptPath,
    available: fsSync.existsSync(scriptPath),
    tools: STUDIO_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  }
}

async function findExecutable(bin: string): Promise<string | null> {
  const home = os.homedir()
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const fnm = path.join(process.env.FNM_DIR || path.join(home, '.local', 'share', 'fnm'), 'node-versions')
  const installedNodes = await fs.readdir(fnm).catch(() => [])
  const dirs = [
    ...pathEntries,
    path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin',
    ...installedNodes.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => path.join(fnm, version, 'installation', 'bin')),
  ]
  const names = process.platform === 'win32' ? [bin + '.exe', bin] : [bin]
  for (const dir of new Set(dirs)) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        await fs.access(candidate, fsSync.constants.X_OK)
        if ((await fs.stat(candidate)).isFile()) return candidate
      } catch { /* continue looking */ }
    }
  }
  return null
}

function cliEnvironment(command: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: [path.dirname(command), cachedNodeCommand && path.dirname(cachedNodeCommand),
    process.env.PATH].filter(Boolean).join(path.delimiter) }
}

async function fetchAgyModels(cmdPath: string): Promise<HarnessModelOption[]> {
  try {
    const { stdout } = await execFileAsync(cmdPath, ['models'], { timeout: 5000 })
    const parsed: HarnessModelOption[] = [{ id: '', label: '默认模型' }]
    for (const line of stdout.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('Fetching')) continue
      const parts = t.split('\t')
      if (parts.length >= 2) {
        parsed.push({ id: parts[0].trim(), label: parts[1].trim() })
      }
    }
    return parsed.length > 1 ? parsed : DEFAULT_MODELS.agy
  } catch {
    return DEFAULT_MODELS.agy
  }
}

export async function detectHarnesses(forceRefresh: boolean = false): Promise<HarnessInfo[]> {
  if (!forceRefresh && cachedHarnesses && Date.now() - cachedHarnesses.ts < CACHE_TTL_MS) {
    return cachedHarnesses.list
  }
  cachedNodeCommand ||= (await findExecutable('node')) || ''
  const results = await Promise.all(HARNESS_SPECS.map(async (spec): Promise<HarnessInfo> => {
    const base = { id: spec.id, name: spec.name, models: DEFAULT_MODELS[spec.id],
      efforts: SUPPORTED_EFFORTS[spec.id], supportsMcp: spec.supportsMcp, supportsSkills: spec.supportsSkills }
    if (spec.id === 'deepseek') {
      const hasEnvKey = Boolean(process.env.DEEPSEEK_API_KEY)
      return { ...base, command: 'builtin:deepseek', version: '内置 API', available: true, requiresApiKey: !hasEnvKey }
    }
    const command = await findExecutable(spec.bin)
    if (!command) return { ...base, command: spec.bin, version: '', available: false }
    const version = await execFileAsync(command, ['--version'], { timeout: 3000, env: cliEnvironment(command) })
      .then(({ stdout }) => stdout.trim().split('\n')[0] || '已安装').catch(() => '已安装')
    if (spec.id === 'codex') {
      try {
        return { ...base, command, version, available: true, models: [...base.models, ...await listCodexModels(command, os.homedir(), cliEnvironment(command))] }
      } catch (err) {
        return { ...base, command, version, available: true, modelError: err instanceof Error ? err.message : String(err) }
      }
    }
    const models = spec.id === 'agy' ? await fetchAgyModels(command) : base.models
    return { ...base, command, version, available: true, models }
  }))
  cachedHarnesses = { list: results, ts: Date.now() }
  return results
}

async function loadResourceSummary(): Promise<string> {
  if (cachedResourceSummary !== null) return cachedResourceSummary
  const p = resolveResourceTreePath()
  if (!p) {
    cachedResourceSummary = ''
    return ''
  }
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const tree = (JSON.parse(raw) as { tree?: Array<{ path: string }> }).tree ?? []
    const bgs = tree.filter((x) => x.path.startsWith('background/') && x.path.endsWith('.png')).slice(0, 30).map((x) => x.path.slice(11, -4))
    const spines = tree.filter((x) => x.path.startsWith('spine/') && x.path.endsWith('.skel')).slice(0, 30).map((x) => x.path.slice(6, -5))
    const bgms = tree.filter((x) => x.path.startsWith('bgm/') && x.path.endsWith('.mp3')).slice(0, 20).map((x) => x.path.slice(4, -4))
    cachedResourceSummary = `\n## Verified Sample Resource IDs\n- Backgrounds: ${bgs.join(', ')}\n- Spines: ${spines.join(', ')}\n- BGMs: ${bgms.join(', ')}\n`
    return cachedResourceSummary
  } catch {
    cachedResourceSummary = ''
    return ''
  }
}

async function syncWorkspaceSkills(dir: string, enabledSkills?: string[]): Promise<string> {
  const allSkills = await listStudioSkills()
  const active =
    enabledSkills && enabledSkills.length > 0
      ? allSkills.filter((s) => enabledSkills.includes(s.id))
      : enabledSkills && enabledSkills.length === 0
        ? []
        : allSkills

  // Sync enabled skills into standard agent skill discovery directories
  const targetDirs = [
    path.join(dir, '.claude', 'skills'),
    path.join(dir, '.agents', 'skills'),
    path.join(dir, '.agent', 'skills'),
    path.join(dir, '.gemini', 'skills'),
  ]

  for (const tDir of targetDirs) {
    await fs.rm(tDir, { recursive: true, force: true }).catch(() => {})
    await fs.mkdir(tDir, { recursive: true })
  }

  let skillPromptBlock = ''
  for (const skill of active) {
    try {
      const content = await fs.readFile(skill.path, 'utf-8')
      for (const tDir of targetDirs) {
        const destDir = path.join(tDir, skill.id)
        await fs.mkdir(destDir, { recursive: true })
        await fs.writeFile(path.join(destDir, 'SKILL.md'), content, 'utf-8')
      }
      skillPromptBlock += `\n\n---\n${content.replace(/^---[\s\S]*?---\s*/, '')}`
    } catch {
      continue
    }
  }
  return skillPromptBlock
}

async function prepareWorkspace(
  script: string,
  enabledSkills?: string[],
  enableMcp: boolean = true,
  workspace?: string,
): Promise<{
  dir: string
  storyFile: string
  guide: string
  mcpConfigPath?: string
  mcpServerPath: string
  resourceTreePath: string
  nodeCommand: string
}> {
  const dir = workspace || path.join(os.tmpdir(), 'sirius-adv-studio-workspace')
  await fs.mkdir(dir, { recursive: true })
  const storyFile = path.join(dir, 'current.story')
  await fs.writeFile(storyFile, script, 'utf-8')

  const mcpServerPath = resolveMcpServerPath()
  const resourceTreePath = resolveResourceTreePath()
  if (!cachedNodeCommand) {
    cachedNodeCommand = (await findExecutable('node')) || 'node'
  }
  const nodeCommand = cachedNodeCommand
  const mcpConfigPath =
    enableMcp && fsSync.existsSync(mcpServerPath) ? path.join(dir, '.mcp.json') : undefined

  const skillText = await syncWorkspaceSkills(dir, enabledSkills)
  const guide = DSL_GUIDE_MD + (await loadResourceSummary()) + skillText
  await fs.writeFile(path.join(dir, 'AGENTS.md'), guide, 'utf-8')
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), guide, 'utf-8')
  const mcpFile = path.join(dir, '.mcp.json')
  if (mcpConfigPath) {
    const mcpServers = { 'sirius-adv-studio': { command: nodeCommand, args: [mcpServerPath, dir, resourceTreePath] } }
    await fs.writeFile(mcpFile, JSON.stringify({ mcpServers }, null, 2), 'utf-8')
  } else {
    await fs.rm(mcpFile, { force: true })
  }
  return { dir, storyFile, guide, mcpConfigPath, mcpServerPath, resourceTreePath, nodeCommand }
}

let turnGeneration = 0
let preparing = Promise.resolve<unknown>(undefined)

export function stopActiveHarness() {
  turnGeneration++
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }
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
    if (obj.type === 'session' && typeof obj.sessionId === 'string') {
      emit({ type: 'session', sessionId: obj.sessionId })
      return
    }
    if (typeof obj.session_id === 'string') {
      emit({ type: 'session', sessionId: obj.session_id })
    } else if (typeof obj.thread_id === 'string') {
      emit({ type: 'session', sessionId: obj.thread_id })
    } else if (typeof obj.conversation_id === 'string') {
      emit({ type: 'session', sessionId: obj.conversation_id })
    } else if (typeof obj.step_update?.conversation_id === 'string') {
      emit({ type: 'session', sessionId: obj.step_update.conversation_id })
    } else if (typeof obj.result?.conversation_id === 'string') {
      emit({ type: 'session', sessionId: obj.result.conversation_id })
    }

    // Antigravity CLI (`agy --output-format stream-json`) format
    if (obj.event === 'step_update' && obj.step_update) {
      const su = obj.step_update
      if (typeof su.text_delta === 'string' && su.text_delta.length > 0) {
        emit({ type: 'delta', text: su.text_delta })
      } else if (su.step_type && su.step_type !== 'user_input' && su.step_type !== 'agent_response') {
        const label = su.tool_name || su.step_type
        emit({ type: 'status', text: `执行工具: ${label}` })
      }
      return
    }
    if (obj.event === 'result' && obj.result) {
      const r = obj.result
      if (r.usage && typeof r.usage === 'object') {
        emit({
          type: 'usage',
          inputTokens: Number(r.usage.input_tokens ?? 0) || 0,
          outputTokens: Number(r.usage.output_tokens ?? 0) || 0,
          cacheReadTokens: Number(r.usage.cache_read_tokens ?? 0) || 0,
        })
      }
      if (r.status && r.status !== 'SUCCESS' && r.error) {
        emit({ type: 'error', message: String(r.error) })
      } else {
        emit({ type: 'status', text: '已完成回复' })
      }
      return
    }
    if (obj.event === 'init') {
      emit({ type: 'status', text: '已连接，思考中…' })
      return
    }

    // Emit token usage when present (Claude, Codex)
    const u = obj.usage || (obj.type !== 'assistant' ? obj.message?.usage : undefined)
    if (u && typeof u === 'object') {
      const inputTokens = Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0
      const outputTokens = Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0
      const cacheReadTokens = Number(u.cache_read_input_tokens ?? u.cached_input_tokens ?? u.prompt_cache_hit_tokens ?? 0) || 0
      const costUsd = typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined
      if (inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0) {
        emit({ type: 'usage', inputTokens, outputTokens, cacheReadTokens, costUsd })
      }
    }

    // Claude / Antigravity stream-json format
    if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          emit({ type: 'delta', text: block.text })
        } else if (block?.type === 'tool_use' && block.name) {
          emit({ type: 'status', text: `执行工具: ${block.name}` })
        }
      }
    } else if (obj.type === 'content_block_delta' && typeof obj.delta?.text === 'string') {
      emit({ type: 'delta', text: obj.delta.text })
    } else if (obj.type === 'text' && typeof obj.text === 'string') {
      emit({ type: 'delta', text: obj.text })
    } else if (obj.type === 'tool_use' && typeof obj.name === 'string') {
      emit({ type: 'status', text: `执行工具: ${obj.name}` })
    } else if (obj.type === 'result') {
      if (obj.is_error) {
        emit({ type: 'error', message: typeof obj.result === 'string' ? obj.result : 'AI 执行失败' })
      } else {
        emit({ type: 'status', text: '已完成回复' })
      }
    }
    // Codex exec --json format
    else if (obj.type === 'item.completed' && obj.item) {
      if (obj.item.type === 'agent_message' && typeof obj.item.text === 'string') {
        emit({ type: 'delta', text: obj.item.text + '\n' })
      } else if (obj.item.type === 'command_execution') {
        emit({ type: 'status', text: `命令完成: ${obj.item.command || ''}` })
      } else if (obj.item.type === 'file_change') {
        emit({ type: 'status', text: '已修改剧本文件' })
      }
    } else if (obj.type === 'turn.failed') {
      emit({ type: 'error', message: obj.error?.message || 'Codex 执行失败' })
    } else if (obj.type === 'error' && typeof obj.message === 'string') {
      emit({ type: 'error', message: obj.message })
    }
  } catch {
    emit({ type: 'delta', text: trimmed + '\n' })
  }
}

export function buildCliArgs(
  params: RunHarnessParams,
  ctx: {
    dir: string
    guide: string
    fullPrompt: string
    mcpConfigPath?: string
    mcpServerPath: string
    resourceTreePath: string
    nodeCommand?: string
  },
): string[] {
  const model = params.model?.trim()
  const effort = params.effort && params.effort !== 'default' ? params.effort : undefined
  const nodeBin = ctx.nodeCommand || 'node'

  if (params.harnessId === 'agy') {
    const args = ['-p', ctx.fullPrompt, '--output-format', 'stream-json', '--mode', 'accept-edits']
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    if (params.sessionId) args.push('--resume', params.sessionId)
    return args
  }

  if (params.harnessId === 'claude') {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--append-system-prompt',
      ctx.guide,
    ]
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    if (ctx.mcpConfigPath && params.enableMcp !== false) {
      args.push('--strict-mcp-config', '--mcp-config', ctx.mcpConfigPath, '--allowedTools', 'mcp__sirius-adv-studio__*')
    } else args.push('--strict-mcp-config')
    if (params.sessionId) args.push('--resume', params.sessionId)
    return [...args, '--', ctx.fullPrompt]
  }

  if (params.harnessId === 'codex') {
    const args = ['-a', 'never', '-c', 'sandbox_mode="workspace-write"']
    args.push('exec')
    if (params.sessionId) args.push('resume')
    args.push('--json', '--skip-git-repo-check')
    if (model) args.push('-m', model)
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
    if (params.enableMcp !== false && fsSync.existsSync(ctx.mcpServerPath)) {
      args.push(
        '-c',
        `mcp_servers.sirius_studio.command=${JSON.stringify(nodeBin)}`,
        '-c',
        `mcp_servers.sirius_studio.args=${JSON.stringify([ctx.mcpServerPath, ctx.dir, ctx.resourceTreePath])}`,
      )
    }
    args.push('--')
    if (params.sessionId) args.push(params.sessionId)
    args.push(ctx.fullPrompt)
    return args
  }

  if (params.harnessId === 'dsh') {
    const args = ['headless', '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never']
    if (params.sessionId) args.push('--session-id', params.sessionId)
    return [...args, '--', ctx.fullPrompt]
  }

  const fallback = ['-p', ctx.fullPrompt]
  if (model) fallback.push('-m', model)
  return fallback
}

async function runDeepSeekAgenticTurn(
  params: RunHarnessParams,
  ctx: { storyFile: string; guide: string; resourceTreePath: string },
  emit: (ev: HarnessStreamEvent) => void,
): Promise<void> {
  const apiKey = params.apiKey?.trim() || process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) {
    emit({
      type: 'error',
      message: '请先在面板中配置 DeepSeek API Key（或设置环境变量 DEEPSEEK_API_KEY）。',
    })
    emit({ type: 'done', exitCode: 1 })
    return
  }

  const baseUrl = (params.baseUrl?.trim() || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
  const effort = params.effort && params.effort !== 'default' ? params.effort : undefined
  // Auto-upgrade to deepseek-reasoner when user selects high effort on default model
  const model =
    params.model?.trim() || (effort === 'high' ? 'deepseek-reasoner' : 'deepseek-chat')
  const enableTools = params.enableMcp !== false && model !== 'deepseek-reasoner'

  const sid = params.sessionId || `ds_${Date.now().toString(36)}`
  emit({ type: 'session', sessionId: sid })

  const history = deepseekSessions.get(sid) ?? []
  const messages: Array<Record<string, any>> = [
    { role: 'system', content: ctx.guide },
    ...history.slice(-8),
    {
      role: 'user',
      content: `当前剧本 (\`current.story\`):\n\`\`\`story\n${params.script}\n\`\`\`\n\n用户需求：${params.prompt}`,
    },
  ]

  const tools = enableTools
    ? STUDIO_MCP_TOOLS.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))
    : undefined

  const controller = new AbortController()
  activeAbort = controller
  try {
    for (let step = 0; step < 5; step++) {
      emit({ type: 'status', text: `DeepSeek (${model}) 思考中…` })
      const body: Record<string, any> = {
        model,
        messages,
        stream: false,
      }
      if (tools) body.tools = tools

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(`DeepSeek HTTP ${resp.status}: ${errText.slice(0, 220) || resp.statusText}`)
      }

      const data = (await resp.json()) as any
      if (data.usage && typeof data.usage === 'object') {
        emit({
          type: 'usage',
          inputTokens: Number(data.usage.prompt_tokens ?? 0) || 0,
          outputTokens: Number(data.usage.completion_tokens ?? 0) || 0,
          cacheReadTokens: Number(data.usage.prompt_cache_hit_tokens ?? 0) || 0,
        })
      }
      const msg = data.choices?.[0]?.message
      if (!msg) break

      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
        emit({ type: 'status', text: 'DeepSeek 推理完成' })
      }

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        messages.push(msg)
        for (const tc of msg.tool_calls) {
          const toolName = tc.function?.name || ''
          let toolArgs: Record<string, unknown> = {}
          try {
            toolArgs = JSON.parse(tc.function?.arguments || '{}')
          } catch {
            toolArgs = {}
          }
          controller.signal.throwIfAborted()
          emit({ type: 'status', text: `MCP 工具: ${toolName}` })
          let toolOutput = ''
          try {
            toolOutput = await executeStudioMcpTool(toolName, toolArgs, {
              storyFile: ctx.storyFile,
              resourceTreePath: ctx.resourceTreePath,
            })
          } catch (err) {
            toolOutput = `Error: ${err instanceof Error ? err.message : String(err)}`
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolOutput,
          })
        }
        continue
      }

      const content = typeof msg.content === 'string' ? msg.content : ''
      if (content) {
        emit({ type: 'delta', text: content })
        history.push({ role: 'user', content: params.prompt }, { role: 'assistant', content })
        deepseekSessions.set(sid, history.slice(-12))
      }
      break
    }

    controller.signal.throwIfAborted()
    const updated = await fs.readFile(ctx.storyFile, 'utf8').catch(() => params.script)
    if (updated.trim() && updated !== params.script) emit({ type: 'script_updated', content: updated })
    emit({ type: 'done', exitCode: 0 })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      emit({ type: 'status', text: '已中断' })
    } else {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    emit({ type: 'done', exitCode: 1 })
  } finally {
    if (activeAbort === controller) activeAbort = null
  }
}

export async function runHarnessTurn(
  params: RunHarnessParams,
  emit: (ev: HarnessStreamEvent) => void,
): Promise<void> {
  stopActiveHarness()
  const generation = turnGeneration
  const pending = preparing.then(() => generation === turnGeneration
    ? prepareWorkspace(params.script, params.enabledSkills, params.enableMcp !== false && params.harnessId !== 'dsh', params.workspace)
    : undefined)
  preparing = pending.catch(() => undefined)
  const ws = await pending
  if (!ws || generation !== turnGeneration) return

  if (params.harnessId === 'deepseek') {
    await runDeepSeekAgenticTurn(params, ws, (ev) => { if (generation === turnGeneration) emit(ev) })
    return
  }

  const spec = HARNESS_SPECS.find((entry) => entry.id === params.harnessId)
  const executable = spec && await findExecutable(spec.bin)
  if (generation !== turnGeneration) return
  if (!executable) throw new Error('未找到所选 CLI，请刷新 AI 设置。')
  const task = `${params.prompt}\n\n在当前工作目录中编辑 current.story。只修改这份剧本，完成后用中文简述；如无法写入，返回完整的 story 代码块。脚本规范见 AGENTS.md。`
  const fullPrompt = params.harnessId === 'dsh' ? `${ws.guide}\n\n${task}` : task
  const args = buildCliArgs(params, { ...ws, fullPrompt })
  emit({ type: 'status', text: `正在连接 ${spec!.name}${params.model ? ` · ${params.model}` : ''}…` })

  const env = cliEnvironment(executable)
  if (params.harnessId === 'claude') delete env.CLAUDECODE
  const child = spawn(executable, args, { cwd: ws.dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  activeChild = child
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  let sawError = false
  let sawText = false
  lines.on('line', (line) => {
    if (generation !== turnGeneration) return
    if (params.harnessId === 'dsh' && !sawText) {
      try {
        const row = JSON.parse(line)
        if (row.type === 'final' && typeof row.text === 'string') {
          sawText = true
          emit({ type: 'delta', text: row.text })
          return
        }
      } catch { /* handled by shared parser */ }
    }
    parseHarnessOutputLine(line, (ev) => {
      if (ev.type === 'delta') sawText = true
      if (ev.type === 'error') sawError = true
      emit(ev)
    })
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-5000) })
  const exitCode = await new Promise<number>((resolve) => {
    child.once('error', (err) => {
      if (generation === turnGeneration) { sawError = true; emit({ type: 'error', message: err.message }) }
      resolve(1)
    })
    child.once('close', (code) => resolve(code ?? 1))
  })
  lines.close()
  if (activeChild === child) activeChild = null
  if (generation !== turnGeneration) return

  if (exitCode === 0) {
    const updated = await fs.readFile(ws.storyFile, 'utf8').catch(() => params.script)
    if (generation !== turnGeneration) return
    if (updated !== params.script && updated.trim()) emit({ type: 'script_updated', content: updated })
  } else if (!sawError) {
    emit({ type: 'error', message: stderr.trim() || `CLI 退出，状态码 ${exitCode}` })
  }
  emit({ type: 'done', exitCode })
}
