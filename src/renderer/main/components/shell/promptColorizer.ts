// Streaming prompt colorizer for the ADB shell terminal.
//
// Intercepts the shell data stream before it reaches xterm.js and colorizes
// prompt lines on the client. Colorization does NOT depend on the device's
// PS1, so it survives `su`, sub-shells, and any device-side prompt reset.
//
// See openspec/changes/terminal-client-colorization.
//
// Design notes:
// - Color is injected as ANSI SGR selecting the 16-color palette already
//   configured in Term.tsx's ITheme (WindTerm-style). No hardcoded hex; the
//   actual rendered colors follow the active light/dark theme.
// - Prompt detection is "middle-band": matches
//     <optional user@host>:<path> <#|$> <space>
//   plus a bare `# `/`$ ` fallback guarded by a path/host prefix, covering
//   the injected top-level PS1, root default prompts, and bare-root prompts
//   while avoiding most program output.
// - TUI safe-mode: on alternate-screen enter/leave and clear-screen sequences
//   the colorizer suspends line rewriting so vim/top/less render correctly.

// ANSI SGR helpers — select palette indices 30-37 (standard colors).
const SGR = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
}

// Prompt terminator. Root (`#`) is colored red; non-root (`$`) uses default.
function coloredTerminator(term: string): string {
  if (term === '#') {
    return SGR.red + term + SGR.reset
  }
  return term
}

// Match: optional `user@host:`, then a path, then `#`/`$` and a trailing space.
// Examples it should accept:
//   Pixel6:/data/local/tmp$           (injected top-level PS1)
//   root@Pixel6:/ #                   (root default)
//   /data/local/tmp#                  (path-only root)
// Captures: g1 = everything before the terminator (the "user@host:path" or
// "path" segment), g2 = the terminator (`#` or `$`).
const PROMPT_RE =
  /^(?:([^\s:@]+@[^\s:]+):)?([^\s:]*?)\s*([#$]) (?=\S|$)/

// A prompt line that the device already colored (carries an ESC SGR). We skip
// recoloring such lines to avoid conflicting with the device's own PS1.
const HAS_ANSI = /\x1b\[/

// TUI / full-screen detection sequences.
const ALT_SCREEN_ENTER = '\x1b[?1049h'
const ALT_SCREEN_LEAVE = '\x1b[?1049l'
// Clear-screen / clear-to-end sequences as a secondary guard: a TUI often
// starts by clearing, and we want to suspend before the next prompt redraw.
const CLEAR_SCREEN_RE = /\x1b(?:\[2J|\[H|\[K|\[J)/

export interface PromptColorizer {
  feed: (chunk: string) => string
  flush: () => string
}

export function createPromptColorizer(): PromptColorizer {
  // Whether we are at the start of a logical line (i.e. the next bytes begin
  // a new prompt/line). Starts true because a fresh session begins at col 0.
  let atLineStart = true
  // Buffered partial line that arrived without a trailing newline.
  let pending = ''
  // True while a full-screen TUI is active; we pass data through verbatim.
  let tuiActive = false

  function colorizeLine(line: string): string {
    // Only attempt to colorize at a line start, and only the prompt portion.
    if (HAS_ANSI.test(line)) {
      // Device already emitted ANSI for this line (e.g. our injected PS1).
      // Pass through unchanged to avoid double-coloring.
      return line
    }
    const m = PROMPT_RE.exec(line)
    if (!m) {
      return line
    }
    const prefix = line.slice(0, m.index)
    const userHost = m[1] // optional "user@host"
    const path = m[2] // path segment
    const term = m[3] // "#" or "$"

    // Rebuild the colored prompt.
    let colored = prefix
    if (userHost) {
      colored += SGR.green + userHost + ':' + SGR.reset
    }
    if (path) {
      colored += SGR.blue + path + SGR.reset
    }
    colored += coloredTerminator(term)
    // Append the rest of the line (after the prompt terminator + space)
    // unchanged — this is usually the user's typed command echo.
    const restStart = m.index + m[0].length
    colored += line.slice(restStart)
    return colored
  }

  function flush(): string {
    // Emit any buffered partial line (used on teardown / reset).
    if (pending === '') return ''
    const out = atLineStart && !tuiActive ? colorizeLine(pending) : pending
    pending = ''
    atLineStart = true
    return out
  }

  function feed(chunk: string): string {
    // 0. Fold any buffered partial line to the front so the continuation
    //    is colorized together with the start of the line.
    if (pending) {
      chunk = pending + chunk
      pending = ''
    }

    // 1. Handle TUI state transitions. Toggle tuiActive and pass sequences
    //    through verbatim.
    if (chunk.includes(ALT_SCREEN_ENTER)) {
      tuiActive = true
    }
    if (chunk.includes(ALT_SCREEN_LEAVE)) {
      tuiActive = false
      // After leaving a TUI, the next line is a fresh prompt.
      atLineStart = true
    }
    // Secondary guard: a clear-screen at line start likely heralds a TUI.
    if (atLineStart && CLEAR_SCREEN_RE.test(chunk)) {
      tuiActive = true
    }

    // In TUI mode, bypass line buffering and rewriting entirely.
    if (tuiActive) {
      return chunk
    }

    // 2. Split into complete lines + a trailing partial (held back).
    let out = ''
    let cursor = 0
    while (cursor < chunk.length) {
      const nl = chunk.indexOf('\n', cursor)
      if (nl === -1) {
        // Remainder is an incomplete line; buffer it for the next chunk.
        pending = chunk.slice(cursor)
        break
      }
      const line = chunk.slice(cursor, nl + 1)
      if (atLineStart) {
        out += colorizeLine(line)
      } else {
        out += line
      }
      atLineStart = true
      cursor = nl + 1
    }

    // 3. The partial line (if any) stays in `pending` and is NOT emitted yet.
    //    Holding an unfinished line back delays its render by at most one
    //    chunk, which is acceptable for prompts and keeps coloring correct
    //    when a terminator/space arrives in the next chunk. When the next
    //    newline lands, step 0 folds `pending` in and colorizes the whole
    //    line together.
    return out
  }

  return { feed, flush }
}
