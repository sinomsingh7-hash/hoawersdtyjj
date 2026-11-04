import { TFS, TF_MS, SCALP_CARD_CONFIG, type Tf } from './constants'
import type { IdealState, LockedSignal, ResolvedSignal } from './types'

/** FNV-1a 32-bit over a string with a custom offset basis. */
function fnv1a(input: string, seed: number) {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

type SealFields = Omit<LockedSignal, 'seal' | 'locked_tf_snapshot' | 'locked_aligned_tfs' | 'gates' | 'close_snapshot'>

const canonical = (s: SealFields) => [
  s.signal_id, s.timeframe, s.direction, s.locked_at_ms, s.signal_bar_ts, s.entry_price, s.ideal_entry, s.initial_sl,
  s.tp1_price, s.tp2_price, s.tp3_price, s.atr_at_lock, s.locked_agreement_pct, s.grade,
].join('|')

export const computeSeal = (s: SealFields) => `${fnv1a(canonical(s), 0x811c9dc5)}${fnv1a(canonical(s), 0x2f9be6cc)}`.toUpperCase()
export const verifySeal = (s: LockedSignal) => computeSeal(s) === s.seal

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
    Object.freeze(value)
  }
  return value
}

const KEY = 'omni_xau_locks_v18'

export type PersistedCard = { locked_signal: LockedSignal; tp1_hit: boolean; tp2_hit: boolean; dynamic_trail_sl: number; ideal_state: IdealState }
type Store = { cards: Partial<Record<Tf, PersistedCard>>; history: ResolvedSignal[] }

export function saveLocks(store: Store) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch {}
}

/** Restore only locks whose seal still verifies and whose max-hold window has not elapsed. */
export function loadLocks(nowMs: number): Store {
  const empty: Store = { cards: {}, history: [] }
  if (typeof localStorage === 'undefined') return empty
  let raw: Store
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null') ?? empty } catch { return empty }
  const out: Store = { cards: {}, history: Array.isArray(raw.history) ? raw.history.filter(h => h?.signal && verifySeal(h.signal)).slice(0, 50) : [] }
  for (const tf of TFS) {
    const c = raw.cards?.[tf]
    if (!c?.locked_signal || !verifySeal(c.locked_signal)) continue
    const maxAge = (SCALP_CARD_CONFIG[tf].max_hold_bars + 1) * TF_MS[tf]
    if (nowMs - c.locked_signal.locked_bar_ts > maxAge) continue
    out.cards[tf] = { ...c, locked_signal: deepFreeze(c.locked_signal) }
  }
  out.history.forEach(h => deepFreeze(h.signal))
  return out
}
