/**
 * 统一日志过滤查询语言（对齐 Android Studio Logcat V2）。
 *
 * 文法（递归下降，优先级高→低）:
 *   expr    := orExpr
 *   orExpr  := andExpr ('|' andExpr)*
 *   andExpr := unit ('&' unit | unit)*          ← 显式 & 或隐式（相邻 unit 无操作符）
 *   unit    := '-'? key (':' | '~:') value       ← 字段级否定/正则（否定仅作用于 keyval/regex）
 *          | atom
 *   atom    := '(' expr ')' | quoted | bareword
 *
 * 操作符:
 *   key:value     包含匹配（key 指定字段）
 *   key~:value    正则匹配
 *   -key:value    否定（排除）
 *   -key~:value   否定 + 正则
 *   &             AND（显式）
 *   |             OR
 *   ( )           分组
 *   "..."         精确短语（内部一切字面）
 *   空白          隐式 AND（低优先级）
 *
 * 隐式规则（对齐 AS）:
 *   同 key 多个非否定 keyval → OR
 *   其余相邻项 → AND
 *   裸文本（无 key 前缀）默认匹配 message
 *
 * 键: package | tag | message | level | is | name
 *   level:value  → 匹配该级别及以上（>=），值大小写不敏感
 *   is:crash / is:stacktrace → 读 entry 预标记
 *   name:value   → 仅保存用，求值恒真
 *
 * parse() 返回 { ok:true, ast } | { ok:false, error }，永不抛异常。
 * evalAst(ast, entry, helpers) 对 entry 求值，helpers 提供 contain/lowerCase/getField/isCrash/isStacktrace。
 */

export type KeyName = 'package' | 'tag' | 'message' | 'level' | 'is' | 'name'

export type AstNode =
  | { type: 'term'; value: string } // 裸文本 → message
  | { type: 'keyval'; key: KeyName; value: string; regex: boolean; negate: boolean }
  | { type: 'not'; child: AstNode }
  | { type: 'and'; children: AstNode[] }
  | { type: 'or'; children: AstNode[] }

export interface ParseSuccess {
  ok: true
  ast: AstNode | null
}
export interface ParseFailure {
  ok: false
  error: string
}
export type ParseResult = ParseSuccess | ParseFailure

// level 名称 → 数字（>= 比较）
export const LEVEL_MAP: Record<string, number> = {
  verbose: 2,
  debug: 3,
  info: 4,
  warn: 5,
  warning: 5,
  error: 6,
  assert: 7,
  fatal: 7,
  // 首字母
  v: 2,
  d: 3,
  i: 4,
  w: 5,
  e: 6,
  a: 7,
  f: 7,
}

const KEY_NAMES = new Set<KeyName>(['package', 'tag', 'message', 'level', 'is', 'name'])

type Token =
  | { type: 'amp' }
  | { type: 'pipe' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'quoted'; value: string }
  | { type: 'word'; value: string }

/**
 * 词法分析。
 * - 空白分隔 token（隐式 AND）；& | ( ) 单字符操作符。
 * - "..." 引号串（内部字面，支持跨空白）。
 * - 其余连续非空白、非操作符字符为 word（后续由 parser 判定 keyval / bare）。
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '&') {
      tokens.push({ type: 'amp' })
      i++
      continue
    }
    if (ch === '|') {
      tokens.push({ type: 'pipe' })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (ch === '"') {
      i++
      let buf = ''
      while (i < n && input[i] !== '"') {
        buf += input[i]
        i++
      }
      if (i < n && input[i] === '"') {
        i++
      }
      tokens.push({ type: 'quoted', value: buf })
      continue
    }
    // word：连续非空白、非 & ( )；遇到 " 则吞掉引号内整段（含空白），使
    // message:"anr detected" 成为一个 word（key:value 含空格短语）。
    // 字段值作用域：识别到 [-]key: 或 [-]key~: 前缀后，紧贴的 |（无空格）属于该字段
    // 的值作用域（字段级 OR），整体作为一个 word；遇空格则作用域结束，| 才当顶层 OR。
    let buf = ''
    while (i < n) {
      const c = input[i]
      // 检测到 [-]key: 或 [-]key~: 前缀且紧跟 ( 时，吞掉配对括号作为 value 的一部分
      // （使 tag~:(A|B|C) / -tag~:(A|B|C) 整体作为一个 word，括号与 | 属于正则 value 作用域）
      if (c === '(' && /^-?[a-zA-Z]+~?:$/.test(buf)) {
        let depth = 0
        while (i < n) {
          const cc = input[i]
          if (cc === '(') depth++
          else if (cc === ')') {
            depth--
            if (depth === 0) {
              buf += cc
              i++
              break
            }
          }
          buf += cc
          i++
        }
        continue
      }
      // 字段值作用域内的紧贴 |：key: 或 key~: 之后、遇 | 且 buf 已是字段前缀或其后继项，
      // 则把 | 作为 value 的一部分吞掉（字段级 OR），继续吞下一个非空白项。
      if (c === '|' && /^-?[a-zA-Z]+~?:[\s\S]+$/.test(buf)) {
        buf += c
        i++
        continue
      }
      if (/\s/.test(c) || c === '&' || c === '|' || c === '(' || c === ')') break
      if (c === '"') {
        i++
        while (i < n && input[i] !== '"') {
          buf += input[i]
          i++
        }
        if (i < n && input[i] === '"') {
          i++
        }
        continue
      }
      buf += c
      i++
    }
    if (buf.length > 0) {
      tokens.push({ type: 'word', value: buf })
      continue
    }
    i++
  }
  return tokens
}

/**
 * 将一个 word 判定为 keyval 或 bare。
 * 形如：[-]key[:|~:]value，key 须为已知键名。否则整串为 bare（裸文本→message）。
 */
function classifyWord(word: string): { kind: 'keyval'; key: KeyName; value: string; regex: boolean; negate: boolean } | { kind: 'bare'; value: string } {
  // 否定前缀
  let negate = false
  let s = word
  if (s.startsWith('-')) {
    negate = true
    s = s.slice(1)
  }
  // 正则后缀前：匹配 key[:~:]value
  // key 为字母序列，后跟 : 或 ~:
  const m = s.match(/^([a-zA-Z]+)(~)?:([\s\S]*)$/)
  if (m) {
    const key = m[1].toLowerCase()
    const regex = !!m[2]
    const value = m[3]
    if (KEY_NAMES.has(key as KeyName)) {
      return { kind: 'keyval', key: key as KeyName, value, regex, negate }
    }
  }
  // 非已知 key：整串（含原始前导 -）作 bare
  return { kind: 'bare', value: word }
}

interface ParserState {
  tokens: Token[]
  pos: number
}

function peek(s: ParserState): Token | undefined {
  return s.tokens[s.pos]
}
function next(s: ParserState): Token | undefined {
  return s.tokens[s.pos++]
}

function parseExpr(s: ParserState): AstNode | null {
  return parseOr(s)
}

function parseOr(s: ParserState): AstNode | null {
  const left = parseAnd(s)
  if (left === null) return null
  const children: AstNode[] = [left]
  while (peek(s)?.type === 'pipe') {
    next(s)
    const right = parseAnd(s)
    if (right === null) {
      throw new SyntaxError("missing operand after '|'")
    }
    children.push(right)
  }
  return children.length === 1 ? left : { type: 'or', children }
}

/**
 * unit：单个 AND 操作数。lparen → 括号子表达式（parseAtom）；否则隐式组（bare/keyval + 隐式OR）。
 */
function parseUnit(s: ParserState): AstNode | null {
  const tk = peek(s)
  if (tk && tk.type === 'lparen') {
    return parseAtom(s)
  }
  return parseImplicitGroup(s)
}

/**
 * AND 层：收集相邻 unit（显式 & 或隐式相邻），并实现隐式 OR（同 key 多非否定 keyval）。
 * 实现：先收集一串相邻 unit（用 AND 连接），但若连续多个同 key 的非否定 keyval，则用 OR 包裹该组。
 */
function parseAnd(s: ParserState): AstNode | null {
  const group = parseUnit(s)
  if (group === null) return null
  const andChildren: AstNode[] = [group]
  while (true) {
    const tk = peek(s)
    if (!tk) break
    if (tk.type === 'pipe' || tk.type === 'rparen') break
    if (tk.type === 'amp') {
      next(s)
      const g = parseUnit(s)
      if (g === null) throw new SyntaxError("missing operand after '&'")
      andChildren.push(g)
      continue
    }
    // 隐式 AND：相邻 unit（word/quoted/lparen）
    if (tk.type === 'lparen') {
      const a = parseAtom(s)
      if (a === null) break
      andChildren.push(a)
      continue
    }
    if (tk.type === 'word' || tk.type === 'quoted') {
      const g = parseImplicitGroup(s)
      if (g === null) break
      andChildren.push(g)
      continue
    }
    break
  }
  return andChildren.length === 1 ? andChildren[0] : { type: 'and', children: andChildren }
}

/**
 * 隐式组：收集一串"无操作符"相邻 keyval/bare，对同 key 非否定 keyval 做 OR，
 * 其余 AND。遇到 & | ) 或结束即停。
 * 注意：裸文本相邻成组（'foo bar' 视为单 message term 的一部分——AS 行为：
 *   foo bar tag:bar1 | tag:bar2 → 'foo bar' & (tag:bar1 | tag:bar2)
 *   即连续 bare 合并为一个 term 值，而非 AND）。
 */
function parseImplicitGroup(s: ParserState): AstNode | null {
  // 收集相邻 bare 合并 + keyval 列表
  let bareBuf: string[] = []
  const keyvals: { node: AstNode; key: KeyName; negate: boolean }[] = []
  let sawAny = false

  function flushBare(): AstNode | null {
    if (bareBuf.length === 0) return null
    const val = bareBuf.join(' ').trim()
    bareBuf = []
    if (val === '') return null
    return { type: 'term', value: val }
  }

  while (true) {
    const tk = peek(s)
    if (!tk) break
    if (tk.type === 'amp' || tk.type === 'pipe' || tk.type === 'rparen') break
    if (tk.type === 'word') {
      const c = classifyWord(tk.value)
      if (c.kind === 'bare') {
        bareBuf.push(c.value)
        next(s)
        sawAny = true
      } else {
        // keyval：相邻 bare 已收集在 bareBuf，稍后合并为单 term 与 keyval 并列（AND）
        next(s)
        const node: AstNode = c.regex
          ? { type: 'keyval', key: c.key, value: c.value, regex: true, negate: c.negate }
          : { type: 'keyval', key: c.key, value: c.value, regex: false, negate: c.negate }
        keyvals.push({ node, key: c.key, negate: c.negate })
        sawAny = true
      }
      continue
    }
    if (tk.type === 'quoted') {
      // 引号短语作为 bare 文本的一部分（与相邻 bare 合并）
      bareBuf.push(tk.value)
      next(s)
      sawAny = true
      continue
    }
    if (tk.type === 'lparen') {
      // 括号作为一个子项：先 flush bare
      break
    }
    break
  }

  if (!sawAny) return null

  // 组装：bare 合并为单 term（AS: 连续 bare 成组），keyval 同 key 非否定 OR、其余 AND
  const parts: AstNode[] = []
  const bareTerm = flushBare()
  if (bareTerm) parts.push(bareTerm)

  // keyval 分组：同 key 的连续非否定项 OR。简化策略：把 keyvals 按 key 分组（非否定），
  // 同组多项用 or 包裹；否定项单独 AND。
  const byKey = new Map<KeyName, AstNode[]>()
  const others: AstNode[] = []
  for (const kv of keyvals) {
    if (!kv.negate) {
      let arr = byKey.get(kv.key)
      if (!arr) {
        arr = []
        byKey.set(kv.key, arr)
      }
      arr.push(kv.node)
    } else {
      others.push(kv.node)
    }
  }
  byKey.forEach((arr) => {
    parts.push(arr.length === 1 ? arr[0] : { type: 'or', children: arr })
  })
  others.forEach((n) => parts.push(n))

  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return { type: 'and', children: parts }
}

// parseAnd 内调用 parseImplicitGroup 已处理括号外的隐式；括号在 atom 层处理。
// 但 parseImplicitGroup 遇 lparen 即 break，回到 parseAnd 层会把它当隐式 AND 子项处理。
// 需在 parseAnd 的"隐式相邻"分支支持 lparen → parseAtom。
function parseAtom(s: ParserState): AstNode | null {
  const tk = peek(s)
  if (!tk) return null
  if (tk.type === 'lparen') {
    next(s)
    const inner = parseExpr(s)
    const close = next(s)
    if (!close || close.type !== 'rparen') {
      throw new SyntaxError("missing ')'")
    }
    return inner
  }
  if (tk.type === 'quoted') {
    next(s)
    return { type: 'term', value: tk.value }
  }
  if (tk.type === 'word') {
    next(s)
    const c = classifyWord(tk.value)
    if (c.kind === 'bare') {
      return { type: 'term', value: c.value }
    }
    return c.regex
      ? { type: 'keyval', key: c.key, value: c.value, regex: true, negate: c.negate }
      : { type: 'keyval', key: c.key, value: c.value, regex: false, negate: c.negate }
  }
  throw new SyntaxError(`unexpected '${describeToken(tk)}'`)
}

function describeToken(tk: Token): string {
  switch (tk.type) {
    case 'amp':
      return '&'
    case 'pipe':
      return '|'
    case 'lparen':
      return '('
    case 'rparen':
      return ')'
    case 'word':
      return tk.value
    case 'quoted':
      return `"${tk.value}"`
  }
}

/**
 * 解析查询字符串为 AST。空串 → ok 且 ast=null（不过滤）。
 */
export function parseFilter(query: string): ParseResult {
  const trimmed = query.trim()
  if (trimmed === '') {
    return { ok: true, ast: null }
  }
  try {
    const s: ParserState = { tokens: tokenize(trimmed), pos: 0 }
    if (s.tokens.length === 0) {
      return { ok: true, ast: null }
    }
    const ast = parseExpr(s)
    if (s.pos < s.tokens.length) {
      const rest = s.tokens[s.pos]
      throw new SyntaxError(`unexpected '${describeToken(rest)}'`)
    }
    if (ast === null) {
      return { ok: true, ast: null }
    }
    return { ok: true, ast }
  } catch (e) {
    const msg = e instanceof SyntaxError ? e.message : 'syntax error'
    return { ok: false, error: msg }
  }
}

export function isEmptyAst(ast: AstNode | null): boolean {
  return ast == null
}

/** 从查询中提取 name: 值（保存命名候选）。取第一个 name: 原子的值。 */
export function extractName(query: string): string | null {
  const r = parseFilter(query)
  if (!r.ok || !r.ast) return null
  let found: string | null = null
  function walk(n: AstNode | null) {
    if (!n || found) return
    if (n.type === 'keyval' && n.key === 'name') {
      found = n.value
      return
    }
    if (n.type === 'not') walk(n.child)
    else if (n.type === 'and' || n.type === 'or') n.children.forEach(walk)
  }
  walk(r.ast)
  return found
}

/**
 * 求值器辅助：调用方提供字段访问与匹配原语，避免本模块直接依赖 licia 与 entry 标记。
 */
export interface EvalHelpers {
  contain: (haystack: string, needle: string) => boolean
  lowerCase: (s: string) => string
  getField: (entry: any, key: string) => string
  getPriority: (entry: any) => number
  isCrash: (entry: any) => boolean
  isStacktrace: (entry: any) => boolean
}

const regexCache = new Map<string, RegExp>()
function getRegex(pattern: string): RegExp | null {
  let re = regexCache.get(pattern)
  if (re) return re
  try {
    re = new RegExp(pattern)
  } catch {
    return null
  }
  regexCache.set(pattern, re)
  return re
}

/**
 * 对 entry 求值 AST。name: 原子恒真；is:crash/is:stacktrace 读标记。
 */
export function evalAst(ast: AstNode | null, entry: any, h: EvalHelpers): boolean {
  if (ast == null) return true
  switch (ast.type) {
    case 'term': {
      if (ast.value === '') return true
      return h.contain(h.lowerCase(h.getField(entry, 'message')), h.lowerCase(ast.value))
    }
    case 'keyval': {
      // name: 恒真
      if (ast.key === 'name') return true
      // is: 特殊
      if (ast.key === 'is') {
        const v = ast.value.toLowerCase()
        let hit: boolean
        if (v === 'crash') hit = h.isCrash(entry)
        else if (v === 'stacktrace') hit = h.isStacktrace(entry)
        else hit = false
        return ast.negate ? !hit : hit
      }
      // level: >= 比较
      if (ast.key === 'level') {
        const lvl = LEVEL_MAP[ast.value.toLowerCase()]
        if (lvl === undefined) {
          // 未知 level 值：求值 false（不匹配）；否定则 true
          return ast.negate ? true : false
        }
        const hit = h.getPriority(entry) >= lvl
        return ast.negate ? !hit : hit
      }
      // package/tag/message：包含或正则
      const field = h.getField(entry, ast.key)
      let hit: boolean
      if (ast.regex) {
        const re = getRegex(ast.value)
        hit = re ? re.test(field) : false
      } else {
        hit = h.contain(h.lowerCase(field), h.lowerCase(ast.value))
      }
      return ast.negate ? !hit : hit
    }
    case 'not':
      return !evalAst(ast.child, entry, h)
    case 'and':
      return ast.children.every((c) => evalAst(c, entry, h))
    case 'or':
      return ast.children.some((c) => evalAst(c, entry, h))
  }
  return true
}

/** 构造与 luna-logcat patch 一致的 contain/lowerCase helpers（licia 语义）。 */
export function makeHelpers(entryGetters: {
  getField: (entry: any, key: string) => string
  getPriority: (entry: any) => number
  isCrash: (entry: any) => boolean
  isStacktrace: (entry: any) => boolean
}): EvalHelpers {
  const lowerCase = (s: string) => (s == null ? '' : String(s).toLowerCase())
  const contain = (haystack: string, needle: string) =>
    haystack.indexOf(needle) !== -1
  return {
    contain,
    lowerCase,
    getField: entryGetters.getField,
    getPriority: entryGetters.getPriority,
    isCrash: entryGetters.isCrash,
    isStacktrace: entryGetters.isStacktrace,
  }
}
