export interface ResourceCatalog {
  backgrounds: string[]
  spines: string[]
  stills: string[]
  cards: string[]
  bgms: string[]
  ses: string[]
}

export const ADV_RESOURCE_CDN =
  'https://cdn.jsdelivr.net/gh/wds-sirius/Adv-Resource@main'

let cachedCatalog: Promise<ResourceCatalog> | null = null

export function loadResourceCatalog(): Promise<ResourceCatalog> {
  if (cachedCatalog) return cachedCatalog
  cachedCatalog = (async () => {
    const empty: ResourceCatalog = {
      backgrounds: [],
      spines: [],
      stills: [],
      cards: [],
      bgms: [],
      ses: [],
    }
    try {
      const resp = await fetch('./adv-resource-tree.json')
      if (!resp.ok) return empty
      const data = (await resp.json()) as { tree?: Array<{ path: string }> }
      const tree = data.tree ?? []

      const bgSet = new Set<string>()
      const spineSet = new Set<string>()
      const stillSet = new Set<string>()
      const cardSet = new Set<string>()
      const bgmSet = new Set<string>()
      const seSet = new Set<string>()

      for (const item of tree) {
        const p = item.path
        if (p.startsWith('background/') && p.endsWith('.png')) {
          bgSet.add(p.slice('background/'.length, -'.png'.length))
        } else if (p.startsWith('spine/') && p.endsWith('.skel')) {
          spineSet.add(p.slice('spine/'.length, -'.skel'.length))
        } else if (p.startsWith('still/') && p.endsWith('.png')) {
          stillSet.add(p.slice('still/'.length, -'.png'.length))
        } else if (p.startsWith('card/') && p.endsWith('.png')) {
          cardSet.add(p.slice('card/'.length, -'.png'.length))
        } else if (p.startsWith('bgm/') && p.endsWith('.mp3')) {
          bgmSet.add(p.slice('bgm/'.length, -'.mp3'.length))
        } else if (p.startsWith('se/') && p.endsWith('.mp3')) {
          seSet.add(p.slice('se/'.length, -'.mp3'.length))
        }
      }

      const sortIds = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return {
        backgrounds: sortIds(bgSet),
        spines: sortIds(spineSet),
        stills: sortIds(stillSet),
        cards: sortIds(cardSet),
        bgms: sortIds(bgmSet),
        ses: sortIds(seSet),
      }
    } catch {
      return empty
    }
  })()
  return cachedCatalog
}
