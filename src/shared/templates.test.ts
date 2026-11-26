import { describe, expect, it } from 'vitest'
import { compileDsl, CURRENT_DSL_VERSION } from '../dsl/compiler'
import { buildTemplateDsl, PROJECT_TEMPLATES } from './templates'

describe('project templates & dsl version', () => {
  it('compiles every built-in template cleanly with @dsl header and custom title', () => {
    for (const tpl of PROJECT_TEMPLATES) {
      const dsl = buildTemplateDsl(tpl.id, 'My Custom Story')
      expect(dsl.startsWith(`@dsl ${CURRENT_DSL_VERSION}`)).toBe(true)
      const compiled = compileDsl(dsl)
      expect(compiled.dslVersion).toBe(CURRENT_DSL_VERSION)
      expect(compiled.episode.Title).toBe('My Custom Story')
      expect(compiled.episode.EpisodeDetail.length).toBeGreaterThan(0)
      expect(compiled.diagnostics).toEqual([])
    }
  })

  it('defaults dslVersion to 1 when omitted and warns on newer DSL versions', () => {
    const legacy = compileDsl('@title Legacy\n: Hi\n')
    expect(legacy.dslVersion).toBe(1)
    expect(legacy.diagnostics).toEqual([])

    const future = compileDsl('@dsl 99\n@title Future\n: Hi\n')
    expect(future.dslVersion).toBe(99)
    expect(future.diagnostics.length).toBe(1)
    expect(future.diagnostics[0].message).toContain('DSL v99')
  })
})
