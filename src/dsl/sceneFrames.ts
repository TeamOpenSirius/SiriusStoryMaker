import type { IEpisodeDetail } from '../../player/src/types/Episode'
import { compileDsl } from './compiler'
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
  for (const [id, name] of Object.entries(BUILTIN_CAST)) {
    map.set(Number(id), name)
  }
  for (const line of preamble.split(/\r?\n/)) {
    const m = line.trim().match(/^@alias\s+([^\s]+)\s+(\d+)/i)
    if (m) map.set(Number(m[2]), m[1])
  }
  return map
}

export function getSceneVisualFrames(
  doc: StoryGraphDoc,
  sceneStartFrames: Map<string, number>,
): Map<string, VisualFrameItem[]> {
  const result = new Map<string, VisualFrameItem[]>()
  for (const node of doc.nodes) {
    const compiledScene = compileDsl(`${doc.preamble}\n${node.body}`)
    const startGlobal = sceneStartFrames.get(node.id)
    const items: VisualFrameItem[] = compiledScene.episode.EpisodeDetail.map((frame, idx) => ({
      localIdx: idx,
      globalIdx: typeof startGlobal === 'number' ? startGlobal + idx : null,
      frame,
    }))
    result.set(node.id, items)
  }
  return result
}

export function framesToSceneDsl(frames: IEpisodeDetail[], aliasMap: Map<number, string>): string {
  const lines: string[] = []
  let prevEffect: number | undefined = undefined
  let prevCharsSig = ''

  for (const f of frames) {
    if (f.WindowEffect !== prevEffect) {
      if (f.WindowEffect === 1) lines.push('@effect sepia')
      else if (f.WindowEffect === 2) lines.push('@effect blur')
      else if (prevEffect !== undefined) lines.push('@effect none')
      prevEffect = f.WindowEffect
    }

    if (f.BackgroundImageFileName) {
      let cmd = `@bg ${f.BackgroundImageFileName}`
      if (f.BackgroundImageFileFadeType && FADE_KEYS[f.BackgroundImageFileFadeType]) {
        cmd += ` fade=${FADE_KEYS[f.BackgroundImageFileFadeType]}`
      }
      if (f.SceneCameraMasterId) cmd += ` camera=${f.SceneCameraMasterId}`
      lines.push(cmd)
    } else if (f.BackgroundImageFileFadeType && FADE_KEYS[f.BackgroundImageFileFadeType]) {
      const vals = [f.FadeValue1, f.FadeValue2, f.FadeValue3]
        .filter((v): v is number => typeof v === 'number')
        .join(' ')
      lines.push(`@fade ${FADE_KEYS[f.BackgroundImageFileFadeType]}${vals ? ` ${vals}` : ''}`)
    }

    if (f.StillPhotoFileName) lines.push(`@still ${f.StillPhotoFileName}`)
    if (f.BgmFileName) lines.push(`@bgm ${f.BgmFileName === '999' ? 'stop' : f.BgmFileName}`)
    if (f.SeFileName) lines.push(`@se ${f.SeFileName}`)
    if (f.VoiceFileName) lines.push(`@voice ${f.VoiceFileName}`)

    const chars = f.CharacterMotions ?? []
    const sig = JSON.stringify(chars)
    if (sig !== prevCharsSig) {
      if (chars.length === 0 && prevCharsSig) {
        lines.push('@clear_chars')
      } else {
        for (const c of chars) {
          const who = aliasMap.get(c.SpineId) ?? String(c.SpineId)
          const pos = POS_KEYS[c.CharacterPosition] || 'center'
          const expr = c.FacialExpressionMasterId
            ? EXPR_KEYS[c.FacialExpressionMasterId] || String(c.FacialExpressionMasterId)
            : 'normal'
          const body = c.BodyMotionMasterId
            ? BODY_KEYS[c.BodyMotionMasterId] || String(c.BodyMotionMasterId)
            : 'normal'
          lines.push(`@char ${c.slotNumber} ${who} pos=${pos} expr=${expr} body=${body}`)
        }
      }
      prevCharsSig = sig
    }

    if (f.Order === 2 && !f.SpeakerName) {
      lines.push(`+ ${f.Phrase}`)
    } else if (f.Phrase || f.SpeakerName) {
      const sizeSuffix = f.FontSize === 1 ? '(small)' : f.FontSize === 3 ? '(large)' : ''
      lines.push(`${f.SpeakerName || ''}${sizeSuffix}: ${f.Phrase}`)
    }
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
      old.body !== node.body ||
      old.next !== node.next ||
      JSON.stringify(old.choices) !== JSON.stringify(node.choices)
    ) {
      changes.set(node.id, 'modified')
    }
  }
  return changes
}
