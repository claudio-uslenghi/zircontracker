import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  value: string | number
  label: string
  /** 'md' (default) fits 3-4 cards in a row (Mis Horas/Mi Reporte); 'lg' is
   * for a page with just 1-2 headline cards (Dashboard). */
  size?: 'md' | 'lg'
}

// Same icon-box + number + label markup that Dashboard/Mi Reporte/Mis Horas
// each hand-rolled 3-4 times — one place to keep the visual language consistent.
export default function StatCard({ icon: Icon, value, label, size = 'md' }: Props) {
  const boxSize = size === 'lg' ? 'w-11 h-11' : 'w-9 h-9'
  const iconSize = size === 'lg' ? 20 : 17
  const valueSize = size === 'lg' ? 'text-2xl' : 'text-lg'
  const labelSize = size === 'lg' ? 'text-sm' : 'text-xs'
  const padding = size === 'lg' ? 'p-5' : 'p-4'

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${padding} flex items-center gap-3 sm:gap-4`}>
      <div className={`${boxSize} rounded-lg flex items-center justify-center shrink-0 bg-primary-light`}>
        <Icon size={iconSize} className="text-primary" />
      </div>
      <div className="min-w-0">
        <p className={`${valueSize} font-bold text-[#3a3a3a] truncate tabular-nums`}>{value}</p>
        <p className={`${labelSize} text-gray-500 truncate`}>{label}</p>
      </div>
    </div>
  )
}
