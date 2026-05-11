import LunaModal from 'luna-modal/react'
import { observer } from 'mobx-react-lite'
import { createPortal } from 'react-dom'
import LunaSetting, {
  LunaSettingButton,
  LunaSettingNumber,
  LunaSettingSelect,
} from 'luna-setting/react'
import { t } from 'common/util'
import Style from './SettingsModal.module.scss'
import toStr from 'licia/toStr'
import toNum from 'licia/toNum'
import clamp from 'licia/clamp'
import store from '../store'
import { IModalProps } from 'share/common/types'

function calcBitRate(maxSize: number, maxFps: number): number {
  const effectiveSize = maxSize || 1080
  const effectiveFps = maxFps || 30
  const bitRate = 8 * (effectiveSize / 1080) * (effectiveFps / 30)
  return clamp(Math.round(bitRate), 1, 100)
}

export default observer(function SettingsModal(props: IModalProps) {
  function onChange(key, val) {
    if (key === 'videoBitRate') {
      val *= 1000000
    } else if (key === 'maxSize') {
      val = toNum(val)
    } else if (key === 'maxFps') {
      val = toNum(val)
    }
    store.setSettings(key, val)

    if (key === 'maxSize' || key === 'maxFps') {
      const currentMaxSize = key === 'maxSize' ? val : store.settings.maxSize
      const currentMaxFps = key === 'maxFps' ? val : store.settings.maxFps
      const recommendedBitRate = calcBitRate(currentMaxSize, currentMaxFps)
      store.setSettings('videoBitRate', recommendedBitRate * 1000000)
    }
  }

  return createPortal(
    <LunaModal
      title={t('settings')}
      width={400}
      visible={props.visible}
      onClose={props.onClose}
    >
      <LunaSetting className={Style.settings} onChange={onChange}>
        <LunaSettingNumber
          keyName="videoBitRate"
          range={true}
          value={Math.floor(store.settings.videoBitRate / 1000000)}
          title={`${t('videoBitRate')} Mbps`}
          min={1}
          max={100}
        />
        <LunaSettingSelect
          keyName="maxSize"
          value={toStr(store.settings.maxSize)}
          title={t('resolution')}
          options={{
            640: '640',
            720: '720',
            1080: '1080',
            1280: '1280',
            1920: '1920',
            [t('actualSize')]: '0',
          }}
        />
        <LunaSettingSelect
          keyName="maxFps"
          value={toStr(store.settings.maxFps)}
          title={t('maxFps')}
          options={{
            [t('unlimited')]: '0',
            15: '15',
            24: '24',
            30: '30',
            60: '60',
            120: '120',
          }}
        />
        <LunaSettingButton
          description={t('restart')}
          onClick={() => main.restartScreencast()}
        />
      </LunaSetting>
    </LunaModal>,
    document.body
  )
})
