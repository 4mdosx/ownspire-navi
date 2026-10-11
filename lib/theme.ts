export const THEME_STORAGE_KEY = 'ownspire-navi-theme'
export type ColorTheme = 'light' | 'dark'

const listeners = new Set<() => void>()

export function getColorTheme(): ColorTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setColorTheme(theme: ColorTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore quota / private mode */
  }
  listeners.forEach((listener) => listener())
}

export function toggleColorTheme() {
  setColorTheme(getColorTheme() === 'dark' ? 'light' : 'dark')
}

export function subscribeColorTheme(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
