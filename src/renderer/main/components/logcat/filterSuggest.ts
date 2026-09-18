/**
 * 单框过滤联想补全。
 * 给定当前输入框文本与光标位置，返回联想候选列表（用于浮层）。
 *
 * 联想规则（对齐 Android Studio）：
 * - 取光标所在 token（按空白 & | ( ) 分隔）
 * - 若 token 为键名前缀（pa/ta/me/le/is/-ta/ta~ 等）→ 联想对应 key: 形式
 * - 若 token 形如 `key:`（键名后跟冒号）→ 对 level/is 联想枚举值
 * - 否则无联想
 */

export interface Suggestion {
  text: string // 插入后替换当前 token 的完整文本
  label: string // 浮层显示
}

const KEY_PREFIXES: { prefix: string; insert: string; label: string }[] = [
  { prefix: 'package', insert: 'package:', label: 'package:' },
  { prefix: 'tag', insert: 'tag:', label: 'tag:' },
  { prefix: 'message', insert: 'message:', label: 'message:' },
  { prefix: 'level', insert: 'level:', label: 'level:' },
  { prefix: 'is', insert: 'is:', label: 'is:' },
  { prefix: '-package', insert: '-package:', label: '-package:' },
  { prefix: '-tag', insert: '-tag:', label: '-tag:' },
  { prefix: '-message', insert: '-message:', label: '-message:' },
  { prefix: '-level', insert: '-level:', label: '-level:' },
  { prefix: 'package~', insert: 'package~:', label: 'package~:' },
  { prefix: 'tag~', insert: 'tag~:', label: 'tag~:' },
  { prefix: 'message~', insert: 'message~:', label: 'message~:' },
  { prefix: '-package~', insert: '-package~:', label: '-package~:' },
  { prefix: '-tag~', insert: '-tag~:', label: '-tag~:' },
  { prefix: '-message~', insert: '-message~:', label: '-message~:' },
]

const LEVEL_VALUES = ['verbose', 'debug', 'info', 'warn', 'error', 'assert']
const IS_VALUES = ['crash', 'stacktrace']

/**
 * 取光标所在 token 的起止索引（按空白 & | ( ) 分隔）。
 */
function currentToken(
  text: string,
  cursor: number
): { start: number; end: number; token: string } {
  let start = cursor
  let end = cursor
  while (start > 0) {
    const ch = text[start - 1]
    if (/\s/.test(ch) || ch === '&' || ch === '|' || ch === '(' || ch === ')') break
    start--
  }
  while (end < text.length) {
    const ch = text[end]
    if (/\s/.test(ch) || ch === '&' || ch === '|' || ch === '(' || ch === ')') break
    end++
  }
  return { start, end, token: text.slice(start, end) }
}

/**
 * 计算联想候选。返回 null 表示无联想。
 */
export function getSuggestions(
  text: string,
  cursor: number
): { suggestions: Suggestion[]; replaceRange: { start: number; end: number } } | null {
  const { start, end, token } = currentToken(text, cursor)
  const lower = token.toLowerCase()
  // 空 token（输入框清空或光标在空白处）：不弹联想，避免清空后一直弹出
  if (token === '') {
    return null
  }
  // 键名前缀联想
  const prefixMatches = KEY_PREFIXES.filter((k) => k.prefix.startsWith(lower))
  // key: 形式（含冒号）→ 枚举值联想
  const colonIdx = lower.indexOf(':')
  if (colonIdx > 0) {
    const keyPart = lower.slice(0, colonIdx) // 形如 tag / level / -tag / tag~ / -tag~
    const valPart = token.slice(colonIdx + 1)
    if (keyPart === 'level' || keyPart === '-level') {
      // 排除大小写不敏感的精确匹配：完整值（如 level:error）不再自建议，
      // 避免 commitSuggestion 后 rAF 重弹相同文本（§4.7 有意重弹，此处堵其尽头）。
      // 仍允许更长扩展值；键后空值（level:）时守卫退化为 v!=='' 恒真，保留全部枚举。
      const lowerVal = valPart.toLowerCase()
      const vals = LEVEL_VALUES.filter(
        (v) => v.startsWith(lowerVal) && v.toLowerCase() !== lowerVal
      )
      if (vals.length > 0) {
        return {
          suggestions: vals.map((v) => ({
            text: `${keyPart}:` + v,
            label: `${keyPart}:` + v,
          })),
          replaceRange: { start, end },
        }
      }
    }
    if (keyPart === 'is' || keyPart === '-is') {
      // 同 level：排除精确匹配，避免 is:crash 选中后 rAF 重弹自身。
      const lowerVal = valPart.toLowerCase()
      const vals = IS_VALUES.filter(
        (v) => v.startsWith(lowerVal) && v.toLowerCase() !== lowerVal
      )
      if (vals.length > 0) {
        return {
          suggestions: vals.map((v) => ({
            text: `${keyPart}:` + v,
            label: `${keyPart}:` + v,
          })),
          replaceRange: { start, end },
        }
      }
    }
  }
  if (prefixMatches.length > 0) {
    return {
      suggestions: prefixMatches.map((k) => ({ text: k.insert, label: k.label })),
      replaceRange: { start, end },
    }
  }
  return null
}

/**
 * 将选中 suggestion 插入文本，返回新文本与新光标位置。
 */
export function applySuggestion(
  text: string,
  cursor: number,
  suggestion: Suggestion,
  range: { start: number; end: number }
): { text: string; cursor: number } {
  const before = text.slice(0, range.start)
  const after = text.slice(range.end)
  const newText = before + suggestion.text + after
  return { text: newText, cursor: range.start + suggestion.text.length }
}
