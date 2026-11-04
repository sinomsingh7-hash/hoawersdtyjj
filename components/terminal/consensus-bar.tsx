'use client'

import { LockKeyhole } from 'lucide-react'
import { TFS, TF_LABEL, type Tf } from '@/lib/xau/constants'
import { dirTone, pct, SYNCING } from '@/lib/xau/format'
import type { Consensus } from '@/lib/xau/scalp-cards'
import type { ScalpCard } from '@/lib/xau/types'
import { cn } from '@/lib/utils'

export function ConsensusBar({ consensus, cards, active, onSelect }: { consensus: Consensus; cards: Record<Tf, ScalpCard>; active: Tf; onSelect: (tf: Tf) => void }) {
  const ready = consensus.ready_tfs > 0
  const dir = consensus.global_dir
  return <section aria-label="8-timeframe consensus" className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 lg:flex-row lg:items-center lg:gap-5">
    <div className="flex shrink-0 items-center gap-4">
      <div>
        <div className="eyebrow">8-TF CLOSE CONSENSUS</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={cn('font-mono text-xl font-semibold tabular-nums', dirTone(dir))}>{ready ? `${consensus.global_aligned_count}/8` : SYNCING}</span>
          <span className="text-[10px] text-muted-foreground">TFs aligned {ready && dir !== 'NEUTRAL' && <span className={dirTone(dir)}>{dir}</span>}</span>
        </div>
      </div>
      <div className="border-l border-border pl-4">
        <div className="text-[8px] tracking-wider text-muted-foreground">WEIGHTED AGREEMENT</div>
        <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{ready ? pct(consensus.global_signal_agreement_pct) : SYNCING}</div>
      </div>
      <div className="hidden border-l border-border pl-4 font-mono text-[10px] sm:block">
        <div className="text-positive">{consensus.bull_tfs} bull</div>
        <div className="text-negative">{consensus.bear_tfs} bear</div>
      </div>
    </div>
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:flex-1">
      {TFS.map(tf => {
        const card = cards[tf]
        const d = card.locked_signal?.direction ?? card.closed_dir
        return <button key={tf} type="button" onClick={() => onSelect(tf)} aria-pressed={active === tf} className={cn('flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 transition-colors', active === tf ? 'border-primary/50 bg-primary/8' : 'border-border hover:border-primary/30')}>
          <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">{TF_LABEL[tf]}{card.is_locked && <LockKeyhole className="size-2.5 text-primary" aria-label="locked" />}</span>
          <span className={cn('font-mono text-[11px] font-semibold tabular-nums', dirTone(d))}>{card.lock_state === 'SYNCING' ? '—' : pct(card.locked_signal?.locked_agreement_pct ?? card.closed_agreement_pct)}</span>
        </button>
      })}
    </div>
  </section>
}
