/**
 * Dashboard edit mode (preview `dashboard_edit_mode`): the host's message vocabulary
 * with the frame, and the pure rules the edit layer draws by.
 *
 * The frame's half is `_EDIT_BRIDGE_JS` in `src/kiro_crew/dashboard_frame.py`. The page
 * only ever answers "which field path is under this point"; every word of a lineage is
 * the gateway's (`member_dashboard_lineage.build_lineage`) and is drawn by the host.
 */
import type { DashboardManifest } from '../../api/client'

/** Host -> frame: Edit mode on or off. Mirrors the bridge. */
export const EDIT_MESSAGE_TYPE = 'kirocrew-dashboard:edit'
/** Host -> frame: the pointer, in frame coordinates. `x: null` means it left. */
export const POINT_MESSAGE_TYPE = 'kirocrew-dashboard:point'
/** Host -> frame: a wheel turn over the capture layer, passed through. */
export const WHEEL_MESSAGE_TYPE = 'kirocrew-dashboard:wheel'
/** Frame -> host: the field path under a point, or under keyboard focus (`seq: -1`). */
export const PICKED_MESSAGE_TYPE = 'kirocrew-dashboard:picked'
/** Frame -> host: Escape was pressed inside the frame. */
export const ESCAPE_MESSAGE_TYPE = 'kirocrew-dashboard:escape'

/** The `seq` a keyboard-focus answer carries: always current. */
export const FOCUS_SEQ = -1

export interface Rect { x: number; y: number; w: number; h: number }

export interface Picked {
  seq: number
  path: string | null
  rect: Rect | null
  block: string
  blockRect: Rect | null
  blockFields: string[]
}

const BLOCK_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/
const ROOT_RE = /^[a-z][a-z0-9_]{0,63}/
const PATH_RE = /^[a-z][a-z0-9_]{0,63}(?:\.[A-Za-z0-9_]{1,64}|\[(?:\d{1,4}|\*)\])*$/

function rect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }
  return [out.x, out.y, out.w, out.h].every(Number.isFinite) ? out : null
}

/** A `picked` message from the frame, every cell checked, or null to drop it. */
export function pickedMessage(data: unknown): Picked | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (m.type !== PICKED_MESSAGE_TYPE || typeof m.seq !== 'number') return null
  const path = typeof m.path === 'string' && m.path.length <= 200 && PATH_RE.test(m.path) ? m.path : null
  const block = typeof m.block === 'string' && BLOCK_RE.test(m.block) ? m.block : ''
  const fields = Array.isArray(m.blockFields)
    ? m.blockFields.filter((f): f is string => typeof f === 'string' && PATH_RE.test(f)).slice(0, 32)
    : []
  return { seq: m.seq, path, rect: rect(m.rect), block, blockRect: block ? rect(m.blockRect) : null, blockFields: block ? fields : [] }
}

/** The field a path starts with: `items[2].accepted` -> `items`. */
export function rootField(path: string): string | null {
  return ROOT_RE.exec(path)?.[0] ?? null
}

/** One field the page reads, from either manifest shape (a template's `fields` or a
 *  package model's `types`). */
export interface FieldSource {
  name: string
  type: string
  kind: 'fold' | 'agentic' | 'custom'
  fold: string
  path: string
  label: string
}

export function manifestFields(manifest: DashboardManifest | Record<string, unknown> | undefined): FieldSource[] {
  const m = (manifest ?? {}) as Record<string, unknown>
  const table = (m.fields && typeof m.fields === 'object' ? m.fields : m.types) as Record<string, unknown> | undefined
  if (!table || typeof table !== 'object') return []
  const out: FieldSource[] = []
  for (const name of Object.keys(table).sort()) {
    const spec = table[name] as Record<string, unknown> | null
    const source = (spec?.source ?? {}) as Record<string, unknown>
    const type = typeof spec?.type === 'string' ? spec.type : ''
    const label = typeof spec?.label === 'string' ? spec.label : ''
    if (source.agentic === true) {
      out.push({ name, type, kind: 'agentic', fold: '', path: '', label })
      continue
    }
    const fold = typeof source.fold === 'string' ? source.fold : ''
    const path = typeof source.path === 'string' ? source.path : ''
    if (!fold) continue
    out.push({ name, type, kind: fold === 'custom' ? 'custom' : 'fold', fold, path, label })
  }
  return out
}

/** Whether the page declares the field *path* names. The host refuses any other. */
export function declaredRoot(path: string, fields: readonly FieldSource[]): FieldSource | null {
  const root = rootField(path)
  return root ? fields.find(f => f.name === root) ?? null : null
}

/**
 * Where a popover of *size* goes beside *anchor*, inside *bounds*: right of the value,
 * then left, then below, then above. It never covers the value; when none fits, the
 * side with the most room wins and the popover is clamped inside the bounds.
 */
export function placePopover(anchor: Rect, size: { w: number; h: number }, bounds: { w: number; h: number }, gap = 12): { x: number; y: number; side: 'right' | 'left' | 'below' | 'above' } {
  const clampY = (y: number) => Math.max(4, Math.min(y, bounds.h - size.h - 4))
  const clampX = (x: number) => Math.max(4, Math.min(x, bounds.w - size.w - 4))
  const rightX = anchor.x + anchor.w + gap
  if (rightX + size.w <= bounds.w) return { x: rightX, y: clampY(anchor.y - 16), side: 'right' }
  const leftX = anchor.x - gap - size.w
  if (leftX >= 0) return { x: leftX, y: clampY(anchor.y - 16), side: 'left' }
  const belowY = anchor.y + anchor.h + gap
  if (belowY + size.h <= bounds.h) return { x: clampX(anchor.x), y: belowY, side: 'below' }
  const aboveY = anchor.y - gap - size.h
  if (aboveY >= 0) return { x: clampX(anchor.x), y: aboveY, side: 'above' }
  const room = { right: bounds.w - rightX, left: anchor.x - gap, below: bounds.h - belowY, above: anchor.y - gap }
  const side = (Object.keys(room) as (keyof typeof room)[]).reduce((a, b) => (room[b] > room[a] ? b : a))
  if (side === 'right') return { x: rightX, y: clampY(anchor.y - 16), side }
  if (side === 'left') return { x: Math.max(4, leftX), y: clampY(anchor.y - 16), side }
  if (side === 'below') return { x: clampX(anchor.x), y: belowY, side }
  return { x: clampX(anchor.x), y: Math.max(4, aboveY), side }
}

/** The person's typed correction as a value of the field's declared *type*, or null.
 *  `number` takes a finite number, `boolean`/`bool` yes/no words, a string type the
 *  text, and `array`/`object` JSON of that shape. */
export function parseCorrection(text: string, type: string): { value: unknown } | null {
  const raw = text.trim()
  if (type === 'number') {
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? { value: n } : null
  }
  if (type === 'boolean' || type === 'bool') {
    if (/^(true|yes|1)$/i.test(raw)) return { value: true }
    if (/^(false|no|0)$/i.test(raw)) return { value: false }
    return null
  }
  if (type === 'array' || type === 'object') {
    try {
      const v: unknown = JSON.parse(raw)
      const ok = type === 'array' ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v)
      return ok ? { value: v } : null
    } catch {
      return null
    }
  }
  return raw ? { value: raw } : null
}

/** A value as one short line for the popover head. */
export function shownValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014'
  if (typeof value === 'object') {
    const s = JSON.stringify(value)
    return s.length > 80 ? `${s.slice(0, 77)}...` : s
  }
  return String(value)
}
