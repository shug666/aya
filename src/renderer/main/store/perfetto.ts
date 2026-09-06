import { action, makeObservable, observable, runInAction } from 'mobx'
import isUndef from 'licia/isUndef'

export type PerfettoStatus =
  'idle' | 'recording' | 'pulling' | 'completed' | 'error'

export type PerfettoTraceTemplate =
  | 'DEFAULT'
  | 'SYSTEM_OVERVIEW'
  | 'APP_PERFORMANCE'
  | 'GFX_PIPELINE'
  | 'INPUT_LATENCY'
  | 'MEMORY_PROFILE'
  | 'CUSTOM'

export const TRACE_TEMPLATES: PerfettoTraceTemplate[] = [
  'DEFAULT',
  'SYSTEM_OVERVIEW',
  'APP_PERFORMANCE',
  'GFX_PIPELINE',
  'INPUT_LATENCY',
  'MEMORY_PROFILE',
  'CUSTOM',
]

const DEFAULT_EVENTS = [
  'sched',
  'freq',
  'idle',
  'am',
  'wm',
  'gfx',
  'view',
  'binder_driver',
  'binder_lock',
  'hal',
  'dalvik',
  'camera',
  'input',
  'res',
  'memory',
  'aidl',
]

// Preset atrace category bundles per trace template (mirrors the
// PerfettoTraceTemplate.defaultProbes() concept from AndroidPerformanceStudio).
export const TRACE_TEMPLATE_DEFAULT_EVENTS: Record<
  Exclude<PerfettoTraceTemplate, 'CUSTOM'>,
  string[]
> = {
  DEFAULT: [...DEFAULT_EVENTS],
  SYSTEM_OVERVIEW: [
    'sched',
    'freq',
    'idle',
    'am',
    'wm',
    'binder_driver',
    'gfx',
    'view',
    'power',
  ],
  APP_PERFORMANCE: [
    'sched',
    'am',
    'wm',
    'binder_driver',
    'gfx',
    'view',
    'dalvik',
  ],
  GFX_PIPELINE: ['gfx', 'view', 'wm', 'sched', 'freq'],
  INPUT_LATENCY: ['input', 'view', 'wm', 'sched'],
  MEMORY_PROFILE: ['memory', 'memreclaim', 'am', 'dalvik', 'sched'],
}

export class Perfetto {
  outputPath = '~/traces/trace_file.perfetto-trace'
  timeValue = 10
  bufferValue = 64
  selectedEvents: string[] = [...DEFAULT_EVENTS]
  traceAllApps = true
  app = ''
  autoOpenBrowser = true
  additionalEvents = ''
  selectedTemplate: PerfettoTraceTemplate = 'DEFAULT'
  status: PerfettoStatus = 'idle'
  sessionId = ''
  logs: string[] = []
  outputFile = ''
  constructor() {
    makeObservable(this, {
      outputPath: observable,
      timeValue: observable,
      bufferValue: observable,
      selectedEvents: observable,
      traceAllApps: observable,
      app: observable,
      autoOpenBrowser: observable,
      additionalEvents: observable,
      selectedTemplate: observable,
      status: observable,
      sessionId: observable,
      logs: observable,
      outputFile: observable,
      setConfig: action,
      setStatus: action,
      addLog: action,
      clearLogs: action,
      toggleEvent: action,
      setAllEvents: action,
      clearAllEvents: action,
      setTemplate: action,
      setGroupEvents: action,
      clearGroupEvents: action,
    })

    this.init()
  }
  async init() {
    const names = [
      'outputPath',
      'timeValue',
      'bufferValue',
      'selectedEvents',
      'traceAllApps',
      'app',
      'autoOpenBrowser',
      'additionalEvents',
      'selectedTemplate',
    ]
    for (let i = 0, len = names.length; i < len; i++) {
      const name = names[i]
      const val = await main.getMainStore(`perfetto_${name}`)
      if (!isUndef(val)) {
        runInAction(() => (this[name] = val))
      }
    }
    // Migrate legacy persisted "10s" / "64mb" strings into numeric fields.
    const legacyTime = await main.getMainStore('perfetto_time')
    if (
      !isUndef(legacyTime) &&
      isUndef(await main.getMainStore('perfetto_timeValue'))
    ) {
      const n = parseInt(String(legacyTime), 10)
      if (!Number.isNaN(n)) runInAction(() => (this.timeValue = n))
    }
    const legacyBuffer = await main.getMainStore('perfetto_buffer')
    if (
      !isUndef(legacyBuffer) &&
      isUndef(await main.getMainStore('perfetto_bufferValue'))
    ) {
      const n = parseInt(String(legacyBuffer), 10)
      if (!Number.isNaN(n)) runInAction(() => (this.bufferValue = n))
    }
  }
  setConfig(name: string, val: any) {
    this[name] = val
    main.setMainStore(`perfetto_${name}`, val)
  }
  setStatus(status: PerfettoStatus) {
    this.status = status
  }
  addLog(text: string) {
    this.logs.push(text)
    // Keep max 500 log lines
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-300)
    }
  }
  clearLogs() {
    this.logs = []
  }
  toggleEvent(event: string) {
    const idx = this.selectedEvents.indexOf(event)
    if (idx >= 0) {
      this.selectedEvents.splice(idx, 1)
    } else {
      this.selectedEvents.push(event)
    }
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  setAllEvents() {
    this.selectedEvents = [...ALL_ATRACE_CATEGORIES]
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  clearAllEvents() {
    this.selectedEvents = []
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedEvents', [])
  }
  setTemplate(template: PerfettoTraceTemplate) {
    this.selectedTemplate = template
    main.setMainStore('perfetto_selectedTemplate', template)
    // CUSTOM keeps the user's current selection untouched.
    if (template !== 'CUSTOM') {
      this.selectedEvents = [...TRACE_TEMPLATE_DEFAULT_EVENTS[template]]
      main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
    }
  }
  setGroupEvents(events: string[]) {
    const next = new Set(this.selectedEvents)
    for (const e of events) next.add(e)
    this.selectedEvents = Array.from(next)
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  clearGroupEvents(events: string[]) {
    const next = this.selectedEvents.filter((e) => !events.includes(e))
    this.selectedEvents = next
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  // If the current selection no longer matches any preset, fall back the
  // highlighted template to CUSTOM so the chips stay truthful.
  syncTemplateFromSelection() {
    const sorted = [...this.selectedEvents].sort().join(',')
    const matchPreset = (TRACE_TEMPLATES as PerfettoTraceTemplate[]).some(
      (tpl) => {
        if (tpl === 'CUSTOM') return false
        const preset = [...TRACE_TEMPLATE_DEFAULT_EVENTS[tpl]].sort().join(',')
        return preset === sorted
      },
    )
    if (!matchPreset && this.selectedTemplate !== 'CUSTOM') {
      this.selectedTemplate = 'CUSTOM'
      main.setMainStore('perfetto_selectedTemplate', 'CUSTOM')
    }
  }
}

// Compose the -t / -b argument strings expected by record_android_trace.
// Units are fixed (seconds / MB) and shown inline in the field labels.
export function composeTime(perfetto: Perfetto): string {
  return `${perfetto.timeValue}s`
}
export function composeBuffer(perfetto: Perfetto): string {
  return `${perfetto.bufferValue}mb`
}

export const ALL_ATRACE_CATEGORIES = [
  'gfx',
  'input',
  'view',
  'webview',
  'wm',
  'am',
  'sm',
  'audio',
  'video',
  'camera',
  'hal',
  'res',
  'dalvik',
  'rs',
  'bionic',
  'power',
  'pm',
  'ss',
  'database',
  'network',
  'adb',
  'vibrator',
  'aidl',
  'nnapi',
  'rro',
  'sched',
  'irq',
  'freq',
  'idle',
  'disk',
  'sync',
  'memreclaim',
  'binder_driver',
  'binder_lock',
  'memory',
  'thermal',
]

// Logical grouping of atrace categories, mirroring the PerfettoProbeGroup
// layout from AndroidPerformanceStudio's data-sources panel.
export const ATRACE_GROUPS: { key: string; categories: string[] }[] = [
  { key: 'grpGraphics', categories: ['gfx'] },
  { key: 'grpInputView', categories: ['input', 'view', 'webview', 'wm'] },
  {
    key: 'grpAndroid',
    categories: [
      'am',
      'sm',
      'audio',
      'video',
      'camera',
      'res',
      'dalvik',
      'rs',
      'bionic',
      'database',
      'aidl',
      'nnapi',
      'rro',
      'hal',
    ],
  },
  {
    key: 'grpScheduling',
    categories: [
      'sched',
      'irq',
      'freq',
      'idle',
      'disk',
      'sync',
      'binder_driver',
      'binder_lock',
    ],
  },
  { key: 'grpMemory', categories: ['memory', 'memreclaim'] },
  { key: 'grpPower', categories: ['power', 'pm', 'ss', 'thermal'] },
  { key: 'grpNetwork', categories: ['network', 'adb', 'vibrator'] },
]
