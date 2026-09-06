import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import LunaToolbar, {
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { t } from 'common/util'
import store from '../../store'
import Style from './Perfetto.module.scss'
import className from 'licia/className'
import {
  ALL_ATRACE_CATEGORIES,
  ATRACE_GROUPS,
  TRACE_TEMPLATES,
  PerfettoTraceTemplate,
  composeTime,
  composeBuffer,
} from '../../store/perfetto'
import { IPerfettoTraceConfig } from 'common/types'

const TEMPLATE_LABEL_KEY: Record<PerfettoTraceTemplate, string> = {
  DEFAULT: 'defaultTemplate',
  SYSTEM_OVERVIEW: 'systemOverview',
  APP_PERFORMANCE: 'appPerformance',
  GFX_PIPELINE: 'gfxPipeline',
  INPUT_LATENCY: 'inputLatency',
  MEMORY_PROFILE: 'memoryProfile',
  CUSTOM: 'customTemplate',
}

// Logs produced by record_android_trace once on-device capture has finished
// and the script starts transferring the trace file back to the host.
const PULLING_RE = /pulling|downloading|uploading|pull.*device|transfer/i

export default observer(function Perfetto() {
  const { perfetto } = store
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offOutput = main.on(
      'perfettoTraceOutput',
      (sessionId: string, text: string) => {
        if (sessionId === perfetto.sessionId) {
          // Strip ANSI escape codes to prevent garbled characters
          const cleanText = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
          // Detect the pull/transfer phase while recording.
          if (perfetto.status === 'recording' && PULLING_RE.test(cleanText)) {
            perfetto.setStatus('pulling')
          }
          perfetto.addLog(cleanText)
        }
      },
    )

    const offExit = main.on(
      'perfettoTraceExit',
      (sessionId: string, code: number, error: string) => {
        if (sessionId === perfetto.sessionId) {
          if (code === 0) {
            perfetto.setStatus('completed')
            perfetto.addLog(
              `\n✓ Trace completed. Saved to: ${perfetto.outputPath}\n`,
            )
          } else {
            perfetto.setStatus('error')
            perfetto.addLog(
              `\n✗ Trace failed with code ${code}${error ? ': ' + error : ''}\n`,
            )
          }
        }
      },
    )

    return () => {
      offOutput()
      offExit()
    }
  }, [perfetto.sessionId])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [perfetto.logs.length])

  const isRecording =
    perfetto.status === 'recording' || perfetto.status === 'pulling'

  async function handleStart() {
    if (!store.device) return

    perfetto.clearLogs()
    perfetto.setStatus('recording')

    const additionalEvents = perfetto.additionalEvents
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean)

    const config: IPerfettoTraceConfig = {
      deviceId: store.device.id,
      outputPath: perfetto.outputPath,
      time: composeTime(perfetto),
      buffer: composeBuffer(perfetto),
      events: [...perfetto.selectedEvents],
      additionalEvents,
      app: perfetto.app,
      traceAllApps: perfetto.traceAllApps,
      noOpen: !perfetto.autoOpenBrowser,
    }

    try {
      const sessionId = await main.startPerfettoTrace(config)
      perfetto.sessionId = sessionId
      perfetto.addLog(
        `Starting trace on device: ${store.device.name} (${store.device.id})\n`,
      )
      perfetto.addLog(`Output: ${config.outputPath}\n`)
      perfetto.addLog(`Duration: ${config.time}, Buffer: ${config.buffer}\n`)
      perfetto.addLog(`Events: ${config.events.join(', ')}\n`)
      if (additionalEvents.length > 0) {
        perfetto.addLog(`Additional: ${additionalEvents.join(', ')}\n`)
      }
      perfetto.addLog(
        `App: ${config.traceAllApps ? 'All apps' : config.app || 'None'}\n`,
      )
      perfetto.addLog('---\n')
    } catch (err: any) {
      perfetto.setStatus('error')
      perfetto.addLog(`Failed to start trace: ${err.message}\n`)
    }
  }

  async function handleStop() {
    if (perfetto.sessionId) {
      perfetto.addLog('\nStopping trace...\n')
      await main.stopPerfettoTrace(perfetto.sessionId)
    }
  }

  async function handleBrowse() {
    const result = await main.showSaveDialog({
      defaultPath: perfetto.outputPath,
      filters: [
        { name: 'Perfetto Trace', extensions: ['perfetto-trace', 'pftrace'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result && !result.canceled && result.filePath) {
      perfetto.setConfig('outputPath', result.filePath)
    }
  }

  function buildConfig(): IPerfettoTraceConfig {
    return {
      deviceId: store.device?.id || '',
      outputPath: perfetto.outputPath,
      time: composeTime(perfetto),
      buffer: composeBuffer(perfetto),
      events: [...perfetto.selectedEvents],
      additionalEvents: perfetto.additionalEvents
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter(Boolean),
      app: perfetto.app,
      traceAllApps: perfetto.traceAllApps,
      noOpen: !perfetto.autoOpenBrowser,
    }
  }

  async function handleExportConfig() {
    const result = await main.showSaveDialog({
      defaultPath: 'config.txtpb',
      filters: [
        { name: t('txtpbFile'), extensions: ['txtpb'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!result || result.canceled || !result.filePath) return

    try {
      await main.exportPerfettoConfig(buildConfig(), result.filePath)
      perfetto.addLog(
        `✓ ${t('exportConfigSuccess', { path: result.filePath })}\n`,
      )
    } catch (err: any) {
      perfetto.addLog(`✗ ${t('exportConfigFailed', { error: err.message })}\n`)
    }
  }

  async function handleExportBoottrace() {
    const result = await main.showSaveDialog({
      defaultPath: 'boottrace.pbtxt',
      filters: [
        { name: t('pbtxtFile'), extensions: ['pbtxt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!result || result.canceled || !result.filePath) return

    try {
      perfetto.addLog(`▶ ${t('exportBoottrace')}...\n`)
      const res = await main.exportBoottraceConfig(
        buildConfig(),
        result.filePath,
      )
      perfetto.addLog(
        `✓ ${t('boottraceExported', { path: result.filePath })}\n`,
      )
      if (!res.pushed) {
        perfetto.addLog(
          `✗ ${t('boottracePushFailed', { error: 'push failed' })}\n`,
        )
      } else if (!res.verified) {
        perfetto.addLog(`! ${t('boottraceVerifyFailed')}\n`)
      } else {
        perfetto.addLog(`✓ ${t('boottracePushed')}\n`)
      }
    } catch (err: any) {
      perfetto.addLog(
        `✗ ${t('boottraceExportFailed', { error: err.message })}\n`,
      )
    }
  }

  function getStatusText() {
    switch (perfetto.status) {
      case 'recording':
        return t('traceRecording')
      case 'pulling':
        return t('tracePulling')
      case 'completed':
        return t('traceCompleted')
      case 'error':
        return t('traceError')
      default:
        return t('traceIdle')
    }
  }

  function isGroupAllSelected(categories: string[]) {
    return categories.every((c) => perfetto.selectedEvents.includes(c))
  }

  function groupHasSelected(categories: string[]) {
    return categories.some((c) => perfetto.selectedEvents.includes(c))
  }

  return (
    <div className={className('panel-with-toolbar', Style.container)}>
      <LunaToolbar className="panel-toolbar">
        {!isRecording ? (
          <ToolbarIcon
            icon="play"
            title={t('startTrace')}
            onClick={handleStart}
            disabled={!store.device}
          />
        ) : (
          <ToolbarIcon
            icon="square"
            title={t('stopTrace')}
            onClick={handleStop}
          />
        )}
        <LunaToolbarSpace />
        <LunaToolbarText text={getStatusText()} className={Style.statusText} />
      </LunaToolbar>
      <div className={className('panel-body', Style.content)}>
        {/* Trace template */}
        <div className={Style.templateRow}>
          {TRACE_TEMPLATES.map((template) => (
            <div
              key={template}
              className={className(
                Style.templateChip,
                perfetto.selectedTemplate === template &&
                  Style.templateChipActive,
              )}
              onClick={() => !isRecording && perfetto.setTemplate(template)}
            >
              {t(TEMPLATE_LABEL_KEY[template])}
            </div>
          ))}
        </div>

        {/* Main two-column area: config (left) | categories (right) */}
        <div className={Style.mainRow}>
          <div className={Style.configCol}>
            {/* Output path */}
            <div className={Style.field}>
              <label className={Style.fieldLabel}>{t('traceOutput')}</label>
              <div className={Style.configRow}>
                <input
                  className={Style.configInput}
                  value={perfetto.outputPath}
                  onChange={(e) =>
                    perfetto.setConfig('outputPath', e.target.value)
                  }
                  disabled={isRecording}
                  spellCheck={false}
                />
                <button
                  className={Style.browseBtn}
                  onClick={handleBrowse}
                  disabled={isRecording}
                >
                  {t('browse')}
                </button>
              </div>
              <div className={Style.exportRow}>
                <button
                  className={Style.exportBtn}
                  onClick={handleExportConfig}
                  disabled={isRecording}
                >
                  {t('exportConfig')}
                </button>
                <button
                  className={Style.exportBtn}
                  onClick={handleExportBoottrace}
                  disabled={isRecording}
                >
                  {t('exportBoottrace')}
                </button>
              </div>
            </div>

            {/* Duration & Buffer */}
            <div className={Style.fieldPair}>
              <div className={Style.field}>
                <label className={Style.fieldLabel}>
                  {t('traceDuration')}
                  <span className={Style.fieldUnit}>{t('unitSeconds')}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className={Style.configInput}
                  value={perfetto.timeValue}
                  onChange={(e) =>
                    perfetto.setConfig(
                      'timeValue',
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                  disabled={isRecording}
                />
              </div>
              <div className={Style.field}>
                <label className={Style.fieldLabel}>
                  {t('bufferSize')}
                  <span className={Style.fieldUnit}>{t('unitMB')}</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className={Style.configInput}
                  value={perfetto.bufferValue}
                  onChange={(e) =>
                    perfetto.setConfig(
                      'bufferValue',
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                  disabled={isRecording}
                />
              </div>
            </div>

            {/* App Filter */}
            <div className={Style.field}>
              <label className={Style.fieldLabel}>{t('appFilter')}</label>
              <label className={Style.checkboxRow}>
                <input
                  type="checkbox"
                  checked={perfetto.traceAllApps}
                  onChange={(e) =>
                    perfetto.setConfig('traceAllApps', e.target.checked)
                  }
                  disabled={isRecording}
                />
                {t('traceAllApps')} (-a*)
              </label>
              {!perfetto.traceAllApps && (
                <input
                  className={Style.configInput}
                  value={perfetto.app}
                  onChange={(e) => perfetto.setConfig('app', e.target.value)}
                  disabled={isRecording}
                  placeholder="com.example.app"
                />
              )}
            </div>

            {/* Additional Events */}
            <div className={Style.field}>
              <label className={Style.fieldLabel}>
                {t('additionalEvents')}
              </label>
              <textarea
                className={Style.additionalInput}
                value={perfetto.additionalEvents}
                onChange={(e) =>
                  perfetto.setConfig('additionalEvents', e.target.value)
                }
                disabled={isRecording}
                spellCheck={false}
                placeholder={t('additionalEventsPlaceholder')}
              />
            </div>

            {/* Options */}
            <label className={Style.checkboxRow}>
              <input
                type="checkbox"
                checked={perfetto.autoOpenBrowser}
                onChange={(e) =>
                  perfetto.setConfig('autoOpenBrowser', e.target.checked)
                }
                disabled={isRecording}
              />
              {t('autoOpenBrowser')}
            </label>
          </div>

          {/* Atrace Categories */}
          <div className={Style.categoriesCol}>
            <div className={Style.categoriesHeader}>
              <span className={Style.fieldLabel}>{t('atraceCategories')}</span>
              <div className={Style.selectActions}>
                <button
                  className={Style.selectBtn}
                  onClick={() => {
                    if (
                      perfetto.selectedEvents.length ===
                      ALL_ATRACE_CATEGORIES.length
                    ) {
                      perfetto.clearAllEvents()
                    } else {
                      perfetto.setAllEvents()
                    }
                  }}
                  disabled={isRecording}
                >
                  {perfetto.selectedEvents.length ===
                  ALL_ATRACE_CATEGORIES.length
                    ? t('deselectAll')
                    : t('selectAll')}
                </button>
              </div>
            </div>
            <div className={Style.groupsScroll}>
              {ATRACE_GROUPS.map((group) => {
                const allSelected = isGroupAllSelected(group.categories)
                return (
                  <div key={group.key} className={Style.groupCard}>
                    <div className={Style.groupHeader}>
                      <span>{t(group.key)}</span>
                      <div className={Style.groupActions}>
                        <button
                          className={Style.selectBtn}
                          onClick={() =>
                            perfetto.setGroupEvents(group.categories)
                          }
                          disabled={isRecording || allSelected}
                        >
                          {t('selectAll')}
                        </button>
                        <button
                          className={Style.selectBtn}
                          onClick={() =>
                            perfetto.clearGroupEvents(group.categories)
                          }
                          disabled={
                            isRecording || !groupHasSelected(group.categories)
                          }
                        >
                          {t('clear')}
                        </button>
                      </div>
                    </div>
                    <div className={Style.groupBody}>
                      {group.categories.map((category) => (
                        <div key={category} className={Style.categoryItem}>
                          <input
                            type="checkbox"
                            id={`atrace-${category}`}
                            checked={perfetto.selectedEvents.includes(category)}
                            onChange={() => perfetto.toggleEvent(category)}
                            disabled={isRecording}
                          />
                          <label htmlFor={`atrace-${category}`}>
                            {category}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Log Output */}
        <div className={Style.logSection}>
          <div className={Style.logHeader}>
            <span className={Style.fieldLabel}>{t('traceLog')}</span>
            {(perfetto.status === 'recording' ||
              perfetto.status === 'pulling') && (
              <div className={Style.progressBar}>
                <div className={Style.progressBarRunning} />
              </div>
            )}
          </div>
          <div className={Style.logContainer} ref={logRef}>
            {perfetto.logs.length > 0
              ? perfetto.logs.join('')
              : perfetto.status === 'idle'
                ? t('traceIdle')
                : ''}
          </div>
        </div>
      </div>
    </div>
  )
})
