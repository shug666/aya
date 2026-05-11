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
import { ALL_ATRACE_CATEGORIES } from '../../store/perfetto'
import { IPerfettoTraceConfig } from 'common/types'

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
          perfetto.addLog(cleanText)
        }
      }
    )

    const offExit = main.on(
      'perfettoTraceExit',
      (sessionId: string, code: number, error: string) => {
        if (sessionId === perfetto.sessionId) {
          if (code === 0) {
            perfetto.setStatus('completed')
            perfetto.addLog(`\n✓ Trace completed. Saved to: ${perfetto.outputPath}\n`)
          } else {
            perfetto.setStatus('error')
            perfetto.addLog(`\n✗ Trace failed with code ${code}${error ? ': ' + error : ''}\n`)
          }
        }
      }
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

  const isRecording = perfetto.status === 'recording'

  async function handleStart() {
    if (!store.device) return

    perfetto.clearLogs()
    perfetto.setStatus('recording')

    const config: IPerfettoTraceConfig = {
      deviceId: store.device.id,
      outputPath: perfetto.outputPath,
      time: perfetto.time,
      buffer: perfetto.buffer,
      events: [...perfetto.selectedEvents],
      app: perfetto.app,
      traceAllApps: perfetto.traceAllApps,
      noOpen: !perfetto.autoOpenBrowser,
    }

    try {
      const sessionId = await main.startPerfettoTrace(config)
      perfetto.sessionId = sessionId
      perfetto.addLog(`Starting trace on device: ${store.device.name} (${store.device.id})\n`)
      perfetto.addLog(`Output: ${config.outputPath}\n`)
      perfetto.addLog(`Duration: ${config.time}, Buffer: ${config.buffer}\n`)
      perfetto.addLog(`Events: ${config.events.join(', ')}\n`)
      perfetto.addLog(`App: ${config.traceAllApps ? 'All apps' : config.app || 'None'}\n`)
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

  function getStatusClass() {
    switch (perfetto.status) {
      case 'recording':
        return Style.statusRecording
      case 'completed':
        return Style.statusCompleted
      case 'error':
        return Style.statusError
      default:
        return Style.statusIdle
    }
  }

  function getStatusText() {
    switch (perfetto.status) {
      case 'recording':
        return t('traceRecording')
      case 'completed':
        return t('traceCompleted')
      case 'error':
        return t('traceError')
      default:
        return t('traceIdle')
    }
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
        <LunaToolbarText
          text={getStatusText()}
        />
      </LunaToolbar>
      <div className={className('panel-body', Style.content)}>
        {/* Basic Config */}
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('traceOutput')}</div>
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
        </div>

        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('traceDuration')} / {t('bufferSize')}</div>
          <div className={Style.configRow}>
            <span className={Style.configLabel}>{t('traceDuration')}</span>
            <input
              className={Style.configInput}
              value={perfetto.time}
              onChange={(e) => perfetto.setConfig('time', e.target.value)}
              disabled={isRecording}
              placeholder="10s / 5m / 1h"
            />
          </div>
          <div className={Style.configRow}>
            <span className={Style.configLabel}>{t('bufferSize')}</span>
            <input
              className={Style.configInput}
              value={perfetto.buffer}
              onChange={(e) =>
                perfetto.setConfig('buffer', e.target.value)
              }
              disabled={isRecording}
              placeholder="32mb / 64mb / 128mb"
            />
          </div>
        </div>

        {/* App Filter */}
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('appFilter')}</div>
          <div className={Style.appRow}>
            <label>
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
          </div>
          {!perfetto.traceAllApps && (
            <div className={Style.configRow}>
              <span className={Style.configLabel}>{t('customApp')}</span>
              <input
                className={Style.configInput}
                value={perfetto.app}
                onChange={(e) =>
                  perfetto.setConfig('app', e.target.value)
                }
                disabled={isRecording}
                placeholder="com.example.app"
              />
            </div>
          )}
        </div>

        {/* Options */}
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('settings')}</div>
          <div className={Style.appRow}>
            <label>
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
        </div>

        {/* Atrace Categories */}
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('atraceCategories')}</div>
          <div className={Style.selectActions}>
            <button
              className={Style.selectBtn}
              onClick={() => {
                if (perfetto.selectedEvents.length === ALL_ATRACE_CATEGORIES.length) {
                  perfetto.clearAllEvents()
                } else {
                  perfetto.setAllEvents()
                }
              }}
              disabled={isRecording}
            >
              {perfetto.selectedEvents.length === ALL_ATRACE_CATEGORIES.length ? t('deselectAll') : t('selectAll')}
            </button>
            <button
              className={Style.selectBtn}
              onClick={() => perfetto.setDefaultEvents()}
              disabled={isRecording}
            >
              {t('resetDefault')}
            </button>
          </div>
          <div className={Style.categoriesGrid}>
            {ALL_ATRACE_CATEGORIES.map((category) => (
              <div key={category} className={Style.categoryItem}>
                <input
                  type="checkbox"
                  id={`atrace-${category}`}
                  checked={perfetto.selectedEvents.includes(category)}
                  onChange={() => perfetto.toggleEvent(category)}
                  disabled={isRecording}
                />
                <label htmlFor={`atrace-${category}`}>{category}</label>
              </div>
            ))}
          </div>
        </div>

        {/* Log Output */}
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('traceLog')}</div>
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
