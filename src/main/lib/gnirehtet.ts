import { app } from 'electron'
import { spawn, ChildProcess, execFile, exec } from 'child_process'
import path from 'path'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import { IpcStartGnirehtet, IpcStopGnirehtet } from 'common/types'
import log from 'share/common/log'

import * as window from 'share/main/lib/window'

const logger = log('gnirehtet')

const activeProcesses = new Map<string, ChildProcess>()

function getGnirehtetDir() {
  return resolveResources('gnirehtet-java')
}

function killOrphanedRelay(): Promise<void> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' 
      ? `FOR /F "tokens=5" %i IN ('netstat -a -n -o ^| findstr :31416') DO TaskKill.exe /F /PID %i`
      : `kill $(lsof -t -i:31416) 2>/dev/null || true`
    exec(cmd, () => resolve())
  })
}

const startGnirehtet: IpcStartGnirehtet = async function (deviceId: string) {
  if (activeProcesses.has(deviceId)) {
    logger.info(`gnirehtet already running for ${deviceId}`)
    return
  }

  const gnirehtetDir = getGnirehtetDir()
  const scriptPath = path.join(gnirehtetDir, 'gnirehtet')

  logger.info(`Starting gnirehtet run for ${deviceId}...`)
  window.sendAll('gnirehtetOutput', deviceId, `Starting gnirehtet run for ${deviceId}...\n`)

  // Ensure any orphaned relay server is killed before starting
  await killOrphanedRelay()

  let child: ChildProcess;
  try {
    child = spawn('java', ['-jar', 'gnirehtet.jar', 'run', deviceId], {
      cwd: gnirehtetDir
    })
  } catch (err: any) {
    logger.error(`Spawn error: ${err.message}`)
    window.sendAll('gnirehtetOutput', deviceId, `Spawn error: ${err.message}\n`)
    return
  }

  child.stdout?.on('data', (data) => {
    window.sendAll('gnirehtetOutput', deviceId, data.toString())
  })

  child.stderr?.on('data', (data) => {
    window.sendAll('gnirehtetOutput', deviceId, data.toString())
  })

  child.on('error', (err) => {
    logger.error(`Failed to start gnirehtet: ${err.message}`)
    window.sendAll('gnirehtetOutput', deviceId, `Error: ${err.message}\n`)
    activeProcesses.delete(deviceId)
  })

  child.on('close', (code) => {
    logger.info(`gnirehtet exited for ${deviceId} with code ${code}`)
    window.sendAll('gnirehtetOutput', deviceId, `\nProcess exited with code ${code}\n`)
    activeProcesses.delete(deviceId)
  })

  activeProcesses.set(deviceId, child)
}

const stopGnirehtet: IpcStopGnirehtet = async function (deviceId: string) {
  logger.info(`Stopping gnirehtet for ${deviceId}...`)
  window.sendAll('gnirehtetOutput', deviceId, `Stopping gnirehtet for ${deviceId}...\n`)
  const gnirehtetDir = getGnirehtetDir()
  const scriptPath = path.join(gnirehtetDir, 'gnirehtet')
  
  execFile('java', ['-jar', 'gnirehtet.jar', 'stop', deviceId], { cwd: gnirehtetDir }, (error, stdout, stderr) => {
    if (error) {
      logger.error(`Failed to execute stop command: ${error.message}`)
      window.sendAll('gnirehtetOutput', deviceId, `Failed to execute stop command: ${error.message}\n`)
    } else {
      logger.info(`gnirehtet stopped via command for ${deviceId}`)
      if (stdout) window.sendAll('gnirehtetOutput', deviceId, stdout.toString())
      if (stderr) window.sendAll('gnirehtetOutput', deviceId, stderr.toString())
    }
  })

  const child = activeProcesses.get(deviceId)
  if (child) {
    window.sendAll('gnirehtetOutput', deviceId, `Killing active process...\n`)
    child.kill('SIGINT')
    activeProcesses.delete(deviceId)
  }
}

export function init() {
  handleEvent('startGnirehtet', startGnirehtet)
  handleEvent('stopGnirehtet', stopGnirehtet)

  app.on('will-quit', () => {
    for (const [deviceId, child] of activeProcesses.entries()) {
      if (child && !child.killed) {
        logger.info(`cleanup: killing gnirehtet for ${deviceId}`)
        child.kill('SIGINT')
      }
    }
  })
}
