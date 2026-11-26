import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OFFICIAL_KB_TOOLS, queryOfficialKb } from './official-kb'
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
    description: 'Read the current SiriusStoryMaker DSL story script from the active workspace.',
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
          description: 'Complete SiriusStoryMaker DSL script content.',
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
      'Look up a WDS speaker, short Chinese dialogue examples, and Spine/pose frequencies observed when only one character is visible.',
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
      'Search the packaged WDS Chinese corpus by dialogue, chapter, title, or speaker. Returns episode IDs and matching scene IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional literal keyword to match title, chapter, speaker, or full dialogue.' },
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
  {
    name: 'trace_official_scene',
    description: 'Follow the original episode scene graph. Returns previous/next scene, frame range, background/BGM/SE, and scenes sharing observed resources.',
    inputSchema: {
      type: 'object',
      properties: {
        sceneId: { type: 'number', description: 'Scene ID from a corpus search result.' },
        limit: { type: 'number', description: 'Maximum related scenes (default 6, max 15).' },
      },
      required: ['sceneId'],
    },
  },
  {
    name: 'search_official_asset_usage',
    description: 'Recommend catalogued background, BGM or sound-effect IDs from actual WDS scene usage. Filter by scene dialogue or co-occurring assets. Returns episode/frame evidence, not inferred audio labels.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['background', 'bgm', 'se'] },
        id: { type: 'string', description: 'Optional exact asset ID to inspect, even if absent from the catalog.' },
        query: { type: 'string', description: 'Optional context keyword, e.g. 排练, 脚步, 舞台.' },
        background: { type: 'string', description: 'Optional background ID active in the scene.' },
        bgm: { type: 'string', description: 'Optional BGM ID used in the same scene.' },
        limit: { type: 'number', description: 'Maximum asset IDs (default 6, max 15).' },
      },
      required: ['kind'],
    },
  },
]

const DSL_SPEC_TEXT = `# SiriusStoryMaker Story DSL Specification
- @title <text> / @chapter <text> / @episode <number>
- @alias <Name> <spine_id> (e.g. @alias 心菜 10101)
- @scene <id> title="<name>" x=<n> y=<n> bgm="<id|inherit|stop>"
- -> <scene_id> | @choice "<label>" -> <scene_id>
- @bg <id> [fade=cross|black|white|time] [camera=1..6]
- @still <id> | @card <id>
- @se <id> | @voice <id> set frame audio. Set BGM in the scene header. Blank keeps the previous track. Use stop for silence.
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

export async function executeStudioMcpTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { storyFile: string; resourceTreePath?: string; kbPath?: string },
): Promise<string> {
  if (OFFICIAL_KB_TOOLS.has(name)) {
    try {
      return JSON.stringify(queryOfficialKb(name, args, ctx.kbPath))
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
    }
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
  if (process.argv[2] === '--knowledge') {
    try {
      const name = process.argv[3] || ''
      if (!OFFICIAL_KB_TOOLS.has(name)) throw new Error('Unknown official corpus tool.')
      const args = JSON.parse(process.argv[4] || '{}') as Record<string, unknown>
      process.stdout.write(JSON.stringify(queryOfficialKb(name, args), null, 2) + '\n')
    } catch (err) {
      process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n')
      process.exitCode = 1
    }
  } else startStdioServer()
}
