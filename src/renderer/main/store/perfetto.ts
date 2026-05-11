import { action, makeObservable, observable, runInAction } from 'mobx'
import isUndef from 'licia/isUndef'

export type PerfettoStatus = 'idle' | 'recording' | 'completed' | 'error'

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

export class Perfetto {
  outputPath = '~/traces/trace_file.perfetto-trace'
  time = '10s'
  buffer = '64mb'
  selectedEvents: string[] = [...DEFAULT_EVENTS]
  traceAllApps = true
  app = ''
  autoOpenBrowser = true
  status: PerfettoStatus = 'idle'
  sessionId = ''
  logs: string[] = []
  outputFile = ''
  constructor() {
    makeObservable(this, {
      outputPath: observable,
      time: observable,
      buffer: observable,
      selectedEvents: observable,
      traceAllApps: observable,
      app: observable,
      autoOpenBrowser: observable,
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
      setDefaultEvents: action,
      clearAllEvents: action,
    })

    this.init()
  }
  async init() {
    const names = [
      'outputPath',
      'time',
      'buffer',
      'selectedEvents',
      'traceAllApps',
      'app',
      'autoOpenBrowser',
    ]
    for (let i = 0, len = names.length; i < len; i++) {
      const name = names[i]
      const val = await main.getMainStore(`perfetto_${name}`)
      if (!isUndef(val)) {
        runInAction(() => (this[name] = val))
      }
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
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  setAllEvents() {
    this.selectedEvents = [...ALL_ATRACE_CATEGORIES]
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  setDefaultEvents() {
    this.selectedEvents = [...DEFAULT_EVENTS]
    main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
  }
  clearAllEvents() {
    this.selectedEvents = []
    main.setMainStore('perfetto_selectedEvents', [])
  }
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
