import { app } from 'electron'
import childProcess, { ChildProcess } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'fs-extra'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import { getAdbPath, spawnAdb } from './base'
import {
  buildTraceConfigText,
  buildBoottraceConfigText,
} from './perfettoConfig'
import log from 'share/common/log'
import {
  IBoottraceResult,
  IPerfettoTraceConfig,
  IpcExportBoottraceConfig,
  IpcExportPerfettoConfig,
  IpcStartPerfettoTrace,
  IpcStopPerfettoTrace,
} from 'common/types'

const logger = log('perfetto')

interface IPerfettoSession {
  proc: ChildProcess
  config: IPerfettoTraceConfig
  configPath: string
}

const sessions: Record<string, IPerfettoSession> = {}

function getScriptPath() {
  return resolveResources('record_android_trace')
}

// Build args for the unified txtpb capture path (record_android_trace -c).
// Short options (-t/-b/-a*/events) are no longer used; all config lives in the
// txtpb temp file referenced by -c.
function buildArgs(config: IPerfettoTraceConfig, configPath: string): string[] {
  const args: string[] = []

  // Output path
  args.push('-o', config.outputPath)

  // Don't open in browser (if disabled)
  if (config.noOpen) {
    args.push('-n')
  }

  // Device serial
  args.push('-s', config.deviceId)

  // Trace config (text-proto)
  args.push('-c', configPath)

  return args
}

function removeConfigFile(configPath: string) {
  if (!configPath) return
  fs.unlink(configPath, (err) => {
    if (err) logger.debug('remove temp config failed:', err.message)
  })
}

const startPerfettoTrace: IpcStartPerfettoTrace = async function (config) {
  const sessionId = uniqId('perfetto')
  const scriptPath = getScriptPath()

  // Generate the txtpb and write it to a temp file for `record_android_trace -c`.
  const configText = buildTraceConfigText(config)
  const configPath = path.join(
    os.tmpdir(),
    `perfetto-config-${sessionId}.txtpb`,
  )
  await fs.writeFile(configPath, configText, 'utf8')

  const args = buildArgs(config, configPath)
  logger.info('start trace', scriptPath, args)

  const adbDir = path.dirname(getAdbPath())
  const env = {
    ...process.env,
    PATH: `${adbDir}${path.delimiter}${process.env.PATH || ''}`,
  }

  const proc = childProcess.spawn('python3', [scriptPath, ...args], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  sessions[sessionId] = { proc, config, configPath }

  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString()
    logger.debug('stdout:', text)
    window.sendAll('perfettoTraceOutput', sessionId, text)
  })

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString()
    logger.debug('stderr:', text)
    window.sendAll('perfettoTraceOutput', sessionId, text)
  })

  proc.on('error', (err) => {
    logger.error('process error:', err)
    window.sendAll('perfettoTraceExit', sessionId, -1, err.message)
    removeConfigFile(configPath)
    delete sessions[sessionId]
  })

  proc.on('close', (code) => {
    logger.info('process exited with code:', code)
    window.sendAll('perfettoTraceExit', sessionId, code || 0, '')
    removeConfigFile(configPath)
    delete sessions[sessionId]
  })

  return sessionId
}

const stopPerfettoTrace: IpcStopPerfettoTrace = async function (sessionId) {
  const session = sessions[sessionId]
  if (session && session.proc) {
    logger.info('stopping trace:', sessionId)
    session.proc.kill('SIGINT')
  }
}

const exportPerfettoConfig: IpcExportPerfettoConfig = async function (
  config,
  savePath,
) {
  const text = buildTraceConfigText(config)
  await fs.writeFile(savePath, text, 'utf8')
  logger.info('exported perfetto config to', savePath)
}

const REMOTE_BOOTTRACE_CONFIG = '/data/misc/perfetto-configs/boottrace.pbtxt'

const exportBoottraceConfig: IpcExportBoottraceConfig = async function (
  config,
  savePath,
) {
  // 1. Generate + write the boot-trace config locally.
  const text = buildBoottraceConfigText(config)
  await fs.writeFile(savePath, text, 'utf8')
  logger.info('exported boottrace config to', savePath)

  const result: IBoottraceResult = { pushed: false, verified: false }

  // 2. Try to gain root (best-effort, matches record_android_trace behavior).
  await spawnAdb(['root'])

  // 3. Ensure the remote config directory exists.
  const mkdir = await spawnAdb([
    'shell',
    'mkdir',
    '-p',
    '/data/misc/perfetto-configs',
  ])
  if (mkdir.code !== 0 && !/already/.test(mkdir.stderr)) {
    logger.error('boottrace mkdir failed', mkdir.stderr)
    return result
  }

  // 4. Push the config to the device.
  const push = await spawnAdb(['push', savePath, REMOTE_BOOTTRACE_CONFIG])
  if (push.code !== 0) {
    logger.error('boottrace push failed', push.stderr)
    return result
  }
  result.pushed = true

  // 5. Enable boot tracing via the persistent property.
  const setprop = await spawnAdb([
    'shell',
    'setprop',
    'persist.debug.perfetto.boottrace',
    '1',
  ])
  if (setprop.code !== 0) {
    logger.error('boottrace setprop failed', setprop.stderr)
    return result
  }

  // 6. Verify the property was set.
  const getprop = await spawnAdb([
    'shell',
    'getprop',
    'persist.debug.perfetto.boottrace',
  ])
  result.verified = getprop.stdout.trim() === '1'
  if (!result.verified) {
    logger.error('boottrace verify failed:', getprop.stdout.trim())
  }
  logger.info('boottrace pushed=%s verified=%s', result.pushed, result.verified)
  return result
}

function cleanup() {
  for (const sessionId in sessions) {
    const session = sessions[sessionId]
    if (session.proc && !session.proc.killed) {
      logger.info('cleanup: killing', sessionId)
      session.proc.kill('SIGINT')
    }
    removeConfigFile(session.configPath)
  }
}

export function init() {
  logger.info('init')

  app.on('will-quit', () => {
    cleanup()
  })

  handleEvent('startPerfettoTrace', startPerfettoTrace)
  handleEvent('stopPerfettoTrace', stopPerfettoTrace)
  handleEvent('exportPerfettoConfig', exportPerfettoConfig)
  handleEvent('exportBoottraceConfig', exportBoottraceConfig)
}
