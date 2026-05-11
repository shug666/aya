import { Client } from '@devicefarmer/adbkit'
import { shell } from './base'
import singleton from 'licia/singleton'
import map from 'licia/map'
import trim from 'licia/trim'
import contain from 'licia/contain'
import fs from 'fs'
import path from 'path'
import { pullFile } from './file'
import { handleEvent } from 'share/main/lib/util'
import {
  IpcClearPackage,
  IpcDisablePackage,
  IpcEnablePackage,
  IpcGetPackages,
  IpcGetTopPackage,
  IpcExportApks,
  IpcInstallPackage,
  IpcStartPackage,
  IpcStopPackage,
  IpcUninstallPackage,
} from 'common/types'

let client: Client

const getCurrentUser = singleton(async (deviceId: string) => {
  const result = await shell(deviceId, 'am get-current-user')
  return parseInt(result, 10)
})

export const getPackages = singleton(<IpcGetPackages>(async (
  deviceId,
  system = true
) => {
  const result: string = await shell(
    deviceId,
    `pm list packages${system ? '' : ' -3'} --user ${await getCurrentUser(
      deviceId
    )}`
  )

  return map(trim(result).split('\n'), (line) => line.slice(8))
}))

const stopPackage: IpcStopPackage = async function (deviceId, pkg) {
  await shell(deviceId, `am force-stop ${pkg}`)
}

const clearPackage: IpcClearPackage = async function (deviceId, pkg) {
  const device = await client.getDevice(deviceId)
  await device.clear(pkg)
}

const startPackage: IpcStartPackage = async function (deviceId, pkg) {
  const component = await getMainComponent(deviceId, pkg)
  const device = await client.getDevice(deviceId)
  await device.startActivity({
    component,
  })
}

const installPackage: IpcInstallPackage = async function (deviceId, apkPath) {
  const device = await client.getDevice(deviceId)
  await device.install(apkPath)
}

const exportApks: IpcExportApks = async function (deviceId, pkg, destDir, folderName) {
  const finalDestDir = path.join(destDir, folderName)
  fs.mkdirSync(finalDestDir, { recursive: true })
  
  const result = await shell(deviceId, `pm path ${pkg}`)
  const lines = result.split('\n').map((l: string) => trim(l)).filter((l: string) => l.startsWith('package:'))
  const paths = lines.map((l: string) => l.replace('package:', ''))
  
  if (paths.length === 0) {
    throw new Error('No APK paths found for package ' + pkg)
  }

  const filenames: string[] = []
  
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    let filename = p.split('/').pop() || `unknown_${i}.apk`
    if (!filename.endsWith('.apk')) {
      filename += '.apk'
    }
    filenames.push(filename)
    await pullFile(deviceId, p, path.join(finalDestDir, filename))
  }

  // Create install.sh
  const shScript = `#!/bin/bash
echo "Installing ${pkg}..."
adb install-multiple ${filenames.map(f => `"${f}"`).join(' ')}
echo "Done."
`
  fs.writeFileSync(path.join(finalDestDir, 'install.sh'), shScript)
  fs.chmodSync(path.join(finalDestDir, 'install.sh'), 0o755)

  // Create install.bat
  const batScript = `@echo off
echo Installing ${pkg}...
adb install-multiple ${filenames.map(f => `"${f}"`).join(' ')}
echo Done.
pause
`
  fs.writeFileSync(path.join(finalDestDir, 'install.bat'), batScript)

  // Create README.txt
  const readme = `APK Export for ${pkg}
===================

This directory contains the split APKs for the application.
To install this application on a device, ensure \`adb\` is in your system PATH and the device is connected.

For Windows:
Double-click \`install.bat\` or run it from the command line.

For Mac/Linux:
Run \`./install.sh\` from the command line.
`
  fs.writeFileSync(path.join(finalDestDir, 'README.txt'), readme)
}

const uninstallPackage: IpcUninstallPackage = async function (deviceId, pkg) {
  const device = await client.getDevice(deviceId)
  await device.uninstall(pkg)
}

async function getMainComponent(deviceId: string, pkg: string) {
  const result = await shell(
    deviceId,
    `dumpsys package ${pkg} | grep -A 1 MAIN`
  )
  const lines = result.split('\n')
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = trim(lines[i])
    if (contain(line, `${pkg}/`)) {
      return line.substring(line.indexOf(`${pkg}/`), line.indexOf(' filter'))
    }
  }

  throw new Error('Failed to get main activity')
}

export const getTopPackage = singleton(<IpcGetTopPackage>(
  async function (deviceId) {
    const topActivity = await shell(deviceId, 'dumpsys activity')
    const lines = topActivity.split('\n')
    let line = ''
    for (let i = 0, len = lines.length; i < len; i++) {
      if (contain(lines[i], 'top-activity')) {
        line = trim(lines[i])
        break
      }
    }

    if (!line) {
      return {
        name: '',
        pid: 0,
      }
    }

    let parts = line.split(/\s+/)
    parts = parts[parts.length - 2].split(':')
    const pid = parseInt(parts[0], 10)
    let name = parts[1]
    if (contain(name, '/')) {
      name = name.split('/')[0]
    }

    return {
      name,
      pid,
    }
  }
))

const disablePackage: IpcDisablePackage = async function (deviceId, pkg) {
  await shell(deviceId, `pm disable-user ${pkg}`)
}

const enablePackage: IpcEnablePackage = async function (deviceId, pkg) {
  await shell(deviceId, `pm enable ${pkg}`)
}

export async function init(c: Client) {
  client = c

  handleEvent('getPackages', getPackages)
  handleEvent('stopPackage', stopPackage)
  handleEvent('startPackage', startPackage)
  handleEvent('exportApks', exportApks)
  handleEvent('installPackage', installPackage)
  handleEvent('uninstallPackage', uninstallPackage)
  handleEvent('getTopPackage', getTopPackage)
  handleEvent('clearPackage', clearPackage)
  handleEvent('disablePackage', disablePackage)
  handleEvent('enablePackage', enablePackage)
}
