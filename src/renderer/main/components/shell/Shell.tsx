import { observer } from 'mobx-react-lite'
import LunaToolbar, { LunaToolbarSpace } from 'luna-toolbar/react'
import Term from './Term'
import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import store from '../../store'
import Style from './Shell.module.scss'
import className from 'licia/className'
import { useEffect, useRef, useState } from 'react'
import uuid from 'licia/uuid'
import map from 'licia/map'
import filter from 'licia/filter'
import find from 'licia/find'
import idxOf from 'licia/idxOf'
import { Terminal } from '@xterm/xterm'
import CommandDrawer from './CommandDrawer'
import { ICommandCategory, IShellCommand } from 'common/types'

interface IShell {
  id: string
  name: string
  sessionId: string
  terminal?: Terminal
}

export default observer(function Shell() {
  const [shells, setShells] = useState<Array<IShell>>([])
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [selectedShell, setSelectedShell] = useState<IShell>({
    id: '',
    name: '',
    sessionId: '',
  })
  const [categories, setCategories] = useState<ICommandCategory[]>([])
  const [commands, setCommands] = useState<IShellCommand[]>([])
  const numRef = useRef(1)
  const { device } = store

  useEffect(() => add(), [])

  // Load commands and categories from store
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
    }
    loadData()
  }, [])

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
            onClick={() => setDrawerVisible(true)}
            disabled={!device}
          />
        </LunaToolbar>
      </div>
      <div className="panel-body">
        {terms}
        <CommandDrawer
          visible={drawerVisible}
          onClose={() => setDrawerVisible(false)}
          onExecute={handleExecute}
          categories={categories}
          commands={commands}
          onCategoriesChange={handleCategoriesChange}
          onCommandsChange={handleCommandsChange}
        />
      </div>
    </div>
  )
})
