// Command block boundary detection for the left-gutter double-click select.
//
// Lazy, non-streaming: the prompt shape regex is applied to complete buffer
// lines only at double-click time (via getLine/translateToString), never on
// the live output stream. This keeps detection robust (no chunk-boundary
// splits, no TUI safe-mode needed for rendering) and avoids resurrecting the
// deleted streaming prompt colorizer.
//
// Prompt shapes recognized (anchored at line start, device PS1 is plain text):
//   model:path$            e.g. TB355FU:/data/local/tmp$
//   user@host:path#        e.g. root@TB355FU:/data #
//   bare # / $             (e.g. after su on some devices)
//
// See openspec/changes/terminal-command-block-select.

// Terminators: root `#` or user `$`. An optional space may follow (the shell
// waits for input with no trailing newline) but the match works either way.
const TERMINATOR = '[#$]'

// Optional "user@host" or "model" prefix before a ':'. `user@host` is
// `word@word`; `model` is a plain word (may contain digits/dashes). We allow
// any run of non-colon/non-space/non-terminator chars as the prefix.
const PREFIX = '[^\\s:#$]*'

// Optional path segment after the ':'. Paths may contain /, ., -, _, ~, and
// word chars but no spaces or terminators.
const PATH = '[^\\s:#$]*'

// Full prompt: the line STARTS with a prompt shape — an optional prefix,
// optional ':path', then a terminator (`#`/`$`) followed by a space or the
// end of the line. The command text the user typed may follow the prompt on
// the SAME line (e.g. `TB355FU:/data$ ls -la`), so we match the prompt as a
// prefix, not a whole-line match. The lookahead `(?=\s|$)` accepts a trailing
// space (typed command follows) or end-of-line (bare prompt awaiting input),
// and rejects `$` immediately followed by a non-space char (e.g. `echo x$y`).
export const PROMPT_RE = new RegExp(
  `^(?:${PREFIX}(?::${PATH})?)?\\s*${TERMINATOR}(?=\\s|$)`
)

// mksh line-editor redraw "wreck" marker. When a command is longer than the
// PTY column width, the device's mksh line editor (emacs/vi mode) soft-wraps
// and redraws the command echo: it emits `\r` + backspaces + rewrites the line,
// clearing to the right edge with spaces and printing a `<` right-scroll
// marker. In the xterm buffer this OVERWRITES the command's prompt line,
// leaving a wreck line of command fragments ending in two-or-more spaces
// followed by `<` (e.g. `D {print pkg}' | xargs dumpsys ...    <`). Such a
// line no longer matches PROMPT_RE, so a plain "scan up to nearest prompt"
// would skip it and latch onto the PREVIOUS command's prompt, sweeping the
// previous command into the selection. We detect these wreck lines by the
// trailing `  +<` (clear-to-end fill + marker) and treat them as the block
// start instead. Normal output containing `<` (e.g. `a < b`, `Author
// <x@y.com>`, a lone `<` line) does NOT match — the marker needs the mksh
// clear-fill spaces before it, which real output never has.
const WRECK_RE = / {2,}<$/
export function getLineText(buffer: IBuffer, y: number): string {
  const line = buffer.getLine(y)
  if (!line) return ''
  return line.translateToString(true)
}

// True if buffer line y is a prompt line (block boundary).
export function isPromptLine(buffer: IBuffer, y: number): boolean {
  if (y < 0 || y >= buffer.length) return false
  const text = getLineText(buffer, y)
  if (!text) return false
  return PROMPT_RE.test(text)
}

// Find the inclusive [start, end] line range of the command block whose
// output contains clickLine. Returns null if no prompt exists at or above
// clickLine (e.g. initial boot output before the first prompt).
//
// Long-command wreck handling: when a command exceeds the PTY column width,
// mksh's line editor redraws the echo and overwrites the prompt line in the
// buffer, leaving a wreck line (matches WRECK_RE) where the prompt should be.
// PROMPT_RE does not match the wreck, so the nearest-prompt scan would skip
// it and latch onto the previous command's prompt — sweeping the previous
// command into the selection. To fix this, after locating the nearest prompt
// above (`promptAbove`) and the block `end`, we scan back down from the click
// line to `promptAbove+1` for a wreck line and, if found, use IT as the block
// start. The scan is bounded to the range between the prompt and the click,
// so it never traverses the whole buffer (worst observed ~0.7ms). If no
// wreck is found we fall back to the prompt as the start, preserving the
// original behavior for every non-wreck case (zero regression).
// True if buffer line y is a mksh line-editor redraw wreck line (the leftover
// of a command whose prompt was destroyed by soft-wrap redraw). See WRECK_RE.
function isWreckLine(buffer: IBuffer, y: number): boolean {
  const line = buffer.getLine(y)
  if (!line) return false
  if (line.isWrapped) return false // a wreck is its own non-wrapped line
  if (isPromptLine(buffer, y)) return false
  const raw = line.translateToString(false) // keep trailing fill spaces
  if (!raw.trim()) return false
  return WRECK_RE.test(raw.trimEnd())
}

export function findBlockBounds(
  buffer: IBuffer,
  clickLine: number
): { start: number; end: number } | null {
  // Scan up from the click line (inclusive). We track TWO candidates for the
  // block start:
  //   - promptAbove: the nearest prompt line (the common-case block start).
  //   - wreckAbove: the nearest mksh redraw-wreck line. A wreck is the leftover
  //     of a long command whose prompt was overwritten by soft-wrap redraw, so
  //     the wreck — not any earlier prompt — is that command's real block start.
  // The wreck wins when found because the prompt above it belongs to the
  // PREVIOUS command. Crucially, we scan for the wreck independent of whether
  // a prompt was found: when the command is long enough that its prompt (and
  // the wreck's own preceding prompt) have scrolled off the top of the buffer,
  // there is no prompt above the click at all — only the wreck remains, and
  // without checking for it we would return null (selecting nothing).
  let promptAbove = -1
  let wreckAbove = -1
  for (let y = clickLine; y >= 0; y--) {
    if (isPromptLine(buffer, y)) {
      promptAbove = y
      break // a prompt is a hard block boundary; stop scanning above it
    }
    if (wreckAbove === -1 && isWreckLine(buffer, y)) {
      wreckAbove = y // remember nearest wreck, but keep scanning in case a
      // prompt sits even closer to the click (prompt takes priority when
      // both are on the same scan path).
      break
    }
  }

  const start = wreckAbove !== -1 ? wreckAbove : promptAbove
  if (start === -1) return null

  // Scan down from the block start to find the next prompt (next block's
  // start); this block ends one line before it.
  let end = buffer.baseY + buffer.cursorY
  for (let y = start + 1; y < buffer.length; y++) {
    if (isPromptLine(buffer, y)) {
      end = y - 1
      break
    }
  }

  return { start, end }
}

// Minimal buffer shape (duck-typed from xterm IBuffer) so this module stays
// decoupled from xterm types for unit testing.
export interface IBuffer {
  readonly type: 'normal' | 'alternate'
  readonly cursorY: number
  readonly baseY: number
  readonly length: number
  getLine(y: number): IBufferLine | undefined
}

// Minimal buffer line shape. `isWrapped` is optional so test fakes that don't
// model soft-wrap can omit it (treated as undefined → falsy → not wrapped);
// real xterm IBufferLine always provides it.
export interface IBufferLine {
  readonly isWrapped?: boolean
  translateToString(trimRight?: boolean): string
}
