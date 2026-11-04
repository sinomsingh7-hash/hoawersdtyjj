'use client'

import { CandlestickChart, Layers } from 'lucide-react'
import { TFS, TF_LABEL, type Tf } from '@/lib/xau/constants'
import { dirTone, num, px, SYNCING, utcTime } from '@/lib/xau/format'
import type { ScalpCard } from '@/lib/xau/types'
import { cn } from '@/lib/utils'
import { DataRow, Panel } from './panel'

export function CloseIntelPanel({ cards, active, onSelect }: { cards: Record<Tf, ScalpCard>; active: Tf; onSelect: (tf: Tf) => void }) {
  return <Panel title="Close-candle intelligence · confirmed bars only" icon={<CandlestickChart className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">non-repainting</span>}>
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <caption className="sr-only">Anatomy of the last closed candle on each timeframe</caption>
        <thead><tr className="border-b border-border text-[9px] text-muted-foreground">
          {['TF', 'Closed', 'Pattern', 'Score', 'CLV', 'Body', 'Wick ↑/↓', 'Vol×', 'Δ', 'EMA', 'Break'].map((h, i) => <th key={h} scope="col" className={cn('py-2 font-normal', i === 0 ? 'px-4 text-left' : i < 3 ? 'text-left' : 'text-right', i === 10 && 'pr-4')}>{h}</th>)}
        </tr></thead>
        <tbody>
          {TFS.map(tf => {
            const ci = cards[tf].close_intel
            return <tr key={tf} onClick={() => onSelect(tf)} className={cn('cursor-pointer border-b border-border/60 font-mono last:border-0 hover:bg-muted/30', active === tf && 'bg-primary/5')}>
              <th scope="row" className={cn('px-4 py-1.5 text-left font-semibold', active === tf ? 'text-primary' : '')}>{TF_LABEL[tf]}</th>
              {ci ? <>
                <td className="py-1.5 text-muted-foreground">{utcTime(ci.bar_ts, false)}</td>
                <td className={cn('py-1.5', dirTone(ci.pattern.startsWith('BULL') ? 'LONG' : ci.pattern.startsWith('BEAR') ? 'SHORT' : ''))}>{ci.pattern.replace('_', ' ')}</td>
                <td className={cn('py-1.5 text-right', dirTone(ci.dir))}>{ci.dir === 'LONG' ? 'L' : ci.dir === 'SHORT' ? 'S' : '—'} {ci.score.toFixed(0)}</td>
                <td className={cn('py-1.5 text-right', ci.clv > 0 ? 'text-positive' : ci.clv < 0 ? 'text-negative' : '')}>{num(ci.clv, 2, true)}</td>
                <td className="py-1.5 text-right">{ci.body_pct.toFixed(0)}%</td>
                <td className="py-1.5 text-right text-muted-foreground">{ci.upper_wick_pct.toFixed(0)}/{ci.lower_wick_pct.toFixed(0)}</td>
                <td className={cn('py-1.5 text-right', ci.vol_ratio >= 1.3 && 'text-primary')}>{ci.vol_ratio.toFixed(2)}</td>
                <td className={cn('py-1.5 text-right', ci.delta_confirm ? 'text-positive' : 'text-muted-foreground')}>{ci.delta_confirm ? '✓' : '×'}</td>
                <td className={cn('py-1.5 text-right', ci.ema_side === 'ABOVE' ? 'text-positive' : ci.ema_side === 'BELOW' ? 'text-negative' : 'text-muted-foreground')}>{ci.ema_side}</td>
                <td className="py-1.5 pr-4 text-right text-muted-foreground">{ci.break_state === 'ABOVE_PREV_HIGH' ? '↑ PH' : ci.break_state === 'BELOW_PREV_LOW' ? '↓ PL' : 'inside'}</td>
              </> : <td colSpan={10} className="py-1.5 text-muted-foreground">{SYNCING}</td>}
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </Panel>
}

export function CandleFillPanel({ card }: { card: ScalpCard }) {
  const f = card.fill
  return <Panel title={`Candle fill logic · ${TF_LABEL[card.tf]}`} icon={<Layers className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">{f ? `${f.filled_recent} FVGs filled · 80 bars` : SYNCING}</span>}>
    <div className="divide-y divide-border px-4">
      <DataRow label="Prev candle 50% (equilibrium)">{px(f?.prev_candle_mid)}</DataRow>
      <DataRow label="Forming bar retrace into prev candle" className={f?.prev_candle_mid_filled ? 'text-primary' : ''}>{f ? `${f.prev_candle_fill_pct.toFixed(0)}%${f.prev_candle_mid_filled ? ' · 50% FILLED' : ''}` : SYNCING}</DataRow>
      <DataRow label="Nearest bull FVG (support)" className="text-positive">{f?.nearest_bull ? `${px(f.nearest_bull.bottom)} – ${px(f.nearest_bull.top)}` : '—'}</DataRow>
      <DataRow label="Nearest bear FVG (resistance)" className="text-negative">{f?.nearest_bear ? `${px(f.nearest_bear.bottom)} – ${px(f.nearest_bear.top)}` : '—'}</DataRow>
    </div>
    <div className="px-4 pt-2 pb-3">
      <div className="mb-1.5 text-[8px] tracking-wider text-muted-foreground">OPEN IMBALANCES NEAREST PRICE</div>
      {!f?.open_fvgs.length && <p className="py-2 text-[10px] text-muted-foreground">{f ? 'No unfilled fair-value gaps within the last 80 closed bars.' : SYNCING}</p>}
      <ul className="flex flex-col gap-1.5">
        {f?.open_fvgs.map(g => <li key={g.id} className="flex flex-col gap-1">
          <div className="flex justify-between font-mono text-[10px]"><span className={g.side === 'BULL' ? 'text-positive' : 'text-negative'}>{g.side} {px(g.bottom)} – {px(g.top)}</span><span className="text-muted-foreground">{utcTime(g.created_ts, false)} · {g.fill_pct.toFixed(0)}% filled</span></div>
          <div className="h-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.fill_pct} aria-label={`${g.side} gap fill`}><div className={cn('h-full', g.side === 'BULL' ? 'bg-positive/70' : 'bg-negative/70')} style={{ width: `${g.fill_pct}%` }} /></div>
        </li>)}
      </ul>
    </div>
  </Panel>
}
