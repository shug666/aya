import { observer } from 'mobx-react-lite'
import LunaToolbar, {
  LunaToolbarSelect,
  LunaToolbarSeparator,
} from 'luna-toolbar/react'
import LunaLogcat from 'luna-logcat/react'
import Logcat from 'luna-logcat'
import map from 'licia/map'
import rpad from 'licia/rpad'
import dateFormat from 'licia/dateFormat'
import trim from 'licia/trim'
import { useEffect, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import download from 'licia/download'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import contextMenu from 'share/renderer/lib/contextMenu'
import { parseFilter, extractName } from './filterQuery'
import {
  getSuggestions,
  applySuggestion,
  Suggestion,
} from './filterSuggest'

interface SavedFilter {
  name: string
  query: string
  // 排序键：最近使用优先。新存即置顶 / 用一次即置顶，均置 Date.now()；旧记录缺字段视作 0 沉底。
  lastUsed?: number
}

export default observer(function Logcat() {
  const [view, setView] = useState<'compact' | 'standard'>('standard')
  const [softWrap, setSoftWrap] = useState(true)
  const [paused, setPaused] = useState(false)
  const [fontSize, setFontSize] = useState(13)
  // 应用到 LunaLogcat 的过滤字符串（仅失焦校验合法后更新）。单框统一查询。
  const [filter, setFilter] = useState<string>('')
  // 输入框显示值（打字实时更新，不触发过滤）
  const [draft, setDraft] = useState<string>('')
  // 语法错误态
  const [error, setError] = useState<string | null>(null)
  // 已保存的快捷命令
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  // 保存命名对话框
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  // 联想浮层
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestRange, setSuggestRange] = useState<{ start: number; end: number } | null>(null)
  const [selectedSuggest, setSelectedSuggest] = useState(0)
  // 浮层定位（fixed，跳出 toolbar 的 overflow-x:hidden 裁切）
  const [suggestPos, setSuggestPos] = useState<{ left: number; top: number; width: number } | null>(null)
  // 快捷命令下拉浮层（对齐 Android Studio Logcat）
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuBtnRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const suggestRef = useRef<HTMLDivElement>(null)
  const logcatRef = useRef<Logcat>(null)
  const entriesRef = useRef<any[]>([])
  const logcatIdRef = useRef('')
  const panelRef = useRef<HTMLDivElement>(null)
  const fontSizeRef = useRef(13)
  fontSizeRef.current = fontSize
  const draftRef = useRef('')
  draftRef.current = draft

  const { device } = store

  useEffect(() => {
    main.getLogcatStore('fontSize').then((size) => {
      if (typeof size === 'number') {
        setFontSize(size)
      }
    })
    main.getLogcatStore('savedFilters').then((val: unknown) => {
      if (Array.isArray(val)) {
        setSavedFilters(val as SavedFilter[])
      }
    })
  }, [])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) {
        return
      }
      e.preventDefault()
      const delta = e.deltaY < 0 ? 1 : -1
      const next = Math.min(32, Math.max(8, fontSizeRef.current + delta))
      if (next !== fontSizeRef.current) {
        setFontSize(next)
        main.setLogcatStore('fontSize', next)
      }
    }
    panel.addEventListener('wheel', onWheel, { passive: false })
    return () => panel.removeEventListener('wheel', onWheel)
  }, [])

  // 日志条目监听：挂载一次，靠 logcatIdRef 过滤当前流，跨重连复用，无需重绑
  // （同 Term 的 sessionIdRef 零重绑模式）。
  useEffect(() => {
    function onLogcatEntry(id, entry) {
      if (logcatIdRef.current !== id) {
        return
      }
      if (logcatRef.current) {
        logcatRef.current.append(entry)
        entriesRef.current.push(entry)
        // 镜像 maxNum 裁剪：与 luna-logcat 内部淘汰同节拍，防 entriesRef 无界增长，
        // 使 save() 导出量与可见缓冲一致（不含早已被环形淘汰的远古日志）。
        if (entriesRef.current.length > 10000) {
          entriesRef.current.shift()
        }
      }
    }
    const offLogcatEntry = main.on('logcatEntry', onLogcatEntry)
    return () => {
      offLogcatEntry()
    }
  }, [])

  // openLogcat 流随设备断开而死亡，且主进程不发 close 事件。以 device（真实
  // 连接状态）为键：blip A→null→A 时，null 瞬间关闭旧流、恢复后重开新流；
  // entriesRef 不清零，历史条目保留，新日志续接到既有缓冲之后。面板容器
  // key 已改为 activeDevice，blip 不卸载本组件，故此 effect 的重连得以运行。
  useEffect(() => {
    if (!device) {
      return
    }
    let cancelled = false
    main.openLogcat(device.id).then((id) => {
      if (!cancelled) {
        logcatIdRef.current = id
      }
    })
    return () => {
      cancelled = true
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
        logcatIdRef.current = ''
      }
    }
  }, [device])

  if (store.panel !== 'logcat') {
    if (!paused && logcatIdRef.current) {
      main.pauseLogcat(logcatIdRef.current)
    }
  } else {
    if (!paused && logcatIdRef.current) {
      main.resumeLogcat(logcatIdRef.current)
    }
  }

  /**
   * 应用一条查询字符串：编译 AST → 写实例 → setFilter 触发重跑。
   * 假定查询已合法（调用方保证）。空查询也应用（清过滤）。
   */
  /**
   * 即时应用过滤（方案 A）：仅当查询合法时编译 AST + 触发重跑；
   * 非法（打字中间态）静默忽略，不红框、面板保持上一次合法结果。
   */
  function applyQueryIfValid(query: string) {
    const result = parseFilter(query)
    if (!result.ok) {
      return // 非法中间态：不打扰，保留上次合法结果
    }
    setError(null)
    if (logcatRef.current) {
      ;(logcatRef.current as any).setFilterAst(result.ast)
      ;(logcatRef.current as any).setOption('filter', query)
    }
    setFilter(query)
  }

  /**
   * 失焦时最终校验：合法则确保应用（并清错误）；非法则红框提示、不动 filter。
   */
  function applyQuery(query: string) {
    const result = parseFilter(query)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (logcatRef.current) {
      ;(logcatRef.current as any).setFilterAst(result.ast)
      ;(logcatRef.current as any).setOption('filter', query)
    }
    setFilter(query)
  }

  function save() {
    const data = map(entriesRef.current, (entry) => {
      return trim(
        `${dateFormat(entry.date, 'mm-dd HH:MM:ss.l')} ${rpad(entry.pid, 5, ' ')} ${rpad(
          entry.tid,
          5,
          ' '
        )} ${toLetter(entry.priority)} ${entry.tag}: ${entry.message}`
      )
    }).join('\n')
    const name = `${store.device ? store.device.name : 'logcat'}.${dateFormat(
      'yyyymmddHH'
    )}.txt`
    download(data, name, 'text/plain')
  }

  function clear() {
    if (logcatRef.current) {
      logcatRef.current.clear()
    }
    entriesRef.current = []
  }

  // 联想：随打字更新浮层
  function updateSuggestions(text: string, cursor: number) {
    const res = getSuggestions(text, cursor)
    if (res && res.suggestions.length > 0) {
      setSuggestions(res.suggestions)
      setSuggestRange(res.replaceRange)
      setSelectedSuggest(0)
      // 计算浮层 fixed 定位（跳出 toolbar overflow-x:hidden 裁切）
      if (inputRef.current) {
        const r = inputRef.current.getBoundingClientRect()
        setSuggestPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 180) })
      }
    } else {
      setSuggestions([])
      setSuggestRange(null)
      setSuggestPos(null)
    }
  }

  function commitSuggestion(s: Suggestion) {
    if (!suggestRange || !inputRef.current) return
    const { text: newText, cursor: newCursor } = applySuggestion(
      draftRef.current,
      inputRef.current.selectionStart || 0,
      s,
      suggestRange
    )
    setDraft(newText)
    draftRef.current = newText
    setSuggestions([])
    setSuggestRange(null)
    // 插入后即时应用过滤（方案 A：合法即时应用）
    applyQueryIfValid(newText)
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(newCursor, newCursor)
        // 插入后对新文本+新光标重新触发联想（如点 level: 后继续联想枚举值）
        updateSuggestions(newText, newCursor)
      }
    })
  }

  // 保存快捷命令
  function persistSavedFilters(next: SavedFilter[]) {
    setSavedFilters(next)
    main.setLogcatStore('savedFilters', next)
  }

  function doSaveFilter() {
    const name = saveName.trim()
    if (!name) return
    // 若已存在同名则覆盖；新存即置顶（lastUsed = now，渲染降序）
    const next = savedFilters.filter((f) => f.name !== name)
    next.push({ name, query: draft, lastUsed: Date.now() })
    persistSavedFilters(next)
    setSaving(false)
    setSaveName('')
  }

  function applyShortcut(f: SavedFilter) {
    setDraft(f.query)
    draftRef.current = f.query
    applyQuery(f.query)
    // 用一次即置顶：更新 lastUsed
    const now = Date.now()
    persistSavedFilters(
      savedFilters.map((s) => (s.name === f.name ? { ...s, lastUsed: now } : s))
    )
    setMenuOpen(false)
  }

  function deleteShortcut(name: string) {
    persistSavedFilters(savedFilters.filter((f) => f.name !== name))
  }

  /**
   * 下拉按钮：过滤输入框左侧，对齐 AS Logcat。
   * label 固定（不反映激活态，单向同步）。展开时关闭联想浮层，避免叠加。
   */
  function toggleMenu() {
    if (!device) return
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    // 互斥：开下拉先关联想
    setSuggestions([])
    setSuggestRange(null)
    setSuggestPos(null)
    if (menuBtnRef.current) {
      const r = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 220) })
    }
    setMenuOpen(true)
  }

  // 下拉外部点击 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current && menuRef.current.contains(target)) return
      if (menuBtnRef.current && menuBtnRef.current.contains(target)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // 联想浮层外部点击 / Esc 关闭（仿 menuOpen effect：document mousedown + keydown）
  // 修 R2（无点外部关闭）+ R5（失焦后 Esc 失效，input onKeyDown 不触发）。
  // 依赖 suggestRef 判"落点在浮层内"避免与浮层项 commitSuggestion 竞争（同 menuRef 之于下拉浮层）。
  useEffect(() => {
    if (!suggestPos) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (suggestRef.current && suggestRef.current.contains(target)) return
      if (inputRef.current && inputRef.current.contains(target)) return
      setSuggestions([])
      setSuggestRange(null)
      setSuggestPos(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSuggestions([])
        setSuggestRange(null)
        setSuggestPos(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [suggestPos])

  const onContextMenu = (e: PointerEvent, entry: any) => {
    e.preventDefault()
    const logcat = logcatRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click: () => {
          if (logcat.hasSelection()) {
            copy(logcat.getSelection())
          } else if (entry) {
            copy(entry.message)
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click: clear,
      },
    ]
    contextMenu(e, template)
  }

  const showError = !!error
  // 保存命名默认候选：从 draft 提取 name:
  const defaultSaveName = saving ? saveName || extractName(draft) || '' : ''
  // 快捷命令按 lastUsed 降序（最近使用/新保存在前，缺字段视作 0 沉底）
  const sortedFilters = [...savedFilters].sort(
    (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)
  )
  const canSaveCurrent = !!device && !!trim(draft)
  // 当前 query 是否已是已保存快捷命令（trim 比较，决定五角星实心/空心 + 点击切换保存/取消）
  const matchingSaved = savedFilters.find((f) => trim(f.query) === trim(draft))
  const isCurrentSaved = !!matchingSaved

  return (
    <div className="panel-with-toolbar" ref={panelRef}>
      <LunaToolbar
        className="panel-toolbar"
        onChange={(key, val) => {
          if (key === 'view') {
            setView(val)
          }
        }}
      >
        <LunaToolbarSelect
          keyName="view"
          disabled={!device}
          value={view}
          options={{
            [t('standardView')]: 'standard',
            [t('compactView')]: 'compact',
          }}
        />
        <LunaToolbarSeparator />
        {/* 快捷命令下拉按钮（过滤输入框左侧，对齐 Android Studio Logcat） */}
        <div
          ref={menuBtnRef}
          className={
            'luna-logcat-menu-btn' + (menuOpen ? ' active' : '') + (!device ? ' disabled' : '')
          }
          title={t('shortcut')}
          onClick={toggleMenu}
        >
          <span className="luna-logcat-menu-btn-label">{t('shortcut')}</span>
          <span className="luna-logcat-menu-btn-caret">▾</span>
        </div>
        <div
          className={
            'luna-logcat-filter-box' + (showError ? ' luna-logcat-filter-error' : '')
          }
          title={showError ? t('filterSyntaxError') + ': ' + error : undefined}
        >
          <input
            ref={inputRef}
            type="text"
            className="luna-logcat-filter-input"
            placeholder={t('filterPlaceholder') || t('message')}
            value={draft}
            disabled={!device}
            onChange={(e) => {
              const v = e.target.value
              setDraft(v)
              draftRef.current = v
              if (error) setError(null)
              // 互斥：打字时关闭下拉
              if (menuOpen) setMenuOpen(false)
              updateSuggestions(v, e.target.selectionStart || 0)
              // 方案 A：打字即时过滤（合法即应用，非法中间态静默忽略）
              applyQueryIfValid(v)
            }}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelectedSuggest((p) => (p + 1) % suggestions.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelectedSuggest(
                    (p) => (p - 1 + suggestions.length) % suggestions.length
                  )
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  commitSuggestion(suggestions[selectedSuggest])
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSuggestions([])
                  setSuggestRange(null)
                  return
                }
              }
            }}
            onBlur={() => {
              // 失焦校验应用。若浮层正操作（mousedown 选中），由浮层 mousedown preventDefault 阻止失焦。
              applyQuery(draft)
            }}
          />
          {/* 保存当前查询为快捷命令（输入框最右侧五角星，动态：已保存=实心，未保存=空心描边）。
              矢量图取自 Feather star.svg（src/renderer/icon/star.svg），内联以支持 fill 切换。 */}
          <div
            className={
              'luna-logcat-save-star' +
              (canSaveCurrent || isCurrentSaved ? '' : ' disabled') +
              (isCurrentSaved ? ' saved' : '')
            }
            title={isCurrentSaved ? t('removeFilter') : t('saveFilter')}
            onMouseDown={(e) => {
              e.preventDefault()
              if (!device) return
              if (!canSaveCurrent && !isCurrentSaved) return
              if (isCurrentSaved && matchingSaved) {
                // 已保存 → 点击取消保存（移除该条）
                deleteShortcut(matchingSaved.name)
              } else {
                // 未保存 → 弹命名对话框
                setSaveName(extractName(draft) || '')
                setSaving(true)
              }
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                fill={isCurrentSaved ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <ToolbarIcon
          icon="save"
          title={t('save')}
          onClick={save}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="soft-wrap"
          state={softWrap ? 'hover' : ''}
          title={t('softWrap')}
          onClick={() => setSoftWrap(!softWrap)}
        />
        <ToolbarIcon
          icon="scroll-end"
          title={t('scrollToEnd')}
          onClick={() => logcatRef.current?.scrollToEnd()}
          disabled={!device}
        />
        <ToolbarIcon
          icon="reset"
          title={t('restart')}
          onClick={() => {
            if (logcatIdRef.current) {
              main.closeLogcat(logcatIdRef.current)
              clear()
            }
            if (device) {
              main.openLogcat(device.id).then((id) => {
                logcatIdRef.current = id
              })
            }
          }}
          disabled={!device}
        />
        <ToolbarIcon
          icon={paused ? 'play' : 'pause'}
          title={t(paused ? 'resume' : 'pause')}
          onClick={() => {
            if (paused) {
              main.resumeLogcat(logcatIdRef.current)
            } else {
              main.pauseLogcat(logcatIdRef.current)
            }
            setPaused(!paused)
          }}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="delete"
          title={t('clear')}
          onClick={clear}
          disabled={!device}
        />
      </LunaToolbar>
      {/* 保存命名对话框 */}
      {saving && (
        <div
          className="luna-logcat-save-dialog-overlay"
          onClick={() => setSaving(false)}
        >
          <div className="luna-logcat-save-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="luna-logcat-save-dialog-title">{t('saveFilter')}</div>
            <input
              autoFocus
              className="luna-logcat-save-dialog-input"
              value={defaultSaveName}
              placeholder={t('filterName')}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSaveFilter()
                if (e.key === 'Escape') setSaving(false)
              }}
            />
            <div className="luna-logcat-save-dialog-actions">
              <button onClick={() => setSaving(false)}>{t('cancel')}</button>
              <button onClick={doSaveFilter} disabled={!saveName.trim()}>
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
      <LunaLogcat
        className="panel-body"
        maxNum={10000}
        maxFilteredNum={100000}
        filter={filter as any}
        wrapLongLines={softWrap}
        fontSize={fontSize}
        onContextMenu={onContextMenu}
        view={view}
        onCreate={(logcat) => (logcatRef.current = logcat)}
      />
      {/* 联想浮层：fixed 定位，跳出 toolbar overflow-x:hidden 裁切 */}
      {suggestions.length > 0 && suggestPos && (
        <div
          ref={suggestRef}
          className="luna-logcat-suggest"
          style={{
            position: 'fixed',
            left: suggestPos.left,
            top: suggestPos.top,
            minWidth: suggestPos.width,
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={s.label}
              className={
                'luna-logcat-suggest-item' +
                (i === selectedSuggest ? ' active' : '')
              }
              onMouseDown={(e) => {
                e.preventDefault()
                commitSuggestion(s)
              }}
              onMouseEnter={() => setSelectedSuggest(i)}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
      {/* 快捷命令下拉浮层：fixed 定位，跳出 toolbar overflow-x:hidden 裁切 */}
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          className="luna-logcat-menu"
          style={{
            position: 'fixed',
            left: menuPos.left,
            top: menuPos.top,
            minWidth: menuPos.width,
          }}
        >
          {sortedFilters.length === 0 && (
            <div className="luna-logcat-menu-empty">{t('shortcut')}</div>
          )}
          {sortedFilters.map((f) => (
            <div
              key={f.name}
              className="luna-logcat-menu-item"
              title={f.query}
              onMouseDown={(e) => {
                e.preventDefault()
                applyShortcut(f)
              }}
            >
              <span className="luna-logcat-menu-item-name">{f.name}</span>
              <span
                className="luna-logcat-menu-item-del"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  deleteShortcut(f.name)
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

function toLetter(priority: number) {
  return ['?', '?', 'V', 'D', 'I', 'W', 'E'][priority]
}
