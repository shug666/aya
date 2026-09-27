import types from 'licia/types'
import Emitter from 'licia/Emitter'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { Client } from '@devicefarmer/adbkit'
import { handleEvent } from 'share/main/lib/util'
import {
  IpcCreateShell,
  IpcKillShell,
  IpcResizeShell,
  IpcWriteShell,
} from 'common/types'

let client: Client

class ShellProtocol {
  static STDIN = 0
  static STDOUT = 1
  static STDERR = 2
  static EXIT = 3
  static CLOSE_STDIN = 4
  static WINDOW_SIZE_CHANGE = 5

  static encodeData(id, data) {
    data = Buffer.from(data, 'utf8')
    const buf = Buffer.alloc(5 + data.length)
    buf.writeUInt8(id, 0)
    buf.writeUInt32LE(data.length, 1)
    data.copy(buf, 5)

    return buf
  }

  static decodeData(buf) {
    const result: Array<{
      id: number
      data: Buffer
    }> = []

    for (let i = 0, len = buf.length; i < len; ) {
      const id = buf.readUInt8(i)
      const len = buf.readUInt32LE(i + 1)
      const data = buf.slice(i + 5, i + 5 + len)
      result.push({
        id,
        data,
      })
      i += 5 + len
    }

    return result
  }
}

class Protocol {
  static OKAY = 'OKAY'

  static encodeLength(length) {
    return length.toString(16).padStart(4, '0').toUpperCase()
  }

  static encodeData(data) {
    const len = Protocol.encodeLength(data.length)
    return Buffer.concat([Buffer.from(len), data])
  }
}

class AdbPty extends Emitter {
  private connection: any
  private useV2 = true
  // 区分「主动 kill」与「非预期死亡」。kill() 先置 true 再 end()，使得
  // end() 触发的 socket close 被下方 close 监听识别为主动结束而不发
  // 'close' 事件；只有设备重启等非预期拆 socket 时才置此处并 emit。
  private closed = false
  constructor(connection: any) {
    super()

    this.connection = connection
  }
  async init(useV2 = true) {
    const { connection } = this

    this.useV2 = useV2
    const protocol = useV2 ? 'shell,v2:' : 'shell:'
    connection.write(Protocol.encodeData(Buffer.from(protocol)))
    const result = await connection.parser.readAscii(4)
    if (result !== Protocol.OKAY) {
      throw new Error('Failed to create shell')
    }

    if (useV2) {
      const { socket } = connection
      socket.on('readable', () => {
        const buf = socket.read()
        if (buf) {
          const packets = ShellProtocol.decodeData(buf)
          for (let i = 0, len = packets.length; i < len; i++) {
            const { id, data } = packets[i]
            // Forward only stdout into the data stream. stderr (id === STDERR)
            // is not forwarded, matching the pre-colorization behavior.
            // EXIT/CLOSE_STDIN/WINDOW_SIZE_CHANGE control packets are ignored.
            if (id === ShellProtocol.STDOUT) {
              this.emit('data', data.toString('utf8'))
            }
          }
        }
      })
    } else {
      const { socket } = connection
      socket.on('readable', () => {
        const buf = socket.read()
        if (buf) {
          this.emit('data', buf.toString('utf8'))
        }
      })
    }

    // 监听会话死亡。监听 connection 而非裸 socket：adbkit Connection
    // (connection.js) 已把 socket 的 close/end/error 透传到自身，且
    // AdbPty.connection 即此 Connection。close/end/error 三者可能在一次
    // 死亡中先后触发，靠 closed 标志去重——首次进入置 true 并 emit，
    // 后续事件见已置即 return。主动 kill 路径已先置 closed=true，故不 emit。
    const onDead = () => {
      if (this.closed) {
        return
      }
      this.closed = true
      this.emit('close')
    }
    connection.on('close', onDead)
    connection.on('end', onDead)
    connection.on('error', onDead)
  }
  resize(cols: number, rows: number) {
    if (this.useV2) {
      this.connection.socket.write(
        ShellProtocol.encodeData(
          ShellProtocol.WINDOW_SIZE_CHANGE,
          Buffer.from(`${rows}x${cols},0x0\0`)
        )
      )
    }
  }
  write(data: string) {
    if (this.useV2) {
      this.connection.socket.write(
        ShellProtocol.encodeData(ShellProtocol.STDIN, Buffer.from(data))
      )
    } else {
      this.connection.socket.write(Buffer.from(data))
    }
  }
  kill() {
    // end() 会触发 socket close；先置 closed=true，使下方 onDead 监听
    // 识别为主动结束而不 emit('close')，避免主动重置误触发自动重建。
    this.closed = true
    this.connection.end()
  }
}

const ptys: types.PlainObj<AdbPty> = {}

const createShell: IpcCreateShell = async function (deviceId, isReconnect) {
  const device = await client.getDevice(deviceId)

  const transport = await device.transport()
  let adbPty = new AdbPty(transport)
  try {
    await adbPty.init()
  } catch {
    adbPty.kill()
    const transport = await device.transport()
    adbPty = new AdbPty(transport)
    await adbPty.init(false)
  }
  const sessionId = uniqId('shell')
  adbPty.on('data', (data) => {
    window.sendTo('main', 'shellData', sessionId, data)
  })
  // 非主动死亡（设备重启拆 socket 等）时 AdbPty emit('close')。在此清理死
  // 会话并通知 renderer 重建。主动 kill 路径因 closed 标志已置不会 emit，
  // 故不触发此回调——避免主动重置/关 tab 误触发自动重建。
  adbPty.on('close', () => {
    delete ptys[sessionId]
    window.sendTo('main', 'shellClosed', sessionId)
  })
  ptys[sessionId] = adbPty

  // Inject shell init commands.
  // Colorless setup: PS1 is plain text (no ANSI), no ls/grep color aliases,
  // no env script or su wrapper. TERM is exported only to declare terminal
  // capability. The prompt `model:path$ ` is colorless and identical before
  // and after su.
  //
  // 型号不从 shell 里 `getprop` 现取——主进程已通过非 shell 的
  // getProperties() 拿到 ro.product.model，预先拼进 PS1 常量。这样设备 shell
  // 不必再跑 getprop，PS1 只剩 $PWD 这一项需 shell 动态求值（cd 后路径要变）。
  // 注入仍走交互式 stdin，tty driver 会在「读取阶段」回显整行命令——这是
  // 「交互式 shell + adb shell: 协议不传 env」的结构限制，无法避免。
  //
  // `clear` 只在首次创建发：清掉 init 命令回显残留。断开重连（isReconnect）
  // 时跳过 clear——否则会清掉可见屏上保留的历史命令，违背「断开保留命令、
  // 接着输入」的目标；重连仅重设 PS1/TERM，新 prompt 续在断开提示之后。
  setTimeout(async () => {
    if (!ptys[sessionId]) {
      return
    }
    let model = ''
    try {
      const properties = await client.getDevice(deviceId).getProperties()
      model = properties['ro.product.model'] || ''
    } catch {
      // 取不到型号则 prompt 不带前缀，仅 $PWD$ —— 不阻断会话。
    }
    const ps1 = `${model}:$PWD\\$ `
    const initCommands = [
      'export TERM=xterm-256color',
      `export PS1="${ps1}"`,
    ]
    if (!isReconnect) {
      initCommands.push('clear')
    }
    adbPty.write(initCommands.join(' && ') + '\n')
  }, 300)

  return sessionId
}

const writeShell: IpcWriteShell = async function (sessionId, data) {
  // 死会话被 close 监听清理后，仍在途的按键会让 ptys[sessionId] 为
  // undefined。handleEvent 不 catch，undefined.write 会冒为未捕获 rejection，
  // 故先防空。
  if (!ptys[sessionId]) {
    return
  }
  ptys[sessionId].write(data)
}

const resizeShell: IpcResizeShell = async function (sessionId, cols, rows) {
  if (!ptys[sessionId]) {
    return
  }
  ptys[sessionId].resize(cols, rows)
}

const killShell: IpcKillShell = async function (sessionId) {
  // renderer cleanup 主动调用；若会话已被 close 监听清理则为 undefined。
  if (!ptys[sessionId]) {
    return
  }
  ptys[sessionId].kill()
  delete ptys[sessionId]
}

export function init(c: Client) {
  client = c

  handleEvent('createShell', createShell)
  handleEvent('writeShell', writeShell)
  handleEvent('resizeShell', resizeShell)
  handleEvent('killShell', killShell)
}
