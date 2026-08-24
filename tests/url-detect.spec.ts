import { describe, expect, it } from 'vitest'
import { detectUrl, URL_DETECT_RE } from '../src/types.ts'

describe('URL detection', () => {
  it('captures the URL from a typical dsh-web-app line', () => {
    const detected = detectUrl('dsh web: http://127.0.0.1:3080')
    expect(detected).toEqual({ url: 'http://127.0.0.1:3080', port: 3080 })
  })

  it('captures the URL with the LAN suffix', () => {
    const detected = detectUrl('dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.42:3080)')
    expect(detected?.port).toBe(3080)
    expect(detected?.url).toBe('http://127.0.0.1:3080')
  })

  it('accepts https loopback (defensive)', () => {
    const detected = detectUrl('dsh web: https://127.0.0.1:8443')
    expect(detected?.port).toBe(8443)
  })

  it('rejects lines that do not match', () => {
    expect(detectUrl('dsh web: opening the default browser; pass --no-open to disable')).toBeNull()
    expect(detectUrl('web-app: could not open the default browser because ...')).toBeNull()
    expect(detectUrl('')).toBeNull()
    expect(detectUrl('some unrelated line')).toBeNull()
  })

  it('rejects loopback missing a port', () => {
    expect(detectUrl('dsh web: http://127.0.0.1')).toBeNull()
  })

  it('the regex captures a non-loopback URL (regression guard)', () => {
    // The contract is loopback only; this test pins that the regex does not
    // accidentally widen to non-loopback hosts.
    expect(URL_DETECT_RE.test('dsh web: http://0.0.0.0:8080')).toBe(false)
    expect(URL_DETECT_RE.test('dsh web: http://example.com:80')).toBe(false)
  })
})