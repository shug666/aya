import { observer } from 'mobx-react-lite'
import LunaToolbar, { LunaToolbarSpace } from 'luna-toolbar/react'
import Term from './Term'
import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import store from '../../store'
import Style from './Shell.module.scss'
import className from 'licia/className'
import { useCallback, useEffect, useRef, useState } from 'react'
import uuid from 'licia/uuid'
import map from 'licia/map'
import filter from 'licia/filter'
import find from 'licia/find'
import idxOf from 'licia/idxOf'
import { Terminal } from '@xterm/xterm'
import CommandDrawer from './CommandDrawer'
import CommandEditModal from './CommandEditModal'
import { ICommandCategory, IShellCommand } from 'common/types'

interface IShell {
  id: string
  name: string
  sessionId: string
  terminal?: Terminal
}

const DEFAULT_DRAWER_WIDTH = 380
const MIN_DRAWER_WIDTH = 280
const MAX_DRAWER_RATIO = 0.6

export default observer(function Shell() {
  const [shells, setShells] = useState<Array<IShell>>([])
  // Sidebar is visible by default; width/visibility persist across sessions.
  const [drawerVisible, setDrawerVisible] = useState(true)
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH)
  const [selectedShell, setSelectedShell] = useState<IShell>({
    id: '',
    name: '',
    sessionId: '',
  })
  const [categories, setCategories] = useState<ICommandCategory[]>([])
  const [commands, setCommands] = useState<IShellCommand[]>([])
  // Edit modal is owned by the shell page (not the sidebar) so hiding the
  // sidebar mid-edit doesn't unmount the modal and lose the in-progress input.
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingCommand, setEditingCommand] = useState<IShellCommand | null>(
    null
  )
  const numRef = useRef(1)
  const { device } = store
  // Track window width so the rendered sidebar width re-clamps on resize.
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : DEFAULT_DRAWER_WIDTH
  )

  useEffect(() => add(), [])

  useEffect(() => {
    let raf = 0
    function onResize() {
      // Coalesce resize-driven windowWidth updates to one per frame. Without
      // this, the resize event fires many times during a drag and each
      // setWindowWidth re-renders + reflows the sidebar, racing the terminal's
      // ResizeObserver fit() and causing the sidebar width to visibly jitter.
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setWindowWidth(window.innerWidth)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Load commands, categories, and persisted sidebar state from the store.
  useEffect(() => {
    async function loadData() {
      const storedCategories = await main.getShellStore('categories')
      const storedCommands = await main.getShellStore('commands')
      if (storedCategories) {
        setCategories(storedCategories)
      }
      if (storedCommands) {
        setCommands(storedCommands)
      }
      const storedWidth = await main.getShellStore('drawerWidth')
      if (storedWidth) {
        setDrawerWidth(storedWidth)
      }
      const storedVisible = await main.getShellStore('drawerVisible')
      if (storedVisible !== null && storedVisible !== undefined) {
        setDrawerVisible(storedVisible)
      }
    }
    loadData()
  }, [])

  // Render-time clamp: the persisted width is a user preference; at render we
  // cap it to 60% of the current window width so shrinking the window never
  // lets the sidebar overrun the terminal (<40%). The preference itself is
  // preserved, so enlarging the window can restore the wider width.
  const effectiveDrawerWidth = Math.min(
    drawerWidth,
    Math.max(MIN_DRAWER_WIDTH, windowWidth * MAX_DRAWER_RATIO)
  )

  function add() {
    const id = uuid()
    const shell = {
      id,
      name: `${t('shell')} ${numRef.current++}`,
      sessionId: '',
    }
    setShells([...shells, shell])
    setSelectedShell(shell)
  }

  function close(id: string) {
    const closedShell = find(shells, (shell) => shell.id === id)
    let closedIdx = idxOf(shells, closedShell)
    const newShells = filter(shells, (shell) => shell.id !== id)
    setShells(newShells)

    if (closedShell === selectedShell) {
      if (closedIdx >= newShells.length) {
        closedIdx = newShells.length - 1
      }
      setSelectedShell(newShells[closedIdx])
    }
  }

  function handleCategoriesChange(newCategories: ICommandCategory[]) {
    setCategories(newCategories)
    main.setShellStore('categories', newCategories)
  }

  function handleCommandsChange(newCommands: IShellCommand[]) {
    setCommands(newCommands)
    main.setShellStore('commands', newCommands)
  }

  function handleExecute(command: string) {
    main.writeShell(selectedShell.sessionId, command)
    setTimeout(() => {
      if (selectedShell.terminal) {
        selectedShell.terminal.focus()
      }
    }, 500)
  }

  // Visibility toggles persist immediately (low frequency).
  function toggleDrawerVisible() {
    setDrawerVisible((v) => {
      const next = !v
      main.setShellStore('drawerVisible', next)
      return next
    })
  }

  // Resize handle drag: the handle is a dedicated flex item between the
  // terminal slot and the sidebar (not an absolutely-positioned overlay), so it
  // is always hit-testable. mousemove updates width locally (terminal refits);
  // mouseup persists once.
  const resizeRef = useRef({ startX: 0, startWidth: 0, currentWidth: 0 })
  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      const delta = resizeRef.current.startX - e.clientX
      const newWidth = Math.min(
        Math.max(resizeRef.current.startWidth + delta, MIN_DRAWER_WIDTH),
        window.innerWidth * MAX_DRAWER_RATIO
      )
      resizeRef.current.currentWidth = newWidth
      setDrawerWidth(newWidth)
    },
    []
  )
  const handleResizeEnd = useCallback(() => {
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
    main.setShellStore('drawerWidth', resizeRef.current.currentWidth)
  }, [handleResizeMove])
  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    resizeRef.current.startX = e.clientX
    resizeRef.current.startWidth = effectiveDrawerWidth
    resizeRef.current.currentWidth = effectiveDrawerWidth
    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [handleResizeMove, handleResizeEnd])

  function handleAddCommand() {
    setEditingCommand(null)
    setEditModalVisible(true)
  }

  function handleEditCommand(cmd: IShellCommand) {
    setEditingCommand(cmd)
    setEditModalVisible(true)
  }

  function handleSaveCommand(data: {
    title: string
    description: string
    command: string
    categoryId: string
  }) {
    if (editingCommand) {
      const updated = map(commands, (cmd) => {
        if (cmd.id === editingCommand.id) {
          return { ...cmd, ...data }
        }
        return cmd
      })
      handleCommandsChange(updated)
    } else {
      const newCmd: IShellCommand = {
        id: uuid(),
        ...data,
        builtin: false,
        order: commands.length,
      }
      handleCommandsChange([...commands, newCmd])
    }
    setEditModalVisible(false)
  }

  const tabItems = map(shells, (shell) => {
    return (
      <LunaTabItem
        key={shell.id}
        id={shell.id}
        title={shell.name}
        closable={true}
        selected={selectedShell.id === shell.id}
      />
    )
  })

  const terms = map(shells, (shell) => {
    return (
      <Term
        key={shell.id}
        onSessionIdChange={(id) => {
          shell.sessionId = id
        }}
        onCreate={(terminal) => {
          shell.terminal = terminal
        }}
        visible={selectedShell.id === shell.id && store.panel === 'shell'}
      />
    )
  })

  return (
    <div className="panel-with-toolbar">
      <div className={className('panel-toolbar', Style.toolbar)}>
        <LunaTab
          className={Style.tabs}
          height={31}
          onSelect={(id) => {
            const shell = find(shells, (shell) => shell.id === id)
            if (shell) {
              setSelectedShell(shell)
            }
          }}
          onClose={close}
        >
          {tabItems}
        </LunaTab>
        <LunaToolbar className={Style.control}>
          <ToolbarIcon
            icon="add"
            title={t('add')}
            onClick={add}
            disabled={!device}
          />
          <LunaToolbarSpace />
          <ToolbarIcon
            icon="list"
            title={t('commandPanel')}
            onClick={toggleDrawerVisible}
          />
        </LunaToolbar>
      </div>
      <div className={className('panel-body', Style.panelBody)}>
        <div className={Style.termSlot}>{terms}</div>
        {drawerVisible && (
          <>
            <div
              className={Style.resizeHandle}
              onMouseDown={handleResizeStart}
            />
            <CommandDrawer
              width={effectiveDrawerWidth}
              onClose={() => toggleDrawerVisible()}
              onExecute={handleExecute}
              canExecute={!!device && !!selectedShell.sessionId}
              onAddCommand={handleAddCommand}
              onEditCommand={handleEditCommand}
              categories={categories}
              commands={commands}
              onCategoriesChange={handleCategoriesChange}
              onCommandsChange={handleCommandsChange}
            />
          </>
        )}
      </div>
      <CommandEditModal
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveCommand}
        command={editingCommand}
        categories={categories}
      />
    </div>
  )
})
