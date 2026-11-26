import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

const filename = 'official-story-kb.sqlite'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
let cached: { path: string; db: DatabaseSync } | undefined
const string = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 160) : ''
const integer = (v: unknown, fallback: number, max: number) =>
  Math.min(max, Math.max(1, Math.floor(Number(v)) || fallback))

export function resolveOfficialKbPath(override?: string) {
  const root = path.resolve(here, '..')
  const explicit = override || process.env.SIRIUS_KB_PATH
  if (explicit) return existsSync(explicit) ? explicit : undefined
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'knowledge', filename),
    path.join(here.replace(/([/\\])[^/\\]+\.asar(?=[/\\])/u, '$&.unpacked'), 'knowledge', filename),
    path.join(root, 'data', filename),
  ]
  return candidates.find(p => p && existsSync(p))
}

function open(override?: string) {
  const resolved = resolveOfficialKbPath(override)
  if (!resolved) throw new Error('Official story SQLite database is unavailable. Reinstall or set SIRIUS_KB_PATH.')
  if (cached?.path === resolved) return cached.db
  let sqlite: typeof import('node:sqlite')
  try { sqlite = require('node:sqlite') } catch {
    throw new Error('Corpus tools need Node.js 22.13+ or the bundled Electron runtime.')
  }
  const db = new sqlite.DatabaseSync(resolved, { readOnly: true })
  try {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new Error('Unsupported official story database schema.')
    db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-4096')
  } catch (e) {
    db.close()
    throw e
  }
  cached?.db.close()
  cached = { path: resolved, db }
  return db
}

// FTS5 trigrams accelerate Chinese substring search without a word tokenizer.
// Its LIKE optimization needs at least 3 literal characters. In the other
// cases, use instr so %, _ and quotation marks are literal search terms.
function matchingScenes(query: string) {
  if (!query) return { sql: 'SELECT id FROM scene', args: [] as SQLInputValue[] }
  const useIndex = Array.from(query).length >= 3 && !/[%_]/u.test(query)
  const phrase = useIndex
    ? 'SELECT f.scene_id AS id FROM phrase_search p JOIN frame f ON f.id=p.rowid WHERE p.phrase LIKE ?'
    : 'SELECT f.scene_id AS id FROM frame f WHERE instr(lower(f.phrase), lower(?)) > 0'
  return {
    sql: `${phrase}
      UNION SELECT s.id FROM scene s JOIN episode e ON e.id=s.episode_id
        WHERE instr(lower(e.title),lower(?))>0 OR instr(lower(e.chapter),lower(?))>0
      UNION SELECT f.scene_id FROM speaker sp JOIN frame f ON f.speaker_id=sp.id WHERE instr(sp.name,?)>0`,
    args: [useIndex ? `%${query}%` : query, query, query, query],
  }
}

export const OFFICIAL_KB_TOOLS = new Set([
  'study_character', 'search_official_episodes', 'inspect_official_episode',
  'trace_official_scene', 'search_official_asset_usage',
])

export function queryOfficialKb(name: string, args: Record<string, unknown>, override?: string): unknown {
  const db = open(override)
  if (name === 'study_character') {
    const q = string(args.name)
    if (!q) return { error: 'Provide a character name.' }
    const speaker = db.prepare('SELECT id,name FROM speaker WHERE instr(name,?)>0 ORDER BY name<>?, length(name),name LIMIT 1').get(q, q)
    if (!speaker) return { found: false }
    const id = speaker.id!
    const stats = (kind: string) => db.prepare(
      'SELECT value AS id,count FROM speaker_stat WHERE speaker_id=? AND kind=? ORDER BY count DESC,value LIMIT 8',
    ).all(id, kind)
    const samples = db.prepare(`
      SELECT e.id AS episodeId, f.line,substr(f.phrase,1,75) AS phrase
      FROM frame f JOIN scene s ON s.id=f.scene_id JOIN episode e ON e.id=s.episode_id
      WHERE f.speaker_id=? AND length(f.phrase) BETWEEN 8 AND 75
      GROUP BY f.phrase ORDER BY e.id,f.line LIMIT 8
    `).all(id)
    return {
      name: speaker.name, lineCount: db.prepare('SELECT count(*) AS n FROM frame WHERE speaker_id=?').get(id)?.n,
      topSpines: stats('spine'), topExprs: stats('expr'), topBodies: stats('body'), samples,
      attribution: 'Motion counts are solo-visible-cast observations, not guaranteed speaker-to-Spine mappings.',
    }
  }

  if (name === 'search_official_episodes') {
    const match = matchingScenes(string(args.query))
    const speaker = string(args.speaker)
    const limit = integer(args.limit, 8, 25)
    const speakerSql = speaker ? `WHERE EXISTS (SELECT 1 FROM scene st JOIN frame ft ON ft.scene_id=st.id
      JOIN speaker p ON p.id=ft.speaker_id WHERE st.episode_id=s.episode_id AND instr(p.name,?)>0)` : ''
    const rows = db.prepare(`
      WITH matched AS MATERIALIZED (${match.sql}), hits AS (
        SELECT s.episode_id,min(s.ordinal) AS ordinal,count(*) AS matchedScenes
        FROM matched m JOIN scene s ON s.id=m.id ${speakerSql} GROUP BY s.episode_id
      )
      SELECT e.id,e.title,e.chapter,e.frame_count AS lines,e.story_type AS storyType,
        hits.matchedScenes,s.id AS sceneId,s.first_line AS startLine,s.background,
        count(*) OVER() AS totalMatches
      FROM hits JOIN episode e ON e.id=hits.episode_id
      JOIN scene s ON s.episode_id=hits.episode_id AND s.ordinal=hits.ordinal
      ORDER BY matchedScenes DESC,e.id LIMIT ?
    `).all(...match.args, ...(speaker ? [speaker] : []), limit)
    return { totalMatches: rows[0]?.totalMatches || 0, episodes: rows.map(({totalMatches: _, ...row}) => row) }
  }

  if (name === 'inspect_official_episode') {
    const episodeId = Number(args.episodeId)
    if (!Number.isSafeInteger(episodeId) || episodeId < 1) return { error: 'Invalid episodeId.' }
    const episode = db.prepare(`SELECT id AS episodeId,title,chapter,frame_count AS totalLines,
      previous_id AS previousEpisodeId,next_id AS nextEpisodeId FROM episode WHERE id=?`).get(episodeId)
    if (!episode) return { found: false, episodeId }
    const start = integer(args.startLine, 1, Number.MAX_SAFE_INTEGER - 60)
    const end = start + integer(args.limit, 25, 60) - 1
    const rows = db.prepare(`
      SELECT f.line,s.id AS sceneId,sp.name AS speaker,f.phrase,f.bg,f.bgm,f.se,f.voice,
        s.background AS activeBackground,f.active_bgm AS activeBgm,
        f.line_order AS "order",f.group_order AS groupOrder,p.motions AS chars
      FROM scene s JOIN frame f ON f.scene_id=s.id
      LEFT JOIN speaker sp ON sp.id=f.speaker_id LEFT JOIN pose p ON p.id=f.pose_id
      WHERE s.episode_id=? AND s.first_line<=? AND s.last_line>=? AND f.line BETWEEN ? AND ? ORDER BY f.line
    `).all(episodeId, end, start, start, end)
    return { ...episode, lines: rows.map(row => ({ ...row, chars: row.chars ? (JSON.parse(String(row.chars)) as Array<Array<number | null>>)
      .map(([slot, spine, pos, expr, body, head, lip]) => ({ slot, spine, pos, expr, body, head, lip })) : [] })) }
  }

  if (name === 'trace_official_scene') {
    const sceneId = Number(args.sceneId)
    if (!Number.isSafeInteger(sceneId) || sceneId < 1) return { error: 'Invalid sceneId.' }
    const scene = db.prepare(`
      SELECT s.id,e.id AS episodeId,e.title,e.chapter,s.background,s.first_line AS startLine,s.last_line AS endLine,
        prev.id AS previousSceneId,nxt.id AS nextSceneId
      FROM scene s JOIN episode e ON e.id=s.episode_id
      LEFT JOIN scene prev ON prev.episode_id=e.id AND prev.ordinal=s.ordinal-1
      LEFT JOIN scene nxt ON nxt.episode_id=e.id AND nxt.ordinal=s.ordinal+1 WHERE s.id=?
    `).get(sceneId)
    if (!scene) return { found: false, sceneId }
    const resources = db.prepare(`
      SELECT u.kind,u.resource_id AS id,u.cue_count AS cueCount,u.active_frames AS activeFrames,
        f.line AS exampleLine,a.in_catalog AS inCatalog
      FROM scene_asset u JOIN frame f ON f.id=u.sample_frame
      JOIN asset a ON a.kind=u.kind AND a.id=u.resource_id WHERE u.scene_id=? ORDER BY f.line,u.kind
    `).all(sceneId)
    const related = db.prepare(`
      SELECT s.id AS sceneId,s.episode_id AS episodeId,e.title,s.first_line AS startLine,s.background,
        count(*) AS sharedResources
      FROM scene_asset a JOIN scene_asset b USING(kind,resource_id)
      JOIN scene s ON s.id=b.scene_id JOIN episode e ON e.id=s.episode_id
      WHERE a.scene_id=? AND s.id<>? GROUP BY s.id
      ORDER BY sharedResources DESC,s.episode_id,s.ordinal LIMIT ?
    `).all(sceneId, sceneId, integer(args.limit, 6, 15))
    return { ...scene, resources, relatedScenes: related }
  }

  if (name === 'search_official_asset_usage') {
    const kind = string(args.kind)
    if (!['background', 'bgm', 'se'].includes(kind)) return { error: 'kind must be background, bgm or se.' }
    const id = string(args.id)
    const bg = string(args.background)
    const bgm = string(args.bgm)
    const query = string(args.query)
    const match = matchingScenes(query)
    const proximity = kind === 'se' && query
      ? '(SELECT min(abs(f.line-cue.line)) FROM frame f WHERE f.scene_id=s.id AND instr(lower(f.phrase),lower(?))>0)'
      : 'NULL'
    const filters = ['u.kind=?']
    const bindings: SQLInputValue[] = [kind]
    if (id) { filters.push('u.resource_id=?'); bindings.push(id) }
    else filters.push('a.in_catalog=1')
    if (bg) { filters.push('s.background=?'); bindings.push(bg) }
    if (bgm) {
      filters.push("EXISTS (SELECT 1 FROM scene_asset link WHERE link.scene_id=s.id AND link.kind='bgm' AND link.resource_id=?)")
      bindings.push(bgm)
    }
    const rows = db.prepare(`
      WITH matched AS MATERIALIZED (${match.sql}), candidates AS MATERIALIZED (
        SELECT u.*,s.episode_id,s.background,a.in_catalog,${proximity} AS distance FROM matched
        JOIN scene s ON s.id=matched.id JOIN scene_asset u ON u.scene_id=s.id
        JOIN asset a ON a.kind=u.kind AND a.id=u.resource_id JOIN frame cue ON cue.id=u.sample_frame
        WHERE ${filters.join(' AND ')}
      ), ranked AS (
        SELECT resource_id,count(*) AS sceneCount,count(DISTINCT episode_id) AS episodeCount,
          sum(cue_count) AS cueCount,sum(active_frames) AS activeFrames,max(in_catalog) AS inCatalog,
          sum(CASE WHEN distance<=2 THEN 1 ELSE 0 END) AS nearKeyword
        FROM candidates GROUP BY resource_id
        ORDER BY nearKeyword DESC,episodeCount DESC,sceneCount DESC,resource_id LIMIT ?
      ), examples AS (
        SELECT c.*,row_number() OVER (PARTITION BY resource_id ORDER BY distance IS NULL,distance,cue_count>0 DESC,episode_id,scene_id) AS rn
        FROM candidates c JOIN ranked USING(resource_id)
      )
      SELECT r.*,ex.scene_id,ex.episode_id,e.title,f.line,ex.background,f.active_bgm,ex.distance,
        sp.name AS speaker,substr(f.phrase,1,120) AS phrase
      FROM ranked r JOIN examples ex ON ex.resource_id=r.resource_id AND ex.rn<=3
      JOIN episode e ON e.id=ex.episode_id JOIN frame f ON f.id=ex.sample_frame
      LEFT JOIN speaker sp ON sp.id=f.speaker_id
      ORDER BY r.nearKeyword DESC,r.episodeCount DESC,r.sceneCount DESC,r.resource_id,ex.rn
    `).all(...match.args, ...(kind === 'se' && query ? [query] : []), ...bindings, integer(args.limit, 6, 15))
    const hits = new Map<SQLInputValue, { id: SQLInputValue; sceneCount: SQLInputValue; episodeCount: SQLInputValue; cueCount: SQLInputValue; activeFrames: SQLInputValue; inCatalog: boolean; examples: unknown[] }>()
    for (const row of rows) {
      const { resource_id: id, sceneCount, episodeCount, cueCount, activeFrames } = row
      const hit = hits.get(id) || { id, sceneCount, episodeCount, cueCount, activeFrames, inCatalog: Boolean(row.inCatalog), examples: [] }
      hit.examples.push({ sceneId: row.scene_id, episodeId: row.episode_id, title: row.title, line: row.line,
        background: row.background, activeBgm: row.active_bgm, distanceToKeyword: row.distance, speaker: row.speaker, phrase: row.phrase })
      hits.set(id, hit)
    }
    return { kind, matches: [...hits.values()] }
  }
  return { error: 'Unknown official story tool.' }
}

/** Bounded local retrieval for API providers without a tool-call loop. */
export function getOfficialReference(prompt: string) {
  const source = prompt.slice(0, 600)
  const stagingTerms = /(排练室|脚步声|演出前|演出后|放学后|休息室|音乐|音效|脚步|敲门|鼓掌|呼吸|寂静|舞台|排练|演出|庆祝|紧张|争吵|告别|和好|回忆|深夜|雨天|公园|后台|教室|屋顶|车站|试镜|失落|感动|喜悦|落幕|footsteps|rehearsal|backstage|stage|applause|rain)/giu
  const quoted = [...source.matchAll(/[「“『"]([^」”』"\n]{2,16})[」”』"]/gu)].map(match => match[1])
  const terms = [...new Set([...quoted, ...Array.from(source.matchAll(stagingTerms), m => m[0])]
    .filter(term => !/^(音乐|音效)$/u.test(term)))].slice(0, 3)
  if (!terms.length) return []
  const references = []
  for (const query of terms) {
    const assets = ['background', 'bgm', 'se'].flatMap(kind => {
      const data = queryOfficialKb('search_official_asset_usage', { kind, query, limit: 1 }) as {
        matches?: { id: string; examples: unknown[] }[]
      }
      return (data.matches || []).map(({ id, examples }) => ({ kind, id, evidence: examples[0] }))
    })
    if (assets.length) references.push({ query, assets })
  }
  return references
}
