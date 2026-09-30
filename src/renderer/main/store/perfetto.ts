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

// Preset ftrace probe bundles per trace template. A template fully defines
// the capture config: its atrace categories AND its probes, so the panel state
// (Atrace checkboxes + Ftrace Probes checkboxes) always matches what a
// capture/export of that template produces. The CPU base (sched + freq +
// usage) mirrors the official Perfetto "Default" preset; GFX adds the GPU
// probe and MEMORY adds the memory probes. CUSTOM keeps the user's selection.
const CPU_BASE_PROBES = ['cpu_sched', 'cpu_freq', 'cpu_usage']
export const TRACE_TEMPLATE_DEFAULT_PROBES: Record<
  Exclude<PerfettoTraceTemplate, 'CUSTOM'>,
  string[]
> = {
  DEFAULT: [...CPU_BASE_PROBES],
  SYSTEM_OVERVIEW: [...CPU_BASE_PROBES],
  APP_PERFORMANCE: [...CPU_BASE_PROBES],
  GFX_PIPELINE: [...CPU_BASE_PROBES, 'gpu_frequency'],
  INPUT_LATENCY: [...CPU_BASE_PROBES],
  MEMORY_PROFILE: [...CPU_BASE_PROBES, 'mem_hifreq', 'mem_lmk'],
}

export class Perfetto {
  outputPath = '~/traces/trace_file.perfetto-trace'
  // Device-side path for the on-device `perfetto` short-command preview. Kept
  // separate from `outputPath` (a host path) so the generated `-o` argument
  // points at a writable location on the device.
  cliOutputPath = '/data/misc/perfetto-traces/trace_file.perfetto-trace'
  timeValue = 10
  bufferValue = 64
  selectedEvents: string[] = [...DEFAULT_EVENTS]
  selectedProbes: string[] = [...DEFAULT_PROBES]
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
      cliOutputPath: observable,
      timeValue: observable,
      bufferValue: observable,
      selectedEvents: observable,
      selectedProbes: observable,
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
      toggleProbe: action,
      setAllProbes: action,
      clearAllProbes: action,
      setGroupProbes: action,
      clearGroupProbes: action,
    })

    this.init()
  }
  async init() {
    const names = [
      'outputPath',
      'cliOutputPath',
      'timeValue',
      'bufferValue',
      'selectedEvents',
      'selectedProbes',
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
    // CUSTOM keeps the user's current selection untouched. Non-CUSTOM
    // templates fully define the capture config — atrace categories AND
    // ftrace probes — so the panel state matches what the template captures.
    if (template !== 'CUSTOM') {
      this.selectedEvents = [...TRACE_TEMPLATE_DEFAULT_EVENTS[template]]
      this.selectedProbes = [...TRACE_TEMPLATE_DEFAULT_PROBES[template]]
      main.setMainStore('perfetto_selectedEvents', [...this.selectedEvents])
      main.setMainStore('perfetto_selectedProbes', [...this.selectedProbes])
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
  // Toggle a ftrace probe. Probes are part of the template definition, so
  // toggling participates in template matching: a probe change that no longer
  // matches any preset falls the highlighted template back to CUSTOM.
  toggleProbe(probeId: string) {
    const idx = this.selectedProbes.indexOf(probeId)
    if (idx >= 0) {
      this.selectedProbes.splice(idx, 1)
    } else {
      this.selectedProbes.push(probeId)
    }
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedProbes', [...this.selectedProbes])
  }
  // Select / clear all probes (global controls, mirroring the atrace all/clear).
  setAllProbes() {
    this.selectedProbes = FTRACE_PROBES.map((p) => p.id)
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedProbes', [...this.selectedProbes])
  }
  clearAllProbes() {
    this.selectedProbes = []
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedProbes', [])
  }
  // Select / clear a probe group (mirrors atrace setGroupEvents/clearGroupEvents).
  setGroupProbes(probeIds: string[]) {
    const next = new Set(this.selectedProbes)
    for (const id of probeIds) next.add(id)
    this.selectedProbes = Array.from(next)
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedProbes', [...this.selectedProbes])
  }
  clearGroupProbes(probeIds: string[]) {
    const next = this.selectedProbes.filter((id) => !probeIds.includes(id))
    this.selectedProbes = next
    this.syncTemplateFromSelection()
    main.setMainStore('perfetto_selectedProbes', [...this.selectedProbes])
  }
  // If the current atrace categories + probes no longer match any preset,
  // fall back the highlighted template to CUSTOM so the chips stay truthful.
  syncTemplateFromSelection() {
    const sig = `${[...this.selectedEvents].sort().join(',')}|${[
      ...this.selectedProbes,
    ].sort().join(',')}`
    const matchPreset = (TRACE_TEMPLATES as PerfettoTraceTemplate[]).some(
      (tpl) => {
        if (tpl === 'CUSTOM') return false
        const presetSig = `${[
          ...TRACE_TEMPLATE_DEFAULT_EVENTS[tpl],
        ].sort().join(',')}|${[...TRACE_TEMPLATE_DEFAULT_PROBES[tpl]].sort().join(',')}`
        return presetSig === sig
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

// Compose a self-contained on-device `perfetto` short-command the user can
// paste into any terminal. This is a "quick capture" path, distinct from the
// record_android_trace + txtpb main path; the product is leaner (no
// process_stats / packages_list). Fidelity tier C: include -b, omit device
// serial (-s), --background, --txt and browser/open flags. App filtering uses
// the long `--app 'name'` form (matching record_android_trace's on-device
// command); all-apps mode omits the flag entirely (atrace default = all apps,
// and avoids the `-a*` bash glob pitfall). Returns an empty string when no
// events are selected.
export function composeCliCommand(perfetto: Perfetto): string {
  const events = [
    ...perfetto.selectedEvents,
    ...perfetto.additionalEvents
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean),
  ]
  if (events.length === 0) return ''

  const parts: string[] = [
    'adb',
    'shell',
    'perfetto',
    '-o',
    perfetto.cliOutputPath,
    '-t',
    composeTime(perfetto),
    '-b',
    composeBuffer(perfetto),
  ]

  if (perfetto.traceAllApps) {
    // "Trace all apps" maps to the wildcard short form. Verified on-device:
    // `-a*` captures all apps' atrace, while `--app '*'` does NOT. Wrapped in
    // single quotes so the shell does not glob-expand `*` when pasted.
    parts.push("'-a*'")
  } else if (perfetto.app.trim()) {
    parts.push('--app', `'${perfetto.app.trim()}'`)
  }

  parts.push(...events)
  return parts.join(' ')
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

// Selectable ftrace probes, mirroring the official Perfetto Record UI probe
// pages (ui/src/plugins/dev.perfetto.RecordTraceV2/pages/*.ts). Each probe id
// contributes a fixed ftrace_events bundle (and some a companion data source)
// in buildTraceConfigText. `group` drives the UI grouping; `titleKey` is the
// i18n label. Probes are orthogonal to atrace categories — toggling a template
// never touches probe selection (see syncTemplateFromSelection).
export interface FtraceProbe {
  id: string
  group: 'cpu' | 'gpu' | 'power' | 'memory' | 'network'
  titleKey: string
}

export const FTRACE_PROBES: FtraceProbe[] = [
  { id: 'cpu_sched', group: 'cpu', titleKey: 'probeCpuSched' },
  { id: 'cpu_freq', group: 'cpu', titleKey: 'probeCpuFreq' },
  { id: 'cpu_usage', group: 'cpu', titleKey: 'probeCpuUsage' },
  { id: 'cpu_syscalls', group: 'cpu', titleKey: 'probeCpuSyscalls' },
  { id: 'gpu_frequency', group: 'gpu', titleKey: 'probeGpuFrequency' },
  { id: 'gpu_memory', group: 'gpu', titleKey: 'probeGpuMemory' },
  { id: 'gpu_work_period', group: 'gpu', titleKey: 'probeGpuWorkPeriod' },
  { id: 'power_voltages', group: 'power', titleKey: 'probePowerVoltages' },
  { id: 'mem_hifreq', group: 'memory', titleKey: 'probeMemHifreq' },
  { id: 'mem_lmk', group: 'memory', titleKey: 'probeMemLmk' },
  { id: 'wifi_network_tracing', group: 'network', titleKey: 'probeWifiNetwork' },
]

export const FTRACE_PROBE_GROUPS: { key: string; group: FtraceProbe['group'] }[] = [
  { key: 'grpProbesCpu', group: 'cpu' },
  { key: 'grpProbesGpu', group: 'gpu' },
  { key: 'grpProbesPower', group: 'power' },
  { key: 'grpProbesMemory', group: 'memory' },
  { key: 'grpProbesNetwork', group: 'network' },
]

// Default probe selection — aligns a default capture with the official Perfetto
// "Default" preset's ftrace base (cpu_sched + cpu_freq + cpu_usage).
export const DEFAULT_PROBES = ['cpu_sched', 'cpu_freq', 'cpu_usage']

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
