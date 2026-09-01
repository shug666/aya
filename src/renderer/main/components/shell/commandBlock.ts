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

// Read a buffer line as trimmed text. Returns '' for non-existent lines.
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
export function findBlockBounds(
  buffer: IBuffer,
  clickLine: number
): { start: number; end: number } | null {
  // Scan up from the click line (inclusive) to find the block-start prompt.
  let start = -1
  for (let y = clickLine; y >= 0; y--) {
    if (isPromptLine(buffer, y)) {
      start = y
      break
    }
  }
  if (start === -1) return null

  // Scan down from the block start to find the next prompt (next block's
  // start); this block ends one line before it.
  for (let y = start + 1; y < buffer.length; y++) {
    if (isPromptLine(buffer, y)) {
      return { start, end: y - 1 }
    }
  }
  // No next prompt: last block in the buffer — end at the cursor line.
  return { start, end: buffer.baseY + buffer.cursorY }
}

// Minimal buffer shape (duck-typed from xterm IBuffer) so this module stays
// decoupled from xterm types for unit testing.
export interface IBuffer {
  readonly type: 'normal' | 'alternate'
  readonly cursorY: number
  readonly baseY: number
  readonly length: number
  getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined
}
