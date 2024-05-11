import msg from '../../public/_locales/en/messages.json'

export function transify(key: string, substitutions?: string | string[]) {
  if (chrome?.i18n) return chrome.i18n.getMessage(key, substitutions)

  // @ts-ignore
  if (msg && msg[key]) {
    // @ts-ignore
    return msg[key]['message'] || key
  }

  return key
}

export function getCurrentLocale() {
  if (chrome?.i18n) return chrome.i18n.getUILanguage()

  return 'en-US'
}