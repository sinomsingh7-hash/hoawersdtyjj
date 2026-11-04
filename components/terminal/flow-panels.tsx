'use client'

import { Droplets, Grid3x3, Waves } from 'lucide-react'
import { TF_LABEL } from '@/lib/xau/constants'
import { num, px, SYNCING, tone } from '@/lib/xau/format'
import type { Confluence } from '@/lib/xau/types'
import { cn } from '@/lib/utils'
import { DataRow, Panel } from './panel'

function Flag({ on, label, kind }: { on: boolean; label: string; kind: 'bull' | 'bear' | 'warn' }) {
  return <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[9px]', !on ? 'border-border text-muted-foreground/60' : kind === 'bull' ? 'border-positive/40 bg-positive/10 text-positive' : kind === 'bear' ? 'border-negative/40 bg-negative/10 text-negative' : 'border-primary/40 bg-primary/10 text-primary')}>{label}</span>
}

export function LiquidityPanel({ c }: { c: Confluence }) {
  return <Panel title="24h liquidity map" icon={<Droplets className="size-3.5" />} action={<span className="font-mono text-[9px] font-normal text-muted-foreground">{c.pd_date ?? SYNCING}</span>}>
    <div className="divide-y divide-border px-4">
      <DataRow label="PDH · prev UTC day high">{px(c.pdh)}</DataRow>
      <DataRow label="Distance to PDH" className={tone(c.dist_pdh)}>{num(c.dist_pdh, 2, true)}</DataRow>
      <DataRow label="PDL · prev UTC day low">{px(c.pdl)}</DataRow>
      <DataRow label="Distance to PDL" className={tone(c.dist_pdl)}>{num(c.dist_pdl, 2, true)}</DataRow>
      <DataRow label="CDH / CDL">{px(c.cdh)} / {px(c.cdl)}</DataRow>
      <DataRow label="Asian range 00–08 UTC">{px(c.asian_high)} / {px(c.asian_low)}</DataRow>
    </div>
    <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border px-4 py-3">
      <Flag on={c.pdl_sweep} label="PDL SWEEP_ALERT" kind="bull" />
      <Flag on={c.pdh_sweep} label="PDH SWEEP_ALERT" kind="bear" />
      <Flag on={c.sweep_testing} label="SWEEP_TESTING" kind="warn" />
      <Flag on={c.absorption_bull} label={`BULL ABSORPTION${c.absorption_tf ? ` ${c.absorption_tf}` : ''}`} kind="bull" />
      <Flag on={c.absorption_bear} label={`BEAR ABSORPTION${c.absorption_tf ? ` ${c.absorption_tf}` : ''}`} kind="bear" />
    </div>
  </Panel>
}

export function VwapPanel({ c }: { c: Confluence }) {
  return <Panel title="00:00 UTC VWAP · CVD" icon={<Waves className="size-3.5" />} action={<span className={cn('font-mono text-[9px] font-normal', tone(c.vwap_distance))}>{c.vwap_distance === null ? SYNCING : c.vwap_distance >= 0 ? 'LONG BIAS' : 'SHORT BIAS'}</span>}>
    <div className="divide-y divide-border px-4">
      <DataRow label="+2SD">{px(c.vwap_upper_2sd)}</DataRow>
      <DataRow label="+1SD">{px(c.vwap_upper_1sd)}</DataRow>
      <DataRow label="UTC VWAP" className="text-[#7fb7f5]">{px(c.utc_vwap)}</DataRow>
      <DataRow label="−1SD">{px(c.vwap_lower_1sd)}</DataRow>
      <DataRow label="−2SD">{px(c.vwap_lower_2sd)}</DataRow>
      <DataRow label="Distance to VWAP" className={tone(c.vwap_distance)}>{num(c.vwap_distance, 2, true)}</DataRow>
      <DataRow label="00:00 UTC CVD (XAU)" className={tone(c.cvd)}>{num(c.cvd, 1, true)}</DataRow>
    </div>
    <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border px-4 py-3">
      <Flag on={c.cvd_bull_div} label="CVD_BULL_DIV" kind="bull" />
      <Flag on={c.cvd_bear_div} label="CVD_BEAR_DIV" kind="bear" />
    </div>
  </Panel>
}

export function MatrixPanel({ c }: { c: Confluence }) {
  const biasTone = c.terminal_bias === 'STRONG BULLISH' ? 'text-positive' : c.terminal_bias === 'STRONG BEARISH' ? 'text-negative' : 'text-primary'
  return <Panel title="1m–4H delta & trend matrix" icon={<Grid3x3 className="size-3.5" />} action={<span className={cn('font-mono text-[9px] font-normal', biasTone)}>{c.terminal_bias}</span>}>
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <caption className="sr-only">Five-bar Solution-A delta and EMA20 position per timeframe</caption>
        <thead><tr className="border-b border-border text-[9px] text-muted-foreground"><th scope="col" className="px-4 py-2 text-left font-normal">TF</th><th scope="col" className="py-2 text-right font-normal">5-bar Δ XAU</th><th scope="col" className="py-2 text-right font-normal">Close vs EMA20</th><th scope="col" className="px-4 py-2 text-right font-normal">Vote</th></tr></thead>
        <tbody>
          {c.matrix.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">{SYNCING}</td></tr>}
          {c.matrix.map(row => <tr key={row.tf} className="border-b border-border/60 last:border-0">
            <th scope="row" className="px-4 py-1.5 text-left font-mono font-medium">{TF_LABEL[row.tf]}</th>
            <td className={cn('py-1.5 text-right font-mono tabular-nums', tone(row.delta5))}>{row.ema20 ? num(row.delta5, 1, true) : SYNCING}</td>
            <td className={cn('py-1.5 text-right font-mono tabular-nums', tone(row.close - row.ema20))}>{row.ema20 ? num(row.close - row.ema20, 2, true) : '—'}</td>
            <td className={cn('px-4 py-1.5 text-right font-mono font-semibold', tone(row.vote))}>{row.vote > 0 ? '+1' : row.vote < 0 ? '−1' : '0'}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-3 text-[10px]"><span className="text-muted-foreground">confluence_score</span><span className={cn('font-mono text-sm font-semibold', tone(c.confluence_score))}>{c.confluence_score > 0 ? '+' : ''}{c.confluence_score} / 8</span></div>
  </Panel>
}
