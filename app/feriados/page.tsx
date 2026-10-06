'use client'

import { Fragment, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { formatDate } from '@/lib/date-utils'
import { Plus, Trash2, Upload, Download, Filter, Pencil, Send } from 'lucide-react'
import HolidayModal from '@/components/modals/HolidayModal'
import HolidaysBotModal from '@/components/modals/HolidaysBotModal'
import CsvImportModal from '@/components/modals/CsvImportModal'
import Pagination from '@/components/ui/Pagination'
import type { CountryHoliday, SyncRunSummary } from '@/types'
import { FLAG_BY_NAME } from '@/lib/countries'
import { confirmDialog } from '@/lib/confirm-dialog'

function countryLabel(name: string) {
  const flag = FLAG_BY_NAME[name] ?? '🌍'
  return `${flag} ${name}`
}

const lastRunFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function FeriadosPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = ((session?.user as { roles?: string[] })?.roles ?? []).includes('admin')
  const [showHolidayModal, setShowHolidayModal] = useState(false)
  const [editHoliday, setEditHoliday] = useState<CountryHoliday | null>(null)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [showHolidaysBotModal, setShowHolidaysBotModal] = useState(false)

  // País filtrado reflejado en la URL (deep-linkable, sobrevive un reload) —
  // mismo criterio que /projects y el resto de la app.
  const setParams = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)))
    router.replace(`/feriados?${sp.toString()}`, { scroll: false })
  }
  const filterCountry = searchParams.get('country') ?? ''
  const setFilterCountry = (country: string) => setParams({ country })

  const [holidayPage, setHolidayPage] = useState(1)
  const [holidayPageSize, setHolidayPageSize] = useState(10)

  const { data: countryHolidays = [] } = useQuery<CountryHoliday[]>({
    queryKey: ['country-holidays'],
    queryFn: () => fetch('/api/country-holidays').then((r) => r.json()),
  })

  const { data: lastHolidaysBotRun } = useQuery<SyncRunSummary | null>({
    queryKey: ['holidays-bot-last'],
    queryFn: () => fetch('/api/holidays-bot/send').then((r) => (r.ok ? r.json() : null)),
    enabled: isAdmin,
  })

  const deleteCountryHoliday = async (id: number) => {
    const ok = await confirmDialog({
      title: '¿Eliminar este feriado?',
      description: 'Se eliminará para todos los recursos del país.',
    })
    if (!ok) return
    await fetch(`/api/country-holidays/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['country-holidays'] })
    qc.invalidateQueries({ queryKey: ['holidays'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const handleDownload = () => {
    const params = filterCountry ? `?country=${encodeURIComponent(filterCountry)}` : ''
    window.open(`/api/country-holidays/export${params}`, '_blank')
  }

  // Derive countries dynamically from data (sorted alphabetically)
  const availableCountries = Array.from(new Set(countryHolidays.map((h) => h.country))).sort()

  // Filter by country, paginate the flat list, then group only the current
  // page's slice — a page can start mid-country, same as any flat pagination
  // over grouped data.
  const filtered = filterCountry
    ? countryHolidays.filter((h) => h.country === filterCountry)
    : countryHolidays

  const holidayTotalPages = Math.max(1, Math.ceil(filtered.length / holidayPageSize))
  const holidayPageClamped = Math.min(holidayPage, holidayTotalPages)
  const pagedFiltered = filtered.slice(
    (holidayPageClamped - 1) * holidayPageSize,
    holidayPageClamped * holidayPageSize
  )

  const grouped = pagedFiltered.reduce<Record<string, CountryHoliday[]>>((acc, h) => {
    if (!acc[h.country]) acc[h.country] = []
    acc[h.country].push(h)
    return acc
  }, {})

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Feriados</h1>
          <p className="text-sm text-gray-500 mt-1">Feriados por país — se aplican a todos los recursos de ese país</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowHolidaysBotModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm min-h-[40px]"
          >
            <Send size={14} /> Holidays Bot
          </button>
        )}
      </div>
      {isAdmin && lastHolidaysBotRun && (
        <p className={`text-xs ${lastHolidaysBotRun.ok ? 'text-gray-500' : 'text-red-600'}`}>
          Último envío a Slack (Holidays Bot): {lastRunFormatter.format(new Date(lastHolidaysBotRun.ranAt))} ({lastHolidaysBotRun.trigger === 'cron' ? 'automático' : 'manual'})
          {lastHolidaysBotRun.ok
            ? ` · ${lastHolidaysBotRun.created} país(es), ${lastHolidaysBotRun.updated} feriado(s)`
            : ' · falló'}
        </p>
      )}

      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Country filter */}
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-sm">
              <Filter size={13} className="text-gray-400" />
              <select
                value={filterCountry}
                onChange={(e) => { setFilterCountry(e.target.value); setHolidayPage(1) }}
                className="text-sm text-gray-700 bg-transparent outline-none"
              >
                <option value="">Todos los países</option>
                {availableCountries.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
              </select>
            </div>
            {/* Download */}
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              title="Descargar CSV"
            >
              <Download size={14} /> Descargar
            </button>
            {isAdmin && (
              <>
                {/* Import CSV */}
                <button
                  onClick={() => setShowCsvModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3a3a3a] text-white rounded-lg hover:bg-[#222] transition-colors text-sm"
                >
                  <Upload size={14} /> Importar CSV
                </button>
                {/* Add single */}
                <button
                  onClick={() => { setEditHoliday(null); setShowHolidayModal(true) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] transition-colors text-sm"
                >
                  <Plus size={14} /> Agregar
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-sm">Sin feriados registrados{filterCountry ? ` para ${filterCountry}` : ''}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0170B9] text-white">
                  <th className="px-4 py-3 text-left">País</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  {isAdmin && <th className="px-4 py-3 text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(grouped).map(([country, holidays]) => (
                  <Fragment key={country}>
                    {/* Country sub-header */}
                    <tr key={`header-${country}`} className="bg-gray-50">
                      <td colSpan={isAdmin ? 4 : 3} className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {countryLabel(country)} — {holidays.length} feriado{holidays.length !== 1 ? 's' : ''}
                      </td>
                    </tr>
                    {holidays.map((h) => (
                      <tr key={h.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500">{countryLabel(h.country)}</td>
                        <td className="px-4 py-3 font-medium">{formatDate(h.date)}</td>
                        <td className="px-4 py-3 text-gray-700">{h.name}</td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => { setEditHoliday(h); setShowHolidayModal(true) }}
                                className="text-blue-400 hover:text-blue-600 transition-colors"
                                aria-label={`Editar ${h.name}`}
                                title="Editar"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => deleteCountryHoliday(h.id)}
                                className="text-red-400 hover:text-red-600 transition-colors"
                                aria-label={`Eliminar ${h.name}`}
                                title="Eliminar"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          <Pagination
            page={holidayPageClamped}
            pageSize={holidayPageSize}
            totalItems={filtered.length}
            onPageChange={setHolidayPage}
            onPageSizeChange={(size) => { setHolidayPageSize(size); setHolidayPage(1) }}
          />
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Los feriados se aplican automáticamente a todos los recursos del país. Al agregar un recurso nuevo, hereda los feriados de su país. El Calendario de Vacaciones sigue marcando estos mismos feriados.
        </p>
      </section>

      {isAdmin && (
        <HolidayModal open={showHolidayModal} onClose={() => { setShowHolidayModal(false); setEditHoliday(null) }} editHoliday={editHoliday} />
      )}
      {isAdmin && <CsvImportModal open={showCsvModal} onClose={() => setShowCsvModal(false)} />}
      {isAdmin && <HolidaysBotModal open={showHolidaysBotModal} onClose={() => setShowHolidaysBotModal(false)} />}
    </div>
  )
}

export default function FeriadosPage() {
  return (
    <Suspense>
      <FeriadosPageInner />
    </Suspense>
  )
}
