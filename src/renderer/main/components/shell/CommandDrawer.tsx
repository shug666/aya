import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { observer } from 'mobx-react-lite'
import LunaModal from 'luna-modal'
import { t } from 'common/util'
import { notify } from 'share/renderer/lib/util'
import uuid from 'licia/uuid'
import filter from 'licia/filter'
import map from 'licia/map'
import each from 'licia/each'
import find from 'licia/find'
import contain from 'licia/contain'
import lowerCase from 'licia/lowerCase'
import Style from './CommandDrawer.module.scss'
import CommandEditModal from './CommandEditModal'
import className from 'licia/className'
import { ICommandCategory, IShellCommand } from 'common/types'

interface ICommandDrawerProps {
  visible: boolean
  onClose: () => void
  onExecute: (command: string) => void
  categories: ICommandCategory[]
  commands: IShellCommand[]
  onCategoriesChange: (categories: ICommandCategory[]) => void
  onCommandsChange: (commands: IShellCommand[]) => void
}

export default observer(function CommandDrawer(props: ICommandDrawerProps) {
  const {
    visible,
    onClose,
    onExecute,
    categories,
    commands,
    onCategoriesChange,
    onCommandsChange,
  } = props

  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set()
  )
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingCommand, setEditingCommand] = useState<IShellCommand | null>(
    null
  )
  const [drawerWidth, setDrawerWidth] = useState(380)
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef({ startX: 0, startWidth: 0 })

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const delta = resizeRef.current.startX - e.clientX
    const newWidth = Math.min(
      Math.max(resizeRef.current.startWidth + delta, 280),
      window.innerWidth * 0.8
    )
    setDrawerWidth(newWidth)
  }, [])

  const handleResizeEnd = useCallback(() => {
    setResizing(false)
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
  }, [handleResizeMove])

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    resizeRef.current.startX = e.clientX
    resizeRef.current.startWidth = drawerWidth
    setResizing(true)
    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [handleResizeMove, handleResizeEnd])

  const filteredCommands = useMemo(() => {
    let result = commands
    if (activeCategory !== 'all') {
      result = filter(result, (cmd) => cmd.categoryId === activeCategory)
    }
    if (search) {
      const s = lowerCase(search)
      result = filter(
        result,
        (cmd) =>
          lowerCase(t(cmd.title) || cmd.title).indexOf(s) > -1 ||
          lowerCase(cmd.description).indexOf(s) > -1 ||
          lowerCase(cmd.command).indexOf(s) > -1
      )
    }
    return result
  }, [commands, activeCategory, search])

  const groupedCommands = useMemo(() => {
    const groups: Array<{
      category: ICommandCategory
      commands: IShellCommand[]
    }> = []

    each(categories, (cat) => {
      const cmds = filter(
        filteredCommands,
        (cmd) => cmd.categoryId === cat.id
      )
      if (cmds.length > 0) {
        groups.push({ category: cat, commands: cmds })
      }
    })

    return groups
  }, [filteredCommands, categories])

  function toggleCollapse(categoryId: string) {
    const newSet = new Set(collapsedCategories)
    if (newSet.has(categoryId)) {
      newSet.delete(categoryId)
    } else {
      newSet.add(categoryId)
    }
    setCollapsedCategories(newSet)
  }

  function handleExecute(cmd: IShellCommand) {
    onExecute(cmd.command + '\n')
  }

  function handleAddCommand() {
    setEditingCommand(null)
    setEditModalVisible(true)
  }

  function handleEditCommand(cmd: IShellCommand) {
    setEditingCommand(cmd)
    setEditModalVisible(true)
  }

  async function handleDeleteCommand(cmd: IShellCommand) {
    const confirmed = await LunaModal.confirm(
      t('confirmDeleteCmd', { name: t(cmd.title) || cmd.title })
    )
    if (confirmed) {
      onCommandsChange(filter(commands, (c) => c.id !== cmd.id))
    }
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
      onCommandsChange(updated)
    } else {
      const newCmd: IShellCommand = {
        id: uuid(),
        ...data,
        builtin: false,
        order: commands.length,
      }
      onCommandsChange([...commands, newCmd])
    }
    setEditModalVisible(false)
  }

  async function handleAddCategory() {
    const name = await LunaModal.prompt(t('categoryName'))
    if (name) {
      const newCat: ICommandCategory = {
        id: uuid(),
        name,
        builtin: false,
        order: categories.length,
      }
      onCategoriesChange([...categories, newCat])
    }
  }

  async function handleEditCategory(cat: ICommandCategory) {
    const name = await LunaModal.prompt(t('categoryName'), t(cat.name) || cat.name)
    if (name) {
      const updated = map(categories, (c) => {
        if (c.id === cat.id) {
          return { ...c, name }
        }
        return c
      })
      onCategoriesChange(updated)
    }
  }

  async function handleDeleteCategory(cat: ICommandCategory) {
    const confirmed = await LunaModal.confirm(
      t('confirmDeleteCategory', { name: t(cat.name) || cat.name })
    )
    if (!confirmed) return

    const firstCategory = find(categories, (c) => c.id !== cat.id)
    if (!firstCategory) return

    const updatedCommands = map(commands, (cmd) => {
      if (cmd.categoryId === cat.id) {
        return { ...cmd, categoryId: firstCategory.id }
      }
      return cmd
    })
    onCommandsChange(updatedCommands)
    onCategoriesChange(filter(categories, (c) => c.id !== cat.id))
    if (activeCategory === cat.id) {
      setActiveCategory('all')
    }
  }

  async function handleExport() {
    const result = await main.showSaveDialog({
      defaultPath: 'aya-commands.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!result.canceled && result.filePath) {
      try {
        const data = JSON.stringify({ categories, commands }, null, 2)
        await main.writeFile(result.filePath, data)
        notify(t('exportSuccess'), { icon: 'success' })
      } catch {
        notify(t('importError'), { icon: 'error' })
      }
    }
  }

  async function handleImport() {
    const result = await main.showOpenDialog({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      try {
        const filePath = result.filePaths[0]
        const text = await main.readFile(filePath)
        const data = JSON.parse(text)

        if (!data.categories || !data.commands) {
          notify(t('importError'), { icon: 'error' })
          return
        }

        // Merge: id match → overwrite, new → append
        const mergedCategories = [...categories]
        each(data.categories, (importedCat: ICommandCategory) => {
          const existing = find(
            mergedCategories,
            (c) => c.id === importedCat.id
          )
          if (existing) {
            Object.assign(existing, importedCat)
          } else {
            mergedCategories.push(importedCat)
          }
        })

        const mergedCommands = [...commands]
        each(data.commands, (importedCmd: IShellCommand) => {
          const existingIdx = mergedCommands.findIndex(
            (c) => c.id === importedCmd.id
          )
          if (existingIdx >= 0) {
            mergedCommands[existingIdx] = importedCmd
          } else {
            mergedCommands.push(importedCmd)
          }
        })

        // Validate categoryIds
        const catIds = map(mergedCategories, (c) => c.id)
        const validCommands = filter(mergedCommands, (cmd) =>
          contain(catIds, cmd.categoryId)
        )

        onCategoriesChange(mergedCategories)
        onCommandsChange(validCommands)
        notify(t('importSuccess'), { icon: 'success' })
      } catch {
        notify(t('importError'), { icon: 'error' })
      }
    }
  }

  return createPortal(
    <>
      <div
        className={className(Style.overlay, { [Style.visible]: visible })}
        onClick={onClose}
      />
      <div
        className={className(Style.drawer, {
          [Style.visible]: visible,
          [Style.resizing]: resizing,
        })}
        style={{ '--drawer-width': `${drawerWidth}px` } as React.CSSProperties}
      >
        <div
          className={Style.resizeHandle}
          onMouseDown={handleResizeStart}
        />
        <div className={Style.header}>
          <span className={Style.title}>{t('commandPanel')}</span>
          <button className={Style.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={Style.searchBar}>
          <input
            type="text"
            placeholder={t('searchCmd')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={Style.tabs}>
          <span
            className={className(Style.tab, {
              [Style.active]: activeCategory === 'all',
            })}
            onClick={() => setActiveCategory('all')}
          >
            {t('allCategories')}
          </span>
          {map(categories, (cat) => (
            <span
              key={cat.id}
              className={className(Style.tab, {
                [Style.active]: activeCategory === cat.id,
              })}
              onClick={() => setActiveCategory(cat.id)}
            >
              {t(cat.name) || cat.name}
              {!cat.builtin && (
                <>
                  <span
                    className={Style.tabAction}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditCategory(cat)
                    }}
                    title={t('editCategory')}
                  >
                    ✎
                  </span>
                  <span
                    className={Style.tabAction}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteCategory(cat)
                    }}
                    title={t('deleteCategory')}
                  >
                    ✕
                  </span>
                </>
              )}
            </span>
          ))}
          <button className={Style.addCategoryBtn} onClick={handleAddCategory}>
            + {t('addCategory')}
          </button>
        </div>

        <div className={Style.body}>
          {groupedCommands.length === 0 ? (
            <div className={Style.emptyState}>{t('noCommands')}</div>
          ) : (
            map(groupedCommands, (group) => (
              <div key={group.category.id} className={Style.categoryGroup}>
                <div
                  className={Style.categoryHeader}
                  onClick={() => toggleCollapse(group.category.id)}
                >
                  <span
                    className={className(Style.arrow, {
                      [Style.collapsed]: collapsedCategories.has(
                        group.category.id
                      ),
                    })}
                  >
                    ▼
                  </span>
                  {t(group.category.name) || group.category.name}
                </div>
                {!collapsedCategories.has(group.category.id) &&
                  map(group.commands, (cmd) => (
                    <div key={cmd.id} className={Style.commandItem}>
                      <div className={Style.commandTop}>
                        <div className={Style.commandInfo}>
                          <div className={Style.commandTitle}>
                            {t(cmd.title) || cmd.title}
                          </div>
                          {cmd.description && (
                            <div className={Style.commandDescription}>
                              {cmd.description}
                            </div>
                          )}
                          <div className={Style.commandCode}>
                            {cmd.command}
                          </div>
                        </div>
                        <div className={Style.commandActions}>
                          <button
                            className={className(
                              Style.actionBtn,
                              Style.executeBtn
                            )}
                            onClick={() => handleExecute(cmd)}
                            title={t('execute')}
                          >
                            ▶
                          </button>
                          <button
                            className={Style.actionBtn}
                            onClick={() => handleEditCommand(cmd)}
                            title={t('editCommand')}
                          >
                            ✎
                          </button>
                          <button
                            className={className(
                              Style.actionBtn,
                              Style.deleteBtn
                            )}
                            onClick={() => handleDeleteCommand(cmd)}
                            title={t('deleteCommand')}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>

        <div className={Style.footer}>
          <button
            className={className(Style.footerBtn, Style.primaryBtn)}
            onClick={handleAddCommand}
          >
            + {t('addCommand')}
          </button>
          <button className={Style.footerBtn} onClick={handleImport}>
            {t('importCommands')}
          </button>
          <button className={Style.footerBtn} onClick={handleExport}>
            {t('exportCommands')}
          </button>
        </div>
      </div>

      <CommandEditModal
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveCommand}
        command={editingCommand}
        categories={categories}
      />
    </>,
    document.body
  )
})
