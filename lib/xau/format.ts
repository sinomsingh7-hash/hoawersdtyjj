export const SYNCING = 'SYNCING...'

const valid = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** Prices: 0, NaN and missing render as SYNCING... (zero-dummy policy). */
export const px = (v: number | null | undefined, d = 2) => valid(v) && v > 0 ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : SYNCING

export const num = (v: number | null | undefined, d = 2, signed = false) => {
  if (!valid(v)) return SYNCING
  const s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  return signed && v > 0 ? `+${s}` : s
}

export const pct = (v: number | null | undefined, d = 1, signed = false) => valid(v) ? `${signed && v > 0 ? '+' : ''}${v.toFixed(d)}%` : SYNCING

export const compact = (v: number | null | undefined) => valid(v) && v > 0 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v) : SYNCING

export const utcTime = (ms: number | null | undefined, seconds = true) => valid(ms) && ms > 0 ? new Date(ms).toISOString().slice(11, seconds ? 19 : 16) : '--:--'

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(r).padStart(2, '0')}s`
}

export const tone = (v: number | null | undefined) => !valid(v) || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-positive' : 'text-negative'
export const dirTone = (d: string) => d === 'LONG' ? 'text-positive' : d === 'SHORT' ? 'text-negative' : 'text-muted-foreground'
