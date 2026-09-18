import { observer } from 'mobx-react-lite'
import { useEffect, useRef } from 'react'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import each from 'licia/each'
import replaceAll from 'licia/replaceAll'
import Style from './Terminal.module.scss'
import {
  colorBgContainer,
  colorBgContainerDark,
  colorPrimary,
  colorText,
  colorTextDark,
} from 'common/theme'
import store from '../store'
import '@xterm/xterm/css/xterm.css'
import contextMenu from '../../lib/contextMenu'
import { t } from '../../../common/i18n'
import copy from 'licia/copy'

export default observer(function () {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)

  useEffect(() => {
    const term = new Terminal({
      allowProposedApi: true,
      fontSize: 14,
      fontFamily: 'mono, courier-new, courier, monospace',
      theme: getTheme(store.theme === 'dark'),
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    // 渲染器 addon 必须在 term.open() 之后加载（attach 到已 open 的终端），
    // 顺序反了会 attach 失败、静默回退 DOM renderer，洪流输出时每帧重建 DOM 卡顿。
    term.open(terminalRef.current!)
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      term.loadAddon(new CanvasAddon())
    }
    const write = (log: string) => {
      term.write(replaceAll(log, '\n', '\r\n'))
    }
    const fit = () => fitAddon.fit()
    fit()

    window.addEventListener('resize', fit)
    main.getLogs().then((logs: string[]) => {
      each(logs, (log) => write(log))
    })
    // 洪流防御：addLog 高频时逐条 term.write 会累积解析开销并打满主线程。
    // 用 rAF 批处理——攒一帧内的所有片段，合并成一次 term.write（一次 replaceAll）。
    // xterm 渲染本身已按 rAF 节流，这里只减少 write 调用与解析次数，对齐帧刷新。
    let pending: string[] = []
    let rafId: number | null = null
    const flush = () => {
      rafId = null
      if (pending.length === 0) return
      const merged = pending.join('')
      pending = []
      term.write(replaceAll(merged, '\n', '\r\n'))
    }
    main.on('addLog', (log) => {
      pending.push(log)
      if (rafId === null) rafId = requestAnimationFrame(flush)
    })

    termRef.current = term

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      term.dispose()
      window.removeEventListener('resize', fit)
    }
  }, [])

  const onContextMenu = (e: React.MouseEvent) => {
    const term = termRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click: () => {
          if (term.hasSelection()) {
            copy(term.getSelection())
            term.focus()
          }
        },
      },
      {
        label: t('selectAll'),
        click: () => {
          term.selectAll()
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click: () => {
          main.clearLogs()
          term.clear()
          term.focus()
        },
      },
    ]

    contextMenu(e, template)
  }

  const theme = getTheme(store.theme === 'dark')
  if (termRef.current) {
    termRef.current.options.theme = theme
  }

  return (
    <div className={Style.terminalContainer}>
      <div
        className={Style.terminal}
        ref={terminalRef}
        onContextMenu={onContextMenu}
      />
    </div>
  )
})

function getTheme(dark = false) {
  let theme: ITheme = {
    background: colorBgContainer,
    foreground: colorText,
  }

  if (dark) {
    theme = {
      background: colorBgContainerDark,
      foreground: colorTextDark,
    }
  }

  return {
    selectionForeground: '#fff',
    selectionBackground: colorPrimary,
    ...theme,
  }
}
