<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autocompletion } from '@codemirror/autocomplete'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { DslDiagnostic } from '../dsl/compiler'
import { createDslCompletionSource } from '../dsl/completions'
import type { ResourceCatalog } from '../services/resourceCatalog'

const props = defineProps<{
  modelValue: string
  diagnostics: DslDiagnostic[]
  catalog?: ResourceCatalog
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  cursorLine: [line: number]
}>()

const hostRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let syncingFromProp = false

const directiveMark = Decoration.mark({ class: 'dsl-directive' })
const commentMark = Decoration.mark({ class: 'dsl-comment' })
const contMark = Decoration.mark({ class: 'dsl-cont' })
const jumpMark = Decoration.mark({ class: 'dsl-jump' })
const speakerMark = Decoration.mark({ class: 'dsl-speaker' })

function buildDslDecorations(edView: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of edView.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = edView.state.doc.lineAt(pos)
      const trimmed = line.text.trimStart()
      if (trimmed.startsWith('@')) {
        builder.add(line.from, line.to, directiveMark)
      } else if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
        builder.add(line.from, line.to, commentMark)
      } else if (trimmed.startsWith('+')) {
        builder.add(line.from, line.to, contMark)
      } else if (trimmed.startsWith('->')) {
        builder.add(line.from, line.to, jumpMark)
      } else {
        const ascii = line.text.indexOf(':')
        const full = line.text.indexOf('：')
        const colon = ascii === -1 ? full : full === -1 ? ascii : Math.min(ascii, full)
        if (colon > 0) {
          builder.add(line.from, line.from + colon + 1, speakerMark)
        }
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const dslHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(edView: EditorView) {
      this.decorations = buildDslDecorations(edView)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDslDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

onMounted(() => {
  if (!hostRef.value) return
  const darkTheme = EditorView.theme(
    {
      '&': { color: '#e4e4e7', backgroundColor: '#09090b' },
      '.cm-content': { caretColor: '#ec4899', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      '&.cm-focused .cm-cursor': { borderLeftColor: '#ec4899' },
      '&.cm-focused': { outline: 'none' },
      '.dsl-directive': { color: '#38bdf8' },
      '.dsl-comment': { color: '#71717a', fontStyle: 'italic' },
      '.dsl-cont': { color: '#34d399' },
      '.dsl-jump': { color: '#fcd34d', fontWeight: '600' },
      '.dsl-speaker': { color: '#f472b6', fontWeight: '600' },
      '.cm-tooltip-autocomplete': {
        backgroundColor: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '6px',
      },
    },
    { dark: true },
  )

  const emptyCatalog: ResourceCatalog = {
    backgrounds: [],
    spines: [],
    stills: [],
    cards: [],
    bgms: [],
    ses: [],
  }

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      autocompletion({
        override: [createDslCompletionSource(() => props.catalog ?? emptyCatalog)],
      }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      darkTheme,
      dslHighlightPlugin,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !syncingFromProp) {
          emit('update:modelValue', update.state.doc.toString())
        }
        if (update.selectionSet || update.docChanged) {
          const line = update.state.doc.lineAt(update.state.selection.main.head).number
          emit('cursorLine', line)
        }
      }),
    ],
  })

  view = new EditorView({ state, parent: hostRef.value })
})

watch(
  () => props.modelValue,
  (next) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (next === current) return
    syncingFromProp = true
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next },
    })
    syncingFromProp = false
  },
)

function insertLine(snippet: string) {
  if (!view) return
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const insertText = `\n${snippet}`
  view.dispatch({
    changes: { from: line.to, insert: insertText },
    selection: { anchor: line.to + insertText.length },
  })
  view.focus()
}

function goToLine(lineNumber: number) {
  if (!view) return
  const clamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines))
  const line = view.state.doc.line(clamped)
  view.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  })
  view.focus()
}

defineExpose({ insertLine, goToLine })

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="editor-shell">
    <div ref="hostRef" class="editor-cm" />
    <div v-if="diagnostics.length > 0" class="diag-bar">
      <button
        v-for="(d, idx) in diagnostics.slice(0, 4)"
        :key="idx"
        type="button"
        class="diag-item"
        @click="goToLine(d.line)"
      >
        L{{ d.line }}: {{ d.message }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.editor-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid #27272a;
  border-radius: 8px;
  overflow: hidden;
  background: #09090b;
}
.editor-cm {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.diag-bar {
  border-top: 1px solid #7f1d1d;
  background: rgba(127, 29, 29, 0.35);
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.diag-item {
  font-size: 12px;
  color: #fecaca;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 2px 0;
  cursor: pointer;
}
.diag-item:hover {
  text-decoration: underline;
}
</style>
