// Lightweight animate-pulse placeholders — replaces plain "Cargando..." text
// so the layout doesn't jump once real content arrives.

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3 animate-pulse">
      <div className="w-9 h-9 rounded-lg bg-gray-200 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-10 rounded bg-gray-200" />
        <div className="h-3 w-16 rounded bg-gray-100" />
      </div>
    </div>
  )
}

export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 animate-pulse ${className}`}>
      <div className="w-2 h-2 rounded-full bg-gray-200 shrink-0" />
      <div className="h-3.5 flex-1 max-w-[60%] rounded bg-gray-200" />
      <div className="h-3.5 w-12 rounded bg-gray-100" />
    </div>
  )
}
