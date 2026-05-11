import { observer } from 'mobx-react-lite'
import { useState, useEffect, useRef } from 'react'
import LunaToolbar, { LunaToolbarSpace, LunaToolbarText } from 'luna-toolbar/react'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { t } from 'common/util'
import store from '../../store'
import className from 'licia/className'
import Style from './Gnirehtet.module.scss'

export default observer(function Gnirehtet() {
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!store.device) return

    const offOutput = main.on('gnirehtetOutput', (deviceId: string, text: string) => {
      if (store.device && deviceId === store.device.id) {
        setLogs(prev => [...prev, text])
      }
    })

    return () => {
      offOutput()
    }
  }, [store.device])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs.length])

  const handleStart = async () => {
    if (!store.device) return
    setLogs([])
    setRunning(true)
    try {
      await main.startGnirehtet(store.device.id)
    } catch (err: any) {
      setLogs(prev => [...prev, `Failed to start: ${err.message}\n`])
      setRunning(false)
    }
  }

  const handleStop = async () => {
    if (!store.device) return
    try {
      await main.stopGnirehtet(store.device.id)
    } catch (err: any) {
      setLogs(prev => [...prev, `Failed to stop: ${err.message}\n`])
    }
    setRunning(false)
  }

  return (
    <div className={className('panel-with-toolbar', Style.container)}>
      <LunaToolbar className="panel-toolbar">
        {!running ? (
          <ToolbarIcon
            icon="play"
            title={t('startReverseTethering')}
            onClick={handleStart}
            disabled={!store.device}
          />
        ) : (
          <ToolbarIcon
            icon="square"
            title={t('stopReverseTethering')}
            onClick={handleStop}
          />
        )}
        <LunaToolbarSpace />
        <LunaToolbarText text={running ? t('gnirehtetRunning') : t('gnirehtetStopped')} />
      </LunaToolbar>
      <div className={className('panel-body', Style.content)}>
        <div className={Style.section}>
          <div className={Style.sectionTitle}>{t('gnirehtetTitle')}</div>
          <p style={{ fontSize: 12, color: 'var(--color-text)' }}>{t('gnirehtetDesc')}</p>
        </div>
        <div className={Style.section} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div className={Style.sectionTitle}>{t('gnirehtetLog')}</div>
          <div className={Style.logContainer} ref={logRef}>
            {logs.length > 0 ? logs.join('') : t('gnirehtetStopped')}
          </div>
        </div>
      </div>
    </div>
  )
})
