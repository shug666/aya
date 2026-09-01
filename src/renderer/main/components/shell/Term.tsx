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
  const gutterRef = useRef<HTMLDivElement>(null)

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
      if (!isHidden(terminalRef.current!)) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', fit)

    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      term.loadAddon(new CanvasAddon())
    }

    term.open(terminalRef.current!)
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

    if (device) {
      main.createShell(device.id).then((id) => {
        setSessionId(id)
        term.onData((data) => main.writeShell(sessionIdRef.current, data))
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
      if (sessionIdRef.current) {
        main.killShell(sessionIdRef.current)
      }
      term.dispose()
      window.removeEventListener('resize', fit)
    }
  }, [])

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

  // Double-click the left gutter: select the command block (prompt + output)
  // nearest the clicked row via a lazy buffer scan. Disabled in TUI/alt buffer.
  function onGutterDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const term = termRef.current
    const gutter = gutterRef.current
    if (!term || !gutter) return
    const buffer = term.buffer.active
    if (buffer.type === 'alternate') return // TUI / full-screen app: no blocks
    const rows = term.rows
    if (rows <= 0) return
    // Map click pixel y → buffer line. cellHeight from the whole viewport
    // (clientHeight / rows) avoids fragile per-cell measurement.
    const cellHeight = (term.element?.clientHeight ?? 0) / rows
    if (cellHeight <= 0) return
    const offsetY = e.clientY - gutter.getBoundingClientRect().top
    const viewportRow = Math.floor(offsetY / cellHeight)
    const bufLine = Math.round(buffer.viewportY) + viewportRow
    const bounds = findBlockBounds(buffer, bufLine)
    if (bounds) {
      term.selectLines(bounds.start, bounds.end)
    }
  }

  return (
    <>
      <div
        className={Style.term}
        style={{ display: props.visible ? 'block' : 'none' }}
        ref={terminalRef}
        onContextMenu={onContextMenu}
      >
        <div
          className={Style.gutter}
          ref={gutterRef}
          onDoubleClick={onGutterDoubleClick}
        />
      </div>
    </>
  )
})
