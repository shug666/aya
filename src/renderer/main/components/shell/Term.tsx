import { observer } from 'mobx-react-lite'
import store from '../../store'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef } from 'react'
import { createPromptColorizer } from './promptColorizer'
import {
  colorBgContainer,
  colorBgContainerDark,
  colorPrimary,
  fontFamilyCode,
} from 'common/theme'
import copy from 'licia/copy'
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

  const { device } = store

  useEffect(() => {
    const term = new Terminal({
      allowProposedApi: true,
      fontSize: 14,
      fontFamily: fontFamilyCode,
      theme: getTheme(store.theme === 'dark'),
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

    // Client-side prompt colorizer: colorizes prompts regardless of the
    // device's PS1 (survives su / prompt resets) and suspends during TUIs.
    const colorizer = createPromptColorizer()

    function onShellData(id, data) {
      if (sessionIdRef.current !== id) {
        return
      }
      const out = colorizer.feed(data)
      // 版本标记 + 诊断：确认运行的是修复版 c46ddc8+
      const toHex = (s: string) => Array.from(s).map((ch) => {
        const c = (ch as string).charCodeAt(0)
        if (c === 0x0a) return '\\n'
        if (c === 0x0d) return '\\r'
        if (c === 0x1b) return '\\e'
        if (c < 0x20 || c === 0x7f) return '\\x' + c.toString(16).padStart(2, '0')
        return ch
      }).join('')
      console.log('[v2-fix] IN:', toHex(data), '| OUT:', toHex(out))
      term.write(out)
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
    }

    return () => {
      offShellData()
      // Flush any buffered partial line before tearing down.
      const remaining = colorizer.flush()
      if (remaining) {
        term.write(remaining)
      }
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

  const theme = getTheme(store.theme === 'dark')
  if (termRef.current) {
    termRef.current.options.theme = theme
  }

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

  return (
    <>
      <div
        className={Style.term}
        style={{ display: props.visible ? 'block' : 'none' }}
        ref={terminalRef}
        onContextMenu={onContextMenu}
      />
    </>
  )
})

function getTheme(dark = false) {
  if (dark) {
    // WindTerm-style dark theme
    return {
      background: colorBgContainerDark,
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: colorBgContainerDark,
      selectionForeground: '#ffffff',
      selectionBackground: 'rgba(68, 138, 255, 0.35)',
      selectionInactiveBackground: 'rgba(68, 138, 255, 0.2)',
      black: '#1e1e1e',
      red: '#f44747',
      green: '#4ec94c',
      yellow: '#e5c07b',
      blue: '#42a5f5',
      magenta: '#c678dd',
      cyan: '#29b8db',
      white: '#d4d4d4',
      brightBlack: '#7f8c98',
      brightRed: '#ff6b6b',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    } as ITheme
  }

  // WindTerm-style light theme
  return {
    background: colorBgContainer,
    foreground: '#383a42',
    cursor: '#383a42',
    cursorAccent: colorBgContainer,
    selectionForeground: '#ffffff',
    selectionBackground: colorPrimary,
    selectionInactiveBackground: 'rgba(79, 177, 85, 0.2)',
    black: '#383a42',
    red: '#e45649',
    green: '#50a14f',
    yellow: '#c18401',
    blue: '#4078f2',
    magenta: '#a626a4',
    cyan: '#0184bc',
    white: '#a0a1a7',
    brightBlack: '#696c77',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  } as ITheme
}
