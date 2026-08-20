'use client'

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Users, FolderKanban, CalendarDays } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

type DashboardSummary = {
  userCount: number
  projectCount: number
  upcomingHolidays: { id: number; country: string; date: string; name: string }[]
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const userName = session?.user?.name ?? session?.user?.email ?? ''

  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: () => fetch('/api/dashboard/summary').then((r) => r.json()),
  })

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#3a3a3a]">Hola, {userName}</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen general de ZirconTracker</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <Users size={20} style={{ color: '#0170B9' }} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#3a3a3a]">{isLoading ? '…' : data?.userCount ?? 0}</p>
            <p className="text-sm text-gray-500">Usuarios activos</p>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <FolderKanban size={20} style={{ color: '#0170B9' }} />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#3a3a3a]">{isLoading ? '…' : data?.projectCount ?? 0}</p>
            <p className="text-sm text-gray-500">Proyectos</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays size={18} style={{ color: '#0170B9' }} />
          <h2 className="text-sm font-semibold text-gray-700">Próximos feriados</h2>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400">Cargando...</p>
        ) : !data?.upcomingHolidays?.length ? (
          <p className="text-sm text-gray-400">No hay feriados próximos cargados.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.upcomingHolidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-700">{h.name}</span>
                <span className="text-gray-400 flex items-center gap-2">
                  <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{h.country}</span>
                  {format(parseISO(h.date), "d 'de' MMMM", { locale: es })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
