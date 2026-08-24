/**
 * Lifecycle tests for the UrlDetector state machine used by main.ts.
 *
 * The detector buffers chunks, scans for the URL line, and is one-shot: once
 * a URL is found, the detector locks and never re-emits. Tests exercise:
 *   - URL arriving mid-chunk (no trailing newline in the first packet)
 *   - URL split across two chunks
 *   - Non-matching lines interleaved with the URL
 *   - Multiple URL lines (only the first wins; subsequent feeds return null)
 *
 * The detector class lives inside main.ts and is not exported, so this test
 * exercises the production `detectUrl` regex in `src/types.ts` directly with
 * the same buffer-and-scan algorithm. The contract that matters — that the
 * buffer cleanly splits on `\n` and only the first match is returned — is
 * pinned here.
 */

import { describe, expect, it } from 'vitest'
import { detectUrl } from '../src/types.ts'

class UrlDetector {
  private buffer = ''
  private resolved: string | null = null

  feed(chunk: string): string | null {
    if (this.resolved !== null) return null
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const detected = detectUrl(line)
      if (detected !== null) {
        this.resolved = detected.url
        return detected.url
      }
      newline = this.buffer.indexOf('\n')
    }
    return null
  }
}

describe('UrlDetector', () => {
  it('returns the URL when it fits on a single line', () => {
    const detector = new UrlDetector()
    expect(detector.feed('dsh web: http://127.0.0.1:3080\n')).toBe('http://127.0.0.1:3080')
  })

  it('handles a URL split across two chunks', () => {
    const detector = new UrlDetector()
    expect(detector.feed('dsh web: http://127.0.')).toBeNull()
    expect(detector.feed('0.1:3080\n')).toBe('http://127.0.0.1:3080')
  })

  it('ignores non-matching lines', () => {
    const detector = new UrlDetector()
    expect(detector.feed('web-app: starting up\n')).toBeNull()
    expect(detector.feed('some other log line\n')).toBeNull()
    expect(detector.feed('dsh web: http://127.0.0.1:3080\n')).toBe('http://127.0.0.1:3080')
  })

  it('returns only the first URL on duplicate lines', () => {
    const detector = new UrlDetector()
    const first = detector.feed('dsh web: http://127.0.0.1:3080\ndsh web: http://127.0.0.1:4096\n')
    expect(first).toBe('http://127.0.0.1:3080')
    // Subsequent feeds must not re-emit; the state machine is one-shot.
    expect(detector.feed('nothing here\n')).toBeNull()
    expect(detector.feed('dsh web: http://127.0.0.1:5555\n')).toBeNull()
  })

  it('keeps a partial line in the buffer across feeds', () => {
    const detector = new UrlDetector()
    expect(detector.feed('partial line without newline yet')).toBeNull()
    expect(detector.feed(' and now\ndsh web: http://127.0.0.1:1234\n'))
      .toBe('http://127.0.0.1:1234')
  })
})