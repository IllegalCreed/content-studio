import { describe, expect, it } from 'vitest'
import { validateVideoViewport } from './viewport'

describe('video viewport validation', () => {
  it('accepts a bounded viewport that matches the video format', () => {
    expect(validateVideoViewport({
      height: 768,
      width: 1366,
    }, 'landscape')).toEqual({
      height: 768,
      width: 1366,
    })
  })

  it('rejects unsafe dimensions and format mismatches', () => {
    expect(() => validateVideoViewport({
      height: 2160,
      width: 3840,
    }, 'portrait')).toThrow(/portrait/i)
    expect(() => validateVideoViewport({
      height: 320,
      width: 3840,
    }, 'landscape')).toThrow(/aspect ratio/i)
    expect(() => validateVideoViewport({
      height: 100,
      width: 100,
    }, 'square')).toThrow(/at least/i)
    expect(() => validateVideoViewport({
      height: 3840,
      width: 3840,
    }, 'square')).toThrow(/pixel area/i)
  })
})
