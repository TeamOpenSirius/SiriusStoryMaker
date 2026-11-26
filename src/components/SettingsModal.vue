<script setup lang="ts">
import { ref } from 'vue'
import {
  Bot,
  BookMarked,
  FolderOpen,
  Keyboard,
  LayoutPanelLeft,
  Plug,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-vue-next'
import type { AudioMix } from '../../player/src/types/AudioMix'
import AudioMixControls from './AudioMixControls.vue'
import { ADV_RESOURCE_CDN } from '../services/resourceCatalog'
import { useI18n } from '../i18n'

const { locale, setLocale, tr } = useI18n()

const props = defineProps<{
  open: boolean
  workspaceMode: 'visual' | 'code'
  showLeftPane: boolean
  showInspector: boolean
  showAiPanel: boolean
  topSplitPct: number
  confirmBeforeExit: boolean
  projectPath?: string
  assetCount: number
  audioMix: AudioMix
  previewMuted: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'openFfmpeg'): void
  (e: 'update:audioMix', mix: AudioMix): void
  (e: 'update:previewMuted', muted: boolean): void
  (e: 'update:workspaceMode', v: 'visual' | 'code'): void
  (e: 'update:showLeftPane', v: boolean): void
  (e: 'update:showInspector', v: boolean): void
  (e: 'update:showAiPanel', v: boolean): void
  (e: 'update:topSplitPct', v: number): void
  (e: 'update:confirmBeforeExit', v: boolean): void
  (e: 'resetLayout'): void
  (e: 'rebuildThumbCache', full: boolean): void
  (e: 'openAiConfig', tab: 'connection' | 'skills' | 'mcp'): void
}>()

type SettingsTab = 'workspace' | 'project' | 'audio' | 'ai' | 'shortcuts'
const activeTab = ref<SettingsTab>('workspace')

const SHORTCUTS = [
  { keys: 'Ctrl + S', zh: '保存当前项目', en: 'Save current project' },
  { keys: 'Ctrl + Z', zh: '撤销上一步编辑', en: 'Undo last edit' },
  { keys: 'Ctrl + Y / Ctrl + Shift + Z', zh: '重做编辑', en: 'Redo edit' },
  { keys: 'Ctrl + O', zh: '返回项目向导 / 打开最近项目', en: 'Open Project Launcher / Recent projects' },
  { keys: 'Ctrl + ,', zh: '打开设置窗口', en: 'Open Settings' },
  { keys: 'Esc', zh: '关闭当前弹窗或菜单', en: 'Close active modal or menu' },
]
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="settings-backdrop" @click.self="emit('close')">
      <section class="settings-dialog" role="dialog" aria-modal="true" :aria-label="tr('设置', 'Settings')">
        <header class="settings-header">
          <div class="settings-title">
            <SlidersHorizontal :size="14" class="title-ico" />
            <span>{{ tr('设置', 'Settings') }}</span>
          </div>
          <button class="close-btn" type="button" :title="tr('关闭', 'Close')" @click="emit('close')">
            <X :size="14" />
          </button>
        </header>

        <div class="settings-body">
          <nav class="settings-nav">
            <button
              type="button"
              class="nav-item"
              :class="{ active: activeTab === 'workspace' }"
              @click="activeTab = 'workspace'"
            >
              <LayoutPanelLeft :size="14" />
              <span>{{ tr('工作区与界面', 'Workspace & UI') }}</span>
            </button>
            <button
              type="button"
              class="nav-item"
              :class="{ active: activeTab === 'project' }"
              @click="activeTab = 'project'"
            >
              <FolderOpen :size="14" />
              <span>{{ tr('项目与资源', 'Project & Assets') }}</span>
            </button>
            <button type="button" class="nav-item" :class="{ active: activeTab === 'audio' }" @click="activeTab = 'audio'">
              <Volume2 :size="14" />
              <span>{{ tr('音频', 'Audio') }}</span>
            </button>
            <button
              type="button"
              class="nav-item"
              :class="{ active: activeTab === 'ai' }"
              @click="activeTab = 'ai'"
            >
              <Bot :size="14" />
              <span>{{ tr('AI 与模型', 'AI & Models') }}</span>
            </button>
            <button
              type="button"
              class="nav-item"
              :class="{ active: activeTab === 'shortcuts' }"
              @click="activeTab = 'shortcuts'"
            >
              <Keyboard :size="14" />
              <span>{{ tr('快捷键', 'Shortcuts') }}</span>
            </button>
          </nav>

          <div class="settings-content">
            <!-- Tab 1: Workspace -->
            <div v-if="activeTab === 'workspace'" class="tab-panel">
              <h3>{{ tr('工作区与界面', 'Workspace & UI') }}</h3>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('界面语言', 'Language') }}</strong>
                  <small>{{ tr('切换应用显示语言（立即生效）', 'Switch interface display language immediately') }}</small>
                </div>
                <div class="seg-group">
                  <button
                    type="button"
                    :class="{ active: locale === 'zh-CN' }"
                    @click="setLocale('zh-CN')"
                  >
                    简体中文
                  </button>
                  <button
                    type="button"
                    :class="{ active: locale === 'en' }"
                    @click="setLocale('en')"
                  >
                    English
                  </button>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('编辑模式', 'Editor Mode') }}</strong>
                  <small>{{ tr('在图形分镜流与 DSL 源码之间切换', 'Switch between visual storyboard graph and DSL source') }}</small>
                </div>
                <div class="seg-group">
                  <button
                    type="button"
                    :class="{ active: props.workspaceMode === 'visual' }"
                    @click="emit('update:workspaceMode', 'visual')"
                  >
                    {{ tr('可视化', 'Visual') }}
                  </button>
                  <button
                    type="button"
                    :class="{ active: props.workspaceMode === 'code' }"
                    @click="emit('update:workspaceMode', 'code')"
                  >
                    {{ tr('源码', 'Source') }}
                  </button>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('左侧素材箱', 'Asset Bin') }}</strong>
                  <small>{{ tr('显示背景、角色、音频素材与大纲侧栏', 'Show backgrounds, characters, audio & outline sidebar') }}</small>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    :checked="props.showLeftPane"
                    @change="emit('update:showLeftPane', ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider" />
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('右侧属性栏', 'Inspector Panel') }}</strong>
                  <small>{{ tr('可视化模式下显示帧与场景属性检查器', 'Show frame and scene inspector in visual mode') }}</small>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    :checked="props.showInspector"
                    @change="emit('update:showInspector', ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider" />
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('AI 导演侧栏', 'AI Director Dock') }}</strong>
                  <small>{{ tr('在右侧停靠 AI 对话与创作助手', 'Dock AI chat and story assistant on the right') }}</small>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    :checked="props.showAiPanel"
                    @change="emit('update:showAiPanel', ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider" />
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('退出前未保存确认', 'Confirm Before Exit') }}</strong>
                  <small>{{ tr('存在未保存修改时关闭窗口前弹窗提示', 'Prompt before closing when there are unsaved changes') }}</small>
                </div>
                <label class="switch">
                  <input
                    type="checkbox"
                    :checked="props.confirmBeforeExit"
                    @change="emit('update:confirmBeforeExit', ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider" />
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr(`舞台高度占比 (${Math.round(props.topSplitPct)}%)`, `Stage Height Split (${Math.round(props.topSplitPct)}%)`) }}</strong>
                  <small>{{ tr('调整上方预览区与下方分镜画布的比例', 'Adjust ratio between top preview deck and bottom graph') }}</small>
                </div>
                <input
                  class="range-input"
                  type="range"
                  min="28"
                  max="72"
                  step="1"
                  :value="props.topSplitPct"
                  @input="emit('update:topSplitPct', Number(($event.target as HTMLInputElement).value))"
                />
              </div>

              <div class="setting-footer-action">
                <button class="s-btn" type="button" @click="emit('resetLayout')">
                  <RotateCcw :size="12" />
                  <span>{{ tr('重置默认布局', 'Reset Default Layout') }}</span>
                </button>
              </div>
            </div>

            <!-- Tab 2: Project & Resources -->
            <div v-else-if="activeTab === 'project'" class="tab-panel">
              <h3>{{ tr('项目与资源', 'Project & Assets') }}</h3>
              <div class="info-card">
                <div class="info-row">
                  <span>{{ tr('当前项目路径', 'Project Path') }}</span>
                  <code class="path-val" :title="props.projectPath || tr('未绑定本地项目', 'No local project')">
                    {{ props.projectPath || tr('未绑定本地项目（草稿模式）', 'No local project (Draft mode)') }}
                  </code>
                </div>
                <div class="info-row">
                  <span>{{ tr('本地扩展素材', 'Local Assets') }}</span>
                  <strong>{{ tr(`${props.assetCount} 个文件`, `${props.assetCount} file(s)`) }}</strong>
                </div>
                <div class="info-row">
                  <span>{{ tr('官方资源 CDN', 'Official Asset CDN') }}</span>
                  <code>{{ ADV_RESOURCE_CDN }}</code>
                </div>
              </div>
              <p class="panel-note">
                {{ tr('本地导入的背景、BGM、SE 与语音会自动复制到当前项目目录下，导出', 'Imported backgrounds, BGM, SE, and voices are copied into the project folder and bundled when exporting') }}
                <code>.zip</code>
                {{ tr('作品包时将自动打包随行。', 'packages.') }}
              </p>
              <div v-if="props.projectPath" class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('FFmpeg 视频编码器', 'FFmpeg Video Encoder') }}</strong>
                  <small>{{ tr('检测系统中的 FFmpeg，或手动选择可执行文件', 'Detect system FFmpeg or choose executable manually') }}</small>
                </div>
                <button class="s-btn" type="button" @click="emit('openFfmpeg')">{{ tr('打开配置向导', 'Open Setup Wizard') }}</button>
              </div>
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('素材缩略图缓存', 'Asset Thumbnail Cache') }}</strong>
                  <small>{{ tr('增量补全缺失的新资源缩略图，或清空磁盘缓存全量重建', 'Incrementally render missing thumbnails or rebuild all from scratch') }}</small>
                </div>
                <div style="display: flex; gap: 6px; flex-shrink: 0">
                  <button class="s-btn" type="button" @click="emit('close'); emit('rebuildThumbCache', false)">
                    <RotateCcw :size="12" />
                    <span>{{ tr('增量更新', 'Incremental') }}</span>
                  </button>
                  <button class="s-btn" type="button" @click="emit('close'); emit('rebuildThumbCache', true)">
                    <span>{{ tr('全量重建', 'Rebuild All') }}</span>
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="activeTab === 'audio'" class="tab-panel">
              <h3>{{ tr('音频', 'Audio') }}</h3>
              <p class="panel-note">{{ tr('各路音量同时用于预览和视频导出。预览静音不影响导出。', 'Channel volumes apply to both live preview and MP4 export. Preview mute does not affect export.') }}</p>
              <AudioMixControls :model-value="audioMix" @update:model-value="emit('update:audioMix', $event)" />
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{{ tr('预览静音', 'Mute Preview') }}</strong>
                  <small>{{ tr('只关闭编辑器舞台预览的声音', 'Mute editor stage preview audio only') }}</small>
                </div>
                <label class="switch">
                  <input type="checkbox" :aria-label="tr('预览静音', 'Mute Preview')" :checked="previewMuted"
                    @change="emit('update:previewMuted', ($event.target as HTMLInputElement).checked)" />
                  <span class="slider" />
                </label>
              </div>
            </div>

            <!-- Tab 3: AI & Models -->
            <div v-else-if="activeTab === 'ai'" class="tab-panel">
              <h3>{{ tr('AI 与模型', 'AI & Models') }}</h3>
              <p class="panel-note">
                {{ tr('管理本地 Harness CLI（Antigravity / Claude / Codex / DeepSeek）与 API 直连配置、Skills 技能库及 MCP 工具服务。', 'Manage local Harness CLIs (Antigravity / Claude / Codex / DeepSeek), API providers, Skills, and Studio MCP tools.') }}
              </p>
              <div class="ai-entry-list">
                <button
                  type="button"
                  class="ai-entry"
                  @click="emit('close'); emit('openAiConfig', 'connection')"
                >
                  <SlidersHorizontal :size="15" class="entry-ico" />
                  <span>
                    <strong>{{ tr('连接、模型与推理强度', 'Connection, Models & Reasoning') }}</strong>
                    <small>{{ tr('切换本地 CLI 或 OpenAI 兼容 API、选择模型与推理等级', 'Switch local CLI or OpenAI-compatible API, models & reasoning effort') }}</small>
                  </span>
                </button>
                <button
                  type="button"
                  class="ai-entry"
                  @click="emit('close'); emit('openAiConfig', 'skills')"
                >
                  <BookMarked :size="15" class="entry-ico" />
                  <span>
                    <strong>{{ tr('Skills 技能库', 'Skills Library') }}</strong>
                    <small>{{ tr('启用或停用剧情编写、角色卡与原版语料参考技能', 'Enable or disable authoring, cast, and corpus reference skills') }}</small>
                  </span>
                </button>
                <button
                  type="button"
                  class="ai-entry"
                  @click="emit('close'); emit('openAiConfig', 'mcp')"
                >
                  <Plug :size="15" class="entry-ico" />
                  <span>
                    <strong>{{ tr('MCP 工具服务', 'MCP Tool Server') }}</strong>
                    <small>{{ tr('查看可供 Agent 调用的剧本读写与资源查询工具', 'Inspect script read/write and resource search tools exposed to agents') }}</small>
                  </span>
                </button>
              </div>
            </div>

            <!-- Tab 4: Shortcuts -->
            <div v-else class="tab-panel">
              <h3>{{ tr('快捷键一览', 'Keyboard Shortcuts') }}</h3>
              <div class="shortcut-list">
                <div v-for="s in SHORTCUTS" :key="s.keys" class="shortcut-row">
                  <span>{{ tr(s.zh, s.en) }}</span>
                  <kbd>{{ s.keys }}</kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 85;
  background: rgba(0, 0, 0, 0.7);
  display: grid;
  place-items: center;
}
.settings-dialog {
  width: min(680px, 92vw);
  height: min(490px, 84vh);
  background: #18181d;
  border: 1px solid #303038;
  border-radius: 12px;
  box-shadow: 0 22px 64px rgba(0, 0, 0, 0.68);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #f4f4f5;
}
.settings-header {
  height: 42px;
  padding: 0 12px 0 16px;
  background: #141418;
  border-bottom: 1px solid #26262e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.settings-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
}
.title-ico {
  color: #f472b6;
}
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.close-btn:hover {
  background: #272731;
  color: #ffffff;
}

.settings-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.settings-nav {
  width: 168px;
  padding: 10px 8px;
  background: #121216;
  border-right: 1px solid #232329;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-shrink: 0;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #a1a1aa;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.nav-item:hover {
  background: #1d1d24;
  color: #f4f4f5;
}
.nav-item.active {
  background: rgba(236, 72, 153, 0.14);
  color: #f472b6;
  font-weight: 600;
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 20px;
}
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tab-panel h3 {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
  color: #fafafa;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #121216;
  border: 1px solid #24242c;
}
.setting-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.setting-copy strong {
  font-size: 12px;
  font-weight: 600;
  color: #e4e4e7;
}
.setting-copy small {
  font-size: 11px;
  color: #71717a;
}

.seg-group {
  display: inline-flex;
  background: #09090b;
  border: 1px solid #26262e;
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
  flex-shrink: 0;
}
.seg-group button {
  border: 0;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-family: inherit;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
}
.seg-group button.active {
  background: #27272f;
  color: #ffffff;
  font-weight: 600;
}

/* Toggle Switch */
.switch {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 19px;
  flex-shrink: 0;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #2c2c36;
  cursor: pointer;
  transition: background 0.16s;
}
.slider::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: #d4d4d8;
  transition: transform 0.16s, background 0.16s;
}
.switch input:checked + .slider {
  background: #db2777;
}
.switch input:checked + .slider::before {
  transform: translateX(15px);
  background: #ffffff;
}

.range-input {
  width: 130px;
  accent-color: #db2777;
  cursor: pointer;
}
.setting-footer-action {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}
.s-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 6px;
  border: 1px solid #2c2c34;
  background: #1a1a20;
  color: #e4e4e7;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.s-btn:hover {
  background: #26262f;
}

.info-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: #121216;
  border: 1px solid #24242c;
}
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
.info-row span {
  color: #a1a1aa;
  flex-shrink: 0;
}
.info-row code {
  color: #38bdf8;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.path-val {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 290px;
}
.panel-note {
  margin: 0;
  font-size: 12px;
  color: #a1a1aa;
  line-height: 1.55;
}
.panel-note code {
  color: #38bdf8;
}

.ai-entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid #26262e;
  background: #121216;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.ai-entry:hover {
  border-color: #ec4899;
  background: #1b1822;
}
.entry-ico {
  color: #f472b6;
  flex-shrink: 0;
}
.ai-entry span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ai-entry strong {
  font-size: 12px;
  font-weight: 600;
  color: #fafafa;
}
.ai-entry small {
  font-size: 11px;
  color: #a1a1aa;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 7px;
  background: #121216;
  border: 1px solid #24242c;
  font-size: 12px;
  color: #d4d4d8;
}
.shortcut-row kbd {
  padding: 2px 7px;
  border-radius: 5px;
  background: #22222b;
  border: 1px solid #343440;
  color: #f4f4f5;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
