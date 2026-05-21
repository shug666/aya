import { action, computed, makeObservable, observable, runInAction } from 'mobx'
import isUndef from 'licia/isUndef'
import isArr from 'licia/isArr'
import filter from 'licia/filter'
import map from 'licia/map'
import contain from 'licia/contain'

export interface PanelConfig {
  id: string
  enabled: boolean
  order: number
}

export const ALL_PANELS: string[] = [
  'overview',
  'file',
  'application',
  'process',
  'performance',
  'shell',
  'layout',
  'screenshot',
  'logcat',
  'webview',
  'perfetto',
  'gnirehtet',
]

function getDefaultPanels(): PanelConfig[] {
  return map(ALL_PANELS, (id, idx) => ({
    id,
    enabled: true,
    order: idx,
  }))
}

function validatePanels(panels: any): panels is PanelConfig[] {
  if (!isArr(panels) || panels.length === 0) {
    return false
  }
  for (const p of panels) {
    if (!p || typeof p.id !== 'string' || typeof p.enabled !== 'boolean' || typeof p.order !== 'number') {
      return false
    }
  }
  return true
}

function mergePanels(saved: PanelConfig[]): PanelConfig[] {
  const savedIds = map(saved, (p) => p.id)
  const merged = filter(saved, (p) => contain(ALL_PANELS, p.id))

  let maxOrder = 0
  for (const p of merged) {
    if (p.order > maxOrder) {
      maxOrder = p.order
    }
  }

  for (const id of ALL_PANELS) {
    if (!contain(savedIds, id)) {
      maxOrder++
      merged.push({ id, enabled: true, order: maxOrder })
    }
  }

  return merged
}

export class Settings {
  language = 'en-US'
  theme = 'light'
  adbPath = ''
  killAdbWhenExit = false
  useNativeTitlebar = false
  enabledPanels: PanelConfig[] = getDefaultPanels()
  constructor() {
    makeObservable(this, {
      language: observable,
      theme: observable,
      adbPath: observable,
      killAdbWhenExit: observable,
      useNativeTitlebar: observable,
      enabledPanels: observable,
      set: action,
      visiblePanels: computed,
    })

    this.init()
  }
  get visiblePanels(): PanelConfig[] {
    const enabled = filter(this.enabledPanels, (p) => p.enabled)
    return enabled.sort((a, b) => a.order - b.order)
  }
  async init() {
    const names = [
      'language',
      'theme',
      'adbPath',
      'killAdbWhenExit',
      'useNativeTitlebar',
    ]
    for (let i = 0, len = names.length; i < len; i++) {
      const name = names[i]
      const val = await main.getSettingsStore(name)
      if (!isUndef(val)) {
        runInAction(() => (this[name] = val))
      }
    }

    const savedPanels = await main.getSettingsStore('enabledPanels')
    runInAction(() => {
      if (validatePanels(savedPanels)) {
        this.enabledPanels = mergePanels(savedPanels)
      } else {
        this.enabledPanels = getDefaultPanels()
      }
    })
  }
  async set(name: string, val: any) {
    runInAction(() => {
      this[name] = val
    })
    await main.setSettingsStore(name, val)
  }
}
