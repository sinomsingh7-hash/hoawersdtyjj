import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Panel({ title, icon, action, children, className, id }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cn('terminal-panel', className)}>
    <header className="panel-heading"><h2 className="flex min-w-0 items-center gap-2">{icon}<span>{title}</span></h2>{action}</header>
    {children}
  </section>
}
export function DataRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="text-muted-foreground">{label}</span><span className={cn('font-mono font-medium tabular-nums', className)}>{children}</span></div>
}
export function StatusDot({ live = false }: { live?: boolean }) { return <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', live ? 'bg-positive shadow-[0_0_7px_#31cba266]' : 'bg-primary')} /> }
