import { observer } from 'mobx-react-lite'
import store from '../../store'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef } from 'react'
import copy from 'licia/copy'
import { findBlockBounds } from './commandBlock'
import Style from './Term.module.scss'
import '@xterm/xterm/css/xterm.css'
import { t } from 'common/util'
import contextMenu from 'share/renderer/lib/contextMenu'
import isHidden from 'licia/isHidden'

interface ITermProps {
  visible: boolean
  onSessionIdChange: (id: string) => void
  onCreate: (terminal: Terminal) => void
}

export default observer(function Term(props: ITermProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)
  const fitAddonRef = useRef<FitAddon>(null)
  const sessionIdRef = useRef('')
  // 重建轮询定时器。设备重启拆 socket 后退避重试 createShell，直到设备
  // 就绪；随 tab 关闭由 cleanup clearTimeout 取消，无泄漏。
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 重建绑定创建时的 device.id，不随后续 store.device 变化——重启与切设备
  // 是独立不重叠场景，切设备时被切走的是已连接的别台设备，非正在重启的。
  const deviceIdRef = useRef('')
  // 跨设备切换：把切设备重开 shell 的能力从挂载 effect 内部暴露出来，
  // 供下方的 [device?.id] effect 调用。挂载 effect 设此 ref，切换 effect 用之。
  const switchToDeviceRef = useRef<(id: string) => void>(() => {})

  const { device } = store

  useEffect(() => {
    const term = new Terminal({
      allowProposedApi: true,
      // WindTerm-inspired monospace font with a cross-platform fallback chain
      // (Cascadia Mono is WindTerm's default; Linux/Mac fall back to Consolas /
      // Menlo / DejaVu Sans Mono so we never degrade to a generic monospace).
      fontFamily:
        "'Cascadia Mono', 'Cascadia Code', 'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
    })

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    const fit = () => {
      if (
        fitAddonRef.current &&
        terminalRef.current &&
        !isHidden(terminalRef.current)
      ) {
        fitAddon.fit()
      }
    }

    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      term.loadAddon(new CanvasAddon())
    }

    term.open(terminalRef.current!)

    // Refit whenever the terminal container resizes — covers sidebar
    // drag/open/close (flex reflow), window resize, and tab switches in one
    // place, replacing the previous window 'resize' listener. Guarded by
    // isHidden() so non-selected shells (display:none) don't refit. Mounted
    // after term.open() so the canvas exists; ResizeObserver only fires once
    // the element has a layout box, so no rAF deferral is needed.
    //
    // The callback is coalesced via requestAnimationFrame: ResizeObserver can
    // fire several times per frame during a drag, and fit() itself mutates the
    // xterm canvas which can re-trigger the observer. Batching to one fit per
    // frame breaks that feedback loop and prevents the sidebar from jittering
    // while the terminal is being resized.
    let raf = 0
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        fit()
      })
    })
    resizeObserver.observe(terminalRef.current!)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        if (term.hasSelection()) {
          copy(term.getSelection())
        }
        return false
      }
      return true
    })
    termRef.current = term
    props.onCreate(term)

    // Ctrl + mouse wheel zooms the terminal font size; persisted across
    // sessions via the shell store. Non-Ctrl wheel scrolls normally.
    term.attachCustomWheelEventHandler((event) => {
      if (event.type !== 'wheel' || !event.ctrlKey) return true
      const dir = event.deltaY < 0 ? 1 : -1
      const next = Math.min(32, Math.max(8, (term.options.fontSize ?? 13) + dir))
      if (next !== term.options.fontSize) {
        term.options.fontSize = next
        main.setShellStore('fontSize', next)
        fit()
      }
      return false
    })

    function onShellData(id, data) {
      if (sessionIdRef.current !== id) {
        return
      }
      term.write(data)
    }
    const offShellData = main.on('shellData', onShellData)

    // 退避重试序列：300ms → 1s → 2s，封顶 2s 后固定 2s 无限重试。
    // 设备 boot 可达数十秒，封顶不设上限——设备无论多久回来都自动恢复。
    const backoff = [300, 1000, 2000]
    let retryStep = 0
    function scheduleReconnect() {
      const delay = retryStep < backoff.length ? backoff[retryStep] : 2000
      retryStep++
      retryTimerRef.current = setTimeout(reconnect, delay)
    }
    function reconnect() {
      // FailError('device offline') 是退避期间的预期失败：设备还没起好，
      // transport() 会拒。静默继续重试，不打 error 日志，仅 debug 记次数。
      // isReconnect=true：重连不发 clear，保留断开前的可见历史命令与输出，
      // 新 prompt 续在断开提示之后。
      main
        .createShell(deviceIdRef.current, true)
        .then((id) => {
          // 零重绑支点：term.onData 闭包实时读 sessionIdRef.current，
          // onShellData 过滤器亦然。setSessionId(newId) 后下一次按键/下一
          // 帧输出自动重路由到新会话，无需重绑 onData/onResize/onShellData。
          retryTimerRef.current = null
          retryStep = 0
          setSessionId(id)
        })
        .catch(() => {
          // 静默重试：设备重启中 transport 失败是预期的。
          console.debug('shell reconnect retry', retryStep)
          scheduleReconnect()
        })
    }
    function onShellClosed(id) {
      if (sessionIdRef.current !== id) {
        return
      }
      // 断开提示：写一行灰色标记，让用户知道设备已断开、正在自动重连，
      // 而非静默卡死。此时 key 修复使 xterm 实例存活，提示写入 scrollback；
      // 重连成功后新 prompt 续在其后（主进程 init 的 clear 仅清可见屏，
      // 不清 scrollback，故断开提示与历史命令一并保留）。
      term.write(`\r\n\x1b[90m${t('shellDisconnected')}\x1b[0m\r\n`)
      // 置空 sessionId：重建窗口内按键被 onData 守卫无害丢弃，不写死会话。
      setSessionId('')
      scheduleReconnect()
    }
    const offShellClosed = main.on('shellClosed', onShellClosed)

    // 跨设备切换：切到新设备时停掉旧重连轮询、kill 旧会话、换目标、重开新
    // 会话，但不清屏不 dispose——新设备 prompt 续在历史 scrollback 之后，
    // 实现终端跨设备保留。blip（同设备断开重连）不进此分支：onShellClosed 的
    // 退避重连已覆盖，且 deviceIdRef 与目标设备一致，切换 effect 会跳过。
    function switchToDevice(id: string) {
      // 取消挂起的退避重试，避免与切设备的 createShell 竞态产生孤儿会话。
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      retryStep = 0
      // kill 旧会话（若仍在）：deviceIdRef 此时还是旧设备。
      if (sessionIdRef.current) {
        main.killShell(sessionIdRef.current)
        setSessionId('')
      }
      // 换目标设备并重开。isReconnect=true：不发 clear，保留跨设备历史。
      deviceIdRef.current = id
      main
        .createShell(id, true)
        .then((newId) => {
          setSessionId(newId)
        })
        .catch(() => {
          // 新设备 transport 暂未就绪（拔插瞬间）——走退避重连恢复。
          scheduleReconnect()
        })
    }
    switchToDeviceRef.current = switchToDevice

    if (device) {
      deviceIdRef.current = device.id
      main.createShell(device.id).then((id) => {
        setSessionId(id)
        term.onData((data) => {
          // 重建窗口内 sessionId 为空时无害丢弃，不触发 main 侧防空守卫，
          // 也不写入已死会话。
          if (!sessionIdRef.current) {
            return
          }
          main.writeShell(sessionIdRef.current, data)
        })
        term.onResize((size) => {
          main.resizeShell(sessionIdRef.current, size.cols, size.rows)
        })
        fit()
      })
      // Restore persisted font size (if any) and refit.
      main.getShellStore('fontSize').then((size) => {
        if (size && size !== term.options.fontSize) {
          term.options.fontSize = size
          fit()
        }
      })
    }

    return () => {
      offShellData()
      offShellClosed()
      // tab 关闭即停重建轮询，无定时器泄漏。
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      if (sessionIdRef.current) {
        main.killShell(sessionIdRef.current)
      }
      if (raf) cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      term.dispose()
    }
  }, [])

  // 切设备感知：device.id 变化时，若已是不同于 deviceIdRef 的新设备，切过去
  // 重开 shell（不清屏，跨设备保留历史）。blip 时 device.id 经历 A→null→A，
  // null 瞬间跳过；回到 A 时与 deviceIdRef 一致也跳过——退避重连链路自处理。
  // 唯一进入此分支的：device.id 变成另一台已连接设备的 id（拔 A 插 B / 下拉切设备）。
  const deviceId = device?.id
  useEffect(() => {
    if (!deviceId) {
      return
    }
    // 仅当目标设备确实不同于当前绑定的设备时才切换，避免挂载首跑与 blip 回原设备
    // 时重复 createShell（挂载已建过；blip 由 onShellClosed 重连负责）。
    if (deviceId === deviceIdRef.current) {
      return
    }
    switchToDeviceRef.current(deviceId)
  }, [deviceId])

  useEffect(() => {
    if (fitAddonRef.current && props.visible) {
      fitAddonRef.current.fit()
    }
    if (props.visible) {
      setTimeout(() => {
        if (termRef.current) {
          termRef.current.focus()
        }
      }, 500)
    }
  }, [props.visible])

  function setSessionId(id: string) {
    sessionIdRef.current = id
    props.onSessionIdChange(id)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!device) {
      return
    }

    const term = termRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click() {
          if (term.hasSelection()) {
            copy(term.getSelection())
            term.focus()
          }
        },
      },
      {
        label: t('paste'),
        click: async () => {
          const text = await navigator.clipboard.readText()
          if (text) {
            main.writeShell(sessionIdRef.current, text)
          }
        },
      },
      {
        label: t('selectAll'),
        click() {
          term.selectAll()
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('reset'),
        click() {
          // 若重建轮询正在进行（sessionId 已置空），先取消挂起重试，避免
          // 手动 createShell 与轮询的 createShell 竞态产生孤儿会话。
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current)
            retryTimerRef.current = null
          }
          if (sessionIdRef.current) {
            main.killShell(sessionIdRef.current)
          }
          term.reset()
          if (device) {
            main.createShell(device.id).then((id) => {
              setSessionId(id)
            })
            term.focus()
          }
        },
      },
      {
        label: t('clear'),
        click() {
          term.clear()
          term.focus()
        },
      },
    ]

    contextMenu(e, template)
  }

  // Double-click the left blank strip of the terminal area (the container's
  // left padding plus the gutter band — the full strip left of the xterm
  // canvas) selects the command block (prompt + output) nearest the clicked
  // row via a lazy buffer scan. Disabled in TUI/alt buffer. Double-clicks that
  // land on the text area (right of the canvas's left edge) fall through to
  // xterm's native word/line selection: we just return without preventing
  // default or stopping propagation, so xterm keeps its own result.
  function onTermDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const term = termRef.current
    const canvas = terminalRef.current
    if (!term || !canvas) return
    // Gate by x: only the left blank strip (left of the xterm canvas) is a
    // block-select hit. On the canvas, do nothing and let xterm select.
    if (e.clientX >= canvas.getBoundingClientRect().left) return
    const buffer = term.buffer.active
    if (buffer.type === 'alternate') return // TUI / full-screen app: no blocks
    const rows = term.rows
    if (rows <= 0) return
    // Map click pixel y → buffer line. cellHeight from the whole viewport
    // (clientHeight / rows) avoids fragile per-cell measurement. The canvas
    // top is the row origin (it aligns with the gutter band's top).
    const cellHeight = (term.element?.clientHeight ?? 0) / rows
    if (cellHeight <= 0) return
    const offsetY = e.clientY - canvas.getBoundingClientRect().top
    const viewportRow = Math.floor(offsetY / cellHeight)
    const bufLine = Math.round(buffer.viewportY) + viewportRow
    const bounds = findBlockBounds(buffer, bufLine)
    if (bounds) {
      term.selectLines(bounds.start, bounds.end)
      // If the block's start (prompt line) is above the current viewport
      // (e.g. the user double-clicked a long block's middle), scroll so the
      // prompt becomes visible. selectLines/refresh and focus(preventScroll)
      // never move the viewport, so without this the block's "first line" is
      // off-screen above. Skip the scroll when the prompt is already in view
      // so short blocks don't disturb the current scroll position.
      if (bounds.start < buffer.viewportY) {
        term.scrollToLine(bounds.start)
      }
      // Restore focus to xterm: the double-click landed on the left blank
      // strip (outside the xterm element), which steals focus from the
      // terminal. Without this, Ctrl+Shift+C copy fails because the
      // terminal's selection/textarea no longer has focus.
      term.focus()
    }
  }

  return (
    <>
      <div
        className={Style.term}
        style={{ display: props.visible ? 'block' : 'none' }}
        onContextMenu={onContextMenu}
        onDoubleClick={onTermDoubleClick}
      >
        <div className={Style.gutter} />
        <div className={Style.termCanvas} ref={terminalRef} />
      </div>
    </>
  )
})
