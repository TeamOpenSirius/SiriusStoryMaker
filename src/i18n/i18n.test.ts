import { describe, expect, it } from 'vitest'
import { locale, setLocale, toggleLocale, tr } from './index'

describe('i18n', () => {
  it('switches between zh-CN and en and translates strings reactively', () => {
    setLocale('zh-CN')
    expect(locale.value).toBe('zh-CN')
    expect(tr('保存', 'Save')).toBe('保存')

    setLocale('en')
    expect(locale.value).toBe('en')
    expect(tr('保存', 'Save')).toBe('Save')

    toggleLocale()
    expect(locale.value).toBe('zh-CN')
  })
})
