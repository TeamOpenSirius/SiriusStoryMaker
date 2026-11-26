export interface StoryChoiceEdge {
  label: string
  target: string
}

export interface StorySceneNode {
  id: string
  title: string
  x: number
  y: number
  body: string
  bgm?: string
  next?: string
  choices: StoryChoiceEdge[]
}

export interface StoryGraphDoc {
  hasExplicitScenes: boolean
  preamble: string
  nodes: StorySceneNode[]
}

const SCENE_HEADER_RE = /^@scene\s+([^\s]+)(.*)$/i
const CHOICE_RE = /^@choice\s+"([^"]+)"\s*->\s*([^\s]+)\s*$/i
const JUMP_RE = /^->\s*([^\s]+)\s*$/

function normalizeSceneBgm(value: string): string | undefined {
  const id = value.trim()
  if (!/^[\w.-]+$/.test(id)) return
  if (id === '999' || id.toLowerCase() === 'stop') return 'stop'
  return id.toLowerCase() === 'inherit' ? 'inherit' : id
}

function isDialogue(line: string) {
  const text = line.trim()
  return text && !text.startsWith('@') && !text.startsWith('#') && !text.startsWith('//') &&
    (text.startsWith('+') || /[:：]/.test(text))
}

export function getSceneBgm(node: StorySceneNode): string | undefined {
  if (node.bgm) return node.bgm
  let bgm: string | undefined
  for (const line of node.body.split('\n')) {
    if (isDialogue(line)) break
    const legacy = /^\s*@bgm\s+(\S+)/i.exec(line)
    if (legacy) bgm = normalizeSceneBgm(legacy[1])
  }
  return bgm
}

export function setSceneBgm(node: StorySceneNode, value: string) {
  node.bgm = normalizeSceneBgm(value)
  // The old UI wrote the entry cue into the first frame. Move that cue
  // to the scene header, but keep explicit later DSL cue changes intact.
  let beforeFirstFrame = true
  node.body = node.body.split('\n').filter(line => {
    if (isDialogue(line)) beforeFirstFrame = false
    return !(beforeFirstFrame && /^\s*@bgm(?:\s|$)/i.test(line))
  }).join('\n')
}

function liftLegacyEntryCue(node: StorySceneNode, preserveLegacyCues: boolean) {
  if (preserveLegacyCues || node.bgm) return
  const bgm = getSceneBgm(node)
  if (bgm) setSceneBgm(node, bgm)
}

export function parseStoryGraph(source: string, preserveLegacyCues = false): StoryGraphDoc {
  const lines = source.split(/\r?\n/)
  const preambleLines: string[] = []
  const nodes: StorySceneNode[] = []
  let current: StorySceneNode | null = null
  let currentBodyLines: string[] = []

  const flushCurrent = () => {
    if (!current) return
    current.body = currentBodyLines.join('\n').replace(/^\n+|\n+$/g, '')
    liftLegacyEntryCue(current, preserveLegacyCues)
    nodes.push(current)
    current = null
    currentBodyLines = []
  }

  for (const raw of lines) {
    const trimmed = raw.trim()
    const sceneMatch = trimmed.match(SCENE_HEADER_RE)
    if (sceneMatch) {
      flushCurrent()
      const id = sceneMatch[1]
      const rest = sceneMatch[2] || ''
      const titleMatch = rest.match(/title="([^"]*)"/)
      const bgmMatch = rest.replace(/title="[^"]*"/g, '').match(/(?:^|\s)bgm="([^"]*)"/i)
      const xMatch = rest.match(/\bx=(-?\d+(?:\.\d+)?)/)
      const yMatch = rest.match(/\by=(-?\d+(?:\.\d+)?)/)
      const idx = nodes.length
      current = {
        id,
        title: titleMatch?.[1] || id,
        x: xMatch ? Number(xMatch[1]) : 80 + idx * 320,
        y: yMatch ? Number(yMatch[1]) : 120,
        body: '',
        bgm: bgmMatch ? normalizeSceneBgm(bgmMatch[1]) : undefined,
        choices: [],
      }
      continue
    }

    if (!current) {
      preambleLines.push(raw)
      continue
    }

    const choiceMatch = trimmed.match(CHOICE_RE)
    if (choiceMatch) {
      current.choices.push({ label: choiceMatch[1], target: choiceMatch[2] })
      continue
    }

    const jumpMatch = trimmed.match(JUMP_RE)
    if (jumpMatch) {
      current.next = jumpMatch[1]
      continue
    }

    currentBodyLines.push(raw)
  }

  flushCurrent()

  if (nodes.length === 0) {
    const bodyLines: string[] = []
    const headerLines: string[] = []
    for (const line of preambleLines) {
      const t = line.trim()
      if (/^@(title|chapter|episode|alias)\b/i.test(t) || t === '') {
        if (bodyLines.length === 0) headerLines.push(line)
        else bodyLines.push(line)
      } else {
        bodyLines.push(line)
      }
    }
    const node: StorySceneNode = {
      id: 'start',
      title: '主线剧情',
      x: 100,
      y: 140,
      body: bodyLines.join('\n').replace(/^\n+|\n+$/g, ''),
      choices: [],
    }
    liftLegacyEntryCue(node, preserveLegacyCues)
    return {
      hasExplicitScenes: false,
      preamble: headerLines.join('\n').replace(/\n+$/g, ''),
      nodes: [node],
    }
  }

  return {
    hasExplicitScenes: true,
    preamble: preambleLines.join('\n').replace(/\n+$/g, ''),
    nodes,
  }
}

export function serializeStoryGraph(doc: StoryGraphDoc): string {
  const parts: string[] = []
  if (doc.preamble.trim()) {
    parts.push(doc.preamble.trimEnd())
  }

  for (const node of doc.nodes) {
    const safeTitle = node.title.replace(/"/g, "'")
    const header = `@scene ${node.id} title="${safeTitle}" x=${Math.round(node.x)} y=${Math.round(node.y)}`
    const bgm = node.bgm && normalizeSceneBgm(node.bgm)
    const block: string[] = [bgm ? `${header} bgm="${bgm}"` : header]
    if (node.body.trim()) {
      block.push(node.body.trim())
    }
    for (const c of node.choices) {
      block.push(`@choice "${c.label.replace(/"/g, "'")}" -> ${c.target}`)
    }
    if (node.next) {
      block.push(`-> ${node.next}`)
    }
    parts.push(block.join('\n'))
  }

  return parts.join('\n\n') + '\n'
}

export interface FlattenedGraphResult {
  flatSource: string
  danglingLinks: Array<{ line: number; target: string }>
  /** Maps sceneId -> 1-based line range [start, end] in flatSource */
  sceneRanges: Map<string, { startLine: number; endLine: number }>
  /** Maps 1-based flat line -> 1-based original source line */
  flatLineToSourceLine: Map<number, number>
}

export function flattenGraphForCompile(
  source: string,
  activeChoices?: Record<string, number>,
  startSceneId?: string,
): FlattenedGraphResult {
  // Compile the original directives so their source line numbers and diagnostics stay intact.
  const doc = parseStoryGraph(source, true)
  const danglingLinks: FlattenedGraphResult['danglingLinks'] = []
  if (!doc.hasExplicitScenes) {
    return {
      flatSource: source,
      danglingLinks,
      sceneRanges: new Map([['start', { startLine: 1, endLine: source.split(/\r?\n/).length }]]),
      flatLineToSourceLine: new Map(),
    }
  }

  const rawLines = source.split(/\r?\n/)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const sceneHeaderLines = new Map<string, number>()
  const sceneBodyWithLineNos = new Map<string, Array<{ text: string; lineNo: number }>>()
  const preambleWithLineNos: Array<{ text: string; lineNo: number }> = []
  let activeSceneId: string | null = null

  rawLines.forEach((raw, i) => {
    const lineNo = i + 1
    const trimmed = raw.trim()
    const m = trimmed.match(SCENE_HEADER_RE)
    if (m) {
      activeSceneId = m[1]
      sceneHeaderLines.set(activeSceneId, lineNo)
      if (!sceneBodyWithLineNos.has(activeSceneId)) {
        sceneBodyWithLineNos.set(activeSceneId, [])
      }
      return
    }
    const target = CHOICE_RE.exec(trimmed)?.[2] ?? JUMP_RE.exec(trimmed)?.[1]
    if (target && !byId.has(target)) danglingLinks.push({ line: lineNo, target })
    if (!activeSceneId) {
      preambleWithLineNos.push({ text: raw, lineNo })
      return
    }
    if (target) return
    sceneBodyWithLineNos.get(activeSceneId)!.push({ text: raw, lineNo })
  })

  const ordered: StorySceneNode[] = []
  const visited = new Set<string>()

  const visit = (id: string) => {
    let currId: string | undefined = id
    while (currId && !visited.has(currId)) {
      const node = byId.get(currId)
      if (!node) break
      visited.add(currId)
      ordered.push(node)
      const choiceIdx = activeChoices?.[node.id] ?? 0
      currId = node.choices[choiceIdx]?.target ?? node.choices[0]?.target ?? node.next
    }
  }

  const entry = startSceneId ?? doc.nodes[0]?.id
  if (entry) visit(entry)

  const flatLines: string[] = []
  const flatLineToSourceLine = new Map<number, number>()
  const sceneRanges = new Map<string, { startLine: number; endLine: number }>()

  for (const entry of preambleWithLineNos) {
    flatLines.push(entry.text)
    flatLineToSourceLine.set(flatLines.length, entry.lineNo)
  }

  for (const node of ordered) {
    const startLine = flatLines.length + 1
    const entries = sceneBodyWithLineNos.get(node.id) ?? []
    const bgm = node.bgm
    if (bgm && bgm !== 'inherit') {
      flatLines.push(`@bgm ${bgm}`)
      flatLineToSourceLine.set(flatLines.length, sceneHeaderLines.get(node.id)!)
    }
    for (const entry of entries) {
      flatLines.push(entry.text)
      flatLineToSourceLine.set(flatLines.length, entry.lineNo)
    }
    const endLine = flatLines.length
    sceneRanges.set(node.id, { startLine, endLine })
  }

  return {
    flatSource: flatLines.join('\n'),
    danglingLinks,
    sceneRanges,
    flatLineToSourceLine,
  }
}
