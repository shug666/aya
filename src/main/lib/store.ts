import memoize from 'licia/memoize'
import FileStore from 'licia/FileStore'
import { getUserDataPath } from 'share/main/lib/util'

export const getMainStore = memoize(function () {
  return new FileStore(getUserDataPath('data/main.json'), {})
})

export const getScreencastStore = memoize(function () {
  return new FileStore(getUserDataPath('data/screencast.json'), {
    settings: {},
    alwaysOnTop: false,
  })
})

export const getDevicesStore = memoize(function () {
  return new FileStore(getUserDataPath('data/devices.json'), {
    remoteDevices: [],
  })
})

export const getSettingsStore = memoize(function () {
  return new FileStore(getUserDataPath('data/settings.json'), {
    language: 'system',
    theme: 'system',
    useNativeTitlebar: false,
    adbPath: '',
    killAdbWhenExit: false,
  })
})

export const getShellStore = memoize(function () {
  return new FileStore(getUserDataPath('data/shell.json'), {
    categories: [
      { id: 'system', name: 'systemOps', builtin: true, order: 0 },
      { id: 'debug', name: 'debugInfo', builtin: true, order: 1 },
      { id: 'tools', name: 'tools', builtin: true, order: 2 },
    ],
    commands: [
      {
        id: 'reboot',
        title: 'reboot',
        description: '',
        command: 'reboot',
        categoryId: 'system',
        builtin: true,
        order: 0,
      },
      {
        id: 'reboot-recovery',
        title: 'rebootRecovery',
        description: '',
        command: 'reboot recovery',
        categoryId: 'system',
        builtin: true,
        order: 1,
      },
      {
        id: 'reboot-bootloader',
        title: 'rebootBootloader',
        description: '',
        command: 'reboot bootloader',
        categoryId: 'system',
        builtin: true,
        order: 2,
      },
      {
        id: 'mem-info',
        title: 'memInfo',
        description: '',
        command: 'dumpsys meminfo',
        categoryId: 'debug',
        builtin: true,
        order: 0,
      },
      {
        id: 'battery-info',
        title: 'batteryInfo',
        description: '',
        command: 'dumpsys battery',
        categoryId: 'debug',
        builtin: true,
        order: 1,
      },
      {
        id: 'start-shizuku',
        title: 'startShizuku',
        description: '',
        command:
          'sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh',
        categoryId: 'tools',
        builtin: true,
        order: 0,
      },
      {
        id: 'grant-gkd',
        title: 'grantGKD',
        description: '',
        command:
          'pm grant li.songe.gkd android.permission.WRITE_SECURE_SETTINGS; appops set li.songe.gkd ACCESS_RESTRICTED_SETTINGS allow',
        categoryId: 'tools',
        builtin: true,
        order: 1,
      },
    ],
  })
})
