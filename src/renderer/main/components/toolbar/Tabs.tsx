import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { observer } from 'mobx-react-lite'
import map from 'licia/map'
import { t } from 'common/util'
import Style from './Tabs.module.scss'
import store from '../../store'

export default observer(function Panels() {
  const tabItems = map(
    store.settings.visiblePanels,
    (panel) => {
      return (
        <LunaTabItem
          key={panel.id}
          id={panel.id}
          title={t(panel.id)}
          selected={panel.id === store.panel}
        />
      )
    }
  )

  return (
    <LunaTab
      className={Style.container}
      height={31}
      onSelect={(panel) => store.selectPanel(panel)}
    >
      {tabItems}
    </LunaTab>
  )
})

