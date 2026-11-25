import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PROJECT_ASSET_KINDS, type ProjectAsset, type ProjectAssetKind, type ProjectManifest } from '../src/shared/project'
import { createZipBuffer } from './zip'

const extensions: Record<ProjectAssetKind, string[]> = {
  background: ['.png', '.jpg', '.jpeg', '.webp'],
  bgm: ['.mp3', '.ogg', '.wav'],
  se: ['.mp3', '.ogg', '.wav'],
  voice: ['.mp3', '.ogg', '.wav'],
}

export function projectPath(root: string, relative: string): string {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') ||
      relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('项目索引包含无效的相对路径')
  }
  return path.join(root, relative)
}

export async function writeAtomic(filePath: string, data: string | Buffer) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export interface Project {
  root: string
  filePath: string
  manifest: ProjectManifest
  content: string
}

export async function createProject(root: string, title: string, content: string): Promise<Project> {
  const filePath = path.join(root, 'project.sav')
  const manifest: ProjectManifest = {
    format: 'sirius-adv-project', version: 1, title: title.trim() || path.basename(root),
    story: 'story.dsl', assetsDirectory: 'assets', aiCache: 'ai-cache', assets: [],
  }
  const created: string[] = []
  try {
    // Reserve all managed paths without overwriting anything already in the selected directory.
    const handle = await fs.open(filePath, 'wx')
    created.push(filePath)
    await handle.close()
    for (const name of [manifest.assetsDirectory, manifest.aiCache]) {
      const target = projectPath(root, name)
      await fs.mkdir(target)
      created.push(target)
    }
    const storyPath = projectPath(root, manifest.story)
    const story = await fs.open(storyPath, 'wx')
    created.push(storyPath)
    try { await story.writeFile(content) } finally { await story.close() }
    await writeAtomic(filePath, JSON.stringify(manifest, null, 2))
  } catch (err) {
    for (const file of created.reverse()) {
      const entry = await fs.lstat(file).catch(() => null)
      if (entry?.isDirectory()) await fs.rmdir(file).catch(() => {})
      else await fs.rm(file, { force: true }).catch(() => {})
    }
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('所选文件夹已有同名项目文件，请选择其他文件夹。')
    throw err
  }
  return { root, filePath, manifest, content }
}

export async function openProject(filePath: string): Promise<Project> {
  if (path.extname(filePath).toLowerCase() !== '.sav') throw new Error('请选择 SiriusAdvStudio 的 .sav 索引')
  filePath = path.resolve(filePath)
  const root = path.dirname(filePath)
  const manifest = JSON.parse(await fs.readFile(filePath, 'utf8')) as ProjectManifest
  if (manifest?.format !== 'sirius-adv-project' || manifest.version !== 1 ||
      typeof manifest.title !== 'string' || !Array.isArray(manifest.assets)) {
    throw new Error('不是有效的 SiriusAdvStudio 项目索引')
  }
  const story = projectPath(root, manifest.story)
  const assetsRoot = projectPath(root, manifest.assetsDirectory)
  const cache = projectPath(root, manifest.aiCache)
  if (new Set([story, assetsRoot, cache, filePath]).size !== 4) throw new Error('项目路径冲突')
  const ids = new Set<string>()
  for (const asset of manifest.assets) {
    if (!asset || !PROJECT_ASSET_KINDS.includes(asset.kind) || !/^asset_[\w-]+$/.test(asset.id) ||
        typeof asset.originalName !== 'string' || typeof asset.file !== 'string' ||
        !extensions[asset.kind].some((ext) => asset.file === `${manifest.assetsDirectory}/${asset.kind}/${asset.id}${ext}`) ||
        ids.has(`${asset.kind}/${asset.id}`)) throw new Error('项目素材索引无效或重复')
    ids.add(`${asset.kind}/${asset.id}`)
  }
  return { root, filePath, manifest, content: await fs.readFile(story, 'utf8') }
}

export async function addProjectAsset(project: Project, kind: ProjectAssetKind, source: string): Promise<ProjectAsset> {
  const ext = path.extname(source).toLowerCase()
  if (!extensions[kind]?.includes(ext)) throw new Error('不支持的素材格式')
  const originalName = path.basename(source)
  const stem = path.basename(source, path.extname(source)).replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  const id = `asset_${stem ? stem + '_' : ''}${randomUUID().slice(0, 8)}`
  const file = `${project.manifest.assetsDirectory}/${kind}/${id}${ext}`
  const asset = { id, kind, file, originalName }
  const target = projectPath(project.root, file)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target, 1 /* COPYFILE_EXCL */)
  try {
    const manifest = { ...project.manifest, assets: [...project.manifest.assets, asset] }
    await writeAtomic(project.filePath, JSON.stringify(manifest, null, 2))
    project.manifest = manifest
  } catch (err) {
    await fs.rm(target, { force: true })
    throw err
  }
  return asset
}

export async function buildProjectPackage(project: Project, payload: {
  json: string; storyDsl?: string; title?: string; chapter?: string
}) {
  const assets = project.manifest.assets.map((asset) => ({
    ...asset,
    file: `assets/${asset.kind}/${path.basename(asset.file)}`,
  }))
  const manifest = {
    format: 'sirius-adv-package', version: 1, title: payload.title || project.manifest.title,
    chapter: payload.chapter || '', episodeFile: 'episode.json',
    ...(payload.storyDsl == null ? {} : { storyFile: 'story.dsl' }),
    assets,
  }
  const entries = await Promise.all(project.manifest.assets.map(async (asset, i) => ({
    name: assets[i].file,
    data: await fs.readFile(projectPath(project.root, asset.file)).catch(() => {
      throw new Error(`缺少项目素材 ${asset.originalName}（${asset.file}）`)
    }),
  })))
  return createZipBuffer([
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'episode.json', data: payload.json },
    ...(payload.storyDsl == null ? [] : [{ name: 'story.dsl', data: payload.storyDsl }]),
    ...entries,
  ])
}
