import { IPerfettoTraceConfig } from 'common/types'

/**
 * Builds a Perfetto text-proto TraceConfig (`.txtpb`) from the aya capture
 * config, mirroring AndroidPerformanceStudio's PerfettoConfigTextBuilder:
 * atrace categories and ftrace events are emitted under a single
 * `linux.ftrace` data source's `ftrace_config`.
 *
 * The resulting string is both saved to a temp file for `record_android_trace
 * -c` capture and exported for the user / ui.perfetto.dev — same generator,
 * so "what you export is what you capture".
 */
export function buildTraceConfigText(config: IPerfettoTraceConfig): string {
  const durationMs = parseDurationMs(config.time)
  const sizeKb = parseBufferSizeKb(config.buffer)

  // Atrace categories (no '/') and ftrace events (with '/'), de-duplicated.
  const atraceCategories: string[] = []
  const ftraceEvents: string[] = []
  const seenAtrace = new Set<string>()
  const seenFtrace = new Set<string>()
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
  // Package list: lets the UI resolve installed package names.
  lines.push('data_sources {')
  lines.push('  config {')
  lines.push('    name: "android.packages_list"')
  lines.push('  }')
  lines.push('}')
  return lines.join('\n') + '\n'
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
