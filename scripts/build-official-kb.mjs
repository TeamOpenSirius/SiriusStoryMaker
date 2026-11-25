import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_DIR = process.env.SIRIUS_EPISODE_DIR ? path.resolve(process.env.SIRIUS_EPISODE_DIR) : null
const OUT_FILE = process.env.SIRIUS_KB_PATH ? path.resolve(process.env.SIRIUS_KB_PATH)
  : fileURLToPath(new URL('../data/official-story-kb.json', import.meta.url))

function bump(map, key) {
  if (key === undefined || key === null || key === '') return
  const k = String(key)
  map.set(k, (map.get(k) || 0) + 1)
}

function topEntries(map, limit = 10) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }))
}

async function main() {
  if (!SOURCE_DIR) throw new Error('Set SIRIUS_EPISODE_DIR to a local directory of episode JSON files.')
  const files = (await fs.readdir(SOURCE_DIR)).filter((f) => f.endsWith('.json')).sort()
  const episodes = []
  const charStats = new Map()
  const bgContexts = new Map()
  const bgmContexts = new Map()
  let totalLines = 0

  for (const file of files) {
    let ep
    try {
      const raw = await fs.readFile(path.join(SOURCE_DIR, file), 'utf-8')
      ep = JSON.parse(raw)
    } catch {
      continue
    }
    const details = Array.isArray(ep.EpisodeDetail) ? ep.EpisodeDetail : []
    if (details.length === 0) continue

    const speakers = new Set()
    const bgs = new Set()
    const bgms = new Set()
    const ses = new Set()
    const previewLines = []

    for (const d of details) {
      totalLines++
      const speaker = (d.SpeakerName || '').trim()
      const phrase = (d.Phrase || '').replace(/\/n/g, ' ').trim()
      if (speaker) speakers.add(speaker)
      if (d.BackgroundImageFileName) bgs.add(String(d.BackgroundImageFileName))
      if (d.BgmFileName && d.BgmFileName !== '999') bgms.add(String(d.BgmFileName))
      if (d.SeFileName) ses.add(String(d.SeFileName))

      if (phrase && previewLines.length < 2) {
        previewLines.push(speaker ? `${speaker}: ${phrase.slice(0, 48)}` : phrase.slice(0, 48))
      }

      if (speaker && speaker !== '？？？') {
        let cs = charStats.get(speaker)
        if (!cs) {
          cs = {
            name: speaker,
            lineCount: 0,
            spines: new Map(),
            exprs: new Map(),
            bodies: new Map(),
            samples: [],
          }
          charStats.set(speaker, cs)
        }
        cs.lineCount++
        if (phrase && phrase.length >= 8 && phrase.length <= 70 && cs.samples.length < 10) {
          if (!cs.samples.includes(phrase)) cs.samples.push(phrase)
        }
        if (Array.isArray(d.CharacterMotions)) {
          for (const m of d.CharacterMotions) {
            if (m.SpineId) bump(cs.spines, m.SpineId)
            if (m.FacialExpressionMasterId) bump(cs.exprs, m.FacialExpressionMasterId)
            if (m.BodyMotionMasterId) bump(cs.bodies, m.BodyMotionMasterId)
          }
        }
      }
    }

    const epTitle = ep.Title || ''
    const epChapter = ep.Chapter || ''
    for (const bg of bgs) {
      let arr = bgContexts.get(bg)
      if (!arr) {
        arr = []
        bgContexts.set(bg, arr)
      }
      if (arr.length < 6 && (epChapter || epTitle)) {
        arr.push(`${epChapter ? `${epChapter}·` : ''}${epTitle}`.slice(0, 40))
      }
    }
    for (const bgm of bgms) {
      let arr = bgmContexts.get(bgm)
      if (!arr) {
        arr = []
        bgmContexts.set(bgm, arr)
      }
      if (arr.length < 6 && (epChapter || epTitle)) {
        arr.push(`${epChapter ? `${epChapter}·` : ''}${epTitle}`.slice(0, 40))
      }
    }

    episodes.push({
      id: ep.EpisodeId,
      storyType: ep.StoryType ?? 0,
      chapter: epChapter,
      title: epTitle,
      lines: details.length,
      speakers: Array.from(speakers).slice(0, 8),
      bgs: Array.from(bgs).slice(0, 8),
      bgms: Array.from(bgms).slice(0, 6),
      ses: Array.from(ses).slice(0, 8),
      preview: previewLines.join(' | '),
    })
  }

  const characters = Array.from(charStats.values())
    .filter((c) => c.lineCount >= 15)
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 80)
    .map((c) => ({
      name: c.name,
      lineCount: c.lineCount,
      topSpines: topEntries(c.spines, 8),
      topExprs: topEntries(c.exprs, 8),
      topBodies: topEntries(c.bodies, 6),
      samples: c.samples,
    }))

  const kb = {
    meta: {
      sourceDir: SOURCE_DIR,
      episodeCount: episodes.length,
      totalLines,
      characterCount: characters.length,
      builtAt: new Date().toISOString(),
    },
    characters,
    bgUsage: Object.fromEntries(bgContexts.entries()),
    bgmUsage: Object.fromEntries(bgmContexts.entries()),
    episodes,
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true })
  await fs.writeFile(OUT_FILE, JSON.stringify(kb), 'utf-8')
  const stat = await fs.stat(OUT_FILE)
  console.log(
    `Built KB: ${episodes.length} episodes, ${totalLines} lines, ${characters.length} characters -> ${OUT_FILE} (${(stat.size / 1024).toFixed(1)} KB)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
