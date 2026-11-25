<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DslDiagnostic } from '../dsl/compiler'
import type { HarnessInfo, HarnessStreamEvent } from '../env'

const props = defineProps<{
  script: string
  filePath?: string
  diagnostics?: DslDiagnostic[]
}>()

const emit = defineEmits<{
  applyScript: [nextScript: string]
  harnessesLoaded: [harnesses: HarnessInfo[]]
}>()

interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  text: string
  storyBlock?: string
}

const harnesses = ref<HarnessInfo[]>([])
const selectedId = ref<HarnessInfo['id']>('claude')
const sessionId = ref<string | undefined>(undefined)
const busy = ref(false)
const liveStatus = ref('')
const promptInput = ref('')
const messages = ref<ChatMsg[]>([
  {
    role: 'system',
    text: '已准备就绪。选择系统上的 AI Harness（如 Claude Code / Codex），即可通过多轮对话直接编写和修改右侧剧本。',
  },
])

const availableHarnesses = computed(() => harnesses.value.filter((h) => h.available))
const activeHarness = computed(
  () => availableHarnesses.value.find((h) => h.id === selectedId.value) ?? availableHarnesses.value[0],
)

let unsubscribe: (() => void) | null = null

function extractStoryBlock(text: string): string | undefined {
  const match = text.match(/```(?:story|dsl)?\s*\n([\s\S]*?)```/i)
  return match?.[1]?.trim()
}

async function refreshHarnesses() {
  if (!window.siriusStudio) return
  harnesses.value = await window.siriusStudio.detectHarnesses()
  emit('harnessesLoaded', harnesses.value)
  if (!availableHarnesses.value.some((h) => h.id === selectedId.value) && availableHarnesses.value[0]) {
    selectedId.value = availableHarnesses.value[0].id
  }
}

function fixDiagnostics() {
  const list = props.diagnostics ?? []
  if (list.length === 0) return
  const summary = list.map((d) => `第 ${d.line} 行: ${d.message}`).join('\n')
  void sendPrompt(`请修复当前剧本中的以下语法或资源 ID 错误，并直接更新文件：\n${summary}`)
}

function resetSession() {
  sessionId.value = undefined
  messages.value = [
    { role: 'system', text: '已开启新对话上下文。' },
  ]
}

async function sendPrompt(customPrompt?: string) {
  const text = (customPrompt ?? promptInput.value).trim()
  if (!text || busy.value) return
  if (!window.siriusStudio || !activeHarness.value) {
    messages.value.push({
      role: 'system',
      text: '未检测到可用的系统 AI Harness（请确认 claude / codex 已在 PATH 中）。',
    })
    return
  }

  if (!customPrompt) promptInput.value = ''
  messages.value.push({ role: 'user', text })
  const assistantMsg: ChatMsg = { role: 'assistant', text: '' }
  messages.value.push(assistantMsg)
  busy.value = true
  liveStatus.value = `连接 ${activeHarness.value.name}…`

  try {
    await window.siriusStudio.sendHarnessPrompt({
      harnessId: activeHarness.value.id,
      command: activeHarness.value.command,
      prompt: text,
      script: props.script,
      sessionId: sessionId.value,
      filePath: props.filePath,
    })
  } catch (err) {
    messages.value.push({
      role: 'system',
      text: `调用失败: ${err instanceof Error ? err.message : String(err)}`,
    })
    busy.value = false
  }
}

async function stopTurn() {
  await window.siriusStudio?.stopHarness()
  busy.value = false
  liveStatus.value = '已中断'
}

onMounted(() => {
  void refreshHarnesses()
  if (window.siriusStudio) {
    unsubscribe = window.siriusStudio.onHarnessEvent((ev: HarnessStreamEvent) => {
      const last = messages.value[messages.value.length - 1]
      if (ev.type === 'session') {
        sessionId.value = ev.sessionId
      } else if (ev.type === 'status') {
        liveStatus.value = ev.text
      } else if (ev.type === 'delta') {
        if (last?.role === 'assistant') {
          last.text += ev.text
          last.storyBlock = extractStoryBlock(last.text)
        }
      } else if (ev.type === 'script_updated') {
        emit('applyScript', ev.content)
        liveStatus.value = '已同步剧本改动到编辑器'
      } else if (ev.type === 'error') {
        messages.value.push({ role: 'system', text: `错误: ${ev.message}` })
      } else if (ev.type === 'done') {
        busy.value = false
        if (!liveStatus.value.includes('同步')) liveStatus.value = ''
      }
    })
  }
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="ai-panel">
    <div class="ai-header">
      <div class="ai-title-row">
        <span class="ai-title">AI 剧情导演</span>
        <select v-model="selectedId" class="harness-select" :disabled="busy || availableHarnesses.length === 0">
          <option v-for="h in availableHarnesses" :key="h.id" :value="h.id">
            {{ h.name }} ({{ h.version }})
          </option>
          <option v-if="availableHarnesses.length === 0" value="claude">未检测到可用 Harness</option>
        </select>
      </div>
      <div class="ai-actions">
        <button class="mini-btn" type="button" :disabled="busy" @click="refreshHarnesses">刷新</button>
        <button class="mini-btn" type="button" :disabled="busy" @click="resetSession">新对话</button>
      </div>
    </div>

    <div class="quick-chips">
      <button class="chip" type="button" :disabled="busy" @click="sendPrompt('续写一段 4 句左右的排练室对话，加入表情和身体动作切换')">
        + 续写排练对话
      </button>
      <button class="chip" type="button" :disabled="busy" @click="sendPrompt('在当前剧情后加一段怀旧 sepia 回忆片段，然后再切回现实')">
        + 加回忆片段
      </button>
      <button
        v-if="(diagnostics?.length ?? 0) > 0"
        class="chip warn"
        type="button"
        :disabled="busy"
        @click="fixDiagnostics"
      >
        修复 {{ diagnostics?.length }} 条报错
      </button>
    </div>

    <div class="chat-scroll">
      <div v-for="(msg, idx) in messages" :key="idx" class="chat-msg" :class="msg.role">
        <div class="msg-role">
          {{ msg.role === 'user' ? '你' : msg.role === 'assistant' ? (activeHarness?.name || 'AI') : '系统' }}
        </div>
        <div class="msg-body">{{ msg.text || (busy && idx === messages.length - 1 ? '思考中…' : '') }}</div>
        <button
          v-if="msg.storyBlock"
          class="apply-btn"
          type="button"
          @click="emit('applyScript', msg.storyBlock)"
        >
          应用此剧本到编辑器
        </button>
      </div>
    </div>

    <div v-if="liveStatus" class="live-status">{{ liveStatus }}</div>

    <div class="composer">
      <textarea
        v-model="promptInput"
        class="prompt-input"
        rows="3"
        placeholder="告诉 AI 你想写什么剧情（Ctrl+Enter 发送）…"
        @keydown.ctrl.enter.prevent="sendPrompt()"
      />
      <div class="composer-footer">
        <span class="session-hint">{{ sessionId ? `会话: ${sessionId.slice(0, 8)}` : '新会话' }}</span>
        <button v-if="busy" class="send-btn stop" type="button" @click="stopTurn">停止</button>
        <button v-else class="send-btn" type="button" :disabled="!promptInput.trim()" @click="sendPrompt()">发送</button>
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
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 10px;
  padding: 8px;
  gap: 8px;
}
.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.ai-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ai-title {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.harness-select {
  font-size: 11px;
  background: #09090b;
  color: #e4e4e7;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  padding: 3px 6px;
  max-width: 170px;
}
.ai-actions {
  display: flex;
  gap: 4px;
}
.mini-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  background: #27272a;
  color: #e4e4e7;
  cursor: pointer;
}
.mini-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid #3f3f46;
  background: #09090b;
  color: #38bdf8;
  cursor: pointer;
}
.chip:hover:not(:disabled) {
  background: #27272a;
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
  gap: 8px;
  padding: 4px;
  background: #09090b;
  border: 1px solid #27272a;
  border-radius: 8px;
}
.chat-msg {
  padding: 8px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.user {
  background: rgba(236, 72, 153, 0.14);
  border: 1px solid rgba(236, 72, 153, 0.3);
}
.chat-msg.assistant {
  background: #18181b;
  border: 1px solid #27272a;
}
.chat-msg.system {
  background: rgba(56, 189, 248, 0.08);
  color: #a1a1aa;
  font-size: 11px;
}
.msg-role {
  font-size: 10px;
  font-weight: 700;
  color: #a1a1aa;
  margin-bottom: 2px;
}
.apply-btn {
  margin-top: 6px;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 0;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}
.live-status {
  font-size: 11px;
  color: #34d399;
  padding: 0 4px;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt-input {
  width: 100%;
  resize: none;
  background: #09090b;
  color: #f4f4f5;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  font-family: inherit;
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
  font-size: 11px;
  color: #71717a;
}
.send-btn {
  font-size: 12px;
  padding: 5px 14px;
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
  opacity: 0.5;
  cursor: default;
}
</style>
