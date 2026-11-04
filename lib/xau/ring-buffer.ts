import type { XBar } from './types'

/** Solution A — Mechanism 4: persistent 00:00 UTC ring-buffer of tick-exact closed 1m flow. */
const PREFIX = 'okx_xau_flow_'
type Entry = [buy_vol: number, sell_vol: number, delta: number, trades: number]

export const flowKey = (ms: number) => {
  const d = new Date(ms)
  return `${PREFIX}${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}_${String(d.getUTCDate()).padStart(2, '0')}`
}

const read = (key: string): Record<string, Entry> => {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

export function loadTodayFlow(nowMs: number) {
  if (typeof localStorage === 'undefined') return new Map<number, Entry>()
  const map = new Map<number, Entry>()
  for (const [ts, entry] of Object.entries(read(flowKey(nowMs)))) {
    if (Array.isArray(entry) && entry.length === 4 && entry.every(Number.isFinite)) map.set(Number(ts), entry)
  }
  return map
}

export function persistClosed1m(bar: XBar) {
  if (typeof localStorage === 'undefined') return
  const key = flowKey(bar.ts)
  try {
    const store = read(key)
    store[bar.ts] = [bar.buy_vol, bar.sell_vol, bar.delta, bar.trades]
    localStorage.setItem(key, JSON.stringify(store))
  } catch { /* Storage quota exhausted: the live session continues without persistence. */ }
}

/** Keep today and yesterday; drop older day buckets. */
export function pruneOldFlow(nowMs: number) {
  if (typeof localStorage === 'undefined') return
  const keep = new Set([flowKey(nowMs), flowKey(nowMs - 86_400_000)])
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX) && !keep.has(key)) localStorage.removeItem(key)
  }
}
