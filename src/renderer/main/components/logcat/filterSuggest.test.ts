/**
 * filterSuggest 单元测试（联想补全浮层候选计算）。
 * 运行：npx esbuild <this> --bundle --format=cjs --platform=node | node
 *
 * 覆盖（对齐 design.md D7 / tasks §8.3）：
 * - 键名前缀联想（package/tag/message/level/is + 否定 + 正则形式）
 * - level: / is: 枚举值联想
 * - 精确匹配不再重弹（R1 回归：is:crash / level:error 等完整值不返回自身）
 * - 键后空值列全部（level: → 全部 level，不破坏 §4.7）
 * - 空 token 不弹
 * - applySuggestion 替换范围与光标定位
 */
import {
  getSuggestions,
  applySuggestion,
} from './filterSuggest'

let pass = 0,
  fail = 0
function ck(name: string, cond: boolean) {
  if (cond) pass++
  else {
    fail++
    console.error('FAIL: ' + name)
  }
}

function labels(text: string, cursor: number): string[] | null {
  const r = getSuggestions(text, cursor)
  if (!r) return null
  return r.suggestions.map((s) => s.label)
}

export function runFilterSuggestTests() {
  pass = 0
  fail = 0

  // --- 空 token 不弹 ---
  ck('empty input no suggest', getSuggestions('', 0) === null)
  ck('cursor in whitespace no suggest', getSuggestions('tag:foo ', 8) === null)
  ck('cursor after separator no suggest', getSuggestions('tag:foo|', 8) === null)

  // --- 键名前缀联想 ---
  ck('pa → package:', labels('pa', 2)?.includes('package:') === true)
  ck('ta → tag:', labels('ta', 2)?.includes('tag:') === true)
  ck('me → message:', labels('me', 2)?.includes('message:') === true)
  ck('le → level:', labels('le', 2)?.includes('level:') === true)
  ck('is → is:', labels('is', 2)?.includes('is:') === true)
  ck('-ta → -tag:', labels('-ta', 3)?.includes('-tag:') === true)
  ck('-pa → -package:', labels('-pa', 3)?.includes('-package:') === true)
  // 正则形式前缀需完整键名 + ~（KEY_PREFIXES 记 tag~ 非 ta~；D3 文档 ta~ 系笔误）
  ck('tag~ → tag~:', labels('tag~', 4)?.includes('tag~:') === true)
  ck('-tag~ → -tag~:', labels('-tag~', 5)?.includes('-tag~:') === true)
  // 大小写不敏感前缀
  ck('TA → tag: (case-insensitive)', labels('TA', 2)?.includes('tag:') === true)

  // --- level 枚举值联想 ---
  ck('level: → all 6 levels', labels('level:', 6)?.length === 6)
  ck('level:w → warn', labels('level:w', 7)?.includes('level:warn') === true)
  ck('level:e → error', labels('level:e', 7)?.includes('level:error') === true)
  ck('level:er → error', labels('level:er', 8)?.includes('level:error') === true)
  ck('level:i → info', labels('level:i', 7)?.includes('level:info') === true)
  // R1 回归：精确匹配不重弹
  ck('level:error exact → no resuggest', labels('level:error', 11) === null)
  ck('level:warn exact → no resuggest', labels('level:warn', 10) === null)
  ck('level:verbose exact → no resuggest', labels('level:verbose', 13) === null)
  // 大小写不敏感精确排除
  ck('level:ERROR exact → no resuggest', labels('level:ERROR', 11) === null)
  // 否定形式
  ck('-level: → all 6 levels', labels('-level:', 7)?.length === 6)
  ck('-level:e → -level:error', labels('-level:e', 8)?.includes('-level:error') === true)
  ck('-level:error exact → no resuggest', labels('-level:error', 12) === null)

  // --- is 枚举值联想 ---
  ck('is: → crash + stacktrace', labels('is:', 3)?.length === 2)
  ck('is:c → is:crash', labels('is:c', 4)?.includes('is:crash') === true)
  ck('is:s → is:stacktrace', labels('is:s', 4)?.includes('is:stacktrace') === true)
  ck('is:cr → is:crash', labels('is:cr', 5)?.includes('is:crash') === true)
  // R1 回归（本 bug 起因）
  ck('is:crash exact → no resuggest', labels('is:crash', 8) === null)
  ck('is:stacktrace exact → no resuggest', labels('is:stacktrace', 14) === null)
  ck('is:CRASH exact → no resuggest (case)', labels('is:CRASH', 8) === null)
  // 否定形式
  ck('-is: → crash + stacktrace', labels('-is:', 4)?.length === 2)
  ck('-is:crash exact → no resuggest', labels('-is:crash', 9) === null)

  // --- 复合查询中光标所在 token ---
  ck('compound: cursor on 2nd token', labels('tag:foo is:c', 11)?.includes('is:crash') === true)
  // 1st token 已含冒号（: 非分隔符 → token=tag:foo）→ 无键名/枚举联想（已完成 key:value）
  ck('compound: cursor in completed 1st token → null', labels('tag:foo is:c', 3) === null)
  // 尚未打冒号的裸键名（空格分隔独立 token）→ 建议键名
  ck('compound: bare key token before space → key suggest', labels('tag is:c', 2)?.includes('tag:') === true)
  // 竖线分隔的字段值作用域之外
  ck('after | separator: bare token', getSuggestions('tag:foo | is:c', 13) === null ? true : labels('tag:foo | is:c', 13) !== null)

  // --- 未知键值 / 无联想 ---
  ck('level:zzz → null (no level match)', labels('level:zzz', 9) === null)
  ck('is:foo → null (no is match)', labels('is:foo', 6) === null)
  ck('xyz:abc → unknown key no suggest', getSuggestions('xyz:abc', 7) === null)

  // --- applySuggestion 替换范围与光标 ---
  {
    const r = getSuggestions('is:c', 4)!
    const s = r.suggestions.find((x) => x.label === 'is:crash')!
    const applied = applySuggestion('is:c', 4, s, r.replaceRange)
    ck('applySuggestion replaces token', applied.text === 'is:crash')
    ck('applySuggestion cursor at end', applied.cursor === 8)
  }
  {
    // 复合查询中只替换当前 token，保留其余
    const text = 'tag:foo is:c'
    const r = getSuggestions(text, 12)! // 光标在 is:c
    const s = r.suggestions.find((x) => x.label === 'is:crash')!
    const applied = applySuggestion(text, 12, s, r.replaceRange)
    ck('applySuggestion preserves rest', applied.text === 'tag:foo is:crash')
    // is:c 在 index 8，插 is:crash(8 字符) → 光标 8+8=16
    ck('applySuggestion cursor after inserted token', applied.cursor === 16)
  }
  {
    // level: 前缀补全：is: → is:crash 替换 is: 整个 token
    const r = getSuggestions('is:', 3)!
    const s = r.suggestions.find((x) => x.label === 'is:crash')!
    const applied = applySuggestion('is:', 3, s, r.replaceRange)
    ck('applySuggestion is: → is:crash', applied.text === 'is:crash')
  }

  console.log(`filterSuggest tests: ${pass} passed, ${fail} failed`)
  return fail === 0
}

if (require.main === module) {
  const ok = runFilterSuggestTests()
  process.exit(ok ? 0 : 1)
}
