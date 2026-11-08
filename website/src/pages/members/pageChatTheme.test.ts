import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, relativeLuminance } from '../../lib/iconContrast'
import { CHAT_AA_TEXT, chatThemeVars, readableText } from './pageChatTheme'

/** The measured WCAG contrast of one CSS colour on another (both opaque). */
function ratio(fg: string, bg: string): number {
  const f = parseCssColor(fg)!
  const b = parseCssColor(bg)!
  return contrastRatio(relativeLuminance(f.r, f.g, f.b), relativeLuminance(b.r, b.g, b.b))
}

describe('readableText', () => {
  it('picks white on a dark background and black on a light one', () => {
    expect(readableText('#101418')?.color).toBe('#ffffff')
    expect(readableText('#f3f4f6')?.color).toBe('#000000')
  })

  it('reports the contrast of its chosen text, >= 4.5 on both ends', () => {
    const dark = readableText('#101418')!
    const light = readableText('#f3f4f6')!
    expect(dark.ratio).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
    expect(light.ratio).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
    // The reported ratio is the real one for the returned colour.
    expect(dark.ratio).toBeCloseTo(ratio(dark.color, '#101418'), 5)
  })

  it('returns null for an unparseable colour, and for a non-opaque one', () => {
    expect(readableText('rebeccapurple')).toBeNull()
    expect(readableText('')).toBeNull()
    expect(readableText('rgba(0,0,0,0)')).toBeNull()
  })
})

describe('chatThemeVars', () => {
  it('is empty with no tokens — the default-off, byte-for-byte state', () => {
    expect(chatThemeVars(null)).toEqual({})
    expect(chatThemeVars(undefined)).toEqual({})
    expect(chatThemeVars({})).toEqual({})
  })

  it('pairs every recoloured surface with a foreground that clears 4.5:1', () => {
    // Dark and light page backgrounds, plus a mid-tone that leaves muted little
    // room (the muting backs off to keep AA rather than ship a dim label).
    for (const bg of ['#101418', '#f3f4f6', '#1e3a8a', '#fef3c7', '#8855ee']) {
      const vars = chatThemeVars({ '--bg': bg })
      expect(vars['--bg']).toBe(bg)
      // Body text and bubble text both clear AA on the surfaces they sit on.
      expect(ratio(vars['--text'], vars['--bg'])).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
      expect(ratio(vars['--card-fg'], vars['--card'])).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
      // Muted secondary text stays legible (>= 4.5:1) on the page background.
      expect(ratio(vars['--muted'], vars['--bg'])).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
    }
  })

  it('steps the card and chrome surfaces OFF the background so bubbles are visible', () => {
    const vars = chatThemeVars({ '--bg': '#2a1a4d' })
    // The card is a distinct surface, not the raw background (the UX finding:
    // bubbles must not melt into the column).
    expect(vars['--card']).toBeDefined()
    expect(vars['--card']).not.toBe(vars['--bg'])
    expect(vars['--bg-hover']).not.toBe(vars['--bg'])
    expect(vars['--bg-elevated']).not.toBe(vars['--bg'])
    // A visible edge is defined.
    expect(vars['--border']).toBeTruthy()
  })

  it('pairs the accent with a readable label colour', () => {
    const vars = chatThemeVars({ '--accent': '#7c3aed' })
    expect(vars['--accent']).toBe('#7c3aed')
    expect(ratio(vars['--accent-fg'], vars['--accent'])).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
  })

  it('derives >= 4.5:1 text for every sRGB background (the worst case still clears)', () => {
    // Black-or-white against any sRGB colour never drops below ~4.58:1, so the
    // chat always gets readable text. `#8855ee` is the measured worst case.
    for (const bg of ['#8855ee', '#767676', '#008080', '#9c6b2f']) {
      const vars = chatThemeVars({ '--bg': bg })
      expect(vars['--bg']).toBe(bg)
      expect(ratio(vars['--text'], vars['--bg'])).toBeGreaterThanOrEqual(CHAT_AA_TEXT)
    }
  })

  it('refuses a non-opaque background rather than theme against a false backdrop', () => {
    // rgba with zero alpha would composite to a fiction; the chat keeps its theme.
    expect(chatThemeVars({ '--bg': 'rgba(0,0,0,0)' })).toEqual({})
    expect(chatThemeVars({ '--bg': 'rgba(10,10,40,0.4)' })).toEqual({})
  })

  it('ignores an unparseable token instead of applying it', () => {
    expect(chatThemeVars({ '--bg': 'var(--something)' })).toEqual({})
  })
})
