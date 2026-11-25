export const PROJECT_ASSET_KINDS = ['background', 'bgm', 'se', 'voice'] as const
export type ProjectAssetKind = (typeof PROJECT_ASSET_KINDS)[number]

export interface ProjectAsset {
  id: string
  kind: ProjectAssetKind
  file: string
  originalName: string
}

export interface ProjectManifest {
  format: 'sirius-adv-project'
  version: 1
  title: string
  story: string
  assetsDirectory: string
  aiCache: string
  assets: ProjectAsset[]
}

export interface RecentProject {
  filePath: string
  title: string
  updatedAt: number
}

export interface OpenProject {
  filePath: string
  manifest: ProjectManifest
  content: string
  assetBase: string
}
