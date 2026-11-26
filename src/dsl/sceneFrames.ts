import type { IEpisodeDetail } from '../../player/src/types/Episode'
import { compileDsl, DIR_MAP, HEAD_MAP, LIP_MAP } from './compiler'
import { serializeDialogue } from './dialogue'
import { parseStoryGraph, type StoryGraphDoc } from './graph'

export const BUILTIN_CAST: Record<number, string> = {
  10101: '心菜',
  10103: '心菜(制服)',
  10201: '静香',
  10203: '静香(制服)',
  10301: '卡特莉娜',
  10303: '卡特莉娜(制服)',
  10401: '八惠',
  10403: '八惠(制服)',
  10501: '潘达',
  10503: '潘达(制服)',
  10601: '知沙',
}

export const POS_LABELS: Record<number, string> = {
  1: '极左',
  2: '左',
  3: '中',
  4: '右',
  5: '极右',
}
export const POS_KEYS: Record<number, string> = {
  1: 'outer_left',
  2: 'left',
  3: 'center',
  4: 'right',
  5: 'outer_right',
}

export const EXPR_LABELS: Record<number, string> = {
  1: '普通',
  2: '开心',
  3: '微笑',
  4: '难过',
  5: '生气',
  6: '惊讶',
  7: '害羞',
  70: '闭眼',
  71: '闭眼笑',
}
export const EXPR_KEYS: Record<number, string> = {
  1: 'normal',
  2: 'happy',
  3: 'smile',
  4: 'sad',
  5: 'angry',
  6: 'surprise',
  7: 'shy',
  70: 'close',
  71: 'close_happy',
}

export const BODY_LABELS: Record<number, string> = {
  1: '普通',
  2: '开心',
  3: '生气',
  4: '难过',
  5: '惊讶',
  6: '害羞',
  7: '思考',
}
export const BODY_KEYS: Record<number, string> = {
  1: 'normal',
  2: 'happy',
  3: 'angry',
  4: 'sad',
  5: 'amazement',
  6: 'shy',
  7: 'think',
}

export const FADE_LABELS: Record<number, string> = {
  1: '黑场',
  2: '白场',
  3: '时间流逝',
  4: '交叉淡入',
}
export const FADE_KEYS: Record<number, string> = {
  1: 'black',
  2: 'white',
  3: 'time',
  4: 'cross',
}

export interface VisualFrameItem {
  localIdx: number
  globalIdx: number | null
  frame: IEpisodeDetail
}

export interface AssetDragPayload {
  kind: 'background' | 'spine' | 'still' | 'bgm' | 'se'
  id: string
}

export const ASSET_DRAG_MIME = 'application/x-sirius-asset'

export function parseAliasMap(preamble: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of preamble.split(/\r?\n/)) {
    const m = line.trim().match(/^@alias\s+([^\s]+)\s+(\d+)/i)
    if (m) map.set(Number(m[2]), m[1])
  }
  return map
}

type SceneFrameCacheEntry = {
  body: string
  start: number | undefined
  items: VisualFrameItem[]
}

/** Keep only the last document's compiled scene frames. Layout, BGM and route indexes
 * do not affect the local frame contents. Callers clone frames before editing them. */
export function createSceneFrameResolver() {
  let previousPreamble: string | undefined
  let previous = new Map<string, SceneFrameCacheEntry>()
  return (doc: StoryGraphDoc, sceneStartFrames: Map<string, number>) => {
    const result = new Map<string, VisualFrameItem[]>()
    const next = new Map<string, SceneFrameCacheEntry>()
    for (const node of doc.nodes) {
      const start = sceneStartFrames.get(node.id)
      const cached = previousPreamble === doc.preamble ? previous.get(node.id) : undefined
      let items: VisualFrameItem[]
      if (cached?.body === node.body) {
        items = cached.start === start ? cached.items : cached.items.map(item => ({
          ...item,
          globalIdx: start === undefined ? null : start + item.localIdx,
        }))
      } else {
        const frames = compileDsl(`${doc.preamble}\n${node.body}`).episode.EpisodeDetail
        items = frames.map((frame, localIdx) => ({
          localIdx,
          globalIdx: start === undefined ? null : start + localIdx,
          frame,
        }))
      }
      next.set(node.id, { body: node.body, start, items })
      result.set(node.id, items)
    }
    previous = next
    previousPreamble = doc.preamble
    return result
  }
}

export function getSceneVisualFrames(doc: StoryGraphDoc, sceneStartFrames: Map<string, number>) {
  return createSceneFrameResolver()(doc, sceneStartFrames)
}

// Replacing a dialogue source line preserves all other scene text, including comments and
// directives not editable in the visual inspector. Structural frame edits use the serializer.
export function replaceSceneDialogue(
  preamble: string,
  body: string,
  frameIndex: number,
  update: (frame: IEpisodeDetail) => void,
): string | undefined {
  const prefix = preamble ? preamble + '\n' : ''
  const compiled = compileDsl(prefix + body)
  const frame = compiled.episode.EpisodeDetail[frameIndex]
  if (!frame) return
  const start = prefix ? prefix.split('\n').length - 1 : 0
  const sourceLine = [...compiled.lineToFrame].find(([line, index]) => index === frameIndex && line > start)?.[0]
  if (sourceLine === undefined) return
  const lines = body.split('\n')
  update(frame)
  lines[sourceLine - start - 1] = serializeDialogue(frame)
  return lines.join('\n')
}

function namedValue(map: Record<string, number>, value: number) {
  return Object.keys(map).find((key) => map[key] === value) ?? value
}

export function framesToSceneDsl(frames: IEpisodeDetail[], aliasMap: Map<number, string>): string {
  const lines: string[] = []
  let prevEffect: number | undefined
  let prevChars = new Map<number, IEpisodeDetail['CharacterMotions'][number]>()
  const appears = ['fade', 'right', 'left', 'bottom']
  const sizes = ['', 's', 'm', 'l']

  for (const f of frames) {
    if (f.WindowEffect !== prevEffect) {
      if (f.WindowEffect === 1) lines.push('@effect sepia')
      else if (f.WindowEffect === 2) lines.push('@effect blur')
      else lines.push('@effect none')
      prevEffect = f.WindowEffect
    }
    if (f.Effect) lines.push(`@effect ${f.Effect}`)

    const fade = f.BackgroundImageFileFadeType && FADE_KEYS[f.BackgroundImageFileFadeType]
    const durations = [f.FadeValue1, f.FadeValue2, f.FadeValue3]
    while (durations.length && durations[durations.length - 1] == null) durations.pop()
    if (f.BackgroundImageFileName) {
      let cmd = `@bg ${f.BackgroundImageFileName}`
      if (fade && !durations.length) cmd += ` fade=${fade}`
      if (f.SceneCameraMasterId) cmd += ` camera=${f.SceneCameraMasterId}`
      lines.push(cmd)
    }
    if (fade && (!f.BackgroundImageFileName || durations.length)) {
      lines.push([`@fade ${fade}`, ...durations.map((n) => n ?? '-')].join(' '))
    }

    if (f.StillPhotoFileName) lines.push(`@still ${f.StillPhotoFileName}`)
    if (f.BackgroundCharacterImageFileName) lines.push(`@card ${f.BackgroundCharacterImageFileName}`)
    if (f.BgmFileName) lines.push(`@bgm ${f.BgmFileName === '999' ? 'stop' : f.BgmFileName}`)
    if (f.SeFileName) lines.push(`@se ${f.SeFileName}`)
    if (f.VoiceFileName) lines.push(`@voice ${f.VoiceFileName}`)
    if (f.MovieFileName) lines.push(`@movie ${f.MovieFileName}`)

    const chars = f.CharacterMotions ?? []
    const nextChars = new Map(chars.map(({ ReplayMotion: _, ...pose }) => [pose.slotNumber, pose]))
    const reset = [...prevChars].some(([slot, prior]) => {
      const next = nextChars.get(slot)
      return !next || (['HeadMotionMasterId', 'HeadDirectionMasterId', 'LipSyncMasterId'] as const)
        .some((key) => prior[key] !== undefined && next[key] === undefined)
    })
    if (reset) {
      lines.push('@clear_chars')
      prevChars = new Map()
    }
    for (const c of chars) {
      if (!c.ReplayMotion && JSON.stringify(prevChars.get(c.slotNumber)) === JSON.stringify(nextChars.get(c.slotNumber))) continue
      const who = aliasMap.get(c.SpineId) ?? String(c.SpineId)
      const pos = POS_KEYS[c.CharacterPosition] || 'center'
      const parts = [
        `@char ${c.slotNumber} ${who}`,
        `pos=${pos}`,
        `expr=${EXPR_KEYS[c.FacialExpressionMasterId ?? 1] ?? c.FacialExpressionMasterId}`,
        `body=${BODY_KEYS[c.BodyMotionMasterId ?? 1] ?? c.BodyMotionMasterId}`,
        `size=${sizes[c.SpineSize] || 's'}`,
        `appear=${appears[c.CharacterAppearanceType] || 'fade'}`,
        `layer=${c.CharacterLayerType ?? 0}`,
      ]
      if (c.HeadMotionMasterId !== undefined) parts.push(`head=${namedValue(HEAD_MAP, c.HeadMotionMasterId)}`)
      if (c.HeadDirectionMasterId !== undefined) parts.push(`dir=${namedValue(DIR_MAP, c.HeadDirectionMasterId)}`)
      if (c.LipSyncMasterId !== undefined) parts.push(`lip=${namedValue(LIP_MAP, c.LipSyncMasterId)}`)
      if (c.ReplayMotion) parts.push('replay=true')
      lines.push(parts.join(' '))
    }
    prevChars = nextChars

    // An explicit empty dialogue line still marks an ADV frame.
    lines.push(serializeDialogue(f))
  }

  return lines.join('\n')
}

/**
 * Diffs two DSL scripts at the scene-node level to produce MoeSekai-style
 * `added` / `modified` badges for AI edits on the StoryGraph canvas.
 */
export function computeSceneChanges(
  prevScript: string,
  nextScript: string,
): Map<string, 'added' | 'modified'> {
  const prevDoc = parseStoryGraph(prevScript)
  const nextDoc = parseStoryGraph(nextScript)
  const prevById = new Map(prevDoc.nodes.map((n) => [n.id, n]))
  const changes = new Map<string, 'added' | 'modified'>()

  for (const node of nextDoc.nodes) {
    const old = prevById.get(node.id)
    if (!old) {
      changes.set(node.id, 'added')
    } else if (
      old.title !== node.title ||
      old.bgm !== node.bgm ||
      old.body !== node.body ||
      old.next !== node.next ||
      JSON.stringify(old.choices) !== JSON.stringify(node.choices)
    ) {
      changes.set(node.id, 'modified')
    }
  }
  return changes
}
