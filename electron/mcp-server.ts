import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileDsl, type DslResourceSets } from '../src/dsl/compiler'

export interface StudioMcpToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const STUDIO_MCP_TOOLS: StudioMcpToolDef[] = [
  {
    name: 'read_story',
    description: 'Read the current SiriusAdvStudio DSL story script from the active workspace.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'write_story',
    description:
      'Replace the current story DSL in the workspace, immediately syncing to the Studio editor and live WDS Adv Player preview. Also runs validation and returns diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Complete SiriusAdvStudio DSL script content.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'validate_story',
    description:
      'Compile and validate the current story (or provided DSL content) against the WDS resource catalog, returning frame count, scenes, and any diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Optional DSL content to validate. Omit to validate current.story.',
        },
      },
    },
  },
  {
    name: 'search_resources',
    description:
      'Search verified WDS Adv Player resource IDs (backgrounds, spines, stills, cards, bgms, ses) from adv-resource-tree.json.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['backgrounds', 'spines', 'stills', 'cards', 'bgms', 'ses'],
          description: 'Resource category to search.',
        },
        query: {
          type: 'string',
          description: 'Optional substring filter.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of IDs to return (default 40, max 120).',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: 'get_dsl_spec',
    description: 'Get the complete WDS Adv Player minimalist DSL specification and common Sirius character Spine IDs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'study_character',
    description:
      'Look up an official WDS character in the 2,470-episode knowledge base to get verified Spine IDs, top expressions/body motions, and authentic Chinese dialogue quotes.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Character name in Chinese, e.g. 心菜, 静香, 卡特莉娜, 八惠, 潘达, 知沙' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_official_episodes',
    description:
      'Search across 2,470 official WDS Chinese episodes by keyword, chapter, title, or speaker name to find reference episodes and BG/BGM/SE usage.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword to match title, chapter, or preview text.' },
        speaker: { type: 'string', description: 'Optional speaker name filter.' },
        limit: { type: 'number', description: 'Max episodes to return (default 8, max 25).' },
      },
    },
  },
  {
    name: 'inspect_official_episode',
    description:
      'Read a slice of an official WDS episode (BG, BGM, SE, character Spine/expr/body, Speaker, Phrase) to study authentic staging and pacing.',
    inputSchema: {
      type: 'object',
      properties: {
        episodeId: { type: 'number', description: 'Official EpisodeId from search_official_episodes.' },
        startLine: { type: 'number', description: '1-based start line (default 1).' },
        limit: { type: 'number', description: 'Number of lines to return (default 25, max 60).' },
      },
      required: ['episodeId'],
    },
  },
]

const DSL_SPEC_TEXT = `# SiriusAdvStudio Story DSL Specification
- @title <text> / @chapter <text> / @episode <number>
- @alias <Name> <spine_id> (e.g. @alias 心菜 10101)
- @scene <id> title="<name>" x=<n> y=<n>
- -> <scene_id> | @choice "<label>" -> <scene_id>
- @bg <id> [fade=cross|black|white|time] [camera=1..6]
- @still <id> | @card <id>
- @bgm <id|stop> | @se <id> | @voice <id>
- @effect sepia|blur|none
- @fade black|white|time|cross [v1] [v2] [v3]
- @char <slot> <spine_id|alias> [pos=outer_left|left|center|right|outer_right] [size=s|m|l] [appear=fade|left|right|bottom] [expr=normal|happy|smile|sad|angry|surprise|shy|close|close_happy] [body=normal|happy|angry|sad|amazement|shy|think] [head=nod|shake|nod2|shake2] [dir=normal|left|right|down|up|tilt_left|tilt_right]
- @clear_chars
- Speaker(small|middle|large): Dialogue | + Continuation | : Narration

Verified Sirius Spine IDs (each character has their own 10Xxx prefix):
- 10101 心菜 (10103 制服), 10201 静香 (10203 制服), 10301 卡特莉娜 (10303 制服), 10401 八惠 (10403 制服), 10501 潘达 (10503 制服), 10601 知沙
- Always call study_character for any other character to get verified Spine IDs!
`

interface ParsedResourceLists {
  backgrounds: string[]
  spines: string[]
  stills: string[]
  cards: string[]
  bgms: string[]
  ses: string[]
}

let cachedLists: ParsedResourceLists | null = null

async function loadResourceLists(resourceTreePath?: string): Promise<ParsedResourceLists> {
  if (cachedLists) return cachedLists
  const empty: ParsedResourceLists = {
    backgrounds: [],
    spines: [],
    stills: [],
    cards: [],
    bgms: [],
    ses: [],
  }
  if (!resourceTreePath) return empty
  try {
    const raw = await fs.readFile(resourceTreePath, 'utf-8')
    const tree = (JSON.parse(raw) as { tree?: Array<{ path: string }> }).tree ?? []
    const bg = new Set<string>()
    const sp = new Set<string>()
    const st = new Set<string>()
    const cd = new Set<string>()
    const bm = new Set<string>()
    const se = new Set<string>()
    for (const item of tree) {
      const p = item.path
      if (p.startsWith('background/') && p.endsWith('.png')) bg.add(p.slice(11, -4))
      else if (p.startsWith('spine/') && p.endsWith('.skel')) sp.add(p.slice(6, -5))
      else if (p.startsWith('still/') && p.endsWith('.png')) st.add(p.slice(6, -4))
      else if (p.startsWith('card/') && p.endsWith('.png')) cd.add(p.slice(5, -4))
      else if (p.startsWith('bgm/') && p.endsWith('.mp3')) bm.add(p.slice(4, -4))
      else if (p.startsWith('se/') && p.endsWith('.mp3')) se.add(p.slice(3, -4))
    }
    const sortIds = (s: Set<string>) =>
      Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    cachedLists = {
      backgrounds: sortIds(bg),
      spines: sortIds(sp),
      stills: sortIds(st),
      cards: sortIds(cd),
      bgms: sortIds(bm),
      ses: sortIds(se),
    }
    return cachedLists
  } catch {
    return empty
  }
}

let cachedKb: any | null = null

async function loadOfficialKb(kbPath?: string): Promise<any | null> {
  if (cachedKb) return cachedKb
  const candidates = [
    kbPath,
    process.env.SIRIUS_KB_PATH,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'official-story-kb.json'),
  ].filter((x): x is string => Boolean(x))
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8')
      cachedKb = JSON.parse(raw)
      return cachedKb
    } catch {
      continue
    }
  }
  return null
}

export async function executeStudioMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { storyFile: string; resourceTreePath?: string; kbPath?: string },
): Promise<string> {
  if (name === 'study_character') {
    const kb = await loadOfficialKb(ctx.kbPath)
    if (!kb) return JSON.stringify({ error: 'Official story knowledge base not built yet.' })
    const q = String(args.name || '').trim()
    const match =
      kb.characters.find((c: any) => c.name === q) ||
      kb.characters.find((c: any) => c.name.includes(q))
    if (!match) {
      return JSON.stringify({
        found: false,
        availableTop: kb.characters.slice(0, 25).map((c: any) => c.name),
      })
    }
    return JSON.stringify(match, null, 2)
  }

  if (name === 'search_official_episodes') {
    const kb = await loadOfficialKb(ctx.kbPath)
    if (!kb) return JSON.stringify({ error: 'Official story knowledge base not built yet.' })
    const query = String(args.query || '').trim().toLowerCase()
    const speaker = String(args.speaker || '').trim()
    const limit = Math.max(1, Math.min(25, Number(args.limit) || 8))
    const hits = (kb.episodes || [])
      .filter((ep: any) => {
        if (speaker && !(ep.speakers || []).some((s: string) => s.includes(speaker))) return false
        if (!query) return true
        return (
          String(ep.title || '').toLowerCase().includes(query) ||
          String(ep.chapter || '').toLowerCase().includes(query) ||
          String(ep.preview || '').toLowerCase().includes(query) ||
          (ep.speakers || []).some((s: string) => s.toLowerCase().includes(query))
        )
      })
      .slice(0, limit)
    return JSON.stringify({ totalMatches: hits.length, episodes: hits }, null, 2)
  }

  if (name === 'inspect_official_episode') {
    const kb = await loadOfficialKb(ctx.kbPath)
    const srcDir = process.env.SIRIUS_EPISODE_DIR || kb?.meta?.sourceDir
    if (!srcDir) return JSON.stringify({ error: 'Set SIRIUS_EPISODE_DIR or build the local corpus first.' })
    const epId = Number(args.episodeId)
    const startLine = Math.max(1, Number(args.startLine) || 1)
    const limit = Math.max(1, Math.min(60, Number(args.limit) || 25))
    const raw = await fs.readFile(path.join(srcDir, `${epId}.json`), 'utf-8')
    const ep = JSON.parse(raw)
    const slice = (ep.EpisodeDetail || []).slice(startLine - 1, startLine - 1 + limit).map((d: any, i: number) => ({
      line: startLine + i,
      speaker: d.SpeakerName || '',
      phrase: String(d.Phrase || '').replace(/\/n/g, '\n'),
      bg: d.BackgroundImageFileName || undefined,
      bgm: d.BgmFileName || undefined,
      se: d.SeFileName || undefined,
      voice: d.VoiceFileName || undefined,
      chars: (d.CharacterMotions || []).map((m: any) => ({
        slot: m.slotNumber,
        spine: m.SpineId,
        pos: m.CharacterPosition,
        expr: m.FacialExpressionMasterId,
        body: m.BodyMotionMasterId,
      })),
    }))
    return JSON.stringify(
      {
        episodeId: ep.EpisodeId,
        chapter: ep.Chapter,
        title: ep.Title,
        totalLines: (ep.EpisodeDetail || []).length,
        lines: slice,
      },
      null,
      2,
    )
  }

  if (name === 'read_story') {
    try {
      return await fs.readFile(ctx.storyFile, 'utf-8')
    } catch {
      return ''
    }
  }

  if (name === 'get_dsl_spec') {
    return DSL_SPEC_TEXT
  }

  if (name === 'search_resources') {
    const kind = String(args.kind || 'backgrounds') as keyof ParsedResourceLists
    const query = String(args.query || '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(120, Number(args.limit) || 40))
    const lists = await loadResourceLists(ctx.resourceTreePath)
    const list = lists[kind] ?? []
    const matched = query ? list.filter((id) => id.toLowerCase().includes(query)) : list
    return JSON.stringify(
      {
        kind,
        total: list.length,
        matched: matched.length,
        items: matched.slice(0, limit),
      },
      null,
      2,
    )
  }

  if (name === 'write_story' || name === 'validate_story') {
    let content = typeof args.content === 'string' ? args.content : undefined
    if (name === 'write_story') {
      if (typeof content !== 'string') {
        throw new Error('Missing required string argument: content')
      }
      await fs.writeFile(ctx.storyFile, content, 'utf-8')
    } else if (content === undefined) {
      content = await fs.readFile(ctx.storyFile, 'utf-8').catch(() => '')
    }

    const lists = await loadResourceLists(ctx.resourceTreePath)
    const sets: DslResourceSets = {
      backgrounds: new Set(lists.backgrounds),
      spines: new Set(lists.spines),
      stills: new Set(lists.stills),
      bgms: new Set(lists.bgms),
      ses: new Set(lists.ses),
    }
    const result = compileDsl(content, sets)
    return JSON.stringify(
      {
        ok: result.diagnostics.length === 0,
        saved: name === 'write_story',
        title: result.episode.Title,
        chapter: result.episode.Chapter,
        frameCount: result.episode.EpisodeDetail.length,
        scenes: Array.from(result.sceneStartFrames.keys()),
        diagnostics: result.diagnostics,
      },
      null,
      2,
    )
  }

  throw new Error(`Unknown tool: ${name}`)
}

// Stdio JSON-RPC 2.0 MCP Server entrypoint
function startStdioServer() {
  const workspaceDir = process.argv[2] || process.cwd()
  const resourceTreePath = process.argv[3] || ''
  const storyFile = path.join(workspaceDir, 'current.story')

  const send = (msg: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(msg) + '\n')
  }

  const handleMessage = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    let req: any
    try {
      req = JSON.parse(trimmed)
    } catch {
      return
    }
    const id = req.id
    const method = req.method

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return
    }

    try {
      if (method === 'initialize') {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'sirius-adv-studio', version: '0.1.0' },
          },
        })
      } else if (method === 'ping') {
        send({ jsonrpc: '2.0', id, result: {} })
      } else if (method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools: STUDIO_MCP_TOOLS } })
      } else if (method === 'resources/list') {
        send({ jsonrpc: '2.0', id, result: { resources: [] } })
      } else if (method === 'prompts/list') {
        send({ jsonrpc: '2.0', id, result: { prompts: [] } })
      } else if (method === 'tools/call') {
        const toolName = req.params?.name
        const toolArgs = (req.params?.arguments ?? {}) as Record<string, unknown>
        const output = await executeStudioMcpTool(toolName, toolArgs, { storyFile, resourceTreePath })
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: output }],
          },
        })
      } else if (id !== undefined) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
      }
    } catch (err) {
      if (id !== undefined) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          },
        })
      }
    }
  }

  let rawBuf = Buffer.alloc(0)
  process.stdin.on('data', (chunk: Buffer | string) => {
    const bufChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk
    rawBuf = Buffer.concat([rawBuf, bufChunk])

    while (rawBuf.length > 0) {
      // Skip leading CR/LF/whitespace between messages
      let start = 0
      while (start < rawBuf.length && (rawBuf[start] === 0x0d || rawBuf[start] === 0x0a)) {
        start++
      }
      if (start > 0) rawBuf = rawBuf.subarray(start)
      if (rawBuf.length === 0) break

      // Case 1: Content-Length LSP/MCP framed message
      if (rawBuf.subarray(0, 15).toString('ascii').toLowerCase().startsWith('content-length:')) {
        const headerEnd = rawBuf.indexOf('\r\n\r\n')
        const altEnd = headerEnd === -1 ? rawBuf.indexOf('\n\n') : -1
        const sepIdx = headerEnd !== -1 ? headerEnd : altEnd
        const sepLen = headerEnd !== -1 ? 4 : 2
        if (sepIdx === -1) break
        const headerText = rawBuf.subarray(0, sepIdx).toString('ascii')
        const m = headerText.match(/content-length:\s*(\d+)/i)
        if (!m) {
          rawBuf = rawBuf.subarray(sepIdx + sepLen)
          continue
        }
        const contentLen = Number(m[1])
        const totalNeeded = sepIdx + sepLen + contentLen
        if (rawBuf.length < totalNeeded) break
        const body = rawBuf.subarray(sepIdx + sepLen, totalNeeded).toString('utf-8')
        rawBuf = rawBuf.subarray(totalNeeded)
        void handleMessage(body)
        continue
      }

      // Case 2: Newline-delimited JSON-RPC
      const nlIdx = rawBuf.indexOf(0x0a)
      if (nlIdx === -1) break
      const line = rawBuf.subarray(0, nlIdx).toString('utf-8')
      rawBuf = rawBuf.subarray(nlIdx + 1)
      void handleMessage(line)
    }
  })
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  startStdioServer()
}
