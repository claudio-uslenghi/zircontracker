import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  message: string
}

// Consistent "nothing here yet" treatment — icon + message instead of a
// lone line of gray text with no visual weight.
export default function EmptyState({ icon: Icon, message }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-100">
        <Icon size={18} className="text-gray-400" />
      </div>
      <p className="text-sm text-gray-400 max-w-xs">{message}</p>
    </div>
  )
}
