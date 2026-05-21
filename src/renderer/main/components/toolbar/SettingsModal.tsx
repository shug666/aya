import LunaModal from 'luna-modal/react'
import LunaSetting, {
  LunaSettingButton,
  LunaSettingCheckbox,
  LunaSettingSelect,
  LunaSettingSeparator,
  LunaSettingTitle,
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

const notifyRequireReload = debounce(() => {
  notify(t('requireReload'), { icon: 'info' })
}, 1000)

const TabManager = observer(function TabManager() {
  const panels = clone(store.settings.enabledPanels).sort(
    (a: PanelConfig, b: PanelConfig) => a.order - b.order
  )

  function togglePanel(id: string) {
    const updated = map(store.settings.enabledPanels, (p: PanelConfig) => {
      if (p.id === id) {
        return { ...p, enabled: !p.enabled }
      }
      return { ...p }
    })
    store.settings.set('enabledPanels', updated)
  }

  function movePanel(id: string, direction: number) {
    const sorted = clone(store.settings.enabledPanels).sort(
      (a: PanelConfig, b: PanelConfig) => a.order - b.order
    )
    const idx = sorted.findIndex((p: PanelConfig) => p.id === id)
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= sorted.length) return

    const tempOrder = sorted[idx].order
    sorted[idx].order = sorted[targetIdx].order
    sorted[targetIdx].order = tempOrder

    store.settings.set('enabledPanels', sorted)
  }

  return (
    <div className={Style.tabManager}>
      {map(panels, (panel: PanelConfig, idx: number) => (
        <div key={panel.id} className={Style.tabItem}>
          <label className={Style.tabLabel}>
            <input
              type="checkbox"
              checked={panel.enabled}
              onChange={() => togglePanel(panel.id)}
            />
            <span>{t(panel.id)}</span>
          </label>
          <div className={Style.tabActions}>
            <button
              className={Style.tabBtn}
              disabled={idx === 0}
              onClick={() => movePanel(panel.id, -1)}
              title={t('moveUp')}
            >
              ↑
            </button>
            <button
              className={Style.tabBtn}
              disabled={idx === panels.length - 1}
              onClick={() => movePanel(panel.id, 1)}
              title={t('moveDown')}
            >
              ↓
            </button>
          </div>
        </div>
      ))}
    </div>
  )
})

export default observer(function SettingsModal(props: IModalProps) {
  function onChange(key, val) {
    if (contain(['language', 'useNativeTitlebar'], key)) {
      notifyRequireReload()
    }
    store.settings.set(key, val)
  }

  return createPortal(
    <LunaModal
      title={t('settings')}
      width={400}
      visible={props.visible}
      onClose={props.onClose}
    >
      <LunaSetting className={Style.settings} onChange={onChange}>
        <LunaSettingTitle title={t('appearance')} />
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
        <LunaSettingSeparator />
        <LunaSettingTitle title={t('tabManagement')} />
        <LunaSettingHtml>
          <TabManager />
        </LunaSettingHtml>
        <LunaSettingSeparator />
        <LunaSettingTitle title="ADB" />
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
    </LunaModal>,
    document.body
  )
})

