import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { BODY_MAP, DIR_MAP, EXPR_MAP, HEAD_MAP, LIP_MAP } from './compiler'
import type { ResourceCatalog } from '../services/resourceCatalog'

const DIRECTIVES: Completion[] = [
  { label: '@scene', type: 'keyword', detail: '场景节点 <id> title="..."', apply: '@scene ' },
  { label: '@choice', type: 'keyword', detail: '分支选项 "文案" -> <id>', apply: '@choice ' },
  { label: '@title', type: 'keyword', detail: '剧集标题', apply: '@title ' },
  { label: '@chapter', type: 'keyword', detail: '章节名称', apply: '@chapter ' },
  { label: '@episode', type: 'keyword', detail: '剧集 ID', apply: '@episode ' },
  { label: '@alias', type: 'keyword', detail: '角色别名 <名> <spine_id>', apply: '@alias ' },
  { label: '@bg', type: 'keyword', detail: '切换背景', apply: '@bg ' },
  { label: '@char', type: 'keyword', detail: '角色登场/动作', apply: '@char ' },
  { label: '@clear_chars', type: 'keyword', detail: '清空场上角色' },
  { label: '@effect', type: 'keyword', detail: '画面滤镜 sepia|blur|none', apply: '@effect ' },
  { label: '@fade', type: 'keyword', detail: '转场黑/白/时间', apply: '@fade ' },
  { label: '@bgm', type: 'keyword', detail: '背景音乐 (stop 停止)', apply: '@bgm ' },
  { label: '@se', type: 'keyword', detail: '音效', apply: '@se ' },
  { label: '@voice', type: 'keyword', detail: '语音', apply: '@voice ' },
  { label: '@still', type: 'keyword', detail: 'CG 插画', apply: '@still ' },
  { label: '@card', type: 'keyword', detail: '卡面背景', apply: '@card ' },
]

const KV_VALUES: Record<string, string[]> = {
  expr: Object.keys(EXPR_MAP),
  body: Object.keys(BODY_MAP),
  head: Object.keys(HEAD_MAP),
  dir: Object.keys(DIR_MAP),
  lip: Object.keys(LIP_MAP),
  pos: ['center', 'left', 'right', 'outer_left', 'outer_right'],
  size: ['s', 'm', 'l'],
  appear: ['fade', 'left', 'right', 'bottom'],
  fade: ['cross', 'black', 'white', 'time'],
}

export function createDslCompletionSource(getCatalog: () => ResourceCatalog) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const before = line.text.slice(0, context.pos - line.from)

    // 1. `@directive` at start of line
    const dirMatch = before.match(/^\s*(@[a-z_]*)$/i)
    if (dirMatch) {
      return {
        from: context.pos - dirMatch[1].length,
        options: DIRECTIVES,
      }
    }

    // 1b. `-> <scene_id>` or `@choice "..." -> <scene_id>`
    const jumpMatch = before.match(/->\s*([^\s]*)$/)
    if (jumpMatch) {
      const sceneOpts: Completion[] = []
      for (const l of context.state.doc.toString().split(/\r?\n/)) {
        const m = l.trim().match(/^@scene\s+([^\s]+)(?:\s+title="([^"]*)")?/i)
        if (m) {
          sceneOpts.push({
            label: m[1],
            type: 'variable',
            detail: m[2] ? `场景: ${m[2]}` : '场景',
          })
        }
      }
      if (sceneOpts.length > 0) {
        return {
          from: context.pos - jumpMatch[1].length,
          options: sceneOpts,
        }
      }
    }

    // 2. `key=value` completion (expr=, body=, pos=, fade=, etc.)
    const kvMatch = before.match(/\b([a-z_]+)=([a-z0-9_]*)$/i)
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase()
      const choices = KV_VALUES[key]
      if (choices) {
        return {
          from: context.pos - kvMatch[2].length,
          options: choices.map((v) => ({ label: v, type: 'enum' })),
        }
      }
    }

    const catalog = getCatalog()

    // 3. `@bg <id>`
    const bgMatch = before.match(/^\s*@bg\s+([^\s]*)$/i)
    if (bgMatch) {
      return {
        from: context.pos - bgMatch[1].length,
        options: catalog.backgrounds.slice(0, 80).map((id) => ({
          label: id,
          type: 'constant',
          detail: '背景',
        })),
      }
    }

    // 4. `@bgm <id>`
    const bgmMatch = before.match(/^\s*@bgm\s+([^\s]*)$/i)
    if (bgmMatch) {
      const opts: Completion[] = [
        { label: 'stop', type: 'keyword', detail: '停止 BGM' },
        ...catalog.bgms.slice(0, 80).map((id) => ({ label: id, type: 'constant', detail: 'BGM' })),
      ]
      return {
        from: context.pos - bgmMatch[1].length,
        options: opts,
      }
    }

    // 5. `@se <id>`
    const seMatch = before.match(/^\s*@se\s+([^\s]*)$/i)
    if (seMatch) {
      return {
        from: context.pos - seMatch[1].length,
        options: catalog.ses.slice(0, 80).map((id) => ({
          label: id,
          type: 'constant',
          detail: '音效',
        })),
      }
    }

    // 6. `@char <slot> <spine_id|alias>`
    const charMatch = before.match(/^\s*@char\s+\d+\s+([^\s]*)$/i)
    if (charMatch) {
      const aliasOpts: Completion[] = []
      const docLines = context.state.doc.toString().split(/\r?\n/)
      for (const l of docLines) {
        const m = l.trim().match(/^@alias\s+(\S+)\s+(\d+)/)
        if (m) aliasOpts.push({ label: m[1], type: 'variable', detail: `Spine ${m[2]}` })
      }
      const spineOpts = catalog.spines.slice(0, 80).map((id) => ({
        label: id,
        type: 'constant',
        detail: 'Spine',
      }))
      return {
        from: context.pos - charMatch[1].length,
        options: [...aliasOpts, ...spineOpts],
      }
    }

    // 7. `@effect <sepia|blur|none>`
    const effMatch = before.match(/^\s*@effect\s+([a-z]*)$/i)
    if (effMatch) {
      return {
        from: context.pos - effMatch[1].length,
        options: [
          { label: 'sepia', type: 'enum', detail: '怀旧滤镜' },
          { label: 'blur', type: 'enum', detail: '柔白光晕' },
          { label: 'none', type: 'enum', detail: '清除滤镜' },
        ],
      }
    }

    return null
  }
}
