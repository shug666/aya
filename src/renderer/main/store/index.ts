import { action, makeObservable, observable, runInAction } from 'mobx'
import isStr from 'licia/isStr'
import find from 'licia/find'
import BaseStore from 'share/renderer/store/BaseStore'
import { Settings } from './settings'
import { Application } from './application'
import { Process } from './process'
import { Webview } from './webview'
import { File } from './file'
import { Layout } from './layout'
import { Perfetto } from './perfetto'
import { installPackages, setMainStore } from '../../lib/util'
import { setMemStore } from 'share/renderer/lib/util'
import isEmpty from 'licia/isEmpty'
import { IDevice } from 'common/types'

class Store extends BaseStore {
  devices: IDevice[] = []
  device: IDevice | null = null
  // UI 连续性目标：device ?? lastDevice。lastDevice 在 device 非空时更新，
  // 使同一设备短暂断开（blip，A→null→A）期间 activeDevice 恒为 A，只有真正
  // 切换到另一台设备（A→B）时才改变。device 仍表达真实连接状态（null=未连接）。
  activeDevice: IDevice | null = null
  private lastDevice: IDevice | null = null
  panel: string = 'overview'
  settings = new Settings()
  application = new Application()
  process = new Process()
  webview = new Webview()
  file = new File()
  layout = new Layout()
  perfetto = new Perfetto()
  ready = false
  constructor() {
    super()

    makeObservable(this, {
      devices: observable,
      device: observable,
      activeDevice: observable,
      panel: observable,
      settings: observable,
      ready: observable,
      selectDevice: action,
      selectPanel: action,
    })

    this.bindEvent()
    this.init()
  }
  // 单点同步：device 非空时更新 lastDevice，并置 activeDevice = device ?? lastDevice。
  // 所有写 this.device 的路径在赋值后调用此函数，保证 activeDevice 永远等于
  // device ?? lastDevice，不存在不一致窗口。
  private syncActiveDevice() {
    if (this.device) {
      this.lastDevice = this.device
    }
    this.activeDevice = this.device ?? this.lastDevice
  }
  selectDevice = (device: string | IDevice | null) => {
    if (isStr(device)) {
      const d = find(this.devices, ({ id }) => id === device)
      if (d) {
        this.device = d
      }
    } else {
      this.device = device
    }

    this.syncActiveDevice()
    setMainStore('device', this.device)
  }
  selectPanel(panel: string) {
    const visiblePanels = this.settings.visiblePanels
    const isEnabled = find(visiblePanels, (p) => p.id === panel)
    if (isEnabled) {
      this.panel = panel
    } else if (visiblePanels.length > 0) {
      this.panel = visiblePanels[0].id
    }
    setMainStore('panel', this.panel)
  }
  private async init() {
    const panel = await main.getMainStore('panel')
    if (panel) {
      runInAction(() => (this.panel = panel))
    }

    const device = await main.getMainStore('device')
    if (device) {
      // 与原版一致：直接赋值 device（不调 setMainStore，避免恢复期多余 IPC），
      // 仅在此事务内同步 activeDevice，使 key 在设备就绪前已有稳定值。
      // 经 selectDevice 路径同样可行，但保持与原版字节级一致以最小化改动面。
      runInAction(() => {
        this.device = device
        this.syncActiveDevice()
      })
    }
    await this.refreshDevices()

    this.ready = true

    const openFile = await main.getOpenFile('.apk')
    if (openFile && this.device) {
      installPackages(this.device.id, [openFile])
    }
  }
  refreshDevices = async () => {
    const devices = await main.getDevices()
    runInAction(() => {
      this.devices = devices
      setMemStore('devices', devices)
    })
    if (!isEmpty(devices)) {
      if (!this.device) {
        this.selectDevice(devices[0])
      } else {
        const device = find(devices, ({ id }) => id === this.device!.id)
        if (!device) {
          this.selectDevice(devices[0])
        }
      }
    } else {
      if (this.device) {
        this.selectDevice(null)
      }
    }
  }
  private bindEvent() {
    main.on('changeDevice', this.refreshDevices)
    main.on('refreshDevices', this.refreshDevices)
    main.on('selectDevice', this.selectDevice)
    main.on('installPackage', async (path: string) => {
      if (this.device) {
        await installPackages(this.device.id, [path])
      }
    })
  }
}

export default new Store()
