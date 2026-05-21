import Toolbar from './components/toolbar/Toolbar'
import Logcat from './components/logcat/Logcat'
import Shell from './components/shell/Shell'
import Overview from './components/overview/Overview'
import Screenshot from './components/screenshot/Screenshot'
import Process from './components/process/Process'
import Performance from './components/performance/Performance'
import Webview from './components/webview/Webview'
import Application from './components/application/Application'
import File from './components/file/File'
import Layout from './components/layout/Layout'
import Perfetto from './components/perfetto/Perfetto'
import Gnirehtet from './components/gnirehtet/Gnirehtet'
import Style from './App.module.scss'
import { useState, PropsWithChildren, FC, ComponentType } from 'react'
import store from './store'
import { observer } from 'mobx-react-lite'
import { useCheckUpdate } from 'share/renderer/lib/hooks'
import { t } from 'common/util'
import find from 'licia/find'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'

const panelComponents: Record<string, ComponentType> = {
  overview: Overview,
  application: Application,
  screenshot: Screenshot,
  logcat: Logcat,
  shell: Shell,
  process: Process,
  performance: Performance,
  webview: Webview,
  file: File,
  layout: Layout,
  perfetto: Perfetto,
  gnirehtet: Gnirehtet,
}

export default observer(function App() {
  useCheckUpdate('https://aya.liriliri.io')

  const visiblePanels = store.settings.visiblePanels

  return (
    <>
      <Toolbar />
      {store.ready && (
        <div className={Style.workspace}>
          {isEmpty(visiblePanels) ? (
            <div className={Style.emptyState}>
              {t('noTabsEnabled')}
            </div>
          ) : (
            <div
              className={Style.panels}
              key={store.device ? store.device.id : ''}
            >
              {map(visiblePanels, (panel) => {
                const Component = panelComponents[panel.id]
                if (!Component) return null
                return (
                  <Panel key={panel.id} panel={panel.id}>
                    <Component />
                  </Panel>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
})

interface IPanelProps {
  panel: string
}

const Panel: FC<PropsWithChildren<IPanelProps>> = observer(function Panel(
  props
) {
  const [used, setUsed] = useState(false)

  const isEnabled = !!find(
    store.settings.enabledPanels,
    (p) => p.id === props.panel && p.enabled
  )

  if (!isEnabled) {
    return null
  }

  let visible = false

  if (store.panel === props.panel) {
    if (!used) {
      setUsed(true)
    }
    visible = true
  }

  const style: React.CSSProperties = {}
  if (!visible) {
    style.opacity = 0
    style.pointerEvents = 'none'
  }

  return (
    <div className={Style.panel} style={style}>
      {used ? props.children : null}
    </div>
  )
})

