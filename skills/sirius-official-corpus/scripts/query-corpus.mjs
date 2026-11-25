#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const KB_PATH = process.env.SIRIUS_KB_PATH || path.join(REPO_ROOT, 'data', 'official-story-kb.json')
const EPISODE_DIR = process.env.SIRIUS_EPISODE_DIR

async function loadKb() {
  const raw = await fs.readFile(KB_PATH, 'utf-8')
  return JSON.parse(raw)
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  node query-corpus.mjs character <name>
  node query-corpus.mjs search <keyword> [--speaker <name>] [--limit 8]
  node query-corpus.mjs inspect <episodeId> [--start 1] [--limit 25]`)
    return
  }

  const kb = await loadKb()

  if (cmd === 'character') {
    const q = (rest[0] || '').trim()
    const match =
      kb.characters.find((c) => c.name === q) ||
      kb.characters.find((c) => c.name.includes(q))
    if (!match) {
      console.log(JSON.stringify({ found: false, availableTop: kb.characters.slice(0, 20).map((c) => c.name) }, null, 2))
      return
    }
    console.log(JSON.stringify(match, null, 2))
    return
  }

  if (cmd === 'search') {
    const query = (rest[0] || '').toLowerCase()
    const speakerIdx = rest.indexOf('--speaker')
    const speaker = speakerIdx !== -1 ? rest[speakerIdx + 1] : ''
    const limitIdx = rest.indexOf('--limit')
    const limit = limitIdx !== -1 ? Number(rest[limitIdx + 1]) || 8 : 8

    const hits = kb.episodes
      .filter((ep) => {
        if (speaker && !ep.speakers.some((s) => s.includes(speaker))) return false
        if (!query) return true
        return (
          (ep.title || '').toLowerCase().includes(query) ||
          (ep.chapter || '').toLowerCase().includes(query) ||
          (ep.preview || '').toLowerCase().includes(query) ||
          ep.speakers.some((s) => s.toLowerCase().includes(query))
        )
      })
      .slice(0, limit)
    console.log(JSON.stringify({ totalMatches: hits.length, episodes: hits }, null, 2))
    return
  }

  if (cmd === 'inspect') {
    const epId = rest[0]
    const startIdx = rest.indexOf('--start')
    const start = Math.max(1, startIdx !== -1 ? Number(rest[startIdx + 1]) || 1 : 1)
    const limitIdx = rest.indexOf('--limit')
    const limit = Math.min(60, limitIdx !== -1 ? Number(rest[limitIdx + 1]) || 25 : 25)
    const srcDir = EPISODE_DIR || kb.meta?.sourceDir
    if (!srcDir) throw new Error('Set SIRIUS_EPISODE_DIR or build the local corpus first.')
    if (!/^\d+$/.test(epId || '')) throw new Error('Episode ID must be numeric.')
    const raw = await fs.readFile(path.join(srcDir, `${epId}.json`), 'utf-8')
    const ep = JSON.parse(raw)
    const slice = (ep.EpisodeDetail || []).slice(start - 1, start - 1 + limit).map((d, i) => ({
      line: start + i,
      speaker: d.SpeakerName || '',
      phrase: (d.Phrase || '').replace(/\/n/g, '\n'),
      bg: d.BackgroundImageFileName || undefined,
      bgm: d.BgmFileName || undefined,
      se: d.SeFileName || undefined,
      voice: d.VoiceFileName || undefined,
      chars: (d.CharacterMotions || []).map((m) => ({
        slot: m.slotNumber,
        spine: m.SpineId,
        pos: m.CharacterPosition,
        expr: m.FacialExpressionMasterId,
        body: m.BodyMotionMasterId,
      })),
    }))
    console.log(
      JSON.stringify(
        {
          episodeId: ep.EpisodeId,
          chapter: ep.Chapter,
          title: ep.Title,
          totalLines: (ep.EpisodeDetail || []).length,
          lines: slice,
        },
        null,
        2,
      ),
    )
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
