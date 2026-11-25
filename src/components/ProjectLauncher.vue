<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Clock, FilePlus2, FolderOpen, Minus, X } from 'lucide-vue-next'
import type { RecentProject } from '../shared/project'
import { newStoryDsl, SAMPLE_DSL } from '../shared/templates'

const api = window.siriusStudio!
const recent = ref<RecentProject[]>([])
const creating = ref(false)
const busy = ref(false)
const title = ref('')
const folder = ref('')
const example = ref(false)
const error = ref('')

async function perform(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action() } catch (err) {
    error.value = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
  } finally { busy.value = false }
}

function chooseFolder() {
  void perform(async () => { folder.value = await api.chooseProjectFolder() ?? folder.value })
}

function create() {
  if (!title.value.trim() || !folder.value) return
  void perform(() => api.createProject({
    folder: folder.value,
    title: title.value.trim(),
    content: example.value ? SAMPLE_DSL.replace(/^@title [^\n]*/, () => `@title ${title.value.trim()}`) : newStoryDsl(title.value),
  }))
}

onMounted(() => perform(async () => { recent.value = await api.recentProjects() }))
</script>

<template>
  <div class="launcher">
    <header class="launcher-bar">
      <span class="brand-dot" /> <strong>SiriusAdvStudio</strong>
      <div class="launcher-controls">
        <button class="win-btn" aria-label="最小化" @click="api.windowMinimize()"><Minus :size="15" /></button>
        <button class="win-btn close" aria-label="关闭" @click="api.windowClose()"><X :size="15" /></button>
      </div>
    </header>
    <div class="launcher-body">
      <section class="launcher-recent">
        <h2><Clock :size="17" /> 最近打开</h2>
        <p v-if="!recent.length">还没有最近项目。新建或打开项目后会显示在这里。</p>
        <div v-for="item in recent" :key="item.filePath" class="launcher-recent-item">
          <button class="launcher-recent-open" :disabled="busy" :title="item.filePath" @click="perform(() => api.openProject(item.filePath))">
            <strong>{{ item.title }}</strong>
            <small>{{ item.filePath }}</small>
          </button>
          <button class="icon-toggle" aria-label="从最近项目移除" :disabled="busy" @click="perform(async () => { recent = await api.forgetProject(item.filePath) })"><X :size="14" /></button>
        </div>
      </section>
      <section class="launcher-start">
        <template v-if="!creating">
          <p class="launcher-kicker">WDS 剧情创作工作台</p>
          <h1>开始创作</h1>
          <button class="launcher-action" :disabled="busy" @click="creating = true; error = ''"><FilePlus2 :size="22" /><span><strong>创建项目</strong><small>选择文件夹，创建一个新的剧情项目</small></span></button>
          <button class="launcher-action" :disabled="busy" @click="perform(() => api.openProject())"><FolderOpen :size="22" /><span><strong>打开项目</strong><small>选择已有的 .sav 项目索引</small></span></button>
        </template>
        <form v-else class="launcher-form" @submit.prevent="create">
          <button class="tb-btn launcher-back" type="button" :disabled="busy" @click="creating = false; error = ''">← 返回</button>
          <h1>创建项目</h1>
          <label>项目名称<input v-model="title" required maxlength="100" placeholder="我的 WDS 剧情" /></label>
          <label>项目文件夹</label>
          <div class="launcher-folder"><input :value="folder" readonly placeholder="请选择文件夹" aria-label="项目文件夹" /><button class="tb-btn" type="button" :disabled="busy" @click="chooseFolder">浏览…</button></div>
          <label class="launcher-check"><input v-model="example" type="checkbox" />使用示例剧本起步</label>
          <button class="tb-btn primary launcher-create" :disabled="busy || !folder || !title.trim()">创建并打开</button>
        </form>
        <p v-if="error" role="alert" class="launcher-error">{{ error }}</p>
      </section>
    </div>
  </div>
</template>
