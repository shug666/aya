import { observer } from 'mobx-react-lite'
import store from '../../store'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef } from 'react'
import { createPromptColorizer } from './promptColorizer'
import { fontFamilyCode } from 'common/theme'
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
      term.write(colorizer.feed(data))
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
    // WindTerm Dark theme — deep blue-grey background, soft balanced ANSI.
    return {
      background: '#233339',
      foreground: '#cad3d6',
      cursor: '#cad3d6',
      cursorAccent: '#233339',
      selectionForeground: '#ffffff',
      selectionBackground: 'rgba(91, 158, 198, 0.35)',
      selectionInactiveBackground: 'rgba(91, 158, 198, 0.2)',
      black: '#000000',
      red: '#bb4546',
      green: '#5d8e3f',
      yellow: '#b58900',
      blue: '#5d97cf',
      magenta: '#b06699',
      cyan: '#3f9eae',
      white: '#cad3d6',
      brightBlack: '#5b6266',
      brightRed: '#d66b6b',
      brightGreen: '#94c150',
      brightYellow: '#d6a651',
      brightBlue: '#7aa6da',
      brightMagenta: '#c79fc4',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    } as ITheme
  }

  // WindTerm DigeWhite theme — warm off-white, gentle ANSI colors.
  return {
    background: '#f9f5ec',
    foreground: '#3f4248',
    cursor: '#3f4248',
    cursorAccent: '#f9f5ec',
    selectionForeground: '#ffffff',
    selectionBackground: 'rgba(79, 137, 198, 0.3)',
    selectionInactiveBackground: 'rgba(79, 137, 198, 0.18)',
    black: '#3f4248',
    red: '#b14545',
    green: '#5f8e3f',
    yellow: '#a8760a',
    blue: '#3f6fb0',
    magenta: '#9b4f8c',
    cyan: '#2e7d9c',
    white: '#9da0a4',
    brightBlack: '#71757a',
    brightRed: '#c25c5c',
    brightGreen: '#79a854',
    brightYellow: '#c89030',
    brightBlue: '#5688c4',
    brightMagenta: '#ad689f',
    brightCyan: '#4b9bb8',
    brightWhite: '#ffffff',
  } as ITheme
}
