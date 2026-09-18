/**
 * filterQuery 单元测试（统一 DSL / AS 对齐）。
 * 运行：npx esbuild <this> --bundle --format=cjs --platform=node | node
 */
import {
  parseFilter,
  evalAst,
  extractName,
  makeHelpers,
} from './filterQuery'

// 构造一个 mock entry
function entry(opts: {
  package?: string
  tag?: string
  message?: string
  priority?: number
  crash?: boolean
  stacktrace?: boolean
}) {
  return {
    package: opts.package ?? 'com.foo.app',
    tag: opts.tag ?? 'MainActivity',
    message: opts.message ?? 'hello world',
    priority: opts.priority ?? 4,
    sessionId: opts.crash ? 's1' : null,
    isStackTrace: opts.stacktrace ?? false,
  }
}

const helpers = makeHelpers({
  getField: (e: any, key: string) => e[key] ?? '',
  getPriority: (e: any) => e.priority,
  isCrash: (e: any) => e.sessionId != null,
  isStacktrace: (e: any) => !!e.isStackTrace,
})

function ev(query: string, e: any): boolean {
  const r = parseFilter(query)
  if (!r.ok) throw new Error('parse failed: ' + r.error)
  return evalAst(r.ast, e, helpers)
}
function isOk(q: string): boolean {
  return parseFilter(q).ok
}
function errMsg(q: string): string | null {
  const r = parseFilter(q)
  return r.ok ? null : r.error
}

let pass = 0,
  fail = 0
function ck(name: string, cond: boolean) {
  if (cond) pass++
  else {
    fail++
    console.error('FAIL: ' + name)
  }
}

export function runFilterQueryTests() {
  pass = 0
  fail = 0

  // --- 空 ---
  ck('empty ok', isOk(''))
  ck('empty no-filter', ev('', entry({})) === true)

  // --- 裸文本 → message ---
  ck('bare matches message', ev('world', entry({ message: 'hello world' })) === true)
  ck('bare no match', ev('zzz', entry({ message: 'hello' })) === false)
  ck('bare case-insensitive', ev('WORLD', entry({ message: 'hello world' })) === true)

  // --- key:value ---
  ck('tag: matches', ev('tag:MainActivity', entry({ tag: 'MainActivity' })) === true)
  ck('tag: no match', ev('tag:Other', entry({ tag: 'MainActivity' })) === false)
  ck('package: matches', ev('package:com.foo', entry({ package: 'com.foo.app' })) === true)

  // --- 否定 ---
  ck('-tag: excludes', ev('-tag:MainActivity', entry({ tag: 'Other' })) === true)
  ck('-tag: no exclude when match', ev('-tag:MainActivity', entry({ tag: 'MainActivity' })) === false)

  // --- 正则 ---
  ck('tag~: regex match', ev('tag~:Main.*', entry({ tag: 'MainActivity' })) === true)
  ck('tag~: regex no match', ev('tag~:Other.*', entry({ tag: 'MainActivity' })) === false)
  ck('-tag~: negate regex', ev('-tag~:Main.*', entry({ tag: 'Other' })) === true)

  // --- 正则多值 OR：tag~:(A|B|C) 括号+| 留在字段正则作用域内 ---
  // 回归：tag:A|B|C 的 | 是顶层 OR，只有 A 绑 tag，B/C 退化 message；
  //       而 tag~:(A|B|C) 整体是 tag 字段正则，| 在正则作用域内。
  ck('tag~:(A|B|C) parses ok', isOk('tag~:(A|B|C)') === true)
  ck('tag~:(A|B|C) hits A', ev('tag~:(VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer)', entry({ tag: 'VideoWallpaperService' })) === true)
  ck('tag~:(A|B|C) hits B', ev('tag~:(VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer)', entry({ tag: 'ZuiPhoneWindowManager' })) === true)
  ck('tag~:(A|B|C) hits C', ev('tag~:(VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer)', entry({ tag: 'MediaPlayer' })) === true)
  ck('tag~:(A|B|C) excludes other tag', ev('tag~:(A|B|C)', entry({ tag: 'OtherTag' })) === false)
  // 关键回归：tag 不匹配、但 message 含这些字符串时不应误命中
  ck('tag~:(A|B|C) no false hit from message', ev('tag~:(VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer)', entry({ tag: 'adbd', message: "logcat '-s' 'VideoWallpaperService' 'MediaPlayer'" })) === false)
  // 字段值作用域内紧贴 |：tag:A|B|C 整体作为 tag 字段值（非正则=字面包含，正则=OR）。
  // 关键：| 后的项不再退化成 message 匹配，避免 message 含这些串时误命中。
  ck('tag:A|B|C scoped to tag field (not message)', ev('tag:VideoWallpaperService|MediaPlayer', entry({ tag: 'adbd', message: 'has MediaPlayer here' })) === false)
  ck('tag~:A|B|C (no parens) regex OR hits B', ev('tag~:VideoWallpaperService|ZuiPhoneWindowManager|MediaPlayer', entry({ tag: 'ZuiPhoneWindowManager', message: 'screenTurnedOff' })) === true)
  ck('tag~:A|B|C (no parens) regex OR hits C', ev('tag~:A|B|C', entry({ tag: 'C' })) === true)
  ck('tag~:A|B|C (no parens) excludes other', ev('tag~:A|B|C', entry({ tag: 'D', message: 'has A' })) === false)
  ck('tag~:A|B|C no false hit from message', ev('tag~:VideoWallpaperService|MediaPlayer', entry({ tag: 'adbd', message: "logcat 'MediaPlayer'" })) === false)
  // 空格分隔后 | 当顶层 OR（作用域在空格处结束）
  ck('tag:A | tag:B top-level OR with spaces', ev('tag:foo | tag:bar', entry({ tag: 'bar' })) === true)
  // 否定正则多值
  ck('-tag~:(A|B|C) excludes A', ev('-tag~:(A|B|C)', entry({ tag: 'A' })) === false)
  ck('-tag~:(A|B|C) keeps other', ev('-tag~:(A|B|C)', entry({ tag: 'D' })) === true)
  ck('-tag~:(A|B|C) keeps other tag with matching message', ev('-tag~:(A|B|C)', entry({ tag: 'D', message: 'has A here' })) === true)
  // 正则多值与字段组合
  ck('tag~:(A|B) & level:error', ev('tag~:(A|B) & level:error', entry({ tag: 'A', priority: 6 })) === true)
  ck('tag~:(A|B) & level:error low prio', ev('tag~:(A|B) & level:error', entry({ tag: 'A', priority: 4 })) === false)

  // --- 逻辑 & | ---
  ck('& both', ev('tag:foo & message:bar', entry({ tag: 'foo', message: 'bar baz' })) === true)
  ck('& one missing', ev('tag:foo & message:zzz', entry({ tag: 'foo', message: 'bar' })) === false)
  ck('| either', ev('tag:foo | tag:bar', entry({ tag: 'bar' })) === true)
  ck('| neither', ev('tag:foo | tag:bar', entry({ tag: 'baz' })) === false)

  // --- 优先级 & 紧于 | ---
  ck('& binds tighter than |',
    ev('tag:foo | tag:bar & message:zzz', entry({ tag: 'foo', message: 'nomatch' })) === true)
  ck('& binds tighter: bar&zzz fails, foo ok',
    ev('tag:foo | tag:bar & message:zzz', entry({ tag: 'bar', message: 'nomatch' })) === false)

  // --- 括号 ---
  ck('(a|b)&c', ev('(tag:foo | tag:bar) & message:baz', entry({ tag: 'bar', message: 'baz here' })) === true)
  ck('(a|b)&c no c', ev('(tag:foo | tag:bar) & message:zzz', entry({ tag: 'bar', message: 'baz' })) === false)

  // --- 引号 ---
  ck('quoted phrase in message', ev('message:"anr detected"', entry({ message: 'anr detected now' })) === true)
  ck('quoted keeps pipe literal', ev('"a | b"', entry({ message: 'log a | b here' })) === true)
  ck('quoted no false pos', ev('"a | b"', entry({ message: 'no pipe here' })) === false)
  ck('quoted with & literal via message:', ev('message:"x=1&y=2"', entry({ message: 'url x=1&y=2 ok' })) === true)

  // --- 隐式 OR（同 key 多非否定）---
  ck('implicit OR same key', ev('tag:foo tag:bar package:myapp', entry({ tag: 'bar', package: 'myapp' })) === true)
  ck('implicit OR same key no other', ev('tag:foo tag:bar package:myapp', entry({ tag: 'baz', package: 'myapp' })) === false)
  ck('implicit OR: package and must', ev('tag:foo tag:bar package:myapp', entry({ tag: 'foo', package: 'other' })) === false)

  // --- 否定不进隐式 OR ---
  ck('negate not in implicit OR', ev('tag:foo -tag:bar package:myapp', entry({ tag: 'foo', package: 'myapp' })) === true)
  ck('negate excludes', ev('tag:foo -tag:bar package:myapp', entry({ tag: 'foo bar', package: 'myapp' })) === false)

  // --- 裸文本遇到 | 成组 ---
  ck('bare groups before |', ev('foo bar tag:bar1 | tag:bar2', entry({ message: 'foo bar', tag: 'bar2' })) === true)
  ck('bare groups before | no bare', ev('foo bar tag:bar1 | tag:bar2', entry({ message: 'no foo', tag: 'bar1' })) === false)

  // --- level >= ---
  ck('level:warn matches warn', ev('level:warn', entry({ priority: 5 })) === true)
  ck('level:warn matches error', ev('level:warn', entry({ priority: 6 })) === true)
  ck('level:warn excludes info', ev('level:warn', entry({ priority: 4 })) === false)
  ck('level:w short form', ev('level:w', entry({ priority: 5 })) === true)
  ck('level:INFO upper', ev('level:INFO', entry({ priority: 4 })) === true)
  ck('-level:warn < warn', ev('-level:warn', entry({ priority: 4 })) === true)
  ck('-level:warn excludes warn', ev('-level:warn', entry({ priority: 5 })) === false)

  // --- is:crash / is:stacktrace ---
  ck('is:crash hits crash', ev('is:crash', entry({ crash: true })) === true)
  ck('is:crash no hit normal', ev('is:crash', entry({ crash: false })) === false)
  ck('is:stacktrace hits', ev('is:stacktrace', entry({ stacktrace: true })) === true)
  ck('is:crash | is:stacktrace union',
    ev('is:crash | is:stacktrace', entry({ crash: false, stacktrace: true })) === true)

  // --- name: 恒真 ---
  ck('name: always true', ev('name:myfilter & tag:foo', entry({ tag: 'foo' })) === true)
  ck('name: does not filter', ev('name:myfilter & tag:zzz', entry({ tag: 'foo' })) === false)
  ck('extractName', extractName('tag:foo name:崩溃日志') === '崩溃日志')
  ck('extractName none', extractName('tag:foo') === null)

  // --- 未知 key 当 bare ---
  ck('unknown key is bare', ev('xyz:abc', entry({ message: 'xyz:abc value' })) === true)

  // --- 错误态 ---
  ck('unbalanced paren error', isOk('(tag:foo') === false)
  ck('dangling & error', isOk('tag:foo &') === false)
  ck('dangling | error', isOk('tag:foo |') === false)
  ck('error has message', typeof errMsg('tag:foo &') === 'string')

  // --- 复合合法 ---
  ck('complex ok', isOk('tag:foo & level:error & -message:test | is:crash') === true)

  console.log(`filterQuery tests: ${pass} passed, ${fail} failed`)
  return fail === 0
}

if (require.main === module) {
  const ok = runFilterQueryTests()
  process.exit(ok ? 0 : 1)
}
