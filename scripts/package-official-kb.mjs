import { access, copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = fileURLToPath(new URL('../data/official-story-kb.sqlite', import.meta.url))
const notice = fileURLToPath(new URL('../data/official-story-kb.NOTICE', import.meta.url))
const destination = fileURLToPath(new URL('../dist-electron/knowledge/', import.meta.url))

try {
  await access(source)
} catch {
  console.log('[build:kb] Optional local official-story-kb.sqlite not found; skipping.')
  process.exit(0)
}

await mkdir(destination, { recursive: true })
await copyFile(source, path.join(destination, 'official-story-kb.sqlite'))
await copyFile(notice, path.join(destination, 'official-story-kb.NOTICE')).catch(() => {})
