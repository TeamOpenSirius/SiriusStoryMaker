<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  BookMarked,
  Bot,
  Check,
  History,
  MessageSquarePlus,
  Plug,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-vue-next'
import type { DslDiagnostic } from '../dsl/compiler'
import type {
  HarnessId,
  HarnessInfo,
  HarnessStreamEvent,
  StudioMcpInfo,
  StudioSkillInfo,
} from '../env'

import { useI18n } from '../i18n'

const { tr } = useI18n()

const props = defineProps<{
  script: string
  filePath?: string
  diagnostics?: DslDiagnostic[]
}>()

const emit = defineEmits<{
  applyScript: [nextScript: string]
}>()

interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'system' | 'error'
  text: string
  storyBlock?: string
}

interface StoredSession {
  id: string
  title: string
  updatedAt: number
  mode: 'cli' | 'api'
  harnessId: HarnessId
  model: string
  remoteSessionId?: string
  tokens?: { input: number; output: number; cache: number }
  messages: ChatMsg[]
}

interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  effort: string
  autoApply: boolean
}

interface HarnessPrefs {
  selectedId: HarnessId
  modelsByHarness: Partial<Record<HarnessId, string>>
  effortByHarness: Partial<Record<HarnessId, string>>
  enableMcp: boolean
  disabledSkills: string[]
  deepseekApiKey: string
  deepseekBaseUrl: string
}

const API_CONFIG_KEY = 'sirius-adv-studio.ai-api.v2'
const HARNESS_PREFS_KEY = 'sirius-adv-studio.harness-prefs.v1'
const SESSIONS_STORAGE_KEY = 'sirius-adv-studio.ai-sessions.v1'
const MAX_SESSIONS = 30

const API_SYSTEM_PROMPT = `你是 SiriusStoryMaker 的剧情导演助手，专门编写 WDS Adv Player 极简 DSL 剧本。
可用语法：
- @title <标题> / @chapter <章节> / @episode <数字ID>
- @alias <角色名> <spine_id>（真实官方 ID：10101 心菜, 10201 静香, 10301 卡特莉娜, 10401 八惠, 10501 潘达, 10601 知沙）
- @scene <id> title="<标题>" x=<n> y=<n> bgm="<id|inherit|stop>"，配合 -> <id> 或 @choice "<文案>" -> <id>
- @bg <id> [fade=cross|black|white|time] [camera=1..6]
- @char <slot> <spine_id|alias> [pos=outer_left|left|center|right|outer_right] [expr=...] [body=...]
- @clear_chars / @effect sepia|blur|none / @fade black|white|time 0.4 0.5 0.4 / @se <id> / @voice <id>（BGM 设在场景上，留空延续旧曲，stop 停乐。SE 与配音设在帧上）
- 说话人(small|middle|large): 台词 / + 同组续行 / : 旁白
请始终在回复末尾给出完整的 \`\`\`story 代码块，并用简洁中文说明改动。`

const EFFORT_LABELS: Record<string, string> = {
  default: '默认推理',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function loadApiConfig(): ApiConfig {
  const fallback: ApiConfig = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    effort: 'default',
    autoApply: true,
  }
  try {
    const raw = localStorage.getItem(API_CONFIG_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<ApiConfig>) } : fallback
  } catch {
    return fallback
  }
}

function loadHarnessPrefs(): HarnessPrefs {
  const fallback: HarnessPrefs = {
    selectedId: 'codex',
    modelsByHarness: {},
    effortByHarness: {},
    enableMcp: true,
    disabledSkills: [],
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
  }
  try {
    const raw = localStorage.getItem(HARNESS_PREFS_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<HarnessPrefs>) } : fallback
  } catch {
    return fallback
  }
}

function loadStoredSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const mode = ref<'cli' | 'api'>(typeof window !== 'undefined' && window.siriusStudio ? 'cli' : 'api')
const activeOverlay = ref<'none' | 'history' | 'config'>('none')
const configTab = ref<'connection' | 'skills' | 'mcp'>('connection')

const apiConfig = ref<ApiConfig>(loadApiConfig())
const prefs = ref<HarnessPrefs>(loadHarnessPrefs())
const harnesses = ref<HarnessInfo[]>([])
const skills = ref<StudioSkillInfo[]>([])
const mcpInfo = ref<StudioMcpInfo | null>(null)

const sessions = ref<StoredSession[]>(window.siriusStudio ? [] : loadStoredSessions())
const settingsReady = ref(!window.siriusStudio)
const scanning = ref(false)
const scanError = ref('')
let submittedScript = ''
let receivedScript = false
const currentLocalSessionId = ref<string>(uid())
const remoteSessionId = ref<string | undefined>(undefined)

const busy = ref(false)
const liveStatus = ref('')
const errorBanner = ref('')
const promptInput = ref('')
const tokenStats = ref({ input: 0, output: 0, cache: 0 })
const lastContextTokens = ref(0)
const chatScrollRef = ref<HTMLElement | null>(null)
let apiAbortController: AbortController | null = null

function fmtTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const contextDisplay = computed(() => {
  if (lastContextTokens.value > 0) return fmtTokens(lastContextTokens.value)
  const chars =
    props.script.length +
    messages.value.reduce((acc, m) => acc + (m.role === 'user' || m.role === 'assistant' ? m.text.length : 0), 0)
  return `~${fmtTokens(Math.max(100, Math.round(chars * 0.65)))}`
})

const agentStatusMeta = computed(() => {
  if (errorBanner.value) return { cls: 'err', label: '异常' }
  if (!busy.value) return { cls: 'idle', label: '就绪' }
  if (liveStatus.value.includes('工具') || liveStatus.value.includes('MCP')) {
    return { cls: 'tool', label: liveStatus.value.slice(0, 14) }
  }
  return { cls: 'busy', label: '运行中' }
})

const messages = ref<ChatMsg[]>([
  {
    id: uid(),
    role: 'system',
    text: '已就绪。输入剧情指令即可直接创作或修改剧本，模型与接口配置位于顶部工具栏的 AI 菜单。',
  },
])

function persistSettings() {
  if (!settingsReady.value) return
  if (window.siriusStudio) {
    void window.siriusStudio.writeAiSettings(JSON.stringify({ mode: mode.value, api: apiConfig.value, prefs: prefs.value }))
      .catch((err) => { scanError.value = `无法保存 AI 设置：${String(err)}` })
    return
  }
  try {
    localStorage.setItem(API_CONFIG_KEY, JSON.stringify(apiConfig.value))
    localStorage.setItem(HARNESS_PREFS_KEY, JSON.stringify(prefs.value))
  } catch { /* browser storage not available */ }
}
watch([apiConfig, prefs, mode], persistSettings, { deep: true })

async function restoreSettingsAndHistory() {
  const api = window.siriusStudio
  if (api) {
    try {
      const [settings, history] = await Promise.all([api.readAiSettings(), api.readAiHistory()])
      const saved = JSON.parse(settings)
      if (saved?.prefs) prefs.value = { ...prefs.value, ...saved.prefs }
      if (saved?.api) apiConfig.value = { ...apiConfig.value, ...saved.api }
      if (saved?.mode === 'api' || saved?.mode === 'cli') mode.value = saved.mode
      const records = JSON.parse(history)
      if (Array.isArray(records)) sessions.value = records.filter((row) => row && Array.isArray(row.messages))
    } catch (err) {
      scanError.value = `无法读取 AI 设置或会话：${String(err)}`
    }
  }
  const latest = sessions.value[0]
  if (latest) {
    currentLocalSessionId.value = latest.id
    if (latest.mode === mode.value && (latest.mode === 'api' || latest.harnessId === prefs.value.selectedId)) {
      remoteSessionId.value = latest.remoteSessionId
    }
    messages.value = latest.messages.map((m) => ({ ...m, id: m.id || uid() }))
    if (latest.tokens) tokenStats.value = { ...latest.tokens }
  }
  await nextTick()
  settingsReady.value = true
}

function persistSessions() {
  if (window.siriusStudio) {
    void window.siriusStudio.writeAiHistory(JSON.stringify(sessions.value.slice(0, MAX_SESSIONS)))
      .catch((err) => { errorBanner.value = `无法保存会话：${String(err)}` })
    return
  }
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.value.slice(0, MAX_SESSIONS)))
  } catch {
    // ignore storage quota errors
  }
}

function saveCurrentSessionSnapshot() {
  const hasRealMessages = messages.value.some((m) => m.role === 'user' || m.role === 'assistant')
  if (!hasRealMessages) return
  const firstUser = messages.value.find((m) => m.role === 'user')
  const title = (firstUser?.text || '未命名会话').replace(/\s+/g, ' ').slice(0, 28)
  const record: StoredSession = {
    id: currentLocalSessionId.value,
    title,
    updatedAt: Date.now(),
    mode: mode.value,
    harnessId: activeHarness.value?.id ?? prefs.value.selectedId,
    model: mode.value === 'api' ? apiConfig.value.model : selectedModel.value,
    remoteSessionId: remoteSessionId.value,
    tokens: { ...tokenStats.value },
    messages: messages.value.slice(-40),
  }
  const next = sessions.value.filter((s) => s.id !== record.id)
  next.unshift(record)
  sessions.value = next.slice(0, MAX_SESSIONS)
  persistSessions()
}

function loadSession(s: StoredSession) {
  if (busy.value) return
  currentLocalSessionId.value = s.id
  remoteSessionId.value = s.remoteSessionId
  mode.value = s.mode
  if (s.mode === 'cli' && s.harnessId) {
    prefs.value.selectedId = s.harnessId
    prefs.value.modelsByHarness[s.harnessId] = s.model
  }
  tokenStats.value = s.tokens ? { ...s.tokens } : { input: 0, output: 0, cache: 0 }
  lastContextTokens.value = 0
  messages.value = s.messages.map((m) => ({ ...m, id: m.id || uid() }))
  errorBanner.value = ''
  liveStatus.value = ''
  activeOverlay.value = 'none'
  scrollToBottom()
}

function deleteSession(id: string) {
  sessions.value = sessions.value.filter((s) => s.id !== id)
  persistSessions()
  if (currentLocalSessionId.value === id) {
    startNewSession()
  }
}

function startNewSession() {
  if (busy.value) return
  saveCurrentSessionSnapshot()
  currentLocalSessionId.value = uid()
  remoteSessionId.value = undefined
  tokenStats.value = { input: 0, output: 0, cache: 0 }
  lastContextTokens.value = 0
  errorBanner.value = ''
  liveStatus.value = ''
  activeOverlay.value = 'none'
  messages.value = [
    {
      id: uid(),
      role: 'system',
      text: '已开启新对话。',
    },
  ]
}

function dismissMessage(msgId: string) {
  messages.value = messages.value.filter((m) => m.id !== msgId)
  saveCurrentSessionSnapshot()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

const availableHarnesses = computed(() => harnesses.value.filter((h) => h.available))
const activeHarness = computed(
  () => availableHarnesses.value.find((h) => h.id === prefs.value.selectedId) ?? availableHarnesses.value[0],
)

const selectedModel = computed({
  get() {
    const id = activeHarness.value?.id
    if (!id) return ''
    return prefs.value.modelsByHarness[id] ?? activeHarness.value?.models[0]?.id ?? ''
  },
  set(val: string) {
    const id = activeHarness.value?.id
    if (!id) return
    prefs.value.modelsByHarness = { ...prefs.value.modelsByHarness, [id]: val }
  },
})

const modelEfforts = computed(() => {
  const harness = activeHarness.value
  const model = harness?.models.find((entry) => entry.id === selectedModel.value)
  return model?.efforts ? ['default', ...model.efforts] : harness?.efforts ?? ['default']
})

const modelLabel = computed(() => activeHarness.value?.models.find((entry) => entry.id === selectedModel.value)?.label || selectedModel.value || '默认模型')

const selectedEffort = computed({
  get() {
    const id = activeHarness.value?.id
    if (!id) return 'default'
    const preferred = prefs.value.effortByHarness[id] ?? 'default'
    return modelEfforts.value.includes(preferred) ? preferred : 'default'
  },
  set(val: string) {
    const id = activeHarness.value?.id
    if (!id) return
    prefs.value.effortByHarness = { ...prefs.value.effortByHarness, [id]: val }
  },
})

const enabledSkillIds = computed(() =>
  skills.value.filter((s) => !prefs.value.disabledSkills.includes(s.id)).map((s) => s.id),
)

let unsubscribe: (() => void) | null = null

function toggleOverlay(target: 'history' | 'config') {
  activeOverlay.value = activeOverlay.value === target ? 'none' : target
}

function toggleSkill(skillId: string) {
  const cur = new Set(prefs.value.disabledSkills)
  if (cur.has(skillId)) cur.delete(skillId)
  else cur.add(skillId)
  prefs.value.disabledSkills = Array.from(cur)
}

function scrollToBottom() {
  void nextTick(() => {
    if (chatScrollRef.value) {
      chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
    }
  })
}

function extractStoryBlock(text: string): string | undefined {
  const regex = /```(?:story|dsl)?\s*\n([\s\S]*?)```/gi
  let lastMatch: string | undefined
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    const body = m[1]?.trim()
    if (body) lastMatch = body
  }
  return lastMatch
}

function applyWithUndo(nextScript: string) {
  if (nextScript !== props.script) emit('applyScript', nextScript)
}

function openConfig(tab: 'connection' | 'skills' | 'mcp') {
  activeOverlay.value = 'config'
  configTab.value = tab
}

function closeConfig() {
  if (activeOverlay.value === 'config') activeOverlay.value = 'none'
}

defineExpose({ openConfig, closeConfig })

async function refreshHarnesses(forceRefresh: boolean = false) {
  if (!window.siriusStudio || scanning.value) return
  scanning.value = true
  scanError.value = ''
  try {
    const [list, skillList, mcp] = await Promise.all([
      window.siriusStudio.detectHarnesses(forceRefresh),
      window.siriusStudio.listSkills(forceRefresh).catch(() => []),
      window.siriusStudio.getMcpInfo().catch(() => null),
    ])
    harnesses.value = list
    skills.value = skillList
    mcpInfo.value = mcp
    const active = activeHarness.value
    if (active && prefs.value.selectedId !== active.id) {
      prefs.value.selectedId = active.id
      remoteSessionId.value = undefined
    }
  } catch (err) {
    scanError.value = `扫描失败：${String(err)}`
  } finally { scanning.value = false }
}

function onHarnessChanged() {
  remoteSessionId.value = undefined
  errorBanner.value = ''
  if (activeHarness.value?.id === 'deepseek' && activeHarness.value.requiresApiKey && !prefs.value.deepseekApiKey) {
    activeOverlay.value = 'config'
    configTab.value = 'connection'
  }
}

function fixDiagnostics() {
  const list = props.diagnostics ?? []
  if (list.length === 0) return
  const summary = list.map((d) => `第 ${d.line} 行: ${d.message}`).join('\n')
  void sendPrompt(`请修复当前剧本中的以下语法或资源 ID 错误，并同步更新剧本：\n${summary}`)
}

async function sendViaApi(userText: string, assistantMsg: ChatMsg) {
  const { baseUrl, apiKey, model, effort, autoApply } = apiConfig.value
  if (!baseUrl.trim() || !model.trim()) {
    errorBanner.value = '请先在「配置 → 接口与模式」中填写 Base URL 与模型名称。'
    activeOverlay.value = 'config'
    configTab.value = 'connection'
    busy.value = false
    return
  }

  apiAbortController = new AbortController()
  liveStatus.value = `请求 ${model}…`

  const diagText =
    props.diagnostics && props.diagnostics.length > 0
      ? `\n\n当前编译诊断：\n${props.diagnostics.map((d) => `- L${d.line}: ${d.message}`).join('\n')}`
      : ''

  const history = messages.value
    .slice(0, -1)
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text.trim()))
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.text }))

  const payload: Record<string, unknown> = {
    model: model.trim(),
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: API_SYSTEM_PROMPT },
      ...history.slice(0, -1),
      {
        role: 'user',
        content: `当前剧本：\n\`\`\`story\n${props.script}\n\`\`\`${diagText}\n\n用户需求：${userText}`,
      },
    ],
  }
  if (effort && effort !== 'default') payload.reasoning_effort = effort

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: apiAbortController.signal,
    })
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 180) || resp.statusText}`)
    }

    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream') && resp.body) {
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(dataStr)
            if (parsed.usage) {
              const inp = Number(parsed.usage.prompt_tokens ?? 0) || 0
              const out = Number(parsed.usage.completion_tokens ?? 0) || 0
              const hit = Number(parsed.usage.prompt_cache_hit_tokens ?? 0) || 0
              if (inp > 0) lastContextTokens.value = inp
              tokenStats.value.input += inp
              tokenStats.value.output += out
              tokenStats.value.cache += hit
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (typeof delta === 'string') {
              assistantMsg.text += delta
              assistantMsg.storyBlock = extractStoryBlock(assistantMsg.text)
              scrollToBottom()
            }
          } catch {
            // ignore partial JSON
          }
        }
      }
    } else {
      const data = await resp.json()
      const content = data.choices?.[0]?.message?.content || ''
      assistantMsg.text = content
      assistantMsg.storyBlock = extractStoryBlock(content)
      scrollToBottom()
    }

    if (autoApply && assistantMsg.storyBlock && props.script === submittedScript) {
      applyWithUndo(assistantMsg.storyBlock)
      liveStatus.value = '已自动应用改动'
    } else {
      if (autoApply && assistantMsg.storyBlock) errorBanner.value = '等待 AI 时剧本已变更。请检查后手动应用 AI 稿。'
      liveStatus.value = ''
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      liveStatus.value = '已中断'
    } else {
      errorBanner.value = `API 调用失败: ${err instanceof Error ? err.message : String(err)}`
      liveStatus.value = ''
    }
  } finally {
    apiAbortController = null
    busy.value = false
    saveCurrentSessionSnapshot()
    scrollToBottom()
  }
}

async function sendPrompt(customPrompt?: string) {
  const text = (customPrompt ?? promptInput.value).trim()
  if (!text || busy.value || !settingsReady.value) return
  errorBanner.value = ''

  if (mode.value === 'cli') {
    if (!window.siriusStudio || !activeHarness.value) {
      errorBanner.value = scanning.value ? '正在检测本地 CLI，请稍后。' : '未检测到可用 CLI。请在工具栏 AI 设置中重新扫描或切换 API 直连。'
      openConfig('connection')
      return
    }
    if (
      activeHarness.value.id === 'deepseek' &&
      activeHarness.value.requiresApiKey &&
      !prefs.value.deepseekApiKey.trim()
    ) {
      errorBanner.value = '请先在「配置 → 接口与模式」填写 DeepSeek API Key。'
      activeOverlay.value = 'config'
      configTab.value = 'connection'
      return
    }
  }

  activeOverlay.value = 'none'
  if (!customPrompt) promptInput.value = ''
  messages.value.push({ id: uid(), role: 'user', text })
  messages.value.push({ id: uid(), role: 'assistant', text: '' })
  const assistantMsg = messages.value[messages.value.length - 1]
  busy.value = true
  submittedScript = props.script
  receivedScript = false
  saveCurrentSessionSnapshot()
  scrollToBottom()

  if (mode.value === 'api') {
    await sendViaApi(text, assistantMsg)
    return
  }

  liveStatus.value = `连接 ${activeHarness.value!.name}…`
  try {
    await window.siriusStudio!.sendHarnessPrompt({
      harnessId: activeHarness.value!.id,
      command: activeHarness.value!.command,
      prompt: text,
      script: props.script,
      sessionId: remoteSessionId.value,
      filePath: props.filePath,
      model: selectedModel.value || undefined,
      effort: selectedEffort.value || undefined,
      enabledSkills: enabledSkillIds.value,
      enableMcp: prefs.value.enableMcp && activeHarness.value!.supportsMcp,
      apiKey: activeHarness.value!.id === 'deepseek' ? prefs.value.deepseekApiKey : undefined,
      baseUrl: activeHarness.value!.id === 'deepseek' ? prefs.value.deepseekBaseUrl : undefined,
    })
  } catch (err) {
    errorBanner.value = `调用失败: ${err instanceof Error ? err.message : String(err)}`
    busy.value = false
    saveCurrentSessionSnapshot()
  }
}

async function stopTurn() {
  if (mode.value === 'api') {
    apiAbortController?.abort()
    return
  }
  await window.siriusStudio?.stopHarness()
  busy.value = false
  liveStatus.value = '已中断'
  saveCurrentSessionSnapshot()
}

onMounted(() => {
  void restoreSettingsAndHistory().then(() => refreshHarnesses(false))
  if (window.siriusStudio) {
    unsubscribe = window.siriusStudio.onHarnessEvent((ev: HarnessStreamEvent) => {
      if (!busy.value) return
      const last = messages.value[messages.value.length - 1]
      if (ev.type === 'session') {
        remoteSessionId.value = ev.sessionId
      } else if (ev.type === 'status') {
        liveStatus.value = ev.text
      } else if (ev.type === 'delta') {
        if (last?.role === 'assistant') {
          last.text += ev.text
          last.storyBlock = extractStoryBlock(last.text)
          scrollToBottom()
        }
      } else if (ev.type === 'script_updated') {
        receivedScript = true
        if (props.script === submittedScript) {
          applyWithUndo(ev.content)
          submittedScript = ev.content
          liveStatus.value = '已同步改动到分镜与舞台'
        } else if (last?.role === 'assistant') {
          last.storyBlock = ev.content
          errorBanner.value = '等待 AI 时剧本已变更。请检查后手动应用 AI 稿。'
        }
      } else if (ev.type === 'usage') {
        const inp = ev.inputTokens ?? 0
        const out = ev.outputTokens ?? 0
        const hit = ev.cacheReadTokens ?? 0
        if (inp > 0) lastContextTokens.value = inp
        tokenStats.value.input += inp
        tokenStats.value.output += out
        tokenStats.value.cache += hit
      } else if (ev.type === 'error') {
        errorBanner.value = ev.message
      } else if (ev.type === 'done') {
        busy.value = false
        if (ev.exitCode === 0 && !receivedScript && last?.storyBlock && props.script === submittedScript) {
          applyWithUndo(last.storyBlock)
          liveStatus.value = '已同步改动到分镜与舞台'
        }
        if (last?.role === 'assistant' && !last.text.trim() && liveStatus.value.includes('同步')) {
          last.text = '已更新剧本并同步至编辑器与预览舞台。'
        }
        if (!liveStatus.value.includes('同步')) liveStatus.value = ''
        saveCurrentSessionSnapshot()
        scrollToBottom()
      }
    })
  }
})

onBeforeUnmount(() => {
  apiAbortController?.abort()
  unsubscribe?.()
})
</script>

<template>
  <div class="ai-panel">
    <!-- Clean, Spacious Header -->
    <div class="ai-header">
      <div class="ai-title-row">
        <Bot :size="14" class="ai-icon" />
        <span class="ai-title">{{ tr('AI 导演', 'AI Director') }}</span>
      </div>

      <div class="ai-actions">
        <button
          class="hdr-btn"
          :class="{ active: activeOverlay === 'history' }"
          type="button"
          :title="tr('会话历史', 'Chat History')"
          @click="toggleOverlay('history')"
        >
          <History :size="13" />
          <span v-if="sessions.length > 0" class="hdr-count">{{ sessions.length }}</span>
        </button>

        <button class="hdr-btn" type="button" :title="tr('新对话', 'New Chat')" :disabled="busy" @click="startNewSession">
          <MessageSquarePlus :size="13" />
        </button>

      </div>
    </div>
    <button
      class="model-bar api-summary"
      type="button"
      :title="tr('点击打开 AI 接口与模型设置', 'Click to open AI provider & model settings')"
      @click="openConfig('connection')"
    >
      <span class="api-tag">{{ mode === 'api' ? tr('API 直连', 'Direct API') : (activeHarness?.name || tr('未检测到 CLI', 'No CLI found')) }}</span>
      <span class="api-model-name" :title="mode === 'api' ? apiConfig.model : modelLabel">{{ mode === 'api' ? apiConfig.model : modelLabel }}</span>
      <span class="api-edit-hint">{{ tr('配置', 'Config') }}</span>
    </button>

    <!-- Session History Drawer -->
    <div v-if="activeOverlay === 'history'" class="overlay-drawer">
      <div class="drawer-top">
        <span>{{ tr(`历史会话 (${sessions.length})`, `History (${sessions.length})`) }}</span>
        <button class="close-x" type="button" @click="activeOverlay = 'none'"><X :size="13" /></button>
      </div>
      <div v-if="sessions.length === 0" class="drawer-empty">{{ tr('暂无历史会话', 'No chat history yet') }}</div>
      <div v-else class="history-list">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="history-item"
          :class="{ current: s.id === currentLocalSessionId }"
          @click="loadSession(s)"
        >
          <div class="hist-main">
            <div class="hist-title">{{ s.title }}</div>
            <div class="hist-meta">
              {{ formatTime(s.updatedAt) }} · {{ s.mode === 'api' ? 'API' : s.harnessId }} · {{ s.messages.length }} 条
            </div>
          </div>
          <button class="hist-del" type="button" title="删除会话" @click.stop="deleteSession(s.id)">
            <Trash2 :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Unified Config Drawer (Connection / Skills / MCP) -->
    <Teleport to="body">
      <div v-if="activeOverlay === 'config'" class="ai-config-backdrop" @click.self="closeConfig">
        <section class="ai-config-dialog" role="dialog" aria-modal="true" aria-label="AI 设置">
      <div class="drawer-top">
        <div class="cfg-tabs">
          <button type="button" :class="{ active: configTab === 'connection' }" @click="configTab = 'connection'">
            接口
          </button>
          <button type="button" :class="{ active: configTab === 'skills' }" @click="configTab = 'skills'">
            <BookMarked :size="11" /> Skills ({{ enabledSkillIds.length }}/{{ skills.length }})
          </button>
          <button type="button" :class="{ active: configTab === 'mcp' }" @click="configTab = 'mcp'">
            <Plug :size="11" /> MCP
          </button>
        </div>
        <button class="close-x" type="button" @click="activeOverlay = 'none'"><X :size="13" /></button>
      </div>

      <!-- Tab: Connection / Mode -->
      <div v-if="configTab === 'connection'" class="cfg-body">
        <div class="mode-row">
          <button type="button" class="mode-opt" :class="{ active: mode === 'cli' }" :disabled="busy" @click="mode = 'cli'; remoteSessionId = undefined">
            本地 Harness
          </button>
          <button type="button" class="mode-opt" :class="{ active: mode === 'api' }" :disabled="busy" @click="mode = 'api'; remoteSessionId = undefined">
            API 直连
          </button>
        </div>

        <template v-if="mode === 'cli'">
          <div class="cfg-field">
            <label>本地 CLI</label>
            <select v-model="prefs.selectedId" :disabled="busy || scanning" @change="onHarnessChanged">
              <option v-for="h in harnesses" :key="h.id" :value="h.id" :disabled="!h.available">
                {{ h.name }}{{ h.available ? ` · ${h.version}` : ' · 未安装' }}
              </option>
            </select>
          </div>
          <template v-if="activeHarness && activeHarness.id !== 'dsh'">
            <div class="cfg-field">
              <label>模型</label>
              <select v-model="selectedModel" :disabled="busy">
                <option v-for="m in activeHarness.models" :key="m.id" :value="m.id">{{ m.label }}</option>
                <option v-if="!activeHarness.models.some((m) => m.id === selectedModel)" :value="selectedModel">{{ selectedModel }}（自定义）</option>
              </select>
            </div>
            <div class="cfg-field">
              <label>手动模型 ID</label>
              <input v-model="selectedModel" type="text" :disabled="busy" placeholder="留空使用 CLI 默认模型" />
            </div>
            <div v-if="modelEfforts.length > 1" class="cfg-field">
              <label>推理强度</label>
              <select v-model="selectedEffort" :disabled="busy">
                <option v-for="ef in modelEfforts" :key="ef" :value="ef">{{ EFFORT_LABELS[ef] || ef }}</option>
              </select>
            </div>
          </template>
          <p v-else-if="activeHarness?.id === 'dsh'" class="cfg-hint">模型与认证由本机 DSH headless profile 管理。</p>
          <p v-if="activeHarness?.modelError" class="cfg-error">{{ activeHarness.modelError }}。可使用 CLI 默认模型或手动输入 ID。</p>
          <p v-if="scanError" class="cfg-error">{{ scanError }}</p>
          <template v-if="activeHarness?.id === 'deepseek'">
            <div class="cfg-field">
              <label>DeepSeek Key</label>
              <input v-model="prefs.deepseekApiKey" type="password" placeholder="sk-... 或环境变量" />
            </div>
            <div class="cfg-field">
              <label>Base URL</label>
              <input v-model="prefs.deepseekBaseUrl" type="text" placeholder="https://api.deepseek.com/v1" />
            </div>
          </template>
          <button class="refresh-cli-btn" type="button" :disabled="busy || scanning" @click="refreshHarnesses(true)">
            <RefreshCw :size="11" /> {{ scanning ? '正在扫描…' : '刷新本机 CLI 与模型' }}
          </button>
        </template>

        <template v-else>
          <div class="cfg-field">
            <label>Base URL</label>
            <input v-model="apiConfig.baseUrl" type="text" placeholder="https://api.deepseek.com/v1" />
          </div>
          <div class="cfg-field">
            <label>API Key</label>
            <input v-model="apiConfig.apiKey" type="password" placeholder="sk-..." />
          </div>
          <div class="cfg-field">
            <label>Model</label>
            <input v-model="apiConfig.model" type="text" placeholder="deepseek-chat / deepseek-reasoner" />
          </div>
          <div class="cfg-field">
            <label>推理强度</label>
            <select v-model="apiConfig.effort">
              <option value="default">默认</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
          <label class="cfg-check">
            <input v-model="apiConfig.autoApply" type="checkbox" />
            <span>回复含 story 代码块时自动应用</span>
          </label>
        </template>
      </div>

      <!-- Tab: Skills -->
      <div v-else-if="configTab === 'skills'" class="cfg-body">
        <div v-if="skills.length === 0" class="drawer-empty">未检测到内置 Skills</div>
        <label v-for="sk in skills" :key="sk.id" class="skill-row">
          <input type="checkbox" :checked="!prefs.disabledSkills.includes(sk.id)" @change="toggleSkill(sk.id)" />
          <div class="skill-txt">
            <div class="skill-name">{{ sk.name }}</div>
            <div class="skill-desc">{{ sk.description }}</div>
          </div>
        </label>
      </div>

      <!-- Tab: MCP -->
      <div v-else class="cfg-body">
        <div class="mcp-top">
          <label class="cfg-check">
            <input v-model="prefs.enableMcp" type="checkbox" />
            <span>启用 Sirius Studio MCP</span>
          </label>
          <span class="mcp-state" :class="{ ok: mcpInfo?.available }">
            {{ mcpInfo?.available ? '已就绪' : '未构建' }}
          </span>
        </div>
        <div v-for="t in mcpInfo?.tools ?? []" :key="t.name" class="mcp-row">
          <code>{{ t.name }}</code>
          <span>{{ t.description }}</span>
        </div>
      </div>
        </section>
      </div>
    </Teleport>

    <!-- Dismissible Error Banner -->
    <div v-if="errorBanner" class="error-banner">
      <AlertCircle :size="13" class="err-ico" />
      <span class="err-msg">{{ errorBanner }}</span>
      <button class="err-close" type="button" title="关闭错误提醒" @click="errorBanner = ''">
        <X :size="13" />
      </button>
    </div>

    <!-- Quick Prompt Chips -->
    <div class="quick-chips">
      <button class="chip" type="button" :disabled="busy" @click="sendPrompt('续写一段 4 句左右的排练室对话，加入合理的角色表情和动作')">
        <Wand2 :size="10" /> 续写对话
      </button>
      <button class="chip" type="button" :disabled="busy" @click="sendPrompt('在当前剧情后加一段怀旧 sepia 回忆片段，再切回现实')">
        + 回忆
      </button>
      <button class="chip" type="button" :disabled="busy" @click="sendPrompt('在末尾添加一个 2 选项的 @choice 分支场景')">
        + 分支
      </button>
      <button
        v-if="(diagnostics?.length ?? 0) > 0"
        class="chip warn"
        type="button"
        :disabled="busy"
        @click="fixDiagnostics"
      >
        修 {{ diagnostics?.length }} 报错
      </button>
    </div>

    <!-- Chat Messages -->
    <div ref="chatScrollRef" class="chat-scroll">
      <div v-for="(msg, idx) in messages" :key="msg.id" class="chat-msg" :class="msg.role">
        <div class="msg-head">
          <span class="msg-role">
            {{ msg.role === 'user' ? '你' : msg.role === 'assistant' ? (mode === 'api' ? apiConfig.model : (activeHarness?.name || 'AI')) : '提示' }}
          </span>
          <button
            v-if="msg.role === 'system' || msg.role === 'error'"
            class="msg-dismiss"
            type="button"
            title="消除此提醒"
            @click="dismissMessage(msg.id)"
          >
            <X :size="11" />
          </button>
        </div>
        <div class="msg-body">
          <template v-if="msg.text">{{ msg.text }}</template>
          <span v-else-if="busy && idx === messages.length - 1" class="thinking-inline">
            <span class="pulse-dot" />
            <span>{{ liveStatus || '正在思考与处理…' }}</span>
          </span>
        </div>
        <div v-if="busy && idx === messages.length - 1 && msg.text && liveStatus" class="streaming-hint">
          <span class="pulse-dot" /> {{ liveStatus }}
        </div>
        <button
          v-if="msg.storyBlock"
          class="apply-btn"
          type="button"
          @click="applyWithUndo(msg.storyBlock!)"
        >
          <Check :size="11" /> 应用到编辑器
        </button>
      </div>
    </div>

    <!-- Minimal Single-Line Agent Telemetry Strip (Status + Context + Token Usage) -->
    <div class="telemetry-bar">
      <span class="t-status" :class="agentStatusMeta.cls">
        <span class="t-dot" />
        {{ agentStatusMeta.label }}
      </span>
      <div class="t-metrics">
        <span title="当前上下文估算/实际输入 Token">上下文 {{ contextDisplay }}</span>
        <span v-if="tokenStats.input + tokenStats.output > 0" class="t-sep">·</span>
        <span
          v-if="tokenStats.input + tokenStats.output > 0"
          :title="`累计输入 ${tokenStats.input} / 输出 ${tokenStats.output}${tokenStats.cache ? ` / 缓存命中 ${tokenStats.cache}` : ''}`"
        >
          ↑{{ fmtTokens(tokenStats.input) }} ↓{{ fmtTokens(tokenStats.output) }}
        </span>
      </div>
    </div>

    <!-- Composer -->
    <div class="composer">
      <textarea
        v-model="promptInput"
        class="prompt-input"
        rows="2"
        placeholder="描述你想创作的剧情… (Ctrl+Enter 发送)"
        @keydown.ctrl.enter.prevent="sendPrompt()"
        @keydown.meta.enter.prevent="sendPrompt()"
      />
      <div class="composer-footer">
        <span class="session-hint">
          {{ remoteSessionId ? `会话 #${remoteSessionId.slice(0, 6)}` : '新上下文' }}
        </span>
        <button v-if="busy" class="send-btn stop" type="button" @click="stopTurn">
          <Square :size="10" /> 停止
        </button>
        <button v-else class="send-btn" type="button" :disabled="!promptInput.trim()" @click="sendPrompt()">
          <Send :size="10" /> 发送
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #101014;
  overflow: hidden;
}
.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 10px;
  background: #16161b;
  border-bottom: 1px solid #232329;
  flex-shrink: 0;
}
.ai-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ai-icon {
  color: #34d399;
}
.ai-title {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
}
.ai-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.hdr-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: #a1a1aa;
  font-size: 11px;
  cursor: pointer;
}
.hdr-btn:hover:not(:disabled) {
  background: #25252e;
  color: #f4f4f5;
}
.hdr-btn.active {
  background: #272731;
  color: #f472b6;
}
.hdr-btn.undo {
  color: #fbbf24;
}
.hdr-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.hdr-count {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 999px;
  background: #272731;
  color: #d4d4d8;
}

/* Compact Model Bar */
.model-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
  background: #131318;
  border-bottom: 1px solid #202026;
  flex-shrink: 0;
}
.m-select {
  font-size: 11px;
  height: 24px;
  padding: 0 5px;
  border-radius: 5px;
  border: 1px solid #2b2b34;
  background: #09090b;
  color: #e4e4e7;
  min-width: 0;
}
.m-select.harness {
  flex: 1;
}
.m-select.model {
  flex: 1.3;
}
.m-select.effort {
  width: 68px;
  flex-shrink: 0;
}
.api-summary {
  width: 100%;
  border: 0;
  border-bottom: 1px solid #232329;
  justify-content: space-between;
  font-size: 11px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.api-summary:hover {
  background: #18181f;
}
.api-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  font-size: 10px;
  flex-shrink: 0;
}
.api-model-name {
  flex: 1;
  color: #d4d4d8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.api-edit-hint {
  font-size: 10px;
  color: #71717a;
  flex-shrink: 0;
}
.api-summary:hover .api-edit-hint {
  color: #f472b6;
}
.link-btn {
  border: 0;
  background: transparent;
  color: #f472b6;
  font-size: 11px;
  cursor: pointer;
}

/* Unified Overlay Drawer (History / Config) */
.overlay-drawer {
  display: flex;
  flex-direction: column;
  background: #15151b;
  border-bottom: 1px solid #282832;
  max-height: 230px;
  overflow: hidden;
  flex-shrink: 0;
}
.drawer-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid #22222b;
  font-size: 11px;
  font-weight: 600;
  color: #e4e4e7;
}
.close-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
}
.close-x:hover {
  background: #272731;
  color: #f4f4f5;
}
.cfg-tabs {
  display: flex;
  gap: 4px;
}
.cfg-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.cfg-tabs button.active {
  background: #272731;
  color: #fff;
  font-weight: 600;
}
.cfg-body,
.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.drawer-empty {
  padding: 16px;
  text-align: center;
  font-size: 11px;
  color: #71717a;
}
.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #0d0d11;
  border: 1px solid #22222a;
  cursor: pointer;
}
.history-item:hover {
  border-color: #3f3f46;
}
.history-item.current {
  border-color: #ec4899;
  background: rgba(236, 72, 153, 0.08);
}
.hist-main {
  min-width: 0;
  flex: 1;
}
.hist-title {
  font-size: 11px;
  font-weight: 600;
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-meta {
  font-size: 10px;
  color: #71717a;
  margin-top: 2px;
}
.hist-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
}
.hist-del:hover {
  background: rgba(153, 27, 27, 0.4);
  color: #fca5a5;
}

.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  background: #09090b;
  padding: 3px;
  border-radius: 6px;
}
.mode-opt {
  font-size: 11px;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.mode-opt.active {
  background: #272731;
  color: #fff;
  font-weight: 600;
}
.cfg-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cfg-field label {
  width: 72px;
  font-size: 11px;
  color: #a1a1aa;
  flex-shrink: 0;
}
.cfg-field input,
.cfg-field select {
  flex: 1;
  font-size: 11px;
  padding: 4px 7px;
  border-radius: 5px;
  border: 1px solid #2b2b34;
  background: #09090b;
  color: #f4f4f5;
}
.cfg-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #d4d4d8;
  cursor: pointer;
}
.refresh-cli-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid #2c2c35;
  background: #1e1e26;
  color: #d4d4d8;
  font-size: 11px;
  cursor: pointer;
}
.refresh-cli-btn:hover {
  background: #292934;
}
.skill-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 5px 7px;
  border-radius: 6px;
  background: #0c0c10;
  cursor: pointer;
}
.skill-name {
  font-size: 11px;
  font-weight: 600;
  color: #38bdf8;
}
.skill-desc {
  font-size: 10px;
  color: #a1a1aa;
  line-height: 1.35;
}
.mcp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mcp-state {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #272730;
  color: #fbbf24;
}
.mcp-state.ok {
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}
.mcp-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10px;
  padding: 4px 6px;
  border-radius: 5px;
  background: #0c0c10;
}
.mcp-row code {
  color: #f472b6;
  flex-shrink: 0;
}
.mcp-row span {
  color: #a1a1aa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Dismissible Error Banner */
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 10px;
  background: rgba(127, 29, 29, 0.45);
  border-bottom: 1px solid #991b1b;
  color: #fecaca;
  font-size: 11px;
  line-height: 1.4;
  flex-shrink: 0;
}
.err-ico {
  flex-shrink: 0;
  margin-top: 1px;
  color: #f87171;
}
.err-msg {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.err-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fecaca;
  cursor: pointer;
  flex-shrink: 0;
}
.err-close:hover {
  background: rgba(248, 113, 113, 0.2);
}

.quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #1e1e24;
  flex-shrink: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #2b2b34;
  background: #16161c;
  color: #7dd3fc;
  cursor: pointer;
}
.chip:hover:not(:disabled) {
  background: #24242d;
}
.chip.warn {
  color: #fca5a5;
  border-color: #991b1b;
  background: rgba(127, 29, 29, 0.25);
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #09090b;
}
.chat-msg {
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.user {
  background: rgba(236, 72, 153, 0.12);
  border: 1px solid rgba(236, 72, 153, 0.25);
}
.chat-msg.assistant {
  background: #15151a;
  border: 1px solid #24242c;
}
.chat-msg.system {
  background: rgba(56, 189, 248, 0.06);
  color: #a1a1aa;
  font-size: 11px;
}
.msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}
.msg-role {
  font-size: 10px;
  font-weight: 700;
  color: #a1a1aa;
}
.msg-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
}
.msg-dismiss:hover {
  background: #272731;
  color: #f4f4f5;
}
.apply-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 5px;
  border: 0;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}
.thinking-inline,
.streaming-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #fbbf24;
}
.streaming-hint {
  margin-top: 6px;
  font-size: 10px;
  color: #38bdf8;
}
.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  animation: aiPulse 1.1s ease-in-out infinite;
}
@keyframes aiPulse {
  0%, 100% { opacity: 0.25; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

.telemetry-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 24px;
  padding: 0 10px;
  background: #121217;
  border-top: 1px solid #1f1f27;
  font-size: 10px;
  color: #a1a1aa;
  flex-shrink: 0;
}
.t-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  white-space: nowrap;
}
.t-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #71717a;
}
.t-status.idle { color: #34d399; }
.t-status.idle .t-dot { background: #34d399; }
.t-status.busy { color: #fbbf24; }
.t-status.busy .t-dot { background: #fbbf24; }
.t-status.tool { color: #38bdf8; }
.t-status.tool .t-dot { background: #38bdf8; }
.t-status.err { color: #f87171; }
.t-status.err .t-dot { background: #f87171; }
.t-metrics {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-variant-numeric: tabular-nums;
  color: #71717a;
  white-space: nowrap;
}
.t-sep {
  color: #3f3f46;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: #131318;
  border-top: 1px solid #232329;
  flex-shrink: 0;
}
.prompt-input {
  width: 100%;
  resize: none;
  background: #09090b;
  color: #f4f4f5;
  border: 1px solid #2b2b34;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.4;
}
.prompt-input:focus {
  outline: none;
  border-color: #ec4899;
}
.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.session-hint {
  font-size: 10px;
  color: #71717a;
}
.send-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 0;
  background: #db2777;
  color: #fff;
  cursor: pointer;
}
.send-btn.stop {
  background: #dc2626;
}
.send-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.ai-config-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.7);
  display: grid;
  place-items: center;
}
.ai-config-dialog {
  width: min(520px, 92vw);
  max-height: 84vh;
  overflow: auto;
  background: #18181d;
  border: 1px solid #303038;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
  color: #f4f4f5;
  font-size: 12px;
}
.ai-config-dialog .drawer-top {
  position: sticky;
  top: 0;
  padding: 10px 14px;
  background: #18181d;
  border-bottom: 1px solid #26262e;
  z-index: 1;
}
.ai-config-dialog .cfg-body {
  padding: 14px;
  gap: 8px;
}
.ai-config-dialog .cfg-field input:focus,
.ai-config-dialog .cfg-field select:focus {
  outline: none;
  border-color: #ec4899;
}
.cfg-hint {
  margin: 0;
  font-size: 11px;
  color: #a1a1aa;
  line-height: 1.45;
}
.cfg-error {
  margin: 0;
  padding: 7px 9px;
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.3);
  border: 1px solid #991b1b;
  color: #fecaca;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
</style>
