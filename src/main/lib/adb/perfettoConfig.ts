import { IPerfettoTraceConfig } from 'common/types'

// ftrace_events contributed by each selectable probe. Mirrors the official
// Perfetto Record UI probe `genConfig` (ui/src/plugins/dev.perfetto.RecordTraceV2
// /pages/*.ts) — explicit event names rather than `power/*` glob fallbacks,
// for cross-kernel determinism. wifi_network_tracing keeps glob strings
// (`cfg80211/*`, `mac80211/*`) literally, as the official probe does.
const PROBE_FTRACE_EVENTS: Record<string, string[]> = {
  cpu_sched: [
    'sched/sched_switch',
    'power/suspend_resume',
    'sched/sched_blocked_reason',
    'sched/sched_wakeup',
    'sched/sched_wakeup_new',
    'sched/sched_waking',
    'sched/sched_process_exit',
    'sched/sched_process_free',
    'task/task_newtask',
    'task/task_rename',
  ],
  cpu_freq: [
    'power/cpu_frequency',
    'power/cpu_idle',
    'power/suspend_resume',
    'power/psci_domain_idle_enter',
    'power/psci_domain_idle_exit',
  ],
  cpu_syscalls: ['raw_syscalls/sys_enter', 'raw_syscalls/sys_exit'],
  gpu_frequency: ['power/gpu_frequency'],
  gpu_memory: ['gpu_mem/gpu_mem_total'],
  gpu_work_period: ['power/gpu_work_period'],
  power_voltages: [
    'regulator/regulator_set_voltage',
    'regulator/regulator_set_voltage_complete',
    'power/clock_enable',
    'power/clock_disable',
    'power/clock_set_rate',
    'power/suspend_resume',
  ],
  mem_hifreq: [
    'mm_event/mm_event_record',
    'kmem/rss_stat',
    'ion/ion_stat',
    'dmabuf_heap/dma_heap_stat',
    'kmem/ion_heap_grow',
    'kmem/ion_heap_shrink',
  ],
  mem_lmk: ['lowmemorykiller/lowmemory_kill', 'oom/oom_score_adj_update'],
  wifi_network_tracing: [
    'cfg80211/*',
    'mac80211/*',
    'net/netif_receive_skb',
    'net/net_dev_xmit',
  ],
}

// Probes that emit ftrace_events (i.e. drive the symbolize_ksyms /
// disable_generic_events injection). cpu_usage is excluded: it only adds a
// linux.sys_stats data source, no ftrace events.
const FTRACE_PROBE_IDS = new Set(Object.keys(PROBE_FTRACE_EVENTS))

// Probes that contribute a linux.sys_stats field set (shared, single data
// source). cpu_usage → stat counters; cpu_freq → cpufreq period.
const SYS_STAT_PERIOD_MS = 1000
const CPUFREQ_PERIOD_MS = 1000

/**
 * Builds a Perfetto text-proto TraceConfig (`.txtpb`) from the aya capture
 * config, mirroring AndroidPerformanceStudio's PerfettoConfigTextBuilder:
 * atrace categories and ftrace events are emitted under a single
 * `linux.ftrace` data source's `ftrace_config`.
 *
 * ftrace_events come from two sources, de-duplicated into one set:
 *   1. selected probes (cpu_sched, cpu_freq, gpu_frequency, power_voltages,
 *      ...), each contributing the official probe's event bundle;
 *   2. the user's `additionalEvents` text box (events with a '/').
 * When any ftrace-emitting probe is selected, `symbolize_ksyms: true` and
 * `disable_generic_events: true` are injected (matching the official
 * `advanced_ftrace` defaults).
 *
 * The resulting string is both saved to a temp file for `record_android_trace
 * -c` capture and exported for the user / ui.perfetto.dev — same generator,
 * so "what you export is what you capture".
 */
export function buildTraceConfigText(config: IPerfettoTraceConfig): string {
  const durationMs = parseDurationMs(config.time)
  const sizeKb = parseBufferSizeKb(config.buffer)

  // Resolve selected probes: undefined/absent defaults to the official Default
  // preset trio (cpu_sched + cpu_freq + cpu_usage) so a default capture has the
  // ftrace base. An explicit empty array means "pure atrace, no probes".
  const probes = resolveProbes(config.probes)

  // Atrace categories (no '/') and ftrace events (with '/'), de-duplicated.
  const atraceCategories: string[] = []
  const ftraceEvents: string[] = []
  const seenAtrace = new Set<string>()
  const seenFtrace = new Set<string>()

  // Probe-contributed ftrace events go in first.
  let hasFtraceProbe = false
  for (const probeId of probes) {
    const events = PROBE_FTRACE_EVENTS[probeId]
    if (events) {
      hasFtraceProbe = true
      for (const e of events) {
        if (!seenFtrace.has(e)) {
          seenFtrace.add(e)
          ftraceEvents.push(e)
        }
      }
    }
  }
  // Then user additional events (atrace categories or ftrace events).
  for (const e of [...config.events, ...config.additionalEvents]) {
    const name = e.trim()
    if (!name) continue
    if (name.includes('/')) {
      if (!seenFtrace.has(name)) {
        seenFtrace.add(name)
        ftraceEvents.push(name)
      }
    } else {
      if (!seenAtrace.has(name)) {
        seenAtrace.add(name)
        atraceCategories.push(name)
      }
    }
  }

  const atraceApps: string[] = []
  if (config.traceAllApps) {
    atraceApps.push('*')
  } else if (config.app) {
    atraceApps.push(config.app)
  }
  // mem_lmk probe contributes the lmkd userspace app (official lmk probe does
  // addAtraceApps('lmkd')). Only when not already tracing all apps ('*').
  if (probes.includes('mem_lmk') && !config.traceAllApps) {
    if (!atraceApps.includes('lmkd')) atraceApps.push('lmkd')
  }

  // linux.sys_stats: single data source, fields accumulated across
  // cpu_usage (stat counters) and cpu_freq (cpufreq period).
  const sysStat =
    probes.includes('cpu_usage') || probes.includes('cpu_freq')
      ? {
          statPeriodMs: SYS_STAT_PERIOD_MS,
          cpufreqPeriodMs: probes.includes('cpu_freq')
            ? CPUFREQ_PERIOD_MS
            : undefined,
          statCounters: probes.includes('cpu_usage')
            ? ['STAT_CPU_TIMES', 'STAT_FORK_COUNT']
            : [],
        }
      : null
  const needGpuMemory = probes.includes('gpu_memory')

  const lines: string[] = []
  lines.push('buffers {')
  lines.push(`  size_kb: ${sizeKb}`)
  lines.push('  fill_policy: RING_BUFFER')
  lines.push('}')
  lines.push(`duration_ms: ${durationMs}`)
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.ftrace"')
  lines.push('    ftrace_config {')
  for (const e of ftraceEvents) {
    lines.push(`      ftrace_events: "${escapeProto(e)}"`)
  }
  for (const c of atraceCategories) {
    lines.push(`      atrace_categories: "${escapeProto(c)}"`)
  }
  for (const a of atraceApps) {
    lines.push(`      atrace_apps: "${escapeProto(a)}"`)
  }
  // Mirrors the official `advanced_ftrace` defaults (ksyms on, additional
  // events off → disable_generic_events true). Only when ftrace probes emit.
  if (hasFtraceProbe) {
    lines.push('      symbolize_ksyms: true')
    lines.push('      disable_generic_events: true')
  }
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  // Process stats: records process/thread names so ui.perfetto.dev can map
  // PIDs to package/process names instead of showing bare PIDs. Without this
  // data source the short-options path (tracebox auto-config) included it
  // implicitly; the txtpb path must declare it explicitly.
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.process_stats"')
  lines.push('    process_stats_config {')
  lines.push('      scan_all_processes_on_start: true')
  lines.push('      record_thread_names: true')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  // System stats: /proc/stat CPU times + fork count (cpu_usage) and/or cpufreq
  // polling (cpu_freq). One shared data source.
  if (sysStat) {
    lines.push('data_sources {')
    lines.push('  config {')
    lines.push('    name: "linux.sys_stats"')
    lines.push('    sys_stats_config {')
    lines.push(`      stat_period_ms: ${sysStat.statPeriodMs}`)
    if (sysStat.cpufreqPeriodMs !== undefined) {
      lines.push(`      cpufreq_period_ms: ${sysStat.cpufreqPeriodMs}`)
    }
    for (const c of sysStat.statCounters) {
      lines.push(`      stat_counters: ${c}`)
    }
    lines.push('    }')
    lines.push('  }')
    lines.push('}')
  }
  // GPU memory tracking data source (gpu_memory probe).
  if (needGpuMemory) {
    lines.push('data_sources {')
    lines.push('  config {')
    lines.push('    name: "android.gpu.memory"')
    lines.push('  }')
    lines.push('}')
  }
  // Package list: lets the UI resolve installed package names.
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "android.packages_list"')
  lines.push('  }')
  lines.push('}')
  return lines.join('\n') + '\n'
}

// Default probe set when `probes` is undefined/absent: aligns a default capture
// with the official Perfetto "Default" preset's ftrace base.
function resolveProbes(probes: string[] | undefined): string[] {
  if (probes === undefined) {
    return ['cpu_sched', 'cpu_freq', 'cpu_usage']
  }
  // Filter to known probes only; preserve order & de-duplicate.
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of probes) {
    const id = p.trim()
    if (id && (FTRACE_PROBE_IDS.has(id) || id === 'cpu_usage') && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// Parse a composed duration like "10s" / "5m" / "1h" into milliseconds.
function parseDurationMs(time: string): number {
  const m = /^(\d+)\s*(s|m|h)?$/i.exec(String(time).trim())
  if (!m) return 0
  const n = parseInt(m[1], 10)
  const unit = (m[2] || 's').toLowerCase()
  const mult = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1
  return n * mult * 1000
}

// Parse a composed buffer size like "64mb" / "1gb" into kilobytes.
function parseBufferSizeKb(buffer: string): number {
  const m = /^(\d+)\s*(mb|gb|kb)?$/i.exec(String(buffer).trim())
  if (!m) return 65536
  const n = parseInt(m[1], 10)
  const unit = (m[2] || 'mb').toLowerCase()
  if (unit === 'gb') return n * 1024 * 1024
  if (unit === 'kb') return n
  return n * 1024
}

function escapeProto(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// The 8 ftrace events essential for a boot trace (fixed base, from the
// user-provided boottrace.pbtxt sample).
const BOOTTRACE_FIXED_FTRACE_EVENTS = [
  'sched/sched_switch',
  'sched/sched_waking',
  'sched/sched_wakeup',
  'power/suspend_resume',
  'power/cpu_frequency',
  'power/cpu_idle',
  'task/task_newtask',
  'task/task_rename',
]

/**
 * Builds a boot-trace text-proto config using the "A 折中" strategy: a fixed,
 * hand-tuned base (dual buffers with target_buffer split, 8 boot-critical
 * ftrace events, process_stats/sys_stats/system_info, 30s) with the user's
 * panel atrace categories overriding the atrace_categories section and
 * additional events merged in. No write_into_file — the
 * persist.debug.perfetto.boottrace mechanism handles on-device persistence.
 */
export function buildBoottraceConfigText(config: IPerfettoTraceConfig): string {
  // atrace categories (no '/') from the panel selection + additional events.
  const atraceCategories: string[] = []
  const ftraceEvents: string[] = [...BOOTTRACE_FIXED_FTRACE_EVENTS]
  const seenAtrace = new Set<string>()
  const seenFtrace = new Set(BOOTTRACE_FIXED_FTRACE_EVENTS)
  for (const e of [...config.events, ...config.additionalEvents]) {
    const name = e.trim()
    if (!name) continue
    if (name.includes('/')) {
      if (!seenFtrace.has(name)) {
        seenFtrace.add(name)
        ftraceEvents.push(name)
      }
    } else {
      if (!seenAtrace.has(name)) {
        seenAtrace.add(name)
        atraceCategories.push(name)
      }
    }
  }

  const atraceApps: string[] = []
  if (config.traceAllApps) {
    atraceApps.push('*')
  } else if (config.app) {
    atraceApps.push(config.app)
  }

  const lines: string[] = []
  lines.push('buffers {')
  lines.push('  size_kb: 393216')
  lines.push('  fill_policy: RING_BUFFER')
  lines.push('}')
  lines.push('buffers {')
  lines.push('  size_kb: 8192')
  lines.push('  fill_policy: RING_BUFFER')
  lines.push('}')
  // linux.ftrace → buffer 0
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.ftrace"')
  lines.push('    target_buffer: 0')
  lines.push('    ftrace_config {')
  for (const e of ftraceEvents) {
    lines.push(`      ftrace_events: "${escapeProto(e)}"`)
  }
  for (const c of atraceCategories) {
    lines.push(`      atrace_categories: "${escapeProto(c)}"`)
  }
  for (const a of atraceApps) {
    lines.push(`      atrace_apps: "${escapeProto(a)}"`)
  }
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  // linux.process_stats → buffer 1
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.process_stats"')
  lines.push('    target_buffer: 1')
  lines.push('    process_stats_config {')
  lines.push('      scan_all_processes_on_start: true')
  lines.push('      record_thread_names: true')
  lines.push('      proc_stats_poll_ms: 1000')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  // linux.sys_stats → buffer 1
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.sys_stats"')
  lines.push('    target_buffer: 1')
  lines.push('    sys_stats_config {')
  lines.push('      stat_period_ms: 2500')
  lines.push('      meminfo_period_ms: 2500')
  lines.push('    }')
  lines.push('  }')
  lines.push('}')
  // linux.system_info → buffer 1
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "linux.system_info"')
  lines.push('    target_buffer: 1')
  lines.push('  }')
  lines.push('}')
  lines.push('duration_ms: 30000')
  return lines.join('\n') + '\n'
}
