import { computed, ref } from 'vue'

export type Locale = 'zh-CN' | 'en'

const LOCALE_STORAGE_KEY = 'sirius-story-maker.locale.v1'

function detectInitialLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
      if (saved === 'en' || saved === 'zh-CN') return saved
    } catch {
      // ignore storage errors
    }
    const nav = (window.navigator?.language || '').toLowerCase()
    if (nav && !nav.startsWith('zh')) return 'en'
  }
  return 'zh-CN'
}

export const locale = ref<Locale>(detectInitialLocale())
export const isEnglish = computed(() => locale.value === 'en')

function syncDocumentLang(loc: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = loc
  }
}

syncDocumentLang(locale.value)

export function setLocale(next: Locale) {
  locale.value = next
  syncDocumentLang(next)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }
}

export function toggleLocale() {
  setLocale(locale.value === 'en' ? 'zh-CN' : 'en')
}

export function tr(zh: string, en: string): string {
  return locale.value === 'en' ? en : zh
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_STORAGE_KEY && (e.newValue === 'en' || e.newValue === 'zh-CN')) {
      locale.value = e.newValue
      syncDocumentLang(e.newValue)
    }
  })
}

export function useI18n() {
  return { locale, isEnglish, setLocale, toggleLocale, tr }
}
