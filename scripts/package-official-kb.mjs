import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = fileURLToPath(new URL('../data/official-story-kb.sqlite', import.meta.url))
const destination = fileURLToPath(new URL('../dist-electron/knowledge/', import.meta.url))
await mkdir(destination, { recursive: true })
await copyFile(source, path.join(destination, 'official-story-kb.sqlite'))
await copyFile(new URL('../data/official-story-kb.NOTICE', import.meta.url), path.join(destination, 'official-story-kb.NOTICE'))
