<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, Clock, FilePlus2, FolderOpen, Globe, Minus, Play, Sparkles, X } from 'lucide-vue-next'
import type { RecentProject } from '../shared/project'
import { newStoryDsl, SAMPLE_DSL } from '../shared/templates'
import { useI18n } from '../i18n'

const { locale, toggleLocale, tr } = useI18n()

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
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error
      ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      : String(err)
  } finally {
    busy.value = false
  }
}

function chooseFolder() {
  void perform(async () => {
    folder.value = await api.chooseProjectFolder() ?? folder.value
  })
}

function create() {
  if (!title.value.trim() || !folder.value) return
  void perform(() => api.createProject({
    folder: folder.value,
    title: title.value.trim(),
    content: example.value
      ? SAMPLE_DSL.replace(/^@title [^\n]*/, () => `@title ${title.value.trim()}`)
      : newStoryDsl(title.value),
  }))
}

onMounted(() => perform(async () => {
  recent.value = await api.recentProjects()
}))
</script>

<template>
  <div class="launcher">
    <header class="launcher-bar">
      <div class="brand-group">
        <img class="brand-logo" src="/sirius-logo.png" alt="" width="22" height="22" draggable="false" />
        <span class="brand-name">SiriusStoryMaker</span>
        <span class="beta-badge">beta</span>
      </div>
      <div class="win-controls">
        <button
          class="lang-btn"
          type="button"
          :title="tr('切换为 English', 'Switch to 简体中文')"
          @click="toggleLocale"
        >
          <Globe :size="12" />
          <span>{{ locale === 'en' ? 'EN' : '中文' }}</span>
        </button>
        <button class="win-btn" type="button" :aria-label="tr('最小化', 'Minimize')" :title="tr('最小化', 'Minimize')" @click="api.windowMinimize()">
          <Minus :size="13" />
        </button>
        <button class="win-btn close" type="button" :aria-label="tr('关闭', 'Close')" :title="tr('关闭', 'Close')" @click="api.windowClose()">
          <X :size="13" />
        </button>
      </div>
    </header>

    <div class="launcher-body">
      <aside class="launcher-recent">
        <div class="recent-header">
          <Clock :size="14" class="accent-icon" />
          <span>{{ tr('最近打开', 'Recent Projects') }}</span>
          <span v-if="recent.length" class="recent-count">{{ recent.length }}</span>
        </div>

        <div v-if="!recent.length" class="recent-empty">
          <FolderOpen :size="20" class="empty-ico" />
          <p>{{ tr('还没有最近项目', 'No recent projects') }}</p>
          <small>{{ tr('新建或打开 .sav 项目后会显示在这里', 'Created or opened .sav projects will appear here') }}</small>
        </div>

        <div v-else class="recent-list">
          <div v-for="item in recent" :key="item.filePath" class="launcher-recent-item">
            <button
              class="launcher-recent-open"
              type="button"
              :disabled="busy"
              :title="item.filePath"
              @click="perform(() => api.openProject(item.filePath))"
            >
              <strong>{{ item.title }}</strong>
              <small>{{ item.filePath }}</small>
            </button>
            <button
              class="icon-toggle"
              type="button"
              :aria-label="tr('从最近项目移除', 'Remove from recent')"
              :title="tr('从最近项目移除', 'Remove from recent')"
              :disabled="busy"
              @click="perform(async () => { recent = await api.forgetProject(item.filePath) })"
            >
              <X :size="13" />
            </button>
          </div>
        </div>
      </aside>

      <main class="launcher-start">
        <div class="start-inner">
          <template v-if="!creating">
            <div class="launcher-kicker">
              <Sparkles :size="12" />
              <span>{{ tr('WDS 剧情创作工作台', 'WDS ADV Story Studio') }}</span>
            </div>
            <h1>{{ tr('开始创作', 'Get Started') }}</h1>
            <p class="launcher-sub">
              {{ tr('选择创建新的剧情项目，或打开已有的', 'Create a new story project or open an existing') }}
              <code>.sav</code>
              {{ tr('项目索引继续编辑。', 'project index to continue editing.') }}
            </p>

            <div class="action-stack">
              <button
                class="launcher-action primary-card"
                type="button"
                :disabled="busy"
                @click="creating = true; error = ''"
              >
                <span class="action-icon accent">
                  <FilePlus2 :size="18" />
                </span>
                <span class="action-copy">
                  <strong>{{ tr('创建项目', 'New Project') }}</strong>
                  <small>{{ tr('选择文件夹，创建一个新的剧情项目', 'Choose a folder to create a new story project') }}</small>
                </span>
              </button>

              <button
                class="launcher-action"
                type="button"
                :disabled="busy"
                @click="perform(() => api.openProject())"
              >
                <span class="action-icon">
                  <FolderOpen :size="18" />
                </span>
                <span class="action-copy">
                  <strong>{{ tr('打开项目', 'Open Project') }}</strong>
                  <small>{{ tr('选择已有的 .sav 项目索引', 'Select an existing .sav project index') }}</small>
                </span>
              </button>
              <button class="launcher-action" type="button" :disabled="busy" @click="perform(() => api.openPlayback())">
                <span class="action-icon"><Play :size="18" /></span>
                <span class="action-copy">
                  <strong>{{ tr('播放剧情作品', 'Play Story Package') }}</strong>
                  <small>{{ tr('直接播放导出的 .zip 或 .json', 'Directly play exported .zip packages or .json files') }}</small>
                </span>
              </button>
            </div>
          </template>

          <form v-else class="launcher-form" @submit.prevent="create">
            <button
              class="tb-btn launcher-back"
              type="button"
              :disabled="busy"
              @click="creating = false; error = ''"
            >
              <ArrowLeft :size="13" />
              <span>{{ tr('返回', 'Back') }}</span>
            </button>

            <div class="form-head">
              <h1>{{ tr('创建项目', 'New Project') }}</h1>
              <p class="launcher-sub">
                {{ tr('将在所选目录下生成', 'Creates a') }} <code>.sav</code> {{ tr('索引与独立素材目录。', 'index and dedicated assets directory in the selected folder.') }}
              </p>
            </div>

            <div class="form-field">
              <label for="proj-title">{{ tr('项目名称', 'Project Name') }}</label>
              <input
                id="proj-title"
                v-model="title"
                required
                maxlength="100"
                :placeholder="tr('例如：星辰舞台的排练日', 'e.g. Rehearsal on the Star Stage')"
              />
            </div>

            <div class="form-field">
              <label for="proj-folder">{{ tr('项目文件夹', 'Project Folder') }}</label>
              <div class="launcher-folder">
                <input
                  id="proj-folder"
                  :value="folder"
                  readonly
                  :placeholder="tr('请选择存放项目的文件夹', 'Select a folder for the project')"
                  :aria-label="tr('项目文件夹', 'Project Folder')"
                />
                <button class="tb-btn" type="button" :disabled="busy" @click="chooseFolder">
                  <FolderOpen :size="13" />
                  <span>{{ tr('浏览…', 'Browse…') }}</span>
                </button>
              </div>
            </div>

            <label class="launcher-check">
              <input v-model="example" type="checkbox" />
              <span>{{ tr('使用示例剧本起步（包含角色、背景与分支示范）', 'Start with sample script (characters, backgrounds & branching)') }}</span>
            </label>

            <div class="form-actions">
              <button
                class="tb-btn primary launcher-create"
                type="submit"
                :disabled="busy || !folder || !title.trim()"
              >
                <FilePlus2 :size="13" />
                <span>{{ tr('创建并打开', 'Create & Open') }}</span>
              </button>
            </div>
          </form>

          <div v-if="error" role="alert" class="launcher-error">{{ error }}</div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.launcher {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #09090b;
  color: #f4f4f5;
  overflow: hidden;
  user-select: none;
}

/* Matches App.vue .top-bar */
.launcher-bar {
  height: 40px;
  padding: 0 8px 0 14px;
  background: #121215;
  border-bottom: 1px solid #232329;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  -webkit-app-region: drag;
}
.brand-group {
  display: flex;
  align-items: center;
  gap: 7px;
}
.brand-logo {
  display: block;
  border-radius: 5px;
  flex-shrink: 0;
}
.brand-name {
  font-size: 13px;
  font-weight: 700;
  color: #fafafa;
}
.beta-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(236, 72, 153, 0.16);
  border: 1px solid rgba(236, 72, 153, 0.35);
  color: #f472b6;
}
.win-controls {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 2px;
}
.lang-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  margin-right: 4px;
  border-radius: 5px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #d4d4d8;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}
.lang-btn:hover {
  background: #26262f;
  color: #ffffff;
}
.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.win-btn:hover {
  background: #272731;
  color: #f4f4f5;
}
.win-btn.close:hover {
  background: #dc2626;
  color: #ffffff;
}

/* Split Body */
.launcher-body {
  display: grid;
  grid-template-columns: minmax(250px, 0.85fr) minmax(360px, 1.15fr);
  flex: 1;
  min-height: 0;
}

/* Left Recent Pane */
.launcher-recent {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 20px 16px;
  background: #101014;
  border-right: 1px solid #232329;
  overflow: hidden;
}
.recent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
  flex-shrink: 0;
}
.accent-icon {
  color: #f472b6;
}
.recent-count {
  margin-left: auto;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #1e1e26;
  color: #a1a1aa;
}
.recent-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px 16px;
  border-radius: 10px;
  border: 1px dashed #26262e;
  background: #141418;
  text-align: center;
}
.empty-ico {
  color: #52525b;
  margin-bottom: 2px;
}
.recent-empty p {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #a1a1aa;
}
.recent-empty small {
  font-size: 11px;
  color: #71717a;
  line-height: 1.4;
}
.recent-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.launcher-recent-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 3px;
  border-radius: 8px;
  background: #141419;
  border: 1px solid #22222a;
  transition: border-color 0.12s, background 0.12s;
}
.launcher-recent-item:hover {
  border-color: rgba(236, 72, 153, 0.45);
  background: #1a1a22;
}
.launcher-recent-open {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  padding: 7px 8px;
  cursor: pointer;
}
.launcher-recent-open strong {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.launcher-recent-open small {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  flex-shrink: 0;
}
.icon-toggle:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.35);
  color: #fca5a5;
}

/* Right Action / Form Pane */
.launcher-start {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 32px;
  overflow-y: auto;
  background: radial-gradient(circle at 80% 15%, rgba(236, 72, 153, 0.08), transparent 48%), #09090b;
}
.start-inner {
  width: 100%;
  max-width: 400px;
}
.launcher-kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #f472b6;
  margin-bottom: 8px;
}
.launcher-start h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fafafa;
}
.launcher-sub {
  margin: 0 0 20px;
  font-size: 12px;
  color: #a1a1aa;
  line-height: 1.5;
}
.launcher-sub code {
  color: #38bdf8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.action-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.launcher-action {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  padding: 13px 14px;
  border-radius: 10px;
  background: #141418;
  color: inherit;
  border: 1px solid #26262e;
  transition: border-color 0.14s, background 0.14s, transform 0.12s;
}
.launcher-action:hover:not(:disabled) {
  border-color: #ec4899;
  background: #1b1921;
}
.launcher-action.primary-card {
  border-color: rgba(236, 72, 153, 0.35);
  background: linear-gradient(135deg, rgba(219, 39, 119, 0.12), #141418 70%);
}
.launcher-action.primary-card:hover:not(:disabled) {
  border-color: #f472b6;
  background: linear-gradient(135deg, rgba(219, 39, 119, 0.2), #1b1822 70%);
}
.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: #1d1d24;
  border: 1px solid #2e2e38;
  color: #a1a1aa;
  flex-shrink: 0;
}
.action-icon.accent {
  background: rgba(219, 39, 119, 0.16);
  border-color: rgba(244, 114, 182, 0.35);
  color: #f472b6;
}
.action-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.action-copy strong {
  font-size: 13px;
  font-weight: 600;
  color: #fafafa;
}
.action-copy small {
  font-size: 11px;
  color: #a1a1aa;
}

/* Form View */
.launcher-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-head h1 {
  margin-bottom: 4px;
}
.form-head .launcher-sub {
  margin-bottom: 0;
}
.launcher-back {
  align-self: flex-start;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-field label {
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
}
.form-field input {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  font-family: inherit;
  background: #121216;
  color: #f4f4f5;
  border: 1px solid #2c2c34;
  border-radius: 6px;
  outline: none;
  transition: border-color 0.12s;
}
.form-field input:focus {
  border-color: #ec4899;
}
.form-field input::placeholder {
  color: #52525b;
}
.launcher-folder {
  display: flex;
  gap: 6px;
}
.launcher-folder .tb-btn {
  height: 32px;
  flex-shrink: 0;
}
.launcher-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #d4d4d8;
  cursor: pointer;
}
.launcher-check input[type='checkbox'] {
  accent-color: #db2777;
  width: 14px;
  height: 14px;
  cursor: pointer;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.launcher-create {
  height: 32px;
  padding: 0 16px;
}

/* Matches App.vue .tb-btn */
.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 6px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #e4e4e7;
  cursor: pointer;
  white-space: nowrap;
}
.tb-btn:hover:not(:disabled) {
  background: #26262f;
}
.tb-btn.primary {
  background: #db2777;
  border-color: #db2777;
  color: #ffffff;
  font-weight: 500;
}
.tb-btn.primary:hover:not(:disabled) {
  background: #be185d;
}
.tb-btn:disabled,
.launcher-action:disabled,
.launcher-recent-open:disabled,
.icon-toggle:disabled {
  opacity: 0.45;
  cursor: default;
}

.launcher-error {
  margin-top: 14px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid #991b1b;
  color: #fecaca;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
</style>
