import { app } from 'electron'
import childProcess, { ChildProcess } from 'node:child_process'
import path from 'node:path'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { handleEvent, resolveResources } from 'share/main/lib/util'
import log from 'share/common/log'
import {
  IPerfettoTraceConfig,
  IpcStartPerfettoTrace,
  IpcStopPerfettoTrace,
} from 'common/types'

const logger = log('perfetto')

interface IPerfettoSession {
  proc: ChildProcess
  config: IPerfettoTraceConfig
}

const sessions: Record<string, IPerfettoSession> = {}

function getScriptPath() {
  return resolveResources('record_android_trace')
}

function buildArgs(config: IPerfettoTraceConfig): string[] {
  const args: string[] = []

  // Output path
  args.push('-o', config.outputPath)

  // Duration
  args.push('-t', config.time)

  // Buffer size
  args.push('-b', config.buffer)

  // Don't open in browser (if disabled)
  if (config.noOpen) {
    args.push('-n')
  }

  // Device serial
  args.push('-s', config.deviceId)

  // Atrace events
  for (const event of config.events) {
    args.push(event)
  }

  // App filter
  if (config.traceAllApps) {
    args.push('-a*')
  } else if (config.app) {
    args.push('-a', config.app)
  }

  return args
}

const startPerfettoTrace: IpcStartPerfettoTrace = async function (config) {
  const sessionId = uniqId('perfetto')
  const scriptPath = getScriptPath()
  const args = buildArgs(config)

  logger.info('start trace', scriptPath, args)

  const proc = childProcess.spawn('python3', [scriptPath, ...args], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  sessions[sessionId] = { proc, config }

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
    delete sessions[sessionId]
  })

  proc.on('close', (code) => {
    logger.info('process exited with code:', code)
    window.sendAll('perfettoTraceExit', sessionId, code || 0, '')
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

function cleanup() {
  for (const sessionId in sessions) {
    const session = sessions[sessionId]
    if (session.proc && !session.proc.killed) {
      logger.info('cleanup: killing', sessionId)
      session.proc.kill('SIGINT')
    }
  }
}

export function init() {
  logger.info('init')

  app.on('will-quit', () => {
    cleanup()
  })

  handleEvent('startPerfettoTrace', startPerfettoTrace)
  handleEvent('stopPerfettoTrace', stopPerfettoTrace)
}
