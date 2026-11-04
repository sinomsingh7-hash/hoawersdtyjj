'use client'

import type { ReactNode } from 'react'
import { Check, CircleCheck, CircleX, LockKeyhole, LockKeyholeOpen, Radar, ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { SCALP_CARD_CONFIG, TF_LABEL } from '@/lib/xau/constants'
import { dirTone, elapsed, num, pct, px, SYNCING, tone, utcTime } from '@/lib/xau/format'
import type { ScalpCard as Card, IdealSource, IdealState } from '@/lib/xau/types'
import { cn } from '@/lib/utils'

export function stateLabel(card: Card) {
  const d = card.locked_signal?.direction
  switch (card.lock_state) {
    case 'LOCKED_ACTIVE': return `LOCKED ${d}`
    case 'TP1_PARTIAL': return 'TP1 HIT • BE LOCKED'
    case 'TP2_PARTIAL': return 'TP2 HIT • TRAIL LOCKED'
    case 'EXPIRED_COOLDOWN': return 'COOLDOWN • 1 BAR'
    case 'SCANNING': return 'SCANNING CLOSE'
    default: return SYNCING
  }
}

const IDEAL_SOURCE: Record<IdealSource, string> = { FVG_EDGE: 'FVG edge', CANDLE_50: 'Candle 50%', RISK_33: '33% risk' }
const IDEAL_STATE: Record<IdealState, { label: string; cls: string }> = {
  PENDING: { label: 'LIMIT PENDING', cls: 'text-primary' },
  FILLED: { label: 'FILLED', cls: 'text-positive' },
  MISSED: { label: 'MISSED', cls: 'text-muted-foreground' },
}

function StateBadge({ card }: { card: Card }) {
  const d = card.locked_signal?.direction
  const cls = card.is_locked
    ? d === 'LONG' ? 'border-positive/40 bg-positive/10 text-positive' : 'border-negative/40 bg-negative/10 text-negative'
    : card.lock_state === 'SCANNING' ? 'border-primary/30 bg-primary/8 text-primary' : 'border-border bg-muted/40 text-muted-foreground'
  return <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wide whitespace-nowrap', cls)}>
    {card.is_locked ? <LockKeyhole className="size-2.5" aria-hidden="true" /> : card.lock_state === 'SCANNING' ? <Radar className="size-2.5" aria-hidden="true" /> : <Timer className="size-2.5" aria-hidden="true" />}
    {stateLabel(card)}
  </span>
}

function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return null
  return <span className={cn('rounded border px-1 py-0.5 font-mono text-[9px] font-semibold', grade === 'A+' ? 'border-primary/50 bg-primary/15 text-primary' : grade === 'A' ? 'border-primary/30 text-primary/90' : 'border-border text-muted-foreground')} title="Signal grade from agreement headroom above the lock threshold">{grade}</span>
}

function AgreementMeter({ card, large }: { card: Card; large?: boolean }) {
  const cfg = SCALP_CARD_CONFIG[card.tf]
  const sig = card.locked_signal
  const ready = card.lock_state !== 'SYNCING'
  const confirmed = sig ? sig.locked_agreement_pct : card.closed_agreement_pct
  const dir = sig?.direction ?? card.closed_dir
  const fill = dir === 'LONG' ? (sig ? 'bg-positive' : 'bg-positive/80') : dir === 'SHORT' ? (sig ? 'bg-negative' : 'bg-negative/80') : 'bg-muted-foreground/50'
  const close = sig ? sig.locked_close_pct : card.close_intel ? (dir === 'LONG' ? card.close_intel.long_pts : dir === 'SHORT' ? card.close_intel.short_pts : card.close_intel.score) : 0
  return <div className="flex flex-col gap-1.5">
    <div className="flex items-end justify-between gap-2">
      <div className="flex items-end gap-3">
        <div>
          <div className="text-[8px] tracking-wider text-muted-foreground">{sig ? 'LOCKED AGREEMENT' : 'CLOSE-CONFIRMED AGREEMENT'}</div>
          <div className={cn('font-mono font-semibold tabular-nums', large ? 'text-2xl' : 'text-base', !sig && dirTone(dir))}>{ready ? pct(confirmed) : SYNCING}</div>
        </div>
        <div>
          <div className="text-[8px] tracking-wider text-muted-foreground">LIVE</div>
          <div className={cn('font-mono tabular-nums', large ? 'text-lg' : 'text-xs')}>{ready ? pct(card.live_agreement_pct) : '—'}{sig && <span className={cn('ml-1 text-[10px]', tone(card.agreement_drift_pct))}>{pct(card.agreement_drift_pct, 1, true)}</span>}</div>
        </div>
      </div>
      <div className="text-right text-[9px] text-muted-foreground"><div>Lock ≥ {cfg.min_agree_pct}%</div><div className={cn('font-mono', dirTone(dir))}>{ready ? dir : '—'}</div></div>
    </div>
    <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ready ? confirmed : 0} aria-label={`${TF_LABEL[card.tf]} close-confirmed signal agreement`}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', fill)} style={{ width: `${ready ? Math.min(100, confirmed) : 0}%` }} />
      <span className="absolute top-0 h-full w-px bg-foreground/70" style={{ left: `${cfg.min_agree_pct}%` }} aria-hidden="true" />
    </div>
    <div className="grid grid-cols-3 gap-1 font-mono text-[9px] text-muted-foreground">
      <span>Intra {ready ? (sig ? sig.locked_intra_pct : card.closed_intra_pct).toFixed(0) : '—'}</span>
      <span className="text-center">Close {ready ? close.toFixed(0) : '—'}</span>
      <span className="text-right">MTF {ready ? `${sig ? sig.locked_aligned_tfs.length : card.closed_aligned_count}/8 · ${(sig ? sig.locked_mtf_pct : card.weighted_mtf_pct).toFixed(0)}%` : '—'}</span>
    </div>
  </div>
}

function Level({ label, value, tint, hit, muted, note }: { label: string; value: number | null | undefined; tint?: string; hit?: boolean; muted?: boolean; note?: ReactNode }) {
  return <div className="flex items-center justify-between gap-2 py-1 text-[10px]">
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">{hit && <Check className="size-3 shrink-0 text-positive" aria-label="hit" />}<span className="truncate">{label}</span>{note}</span>
    <span className={cn('font-mono tabular-nums', tint, muted && 'opacity-60')}>{px(value)}</span>
  </div>
}

function Gates({ card, large }: { card: Card; large?: boolean }) {
  const gates = card.locked_signal?.gates ?? card.gates
  if (!gates.length) return null
  const passed = gates.filter(g => g.pass).length
  return <div className="border-t border-border pt-1.5">
    <div className="mb-1 flex items-center justify-between text-[8px] tracking-wider text-muted-foreground"><span>{card.locked_signal ? 'GATES AT LOCK (FROZEN)' : 'CLOSE LOCK GATES'}</span><span className={cn('font-mono', passed === gates.length ? 'text-positive' : 'text-muted-foreground')}>{passed}/{gates.length}</span></div>
    {large
      ? <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">{gates.map(g => <li key={g.key} className="flex items-center gap-1 text-[9px]">{g.pass ? <CircleCheck className="size-3 shrink-0 text-positive" aria-label="pass" /> : <CircleX className="size-3 shrink-0 text-negative/80" aria-label="fail" />}<span className={cn('truncate', g.pass ? 'text-foreground/80' : 'text-muted-foreground')}>{g.label}</span></li>)}</ul>
      : <ul className="flex gap-0.5" aria-label={`${passed} of ${gates.length} lock gates passed`}>{gates.map(g => <li key={g.key} title={`${g.label}: ${g.pass ? 'pass' : 'fail'}`} className={cn('h-1 flex-1 rounded-full', g.pass ? 'bg-positive/80' : 'bg-muted')} />)}</ul>}
  </div>
}

export function ScalpCardView({ card, nowMs, active, onSelect, large }: { card: Card; nowMs: number; active?: boolean; onSelect?: () => void; large?: boolean }) {
  const cfg = SCALP_CARD_CONFIG[card.tf]
  const sig = card.locked_signal
  const pv = card.preview
  const ci = card.close_intel
  const left = card.next_close_ms && nowMs ? Math.max(0, Math.floor((card.next_close_ms - nowMs) / 1000)) : null
  const countdown = left === null ? '—' : left >= 3600 ? `${Math.floor(left / 3600)}h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}m` : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
  const idealState = IDEAL_STATE[card.ideal_state]
  const body = <>
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span className={cn('flex h-6 min-w-8 items-center justify-center rounded border px-1.5 font-mono text-[11px] font-semibold', active ? 'border-primary/50 bg-primary/12 text-primary' : 'border-border text-foreground')}>{cfg.label}</span>
        <StateBadge card={card} />
        <GradeBadge grade={sig?.grade ?? (card.lock_state === 'SCANNING' ? card.candidate_grade : null)} />
      </div>
      {sig ? <span className="flex items-center gap-1 text-[9px] text-muted-foreground" title={sig.signal_id}><LockKeyhole className="size-3 text-primary" aria-hidden="true" /><span className="font-mono">{elapsed(nowMs - sig.locked_at_ms)}</span></span> : <LockKeyholeOpen className="size-3 text-muted-foreground" aria-label="Unlocked" />}
    </div>
    {sig && <div className="flex items-center justify-between gap-2 font-mono text-[9px]">
      <span className="truncate text-primary/80" title={`Locked ${utcTime(sig.locked_at_ms)} UTC`}>{sig.signal_id}</span>
      <span className={cn('flex shrink-0 items-center gap-1', card.seal_ok ? 'text-positive' : 'text-negative')} title={`Integrity seal ${sig.seal}`}>{card.seal_ok ? <ShieldCheck className="size-3" aria-hidden="true" /> : <ShieldAlert className="size-3" aria-hidden="true" />}{sig.seal.slice(0, 8)}</span>
    </div>}
    <AgreementMeter card={card} large={large} />
    <div className="border-t border-border pt-1.5">
      {sig ? <>
        <Level label="Entry (frozen at close)" value={sig.entry_price} tint="text-primary" />
        <Level label={`Ideal entry · ${IDEAL_SOURCE[sig.ideal_source]}`} value={sig.ideal_entry} tint="text-primary/80" hit={card.ideal_state === 'FILLED'} note={<span className={cn('ml-1 shrink-0 font-mono text-[8px]', idealState.cls)}>{idealState.label}</span>} />
        <Level label={`Stop loss · ${sig.sl_source === 'STRUCTURE' ? 'structure' : 'ATR'}`} value={sig.initial_sl} tint="text-negative" />
        {card.dynamic_trail_sl !== sig.initial_sl && <Level label="Trail SL" value={card.dynamic_trail_sl} tint="text-negative/80" />}
        <Level label={`Target 1 (${cfg.tp1_r.toFixed(1)}R)`} value={sig.tp1_price} tint="text-positive" hit={card.tp1_hit} />
        <Level label={`Target 2 (${cfg.tp2_r.toFixed(1)}R)`} value={sig.tp2_price} tint="text-positive" hit={card.tp2_hit} />
        <Level label={`Target 3 (${cfg.tp3_r.toFixed(1)}R)`} value={sig.tp3_price} tint="text-positive" />
        <div className="flex justify-between pt-0.5 font-mono text-[9px] text-muted-foreground"><span>R:R @ ideal</span><span>TP1 {sig.rr_tp1_ideal.toFixed(2)} · TP3 {sig.rr_tp3_ideal.toFixed(2)}</span></div>
      </> : <>
        <div className="flex items-center justify-between py-1 text-[8px] tracking-wider text-muted-foreground"><span>PREVIEW · LOCKS ONLY ON CLOSE</span><span className="font-mono text-primary">{countdown}</span></div>
        <Level label="Entry" value={pv?.entry} muted />
        <Level label={`Ideal entry${pv ? ` · ${IDEAL_SOURCE[pv.ideal_source]}` : ''}`} value={pv?.ideal} muted />
        <Level label="Stop loss" value={pv?.sl} muted />
        <Level label={`Target 1 (${cfg.tp1_r.toFixed(1)}R)`} value={pv?.tp1} muted />
        <Level label={`Target 2 (${cfg.tp2_r.toFixed(1)}R)`} value={pv?.tp2} muted />
        <Level label={`Target 3 (${cfg.tp3_r.toFixed(1)}R)`} value={pv?.tp3} muted />
      </>}
    </div>
    <Gates card={card} large={large} />
    {(sig || ci) && <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
      <span className="text-[8px] tracking-wider">{sig ? 'SIGNAL CANDLE' : 'LAST CLOSE'}</span>
      <span className={dirTone((sig?.close_snapshot.pattern ?? ci?.pattern ?? '').startsWith('BULL') ? 'LONG' : (sig?.close_snapshot.pattern ?? ci?.pattern ?? '').startsWith('BEAR') ? 'SHORT' : '')}>{(sig?.close_snapshot.pattern ?? ci?.pattern ?? '').replace('_', ' ')}</span>
      <span>CLV {num(sig?.close_snapshot.clv ?? ci?.clv, 2, true)}</span>
      <span>Body {(sig?.close_snapshot.body_pct ?? ci?.body_pct ?? 0).toFixed(0)}%</span>
      <span>Vol {(sig?.close_snapshot.vol_ratio ?? ci?.vol_ratio ?? 0).toFixed(2)}×</span>
      <span className={(sig?.close_snapshot.delta_confirm ?? ci?.delta_confirm) ? 'text-positive' : ''}>Δ {(sig?.close_snapshot.delta_confirm ?? ci?.delta_confirm) ? '✓' : '×'}</span>
    </div>}
    <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-2 font-mono text-[10px]">
      <div><div className="font-sans text-[8px] text-muted-foreground">PNL $/XAU</div><div className={tone(sig ? card.unrealized_pnl_xau : null)}>{sig ? num(card.unrealized_pnl_xau, 2, true) : '—'}</div></div>
      <div><div className="font-sans text-[8px] text-muted-foreground">R-MULTIPLE</div><div className={tone(sig ? card.unrealized_r : null)}>{sig ? `${num(card.unrealized_r, 2, true)}R` : '—'}</div></div>
      <div className="text-right"><div className="font-sans text-[8px] text-muted-foreground">HOLD</div><div>{sig ? `${card.bars_elapsed}/${cfg.max_hold_bars}` : `—/${cfg.max_hold_bars}`}</div></div>
    </div>
    <div className="truncate font-mono text-[9px] text-muted-foreground" title={card.last_eval_note}>{card.last_eval_note}</div>
    {card.last_resolved && !sig && <div className="rounded border border-border bg-muted/30 px-2 py-1 font-mono text-[9px] text-muted-foreground">
      Last: <span className={card.last_resolved.outcome === 'RESOLVED_WIN' ? 'text-positive' : card.last_resolved.outcome === 'RESOLVED_LOSS' ? 'text-negative' : ''}>{card.last_resolved.outcome.replace('RESOLVED_', '')}</span> {card.last_resolved.reason.replaceAll('_', ' ').toLowerCase()} · {num(card.last_resolved.r_multiple, 2, true)}R
    </div>}
  </>
  const className = cn('flex flex-col gap-2.5 rounded-md border bg-card p-3 text-left transition-colors', active ? 'border-primary/50' : 'border-border hover:border-primary/30', sig?.direction === 'LONG' && 'shadow-[inset_2px_0_0_var(--positive)]', sig?.direction === 'SHORT' && 'shadow-[inset_2px_0_0_var(--negative)]')
  if (!onSelect) return <div className={className}>{body}</div>
  return <button type="button" onClick={onSelect} aria-pressed={active} aria-label={`Focus ${cfg.label} scalp trade card`} className={className}>{body}</button>
}
