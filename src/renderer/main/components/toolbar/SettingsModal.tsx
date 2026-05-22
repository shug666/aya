import LunaModal from 'luna-modal/react'
import LunaSetting, {
  LunaSettingButton,
  LunaSettingCheckbox,
  LunaSettingSelect,
  LunaSettingHtml,
} from 'luna-setting/react'
import { notify } from 'share/renderer/lib/util'
import { t } from 'common/util'
import Style from './SettingsModal.module.scss'
import { createPortal } from 'react-dom'
import { observer } from 'mobx-react-lite'
import contain from 'licia/contain'
import debounce from 'licia/debounce'
import SettingPath from 'share/renderer/components/SettingPath'
import store from '../../store'
import { IModalProps } from 'share/common/types'
import { PanelConfig } from '../../store/settings'
import map from 'licia/map'
import clone from 'licia/clone'
import filter from 'licia/filter'
import className from 'licia/className'
import find from 'licia/find'
import { useState, useRef } from 'react'

const notifyRequireReload = debounce(() => {
  notify(t('requireReload'), { icon: 'info' })
}, 1000)

const TabManager = observer(function TabManager() {
  const panels = clone(store.settings.enabledPanels).sort(
    (a: PanelConfig, b: PanelConfig) => a.order - b.order
  )
  const dragRef = useRef<string | null>(null)

  function togglePanel(id: string) {
    const target = panels.find((p: PanelConfig) => p.id === id)
    if (target && target.enabled) {
      const enabledCount = filter(panels, (p: PanelConfig) => p.enabled).length
      if (enabledCount <= 1) {
        notify(t('lastTabWarning'), { icon: 'warn' })
        return
      }
    }
    const updated = map(store.settings.enabledPanels, (p: PanelConfig) => {
      if (p.id === id) {
        return { ...p, enabled: !p.enabled }
      }
      return { ...p }
    })
    store.settings.set('enabledPanels', updated)
  }

  function handleDragStart(id: string) {
    dragRef.current = id
  }

  function handleDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    if (!dragRef.current || dragRef.current === targetId) return
    const sorted = clone(store.settings.enabledPanels).sort(
      (a: PanelConfig, b: PanelConfig) => a.order - b.order
    )
    const from = find(sorted, (p: PanelConfig) => p.id === dragRef.current)
    const to = find(sorted, (p: PanelConfig) => p.id === targetId)
    if (!from || !to) return
    const tempOrder = from.order
    from.order = to.order
    to.order = tempOrder
    store.settings.set('enabledPanels', sorted)
  }

  function handleDragEnd() {
    dragRef.current = null
  }

  return (
    <div className={Style.tabManager}>
      {map(panels, (panel: PanelConfig) => (
        <div
          key={panel.id}
          className={Style.tabItem}
          draggable
          onDragStart={() => handleDragStart(panel.id)}
          onDragOver={(e) => handleDragOver(e, panel.id)}
          onDragEnd={handleDragEnd}
        >
          <span className={Style.dragHandle}>☰</span>
          <label className={Style.tabLabel}>
            <input
              type="checkbox"
              checked={panel.enabled}
              onChange={() => togglePanel(panel.id)}
            />
            <span>{t(panel.id)}</span>
          </label>
        </div>
      ))}
    </div>
  )
})

type SettingsSection = 'appearance' | 'tabs' | 'adb'

export default observer(function SettingsModal(props: IModalProps) {
  const [section, setSection] = useState<SettingsSection>('appearance')

  function onChange(key, val) {
    if (contain(['language', 'useNativeTitlebar'], key)) {
      notifyRequireReload()
    }
    store.settings.set(key, val)
  }

  const sections: Array<{ id: SettingsSection; label: string; icon: string }> =
    [
      { id: 'appearance', label: t('appearance'), icon: '🎨' },
      { id: 'tabs', label: t('tabManagement'), icon: '📑' },
      { id: 'adb', label: 'ADB', icon: '🔧' },
    ]

  return createPortal(
    <LunaModal
      title={t('settings')}
      width={560}
      visible={props.visible}
      onClose={props.onClose}
    >
      <div className={Style.layout}>
        <div className={Style.sidebar}>
          {sections.map((s) => (
            <div
              key={s.id}
              className={className(Style.navItem, {
                [Style.active]: section === s.id,
              })}
              onClick={() => setSection(s.id)}
            >
              <span className={Style.navIcon}>{s.icon}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className={Style.content}>
          {section === 'appearance' && (
            <LunaSetting className={Style.settings} onChange={onChange}>
              <LunaSettingSelect
                keyName="theme"
                value={store.settings.theme}
                title={t('theme')}
                options={{
                  [t('sysPreference')]: 'system',
                  [t('light')]: 'light',
                  [t('dark')]: 'dark',
                }}
              />
              <LunaSettingSelect
                keyName="language"
                value={store.settings.language}
                title={t('language')}
                options={{
                  [t('sysPreference')]: 'system',
                  ['العربية']: 'ar',
                  English: 'en-US',
                  ['Français']: 'fr',
                  ['Português']: 'pt',
                  ['Español']: 'es',
                  ['Русский']: 'ru',
                  ['Türkçe']: 'tr',
                  ['中文']: 'zh-CN',
                  ['繁體中文']: 'zh-TW',
                }}
              />
              <LunaSettingCheckbox
                keyName="useNativeTitlebar"
                value={store.settings.useNativeTitlebar}
                description={t('useNativeTitlebar')}
              />
            </LunaSetting>
          )}

          {section === 'tabs' && <TabManager />}

          {section === 'adb' && (
            <LunaSetting className={Style.settings} onChange={onChange}>
              <SettingPath
                title={t('adbPath')}
                value={store.settings.adbPath}
                onChange={(val) => {
                  notifyRequireReload()
                  store.settings.set('adbPath', val)
                }}
                options={{
                  properties: ['openFile'],
                }}
              />
              <LunaSettingCheckbox
                keyName="killAdbWhenExit"
                value={store.settings.killAdbWhenExit}
                description={t('killAdbWhenExit')}
              />
              <LunaSettingButton
                description={t('restartAya')}
                onClick={() => main.relaunch()}
              />
            </LunaSetting>
          )}
        </div>
      </div>
    </LunaModal>,
    document.body
  )
})
