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
// - Prompt detection matches a prompt at the START of a line:
//     <optional user@host>:<optional path> <#|$> <space or end-of-line>
//   covering the injected top-level PS1, root default prompts, and bare
//   root prompts while avoiding most program output.
// - Prompt lines from a PTY usually arrive WITHOUT a trailing newline (the
//   shell waits for input). So we cannot wait for a newline to emit a line:
//   we detect a complete prompt shape as soon as the terminator + space
//   (or terminator at end of chunk) is visible and emit immediately.
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

// A prompt line that the device already colored (carries an ESC SGR). We skip
// recoloring such lines to avoid conflicting with the device's own PS1.
const HAS_ANSI = /\x1b\[/

// TUI / full-screen detection sequences.
const ALT_SCREEN_ENTER = '\x1b[?1049h'
const ALT_SCREEN_LEAVE = '\x1b[?1049l'
// Clear-screen / clear-to-end sequences as a secondary guard: a TUI often
// starts by clearing, and we want to suspend before the next prompt redraw.
const CLEAR_SCREEN_RE = /\x1b(?:\[2J|\[H|\[K|\[J)/

// Prompt shape, anchored at line start. Accepts:
//   Pixel6:/data/local/tmp$            (injected top-level PS1: model:path)
//   root@Pixel6:/ #                    (root default: user@host:path)
//   /data/local/tmp#                   (path-only root)
//   #                                  (bare root, e.g. after su on some devices)
//   $                                  (bare user)
// The terminator must be followed by a space or be at the end of the visible
// line (the shell waits for input with no trailing newline).
//
// The segment before the terminator is split on the FIRST ':' into an
// optional "user@host" or "model" prefix (g1, green) and an optional path
// (g2, blue). A line with no ':' treats the whole pre-terminator text as the
// prefix (e.g. bare "#"). g3 is the terminator ("#" red, "$" default).
const PROMPT_RE =
  /^([^\s:#$]*?)(?::([^\s:#$]*?))?\s*([#$])(?: (.*)$|$)/

// Characters that can begin a prompt's pre-terminator segment. If the
// accumulated line-start text contains a character that cannot appear in
// (user@host:path), it cannot be a prompt and we flush it as plain output
// immediately (no buffering). This keeps program output un-delayed.
const PROMPT_PREFIX_OK = /^[^\n]*$/

export interface PromptColorizer {
  feed: (chunk: string) => string
  flush: () => string
}

export function createPromptColorizer(): PromptColorizer {
  // Whether we are at the start of a logical line (i.e. the next bytes begin
  // a new prompt/line). Starts true because a fresh session begins at col 0.
  let atLineStart = true
  // Buffered line-start text that might still become a prompt. Only kept
  // while at a line start and not yet decided.
  let pending = ''
  // True while a full-screen TUI is active; we pass data through verbatim.
  let tuiActive = false

  function colorizePromptLine(text: string): string {
    // text is the full line content (no trailing newline). Try to colorize
    // the prompt portion; the rest (typed command echo) passes through.
    if (HAS_ANSI.test(text)) {
      // Device already emitted ANSI for this line (e.g. our injected PS1).
      return text
    }
    const m = PROMPT_RE.exec(text)
    if (!m) {
      return text
    }
    const prefix = text.slice(0, m.index)
    const head = m[1] // "model" or "user@host" (before the first ':')
    const path = m[2] // optional path segment (after the ':')
    const term = m[3] // "#" or "$"

    let colored = prefix
    if (head) {
      colored += SGR.green + head + SGR.reset
    }
    if (path !== undefined) {
      // A ':' separated head from path; re-insert it and color the path.
      colored += ':' + SGR.blue + path + SGR.reset
    }
    colored += coloredTerminator(term)
    // Append the rest (after the prompt terminator + space) unchanged.
    const restStart = m.index + m[0].length
    colored += text.slice(restStart)
    return colored
  }

  // Try to decide a pending line-start buffer:
  //  - returns { out, decided } where decided=true means the buffer is
  //    fully resolved (emitted into `out`) and pending should clear;
  //  - decided=false means we still need more bytes to decide.
  function tryResolvePending(): { out: string; decided: boolean } {
    if (pending === '') {
      return { out: '', decided: true }
    }
    // If it already contains ANSI, the device colored it — emit as-is.
    if (HAS_ANSI.test(pending)) {
      const out = pending
      pending = ''
      atLineStart = false
      return { out, decided: true }
    }
    // If a newline is present, the line is complete; colorize the prompt.
    const nl = pending.indexOf('\n')
    if (nl !== -1) {
      const head = pending.slice(0, nl)
      const tail = pending.slice(nl) // includes the \n
      const out = colorizePromptLine(head) + tail
      pending = ''
      atLineStart = true
      return { out, decided: true }
    }
    // No newline yet. Can it still be a prompt prefix? If it already has a
    // terminator with a following space, it's a complete prompt — emit now.
    const m = PROMPT_RE.exec(pending)
    if (m && m[0] === pending) {
      // Whole pending matches a prompt with no trailing command text and no
      // newline (e.g. "Pixel6:/data/local/tmp$ " or "# "). Emit colored now
      // so the prompt shows immediately; stay at line start=false (input
      // will follow on the same line).
      const out = colorizePromptLine(pending)
      pending = ''
      atLineStart = false
      return { out, decided: true }
    }
    // If the buffer cannot possibly extend into a prompt prefix (contains a
    // char that breaks user@host:path shape, e.g. a space mid-segment that
    // isn't the terminator), emit it as plain output.
    // Heuristic: a prompt prefix has no spaces before the terminator. If we
    // see a space and the last non-space isn't #/$, it's not a prompt.
    if (/ /.test(pending) && !/[#$]$/.test(pending.replace(/\s+$/, ''))) {
      const out = pending
      pending = ''
      atLineStart = false
      return { out, decided: true }
    }
    // Otherwise keep buffering — we need more bytes to decide.
    return { out: '', decided: false }
  }

  function flush(): string {
    if (pending === '') return ''
    const out = atLineStart && !tuiActive ? colorizePromptLine(pending) : pending
    pending = ''
    atLineStart = true
    return out
  }

  function feed(chunk: string): string {
    // Handle TUI state transitions. Toggle tuiActive and pass sequences
    // through verbatim.
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

    // Fast path: if we are mid-line (not at a line start), emit the chunk
    // directly until we hit a newline, which returns us to line-start mode.
    if (!atLineStart) {
      const nl = chunk.indexOf('\n')
      if (nl === -1) {
        return chunk
      }
      // Emit up to and including the first newline; recurse for the rest.
      const head = chunk.slice(0, nl + 1)
      const rest = chunk.slice(nl + 1)
      atLineStart = true
      return head + (rest ? feed(rest) : '')
    }

    // We are at a line start. Prepend any pending buffer.
    if (pending) {
      chunk = pending + chunk
      pending = ''
    }

    let out = ''
    let cursor = 0
    while (cursor < chunk.length) {
      const nl = chunk.indexOf('\n', cursor)
      if (nl === -1) {
        // No newline in the remainder. Buffer it as a pending line-start and
        // try to resolve immediately (a complete prompt w/o newline should
        // emit now).
        pending = chunk.slice(cursor)
        const r = tryResolvePending()
        out += r.out
        // If not decided, it stays in pending for the next chunk.
        break
      }
      // Complete line including the newline.
      const line = chunk.slice(cursor, nl + 1)
      const head = line.slice(0, -1) // without \n
      out += colorizePromptLine(head) + '\n'
      atLineStart = true
      cursor = nl + 1
    }

    return out
  }

  return { feed, flush }
}
