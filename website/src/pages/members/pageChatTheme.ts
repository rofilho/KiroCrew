/**
 * Map a crewmate's DASHBOARD PAGE colour tokens onto the CHAT column's CSS
 * variables, so the chat and the Dashboard tab beside it read as one theme.
 *
 * The problem this solves: a crewmate's page can declare its own colours
 * (`theme.tokens`, validated in `artifact_store/dashboard_package.py`), but the
 * chat in the middle stays on the app theme — a strongly coloured page and a
 * default-dark chat look like two different apps. This module takes the two
 * page colours the chat can safely follow and returns the variable overrides
 * the column sets inline.
 *
 * WHY ONLY TWO TOKENS, NOT THE PAGE'S WHOLE PALETTE: a page's tokens are
 * free-form custom-property names a page author picks (up to 64 of them), with
 * no guaranteed meaning. Copying arbitrary names onto the chat's own variables
 * would be guessing. The chat follows exactly the two whose role is
 * unambiguous — the page BACKGROUND (`--bg`) and the page ACCENT (`--accent`),
 * the same names the app's own theme uses — and derives everything else itself.
 * A page that declares neither keeps today's chat untouched.
 *
 * WHY A WHOLE MINI-PALETTE IS DERIVED, NOT JUST `--bg`/`--text`: the chat column
 * is painted through several surface variables, not one. Bubbles read `--card`,
 * their edges `--border`, secondary labels `--muted`/`--text-strong`, the
 * composer's chips `--bg-hover`/`--bg-elevated`. Overriding only `--bg` and
 * `--text` would leave those sibling surfaces on the app theme's values —
 * bubbles that vanish into a recoloured background, and a `--muted` label at an
 * unmeasured contrast on the new surface. So a recoloured background derives a
 * self-consistent set: the card and chrome surfaces step off the page
 * background toward its text colour, the border is that text at low alpha, and
 * every foreground is paired with the surface it sits on.
 *
 * WHY TEXT IS DERIVED, NOT READ: readability cannot be left to a page author. A
 * declared text colour could sit at any contrast on the declared background. So
 * every foreground here is chosen by measured contrast (`lib/iconContrast`, the
 * repo's core WCAG helpers): black or white, whichever has more contrast on the
 * surface it labels. Against any sRGB colour the better of pure black and pure
 * white never drops below ~4.58:1, so body text clears 4.5:1 on a light page
 * and a dark one alike.
 *
 * WHY NON-OPAQUE TOKENS ARE REFUSED: a translucent `--bg` (e.g. `rgba(0,0,0,0)`)
 * lets the app background show through, so a contrast measured against the token
 * alone is a fiction. A token the chat cannot paint a solid surface from is
 * treated as absent, and the chat keeps its own theme.
 */
import { contrastRatio, parseCssColor, relativeLuminance } from '../../lib/iconContrast'

/**
 * The page colour tokens the chat follows, keyed by CSS custom-property name as
 * the server's `page_theme` emits them. Free-form elsewhere; the chat reads
 * exactly these two.
 */
export interface PageColorTokens {
  /** The page's `--bg`: the surface the chat paints its background from. */
  '--bg'?: string
  /** The page's `--accent`: the chat's accent (caret, links, send). */
  '--accent'?: string
}

/** The chat column's CSS-variable overrides, ready to spread onto an element's style. */
export type ChatThemeVars = Record<string, string>

/** WCAG AA for normal text; stated here so the contract is visible at the call site. */
export const CHAT_AA_TEXT = 4.5

/** The two ends of the tone scale, as readable foregrounds. */
const WHITE = '#ffffff'
const BLACK = '#000000'

interface Readable { color: string; ratio: number }

/**
 * The readable text colour for an OPAQUE background triple: black or white,
 * whichever has the higher contrast, with the ratio so a caller can refuse a
 * surface whose best text still falls short.
 */
function readableFor(r: number, g: number, b: number): Readable {
  const bg = relativeLuminance(r, g, b)
  const onWhite = contrastRatio(relativeLuminance(255, 255, 255), bg)
  const onBlack = contrastRatio(0, bg)
  return onWhite >= onBlack ? { color: WHITE, ratio: onWhite } : { color: BLACK, ratio: onBlack }
}

/**
 * The readable text colour for a CSS colour string, or `null` when it does not
 * parse or is not opaque — an unknown or see-through colour is unusable, not
 * guessed. Exported for the unit test.
 */
export function readableText(bg: string): Readable | null {
  const c = parseCssColor(bg)
  if (!c || c.a < 0.999) return null
  return readableFor(c.r, c.g, c.b)
}

/** Mix two 0–255 channels by *t* (0 = a, 1 = b). */
function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/** `#rrggbb` for a triple. */
function hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')
}

/**
 * The chat column's variable overrides for a crewmate's page colours, or an
 * EMPTY object when the page drives nothing (no tokens, a non-opaque token, or
 * a background whose best text cannot clear 4.5:1 — the fail-safe is today's
 * look, never unreadable text).
 *
 * An empty result is the default-OFF state expressed as data: the column
 * spreads `{}`, which adds no inline variable, so the chat is byte-for-byte the
 * one on `main`.
 */
export function chatThemeVars(tokens: PageColorTokens | null | undefined): ChatThemeVars {
  if (!tokens) return {}
  const vars: ChatThemeVars = {}

  const bgStr = tokens['--bg']
  const bg = bgStr ? parseCssColor(bgStr) : null
  if (bgStr && bg && bg.a >= 0.999) {
    const text = readableFor(bg.r, bg.g, bg.b)
    if (text.ratio >= CHAT_AA_TEXT) {
      // The page background, and foregrounds derived for it.
      vars['--bg'] = bgStr
      vars['--text'] = text.color
      vars['--text-strong'] = text.color
      const tc = text.color === WHITE ? 255 : 0
      const bgL = relativeLuminance(bg.r, bg.g, bg.b)
      // Secondary text: the readable end, pulled toward the background so it
      // reads as muted. Pulled only as far as still clears AA on the background
      // — a mid-tone page background leaves little room, so the muting backs off
      // to keep >= 4.5:1 rather than ship a dim, unreadable label.
      // One step toward the text colour by *t*, used for both the muted label
      // and the chrome surfaces below.
      const step = (t: number) => hex(mix(bg.r, tc, t), mix(bg.g, tc, t), mix(bg.b, tc, t))
      const mutedReadable = (t: number): boolean => {
        const m = parseCssColor(step(t))!
        return contrastRatio(relativeLuminance(m.r, m.g, m.b), bgL) >= CHAT_AA_TEXT
      }
      // Prefer 0.66 (clearly muted); step up toward the full text colour until AA holds.
      vars['--muted'] = step([0.66, 0.78, 0.9, 1].find(mutedReadable) ?? 1)
      // Chrome surfaces step OFF the background toward its text colour, so a
      // bubble, a hovered row and an elevated chip are distinct from the column
      // instead of melting into it. The step is CAPPED so the surface's own
      // text still clears AA: a mid-tone page background has no room to lighten a
      // card and keep white text readable, so there the step shrinks toward 0 and
      // the visible edge below carries the separation instead.
      // The luminance of the card's own text (the chosen extreme): white's, or
      // black's (0). A card surface is usable only if that text clears AA on it.
      const fgLum = text.color === WHITE ? relativeLuminance(255, 255, 255) : 0
      const surfaceFgOk = (t: number): boolean => {
        const s = parseCssColor(step(t))!
        return contrastRatio(relativeLuminance(s.r, s.g, s.b), fgLum) >= CHAT_AA_TEXT
      }
      const cardStep = [0.08, 0.05, 0.03, 0].find(surfaceFgOk) ?? 0
      vars['--card'] = step(cardStep)
      vars['--card-fg'] = text.color
      vars['--bg-hover'] = step(Math.min(cardStep, 0.06))
      vars['--bg-elevated'] = step(Math.min(cardStep * 1.5, 0.12))
      // The edge: the text colour at low alpha, so a bubble is outlined and
      // reads the same on a light page and a dark one even when the card sits
      // close to the background.
      vars['--border'] = text.color === WHITE
        ? 'rgba(255,255,255,0.22)'
        : 'rgba(0,0,0,0.22)'
    }
  }

  const accentStr = tokens['--accent']
  const accent = accentStr ? parseCssColor(accentStr) : null
  if (accentStr && accent && accent.a >= 0.999) {
    const text = readableFor(accent.r, accent.g, accent.b)
    // The accent is a background for its own label (send button, pills), so it
    // is paired with a readable foreground the same way.
    if (text.ratio >= CHAT_AA_TEXT) {
      vars['--accent'] = accentStr
      vars['--accent-fg'] = text.color
    }
  }

  return vars
}
