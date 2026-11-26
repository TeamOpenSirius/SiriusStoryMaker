import type {
  CharacterAppearanceTypes,
  CharacterLayerTypes,
  CharacterPositions,
  FadeTypes,
  FontSizes,
  IEpisodeDetail,
  IEpisodeDetailCharacterMotion,
  IEpisodeModel,
  NextOrderType,
  SpineSizes,
  StoryTypes,
  WindowEffects,
} from '../../player/src/types/Episode'
import { flattenGraphForCompile } from './graph'

export interface DslDiagnostic {
  line: number
  message: string
}

export interface DslResourceSets {
  backgrounds?: Set<string>
  spines?: Set<string>
  stills?: Set<string>
  bgms?: Set<string>
  ses?: Set<string>
}

export interface DslCompileOutput {
  episode: IEpisodeModel
  lineToFrame: Map<number, number>
  sceneStartFrames: Map<string, number>
  diagnostics: DslDiagnostic[]
}

export const EXPR_MAP: Record<string, number> = {
  normal: 1,
  happy: 2,
  smile: 3,
  sad: 4,
  angry: 5,
  surprise: 6,
  shy: 7,
  close: 70,
  close_happy: 71,
}

export const BODY_MAP: Record<string, number> = {
  normal: 1,
  happy: 2,
  angry: 3,
  sad: 4,
  amazement: 5,
  surprise: 5,
  shy: 6,
  think: 7,
}

export const HEAD_MAP: Record<string, number> = {
  nod: 1,
  shake: 2,
  nod2: 3,
  shake2: 4,
  nod3: 5,
  shake3: 6,
}

export const DIR_MAP: Record<string, number> = {
  normal: 1,
  left: 2,
  leftward: 2,
  right: 3,
  rightward: 3,
  down: 4,
  downward: 4,
  up: 5,
  upward: 5,
  tilt_left: 6,
  tilt_right: 7,
}

export const LIP_MAP: Record<string, number> = {
  normal: 1,
  happy: 2,
  angry: 3,
  sad: 4,
}

interface PendingState {
  bg?: string
  card?: string
  still?: string
  camera?: number
  fade?: FadeTypes
  fadeValues: [number?, number?, number?]
  bgm?: string
  se?: string
  voice?: string
  movie?: string
  windowEffect?: WindowEffects
  effect?: string
  characters: IEpisodeDetailCharacterMotion[]
  charsDirty: boolean
  aliases: Map<string, number>
}

export const DSL_SNIPPETS = [
  { category: '场景', label: '切换背景 (交叉淡入)', code: '@bg 1000 fade=cross' },
  { category: '场景', label: '切换背景 + 镜头推进', code: '@bg 1001 fade=cross camera=6' },
  { category: '场景', label: '黑场转场', code: '@fade black 0.4 0.5 0.4' },
  { category: '场景', label: '白场转场', code: '@fade white 0.4 0.5 0.4' },
  { category: '场景', label: '时间流逝转场', code: '@fade time' },
  { category: '角色', label: '角色登场 (心菜·微笑)', code: '@char 1 10101 pos=center expr=smile body=happy' },
  { category: '角色', label: '角色左滑入 (思考)', code: '@char 1 10101 pos=left appear=left expr=normal body=think' },
  { category: '角色', label: '清空场上角色', code: '@clear_chars' },
  { category: '特效', label: '怀旧滤镜 (Sepia)', code: '@effect sepia' },
  { category: '特效', label: '柔白光晕 (WhiteBlur)', code: '@effect blur' },
  { category: '特效', label: '清除画面滤镜', code: '@effect none' },
  { category: '音频', label: '播放 BGM', code: '@bgm bgm_001' },
  { category: '音频', label: '停止 BGM', code: '@bgm stop' },
  { category: '音频', label: '播放音效 SE', code: '@se se_001' },
  { category: '对话', label: '角色台词', code: '心菜: 这里输入台词内容。' },
  { category: '对话', label: '同组续行', code: '+ 接着上一句继续说。' },
  { category: '对话', label: '旁白', code: ': 这里输入旁白描述。' },
]

export function compileDsl(
  source: string,
  resources?: DslResourceSets,
  activeChoices?: Record<string, number>,
  startSceneId?: string,
): DslCompileOutput {
  const flattened = flattenGraphForCompile(source, activeChoices, startSceneId)
  const episode: IEpisodeModel = {
    EpisodeId: 1,
    StoryType: 1 as StoryTypes,
    Order: 1,
    Prev: undefined,
    Next: undefined,
    Chapter: 'Custom Story',
    Title: 'Untitled Episode',
    EpisodeDetail: [],
  }

  const pending: PendingState = {
    fadeValues: [],
    characters: [],
    charsDirty: false,
    aliases: new Map(),
  }
  const diagnostics: DslDiagnostic[] = flattened.danglingLinks.map(({ line, target }) => ({
    line,
    message: `连线目标场景 "${target}" 不存在`,
  }))
  const flatLineToFrame = new Map<number, number>()
  let nextGroupOrder = 1

  const lines = flattened.flatSource.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const flatLineNo = i + 1
    const origLineNo = flattened.flatLineToSourceLine.get(flatLineNo) ?? flatLineNo
    const line = lines[i].trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    if (line.startsWith('@')) {
      handleDirective(origLineNo, line.slice(1), episode, pending, diagnostics, resources)
      continue
    }

    if (line.startsWith('+')) {
      const phrase = line.slice(1).trim()
      const groupOrder = Math.max(1, nextGroupOrder - 1)
      const frameIdx = episode.EpisodeDetail.length
      episode.EpisodeDetail.push(
        buildFrame(frameIdx + 1, episode.EpisodeId, 2 as NextOrderType, groupOrder, undefined, phrase, 2 as FontSizes, pending),
      )
      flatLineToFrame.set(flatLineNo, frameIdx)
      continue
    }

    const colonIdx = findDialogueColon(line)
    if (colonIdx !== -1) {
      const head = line.slice(0, colonIdx)
      const phrase = line.slice(colonIdx + 1).trim()
      const { speaker, fontSize } = parseSpeakerAndSize(head, origLineNo, diagnostics)
      const groupOrder = nextGroupOrder++
      const frameIdx = episode.EpisodeDetail.length
      episode.EpisodeDetail.push(
        buildFrame(frameIdx + 1, episode.EpisodeId, 1 as NextOrderType, groupOrder, speaker, phrase, fontSize, pending),
      )
      flatLineToFrame.set(flatLineNo, frameIdx)
    } else {
      diagnostics.push({
        line: origLineNo,
        message: `无法识别的语法（应为 @指令 或 说话人: 台词）: ${line}`,
      })
    }
  }

  if (
    pending.bg ||
    pending.still ||
    pending.card ||
    pending.fade !== undefined ||
    pending.bgm ||
    pending.se ||
    pending.voice ||
    pending.movie ||
    pending.effect ||
    pending.charsDirty
  ) {
    const frameIdx = episode.EpisodeDetail.length
    episode.EpisodeDetail.push(
      buildFrame(frameIdx + 1, episode.EpisodeId, 1 as NextOrderType, nextGroupOrder, undefined, '', 2 as FontSizes, pending),
    )
  }

  const lineToFrame = new Map<number, number>()
  for (const [flatLine, frameIdx] of flatLineToFrame.entries()) {
    const orig = flattened.flatLineToSourceLine.get(flatLine) ?? flatLine
    lineToFrame.set(orig, frameIdx)
  }

  const sceneStartFrames = new Map<string, number>()
  for (const [sceneId, range] of flattened.sceneRanges.entries()) {
    for (let l = range.startLine; l <= range.endLine; l++) {
      const frame = flatLineToFrame.get(l)
      if (typeof frame === 'number') {
        sceneStartFrames.set(sceneId, frame)
        break
      }
    }
  }

  return { episode, lineToFrame, sceneStartFrames, diagnostics }
}

function buildFrame(
  id: number,
  episodeMasterId: number,
  order: NextOrderType,
  groupOrder: number,
  speakerName: string | undefined,
  phrase: string,
  fontSize: FontSizes,
  pending: PendingState,
): IEpisodeDetail {
  // wds-player's CharacterView hides all characters when CharacterMotions is empty,
  // so active characters must persist across frames until @clear_chars.
  const characters = pending.characters.map((c) => ({ ...c }))
  pending.charsDirty = false

  const frame: IEpisodeDetail = {
    Id: id,
    EpisodeMasterId: episodeMasterId,
    Order: order,
    GroupOrder: groupOrder,
    SpeakerName: speakerName,
    Phrase: phrase,
    FontSize: fontSize,
    BackgroundImageFileName: pending.bg,
    BackgroundCharacterImageFileName: pending.card,
    StillPhotoFileName: pending.still,
    SceneCameraMasterId: pending.camera,
    BackgroundImageFileFadeType: pending.fade,
    FadeValue1: pending.fadeValues[0],
    FadeValue2: pending.fadeValues[1],
    FadeValue3: pending.fadeValues[2],
    BgmFileName: pending.bgm,
    SeFileName: pending.se,
    VoiceFileName: pending.voice,
    MovieFileName: pending.movie,
    WindowEffect: pending.windowEffect,
    Effect: pending.effect,
    CharacterMotions: characters,
  }

  pending.bg = undefined
  pending.card = undefined
  pending.still = undefined
  pending.camera = undefined
  pending.fade = undefined
  pending.fadeValues = []
  pending.bgm = undefined
  pending.se = undefined
  pending.voice = undefined
  pending.movie = undefined
  // windowEffect persists across frames until `@effect none`
  pending.effect = undefined

  return frame
}

function findDialogueColon(line: string): number {
  const ascii = line.indexOf(':')
  const full = line.indexOf('：')
  if (ascii === -1) return full
  if (full === -1) return ascii
  return Math.min(ascii, full)
}

function parseSpeakerAndSize(
  head: string,
  lineNo: number,
  diagnostics: DslDiagnostic[],
): { speaker?: string; fontSize: FontSizes } {
  const trimmed = head.trim()
  if (!trimmed) return { speaker: undefined, fontSize: 2 as FontSizes }

  const open = trimmed.lastIndexOf('(')
  if (open !== -1 && trimmed.endsWith(')')) {
    const name = trimmed.slice(0, open).trim()
    const sizeStr = trimmed.slice(open + 1, -1).trim().toLowerCase()
    let fontSize: FontSizes = 2 as FontSizes
    if (sizeStr === 's' || sizeStr === 'small') fontSize = 1 as FontSizes
    else if (sizeStr === 'm' || sizeStr === 'middle' || sizeStr === 'medium') fontSize = 2 as FontSizes
    else if (sizeStr === 'l' || sizeStr === 'large') fontSize = 3 as FontSizes
    else {
      diagnostics.push({ line: lineNo, message: `未知字号 "${sizeStr}"，已回退为 middle` })
    }
    return { speaker: name || undefined, fontSize }
  }

  return { speaker: trimmed, fontSize: 2 as FontSizes }
}

function handleDirective(
  lineNo: number,
  rest: string,
  episode: IEpisodeModel,
  pending: PendingState,
  diagnostics: DslDiagnostic[],
  resources?: DslResourceSets,
) {
  const tokens = rest.trim().split(/\s+/)
  const cmd = tokens[0]?.toLowerCase()
  const args = tokens.slice(1)
  if (!cmd) return

  switch (cmd) {
    case 'title':
      episode.Title = rest.slice(cmd.length).trim()
      break
    case 'chapter':
      episode.Chapter = rest.slice(cmd.length).trim()
      break
    case 'episode': {
      const id = Number(args[0])
      if (Number.isFinite(id) && id > 0) episode.EpisodeId = id
      else diagnostics.push({ line: lineNo, message: `无效的 episode id: ${args[0] ?? ''}` })
      break
    }
    case 'bg': {
      if (!args[0]) {
        diagnostics.push({ line: lineNo, message: '@bg 缺少背景资源名称' })
        break
      }
      if (
        !args[0].startsWith('asset_') &&
        resources?.backgrounds &&
        resources.backgrounds.size > 0 &&
        !resources.backgrounds.has(args[0])
      ) {
        diagnostics.push({ line: lineNo, message: `资源库中未找到背景 "${args[0]}"` })
      }
      pending.bg = args[0]
      for (const kv of args.slice(1)) {
        const [k, v] = kv.split('=')
        if (k === 'fade') pending.fade = parseFade(v)
        else if (k === 'camera') pending.camera = Number(v) || undefined
      }
      break
    }
    case 'still':
      if (args[0] && resources?.stills && resources.stills.size > 0 && !resources.stills.has(args[0])) {
        diagnostics.push({ line: lineNo, message: `资源库中未找到 CG "${args[0]}"` })
      }
      pending.still = args[0]
      break
    case 'card':
      pending.card = args[0]
      break
    case 'bgm': {
      const id = args[0]?.toLowerCase() === 'stop' ? '999' : args[0]
      if (id && id !== '999' && !id.startsWith('asset_') && resources?.bgms && resources.bgms.size > 0 && !resources.bgms.has(id)) {
        diagnostics.push({ line: lineNo, message: `资源库中未找到 BGM "${id}"` })
      }
      pending.bgm = id
      break
    }
    case 'se':
      if (args[0] && !args[0].startsWith('asset_') && resources?.ses && resources.ses.size > 0 && !resources.ses.has(args[0])) {
        diagnostics.push({ line: lineNo, message: `资源库中未找到音效 "${args[0]}"` })
      }
      pending.se = args[0]
      break
    case 'voice':
      pending.voice = args[0]
      break
    case 'movie':
      pending.movie = args[0]
      break
    case 'effect': {
      const eff = (args[0] || '').toLowerCase()
      if (eff === 'sepia') pending.windowEffect = 1 as WindowEffects
      else if (eff === 'blur' || eff === 'whiteblur') pending.windowEffect = 2 as WindowEffects
      else if (eff === 'none' || eff === 'clear') pending.windowEffect = undefined
      else pending.effect = args[0]
      break
    }
    case 'fade': {
      pending.fade = parseFade(args[0])
      for (let i = 0; i < 3; i++) {
        const n = Number(args[i + 1])
        if (Number.isFinite(n)) pending.fadeValues[i] = n
      }
      break
    }
    case 'clear_chars':
      pending.characters = []
      pending.charsDirty = true
      break
    case 'alias': {
      const [aliasName, idRaw] = args
      const id = Number(idRaw)
      if (!aliasName || !Number.isInteger(id) || id <= 0) {
        diagnostics.push({ line: lineNo, message: '@alias 需要格式: @alias <角色名> <spine_id>' })
      } else {
        pending.aliases.set(aliasName, id)
      }
      break
    }
    case 'char':
      handleCharDirective(lineNo, args, pending, diagnostics, resources)
      break
    default:
      diagnostics.push({ line: lineNo, message: `未知指令 @${cmd}` })
  }
}

function parseFade(value?: string): FadeTypes | undefined {
  switch ((value || '').toLowerCase()) {
    case 'black':
      return 1 as FadeTypes
    case 'white':
      return 2 as FadeTypes
    case 'time':
    case 'elapsed':
      return 3 as FadeTypes
    case 'cross':
    case 'crossfade':
      return 4 as FadeTypes
    default:
      return undefined
  }
}

function handleCharDirective(
  lineNo: number,
  args: string[],
  pending: PendingState,
  diagnostics: DslDiagnostic[],
  resources?: DslResourceSets,
) {
  if (args.length < 2) {
    diagnostics.push({ line: lineNo, message: '@char 需要至少提供 <slot> <spine_id>' })
    return
  }
  const slotNumber = Number(args[0])
  const resolvedId = pending.aliases.get(args[1]) ?? Number(args[1])
  const spineId = resolvedId
  if (!Number.isInteger(slotNumber) || !Number.isInteger(spineId)) {
    diagnostics.push({ line: lineNo, message: '@char 的 slot 必须为整数，角色需为 spine_id 或已定义的 @alias' })
    return
  }
  if (spineId > 0 && resources?.spines && resources.spines.size > 0 && !resources.spines.has(String(spineId))) {
    diagnostics.push({ line: lineNo, message: `资源库中未找到 Spine "${spineId}"` })
  }

  let motion = pending.characters.find((c) => c.slotNumber === slotNumber)
  if (!motion) {
    motion = {
      slotNumber,
      FacialExpressionMasterId: 1,
      BodyMotionMasterId: 1,
      SpineId: spineId,
      CharacterAppearanceType: 0 as CharacterAppearanceTypes,
      CharacterPosition: 3 as CharacterPositions,
      CharacterLayerType: 0 as CharacterLayerTypes,
      SpineSize: 1 as SpineSizes,
    }
    pending.characters.push(motion)
  }
  motion.SpineId = spineId

  for (const kv of args.slice(2)) {
    const [k, v] = kv.split('=')
    if (!v) continue
    const val = v.toLowerCase()
    switch (k) {
      case 'pos':
        motion.CharacterPosition = ({
          outer_left: 1,
          ol: 1,
          left: 2,
          inner_left: 2,
          il: 2,
          center: 3,
          c: 3,
          right: 4,
          inner_right: 4,
          ir: 4,
          outer_right: 5,
          or: 5,
        }[val] ?? 3) as CharacterPositions
        break
      case 'size':
        motion.SpineSize = ({ s: 1, small: 1, m: 2, middle: 2, l: 3, large: 3 }[val] ?? 1) as SpineSizes
        break
      case 'layer': {
        const layer = Number(val)
        if (Number.isInteger(layer) && layer >= 0 && layer <= 3) motion.CharacterLayerType = layer as CharacterLayerTypes
        break
      }
      case 'appear':
        motion.CharacterAppearanceType = ({
          fade: 0,
          right: 1,
          left: 2,
          bottom: 3,
        }[val] ?? 0) as CharacterAppearanceTypes
        break
      case 'expr':
        motion.FacialExpressionMasterId = Number.isFinite(Number(v)) ? Number(v) : EXPR_MAP[val]
        break
      case 'body':
        motion.BodyMotionMasterId = Number.isFinite(Number(v)) ? Number(v) : BODY_MAP[val]
        break
      case 'head':
        motion.HeadMotionMasterId = Number.isFinite(Number(v)) ? Number(v) : HEAD_MAP[val]
        break
      case 'dir':
        motion.HeadDirectionMasterId = Number.isFinite(Number(v)) ? Number(v) : DIR_MAP[val]
        break
      case 'lip':
        motion.LipSyncMasterId = Number.isFinite(Number(v)) ? Number(v) : LIP_MAP[val]
        break
    }
  }
  pending.charsDirty = true
}
