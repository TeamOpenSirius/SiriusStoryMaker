import defaultTutorialDsl from '../templates/default-tutorial.dsl?raw'
import rehearsalSampleDsl from '../templates/rehearsal-sample.dsl?raw'
import { DSL_SPEC_VERSION } from './version'

export type ProjectTemplateId = 'blank' | 'tutorial' | 'rehearsal'

export interface ProjectTemplate {
  id: ProjectTemplateId
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  badgeZh?: string
  badgeEn?: string
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    nameZh: '空白项目',
    nameEn: 'Blank Project',
    descZh: '仅含一个开场场景，适合从零开始自由创作',
    descEn: 'Single empty opening scene to start from scratch',
  },
  {
    id: 'tutorial',
    nameZh: '新手引导 · 开演前十分钟',
    nameEn: 'Tutorial · 10 Min Before Curtain',
    descZh: '完整互动教学剧本，涵盖分镜、分支、音效、AI 导演与导出',
    descEn: 'Interactive guided story covering scenes, branches, audio, AI & export',
    badgeZh: '推荐',
    badgeEn: 'Recommended',
  },
  {
    id: 'rehearsal',
    nameZh: '精简示例 · 排练室',
    nameEn: 'Quick Sample · Rehearsal',
    descZh: '3 场景轻量范例，包含背景、角色动作、回忆滤镜与 BGM',
    descEn: 'Compact 3-scene sample with background, Spine motions, sepia & BGM',
  },
]

export const SAMPLE_DSL = rehearsalSampleDsl

export function newStoryDsl(title: string) {
  return `@dsl ${DSL_SPEC_VERSION}\n@title ${title.replace(/[\r\n]+/g, ' ').trim() || '新建剧集'}\n@chapter 第一章\n@episode 1001\n\n@scene start title="开场" x=40 y=40\n: 从这里开始创作你的剧情。\n`
}

export function buildTemplateDsl(templateId: ProjectTemplateId, title: string): string {
  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim()
  if (templateId === 'blank') return newStoryDsl(cleanTitle)
  const source = templateId === 'tutorial' ? defaultTutorialDsl : rehearsalSampleDsl
  if (!cleanTitle) return source
  return source.replace(/^@title [^\r\n]*/m, () => `@title ${cleanTitle}`)
}
