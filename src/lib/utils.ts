import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, letting later Tailwind classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "Ada Lovelace" -> "AL". Falls back to the email's first letter. */
export function initials(name?: string | null, email?: string | null): string {
  const source = (name || '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
  }
  return (email || '?').charAt(0).toUpperCase()
}

export function formatMoney(amount: number | string | null | undefined, currency = 'USD'): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

export function formatHours(hours: number | string | null | undefined): string {
  const n = typeof hours === 'string' ? parseFloat(hours) : (hours ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const h = Math.floor(n)
  const m = Math.round((n - h) * 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Title-case a slug/enum value for display: `needs_reauth` -> `Needs reauth`. */
export function humanize(value?: string | null): string {
  if (!value) return ''
  const s = value.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Clamp a string for display without cutting mid-word when avoidable. */
export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

/**
 * Readable contrast colour for a hex background — used so an org's custom
 * primary colour never ends up with unreadable label text on top of it.
 */
export function contrastOn(hex: string): '#FFFFFF' | '#1A1C23' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#FFFFFF'
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  // Relative luminance (sRGB, simplified).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#1A1C23' : '#FFFFFF'
}

/** Hex -> `H S% L%` so a custom brand colour can be written into a CSS variable. */
export function hexToHslTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Shift an HSL triple's lightness — derives hover/tint shades from one colour. */
export function shiftLightness(triple: string, delta: number): string {
  const parts = triple.split(/\s+/)
  if (parts.length !== 3) return triple
  const l = parseFloat(parts[2])
  if (!Number.isFinite(l)) return triple
  return `${parts[0]} ${parts[1]} ${Math.min(97, Math.max(6, Math.round(l + delta)))}%`
}
