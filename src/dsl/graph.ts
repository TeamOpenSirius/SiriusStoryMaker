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

export function parseStoryGraph(source: string): StoryGraphDoc {
  const lines = source.split(/\r?\n/)
  const preambleLines: string[] = []
  const nodes: StorySceneNode[] = []
  let current: StorySceneNode | null = null
  let currentBodyLines: string[] = []

  const flushCurrent = () => {
    if (!current) return
    current.body = currentBodyLines.join('\n').replace(/^\n+|\n+$/g, '')
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
      const xMatch = rest.match(/\bx=(-?\d+(?:\.\d+)?)/)
      const yMatch = rest.match(/\by=(-?\d+(?:\.\d+)?)/)
      const idx = nodes.length
      current = {
        id,
        title: titleMatch?.[1] || id,
        x: xMatch ? Number(xMatch[1]) : 80 + idx * 320,
        y: yMatch ? Number(yMatch[1]) : 120,
        body: '',
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
    return {
      hasExplicitScenes: false,
      preamble: headerLines.join('\n').replace(/\n+$/g, ''),
      nodes: [
        {
          id: 'start',
          title: '主线剧情',
          x: 100,
          y: 140,
          body: bodyLines.join('\n').replace(/^\n+|\n+$/g, ''),
          choices: [],
        },
      ],
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
    const block: string[] = [header]
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
  /** Maps sceneId -> 1-based line range [start, end] in flatSource */
  sceneRanges: Map<string, { startLine: number; endLine: number }>
  /** Maps 1-based flat line -> 1-based original source line */
  flatLineToSourceLine: Map<number, number>
}

export function flattenGraphForCompile(
  source: string,
  activeChoices?: Record<string, number>,
): FlattenedGraphResult {
  const doc = parseStoryGraph(source)
  if (!doc.hasExplicitScenes) {
    return {
      flatSource: source,
      sceneRanges: new Map([['start', { startLine: 1, endLine: source.split(/\r?\n/).length }]]),
      flatLineToSourceLine: new Map(),
    }
  }

  const rawLines = source.split(/\r?\n/)
  const sceneBodyWithLineNos = new Map<string, Array<{ text: string; lineNo: number }>>()
  const preambleWithLineNos: Array<{ text: string; lineNo: number }> = []
  let activeSceneId: string | null = null

  rawLines.forEach((raw, i) => {
    const lineNo = i + 1
    const trimmed = raw.trim()
    const m = trimmed.match(SCENE_HEADER_RE)
    if (m) {
      activeSceneId = m[1]
      if (!sceneBodyWithLineNos.has(activeSceneId)) {
        sceneBodyWithLineNos.set(activeSceneId, [])
      }
      return
    }
    if (!activeSceneId) {
      preambleWithLineNos.push({ text: raw, lineNo })
      return
    }
    if (CHOICE_RE.test(trimmed) || JUMP_RE.test(trimmed)) return
    sceneBodyWithLineNos.get(activeSceneId)!.push({ text: raw, lineNo })
  })

  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
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
      currId = node.next ?? node.choices[choiceIdx]?.target ?? node.choices[0]?.target
    }
  }

  if (doc.nodes[0]) visit(doc.nodes[0].id)
  for (const n of doc.nodes) {
    if (!visited.has(n.id)) visit(n.id)
  }

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
    for (const entry of entries) {
      flatLines.push(entry.text)
      flatLineToSourceLine.set(flatLines.length, entry.lineNo)
    }
    const endLine = Math.max(startLine, flatLines.length)
    sceneRanges.set(node.id, { startLine, endLine })
  }

  return {
    flatSource: flatLines.join('\n'),
    sceneRanges,
    flatLineToSourceLine,
  }
}
