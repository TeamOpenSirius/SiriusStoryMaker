import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = process.env.SIRIUS_EPISODE_DIR
const output = path.resolve(process.env.SIRIUS_KB_PATH || path.join(root, 'data/official-story-kb.sqlite'))
const text = v => typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
const id = v => v == null || v === '' || !Number.isSafeInteger(Number(v)) ? null : Number(v)
const cue = v => text(v) || null

async function build() {
  if (!source) throw new Error('Set SIRIUS_EPISODE_DIR to a directory of WDS ADV episode JSON files.')
  const files = (await fs.readdir(source)).filter(f => f.endsWith('.json')).sort()
  const catalog = new Set()
  const tree = JSON.parse(await fs.readFile(path.join(root, 'public/adv-resource-tree.json'), 'utf8')).tree
  for (const { path: resource } of tree) {
    const match = /^(background|bgm|se)\/([^/]+)\.(png|mp3)$/u.exec(resource)
    if (match) catalog.add(`${match[1]}/${match[2]}`)
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  const temporary = `${output}.${randomUUID()}.tmp`
  const db = new DatabaseSync(temporary)
  let closed = false
  try {
    db.exec(await fs.readFile(new URL('./official-kb-schema.sql', import.meta.url), 'utf8'))
    const episode = db.prepare('INSERT INTO episode VALUES (?, ?, ?, ?, ?, ?, ?)')
    const scene = db.prepare('INSERT INTO scene VALUES (?, ?, ?, ?, ?, ?)')
    const endScene = db.prepare('UPDATE scene SET last_line = ? WHERE id = ?')
    const frame = db.prepare('INSERT INTO frame VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const addSpeaker = db.prepare('INSERT INTO speaker(name) VALUES (?)')
    const addPose = db.prepare('INSERT INTO pose(motions) VALUES (?)')
    const addAsset = db.prepare('INSERT OR IGNORE INTO asset VALUES (?, ?, ?)')
    const addUse = db.prepare('INSERT INTO scene_asset VALUES (?, ?, ?, ?, ?, ?)')
    const addStat = db.prepare('INSERT INTO speaker_stat VALUES (?, ?, ?, 1) ON CONFLICT DO UPDATE SET count=count+1')
    const speakers = new Map(), poses = new Map(), seen = new Set()
    let sceneId = 0, frameId = 0, skipped = 0
    function intern(map, insert, value) {
      if (!map.has(value)) map.set(value, Number(insert.run(value).lastInsertRowid))
      return map.get(value)
    }
    db.exec('BEGIN')
    for (const file of files) {
      let ep
      try { ep = JSON.parse((await fs.readFile(path.join(source, file), 'utf8')).replace(/^\uFEFF/u, '')) }
      catch (err) {
        if (!(err instanceof SyntaxError)) throw err
        skipped++
        continue
      }
      const episodeId = id(ep?.EpisodeId)
      if (!episodeId || !Array.isArray(ep?.EpisodeDetail) || !ep.EpisodeDetail.length || seen.has(episodeId)) {
        skipped++
        continue
      }
      seen.add(episodeId)
      const lines = ep.EpisodeDetail
      episode.run(episodeId, text(ep.Title), text(ep.Chapter), id(ep.StoryType), id(ep.Prev), id(ep.Next), lines.length)
      let ordinal = 0, bg = null, activeBgm = null
      const uses = new Map()
      function finishScene(lastLine) {
        endScene.run(lastLine, sceneId)
        for (const u of uses.values()) {
          addAsset.run(u.kind, u.resource, Number(catalog.has(`${u.kind}/${u.resource}`)))
          addUse.run(sceneId, u.kind, u.resource, u.sample, u.count, u.frames)
        }
        uses.clear()
      }
      for (const [offset, detail] of lines.entries()) {
        const d = detail || {}
        const line = offset + 1
        const bgChange = cue(d.BackgroundImageFileName), bgm = cue(d.BgmFileName), se = cue(d.SeFileName)
        if (!ordinal || (bgChange && bgChange !== bg)) {
          if (ordinal) finishScene(line - 1)
          bg = bgChange
          scene.run(++sceneId, episodeId, ++ordinal, line, line, bg)
        }
        if (bgm) activeBgm = bgm === '999' ? null : bgm
        const speakerName = text(d.SpeakerName)
        const speakerId = speakerName ? intern(speakers, addSpeaker, speakerName) : null
        const cast = (Array.isArray(d.CharacterMotions) ? d.CharacterMotions : []).filter(Boolean).map(m => ({
          slot: id(m.slotNumber), spine: id(m.SpineId), pos: id(m.CharacterPosition),
          expr: id(m.FacialExpressionMasterId), body: id(m.BodyMotionMasterId),
          head: id(m.HeadMotionMasterId), lip: id(m.LipSyncMasterId),
        }))
        const poseId = cast.length ? intern(poses, addPose, JSON.stringify(cast.map(m => [m.slot,m.spine,m.pos,m.expr,m.body,m.head,m.lip]))) : null
        const phrase = text(d.Phrase).replace(/\r\n?|[\\/]n/gu, '\n')
        frame.run(++frameId, sceneId, line, speakerId, phrase, bgChange, bgm, se, cue(d.VoiceFileName),
          activeBgm, poseId, id(d.Order), id(d.GroupOrder))
        if (speakerId && cast.length === 1 && cast[0].spine > 0) {
          for (const k of ['spine', 'expr', 'body']) if (cast[0][k] > 0) addStat.run(speakerId, k, cast[0][k])
        }
        for (const [kind, resource, triggered] of [
          ['background', bg, Boolean(bgChange)], ['bgm', activeBgm, Boolean(bgm)], ['se', se, Boolean(se)],
        ]) {
          if (!resource) continue
          const key = `${kind}/${resource}`
          const u = uses.get(key) || { kind, resource, sample: frameId, count: 0, frames: 0 }
          if (triggered && !u.count) u.sample = frameId
          u.count += Number(triggered)
          u.frames++
          uses.set(key, u)
        }
      }
      finishScene(lines.length)
    }
    if (!seen.size) throw new Error('No valid WDS episodes found. Existing database was not changed.')
    const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)')
    for (const [key, value] of Object.entries({
      episodes: seen.size, scenes: sceneId, frames: frameId, skipped,
      source: process.env.SIRIUS_KB_SOURCE_LABEL || 'WDS episode exports',
      ...(process.env.SIRIUS_KB_SOURCE_REVISION ? { sourceRevision: process.env.SIRIUS_KB_SOURCE_REVISION } : {}),
    })) meta.run(key, String(value))
    db.exec(`
      CREATE INDEX scene_background ON scene(background);
      CREATE INDEX frame_speaker ON frame(speaker_id, scene_id);
      CREATE INDEX scene_asset_reverse ON scene_asset(kind,resource_id,scene_id);
      INSERT INTO phrase_search(phrase_search) VALUES('rebuild');
      INSERT INTO phrase_search(phrase_search) VALUES('optimize');
      COMMIT;
      ANALYZE;
      VACUUM;
    `)
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
      throw new Error('SQLite integrity validation failed.')
    }
    db.close()
    closed = true
    await fs.rename(temporary, output)
    console.log(`Built ${seen.size} episodes, ${sceneId} scenes, ${frameId} frames at ${output} (${(await fs.stat(output)).size} bytes, skipped ${skipped})`)
  } finally {
    if (!closed) db.close()
    await fs.rm(temporary, { force: true })
  }
}
await build()
